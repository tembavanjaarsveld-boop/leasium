"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { StatusBadge, type StatusTone } from "@/components/ui";

/**
 * DashboardMetricCard — one operational metric tile on the Dashboard
 * metric strip. Renders count + chip + "next action" copy + optional
 * 7-day sparkline trend. The metric strip is capped at 4 cards per SoT
 * §10.5.6; this card is the per-cell component.
 *
 * `computeOpenObligationTrend` ships alongside the card so callers that
 * pass a trend prop don't have to keep reimplementing the same 7-day
 * roll-up. Other trend helpers can land in this file as they're built.
 *
 * Extracted from the monolithic dashboard.tsx per
 * `docs/external-design-review-2026-05-23.md` §1.2 (page-file size
 * policy). Pending Remba review.
 */

export type DashboardMetricTrend = {
  delta: number;
  series: number[];
  /**
   * "lower-better" means a negative delta is rendered with success styling
   * (used for things like open urgent obligations).
   */
  direction?: "higher-better" | "lower-better";
  label?: string;
};

/**
 * SVG `stroke` props can't take Tailwind classes, so sparkline colours
 * are pinned to the Codex SoT hex values. Keep these in sync with
 * §3 (Brand palette / Neutral palette / Semantic colours) and
 * tailwind.config.ts. If you find yourself duplicating this map in
 * another SVG-based chart, lift it into a shared module.
 */
const SPARKLINE_STROKE = {
  // Codex slate.300 — neutral / no-change.
  neutral: "#98A2B3",
  // Codex success.
  positive: "#12B76A",
  // Codex danger.
  negative: "#F04438",
} as const;

function MetricSparkline({
  series,
  direction = "higher-better",
  delta,
}: {
  series: number[];
  direction?: "higher-better" | "lower-better";
  delta: number;
}) {
  if (!series.length) return null;
  const width = 72;
  const height = 22;
  const padding = 1;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const stepX = series.length > 1 ? (width - padding * 2) / (series.length - 1) : 0;
  const points = series.map((value, index) => {
    const x = padding + index * stepX;
    const y =
      padding + (height - padding * 2) * (1 - (value - min) / range);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const stroke =
    delta === 0
      ? SPARKLINE_STROKE.neutral
      : (direction === "higher-better" ? delta > 0 : delta < 0)
        ? SPARKLINE_STROKE.positive
        : SPARKLINE_STROKE.negative;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="presentation"
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points.join(" ")}
      />
    </svg>
  );
}

function MetricDeltaBadge({
  delta,
  direction = "higher-better",
  label,
}: {
  delta: number;
  direction?: "higher-better" | "lower-better";
  label?: string;
}) {
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-leasium-micro font-semibold text-muted-foreground">
        <span>·</span>
        <span>{label ?? "No change"}</span>
      </span>
    );
  }
  const isPositive =
    direction === "higher-better" ? delta > 0 : delta < 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-leasium-micro font-semibold ${
        isPositive ? "text-success-strong" : "text-danger-strong"
      }`}
    >
      <span aria-hidden="true">{delta > 0 ? "↑" : "↓"}</span>
      <span>
        {Math.abs(delta)}
        {label ? ` ${label}` : ""}
      </span>
    </span>
  );
}

export function DashboardMetricCard({
  href,
  label,
  count,
  chip,
  tone,
  nextAction,
  icon,
  trend,
}: {
  href: string;
  label: string;
  count: number | string;
  chip: string;
  tone: StatusTone;
  nextAction: string;
  icon: ReactNode;
  trend?: DashboardMetricTrend | null;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-border bg-white p-4 shadow-leasiumCard transition duration-200 ease-leasium hover:border-primary/40 hover:shadow-leasiumMd"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-muted-foreground">
          {label}
        </span>
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary-soft text-primary transition group-hover:bg-primary group-hover:text-white">
          {icon}
        </span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="text-3xl font-semibold tracking-normal">{count}</div>
        <StatusBadge tone={tone}>{chip}</StatusBadge>
      </div>
      {/* A zero delta renders a dangling "· vs last week" next to a flat
          sparkline; only show the trend row when something actually moved. */}
      {trend && trend.delta !== 0 ? (
        <div className="mt-2 flex items-center justify-between gap-2">
          <MetricDeltaBadge
            delta={trend.delta}
            direction={trend.direction}
            label={trend.label}
          />
          <MetricSparkline
            series={trend.series}
            direction={trend.direction}
            delta={trend.delta}
          />
        </div>
      ) : null}
      <p className="mt-3 min-h-10 text-sm leading-5 text-muted-foreground">
        {nextAction}
      </p>
    </Link>
  );
}

/**
 * Roll up the last 7 days of open-obligation counts into a
 * DashboardMetricTrend ready to pass to the Operations metric card.
 * Records are an iterable of `{ due_date, completed_at, status }` rows
 * — typically the `obligationsQuery.data` from the dashboard parent.
 */
export function computeOpenObligationTrend({
  records,
}: {
  records: ReadonlyArray<{
    due_date: string;
    completed_at: string | null;
    status: string;
  }> | null;
}): DashboardMetricTrend | null {
  if (!records) return null;
  const now = new Date();
  const startOfTodayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).getTime();
  const series: number[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const asOf = startOfTodayUtc + (1 - i) * 86_400_000;
    const count = records.reduce((acc, row) => {
      const due = Date.parse(row.due_date);
      if (Number.isNaN(due) || due > asOf) return acc;
      if (row.completed_at) {
        const completedAt = Date.parse(row.completed_at);
        if (!Number.isNaN(completedAt) && completedAt <= asOf) return acc;
      }
      if (["completed", "waived"].includes(row.status)) return acc;
      return acc + 1;
    }, 0);
    series.push(count);
  }
  const delta = series[series.length - 1] - series[0];
  return {
    delta,
    series,
    // Fewer open obligations is better.
    direction: "lower-better",
    label: "vs last week",
  };
}
