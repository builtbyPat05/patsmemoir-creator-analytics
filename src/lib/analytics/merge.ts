import type { AnalyticsData, PerformancePoint } from "../dashboard-data";
import { unavailable } from "./quality";

function percentChange(current: number, previous: number) {
  return previous > 0 ? (current - previous) / previous * 100 : 0;
}

export function mergeRange(channels: AnalyticsData[]): AnalyticsData {
  channels = channels.filter((channel) => !channel.unavailableReason && channel.performanceData.length > 0);
  if (channels.length === 0) return unavailable("Daily data is unavailable for this reporting period.");
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
    sum + (channel.previous?.views ?? (channel.changes.views > -100 ? channel.views / (1 + channel.changes.views / 100) : 0)), 0);
  const previousInteractions = channels.reduce((sum, channel) => {
    const previousChannelViews = channel.previous?.views ?? (channel.changes.views > -100 ? channel.views / (1 + channel.changes.views / 100) : 0);
    const previousRate = channel.previous?.engagementRate ?? (channel.changes.engagementRate > -100
      ? channel.engagementRate / (1 + channel.changes.engagementRate / 100) : 0);
    return sum + previousChannelViews * previousRate / 100;
  }, 0);
  const followers = channels.reduce((sum, channel) => sum + channel.followers, 0);
  const previousFollowers = channels.reduce((sum, channel) =>
    sum + (channel.previous?.followers ?? (channel.changes.followers > -100 ? channel.followers / (1 + channel.changes.followers / 100) : 0)), 0);
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

