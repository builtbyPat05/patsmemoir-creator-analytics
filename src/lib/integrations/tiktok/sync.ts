import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchTikTokUser,
  fetchTikTokVideos,
  refreshTikTokToken,
  type TikTokToken,
  type TikTokUser,
  type TikTokVideo,
} from "@/lib/integrations/tiktok/api";
import { tiktokScopes } from "@/lib/integrations/tiktok/config";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  Database,
  Json,
  Tables,
  TablesInsert,
} from "@/lib/supabase/database.types";

const UPSERT_CHUNK_SIZE = 200;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1_000;
const PUBLICATION_HISTORY_DAYS = 365;

type AdminClient = SupabaseClient<Database>;
type SyncTrigger = Database["public"]["Enums"]["analytics_sync_trigger"];
type PriorAccountSnapshot = Pick<
  Tables<"account_metric_snapshots">,
  "follower_count" | "snapshot_date"
>;
type PriorPostSnapshot = Pick<
  Tables<"post_metric_snapshots">,
  "comments" | "likes" | "post_id" | "shares" | "views"
>;
type StoredCredentials = {
  access_token: string;
  expires_at: string | null;
  provider_metadata: Json | null;
  refresh_token: string | null;
  scopes: string[] | null;
  token_type: string | null;
};

export type TikTokSyncResult = {
  accountId: string;
  metricsUpserted: number;
  postsUpserted: number;
  status: "succeeded" | "partial";
};

export async function connectTikTokAccount(ownerId: string, token: TikTokToken) {
  assertRequiredScopes(token.scopes);

  const admin = createAdminClient();
  const user = await fetchTikTokUser(token.accessToken);
  const now = new Date().toISOString();
  const { data: account, error: accountError } = await admin
    .from("social_accounts")
    .upsert(
      {
        owner_id: ownerId,
        platform: "tiktok",
        external_account_id: user.openId,
        handle: null,
        display_name: user.displayName,
        profile_url: null,
        avatar_url: user.avatarUrl,
        status: "connected",
        scopes: token.scopes,
        connected_at: now,
        token_expires_at: token.expiresAt,
        metadata: userMetadata(user),
      },
      { onConflict: "owner_id,platform,external_account_id" },
    )
    .select("id")
    .single();

  if (accountError) {
    throw new Error(`Unable to save the TikTok account: ${accountError.message}`);
  }

  await storeTikTokToken(admin, account.id, token);

  try {
    return await runTikTokSync(
      admin,
      account.id,
      token.accessToken,
      "oauth",
      user,
    );
  } catch (error) {
    console.error(
      "[tiktok] Initial analytics sync failed after connection.",
      error instanceof Error ? error.message : error,
    );

    return {
      accountId: account.id,
      metricsUpserted: 0,
      postsUpserted: 0,
      status: "partial" as const,
    };
  }
}

export async function syncTikTokAccount(
  ownerId: string,
  accountId: string,
  trigger: SyncTrigger = "manual",
) {
  const admin = createAdminClient();
  const { data: account, error: accountError } = await admin
    .from("social_accounts")
    .select("id, owner_id, platform")
    .eq("id", accountId)
    .eq("owner_id", ownerId)
    .eq("platform", "tiktok")
    .maybeSingle();

  if (accountError || !account) {
    throw new Error("The selected TikTok connection could not be found.");
  }

  const accessToken = await getValidTikTokAccessToken(admin, accountId);
  return runTikTokSync(admin, accountId, accessToken, trigger);
}

