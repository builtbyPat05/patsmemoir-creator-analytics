export type PlatformKey = "youtube" | "instagram" | "tiktok";

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
  url?: string;
  pillar: string;
  publishedAt: string;
  views: number;
  engagementRate: number;
  accent: MetricTone;
};

export type AnalyticsData = {
  unavailableReason?: string;
  previous?: { views: number; followers: number; engagementRate: number };
  views: number;
  engagementRate: number;
  followers: number;
  postsPublished: number;
  changes: AnalyticsChanges;
  performanceData: PerformancePoint[];
  topPosts: Post[];
};

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

export type PlatformConfig = {
  key: PlatformKey;
  label: string;
  description: string;
  color: string;
  tone: MetricTone;
};

export const platformKeys: PlatformKey[] = ["youtube", "instagram", "tiktok"];

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
  tiktok: {
    key: "tiktok",
    label: "TikTok",
    description: "Short-form discovery and shareability",
    color: "#7f8b82",
    tone: "teal",
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
