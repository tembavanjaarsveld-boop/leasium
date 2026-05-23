"use client";

import { CalendarClock } from "lucide-react";
import Link from "next/link";

import {
  SectionPanel,
  StatusBadge,
  type StatusTone,
} from "@/components/ui";
import type {
  InsightsOverviewRecord,
  LeaseEventRecord,
} from "@/lib/api";

/**
 * UpcomingLeaseEventsPanel — read-only summary of the next 120 days of
 * lease expiries, rent reviews, obligations, and tenant onboarding
 * follow-ups on the Dashboard. Reads from the existing
 * `/api/v1/insights/overview` payload (`lease_event_snapshot.next_events`).
 * Each row deep-links into the relevant property/lease record.
 *
 * Extracted from the monolithic dashboard.tsx per
 * `docs/external-design-review-2026-05-23.md` §1.2 (page-file size
 * policy). Pending Remba review.
 */

function leaseEventKindLabel(kind: LeaseEventRecord["kind"]) {
  switch (kind) {
    case "rent_review":
      return "Rent review";
    case "lease_expiry":
      return "Lease expiry";
    case "obligation":
      return "Obligation";
    case "tenant_onboarding":
      return "Onboarding follow-up";
    default:
      return "Event";
  }
}

function leaseEventKindTone(kind: LeaseEventRecord["kind"]): StatusTone {
  switch (kind) {
    case "lease_expiry":
      return "danger";
    case "rent_review":
      return "warning";
    case "tenant_onboarding":
      return "primary";
    default:
      return "neutral";
  }
}

export function UpcomingLeaseEventsPanel({
  overview,
  isLoading,
}: {
  overview: InsightsOverviewRecord | undefined;
  isLoading: boolean;
}) {
  const snapshot = overview?.lease_event_snapshot;
  const events = snapshot?.next_events ?? [];
  const summaryParts: string[] = [];
  if (snapshot) {
    if (snapshot.next_expiry_count > 0) {
      summaryParts.push(`${snapshot.next_expiry_count} expiries`);
    }
    if (snapshot.next_review_count > 0) {
      summaryParts.push(`${snapshot.next_review_count} reviews`);
    }
    if (snapshot.overdue_obligation_count > 0) {
      summaryParts.push(`${snapshot.overdue_obligation_count} overdue`);
    }
    if (snapshot.due_soon_obligation_count > 0) {
      summaryParts.push(`${snapshot.due_soon_obligation_count} due soon`);
    }
    if (snapshot.tenant_onboarding_waiting_count > 0) {
      summaryParts.push(
        `${snapshot.tenant_onboarding_waiting_count} onboarding`,
      );
    }
  }
  return (
    <SectionPanel
      title="Upcoming lease events"
      description={
        summaryParts.length
          ? `Next 120 days · ${summaryParts.join(" · ")}.`
          : "Lease expiries, rent reviews, and obligations due in the next 120 days appear here."
      }
      icon={<CalendarClock size={17} className="text-primary" />}
      actions={
        snapshot ? (
          <StatusBadge tone={events.length ? "warning" : "success"}>
            {events.length ? `${events.length} upcoming` : "All clear"}
          </StatusBadge>
        ) : null
      }
    >
      <div className="grid gap-2 p-4">
        {isLoading && !overview ? (
          <div className="rounded-md border border-border bg-muted/25 p-3 text-sm text-muted-foreground">
            Loading upcoming events.
          </div>
        ) : events.length === 0 ? (
          <div className="rounded-md border border-border bg-muted/25 p-3 text-sm text-muted-foreground">
            Nothing in the next 120 days. New expiries or reviews will appear
            here as they are entered.
          </div>
        ) : (
          events.map((event) => (
            <Link
              key={event.id}
              href={event.href || "/properties"}
              className="grid gap-1 rounded-md border border-border bg-white p-3 text-sm transition hover:bg-muted/40"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={leaseEventKindTone(event.kind)}>
                    {leaseEventKindLabel(event.kind)}
                  </StatusBadge>
                  <span className="font-medium text-foreground">
                    {event.title}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {event.chip}
                </span>
              </div>
            </Link>
          ))
        )}
      </div>
    </SectionPanel>
  );
}
