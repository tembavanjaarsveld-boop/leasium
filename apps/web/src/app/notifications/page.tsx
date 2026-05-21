"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  markWorkAssignmentNotificationCenterRead,
  runWorkAssignmentDigest,
  type WorkAssignmentNotificationCenterDigestRecord,
  type WorkAssignmentNotificationCenterItemRecord,
  type WorkAssignmentProviderHistoryRecord,
  type WorkAssignmentNoticeGroup,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const ENTITY_STORAGE_KEY = "leasium.entity_id";

type StatusTone = "neutral" | "success" | "warning" | "danger" | "primary";
type NoticeFilter = "all" | WorkAssignmentNoticeGroup | "follow_up" | "failed";
type DeliveryChannelFilter = "all" | "email" | "sms" | "in_app" | "preview";
type DigestFilter =
  | "all"
  | "needs_send"
  | "sent"
  | "failed"
  | "skipped"
  | "recovery";

const noticeFilterLabels: Record<NoticeFilter, string> = {
  all: "All",
  attention: "Attention",
  ready: "Ready",
  in_flight: "In flight",
  done: "Done",
  follow_up: "Follow-up due",
  failed: "Failed email",
};

const digestFilterLabels: Record<DigestFilter, string> = {
  all: "All",
  needs_send: "Needs send",
  sent: "Sent",
  failed: "Failed",
  skipped: "Skipped",
  recovery: "Recovery",
};

const deliveryChannelFilterLabels: Record<DeliveryChannelFilter, string> = {
  all: "All channels",
  email: "Email",
  sms: "SMS",
  in_app: "In-app",
  preview: "Preview only",
};

const noticeFilters: NoticeFilter[] = [
  "all",
  "attention",
  "in_flight",
  "ready",
  "follow_up",
  "failed",
];

const noticeChannelFilters: DeliveryChannelFilter[] = [
  "all",
  "email",
  "sms",
  "in_app",
];

const digestFilters: DigestFilter[] = [
  "all",
  "needs_send",
  "sent",
  "failed",
  "skipped",
  "recovery",
];

const digestChannelFilters: DeliveryChannelFilter[] = [
  "all",
  "email",
  "sms",
  "preview",
];

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

function channelLabel(value: string | null | undefined) {
  if (value === "sms") {
    return "SMS";
  }
  if (value === "in_app") {
    return "In-app";
  }
  if (value === "preview") {
    return "Preview only";
  }
  if (value === "email") {
    return "Email";
  }
  return "Unknown channel";
}

function templateLabel(
  templateKey: string | null | undefined,
  templateVersion: string | null | undefined,
) {
  if (!templateKey && !templateVersion) {
    return null;
  }
  return [templateKey, templateVersion].filter(Boolean).join(" ");
}

