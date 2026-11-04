import "server-only";

import { sumAvailable, type AllTimeDashboard, type AllTimeStats } from "@/lib/analytics/all-time";

import {
  performanceRangeKeys,
  type AnalyticsByRange,
  type AnalyticsData,
  type PerformancePoint,
  type PerformanceRange,
  type PlatformAnalyticsByRange,
  type Post,
} from "@/lib/dashboard-data";
import { getWindsorYoutubeAllTime, getWindsorYoutubeAnalytics, getWindsorYoutubeContent } from "@/lib/integrations/windsor/youtube";
import { getWindsorTikTokAllTime, getWindsorTikTokAnalytics, getWindsorTikTokLifetime } from "@/lib/integrations/windsor/tiktok";

function empty(): AnalyticsData {
  return {
    views: 0, followers: 0, engagementRate: 0, postsPublished: 0,
    changes: { views: 0, followers: 0, engagementRate: 0, postsPublished: 0 },
    performanceData: [], topPosts: [],
  };
}

export function emptyRanges(): AnalyticsByRange {
  return Object.fromEntries(performanceRangeKeys.map((range) => [range, empty()])) as AnalyticsByRange;
}

async function loadChannel<T>(label: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    console.error(`[${label}] Windsor data unavailable:`, error instanceof Error ? error.message : error);
    return null;
  }
}

function percentChange(current: number, previous: number) {
  return previous > 0 ? (current - previous) / previous * 100 : 0;
}

function mergeRange(channels: AnalyticsData[]): AnalyticsData {
  const dates = new Map<string, { views: number; followers: number; interactions: number }>();
  for (const channel of channels) {
    for (const point of channel.performanceData) {
      const day = dates.get(point.date) ?? { views: 0, followers: 0, interactions: 0 };
      day.views += point.views;
      day.followers += point.followers;
      day.interactions += point.views * point.engagement / 100;
      dates.set(point.date, day);
    }
  }
  const performanceData: PerformancePoint[] = [...dates.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, day]) => ({
      date, views: day.views, followers: day.followers,
      engagement: day.views > 0 ? day.interactions / day.views * 100 : 0,
    }));
  const views = channels.reduce((sum, channel) => sum + channel.views, 0);
  const interactions = channels.reduce((sum, channel) => sum + channel.views * channel.engagementRate / 100, 0);
  const previousViews = channels.reduce((sum, channel) =>
    sum + (channel.changes.views > -100 ? channel.views / (1 + channel.changes.views / 100) : 0), 0);
  const previousInteractions = channels.reduce((sum, channel) => {
    const previousChannelViews = channel.changes.views > -100 ? channel.views / (1 + channel.changes.views / 100) : 0;
    const previousRate = channel.changes.engagementRate > -100
      ? channel.engagementRate / (1 + channel.changes.engagementRate / 100) : 0;
    return sum + previousChannelViews * previousRate / 100;
  }, 0);
  const followers = channels.reduce((sum, channel) => sum + channel.followers, 0);
  const previousFollowers = channels.reduce((sum, channel) =>
    sum + (channel.changes.followers > -100 ? channel.followers / (1 + channel.changes.followers / 100) : 0), 0);
  const postsPublished = channels.reduce((sum, channel) => sum + channel.postsPublished, 0);
  const engagementRate = views > 0 ? interactions / views * 100 : 0;
  const previousEngagementRate = previousViews > 0 ? previousInteractions / previousViews * 100 : 0;

  return {
    views, engagementRate, followers, postsPublished,
    changes: {
      views: percentChange(views, previousViews),
      engagementRate: percentChange(engagementRate, previousEngagementRate),
      followers: percentChange(followers, previousFollowers),
      postsPublished: channels.reduce((sum, channel) => sum + channel.changes.postsPublished, 0),
    },
    performanceData, topPosts: [],
  };
}

export async function getLiveDashboard() {
  const [youtube, tiktok, youtubeAllTime, tiktokAllTime, youtubeContent, tiktokLifetime] = process.env.WINDSOR_API_KEY
    ? await Promise.all([
      loadChannel("youtube", getWindsorYoutubeAnalytics),
      loadChannel("tiktok", getWindsorTikTokAnalytics),
      loadChannel("youtube all-time", getWindsorYoutubeAllTime),
      loadChannel("tiktok all-time", getWindsorTikTokAllTime),
      loadChannel("youtube content", getWindsorYoutubeContent),
      loadChannel("tiktok content", getWindsorTikTokLifetime),
    ])
    : [null, null, null, null, null, null];
  const instagram = emptyRanges();
  const platforms: PlatformAnalyticsByRange = {
    youtube: youtube ?? emptyRanges(), instagram, tiktok: tiktok ?? emptyRanges(),
  };
  const overview = Object.fromEntries(performanceRangeKeys.map((range: PerformanceRange) => [
    range, mergeRange([youtube?.[range], tiktok?.[range]].filter((item): item is AnalyticsData => Boolean(item?.performanceData.length))),
  ])) as AnalyticsByRange;

  const allTimeSources = [youtubeAllTime, tiktokAllTime].filter((item): item is AllTimeStats => item !== null);
  const overviewAllTime: AllTimeStats | null = allTimeSources.length > 0 ? {
    views: sumAvailable(allTimeSources.map((item) => item.views)),
    followers: sumAvailable(allTimeSources.map((item) => item.followers)),
    videos: sumAvailable(allTimeSources.map((item) => item.videos)),
    likes: null,
  } : null;
  const allTime: AllTimeDashboard = {
    youtube: youtubeAllTime, tiktok: tiktokAllTime, instagram: null, overview: overviewAllTime,
  };

  const contentPosts: Record<"youtube" | "instagram" | "tiktok", Post[]> = {
    youtube: youtubeContent ?? [],
    instagram: [],
    tiktok: tiktokLifetime?.topVideos ?? [],
  };

  return { overview, platforms, allTime, contentPosts, tiktokLifetime, connected: { youtube: Boolean(youtube), tiktok: Boolean(tiktok) } };
}
