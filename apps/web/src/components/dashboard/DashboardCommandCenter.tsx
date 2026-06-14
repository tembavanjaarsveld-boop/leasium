"use client";

import {
  ArrowRight,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import type { KeyboardEvent, ReactNode } from "react";

import { StatusBadge, type StatusTone } from "@/components/ui";

/**
 * DashboardCommandCenter — the daily first-viewport "what needs me
 * today" surface on the operator dashboard. Pure rendering: takes a
 * ranked, pre-sorted list of operator actions plus per-area counts,
 * and renders the highest-value action as the Horizon focus hero.
 *
 * The parent Dashboard owns the work of BUILDING the items list and
 * counts (combining Smart Intake reviews, billing blockers, onboarding
 * follow-ups, and urgent obligations into a single ranked list) and
 * the SORTING (via `commandCenterSort`, which still lives in
 * dashboard.tsx because it leans on the parent's local date helpers).
 *
 * Per SoT §10.5.6, the dashboard order is fixed and this command
 * center sits first. This is action-routing only — no record mutation.
 *
 * Extracted from the monolithic dashboard.tsx per
 * `docs/external-design-review-2026-05-23.md` §1.2 (page-file size
 * policy).
 */

export type CommandCenterItem = {
  id: string;
  area: string;
  title: string;
  why: string;
  href: string;
  nextStep: string;
  chip: string;
  tone: StatusTone;
  score: number;
  date: string | null;
  dateLabel: string;
  icon: ReactNode;
};

export type CommandCenterCounts = {
  intake: number;
  billing: number;
  onboarding: number;
  operations: number;
};

export function DashboardCommandCenter({
  items,
  loading,
  refreshing,
  counts,
  actions,
}: {
  items: CommandCenterItem[];
  loading: boolean;
  refreshing: boolean;
  counts: CommandCenterCounts;
  actions?: ReactNode;
}) {
  const visibleItems = items.slice(0, 3);
  const primaryItem = visibleItems[0] ?? null;
  const nextItems = visibleItems.slice(1);
  const totalCount =
    counts.intake + counts.billing + counts.onboarding + counts.operations;
  const focusTotal = Math.max(visibleItems.length, 1);

  // Keyboard flow (Phase D): once focus is inside the compact next-up links,
  // j / ArrowDown and k / ArrowUp move between rows; Enter activates the
  // focused row natively (each row is an anchor). The handler lives on the
  // list container, so it only fires when a row already has focus — it never
  // hijacks global keystrokes, and Tab / click behaviour is unchanged.
  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["j", "k", "ArrowDown", "ArrowUp"].includes(event.key)) {
      return;
    }
    const rows = Array.from(
      event.currentTarget.querySelectorAll<HTMLAnchorElement>("[data-cc-row]"),
    );
    if (rows.length === 0) {
      return;
    }
    event.preventDefault();
    const current = rows.findIndex((row) => row === document.activeElement);
    const forward = event.key === "j" || event.key === "ArrowDown";
    const next =
      current < 0
        ? 0
        : forward
          ? Math.min(current + 1, rows.length - 1)
          : Math.max(current - 1, 0);
    rows[next]?.focus();
    rows[next]?.scrollIntoView({ block: "nearest" });
  }

  return (
    <section
      className="overflow-hidden rounded-[18px] border border-primary/15 bg-gradient-to-r from-leasium-hero-wash-from to-leasium-hero-wash-to shadow-[0_1px_3px_rgba(16,24,40,0.04)] sm:rounded-[20px]"
      aria-label="Today's focus"
      aria-describedby="dashboard-focus-counts"
    >
      <p id="dashboard-focus-counts" className="sr-only">
        Today&apos;s focus is ranked from {totalCount} open items across Smart
        Intake, billing, onboarding, and operations.
      </p>
      <div className="grid gap-3 p-3 sm:gap-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        {loading && !primaryItem ? (
          <div className="grid gap-3">
            <h2 className="text-leasium-micro font-semibold uppercase tracking-[0.04em] text-primary">
              Today&apos;s focus
            </h2>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 size={18} className="animate-spin text-primary" />
              <span>Preparing today&apos;s focus.</span>
            </div>
          </div>
        ) : primaryItem ? (
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <h2 className="inline-flex min-h-6 items-center rounded-full bg-primary-soft px-2.5 text-leasium-micro font-semibold uppercase tracking-[0.04em] text-primary">
                Today&apos;s focus
              </h2>
              <StatusBadge tone={primaryItem.tone}>{primaryItem.chip}</StatusBadge>
              <StatusBadge tone="neutral" className="hidden sm:inline-flex">
                {primaryItem.dateLabel}
              </StatusBadge>
            </div>
            <h3 className="mt-2 text-[15px] font-bold leading-6 tracking-normal text-foreground sm:mt-3 sm:text-2xl sm:leading-8">
              {primaryItem.title}
            </h3>
            <p className="mt-1 line-clamp-1 max-w-3xl text-xs leading-4 text-muted-foreground sm:line-clamp-none sm:leading-5 sm:text-sm">
              {primaryItem.why}
            </p>
            {nextItems.length ? (
              <div
                className="mt-3 hidden flex-wrap gap-2 text-[11px] leading-4 text-muted-foreground sm:flex"
                onKeyDown={handleListKeyDown}
              >
                {nextItems.map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    data-cc-row
                    aria-label={`Next: ${item.area} - ${item.title}. ${item.nextStep}`}
                    className="rounded-full border border-white/70 bg-white/65 px-3 py-1.5 font-medium transition duration-200 ease-leasium hover:border-primary/30 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    Next: {item.area}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/70 text-primary shadow-leasiumXs">
              <CheckCircle2 size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="text-leasium-micro font-semibold uppercase tracking-[0.04em] text-primary">
                Today&apos;s focus
              </h2>
              <p className="mt-1 text-lg font-bold leading-6 tracking-normal text-foreground">
                Portfolio clear right now.
              </p>
              <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
                Smart Intake, billing readiness, onboarding, and urgent dates
                are clear for now.
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 lg:flex-col lg:items-end">
          {primaryItem ? (
            <div className="flex w-full flex-wrap items-center gap-3 lg:w-auto lg:justify-end">
              <div className="hidden h-16 w-16 place-items-center rounded-full border-[6px] border-primary/15 bg-white/80 text-center shadow-leasiumXs sm:grid">
                <div className="text-xs font-bold leading-none text-foreground">
                  1/{focusTotal}
                </div>
              </div>
              <Link
                href={primaryItem.href}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[0_4px_12px_rgba(36,91,255,0.32)] transition duration-200 ease-leasium hover:bg-primary-hover active:scale-[0.98] sm:w-auto"
              >
                {primaryItem.nextStep}
                <ArrowRight size={15} />
              </Link>
            </div>
          ) : null}
          {actions ? (
            <div className="hidden flex-wrap items-center gap-2 sm:flex lg:justify-end">
              {actions}
            </div>
          ) : null}
          {refreshing && !loading ? (
            <StatusBadge tone="neutral">Updating</StatusBadge>
          ) : null}
        </div>
      </div>

    </section>
  );
}
