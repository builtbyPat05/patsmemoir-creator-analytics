import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchFacebookPage,
  fetchFacebookPageInsights,
  fetchFacebookPostInsights,
  fetchFacebookPosts,
  type FacebookPage,
  type FacebookPageInsightPoint,
  type FacebookPost,
  type FacebookPostInsights,
  type FacebookUserToken,
} from "@/lib/integrations/facebook/api";
import { facebookScopes } from "@/lib/integrations/facebook/config";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  Database,
  Json,
  Tables,
  TablesInsert,
} from "@/lib/supabase/database.types";

const UPSERT_CHUNK_SIZE = 200;
const TOKEN_EXPIRY_MARGIN_MS = 7 * 24 * 60 * 60 * 1_000;
const HISTORY_DAYS = 365;
const POST_INSIGHT_CONCURRENCY = 5;
const MAX_DETAILED_POSTS = 100;

type AdminClient = SupabaseClient<Database>;
type SyncTrigger = Database["public"]["Enums"]["analytics_sync_trigger"];
type SyncStatus = "succeeded" | "partial";
type PriorAccountSnapshot = Pick<
  Tables<"account_metric_snapshots">,
  "follower_count" | "snapshot_date"
>;
type PriorPostSnapshot = Pick<
  Tables<"post_metric_snapshots">,
  "comments" | "likes" | "post_id" | "reach" | "shares" | "views"
>;
type StoredCredentials = {
  access_token: string;
  expires_at: string | null;
  provider_metadata: Json | null;
  refresh_token: string | null;
  scopes: string[] | null;
  token_type: string | null;
};
type EnrichedPost = FacebookPost & {
  insightError: string | null;
  insights: FacebookPostInsights;
};
type PageInsightValues = Partial<Record<FacebookPageInsightPoint["metric"], number>>;

export type FacebookSyncResult = {
  accountId: string;
  metricsUpserted: number;
  postsUpserted: number;
  status: SyncStatus;
};

export type FacebookConnectionResult = {
  accountIds: string[];
  status: SyncStatus;
};

