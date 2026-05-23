"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  Building2,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileWarning,
  HandCoins,
  History,
  Link2,
  MailCheck,
  Plus,
  RefreshCw,
  ReceiptText,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { InlineEditCell } from "@/components/inline-edit-cell";
import { QueryProvider } from "@/components/query-provider";
import { SavedViewsMenu } from "@/components/saved-views-menu";
import {
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SecondaryButton,
  SectionPanel,
  Select,
  StatusBadge,
} from "@/components/ui";
import {
  type ArrearsCaseRecord,
  type ArrearsCaseStatus,
  type ArrearsDisputeStatus,
  type ArrearsEscalationStatus,
  createArrearsCase,
  createMaintenanceWorkOrder,
  type DocumentIntakeRecord,
  type InvoiceDraftRecord,
  listArrearsCases,
  listDocumentIntakes,
  listEntities,
  listInvoiceDrafts,
  listMaintenanceWorkOrders,
  listObligations,
  listProperties,
  getSecurityWorkspace,
  listTenantOnboardings,
  listTenants,
  runWorkAssignmentDigest,
  type MaintenancePriority,
  type MaintenanceWorkOrderRecord,
  type MaintenanceWorkOrderStatus,
  type ObligationRecord,
  type PropertyRecord,
  type SecurityMemberRecord,
  type TenantOnboardingRecord,
  type TenantRecord,
  sendArrearsAssignmentNotification,
  sendMaintenanceWorkOrderAssignmentNotification,
  sendObligationAssignmentNotification,
  updateArrearsCase,
  updateMaintenanceWorkOrder,
  updateObligation,
  type WorkAssignmentDigestCadence,
  type WorkAssignmentDigestRunRecord,
  type WorkAssignmentRenderedMessagePreviewRecord,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const ENTITY_STORAGE_KEY = "leasium.entity_id";
const EMPTY_PROPERTIES: PropertyRecord[] = [];
const EMPTY_TENANTS: TenantRecord[] = [];
const EMPTY_OBLIGATIONS: ObligationRecord[] = [];
const EMPTY_ONBOARDINGS: TenantOnboardingRecord[] = [];
const EMPTY_INTAKES: DocumentIntakeRecord[] = [];
const EMPTY_MAINTENANCE: MaintenanceWorkOrderRecord[] = [];
const EMPTY_ARREARS: ArrearsCaseRecord[] = [];
const EMPTY_INVOICE_DRAFTS: InvoiceDraftRecord[] = [];
const EMPTY_MEMBERS: SecurityMemberRecord[] = [];
const WORK_ASSIGNMENT_KEY = "work_assignment";
const WORK_ASSIGNMENT_TEMPLATE_KEY = "work_assignment_notification";
const WORK_ASSIGNMENT_TEMPLATE_VERSION = "v1";

const tabs = [
  { id: "queue", label: "Queue", description: "All operational work" },
  {
    id: "maintenance",
    label: "Maintenance",
    description: "Repairs and approvals",
  },
  { id: "arrears", label: "Arrears", description: "Balances and escalation" },
] as const;

const maintenanceStatuses: MaintenanceWorkOrderStatus[] = [
  "requested",
  "triaged",
  "assigned",
  "awaiting_approval",
  "approved",
  "in_progress",
  "completed",
  "cancelled",
];

const maintenancePriorities: MaintenancePriority[] = [
  "low",
  "normal",
  "high",
  "urgent",
];
const arrearsStatuses: ArrearsCaseStatus[] = [
  "monitoring",
  "active",
  "resolved",
  "written_off",
  "closed",
];
const disputeStatuses: ArrearsDisputeStatus[] = [
  "none",
  "raised",
  "under_review",
  "resolved",
  "escalated",
];
const escalationStatuses: ArrearsEscalationStatus[] = [
  "none",
  "queued",
  "in_progress",
  "referred",
  "closed",
];

type OperationsTab = (typeof tabs)[number]["id"];
type Tone = "neutral" | "success" | "warning" | "danger" | "primary";

type QueueItem =
  | {
      id: string;
      kind: "obligation";
      title: string;
      description: string;
      dueDate: string | null;
      tone: Tone;
      chip: string;
      href: string;
      record: ObligationRecord;
      completed: boolean;
    }
  | {
      id: string;
      kind: "onboarding";
      title: string;
      description: string;
      dueDate: string | null;
      tone: Tone;
      chip: string;
      href: string;
      record: TenantOnboardingRecord;
      completed: boolean;
    }
  | {
      id: string;
      kind: "document_intake";
      title: string;
      description: string;
      dueDate: string | null;
      tone: Tone;
      chip: string;
      href: string;
      record: DocumentIntakeRecord;
      completed: boolean;
    }
  | {
      id: string;
      kind: "maintenance";
      title: string;
      description: string;
      dueDate: string | null;
      tone: Tone;
      chip: string;
      href: string;
      record: MaintenanceWorkOrderRecord;
      completed: boolean;
    }
  | {
      id: string;
      kind: "arrears";
      title: string;
      description: string;
      dueDate: string | null;
      tone: Tone;
      chip: string;
      href: string;
      record: ArrearsCaseRecord;
      completed: boolean;
    };

type AssignableQueueItem = Extract<
  QueueItem,
  { kind: "obligation" | "maintenance" | "arrears" }
>;

type WorkAssignmentHistoryEntry = {
  event: string;
  at: string | null;
  actor_name: string | null;
  assigned_user_name: string | null;
  assigned_user_email: string | null;
  summary: string | null;
  notification_status: string | null;
};

type WorkAssignment = {
  assignedUserId: string | null;
  assignedName: string | null;
  assignedEmail: string | null;
  assignedRole: string | null;
  assignedAt: string | null;
  assignedByName: string | null;
  reminderStatus: string | null;
  reminderDueOn: string | null;
  reminderDetail: string | null;
  escalationStatus: string | null;
  escalationDueOn: string | null;
  escalationRule: string | null;
  notificationStatus: string | null;
  notificationDetail: string | null;
  history: WorkAssignmentHistoryEntry[];
};

type AssigneeFilter =
  | "all"
  | "unassigned"
  | "me"
  | "follow_up"
  | `member:${string}`;
type WorkAssignmentAction = "reminder_logged" | "escalation_queued";
type AssignmentNoticeGroup = "ready" | "in_flight" | "attention" | "done";

type AssignmentNoticeInboxItem = {
  id: string;
  href: string;
  title: string;
  group: AssignmentNoticeGroup;
  tone: Tone;
  statusLabel: string;
  summary: string;
  meta: string;
  at: string | null;
};

const ASSIGNMENT_EMAIL_DELIVERED_STATUSES = [
  "queued",
  "sent",
  "delivered",
  "opened",
];
const ASSIGNMENT_EMAIL_PROBLEM_STATUSES = ["failed", "skipped"];

function assignmentEmailDelivered(assignment: WorkAssignment | null) {
  return ASSIGNMENT_EMAIL_DELIVERED_STATUSES.includes(
    assignment?.notificationStatus ?? "",
  );
}

function assignmentEmailProblem(assignment: WorkAssignment | null) {
  return ASSIGNMENT_EMAIL_PROBLEM_STATUSES.includes(
    assignment?.notificationStatus ?? "",
  );
}

function assignmentEmailReady(assignment: WorkAssignment | null) {
  return Boolean(
    assignment?.assignedEmail && assignment.notificationStatus === "ready",
  );
}

function assignmentNoticeGroup(
  assignment: WorkAssignment | null,
): AssignmentNoticeGroup | null {
  if (!assignment || (!assignment.assignedUserId && !assignment.assignedName)) {
    return null;
  }
  const status = assignment.notificationStatus ?? "";
  if (assignmentEmailReady(assignment)) {
    return "ready";
  }
  if (assignmentEmailProblem(assignment)) {
    return "attention";
  }
  if (["queued", "sent"].includes(status)) {
    return "in_flight";
  }
  if (["delivered", "opened"].includes(status)) {
    return "done";
  }
  return null;
}

function assignmentNoticeTone(group: AssignmentNoticeGroup): Tone {
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

function assignmentNoticeLabel(group: AssignmentNoticeGroup) {
  if (group === "in_flight") {
    return "In flight";
  }
  return label(group);
}

function assignmentNoticeInboxItem(
  item: AssignableQueueItem,
): AssignmentNoticeInboxItem | null {
  const assignment = workAssignment(item.record.metadata);
  const group = assignmentNoticeGroup(assignment);
  if (!assignment || !group) {
    return null;
  }
  const latestHistory = assignment.history[0];
  const at = latestHistory?.at ?? assignment.assignedAt;
  const statusLabel =
    assignment.notificationStatus === "ready"
      ? "Ready"
      : assignment.notificationStatus
        ? label(assignment.notificationStatus)
        : assignmentNoticeLabel(group);
  const summary =
    latestHistory?.summary ??
    assignment.notificationDetail ??
    (group === "ready"
      ? "Assignment notice is ready."
      : "Assignment notice updated.");
  const meta = [
    assignment.assignedName,
    at ? formatDateTime(at) : null,
    assignment.assignedEmail,
  ]
    .filter(Boolean)
    .join(" - ");

  return {
    id: item.id,
    href: item.href,
    title: item.title,
    group,
    tone: assignmentNoticeTone(group),
    statusLabel,
    summary,
    meta,
    at,
  };
}

type MaintenanceFormState = {
  title: string;
  description: string;
  property_id: string;
  tenant_id: string;
  priority: MaintenancePriority;
  status: MaintenanceWorkOrderStatus;
  due_date: string;
  contractor_name: string;
  contractor_email: string;
  contractor_phone: string;
  quote_amount: string;
  approval_limit: string;
  approval_notes: string;
  approval_required: boolean;
  source_reference: string;
  invoice_reference: string;
  invoice_amount: string;
  notes: string;
};

type ArrearsFormState = {
  tenant_id: string;
  status: ArrearsCaseStatus;
  balance_current: string;
  balance_1_30: string;
  balance_31_60: string;
  balance_61_90: string;
  balance_90_plus: string;
  next_reminder_on: string;
  dispute_status: ArrearsDisputeStatus;
  escalation_status: ArrearsEscalationStatus;
  promise_to_pay_date: string;
  promise_to_pay_amount: string;
  notes: string;
};

const emptyMaintenanceForm: MaintenanceFormState = {
  title: "",
  description: "",
  property_id: "",
  tenant_id: "",
  priority: "normal",
  status: "requested",
  due_date: "",
  contractor_name: "",
  contractor_email: "",
  contractor_phone: "",
  quote_amount: "",
  approval_limit: "",
  approval_notes: "",
  approval_required: false,
  source_reference: "",
  invoice_reference: "",
  invoice_amount: "",
  notes: "",
};

const emptyArrearsForm: ArrearsFormState = {
  tenant_id: "",
  status: "active",
  balance_current: "",
  balance_1_30: "",
  balance_31_60: "",
  balance_61_90: "",
  balance_90_plus: "",
  next_reminder_on: "",
  dispute_status: "none",
  escalation_status: "none",
  promise_to_pay_date: "",
  promise_to_pay_amount: "",
  notes: "",
};

function friendlyError(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function dateOnly(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function optionalString(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function dollarsToCents(value: string) {
  const cleaned = value.replace(/[^0-9.-]/g, "");
  const amount = Number.parseFloat(cleaned);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function dueRank(value: string | null | undefined) {
  if (!value) {
    return 9999;
  }
  const today = new Date(dateOnly(new Date())).getTime();
  const due = new Date(`${value.slice(0, 10)}T00:00:00`).getTime();
  return Math.ceil((due - today) / 86_400_000);
}

function dueLabel(value: string | null | undefined) {
  const days = dueRank(value);
  if (!value) {
    return "No date";
  }
  if (days < 0) {
    return `${Math.abs(days)}d overdue`;
  }
  if (days === 0) {
    return "Today";
  }
  if (days === 1) {
    return "Tomorrow";
  }
  if (days < 31) {
    return `In ${days}d`;
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
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

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "No date";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatMoney(cents: number | null | undefined, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format((cents ?? 0) / 100);
}

function label(value: string | null | undefined) {
  return value ? value.replaceAll("_", " ") : "None";
}

function propertyName(
  properties: PropertyRecord[],
  propertyId: string | null | undefined,
) {
  return (
    properties.find((property) => property.id === propertyId)?.name ??
    "No property"
  );
}

function tenantName(
  tenants: TenantRecord[],
  tenantId: string | null | undefined,
) {
  const tenant = tenants.find((item) => item.id === tenantId);
  return tenant?.trading_name || tenant?.legal_name || "No tenant";
}

function invoiceDraftLabel(draft: InvoiceDraftRecord) {
  return [
    draft.invoice_number || draft.title,
    draft.recipient_name,
    formatMoney(draft.total_cents, draft.currency),
    label(draft.status),
  ]
    .filter(Boolean)
    .join(" - ");
}

function invoiceDraftName(
  drafts: InvoiceDraftRecord[],
  invoiceDraftId: string | null,
) {
  if (!invoiceDraftId) {
    return null;
  }
  const draft = drafts.find((item) => item.id === invoiceDraftId);
  return draft ? invoiceDraftLabel(draft) : "Linked invoice draft";
}

type MaintenanceActivityEntry = {
  at?: string;
  timestamp?: string;
  event?: string;
  action?: string;
  actor?: string;
  source?: string;
  status?: string;
  summary?: string;
  visibility?: string;
};

type MaintenanceTimelineEntry = {
  at: string;
  label: string;
  detail: string;
  meta: string[];
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function workAssignmentHistory(raw: unknown): WorkAssignmentHistoryEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(isPlainRecord).map((entry) => ({
    event: stringValue(entry, "event") ?? "assigned",
    at: stringValue(entry, "at"),
    actor_name: stringValue(entry, "actor_name"),
    assigned_user_name: stringValue(entry, "assigned_user_name"),
    assigned_user_email: stringValue(entry, "assigned_user_email"),
    summary: stringValue(entry, "summary"),
    notification_status: stringValue(entry, "notification_status"),
  }));
}

function workAssignment(
  metadata: Record<string, unknown> | null | undefined,
): WorkAssignment | null {
  const raw = metadata?.[WORK_ASSIGNMENT_KEY];
  if (!isPlainRecord(raw)) {
    return null;
  }
  const notification = isPlainRecord(raw.notification) ? raw.notification : {};
  const reminder = isPlainRecord(raw.reminder) ? raw.reminder : {};
  const escalation = isPlainRecord(raw.escalation) ? raw.escalation : {};
  const assignedUserId = stringValue(raw, "assigned_user_id");
  const assignedName = stringValue(raw, "assigned_user_name");
  const history = workAssignmentHistory(raw.history);
  if (!assignedUserId && !assignedName && history.length === 0) {
    return null;
  }
  return {
    assignedUserId,
    assignedName,
    assignedEmail: stringValue(raw, "assigned_user_email"),
    assignedRole: stringValue(raw, "assigned_role"),
    assignedAt: stringValue(raw, "assigned_at"),
    assignedByName: stringValue(raw, "assigned_by_name"),
    reminderStatus: stringValue(reminder, "status"),
    reminderDueOn: stringValue(reminder, "due_on"),
    reminderDetail: stringValue(reminder, "detail"),
    escalationStatus: stringValue(escalation, "status"),
    escalationDueOn: stringValue(escalation, "due_on"),
    escalationRule: stringValue(escalation, "rule"),
    notificationStatus: stringValue(notification, "status"),
    notificationDetail: stringValue(notification, "detail"),
    history,
  };
}

function memberEntityRole(member: SecurityMemberRecord, entityId: string) {
  return member.roles.find((role) => role.entity_id === entityId)?.role ?? null;
}

function memberLabel(member: SecurityMemberRecord) {
  return member.display_name || member.email;
}

function memberCanReceiveWork(member: SecurityMemberRecord, entityId: string) {
  const role = memberEntityRole(member, entityId);
  return Boolean(member.is_active && role && role !== "viewer");
}

function isAssignableQueueItem(item: QueueItem): item is AssignableQueueItem {
  return (
    item.kind === "obligation" ||
    item.kind === "maintenance" ||
    item.kind === "arrears"
  );
}

function assignedUserId(item: QueueItem) {
  if (!isAssignableQueueItem(item)) {
    return null;
  }
  return (
    workAssignment(item.record.metadata)?.assignedUserId ??
    (item.kind === "arrears" ? item.record.assigned_user_id : null)
  );
}

function assignedUserName(item: QueueItem) {
  if (!isAssignableQueueItem(item)) {
    return null;
  }
  return workAssignment(item.record.metadata)?.assignedName ?? null;
}

function memberAssigneeFilter(memberId: string): AssigneeFilter {
  return `member:${memberId}`;
}

function matchesAssigneeFilter(
  item: QueueItem,
  filter: AssigneeFilter,
  currentUserId: string | null | undefined,
) {
  if (filter === "all") {
    return true;
  }
  if (!isAssignableQueueItem(item)) {
    return false;
  }
  const userId = assignedUserId(item);
  const userName = assignedUserName(item);
  if (filter === "unassigned") {
    return !userId && !userName;
  }
  if (filter === "me") {
    return Boolean(currentUserId && userId === currentUserId);
  }
  if (filter === "follow_up") {
    return assignmentFollowUpDue(workAssignment(item.record.metadata));
  }
  return userId === filter.replace("member:", "");
}

function assignmentFollowUpDue(assignment: WorkAssignment | null) {
  if (!assignment || (!assignment.assignedUserId && !assignment.assignedName)) {
    return false;
  }
  if (assignment.reminderStatus === "due") {
    return true;
  }
  if (
    assignment.reminderDueOn &&
    dueRank(assignment.reminderDueOn) <= 0 &&
    !["logged", "skipped"].includes(assignment.reminderStatus ?? "")
  ) {
    return true;
  }
  return Boolean(
    assignment.escalationDueOn &&
    dueRank(assignment.escalationDueOn) <= 0 &&
    !["queued", "skipped", "resolved"].includes(
      assignment.escalationStatus ?? "",
    ),
  );
}

function assignmentActionMetadata({
  metadata,
  action,
  currentUser,
}: {
  metadata: Record<string, unknown>;
  action: WorkAssignmentAction;
  currentUser:
    | { id: string; email: string; display_name: string }
    | null
    | undefined;
}) {
  const raw = metadata[WORK_ASSIGNMENT_KEY];
  if (!isPlainRecord(raw)) {
    return null;
  }

  const now = new Date().toISOString();
  const actorName =
    currentUser?.display_name || currentUser?.email || "Leasium operator";
  const reminder = isPlainRecord(raw.reminder) ? raw.reminder : {};
  const escalation = isPlainRecord(raw.escalation) ? raw.escalation : {};
  const notification = isPlainRecord(raw.notification) ? raw.notification : {};
  const existingHistory = workAssignmentHistory(raw.history);
  const assignedName = stringValue(raw, "assigned_user_name");

  const actionSummary =
    action === "reminder_logged"
      ? `In-app assignment reminder logged${assignedName ? ` for ${assignedName}` : ""}.`
      : `Assignment escalation queued${assignedName ? ` for ${assignedName}` : ""}.`;
  const historyEntry = {
    event: action,
    at: now,
    actor_user_id: currentUser?.id ?? null,
    actor_name: actorName,
    assigned_user_id: stringValue(raw, "assigned_user_id"),
    assigned_user_name: assignedName,
    assigned_user_email: stringValue(raw, "assigned_user_email"),
    notification_status: stringValue(notification, "status"),
    summary: actionSummary,
  };

  return {
    ...metadata,
    [WORK_ASSIGNMENT_KEY]: {
      ...raw,
      reminder:
        action === "reminder_logged"
          ? {
              ...reminder,
              status: "logged",
              due_on: null,
              logged_at: now,
              logged_by_user_id: currentUser?.id ?? null,
              logged_by_name: actorName,
              detail:
                "In-app assignment reminder was logged. Provider email/SMS was not sent.",
            }
          : reminder,
      escalation:
        action === "escalation_queued"
          ? {
              ...escalation,
              status: "queued",
              queued_at: now,
              queued_by_user_id: currentUser?.id ?? null,
              queued_by_name: actorName,
              rule:
                stringValue(escalation, "rule") ??
                "Escalation queued by the operator.",
            }
          : escalation,
      history: [historyEntry, ...existingHistory].slice(0, 10),
    },
  };
}

function assignmentWorkflowPlan({
  assignee,
  dueDate,
  tone,
  now,
}: {
  assignee: SecurityMemberRecord | null;
  dueDate: string | null | undefined;
  tone: Tone;
  now: Date;
}) {
  if (!assignee) {
    return {
      reminder: {
        status: "skipped",
        due_on: null,
        detail: "Assignment was cleared; no reminder is scheduled.",
      },
      escalation: {
        status: "skipped",
        due_on: null,
        rule: "No assignee is watching this work.",
      },
    };
  }

  const dueDays = dueRank(dueDate);
  const reminderDueOn =
    tone === "danger" || dueDays <= 0
      ? dateOnly(now)
      : tone === "warning" || dueDays <= 2
        ? dateOnly(addDays(now, 1))
        : dateOnly(addDays(now, 2));
  const escalationDueOn =
    dueDays < 0
      ? dateOnly(addDays(now, 1))
      : dueDate
        ? dateOnly(addDays(new Date(`${dueDate.slice(0, 10)}T00:00:00`), 1))
        : dateOnly(addDays(now, 3));

  return {
    reminder: {
      channel: "in_app",
      provider: "leasium",
      status: dueRank(reminderDueOn) <= 0 ? "due" : "scheduled",
      due_on: reminderDueOn,
      detail:
        "In-app reminder plan only. Provider email/SMS delivery is a separate approval step.",
    },
    escalation: {
      channel: "in_app",
      provider: "leasium",
      status: "watching",
      due_on: escalationDueOn,
      rule: "Flag for escalation if this assigned work is still open after the watched date.",
    },
  };
}

function assignmentMetadata({
  metadata,
  assignee,
  currentUser,
  entityId,
  title,
  kind,
  dueDate,
  tone,
}: {
  metadata: Record<string, unknown>;
  assignee: SecurityMemberRecord | null;
  currentUser:
    | { id: string; email: string; display_name: string }
    | null
    | undefined;
  entityId: string;
  title: string;
  kind: string;
  dueDate: string | null | undefined;
  tone: Tone;
}) {
  const now = new Date().toISOString();
  const nowDate = new Date(now);
  const existing = workAssignment(metadata);
  const existingHistory = existing?.history ?? [];
  const actorName =
    currentUser?.display_name || currentUser?.email || "Leasium operator";
  const assigneeName = assignee ? memberLabel(assignee) : null;
  const notificationStatus = assignee ? "ready" : "skipped";
  const workflowPlan = assignmentWorkflowPlan({
    assignee,
    dueDate,
    tone,
    now: nowDate,
  });
  const summary = assigneeName
    ? `${kind} assigned to ${assigneeName}.`
    : `${kind} assignment cleared.`;
  const historyEntry = {
    event: assignee ? "assigned" : "cleared",
    at: now,
    actor_user_id: currentUser?.id ?? null,
    actor_name: actorName,
    assigned_user_id: assignee?.id ?? null,
    assigned_user_name: assigneeName,
    assigned_user_email: assignee?.email ?? null,
    notification_status: notificationStatus,
    summary,
  };

  return {
    ...metadata,
    [WORK_ASSIGNMENT_KEY]: {
      assigned_user_id: assignee?.id ?? null,
      assigned_user_name: assigneeName,
      assigned_user_email: assignee?.email ?? null,
      assigned_role: assignee ? memberEntityRole(assignee, entityId) : null,
      assigned_at: now,
      assigned_by_user_id: currentUser?.id ?? null,
      assigned_by_name: actorName,
      work_title: title,
      work_kind: kind,
      reminder: workflowPlan.reminder,
      escalation: workflowPlan.escalation,
      notification: {
        channel: "in_app",
        provider: "leasium",
        status: notificationStatus,
        recipient_email: assignee?.email ?? null,
        template_key: WORK_ASSIGNMENT_TEMPLATE_KEY,
        template_version: WORK_ASSIGNMENT_TEMPLATE_VERSION,
        prepared_at: now,
        detail: assignee
          ? "Assignment notification is ready inside Leasium. Provider email/SMS delivery is a separate approval step."
          : "Assignment was cleared; no notification was prepared.",
      },
      history: [historyEntry, ...existingHistory].slice(0, 10),
    },
  };
}

function obligationUpdateData(
  obligation: ObligationRecord,
  overrides: Parameters<typeof updateObligation>[1],
): Parameters<typeof updateObligation>[1] {
  return {
    entity_id: obligation.entity_id,
    property_id: obligation.property_id,
    tenancy_unit_id: obligation.tenancy_unit_id,
    lease_id: obligation.lease_id,
    title: obligation.title,
    category: obligation.category,
    status: obligation.status,
    due_date: obligation.due_date,
    priority: obligation.priority,
    owner_role: obligation.owner_role,
    notes: obligation.notes,
    metadata: obligation.metadata,
    completed_at: obligation.completed_at,
    ...overrides,
  };
}

function maintenanceActivity(workOrder: MaintenanceWorkOrderRecord) {
  const raw = workOrder.metadata?.activity_history;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter(isPlainRecord)
    .map(
      (entry): MaintenanceActivityEntry => ({
        at: typeof entry.at === "string" ? entry.at : undefined,
        timestamp:
          typeof entry.timestamp === "string" ? entry.timestamp : undefined,
        event: typeof entry.event === "string" ? entry.event : undefined,
        action: typeof entry.action === "string" ? entry.action : undefined,
        actor: typeof entry.actor === "string" ? entry.actor : undefined,
        source: typeof entry.source === "string" ? entry.source : undefined,
        status: typeof entry.status === "string" ? entry.status : undefined,
        summary: typeof entry.summary === "string" ? entry.summary : undefined,
        visibility:
          typeof entry.visibility === "string" ? entry.visibility : undefined,
      }),
    )
    .filter((entry) => entry.summary || entry.event || entry.action);
}

function activityMeta(entry: {
  actor?: string;
  source?: string;
  status?: string;
  visibility?: string;
}) {
  return [
    entry.visibility ? `${label(entry.visibility)} visible` : null,
    entry.status ? label(entry.status) : null,
    entry.source ? label(entry.source) : null,
    entry.actor ? entry.actor : null,
  ].filter((item): item is string => Boolean(item));
}

function obligationTone(obligation: ObligationRecord): Tone {
  const days = dueRank(obligation.due_date);
  if (["completed", "waived"].includes(obligation.status)) {
    return "success";
  }
  if (days < 0) {
    return "danger";
  }
  if (days <= 14 || obligation.priority <= 1) {
    return "warning";
  }
  return "neutral";
}

function onboardingTone(onboarding: TenantOnboardingRecord): Tone {
  if (["applied", "reviewed", "cancelled"].includes(onboarding.status)) {
    return "success";
  }
  if (onboarding.status === "submitted") {
    return "primary";
  }
  if (dueRank(onboarding.due_date) < 0) {
    return "danger";
  }
  if (dueRank(onboarding.due_date) <= 7) {
    return "warning";
  }
  return "neutral";
}

function intakeIsOpen(intake: DocumentIntakeRecord) {
  return [
    "uploaded",
    "reading",
    "ready_for_review",
    "needs_attention",
    "failed",
  ].includes(intake.status);
}

function intakeTone(intake: DocumentIntakeRecord): Tone {
  if (intake.status === "failed") {
    return "danger";
  }
  if (intake.status === "needs_attention") {
    return "warning";
  }
  if (intake.status === "ready_for_review") {
    return "primary";
  }
  return "neutral";
}

function maintenanceIsOpen(workOrder: MaintenanceWorkOrderRecord) {
  return !["completed", "cancelled"].includes(workOrder.status);
}

function maintenanceTone(workOrder: MaintenanceWorkOrderRecord): Tone {
  if (workOrder.status === "completed") {
    return "success";
  }
  if (workOrder.status === "cancelled") {
    return "neutral";
  }
  if (dueRank(workOrder.due_date) < 0 || workOrder.priority === "urgent") {
    return "danger";
  }
  if (
    workOrder.priority === "high" ||
    workOrder.approval_status === "pending" ||
    workOrder.status === "awaiting_approval"
  ) {
    return "warning";
  }
  return "neutral";
}

function arrearsIsOpen(arrearsCase: ArrearsCaseRecord) {
  return !["resolved", "written_off", "closed"].includes(arrearsCase.status);
}

function arrearsTone(arrearsCase: ArrearsCaseRecord): Tone {
  if (!arrearsIsOpen(arrearsCase)) {
    return "success";
  }
  if (
    arrearsCase.escalation_status === "queued" ||
    arrearsCase.escalation_status === "in_progress" ||
    arrearsCase.dispute_status === "escalated" ||
    (arrearsCase.next_reminder_on && dueRank(arrearsCase.next_reminder_on) < 0)
  ) {
    return "danger";
  }
  if (
    arrearsCase.total_balance_cents > 0 ||
    arrearsCase.dispute_status === "raised" ||
    arrearsCase.dispute_status === "under_review"
  ) {
    return "warning";
  }
  return "neutral";
}

function documentTypeLabel(value: string | null | undefined) {
  return value ? label(value) : "document";
}

function intakeChip(intake: DocumentIntakeRecord) {
  switch (intake.status) {
    case "failed":
      return "Could not read";
    case "needs_attention":
      return "Needs match";
    case "ready_for_review":
      return "Needs review";
    case "reading":
      return "Reading";
    default:
      return "Processing…";
  }
}

function intakeTitle(intake: DocumentIntakeRecord) {
  switch (intake.status) {
    case "failed":
      return "Document could not be read";
    case "needs_attention":
      return "Document needs match";
    case "ready_for_review":
      return "Document waiting for review";
    default:
      return "Document still processing";
  }
}

function queueKindLabel(task: QueueItem) {
  const labels: Record<QueueItem["kind"], string> = {
    obligation: "Critical date",
    onboarding: "Onboarding",
    document_intake: "Smart Intake",
    maintenance: "Maintenance",
    arrears: "Arrears",
  };
  return labels[task.kind];
}

function queueKindTone(task: QueueItem): Tone {
  if (task.kind === "document_intake" || task.kind === "arrears") {
    return "primary";
  }
  if (task.kind === "maintenance") {
    return "warning";
  }
  return "neutral";
}

function queueDateLabel(task: QueueItem) {
  if (task.kind === "document_intake") {
    return formatDateTime(task.dueDate);
  }
  return dueLabel(task.dueDate);
}

function buildQueueItems(
  obligations: ObligationRecord[],
  onboardings: TenantOnboardingRecord[],
  intakes: DocumentIntakeRecord[],
  workOrders: MaintenanceWorkOrderRecord[],
  arrearsCases: ArrearsCaseRecord[],
  properties: PropertyRecord[],
  tenants: TenantRecord[],
) {
  const obligationItems: QueueItem[] = obligations.map((obligation) => ({
    id: `obligation-${obligation.id}`,
    kind: "obligation",
    title: obligation.title,
    description: [
      label(obligation.category),
      obligation.owner_role ? `Owner: ${obligation.owner_role}` : null,
      obligation.notes,
    ]
      .filter(Boolean)
      .join(" - "),
    dueDate: obligation.due_date,
    tone: obligationTone(obligation),
    chip: label(obligation.status),
    href: "/properties",
    record: obligation,
    completed: ["completed", "waived"].includes(obligation.status),
  }));

  const onboardingItems: QueueItem[] = onboardings.map((onboarding) => ({
    id: `onboarding-${onboarding.id}`,
    kind: "onboarding",
    title:
      onboarding.status === "submitted"
        ? "Tenant onboarding ready for review"
        : "Tenant onboarding follow-up",
    description: [
      label(onboarding.status),
      onboarding.last_sent_at
        ? `Sent ${formatDateTime(onboarding.last_sent_at)}`
        : null,
    ]
      .filter(Boolean)
      .join(" - "),
    dueDate: onboarding.due_date,
    tone: onboardingTone(onboarding),
    chip: label(onboarding.status),
    href: "/tenants",
    record: onboarding,
    completed: ["applied", "reviewed", "cancelled"].includes(onboarding.status),
  }));

  const intakeItems: QueueItem[] = intakes
    .filter(intakeIsOpen)
    .map((intake) => ({
      id: `intake-${intake.id}`,
      kind: "document_intake",
      title: intakeTitle(intake),
      description: [
        `Smart Intake - ${documentTypeLabel(intake.document_type)}`,
        intake.filename,
        intake.summary,
      ]
        .filter(Boolean)
        .join(" - "),
      dueDate: intake.created_at,
      tone: intakeTone(intake),
      chip: intakeChip(intake),
      href: "/intake",
      record: intake,
      completed: false,
    }));

  const maintenanceItems: QueueItem[] = workOrders.map((workOrder) => ({
    id: `maintenance-${workOrder.id}`,
    kind: "maintenance",
    title: workOrder.title,
    description: [
      propertyName(properties, workOrder.property_id),
      tenantName(tenants, workOrder.tenant_id),
      workOrder.contractor_name
        ? `Contractor: ${workOrder.contractor_name}`
        : null,
    ]
      .filter(Boolean)
      .join(" - "),
    dueDate: workOrder.due_date,
    tone: maintenanceTone(workOrder),
    chip: `${label(workOrder.priority)} / ${label(workOrder.status)}`,
    href: "/operations",
    record: workOrder,
    completed: !maintenanceIsOpen(workOrder),
  }));

  const arrearsItems: QueueItem[] = arrearsCases.map((arrearsCase) => ({
    id: `arrears-${arrearsCase.id}`,
    kind: "arrears",
    title: `${tenantName(tenants, arrearsCase.tenant_id)} arrears`,
    description: [
      formatMoney(arrearsCase.total_balance_cents, arrearsCase.currency),
      propertyName(properties, arrearsCase.property_id),
      arrearsCase.dispute_status !== "none"
        ? `Dispute: ${label(arrearsCase.dispute_status)}`
        : null,
    ]
      .filter(Boolean)
      .join(" - "),
    dueDate: arrearsCase.next_reminder_on,
    tone: arrearsTone(arrearsCase),
    chip: `${label(arrearsCase.status)} / ${label(arrearsCase.escalation_status)}`,
    href: "/operations",
    record: arrearsCase,
    completed: !arrearsIsOpen(arrearsCase),
  }));

  const toneRank: Record<Tone, number> = {
    danger: 0,
    warning: 1,
    primary: 2,
    neutral: 3,
    success: 4,
  };

  return [
    ...obligationItems,
    ...onboardingItems,
    ...intakeItems,
    ...maintenanceItems,
    ...arrearsItems,
  ].sort((a, b) => {
    const toneDelta = toneRank[a.tone] - toneRank[b.tone];
    if (toneDelta !== 0) {
      return toneDelta;
    }
    const dueDelta = dueRank(a.dueDate) - dueRank(b.dueDate);
    if (dueDelta !== 0) {
      return dueDelta;
    }
    return a.title.localeCompare(b.title);
  });
}

function OperationsWorkspace() {
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [activeTab, setActiveTab] = useState<OperationsTab>("queue");
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>("all");
  const [maintenanceStatus, setMaintenanceStatus] = useState<
    MaintenanceWorkOrderStatus | "all"
  >("all");
  const [maintenancePriority, setMaintenancePriority] = useState<
    MaintenancePriority | "all"
  >("all");
  const [arrearsStatus, setArrearsStatus] = useState<ArrearsCaseStatus | "all">(
    "all",
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab && tabs.some((entry) => entry.id === tab)) {
      setActiveTab(tab as OperationsTab);
    }
    const assignee = params.get("assignee");
    if (
      assignee === "all" ||
      assignee === "unassigned" ||
      assignee === "me" ||
      assignee === "follow_up" ||
      (typeof assignee === "string" && assignee.startsWith("member:"))
    ) {
      setAssigneeFilter(assignee as AssigneeFilter);
    }
    const mStatus = params.get("maintenance_status");
    if (
      mStatus === "all" ||
      (mStatus && maintenanceStatuses.includes(mStatus as MaintenanceWorkOrderStatus))
    ) {
      setMaintenanceStatus(mStatus as MaintenanceWorkOrderStatus | "all");
    }
    const mPriority = params.get("maintenance_priority");
    if (
      mPriority === "all" ||
      (mPriority && maintenancePriorities.includes(mPriority as MaintenancePriority))
    ) {
      setMaintenancePriority(mPriority as MaintenancePriority | "all");
    }
    const arrears = params.get("arrears_status");
    if (
      arrears === "all" ||
      (arrears && arrearsStatuses.includes(arrears as ArrearsCaseStatus))
    ) {
      setArrearsStatus(arrears as ArrearsCaseStatus | "all");
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const setOrDelete = (key: string, value: string) => {
      if (value === "all") {
        url.searchParams.delete(key);
      } else {
        url.searchParams.set(key, value);
      }
    };
    setOrDelete("tab", activeTab === "queue" ? "all" : activeTab);
    setOrDelete("assignee", assigneeFilter);
    setOrDelete("maintenance_status", maintenanceStatus);
    setOrDelete("maintenance_priority", maintenancePriority);
    setOrDelete("arrears_status", arrearsStatus);
    window.history.replaceState(null, "", url);
  }, [
    activeTab,
    assigneeFilter,
    maintenanceStatus,
    maintenancePriority,
    arrearsStatus,
  ]);
  const [maintenanceFormOpen, setMaintenanceFormOpen] = useState(false);
  const [arrearsFormOpen, setArrearsFormOpen] = useState(false);
  const [expandedMaintenanceId, setExpandedMaintenanceId] = useState<
    string | null
  >(null);
  const [assignmentDrafts, setAssignmentDrafts] = useState<
    Record<string, string>
  >({});
  const [digestCadence, setDigestCadence] =
    useState<WorkAssignmentDigestCadence>("daily");
  const [digestResult, setDigestResult] =
    useState<WorkAssignmentDigestRunRecord | null>(null);
  const [maintenanceForm, setMaintenanceForm] =
    useState<MaintenanceFormState>(emptyMaintenanceForm);
  const [arrearsForm, setArrearsForm] =
    useState<ArrearsFormState>(emptyArrearsForm);
  const queryClient = useQueryClient();

  const entitiesQuery = useQuery({
    queryKey: ["operations-entities"],
    queryFn: listEntities,
  });

  const securityWorkspaceQuery = useQuery({
    queryKey: ["operations-security-workspace"],
    queryFn: getSecurityWorkspace,
  });

  useEffect(() => {
    const stored = window.localStorage.getItem(ENTITY_STORAGE_KEY);
    const accessibleIds = new Set(
      (entitiesQuery.data ?? []).map((entity) => entity.id),
    );
    const firstEntity = entitiesQuery.data?.[0]?.id ?? "";
    const next = stored && accessibleIds.has(stored) ? stored : firstEntity;
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

  const propertiesQuery = useQuery({
    queryKey: ["operations-properties", selectedEntityId],
    queryFn: () => listProperties(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });

  const tenantsQuery = useQuery({
    queryKey: ["operations-tenants", selectedEntityId],
    queryFn: () => listTenants(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });

  const obligationsQuery = useQuery({
    queryKey: ["operations-obligations", selectedEntityId],
    queryFn: () => listObligations({ entity_id: selectedEntityId }),
    enabled: Boolean(selectedEntityId),
  });

  const onboardingQuery = useQuery({
    queryKey: ["operations-onboarding", selectedEntityId],
    queryFn: () => listTenantOnboardings(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });

  const documentIntakesQuery = useQuery({
    queryKey: ["operations-document-intakes", selectedEntityId],
    queryFn: () => listDocumentIntakes(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });

  const maintenanceQuery = useQuery({
    queryKey: ["operations-maintenance", selectedEntityId],
    queryFn: () => listMaintenanceWorkOrders({ entity_id: selectedEntityId }),
    enabled: Boolean(selectedEntityId),
  });

  const invoiceDraftsQuery = useQuery({
    queryKey: ["operations-invoice-drafts", selectedEntityId],
    queryFn: () => listInvoiceDrafts({ entity_id: selectedEntityId }),
    enabled: Boolean(selectedEntityId),
  });

  const arrearsQuery = useQuery({
    queryKey: ["operations-arrears", selectedEntityId],
    queryFn: () => listArrearsCases({ entity_id: selectedEntityId }),
    enabled: Boolean(selectedEntityId),
  });

  const invalidateOperations = () => {
    queryClient.invalidateQueries({
      queryKey: ["operations-obligations", selectedEntityId],
    });
    queryClient.invalidateQueries({
      queryKey: ["operations-maintenance", selectedEntityId],
    });
    queryClient.invalidateQueries({
      queryKey: ["operations-arrears", selectedEntityId],
    });
  };

  function sendAssignmentNotificationRequest(item: AssignableQueueItem) {
    if (item.kind === "maintenance") {
      return sendMaintenanceWorkOrderAssignmentNotification(item.record.id);
    }
    if (item.kind === "arrears") {
      return sendArrearsAssignmentNotification(item.record.id);
    }
    return sendObligationAssignmentNotification(item.record.id);
  }

  const updateObligationMutation = useMutation({
    mutationFn: (payload: {
      obligation: ObligationRecord;
      status: "completed" | "waived";
    }) =>
      updateObligation(
        payload.obligation.id,
        obligationUpdateData(payload.obligation, {
          status: payload.status,
          completed_at:
            payload.status === "completed" ? new Date().toISOString() : null,
        }),
      ),
    onSuccess: invalidateOperations,
  });

  const assignObligationMutation = useMutation({
    mutationFn: (payload: {
      obligation: ObligationRecord;
      metadata: Record<string, unknown>;
    }) =>
      updateObligation(
        payload.obligation.id,
        obligationUpdateData(payload.obligation, {
          metadata: payload.metadata,
        }),
      ),
    onSuccess: invalidateOperations,
  });

  const sendObligationAssignmentNotificationMutation = useMutation({
    mutationFn: (obligation: ObligationRecord) =>
      sendObligationAssignmentNotification(obligation.id),
    onSuccess: invalidateOperations,
  });

  const createMaintenanceMutation = useMutation({
    mutationFn: createMaintenanceWorkOrder,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["operations-maintenance", selectedEntityId],
      });
      setMaintenanceForm(emptyMaintenanceForm);
      setMaintenanceFormOpen(false);
    },
  });

  const updateMaintenanceMutation = useMutation({
    mutationFn: (payload: {
      id: string;
      data: Parameters<typeof updateMaintenanceWorkOrder>[1];
    }) => updateMaintenanceWorkOrder(payload.id, payload.data),
    onSuccess: invalidateOperations,
  });

  // Inline-edit handler for the work-order status / priority cells.
  // Patches the React Query maintenance cache optimistically so the
  // row reflects the new state immediately; rolls back + rethrows on
  // failure so InlineEditCell surfaces the error inline.
  async function saveWorkOrderField(
    workOrderId: string,
    field: "status" | "priority",
    next: string | null,
  ): Promise<void> {
    if (next == null) return;
    const queryKey = ["operations-maintenance", selectedEntityId];
    const previous =
      queryClient.getQueryData<MaintenanceWorkOrderRecord[]>(queryKey) ?? null;
    if (previous) {
      queryClient.setQueryData<MaintenanceWorkOrderRecord[]>(
        queryKey,
        previous.map((row) =>
          row.id === workOrderId ? { ...row, [field]: next } : row,
        ),
      );
    }
    try {
      await updateMaintenanceWorkOrder(workOrderId, {
        [field]: next,
      } as Parameters<typeof updateMaintenanceWorkOrder>[1]);
      invalidateOperations();
    } catch (err) {
      if (previous) {
        queryClient.setQueryData(queryKey, previous);
      }
      throw err;
    }
  }

  const MAINTENANCE_STATUS_OPTIONS = [
    { value: "requested", label: "Requested" },
    { value: "triaged", label: "Triaged" },
    { value: "assigned", label: "Assigned" },
    { value: "awaiting_approval", label: "Awaiting approval" },
    { value: "approved", label: "Approved" },
    { value: "in_progress", label: "In progress" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
  ];

  const MAINTENANCE_PRIORITY_OPTIONS = [
    { value: "low", label: "Low" },
    { value: "normal", label: "Normal" },
    { value: "high", label: "High" },
    { value: "urgent", label: "Urgent" },
  ];

  const sendMaintenanceAssignmentNotificationMutation = useMutation({
    mutationFn: (workOrder: MaintenanceWorkOrderRecord) =>
      sendMaintenanceWorkOrderAssignmentNotification(workOrder.id),
    onSuccess: invalidateOperations,
  });

  const createArrearsMutation = useMutation({
    mutationFn: createArrearsCase,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["operations-arrears", selectedEntityId],
      });
      setArrearsForm(emptyArrearsForm);
      setArrearsFormOpen(false);
    },
  });

  const updateArrearsMutation = useMutation({
    mutationFn: (payload: {
      id: string;
      data: Parameters<typeof updateArrearsCase>[1];
    }) => updateArrearsCase(payload.id, payload.data),
    onSuccess: invalidateOperations,
  });

  const sendArrearsAssignmentNotificationMutation = useMutation({
    mutationFn: (arrearsCase: ArrearsCaseRecord) =>
      sendArrearsAssignmentNotification(arrearsCase.id),
    onSuccess: invalidateOperations,
  });

  const sendReadyAssignmentNotificationsMutation = useMutation({
    mutationFn: async (items: AssignableQueueItem[]) => {
      const results = [];
      for (const item of items) {
        results.push(await sendAssignmentNotificationRequest(item));
      }
      return results;
    },
    onSuccess: invalidateOperations,
  });

  const workAssignmentDigestMutation = useMutation({
    mutationFn: (sendEmailApproved: boolean = false) =>
      runWorkAssignmentDigest({
        entity_id: selectedEntityId,
        cadence: digestCadence,
        send_email_approved: sendEmailApproved,
      }),
    onSuccess: (result) => setDigestResult(result),
  });

  const operationsLoading =
    entitiesQuery.isLoading ||
    (Boolean(selectedEntityId) &&
      (propertiesQuery.isLoading ||
        tenantsQuery.isLoading ||
        obligationsQuery.isLoading ||
        onboardingQuery.isLoading ||
        documentIntakesQuery.isLoading ||
        maintenanceQuery.isLoading ||
        invoiceDraftsQuery.isLoading ||
        arrearsQuery.isLoading));

  const currentUser = securityWorkspaceQuery.data?.current_user ?? null;
  const properties = propertiesQuery.data ?? EMPTY_PROPERTIES;
  const tenants = tenantsQuery.data ?? EMPTY_TENANTS;
  const obligations = obligationsQuery.data ?? EMPTY_OBLIGATIONS;
  const onboardings = onboardingQuery.data ?? EMPTY_ONBOARDINGS;
  const intakes = documentIntakesQuery.data ?? EMPTY_INTAKES;
  const maintenance = maintenanceQuery.data ?? EMPTY_MAINTENANCE;
  const arrears = arrearsQuery.data ?? EMPTY_ARREARS;
  const invoiceDrafts = invoiceDraftsQuery.data ?? EMPTY_INVOICE_DRAFTS;
  const assignableMembers = useMemo(
    () =>
      (securityWorkspaceQuery.data?.members ?? EMPTY_MEMBERS)
        .filter((member) => memberCanReceiveWork(member, selectedEntityId))
        .sort((a, b) => memberLabel(a).localeCompare(memberLabel(b))),
    [securityWorkspaceQuery.data?.members, selectedEntityId],
  );

  const queueItems = useMemo(
    () =>
      buildQueueItems(
        obligations,
        onboardings,
        intakes,
        maintenance,
        arrears,
        properties,
        tenants,
      ),
    [
      arrears,
      intakes,
      maintenance,
      obligations,
      onboardings,
      properties,
      tenants,
    ],
  );

  const openQueueItems = queueItems.filter((item) => !item.completed);
  const assignableOpenQueueItems = openQueueItems.filter(isAssignableQueueItem);
  const filteredOpenQueueItems = openQueueItems.filter((item) =>
    matchesAssigneeFilter(item, assigneeFilter, currentUser?.id),
  );
  const readyNotificationItems = filteredOpenQueueItems
    .filter(isAssignableQueueItem)
    .filter((item) =>
      assignmentEmailReady(workAssignment(item.record.metadata)),
    );
  const noticeInboxItems = filteredOpenQueueItems
    .filter(isAssignableQueueItem)
    .map(assignmentNoticeInboxItem)
    .filter((item): item is AssignmentNoticeInboxItem => Boolean(item))
    .sort((a, b) => {
      const rank: Record<AssignmentNoticeGroup, number> = {
        attention: 0,
        ready: 1,
        in_flight: 2,
        done: 3,
      };
      return (
        rank[a.group] - rank[b.group] ||
        (b.at ? Date.parse(b.at) : 0) - (a.at ? Date.parse(a.at) : 0)
      );
    });
  const noticeInboxCounts = noticeInboxItems.reduce(
    (counts, item) => ({
      ...counts,
      [item.group]: counts[item.group] + 1,
    }),
    {
      attention: 0,
      ready: 0,
      in_flight: 0,
      done: 0,
    } satisfies Record<AssignmentNoticeGroup, number>,
  );
  const unassignedWorkCount = assignableOpenQueueItems.filter(
    (item) => !assignedUserId(item) && !assignedUserName(item),
  ).length;
  const assignedWorkCount =
    assignableOpenQueueItems.length - unassignedWorkCount;
  const followUpDueCount = assignableOpenQueueItems.filter((item) =>
    assignmentFollowUpDue(workAssignment(item.record.metadata)),
  ).length;
  const myWorkCount = currentUser
    ? assignableOpenQueueItems.filter(
        (item) => assignedUserId(item) === currentUser.id,
      ).length
    : 0;
  const workloadRows = assignableMembers
    .map((member) => {
      const memberItems = assignableOpenQueueItems.filter(
        (item) => assignedUserId(item) === member.id,
      );
      return {
        id: member.id,
        label: memberLabel(member),
        role: memberEntityRole(member, selectedEntityId),
        count: memberItems.length,
        urgentCount: memberItems.filter((item) =>
          ["danger", "warning"].includes(item.tone),
        ).length,
        followUpCount: memberItems.filter((item) =>
          assignmentFollowUpDue(workAssignment(item.record.metadata)),
        ).length,
      };
    })
    .filter((row) => row.count > 0 && row.id !== currentUser?.id)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const urgentMaintenance = maintenance.filter(
    (item) =>
      maintenanceIsOpen(item) && ["urgent", "high"].includes(item.priority),
  );
  const awaitingApproval = maintenance.filter(
    (item) =>
      maintenanceIsOpen(item) &&
      (item.status === "awaiting_approval" ||
        item.approval_status === "pending"),
  );
  const activeArrears = arrears.filter(arrearsIsOpen);
  const disputedArrears = activeArrears.filter((item) =>
    ["raised", "under_review", "escalated"].includes(item.dispute_status),
  );
  const remindersDue = activeArrears.filter(
    (item) => item.next_reminder_on && dueRank(item.next_reminder_on) <= 0,
  );

  const filteredMaintenance = maintenance.filter((item) => {
    if (maintenanceStatus !== "all" && item.status !== maintenanceStatus) {
      return false;
    }
    if (
      maintenancePriority !== "all" &&
      item.priority !== maintenancePriority
    ) {
      return false;
    }
    return true;
  });

  const filteredArrears = arrears.filter((item) => {
    if (arrearsStatus !== "all" && item.status !== arrearsStatus) {
      return false;
    }
    return true;
  });

  const error =
    entitiesQuery.error ||
    propertiesQuery.error ||
    tenantsQuery.error ||
    obligationsQuery.error ||
    onboardingQuery.error ||
    documentIntakesQuery.error ||
    maintenanceQuery.error ||
    invoiceDraftsQuery.error ||
    arrearsQuery.error ||
    createMaintenanceMutation.error ||
    updateMaintenanceMutation.error ||
    createArrearsMutation.error ||
    updateArrearsMutation.error ||
    updateObligationMutation.error ||
    assignObligationMutation.error ||
    sendMaintenanceAssignmentNotificationMutation.error ||
    sendArrearsAssignmentNotificationMutation.error ||
    sendObligationAssignmentNotificationMutation.error ||
    sendReadyAssignmentNotificationsMutation.error ||
    workAssignmentDigestMutation.error ||
    securityWorkspaceQuery.error;

  const assignmentPending =
    updateMaintenanceMutation.isPending ||
    updateArrearsMutation.isPending ||
    assignObligationMutation.isPending ||
    sendMaintenanceAssignmentNotificationMutation.isPending ||
    sendArrearsAssignmentNotificationMutation.isPending ||
    sendObligationAssignmentNotificationMutation.isPending ||
    sendReadyAssignmentNotificationsMutation.isPending;

  function refresh() {
    securityWorkspaceQuery.refetch();
    propertiesQuery.refetch();
    tenantsQuery.refetch();
    obligationsQuery.refetch();
    onboardingQuery.refetch();
    documentIntakesQuery.refetch();
    maintenanceQuery.refetch();
    invoiceDraftsQuery.refetch();
    arrearsQuery.refetch();
  }

  function submitMaintenance(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEntityId || !maintenanceForm.title.trim()) {
      return;
    }
    const quoteAmount = dollarsToCents(maintenanceForm.quote_amount);
    createMaintenanceMutation.mutate({
      entity_id: selectedEntityId,
      title: maintenanceForm.title.trim(),
      description: optionalString(maintenanceForm.description),
      property_id: maintenanceForm.property_id || null,
      tenant_id: maintenanceForm.tenant_id || null,
      priority: maintenanceForm.priority,
      status: maintenanceForm.approval_required
        ? "awaiting_approval"
        : maintenanceForm.status,
      due_date: maintenanceForm.due_date || null,
      contractor_name: optionalString(maintenanceForm.contractor_name),
      contractor_email: optionalString(maintenanceForm.contractor_email),
      contractor_phone: optionalString(maintenanceForm.contractor_phone),
      quote_amount_cents: quoteAmount || null,
      approval_required: maintenanceForm.approval_required,
      approval_status: maintenanceForm.approval_required
        ? "pending"
        : "not_required",
      approval_limit_cents:
        dollarsToCents(maintenanceForm.approval_limit) || null,
      approval_notes: optionalString(maintenanceForm.approval_notes),
      source_reference: optionalString(maintenanceForm.source_reference),
      invoice_reference: optionalString(maintenanceForm.invoice_reference),
      invoice_amount_cents:
        dollarsToCents(maintenanceForm.invoice_amount) || null,
      notes: optionalString(maintenanceForm.notes),
      metadata: { source: "operator_operations_workspace" },
    });
  }

  function submitArrears(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEntityId || !arrearsForm.tenant_id) {
      return;
    }
    const tenant = tenants.find((item) => item.id === arrearsForm.tenant_id);
    createArrearsMutation.mutate({
      entity_id: selectedEntityId,
      tenant_id: arrearsForm.tenant_id,
      status: arrearsForm.status,
      currency: "AUD",
      as_of: dateOnly(new Date()),
      balance_current_cents: dollarsToCents(arrearsForm.balance_current),
      balance_1_30_cents: dollarsToCents(arrearsForm.balance_1_30),
      balance_31_60_cents: dollarsToCents(arrearsForm.balance_31_60),
      balance_61_90_cents: dollarsToCents(arrearsForm.balance_61_90),
      balance_90_plus_cents: dollarsToCents(arrearsForm.balance_90_plus),
      next_reminder_on: arrearsForm.next_reminder_on || null,
      dispute_status: arrearsForm.dispute_status,
      escalation_status: arrearsForm.escalation_status,
      promise_to_pay_date: arrearsForm.promise_to_pay_date || null,
      promise_to_pay_amount_cents:
        dollarsToCents(arrearsForm.promise_to_pay_amount) || null,
      notes: optionalString(arrearsForm.notes),
      metadata: {
        source: "operator_operations_workspace",
        tenant_name: tenant?.trading_name || tenant?.legal_name || null,
      },
    });
  }

  function assignmentValue(itemId: string, metadata: Record<string, unknown>) {
    return (
      assignmentDrafts[itemId] ?? workAssignment(metadata)?.assignedUserId ?? ""
    );
  }

  function setAssignmentValue(itemId: string, value: string) {
    setAssignmentDrafts((current) => ({
      ...current,
      [itemId]: value,
    }));
  }

  function nextAssignmentMetadata(
    metadata: Record<string, unknown>,
    assigneeId: string,
    title: string,
    kind: string,
    dueDate: string | null | undefined,
    tone: Tone,
  ) {
    const assignee = assigneeId
      ? (assignableMembers.find((member) => member.id === assigneeId) ?? null)
      : null;
    if (assigneeId && !assignee) {
      return null;
    }
    return assignmentMetadata({
      metadata,
      assignee,
      currentUser,
      entityId: selectedEntityId,
      title,
      kind,
      dueDate,
      tone,
    });
  }

  function assignMaintenance(
    workOrder: MaintenanceWorkOrderRecord,
    assigneeId: string,
  ) {
    const metadata = nextAssignmentMetadata(
      workOrder.metadata,
      assigneeId,
      workOrder.title,
      "Maintenance",
      workOrder.due_date,
      maintenanceTone(workOrder),
    );
    if (!metadata) {
      return;
    }
    updateMaintenanceMutation.mutate({
      id: workOrder.id,
      data: { metadata },
    });
  }

  function actionMaintenance(
    workOrder: MaintenanceWorkOrderRecord,
    action: WorkAssignmentAction,
  ) {
    const metadata = assignmentActionMetadata({
      metadata: workOrder.metadata,
      action,
      currentUser,
    });
    if (!metadata) {
      return;
    }
    updateMaintenanceMutation.mutate({
      id: workOrder.id,
      data: { metadata },
    });
  }

  function assignArrears(arrearsCase: ArrearsCaseRecord, assigneeId: string) {
    const title = `${tenantName(tenants, arrearsCase.tenant_id)} arrears`;
    const metadata = nextAssignmentMetadata(
      arrearsCase.metadata,
      assigneeId,
      title,
      "Arrears",
      arrearsCase.next_reminder_on,
      arrearsTone(arrearsCase),
    );
    if (!metadata) {
      return;
    }
    updateArrearsMutation.mutate({
      id: arrearsCase.id,
      data: {
        assigned_user_id: assigneeId || null,
        metadata,
      },
    });
  }

  function actionArrears(
    arrearsCase: ArrearsCaseRecord,
    action: WorkAssignmentAction,
  ) {
    const metadata = assignmentActionMetadata({
      metadata: arrearsCase.metadata,
      action,
      currentUser,
    });
    if (!metadata) {
      return;
    }
    updateArrearsMutation.mutate({
      id: arrearsCase.id,
      data: { metadata },
    });
  }

  function assignObligation(obligation: ObligationRecord, assigneeId: string) {
    const metadata = nextAssignmentMetadata(
      obligation.metadata,
      assigneeId,
      obligation.title,
      "Critical date",
      obligation.due_date,
      obligationTone(obligation),
    );
    if (!metadata) {
      return;
    }
    assignObligationMutation.mutate({
      obligation,
      metadata,
    });
  }

  function actionObligation(
    obligation: ObligationRecord,
    action: WorkAssignmentAction,
  ) {
    const metadata = assignmentActionMetadata({
      metadata: obligation.metadata,
      action,
      currentUser,
    });
    if (!metadata) {
      return;
    }
    assignObligationMutation.mutate({
      obligation,
      metadata,
    });
  }

  function assignQueueItem(item: AssignableQueueItem, assigneeId: string) {
    if (item.kind === "maintenance") {
      assignMaintenance(item.record, assigneeId);
      return;
    }
    if (item.kind === "arrears") {
      assignArrears(item.record, assigneeId);
      return;
    }
    assignObligation(item.record, assigneeId);
  }

  function actionQueueItem(
    item: AssignableQueueItem,
    action: WorkAssignmentAction,
  ) {
    if (item.kind === "maintenance") {
      actionMaintenance(item.record, action);
      return;
    }
    if (item.kind === "arrears") {
      actionArrears(item.record, action);
      return;
    }
    actionObligation(item.record, action);
  }

  function sendAssignmentNotification(item: AssignableQueueItem) {
    if (item.kind === "maintenance") {
      sendMaintenanceAssignmentNotificationMutation.mutate(item.record);
      return;
    }
    if (item.kind === "arrears") {
      sendArrearsAssignmentNotificationMutation.mutate(item.record);
      return;
    }
    sendObligationAssignmentNotificationMutation.mutate(item.record);
  }

  function renderAssignmentControl({
    itemId,
    title,
    metadata,
    onAssign,
    onAction,
    onNotify,
  }: {
    itemId: string;
    title: string;
    metadata: Record<string, unknown>;
    onAssign: (assigneeId: string) => void;
    onAction: (action: WorkAssignmentAction) => void;
    onNotify: () => void;
  }) {
    return (
      <WorkAssignmentControl
        title={title}
        assignment={workAssignment(metadata)}
        members={assignableMembers}
        value={assignmentValue(itemId, metadata)}
        onChange={(value) => setAssignmentValue(itemId, value)}
        onAssign={onAssign}
        onAction={onAction}
        onNotify={onNotify}
        disabled={assignmentPending}
        membersLoading={securityWorkspaceQuery.isLoading}
      />
    );
  }

  function renderQueueActions(item: QueueItem) {
    if (item.kind === "obligation") {
      if (item.completed) {
        return <StatusBadge tone="success">{item.chip}</StatusBadge>;
      }
      return (
        <>
          <SecondaryButton
            type="button"
            className="h-9 px-3"
            onClick={() =>
              updateObligationMutation.mutate({
                obligation: item.record,
                status: "completed",
              })
            }
            disabled={updateObligationMutation.isPending}
          >
            <CheckCircle2 size={15} className="text-success" />
            Complete
          </SecondaryButton>
          <SecondaryButton
            type="button"
            className="h-9 px-3"
            onClick={() =>
              updateObligationMutation.mutate({
                obligation: item.record,
                status: "waived",
              })
            }
            disabled={updateObligationMutation.isPending}
          >
            <Ban size={15} className="text-danger" />
            Waive
          </SecondaryButton>
        </>
      );
    }
    if (item.kind === "onboarding") {
      return (
        <Link
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
          href="/tenants"
        >
          <MailCheck size={15} />
          Open tenants
        </Link>
      );
    }
    if (item.kind === "document_intake") {
      return (
        <Link
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
          href="/intake"
        >
          <Sparkles size={15} />
          Review
        </Link>
      );
    }
    if (item.kind === "maintenance") {
      return (
        <MaintenanceActions
          workOrder={item.record}
          onUpdate={(data) =>
            updateMaintenanceMutation.mutate({ id: item.record.id, data })
          }
          disabled={updateMaintenanceMutation.isPending}
        />
      );
    }
    return (
      <ArrearsActions
        arrearsCase={item.record}
        onUpdate={(data) =>
          updateArrearsMutation.mutate({ id: item.record.id, data })
        }
        disabled={updateArrearsMutation.isPending}
      />
    );
  }

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
          title="Operations"
          description="Maintenance, arrears, tenant follow-ups, critical dates, and document exceptions."
          actions={
            <div className="flex flex-wrap gap-2">
              <SecondaryButton
                type="button"
                onClick={refresh}
                disabled={!selectedEntityId}
              >
                <RefreshCw size={15} />
                Refresh
              </SecondaryButton>
              <Button
                type="button"
                onClick={() => {
                  setActiveTab("maintenance");
                  setMaintenanceFormOpen((open) => !open);
                }}
                disabled={!selectedEntityId}
              >
                <Plus size={15} />
                Work order
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setActiveTab("arrears");
                  setArrearsFormOpen((open) => !open);
                }}
                disabled={!selectedEntityId}
              >
                <Plus size={15} />
                Arrears case
              </Button>
            </div>
          }
        />

        {error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {friendlyError(error)}
          </div>
        ) : null}

        {operationsLoading ? (
          <SectionPanel
            title="Loading operations"
            description={
              selectedEntity
                ? selectedEntity.name
                : "Finding the active entity."
            }
            icon={<RefreshCw size={17} className="animate-spin text-primary" />}
            actions={<StatusBadge tone="neutral">Loading</StatusBadge>}
            className="border-primary/20 bg-primary/5"
          >
            <div className="grid gap-3 p-4 text-sm text-muted-foreground sm:grid-cols-3">
              <div className="rounded-xl border border-border bg-white px-3 py-2">
                Queue
              </div>
              <div className="rounded-xl border border-border bg-white px-3 py-2">
                Maintenance
              </div>
              <div className="rounded-xl border border-border bg-white px-3 py-2">
                Arrears
              </div>
            </div>
          </SectionPanel>
        ) : null}

        {!selectedEntityId && !operationsLoading ? (
          <SectionPanel>
            <EmptyState
              icon={<Building2 size={18} />}
              title="No entity selected"
              description="Choose an entity from the header to load the operations workspace."
            />
          </SectionPanel>
        ) : null}

        {selectedEntityId ? (
          <>
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <MetricCard
                icon={<AlertTriangle size={17} className="text-primary" />}
                label="Urgent maintenance"
                value={operationsLoading ? "..." : urgentMaintenance.length}
                description="High and urgent open work."
              />
              <MetricCard
                icon={<ShieldCheck size={17} className="text-primary" />}
                label="Awaiting approval"
                value={operationsLoading ? "..." : awaitingApproval.length}
                description="Quotes or works needing approval."
              />
              <MetricCard
                icon={<HandCoins size={17} className="text-primary" />}
                label="Active arrears"
                value={operationsLoading ? "..." : activeArrears.length}
                description="Open credit-control cases."
              />
              <MetricCard
                icon={<FileWarning size={17} className="text-primary" />}
                label="Disputed"
                value={operationsLoading ? "..." : disputedArrears.length}
                description="Raised or escalated disputes."
              />
              <MetricCard
                icon={<Clock3 size={17} className="text-primary" />}
                label="Reminders due"
                value={operationsLoading ? "..." : remindersDue.length}
                description="Arrears follow-ups due now."
              />
            </section>

            <div
              className="grid gap-2 rounded-2xl border border-border bg-white p-2 shadow-leasiumXs md:grid-cols-3"
              role="tablist"
              aria-label="Operations sections"
            >
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "grid min-h-16 gap-1 rounded-xl px-3 py-2 text-left transition duration-200 ease-leasium",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-leasiumXs"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <span className="text-sm font-semibold">{tab.label}</span>
                    <span
                      className={cn(
                        "text-xs",
                        isActive && "text-primary-foreground/80",
                      )}
                    >
                      {tab.description}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <SavedViewsMenu
                surface="operations"
                currentFilters={{
                  tab: activeTab === "queue" ? null : activeTab,
                  assignee: assigneeFilter === "all" ? null : assigneeFilter,
                  maintenance_status:
                    maintenanceStatus === "all" ? null : maintenanceStatus,
                  maintenance_priority:
                    maintenancePriority === "all" ? null : maintenancePriority,
                  arrears_status:
                    arrearsStatus === "all" ? null : arrearsStatus,
                }}
                onApplyView={(filters) => {
                  const nextTab = filters.tab;
                  if (
                    nextTab &&
                    tabs.some((entry) => entry.id === nextTab)
                  ) {
                    setActiveTab(nextTab as OperationsTab);
                  } else {
                    setActiveTab("queue");
                  }
                  const nextAssignee = filters.assignee;
                  if (
                    nextAssignee === "unassigned" ||
                    nextAssignee === "me" ||
                    nextAssignee === "follow_up" ||
                    (typeof nextAssignee === "string" &&
                      nextAssignee.startsWith("member:"))
                  ) {
                    setAssigneeFilter(nextAssignee as AssigneeFilter);
                  } else {
                    setAssigneeFilter("all");
                  }
                  const nextMStatus = filters.maintenance_status;
                  if (
                    nextMStatus &&
                    maintenanceStatuses.includes(
                      nextMStatus as MaintenanceWorkOrderStatus,
                    )
                  ) {
                    setMaintenanceStatus(
                      nextMStatus as MaintenanceWorkOrderStatus,
                    );
                  } else {
                    setMaintenanceStatus("all");
                  }
                  const nextMPriority = filters.maintenance_priority;
                  if (
                    nextMPriority &&
                    maintenancePriorities.includes(
                      nextMPriority as MaintenancePriority,
                    )
                  ) {
                    setMaintenancePriority(
                      nextMPriority as MaintenancePriority,
                    );
                  } else {
                    setMaintenancePriority("all");
                  }
                  const nextArrears = filters.arrears_status;
                  if (
                    nextArrears &&
                    arrearsStatuses.includes(nextArrears as ArrearsCaseStatus)
                  ) {
                    setArrearsStatus(nextArrears as ArrearsCaseStatus);
                  } else {
                    setArrearsStatus("all");
                  }
                }}
              />
            </div>

            {activeTab === "queue" ? (
              <SectionPanel
                title="Operations queue"
                description={selectedEntity?.name ?? "Current entity"}
                icon={<ClipboardList size={17} className="text-primary" />}
                actions={
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <SecondaryButton
                      type="button"
                      className="h-10 px-3"
                      disabled={
                        assignmentPending || readyNotificationItems.length === 0
                      }
                      onClick={() =>
                        sendReadyAssignmentNotificationsMutation.mutate(
                          readyNotificationItems,
                        )
                      }
                    >
                      <Send size={15} />
                      {sendReadyAssignmentNotificationsMutation.isPending
                        ? "Sending…"
                        : "Send ready notices"}
                      <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
                        {readyNotificationItems.length}
                      </span>
                    </SecondaryButton>
                    <Select
                      aria-label="Digest cadence"
                      value={digestCadence}
                      onChange={(event) =>
                        setDigestCadence(
                          event.target.value as WorkAssignmentDigestCadence,
                        )
                      }
                      className="w-36"
                    >
                      <option value="daily">Daily digest</option>
                      <option value="weekly">Weekly digest</option>
                    </Select>
                    <SecondaryButton
                      type="button"
                      className="h-10 px-3"
                      disabled={
                        !selectedEntityId ||
                        workAssignmentDigestMutation.isPending
                      }
                      onClick={() => workAssignmentDigestMutation.mutate(false)}
                    >
                      {workAssignmentDigestMutation.isPending ? (
                        <RefreshCw size={15} className="animate-spin" />
                      ) : (
                        <ReceiptText size={15} />
                      )}
                      Generate digest
                    </SecondaryButton>
                    <SecondaryButton
                      type="button"
                      className="h-10 px-3"
                      disabled={
                        !selectedEntityId ||
                        workAssignmentDigestMutation.isPending
                      }
                      onClick={() => workAssignmentDigestMutation.mutate(true)}
                    >
                      <Send size={15} />
                      Send digest
                    </SecondaryButton>
                    <Select
                      aria-label="Queue assignee"
                      value={assigneeFilter}
                      onChange={(event) =>
                        setAssigneeFilter(event.target.value as AssigneeFilter)
                      }
                      className="w-52"
                    >
                      <option value="all">All open work</option>
                      <option value="unassigned">Unassigned</option>
                      <option value="follow_up">Follow-up due</option>
                      {currentUser ? <option value="me">My work</option> : null}
                      {assignableMembers.map((member) => (
                        <option
                          key={member.id}
                          value={memberAssigneeFilter(member.id)}
                        >
                          {memberLabel(member)}
                        </option>
                      ))}
                    </Select>
                  </div>
                }
              >
                <div className="border-b border-border bg-muted/30 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white px-3 text-xs font-semibold text-slate shadow-leasiumXs">
                      <UserRound size={14} className="text-primary" />
                      Team workload
                    </span>
                    <button
                      type="button"
                      aria-label={`Show all open work, ${openQueueItems.length}`}
                      onClick={() => setAssigneeFilter("all")}
                      className={cn(
                        "inline-flex min-h-10 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition duration-200 ease-leasium",
                        assigneeFilter === "all"
                          ? "border-primary/30 bg-primary-soft text-primary-hover"
                          : "border-border bg-white text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      Open
                      <span className="text-foreground">
                        {openQueueItems.length}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Show unowned work, ${unassignedWorkCount}`}
                      onClick={() => setAssigneeFilter("unassigned")}
                      className={cn(
                        "inline-flex min-h-10 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition duration-200 ease-leasium",
                        assigneeFilter === "unassigned"
                          ? "border-primary/30 bg-primary-soft text-primary-hover"
                          : "border-border bg-white text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      Unassigned
                      <span className="text-foreground">
                        {unassignedWorkCount}
                      </span>
                    </button>
                    <span className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border bg-white px-3 text-xs font-semibold text-muted-foreground">
                      Assigned
                      <span className="text-foreground">
                        {assignedWorkCount}
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-label={`Show assignment follow-ups, ${followUpDueCount}`}
                      onClick={() => setAssigneeFilter("follow_up")}
                      className={cn(
                        "inline-flex min-h-10 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition duration-200 ease-leasium",
                        assigneeFilter === "follow_up"
                          ? "border-primary/30 bg-primary-soft text-primary-hover"
                          : "border-border bg-white text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      Follow-up due
                      <span className="text-foreground">
                        {followUpDueCount}
                      </span>
                    </button>
                    {currentUser ? (
                      <button
                        type="button"
                        aria-label={`Show my work, ${myWorkCount}`}
                        onClick={() => setAssigneeFilter("me")}
                        className={cn(
                          "inline-flex min-h-10 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition duration-200 ease-leasium",
                          assigneeFilter === "me"
                            ? "border-primary/30 bg-primary-soft text-primary-hover"
                            : "border-border bg-white text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        My work
                        <span className="text-foreground">{myWorkCount}</span>
                      </button>
                    ) : null}
                    {workloadRows.map((row) => {
                      const filter = memberAssigneeFilter(row.id);
                      const active = assigneeFilter === filter;
                      return (
                        <button
                          key={row.id}
                          type="button"
                          aria-label={`Show ${row.label} work, ${row.count}`}
                          onClick={() => setAssigneeFilter(filter)}
                          className={cn(
                            "inline-flex min-h-10 max-w-full items-center gap-2 rounded-full border px-3 text-xs font-semibold transition duration-200 ease-leasium",
                            active
                              ? "border-primary/30 bg-primary-soft text-primary-hover"
                              : "border-border bg-white text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                          title={`${row.label}${row.role ? ` - ${label(row.role)}` : ""}`}
                        >
                          <span className="max-w-36 truncate">
                            {row.id === currentUser?.id
                              ? `${row.label} (me)`
                              : row.label}
                          </span>
                          <span className="text-foreground">{row.count}</span>
                          {row.urgentCount ? (
                            <span className="text-danger">
                              {row.urgentCount} urgent
                            </span>
                          ) : null}
                          {row.followUpCount ? (
                            <span className="text-warning">
                              {row.followUpCount} follow-up
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  {noticeInboxItems.length > 0 ? (
                    <AssignmentNoticeInbox
                      items={noticeInboxItems.slice(0, 4)}
                      counts={noticeInboxCounts}
                    />
                  ) : null}
                  {digestResult ? (
                    <AssignmentDigestPreview result={digestResult} />
                  ) : null}
                </div>
                <div className="divide-y divide-border">
                  {filteredOpenQueueItems.map((item) => (
                    <div
                      key={item.id}
                      className="grid gap-3 px-4 py-4 xl:grid-cols-[minmax(18rem,1fr)_22rem_auto] xl:items-start"
                    >
                      <Link href={item.href} className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-leasium-body-compact font-medium leading-5 text-foreground">
                            {item.title}
                          </span>
                          <StatusBadge tone={item.tone}>
                            {queueDateLabel(item)}
                          </StatusBadge>
                          <StatusBadge tone={item.tone}>
                            {item.chip}
                          </StatusBadge>
                          <StatusBadge tone={queueKindTone(item)}>
                            {queueKindLabel(item)}
                          </StatusBadge>
                        </div>
                        <p className="mt-1 text-sm leading-5 text-muted-foreground">
                          {item.description}
                        </p>
                      </Link>
                      {isAssignableQueueItem(item) ? (
                        <div className="w-full xl:w-[22rem]">
                          {renderAssignmentControl({
                            itemId: item.id,
                            title: item.title,
                            metadata: item.record.metadata,
                            onAssign: (assigneeId) =>
                              assignQueueItem(item, assigneeId),
                            onAction: (action) => actionQueueItem(item, action),
                            onNotify: () => sendAssignmentNotification(item),
                          })}
                        </div>
                      ) : null}
                      <div className="grid w-full gap-2 sm:w-auto sm:grid-flow-col xl:grid-flow-row xl:justify-items-stretch">
                        {renderQueueActions(item)}
                      </div>
                    </div>
                  ))}
                  {!operationsLoading && filteredOpenQueueItems.length === 0 ? (
                    <EmptyState
                      title={
                        assigneeFilter === "all"
                          ? "No open operational work"
                          : assigneeFilter === "follow_up"
                            ? "No assignment follow-ups due"
                            : "No work matches this assignee"
                      }
                      description={
                        assigneeFilter === "all"
                          ? "New document reviews, maintenance jobs, arrears cases, and tenant follow-ups will appear here."
                          : assigneeFilter === "follow_up"
                            ? "Assigned work with due reminders or escalation watches will appear here."
                            : "This assignee has no open assigned work in the current queue."
                      }
                      action={
                        assigneeFilter === "all" ? (
                          <div className="flex flex-wrap justify-center gap-2">
                            <SecondaryButton
                              type="button"
                              onClick={() => {
                                setActiveTab("maintenance");
                                setMaintenanceFormOpen(true);
                              }}
                            >
                              <Wrench size={15} />
                              Work order
                            </SecondaryButton>
                            <SecondaryButton
                              type="button"
                              onClick={() => {
                                setActiveTab("arrears");
                                setArrearsFormOpen(true);
                              }}
                            >
                              <HandCoins size={15} />
                              Arrears case
                            </SecondaryButton>
                          </div>
                        ) : (
                          <SecondaryButton
                            type="button"
                            onClick={() => setAssigneeFilter("all")}
                          >
                            <ClipboardList size={15} />
                            Show all work
                          </SecondaryButton>
                        )
                      }
                    />
                  ) : null}
                </div>
              </SectionPanel>
            ) : null}

            {activeTab === "maintenance" ? (
              <div className="grid gap-5">
                {maintenanceFormOpen ? (
                  <SectionPanel
                    title="New work order"
                    description="Track a tenant request, contractor job, approval, or invoice reference."
                    icon={<Wrench size={17} className="text-primary" />}
                  >
                    <form
                      onSubmit={submitMaintenance}
                      className="grid gap-3 p-4 md:grid-cols-2"
                    >
                      <Field label="Title">
                        <Input
                          value={maintenanceForm.title}
                          onChange={(event) =>
                            setMaintenanceForm((current) => ({
                              ...current,
                              title: event.target.value,
                            }))
                          }
                          required
                        />
                      </Field>
                      <Field label="Priority">
                        <Select
                          value={maintenanceForm.priority}
                          onChange={(event) =>
                            setMaintenanceForm((current) => ({
                              ...current,
                              priority: event.target
                                .value as MaintenancePriority,
                            }))
                          }
                        >
                          {maintenancePriorities.map((priority) => (
                            <option key={priority} value={priority}>
                              {label(priority)}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Property">
                        <Select
                          value={maintenanceForm.property_id}
                          onChange={(event) =>
                            setMaintenanceForm((current) => ({
                              ...current,
                              property_id: event.target.value,
                            }))
                          }
                        >
                          <option value="">No property</option>
                          {properties.map((property) => (
                            <option key={property.id} value={property.id}>
                              {property.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Tenant">
                        <Select
                          value={maintenanceForm.tenant_id}
                          onChange={(event) =>
                            setMaintenanceForm((current) => ({
                              ...current,
                              tenant_id: event.target.value,
                            }))
                          }
                        >
                          <option value="">No tenant</option>
                          {tenants.map((tenant) => (
                            <option key={tenant.id} value={tenant.id}>
                              {tenant.trading_name || tenant.legal_name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Due date">
                        <Input
                          type="date"
                          value={maintenanceForm.due_date}
                          onChange={(event) =>
                            setMaintenanceForm((current) => ({
                              ...current,
                              due_date: event.target.value,
                            }))
                          }
                        />
                      </Field>
                      <Field label="Contractor">
                        <Input
                          value={maintenanceForm.contractor_name}
                          onChange={(event) =>
                            setMaintenanceForm((current) => ({
                              ...current,
                              contractor_name: event.target.value,
                            }))
                          }
                        />
                      </Field>
                      <Field label="Contractor email">
                        <Input
                          type="email"
                          value={maintenanceForm.contractor_email}
                          onChange={(event) =>
                            setMaintenanceForm((current) => ({
                              ...current,
                              contractor_email: event.target.value,
                            }))
                          }
                        />
                      </Field>
                      <Field label="Contractor phone">
                        <Input
                          value={maintenanceForm.contractor_phone}
                          onChange={(event) =>
                            setMaintenanceForm((current) => ({
                              ...current,
                              contractor_phone: event.target.value,
                            }))
                          }
                        />
                      </Field>
                      <Field label="Quote amount">
                        <Input
                          inputMode="decimal"
                          value={maintenanceForm.quote_amount}
                          onChange={(event) =>
                            setMaintenanceForm((current) => ({
                              ...current,
                              quote_amount: event.target.value,
                            }))
                          }
                        />
                      </Field>
                      <Field label="Approval limit">
                        <Input
                          inputMode="decimal"
                          value={maintenanceForm.approval_limit}
                          onChange={(event) =>
                            setMaintenanceForm((current) => ({
                              ...current,
                              approval_limit: event.target.value,
                            }))
                          }
                        />
                      </Field>
                      <Field label="Source reference">
                        <Input
                          value={maintenanceForm.source_reference}
                          onChange={(event) =>
                            setMaintenanceForm((current) => ({
                              ...current,
                              source_reference: event.target.value,
                            }))
                          }
                        />
                      </Field>
                      <Field label="Invoice reference">
                        <Input
                          value={maintenanceForm.invoice_reference}
                          onChange={(event) =>
                            setMaintenanceForm((current) => ({
                              ...current,
                              invoice_reference: event.target.value,
                            }))
                          }
                        />
                      </Field>
                      <Field label="Invoice amount">
                        <Input
                          inputMode="decimal"
                          value={maintenanceForm.invoice_amount}
                          onChange={(event) =>
                            setMaintenanceForm((current) => ({
                              ...current,
                              invoice_amount: event.target.value,
                            }))
                          }
                        />
                      </Field>
                      <label className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-white px-3 text-sm font-semibold">
                        <input
                          type="checkbox"
                          checked={maintenanceForm.approval_required}
                          onChange={(event) =>
                            setMaintenanceForm((current) => ({
                              ...current,
                              approval_required: event.target.checked,
                            }))
                          }
                        />
                        Approval required
                      </label>
                      <label className="grid gap-1.5 text-sm md:col-span-2">
                        <span className="font-medium text-foreground">
                          Approval notes
                        </span>
                        <textarea
                          value={maintenanceForm.approval_notes}
                          onChange={(event) =>
                            setMaintenanceForm((current) => ({
                              ...current,
                              approval_notes: event.target.value,
                            }))
                          }
                          rows={2}
                          className="w-full rounded-xl border border-border bg-white px-3 py-3 text-sm outline-none transition-colors duration-200 ease-leasium focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15"
                        />
                      </label>
                      <label className="grid gap-1.5 text-sm md:col-span-2">
                        <span className="font-medium text-foreground">
                          Description
                        </span>
                        <textarea
                          value={maintenanceForm.description}
                          onChange={(event) =>
                            setMaintenanceForm((current) => ({
                              ...current,
                              description: event.target.value,
                            }))
                          }
                          rows={3}
                          className="w-full rounded-xl border border-border bg-white px-3 py-3 text-sm outline-none transition-colors duration-200 ease-leasium focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15"
                        />
                      </label>
                      <label className="grid gap-1.5 text-sm md:col-span-2">
                        <span className="font-medium text-foreground">
                          Internal notes
                        </span>
                        <textarea
                          value={maintenanceForm.notes}
                          onChange={(event) =>
                            setMaintenanceForm((current) => ({
                              ...current,
                              notes: event.target.value,
                            }))
                          }
                          rows={2}
                          className="w-full rounded-xl border border-border bg-white px-3 py-3 text-sm outline-none transition-colors duration-200 ease-leasium focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15"
                        />
                      </label>
                      <div className="flex flex-wrap gap-2 md:col-span-2">
                        <Button
                          type="submit"
                          disabled={
                            !maintenanceForm.title.trim() ||
                            createMaintenanceMutation.isPending
                          }
                        >
                          <Plus size={15} />
                          Create work order
                        </Button>
                        <SecondaryButton
                          type="button"
                          onClick={() => setMaintenanceFormOpen(false)}
                        >
                          Cancel
                        </SecondaryButton>
                      </div>
                    </form>
                  </SectionPanel>
                ) : null}

                <SectionPanel
                  title="Maintenance work orders"
                  description="Requests, approvals, contractors, and completion status."
                  icon={<Wrench size={17} className="text-primary" />}
                  actions={
                    <div className="flex flex-wrap gap-2">
                      <Select
                        aria-label="Maintenance status"
                        value={maintenanceStatus}
                        onChange={(event) =>
                          setMaintenanceStatus(
                            event.target.value as
                              | MaintenanceWorkOrderStatus
                              | "all",
                          )
                        }
                        className="w-40"
                      >
                        <option value="all">All statuses</option>
                        {maintenanceStatuses.map((status) => (
                          <option key={status} value={status}>
                            {label(status)}
                          </option>
                        ))}
                      </Select>
                      <Select
                        aria-label="Maintenance priority"
                        value={maintenancePriority}
                        onChange={(event) =>
                          setMaintenancePriority(
                            event.target.value as MaintenancePriority | "all",
                          )
                        }
                        className="w-40"
                      >
                        <option value="all">All priorities</option>
                        {maintenancePriorities.map((priority) => (
                          <option key={priority} value={priority}>
                            {label(priority)}
                          </option>
                        ))}
                      </Select>
                    </div>
                  }
                >
                  <div className="divide-y divide-border">
                    {filteredMaintenance.map((workOrder) => (
                      <div
                        key={workOrder.id}
                        className="grid gap-3 px-4 py-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/operations/maintenance/${workOrder.id}`}
                              className="font-semibold text-foreground hover:text-primary"
                            >
                              {workOrder.title}
                            </Link>
                            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5">
                              <span className="text-leasium-micro uppercase tracking-wide text-muted-foreground">
                                Status
                              </span>
                              <InlineEditCell
                                value={workOrder.status}
                                ariaLabel={`Status for ${workOrder.title}`}
                                placeholder="Set status"
                                options={MAINTENANCE_STATUS_OPTIONS}
                                onSave={(next) =>
                                  saveWorkOrderField(
                                    workOrder.id,
                                    "status",
                                    next,
                                  )
                                }
                              />
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5">
                              <span className="text-leasium-micro uppercase tracking-wide text-muted-foreground">
                                Priority
                              </span>
                              <InlineEditCell
                                value={workOrder.priority}
                                ariaLabel={`Priority for ${workOrder.title}`}
                                placeholder="Set priority"
                                options={MAINTENANCE_PRIORITY_OPTIONS}
                                onSave={(next) =>
                                  saveWorkOrderField(
                                    workOrder.id,
                                    "priority",
                                    next,
                                  )
                                }
                              />
                            </span>
                            {workOrder.approval_status === "pending" ? (
                              <StatusBadge tone="warning">
                                Approval pending
                              </StatusBadge>
                            ) : null}
                            {workAssignment(workOrder.metadata)
                              ?.assignedName ? (
                              <StatusBadge tone="primary">
                                Assigned to{" "}
                                {
                                  workAssignment(workOrder.metadata)
                                    ?.assignedName
                                }
                              </StatusBadge>
                            ) : null}
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {[
                              propertyName(properties, workOrder.property_id),
                              tenantName(tenants, workOrder.tenant_id),
                              workOrder.description,
                            ]
                              .filter(Boolean)
                              .join(" - ")}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span>Due {dueLabel(workOrder.due_date)}</span>
                            <span>
                              Requested {formatDateTime(workOrder.requested_at)}
                            </span>
                            {workOrder.contractor_name ? (
                              <span>{workOrder.contractor_name}</span>
                            ) : null}
                            {workOrder.invoice_draft_id ||
                            workOrder.invoice_reference ? (
                              <span>
                                Invoice{" "}
                                {invoiceDraftName(
                                  invoiceDrafts,
                                  workOrder.invoice_draft_id,
                                ) ??
                                  workOrder.invoice_reference ??
                                  "linked"}
                              </span>
                            ) : null}
                            {workOrder.quote_amount_cents ? (
                              <span>
                                {formatMoney(workOrder.quote_amount_cents)}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="grid gap-2 xl:justify-items-end">
                          {renderAssignmentControl({
                            itemId: `maintenance-${workOrder.id}`,
                            title: workOrder.title,
                            metadata: workOrder.metadata,
                            onAssign: (assigneeId) =>
                              assignMaintenance(workOrder, assigneeId),
                            onAction: (action) =>
                              actionMaintenance(workOrder, action),
                            onNotify: () =>
                              sendMaintenanceAssignmentNotificationMutation.mutate(
                                workOrder,
                              ),
                          })}
                          <MaintenanceActions
                            workOrder={workOrder}
                            onUpdate={(data) =>
                              updateMaintenanceMutation.mutate({
                                id: workOrder.id,
                                data,
                              })
                            }
                            disabled={updateMaintenanceMutation.isPending}
                            expanded={expandedMaintenanceId === workOrder.id}
                            onToggleDetails={() =>
                              setExpandedMaintenanceId((current) =>
                                current === workOrder.id ? null : workOrder.id,
                              )
                            }
                          />
                        </div>
                        {expandedMaintenanceId === workOrder.id ? (
                          <div className="xl:col-span-2">
                            <MaintenanceDetailPanel
                              workOrder={workOrder}
                              properties={properties}
                              tenants={tenants}
                              invoiceDrafts={invoiceDrafts}
                              disabled={updateMaintenanceMutation.isPending}
                              onUpdate={(data) =>
                                updateMaintenanceMutation.mutate({
                                  id: workOrder.id,
                                  data,
                                })
                              }
                            />
                          </div>
                        ) : null}
                      </div>
                    ))}
                    {!operationsLoading && filteredMaintenance.length === 0 ? (
                      <EmptyState
                        icon={<Wrench size={18} />}
                        title="No maintenance work orders"
                        description="Repairs, contractor jobs, approvals, and maintenance invoices will appear here."
                        action={
                          <SecondaryButton
                            type="button"
                            onClick={() => setMaintenanceFormOpen(true)}
                          >
                            <Plus size={15} />
                            Work order
                          </SecondaryButton>
                        }
                      />
                    ) : null}
                  </div>
                </SectionPanel>
              </div>
            ) : null}

            {activeTab === "arrears" ? (
              <div className="grid gap-5">
                {arrearsFormOpen ? (
                  <SectionPanel
                    title="New arrears case"
                    description="Track ageing, reminders, disputes, promise-to-pay, and escalation."
                    icon={<HandCoins size={17} className="text-primary" />}
                  >
                    <form
                      onSubmit={submitArrears}
                      className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3"
                    >
                      <Field label="Tenant">
                        <Select
                          value={arrearsForm.tenant_id}
                          onChange={(event) =>
                            setArrearsForm((current) => ({
                              ...current,
                              tenant_id: event.target.value,
                            }))
                          }
                          required
                        >
                          <option value="">Select tenant</option>
                          {tenants.map((tenant) => (
                            <option key={tenant.id} value={tenant.id}>
                              {tenant.trading_name || tenant.legal_name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Status">
                        <Select
                          value={arrearsForm.status}
                          onChange={(event) =>
                            setArrearsForm((current) => ({
                              ...current,
                              status: event.target.value as ArrearsCaseStatus,
                            }))
                          }
                        >
                          {arrearsStatuses.map((status) => (
                            <option key={status} value={status}>
                              {label(status)}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Next reminder">
                        <Input
                          type="date"
                          value={arrearsForm.next_reminder_on}
                          onChange={(event) =>
                            setArrearsForm((current) => ({
                              ...current,
                              next_reminder_on: event.target.value,
                            }))
                          }
                        />
                      </Field>
                      {[
                        ["Current", "balance_current"],
                        ["1-30 days", "balance_1_30"],
                        ["31-60 days", "balance_31_60"],
                        ["61-90 days", "balance_61_90"],
                        ["90+ days", "balance_90_plus"],
                      ].map(([fieldLabel, key]) => (
                        <Field key={key} label={fieldLabel}>
                          <Input
                            inputMode="decimal"
                            value={
                              arrearsForm[
                                key as keyof ArrearsFormState
                              ] as string
                            }
                            onChange={(event) =>
                              setArrearsForm((current) => ({
                                ...current,
                                [key]: event.target.value,
                              }))
                            }
                          />
                        </Field>
                      ))}
                      <Field label="Dispute">
                        <Select
                          value={arrearsForm.dispute_status}
                          onChange={(event) =>
                            setArrearsForm((current) => ({
                              ...current,
                              dispute_status: event.target
                                .value as ArrearsDisputeStatus,
                            }))
                          }
                        >
                          {disputeStatuses.map((status) => (
                            <option key={status} value={status}>
                              {label(status)}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Escalation">
                        <Select
                          value={arrearsForm.escalation_status}
                          onChange={(event) =>
                            setArrearsForm((current) => ({
                              ...current,
                              escalation_status: event.target
                                .value as ArrearsEscalationStatus,
                            }))
                          }
                        >
                          {escalationStatuses.map((status) => (
                            <option key={status} value={status}>
                              {label(status)}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Promise date">
                        <Input
                          type="date"
                          value={arrearsForm.promise_to_pay_date}
                          onChange={(event) =>
                            setArrearsForm((current) => ({
                              ...current,
                              promise_to_pay_date: event.target.value,
                            }))
                          }
                        />
                      </Field>
                      <Field label="Promise amount">
                        <Input
                          inputMode="decimal"
                          value={arrearsForm.promise_to_pay_amount}
                          onChange={(event) =>
                            setArrearsForm((current) => ({
                              ...current,
                              promise_to_pay_amount: event.target.value,
                            }))
                          }
                        />
                      </Field>
                      <label className="grid gap-1.5 text-sm md:col-span-2 xl:col-span-3">
                        <span className="font-medium text-foreground">
                          Notes
                        </span>
                        <textarea
                          value={arrearsForm.notes}
                          onChange={(event) =>
                            setArrearsForm((current) => ({
                              ...current,
                              notes: event.target.value,
                            }))
                          }
                          rows={3}
                          className="w-full rounded-xl border border-border bg-white px-3 py-3 text-sm outline-none transition-colors duration-200 ease-leasium focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15"
                        />
                      </label>
                      <div className="flex flex-wrap gap-2 md:col-span-2 xl:col-span-3">
                        <Button
                          type="submit"
                          disabled={
                            !arrearsForm.tenant_id ||
                            createArrearsMutation.isPending
                          }
                        >
                          <Plus size={15} />
                          Create arrears case
                        </Button>
                        <SecondaryButton
                          type="button"
                          onClick={() => setArrearsFormOpen(false)}
                        >
                          Cancel
                        </SecondaryButton>
                      </div>
                    </form>
                  </SectionPanel>
                ) : null}

                <SectionPanel
                  title="Arrears and credit control"
                  description="Ageing, reminder cadence, disputes, promise-to-pay, and escalation."
                  icon={<HandCoins size={17} className="text-primary" />}
                  actions={
                    <Select
                      aria-label="Arrears status"
                      value={arrearsStatus}
                      onChange={(event) =>
                        setArrearsStatus(
                          event.target.value as ArrearsCaseStatus | "all",
                        )
                      }
                      className="w-44"
                    >
                      <option value="all">All statuses</option>
                      {arrearsStatuses.map((status) => (
                        <option key={status} value={status}>
                          {label(status)}
                        </option>
                      ))}
                    </Select>
                  }
                >
                  <div className="divide-y divide-border">
                    {filteredArrears.map((arrearsCase) => (
                      <div
                        key={arrearsCase.id}
                        className="grid gap-3 px-4 py-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">
                              {tenantName(tenants, arrearsCase.tenant_id)}
                            </span>
                            <StatusBadge tone={arrearsTone(arrearsCase)}>
                              {formatMoney(
                                arrearsCase.total_balance_cents,
                                arrearsCase.currency,
                              )}
                            </StatusBadge>
                            <StatusBadge
                              tone={
                                arrearsIsOpen(arrearsCase)
                                  ? "warning"
                                  : "success"
                              }
                            >
                              {label(arrearsCase.status)}
                            </StatusBadge>
                            {arrearsCase.dispute_status !== "none" ? (
                              <StatusBadge tone="danger">
                                {label(arrearsCase.dispute_status)}
                              </StatusBadge>
                            ) : null}
                            {workAssignment(arrearsCase.metadata)
                              ?.assignedName ? (
                              <StatusBadge tone="primary">
                                Assigned to{" "}
                                {
                                  workAssignment(arrearsCase.metadata)
                                    ?.assignedName
                                }
                              </StatusBadge>
                            ) : null}
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {[
                              propertyName(properties, arrearsCase.property_id),
                              `As of ${formatDate(arrearsCase.as_of)}`,
                              arrearsCase.promise_to_pay_date
                                ? `Promise ${formatDate(arrearsCase.promise_to_pay_date)}`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" - ")}
                          </p>
                          <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-5">
                            <span>
                              Current{" "}
                              {formatMoney(arrearsCase.balance_current_cents)}
                            </span>
                            <span>
                              1-30 {formatMoney(arrearsCase.balance_1_30_cents)}
                            </span>
                            <span>
                              31-60{" "}
                              {formatMoney(arrearsCase.balance_31_60_cents)}
                            </span>
                            <span>
                              61-90{" "}
                              {formatMoney(arrearsCase.balance_61_90_cents)}
                            </span>
                            <span>
                              90+{" "}
                              {formatMoney(arrearsCase.balance_90_plus_cents)}
                            </span>
                          </div>
                        </div>
                        <div className="grid gap-2">
                          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                            <StatusBadge
                              tone={
                                dueRank(arrearsCase.next_reminder_on) <= 0
                                  ? "warning"
                                  : "neutral"
                              }
                            >
                              Reminder {dueLabel(arrearsCase.next_reminder_on)}
                            </StatusBadge>
                            <StatusBadge
                              tone={
                                arrearsCase.escalation_status === "none"
                                  ? "neutral"
                                  : "danger"
                              }
                            >
                              {label(arrearsCase.escalation_status)}
                            </StatusBadge>
                          </div>
                          {renderAssignmentControl({
                            itemId: `arrears-${arrearsCase.id}`,
                            title: `${tenantName(tenants, arrearsCase.tenant_id)} arrears`,
                            metadata: arrearsCase.metadata,
                            onAssign: (assigneeId) =>
                              assignArrears(arrearsCase, assigneeId),
                            onAction: (action) =>
                              actionArrears(arrearsCase, action),
                            onNotify: () =>
                              sendArrearsAssignmentNotificationMutation.mutate(
                                arrearsCase,
                              ),
                          })}
                          <ArrearsActions
                            arrearsCase={arrearsCase}
                            onUpdate={(data) =>
                              updateArrearsMutation.mutate({
                                id: arrearsCase.id,
                                data,
                              })
                            }
                            disabled={updateArrearsMutation.isPending}
                          />
                        </div>
                      </div>
                    ))}
                    {!operationsLoading && filteredArrears.length === 0 ? (
                      <EmptyState
                        icon={<CheckCircle2 size={18} />}
                        title="No arrears cases"
                        description="Open balances, disputes, reminder schedules, and escalation work will appear here."
                        action={
                          <SecondaryButton
                            type="button"
                            onClick={() => setArrearsFormOpen(true)}
                          >
                            <Plus size={15} />
                            Arrears case
                          </SecondaryButton>
                        }
                      />
                    ) : null}
                  </div>
                </SectionPanel>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}

function WorkAssignmentControl({
  title,
  assignment,
  members,
  value,
  onChange,
  onAssign,
  onAction,
  onNotify,
  disabled,
  membersLoading,
}: {
  title: string;
  assignment: WorkAssignment | null;
  members: SecurityMemberRecord[];
  value: string;
  onChange: (value: string) => void;
  onAssign: (assigneeId: string) => void;
  onAction: (action: WorkAssignmentAction) => void;
  onNotify: () => void;
  disabled: boolean;
  membersLoading: boolean;
}) {
  const currentAssigneeId = assignment?.assignedUserId ?? "";
  const hasMembers = members.length > 0;
  const canAssign = Boolean(value) && value !== currentAssigneeId;
  const notificationReady = assignment?.notificationStatus === "ready";
  const notificationDelivered = assignmentEmailDelivered(assignment);
  const notificationProblem = assignmentEmailProblem(assignment);
  const recentHistory = assignment?.history.slice(0, 3) ?? [];
  const reminderDue = Boolean(
    assignment?.reminderDueOn && dueRank(assignment.reminderDueOn) <= 0,
  );
  const escalationDue = Boolean(
    assignment?.escalationDueOn && dueRank(assignment.escalationDueOn) <= 0,
  );
  const isAssigned = Boolean(
    assignment?.assignedUserId || assignment?.assignedName,
  );
  const canLogReminder = Boolean(
    isAssigned &&
    (assignment?.reminderStatus === "due" ||
      (assignment?.reminderDueOn && dueRank(assignment.reminderDueOn) <= 0)) &&
    !["logged", "skipped"].includes(assignment?.reminderStatus ?? ""),
  );
  const canQueueEscalation = Boolean(
    isAssigned &&
    escalationDue &&
    !["queued", "skipped", "resolved"].includes(
      assignment?.escalationStatus ?? "",
    ),
  );
  const canSendNotice = Boolean(
    isAssigned && assignment?.assignedEmail && !notificationDelivered,
  );
  const notificationFootnote = notificationDelivered
    ? `Provider email ${label(assignment?.notificationStatus)}${
        assignment?.assignedEmail ? ` to ${assignment.assignedEmail}` : ""
      }.`
    : notificationProblem
      ? assignment?.notificationDetail ||
        `Provider email ${label(assignment?.notificationStatus)}.`
      : notificationReady
        ? "Ready to send the assignment email when an operator approves it."
        : assignment?.assignedAt
          ? "In-app reminder only; provider email has not been sent."
          : "Assign the owner and prepare the Leasium notification.";

  return (
    <div className="grid min-w-[min(100%,22rem)] gap-2 rounded-xl border border-border bg-muted/30 p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex size-7 items-center justify-center rounded-lg bg-white text-primary shadow-leasiumXs">
          <UserRound size={15} />
        </span>
        <span className="font-semibold">
          {assignment?.assignedName
            ? `Assigned to ${assignment.assignedName}`
            : "Unassigned"}
        </span>
        {notificationReady ? (
          <StatusBadge tone="success">Notification ready</StatusBadge>
        ) : null}
        {notificationDelivered ? (
          <StatusBadge tone="success">
            Email {label(assignment?.notificationStatus)}
          </StatusBadge>
        ) : null}
        {notificationProblem ? (
          <StatusBadge tone="warning">
            Email {label(assignment?.notificationStatus)}
          </StatusBadge>
        ) : null}
        {assignment?.reminderStatus === "logged" ? (
          <StatusBadge tone="success">Reminder logged</StatusBadge>
        ) : null}
        {assignment?.reminderDueOn ? (
          <StatusBadge tone={reminderDue ? "warning" : "neutral"}>
            Reminder {dueLabel(assignment.reminderDueOn)}
          </StatusBadge>
        ) : null}
        {assignment?.escalationStatus === "queued" ? (
          <StatusBadge tone="warning">Escalation queued</StatusBadge>
        ) : null}
        {assignment?.escalationDueOn ? (
          <StatusBadge tone={escalationDue ? "danger" : "neutral"}>
            Escalate {dueLabel(assignment.escalationDueOn)}
          </StatusBadge>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label={`Assignee for ${title}`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled || membersLoading || !hasMembers}
          className="h-9 w-44"
        >
          <option value="">
            {membersLoading
              ? "Loading members"
              : hasMembers
                ? "Choose assignee"
                : "No members"}
          </option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {memberLabel(member)}
            </option>
          ))}
        </Select>
        <SecondaryButton
          type="button"
          className="h-9 px-3"
          disabled={disabled || !canAssign}
          onClick={() => onAssign(value)}
        >
          <MailCheck size={15} />
          Assign
        </SecondaryButton>
        {assignment?.assignedUserId ? (
          <SecondaryButton
            type="button"
            className="h-9 px-3"
            disabled={disabled}
            onClick={() => {
              onChange("");
              onAssign("");
            }}
          >
            <Ban size={15} />
            Clear
          </SecondaryButton>
        ) : null}
        {canLogReminder ? (
          <SecondaryButton
            type="button"
            className="h-9 px-3"
            disabled={disabled}
            onClick={() => onAction("reminder_logged")}
          >
            <Clock3 size={15} />
            Log reminder
          </SecondaryButton>
        ) : null}
        {canQueueEscalation ? (
          <SecondaryButton
            type="button"
            className="h-9 px-3"
            disabled={disabled}
            onClick={() => onAction("escalation_queued")}
          >
            <AlertTriangle size={15} />
            Queue escalation
          </SecondaryButton>
        ) : null}
        {canSendNotice ? (
          <SecondaryButton
            type="button"
            className="h-9 px-3"
            disabled={disabled}
            onClick={onNotify}
          >
            <Send size={15} />
            {notificationProblem ? "Retry notice" : "Send notice"}
          </SecondaryButton>
        ) : null}
      </div>
      {recentHistory.length > 0 ? (
        <details className="rounded-lg border border-border bg-white px-2.5 py-2">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <History size={13} className="text-primary" />
              Recent activity
            </span>
            <span>{recentHistory.length}</span>
          </summary>
          <div className="mt-2 grid gap-1.5">
            {recentHistory.map((entry, index) => {
              const meta = [
                entry.at ? formatDateTime(entry.at) : null,
                entry.actor_name,
                entry.notification_status
                  ? `Email ${label(entry.notification_status)}`
                  : null,
              ]
                .filter(Boolean)
                .join(" - ");

              return (
                <div
                  key={`${entry.event}-${entry.at ?? index}`}
                  className="rounded-md bg-muted/50 px-2 py-1.5 text-xs"
                >
                  <div className="font-medium text-foreground">
                    {entry.summary ?? label(entry.event)}
                  </div>
                  {meta ? (
                    <div className="mt-0.5 text-muted-foreground">{meta}</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
      <div className="text-xs text-muted-foreground">
        {assignment?.assignedAt
          ? `Updated ${formatDateTime(assignment.assignedAt)} by ${
              assignment.assignedByName ?? "Leasium"
            }. ${notificationFootnote}`
          : notificationFootnote}
      </div>
    </div>
  );
}

function AssignmentNoticeInbox({
  items,
  counts,
}: {
  items: AssignmentNoticeInboxItem[];
  counts: Record<AssignmentNoticeGroup, number>;
}) {
  const summary = [
    { group: "attention", icon: <AlertTriangle size={13} /> },
    { group: "ready", icon: <Send size={13} /> },
    { group: "in_flight", icon: <Clock3 size={13} /> },
    { group: "done", icon: <CheckCircle2 size={13} /> },
  ] satisfies { group: AssignmentNoticeGroup; icon: ReactNode }[];

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex min-h-8 items-center gap-2 rounded-full bg-white px-3 text-xs font-semibold text-slate shadow-leasiumXs">
          <MailCheck size={14} className="text-primary" />
          Notice inbox
        </span>
        {summary.map((item) => (
          <span
            key={item.group}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border bg-white px-3 text-xs font-semibold text-muted-foreground"
          >
            <span className="text-primary">{item.icon}</span>
            {assignmentNoticeLabel(item.group)}
            <span className="text-foreground">{counts[item.group]}</span>
          </span>
        ))}
      </div>
      <div className="mt-2 grid gap-2 lg:grid-cols-2 2xl:grid-cols-4">
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className="grid min-h-[5.25rem] gap-1 rounded-lg border border-border bg-white px-3 py-2 text-xs transition duration-200 ease-leasium hover:border-primary/30 hover:bg-primary-soft"
          >
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="truncate font-semibold text-foreground">
                {item.title}
              </span>
              <StatusBadge tone={item.tone}>{item.statusLabel}</StatusBadge>
            </div>
            <div className="line-clamp-2 text-muted-foreground">
              {item.summary}
            </div>
            {item.meta ? (
              <div className="truncate text-muted-foreground/80">
                {item.meta}
              </div>
            ) : null}
          </Link>
        ))}
      </div>
    </div>
  );
}

function digestItemHref(workUrl: string | null) {
  if (!workUrl) {
    return "/operations";
  }
  try {
    const url = new URL(workUrl);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return workUrl;
  }
}

function digestDeliveryLabel(result: WorkAssignmentDigestRunRecord) {
  const sent = result.digests.filter((digest) => digest.message_sent).length;
  const attempted = result.digests.some(
    (digest) =>
      digest.delivery_status && digest.delivery_status !== "previewed",
  );
  if (sent > 0) {
    return `${sent} email${sent === 1 ? "" : "s"} queued`;
  }
  return attempted ? "No emails sent" : "No messages sent";
}

function digestDeliveryTone(result: WorkAssignmentDigestRunRecord) {
  if (result.digests.some((digest) => digest.message_sent)) {
    return "success" as const;
  }
  if (result.digests.some((digest) => digest.delivery_status === "failed")) {
    return "danger" as const;
  }
  if (result.digests.some((digest) => digest.delivery_status === "skipped")) {
    return "warning" as const;
  }
  return "neutral" as const;
}

function WorkDigestMessagePreview({
  preview,
}: {
  preview: WorkAssignmentRenderedMessagePreviewRecord | null;
}) {
  if (!preview) {
    return null;
  }
  return (
    <details className="mt-2 rounded-md border border-border bg-muted/30">
      <summary className="cursor-pointer px-2 py-1.5 text-xs font-semibold text-primary hover:text-primary-hover">
        Message preview
      </summary>
      <div className="border-t border-border px-2 py-2 text-xs">
        <div className="flex flex-wrap gap-2 text-muted-foreground">
          <span>{label(preview.channel)}</span>
          <span>{label(preview.provider)}</span>
          {preview.template_key || preview.template_version ? (
            <span>
              {preview.template_key} {preview.template_version}
            </span>
          ) : null}
        </div>
        {preview.subject ? (
          <div className="mt-2 font-semibold text-foreground">
            {preview.subject}
          </div>
        ) : null}
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-white p-2 font-sans leading-5 text-muted-foreground">
          {preview.body_text}
        </pre>
        {preview.action_label && preview.action_url ? (
          <Link
            href={digestItemHref(preview.action_url)}
            className="mt-2 inline-flex text-xs font-semibold text-primary hover:text-primary-hover"
          >
            {preview.action_label}
          </Link>
        ) : null}
      </div>
    </details>
  );
}

function AssignmentDigestPreview({
  result,
}: {
  result: WorkAssignmentDigestRunRecord;
}) {
  return (
    <div className="mt-3 rounded-xl border border-primary/20 bg-primary-soft p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Work digest generated</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {formatDateTime(result.generated_at)} - {result.operator_count}{" "}
            operators - {result.work_item_count} items
          </div>
        </div>
        <StatusBadge tone={digestDeliveryTone(result)}>
          {digestDeliveryLabel(result)}
        </StatusBadge>
      </div>
      {result.guardrails.length > 0 ? (
        <div className="mt-2 rounded-lg border border-border bg-white px-3 py-2 text-xs text-muted-foreground">
          {result.guardrails[0]}
        </div>
      ) : null}
      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        {result.digests.slice(0, 4).map((digest) => (
          <div
            key={digest.assignee_user_id}
            className="rounded-lg border border-border bg-white p-3 text-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-semibold">
                  {digest.assignee_name}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {digest.assignee_email}
                </div>
              </div>
              <StatusBadge tone="primary">
                {digest.item_count} {digest.item_count === 1 ? "item" : "items"}
              </StatusBadge>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {digest.delivery_status &&
              digest.delivery_status !== "previewed" ? (
                <StatusBadge tone={digest.message_sent ? "success" : "warning"}>
                  {label(digest.delivery_status)}
                </StatusBadge>
              ) : null}
              {digest.follow_up_due_count ? (
                <StatusBadge tone="warning">
                  {digest.follow_up_due_count} follow-up
                </StatusBadge>
              ) : null}
              {digest.attention_count ? (
                <StatusBadge tone="danger">
                  {digest.attention_count} attention
                </StatusBadge>
              ) : null}
              {digest.ready_count ? (
                <StatusBadge tone="primary">
                  {digest.ready_count} ready
                </StatusBadge>
              ) : null}
              {digest.in_flight_count ? (
                <StatusBadge tone="warning">
                  {digest.in_flight_count} in flight
                </StatusBadge>
              ) : null}
              {digest.done_count ? (
                <StatusBadge tone="success">
                  {digest.done_count} done
                </StatusBadge>
              ) : null}
            </div>
            {digest.delivery_detail ? (
              <div className="mt-2 rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">
                {digest.delivery_detail}
              </div>
            ) : null}
            <WorkDigestMessagePreview
              preview={digest.rendered_message_preview}
            />
            <div className="mt-2 grid gap-1.5">
              {digest.items.slice(0, 3).map((item) => (
                <Link
                  key={item.target_id}
                  href={digestItemHref(item.work_url)}
                  className="rounded-md bg-muted/50 px-2 py-1.5 text-xs hover:bg-muted"
                >
                  <div className="font-medium text-foreground">
                    {item.title}
                  </div>
                  <div className="mt-0.5 text-muted-foreground">
                    {[
                      item.notification_group
                        ? assignmentNoticeLabel(item.notification_group)
                        : null,
                      item.follow_up_due ? "Follow-up due" : null,
                      item.due_date ? `Due ${formatDate(item.due_date)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" - ")}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
        {result.digests.length === 0 ? (
          <div className="rounded-lg border border-border bg-white p-3 text-sm text-muted-foreground">
            No operators have assigned work matching this digest cadence.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label: metricLabel,
  value,
  description,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-white p-4 shadow-leasiumXs">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-muted-foreground">
          {metricLabel}
        </span>
        {icon}
      </div>
      <div className="mt-3 text-3xl font-semibold">{value}</div>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function maintenanceTimeline(workOrder: MaintenanceWorkOrderRecord) {
  const backendHistory = maintenanceActivity(workOrder).map((entry) => ({
    at: entry.at ?? entry.timestamp ?? workOrder.updated_at,
    label: label(entry.event ?? entry.action ?? "Activity"),
    detail:
      entry.summary ||
      [entry.actor, entry.source].filter(Boolean).join(" - ") ||
      "Maintenance activity updated.",
    meta: activityMeta(entry),
  }));
  const derived = [
    {
      at: workOrder.requested_at,
      label: "Requested",
      detail: workOrder.source_reference || "Work order opened.",
      meta: workOrder.status ? [label(workOrder.status)] : [],
    },
    workOrder.contractor_assigned_at
      ? {
          at: workOrder.contractor_assigned_at,
          label: "Contractor assigned",
          detail: workOrder.contractor_name || "Contractor added.",
          meta: ["Contractor"],
        }
      : null,
    workOrder.approval_required
      ? {
          at: workOrder.approved_at ?? workOrder.updated_at,
          label: `Approval ${label(workOrder.approval_status)}`,
          detail:
            workOrder.approval_notes ||
            (workOrder.quote_amount_cents
              ? `Quote ${formatMoney(workOrder.quote_amount_cents)}`
              : "Approval tracked."),
          meta: [label(workOrder.approval_status)],
        }
      : null,
    workOrder.invoice_draft_id ||
    workOrder.invoice_reference ||
    workOrder.invoice_amount_cents
      ? {
          at: workOrder.updated_at,
          label: "Invoice linked",
          detail: [
            workOrder.invoice_reference,
            workOrder.invoice_amount_cents
              ? formatMoney(workOrder.invoice_amount_cents)
              : null,
          ]
            .filter(Boolean)
            .join(" - "),
          meta: ["Billing"],
        }
      : null,
    workOrder.completed_at
      ? {
          at: workOrder.completed_at,
          label: "Completed",
          detail: workOrder.notes || "Work order completed.",
          meta: ["Completed"],
        }
      : null,
  ].filter(Boolean) as MaintenanceTimelineEntry[];

  const combined = backendHistory.length ? backendHistory : derived;
  return combined
    .filter((entry) => entry.at)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

function MaintenanceDetailPanel({
  workOrder,
  properties,
  tenants,
  invoiceDrafts,
  onUpdate,
  disabled,
}: {
  workOrder: MaintenanceWorkOrderRecord;
  properties: PropertyRecord[];
  tenants: TenantRecord[];
  invoiceDrafts: InvoiceDraftRecord[];
  onUpdate: (data: Parameters<typeof updateMaintenanceWorkOrder>[1]) => void;
  disabled: boolean;
}) {
  const matchingInvoiceDrafts = invoiceDrafts.filter((draft) => {
    if (
      workOrder.tenant_id &&
      draft.tenant_id &&
      draft.tenant_id !== workOrder.tenant_id
    ) {
      return false;
    }
    if (
      workOrder.property_id &&
      draft.property_id &&
      draft.property_id !== workOrder.property_id
    ) {
      return false;
    }
    return (
      draft.status === "approved" || draft.id === workOrder.invoice_draft_id
    );
  });
  const [invoiceDraftId, setInvoiceDraftId] = useState(
    workOrder.invoice_draft_id ?? "",
  );
  const selectedInvoiceDraft = matchingInvoiceDrafts.find(
    (draft) => draft.id === invoiceDraftId,
  );
  const timeline = maintenanceTimeline(workOrder);

  useEffect(() => {
    setInvoiceDraftId(workOrder.invoice_draft_id ?? "");
  }, [workOrder.invoice_draft_id]);

  return (
    <div className="grid gap-3 rounded-xl border border-border bg-muted/30 p-3">
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-white p-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck size={15} className="text-primary" />
            Approval
          </div>
          <dl className="mt-3 grid gap-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Quote</dt>
              <dd className="font-medium">
                {workOrder.quote_amount_cents
                  ? formatMoney(workOrder.quote_amount_cents)
                  : "No quote"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Limit</dt>
              <dd className="font-medium">
                {workOrder.approval_limit_cents
                  ? formatMoney(workOrder.approval_limit_cents)
                  : "No limit"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-medium">
                {label(workOrder.approval_status)}
              </dd>
            </div>
            {workOrder.approval_notes ? (
              <div>
                <dt className="text-muted-foreground">Notes</dt>
                <dd>{workOrder.approval_notes}</dd>
              </div>
            ) : null}
          </dl>
          {workOrder.approval_status === "pending" ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <SecondaryButton
                type="button"
                className="h-9 px-3"
                disabled={disabled}
                onClick={() =>
                  onUpdate({
                    status: "approved",
                    approval_status: "approved",
                    approved_at: new Date().toISOString(),
                    approval_notes:
                      workOrder.approval_notes || "Approved from Operations.",
                  })
                }
              >
                <ShieldCheck size={15} />
                Approve quote
              </SecondaryButton>
              <SecondaryButton
                type="button"
                className="h-9 px-3"
                disabled={disabled}
                onClick={() =>
                  onUpdate({
                    status: "triaged",
                    approval_status: "declined",
                    approval_notes:
                      workOrder.approval_notes || "Declined from Operations.",
                  })
                }
              >
                <Ban size={15} className="text-danger" />
                Decline
              </SecondaryButton>
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-border bg-white p-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <UserRound size={15} className="text-primary" />
            Contractor
          </div>
          <dl className="mt-3 grid gap-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Name</dt>
              <dd className="font-medium">
                {workOrder.contractor_name || "Not assigned"}
              </dd>
            </div>
            {workOrder.contractor_email ? (
              <div>
                <dt className="text-muted-foreground">Email</dt>
                <dd>{workOrder.contractor_email}</dd>
              </div>
            ) : null}
            {workOrder.contractor_phone ? (
              <div>
                <dt className="text-muted-foreground">Phone</dt>
                <dd>{workOrder.contractor_phone}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-muted-foreground">Assigned</dt>
              <dd>{formatDateTime(workOrder.contractor_assigned_at)}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-border bg-white p-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ReceiptText size={15} className="text-primary" />
            Invoice
          </div>
          <div className="mt-3 grid gap-2">
            <Select
              aria-label={`Invoice draft for ${workOrder.title}`}
              value={invoiceDraftId}
              onChange={(event) => setInvoiceDraftId(event.target.value)}
            >
              <option value="">No linked invoice</option>
              {matchingInvoiceDrafts.map((draft) => (
                <option key={draft.id} value={draft.id}>
                  {invoiceDraftLabel(draft)}
                </option>
              ))}
            </Select>
            <div className="text-xs text-muted-foreground">
              {workOrder.invoice_reference
                ? `Reference ${workOrder.invoice_reference}`
                : "Link an approved internal invoice draft or keep a manual reference."}
              {workOrder.invoice_amount_cents
                ? ` - ${formatMoney(workOrder.invoice_amount_cents)}`
                : ""}
            </div>
            <div className="flex flex-wrap gap-2">
              <SecondaryButton
                type="button"
                className="h-9 px-3"
                disabled={disabled || !invoiceDraftId}
                onClick={() =>
                  onUpdate({
                    invoice_draft_id: invoiceDraftId || null,
                    invoice_reference:
                      selectedInvoiceDraft?.invoice_number ??
                      selectedInvoiceDraft?.title ??
                      workOrder.invoice_reference,
                    invoice_amount_cents:
                      selectedInvoiceDraft?.total_cents ??
                      workOrder.invoice_amount_cents,
                  })
                }
              >
                <Link2 size={15} />
                Link invoice
              </SecondaryButton>
              {workOrder.invoice_draft_id ? (
                <SecondaryButton
                  type="button"
                  className="h-9 px-3"
                  disabled={disabled}
                  onClick={() =>
                    onUpdate({
                      invoice_draft_id: null,
                      invoice_reference: null,
                      invoice_amount_cents: null,
                    })
                  }
                >
                  <Ban size={15} />
                  Unlink
                </SecondaryButton>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-xl border border-border bg-white p-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <History size={15} className="text-primary" />
            Activity
          </div>
          <div className="mt-3 grid gap-2">
            {timeline.map((entry, index) => (
              <div
                key={`${entry.label}-${entry.at}-${index}`}
                className="grid gap-1 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{entry.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(entry.at)}
                  </span>
                  {entry.meta.map((item) => (
                    <span
                      key={item}
                      className="rounded-full bg-muted px-2 py-0.5 text-leasium-micro font-semibold text-muted-foreground"
                    >
                      {item}
                    </span>
                  ))}
                </div>
                <div className="text-muted-foreground">{entry.detail}</div>
              </div>
            ))}
          </div>
        </div>

        <dl className="grid content-start gap-2 rounded-xl border border-border bg-white p-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Scope</dt>
            <dd className="font-medium">
              {propertyName(properties, workOrder.property_id)} -{" "}
              {tenantName(tenants, workOrder.tenant_id)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Source</dt>
            <dd>{workOrder.source_reference || "No source reference"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Attachments</dt>
            <dd>
              {workOrder.document_ids.length +
                workOrder.photo_document_ids.length}{" "}
              file
              {workOrder.document_ids.length +
                workOrder.photo_document_ids.length ===
              1
                ? ""
                : "s"}
            </dd>
          </div>
          {workOrder.notes ? (
            <div>
              <dt className="text-muted-foreground">Notes</dt>
              <dd>{workOrder.notes}</dd>
            </div>
          ) : null}
        </dl>
      </div>
    </div>
  );
}

function MaintenanceActions({
  workOrder,
  onUpdate,
  disabled,
  expanded,
  onToggleDetails,
}: {
  workOrder: MaintenanceWorkOrderRecord;
  onUpdate: (data: Parameters<typeof updateMaintenanceWorkOrder>[1]) => void;
  disabled: boolean;
  expanded?: boolean;
  onToggleDetails?: () => void;
}) {
  if (!maintenanceIsOpen(workOrder)) {
    return <StatusBadge tone="success">{label(workOrder.status)}</StatusBadge>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 xl:justify-end">
      {onToggleDetails ? (
        <SecondaryButton
          type="button"
          className="h-9 px-3"
          disabled={disabled}
          onClick={onToggleDetails}
        >
          <ClipboardList size={15} />
          {expanded ? "Hide detail" : "Detail"}
        </SecondaryButton>
      ) : null}
      {workOrder.status === "requested" ? (
        <SecondaryButton
          type="button"
          className="h-9 px-3"
          disabled={disabled}
          onClick={() => onUpdate({ status: "triaged" })}
        >
          <ClipboardList size={15} />
          Triaged
        </SecondaryButton>
      ) : null}
      {workOrder.approval_status === "pending" ||
      workOrder.status === "awaiting_approval" ? (
        <SecondaryButton
          type="button"
          className="h-9 px-3"
          disabled={disabled}
          onClick={() =>
            onUpdate({
              status: "approved",
              approval_status: "approved",
              approved_at: new Date().toISOString(),
            })
          }
        >
          <ShieldCheck size={15} />
          Approve
        </SecondaryButton>
      ) : null}
      {!["in_progress", "completed"].includes(workOrder.status) ? (
        <SecondaryButton
          type="button"
          className="h-9 px-3"
          disabled={disabled}
          onClick={() => onUpdate({ status: "in_progress" })}
        >
          <Wrench size={15} />
          Start
        </SecondaryButton>
      ) : null}
      <Link
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
        href={`/operations/maintenance/${workOrder.id}`}
      >
        <CheckCircle2 size={15} className="text-success" />
        Review completion
      </Link>
    </div>
  );
}

function ArrearsActions({
  arrearsCase,
  onUpdate,
  disabled,
}: {
  arrearsCase: ArrearsCaseRecord;
  onUpdate: (data: Parameters<typeof updateArrearsCase>[1]) => void;
  disabled: boolean;
}) {
  if (!arrearsIsOpen(arrearsCase)) {
    return (
      <StatusBadge tone="success">{label(arrearsCase.status)}</StatusBadge>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 xl:justify-end">
      <SecondaryButton
        type="button"
        className="h-9 px-3"
        disabled={disabled}
        onClick={() =>
          onUpdate({
            last_reminder_at: new Date().toISOString(),
            reminder_stage: arrearsCase.reminder_stage + 1,
          })
        }
      >
        <Send size={15} />
        Reminder
      </SecondaryButton>
      {arrearsCase.escalation_status === "none" ? (
        <SecondaryButton
          type="button"
          className="h-9 px-3"
          disabled={disabled}
          onClick={() =>
            onUpdate({
              escalation_status: "queued",
              escalation_queue: "credit_control",
              escalated_at: new Date().toISOString(),
            })
          }
        >
          <AlertTriangle size={15} className="text-danger" />
          Escalate
        </SecondaryButton>
      ) : null}
      <SecondaryButton
        type="button"
        className="h-9 px-3"
        disabled={disabled}
        onClick={() => onUpdate({ status: "resolved" })}
      >
        <CheckCircle2 size={15} className="text-success" />
        Resolve
      </SecondaryButton>
    </div>
  );
}

export default function OperationsPage() {
  return (
    <QueryProvider>
      <OperationsWorkspace />
    </QueryProvider>
  );
}
