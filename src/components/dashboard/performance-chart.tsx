"use client";

import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { Eye, Heart, Users } from "lucide-react";
import {
  formatMetricChange,
  performanceRangeLabels,
  type PerformancePoint,
  type PerformanceRange,
} from "@/lib/dashboard-data";

type ChartMetric = "views" | "followers" | "engagement";

type PerformanceChartProps = {
  data: PerformancePoint[];
  range: PerformanceRange;
  changes: {
    views: number;
    followers: number;
    engagement: number;
  };
};

type MetricDefinition = {
  key: ChartMetric;
  label: string;
  description: string;
  color: string;
  icon: typeof Eye;
};

type ChartPoint = PerformancePoint & {
  axisLabel: string;
  label: string;
};

const metricDefinitions: MetricDefinition[] = [
  { key: "views", label: "Views over time", description: "Content reach across the selected period", color: "#9a6e5c", icon: Eye },
  { key: "followers", label: "Followers over time", description: "Audience growth across the selected period", color: "#8c8491", icon: Users },
  { key: "engagement", label: "Engagement over time", description: "Average engagement rate across the selected period", color: "#7f8b82", icon: Heart },
];

const defaultVisibleMetrics: Record<ChartMetric, boolean> = {
  views: true,
  followers: true,
  engagement: true,
};

const chartWidth = 760;
const chartHeight = 196;
const chartMargins = { top: 16, right: 16, bottom: 31, left: 58 };
const innerWidth = chartWidth - chartMargins.left - chartMargins.right;
const innerHeight = chartHeight - chartMargins.top - chartMargins.bottom;

function getMetricValue(point: PerformancePoint, metric: ChartMetric) {
  const value = point[metric];

  return Number.isFinite(value) ? value : 0;
}

type ChartDisplayData = {
  data: ChartPoint[];
  note: string;
  summaryLabel: string;
};

function getWindowSize(range: PerformanceRange) {
  if (range === "30d") {
    return 2;
  }

  if (range === "90d") {
    return 7;
  }

  if (range === "1y") {
    return 30;
  }

  return 1;
}

function getUtcDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDateLabel(value: string, range: PerformanceRange) {
  const date = getUtcDate(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
    ...(range === "1y" ? { year: "numeric" } : {}),
  }).format(date);
}

