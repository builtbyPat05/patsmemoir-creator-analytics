import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createSampleAnalyticsByRange,
  createSamplePlatformAnalyticsByRange,
  isPlatformKey,
  overviewAnalytics,
  performanceRangeKeys,
  platformAnalytics,
  platforms,
  type AnalyticsByRange,
  type AnalyticsData,
  type PerformancePoint,
  type PerformanceRange,
  type PlatformAnalyticsByRange,
  type PlatformKey,
  type Post,
} from "@/lib/dashboard-data";
import { createClient } from "@/lib/supabase/server";
import type { Database, Tables } from "@/lib/supabase/database.types";

const PAGE_SIZE = 1_000;
const RANGE_DAYS: Record<PerformanceRange, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
};

type AccountMetricRow = Tables<"account_daily_metrics">;
type AccountSummary = Pick<Tables<"social_accounts">, "id" | "platform">;

type PostMetricRow = {
  post_id: string;
  metric_date: string;
  views: number;
  engagements: number;
  content_posts: {
    id: string;
    account_id: string;
    title: string | null;
    caption: string | null;
    pillar: string | null;
    published_at: string;
    social_accounts: {
      platform: string;
    } | null;
  } | null;
};

export type DashboardDataset = {
  source: "demo" | "supabase";
  overview: AnalyticsByRange;
  platforms: PlatformAnalyticsByRange;
};

export async function getDashboardDataset(): Promise<DashboardDataset> {
  try {
    const supabase = await createClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();

    if (authError || !authData.user) {
      return createDemoDataset();
    }

    const accounts = await fetchAccounts(supabase);

    if (accounts.length === 0) {
      return createDemoDataset();
    }

    const accountIds = accounts.map((account) => account.id);
    const latestDate = await fetchLatestMetricDate(supabase, accountIds);
    const endDate = new Date().toISOString().slice(0, 10);

    if (!latestDate) {
      return createSupabaseDataset([], [], accounts, endDate);
    }

    const earliestMetricDate = addDays(endDate, -(RANGE_DAYS["1y"] * 2 - 1));
    const earliestPostDate = addDays(endDate, -(RANGE_DAYS["1y"] - 1));
    const [accountMetrics, postMetrics] = await Promise.all([
      fetchAccountMetrics(supabase, accountIds, earliestMetricDate, endDate),
      fetchPostMetrics(supabase, earliestPostDate, endDate),
    ]);

    return createSupabaseDataset(accountMetrics, postMetrics, accounts, endDate);
  } catch (error) {
    console.error(
      "[analytics] Supabase data unavailable; using demo data.",
      error instanceof Error ? error.message : error,
    );
    return createDemoDataset();
  }
}

function createDemoDataset(): DashboardDataset {
  return {
    source: "demo",
    overview: createSampleAnalyticsByRange(overviewAnalytics),
    platforms: createSamplePlatformAnalyticsByRange(platformAnalytics),
  };
}

function createSupabaseDataset(
  accountMetrics: AccountMetricRow[],
  postMetrics: PostMetricRow[],
  accounts: AccountSummary[],
  endDate: string,
): DashboardDataset {
  const accountIds = accounts.map((account) => account.id);
  const idsByPlatform = createAccountIdsByPlatform(accounts);

  return {
    source: "supabase",
    overview: buildAnalyticsByRange(accountMetrics, postMetrics, accountIds, endDate),
    platforms: {
      youtube: buildAnalyticsByRange(
        accountMetrics,
        postMetrics,
        idsByPlatform.youtube,
        endDate,
      ),
      instagram: buildAnalyticsByRange(
        accountMetrics,
        postMetrics,
        idsByPlatform.instagram,
        endDate,
      ),
      facebook: buildAnalyticsByRange(
        accountMetrics,
        postMetrics,
        idsByPlatform.facebook,
        endDate,
      ),
      tiktok: buildAnalyticsByRange(
        accountMetrics,
        postMetrics,
        idsByPlatform.tiktok,
        endDate,
      ),
    },
  };
}

async function fetchAccounts(
  supabase: SupabaseClient<Database>,
): Promise<AccountSummary[]> {
  const { data, error } = await supabase
    .from("social_accounts")
    .select("id, platform")
    .neq("status", "disconnected")
    .order("platform");

  if (error) {
    throw new Error(`Unable to load connected accounts: ${error.message}`);
  }

  return data;
}

async function fetchLatestMetricDate(
  supabase: SupabaseClient<Database>,
  accountIds: string[],
) {
  const { data, error } = await supabase
    .from("account_daily_metrics")
    .select("metric_date")
    .in("account_id", accountIds)
    .order("metric_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to determine the latest analytics date: ${error.message}`);
  }

  return data?.metric_date ?? null;
}

