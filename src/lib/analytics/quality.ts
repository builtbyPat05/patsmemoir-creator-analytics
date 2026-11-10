import type { AnalyticsData } from "../dashboard-data";

export function hasMetrics(row: object | undefined, fields: string[]): boolean {
  if (!row) return false;
  const values = row as Record<string, unknown>;
  return fields.every((field) => {
    const value = values[field];
    return (typeof value === "number" || (typeof value === "string" && value.trim() !== ""))
      && Number.isFinite(Number(value)) && Number(value) >= 0;
  });
}

export function coversPeriod(dates: Set<string>, end: string, days: number): boolean {
  const endTime = Date.parse(end + "T00:00:00Z");
  return Array.from({ length: days }, (_, index) =>
    new Date(endTime - index * 86400000).toISOString().slice(0, 10)
  ).every((date) => dates.has(date));
}

export function unavailable(reason: string): AnalyticsData {
  return {
    unavailableReason: reason,
    views: 0, followers: 0, engagementRate: 0, postsPublished: 0,
    changes: { views: 0, followers: 0, engagementRate: 0, postsPublished: 0 },
    performanceData: [], topPosts: [],
  };
}
