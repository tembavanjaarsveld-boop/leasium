"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock3,
  ExternalLink,
  MailCheck,
  RefreshCw,
  Send,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { QueryProvider } from "@/components/query-provider";
import {
  EmptyState,
  PageHeader,
  SecondaryButton,
  SectionPanel,
  Select,
  StatusBadge,
} from "@/components/ui";
import {
  getWorkAssignmentNotificationCenter,
  listEntities,
  type WorkAssignmentNotificationCenterItemRecord,
  type WorkAssignmentNoticeGroup,
} from "@/lib/api";

const ENTITY_STORAGE_KEY = "leasium.entity_id";

type StatusTone = "neutral" | "success" | "warning" | "danger" | "primary";

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not recorded";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "No date";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

function label(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function groupTone(group: WorkAssignmentNoticeGroup): StatusTone {
  if (group === "attention") {
    return "danger";
  }
  if (group === "ready") {
    return "primary";
  }
  if (group === "done") {
    return "success";
  }
  return "warning";
}

function groupIcon(group: WorkAssignmentNoticeGroup): ReactNode {
  if (group === "attention") {
    return <AlertTriangle size={15} />;
  }
  if (group === "ready") {
    return <Send size={15} />;
  }
  if (group === "done") {
    return <CheckCircle2 size={15} />;
  }
  return <Clock3 size={15} />;
}

function workHref(url: string | null) {
  if (!url) {
    return "/operations";
  }
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

function NoticeRow({
  notice,
}: {
  notice: WorkAssignmentNotificationCenterItemRecord;
}) {
  return (
    <Link
      href={workHref(notice.work_url)}
      className="grid gap-3 border-t border-border px-4 py-4 text-sm transition duration-200 ease-leasium hover:bg-muted/45 md:grid-cols-[1fr_13rem_9rem]"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex text-primary">
            {groupIcon(notice.group)}
          </span>
          <span className="font-semibold text-foreground">{notice.title}</span>
          <StatusBadge tone={groupTone(notice.group)}>
            {notice.group === "in_flight" ? "In flight" : label(notice.group)}
          </StatusBadge>
          {notice.follow_up_due ? (
            <StatusBadge tone="warning">Follow-up due</StatusBadge>
          ) : null}
        </div>
        <div className="mt-1 text-sm text-muted-foreground">
          {notice.summary ??
            notice.notification_detail ??
            "Assignment notice updated."}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{label(notice.target_type)}</span>
          <span>Email {label(notice.notification_status)}</span>
          {notice.provider ? <span>{label(notice.provider)}</span> : null}
        </div>
      </div>
      <div className="min-w-0 text-xs text-muted-foreground">
        <div className="font-semibold text-foreground">
          {notice.assignee_name ?? "Unassigned"}
        </div>
        {notice.assignee_email ? (
          <div className="mt-1 truncate">{notice.assignee_email}</div>
        ) : null}
      </div>
      <div className="text-xs text-muted-foreground md:text-right">
        <div>
          {notice.event_at ? formatDateTime(notice.event_at) : "No event yet"}
        </div>
        <div className="mt-1">Due {formatDate(notice.due_date)}</div>
      </div>
    </Link>
  );
}

function NotificationsWorkspace() {
  const [selectedEntityId, setSelectedEntityId] = useState("");

  const entitiesQuery = useQuery({
    queryKey: ["notifications-entities"],
    queryFn: listEntities,
  });

  useEffect(() => {
    const stored = window.localStorage.getItem(ENTITY_STORAGE_KEY);
    const next = stored || entitiesQuery.data?.[0]?.id;
    if (!selectedEntityId && next) {
      setSelectedEntityId(next);
    }
  }, [entitiesQuery.data, selectedEntityId]);

  useEffect(() => {
    if (selectedEntityId) {
      window.localStorage.setItem(ENTITY_STORAGE_KEY, selectedEntityId);
    }
  }, [selectedEntityId]);

  const selectedEntity = entitiesQuery.data?.find(
    (entity) => entity.id === selectedEntityId,
  );

  const centerQuery = useQuery({
    queryKey: ["work-assignment-notification-center", selectedEntityId],
    queryFn: () => getWorkAssignmentNotificationCenter(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });

  const center = centerQuery.data;
  const countCards = useMemo(
    () => [
      {
        label: "Attention",
        value: center?.attention_count ?? 0,
        tone: "danger" as StatusTone,
      },
      {
        label: "Ready",
        value: center?.ready_count ?? 0,
        tone: "primary" as StatusTone,
      },
      {
        label: "In flight",
        value: center?.in_flight_count ?? 0,
        tone: "warning" as StatusTone,
      },
      {
        label: "Delivered",
        value: center?.done_count ?? 0,
        tone: "success" as StatusTone,
      },
      {
        label: "Digest receipts",
        value: center?.digest_receipt_count ?? 0,
        tone: "neutral" as StatusTone,
      },
    ],
    [center],
  );

  return (
    <main className="min-h-screen">
      <AppHeader>
        <Select
          aria-label="Entity"
          value={selectedEntityId}
          onChange={(event) => setSelectedEntityId(event.target.value)}
        >
          <option value="">Select entity</option>
          {entitiesQuery.data?.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))}
        </Select>
      </AppHeader>

      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-5">
        <PageHeader
          title="Notifications"
          description={
            selectedEntity
              ? `${selectedEntity.name} work notices and digest receipts.`
              : "Choose an entity to review work notices and digest receipts."
          }
          actions={
            <SecondaryButton
              type="button"
              disabled={!selectedEntityId || centerQuery.isFetching}
              onClick={() => centerQuery.refetch()}
            >
              <RefreshCw
                size={15}
                className={centerQuery.isFetching ? "animate-spin" : ""}
              />
              Refresh
            </SecondaryButton>
          }
        />

        <div className="grid gap-3 md:grid-cols-5">
          {countCards.map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-border bg-white p-3 shadow-leasiumXs"
            >
              <div className="text-xs font-semibold uppercase text-muted-foreground">
                {card.label}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="text-2xl font-semibold">{card.value}</div>
                <StatusBadge tone={card.tone}>{card.label}</StatusBadge>
              </div>
            </div>
          ))}
        </div>

        <SectionPanel
          title="Work notice center"
          description="Assignment notices across maintenance, arrears, and critical dates."
          icon={<Bell size={17} className="text-primary" />}
          actions={
            center ? (
              <StatusBadge tone="neutral">
                {center.notice_count} notices
              </StatusBadge>
            ) : null
          }
        >
          {center?.guardrails.length ? (
            <div className="border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
              {center.guardrails[0]}
            </div>
          ) : null}
          <div>
            {center?.notices.map((notice) => (
              <NoticeRow
                key={`${notice.target_type}-${notice.target_id}`}
                notice={notice}
              />
            ))}
            {!centerQuery.isLoading && center?.notices.length === 0 ? (
              <EmptyState
                title="No work notices"
                description="Assigned work notices will appear here once they are ready, sent, delivered, or need attention."
              />
            ) : null}
          </div>
        </SectionPanel>

        <SectionPanel
          title="Digest history"
          description="Preview receipts from manually generated or scheduled Work digests."
          icon={<MailCheck size={17} className="text-primary" />}
          actions={
            center ? (
              <StatusBadge tone="neutral">
                {center.digest_receipt_count} receipts
              </StatusBadge>
            ) : null
          }
        >
          <div className="grid gap-3 p-4 md:grid-cols-2">
            {center?.digest_receipts.map((receipt) => (
              <div
                key={`${receipt.assignee_user_id}-${receipt.generated_at}`}
                className="rounded-xl border border-border bg-white p-3 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">
                      {receipt.assignee_name}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {receipt.assignee_email}
                    </div>
                  </div>
                  <StatusBadge
                    tone={receipt.message_sent ? "success" : "neutral"}
                  >
                    {receipt.message_sent ? "Message sent" : "No messages sent"}
                  </StatusBadge>
                </div>
                <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
                  <div>{formatDateTime(receipt.generated_at)}</div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <span>{label(receipt.cadence)} digest</span>
                    <span>
                      {receipt.item_count}{" "}
                      {receipt.item_count === 1 ? "item" : "items"}
                    </span>
                    <span>{receipt.follow_up_due_count} follow-up</span>
                  </div>
                </div>
              </div>
            ))}
            {!centerQuery.isLoading && center?.digest_receipts.length === 0 ? (
              <EmptyState
                title="No digest receipts"
                description="Generated digest previews will appear here before scheduled delivery is enabled."
              />
            ) : null}
          </div>
        </SectionPanel>

        <div className="flex justify-end">
          <Link
            href="/operations"
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border-strong bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
          >
            <ExternalLink size={15} />
            Open Work
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function NotificationsPage() {
  return (
    <QueryProvider>
      <NotificationsWorkspace />
    </QueryProvider>
  );
}
