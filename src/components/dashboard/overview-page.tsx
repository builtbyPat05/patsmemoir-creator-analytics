"use client";

import { useState } from "react";
import { AllTimeSummary } from "@/components/dashboard/all-time-summary";
import { CreatorGrowthCoach } from "@/components/dashboard/creator-growth-coach";
import { DateRangeControl, type SharedRange } from "@/components/dashboard/date-range-control";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PerformanceChart } from "@/components/dashboard/performance-chart";
import { PlatformBreakdown } from "@/components/dashboard/platform-breakdown";
import { ReportingWindow } from "@/components/dashboard/reporting-window";
import { Sidebar } from "@/components/dashboard/sidebar";
import { TopPostsTable } from "@/components/dashboard/top-posts-table";
import {
  formatCompactNumber,
  formatPercentage,
  performanceRangeLabels,
  type AnalyticsByRange,
  type PlatformAnalyticsByRange,
  type Post,
} from "@/lib/dashboard-data";
import type { AllTimeDashboard } from "@/lib/analytics/all-time";

type OverviewPageProps = {
  connected: { youtube: boolean; tiktok: boolean };
  allTime: AllTimeDashboard;
  initialAnalyticsByRange: AnalyticsByRange;
  initialPlatformAnalyticsByRange: PlatformAnalyticsByRange;
  contentPosts: { youtube: Post[]; instagram: Post[]; tiktok: Post[] };
};

export function OverviewPage({
  connected,
  allTime,
  initialAnalyticsByRange,
  initialPlatformAnalyticsByRange,
  contentPosts,
}: OverviewPageProps) {
  const [range, setRange] = useState<SharedRange>("7d");
  const period = range === "all" ? null : range;
  const analytics = initialAnalyticsByRange[period ?? "7d"];
  const includedChannels = (["youtube", "tiktok"] as const)
    .filter((platform) => !initialPlatformAnalyticsByRange[platform][period ?? "7d"].unavailableReason)
    .map((platform) => platform === "youtube" ? "YouTube" : "TikTok");
  const rangeLabel = period ? performanceRangeLabels[period].toLowerCase() : "all time";

  return (
    <main className="app-shell">
      <Sidebar activeSection="overview" />

      <section className="main-content">
        <header className="topbar">
          <div>
            <div className="dashboard-eyebrow-row">
              <p className="eyebrow">Connected platforms</p>
              <span className="data-source-badge">{connected.youtube || connected.tiktok ? "Windsor data" : "No connected data"}</span>
            </div>
            <h1>Good morning, Patrick.</h1>
            <p className="header-subtitle">Your connected channels {period ? `in the ${rangeLabel}` : "since you began"}.</p>
            {period && <ReportingWindow points={analytics.performanceData} />}
          </div>

          <div className="topbar-actions">
            <DateRangeControl value={range} onChange={setRange} />
          </div>
        </header>

        {range === "all" ? <AllTimeSummary title="All-time overview" stats={allTime.overview} breakdown={allTime} /> : <>
        <p className="header-subtitle">
          {includedChannels.length ? `Included in this period: ${includedChannels.join(" and ")}.` : "No channels have complete period data."} Instagram is not connected yet.
          {!connected.tiktok && " TikTok is currently unavailable."}
        </p>

        <p className="header-subtitle">Period totals include channels with complete daily fields in both reporting windows. Missing data is marked unavailable. Source requests are cached for one hour.</p>
        {analytics.unavailableReason ? <p role="status">{analytics.unavailableReason}</p> : <div className="metric-grid">
          <MetricCard label="Total views" value={formatCompactNumber(analytics.views)} change={analytics.changes.views} detail="vs. previous period" tone="coral" />
          <MetricCard label="Engagement rate" value={formatPercentage(analytics.engagementRate)} change={analytics.changes.engagementRate} detail="weighted across platforms" tone="teal" />
          <MetricCard label="Followers" value={formatCompactNumber(analytics.followers)} change={analytics.changes.followers} detail="total audience" tone="violet" />
          <MetricCard label="Posts published" value={String(analytics.postsPublished)} change={analytics.changes.postsPublished} changeUnit="count" detail="in selected period" tone="gold" />
        </div>}

        <PlatformBreakdown
          analyticsByPlatform={initialPlatformAnalyticsByRange}
          range={range}
        />

        {!analytics.unavailableReason && <div className="content-grid">
          <section className="panel chart-panel" aria-labelledby="views-heading">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Reach</p>
                <h2 id="views-heading">Performance over time</h2>
              </div>
            </div>
            <PerformanceChart
              data={analytics.performanceData}
              range={range}
              changes={{
                views: analytics.changes.views,
                followers: analytics.changes.followers,
                engagement: analytics.changes.engagementRate,
              }}
            />
          </section>

          <CreatorGrowthCoach analytics={analytics} range={range} scopeLabel="All platforms" />
        </div>}

        </>}

        {(["youtube", "tiktok", "instagram"] as const).map((platform) => (
          <section className="panel posts-panel" aria-labelledby={`${platform}-posts-heading`} key={platform}>
            <div className="panel-heading posts-heading">
              <div>
                <p className="section-kicker">Content performance</p>
                <h2 id={`${platform}-posts-heading`}>{platform === "youtube" ? "YouTube" : platform === "tiktok" ? "TikTok" : "Instagram"} published content</h2>
                <p className="reporting-window">{platform === "instagram" ? "No connected content yet." : "Published posts returned by Windsor. Views are lifetime totals, independent of the date selector."}</p>
              </div>
            </div>
            <TopPostsTable posts={contentPosts[platform]} formatNumber={formatCompactNumber} />
          </section>
        ))}
      </section>
    </main>
  );
}
