import { ArrowUpRight, Facebook, Instagram, Music2, Youtube } from "lucide-react";
import Link from "next/link";
import {
  formatCompactNumber,
  formatPercentage,
  performanceRangeLabels,
  platforms,
  type PerformanceRange,
  type PlatformAnalyticsByRange,
  type PlatformKey,
} from "@/lib/dashboard-data";

const platformIcons = {
  youtube: Youtube,
  instagram: Instagram,
  facebook: Facebook,
  tiktok: Music2,
};

type PlatformBreakdownProps = {
  analyticsByPlatform: PlatformAnalyticsByRange;
  range: PerformanceRange;
};

export function PlatformBreakdown({ analyticsByPlatform, range }: PlatformBreakdownProps) {
  return (
    <section className="platform-breakdown" aria-labelledby="platform-breakdown-heading">
      <div className="breakdown-heading">
        <div>
          <p className="section-kicker">Channel mix</p>
          <h2 id="platform-breakdown-heading">Platform performance</h2>
        </div>
        <p className="breakdown-helper">{performanceRangeLabels[range]} across each platform.</p>
      </div>

      <div className="platform-grid">
        {(Object.keys(platforms) as PlatformKey[]).map((platformKey) => {
          const platform = platforms[platformKey];
          const analytics = analyticsByPlatform[platformKey][range];
          const Icon = platformIcons[platformKey];

          return (
            <Link className="platform-card" href={`/${platformKey}`} key={platformKey} style={{ borderTopColor: platform.color }}>
              <div className="platform-card-heading">
                <span className="platform-icon" style={{ color: platform.color }} aria-hidden="true">
                  <Icon size={18} />
                </span>
                <ArrowUpRight className="platform-arrow" size={17} aria-hidden="true" />
              </div>
              <p className="platform-card-name">{platform.label}</p>
              <p className="platform-card-description">{platform.description}</p>
              <div className="platform-card-stats">
                <span><strong>{formatCompactNumber(analytics.views)}</strong> views</span>
                <span><strong>{formatPercentage(analytics.engagementRate)}</strong> engagement</span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
