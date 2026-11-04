import { formatPostDate, type PerformancePoint } from "@/lib/dashboard-data";

export function ReportingWindow({ points }: { points: PerformancePoint[] }) {
  const first = points[0]?.date;
  const last = points.at(-1)?.date;

  if (!first || !last) {
    return <p className="reporting-window">No reporting window available</p>;
  }

  return <p className="reporting-window">Period: {formatPostDate(first)} – {formatPostDate(last)}</p>;
}
