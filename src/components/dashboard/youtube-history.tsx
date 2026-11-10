"use client";

import { useState } from "react";
import { PerformanceChart } from "@/components/dashboard/performance-chart";
import { ReportingWindow } from "@/components/dashboard/reporting-window";
import { formatCompactNumber, type AnalyticsByRange } from "@/lib/dashboard-data";

type HistoricalRange = "90d" | "1y";

export function YoutubeHistory({ analyticsByRange }: { analyticsByRange: AnalyticsByRange }) {
  const [range, setRange] = useState<HistoricalRange>("90d");
  const analytics = analyticsByRange[range];

  return (
    <section className="panel chart-panel youtube-history" aria-labelledby="youtube-history-heading">
      <div className="panel-heading history-heading">
        <div>
          <p className="section-kicker">YouTube only</p>
          <h2 id="youtube-history-heading">Historical trends</h2>
          <ReportingWindow points={analytics.performanceData} />
        </div>
        <div className="range-control" role="group" aria-label="Select YouTube historical range">
          {(["90d", "1y"] as const).map((option) => (
            <button
              aria-pressed={range === option}
              className={range === option ? "range-button range-button-active" : "range-button"}
              key={option}
              onClick={() => setRange(option)}
              type="button"
            >
              {option === "90d" ? "90D" : "1Y"}
            </button>
          ))}
        </div>
      </div>
      {analytics.unavailableReason ? <p role="status">{analytics.unavailableReason}</p> : <>
      <p className="history-summary">{formatCompactNumber(analytics.views)} views in this period</p>
      <PerformanceChart
        data={analytics.performanceData}
        range={range}
        changes={{
          views: analytics.changes.views,
          followers: analytics.changes.followers,
          engagement: analytics.changes.engagementRate,
        }}
      />
      </>}
    </section>
  );
}
