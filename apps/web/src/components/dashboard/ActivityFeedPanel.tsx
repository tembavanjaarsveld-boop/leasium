"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, Loader2 } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import {
  SectionPanel,
  StatusBadge,
  type StatusTone,
} from "@/components/ui";
import {
  listActivityFeed,
  type ActivityActionKind,
  type ActivityFeedItemRecord,
} from "@/lib/api";
import { friendlyError } from "@/lib/utils";

/**
 * Recent activity feed — read-only audit-log projection on the operator
 * dashboard. Backend `/api/v1/activity-feed` (Tier 2 (f) v1) projects
 * the append-only `audit_action` rows for the entity into a
 * presentation-friendly shape with deep-links into the source record.
 * Grouped by Today / Yesterday / Earlier this week / Older, refetched
 * every 60s in the background.
 *
 * Extracted from the monolithic dashboard.tsx per
 * `docs/external-design-review-2026-05-23.md` §1.2 (page-file size
 * policy). Pending Remba review.
 */

const ACTIVITY_KIND_TONE: Record<ActivityActionKind, StatusTone> = {
  create: "primary",
  update: "neutral",
  apply: "primary",
  review: "primary",
  approve: "success",
  deliver: "success",
  remind: "warning",
  revoke: "danger",
  query: "neutral",
  delete: "danger",
  other: "neutral",
};

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function activityTimeBucket(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "Earlier";
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 6);
  if (then >= startOfToday) return "Today";
  if (then >= startOfYesterday) return "Yesterday";
  if (then >= startOfWeek) return "Earlier this week";
  return "Older";
}

export function ActivityFeedPanel({ entityId }: { entityId: string }) {
  const feedQuery = useQuery({
    queryKey: ["dashboard-activity-feed", entityId],
    queryFn: () => listActivityFeed(entityId, 30),
    enabled: Boolean(entityId),
    refetchInterval: 60000,
  });

  const grouped = useMemo(() => {
    const items = feedQuery.data?.items ?? [];
    const order = ["Today", "Yesterday", "Earlier this week", "Older"];
    const buckets = new Map<string, ActivityFeedItemRecord[]>();
    for (const item of items) {
      const key = activityTimeBucket(item.occurred_at);
      const list = buckets.get(key);
      if (list) {
        list.push(item);
      } else {
        buckets.set(key, [item]);
      }
    }
    return order
      .map((key) => ({ key, items: buckets.get(key) ?? [] }))
      .filter((bucket) => bucket.items.length > 0);
  }, [feedQuery.data?.items]);

  const total = feedQuery.data?.items.length ?? 0;

  return (
    <SectionPanel
      title="Recent activity"
      description="Everything that has changed across the portfolio — automatically built from the audit log. Read-only."
      icon={<Activity size={17} className="text-primary" />}
      actions={
        feedQuery.isFetching ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 size={12} className="animate-spin" /> Refreshing
          </span>
        ) : feedQuery.data ? (
          <StatusBadge tone={total ? "primary" : "neutral"}>
            {total === 0 ? "No activity yet" : `${total} recent`}
          </StatusBadge>
        ) : null
      }
    >
      <div className="grid gap-3 p-4">
        {!entityId ? (
          <div className="rounded-md border border-border bg-muted/25 p-3 text-sm text-muted-foreground">
            Choose an entity above to see activity.
          </div>
        ) : feedQuery.isLoading ? (
          <div className="rounded-md border border-border bg-muted/25 p-3 text-sm text-muted-foreground">
            Loading recent activity.
          </div>
        ) : feedQuery.isError ? (
          <div className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {friendlyError(feedQuery.error)}
          </div>
        ) : total === 0 ? (
          <div className="rounded-md border border-border bg-muted/25 p-3 text-sm text-muted-foreground">
            Nothing in the audit log yet. As soon as you or the system change a
            record, it will appear here.
          </div>
        ) : (
          grouped.map((bucket) => (
            <div key={bucket.key} className="grid gap-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {bucket.key}
              </div>
              <div className="grid gap-1.5">
                {bucket.items.map((item) => {
                  const tone = ACTIVITY_KIND_TONE[item.action_kind];
                  const wrapperClass =
                    "grid gap-1 rounded-md border border-border bg-white p-3 text-sm transition";
                  const interactiveClass = item.target_href
                    ? " hover:bg-muted/40"
                    : "";
                  const inner = (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone={tone}>
                            {item.action_label}
                          </StatusBadge>
                          <span className="font-medium text-foreground">
                            {item.target_label ?? item.target_table ?? "Change"}
                          </span>
                          {item.outcome !== "success" ? (
                            <StatusBadge tone="danger">
                              {item.outcome}
                            </StatusBadge>
                          ) : null}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatRelativeTime(item.occurred_at)}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground/80">
                          {item.actor}
                        </span>
                        {item.summary ? ` · ${item.summary}` : ""}
                      </div>
                      {item.error_message ? (
                        <div className="text-xs text-danger">
                          {item.error_message}
                        </div>
                      ) : null}
                    </>
                  );
                  return item.target_href ? (
                    <Link
                      key={item.id}
                      href={item.target_href}
                      className={wrapperClass + interactiveClass}
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div key={item.id} className={wrapperClass}>
                      {inner}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </SectionPanel>
  );
}
