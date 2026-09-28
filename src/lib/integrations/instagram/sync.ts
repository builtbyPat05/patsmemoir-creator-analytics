import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchInstagramAccountInsights,
  fetchInstagramMedia,
  fetchInstagramMediaInsights,
  fetchInstagramProfile,
  refreshInstagramToken,
  type InstagramAccountInsightPoint,
  type InstagramMedia,
  type InstagramMediaInsights,
  type InstagramProfile,
  type InstagramToken,
} from "@/lib/integrations/instagram/api";
import { instagramScopes } from "@/lib/integrations/instagram/config";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  Database,
  Json,
  Tables,
  TablesInsert,
} from "@/lib/supabase/database.types";

const UPSERT_CHUNK_SIZE = 200;
const TOKEN_REFRESH_MARGIN_MS = 7 * 24 * 60 * 60 * 1_000;
const ACCOUNT_INSIGHT_DAYS = 90;
const MEDIA_HISTORY_DAYS = 365;
const MEDIA_INSIGHT_CONCURRENCY = 5;

type AdminClient = SupabaseClient<Database>;
type SyncTrigger = Database["public"]["Enums"]["analytics_sync_trigger"];
type SyncStatus = "succeeded" | "partial";
type PriorAccountSnapshot = Pick<
  Tables<"account_metric_snapshots">,
  "follower_count" | "snapshot_date"
>;
type PriorPostSnapshot = Pick<
  Tables<"post_metric_snapshots">,
  "comments" | "likes" | "post_id" | "reach" | "saves" | "shares" | "views"
>;
type StoredCredentials = {
  access_token: string;
  expires_at: string | null;
  provider_metadata: Json | null;
  refresh_token: string | null;
  scopes: string[] | null;
  token_type: string | null;
};
type EnrichedMedia = InstagramMedia & {
  insightError: string | null;
  insights: InstagramMediaInsights;
};
type AccountInsightValues = Partial<Record<InstagramAccountInsightPoint["metric"], number>>;

export type InstagramSyncResult = {
  accountId: string;
  metricsUpserted: number;
  postsUpserted: number;
  status: SyncStatus;
};

