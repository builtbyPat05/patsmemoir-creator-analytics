"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { AllTimeSummary } from "@/components/dashboard/all-time-summary";
import { CreatorGrowthCoach } from "@/components/dashboard/creator-growth-coach";
import { DateRangeControl, type SharedRange } from "@/components/dashboard/date-range-control";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PerformanceChart } from "@/components/dashboard/performance-chart";
import { ReportingWindow } from "@/components/dashboard/reporting-window";
import { Sidebar } from "@/components/dashboard/sidebar";
import { TopPostsTable } from "@/components/dashboard/top-posts-table";
import {
  formatCompactNumber,
  formatPercentage,
  performanceRangeLabels,
  platforms,
  type AnalyticsByRange,
  type PlatformKey,
  type Post,
} from "@/lib/dashboard-data";
import type { AllTimeStats } from "@/lib/analytics/all-time";

type AnalyticsPageProps = {
  dataSource: "windsor" | "empty";
  allTime: AllTimeStats | null;
  initialAnalyticsByRange: AnalyticsByRange;
  platform: PlatformKey;
  contentPosts: Post[];
  allTimeSection?: ReactNode;
};

export function AnalyticsPage({ dataSource, allTime, initialAnalyticsByRange, contentPosts, platform, allTimeSection }: AnalyticsPageProps) {
  const [range, setRange] = useState<SharedRange>("7d");
  const platformDetails = platforms[platform];
  const period = range === "all" ? null : range;
  const analytics = initialAnalyticsByRange[period ?? "7d"];
  const rangeLabel = period ? performanceRangeLabels[period].toLowerCase() : "all time";

  return (
    <main className="app-shell">
      <Sidebar activeSection={platform} />

      <section className="main-content">
        <header className="topbar">
          <div>
            <div className="dashboard-eyebrow-row">
              <p className="eyebrow">{platformDetails.label} analytics</p>
              {dataSource === "windsor" && <span className="data-source-badge">Connected {platformDetails.label} data</span>}
              {dataSource === "empty" && <span className="data-source-badge">No connected data</span>}
            </div>
            <h1>{platformDetails.label} performance.</h1>
            <p className="header-subtitle">{period ? `A focused view of how this channel is moving in the ${rangeLabel}.` : "A summary of this channel since you began."}</p>
            {period && <ReportingWindow points={analytics.performanceData} />}
          </div>

          <div className="topbar-actions">
            <DateRangeControl value={range} onChange={setRange} />
          </div>
        </header>

        {range === "all" ? <>
          <AllTimeSummary title={`${platformDetails.label} all time`} stats={allTime} platform={platform} />
          {platform === "tiktok" && allTimeSection}
        </> : <>
        {analytics.unavailableReason || dataSource === "empty" ? <p role="status">{platform === "instagram" ? "Instagram is not connected yet." : analytics.unavailableReason ?? "Channel data is currently unavailable."}</p> : <>
        <p className="header-subtitle">Daily fields cover this period and its comparison window. Source requests are cached for one hour.</p>

        <div className="platform-view-banner" style={{ borderLeftColor: platformDetails.color }}>
          <span className="platform-view-dot" style={{ background: platformDetails.color }} aria-hidden="true" />
          <span>{`Showing only ${platformDetails.label} data`}</span>
          <span className="platform-view-total">{formatCompactNumber(analytics.views)} total views in the {rangeLabel}</span>
        </div>

        <div className="metric-grid">
          <MetricCard label="Total views" value={formatCompactNumber(analytics.views)} change={analytics.changes.views} detail="vs. previous period" tone={platformDetails.tone} />
          <MetricCard label="Engagement rate" value={formatPercentage(analytics.engagementRate)} change={analytics.changes.engagementRate} detail="weighted for this channel" tone="teal" />
          <MetricCard label="Followers" value={formatCompactNumber(analytics.followers)} change={analytics.changes.followers} detail="total audience" tone="violet" />
          <MetricCard label={dataSource === "windsor" && platform === "youtube" ? "New videos tracked" : "Posts published"} value={String(analytics.postsPublished)} change={analytics.changes.postsPublished} changeUnit="count" detail={dataSource === "windsor" && platform === "youtube" ? "uploads with measured views" : "in selected period"} tone="gold" />
        </div>

        <div className="content-grid">
          <section className="panel chart-panel" aria-labelledby={`${platform}-views-heading`}>
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Reach</p>
                <h2 id={`${platform}-views-heading`}>{platformDetails.label} performance over time</h2>
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

          <CreatorGrowthCoach analytics={analytics} range={range} scopeLabel={platformDetails.label} />
        </div>

        </>}
        {platform !== "tiktok" && allTimeSection}

        </>}

        <section className="panel posts-panel" aria-labelledby={`${platform}-posts-heading`}>
          <div className="panel-heading posts-heading">
            <div>
              <p className="section-kicker">Content performance</p>
              <h2 id={`${platform}-posts-heading`}>{platformDetails.label} published content</h2>
              <p className="reporting-window">{dataSource === "empty" ? "No connected content yet." : "Published posts returned by Windsor. Views are lifetime totals, independent of the date selector."}</p>
            </div>
          </div>
          <TopPostsTable posts={contentPosts} formatNumber={formatCompactNumber} />
        </section>
      </section>
    </main>
  );
}
