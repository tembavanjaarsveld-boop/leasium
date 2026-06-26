"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronDown,
  ClipboardCopy,
  Clock3,
  Download,
  ExternalLink,
  MailCheck,
  MessageSquare,
  RefreshCw,
  Send,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { QueryProvider } from "@/components/query-provider";
import {
  EmptyState,
  PageTitle,
  SecondaryButton,
  SectionPanel,
  StatusBadge,
  type StatusTone,
} from "@/components/ui";
import {
  getOrgWideWorkAssignmentNotificationCenter,
  getWorkAssignmentNotificationCenter,
  listEntities,
  markWorkAssignmentNotificationCenterRead,
  runWorkAssignmentDigest,
  sendWorkAssignmentNoticeEmail,
  sendWorkAssignmentNoticeSms,
  type OrgWideWorkAssignmentNotificationCenterRecord,
  type WorkAssignmentNoticeChannelReceiptRecord,
  type WorkAssignmentNotificationCenterDigestRecord,
  type WorkAssignmentNotificationCenterItemRecord,
  type WorkAssignmentNotificationCenterRecord,
  type WorkAssignmentNotificationChannelRecord,
  type WorkAssignmentProviderHistoryRecord,
  type WorkAssignmentNoticeGroup,
  type WorkAssignmentRenderedMessagePreviewRecord,
} from "@/lib/api";
import { csvCell } from "@/lib/csv";
import { saveBlob } from "@/lib/download";
import {
  ALL_ENTITIES_VALUE,
  isAllEntities,
  scopeEntityId,
} from "@/lib/entity-selection";
import { useEntityFanOut } from "@/lib/use-entity-fan-out";
import { cn } from "@/lib/utils";

// In all-entities mode the merged notice/receipt rows carry the entity they
// came from (derived from the per-entity fan-out grouping, since the API rows
// do not embed an entity id). The tag drives the small entity label on each
// row; it is undefined in single-entity mode.
type EntityTag = { __entityId?: string };
type AllModeNotificationCenter = Omit<
  WorkAssignmentNotificationCenterRecord,
  "entity_id"
> & { entity_id: string | null };
type TaggedNotice = WorkAssignmentNotificationCenterItemRecord & EntityTag;
type TaggedDigestReceipt = WorkAssignmentNotificationCenterDigestRecord &
  EntityTag;

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

function formatTime(value: string | null | undefined) {
  if (!value) {
    return "No time";
  }
  return new Intl.DateTimeFormat("en-AU", {
    hour: "numeric",
    minute: "2-digit",
  })
    .format(new Date(value))
    .toLowerCase();
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

function channelReadinessTone(
  channel: WorkAssignmentNotificationChannelRecord,
): StatusTone {
  if (channel.readiness === "actionable") {
    return channel.configured || !channel.reason_code ? "success" : "warning";
  }
  if (channel.readiness === "read_only") {
    return "neutral";
  }
  return "danger";
}

function channelReadinessLabel(readiness: string) {
  if (readiness === "read_only") {
    return "Read-only";
  }
  return label(readiness);
}

function setupCheckTone(status: string): StatusTone {
  if (status === "ready") {
    return "success";
  }
  if (status === "review") {
    return "warning";
  }
  return "danger";
}

function setupCheckLabel(status: string) {
  if (status === "ready") {
    return "Ready";
  }
  if (status === "review") {
    return "Review";
  }
  return "Missing";
}

// Mirrors notificationTemplateTitle in settings/page.tsx (kept local so this
// page does not import another page module). Unknown keys fall back to the
// raw template key.
const templateKeyTitles: Record<string, string> = {
  work_assignment_notification: "Standard work assignment",
  work_assignment_follow_up: "Follow-up assignment notice",
  work_assignment_digest: "Standard work digest",
  work_assignment_digest_owner_review: "Owner review digest",
};

function templateLabel(
  templateKey: string | null | undefined,
  templateVersion: string | null | undefined,
) {
  if (!templateKey && !templateVersion) {
    return null;
  }
  const title = templateKey
    ? (templateKeyTitles[templateKey] ?? templateKey)
    : null;
  return [title, templateVersion].filter(Boolean).join(" · ");
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

function noticeNextAction(notice: WorkAssignmentNotificationCenterItemRecord) {
  if (notice.notification_status === "failed") {
    return "Retry the assignment email from this page.";
  }
  if (notice.notification_status === "skipped") {
    return "Check the operator's Work email preference, then retry from this page.";
  }
  if (notice.group === "ready") {
    return "Send the assignment notice from this page.";
  }
  if (notice.group === "in_flight") {
    return "Wait for the provider receipt or open Work to retry.";
  }
  if (notice.group === "done") {
    return "No recovery needed.";
  }
  return "Open Work to review the notice state.";
}

function canSendNotice(notice: WorkAssignmentNotificationCenterItemRecord) {
  return (
    notice.group === "ready" ||
    notice.notification_status === "failed" ||
    notice.notification_status === "skipped"
  );
}

function noticeRecoveryLabel(notice: WorkAssignmentNotificationCenterItemRecord) {
  return notice.notification_status === "failed" ||
    notice.notification_status === "skipped"
    ? "Retry notice"
    : "Send notice";
}

function providerAttemptCount(
  history: WorkAssignmentProviderHistoryRecord[] | null | undefined,
) {
  return (
    history?.filter((event) => event.event === "provider_notification_attempted")
      .length ?? 0
  );
}

function noticeChannelReceipt(
  notice: WorkAssignmentNotificationCenterItemRecord,
  channel: "email" | "sms" | "in_app",
): WorkAssignmentNoticeChannelReceiptRecord | null {
  const projected = (notice.channel_receipts ?? []).find(
    (receipt) => receipt.channel === channel,
  );
  if (projected) {
    return projected;
  }
  if (channel === "email" && notice.notification_status) {
    return {
      channel: "email",
      label: "Email",
      provider: notice.provider,
      status: notice.notification_status,
      detail: notice.notification_detail,
      recipient_email: notice.assignee_email,
      recipient_phone: null,
      provider_message_id: null,
      template_key: notice.template_key,
      template_version: notice.template_version,
      attempted_at: notice.event_at,
      sent_at: null,
      receipt_at: null,
      last_event: null,
      delivery_trigger: null,
      delivery_attempt_count: providerAttemptCount(notice.provider_history),
      message_sent: noticeDeliverySent(notice.notification_status),
      action_available: canSendNotice(notice),
      provider_history: notice.provider_history,
      rendered_message_preview: null,
    };
  }
  if (channel === "sms" && (notice.sms_status || notice.sms_action_available)) {
    return {
      channel: "sms",
      label: "SMS",
      provider: notice.sms_provider,
      status: notice.sms_status,
      detail: notice.sms_detail,
      recipient_email: null,
      recipient_phone: notice.sms_recipient_phone,
      provider_message_id: notice.sms_provider_message_id,
      template_key: null,
      template_version: null,
      attempted_at: null,
      sent_at: null,
      receipt_at: null,
      last_event: null,
      delivery_trigger: null,
      delivery_attempt_count: notice.sms_attempt_count,
      message_sent: noticeDeliverySent(notice.sms_status),
      action_available:
        notice.sms_action_available && !noticeDeliverySent(notice.sms_status),
      provider_history: notice.sms_provider_history,
      rendered_message_preview: null,
    };
  }
  return null;
}

function noticeDeliverySent(status: string | null | undefined) {
  return ["queued", "sent", "delivered", "opened"].includes(status ?? "");
}

function canSendSmsNotice(notice: WorkAssignmentNotificationCenterItemRecord) {
  return noticeChannelReceipt(notice, "sms")?.action_available ?? false;
}

function smsNoticeRecoveryLabel(
  notice: WorkAssignmentNotificationCenterItemRecord,
) {
  const smsReceipt = noticeChannelReceipt(notice, "sms");
  return smsReceipt?.status === "failed" || smsReceipt?.status === "skipped"
    ? "Retry SMS"
    : "Send SMS";
}

function digestNextAction(
  receipt: WorkAssignmentNotificationCenterDigestRecord,
) {
  if (!receipt.message_sent) {
    return `${digestRecoveryLabel(receipt)} from this page.`;
  }
  if (receipt.delivery_status === "failed") {
    return "Retry the digest from this page.";
  }
  if (receipt.delivery_status === "skipped") {
    return "Check email preferences, then retry the digest.";
  }
  if (["queued", "sent"].includes(receipt.delivery_status)) {
    return "Wait for the SendGrid delivery receipt.";
  }
  if (["delivered", "opened"].includes(receipt.delivery_status)) {
    return "No recovery needed.";
  }
  return "Review the receipt before sending again.";
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
  if (filter === "all") {
    return true;
  }
  if (filter === "email" || filter === "sms" || filter === "in_app") {
    const receipt = noticeChannelReceipt(notice, filter);
    return Boolean(receipt?.status || receipt?.action_available);
  }
  return noticeDeliveryChannel(notice) === filter;
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
        "inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-white px-3 text-xs font-semibold text-muted-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted hover:text-foreground",
        active && "border-primary/25 bg-primary-soft text-primary",
      )}
      onClick={onClick}
    >
      <span>{children}</span>
      <span className="rounded-full bg-muted px-1.5 py-0.5 text-leasium-micro leading-none text-muted-foreground">
        {count}
      </span>
    </button>
  );
}