async function runTikTokSync(
  admin: AdminClient,
  accountId: string,
  accessToken: string,
  trigger: SyncTrigger,
  knownUser?: TikTokUser,
): Promise<TikTokSyncResult> {
  const snapshotDate = new Date().toISOString().slice(0, 10);
  const { data: syncRun, error: syncRunError } = await admin
    .from("analytics_sync_runs")
    .insert({
      account_id: accountId,
      status: "running",
      trigger,
      range_start: snapshotDate,
      range_end: snapshotDate,
      metadata: { aggregation: "snapshot_delta", platform: "tiktok" },
    })
    .select("id")
    .single();

  if (syncRunError) {
    throw new Error(`Unable to start the TikTok sync: ${syncRunError.message}`);
  }

  try {
    const [user, videos] = await Promise.all([
      knownUser ? Promise.resolve(knownUser) : fetchTikTokUser(accessToken),
      fetchTikTokVideos(accessToken),
    ]);
    const capturedAt = new Date().toISOString();
    const postIdMap = await upsertTikTokPosts(admin, accountId, videos);
    const previousAccount = await getPreviousAccountSnapshot(
      admin,
      accountId,
      snapshotDate,
    );
    const previousPosts = previousAccount
      ? await getPostSnapshots(
        admin,
        [...postIdMap.values()],
        previousAccount.snapshot_date,
      )
      : new Map<string, PriorPostSnapshot>();
    const postMetrics = createPostDailyMetrics(
      videos,
      postIdMap,
      previousPosts,
      previousAccount?.snapshot_date ?? null,
      snapshotDate,
      capturedAt,
    );
    const accountMetric = createAccountDailyMetric(
      accountId,
      user,
      videos,
      postMetrics,
      previousAccount,
      snapshotDate,
      capturedAt,
    );
    const publicationMetrics = createPublicationMetrics(
      accountId,
      videos,
      snapshotDate,
      capturedAt,
    );
    const accountSnapshot = createAccountSnapshot(
      accountId,
      user,
      videos,
      snapshotDate,
      capturedAt,
    );
    const postSnapshots = createPostSnapshots(
      videos,
      postIdMap,
      snapshotDate,
      capturedAt,
    );

    await upsertAccountSnapshot(admin, accountSnapshot);
    await upsertPostSnapshots(admin, postSnapshots);
    await upsertPostMetrics(admin, postMetrics);
    await upsertAccountMetrics(admin, [...publicationMetrics, accountMetric]);

    const { error: accountUpdateError } = await admin
      .from("social_accounts")
      .update({
        display_name: user.displayName,
        avatar_url: user.avatarUrl,
        status: "connected",
        last_synced_at: capturedAt,
        metadata: {
          ...userMetadata(user),
          importedVideoCount: videos.length,
        },
      })
      .eq("id", accountId);

    if (accountUpdateError) {
      throw new Error(`Unable to finish the TikTok account update: ${accountUpdateError.message}`);
    }

    const recordsUpserted = postIdMap.size
      + postMetrics.length
      + publicationMetrics.length
      + postSnapshots.length
      + 1;

    await admin
      .from("analytics_sync_runs")
      .update({
        status: "succeeded",
        finished_at: capturedAt,
        range_start: previousAccount?.snapshot_date ?? snapshotDate,
        records_upserted: recordsUpserted,
        metadata: {
          aggregation: "snapshot_delta",
          baselineDate: previousAccount?.snapshot_date ?? null,
          platform: "tiktok",
          videosImported: videos.length,
        },
      })
      .eq("id", syncRun.id);

    return {
      accountId,
      metricsUpserted: postMetrics.length + publicationMetrics.length + 1,
      postsUpserted: postIdMap.size,
      status: "succeeded",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown TikTok sync error";

    await admin
      .from("analytics_sync_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_code: "TIKTOK_SYNC_FAILED",
        error_message: message.slice(0, 1_000),
      })
      .eq("id", syncRun.id);

    throw error;
  }
}

