import "server-only";

import type { AllTimeStats } from "@/lib/analytics/all-time";

import {
  performanceRangeKeys,
  type AnalyticsByRange,
  type AnalyticsData,
  type PerformancePoint,
  type Post,
} from "@/lib/dashboard-data";

const DAY_MS = 86_400_000;
const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 } as const;

type DailyRow = {
  date: string;
  video_views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  total_followers_count?: number;
};

type VideoRow = {
  video_id?: string;
  video_share_url?: string;
  video_caption?: string;
  video_create_datetime?: string;
  video_views_count?: number;
  video_likes?: number;
  video_comments?: number;
  video_shares?: number;
};

type AccountRow = {
  total_followers_count?: number;
  total_likes?: number;
  videos_count?: number;
};

export async function getWindsorTikTokAllTime(): Promise<AllTimeStats> {
  const accounts = await queryWindsor<AccountRow>([
    "total_followers_count", "total_likes", "videos_count",
  ]);
  if (accounts.length === 0) throw new Error("Windsor returned no TikTok account totals");

  const sum = (field: keyof AccountRow) => {
    const values = accounts.map((account) => account[field]);
    return values.every((value) => value !== undefined && value !== null && Number.isFinite(Number(value)) && Number(value) >= 0)
      ? values.reduce<number>((total, value) => total + number(value), 0)
      : null;
  };

  return {
    views: null, followers: sum("total_followers_count"),
    videos: sum("videos_count"), likes: sum("total_likes"),
  };
}

export type TikTokLifetimeSummary = {
  followers: number;
  likes: number;
  publicVideos: number;
  trackedVideos: number;
  trackedVideoViews: number;
  topVideos: Post[];
};

function trustedTikTokUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["tiktok.com", "www.tiktok.com", "m.tiktok.com"].includes(url.hostname)
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function dateAt(day: number) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function change(current: number, previous: number) {
  return previous > 0 ? (current - previous) / previous * 100 : 0;
}

async function queryWindsor<T>(
  fields: string[],
  options: { start?: string; end?: string; preset?: string; timeoutMs?: number } = {},
): Promise<T[]> {
  const key = process.env.WINDSOR_API_KEY;
  if (!key) throw new Error("WINDSOR_API_KEY is not configured");

  const url = new URL("https://connectors.windsor.ai/tiktok_organic");
  url.searchParams.set("api_key", key);
  url.searchParams.set("fields", fields.join(","));
  if (options.start) url.searchParams.set("date_from", options.start);
  if (options.end) url.searchParams.set("date_to", options.end);
  if (options.preset) url.searchParams.set("date_preset", options.preset);

  const response = await fetch(url, {
    next: { revalidate: 3600 },
    signal: AbortSignal.timeout(options.timeoutMs ?? 25_000),
  });
  if (!response.ok) throw new Error(`Windsor returned HTTP ${response.status}`);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("data" in body) || !Array.isArray(body.data)) {
    throw new Error("Windsor returned an unexpected TikTok response");
  }
  return body.data as T[];
}