function providerHistoryTone(status: string | null | undefined): StatusTone {
  if (status && ["failed", "bounce", "dropped"].includes(status)) {
    return "danger";
  }
  if (status && ["skipped", "attention", "deferred"].includes(status)) {
    return "warning";
  }
  if (
    status &&
    ["queued", "sent", "delivered", "opened", "processed"].includes(status)
  ) {
    return "success";
  }
  return "neutral";
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

function digestReceiptTone(
  receipt: WorkAssignmentNotificationCenterDigestRecord,
): StatusTone {
  if (receipt.message_sent) {
    return "success";
  }
  if (receipt.delivery_status === "failed") {
    return "danger";
  }
  if (receipt.delivery_status === "skipped") {
    return "warning";
  }
  return "neutral";
}

function digestReceiptLabel(
  receipt: WorkAssignmentNotificationCenterDigestRecord,
) {
  if (receipt.message_sent) {
    return "Email queued";
  }
  if (receipt.delivery_status === "failed") {
    return "Failed";
  }
  if (receipt.delivery_status === "skipped") {
    return "Skipped";
  }
  return "No messages sent";
}

function digestRecoveryLabel(
  receipt: WorkAssignmentNotificationCenterDigestRecord,
) {
  return receipt.delivery_status === "failed" ||
    receipt.delivery_status === "skipped"
    ? "Retry digest"
    : "Send digest";
}

function matchesNoticeFilter(
  notice: WorkAssignmentNotificationCenterItemRecord,
  filter: NoticeFilter,
) {
  if (filter === "all") {
    return true;
  }
  if (filter === "follow_up") {
    return notice.follow_up_due;
  }
  if (filter === "failed") {
    return notice.notification_status === "failed";
  }
  return notice.group === filter;
}

function noticeDeliveryChannel(
  notice: WorkAssignmentNotificationCenterItemRecord,
): DeliveryChannelFilter {
  if (notice.channel === "email" || notice.channel === "sms") {
    return notice.channel;
  }
  return "in_app";
}

function digestDeliveryChannel(
  receipt: WorkAssignmentNotificationCenterDigestRecord,
): DeliveryChannelFilter {
  if (
    receipt.delivery_channel === "email" ||
    receipt.delivery_channel === "sms"
  ) {
    return receipt.delivery_channel;
  }
  return receipt.message_sent || receipt.provider_message_id
    ? "email"
    : "preview";
}

function matchesNoticeChannelFilter(
  notice: WorkAssignmentNotificationCenterItemRecord,
  filter: DeliveryChannelFilter,
) {
  return filter === "all" || noticeDeliveryChannel(notice) === filter;
}

function matchesDigestFilter(
  receipt: WorkAssignmentNotificationCenterDigestRecord,
  filter: DigestFilter,
) {
  if (filter === "all") {
    return true;
  }
  if (filter === "needs_send") {
    return !receipt.message_sent;
  }
  if (filter === "sent") {
    return receipt.message_sent;
  }
  if (filter === "recovery") {
    return Boolean(
      receipt.recovery_of_generated_at ||
      receipt.delivery_trigger === "recovery",
    );
  }
  return receipt.delivery_status === filter;
}

function matchesDigestChannelFilter(
  receipt: WorkAssignmentNotificationCenterDigestRecord,
  filter: DeliveryChannelFilter,
) {
  return filter === "all" || digestDeliveryChannel(receipt) === filter;
}

function FilterButton({
  active,
  children,
  count,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-9 items-center gap-2 rounded-xl border border-border bg-white px-3 text-xs font-semibold text-muted-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted hover:text-foreground",
        active && "border-primary/25 bg-leasium-blue-soft text-primary",
      )}
      onClick={onClick}
    >
      <span>{children}</span>
      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground">
        {count}
      </span>
    </button>
  );
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

function ProviderHistoryStrip({
  history,
}: {
  history?: WorkAssignmentProviderHistoryRecord[] | null;
}) {
  const latest = history?.[0];
  if (!latest) {
    return null;
  }
  const timestamp = latest.received_at ?? latest.attempted_at;
  const template = templateLabel(latest.template_key, latest.template_version);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
      <span className="font-semibold text-foreground">
        Latest provider event
      </span>
      <StatusBadge tone={providerHistoryTone(latest.status)}>
        {latest.status ? label(latest.status) : "Recorded"}
      </StatusBadge>
      {latest.event ? <span>{label(latest.event)}</span> : null}
      {latest.provider ? <span>{label(latest.provider)}</span> : null}
      {timestamp ? <span>{formatDateTime(timestamp)}</span> : null}
      {template ? <span>{template}</span> : null}
      {latest.delivery_attempt_count ? (
        <span>Attempt {latest.delivery_attempt_count}</span>
      ) : null}
      {latest.error ? <span>{latest.error}</span> : null}
    </div>
  );
}