async function fetchAccountMetrics(
  supabase: SupabaseClient<Database>,
  accountIds: string[],
  startDate: string,
  endDate: string,
): Promise<AccountMetricRow[]> {
  const rows: AccountMetricRow[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("account_daily_metrics")
      .select("*")
      .in("account_id", accountIds)
      .gte("metric_date", startDate)
      .lte("metric_date", endDate)
      .order("metric_date")
      .order("account_id")
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Unable to load account analytics: ${error.message}`);
    }

    rows.push(...data);

    if (data.length < PAGE_SIZE) {
      return rows;
    }
  }
}

async function fetchPostMetrics(
  supabase: SupabaseClient<Database>,
  startDate: string,
  endDate: string,
): Promise<PostMetricRow[]> {
  const rows: PostMetricRow[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("post_daily_metrics")
      .select(`
        post_id,
        metric_date,
        views,
        engagements,
        content_posts!inner (
          id,
          account_id,
          title,
          caption,
          pillar,
          published_at,
          social_accounts!inner (
            platform
          )
        )
      `)
      .gte("metric_date", startDate)
      .lte("metric_date", endDate)
      .order("metric_date")
      .order("post_id")
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Unable to load post analytics: ${error.message}`);
    }

    const page = data as unknown as PostMetricRow[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) {
      return rows;
    }
  }
}

function createAccountIdsByPlatform(accounts: AccountSummary[]) {
  const result: Record<PlatformKey, string[]> = {
    youtube: [],
    instagram: [],
    facebook: [],
    tiktok: [],
  };

  accounts.forEach((account) => {
    result[account.platform].push(account.id);
  });

  return result;
}

function buildAnalyticsByRange(
  metrics: AccountMetricRow[],
  postMetrics: PostMetricRow[],
  accountIds: string[],
  endDate: string,
): AnalyticsByRange {
  return Object.fromEntries(
    performanceRangeKeys.map((range) => [
      range,
      buildAnalyticsForRange(metrics, postMetrics, accountIds, endDate, RANGE_DAYS[range]),
    ]),
  ) as AnalyticsByRange;
}

function buildAnalyticsForRange(
  metrics: AccountMetricRow[],
  postMetrics: PostMetricRow[],
  accountIds: string[],
  endDate: string,
  days: number,
): AnalyticsData {
  if (accountIds.length === 0) {
    return emptyAnalytics();
  }

  const accountIdSet = new Set(accountIds);
  const startDate = addDays(endDate, -(days - 1));
  const previousEndDate = addDays(startDate, -1);
  const previousStartDate = addDays(previousEndDate, -(days - 1));
  const performanceData = buildPerformanceData(
    metrics,
    accountIdSet,
    startDate,
    endDate,
  );
  const current = summarizeMetrics(metrics, accountIdSet, startDate, endDate);
  const previous = summarizeMetrics(
    metrics,
    accountIdSet,
    previousStartDate,
    previousEndDate,
  );

  return {
    views: current.views,
    engagementRate: current.engagementRate,
    followers: performanceData.at(-1)?.followers ?? 0,
    postsPublished: current.postsPublished,
    changes: {
      views: percentageChange(current.views, previous.views),
      engagementRate: percentageChange(
        current.engagementRate,
        previous.engagementRate,
      ),
      followers: percentageChange(current.followers, previous.followers),
      postsPublished: current.postsPublished - previous.postsPublished,
    },
    performanceData,
    topPosts: buildTopPosts(postMetrics, accountIdSet, startDate, endDate),
  };
}

function buildPerformanceData(
  metrics: AccountMetricRow[],
  accountIds: Set<string>,
  startDate: string,
  endDate: string,
): PerformancePoint[] {
  const rows = metrics
    .filter((row) => accountIds.has(row.account_id) && row.metric_date <= endDate)
    .sort(compareMetricRows);
  const rowsByDate = new Map<string, AccountMetricRow[]>();
  const followersByAccount = new Map<string, number>();

  rows.forEach((row) => {
    if (row.metric_date < startDate) {
      if (hasKnownFollowerCount(row)) {
        followersByAccount.set(row.account_id, row.follower_count);
      }
      return;
    }

    const dayRows = rowsByDate.get(row.metric_date) ?? [];
    dayRows.push(row);
    rowsByDate.set(row.metric_date, dayRows);
  });

  return eachDate(startDate, endDate).map((date) => {
    const dayRows = rowsByDate.get(date) ?? [];
    let views = 0;
    let engagements = 0;

    dayRows.forEach((row) => {
      views += row.views;
      engagements += row.engagements;
      if (hasKnownFollowerCount(row)) {
        followersByAccount.set(row.account_id, row.follower_count);
      }
    });

    const followers = [...accountIds].reduce(
      (total, accountId) => total + (followersByAccount.get(accountId) ?? 0),
      0,
    );

    return {
      date,
      views,
      followers,
      engagement: calculateEngagementRate(engagements, views),
    };
  });
}

