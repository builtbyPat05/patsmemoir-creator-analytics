"use client";

import { useState } from "react";
import { CreatorGrowthCoach } from "@/components/dashboard/creator-growth-coach";
import { DateRangeControl } from "@/components/dashboard/date-range-control";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PerformanceChart } from "@/components/dashboard/performance-chart";
import { PlatformBreakdown } from "@/components/dashboard/platform-breakdown";
import { Sidebar } from "@/components/dashboard/sidebar";
import { TopPostsTable } from "@/components/dashboard/top-posts-table";
import {
  formatCompactNumber,
  formatPercentage,
  performanceRangeLabels,
  type AnalyticsByRange,
  type PerformanceRange,
  type PlatformAnalyticsByRange,
} from "@/lib/dashboard-data";

type OverviewPageProps = {
  dataSource: "demo" | "supabase";
  initialAnalyticsByRange: AnalyticsByRange;
  initialPlatformAnalyticsByRange: PlatformAnalyticsByRange;
};

export function OverviewPage({
  dataSource,
  initialAnalyticsByRange,
  initialPlatformAnalyticsByRange,
}: OverviewPageProps) {
  const [range, setRange] = useState<PerformanceRange>("7d");
  const analytics = initialAnalyticsByRange[range];
  const rangeLabel = performanceRangeLabels[range].toLowerCase();

  return (
    <main className="app-shell">
      <Sidebar activeSection="overview" />

      <section className="main-content">
        <header className="topbar">
          <div>
            <div className="dashboard-eyebrow-row">
              <p className="eyebrow">All platforms</p>
              {dataSource === "demo" && <span className="data-source-badge">Demo data</span>}
            </div>
            <h1>Good morning, Patrick.</h1>
            <p className="header-subtitle">Here&apos;s how your personal brand is moving across every channel in the {rangeLabel}.</p>
          </div>

          <div className="topbar-actions">
            <DateRangeControl value={range} onChange={setRange} />
          </div>
        </header>

        <div className="metric-grid">
          <MetricCard label="Total views" value={formatCompactNumber(analytics.views)} change={analytics.changes.views} detail="vs. previous period" tone="coral" />
          <MetricCard label="Engagement rate" value={formatPercentage(analytics.engagementRate)} change={analytics.changes.engagementRate} detail="weighted across platforms" tone="teal" />
          <MetricCard label="Followers" value={formatCompactNumber(analytics.followers)} change={analytics.changes.followers} detail="total audience" tone="violet" />
          <MetricCard label="Posts published" value={String(analytics.postsPublished)} change={analytics.changes.postsPublished} changeUnit="count" detail="in selected period" tone="gold" />
        </div>

        <PlatformBreakdown
          analyticsByPlatform={initialPlatformAnalyticsByRange}
          range={range}
        />

        <div className="content-grid">
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
        </div>

        <section className="panel posts-panel" aria-labelledby="posts-heading">
          <div className="panel-heading posts-heading">
            <div>
              <p className="section-kicker">Content performance</p>
              <h2 id="posts-heading">Top posts for the {rangeLabel}</h2>
            </div>
          </div>
          <TopPostsTable posts={analytics.topPosts} formatNumber={formatCompactNumber} />
        </section>
      </section>
    </main>
  );
}
