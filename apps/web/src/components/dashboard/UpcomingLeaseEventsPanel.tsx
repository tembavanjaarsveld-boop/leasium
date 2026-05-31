"use client";

import { CalendarClock } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

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

// Lightweight date buckets (B3). Purely presentational: groups the
// existing, already-sorted events under quiet headers by each event's
// own due date. Ordering within a bucket is unchanged.
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
const COLLAPSED_EVENT_LIMIT = 5;
const EMPTY_LEASE_EVENTS: LeaseEventRecord[] = [];

function daysUntil(date: string | null) {
  if (!date) {
    return null;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${date.slice(0, 10)}T00:00:00`);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

function dateBucketFor(date: string | null): DateBucketKey {
  const diffDays = daysUntil(date);
  if (diffDays === null) {
    return "later";
  }
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

function leaseEventUrgencyLabel(event: LeaseEventRecord) {
  const diffDays = daysUntil(event.date);
  if (diffDays === null) {
    return event.chip;
  }
  if (diffDays < 0) {
    return `${Math.abs(diffDays)}d overdue`;
  }
  if (diffDays === 0) {
    return "Due today";
  }
  if (diffDays === 1) {
    return "Due tomorrow";
  }
  if (diffDays <= 7) {
    return `Due in ${diffDays}d`;
  }
  return event.chip;
}

function leaseEventUrgencyTone(event: LeaseEventRecord): StatusTone {
  const diffDays = daysUntil(event.date);
  if (diffDays !== null && diffDays < 0) {
    return "danger";
  }
  if (diffDays !== null && diffDays <= 7) {
    return "warning";
  }
  return "neutral";
}

export function UpcomingLeaseEventsPanel({
  overview,
  isLoading,
}: {
  overview: InsightsOverviewRecord | undefined;
  isLoading: boolean;
}) {
  const snapshot = overview?.lease_event_snapshot;
  const events = snapshot?.next_events ?? EMPTY_LEASE_EVENTS;
  const [expanded, setExpanded] = useState(false);
  const visibleEvents = useMemo(
    () =>
      expanded || events.length <= COLLAPSED_EVENT_LIMIT
        ? events
        : events.slice(0, COLLAPSED_EVENT_LIMIT),
    [events, expanded],
  );
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
            Preparing upcoming events.
          </div>
        ) : events.length === 0 ? (
          <div className="rounded-md border border-border bg-muted/25 p-3 text-sm text-muted-foreground">
            Nothing in the next 120 days. New expiries or reviews will appear
            here as they are entered.
          </div>
        ) : (
          <>
            {DATE_BUCKET_ORDER.map((bucket) => {
              const bucketEvents = visibleEvents.filter(
                (event) => dateBucketFor(event.date) === bucket,
              );
              if (bucketEvents.length === 0) {
                return null;
              }
              return (
                <div key={bucket} className="grid gap-2">
                  <div className="px-0.5 text-leasium-micro font-semibold uppercase tracking-wide text-muted-foreground">
                    {DATE_BUCKET_LABEL[bucket]}
                  </div>
                  {bucketEvents.map((event) => (
                    <Link
                      key={event.id}
                      href={event.href || "/properties"}
                      className="animate-leasium-row-in grid gap-1 rounded-md border border-border bg-white p-3 text-sm transition duration-200 ease-leasium hover:bg-muted/40"
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
                        <StatusBadge tone={leaseEventUrgencyTone(event)}>
                          {leaseEventUrgencyLabel(event)}
                        </StatusBadge>
                      </div>
                    </Link>
                  ))}
                </div>
              );
            })}
            {events.length > COLLAPSED_EVENT_LIMIT ? (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="mt-1 inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-white px-3 text-sm font-medium text-muted-foreground transition duration-200 ease-leasium hover:bg-muted hover:text-foreground"
              >
                {expanded ? "Show fewer" : `Show all ${events.length}`}
              </button>
            ) : null}
          </>
        )}
      </div>
    </SectionPanel>
  );
}
