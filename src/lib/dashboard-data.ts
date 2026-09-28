export type PlatformKey = "youtube" | "instagram" | "facebook" | "tiktok";

export type MetricTone = "coral" | "teal" | "violet" | "gold";

export type PerformancePoint = {
  date: string;
  views: number;
  followers: number;
  engagement: number;
};

export type PerformanceRange = "7d" | "30d" | "90d" | "1y";

export type AnalyticsChanges = {
  views: number;
  engagementRate: number;
  followers: number;
  postsPublished: number;
};

export type Post = {
  id: string;
  title: string;
  platform: PlatformKey;
  pillar: string;
  publishedAt: string;
  views: number;
  engagementRate: number;
  accent: MetricTone;
};

export type AnalyticsData = {
  views: number;
  engagementRate: number;
  followers: number;
  postsPublished: number;
  changes: AnalyticsChanges;
  performanceData: PerformancePoint[];
  topPosts: Post[];
};

export type PlatformAnalytics = Record<PlatformKey, AnalyticsData>;

export type AnalyticsByRange = Record<PerformanceRange, AnalyticsData>;

export type PlatformAnalyticsByRange = Record<PlatformKey, AnalyticsByRange>;

export const performanceRangeOptions: { key: PerformanceRange; label: string }[] = [
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "90d", label: "90D" },
  { key: "1y", label: "1Y" },
];

export const performanceRangeLabels: Record<PerformanceRange, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "1y": "Last year",
};

export const performanceRangeKeys: PerformanceRange[] = ["7d", "30d", "90d", "1y"];

const rangeSettings: Record<Exclude<PerformanceRange, "7d">, {
  days: number;
  followerStart: number;
  engagementDrop: number;
}> = {
  "30d": {
    days: 30,
    followerStart: 0.94,
    engagementDrop: 0.7,
  },
  "90d": {
    days: 90,
    followerStart: 0.8,
    engagementDrop: 1.4,
  },
  "1y": {
    days: 365,
    followerStart: 0.55,
    engagementDrop: 2.2,
  },
};

export function createPerformanceRanges(baseData: PerformancePoint[]): Record<PerformanceRange, PerformancePoint[]> {
  const latest = baseData.at(-1);
  const first = baseData[0];

  if (!latest || !first) {
    return {
      "7d": [],
      "30d": [],
      "90d": [],
      "1y": [],
    };
  }

  const averageEngagement = baseData.reduce((total, point) => total + point.engagement, 0) / baseData.length;

  return {
    "7d": baseData,
    "30d": createDailyRange(baseData, latest, first, averageEngagement, rangeSettings["30d"]),
    "90d": createDailyRange(baseData, latest, first, averageEngagement, rangeSettings["90d"]),
    "1y": createDailyRange(baseData, latest, first, averageEngagement, rangeSettings["1y"]),
  };
}

const postMultipliers: Record<PerformanceRange, number> = {
  "7d": 1,
  "30d": 4,
  "90d": 13,
  "1y": 52,
};

export function getSampleAnalyticsForRange(analytics: AnalyticsData, range: PerformanceRange): AnalyticsData {
  const performanceData = createPerformanceRanges(analytics.performanceData)[range];
  const views = performanceData.reduce((total, point) => total + point.views, 0);
  const multiplier = postMultipliers[range];
  const latestPoint = performanceData.at(-1);

  if (!latestPoint) {
    return {
      ...analytics,
      views: 0,
      engagementRate: 0,
      followers: 0,
      postsPublished: 0,
      performanceData: [],
      topPosts: [],
    };
  }

  const weightedEngagement = views > 0
    ? performanceData.reduce(
      (total, point) => total + point.views * point.engagement,
      0,
    ) / views
    : 0;

  return {
    ...analytics,
    views,
    engagementRate: Number(weightedEngagement.toFixed(1)),
    followers: latestPoint.followers,
    postsPublished: analytics.postsPublished * multiplier,
    performanceData,
    topPosts: analytics.topPosts.map((post) => ({
      ...post,
      views: Math.round(post.views * multiplier),
    })),
  };
}

export function createSampleAnalyticsByRange(analytics: AnalyticsData): AnalyticsByRange {
  return {
    "7d": getSampleAnalyticsForRange(analytics, "7d"),
    "30d": getSampleAnalyticsForRange(analytics, "30d"),
    "90d": getSampleAnalyticsForRange(analytics, "90d"),
    "1y": getSampleAnalyticsForRange(analytics, "1y"),
  };
}

