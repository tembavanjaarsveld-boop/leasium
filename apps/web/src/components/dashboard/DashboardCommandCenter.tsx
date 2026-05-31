"use client";

import {
  CheckCircle2,
  ClipboardList,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import type { KeyboardEvent, ReactNode } from "react";

import {
  EmptyState,
  SectionPanel,
  StatusBadge,
  type StatusTone,
} from "@/components/ui";

/**
 * DashboardCommandCenter — the daily first-viewport "what needs me
 * today" surface on the operator dashboard. Pure rendering: takes a
 * ranked, pre-sorted list of operator actions plus per-area counts,
 * and displays the top six items + a category summary aside.
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
 * policy). Pending Remba review.
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

// Lightweight date buckets (B3). Purely presentational: groups the
// already-ranked items under quiet headers by each item's own due
// date. Item order (and the #N rank badge) within a bucket is
// unchanged — items without a date fall into "Later".
type DateBucketKey = "overdue" | "today" | "week" | "later";

const DATE_BUCKET_LABEL: Record<DateBucketKey, string> = {
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  later: "Later",
};

const DATE_BUCKET_ORDER: DateBucketKey[] = [
  "overdue",
  "today",
  "week",
  "later",
];

function dateBucketFor(date: string | null): DateBucketKey {
  if (!date) {
    return "later";
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${date.slice(0, 10)}T00:00:00`);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (diffDays < 0) {
    return "overdue";
  }
  if (diffDays === 0) {
    return "today";
  }
  if (diffDays <= 7) {
    return "week";
  }
  return "later";
}

export function DashboardCommandCenter({
  items,
  loading,
  refreshing,
  counts,
}: {
  items: CommandCenterItem[];
  loading: boolean;
  refreshing: boolean;
  counts: CommandCenterCounts;
}) {
  const shownItems = items.slice(0, 6);
  const totalCount =
    counts.intake + counts.billing + counts.onboarding + counts.operations;

  // Keyboard flow (Phase D): once focus is inside the ranked list, j / ArrowDown
  // and k / ArrowUp move between rows; Enter activates the focused row natively
  // (each row is an anchor). The handler lives on the list container, so it only
  // fires when a row already has focus — it never hijacks global keystrokes, and
  // Tab / click behaviour is unchanged.
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
    <SectionPanel
      title="Daily command center"
      description="Ranked operator actions across reviews, billing, onboarding, and key dates."
      icon={<ClipboardList size={17} className="text-primary" />}
      actions={
        <StatusBadge
          tone={
            loading
              ? "neutral"
              : totalCount
                ? (shownItems[0]?.tone ?? "warning")
                : "success"
          }
        >
          {loading
            ? "Checking"
            : refreshing
              ? "Updating"
              : totalCount
                ? "Act today"
                : "Clear"}
        </StatusBadge>
      }
      className="border-primary/20"
    >
      <div>
        <div className="divide-y divide-border" onKeyDown={handleListKeyDown}>
          {loading && shownItems.length === 0 ? (
            <EmptyState
              icon={<Loader2 size={18} className="animate-spin" />}
              title="Preparing today's command center"
              description="Checking review queues, billing readiness, onboarding, and key dates."
            />
          ) : shownItems.length ? (
            DATE_BUCKET_ORDER.flatMap((bucket) => {
              const bucketItems = shownItems
                .map((item, index) => ({ item, index }))
                .filter(({ item }) => dateBucketFor(item.date) === bucket);
              if (bucketItems.length === 0) {
                return [];
              }
              return [
                <div
                  key={`cc-bucket-${bucket}`}
                  className="bg-muted/30 px-4 py-1.5 text-leasium-micro font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {DATE_BUCKET_LABEL[bucket]}
                </div>,
                ...bucketItems.map(({ item, index }) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    data-cc-row
                    className={[
                      "group grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-3 gap-y-3 px-4 py-4 transition duration-200 ease-leasium hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 md:grid-cols-[3.25rem_minmax(0,1fr)_auto] md:items-center",
                      index === 0 ? "bg-primary-soft/35" : "",
                    ].join(" ")}
                  >
                    <div className="flex justify-center self-center">
                      <span className="inline-flex h-8 min-w-10 items-center justify-center rounded-full border border-border bg-white px-2 text-xs font-semibold text-muted-foreground shadow-leasiumXs transition duration-200 ease-leasium group-hover:border-primary/30 group-hover:text-primary">
                        #{index + 1}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div className="line-clamp-2 text-leasium-body-compact font-medium leading-5 text-foreground">
                        {item.title}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-4 text-muted-foreground">
                        <StatusBadge tone={item.tone}>{item.chip}</StatusBadge>
                        <span>{item.area}</span>
                        <span
                          aria-hidden="true"
                          className="hidden h-1 w-1 rounded-full bg-border sm:inline-block"
                        />
                        <span className="min-w-0 truncate">
                          {item.dateLabel}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
                        {item.why}
                      </p>
                    </div>
                    <div className="col-start-2 flex min-w-0 items-center gap-2 md:col-start-auto md:justify-end md:self-center">
                      <span className="truncate text-sm font-medium text-primary md:whitespace-nowrap">
                        {item.nextStep}
                      </span>
                    </div>
                  </Link>
                )),
              ];
            })
          ) : (
            <EmptyState
              icon={<CheckCircle2 size={18} />}
              title="No operator actions need attention."
              description="Smart Intake, billing readiness, onboarding, and urgent dates are clear for now."
            />
          )}
        </div>
        <div className="flex items-start gap-2 border-t border-border bg-primary-soft/40 px-4 py-2.5 text-xs leading-5 text-primary-hover">
          <ShieldCheck
            size={14}
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <span>
            <span className="font-semibold">Review-first.</span> This surface
            points to the next safe step; changes still stay inside reviewed
            workflows.
          </span>
        </div>
      </div>
    </SectionPanel>
  );
}
