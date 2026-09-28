import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchYoutubeChannel,
  fetchYoutubeChannelDays,
  fetchYoutubeUploadIds,
  fetchYoutubeVideoDays,
  fetchYoutubeVideos,
  refreshYoutubeToken,
  type YoutubeChannel,
  type YoutubeToken,
  type YoutubeVideo,
} from "@/lib/integrations/youtube/api";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  Database,
  Json,
  TablesInsert,
} from "@/lib/supabase/database.types";

const UPSERT_CHUNK_SIZE = 500;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1_000;

type AdminClient = SupabaseClient<Database>;
type SyncTrigger = Database["public"]["Enums"]["analytics_sync_trigger"];

type StoredCredentials = {
  access_token: string;
  expires_at: string | null;
  provider_metadata: Json | null;
  refresh_token: string | null;
  scopes: string[] | null;
  token_type: string | null;
};

export type YoutubeSyncResult = {
  accountId: string;
  metricsUpserted: number;
  postsUpserted: number;
  status: "succeeded" | "partial";
};

export async function connectYoutubeAccount(ownerId: string, token: YoutubeToken) {
  const admin = createAdminClient();
  const channel = await fetchYoutubeChannel(token.accessToken);
  const now = new Date().toISOString();
  const { data: account, error: accountError } = await admin
    .from("social_accounts")
    .upsert(
      {
        owner_id: ownerId,
        platform: "youtube",
        external_account_id: channel.id,
        handle: channel.customUrl,
        display_name: channel.title,
        profile_url: `https://www.youtube.com/channel/${channel.id}`,
        avatar_url: channel.avatarUrl,
        status: "connected",
        scopes: token.scopes,
        connected_at: now,
        token_expires_at: token.expiresAt,
        metadata: channelMetadata(channel),
      },
      { onConflict: "owner_id,platform,external_account_id" },
    )
    .select("id")
    .single();

  if (accountError) {
    throw new Error(`Unable to save the YouTube account: ${accountError.message}`);
  }

  await storeYoutubeToken(admin, account.id, token, {
    provider: "google",
    youtubeChannelId: channel.id,
  });

  try {
    return await runYoutubeSync(
      admin,
      account.id,
      token.accessToken,
      channel,
      "oauth",
    );
  } catch (error) {
    console.error(
      "[youtube] Initial analytics sync failed after connection.",
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

export async function syncYoutubeAccount(
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
    .eq("platform", "youtube")
    .maybeSingle();

  if (accountError || !account) {
    throw new Error("The selected YouTube connection could not be found.");
  }

  const accessToken = await getValidYoutubeAccessToken(admin, accountId);
  const channel = await fetchYoutubeChannel(accessToken);

  return runYoutubeSync(admin, accountId, accessToken, channel, trigger);
}

async function runYoutubeSync(
  admin: AdminClient,
  accountId: string,
  accessToken: string,
  channel: YoutubeChannel,
  trigger: SyncTrigger,
): Promise<YoutubeSyncResult> {
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = addDays(endDate, -364);
  const { data: syncRun, error: syncRunError } = await admin
    .from("analytics_sync_runs")
    .insert({
      account_id: accountId,
      status: "running",
      trigger,
      range_start: startDate,
      range_end: endDate,
    })
    .select("id")
    .single();

  if (syncRunError) {
    throw new Error(`Unable to start the YouTube sync: ${syncRunError.message}`);
  }

  try {
    const channelDays = await fetchYoutubeChannelDays(accessToken, startDate, endDate);
    const videoDaysResult = await settleYoutubeVideoDays(accessToken, startDate, endDate);
    const uploadIds = channel.uploadsPlaylistId
      ? await fetchYoutubeUploadIds(
        accessToken,
        channel.uploadsPlaylistId,
        startDate,
      )
      : [];
    const videoIds = [...new Set([
      ...uploadIds,
      ...videoDaysResult.rows.map((row) => row.videoId),
    ])];
    const videos = await fetchYoutubeVideos(accessToken, videoIds);
    const postIdMap = await upsertYoutubePosts(admin, accountId, videos);
    const postsByDate = countPublishedVideosByDate(videos, startDate, endDate);
    const accountMetrics = createAccountMetrics(
      accountId,
      channelDays,
      channel.subscriberCount,
      postsByDate,
      endDate,
    );
    const postMetrics = videoDaysResult.rows.flatMap((row) => {
      const postId = postIdMap.get(row.videoId);

      if (!postId) return [];

      return [{
        post_id: postId,
        metric_date: row.date,
        views: row.views,
        engagements: row.likes + row.comments + row.shares,
        likes: row.likes,
        comments: row.comments,
        shares: row.shares,
        source_updated_at: new Date().toISOString(),
        metadata: { platform: "youtube" },
      } satisfies TablesInsert<"post_daily_metrics">];
    });

    await upsertAccountMetrics(admin, accountMetrics);
    await upsertPostMetrics(admin, postMetrics);

    const now = new Date().toISOString();
    const status = videoDaysResult.error ? "partial" : "succeeded";
    const recordsUpserted = accountMetrics.length + postMetrics.length + postIdMap.size;

    const { error: accountUpdateError } = await admin
      .from("social_accounts")
      .update({
        display_name: channel.title,
        handle: channel.customUrl,
        avatar_url: channel.avatarUrl,
        status: "connected",
        last_synced_at: now,
        metadata: channelMetadata(channel),
      })
      .eq("id", accountId);

    if (accountUpdateError) {
      throw new Error(`Unable to finish the YouTube account update: ${accountUpdateError.message}`);
    }

    await admin
      .from("analytics_sync_runs")
      .update({
        status,
        finished_at: now,
        records_upserted: recordsUpserted,
        error_code: videoDaysResult.error ? "VIDEO_REPORT_UNAVAILABLE" : null,
        error_message: videoDaysResult.error,
      })
      .eq("id", syncRun.id);

    return {
      accountId,
      metricsUpserted: accountMetrics.length + postMetrics.length,
      postsUpserted: postIdMap.size,
      status,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown YouTube sync error";

    await admin
      .from("analytics_sync_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_code: "YOUTUBE_SYNC_FAILED",
        error_message: message.slice(0, 1_000),
      })
      .eq("id", syncRun.id);

    throw error;
  }
}

async function settleYoutubeVideoDays(
  accessToken: string,
  startDate: string,
  endDate: string,
) {
  try {
    return {
      rows: await fetchYoutubeVideoDays(accessToken, startDate, endDate),
      error: null,
    };
  } catch (error) {
    return {
      rows: [],
      error: error instanceof Error ? error.message.slice(0, 1_000) : "Video report unavailable",
    };
  }
}

async function upsertYoutubePosts(
  admin: AdminClient,
  accountId: string,
  videos: YoutubeVideo[],
) {
  const rows = videos.map((video) => ({
    account_id: accountId,
    external_post_id: video.id,
    content_type: video.durationSeconds !== null && video.durationSeconds <= 180
      ? "short"
      : "video",
    title: video.title,
    permalink: `https://www.youtube.com/watch?v=${video.id}`,
    thumbnail_url: video.thumbnailUrl,
    published_at: video.publishedAt,
    duration_seconds: video.durationSeconds,
    metadata: {
      lifetimeCommentCount: video.statistics.commentCount,
      lifetimeLikeCount: video.statistics.likeCount,
      lifetimeViewCount: video.statistics.viewCount,
      platform: "youtube",
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
      throw new Error(`Unable to save YouTube videos: ${error.message}`);
    }

    data.forEach((post) => result.set(post.external_post_id, post.id));
  }

  return result;
}

function createAccountMetrics(
  accountId: string,
  channelDays: Awaited<ReturnType<typeof fetchYoutubeChannelDays>>,
  currentSubscriberCount: number,
  postsByDate: Map<string, number>,
  fallbackDate: string,
): TablesInsert<"account_daily_metrics">[] {
  if (channelDays.length === 0) {
    return [{
      account_id: accountId,
      metric_date: fallbackDate,
      follower_count: currentSubscriberCount,
      posts_published: postsByDate.get(fallbackDate) ?? 0,
      metadata: { platform: "youtube" },
    }];
  }

  const sortedDays = [...channelDays].sort((left, right) => left.date.localeCompare(right.date));
  const followerByDate = new Map<string, number>();
  let followerCount = currentSubscriberCount;

  for (let index = sortedDays.length - 1; index >= 0; index -= 1) {
    const day = sortedDays[index];
    if (!day) continue;
    followerByDate.set(day.date, Math.max(0, Math.round(followerCount)));
    followerCount -= day.subscribersGained - day.subscribersLost;
  }

  const sourceUpdatedAt = new Date().toISOString();

  return sortedDays.map((day) => ({
    account_id: accountId,
    metric_date: day.date,
    views: day.views,
    follower_count: followerByDate.get(day.date) ?? currentSubscriberCount,
    follower_delta: day.subscribersGained - day.subscribersLost,
    engagements: day.likes + day.comments + day.shares,
    likes: day.likes,
    comments: day.comments,
    shares: day.shares,
    watch_time_seconds: Math.round(day.estimatedMinutesWatched * 60),
    posts_published: postsByDate.get(day.date) ?? 0,
    source_updated_at: sourceUpdatedAt,
    metadata: {
      platform: "youtube",
      subscribersGained: day.subscribersGained,
      subscribersLost: day.subscribersLost,
    },
  }));
}

function countPublishedVideosByDate(
  videos: YoutubeVideo[],
  startDate: string,
  endDate: string,
) {
  const counts = new Map<string, number>();

  videos.forEach((video) => {
    const date = video.publishedAt.slice(0, 10);

    if (date >= startDate && date <= endDate) {
      counts.set(date, (counts.get(date) ?? 0) + 1);
    }
  });

  return counts;
}

async function getValidYoutubeAccessToken(admin: AdminClient, accountId: string) {
  const { data, error } = await admin.rpc("get_social_account_tokens", {
    p_account_id: accountId,
  });

  if (error || !data?.[0]) {
    throw new Error("Stored YouTube credentials could not be loaded.");
  }

  const credentials = data[0] as StoredCredentials;
  const expiresAt = credentials.expires_at
    ? Date.parse(credentials.expires_at)
    : 0;

  if (expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS) {
    return credentials.access_token;
  }

  if (!credentials.refresh_token) {
    throw new Error("The YouTube connection needs to be authorized again.");
  }

  const refreshed = await refreshYoutubeToken(credentials.refresh_token);
  const token = {
    ...refreshed,
    scopes: refreshed.scopes.length > 0
      ? refreshed.scopes
      : (credentials.scopes ?? []),
  };

  await storeYoutubeToken(
    admin,
    accountId,
    token,
    credentials.provider_metadata ?? { provider: "google" },
  );

  await admin
    .from("social_accounts")
    .update({ token_expires_at: token.expiresAt, scopes: token.scopes })
    .eq("id", accountId);

  return token.accessToken;
}

async function storeYoutubeToken(
  admin: AdminClient,
  accountId: string,
  token: YoutubeToken,
  providerMetadata: Json,
) {
  const { error } = await admin.rpc("store_social_account_tokens", {
    p_account_id: accountId,
    p_access_token: token.accessToken,
    p_refresh_token: token.refreshToken ?? "",
    p_token_type: token.tokenType,
    p_scopes: token.scopes,
    p_expires_at: token.expiresAt,
    p_provider_metadata: providerMetadata,
  });

  if (error) {
    throw new Error(`Unable to protect the YouTube credentials: ${error.message}`);
  }
}

async function upsertAccountMetrics(
  admin: AdminClient,
  rows: TablesInsert<"account_daily_metrics">[],
) {
  for (let offset = 0; offset < rows.length; offset += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + UPSERT_CHUNK_SIZE);
    const { error } = await admin
      .from("account_daily_metrics")
      .upsert(chunk, { onConflict: "account_id,metric_date" });

    if (error) {
      throw new Error(`Unable to save account_daily_metrics: ${error.message}`);
    }
  }
}

async function upsertPostMetrics(
  admin: AdminClient,
  rows: TablesInsert<"post_daily_metrics">[],
) {
  for (let offset = 0; offset < rows.length; offset += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + UPSERT_CHUNK_SIZE);
    const { error } = await admin
      .from("post_daily_metrics")
      .upsert(chunk, { onConflict: "post_id,metric_date" });

    if (error) {
      throw new Error(`Unable to save post_daily_metrics: ${error.message}`);
    }
  }
}

function channelMetadata(channel: YoutubeChannel): Json {
  return {
    channelViewCount: channel.viewCount,
    uploadsPlaylistId: channel.uploadsPlaylistId,
    videoCount: channel.videoCount,
  };
}

function addDays(date: string, numberOfDays: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + numberOfDays);
  return value.toISOString().slice(0, 10);
}
