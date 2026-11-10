import { hasMetrics, coversPeriod, unavailable } from "../../analytics/quality";
import "server-only";

import type { AllTimeStats } from "@/lib/analytics/all-time";

import {
  performanceRangeKeys,
  type AnalyticsByRange,
  type AnalyticsData,
  type PerformancePoint,
  type Post,
} from "@/lib/dashboard-data";

const DAYS = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 } as const;
const DAY_MS = 86_400_000;

type DailyRow = {
  date: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
};
type GrowthRow = {
  date: string;
  subscribers_gained_channel?: number;
  subscribers_lost_channel?: number;
};
type ChannelRow = { subscriber_count?: number; view_count?: number; video_count?: number };
type VideoRow = DailyRow & {
  video?: string;
  video_title?: string;
  published_at?: string;
};
type PublishedVideoRow = {
  videourl?: string;
  video_title?: string;
  published_at?: string;
  video_view_count?: number;
  video_like_count?: number;
  video_comment_count?: number;
};

function dateAt(day: number) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

async function queryWindsor<T>(fields: string[], start?: string, end?: string): Promise<T[]> {
  const key = process.env.WINDSOR_API_KEY;
  if (!key) throw new Error("WINDSOR_API_KEY is not configured");

  const url = new URL("https://connectors.windsor.ai/youtube");
  url.searchParams.set("api_key", key);
  url.searchParams.set("fields", fields.join(","));
  if (start) url.searchParams.set("date_from", start);
  if (end) url.searchParams.set("date_to", end);

  const response = await fetch(url, {
    next: { revalidate: 3600 },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`Windsor returned HTTP ${response.status}`);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("data" in body) || !Array.isArray(body.data)) {
    throw new Error("Windsor returned an unexpected response");
  }
  return body.data as T[];
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getWindsorYoutubeAllTime(): Promise<AllTimeStats> {
  const channels = await queryWindsor<ChannelRow>(["view_count", "subscriber_count", "video_count"]);
  if (channels.length === 0) throw new Error("Windsor returned no YouTube channel totals");

  const sum = (field: keyof ChannelRow) => {
    const values = channels.map((channel) => channel[field]);
    return values.every((value) => value !== undefined && value !== null && Number.isFinite(Number(value)) && Number(value) >= 0)
      ? values.reduce<number>((total, value) => total + number(value), 0)
      : null;
  };

  return { views: sum("view_count"), followers: sum("subscriber_count"), videos: sum("video_count"), likes: null };
}

export async function getWindsorYoutubeContent(): Promise<Post[]> {
  const today = dateAt(Math.floor(Date.now() / DAY_MS));
  const rows = await queryWindsor<PublishedVideoRow>(
    ["videourl", "video_title", "published_at", "video_view_count", "video_like_count", "video_comment_count"],
    "2018-01-01",
    today,
  );

  const posts = new Map<string, Post>();
  for (const row of rows) {
    if (!row.videourl || !row.published_at) continue;
    let url: URL;
    try {
      url = new URL(row.videourl);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || !["youtube.com", "www.youtube.com", "youtu.be"].includes(url.hostname)) continue;
    const views = number(row.video_view_count);
    const interactions = number(row.video_like_count) + number(row.video_comment_count);
    posts.set(url.toString(), {
      id: url.toString(),
      title: row.video_title || "Untitled video",
      platform: "youtube",
      url: url.toString(),
      pillar: "YouTube",
      publishedAt: row.published_at.slice(0, 10),
      views,
      engagementRate: views > 0 ? interactions / views * 100 : 0,
      accent: "coral",
    });
  }
  return [...posts.values()].sort((a, b) => b.views - a.views);
}

function change(current: number, previous: number) {
  return previous > 0 ? ((current - previous) / previous) * 100 : 0;
}

function addDays(date: string, days: number) {
  return dateAt(Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS) + days);
}

