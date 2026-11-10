import "server-only";
import { mergeRange } from "./merge";
import { unavailable } from "./quality";

import { sumAvailable, type AllTimeDashboard, type AllTimeStats } from "@/lib/analytics/all-time";

import {
  performanceRangeKeys,
  type AnalyticsByRange,
  type AnalyticsData,
  type PerformanceRange,
  type PlatformAnalyticsByRange,
  type Post,
} from "@/lib/dashboard-data";
import { getWindsorYoutubeAllTime, getWindsorYoutubeAnalytics, getWindsorYoutubeContent } from "@/lib/integrations/windsor/youtube";
import { getWindsorTikTokAllTime, getWindsorTikTokAnalytics, getWindsorTikTokLifetime } from "@/lib/integrations/windsor/tiktok";

export function emptyRanges(): AnalyticsByRange {
  return Object.fromEntries(performanceRangeKeys.map((range) => [range, unavailable("No daily data is available.")])) as AnalyticsByRange;
}

async function loadChannel<T>(label: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    console.error(`[${label}] Windsor data unavailable:`, error instanceof Error ? error.message : error);
    return null;
  }
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