function formatAxisDate(value: string, range: PerformanceRange) {
  const date = getUtcDate(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", range === "7d"
    ? { weekday: "short", timeZone: "UTC" }
    : { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

function formatDateWindow(firstDate: string, lastDate: string, range: PerformanceRange) {
  if (firstDate === lastDate) {
    return formatDateLabel(firstDate, range);
  }

  return `${formatDateLabel(firstDate, range)} - ${formatDateLabel(lastDate, range)}`;
}

function createChartDisplayData(data: PerformancePoint[], range: PerformanceRange): ChartDisplayData {
  const windowSize = getWindowSize(range);

  if (windowSize === 1) {
    return {
      data: data.map((point) => ({
        ...point,
        axisLabel: formatAxisDate(point.date, range),
        label: formatDateLabel(point.date, range),
      })),
      note: "Daily trend data",
      summaryLabel: "Latest day",
    };
  }

  const firstWindowSize = data.length % windowSize || windowSize;
  let offset = 0;
  const windowedData = Array.from({ length: Math.ceil(data.length / windowSize) }, (_, index) => {
    const currentWindowSize = index === 0 ? firstWindowSize : windowSize;
    const window = data.slice(offset, offset + currentWindowSize);
    offset += currentWindowSize;
    const views = window.reduce((total, point) => total + getMetricValue(point, "views"), 0);
    const weightedEngagement = views > 0
      ? window.reduce(
        (total, point) => total + getMetricValue(point, "views") * getMetricValue(point, "engagement"),
        0,
      ) / views
      : 0;
    const firstPoint = window[0];
    const latestPoint = window.at(-1);

    if (!firstPoint || !latestPoint) {
      throw new Error("A chart trend window cannot be empty.");
    }

    return {
      axisLabel: formatAxisDate(firstPoint.date, range),
      date: latestPoint.date,
      views,
      followers: getMetricValue(latestPoint, "followers"),
      engagement: Number(weightedEngagement.toFixed(1)),
      label: formatDateWindow(firstPoint.date, latestPoint.date, range),
    };
  });

  const windowLabel = windowSize === 30 ? "Monthly" : windowSize === 7 ? "Weekly" : "2-day";

  return {
    data: windowedData,
    note: `${windowLabel} trend windows keep the longer view easy to explore`,
    summaryLabel: `Latest ${windowSize} days`,
  };
}

function formatMetricValue(metric: ChartMetric, value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }

  if (metric === "engagement") {
    return `${value.toFixed(1)}%`;
  }

  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatTooltipValue(metric: ChartMetric, value: number) {
  if (!Number.isFinite(value)) {
    return metric === "engagement" ? "0.0%" : "0";
  }

  if (metric === "engagement") {
    return `${value.toFixed(1)}%`;
  }

  return Math.round(value).toLocaleString("en-US");
}

function getX(index: number, count: number) {
  if (count <= 1) {
    return chartMargins.left;
  }

  return chartMargins.left + (index / (count - 1)) * innerWidth;
}

function getY(value: number, domainMin: number, domainMax: number) {
  return chartMargins.top + innerHeight - ((value - domainMin) / (domainMax - domainMin)) * innerHeight;
}

function getDomain(data: ChartPoint[], metric: ChartMetric) {
  const values = data.map((point) => getMetricValue(point, metric));
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const minimumSpread = metric === "engagement" ? 1 : Math.max(maximum * 0.08, 1);
  const spread = Math.max(maximum - minimum, minimumSpread);
  const padding = spread * 0.16;

  return {
    min: Math.max(0, minimum - padding),
    max: maximum + padding,
  };
}

function createPath(data: ChartPoint[], metric: ChartMetric, domainMin: number, domainMax: number) {
  return data.map((point, index) => {
    const command = index === 0 ? "M" : "L";
    return `${command} ${getX(index, data.length)} ${getY(getMetricValue(point, metric), domainMin, domainMax)}`;
  }).join(" ");
}

function getPointerPosition(event: PointerEvent<SVGRectElement>, count: number) {
  const svg = event.currentTarget.ownerSVGElement;
  const bounds = svg?.getBoundingClientRect();

  if (!bounds || count <= 1) {
    return 0;
  }

  const chartX = ((event.clientX - bounds.left) / bounds.width) * chartWidth;
  const progress = Math.min(1, Math.max(0, (chartX - chartMargins.left) / innerWidth));

  return progress * (count - 1);
}

function getInterpolatedValue(data: ChartPoint[], metric: ChartMetric, position: number) {
  const fallbackPoint = data[0];

  if (!fallbackPoint) {
    return 0;
  }

  const lowerIndex = Math.floor(position);
  const upperIndex = Math.min(data.length - 1, Math.ceil(position));
  const fraction = position - lowerIndex;
  const lowerValue = getMetricValue(data[lowerIndex] ?? fallbackPoint, metric);
  const upperValue = getMetricValue(data[upperIndex] ?? fallbackPoint, metric);

  return lowerValue + (upperValue - lowerValue) * fraction;
}

function getHoverLabel(data: ChartPoint[], position: number) {
  return data[Math.round(position)]?.label ?? "Unknown date";
}

function ChartTooltip({
  data,
  position,
  metric,
  label,
  domainMin,
  domainMax,
  color,
}: {
  data: ChartPoint[];
  position: number;
  metric: ChartMetric;
  label: string;
  domainMin: number;
  domainMax: number;
  color: string;
}) {
  const value = getInterpolatedValue(data, metric, position);
  const boxWidth = 154;
  const boxHeight = 48;
  const preferredLeft = getX(position, data.length) - boxWidth / 2;
  const boxLeft = Math.min(Math.max(preferredLeft, chartMargins.left), chartWidth - chartMargins.right - boxWidth);
  const pointY = getY(value, domainMin, domainMax);
  const boxTop = Math.max(chartMargins.top, pointY - boxHeight - 12);

  return (
    <g className="chart-tooltip-svg" pointerEvents="none" transform={`translate(${boxLeft}, ${boxTop})`}>
      <rect className="chart-tooltip-box" width={boxWidth} height={boxHeight} rx="8" />
      <text className="chart-tooltip-day-text" x="12" y="17">{getHoverLabel(data, position)}</text>
      <circle className="chart-tooltip-dot" cx="15" cy="34" fill={color} r="3" />
      <text className="chart-tooltip-label" x="25" y="38">{label}</text>
      <text className="chart-tooltip-value" x={boxWidth - 12} y="38" textAnchor="end">{formatTooltipValue(metric, value)}</text>
    </g>
  );
}

function MetricChart({
  data,
  metric,
  change,
  summaryLabel,
}: {
  data: ChartPoint[];
  metric: MetricDefinition;
  change: number;
  summaryLabel: string;
}) {
  const [hoveredPosition, setHoveredPosition] = useState<number | null>(null);
  const latestPoint = data.at(-1);

  if (!latestPoint) {
    return null;
  }

  const domain = getDomain(data, metric.key);
  const ticks = Array.from({ length: 4 }, (_, index) => domain.min + ((3 - index) / 3) * (domain.max - domain.min));
  const MetricIcon = metric.icon;
  const labelStep = data.length > 7 ? Math.ceil((data.length - 1) / 5) : 1;
  const activePosition = hoveredPosition ?? data.length - 1;
  const activeValue = getInterpolatedValue(data, metric.key, activePosition);

  function handleKeyDown(event: KeyboardEvent<SVGRectElement>) {
    const currentIndex = Math.round(hoveredPosition ?? data.length - 1);
    let nextIndex = currentIndex;

    if (event.key === "ArrowLeft") {
      nextIndex = Math.max(0, currentIndex - 1);
    } else if (event.key === "ArrowRight") {
      nextIndex = Math.min(data.length - 1, currentIndex + 1);
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = data.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    setHoveredPosition(nextIndex);
  }

  return (
    <article className={`metric-chart metric-chart-${metric.key}`}>
      <div className="metric-chart-header">
        <div className="metric-chart-heading">
          <span className="metric-chart-icon" style={{ color: metric.color }} aria-hidden="true">
            <MetricIcon size={17} />
          </span>
          <div>
            <h3>{metric.label}</h3>
            <p>{metric.description}</p>
          </div>
        </div>
        <div className="metric-chart-summary">
          <strong>{formatMetricValue(metric.key, getMetricValue(latestPoint, metric.key))}</strong>
          <span>{summaryLabel} · {formatMetricChange(change)} vs. prior period</span>
        </div>
      </div>

      <div className="metric-chart-canvas">
        <svg className="performance-chart-svg" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="group" aria-label={`${metric.label} chart`}>
          {ticks.map((tick) => {
            const y = getY(tick, domain.min, domain.max);

            return (
              <g key={tick}>
                <line className="chart-grid-line" x1={chartMargins.left} x2={chartWidth - chartMargins.right} y1={y} y2={y} />
                <text className="chart-axis-label" x={chartMargins.left - 10} y={y + 4} textAnchor="end">{formatMetricValue(metric.key, tick)}</text>
              </g>
            );
          })}

          <path className="chart-line" d={createPath(data, metric.key, domain.min, domain.max)} fill="none" stroke={metric.color} />

          {hoveredPosition !== null && (
            <>
              <line
                className="chart-hover-guide"
                x1={getX(hoveredPosition, data.length)}
                x2={getX(hoveredPosition, data.length)}
                y1={chartMargins.top}
                y2={chartMargins.top + innerHeight}
              />
              <circle
                className="chart-point"
                cx={getX(hoveredPosition, data.length)}
                cy={getY(getInterpolatedValue(data, metric.key, hoveredPosition), domain.min, domain.max)}
                fill="var(--panel)"
                r="5"
                stroke={metric.color}
              />
            </>
          )}

          <rect
            aria-label={`${metric.label}. Use left and right arrow keys to explore the trend.`}
            aria-valuemax={data.length - 1}
            aria-valuemin={0}
            aria-valuenow={activePosition}
            aria-valuetext={`${getHoverLabel(data, activePosition)}: ${formatTooltipValue(metric.key, activeValue)}`}
            className="chart-hover-target"
            height={innerHeight}
            onBlur={() => setHoveredPosition(null)}
            onFocus={() => setHoveredPosition((current) => current ?? data.length - 1)}
            onKeyDown={handleKeyDown}
            onPointerLeave={() => setHoveredPosition(null)}
            onPointerMove={(event) => setHoveredPosition(getPointerPosition(event, data.length))}
            role="slider"
            tabIndex={0}
            width={innerWidth}
            x={chartMargins.left}
            y={chartMargins.top}
          />

          {data.map((point, index) => (
            (index === 0 || index === data.length - 1 || index % labelStep === 0) && (
              <text className="chart-day-label" key={`day-${metric.key}-${point.date}`} x={getX(index, data.length)} y={chartHeight - 7} textAnchor="middle">
                {point.axisLabel}
              </text>
            )
          ))}

          {hoveredPosition !== null && (
            <ChartTooltip
              color={metric.color}
              data={data}
              domainMax={domain.max}
              domainMin={domain.min}
              label={metric.label.replace(" over time", "")}
              metric={metric.key}
              position={hoveredPosition}
            />
          )}
        </svg>
      </div>
    </article>
  );
}

export function PerformanceChart({ data, range, changes }: PerformanceChartProps) {
  const [visibleMetrics, setVisibleMetrics] = useState<Record<ChartMetric, boolean>>(defaultVisibleMetrics);
  const visibleDefinitions = metricDefinitions.filter((metric) => visibleMetrics[metric.key]);
  const displayData = createChartDisplayData(data, range);

  function toggleMetric(metric: ChartMetric) {
    setVisibleMetrics((current) => ({ ...current, [metric]: !current[metric] }));
  }

  return (
    <div className="performance-module">
      <div className="performance-toolbar">
        <div>
          <p className="chart-control-label">Performance trends</p>
          <p className="performance-toolbar-note">{performanceRangeLabels[range]} · {displayData.note.toLowerCase()} · each metric uses its own scale.</p>
        </div>
      </div>

      <div className="metric-visibility" role="group" aria-label="Show or hide metric charts">
        <span className="metric-visibility-label">Show charts</span>
        {metricDefinitions.map((metric) => {
          const isVisible = visibleMetrics[metric.key];

          return (
            <button
              aria-pressed={isVisible}
              className={isVisible ? "metric-visibility-button metric-visibility-button-active" : "metric-visibility-button"}
              key={metric.key}
              onClick={() => toggleMetric(metric.key)}
              type="button"
            >
              <span className="metric-visibility-dot" style={{ background: metric.color }} aria-hidden="true" />
              <span>{metric.label.replace(" over time", "")}</span>
              <span className={`chart-switch ${isVisible ? "chart-switch-on" : ""}`} aria-hidden="true"><span /></span>
            </button>
          );
        })}
      </div>

      {displayData.data.length === 0 ? (
        <div className="metric-chart-empty" role="status">
          <strong>No performance data</strong>
          <span>There is no analytics history available for this period yet.</span>
        </div>
      ) : (
        <div className="metric-chart-list">
          {visibleDefinitions.map((metric) => (
            <MetricChart
              change={changes[metric.key]}
              data={displayData.data}
              key={metric.key}
              metric={metric}
              summaryLabel={displayData.summaryLabel}
            />
          ))}
          {visibleDefinitions.length === 0 && (
            <div className="metric-chart-empty">
              <strong>No charts selected</strong>
              <span>Turn on a metric above to view its trend.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