export async function getWindsorYoutubeAnalytics(): Promise<AnalyticsByRange> {
  // YouTube's reporting day is complete only after midnight; omit today.
  const today = Math.floor(Date.now() / DAY_MS);
  const endDay = today - 1;
  const endDate = dateAt(endDay);
  const startDate = dateAt(endDay - 729);
  const [daily, growth, channel, videos] = await Promise.all([
    queryWindsor<DailyRow>(["date", "views", "likes", "comments", "shares"], startDate, endDate),
    queryWindsor<GrowthRow>(["date", "subscribers_gained_channel", "subscribers_lost_channel"], startDate, endDate),
    queryWindsor<ChannelRow>(["subscriber_count"]),
    queryWindsor<VideoRow>(["date", "video", "video_title", "published_at", "views", "likes", "comments", "shares"], dateAt(endDay - 364), endDate),
  ]);

  const count = number(channel[0]?.subscriber_count);
  const dailyByDate = new Map(daily.map((row) => [row.date, row]));
  const growthByDate = new Map(growth.map((row) => [row.date, row]));
  const validDates = new Set(daily.filter((row) =>
    hasMetrics(row, ["views", "likes", "comments", "shares"]) &&
    hasMetrics(growthByDate.get(row.date), ["subscribers_gained_channel", "subscribers_lost_channel"])
  ).map((row) => row.date));
  const points: PerformancePoint[] = [];
  let followers = count;

  for (let day = endDay; day >= endDay - 729; day--) {
    const date = dateAt(day);
    const row = dailyByDate.get(date);
    const views = number(row?.views);
    const interactions = Math.max(0, number(row?.likes) + number(row?.comments) + number(row?.shares));
    points.push({
      date,
      views,
      followers: Math.max(0, followers),
      engagement: views > 0 ? (interactions / views) * 100 : 0,
    });
    const subscriberChange = growthByDate.get(date);
    followers -= number(subscriberChange?.subscribers_gained_channel) - number(subscriberChange?.subscribers_lost_channel);
  }
  points.reverse();

  return Object.fromEntries(performanceRangeKeys.map((range) => {
    const days = DAYS[range];
    if (!hasMetrics(channel[0], ["subscriber_count"]) || !coversPeriod(validDates, endDate, days * 2)) {
      return [range, unavailable("Daily fields are missing in this period or its comparison window.")];
    }
    const current = points.slice(-days);
    const previous = points.slice(-days * 2, -days);
    const total = (items: PerformancePoint[]) => items.reduce((sum, point) => sum + point.views, 0);
    const weightedEngagement = (items: PerformancePoint[]) => {
      const views = total(items);
      return views > 0 ? items.reduce((sum, point) => sum + point.engagement * point.views, 0) / views : 0;
    };
    const periodStart = current[0]?.date ?? endDate;
    const previousStart = addDays(periodStart, -days);
    const posts = buildPosts(videos, periodStart, endDate);
    const previousPosts = buildPosts(videos, previousStart, addDays(periodStart, -1));
    const analytics: AnalyticsData = {
      previous: { views: total(previous), followers: previous.at(-1)?.followers ?? count, engagementRate: weightedEngagement(previous) },
      views: total(current),
      engagementRate: weightedEngagement(current),
      followers: current.at(-1)?.followers ?? count,
      postsPublished: posts.filter((post) => post.publishedAt >= periodStart).length,
      changes: {
        views: change(total(current), total(previous)),
        engagementRate: change(weightedEngagement(current), weightedEngagement(previous)),
        followers: change(current.at(-1)?.followers ?? count, previous.at(-1)?.followers ?? 0),
        postsPublished: posts.filter((post) => post.publishedAt >= periodStart).length - previousPosts.filter((post) => post.publishedAt >= previousStart).length,
      },
      performanceData: current,
      topPosts: posts.slice(0, 10),
    };
    return [range, analytics];
  })) as AnalyticsByRange;
}

function buildPosts(rows: VideoRow[], start: string, end: string): Post[] {
  const byVideo = new Map<string, Post>();
  for (const row of rows) {
    if (!row.video || !row.date || row.date < start || row.date > end) continue;
    const existing = byVideo.get(row.video);
    const views = number(row.views);
    const interactions = Math.max(0, number(row.likes) + number(row.comments) + number(row.shares));
    if (existing) {
      const existingInteractions = existing.engagementRate * existing.views / 100;
      existing.views += views;
      existing.engagementRate = existing.views > 0 ? (existingInteractions + interactions) / existing.views * 100 : 0;
    } else {
      byVideo.set(row.video, {
        id: row.video,
        title: row.video_title || "Untitled video",
        platform: "youtube",
        pillar: "YouTube",
        publishedAt: row.published_at?.slice(0, 10) || row.date,
        views,
        engagementRate: views > 0 ? interactions / views * 100 : 0,
        accent: "coral",
      });
    }
  }
  return [...byVideo.values()].sort((a, b) => b.views - a.views);
}