function summarizeMetrics(
  metrics: AccountMetricRow[],
  accountIds: Set<string>,
  startDate: string,
  endDate: string,
) {
  const periodRows = metrics.filter(
    (row) =>
      accountIds.has(row.account_id) &&
      row.metric_date >= startDate &&
      row.metric_date <= endDate,
  );
  const views = periodRows.reduce((total, row) => total + row.views, 0);
  const engagements = periodRows.reduce(
    (total, row) => total + row.engagements,
    0,
  );
  const postsPublished = periodRows.reduce(
    (total, row) => total + row.posts_published,
    0,
  );
  const latestFollowers = new Map<string, { date: string; count: number }>();

  metrics.forEach((row) => {
    if (
      !accountIds.has(row.account_id) ||
      row.metric_date > endDate ||
      !hasKnownFollowerCount(row)
    ) {
      return;
    }

    const existing = latestFollowers.get(row.account_id);

    if (!existing || row.metric_date > existing.date) {
      latestFollowers.set(row.account_id, {
        date: row.metric_date,
        count: row.follower_count,
      });
    }
  });

  return {
    views,
    followers: [...latestFollowers.values()].reduce(
      (total, follower) => total + follower.count,
      0,
    ),
    engagementRate: calculateEngagementRate(engagements, views),
    postsPublished,
  };
}

function buildTopPosts(
  metrics: PostMetricRow[],
  accountIds: Set<string>,
  startDate: string,
  endDate: string,
): Post[] {
  const totals = new Map<
    string,
    {
      post: NonNullable<PostMetricRow["content_posts"]>;
      platform: PlatformKey;
      views: number;
      engagements: number;
    }
  >();

  metrics.forEach((row) => {
    const post = row.content_posts;
    const platform = post?.social_accounts?.platform;

    if (
      row.metric_date < startDate ||
      row.metric_date > endDate ||
      !post ||
      !accountIds.has(post.account_id) ||
      !platform ||
      !isPlatformKey(platform)
    ) {
      return;
    }

    const existing = totals.get(row.post_id) ?? {
      post,
      platform,
      views: 0,
      engagements: 0,
    };

    existing.views += row.views;
    existing.engagements += row.engagements;
    totals.set(row.post_id, existing);
  });

  return [...totals.entries()]
    .map(([id, total]) => ({
      id,
      title: getPostTitle(total.post, total.platform),
      platform: total.platform,
      pillar: total.post.pillar?.trim() || "Uncategorized",
      publishedAt: total.post.published_at,
      views: total.views,
      engagementRate: calculateEngagementRate(total.engagements, total.views),
      accent: platforms[total.platform].tone,
    }))
    .sort((left, right) => right.views - left.views)
    .slice(0, 8);
}

function getPostTitle(
  post: NonNullable<PostMetricRow["content_posts"]>,
  platform: PlatformKey,
) {
  const title = post.title?.trim();

  if (title) {
    return title;
  }

  const caption = post.caption?.trim();

  if (caption) {
    return caption.length > 80 ? `${caption.slice(0, 77)}...` : caption;
  }

  return `${platforms[platform].label} post`;
}

function emptyAnalytics(): AnalyticsData {
  return {
    views: 0,
    engagementRate: 0,
    followers: 0,
    postsPublished: 0,
    changes: {
      views: 0,
      engagementRate: 0,
      followers: 0,
      postsPublished: 0,
    },
    performanceData: [],
    topPosts: [],
  };
}

function calculateEngagementRate(engagements: number, views: number) {
  return views > 0 ? roundToOneDecimal((engagements / views) * 100) : 0;
}

function hasKnownFollowerCount(row: AccountMetricRow) {
  const metadata = row.metadata;

  return !(
    typeof metadata === "object" &&
    metadata !== null &&
    !Array.isArray(metadata) &&
    metadata.followerCountUnavailable === true
  );
}

function percentageChange(current: number, previous: number) {
  if (previous === 0) {
    return current === 0 ? 0 : 100;
  }

  return roundToOneDecimal(((current - previous) / previous) * 100);
}

function roundToOneDecimal(value: number) {
  return Math.round(value * 10) / 10;
}

function addDays(date: string, numberOfDays: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + numberOfDays);
  return value.toISOString().slice(0, 10);
}

function eachDate(startDate: string, endDate: string) {
  const dates: string[] = [];

  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    dates.push(date);
  }

  return dates;
}

function compareMetricRows(left: AccountMetricRow, right: AccountMetricRow) {
  const dateComparison = left.metric_date.localeCompare(right.metric_date);

  return dateComparison || left.account_id.localeCompare(right.account_id);
}