async function upsertTikTokPosts(
  admin: AdminClient,
  accountId: string,
  videos: TikTokVideo[],
) {
  const rows = videos.map((video) => ({
    account_id: accountId,
    external_post_id: video.id,
    content_type: "video",
    title: video.title,
    caption: video.description,
    permalink: video.shareUrl,
    thumbnail_url: video.coverImageUrl,
    published_at: video.publishedAt,
    duration_seconds: video.durationSeconds,
    metadata: {
      lifetimeCommentCount: video.commentCount,
      lifetimeLikeCount: video.likeCount,
      lifetimeShareCount: video.shareCount,
      lifetimeViewCount: video.viewCount,
      platform: "tiktok",
    },
  } satisfies TablesInsert<"content_posts">));
  const result = new Map<string, string>();

  for (let offset = 0; offset < rows.length; offset += UPSERT_CHUNK_SIZE) {
    const { data, error } = await admin
      .from("content_posts")
      .upsert(rows.slice(offset, offset + UPSERT_CHUNK_SIZE), {
        onConflict: "account_id,external_post_id",
      })
      .select("id, external_post_id");

    if (error) {
      throw new Error(`Unable to save TikTok videos: ${error.message}`);
    }

    data.forEach((post) => result.set(post.external_post_id, post.id));
  }

  return result;
}

