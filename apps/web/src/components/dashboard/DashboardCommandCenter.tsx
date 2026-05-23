"use client";

import { CheckCircle2, ClipboardList, Link2, Loader2 } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

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
  const summaryRows = [
    {
      label: "Smart Intake",
      count: counts.intake,
      detail: "Reviews and failed reads",
      href: "/intake",
      tone: counts.intake ? ("primary" as const) : ("success" as const),
    },
    {
      label: "Billing",
      count: counts.billing,
      detail: "Readiness blockers",
      href: "/billing-readiness",
      tone: counts.billing ? ("danger" as const) : ("success" as const),
    },
    {
      label: "Onboarding",
      count: counts.onboarding,
      detail: "Submitted or due",
      href: "/tenants",
      tone: counts.onboarding ? ("primary" as const) : ("success" as const),
    },
    {
      label: "Operations",
      count: counts.operations,
      detail: "Urgent key dates",
      href: "/operations",
      tone: counts.operations ? ("warning" as const) : ("success" as const),
    },
  ];

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
            ? "Loading…"
            : refreshing
              ? "Refreshing…"
              : totalCount
                ? "Act today"
                : "Clear"}
        </StatusBadge>
      }
      className="border-primary/20"
    >
      <div className="grid lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="divide-y divide-border lg:border-r lg:border-border">
          {loading && shownItems.length === 0 ? (
            <EmptyState
              icon={<Loader2 size={18} className="animate-spin" />}
              title="Loading today's command center."
              description="Checking Smart Intake, billing readiness, onboarding, and key dates."
            />
          ) : shownItems.length ? (
            shownItems.map((item, index) => (
              <Link
                key={item.id}
                href={item.href}
                className={[
                  "group grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-3 gap-y-3 px-4 py-4 transition hover:bg-muted/55 md:grid-cols-[3.25rem_minmax(0,1fr)_auto] md:items-center",
                  index === 0 ? "bg-primary-soft/35" : "",
                ].join(" ")}
              >
                <div className="flex justify-center self-center">
                  <span className="inline-flex h-8 min-w-10 items-center justify-center rounded-full border border-border bg-white px-2 text-xs font-semibold text-muted-foreground shadow-leasiumXs transition group-hover:border-primary/30 group-hover:text-primary">
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
                    <span className="min-w-0 truncate">{item.dateLabel}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
                    {item.why}
                  </p>
                </div>
                <div className="col-start-2 flex min-w-0 items-center gap-2 md:col-start-auto md:justify-end md:self-center">
                  <span className="truncate text-sm font-medium text-primary md:whitespace-nowrap">
                    {item.nextStep}
                  </span>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-white text-primary transition group-hover:border-primary/35 group-hover:bg-primary group-hover:text-white">
                    <Link2 size={15} />
                  </span>
                </div>
              </Link>
            ))
          ) : (
            <EmptyState
              icon={<CheckCircle2 size={18} />}
              title="No operator actions need attention."
              description="Smart Intake, billing readiness, onboarding, and urgent dates are clear for now."
            />
          )}
        </div>
        <aside className="grid content-start gap-4 p-4">
          <div className="rounded-xl bg-primary-soft px-3 py-3 text-sm text-primary-hover">
            <div className="font-semibold">Review-first guardrail</div>
            <p className="mt-1 leading-5">
              Smart Intake is the gate. This surface routes work only; applying
              stays inside reviewed workflows.
            </p>
          </div>
          <div className="grid gap-3">
            {summaryRows.map((row) => (
              <Link
                key={row.label}
                href={row.href}
                className="flex items-center justify-between gap-3 border-b border-border pb-3 text-sm transition last:border-b-0 last:pb-0 hover:text-primary"
              >
                <span>
                  <span className="block font-semibold">{row.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {row.detail}
                  </span>
                </span>
                <StatusBadge tone={row.tone}>
                  {loading && row.count === 0 ? "..." : row.count}
                </StatusBadge>
              </Link>
            ))}
          </div>
        </aside>
      </div>
    </SectionPanel>
  );
}