export async function connectInstagramAccount(ownerId: string, token: InstagramToken) {
  const grantedScopes = token.scopes.length > 0 ? token.scopes : instagramScopes;
  assertRequiredScopes(grantedScopes);

  const admin = createAdminClient();
  const profile = await fetchInstagramProfile(token.accessToken, token.userId);
  const now = new Date().toISOString();
  const storedToken = { ...token, scopes: grantedScopes };
  const { data: account, error: accountError } = await admin
    .from("social_accounts")
    .upsert(
      {
        owner_id: ownerId,
        platform: "instagram",
        external_account_id: profile.id,
        handle: profile.username,
        display_name: profile.displayName,
        profile_url: `https://www.instagram.com/${encodeURIComponent(profile.username)}/`,
        avatar_url: profile.profilePictureUrl,
        status: "connected",
        scopes: grantedScopes,
        connected_at: now,
        token_expires_at: token.expiresAt,
        metadata: profileMetadata(profile),
      },
      { onConflict: "owner_id,platform,external_account_id" },
    )
    .select("id")
    .single();

  if (accountError) {
    throw new Error(`Unable to save the Instagram account: ${accountError.message}`);
  }

  await storeInstagramToken(admin, account.id, storedToken);

  try {
    return await runInstagramSync(
      admin,
      account.id,
      profile.id,
      token.accessToken,
      "oauth",
      profile,
    );
  } catch (error) {
    console.error(
      "[instagram] Initial analytics sync failed after connection.",
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

export async function syncInstagramAccount(
  ownerId: string,
  accountId: string,
  trigger: SyncTrigger = "manual",
) {
  const admin = createAdminClient();
  const { data: account, error: accountError } = await admin
    .from("social_accounts")
    .select("id, external_account_id, owner_id, platform")
    .eq("id", accountId)
    .eq("owner_id", ownerId)
    .eq("platform", "instagram")
    .maybeSingle();

  if (accountError || !account) {
    throw new Error("The selected Instagram connection could not be found.");
  }

  const accessToken = await getValidInstagramAccessToken(
    admin,
    accountId,
    account.external_account_id,
  );

  return runInstagramSync(
    admin,
    accountId,
    account.external_account_id,
    accessToken,
    trigger,
  );
}

async function runInstagramSync(
  admin: AdminClient,
  accountId: string,
  externalUserId: string,
  accessToken: string,
  trigger: SyncTrigger,
  knownProfile?: InstagramProfile,
): Promise<InstagramSyncResult> {
  const snapshotDate = new Date().toISOString().slice(0, 10);
  const insightStartDate = addDays(snapshotDate, -(ACCOUNT_INSIGHT_DAYS - 1));
  const mediaStartDate = addDays(snapshotDate, -(MEDIA_HISTORY_DAYS - 1));
  const { data: syncRun, error: syncRunError } = await admin
    .from("analytics_sync_runs")
    .insert({
      account_id: accountId,
      status: "running",
      trigger,
      range_start: mediaStartDate,
      range_end: snapshotDate,
      metadata: { platform: "instagram", source: "instagram_graph_api" },
    })
    .select("id")
    .single();

  if (syncRunError) {
    throw new Error(`Unable to start the Instagram sync: ${syncRunError.message}`);
  }

  try {
    const [profile, media, accountInsights] = await Promise.all([
      knownProfile
        ? Promise.resolve(knownProfile)
        : fetchInstagramProfile(accessToken, externalUserId),
      fetchInstagramMedia(accessToken, externalUserId, mediaStartDate),
      fetchInstagramAccountInsights(
        accessToken,
        externalUserId,
        insightStartDate,
        snapshotDate,
      ),
    ]);
    const enrichedMedia = await enrichMediaWithInsights(accessToken, media);
    const capturedAt = new Date().toISOString();
    const postIdMap = await upsertInstagramPosts(admin, accountId, enrichedMedia);
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
      enrichedMedia,
      postIdMap,
      previousPosts,
      previousAccount?.snapshot_date ?? null,
      snapshotDate,
      capturedAt,
    );
    const accountMetrics = createAccountDailyMetrics(
      accountId,
      profile,
      enrichedMedia,
      accountInsights.points,
      accountInsights.failedMetrics,
      postMetrics,
      previousAccount,
      snapshotDate,
      capturedAt,
    );
    const accountSnapshot = createAccountSnapshot(
      accountId,
      profile,
      enrichedMedia,
      snapshotDate,
      capturedAt,
    );
    const postSnapshots = createPostSnapshots(
      enrichedMedia,
      postIdMap,
      snapshotDate,
      capturedAt,
    );

    await upsertAccountSnapshot(admin, accountSnapshot);
    await upsertPostSnapshots(admin, postSnapshots);
    await upsertPostMetrics(admin, postMetrics);
    await upsertAccountMetrics(admin, accountMetrics);

    const failedMediaInsights = enrichedMedia.filter((item) => item.insightError).length;
    const status: SyncStatus = accountInsights.failedMetrics.length > 0 || failedMediaInsights > 0
      ? "partial"
      : "succeeded";
    const { error: accountUpdateError } = await admin
      .from("social_accounts")
      .update({
        handle: profile.username,
        display_name: profile.displayName,
        profile_url: `https://www.instagram.com/${encodeURIComponent(profile.username)}/`,
        avatar_url: profile.profilePictureUrl,
        status: "connected",
        last_synced_at: capturedAt,
        metadata: {
          ...profileMetadata(profile),
          accountInsightMetricsUnavailable: accountInsights.failedMetrics,
          importedMediaCount: enrichedMedia.length,
          mediaInsightFailures: failedMediaInsights,
        },
      })
      .eq("id", accountId);

    if (accountUpdateError) {
      throw new Error(`Unable to finish the Instagram account update: ${accountUpdateError.message}`);
    }

    const recordsUpserted = postIdMap.size
      + postMetrics.length
      + accountMetrics.length
      + postSnapshots.length
      + 1;

    await admin
      .from("analytics_sync_runs")
      .update({
        status,
        finished_at: capturedAt,
        records_upserted: recordsUpserted,
        metadata: {
          accountInsightMetricsUnavailable: accountInsights.failedMetrics,
          followerHistory: "estimated_from_daily_new_followers",
          mediaImported: enrichedMedia.length,
          mediaInsightFailures: failedMediaInsights,
          platform: "instagram",
          source: "instagram_graph_api",
        },
      })
      .eq("id", syncRun.id);

    return {
      accountId,
      metricsUpserted: postMetrics.length + accountMetrics.length,
      postsUpserted: postIdMap.size,
      status,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Instagram sync error";

    await admin
      .from("analytics_sync_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_code: "INSTAGRAM_SYNC_FAILED",
        error_message: message.slice(0, 1_000),
      })
      .eq("id", syncRun.id);

    throw error;
  }
}

async function enrichMediaWithInsights(
  accessToken: string,
  media: InstagramMedia[],
) {
  const enriched: EnrichedMedia[] = [];

  for (let offset = 0; offset < media.length; offset += MEDIA_INSIGHT_CONCURRENCY) {
    const batch = media.slice(offset, offset + MEDIA_INSIGHT_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (item): Promise<EnrichedMedia> => {
        try {
          const insights = await fetchInstagramMediaInsights(accessToken, item.id);
          return {
            ...item,
            insights: {
              ...insights,
              comments: Math.max(insights.comments, item.commentsCount),
              likes: Math.max(insights.likes, item.likeCount),
              totalInteractions: Math.max(
                insights.totalInteractions,
                insights.likes + insights.comments + insights.shares + insights.saves,
              ),
            },
            insightError: null,
          };
        } catch (error) {
          return {
            ...item,
            insights: {
              comments: item.commentsCount,
              likes: item.likeCount,
              reach: 0,
              saves: 0,
              shares: 0,
              totalInteractions: item.likeCount + item.commentsCount,
              views: 0,
            },
            insightError: error instanceof Error ? error.message.slice(0, 500) : "Unknown error",
          };
        }
      }),
    );

    enriched.push(...results);
  }

  return enriched;
}

async function upsertInstagramPosts(
  admin: AdminClient,
  accountId: string,
  media: EnrichedMedia[],
) {
  const rows = media.map((item) => ({
    account_id: accountId,
    external_post_id: item.id,
    content_type: contentType(item),
    title: null,
    caption: item.caption,
    permalink: item.permalink,
    thumbnail_url: item.thumbnailUrl ?? (item.mediaType === "IMAGE" ? item.mediaUrl : null),
    published_at: item.publishedAt,
    metadata: {
      lifetimeComments: item.insights.comments,
      lifetimeLikes: item.insights.likes,
      lifetimeReach: item.insights.reach,
      lifetimeSaves: item.insights.saves,
      lifetimeShares: item.insights.shares,
      lifetimeViews: item.insights.views,
      mediaProductType: item.mediaProductType,
      mediaType: item.mediaType,
      platform: "instagram",
      detailedInsightsAvailable: item.insightError === null,
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
      throw new Error(`Unable to save Instagram media: ${error.message}`);
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
    throw new Error(`Unable to load the Instagram account baseline: ${error.message}`);
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
    const chunk = postIds.slice(offset, offset + UPSERT_CHUNK_SIZE);
    if (chunk.length === 0) continue;

    const { data, error } = await admin
      .from("post_metric_snapshots")
      .select("post_id, views, likes, comments, shares, saves, reach")
      .in("post_id", chunk)
      .eq("snapshot_date", snapshotDate);

    if (error) {
      throw new Error(`Unable to load Instagram post baselines: ${error.message}`);
    }

    data.forEach((snapshot) => result.set(snapshot.post_id, snapshot));
  }

  return result;
}

function createPostDailyMetrics(
  media: EnrichedMedia[],
  postIdMap: Map<string, string>,
  previousPosts: Map<string, PriorPostSnapshot>,
  baselineDate: string | null,
  snapshotDate: string,
  capturedAt: string,
): TablesInsert<"post_daily_metrics">[] {
  return media.flatMap((item) => {
    const postId = postIdMap.get(item.id);
    if (!postId) return [];

    const previous = previousPosts.get(postId);
    const publishedDate = item.publishedAt.slice(0, 10);
    const countFromZero = !previous && (
      baselineDate ? publishedDate > baselineDate : publishedDate === snapshotDate
    );
    const views = deriveDelta(item.insights.views, previous?.views, countFromZero);
    const likes = deriveDelta(item.insights.likes, previous?.likes, countFromZero);
    const comments = deriveDelta(item.insights.comments, previous?.comments, countFromZero);
    const shares = deriveDelta(item.insights.shares, previous?.shares, countFromZero);
    const saves = deriveDelta(item.insights.saves, previous?.saves, countFromZero);
    const reach = deriveDelta(item.insights.reach, previous?.reach, countFromZero);
    const engagements = likes + comments + shares + saves;

    return [{
      post_id: postId,
      metric_date: snapshotDate,
      views,
      engagements,
      likes,
      comments,
      shares,
      saves,
      reach,
      engagement_rate_percent: views > 0 ? roundOne((engagements / views) * 100) : null,
      source_updated_at: capturedAt,
      ingested_at: capturedAt,
      metadata: {
        aggregation: "snapshot_delta",
        baselineDate,
        countedFromPublication: countFromZero,
        detailedInsightsAvailable: item.insightError === null,
        platform: "instagram",
      },
    } satisfies TablesInsert<"post_daily_metrics">];
  });
}

function createAccountDailyMetrics(
  accountId: string,
  profile: InstagramProfile,
  media: EnrichedMedia[],
  points: InstagramAccountInsightPoint[],
  failedMetrics: InstagramAccountInsightPoint["metric"][],
  postMetrics: TablesInsert<"post_daily_metrics">[],
  previousAccount: PriorAccountSnapshot | null,
  snapshotDate: string,
  capturedAt: string,
) {
  const insightsByDate = new Map<string, AccountInsightValues>();
  const publicationCounts = new Map<string, number>();

  points.forEach((point) => {
    const values = insightsByDate.get(point.date) ?? {};
    values[point.metric] = point.value;
    insightsByDate.set(point.date, values);
  });

  media.forEach((item) => {
    const date = item.publishedAt.slice(0, 10);
    publicationCounts.set(date, (publicationCounts.get(date) ?? 0) + 1);
  });

  const followerDeltas = new Map<string, number>();
  insightsByDate.forEach((values, date) => {
    if (values.follower_count !== undefined) {
      followerDeltas.set(date, values.follower_count);
    }
  });
  const followerCounts = estimateHistoricalFollowerCounts(
    profile.followerCount,
    followerDeltas,
    snapshotDate,
  );
  const dates = new Set<string>([
    ...insightsByDate.keys(),
    ...publicationCounts.keys(),
    ...followerCounts.keys(),
    snapshotDate,
  ]);
  const todayPostTotals = summarizePostMetrics(postMetrics);

  return [...dates]
    .filter((date) => date <= snapshotDate)
    .sort()
    .map((date): TablesInsert<"account_daily_metrics"> => {
      const values = insightsByDate.get(date) ?? {};
      const followerCount = followerCounts.get(date);
      const followerDelta = values.follower_count
        ?? (date === snapshotDate && previousAccount
          ? profile.followerCount - previousAccount.follower_count
          : 0);
      const fallback = date === snapshotDate ? todayPostTotals : null;
      const views = values.views ?? fallback?.views ?? 0;
      const likes = values.likes ?? fallback?.likes ?? 0;
      const comments = values.comments ?? fallback?.comments ?? 0;
      const shares = values.shares ?? fallback?.shares ?? 0;
      const saves = values.saves ?? fallback?.saves ?? 0;
      const engagements = values.total_interactions
        ?? (likes + comments + shares + saves);

      return {
        account_id: accountId,
        metric_date: date,
        views,
        follower_count: followerCount ?? 0,
        follower_delta: followerDelta,
        engagements,
        likes,
        comments,
        shares,
        saves,
        reach: values.reach ?? fallback?.reach ?? 0,
        profile_views: values.profile_views ?? 0,
        posts_published: publicationCounts.get(date) ?? 0,
        engagement_rate_percent: views > 0 ? roundOne((engagements / views) * 100) : null,
        source_updated_at: capturedAt,
        ingested_at: capturedAt,
        metadata: {
          followerCountEstimated: followerCount !== undefined && date !== snapshotDate,
          followerCountUnavailable: followerCount === undefined,
          followerEstimateBasis: "daily_new_followers",
          metricsUnavailable: failedMetrics,
          platform: "instagram",
          source: "instagram_graph_api",
        },
      };
    });
}

function estimateHistoricalFollowerCounts(
  currentFollowerCount: number,
  followerDeltas: Map<string, number>,
  snapshotDate: string,
) {
  const counts = new Map<string, number>([[snapshotDate, currentFollowerCount]]);
  const dates = [...followerDeltas.keys()].filter((date) => date <= snapshotDate).sort();
  const earliestDate = dates[0];

  if (!earliestDate) return counts;

  let count = currentFollowerCount;
  for (let date = snapshotDate; date >= earliestDate; date = addDays(date, -1)) {
    counts.set(date, Math.max(0, count));
    count -= followerDeltas.get(date) ?? 0;
  }

  return counts;
}

function createAccountSnapshot(
  accountId: string,
  profile: InstagramProfile,
  media: EnrichedMedia[],
  snapshotDate: string,
  capturedAt: string,
): TablesInsert<"account_metric_snapshots"> {
  return {
    account_id: accountId,
    snapshot_date: snapshotDate,
    captured_at: capturedAt,
    follower_count: profile.followerCount,
    following_count: profile.followsCount,
    total_views: sumMedia(media, "views"),
    total_likes: sumMedia(media, "likes"),
    total_comments: sumMedia(media, "comments"),
    total_shares: sumMedia(media, "shares"),
    post_count: profile.mediaCount,
    metadata: {
      importedMediaCount: media.length,
      platform: "instagram",
      totalsCoverImportedMediaOnly: true,
    },
  };
}

function createPostSnapshots(
  media: EnrichedMedia[],
  postIdMap: Map<string, string>,
  snapshotDate: string,
  capturedAt: string,
): TablesInsert<"post_metric_snapshots">[] {
  return media.flatMap((item) => {
    const postId = postIdMap.get(item.id);
    if (!postId) return [];

    return [{
      post_id: postId,
      snapshot_date: snapshotDate,
      captured_at: capturedAt,
      views: item.insights.views,
      likes: item.insights.likes,
      comments: item.insights.comments,
      shares: item.insights.shares,
      saves: item.insights.saves,
      reach: item.insights.reach,
      metadata: {
        detailedInsightsAvailable: item.insightError === null,
        platform: "instagram",
      },
    } satisfies TablesInsert<"post_metric_snapshots">];
  });
}

async function getValidInstagramAccessToken(
  admin: AdminClient,
  accountId: string,
  externalUserId: string,
) {
  const { data, error } = await admin.rpc("get_social_account_tokens", {
    p_account_id: accountId,
  });

  if (error || !data?.[0]) {
    throw new Error("Stored Instagram credentials could not be loaded.");
  }

  const credentials = data[0] as StoredCredentials;
  const expiresAt = credentials.expires_at ? Date.parse(credentials.expires_at) : 0;

  if (expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS) {
    return credentials.access_token;
  }

  const scopes = credentials.scopes?.length ? credentials.scopes : instagramScopes;
  const token = await refreshInstagramToken(
    credentials.access_token,
    externalUserId,
    scopes,
  );
  assertRequiredScopes(token.scopes);
  await storeInstagramToken(admin, accountId, token);

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

async function storeInstagramToken(
  admin: AdminClient,
  accountId: string,
  token: InstagramToken,
) {
  const { error } = await admin.rpc("store_social_account_tokens", {
    p_account_id: accountId,
    p_access_token: token.accessToken,
    p_refresh_token: "",
    p_token_type: token.tokenType,
    p_scopes: token.scopes,
    p_expires_at: token.expiresAt,
    p_provider_metadata: {
      provider: "instagram",
      userId: token.userId,
    },
  });

  if (error) {
    throw new Error(`Unable to protect the Instagram credentials: ${error.message}`);
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
    throw new Error(`Unable to save the Instagram account snapshot: ${error.message}`);
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
      throw new Error(`Unable to save Instagram post snapshots: ${error.message}`);
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
      throw new Error(`Unable to save Instagram post metrics: ${error.message}`);
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
      throw new Error(`Unable to save Instagram account metrics: ${error.message}`);
    }
  }
}

function assertRequiredScopes(scopes: string[]) {
  const missing = instagramScopes.filter((scope) => !scopes.includes(scope));

  if (missing.length > 0) {
    throw new Error(`Instagram did not grant required permissions: ${missing.join(", ")}.`);
  }
}

function summarizePostMetrics(rows: TablesInsert<"post_daily_metrics">[]) {
  return {
    views: sumRows(rows, "views"),
    likes: sumRows(rows, "likes"),
    comments: sumRows(rows, "comments"),
    shares: sumRows(rows, "shares"),
    saves: sumRows(rows, "saves"),
    reach: sumRows(rows, "reach"),
  };
}

function sumRows(
  rows: TablesInsert<"post_daily_metrics">[],
  key: "comments" | "likes" | "reach" | "saves" | "shares" | "views",
) {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

function sumMedia(
  media: EnrichedMedia[],
  key: "comments" | "likes" | "shares" | "views",
) {
  return media.reduce((total, item) => total + item.insights[key], 0);
}

function deriveDelta(current: number, previous: number | undefined, countFromZero: boolean) {
  if (previous !== undefined) return Math.max(0, current - previous);
  return countFromZero ? current : 0;
}

function contentType(media: InstagramMedia) {
  if (media.mediaProductType === "REELS") return "reel";
  if (media.mediaType === "CAROUSEL_ALBUM") return "carousel";
  return media.mediaType.toLowerCase();
}

function profileMetadata(profile: InstagramProfile) {
  return {
    accountType: profile.accountType,
    followerCount: profile.followerCount,
    followsCount: profile.followsCount,
    mediaCount: profile.mediaCount,
  };
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function addDays(date: string, numberOfDays: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + numberOfDays);
  return value.toISOString().slice(0, 10);
}