function ExportMenu({
  actions,
}: {
  actions: Array<{
    key: string;
    label: string;
    icon: ReactNode;
    onSelect: () => void;
  }>;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        event.target instanceof Node &&
        !containerRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  return (
    <div ref={containerRef} className="relative">
      <SecondaryButton
        type="button"
        className="min-h-11 rounded-lg px-3 text-xs"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        <Download size={14} />
        Export
        <ChevronDown size={14} />
      </SecondaryButton>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-64 rounded-xl border border-border bg-white p-1 shadow-leasiumMd"
        >
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              role="menuitem"
              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-semibold text-foreground transition duration-200 ease-leasium hover:bg-muted"
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
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

function receiptRecipient(receipt: WorkAssignmentNoticeChannelReceiptRecord) {
  return receipt.recipient_email ?? receipt.recipient_phone ?? null;
}

function receiptRows(receipt: WorkAssignmentNoticeChannelReceiptRecord) {
  return [
    ["Channel", channelLabel(receipt.channel)],
    ["Status", receipt.status ? label(receipt.status) : null],
    ["Provider", receipt.provider ? label(receipt.provider) : null],
    ["Recipient", receiptRecipient(receipt)],
    ["Message ID", receipt.provider_message_id],
    ["Template", templateLabel(receipt.template_key, receipt.template_version)],
    ["Trigger", receipt.delivery_trigger ? label(receipt.delivery_trigger) : null],
    ["Attempted", formatDateTime(receipt.attempted_at)],
    ["Sent", receipt.sent_at ? formatDateTime(receipt.sent_at) : null],
    ["Receipt", receipt.receipt_at ? formatDateTime(receipt.receipt_at) : null],
    ["Last event", receipt.last_event ? label(receipt.last_event) : null],
    [
      "Attempts",
      receipt.delivery_attempt_count
        ? String(receipt.delivery_attempt_count)
        : null,
    ],
  ].filter((row): row is [string, string] => Boolean(row[1]));
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
      {latest.recipient_phone ? <span>{latest.recipient_phone}</span> : null}
      {timestamp ? <span>{formatDateTime(timestamp)}</span> : null}
      {template ? <span>{template}</span> : null}
      {latest.delivery_attempt_count ? (
        <span>Attempt {latest.delivery_attempt_count}</span>
      ) : null}
      {latest.error ? <span>{latest.error}</span> : null}
    </div>
  );
}

function MessagePreviewDisclosure({
  preview,
}: {
  preview?: WorkAssignmentRenderedMessagePreviewRecord | null;
}) {
  if (!preview) {
    return null;
  }
  const recipient = preview.recipient_email ?? preview.recipient_phone;
  const template = templateLabel(preview.template_key, preview.template_version);
  return (
    <details className="mt-2 rounded-lg border border-border bg-white">
      <summary className="min-h-11 cursor-pointer px-3 py-3 text-xs font-semibold text-primary hover:text-primary-hover">
        Message preview
      </summary>
      <div className="border-t border-border px-3 py-2 text-xs">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
          <span>{channelLabel(preview.channel)}</span>
          <span>{label(preview.provider)}</span>
          {recipient ? <span>{recipient}</span> : null}
          {template ? <span>{template}</span> : null}
        </div>
        {preview.subject ? (
          <div className="mt-2 font-semibold text-foreground">
            {preview.subject}
          </div>
        ) : null}
        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-muted/45 p-2 font-sans text-xs leading-5 text-muted-foreground">
          {preview.body_text}
        </pre>
        {preview.action_label && preview.action_url ? (
          <a
            href={preview.action_url}
            className="mt-2 inline-flex min-h-11 items-center rounded-md px-1 text-xs font-semibold text-primary hover:text-primary-hover"
          >
            {preview.action_label}
          </a>
        ) : null}
      </div>
    </details>
  );
}

function ProviderSetupChecks({
  channels,
}: {
  channels: WorkAssignmentNotificationChannelRecord[];
}) {
  const checks = channels.flatMap((channel) =>
    (channel.setup_checks ?? []).map((check) => ({
      ...check,
      channelLabel: channel.label,
    })),
  );
  if (!checks.length) {
    return null;
  }
  const issueCount = checks.filter((check) => check.status !== "ready").length;
  return (
    <details className="hidden rounded-lg border border-border bg-muted/20 text-xs md:col-span-3 md:block">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 font-semibold text-foreground">
        <span>Provider setup checks</span>
        <StatusBadge tone={issueCount ? "warning" : "success"}>
          {issueCount ? `${issueCount} to review` : "Ready"}
        </StatusBadge>
      </summary>
      <div className="grid gap-2 border-t border-border px-3 py-3 md:grid-cols-2">
        {checks.map((check) => (
          <div
            key={`${check.channelLabel}-${check.key}`}
            className="rounded-md border border-border bg-white px-3 py-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-foreground">
                {check.channelLabel} / {check.label}
              </div>
              <StatusBadge tone={setupCheckTone(check.status)}>
                {setupCheckLabel(check.status)}
              </StatusBadge>
            </div>
            <div className="mt-1 leading-5 text-muted-foreground">
              {check.detail}
            </div>
            {check.value ? (
              <div className="mt-2 break-all rounded-md bg-muted/45 px-2 py-1 font-mono text-leasium-micro leading-4 text-muted-foreground">
                {check.value}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </details>
  );
}

function HorizonChannelCards({
  channels,
}: {
  channels: WorkAssignmentNotificationChannelRecord[];
}) {
  if (!channels.length) {
    return null;
  }
  return (
    <div className="hidden md:grid md:grid-cols-3 md:gap-3">
      {channels.map((channel) => {
        const ready = channel.configured && channel.readiness !== "blocked";
        const setupNeeded = channel.action_available && !channel.configured;
        const statusLabel = ready
          ? "Ready"
          : setupNeeded
            ? "Setup needed"
            : channelReadinessLabel(channel.readiness);
        return (
          <article
            key={channel.channel}
            className="inline-flex min-h-10 items-center rounded-full border border-leasium-card-border bg-white px-3 py-1.5 text-xs shadow-leasiumXs md:block md:min-h-0 md:rounded-2xl md:px-4 md:py-4 md:text-sm md:shadow-leasiumCard"
          >
            <div className="flex items-center justify-between gap-2 md:items-start md:gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-semibold text-foreground">
                  {channel.channel === "sms" ? (
                    <Bell size={16} className="text-slate" />
                  ) : channel.channel === "email" ? (
                    <MailCheck size={16} className="text-slate" />
                  ) : (
                    <CheckCircle2 size={16} className="text-slate" />
                  )}
                  <span>{channel.label}</span>
                </div>
                <p className="mt-2 hidden text-xs leading-5 text-muted-foreground md:block">
                  {channel.detail}
                </p>
                <p className="mt-1 hidden text-leasium-micro font-semibold uppercase text-muted-foreground md:block">
                  {channel.label}{" "}
                  {channelReadinessLabel(channel.readiness).toLowerCase()}
                </p>
              </div>
              <StatusBadge tone={channelReadinessTone(channel)}>
                {statusLabel}
              </StatusBadge>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function mobileChannelChipClass(
  channel: WorkAssignmentNotificationChannelRecord,
) {
  const ready =
    channel.configured &&
    (channel.readiness === "actionable" || channel.readiness === "read_only");
  if (ready || channel.readiness === "read_only") {
    return "bg-accent-soft text-leasium-teal-strong";
  }
  if (channel.readiness === "blocked") {
    return "bg-danger-soft text-danger-strong";
  }
  return "bg-warning-soft text-warning-strong";
}

function mobileChannelStatusLabel(
  channel: WorkAssignmentNotificationChannelRecord,
) {
  const ready =
    channel.configured &&
    (channel.readiness === "actionable" || channel.readiness === "read_only");
  if (ready || channel.readiness === "read_only") {
    return "ready";
  }
  if (channel.action_available && !channel.configured) {
    return "setup";
  }
  return channelReadinessLabel(channel.readiness).toLowerCase();
}

function MobileChannelChips({
  channels,
}: {
  channels: WorkAssignmentNotificationChannelRecord[];
}) {
  if (!channels.length) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-1.5 md:hidden">
      {channels.map((channel) => (
        <span
          key={channel.channel}
          className={cn(
            "inline-flex min-h-6 items-center rounded-full px-2.5 text-[11px] font-semibold leading-none",
            mobileChannelChipClass(channel),
          )}
        >
          {channel.label} {mobileChannelStatusLabel(channel)}
        </span>
      ))}
    </div>
  );
}

function NotificationTrustRibbon() {
  return (
    <div className="flex justify-center">
      <div className="inline-flex max-w-full items-center gap-2 rounded-full bg-success-soft px-4 py-2 text-sm font-semibold text-leasium-teal-strong">
        <CheckCircle2 size={16} />
        <span>
          Notification center is read-only — sends need your explicit approval.
        </span>
      </div>
    </div>
  );
}

function providerReadinessCsv({
  channels,
  guardrails,
}: {
  channels: WorkAssignmentNotificationChannelRecord[];
  guardrails: string[];
}) {
  const exportGuardrail =
    "Review-only export: downloading this file does not send email, send SMS, run digests, mark notifications read, dispatch providers, refresh provider tokens, or mutate provider history.";
  const rows: Array<Array<string | number | boolean | null | undefined>> = [
    [
      "Category",
      "Channel",
      "Provider",
      "Readiness",
      "Configured",
      "Action available",
      "Reason code",
      "Detail",
      "Next action",
      "Setup check",
      "Setup status",
      "Setup detail",
      "Setup value",
      "Guardrail",
    ],
    ...channels.flatMap((channel) => [
      [
        "Provider channel",
        channel.label,
        label(channel.provider),
        channelReadinessLabel(channel.readiness),
        channel.configured ? "Yes" : "No",
        channel.action_available ? "Yes" : "No",
        channel.reason_code ? label(channel.reason_code) : "",
        channel.detail,
        channel.next_action,
        "",
        "",
        "",
        "",
        exportGuardrail,
      ],
      ...(channel.setup_checks ?? []).map((check) => [
        "Setup check",
        channel.label,
        label(channel.provider),
        channelReadinessLabel(channel.readiness),
        channel.configured ? "Yes" : "No",
        channel.action_available ? "Yes" : "No",
        channel.reason_code ? label(channel.reason_code) : "",
        channel.detail,
        channel.next_action,
        check.label,
        setupCheckLabel(check.status),
        check.detail,
        check.value,
        exportGuardrail,
      ]),
    ]),
    ...guardrails.map((guardrail) => [
      "Center guardrail",
      "",
      "",
      "",
      "",
      "",
      "",
      guardrail,
      "",
      "",
      "",
      "",
      "",
      exportGuardrail,
    ]),
    [
      "Export guardrail",
      "",
      "",
      "",
      "",
      "",
      "",
      exportGuardrail,
      "",
      "",
      "",
      "",
      "",
      exportGuardrail,
    ],
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

const reviewPacketGuardrail =
  "Review-only packet: copying or downloading this packet does not send email, send SMS, run digests, mark notifications read, mark notifications reviewed, dispatch providers, call Comms, call Xero, call Basiq, refresh provider tokens, or mutate provider history.";

function reviewPacketRows({
  entityName,
  generatedAt,
  guardrails,
  notices,
  digestReceipts,
}: {
  entityName: string | null | undefined;
  generatedAt: string | null | undefined;
  guardrails: string[];
  notices: WorkAssignmentNotificationCenterItemRecord[];
  digestReceipts: WorkAssignmentNotificationCenterDigestRecord[];
}) {
  const noticeRows = notices.flatMap((notice) => {
    const receipts = [
      noticeChannelReceipt(notice, "email"),
      noticeChannelReceipt(notice, "sms"),
      noticeChannelReceipt(notice, "in_app"),
    ].filter(
      (receipt): receipt is WorkAssignmentNoticeChannelReceiptRecord =>
        Boolean(receipt?.status || receipt?.action_available),
    );
    const noticeSummary = [
      [
        "Notice",
        notice.title,
        entityName,
        notice.assignee_name,
        notice.assignee_email,
        label(notice.target_type),
        channelLabel(noticeDeliveryChannel(notice)),
        notice.notification_status ? label(notice.notification_status) : "",
        notice.provider ? label(notice.provider) : "",
        notice.notification_detail,
        notice.summary,
        notice.event_at ? formatDateTime(notice.event_at) : "",
        formatDate(notice.due_date),
        notice.follow_up_due ? "Yes" : "No",
        noticeNextAction(notice),
        templateLabel(notice.template_key, notice.template_version),
        "",
        reviewPacketGuardrail,
      ],
    ];
    const receiptEvidence = receipts.map((receipt) => [
      "Notice receipt",
      notice.title,
      entityName,
      notice.assignee_name,
      receiptRecipient(receipt),
      label(notice.target_type),
      channelLabel(receipt.channel),
      receipt.status ? label(receipt.status) : "",
      receipt.provider ? label(receipt.provider) : "",
      receipt.detail,
      receipt.provider_message_id,
      receipt.attempted_at ? formatDateTime(receipt.attempted_at) : "",
      receipt.receipt_at ? formatDateTime(receipt.receipt_at) : "",
      receipt.delivery_attempt_count,
      noticeNextAction(notice),
      templateLabel(receipt.template_key, receipt.template_version),
      receipt.rendered_message_preview?.subject,
      reviewPacketGuardrail,
    ]);
    return [...noticeSummary, ...receiptEvidence];
  });
  const digestRows = digestReceipts.flatMap((receipt) => [
    [
      "Digest receipt",
      `${label(receipt.cadence)} digest`,
      entityName,
      receipt.assignee_name,
      receipt.assignee_email,
      "Digest",
      channelLabel(digestDeliveryChannel(receipt)),
      receipt.delivery_status ? label(receipt.delivery_status) : "",
      receipt.provider ? label(receipt.provider) : "",
      receipt.delivery_detail,
      receipt.rendered_message_preview?.subject,
      formatDateTime(receipt.generated_at),
      "",
      receipt.delivery_attempt_count,
      digestNextAction(receipt),
      templateLabel(receipt.template_key, receipt.template_version),
      receipt.provider_message_id,
      reviewPacketGuardrail,
    ],
    ...(receipt.channel_receipts ?? []).map((channelReceipt) => [
      "Digest channel receipt",
      channelReceipt.label,
      entityName,
      receipt.assignee_name,
      receiptRecipient(channelReceipt),
      "Digest",
      channelLabel(channelReceipt.channel),
      channelReceipt.status ? label(channelReceipt.status) : "",
      channelReceipt.provider ? label(channelReceipt.provider) : "",
      channelReceipt.detail,
      channelReceipt.provider_message_id,
      channelReceipt.attempted_at
        ? formatDateTime(channelReceipt.attempted_at)
        : "",
      channelReceipt.receipt_at ? formatDateTime(channelReceipt.receipt_at) : "",
      channelReceipt.delivery_attempt_count,
      digestNextAction(receipt),
      templateLabel(channelReceipt.template_key, channelReceipt.template_version),
      channelReceipt.rendered_message_preview?.subject,
      reviewPacketGuardrail,
    ]),
  ]);

  return [
    [
      "Type",
      "Title",
      "Entity",
      "Assignee",
      "Recipient",
      "Work type",
      "Channel",
      "Status",
      "Provider",
      "Detail",
      "Evidence",
      "Event time",
      "Due or receipt time",
      "Attempts or follow-up",
      "Next action",
      "Template",
      "Message evidence",
      "Guardrail",
    ],
    [
      "Packet",
      "Work notification review packet",
      entityName,
      "",
      "",
      "",
      "",
      "",
      "",
      `Generated ${formatDateTime(generatedAt)}`,
      "",
      "",
      "",
      "",
      "Review work-notification evidence before taking explicit send or retry actions.",
      "",
      "",
      reviewPacketGuardrail,
    ],
    ...noticeRows,
    ...digestRows,
    ...guardrails.map((guardrail) => [
      "Center guardrail",
      "Notification center guardrail",
      entityName,
      "",
      "",
      "",
      "",
      "",
      "",
      guardrail,
      "",
      "",
      "",
      "",
      "Keep review packet actions local-only.",
      "",
      "",
      reviewPacketGuardrail,
    ]),
    [
      "Packet guardrail",
      "No-send guardrail",
      entityName,
      "",
      "",
      "",
      "",
      "",
      "",
      reviewPacketGuardrail,
      "",
      "",
      "",
      "",
      "Use explicit send, retry, mark reviewed, or provider actions separately.",
      "",
      "",
      reviewPacketGuardrail,
    ],
  ];
}

function workNotificationReviewPacketCsv({
  entityName,
  generatedAt,
  guardrails,
  notices,
  digestReceipts,
}: {
  entityName: string | null | undefined;
  generatedAt: string | null | undefined;
  guardrails: string[];
  notices: WorkAssignmentNotificationCenterItemRecord[];
  digestReceipts: WorkAssignmentNotificationCenterDigestRecord[];
}) {
  return reviewPacketRows({
    entityName,
    generatedAt,
    guardrails,
    notices,
    digestReceipts,
  })
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}

function ReceiptEvidenceDisclosure({
  receipt,
}: {
  receipt: WorkAssignmentNoticeChannelReceiptRecord;
}) {
  const rows = receiptRows(receipt);
  return (
    <details className="mt-2 rounded-lg border border-border bg-white">
      <summary className="min-h-11 cursor-pointer px-3 py-3 text-xs font-semibold text-primary hover:text-primary-hover">
        Receipt evidence
      </summary>
      <div className="border-t border-border px-3 py-2">
        <div className="grid gap-1 text-xs">
          {rows.map(([name, value]) => (
            <div
              key={name}
              className="grid gap-1 sm:grid-cols-[7rem_1fr] sm:gap-3"
            >
              <span className="text-muted-foreground">{name}</span>
              <span className="min-w-0 break-words font-medium text-foreground">
                {value}
              </span>
            </div>
          ))}
        </div>
        {receipt.provider_history.length ? (
          <div className="mt-3 border-t border-border pt-2">
            <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              Provider history
            </div>
            <div className="grid gap-2">
              {receipt.provider_history.map((event, index) => {
                const timestamp = event.received_at ?? event.attempted_at;
                return (
                  <div
                    key={`${event.event ?? "event"}-${timestamp ?? index}`}
                    className="rounded-md bg-muted/45 px-2 py-2 text-xs text-muted-foreground"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={providerHistoryTone(event.status)}>
                        {event.status ? label(event.status) : "Recorded"}
                      </StatusBadge>
                      {event.event ? (
                        <span className="font-semibold text-foreground">
                          {label(event.event)}
                        </span>
                      ) : null}
                      {timestamp ? <span>{formatDateTime(timestamp)}</span> : null}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      {event.provider ? <span>{label(event.provider)}</span> : null}
                      {event.provider_message_id ? (
                        <span>{event.provider_message_id}</span>
                      ) : null}
                      {event.recipient_email ? (
                        <span>{event.recipient_email}</span>
                      ) : null}
                      {event.recipient_phone ? (
                        <span>{event.recipient_phone}</span>
                      ) : null}
                      {event.delivery_attempt_count ? (
                        <span>Attempt {event.delivery_attempt_count}</span>
                      ) : null}
                      {event.error ? <span>{event.error}</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function NoticeChannelReceiptCard({
  receipt,
}: {
  receipt: WorkAssignmentNoticeChannelReceiptRecord;
}) {
  if (!receipt.status) {
    return null;
  }
  const template = templateLabel(receipt.template_key, receipt.template_version);
  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-foreground">{receipt.label}</span>
        <StatusBadge tone={providerHistoryTone(receipt.status)}>
          {label(receipt.status)}
        </StatusBadge>
        {receipt.provider ? <span>{label(receipt.provider)}</span> : null}
        {receipt.recipient_phone ? <span>{receipt.recipient_phone}</span> : null}
        {receipt.recipient_email ? <span>{receipt.recipient_email}</span> : null}
        {receipt.delivery_attempt_count ? (
          <span>Attempt {receipt.delivery_attempt_count}</span>
        ) : null}
        {template ? <span>{template}</span> : null}
      </div>
      {receipt.detail ? <div className="mt-1">{receipt.detail}</div> : null}
      <ProviderHistoryStrip history={receipt.provider_history} />
      <ReceiptEvidenceDisclosure receipt={receipt} />
    </div>
  );
}

function NoticeRow({
  isSending,
  isSendingSms,
  notice,
  entityName,
  allMode,
  onSend,
  onSendSms,
}: {
  isSending: boolean;
  isSendingSms: boolean;
  notice: WorkAssignmentNotificationCenterItemRecord;
  entityName?: string | null;
  allMode: boolean;
  onSend: (notice: WorkAssignmentNotificationCenterItemRecord) => void;
  onSendSms: (notice: WorkAssignmentNotificationCenterItemRecord) => void;
}) {
  const template = templateLabel(notice.template_key, notice.template_version);
  const href = workHref(notice.work_url);
  const emailReceipt = noticeChannelReceipt(notice, "email");
  const projectedSidecarReceipts = (notice.channel_receipts ?? []).filter(
    (receipt) => receipt.channel !== "email" && receipt.status,
  );
  const fallbackSmsReceipt = noticeChannelReceipt(notice, "sms");
  const sidecarReceipts =
    fallbackSmsReceipt?.status &&
    !projectedSidecarReceipts.some((receipt) => receipt.channel === "sms")
      ? [...projectedSidecarReceipts, fallbackSmsReceipt]
      : projectedSidecarReceipts;
  const messagePreviewReceipts = [emailReceipt, ...sidecarReceipts].filter(
    (receipt): receipt is WorkAssignmentNoticeChannelReceiptRecord =>
      Boolean(receipt?.rendered_message_preview),
  );
  return (
    <div
      className="grid gap-3 border-t border-border px-4 py-4 text-sm transition duration-200 ease-leasium hover:bg-muted/45 md:grid-cols-[1fr_13rem_11rem]"
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
        {allMode ? (
          <div className="mt-1 text-leasium-micro font-semibold uppercase text-muted-foreground">
            {entityName ?? "Unknown entity"}
          </div>
        ) : null}
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
        {messagePreviewReceipts.map((receipt) => (
          <MessagePreviewDisclosure
            key={`${notice.target_type}-${notice.target_id}-${receipt.channel}-preview`}
            preview={receipt.rendered_message_preview}
          />
        ))}
        <div className="mt-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Next action:</span>{" "}
          {noticeNextAction(notice)}
        </div>
        <ProviderHistoryStrip history={notice.provider_history} />
        {emailReceipt ? <ReceiptEvidenceDisclosure receipt={emailReceipt} /> : null}
        {sidecarReceipts.map((receipt) => (
          <NoticeChannelReceiptCard
            key={`${notice.target_type}-${notice.target_id}-${receipt.channel}`}
            receipt={receipt}
          />
        ))}
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
        <div className="mt-3 flex flex-wrap justify-start gap-2 md:justify-end">
          {canSendNotice(notice) ? (
            <SecondaryButton
              type="button"
              className="h-9 px-2.5"
              disabled={isSending}
              onClick={() => onSend(notice)}
            >
              <Send size={14} />
              {isSending ? "Sending…" : noticeRecoveryLabel(notice)}
            </SecondaryButton>
          ) : null}
          {canSendSmsNotice(notice) ? (
            <SecondaryButton
              type="button"
              className="h-9 px-2.5"
              disabled={isSendingSms}
              onClick={() => onSendSms(notice)}
            >
              <MessageSquare size={14} />
              {isSendingSms
                ? "Sending…"
                : smsNoticeRecoveryLabel(notice)}
            </SecondaryButton>
          ) : null}
          <Link
            href={href}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border-strong bg-white px-3 text-xs font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
          >
            <ExternalLink size={14} />
            Open work
          </Link>
        </div>
      </div>
    </div>
  );
}

function mobileNoticeRailClass(
  notice: WorkAssignmentNotificationCenterItemRecord,
) {
  if (
    notice.group === "attention" ||
    notice.notification_status === "failed"
  ) {
    return "bg-danger";
  }
  if (
    notice.group === "ready" ||
    notice.group === "in_flight" ||
    notice.follow_up_due
  ) {
    return "bg-warning";
  }
  if (notice.group === "done") {
    return "bg-success";
  }
  return "bg-primary";
}

function MobileNoticeCard({
  allMode,
  entityName,
  isSending,
  isSendingSms,
  notice,
  onSend,
  onSendSms,
}: {
  allMode: boolean;
  entityName?: string | null;
  isSending: boolean;
  isSendingSms: boolean;
  notice: TaggedNotice;
  onSend: (notice: TaggedNotice) => void;
  onSendSms: (notice: TaggedNotice) => void;
}) {
  const href = workHref(notice.work_url);
  const summary =
    notice.summary ?? notice.notification_detail ?? "Assignment notice updated.";
  return (
    <article
      data-testid={`notifications-mobile-notice-${notice.target_id}`}
      className="flex overflow-hidden rounded-[14px] border border-leasium-card-border bg-white shadow-leasiumXs"
    >
      <div className={cn("w-1 shrink-0", mobileNoticeRailClass(notice))} />
      <div className="grid min-w-0 flex-1 gap-1.5 px-3.5 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold leading-5 text-foreground">
            {notice.title}
          </h2>
          {entityName ? (
            <p className="mt-0.5 truncate text-[10px] font-semibold uppercase leading-4 text-muted-foreground">
              {entityName}
            </p>
          ) : null}
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
            {summary}
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 pt-0.5">
          {canSendNotice(notice) ? (
            <SecondaryButton
              type="button"
              className="min-h-11 rounded-[10px] border-transparent bg-primary px-3 text-xs text-primary-foreground hover:bg-primary-hover"
              disabled={isSending}
              onClick={() => onSend(notice)}
            >
              {isSending ? "Sending…" : noticeRecoveryLabel(notice)}
            </SecondaryButton>
          ) : canSendSmsNotice(notice) ? (
            <SecondaryButton
              type="button"
              className="min-h-11 rounded-[10px] border-transparent bg-primary px-3 text-xs text-primary-foreground hover:bg-primary-hover"
              disabled={isSendingSms}
              onClick={() => onSendSms(notice)}
            >
              {isSendingSms ? "Sending…" : smsNoticeRecoveryLabel(notice)}
            </SecondaryButton>
          ) : (
            <Link
              href={href}
              className="inline-flex min-h-11 items-center justify-center rounded-[10px] border border-border-strong bg-white px-3 text-xs font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
            >
              Open work
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}

function MobileReceiptCard({
  allMode,
  isSendingDigest,
  receipt,
  onRetryDigest,
}: {
  allMode: boolean;
  isSendingDigest: boolean;
  receipt: TaggedDigestReceipt;
  onRetryDigest: (receipt: TaggedDigestReceipt) => void;
}) {
  return (
    <article
      data-testid={`notifications-mobile-receipt-${receipt.assignee_user_id}`}
      className="grid gap-1.5 rounded-[14px] border border-leasium-card-border bg-white px-3.5 py-3 shadow-leasiumXs"
    >
      <h2 className="truncate text-sm font-semibold leading-5 text-foreground">
        {label(receipt.cadence)} digest — {receipt.assignee_name}
      </h2>
      <p className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">
        {receipt.delivery_detail ??
          `${receipt.message_sent ? "Sent" : "Generated"} ${formatTime(
            receipt.generated_at,
          )} · ${receipt.item_count} ${
            receipt.item_count === 1 ? "item" : "items"
          }`}
      </p>
      <div className="flex items-center justify-end gap-2 pt-0.5">
        <StatusBadge tone={digestReceiptTone(receipt)}>
          {digestReceiptLabel(receipt)}
        </StatusBadge>
        {!receipt.message_sent ? (
          <SecondaryButton
            type="button"
            className="min-h-11 rounded-[10px] border-transparent bg-primary px-3 text-xs text-primary-foreground hover:bg-primary-hover"
            disabled={isSendingDigest}
            onClick={() => onRetryDigest(receipt)}
          >
            {isSendingDigest ? "Sending…" : digestRecoveryLabel(receipt)}
          </SecondaryButton>
        ) : null}
      </div>
    </article>
  );
}

function NotificationsMobileSummary({
  allMode,
  centerLoading,
  entityNameById,
  filteredDigestReceipts,
  filteredNotices,
  hasCenterData,
  retryDigestMutationPending,
  retryDigestVariables,
  sendNoticeMutationPending,
  sendNoticeVariables,
  sendSmsNoticeMutationPending,
  sendSmsNoticeVariables,
  onRetryDigest,
  onSend,
  onSendSms,
}: {
  allMode: boolean;
  centerLoading: boolean;
  entityNameById: Map<string, string>;
  filteredDigestReceipts: TaggedDigestReceipt[];
  filteredNotices: TaggedNotice[];
  hasCenterData: boolean;
  retryDigestMutationPending: boolean;
  retryDigestVariables?: WorkAssignmentNotificationCenterDigestRecord;
  sendNoticeMutationPending: boolean;
  sendNoticeVariables?: WorkAssignmentNotificationCenterItemRecord;
  sendSmsNoticeMutationPending: boolean;
  sendSmsNoticeVariables?: WorkAssignmentNotificationCenterItemRecord;
  onRetryDigest: (receipt: TaggedDigestReceipt) => void;
  onSend: (notice: TaggedNotice) => void;
  onSendSms: (notice: TaggedNotice) => void;
}) {
  return (
    <section
      aria-label="Notifications mobile review"
      data-testid="notifications-mobile-first-viewport"
      className="grid gap-3 md:hidden"
    >
      <p className="text-[10px] font-semibold uppercase leading-4 text-muted-foreground">
        Needs you
      </p>
      {filteredNotices.slice(0, 2).map((notice) => (
        <MobileNoticeCard
          key={`${notice.__entityId ?? ""}-${notice.target_type}-${notice.target_id}`}
          allMode={allMode}
          entityName={
            notice.__entityId ? entityNameById.get(notice.__entityId) : null
          }
          isSending={
            sendNoticeMutationPending &&
            sendNoticeVariables?.target_id === notice.target_id
          }
          isSendingSms={
            sendSmsNoticeMutationPending &&
            sendSmsNoticeVariables?.target_id === notice.target_id
          }
          notice={notice}
          onSend={onSend}
          onSendSms={onSendSms}
        />
      ))}
      {!centerLoading && hasCenterData && filteredNotices.length === 0 ? (
        <EmptyState
          icon={<Bell size={18} />}
          title="No matching work notices"
          description="Change the notice filter on desktop to review another receipt state."
        />
      ) : null}

      <p className="mt-0.5 text-[10px] font-semibold uppercase leading-4 text-muted-foreground">
        Receipts
      </p>
      {filteredDigestReceipts.slice(0, 2).map((receipt) => (
        <MobileReceiptCard
          key={`${receipt.__entityId ?? ""}-${receipt.assignee_user_id}-${receipt.generated_at}`}
          allMode={allMode}
          isSendingDigest={
            retryDigestMutationPending &&
            retryDigestVariables?.generated_at === receipt.generated_at
          }
          receipt={receipt}
          onRetryDigest={onRetryDigest}
        />
      ))}
      {!centerLoading && hasCenterData && filteredDigestReceipts.length === 0 ? (
        <EmptyState
          icon={<MailCheck size={18} />}
          title="No matching digest receipts"
          description="Change the receipt filter on desktop to review another delivery state."
        />
      ) : null}
    </section>
  );
}

function NotificationsWorkspace() {
  const queryClient = useQueryClient();
  const [noticeFilter, setNoticeFilter] = useState<NoticeFilter>("all");
  const [noticeChannelFilter, setNoticeChannelFilter] =
    useState<DeliveryChannelFilter>("all");
  const [digestFilter, setDigestFilter] = useState<DigestFilter>("all");
  const [digestChannelFilter, setDigestChannelFilter] =
    useState<DeliveryChannelFilter>("all");
  const [reviewPacketCopied, setReviewPacketCopied] = useState(false);
  const [providerReadinessCsvCopied, setProviderReadinessCsvCopied] =
    useState(false);

  const entitiesQuery = useQuery({
    queryKey: ["notifications-entities"],
    queryFn: listEntities,
  });

  // The portfolio is all-entities by default — the global entity switcher is
  // gone and the entity is now a per-list trust tag. The org-wide read path
  // always runs; a single entity is reached via the tag, not a page-level pin.
  const selectedEntityId = ALL_ENTITIES_VALUE;

  // All-entities mode: the single-entity center query uses scopedEntityId
  // (empty in all-mode, so it stays disabled) and the page reads merged
  // fan-out results. Single-entity writes are gated off while allMode is on.
  const allMode = isAllEntities(selectedEntityId);
  const scopedEntityId = scopeEntityId(selectedEntityId);
  const entityNameById = useMemo(
    () =>
      new Map(
        (entitiesQuery.data ?? []).map((entity) => [entity.id, entity.name]),
      ),
    [entitiesQuery.data],
  );

  const selectedEntity = entitiesQuery.data?.find(
    (entity) => entity.id === scopedEntityId,
  );

  const centerQuery = useQuery({
    queryKey: ["work-assignment-notification-center", scopedEntityId],
    queryFn: () => getWorkAssignmentNotificationCenter(scopedEntityId),
    enabled: Boolean(scopedEntityId),
  });

  // Fan the composite center across every entity. The hook flattens T[], so
  // each per-entity queryFn returns a single-element array holding that
  // entity's whole center record; merged notice/receipt arrays are derived
  // below. The per-entity key matches the single-entity query, sharing cache.
  const centerFanOut = useEntityFanOut<AllModeNotificationCenter>({
    entities: entitiesQuery.data,
    enabled: allMode,
    keyPrefix: ["work-assignment-notification-center"],
    queryFn: async (entityId) => [
      await getWorkAssignmentNotificationCenter(entityId),
    ],
    orgWideQueryFn: async () => [
      await getOrgWideWorkAssignmentNotificationCenter(),
    ],
  });

  // Channel readiness + provider setup checks are org-level (SendGrid/Twilio
  // live in env, shared across trusts), but the org-wide center returns
  // channels: []. In all-mode read them from the first accessible entity's
  // center so the readiness strip and setup checks still render.
  const firstEntityId = entitiesQuery.data?.[0]?.id ?? "";
  const channelReadinessQuery = useQuery({
    queryKey: ["work-assignment-notification-center-channels", firstEntityId],
    queryFn: () => getWorkAssignmentNotificationCenter(firstEntityId),
    enabled: allMode && Boolean(firstEntityId),
  });

  const markReadMutation = useMutation({
    mutationFn: () =>
      markWorkAssignmentNotificationCenterRead(scopedEntityId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        // Prefix match so the all-mode fan-out (org-wide / per-entity keys)
        // refetches too, not just the single-entity center.
        queryKey: ["work-assignment-notification-center"],
      }),
  });

  const retryDigestMutation = useMutation({
    mutationFn: (receipt: WorkAssignmentNotificationCenterDigestRecord) =>
      runWorkAssignmentDigest({
        entity_id: receipt.entity_id || scopedEntityId,
        cadence: receipt.cadence,
        send_email_approved: true,
        delivery_trigger: "recovery",
        recovery_of_generated_at: receipt.generated_at,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        // Prefix match so the all-mode fan-out (org-wide / per-entity keys)
        // refetches too, not just the single-entity center.
        queryKey: ["work-assignment-notification-center"],
      }),
  });

  const sendNoticeMutation = useMutation({
    mutationFn: (notice: WorkAssignmentNotificationCenterItemRecord) =>
      sendWorkAssignmentNoticeEmail({
        entity_id: notice.entity_id || scopedEntityId,
        target_id: notice.target_id,
        target_type: notice.target_type,
        delivery_trigger:
          notice.notification_status === "failed" ||
          notice.notification_status === "skipped"
            ? "retry"
            : "manual",
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        // Prefix match so the all-mode fan-out (org-wide / per-entity keys)
        // refetches too, not just the single-entity center.
        queryKey: ["work-assignment-notification-center"],
      }),
  });

  const sendSmsNoticeMutation = useMutation({
    mutationFn: (notice: WorkAssignmentNotificationCenterItemRecord) =>
      sendWorkAssignmentNoticeSms({
        entity_id: notice.entity_id || scopedEntityId,
        target_id: notice.target_id,
        target_type: notice.target_type,
        delivery_trigger:
          noticeChannelReceipt(notice, "sms")?.status === "failed" ||
          noticeChannelReceipt(notice, "sms")?.status === "skipped"
            ? "retry"
            : "manual",
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        // Prefix match so the all-mode fan-out (org-wide / per-entity keys)
        // refetches too, not just the single-entity center.
        queryKey: ["work-assignment-notification-center"],
      }),
  });

  const center = centerQuery.data;
  const centerChannels = allMode
    ? (channelReadinessQuery.data?.channels ?? [])
    : (center?.channels ?? []);
  // Guardrail bar + reviewed-state: org-level guardrails come from the first
  // entity's center in all-mode; the reviewed timestamp from the merged
  // fan-out (refetched after mark-read), else the single-entity center.
  const centerGuardrails = allMode
    ? (channelReadinessQuery.data?.guardrails ?? [])
    : (center?.guardrails ?? []);
  const centerLastReadAt = allMode
    ? (centerFanOut.data[0]?.last_read_at ?? null)
    : (center?.last_read_at ?? null);

  // Merged, entity-tagged list views the UI reads in all-mode. Notice/receipt
  // rows do not embed an entity id, so each row is tagged from the center it
  // came from during the fan-out grouping. Composite scalar/summary fields
  // (channel readiness, provider setup checks, counts) stay single-entity-only.
  const mergedNotices = useMemo<TaggedNotice[]>(
    () =>
      centerFanOut.data.flatMap((entityCenter) =>
        entityCenter.notices.map((notice) => ({
          ...notice,
          __entityId: notice.entity_id ?? entityCenter.entity_id ?? undefined,
        })),
      ),
    [centerFanOut.data],
  );
  const mergedDigestReceipts = useMemo<TaggedDigestReceipt[]>(
    () =>
      centerFanOut.data.flatMap((entityCenter) =>
        entityCenter.digest_receipts.map((receipt) => ({
          ...receipt,
          __entityId: receipt.entity_id ?? entityCenter.entity_id ?? undefined,
        })),
      ),
    [centerFanOut.data],
  );

  // Trust-as-tag filter: in all-entities mode a row of trust chips scopes the
  // notice center to one entity (?trust_tag). "All trusts" clears.
  const [trustTagFilter, setTrustTagFilter] = useState("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const tag = new URL(window.location.href).searchParams.get("trust_tag");
    setTrustTagFilter(tag ?? "");
  }, []);
  const applyTrustTag = (entityId: string) => {
    setTrustTagFilter(entityId);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (entityId) url.searchParams.set("trust_tag", entityId);
    else url.searchParams.delete("trust_tag");
    window.history.replaceState({}, "", url);
  };
  const trustChips = useMemo(() => {
    if (!allMode) return [] as { id: string; name: string }[];
    const seen = new Map<string, string>();
    for (const id of [
      ...mergedNotices.map((notice) => notice.__entityId),
      ...mergedDigestReceipts.map((receipt) => receipt.__entityId),
    ]) {
      if (id && !seen.has(id)) {
        seen.set(id, entityNameById.get(id) ?? "Unknown entity");
      }
    }
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allMode, mergedNotices, mergedDigestReceipts, entityNameById]);

  // Unified accessors so the filter/count/render code below works the same way
  // in single- and all-entity mode. In single mode these fall back to the
  // composite center payload; in all mode they read the merged arrays.
  const notices = useMemo<TaggedNotice[]>(() => {
    if (!allMode) return center?.notices ?? [];
    return trustTagFilter
      ? mergedNotices.filter((notice) => notice.__entityId === trustTagFilter)
      : mergedNotices;
  }, [allMode, trustTagFilter, center?.notices, mergedNotices]);
  const digestReceipts = useMemo<TaggedDigestReceipt[]>(() => {
    if (!allMode) return center?.digest_receipts ?? [];
    return trustTagFilter
      ? mergedDigestReceipts.filter(
          (receipt) => receipt.__entityId === trustTagFilter,
        )
      : mergedDigestReceipts;
  }, [allMode, trustTagFilter, center?.digest_receipts, mergedDigestReceipts]);
  // In all-mode the center scalar payload is unavailable; treat presence of
  // fan-out data as "have something to show" for empty-state gating.
  const hasCenterData = allMode ? centerFanOut.data.length > 0 : Boolean(center);
  const centerLoading = allMode
    ? centerFanOut.isLoading
    : centerQuery.isLoading;
  const centerFetching = allMode
    ? centerFanOut.isFetching
    : centerQuery.isFetching;
  const noticeFilterCounts = useMemo(
    () =>
      Object.fromEntries(
        noticeFilters.map((filter) => [
          filter,
          notices.filter((notice) => matchesNoticeFilter(notice, filter))
            .length,
        ]),
      ) as Record<NoticeFilter, number>,
    [notices],
  );
  const noticeChannelFilterCounts = useMemo(
    () =>
      Object.fromEntries(
        noticeChannelFilters.map((filter) => [
          filter,
          notices.filter((notice) =>
            matchesNoticeChannelFilter(notice, filter),
          ).length,
        ]),
      ) as Record<DeliveryChannelFilter, number>,
    [notices],
  );
  const digestFilterCounts = useMemo(
    () =>
      Object.fromEntries(
        digestFilters.map((filter) => [
          filter,
          digestReceipts.filter((receipt) =>
            matchesDigestFilter(receipt, filter),
          ).length,
        ]),
      ) as Record<DigestFilter, number>,
    [digestReceipts],
  );
  const digestChannelFilterCounts = useMemo(
    () =>
      Object.fromEntries(
        digestChannelFilters.map((filter) => [
          filter,
          digestReceipts.filter((receipt) =>
            matchesDigestChannelFilter(receipt, filter),
          ).length,
        ]),
      ) as Record<DeliveryChannelFilter, number>,
    [digestReceipts],
  );
  const filteredNotices = useMemo(
    () =>
      notices.filter(
        (notice) =>
          matchesNoticeFilter(notice, noticeFilter) &&
          matchesNoticeChannelFilter(notice, noticeChannelFilter),
      ),
    [notices, noticeChannelFilter, noticeFilter],
  );
  const filteredDigestReceipts = useMemo(
    () =>
      digestReceipts.filter(
        (receipt) =>
          matchesDigestFilter(receipt, digestFilter) &&
          matchesDigestChannelFilter(receipt, digestChannelFilter),
      ),
    [digestReceipts, digestChannelFilter, digestFilter],
  );
  const providerReadinessCsvText = () => {
    // Channel readiness is org-level; in all-mode it comes from the first
    // entity's center (channelReadinessQuery), else the single-entity center.
    const guardrails = allMode
      ? channelReadinessQuery.data?.guardrails
      : center?.guardrails;
    if (!guardrails) {
      return "";
    }
    return providerReadinessCsv({
      channels: centerChannels,
      guardrails,
    });
  };
  const copyCsvToClipboard = async (csv: string) => {
    try {
      await navigator.clipboard.writeText(csv);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = csv;
      textArea.setAttribute("readonly", "true");
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
    }
  };
  const copyProviderReadinessCsv = async () => {
    const csv = providerReadinessCsvText();
    if (!csv) {
      return;
    }
    await copyCsvToClipboard(csv);
    setProviderReadinessCsvCopied(true);
  };
  const downloadProviderReadinessCsv = () => {
    const csv = providerReadinessCsvText();
    if (!csv) {
      return;
    }
    saveBlob(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      "work-notification-provider-readiness.csv",
    );
  };
  const reviewPacketCsv = () => {
    if (allMode) {
      return workNotificationReviewPacketCsv({
        entityName: "All entities",
        generatedAt: null,
        guardrails: channelReadinessQuery.data?.guardrails ?? [],
        notices: mergedNotices,
        digestReceipts: mergedDigestReceipts,
      });
    }
    if (!center) {
      return "";
    }
    return workNotificationReviewPacketCsv({
      entityName: selectedEntity?.name,
      generatedAt: center.generated_at,
      guardrails: center.guardrails,
      notices: center.notices,
      digestReceipts: center.digest_receipts,
    });
  };
  const copyReviewPacket = async () => {
    const csv = reviewPacketCsv();
    if (!csv) {
      return;
    }
    await copyCsvToClipboard(csv);
    setReviewPacketCopied(true);
  };
  const downloadReviewPacketCsv = () => {
    const csv = reviewPacketCsv();
    if (!csv) {
      return;
    }
    saveBlob(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      "work-notification-review-packet.csv",
    );
  };
  // Count-card values sum cleanly across entities (they are per-entity scalar
  // totals), so all-mode adds them up from the fan-out centers.
  const countTotals = useMemo(() => {
    if (allMode) {
      return centerFanOut.data.reduce(
        (totals, entityCenter) => ({
          unread: totals.unread + entityCenter.unread_count,
          attention: totals.attention + entityCenter.attention_count,
          ready: totals.ready + entityCenter.ready_count,
          inFlight: totals.inFlight + entityCenter.in_flight_count,
          done: totals.done + entityCenter.done_count,
          digestReceipts:
            totals.digestReceipts + entityCenter.digest_receipt_count,
        }),
        {
          unread: 0,
          attention: 0,
          ready: 0,
          inFlight: 0,
          done: 0,
          digestReceipts: 0,
        },
      );
    }
    return {
      unread: center?.unread_count ?? 0,
      attention: center?.attention_count ?? 0,
      ready: center?.ready_count ?? 0,
      inFlight: center?.in_flight_count ?? 0,
      done: center?.done_count ?? 0,
      digestReceipts: center?.digest_receipt_count ?? 0,
    };
  }, [allMode, center, centerFanOut.data]);
  const noticeTotalCount = useMemo(
    () =>
      allMode
        ? centerFanOut.data.reduce(
            (total, entityCenter) => total + entityCenter.notice_count,
            0,
          )
        : (center?.notice_count ?? 0),
    [allMode, center?.notice_count, centerFanOut.data],
  );
  const desktopDescription = allMode
    ? `${noticeTotalCount} work notices and ${countTotals.digestReceipts} digest receipts across every entity.`
    : selectedEntity
      ? `Work notices and digest receipts — ${notices.length} need you, the rest are receipts.`
      : "Choose an entity to review work notices and digest receipts.";
  const mobileDescription =
    allMode || selectedEntity
      ? `${noticeTotalCount} ${
          noticeTotalCount === 1 ? "needs you" : "need you"
        } · rest are receipts`
      : "Choose an entity to review receipts";
  const headerActions = (
    <>
      {hasCenterData ? (
        <StatusBadge tone={countTotals.unread ? "primary" : "neutral"}>
          {countTotals.unread} unread
        </StatusBadge>
      ) : null}
      <SecondaryButton
        type="button"
        disabled={
          countTotals.unread === 0 || markReadMutation.isPending
        }
        onClick={() => markReadMutation.mutate()}
      >
        <CheckCircle2 size={15} />
        Mark reviewed
      </SecondaryButton>
      {hasCenterData ? (
        <ExportMenu
          actions={[
            {
              key: "copy-review-packet",
              label: "Copy review packet",
              icon: <ClipboardCopy size={14} />,
              onSelect: () => void copyReviewPacket(),
            },
            {
              key: "download-review-packet",
              label: "Download review packet CSV",
              icon: <Download size={14} />,
              onSelect: downloadReviewPacketCsv,
            },
            {
              key: "copy-readiness",
              label: "Copy readiness CSV",
              icon: <ClipboardCopy size={14} />,
              onSelect: () => void copyProviderReadinessCsv(),
            },
            {
              key: "download-readiness",
              label: "Download readiness CSV",
              icon: <Download size={14} />,
              onSelect: downloadProviderReadinessCsv,
            },
          ]}
        />
      ) : null}
      <SecondaryButton
        type="button"
        disabled={!selectedEntityId || centerFetching}
        onClick={() => (allMode ? centerFanOut.refetch() : centerQuery.refetch())}
      >
        <RefreshCw
          size={15}
          className={centerFetching ? "animate-spin" : ""}
        />
        Refresh
      </SecondaryButton>
    </>
  );
  return (
    <main className="min-h-screen">
      <AppHeader />

      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-5">
        <section className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <PageTitle className="text-[21px] leading-7 md:text-3xl md:leading-9">
              Notifications
            </PageTitle>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground md:mt-1.5 md:text-sm">
              <span className="md:hidden">{mobileDescription}</span>
              <span className="hidden md:inline">{desktopDescription}</span>
            </p>
          </div>
          <div className="hidden flex-wrap items-center gap-2 md:flex">
            {headerActions}
          </div>
        </section>

        {reviewPacketCopied ? (
          <div
            role="status"
            className="rounded-full bg-success-soft px-4 py-2 text-sm font-semibold text-success md:w-fit"
          >
            Review packet copied
          </div>
        ) : null}
        {providerReadinessCsvCopied ? (
          <div
            role="status"
            className="rounded-full bg-success-soft px-4 py-2 text-sm font-semibold text-success md:w-fit"
          >
            Readiness CSV copied
          </div>
        ) : null}

        <section aria-label="Notification channel health" className="grid gap-3">
          <MobileChannelChips channels={centerChannels} />
          <HorizonChannelCards channels={centerChannels} />
          {centerChannels.length ? (
            <ProviderSetupChecks channels={centerChannels} />
          ) : null}
          {allMode ? (
            <div className="hidden rounded-2xl border border-border bg-white px-4 py-3 text-sm text-muted-foreground shadow-leasiumXs md:block">
              Channel readiness and provider setup are shown when a single
              entity is selected.
            </div>
          ) : null}
        </section>

        {allMode && trustChips.length > 1 ? (
          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label="Filter notifications by trust"
          >
            <button
              type="button"
              onClick={() => applyTrustTag("")}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                trustTagFilter
                  ? "text-muted-foreground hover:bg-muted hover:text-foreground"
                  : "bg-foreground text-white"
              }`}
            >
              All trusts
            </button>
            {trustChips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => applyTrustTag(chip.id)}
                className={`max-w-full truncate rounded-full px-3 py-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                  trustTagFilter === chip.id
                    ? "bg-primary-soft text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {chip.name}
              </button>
            ))}
          </div>
        ) : null}

        <NotificationsMobileSummary
          allMode={allMode}
          centerLoading={centerLoading}
          entityNameById={entityNameById}
          filteredDigestReceipts={filteredDigestReceipts}
          filteredNotices={filteredNotices}
          hasCenterData={hasCenterData}
          retryDigestMutationPending={retryDigestMutation.isPending}
          retryDigestVariables={retryDigestMutation.variables}
          sendNoticeMutationPending={sendNoticeMutation.isPending}
          sendNoticeVariables={sendNoticeMutation.variables}
          sendSmsNoticeMutationPending={sendSmsNoticeMutation.isPending}
          sendSmsNoticeVariables={sendSmsNoticeMutation.variables}
          onRetryDigest={(receipt) => retryDigestMutation.mutate(receipt)}
          onSend={(notice) => sendNoticeMutation.mutate(notice)}
          onSendSms={(notice) => sendSmsNoticeMutation.mutate(notice)}
        />

        <SectionPanel
          className="hidden md:block"
          title={`NEEDS YOU — ${filteredNotices.length}`}
          description="Work notice center"
          icon={<Bell size={17} className="text-primary" />}
          actions={
            hasCenterData ? (
              <StatusBadge tone="neutral">
                {noticeTotalCount}{" "}
                {noticeTotalCount === 1 ? "notice" : "notices"}
              </StatusBadge>
            ) : null
          }
        >
          {centerGuardrails.length ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
              <span>{centerGuardrails[0]}</span>
              <span>
                {centerLastReadAt
                  ? `Reviewed ${formatDateTime(centerLastReadAt)}`
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
                key={`${notice.__entityId ?? ""}-${notice.target_type}-${notice.target_id}`}
                isSending={
                  sendNoticeMutation.isPending &&
                  sendNoticeMutation.variables?.target_id === notice.target_id
                }
                isSendingSms={
                  sendSmsNoticeMutation.isPending &&
                  sendSmsNoticeMutation.variables?.target_id === notice.target_id
                }
                notice={notice}
                allMode={allMode}
                entityName={
                  notice.__entityId
                    ? entityNameById.get(notice.__entityId)
                    : null
                }
                onSend={(nextNotice) => sendNoticeMutation.mutate(nextNotice)}
                onSendSms={(nextNotice) =>
                  sendSmsNoticeMutation.mutate(nextNotice)
                }
              />
            ))}
            {!centerLoading &&
            hasCenterData &&
            filteredNotices.length === 0 ? (
              <EmptyState
                icon={<Bell size={18} />}
                title="No matching work notices"
                description="Change the notice filter to review another receipt state."
              />
            ) : null}
          </div>
        </SectionPanel>

        <SectionPanel
          className="hidden md:block"
          title="RECEIPTS — QUIET"
          description="Digest history and provider receipts that do not need an operator action."
          icon={<MailCheck size={17} className="text-primary" />}
          actions={
            hasCenterData ? (
              <StatusBadge tone="neutral">
                {countTotals.digestReceipts} receipts
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
                  key={`${receipt.__entityId ?? ""}-${receipt.assignee_user_id}-${receipt.generated_at}`}
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
                      {allMode ? (
                        <div className="mt-0.5 text-leasium-micro font-semibold uppercase text-muted-foreground">
                          {receipt.__entityId
                            ? (entityNameById.get(receipt.__entityId) ??
                              "Unknown entity")
                            : "Unknown entity"}
                        </div>
                      ) : null}
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
                    <div>
                      <span className="font-semibold text-foreground">
                        Next action:
                      </span>{" "}
                      {digestNextAction(receipt)}
                    </div>
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
                  {receipt.channel_receipts.length > 0 ? (
                    <ReceiptEvidenceDisclosure
                      receipt={receipt.channel_receipts[0]}
                    />
                  ) : null}
                  <MessagePreviewDisclosure
                    preview={receipt.rendered_message_preview}
                  />
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
                        disabled={retryDigestMutation.isPending}
                        onClick={() => retryDigestMutation.mutate(receipt)}
                      >
                        <Send size={14} />
                        {retryDigestMutation.isPending
                          ? "Sending…"
                          : digestRecoveryLabel(receipt)}
                      </SecondaryButton>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {!centerLoading &&
            hasCenterData &&
            filteredDigestReceipts.length === 0 ? (
              <EmptyState
                icon={<MailCheck size={18} />}
                title="No matching digest receipts"
                description="Change the digest filter to review another delivery state."
              />
            ) : null}
          </div>
        </SectionPanel>

        <div className="hidden md:block">
          <NotificationTrustRibbon />
        </div>

        <div className="hidden justify-end md:flex">
          <Link
            href="/operations"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border-strong bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
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