async function getPreviousAccountSnapshot(
  admin: AdminClient,
  accountId: string,
  beforeDate: string,
) {
  const { data, error } = await admin
    .from("account_metric_snapshots")
    .select("snapshot_date, follower_count")
    .eq("account_id", accountId)
    .lt("snapshot_date", beforeDate)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load the TikTok account baseline: ${error.message}`);
  }

  return data;
}

async function getPostSnapshots(
  admin: AdminClient,
  postIds: string[],
  snapshotDate: string,
) {
  const result = new Map<string, PriorPostSnapshot>();

  for (let offset = 0; offset < postIds.length; offset += UPSERT_CHUNK_SIZE) {
    const { data, error } = await admin
      .from("post_metric_snapshots")
      .select("post_id, views, likes, comments, shares")
      .in("post_id", postIds.slice(offset, offset + UPSERT_CHUNK_SIZE))
      .eq("snapshot_date", snapshotDate);

    if (error) {
      throw new Error(`Unable to load TikTok post baselines: ${error.message}`);
    }

    data.forEach((snapshot) => result.set(snapshot.post_id, snapshot));
  }

  return result;
}

function createPostDailyMetrics(
  videos: TikTokVideo[],
  postIdMap: Map<string, string>,
  previousPosts: Map<string, PriorPostSnapshot>,
  baselineDate: string | null,
  snapshotDate: string,
  capturedAt: string,
): TablesInsert<"post_daily_metrics">[] {
  return videos.flatMap((video) => {
    const postId = postIdMap.get(video.id);

    if (!postId) return [];

    const previous = previousPosts.get(postId);
    const publishedDate = video.publishedAt.slice(0, 10);
    const countFromZero = !previous && (
      baselineDate ? publishedDate > baselineDate : publishedDate === snapshotDate
    );
    const views = deriveDelta(video.viewCount, previous?.views, countFromZero);
    const likes = deriveDelta(video.likeCount, previous?.likes, countFromZero);
    const comments = deriveDelta(video.commentCount, previous?.comments, countFromZero);
    const shares = deriveDelta(video.shareCount, previous?.shares, countFromZero);

    return [{
      post_id: postId,
      metric_date: snapshotDate,
      views,
      engagements: likes + comments + shares,
      likes,
      comments,
      shares,
      source_updated_at: capturedAt,
      ingested_at: capturedAt,
      metadata: {
        aggregation: "snapshot_delta",
        baselineDate,
        countedFromPublication: countFromZero,
        platform: "tiktok",
      },
    } satisfies TablesInsert<"post_daily_metrics">];
  });
}

function createAccountDailyMetric(
  accountId: string,
  user: TikTokUser,
  videos: TikTokVideo[],
  postMetrics: TablesInsert<"post_daily_metrics">[],
  previousAccount: PriorAccountSnapshot | null,
  snapshotDate: string,
  capturedAt: string,
): TablesInsert<"account_daily_metrics"> {
  const views = sum(postMetrics, "views");
  const likes = sum(postMetrics, "likes");
  const comments = sum(postMetrics, "comments");
  const shares = sum(postMetrics, "shares");

  return {
    account_id: accountId,
    metric_date: snapshotDate,
    views,
    follower_count: user.followerCount,
    follower_delta: previousAccount
      ? user.followerCount - previousAccount.follower_count
      : 0,
    engagements: likes + comments + shares,
    likes,
    comments,
    shares,
    posts_published: videos.filter(
      (video) => video.publishedAt.slice(0, 10) === snapshotDate,
    ).length,
    source_updated_at: capturedAt,
    ingested_at: capturedAt,
    metadata: {
      aggregation: "snapshot_delta",
      baselineDate: previousAccount?.snapshot_date ?? null,
      platform: "tiktok",
    },
  };
}

function createPublicationMetrics(
  accountId: string,
  videos: TikTokVideo[],
  snapshotDate: string,
  capturedAt: string,
): TablesInsert<"account_daily_metrics">[] {
  const earliestDate = addDays(snapshotDate, -(PUBLICATION_HISTORY_DAYS - 1));
  const counts = new Map<string, number>();

  videos.forEach((video) => {
    const publishedDate = video.publishedAt.slice(0, 10);

    if (publishedDate >= earliestDate && publishedDate < snapshotDate) {
      counts.set(publishedDate, (counts.get(publishedDate) ?? 0) + 1);
    }
  });

  return [...counts.entries()].map(([metricDate, postsPublished]) => ({
    account_id: accountId,
    metric_date: metricDate,
    posts_published: postsPublished,
    source_updated_at: capturedAt,
    ingested_at: capturedAt,
    metadata: {
      followerCountUnavailable: true,
      platform: "tiktok",
      publicationBackfill: true,
    },
  }));
}

function createAccountSnapshot(
  accountId: string,
  user: TikTokUser,
  videos: TikTokVideo[],
  snapshotDate: string,
  capturedAt: string,
): TablesInsert<"account_metric_snapshots"> {
  return {
    account_id: accountId,
    snapshot_date: snapshotDate,
    captured_at: capturedAt,
    follower_count: user.followerCount,
    following_count: user.followingCount,
    total_views: videos.reduce((total, video) => total + video.viewCount, 0),
    total_likes: user.likesCount,
    total_comments: videos.reduce((total, video) => total + video.commentCount, 0),
    total_shares: videos.reduce((total, video) => total + video.shareCount, 0),
    post_count: user.videoCount,
    metadata: {
      importedVideoCount: videos.length,
      platform: "tiktok",
    },
  };
}

function createPostSnapshots(
  videos: TikTokVideo[],
  postIdMap: Map<string, string>,
  snapshotDate: string,
  capturedAt: string,
): TablesInsert<"post_metric_snapshots">[] {
  return videos.flatMap((video) => {
    const postId = postIdMap.get(video.id);

    if (!postId) return [];

    return [{
      post_id: postId,
      snapshot_date: snapshotDate,
      captured_at: capturedAt,
      views: video.viewCount,
      likes: video.likeCount,
      comments: video.commentCount,
      shares: video.shareCount,
      metadata: { platform: "tiktok" },
    } satisfies TablesInsert<"post_metric_snapshots">];
  });
}

async function getValidTikTokAccessToken(admin: AdminClient, accountId: string) {
  const { data, error } = await admin.rpc("get_social_account_tokens", {
    p_account_id: accountId,
  });

  if (error || !data?.[0]) {
    throw new Error("Stored TikTok credentials could not be loaded.");
  }

  const credentials = data[0] as StoredCredentials;
  const expiresAt = credentials.expires_at
    ? Date.parse(credentials.expires_at)
    : 0;

  if (expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS) {
    return credentials.access_token;
  }

  if (!credentials.refresh_token) {
    throw new Error("The TikTok connection needs to be authorized again.");
  }

  const token = await refreshTikTokToken(credentials.refresh_token);
  assertRequiredScopes(token.scopes);
  await storeTikTokToken(admin, accountId, token);

  await admin
    .from("social_accounts")
    .update({
      status: "connected",
      token_expires_at: token.expiresAt,
      scopes: token.scopes,
    })
    .eq("id", accountId);

  return token.accessToken;
}

async function storeTikTokToken(
  admin: AdminClient,
  accountId: string,
  token: TikTokToken,
) {
  const { error } = await admin.rpc("store_social_account_tokens", {
    p_account_id: accountId,
    p_access_token: token.accessToken,
    p_refresh_token: token.refreshToken,
    p_token_type: token.tokenType,
    p_scopes: token.scopes,
    p_expires_at: token.expiresAt,
    p_provider_metadata: {
      openId: token.openId,
      provider: "tiktok",
      refreshExpiresAt: token.refreshExpiresAt,
    },
  });

  if (error) {
    throw new Error(`Unable to protect the TikTok credentials: ${error.message}`);
  }
}

async function upsertAccountSnapshot(
  admin: AdminClient,
  row: TablesInsert<"account_metric_snapshots">,
) {
  const { error } = await admin
    .from("account_metric_snapshots")
    .upsert(row, { onConflict: "account_id,snapshot_date" });

  if (error) {
    throw new Error(`Unable to save the TikTok account snapshot: ${error.message}`);
  }
}

async function upsertPostSnapshots(
  admin: AdminClient,
  rows: TablesInsert<"post_metric_snapshots">[],
) {
  for (let offset = 0; offset < rows.length; offset += UPSERT_CHUNK_SIZE) {
    const { error } = await admin
      .from("post_metric_snapshots")
      .upsert(rows.slice(offset, offset + UPSERT_CHUNK_SIZE), {
        onConflict: "post_id,snapshot_date",
      });

    if (error) {
      throw new Error(`Unable to save post_metric_snapshots: ${error.message}`);
    }
  }
}

async function upsertPostMetrics(
  admin: AdminClient,
  rows: TablesInsert<"post_daily_metrics">[],
) {
  for (let offset = 0; offset < rows.length; offset += UPSERT_CHUNK_SIZE) {
    const { error } = await admin
      .from("post_daily_metrics")
      .upsert(rows.slice(offset, offset + UPSERT_CHUNK_SIZE), {
        onConflict: "post_id,metric_date",
      });

    if (error) {
      throw new Error(`Unable to save post_daily_metrics: ${error.message}`);
    }
  }
}

async function upsertAccountMetrics(
  admin: AdminClient,
  rows: TablesInsert<"account_daily_metrics">[],
) {
  for (let offset = 0; offset < rows.length; offset += UPSERT_CHUNK_SIZE) {
    const { error } = await admin
      .from("account_daily_metrics")
      .upsert(rows.slice(offset, offset + UPSERT_CHUNK_SIZE), {
        onConflict: "account_id,metric_date",
      });

    if (error) {
      throw new Error(`Unable to save account_daily_metrics: ${error.message}`);
    }
  }
}

function assertRequiredScopes(scopes: string[]) {
  const missing = tiktokScopes.filter((scope) => !scopes.includes(scope));

  if (missing.length > 0) {
    throw new Error(`TikTok did not grant required permissions: ${missing.join(", ")}.`);
  }
}

function deriveDelta(current: number, previous: number | undefined, countFromZero: boolean) {
  if (previous !== undefined) {
    return Math.max(0, current - previous);
  }

  return countFromZero ? current : 0;
}

function sum(
  rows: TablesInsert<"post_daily_metrics">[],
  key: "comments" | "likes" | "shares" | "views",
) {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

function userMetadata(user: TikTokUser) {
  return {
    followerCount: user.followerCount,
    followingCount: user.followingCount,
    likesCount: user.likesCount,
    unionId: user.unionId,
    videoCount: user.videoCount,
  };
}

function addDays(date: string, numberOfDays: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + numberOfDays);
  return value.toISOString().slice(0, 10);
}