export function createSamplePlatformAnalyticsByRange(
  analyticsByPlatform: PlatformAnalytics,
): PlatformAnalyticsByRange {
  return {
    youtube: createSampleAnalyticsByRange(analyticsByPlatform.youtube),
    instagram: createSampleAnalyticsByRange(analyticsByPlatform.instagram),
    facebook: createSampleAnalyticsByRange(analyticsByPlatform.facebook),
    tiktok: createSampleAnalyticsByRange(analyticsByPlatform.tiktok),
  };
}

function createDailyRange(
  baseData: PerformancePoint[],
  latest: PerformancePoint,
  first: PerformancePoint,
  averageEngagement: number,
  settings: {
    days: number;
    followerStart: number;
    engagementDrop: number;
  },
) {
  const endDate = new Date(Date.UTC(2026, 5, 28));
  const startDate = new Date(endDate);
  startDate.setUTCDate(endDate.getUTCDate() - settings.days + 1);

  return Array.from({ length: settings.days }, (_, index) => {
    const pattern = baseData[index % baseData.length];

    if (!pattern) {
      throw new Error("Sample performance data must include at least one point.");
    }
    const progress = index / (settings.days - 1);
    const variation = 0.94 + ((index * 7) % 8) / 100;
    const isLatestPoint = index === settings.days - 1;
    const date = new Date(startDate);
    date.setUTCDate(startDate.getUTCDate() + index);

    return {
      date: date.toISOString().slice(0, 10),
      views: Math.round(pattern.views * (0.84 + progress * 0.2) * variation),
      followers: isLatestPoint
        ? latest.followers
        : Math.round(
          latest.followers * (settings.followerStart + (1 - settings.followerStart) * progress)
            + (pattern.followers - first.followers) * 0.15,
        ),
      engagement: Number((latest.engagement - settings.engagementDrop * (1 - progress) + (pattern.engagement - averageEngagement) * 0.2).toFixed(1)),
    };
  });
}

export type PlatformConfig = {
  key: PlatformKey;
  label: string;
  description: string;
  color: string;
  tone: MetricTone;
};

export const platformKeys: PlatformKey[] = ["youtube", "instagram", "facebook", "tiktok"];

export const platforms: Record<PlatformKey, PlatformConfig> = {
  youtube: {
    key: "youtube",
    label: "YouTube",
    description: "Long-form video and channel growth",
    color: "#9a6e5c",
    tone: "coral",
  },
  instagram: {
    key: "instagram",
    label: "Instagram",
    description: "Reels, carousels, and community reach",
    color: "#8c8491",
    tone: "violet",
  },
  facebook: {
    key: "facebook",
    label: "Facebook",
    description: "Community distribution and conversations",
    color: "#8f826c",
    tone: "gold",
  },
  tiktok: {
    key: "tiktok",
    label: "TikTok",
    description: "Short-form discovery and shareability",
    color: "#7f8b82",
    tone: "teal",
  },
};

const tiktokPost: Post = {
  id: "tiktok-consistency-habits",
  title: "Three habits that made me more consistent",
  platform: "tiktok",
  pillar: "Mindset",
  publishedAt: "2026-06-27",
  views: 48200,
  engagementRate: 9.8,
  accent: "coral",
};

const instagramPost: Post = {
  id: "instagram-building-in-public",
  title: "What I learned from building in public",
  platform: "instagram",
  pillar: "Build in public",
  publishedAt: "2026-06-25",
  views: 36700,
  engagementRate: 8.4,
  accent: "violet",
};

const youtubePost: Post = {
  id: "youtube-busy-week-reset",
  title: "A simple reset for a busy week",
  platform: "youtube",
  pillar: "Lifestyle",
  publishedAt: "2026-06-22",
  views: 24100,
  engagementRate: 6.7,
  accent: "teal",
};

const facebookPost: Post = {
  id: "facebook-content-planning-system",
  title: "My five-minute content planning system",
  platform: "facebook",
  pillar: "Creator tips",
  publishedAt: "2026-06-20",
  views: 18900,
  engagementRate: 5.9,
  accent: "gold",
};

const allPosts: Post[] = [tiktokPost, instagramPost, youtubePost, facebookPost];

export const overviewAnalytics: AnalyticsData = {
  views: 204600,
  engagementRate: 7.6,
  followers: 12800,
  postsPublished: 12,
  changes: {
    views: 16.3,
    engagementRate: 2.0,
    followers: 6.7,
    postsPublished: 3,
  },
  performanceData: [
    { date: "2026-06-22", views: 20700, followers: 11530, engagement: 6.3 },
    { date: "2026-06-23", views: 26100, followers: 11730, engagement: 7.2 },
    { date: "2026-06-24", views: 24300, followers: 11910, engagement: 7.0 },
    { date: "2026-06-25", views: 32400, followers: 12130, engagement: 7.8 },
    { date: "2026-06-26", views: 35600, followers: 12370, engagement: 8.4 },
    { date: "2026-06-27", views: 30100, followers: 12590, engagement: 8.3 },
    { date: "2026-06-28", views: 35400, followers: 12800, engagement: 7.8 },
  ],
  topPosts: allPosts,
};