export async function connectFacebookPages(
  ownerId: string,
  userToken: FacebookUserToken,
  pages: FacebookPage[],
): Promise<FacebookConnectionResult> {
  assertRequiredScopes(userToken.scopes);

  if (pages.length === 0) {
    throw new Error("Facebook did not return a Page that this account can analyze.");
  }

  const admin = createAdminClient();
  const accountIds: string[] = [];
  let status: SyncStatus = "succeeded";

  for (const page of pages) {
    const now = new Date().toISOString();
    const { data: account, error: accountError } = await admin
      .from("social_accounts")
      .upsert(
        {
          owner_id: ownerId,
          platform: "facebook",
          external_account_id: page.id,
          handle: page.username,
          display_name: page.name,
          profile_url: page.link,
          avatar_url: page.pictureUrl,
          status: "connected",
          scopes: userToken.scopes,
          connected_at: now,
          token_expires_at: userToken.expiresAt,
          metadata: pageMetadata(page),
        },
        { onConflict: "owner_id,platform,external_account_id" },
      )
      .select("id")
      .single();

    if (accountError) {
      throw new Error(`Unable to save Facebook Page ${page.name}: ${accountError.message}`);
    }

    accountIds.push(account.id);
    await storeFacebookTokens(admin, account.id, page, userToken);

    try {
      const syncResult = await runFacebookSync(
        admin,
        account.id,
        page.id,
        page.accessToken,
        "oauth",
        page,
      );
      if (syncResult.status === "partial") status = "partial";
    } catch (error) {
      status = "partial";
      console.error(
        `[facebook] Initial sync failed for Page ${page.id}.`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return { accountIds, status };
}

export async function syncFacebookAccount(
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
    .eq("platform", "facebook")
    .maybeSingle();

  if (accountError || !account) {
    throw new Error("The selected Facebook Page connection could not be found.");
  }

  const accessToken = await getValidFacebookPageToken(admin, accountId);
  return runFacebookSync(
    admin,
    accountId,
    account.external_account_id,
    accessToken,
    trigger,
  );
}

export async function syncAllFacebookAccounts(
  ownerId: string,
  trigger: SyncTrigger = "manual",
) {
  const admin = createAdminClient();
  const { data: accounts, error } = await admin
    .from("social_accounts")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("platform", "facebook")
    .neq("status", "disconnected");

  if (error) {
    throw new Error(`Unable to load connected Facebook Pages: ${error.message}`);
  }

  if (accounts.length === 0) {
    throw new Error("No connected Facebook Page was found.");
  }

  const results: FacebookSyncResult[] = [];
  let failedAccounts = 0;

  for (const account of accounts) {
    try {
      results.push(await syncFacebookAccount(ownerId, account.id, trigger));
    } catch (syncError) {
      failedAccounts += 1;
      console.error(
        `[facebook] Sync failed for account ${account.id}.`,
        syncError instanceof Error ? syncError.message : syncError,
      );
    }
  }

  if (results.length === 0) {
    throw new Error("None of the connected Facebook Pages could be refreshed.");
  }

  return {
    failedAccounts,
    results,
    status: failedAccounts > 0 || results.some((result) => result.status === "partial")
      ? "partial" as const
      : "succeeded" as const,
  };
}

async function runFacebookSync(
  admin: AdminClient,
  accountId: string,
  pageId: string,
  pageAccessToken: string,
  trigger: SyncTrigger,
  knownPage?: FacebookPage,
): Promise<FacebookSyncResult> {
  const snapshotDate = new Date().toISOString().slice(0, 10);
  const startDate = addDays(snapshotDate, -(HISTORY_DAYS - 1));
  const { data: syncRun, error: syncRunError } = await admin
    .from("analytics_sync_runs")
    .insert({
      account_id: accountId,
      status: "running",
      trigger,
      range_start: startDate,
      range_end: snapshotDate,
      metadata: { platform: "facebook", source: "facebook_graph_api" },
    })
    .select("id")
    .single();

  if (syncRunError) {
    throw new Error(`Unable to start the Facebook sync: ${syncRunError.message}`);
  }

  try {
    const [page, posts, pageInsights] = await Promise.all([
      knownPage
        ? Promise.resolve(knownPage)
        : fetchFacebookPage(pageAccessToken, pageId),
      fetchFacebookPosts(pageAccessToken, pageId, startDate),
      fetchFacebookPageInsights(pageAccessToken, pageId, startDate, snapshotDate),
    ]);
    const enrichedPosts = await enrichPostsWithInsights(pageAccessToken, posts);
    const capturedAt = new Date().toISOString();
    const postIdMap = await upsertFacebookPosts(admin, accountId, enrichedPosts);
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
      enrichedPosts,
      postIdMap,
      previousPosts,
      previousAccount?.snapshot_date ?? null,
      snapshotDate,
      capturedAt,
    );
    const accountMetrics = createAccountDailyMetrics(
      accountId,
      page,
      enrichedPosts,
      pageInsights.points,
      pageInsights.failedMetrics,
      postMetrics,
      previousAccount,
      snapshotDate,
      capturedAt,
    );
    const accountSnapshot = createAccountSnapshot(
      accountId,
      page,
      enrichedPosts,
      snapshotDate,
      capturedAt,
    );
    const postSnapshots = createPostSnapshots(
      enrichedPosts,
      postIdMap,
      snapshotDate,
      capturedAt,
    );

    await upsertAccountSnapshot(admin, accountSnapshot);
    await upsertPostSnapshots(admin, postSnapshots);
    await upsertPostMetrics(admin, postMetrics);
    await upsertAccountMetrics(admin, accountMetrics);

    const postInsightFailures = enrichedPosts.filter((post) => post.insightError).length;
    const status: SyncStatus = pageInsights.failedMetrics.length > 0 || postInsightFailures > 0
      ? "partial"
      : "succeeded";
    const { error: accountUpdateError } = await admin
      .from("social_accounts")
      .update({
        handle: page.username,
        display_name: page.name,
        profile_url: page.link,
        avatar_url: page.pictureUrl,
        status: "connected",
        last_synced_at: capturedAt,
        metadata: {
          ...pageMetadata(page),
          importedPostCount: enrichedPosts.length,
          pageInsightMetricsUnavailable: pageInsights.failedMetrics,
          postInsightFailures,
        },
      })
      .eq("id", accountId);

    if (accountUpdateError) {
      throw new Error(`Unable to finish the Facebook Page update: ${accountUpdateError.message}`);
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
          importedPosts: enrichedPosts.length,
          pageInsightMetricsUnavailable: pageInsights.failedMetrics,
          platform: "facebook",
          postInsightFailures,
          source: "facebook_graph_api",
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
    const message = error instanceof Error ? error.message : "Unknown Facebook sync error";

    await admin
      .from("analytics_sync_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_code: "FACEBOOK_SYNC_FAILED",
        error_message: message.slice(0, 1_000),
      })
      .eq("id", syncRun.id);

    throw error;
  }
}

async function enrichPostsWithInsights(
  accessToken: string,
  posts: FacebookPost[],
) {
  const enriched: EnrichedPost[] = [];

  for (let offset = 0; offset < posts.length; offset += POST_INSIGHT_CONCURRENCY) {
    const batch = posts.slice(offset, offset + POST_INSIGHT_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (post, batchIndex): Promise<EnrichedPost> => {
        const index = offset + batchIndex;

        if (index >= MAX_DETAILED_POSTS) {
          return fallbackPost(post, "Detailed insight limit reached for this sync.");
        }

        try {
          return {
            ...post,
            insights: await fetchFacebookPostInsights(accessToken, post.id),
            insightError: null,
          };
        } catch (error) {
          return fallbackPost(
            post,
            error instanceof Error ? error.message.slice(0, 500) : "Unknown error",
          );
        }
      }),
    );

    enriched.push(...results);
  }

  return enriched;
}

function fallbackPost(post: FacebookPost, message: string): EnrichedPost {
  return {
    ...post,
    insights: {
      engagedUsers: post.reactions + post.comments + post.shares,
      uniqueViewers: 0,
      views: 0,
    },
    insightError: message,
  };
}

async function upsertFacebookPosts(
  admin: AdminClient,
  accountId: string,
  posts: EnrichedPost[],
) {
  const rows = posts.map((post) => ({
    account_id: accountId,
    external_post_id: post.id,
    content_type: post.contentType.toLowerCase(),
    title: null,
    caption: post.message,
    permalink: post.permalink,
    thumbnail_url: post.thumbnailUrl,
    published_at: post.publishedAt,
    metadata: {
      detailedInsightsAvailable: post.insightError === null,
      lifetimeComments: post.comments,
      lifetimeReactions: post.reactions,
      lifetimeShares: post.shares,
      lifetimeViews: post.insights.views,
      platform: "facebook",
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

    if (error) throw new Error(`Unable to save Facebook posts: ${error.message}`);
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

  if (error) throw new Error(`Unable to load the Facebook Page baseline: ${error.message}`);
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
      .select("post_id, views, likes, comments, shares, reach")
      .in("post_id", chunk)
      .eq("snapshot_date", snapshotDate);

    if (error) throw new Error(`Unable to load Facebook post baselines: ${error.message}`);
    data.forEach((snapshot) => result.set(snapshot.post_id, snapshot));
  }

  return result;
}

function createPostDailyMetrics(
  posts: EnrichedPost[],
  postIdMap: Map<string, string>,
  previousPosts: Map<string, PriorPostSnapshot>,
  baselineDate: string | null,
  snapshotDate: string,
  capturedAt: string,
): TablesInsert<"post_daily_metrics">[] {
  return posts.flatMap((post) => {
    const postId = postIdMap.get(post.id);
    if (!postId) return [];

    const previous = previousPosts.get(postId);
    const publishedDate = post.publishedAt.slice(0, 10);
    const countFromZero = !previous && (
      baselineDate ? publishedDate > baselineDate : publishedDate === snapshotDate
    );
    const views = deriveDelta(post.insights.views, previous?.views, countFromZero);
    const likes = deriveDelta(post.reactions, previous?.likes, countFromZero);
    const comments = deriveDelta(post.comments, previous?.comments, countFromZero);
    const shares = deriveDelta(post.shares, previous?.shares, countFromZero);
    const reach = deriveDelta(post.insights.uniqueViewers, previous?.reach, countFromZero);
    const engagements = likes + comments + shares;

    return [{
      post_id: postId,
      metric_date: snapshotDate,
      views,
      engagements,
      likes,
      comments,
      shares,
      reach,
      engagement_rate_percent: views > 0 ? roundOne((engagements / views) * 100) : null,
      source_updated_at: capturedAt,
      ingested_at: capturedAt,
      metadata: {
        aggregation: "snapshot_delta",
        baselineDate,
        countedFromPublication: countFromZero,
        detailedInsightsAvailable: post.insightError === null,
        platform: "facebook",
      },
    } satisfies TablesInsert<"post_daily_metrics">];
  });
}

function createAccountDailyMetrics(
  accountId: string,
  page: FacebookPage,
  posts: EnrichedPost[],
  points: FacebookPageInsightPoint[],
  failedMetrics: FacebookPageInsightPoint["metric"][],
  postMetrics: TablesInsert<"post_daily_metrics">[],
  previousAccount: PriorAccountSnapshot | null,
  snapshotDate: string,
  capturedAt: string,
) {
  const insightsByDate = new Map<string, PageInsightValues>();
  const publicationCounts = new Map<string, number>();

  points.forEach((point) => {
    const values = insightsByDate.get(point.date) ?? {};
    values[point.metric] = point.value;
    insightsByDate.set(point.date, values);
  });
  posts.forEach((post) => {
    const date = post.publishedAt.slice(0, 10);
    publicationCounts.set(date, (publicationCounts.get(date) ?? 0) + 1);
  });

  const followerCounts = new Map<string, number>();
  insightsByDate.forEach((values, date) => {
    if (values.page_follows !== undefined) {
      followerCounts.set(date, values.page_follows);
    }
  });
  followerCounts.set(snapshotDate, page.followerCount);
  const followerDeltas = calculateFollowerDeltas(
    followerCounts,
    previousAccount,
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
      const fallback = date === snapshotDate ? todayPostTotals : null;
      const views = values.page_media_view ?? fallback?.views ?? 0;
      const engagements = values.page_post_engagements ?? fallback?.engagements ?? 0;

      return {
        account_id: accountId,
        metric_date: date,
        views,
        follower_count: followerCount ?? 0,
        follower_delta: followerDeltas.get(date)
          ?? (date === snapshotDate && previousAccount
            ? page.followerCount - previousAccount.follower_count
            : 0),
        engagements,
        likes: fallback?.likes ?? 0,
        comments: fallback?.comments ?? 0,
        shares: fallback?.shares ?? 0,
        reach: values.page_total_media_view_unique ?? fallback?.reach ?? 0,
        profile_views: values.page_views_total ?? 0,
        posts_published: publicationCounts.get(date) ?? 0,
        engagement_rate_percent: views > 0 ? roundOne((engagements / views) * 100) : null,
        source_updated_at: capturedAt,
        ingested_at: capturedAt,
        metadata: {
          followerCountUnavailable: followerCount === undefined,
          metricsUnavailable: failedMetrics,
          platform: "facebook",
          source: "facebook_graph_api",
        },
      };
    });
}

function calculateFollowerDeltas(
  followerCounts: Map<string, number>,
  previousAccount: PriorAccountSnapshot | null,
  snapshotDate: string,
) {
  const deltas = new Map<string, number>();
  const values = [...followerCounts.entries()]
    .filter(([date]) => date <= snapshotDate)
    .sort(([left], [right]) => left.localeCompare(right));

  values.forEach(([date, count], index) => {
    const previous = values[index - 1];
    if (previous) {
      deltas.set(date, count - previous[1]);
    } else if (date === snapshotDate && previousAccount) {
      deltas.set(date, count - previousAccount.follower_count);
    }
  });

  if (!deltas.has(snapshotDate) && previousAccount) {
    const current = followerCounts.get(snapshotDate);
    if (current !== undefined) {
      deltas.set(snapshotDate, current - previousAccount.follower_count);
    }
  }

  return deltas;
}

function createAccountSnapshot(
  accountId: string,
  page: FacebookPage,
  posts: EnrichedPost[],
  snapshotDate: string,
  capturedAt: string,
): TablesInsert<"account_metric_snapshots"> {
  return {
    account_id: accountId,
    snapshot_date: snapshotDate,
    captured_at: capturedAt,
    follower_count: page.followerCount,
    following_count: 0,
    total_views: posts.reduce(
      (total, post) => total + post.insights.views,
      0,
    ),
    total_likes: posts.reduce((total, post) => total + post.reactions, 0),
    total_comments: posts.reduce((total, post) => total + post.comments, 0),
    total_shares: posts.reduce((total, post) => total + post.shares, 0),
    post_count: posts.length,
    metadata: {
      importedPostCount: posts.length,
      platform: "facebook",
      totalsCoverImportedPostsOnly: true,
    },
  };
}

function createPostSnapshots(
  posts: EnrichedPost[],
  postIdMap: Map<string, string>,
  snapshotDate: string,
  capturedAt: string,
): TablesInsert<"post_metric_snapshots">[] {
  return posts.flatMap((post) => {
    const postId = postIdMap.get(post.id);
    if (!postId) return [];

    return [{
      post_id: postId,
      snapshot_date: snapshotDate,
      captured_at: capturedAt,
      views: post.insights.views,
      likes: post.reactions,
      comments: post.comments,
      shares: post.shares,
      reach: post.insights.uniqueViewers,
      metadata: {
        detailedInsightsAvailable: post.insightError === null,
        platform: "facebook",
      },
    } satisfies TablesInsert<"post_metric_snapshots">];
  });
}

async function getValidFacebookPageToken(admin: AdminClient, accountId: string) {
  const { data, error } = await admin.rpc("get_social_account_tokens", {
    p_account_id: accountId,
  });

  if (error || !data?.[0]) {
    throw new Error("Stored Facebook credentials could not be loaded.");
  }

  const credentials = data[0] as StoredCredentials;
  const expiresAt = credentials.expires_at ? Date.parse(credentials.expires_at) : 0;

  if (expiresAt <= Date.now() + TOKEN_EXPIRY_MARGIN_MS) {
    await admin
      .from("social_accounts")
      .update({ status: "expired" })
      .eq("id", accountId);
    throw new Error("The Facebook connection needs to be authorized again.");
  }

  return credentials.access_token;
}

async function storeFacebookTokens(
  admin: AdminClient,
  accountId: string,
  page: FacebookPage,
  userToken: FacebookUserToken,
) {
  const { error } = await admin.rpc("store_social_account_tokens", {
    p_account_id: accountId,
    p_access_token: page.accessToken,
    p_refresh_token: userToken.accessToken,
    p_token_type: userToken.tokenType,
    p_scopes: userToken.scopes,
    p_expires_at: userToken.expiresAt,
    p_provider_metadata: {
      pageId: page.id,
      provider: "facebook",
      tokenKind: "page_access_token",
    },
  });

  if (error) {
    throw new Error(`Unable to protect Facebook Page credentials: ${error.message}`);
  }
}

async function upsertAccountSnapshot(
  admin: AdminClient,
  row: TablesInsert<"account_metric_snapshots">,
) {
  const { error } = await admin
    .from("account_metric_snapshots")
    .upsert(row, { onConflict: "account_id,snapshot_date" });
  if (error) throw new Error(`Unable to save the Facebook account snapshot: ${error.message}`);
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
    if (error) throw new Error(`Unable to save Facebook post snapshots: ${error.message}`);
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
    if (error) throw new Error(`Unable to save Facebook post metrics: ${error.message}`);
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
    if (error) throw new Error(`Unable to save Facebook account metrics: ${error.message}`);
  }
}

function assertRequiredScopes(scopes: string[]) {
  const missing = facebookScopes.filter((scope) => !scopes.includes(scope));
  if (missing.length > 0) {
    throw new Error(`Facebook did not grant required permissions: ${missing.join(", ")}.`);
  }
}

function summarizePostMetrics(rows: TablesInsert<"post_daily_metrics">[]) {
  return {
    comments: sumRows(rows, "comments"),
    engagements: rows.reduce((total, row) => total + Number(row.engagements ?? 0), 0),
    likes: sumRows(rows, "likes"),
    reach: sumRows(rows, "reach"),
    shares: sumRows(rows, "shares"),
    views: sumRows(rows, "views"),
  };
}

function sumRows(
  rows: TablesInsert<"post_daily_metrics">[],
  key: "comments" | "likes" | "reach" | "shares" | "views",
) {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

function deriveDelta(current: number, previous: number | undefined, countFromZero: boolean) {
  if (previous !== undefined) return Math.max(0, current - previous);
  return countFromZero ? current : 0;
}

function pageMetadata(page: FacebookPage) {
  return {
    fanCount: page.fanCount,
    followerCount: page.followerCount,
    tasks: page.tasks,
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