function NoticeRow({
  notice,
}: {
  notice: WorkAssignmentNotificationCenterItemRecord;
}) {
  const template = templateLabel(notice.template_key, notice.template_version);
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
          <span>
            {channelLabel(noticeDeliveryChannel(notice))}{" "}
            {label(notice.notification_status)}
          </span>
          {notice.provider ? <span>{label(notice.provider)}</span> : null}
          {template ? <span>{template}</span> : null}
        </div>
        <ProviderHistoryStrip history={notice.provider_history} />
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
  const queryClient = useQueryClient();
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [noticeFilter, setNoticeFilter] = useState<NoticeFilter>("all");
  const [noticeChannelFilter, setNoticeChannelFilter] =
    useState<DeliveryChannelFilter>("all");
  const [digestFilter, setDigestFilter] = useState<DigestFilter>("all");
  const [digestChannelFilter, setDigestChannelFilter] =
    useState<DeliveryChannelFilter>("all");

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

  const markReadMutation = useMutation({
    mutationFn: () =>
      markWorkAssignmentNotificationCenterRead(selectedEntityId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["work-assignment-notification-center", selectedEntityId],
      }),
  });

  const retryDigestMutation = useMutation({
    mutationFn: (receipt: WorkAssignmentNotificationCenterDigestRecord) =>
      runWorkAssignmentDigest({
        entity_id: selectedEntityId,
        cadence: receipt.cadence,
        send_email_approved: true,
        delivery_trigger: "recovery",
        recovery_of_generated_at: receipt.generated_at,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["work-assignment-notification-center", selectedEntityId],
      }),
  });

  const center = centerQuery.data;
  const noticeFilterCounts = useMemo(
    () =>
      Object.fromEntries(
        noticeFilters.map((filter) => [
          filter,
          center?.notices.filter((notice) =>
            matchesNoticeFilter(notice, filter),
          ).length ?? 0,
        ]),
      ) as Record<NoticeFilter, number>,
    [center?.notices],
  );
  const noticeChannelFilterCounts = useMemo(
    () =>
      Object.fromEntries(
        noticeChannelFilters.map((filter) => [
          filter,
          center?.notices.filter((notice) =>
            matchesNoticeChannelFilter(notice, filter),
          ).length ?? 0,
        ]),
      ) as Record<DeliveryChannelFilter, number>,
    [center?.notices],
  );
  const digestFilterCounts = useMemo(
    () =>
      Object.fromEntries(
        digestFilters.map((filter) => [
          filter,
          center?.digest_receipts.filter((receipt) =>
            matchesDigestFilter(receipt, filter),
          ).length ?? 0,
        ]),
      ) as Record<DigestFilter, number>,
    [center?.digest_receipts],
  );
  const digestChannelFilterCounts = useMemo(
    () =>
      Object.fromEntries(
        digestChannelFilters.map((filter) => [
          filter,
          center?.digest_receipts.filter((receipt) =>
            matchesDigestChannelFilter(receipt, filter),
          ).length ?? 0,
        ]),
      ) as Record<DeliveryChannelFilter, number>,
    [center?.digest_receipts],
  );
  const filteredNotices = useMemo(
    () =>
      center?.notices.filter(
        (notice) =>
          matchesNoticeFilter(notice, noticeFilter) &&
          matchesNoticeChannelFilter(notice, noticeChannelFilter),
      ) ?? [],
    [center?.notices, noticeChannelFilter, noticeFilter],
  );
  const filteredDigestReceipts = useMemo(
    () =>
      center?.digest_receipts.filter(
        (receipt) =>
          matchesDigestFilter(receipt, digestFilter) &&
          matchesDigestChannelFilter(receipt, digestChannelFilter),
      ) ?? [],
    [center?.digest_receipts, digestChannelFilter, digestFilter],
  );
  const countCards = useMemo(
    () => [
      {
        label: "Unread",
        value: center?.unread_count ?? 0,
        tone: "primary" as StatusTone,
      },
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
            <>
              {center ? (
                <StatusBadge tone={center.unread_count ? "primary" : "neutral"}>
                  {center.unread_count} unread
                </StatusBadge>
              ) : null}
              <SecondaryButton
                type="button"
                disabled={
                  !selectedEntityId ||
                  !center ||
                  center.unread_count === 0 ||
                  markReadMutation.isPending
                }
                onClick={() => markReadMutation.mutate()}
              >
                <CheckCircle2 size={15} />
                Mark reviewed
              </SecondaryButton>
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
            </>
          }
        />

        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
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
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
              <span>{center.guardrails[0]}</span>
              <span>
                {center.last_read_at
                  ? `Reviewed ${formatDateTime(center.last_read_at)}`
                  : "Not reviewed yet"}
              </span>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
            {noticeFilters.map((filter) => (
              <FilterButton
                key={filter}
                active={noticeFilter === filter}
                count={noticeFilterCounts[filter]}
                onClick={() => setNoticeFilter(filter)}
              >
                {noticeFilterLabels[filter]}
              </FilterButton>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-4 py-3">
            <span className="text-xs font-semibold uppercase text-muted-foreground">
              Channel
            </span>
            {noticeChannelFilters.map((filter) => (
              <FilterButton
                key={filter}
                active={noticeChannelFilter === filter}
                count={noticeChannelFilterCounts[filter]}
                onClick={() => setNoticeChannelFilter(filter)}
              >
                {deliveryChannelFilterLabels[filter]}
              </FilterButton>
            ))}
          </div>
          <div>
            {filteredNotices.map((notice) => (
              <NoticeRow
                key={`${notice.target_type}-${notice.target_id}`}
                notice={notice}
              />
            ))}
            {!centerQuery.isLoading &&
            center &&
            filteredNotices.length === 0 ? (
              <EmptyState
                title="No matching work notices"
                description="Change the notice filter to review another receipt state."
              />
            ) : null}
          </div>
        </SectionPanel>

        <SectionPanel
          title="Digest history"
          description="Receipts from manually generated, scheduled, or approved Work digest emails."
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
            <div className="flex flex-wrap gap-2 md:col-span-2">
              {digestFilters.map((filter) => (
                <FilterButton
                  key={filter}
                  active={digestFilter === filter}
                  count={digestFilterCounts[filter]}
                  onClick={() => setDigestFilter(filter)}
                >
                  {digestFilterLabels[filter]}
                </FilterButton>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 md:col-span-2">
              <span className="text-xs font-semibold uppercase text-muted-foreground">
                Channel
              </span>
              {digestChannelFilters.map((filter) => (
                <FilterButton
                  key={filter}
                  active={digestChannelFilter === filter}
                  count={digestChannelFilterCounts[filter]}
                  onClick={() => setDigestChannelFilter(filter)}
                >
                  {deliveryChannelFilterLabels[filter]}
                </FilterButton>
              ))}
            </div>
            {filteredDigestReceipts.map((receipt) => {
              const template = templateLabel(
                receipt.template_key,
                receipt.template_version,
              );
              return (
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
                    <StatusBadge tone={digestReceiptTone(receipt)}>
                      {digestReceiptLabel(receipt)}
                    </StatusBadge>
                  </div>
                  <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
                    <div>{formatDateTime(receipt.generated_at)}</div>
                    {receipt.delivery_detail ? (
                      <div>{receipt.delivery_detail}</div>
                    ) : null}
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      <span>
                        {channelLabel(digestDeliveryChannel(receipt))}
                        {receipt.provider
                          ? ` / ${label(receipt.provider)}`
                          : ""}
                      </span>
                      {template ? <span>{template}</span> : null}
                      <span>{label(receipt.cadence)} digest</span>
                      <span>
                        {receipt.item_count}{" "}
                        {receipt.item_count === 1 ? "item" : "items"}
                      </span>
                      <span>{receipt.follow_up_due_count} follow-up</span>
                    </div>
                  </div>
                  <ProviderHistoryStrip history={receipt.provider_history} />
                  {!receipt.message_sent ? (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                      <span>
                        Sends the current {label(receipt.cadence).toLowerCase()}{" "}
                        digest to matching operators.
                        {receipt.delivery_attempt_count > 0
                          ? ` Attempt ${receipt.delivery_attempt_count + 1}.`
                          : ""}
                      </span>
                      <SecondaryButton
                        type="button"
                        className="h-9 px-2.5"
                        disabled={
                          !selectedEntityId || retryDigestMutation.isPending
                        }
                        onClick={() => retryDigestMutation.mutate(receipt)}
                      >
                        <Send size={14} />
                        {retryDigestMutation.isPending
                          ? "Sending"
                          : digestRecoveryLabel(receipt)}
                      </SecondaryButton>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {!centerQuery.isLoading &&
            center &&
            filteredDigestReceipts.length === 0 ? (
              <EmptyState
                title="No matching digest receipts"
                description="Change the digest filter to review another delivery state."
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