export const platformAnalytics: PlatformAnalytics = {
  youtube: {
    views: 72400,
    engagementRate: 6.0,
    followers: 4800,
    postsPublished: 3,
    changes: { views: 12.8, engagementRate: 1.4, followers: 4.1, postsPublished: 1 },
    performanceData: [
      { date: "2026-06-22", views: 7200, followers: 4310, engagement: 5.1 },
      { date: "2026-06-23", views: 8400, followers: 4380, engagement: 5.6 },
      { date: "2026-06-24", views: 7900, followers: 4440, engagement: 5.4 },
      { date: "2026-06-25", views: 10800, followers: 4520, engagement: 6.0 },
      { date: "2026-06-26", views: 12100, followers: 4610, engagement: 6.4 },
      { date: "2026-06-27", views: 9600, followers: 4700, engagement: 6.0 },
      { date: "2026-06-28", views: 16400, followers: 4800, engagement: 6.8 },
    ],
    topPosts: [youtubePost],
  },
  instagram: {
    views: 58700,
    engagementRate: 7.6,
    followers: 3600,
    postsPublished: 4,
    changes: { views: 16.2, engagementRate: 1.8, followers: 5.4, postsPublished: 1 },
    performanceData: [
      { date: "2026-06-22", views: 6100, followers: 3280, engagement: 6.5 },
      { date: "2026-06-23", views: 6900, followers: 3320, engagement: 7.0 },
      { date: "2026-06-24", views: 7400, followers: 3370, engagement: 7.2 },
      { date: "2026-06-25", views: 9200, followers: 3420, engagement: 7.8 },
      { date: "2026-06-26", views: 10100, followers: 3480, engagement: 8.2 },
      { date: "2026-06-27", views: 8800, followers: 3540, engagement: 7.9 },
      { date: "2026-06-28", views: 10200, followers: 3600, engagement: 8.1 },
    ],
    topPosts: [instagramPost],
  },
  facebook: {
    views: 21900,
    engagementRate: 5.3,
    followers: 2100,
    postsPublished: 2,
    changes: { views: 8.6, engagementRate: 0.9, followers: 3.3, postsPublished: 1 },
    performanceData: [
      { date: "2026-06-22", views: 2800, followers: 1930, engagement: 4.8 },
      { date: "2026-06-23", views: 3400, followers: 1960, engagement: 5.1 },
      { date: "2026-06-24", views: 2900, followers: 1980, engagement: 5.0 },
      { date: "2026-06-25", views: 4100, followers: 2010, engagement: 5.7 },
      { date: "2026-06-26", views: 3600, followers: 2040, engagement: 5.5 },
      { date: "2026-06-27", views: 2300, followers: 2070, engagement: 5.1 },
      { date: "2026-06-28", views: 2800, followers: 2100, engagement: 5.8 },
    ],
    topPosts: [facebookPost],
  },
  tiktok: {
    views: 51600,
    engagementRate: 10.8,
    followers: 2300,
    postsPublished: 3,
    changes: { views: 24.5, engagementRate: 3.8, followers: 8.9, postsPublished: 1 },
    performanceData: [
      { date: "2026-06-22", views: 4600, followers: 2010, engagement: 8.9 },
      { date: "2026-06-23", views: 7400, followers: 2070, engagement: 10.1 },
      { date: "2026-06-24", views: 6100, followers: 2120, engagement: 9.7 },
      { date: "2026-06-25", views: 8300, followers: 2180, engagement: 11.0 },
      { date: "2026-06-26", views: 9800, followers: 2240, engagement: 12.1 },
      { date: "2026-06-27", views: 9400, followers: 2280, engagement: 11.7 },
      { date: "2026-06-28", views: 6000, followers: 2300, engagement: 10.8 },
    ],
    topPosts: [tiktokPost],
  },
};

export function isPlatformKey(value: string): value is PlatformKey {
  return platformKeys.includes(value as PlatformKey);
}

export function formatCompactNumber(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0;

  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(safeValue);
}

export function formatPercentage(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0;

  return `${safeValue.toFixed(1)}%`;
}

export function formatMetricChange(value: number, unit: "count" | "percentage" = "percentage") {
  const safeValue = Number.isFinite(value) ? value : 0;
  const sign = safeValue > 0 ? "+" : "";
  const formattedValue = unit === "count" ? Math.round(safeValue).toLocaleString("en-US") : formatPercentage(safeValue);

  return `${sign}${formattedValue}`;
}

export function formatPostDate(value: string) {
  const date = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
