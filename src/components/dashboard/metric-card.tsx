import { ArrowDownRight, ArrowUpRight, Eye, Heart, Users, Video } from "lucide-react";
import { formatMetricChange } from "@/lib/dashboard-data";

type MetricTone = "coral" | "teal" | "violet" | "gold";

type MetricCardProps = {
  label: string;
  value: string;
  change: number;
  changeUnit?: "count" | "percentage";
  detail: string;
  tone: MetricTone;
};

const icons = {
  coral: Eye,
  teal: Heart,
  violet: Users,
  gold: Video,
};

export function MetricCard({ label, value, change, changeUnit = "percentage", detail, tone }: MetricCardProps) {
  const Icon = icons[tone];
  const ChangeIcon = change < 0 ? ArrowDownRight : ArrowUpRight;

  return (
    <article className={`metric-card metric-card-${tone}`}>
      <div className="metric-card-topline">
        <span className="metric-icon" aria-hidden="true">
          <Icon size={18} />
        </span>
        <span className={change < 0 ? "metric-change metric-change-negative" : "metric-change"}>
          <ChangeIcon size={14} aria-hidden="true" />
          {formatMetricChange(change, changeUnit)}
        </span>
      </div>
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
      <p className="metric-detail">{detail}</p>
    </article>
  );
}
