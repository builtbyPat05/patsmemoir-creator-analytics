import Link from "next/link";
import type { AllTimeDashboard, AllTimeStats } from "@/lib/analytics/all-time";

function value(number: number | null | undefined) {
  return number == null ? "N/A" : number.toLocaleString("en-US");
}

type AllTimeSummaryProps = {
  title: string;
  stats: AllTimeStats | null;
  platform?: "youtube" | "instagram" | "tiktok";
  breakdown?: AllTimeDashboard;
};

export function AllTimeSummary({ title, stats, platform, breakdown }: AllTimeSummaryProps) {
  const contributors = breakdown
    ? (["youtube", "tiktok"] as const).filter((key) => breakdown[key] !== null)
    : [];
  const partial = breakdown && contributors.length < 2;

  return (
    <div className="all-time-view">
      <section className="all-time-intro" aria-labelledby="all-time-heading">
        <p className="section-kicker">Account totals</p>
        <h2 id="all-time-heading">{title}</h2>
        <p className="header-subtitle">
          {platform === "instagram"
            ? "Instagram is not connected yet. No lifetime totals are available."
            : stats
              ? "Available account totals reported by Windsor. Lifetime engagement rate and a complete lifetime chart are not available."
              : "Lifetime totals are currently unavailable. N/A means no verified number was returned."}
        </p>
        {breakdown && (
          <p className="reporting-window">
            {contributors.length > 0
              ? `${partial ? "Partial total" : "Included"}: ${contributors.map((key) => key === "youtube" ? "YouTube" : "TikTok").join(" + ")}. Instagram is not connected.`
              : "No channels returned lifetime totals. Instagram is not connected."}
          </p>
        )}
        {(platform === "tiktok" || breakdown) && <p className="reporting-window">TikTok does not provide a verified account lifetime views total here, so combined lifetime views are N/A.</p>}
      </section>

      <div className="metric-grid all-time-metrics">
        <article className="metric-card"><p className="metric-label">Lifetime video views</p><p className="metric-value">{value(stats?.views)}</p><p className="metric-detail">{stats?.views == null ? "No verified total" : "Account total"}</p></article>
        <article className="metric-card"><p className="metric-label">Followers</p><p className="metric-value">{value(stats?.followers)}</p><p className="metric-detail">Current account total</p></article>
        <article className="metric-card"><p className="metric-label">Public videos</p><p className="metric-value">{value(stats?.videos)}</p><p className="metric-detail">Account total</p></article>
        <article className="metric-card"><p className="metric-label">Lifetime engagement rate</p><p className="metric-value">N/A</p><p className="metric-detail">Not comparable across full history</p></article>
      </div>

      {platform === "tiktok" && stats?.likes != null && (
        <p className="all-time-extra">{value(stats.likes)} lifetime TikTok likes</p>
      )}

      {breakdown && (
        <section className="all-time-breakdown" aria-labelledby="all-time-breakdown-heading">
          <div className="breakdown-heading">
            <div><p className="section-kicker">Channel totals</p><h2 id="all-time-breakdown-heading">By platform</h2></div>
          </div>
          <div className="platform-grid">
            {(["youtube", "tiktok", "instagram"] as const).map((key) => (
              <Link className="platform-card" href={`/${key}`} key={key}>
                <p className="platform-card-name">{key === "youtube" ? "YouTube" : key === "tiktok" ? "TikTok" : "Instagram"}</p>
                <p className="platform-card-description">{breakdown[key] ? "Windsor account totals" : "No verified totals"}</p>
                <div className="platform-card-stats"><span><strong>{value(breakdown[key]?.views)}</strong> lifetime views</span><span><strong>{value(breakdown[key]?.followers)}</strong> followers</span></div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
