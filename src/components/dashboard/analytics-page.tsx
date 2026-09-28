"use client";

import { useState } from "react";
import { CreatorGrowthCoach } from "@/components/dashboard/creator-growth-coach";
import { DateRangeControl } from "@/components/dashboard/date-range-control";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PerformanceChart } from "@/components/dashboard/performance-chart";
import { Sidebar } from "@/components/dashboard/sidebar";
import { TopPostsTable } from "@/components/dashboard/top-posts-table";
import {
  formatCompactNumber,
  formatPercentage,
  performanceRangeLabels,
  platforms,
  type AnalyticsByRange,
  type PerformanceRange,
  type PlatformKey,
} from "@/lib/dashboard-data";

type AnalyticsPageProps = {
  dataSource: "demo" | "supabase";
  initialAnalyticsByRange: AnalyticsByRange;
  platform: PlatformKey;
};

export function AnalyticsPage({ dataSource, initialAnalyticsByRange, platform }: AnalyticsPageProps) {
  const [range, setRange] = useState<PerformanceRange>("7d");
  const platformDetails = platforms[platform];
  const analytics = initialAnalyticsByRange[range];
  const rangeLabel = performanceRangeLabels[range].toLowerCase();

  return (
    <main className="app-shell">
      <Sidebar activeSection={platform} />

      <section className="main-content">
        <header className="topbar">
          <div>
            <div className="dashboard-eyebrow-row">
              <p className="eyebrow">{platformDetails.label} analytics</p>
              {dataSource === "demo" && <span className="data-source-badge">Demo data</span>}
            </div>
            <h1>{platformDetails.label} performance.</h1>
            <p className="header-subtitle">A focused view of how this channel is moving in the {rangeLabel}.</p>
          </div>

          <div className="topbar-actions">
            <DateRangeControl value={range} onChange={setRange} />
          </div>
        </header>

        <div className="platform-view-banner" style={{ borderLeftColor: platformDetails.color }}>
          <span className="platform-view-dot" style={{ background: platformDetails.color }} aria-hidden="true" />
          <span>Showing only {platformDetails.label} data</span>
          <span className="platform-view-total">{formatCompactNumber(analytics.views)} total views in the {rangeLabel}</span>
        </div>

        <div className="metric-grid">
          <MetricCard label="Total views" value={formatCompactNumber(analytics.views)} change={analytics.changes.views} detail="vs. previous period" tone={platformDetails.tone} />
          <MetricCard label="Engagement rate" value={formatPercentage(analytics.engagementRate)} change={analytics.changes.engagementRate} detail="weighted for this channel" tone="teal" />
          <MetricCard label="Followers" value={formatCompactNumber(analytics.followers)} change={analytics.changes.followers} detail="total audience" tone="violet" />
          <MetricCard label="Posts published" value={String(analytics.postsPublished)} change={analytics.changes.postsPublished} changeUnit="count" detail="in selected period" tone="gold" />
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

        <section className="panel posts-panel" aria-labelledby={`${platform}-posts-heading`}>
          <div className="panel-heading posts-heading">
            <div>
              <p className="section-kicker">Content performance</p>
              <h2 id={`${platform}-posts-heading`}>Top {platformDetails.label} posts for the {rangeLabel}</h2>
            </div>
          </div>
          <TopPostsTable posts={analytics.topPosts} formatNumber={formatCompactNumber} />
        </section>
      </section>
    </main>
  );
}
