import { formatCompactNumber } from "@/lib/dashboard-data";
import type { TikTokLifetimeSummary } from "@/lib/integrations/windsor/tiktok";

export function TikTokAllTime({ summary }: { summary: TikTokLifetimeSummary | null }) {
  if (!summary) {
    return <p className="tiktok-lifetime-note">TikTok all-time totals are temporarily unavailable.</p>;
  }

  return (
      <section className="tiktok-lifetime" aria-labelledby="tiktok-lifetime-heading">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Partial video history</p>
            <h2 id="tiktok-lifetime-heading">Tracked TikTok videos</h2>
          </div>
        </div>
        <div className="metric-grid tiktok-lifetime-grid">
          <article className="metric-card tiktok-lifetime-card">
            <p className="metric-label">Tracked video views</p>
            <p className="metric-value">{formatCompactNumber(summary.trackedVideoViews)}</p>
            <p className="metric-detail">{summary.trackedVideos} of {summary.publicVideos} public videos returned</p>
          </article>
        </div>
        <p className="tiktok-lifetime-note">Tracked views are partial and are not an account all-time views total.</p>
      </section>
  );
}
