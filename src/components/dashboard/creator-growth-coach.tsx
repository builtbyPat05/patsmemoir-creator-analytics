import { ArrowUpRight, Sparkles } from "lucide-react";
import Link from "next/link";
import {
  formatPercentage,
  performanceRangeLabels,
  type AnalyticsData,
  type PerformanceRange,
} from "@/lib/dashboard-data";

type CreatorGrowthCoachProps = {
  analytics: AnalyticsData;
  range: PerformanceRange;
  scopeLabel: string;
};

export function CreatorGrowthCoach({ analytics, range, scopeLabel }: CreatorGrowthCoachProps) {
  const period = performanceRangeLabels[range].toLowerCase();
  const scope = scopeLabel === "All platforms" ? "across your channels" : `on ${scopeLabel}`;
  const reachDirection = analytics.changes.views < 0 ? "down" : "up";
  const reachChange = formatPercentage(Math.abs(analytics.changes.views));

  return (
    <section className="panel growth-coach-card" aria-labelledby="growth-coach-heading">
      <div className="growth-coach-header">
        <div className="coach-icon" aria-hidden="true">
          <Sparkles size={20} />
        </div>
        <div>
          <p className="section-kicker">Creator growth coach</p>
          <h2 id="growth-coach-heading">Your next best move.</h2>
        </div>
        <span className="coach-demo-badge">Demo</span>
      </div>

      <p className="coach-summary">
        Your reach is {reachDirection} {reachChange} {scope} in the {period}. The strongest growth opportunity is turning your faith, purpose, discipline, and relationship lessons into clearer repeatable series.
      </p>

      <div className="coach-read">
        <p className="coach-read-label">Coach read</p>
        <p>Lead with a specific tension your audience feels, then use your personal experience to earn the lesson. That keeps the message wise without making it feel distant.</p>
      </div>

      <ol className="coach-actions">
        <li>
          <strong>Strengthen the hook</strong>
          <span>Open with the problem before the lesson: “Discipline is hardest when nobody is watching.”</span>
        </li>
        <li>
          <strong>Invite community, not just views</strong>
          <span>End two posts this week with one genuine question your audience can answer from experience.</span>
        </li>
        <li>
          <strong>Collect future product signals</strong>
          <span>Save repeat questions about purpose and relationships; they can become a guide, workshop, or brand-deal proof point.</span>
        </li>
      </ol>

      <Link className="coach-open-link" href="/coach">
        Open the Growth Coach
        <ArrowUpRight size={16} aria-hidden="true" />
      </Link>
    </section>
  );
}