export async function getWindsorTikTokAnalytics(): Promise<AnalyticsByRange> {
  const endDay = Math.floor(Date.now() / DAY_MS) - 1;
  const endDate = dateAt(endDay);
  const startDate = dateAt(endDay - 59);
  const [daily, videos] = await Promise.all([
    queryWindsor<DailyRow>(
      ["date", "video_views", "likes", "comments", "shares", "total_followers_count"],
      { preset: "last_60d" },
    ),
    queryWindsor<VideoRow>(
      ["video_id", "video_caption", "video_create_datetime", "video_views_count", "video_likes", "video_comments", "video_shares"],
      { start: startDate, end: endDate },
    ),
  ]);

  if (daily.length === 0 || daily.every((row) => number(row.video_views) === 0 && number(row.total_followers_count) === 0)) {
    throw new Error("Windsor has no usable TikTok daily data for this account");
  }

  const byDate = new Map<string, DailyRow[]>();
  for (const row of daily) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
    const rows = byDate.get(row.date) ?? [];
    rows.push(row);
    byDate.set(row.date, rows);
  }

  let followers = 0;
  const points: PerformancePoint[] = [];
  for (let day = endDay - 59; day <= endDay; day++) {
    const date = dateAt(day);
    const rows = byDate.get(date) ?? [];
    const views = rows.reduce((sum, row) => sum + number(row.video_views), 0);
    const interactions = rows.reduce(
      (sum, row) => sum + number(row.likes) + number(row.comments) + number(row.shares),
      0,
    );
    for (const row of rows) {
      if (number(row.total_followers_count) > 0) {
        followers = number(row.total_followers_count);
      }
    }
    points.push({
      date,
      views,
      followers,
      engagement: views > 0 ? Math.max(0, interactions) / views * 100 : 0,
    });
  }

  const posts = new Map<string, Post>();
  for (const row of videos) {
    if (!row.video_id || !row.video_create_datetime || posts.has(row.video_id)) continue;
    const views = number(row.video_views_count);
    const interactions = number(row.video_likes) + number(row.video_comments) + number(row.video_shares);
    posts.set(row.video_id, {
      id: row.video_id,
      title: row.video_caption?.trim() || "Untitled TikTok video",
      platform: "tiktok",
      pillar: "TikTok",
      publishedAt: row.video_create_datetime.slice(0, 10),
      views,
      engagementRate: views > 0 ? Math.max(0, interactions) / views * 100 : 0,
      accent: "teal",
    });
  }
  const allPosts = [...posts.values()];

  return Object.fromEntries(performanceRangeKeys.map((range) => {
    if (range === "90d" || range === "1y") {
      const unavailable: AnalyticsData = {
        views: 0,
        engagementRate: 0,
        followers: 0,
        postsPublished: 0,
        changes: { views: 0, engagementRate: 0, followers: 0, postsPublished: 0 },
        performanceData: [],
        topPosts: [],
      };
      return [range, unavailable];
    }
    const days = RANGE_DAYS[range];
    const current = points.slice(-days);
    const previous = points.slice(-days * 2, -days);
    const totalViews = (items: PerformancePoint[]) => items.reduce((sum, point) => sum + point.views, 0);
    const engagementRate = (items: PerformancePoint[]) => {
      const views = totalViews(items);
      return views > 0 ? items.reduce((sum, point) => sum + point.engagement * point.views, 0) / views : 0;
    };
    const start = current[0]?.date ?? endDate;
    const previousStart = previous[0]?.date ?? start;
    const previousEnd = previous.at(-1)?.date ?? start;
    const currentPosts = allPosts.filter((post) => post.publishedAt >= start && post.publishedAt <= endDate);
    const previousPosts = allPosts.filter((post) => post.publishedAt >= previousStart && post.publishedAt <= previousEnd);
    const analytics: AnalyticsData = {
      views: totalViews(current),
      engagementRate: engagementRate(current),
      followers: current.at(-1)?.followers ?? 0,
      postsPublished: currentPosts.length,
      changes: {
        views: change(totalViews(current), totalViews(previous)),
        engagementRate: change(engagementRate(current), engagementRate(previous)),
        followers: change(current.at(-1)?.followers ?? 0, previous.at(-1)?.followers ?? 0),
        postsPublished: currentPosts.length - previousPosts.length,
      },
      performanceData: current,
      topPosts: currentPosts.sort((a, b) => b.views - a.views).slice(0, 10),
    };
    return [range, analytics];
  })) as AnalyticsByRange;
}

export async function getWindsorTikTokLifetime(): Promise<TikTokLifetimeSummary> {
  const [accountRows, videoRows] = await Promise.all([
    queryWindsor<AccountRow>(["total_followers_count", "total_likes", "videos_count"]),
    queryWindsor<VideoRow>(
      ["video_id", "video_share_url", "video_caption", "video_create_datetime", "video_views_count", "video_likes", "video_comments", "video_shares"],
      { start: "2018-01-01", end: dateAt(Math.floor(Date.now() / DAY_MS)), timeoutMs: 60_000 },
    ),
  ]);

  const account = accountRows[0];
  if (!account || account.videos_count == null || account.total_followers_count == null || account.total_likes == null) {
    throw new Error("Windsor did not provide TikTok account totals");
  }
  if (videoRows.length === 0) throw new Error("Windsor did not provide TikTok video records");

  const videos = new Map<string, Post>();
  for (const row of videoRows) {
    if (!row.video_id || !row.video_create_datetime || row.video_views_count == null || videos.has(row.video_id)) continue;
    const views = number(row.video_views_count);
    const interactions = number(row.video_likes) + number(row.video_comments) + number(row.video_shares);
    videos.set(row.video_id, {
      id: row.video_id,
      title: row.video_caption?.trim() || "Untitled TikTok video",
      platform: "tiktok",
      url: trustedTikTokUrl(row.video_share_url),
      pillar: "TikTok",
      publishedAt: row.video_create_datetime.slice(0, 10),
      views,
      engagementRate: views > 0 ? Math.max(0, interactions) / views * 100 : 0,
      accent: "teal",
    });
  }

  const ranked = [...videos.values()].sort((a, b) => b.views - a.views);
  return {
    followers: number(account.total_followers_count),
    likes: number(account.total_likes),
    publicVideos: number(account.videos_count),
    trackedVideos: ranked.length,
    trackedVideoViews: ranked.reduce((sum, video) => sum + video.views, 0),
    topVideos: ranked,
  };
}
