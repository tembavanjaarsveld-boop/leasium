"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock3,
  Copy,
  Download,
  FileWarning,
  HandCoins,
  History,
  Link2,
  MailCheck,
  Plus,
  RefreshCw,
  ReceiptText,
  Send,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AppHeader } from "@/components/app-shell";
import { EntityPicker } from "@/components/entity-picker";
import { InlineEditCell } from "@/components/inline-edit-cell";
import {
  PropertyCalendarMonthGrid,
  type CalendarMonthGridEvent,
} from "@/components/properties/PropertyCalendarMonthGrid";
import { QueryProvider } from "@/components/query-provider";
import { SavedViewsMenu } from "@/components/saved-views-menu";
import {
  Button,
  EmptyState,
  Field,
  Input,
  PageTitle,
  SecondaryButton,
  SectionPanel,
  Select,
  StatusBadge,
  type StatusTone,
} from "@/components/ui";
import {
  type ArrearsCaseRecord,
  type ArrearsCaseStatus,
  type ArrearsDisputeStatus,
  type ArrearsEscalationStatus,
  type CalendarEventRecord,
  type ComplianceCheckRecord,
  completeComplianceCheck,
  createArrearsCase,
  createMaintenanceWorkOrder,
  type DocumentIntakeRecord,
  type DocumentRecord,
  type InvoiceDraftRecord,
  linkComplianceCheckEvidence,
  listArrearsCases,
  listCalendarEvents,
  listComplianceChecks,
  listDocumentIntakes,
  listDocuments,
  listEntities,
  listInvoiceDrafts,
  listMaintenanceWorkOrders,
  listObligations,
  listProperties,
  getSecurityWorkspace,
  listTenantOnboardings,
  listTenants,
  recordArrearsPromiseToPay,
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
  uploadDocument,
  type WorkAssignmentDigestCadence,
  type WorkAssignmentDigestRunRecord,
  type WorkAssignmentRenderedMessagePreviewRecord,
} from "@/lib/api";
import { csvCell } from "@/lib/csv";
import { saveBlob } from "@/lib/download";
import {
  ENTITY_STORAGE_KEY,
  defaultEntitySelection,
  isAllEntities,
  scopeEntityId,
} from "@/lib/entity-selection";
import { useEntityFanOut } from "@/lib/use-entity-fan-out";
import { cn, friendlyError } from "@/lib/utils";

import {
  ArrearsReviewPacketPanel as ArrearsReviewPacketPanelView,
} from "./ArrearsReviewPacketPanel";

const EMPTY_PROPERTIES: PropertyRecord[] = [];
const EMPTY_TENANTS: TenantRecord[] = [];
const EMPTY_OBLIGATIONS: ObligationRecord[] = [];
const EMPTY_COMPLIANCE_CHECKS: ComplianceCheckRecord[] = [];
const EMPTY_ONBOARDINGS: TenantOnboardingRecord[] = [];
const EMPTY_INTAKES: DocumentIntakeRecord[] = [];
const EMPTY_MAINTENANCE: MaintenanceWorkOrderRecord[] = [];
const EMPTY_ARREARS: ArrearsCaseRecord[] = [];
const EMPTY_INVOICE_DRAFTS: InvoiceDraftRecord[] = [];
const EMPTY_CALENDAR_EVENTS: CalendarEventRecord[] = [];
const EMPTY_MEMBERS: SecurityMemberRecord[] = [];
const WORK_MOBILE_TOAST_CLASS =
  "fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] left-5 right-5 z-40 rounded-2xl border border-border bg-white p-4 shadow-leasiumSm md:bottom-5 md:left-auto md:w-[420px]";
const WORK_ASSIGNMENT_KEY = "work_assignment";
const WORK_ASSIGNMENT_TEMPLATE_KEY = "work_assignment_notification";
const WORK_ASSIGNMENT_TEMPLATE_VERSION = "v1";
const OPERATIONS_QUEUE_EXPORT_GUARDRAIL =
  "Local-only review export: downloading this file does not send SendGrid or Twilio messages, send tenant, owner, or provider email, dispatch providers, refresh providers, mutate provider history, generate billing drafts, perform Xero/Basiq writes, apply payment reconciliation, or update maintenance, arrears, onboarding, or assignment records.";
const ARREARS_REVIEW_PACKET_GUARDRAIL =
  "Review-only arrears packet: downloading or copying this file does not send email, SMS, tenant messages, owner messages, provider dispatch, Xero/Basiq writes, payment reconciliation, invoice updates, arrears status changes, reminder updates, escalation updates, or assignment updates.";
const COMPLIANCE_REVIEW_PACKET_GUARDRAIL =
  "Review-only compliance packet: copying or downloading this file does not complete checks, upload evidence, create or update obligations, apply Smart Intake, create or update work orders, send email/SMS, dispatch providers, create billing drafts, call Xero/Basiq, or reconcile payments.";
const APPROVALS_REVIEW_PACKET_GUARDRAIL =
  "Review-only approvals packet: copying or downloading this file does not approve, complete, apply, dispatch, send email/SMS, post to Xero/Basiq, reconcile payments, update provider history, create billing drafts, or mutate Smart Intake, compliance, maintenance, onboarding, invoice, obligation, arrears, assignment, provider, comms, payment, or reconciliation records.";
const COMPLIANCE_CATEGORIES = new Set([
  "insurance",
  "bank_guarantee",
  "make_good",
  "compliance",
]);
const COMPLIANCE_DOCUMENT_TYPES = new Set([
  "insurance_certificate",
  "inspection_report",
]);

const tabs = [
  { id: "queue", label: "Queue", description: "All operational work" },
  {
    id: "approvals",
    label: "Approvals",
    description: "Review-only decision queue",
  },
  {
    id: "calendar",
    label: "Calendar",
    description: "Dates and deadlines",
  },
  {
    id: "maintenance",
    label: "Maintenance",
    description: "Repairs and approvals",
  },
  {
    id: "compliance",
    label: "Compliance",
    description: "Checks and inspections",
  },
  { id: "arrears", label: "Arrears", description: "Balances and escalation" },
] as const;

const approvalGroups = [
  {
    id: "ready",
    label: "Ready",
    description: "Reviewable now",
    tone: "primary",
  },
  {
    id: "blocked",
    label: "Needs evidence/setup",
    description: "Needs context first",
    tone: "warning",
  },
  {
    id: "provider_adjacent",
    label: "Provider-adjacent",
    description: "Could lead to send, dispatch, Xero, or payment work",
    tone: "danger",
  },
  {
    id: "watching",
    label: "Recently safe/no action",
    description: "Tracked but not urgent",
    tone: "neutral",
  },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  description: string;
  tone: StatusTone;
}>;

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

const workRanges = [
  { id: "today", label: "Today", mobileLabel: "Today" },
  { id: "week", label: "This week", mobileLabel: "Week" },
  { id: "all", label: "All", mobileLabel: "All" },
] as const;

type WorkRange = (typeof workRanges)[number]["id"];
type CalendarLayout = "agenda" | "month";
type CalendarSourceFilter =
  | "all"
  | "leases"
  | "work"
  | "compliance"
  | "billing"
  | "arrears"
  | "onboarding";
type CalendarDateFilter = "all" | "overdue" | "week" | "next30";

const CALENDAR_EVENT_LABELS: Record<CalendarEventRecord["type"], string> = {
  lease_expiry: "Lease expiry",
  rent_review: "Rent review",
  maintenance_due: "Maintenance",
  compliance_due: "Compliance",
  obligation: "Obligation",
  charge_due: "Charge due",
  billing_due: "Billing",
  invoice_due: "Invoice",
  arrears_reminder: "Arrears reminder",
  promise_to_pay: "Promise to pay",
  tenant_onboarding: "Onboarding",
};

const CALENDAR_SOURCE_FILTERS: Array<{
  id: CalendarSourceFilter;
  label: string;
}> = [
  { id: "all", label: "All sources" },
  { id: "leases", label: "Leases" },
  { id: "work", label: "Work" },
  { id: "compliance", label: "Compliance" },
  { id: "billing", label: "Billing" },
  { id: "arrears", label: "Arrears" },
  { id: "onboarding", label: "Onboarding" },
];

const CALENDAR_DATE_FILTERS: Array<{
  id: CalendarDateFilter;
  label: string;
}> = [
  { id: "all", label: "All dates" },
  { id: "overdue", label: "Overdue" },
  { id: "week", label: "This week" },
  { id: "next30", label: "Next 30" },
];

const horizonWorkLanes = [
  {
    id: "act_now",
    label: "Act now",
    tone: "danger",
    dotClassName: "bg-danger",
    railClassName: "bg-danger",
  },
  {
    id: "scheduled",
    label: "Scheduled",
    tone: "primary",
    dotClassName: "bg-info",
    railClassName: "bg-info",
  },
  {
    id: "waiting",
    label: "Waiting",
    tone: "neutral",
    dotClassName: "bg-leasium-slate-300",
    railClassName: "bg-leasium-slate-300",
  },
] as const;

type HorizonWorkLaneId = (typeof horizonWorkLanes)[number]["id"];

type QueueItem =
  | {
      id: string;
      kind: "obligation";
      title: string;
      description: string;
      dueDate: string | null;
      tone: StatusTone;
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
      tone: StatusTone;
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
      tone: StatusTone;
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
      tone: StatusTone;
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
      tone: StatusTone;
      chip: string;
      href: string;
      record: ArrearsCaseRecord;
      completed: boolean;
    };

type AssignableQueueItem = Extract<
  QueueItem,
  { kind: "obligation" | "maintenance" | "arrears" }
>;

type ApprovalGroupId = (typeof approvalGroups)[number]["id"];

type ApprovalCandidateKind =
  | "smart_intake"
  | "maintenance"
  | "invoice_draft"
  | "compliance"
  | "onboarding"
  | "assignment_notice";

type ApprovalGroupFilter = "all" | ApprovalGroupId;
type ApprovalKindFilter = "all" | ApprovalCandidateKind;

const approvalKindFilters: ReadonlyArray<{
  id: ApprovalKindFilter;
  label: string;
}> = [
  { id: "all", label: "All sources" },
  { id: "smart_intake", label: "Smart Intake" },
  { id: "maintenance", label: "Maintenance" },
  { id: "invoice_draft", label: "Invoice drafts" },
  { id: "compliance", label: "Compliance" },
  { id: "onboarding", label: "Tenant onboarding" },
  { id: "assignment_notice", label: "Assignment notices" },
];

type ApprovalCandidate = {
  id: string;
  kind: ApprovalCandidateKind;
  group: ApprovalGroupId;
  tone: StatusTone;
  title: string;
  sourceLabel: string;
  statusLabel: string;
  context: string;
  reason: string;
  dueDate: string | null;
  href: string;
  guardrail: string;
  previewDetails: string[];
};

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

type ArrearsReviewPacketEvidenceRow = {
  label: string;
  statusLabel: string;
  detail: string;
  tone: StatusTone;
};

type ArrearsReviewPacket = {
  nextAction: string;
  nextActionDetail: string;
  nextActionTone: StatusTone;
  evidenceRows: ArrearsReviewPacketEvidenceRow[];
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
  tone: StatusTone;
  statusLabel: string;
  summary: string;
  meta: string;
  at: string | null;
};

type MaintenanceUndoField = "status" | "priority";

type MaintenanceInlineUndo = {
  id: string;
  entityId: string;
  workOrderId: string;
  title: string;
  field: MaintenanceUndoField;
  previous: MaintenanceWorkOrderStatus | MaintenancePriority;
  next: MaintenanceWorkOrderStatus | MaintenancePriority;
  undoing: boolean;
  error: string | null;
};

const ASSIGNMENT_EMAIL_DELIVERED_STATUSES = [
  "queued",
  "sent",
  "delivered",
  "opened",
];
const ASSIGNMENT_EMAIL_PROBLEM_STATUSES = ["failed", "skipped"];

// Keyboard flow (Phase D, ported from the command center): once focus is inside
// the operations queue, j / ArrowDown and k / ArrowUp move between row links and
// Enter opens the focused row natively. Lives on the list container so it only
// fires when a row already has focus — never hijacks global keys; Tab, click,
// and the per-row work controls are unchanged.
function handleQueueKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  if (!["j", "k", "ArrowDown", "ArrowUp"].includes(event.key)) {
    return;
  }
  const rows = Array.from(
    event.currentTarget.querySelectorAll<HTMLAnchorElement>("[data-ops-row]"),
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

function assignmentNoticeTone(group: AssignmentNoticeGroup): StatusTone {
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

const QUEUE_BUCKETS = [
  { id: "overdue", label: "Overdue" },
  { id: "due_soon", label: "Due soon" },
  { id: "scheduled", label: "Scheduled" },
  { id: "no_date", label: "No date" },
] as const;

type QueueBucketId = (typeof QUEUE_BUCKETS)[number]["id"];

function queueBucketId(item: QueueItem): QueueBucketId {
  if (!item.dueDate) {
    return "no_date";
  }
  const rank = dueRank(item.dueDate);
  if (rank < 0) {
    return "overdue";
  }
  if (rank <= 7) {
    return "due_soon";
  }
  return "scheduled";
}

function horizonWorkLaneId(item: QueueItem): HorizonWorkLaneId {
  const bucket = queueBucketId(item);
  if (bucket === "no_date") {
    return "waiting";
  }
  if (bucket === "overdue" || item.tone === "danger") {
    return "act_now";
  }
  return "scheduled";
}

function workRangeMatches(item: QueueItem, range: WorkRange) {
  if (range === "all") {
    return true;
  }
  if (!item.dueDate) {
    return true;
  }
  const rank = dueRank(item.dueDate);
  if (range === "today") {
    return rank <= 0;
  }
  return rank <= 7;
}

function queueBucketTone(id: QueueBucketId): StatusTone {
  if (id === "overdue") {
    return "danger";
  }
  if (id === "due_soon") {
    return "warning";
  }
  return "neutral";
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

function calendarWindow() {
  const today = new Date();
  return {
    from: dateOnly(addDays(today, -90)),
    to: dateOnly(addDays(today, 180)),
  };
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

function calendarEventLabel(event: CalendarEventRecord) {
  return event.chip || CALENDAR_EVENT_LABELS[event.type];
}

function calendarEventSourceLabel(event: CalendarEventRecord) {
  return event.source.table.replaceAll("_", " ");
}

function calendarEventSourceFilter(
  event: CalendarEventRecord,
): Exclude<CalendarSourceFilter, "all"> {
  if (event.type === "lease_expiry" || event.type === "rent_review") {
    return "leases";
  }
  if (event.type === "maintenance_due") {
    return "work";
  }
  if (event.type === "compliance_due" || event.type === "obligation") {
    return "compliance";
  }
  if (
    event.type === "charge_due" ||
    event.type === "billing_due" ||
    event.type === "invoice_due"
  ) {
    return "billing";
  }
  if (event.type === "arrears_reminder" || event.type === "promise_to_pay") {
    return "arrears";
  }
  return "onboarding";
}

function calendarDateFilterMatches(
  event: CalendarEventRecord,
  filter: CalendarDateFilter,
) {
  const rank = dueRank(event.date);
  if (filter === "overdue") {
    return rank < 0;
  }
  if (filter === "week") {
    return rank >= 0 && rank <= 7;
  }
  if (filter === "next30") {
    return rank >= 0 && rank <= 30;
  }
  return true;
}

function sortCalendarEvents(events: CalendarEventRecord[]) {
  const severityRank: Record<StatusTone, number> = {
    danger: 0,
    warning: 1,
    primary: 2,
    neutral: 3,
    success: 4,
  };
  return [...events].sort((a, b) => {
    const dateDelta = a.date.localeCompare(b.date);
    if (dateDelta !== 0) {
      return dateDelta;
    }
    const severityDelta = severityRank[a.severity] - severityRank[b.severity];
    if (severityDelta !== 0) {
      return severityDelta;
    }
    return a.title.localeCompare(b.title);
  });
}

function groupCalendarEvents(events: CalendarEventRecord[]) {
  const groups = new Map<string, CalendarEventRecord[]>();
  for (const event of sortCalendarEvents(events)) {
    const bucket = groups.get(event.date) ?? [];
    bucket.push(event);
    groups.set(event.date, bucket);
  }
  return Array.from(groups, ([date, items]) => ({ date, items }));
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

function sentenceLabel(value: string | null | undefined) {
  const text = label(value);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

async function copyTextToClipboard(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to the textarea copy path for restricted browser contexts.
    }
  }
  if (typeof document === "undefined") {
    return false;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
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

function assignmentSummary(metadata: Record<string, unknown>) {
  const assignment = workAssignment(metadata);
  if (assignment?.assignedName) {
    return assignment.assignedName;
  }
  return assignment?.assignedUserId ? "Assigned" : "Unassigned";
}

function queueAssignmentSummary(item: QueueItem) {
  if (!isAssignableQueueItem(item)) {
    return "";
  }
  return (
    assignedUserName(item) ?? (assignedUserId(item) ? "Assigned" : "Unassigned")
  );
}

function queueMobileActionSummary(item: QueueItem) {
  if (!isAssignableQueueItem(item)) {
    return "";
  }
  const assignment = workAssignment(item.record.metadata);
  const notice = assignment?.notificationStatus
    ? `notice ${label(assignment.notificationStatus)}`
    : null;
  return [queueAssignmentSummary(item), item.chip, notice]
    .filter(Boolean)
    .join(" - ");
}

function operationsQueueReviewCsv(items: QueueItem[]) {
  const rows: Array<Array<string | number | null | undefined>> = [
    [
      "Kind",
      "Title",
      "Context",
      "Due",
      "Urgency",
      "Completion",
      "Assignee",
      "Notification",
      "Follow-up",
      "Guardrail",
    ],
    ...items.map((item) => {
      const assignment = isAssignableQueueItem(item)
        ? workAssignment(item.record.metadata)
        : null;
      const noticeGroup = isAssignableQueueItem(item)
        ? assignmentNoticeGroup(assignment)
        : null;
      const notificationStatus = assignment?.notificationStatus
        ? `Notification ${label(assignment.notificationStatus)}`
        : noticeGroup
          ? `Notification ${assignmentNoticeLabel(noticeGroup)}`
          : "No assignment notification";
      const followUp = [
        assignment?.reminderStatus
          ? `Reminder ${label(assignment.reminderStatus)}`
          : null,
        assignment?.reminderDueOn
          ? `due ${formatDate(assignment.reminderDueOn)}`
          : null,
        assignment?.escalationStatus
          ? `Escalation ${label(assignment.escalationStatus)}`
          : null,
        assignment?.escalationDueOn
          ? `due ${formatDate(assignment.escalationDueOn)}`
          : null,
      ]
        .filter(Boolean)
        .join("; ");

      return [
        queueKindLabel(item),
        item.title,
        item.description,
        item.kind === "document_intake"
          ? formatDateTime(item.dueDate)
          : formatDate(item.dueDate),
        item.chip,
        item.completed ? "Complete" : "Open",
        isAssignableQueueItem(item)
          ? (assignment?.assignedName ??
            assignment?.assignedEmail ??
            (assignedUserId(item) ? "Assigned" : "Unassigned"))
          : "",
        notificationStatus,
        followUp || "No follow-up due",
        OPERATIONS_QUEUE_EXPORT_GUARDRAIL,
      ];
    }),
    [
      "Export guardrail",
      "",
      "",
      "",
      "",
      "Review-only",
      "",
      "",
      "",
      OPERATIONS_QUEUE_EXPORT_GUARDRAIL,
    ],
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function approvalContext(
  scope: {
    property_id?: string | null;
    tenant_id?: string | null;
  },
  properties: PropertyRecord[],
  tenants: TenantRecord[],
) {
  return [
    propertyName(properties, scope.property_id),
    scope.tenant_id ? tenantName(tenants, scope.tenant_id) : null,
  ]
    .filter(Boolean)
    .join(" - ");
}

function approvalKindLabel(kind: ApprovalCandidateKind) {
  const labels: Record<ApprovalCandidateKind, string> = {
    smart_intake: "Smart Intake",
    maintenance: "Maintenance",
    invoice_draft: "Invoice draft",
    compliance: "Compliance",
    onboarding: "Tenant onboarding",
    assignment_notice: "Assignment notice",
  };
  return labels[kind];
}

function approvalPreviewDetails(
  ...details: Array<string | null | undefined>
) {
  return details.filter(Boolean) as string[];
}

function onboardingApprovalHref(onboarding: TenantOnboardingRecord) {
  return onboarding.tenant_id
    ? `/tenants/${encodeURIComponent(onboarding.tenant_id)}`
    : "/tenants";
}

function assignmentNoticeApprovalHref(item: AssignableQueueItem) {
  if (item.kind === "maintenance") {
    return `/operations/maintenance/${encodeURIComponent(item.record.id)}`;
  }
  if (item.kind === "arrears") {
    return "/operations?tab=arrears";
  }
  return item.href;
}

function buildApprovalCandidates({
  intakes,
  maintenance,
  invoiceDrafts,
  complianceChecks,
  onboardings,
  readyNotificationItems,
  properties,
  tenants,
}: {
  intakes: DocumentIntakeRecord[];
  maintenance: MaintenanceWorkOrderRecord[];
  invoiceDrafts: InvoiceDraftRecord[];
  complianceChecks: ComplianceCheckRecord[];
  onboardings: TenantOnboardingRecord[];
  readyNotificationItems: AssignableQueueItem[];
  properties: PropertyRecord[];
  tenants: TenantRecord[];
}) {
  const candidates: ApprovalCandidate[] = [];

  for (const intake of intakes.filter((item) =>
    ["ready_for_review", "needs_attention", "failed"].includes(item.status),
  )) {
    const needsSetup = intake.status !== "ready_for_review";
    candidates.push({
      id: `smart-intake-${intake.id}`,
      kind: "smart_intake",
      group: needsSetup ? "blocked" : "ready",
      tone: intakeTone(intake),
      title: intakeTitle(intake),
      sourceLabel: "Smart Intake",
      statusLabel: intakeChip(intake),
      context: [documentTypeLabel(intake.document_type), intake.filename]
        .filter(Boolean)
        .join(" - "),
      reason:
        intake.summary ??
        "Review extracted document fields before applying anything.",
      dueDate: intake.created_at,
      href: intakeReviewHref(intake),
      guardrail:
        "Open the Smart Intake review to approve, edit, ignore, or apply extracted fields.",
      previewDetails: approvalPreviewDetails(
        `Document type: ${documentTypeLabel(intake.document_type)}`,
        intake.filename ? `File: ${intake.filename}` : null,
        `Created ${formatDate(intake.created_at)}`,
      ),
    });
  }

  for (const workOrder of maintenance.filter(
    (item) =>
      item.approval_status === "pending" ||
      item.status === "awaiting_approval",
  )) {
    candidates.push({
      id: `maintenance-${workOrder.id}`,
      kind: "maintenance",
      group: "provider_adjacent",
      tone: maintenanceTone(workOrder),
      title: workOrder.title,
      sourceLabel: "Maintenance",
      statusLabel: "Needs approval",
      context: approvalContext(workOrder, properties, tenants),
      reason: [
        workOrder.quote_amount_cents
          ? `Quote ${formatMoney(workOrder.quote_amount_cents)}`
          : null,
        workOrder.approval_limit_cents
          ? `Limit ${formatMoney(workOrder.approval_limit_cents)}`
          : null,
        workOrder.notes,
      ]
        .filter(Boolean)
        .join(" - "),
      dueDate: workOrder.due_date,
      href: `/operations/maintenance/${encodeURIComponent(workOrder.id)}`,
      guardrail:
        "Review the maintenance record before any owner approval, contractor dispatch, or invoice work.",
      previewDetails: approvalPreviewDetails(
        workOrder.quote_amount_cents
          ? `Quote: ${formatMoney(workOrder.quote_amount_cents)}`
          : null,
        workOrder.approval_limit_cents
          ? `Approval limit: ${formatMoney(workOrder.approval_limit_cents)}`
          : null,
        workOrder.contractor_name
          ? `Contractor: ${workOrder.contractor_name}`
          : null,
        workOrder.status
          ? `Work status: ${sentenceLabel(workOrder.status)}`
          : null,
      ),
    });
  }

  for (const draft of invoiceDrafts.filter(
    (item) => item.status === "ready_for_approval",
  )) {
    candidates.push({
      id: `invoice-draft-${draft.id}`,
      kind: "invoice_draft",
      group: "provider_adjacent",
      tone: "primary",
      title: draft.title,
      sourceLabel: "Billing",
      statusLabel: "Ready for approval",
      context: [
        approvalContext(draft, properties, tenants),
        draft.recipient_name,
        formatMoney(draft.total_cents, draft.currency),
      ]
        .filter(Boolean)
        .join(" - "),
      reason:
        draft.notes ??
        "Review the invoice draft before tenant delivery or Xero posting.",
      dueDate: draft.due_date,
      href: `/billing-readiness?entity_id=${encodeURIComponent(
        draft.entity_id,
      )}&invoice_id=${encodeURIComponent(draft.id)}`,
      guardrail:
        "Open Billing Readiness to approve the draft, send tenant email, or post to Xero.",
      previewDetails: approvalPreviewDetails(
        draft.recipient_name ? `Recipient: ${draft.recipient_name}` : null,
        `Amount: ${formatMoney(draft.total_cents, draft.currency)}`,
        draft.invoice_number ? `Invoice: ${draft.invoice_number}` : null,
        draft.issue_date ? `Issue date: ${formatDate(draft.issue_date)}` : null,
      ),
    });
  }

  for (const check of complianceChecks.filter(canCompleteComplianceCheck)) {
    candidates.push({
      id: `compliance-${check.id}`,
      kind: "compliance",
      group: "ready",
      tone: complianceCheckTone(check),
      title: check.title,
      sourceLabel: "Compliance",
      statusLabel: "Evidence linked",
      context: complianceScopeContext(check, properties, tenants),
      reason: complianceCheckNextAction(check),
      dueDate: check.next_due_date,
      href: `/operations?tab=compliance#compliance-check-${encodeURIComponent(
        check.id,
      )}`,
      guardrail:
        "Open the Compliance tab to inspect evidence before completing and rolling the check forward.",
      previewDetails: approvalPreviewDetails(
        `Scope: ${complianceScopeContext(check, properties, tenants) || "No scope"}`,
        check.current_obligation_id
          ? `Current obligation: ${check.current_obligation_id}`
          : null,
        check.source_document_id
          ? `Evidence document: ${check.source_document_id}`
          : null,
        check.owner_role
          ? `Owner role: ${sentenceLabel(check.owner_role)}`
          : null,
      ),
    });
  }

  for (const onboarding of onboardings.filter(
    (item) => item.status === "submitted" || dueRank(item.due_date) < 0,
  )) {
    const submitted = onboarding.status === "submitted";
    candidates.push({
      id: `onboarding-${onboarding.id}`,
      kind: "onboarding",
      group: submitted ? "ready" : "blocked",
      tone: onboardingTone(onboarding),
      title: submitted
        ? "Tenant onboarding ready for review"
        : "Tenant onboarding follow-up",
      sourceLabel: "Tenant onboarding",
      statusLabel: submitted ? "Submitted" : sentenceLabel(onboarding.status),
      context: tenantName(tenants, onboarding.tenant_id),
      reason: submitted
        ? "Tenant submitted onboarding details for operator review."
        : "Onboarding is overdue and needs follow-up before approval.",
      dueDate: onboarding.due_date,
      href: onboardingApprovalHref(onboarding),
      guardrail:
        "Open Tenants to review onboarding details before applying or sending any portal follow-up.",
      previewDetails: approvalPreviewDetails(
        `Tenant: ${tenantName(tenants, onboarding.tenant_id)}`,
        onboarding.submitted_at
          ? `Submitted ${formatDate(onboarding.submitted_at)}`
          : null,
        onboarding.expires_at
          ? `Expires ${formatDate(onboarding.expires_at)}`
          : null,
        onboarding.portal_url ? "Portal link exists" : null,
      ),
    });
  }

  for (const item of readyNotificationItems) {
    const assignment = workAssignment(item.record.metadata);
    candidates.push({
      id: `assignment-notice-${item.id}`,
      kind: "assignment_notice",
      group: "provider_adjacent",
      tone: "primary",
      title: "Assignment notice ready",
      sourceLabel: queueKindLabel(item),
      statusLabel: "Ready",
      context: [
        item.title,
        assignment?.assignedName,
        assignment?.assignedEmail,
      ]
        .filter(Boolean)
        .join(" - "),
      reason:
        assignment?.notificationDetail ??
        "Assignment email preview is ready for operator review.",
      dueDate: item.dueDate,
      href: assignmentNoticeApprovalHref(item),
      guardrail:
        "Use the Queue controls to review and send the assignment notice.",
      previewDetails: approvalPreviewDetails(
        `Source item: ${item.title}`,
        assignment?.assignedName
          ? `Assignee: ${assignment.assignedName}`
          : null,
        assignment?.assignedEmail
          ? `Email: ${assignment.assignedEmail}`
          : null,
        assignment?.assignedRole
          ? `Role: ${sentenceLabel(assignment.assignedRole)}`
          : null,
      ),
    });
  }

  const groupRank: Record<ApprovalGroupId, number> = {
    ready: 0,
    blocked: 1,
    provider_adjacent: 2,
    watching: 3,
  };
  return candidates.sort((a, b) => {
    const groupDelta = groupRank[a.group] - groupRank[b.group];
    if (groupDelta !== 0) {
      return groupDelta;
    }
    const dueDelta = dueRank(a.dueDate) - dueRank(b.dueDate);
    if (dueDelta !== 0) {
      return dueDelta;
    }
    return a.title.localeCompare(b.title);
  });
}

function operationsApprovalsReviewCsv(candidates: ApprovalCandidate[]) {
  const rows: Array<Array<string | number | null | undefined>> = [
    [
      "Kind",
      "Title",
      "Source",
      "Status",
      "Context",
      "Due",
      "Reason",
      "Guardrail",
    ],
    ...candidates.map((candidate) => [
      approvalKindLabel(candidate.kind),
      candidate.title,
      candidate.sourceLabel,
      candidate.statusLabel,
      candidate.context,
      candidate.kind === "smart_intake"
        ? formatDateTime(candidate.dueDate)
        : formatDate(candidate.dueDate),
      candidate.reason,
      APPROVALS_REVIEW_PACKET_GUARDRAIL,
    ]),
    [
      "Export guardrail",
      "",
      "",
      "Review-only",
      "",
      "",
      "No approval or provider action ran.",
      APPROVALS_REVIEW_PACKET_GUARDRAIL,
    ],
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function approvalCandidatePacketFilename(candidate: ApprovalCandidate) {
  const sourcePrefix = `${candidate.kind.replace(/_/g, "-")}-`;
  const rawId = candidate.id.startsWith(`${sourcePrefix}${sourcePrefix}`)
    ? candidate.id.slice(sourcePrefix.length)
    : candidate.id;
  const slug =
    rawId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "candidate";
  return `approval-candidate-${slug}.csv`;
}

function approvalCandidatePacketCsv(candidate: ApprovalCandidate) {
  const due =
    candidate.kind === "smart_intake"
      ? formatDateTime(candidate.dueDate)
      : formatDate(candidate.dueDate);
  const rows: Array<Array<string | number | null | undefined>> = [
    ["Single approval candidate packet", candidate.title, ""],
    ["Field", "Value", "Guardrail"],
    ["Kind", approvalKindLabel(candidate.kind), APPROVALS_REVIEW_PACKET_GUARDRAIL],
    ["Title", candidate.title, APPROVALS_REVIEW_PACKET_GUARDRAIL],
    ["Source", candidate.sourceLabel, APPROVALS_REVIEW_PACKET_GUARDRAIL],
    ["Status", candidate.statusLabel, APPROVALS_REVIEW_PACKET_GUARDRAIL],
    [
      "Decision state",
      approvalGroups.find((group) => group.id === candidate.group)?.label ??
        candidate.group,
      APPROVALS_REVIEW_PACKET_GUARDRAIL,
    ],
    ["Context", candidate.context, APPROVALS_REVIEW_PACKET_GUARDRAIL],
    ["Due", due, APPROVALS_REVIEW_PACKET_GUARDRAIL],
    ["Reason", candidate.reason, APPROVALS_REVIEW_PACKET_GUARDRAIL],
    ["Source link", candidate.href, APPROVALS_REVIEW_PACKET_GUARDRAIL],
    ...candidate.previewDetails.map((detail) => [
      "Detail",
      detail,
      APPROVALS_REVIEW_PACKET_GUARDRAIL,
    ]),
    [
      "Export guardrail",
      "Review-only",
      APPROVALS_REVIEW_PACKET_GUARDRAIL,
    ],
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function approvalCandidateMatchesSearch(
  candidate: ApprovalCandidate,
  searchQuery: string,
) {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  return [
    approvalKindLabel(candidate.kind),
    candidate.title,
    candidate.sourceLabel,
    candidate.statusLabel,
    candidate.context,
    candidate.reason,
    candidate.guardrail,
    formatDate(candidate.dueDate),
    ...candidate.previewDetails,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

function complianceCheckTone(check: ComplianceCheckRecord): StatusTone {
  if (check.status === "completed") {
    return "success";
  }
  if (check.status === "paused" || check.status === "archived") {
    return "neutral";
  }
  const days = dueRank(check.next_due_date);
  if (days < 0) {
    return "danger";
  }
  if (days <= 30) {
    return "warning";
  }
  return "primary";
}

function complianceCheckStatusLabel(check: ComplianceCheckRecord) {
  if (check.status !== "active") {
    return sentenceLabel(check.status);
  }
  const days = dueRank(check.next_due_date);
  if (days < 0) {
    return "Overdue";
  }
  if (days <= 30) {
    return "Due soon";
  }
  return "Active";
}

function complianceEvidenceCount(check: ComplianceCheckRecord) {
  const evidenceHistory = Array.isArray(check.metadata.evidence_history)
    ? check.metadata.evidence_history.length
    : 0;
  const completionHistory = Array.isArray(check.metadata.completion_history)
    ? check.metadata.completion_history.length
    : 0;
  return Math.max(
    evidenceHistory,
    completionHistory,
    check.source_document_id ? 1 : 0,
  );
}

function complianceEvidenceLabel(check: ComplianceCheckRecord) {
  const count = complianceEvidenceCount(check);
  if (count === 0) {
    return "No evidence yet";
  }
  return count === 1 ? "Evidence linked" : `${count} evidence events`;
}

function recurrenceLabel(check: ComplianceCheckRecord) {
  const unit =
    check.recurrence_interval === 1
      ? check.recurrence_unit.replace(/s$/, "")
      : check.recurrence_unit;
  return `Every ${check.recurrence_interval} ${unit}`;
}

function memberNameById(
  members: SecurityMemberRecord[],
  memberId: string | null | undefined,
) {
  if (!memberId) {
    return null;
  }
  return members.find((member) => member.id === memberId)
    ? memberLabel(members.find((member) => member.id === memberId)!)
    : "Assigned";
}

function complianceOwnerLabel(
  check: ComplianceCheckRecord,
  members: SecurityMemberRecord[],
) {
  return (
    memberNameById(members, check.assigned_user_id) ??
    (check.owner_role ? sentenceLabel(check.owner_role) : "Unassigned")
  );
}

function complianceScopeContext(
  scope: {
    property_id?: string | null;
    tenant_id?: string | null;
    jurisdiction?: string | null;
    authority?: string | null;
  },
  properties: PropertyRecord[],
  tenants: TenantRecord[],
) {
  return [
    propertyName(properties, scope.property_id),
    scope.tenant_id ? tenantName(tenants, scope.tenant_id) : null,
    scope.jurisdiction,
    scope.authority,
  ]
    .filter(Boolean)
    .join(" - ");
}

function complianceCheckNextAction(check: ComplianceCheckRecord) {
  if (check.status === "paused") {
    return "Review paused check";
  }
  if (check.status === "archived" || check.status === "completed") {
    return "No open action";
  }
  const days = dueRank(check.next_due_date);
  if (days < 0) {
    return "Review overdue evidence and roll forward";
  }
  if (days <= 30) {
    return "Request evidence before due date";
  }
  return "Monitor next due date";
}

function canCompleteComplianceCheck(check: ComplianceCheckRecord) {
  return (
    check.status === "active" &&
    Boolean(check.source_document_id) &&
    dueRank(check.next_due_date) <= 30
  );
}

function complianceCompletionActionLabel(check: ComplianceCheckRecord) {
  if (canCompleteComplianceCheck(check)) {
    return "Complete with linked evidence";
  }
  if (!check.source_document_id) {
    return "Needs evidence";
  }
  if (check.status !== "active") {
    return "No open action";
  }
  return "Evidence current";
}

function isComplianceObligation(obligation: ObligationRecord) {
  return (
    COMPLIANCE_CATEGORIES.has(obligation.category) &&
    !["completed", "waived"].includes(obligation.status)
  );
}

function complianceIntakeTitle(intake: DocumentIntakeRecord) {
  if (intake.document_type === "inspection_report") {
    return "Inspection report waiting review";
  }
  if (intake.document_type === "insurance_certificate") {
    return "Insurance certificate waiting review";
  }
  return "Compliance document waiting review";
}

function isComplianceIntake(intake: DocumentIntakeRecord) {
  return (
    intakeIsOpen(intake) &&
    COMPLIANCE_DOCUMENT_TYPES.has(intake.document_type ?? "")
  );
}

function inspectionWorkOrderIntakeId(workOrder: MaintenanceWorkOrderRecord) {
  const metadata = workOrder.metadata;
  return stringValue(metadata, "document_intake_id");
}

function isInspectionWorkOrder(workOrder: MaintenanceWorkOrderRecord) {
  const metadata = workOrder.metadata;
  return (
    maintenanceIsOpen(workOrder) &&
    stringValue(metadata, "source") === "document_intake" &&
    stringValue(metadata, "document_type") === "inspection_report"
  );
}

function inspectionWorkOrderFinding(workOrder: MaintenanceWorkOrderRecord) {
  const finding = workOrder.metadata.inspection_finding;
  return isPlainRecord(finding) ? finding : {};
}

function complianceReviewCsv({
  checks,
  obligations,
  intakes,
  workOrders,
  properties,
  tenants,
  members,
}: {
  checks: ComplianceCheckRecord[];
  obligations: ObligationRecord[];
  intakes: DocumentIntakeRecord[];
  workOrders: MaintenanceWorkOrderRecord[];
  properties: PropertyRecord[];
  tenants: TenantRecord[];
  members: SecurityMemberRecord[];
}) {
  const rows: Array<Array<string | number | null | undefined>> = [
    [
      "Kind",
      "Title",
      "Context",
      "Due",
      "Status",
      "Owner",
      "Evidence",
      "Next action",
      "Guardrail",
    ],
    ...checks.map((check) => [
      "Compliance check",
      check.title,
      [
        complianceScopeContext(check, properties, tenants),
        recurrenceLabel(check),
        check.notes,
      ]
        .filter(Boolean)
        .join(" - "),
      formatDate(check.next_due_date),
      complianceCheckStatusLabel(check),
      complianceOwnerLabel(check, members),
      complianceEvidenceLabel(check),
      complianceCheckNextAction(check),
      COMPLIANCE_REVIEW_PACKET_GUARDRAIL,
    ]),
    ...obligations.map((obligation) => [
      "Compliance obligation",
      obligation.title,
      [
        complianceScopeContext(obligation, properties, tenants),
        obligation.notes,
      ]
        .filter(Boolean)
        .join(" - "),
      formatDate(obligation.due_date),
      sentenceLabel(obligation.status),
      obligation.owner_role ? sentenceLabel(obligation.owner_role) : "",
      obligation.metadata.source_document_id ? "Evidence linked" : "",
      "Review obligation before marking complete",
      COMPLIANCE_REVIEW_PACKET_GUARDRAIL,
    ]),
    ...intakes.map((intake) => [
      "Inspection intake",
      complianceIntakeTitle(intake),
      [documentTypeLabel(intake.document_type), intake.filename, intake.summary]
        .filter(Boolean)
        .join(" - "),
      formatDateTime(intake.created_at),
      intakeChip(intake),
      "",
      intake.document_id ? "Source document linked" : "",
      "Open Leasium AI review",
      COMPLIANCE_REVIEW_PACKET_GUARDRAIL,
    ]),
    ...workOrders.map((workOrder) => [
      "Inspection work order",
      workOrder.title,
      [
        complianceScopeContext(workOrder, properties, tenants),
        stringValue(inspectionWorkOrderFinding(workOrder), "location"),
        workOrder.source_reference,
      ]
        .filter(Boolean)
        .join(" - "),
      formatDate(workOrder.due_date),
      `${sentenceLabel(workOrder.status)} / ${sentenceLabel(workOrder.priority)}`,
      assignmentSummary(workOrder.metadata),
      workOrder.document_ids.length
        ? `${workOrder.document_ids.length} document link`
        : "",
      "Review work order before contractor dispatch",
      COMPLIANCE_REVIEW_PACKET_GUARDRAIL,
    ]),
    [
      "Export guardrail",
      "",
      "",
      "",
      "Review-only",
      "",
      "",
      "",
      COMPLIANCE_REVIEW_PACKET_GUARDRAIL,
    ],
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function complianceCompletionHistory(check: ComplianceCheckRecord) {
  const history = check.metadata.completion_history;
  return Array.isArray(history) ? history.filter(isPlainRecord) : [];
}

function latestComplianceCompletion(check: ComplianceCheckRecord) {
  const history = complianceCompletionHistory(check);
  return history.length ? history[history.length - 1] : null;
}

function complianceEvidenceDocumentId(check: ComplianceCheckRecord) {
  const latestCompletion = latestComplianceCompletion(check);
  return (
    check.source_document_id ??
    (latestCompletion
      ? stringValue(latestCompletion, "source_document_id")
      : null)
  );
}

function complianceCompletionDateLabel(check: ComplianceCheckRecord) {
  const latestCompletion = latestComplianceCompletion(check);
  const completedAt = latestCompletion
    ? stringValue(latestCompletion, "completed_at")
    : null;
  return completedAt ? formatDate(completedAt) : "No completion yet";
}

function complianceCompletionNextDueLabel(check: ComplianceCheckRecord) {
  const latestCompletion = latestComplianceCompletion(check);
  const nextDue = latestCompletion
    ? stringValue(latestCompletion, "next_due_date")
    : null;
  return formatDate(nextDue ?? check.next_due_date);
}

type ComplianceCompletionEntry = {
  completedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  operatorApproved: boolean;
  sourceDocumentId: string | null;
  notes: string | null;
};

// Most-recent-first view of the check's completion history, reading the
// operator-approved completion fields the backend now records. Pure
// read/display — no mutation.
function complianceCompletionEntries(
  check: ComplianceCheckRecord,
): ComplianceCompletionEntry[] {
  return complianceCompletionHistory(check)
    .map((entry) => ({
      completedAt: stringValue(entry, "completed_at"),
      approvedBy:
        stringValue(entry, "approved_by") ??
        stringValue(entry, "approved_by_user_id"),
      approvedAt: stringValue(entry, "approved_at"),
      operatorApproved: entry.operator_approved === true,
      sourceDocumentId: stringValue(entry, "source_document_id"),
      notes: stringValue(entry, "notes"),
    }))
    .reverse();
}

function latestComplianceCompletionEntry(check: ComplianceCheckRecord) {
  return complianceCompletionEntries(check)[0] ?? null;
}

function complianceEvidenceNotes(check: ComplianceCheckRecord) {
  return (
    latestComplianceCompletionEntry(check)?.notes ??
    check.notes ??
    "No notes recorded"
  );
}

function complianceHasEvidence(check: ComplianceCheckRecord) {
  return complianceEvidenceCount(check) > 0;
}

function complianceEvidenceTone(check: ComplianceCheckRecord): StatusTone {
  return complianceHasEvidence(check) ? "success" : "neutral";
}

function complianceEvidenceStatusLabel(check: ComplianceCheckRecord) {
  return complianceHasEvidence(check) ? "Evidence on file" : "Evidence missing";
}

function complianceCertificateExpiryTone(
  check: ComplianceCheckRecord,
): StatusTone {
  if (check.certificate_expiry_status === "expired") {
    return "danger";
  }
  if (check.certificate_expiry_status === "due_soon") {
    return "warning";
  }
  return "success";
}

function complianceCertificateExpiryLabel(
  check: ComplianceCheckRecord,
): string | null {
  const days = check.days_until_certificate_expiry;
  switch (check.certificate_expiry_status) {
    case "expired": {
      if (days == null) {
        return "Certificate expired";
      }
      const overdue = Math.abs(days);
      return `Certificate expired ${overdue} ${overdue === 1 ? "day" : "days"} ago`;
    }
    case "due_soon": {
      if (days == null) {
        return "Certificate due soon";
      }
      return `Certificate due in ${days} ${days === 1 ? "day" : "days"}`;
    }
    case "ok":
      return "Certificate valid";
    default:
      return null;
  }
}

function complianceEvidencePacketCsv({
  check,
  properties,
  tenants,
  members,
}: {
  check: ComplianceCheckRecord;
  properties: PropertyRecord[];
  tenants: TenantRecord[];
  members: SecurityMemberRecord[];
}) {
  const rows: Array<Array<string | number | null | undefined>> = [
    ["Field", "Value", "Guardrail"],
    ["Check", check.title, COMPLIANCE_REVIEW_PACKET_GUARDRAIL],
    [
      "Context",
      complianceScopeContext(check, properties, tenants),
      COMPLIANCE_REVIEW_PACKET_GUARDRAIL,
    ],
    [
      "Status",
      complianceCheckStatusLabel(check),
      COMPLIANCE_REVIEW_PACKET_GUARDRAIL,
    ],
    ["Next due", formatDate(check.next_due_date), COMPLIANCE_REVIEW_PACKET_GUARDRAIL],
    [
      "Recurrence",
      recurrenceLabel(check),
      COMPLIANCE_REVIEW_PACKET_GUARDRAIL,
    ],
    [
      "Evidence",
      complianceEvidenceLabel(check),
      COMPLIANCE_REVIEW_PACKET_GUARDRAIL,
    ],
    [
      "Source document",
      complianceEvidenceDocumentId(check),
      COMPLIANCE_REVIEW_PACKET_GUARDRAIL,
    ],
    [
      "Last completed",
      complianceCompletionDateLabel(check),
      COMPLIANCE_REVIEW_PACKET_GUARDRAIL,
    ],
    [
      "Completion next due",
      complianceCompletionNextDueLabel(check),
      COMPLIANCE_REVIEW_PACKET_GUARDRAIL,
    ],
    [
      "Owner",
      complianceOwnerLabel(check, members),
      COMPLIANCE_REVIEW_PACKET_GUARDRAIL,
    ],
    [
      "Next action",
      complianceCheckNextAction(check),
      COMPLIANCE_REVIEW_PACKET_GUARDRAIL,
    ],
    ["Guardrail", COMPLIANCE_REVIEW_PACKET_GUARDRAIL, COMPLIANCE_REVIEW_PACKET_GUARDRAIL],
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function maintenanceMobileActionSummary(workOrder: MaintenanceWorkOrderRecord) {
  return [
    assignmentSummary(workOrder.metadata),
    label(workOrder.priority),
    label(workOrder.status),
  ]
    .filter(Boolean)
    .join(" - ");
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
  tone: StatusTone;
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
  tone: StatusTone;
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

function obligationTone(obligation: ObligationRecord): StatusTone {
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

function onboardingTone(onboarding: TenantOnboardingRecord): StatusTone {
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

function intakeTone(intake: DocumentIntakeRecord): StatusTone {
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

function maintenanceTone(workOrder: MaintenanceWorkOrderRecord): StatusTone {
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

function arrearsTone(arrearsCase: ArrearsCaseRecord): StatusTone {
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

function arrearsReviewNextAction(arrearsCase: ArrearsCaseRecord) {
  if (!arrearsIsOpen(arrearsCase)) {
    return {
      label: "Closed - audit only",
      detail:
        "Use this packet for history; reopen the case before changing credit-control state.",
      tone: "neutral" as StatusTone,
    };
  }
  if (
    ["queued", "in_progress", "referred"].includes(
      arrearsCase.escalation_status,
    )
  ) {
    return {
      label: "Review escalation path",
      detail:
        "Escalation is already active or queued. Confirm the next credit-control owner before sending more reminders.",
      tone: "danger" as StatusTone,
    };
  }
  if (
    ["raised", "under_review", "escalated"].includes(
      arrearsCase.dispute_status,
    )
  ) {
    return {
      label: "Review dispute before reminder",
      detail:
        "A dispute is recorded, so review the case context before the next arrears follow-up.",
      tone: "warning" as StatusTone,
    };
  }
  if (dueRank(arrearsCase.next_reminder_on) < 0) {
    return {
      label: "Send or log arrears follow-up",
      detail:
        "The next reminder date is overdue. Use the case actions when ready to mutate reminder history.",
      tone: "danger" as StatusTone,
    };
  }
  if (
    arrearsCase.promise_to_pay_date &&
    dueRank(arrearsCase.promise_to_pay_date) >= 0
  ) {
    return {
      label: "Monitor promise to pay",
      detail:
        "A future promise-to-pay date is recorded. Monitor the case until that date before escalating.",
      tone: "primary" as StatusTone,
    };
  }
  if (arrearsCase.total_balance_cents > 0 && !arrearsCase.next_reminder_on) {
    return {
      label: "Schedule arrears reminder",
      detail: "A positive balance is open and no next reminder date is recorded.",
      tone: "warning" as StatusTone,
    };
  }
  if (arrearsCase.total_balance_cents > 0) {
    return {
      label: "Monitor next reminder",
      detail: `Next reminder is ${dueLabel(arrearsCase.next_reminder_on)}.`,
      tone: "neutral" as StatusTone,
    };
  }
  return {
    label: "Monitor arrears case",
    detail: "No immediate arrears blocker is showing. Continue normal review.",
    tone: "neutral" as StatusTone,
  };
}

function buildArrearsReviewPacket(
  arrearsCase: ArrearsCaseRecord,
): ArrearsReviewPacket {
  const nextAction = arrearsReviewNextAction(arrearsCase);
  const assignment = workAssignment(arrearsCase.metadata);

  return {
    nextAction: nextAction.label,
    nextActionDetail: nextAction.detail,
    nextActionTone: nextAction.tone,
    evidenceRows: [
      {
        label: "Balance age",
        statusLabel: formatMoney(
          arrearsCase.total_balance_cents,
          arrearsCase.currency,
        ),
        detail: [
          `Current ${formatMoney(
            arrearsCase.balance_current_cents,
            arrearsCase.currency,
          )}`,
          `1-30 ${formatMoney(
            arrearsCase.balance_1_30_cents,
            arrearsCase.currency,
          )}`,
          `31-60 ${formatMoney(
            arrearsCase.balance_31_60_cents,
            arrearsCase.currency,
          )}`,
          `61-90 ${formatMoney(
            arrearsCase.balance_61_90_cents,
            arrearsCase.currency,
          )}`,
          `90+ ${formatMoney(
            arrearsCase.balance_90_plus_cents,
            arrearsCase.currency,
          )}`,
        ].join(" - "),
        tone: arrearsCase.total_balance_cents > 0 ? "warning" : "success",
      },
      {
        label: "Reminder",
        statusLabel: dueLabel(arrearsCase.next_reminder_on),
        detail: arrearsCase.last_reminder_at
          ? `Last reminder ${formatDateTime(
              arrearsCase.last_reminder_at,
            )}. Stage ${arrearsCase.reminder_stage}.`
          : `No reminder has been logged yet. Stage ${arrearsCase.reminder_stage}.`,
        tone:
          dueRank(arrearsCase.next_reminder_on) <= 0 ? "warning" : "neutral",
      },
      {
        label: "Dispute",
        statusLabel: label(arrearsCase.dispute_status),
        detail:
          arrearsCase.dispute_status === "none"
            ? "No dispute is recorded."
            : "Review dispute context before follow-up.",
        tone: arrearsCase.dispute_status === "none" ? "neutral" : "warning",
      },
      {
        label: "Escalation",
        statusLabel: label(arrearsCase.escalation_status),
        detail:
          arrearsCase.escalation_status === "none"
            ? "No escalation is active."
            : `Escalation queue: ${
                arrearsCase.escalation_queue ?? "not recorded"
              }.`,
        tone: arrearsCase.escalation_status === "none" ? "neutral" : "danger",
      },
      {
        label: "Promise",
        statusLabel: arrearsCase.promise_to_pay_date
          ? formatDate(arrearsCase.promise_to_pay_date)
          : "No promise",
        detail: arrearsCase.promise_to_pay_amount_cents
          ? `Promised amount ${formatMoney(
              arrearsCase.promise_to_pay_amount_cents,
              arrearsCase.currency,
            )}.`
          : "No promise-to-pay amount is recorded.",
        tone: arrearsCase.promise_to_pay_date ? "primary" : "neutral",
      },
      {
        label: "Assignment",
        statusLabel: assignment?.assignedName ?? "Unassigned",
        detail: assignment?.notificationStatus
          ? `Assignment notice ${label(assignment.notificationStatus)}.`
          : "No assignment notice is ready.",
        tone: assignment?.assignedName ? "primary" : "neutral",
      },
    ],
  };
}

function arrearsReviewPacketText({
  arrearsCase,
  tenantLabel,
  propertyLabel,
  packet,
}: {
  arrearsCase: ArrearsCaseRecord;
  tenantLabel: string;
  propertyLabel: string;
  packet: ArrearsReviewPacket;
}) {
  return [
    "Arrears review packet",
    `Tenant: ${tenantLabel}`,
    `Property: ${propertyLabel}`,
    `Balance: ${formatMoney(
      arrearsCase.total_balance_cents,
      arrearsCase.currency,
    )}`,
    `Status: ${label(arrearsCase.status)}`,
    `Next action: ${packet.nextAction}`,
    packet.nextActionDetail,
    "",
    "Evidence:",
    ...packet.evidenceRows.map(
      (row) => `- ${row.label}: ${row.statusLabel} - ${row.detail}`,
    ),
    "",
    ARREARS_REVIEW_PACKET_GUARDRAIL,
  ].join("\n");
}

function arrearsReviewPacketCsv({
  arrearsCase,
  tenantLabel,
  propertyLabel,
  packet,
}: {
  arrearsCase: ArrearsCaseRecord;
  tenantLabel: string;
  propertyLabel: string;
  packet: ArrearsReviewPacket;
}) {
  const rows: Array<Array<string | number | null | undefined>> = [
    ["Category", "Item", "Status", "Detail", "Guardrail"],
    [
      "Arrears case",
      tenantLabel,
      `${formatMoney(
        arrearsCase.total_balance_cents,
        arrearsCase.currency,
      )} / ${label(arrearsCase.status)}`,
      `${propertyLabel}. Next action: ${packet.nextAction}. ${packet.nextActionDetail}`,
      ARREARS_REVIEW_PACKET_GUARDRAIL,
    ],
    ...packet.evidenceRows.map((row) => [
      "Evidence",
      row.label,
      row.statusLabel,
      row.detail,
      ARREARS_REVIEW_PACKET_GUARDRAIL,
    ]),
    [
      "Export guardrail",
      "",
      "Review-only",
      ARREARS_REVIEW_PACKET_GUARDRAIL,
      ARREARS_REVIEW_PACKET_GUARDRAIL,
    ],
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
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

function intakeReviewHref(intake: DocumentIntakeRecord) {
  return `/intake?entity_id=${encodeURIComponent(
    intake.entity_id,
  )}&review=${encodeURIComponent(intake.id)}`;
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

// One urgency chip per row: overdue wins, then due-soon, then the
// scheduled/no-date neutral tone. Smart Intake rows have no due date
// (dueDate is the received timestamp), so they keep their review chip.
function queueUrgencyChip(task: QueueItem): { label: string; tone: StatusTone } {
  if (task.kind === "document_intake") {
    return { label: task.chip, tone: task.tone };
  }
  return {
    label: dueLabel(task.dueDate),
    tone: queueBucketTone(queueBucketId(task)),
  };
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
      href: intakeReviewHref(intake),
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

  const toneRank: Record<StatusTone, number> = {
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
  const [calendarLayout, setCalendarLayout] =
    useState<CalendarLayout>("agenda");
  const [calendarSourceFilter, setCalendarSourceFilter] =
    useState<CalendarSourceFilter>("all");
  const [calendarDateFilter, setCalendarDateFilter] =
    useState<CalendarDateFilter>("all");
  const [approvalGroupFilter, setApprovalGroupFilter] =
    useState<ApprovalGroupFilter>("all");
  const [approvalKindFilter, setApprovalKindFilter] =
    useState<ApprovalKindFilter>("all");
  const [approvalSearchQuery, setApprovalSearchQuery] = useState("");
  const [selectedApprovalCandidateId, setSelectedApprovalCandidateId] =
    useState<string | null>(null);
  const [previewCalendarEventId, setPreviewCalendarEventId] = useState<
    string | null
  >(null);
  const [workRange, setWorkRange] = useState<WorkRange>("today");
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
      (mStatus &&
        maintenanceStatuses.includes(mStatus as MaintenanceWorkOrderStatus))
    ) {
      setMaintenanceStatus(mStatus as MaintenanceWorkOrderStatus | "all");
    }
    const mPriority = params.get("maintenance_priority");
    if (
      mPriority === "all" ||
      (mPriority &&
        maintenancePriorities.includes(mPriority as MaintenancePriority))
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

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 768px)").matches
    ) {
      setCalendarLayout("month");
    }
  }, []);

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
  const [maintenanceInlineUndo, setMaintenanceInlineUndo] =
    useState<MaintenanceInlineUndo | null>(null);
  // Brief inline confirmation for the obligation Complete/Waive actions
  // (E6). These mutations previously gave no feedback beyond the row
  // leaving the open queue; this reuses the existing transient-status
  // toast pattern below. Local-state only — no provider call.
  const [obligationConfirmation, setObligationConfirmation] = useState<{
    id: string;
    message: string;
  } | null>(null);
  // Two-click inline confirm for the destructive Waive action on
  // obligation queue rows. Local-state only — no provider call.
  const [waiveConfirmId, setWaiveConfirmId] = useState<string | null>(null);
  const [
    complianceCompletionConfirmation,
    setComplianceCompletionConfirmation,
  ] = useState<{
    id: string;
    message: string;
  } | null>(null);
  // Review-first evidence linking for Needs-evidence compliance checks.
  // The form only links an already-stored document; it never completes
  // the check and never calls a provider.
  const [evidenceLinkForm, setEvidenceLinkForm] = useState<{
    checkId: string;
    documentId: string;
    certificateExpiresOn: string;
    file: File | null;
  } | null>(null);
  // Read-only disclosure toggle for a check's completion history. Local
  // UI state only — never mutates the check or calls a provider.
  const [expandedCompletionHistoryId, setExpandedCompletionHistoryId] =
    useState<string | null>(null);
  const [expandedComplianceDetailId, setExpandedComplianceDetailId] =
    useState<string | null>(null);
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
    // The All-entities sentinel is a valid restore target even though it is
    // not a real entity id, so the cross-entity view survives navigation.
    const next =
      stored && (isAllEntities(stored) || accessibleIds.has(stored))
        ? stored
        : defaultEntitySelection(entitiesQuery.data ?? []);
    if (!selectedEntityId && next) {
      setSelectedEntityId(next);
    }
  }, [entitiesQuery.data, selectedEntityId]);

  useEffect(() => {
    if (selectedEntityId) {
      window.localStorage.setItem(ENTITY_STORAGE_KEY, selectedEntityId);
    }
  }, [selectedEntityId]);

  useEffect(() => {
    if (!maintenanceInlineUndo || maintenanceInlineUndo.undoing) return;
    const timeout = window.setTimeout(() => {
      setMaintenanceInlineUndo((current) =>
        current?.id === maintenanceInlineUndo.id ? null : current,
      );
    }, 9000);
    return () => window.clearTimeout(timeout);
  }, [maintenanceInlineUndo]);

  useEffect(() => {
    if (!obligationConfirmation) return;
    const timeout = window.setTimeout(() => {
      setObligationConfirmation((current) =>
        current?.id === obligationConfirmation.id ? null : current,
      );
    }, 6000);
    return () => window.clearTimeout(timeout);
  }, [obligationConfirmation]);

  useEffect(() => {
    if (!complianceCompletionConfirmation) return;
    const timeout = window.setTimeout(() => {
      setComplianceCompletionConfirmation((current) =>
        current?.id === complianceCompletionConfirmation.id ? null : current,
      );
    }, 6000);
    return () => window.clearTimeout(timeout);
  }, [complianceCompletionConfirmation]);

  const selectedEntity = entitiesQuery.data?.find(
    (entity) => entity.id === selectedEntityId,
  );

  // All-entities mode: entity-scoped queries use scopedEntityId (empty in
  // all-mode, so they stay disabled) and the page reads merged fan-out
  // results. Single-entity writes are gated off while allMode is on.
  const allMode = isAllEntities(selectedEntityId);
  const scopedEntityId = scopeEntityId(selectedEntityId);
  const entityNameById = useMemo(
    () =>
      new Map(
        (entitiesQuery.data ?? []).map((entity) => [entity.id, entity.name]),
      ),
    [entitiesQuery.data],
  );
  const operationsCalendarWindow = useMemo(calendarWindow, []);

  const propertiesQuery = useQuery({
    queryKey: ["operations-properties", scopedEntityId],
    queryFn: () => listProperties(scopedEntityId),
    enabled: Boolean(scopedEntityId),
  });

  const tenantsQuery = useQuery({
    queryKey: ["operations-tenants", scopedEntityId],
    queryFn: () => listTenants(scopedEntityId),
    enabled: Boolean(scopedEntityId),
  });

  const obligationsQuery = useQuery({
    queryKey: ["operations-obligations", scopedEntityId],
    queryFn: () => listObligations({ entity_id: scopedEntityId }),
    enabled: Boolean(scopedEntityId),
  });

  const complianceChecksQuery = useQuery({
    queryKey: ["operations-compliance-checks", scopedEntityId],
    queryFn: () => listComplianceChecks({ entity_id: scopedEntityId }),
    enabled: Boolean(scopedEntityId),
  });

  const onboardingQuery = useQuery({
    queryKey: ["operations-onboarding", scopedEntityId],
    queryFn: () => listTenantOnboardings(scopedEntityId),
    enabled: Boolean(scopedEntityId),
  });

  const documentIntakesQuery = useQuery({
    queryKey: ["operations-document-intakes", scopedEntityId],
    queryFn: () => listDocumentIntakes(scopedEntityId),
    enabled: Boolean(scopedEntityId),
  });

  // Stored documents are only fetched while an evidence-link form is open.
  const evidenceDocumentsQuery = useQuery({
    queryKey: ["operations-evidence-documents", scopedEntityId],
    queryFn: () => listDocuments({ entity_id: scopedEntityId }),
    enabled: Boolean(scopedEntityId) && evidenceLinkForm !== null,
  });

  const maintenanceQuery = useQuery({
    queryKey: ["operations-maintenance", scopedEntityId],
    queryFn: () => listMaintenanceWorkOrders({ entity_id: scopedEntityId }),
    enabled: Boolean(scopedEntityId),
  });

  const invoiceDraftsQuery = useQuery({
    queryKey: ["operations-invoice-drafts", scopedEntityId],
    queryFn: () => listInvoiceDrafts({ entity_id: scopedEntityId }),
    enabled: Boolean(scopedEntityId),
  });

  const arrearsQuery = useQuery({
    queryKey: ["operations-arrears", scopedEntityId],
    queryFn: () => listArrearsCases({ entity_id: scopedEntityId }),
    enabled: Boolean(scopedEntityId),
  });

  const calendarQuery = useQuery({
    queryKey: [
      "operations-calendar",
      selectedEntityId,
      operationsCalendarWindow.from,
      operationsCalendarWindow.to,
    ],
    queryFn: () =>
      listCalendarEvents({
        from: operationsCalendarWindow.from,
        to: operationsCalendarWindow.to,
        entity_id: scopedEntityId || undefined,
      }),
    enabled: Boolean(selectedEntityId),
  });

  // Fan-out copies of the primary list queries for all-entities mode. Each
  // runs the same per-entity request across every accessible entity and
  // concatenates the results so the queue/maintenance/arrears tables can
  // render a cross-entity view.
  const propertiesFanOut = useEntityFanOut({
    entities: entitiesQuery.data,
    enabled: allMode,
    keyPrefix: ["operations-properties"],
    queryFn: listProperties,
    orgWideQueryFn: () => listProperties(),
  });
  const tenantsFanOut = useEntityFanOut({
    entities: entitiesQuery.data,
    enabled: allMode,
    keyPrefix: ["operations-tenants"],
    queryFn: listTenants,
    orgWideQueryFn: () => listTenants(),
  });
  const obligationsFanOut = useEntityFanOut({
    entities: entitiesQuery.data,
    enabled: allMode,
    keyPrefix: ["operations-obligations"],
    queryFn: (entityId) => listObligations({ entity_id: entityId }),
    orgWideQueryFn: () => listObligations({}),
  });
  const complianceChecksFanOut = useEntityFanOut({
    entities: entitiesQuery.data,
    enabled: allMode,
    keyPrefix: ["operations-compliance-checks"],
    queryFn: (entityId) => listComplianceChecks({ entity_id: entityId }),
    orgWideQueryFn: () => listComplianceChecks({}),
  });
  const onboardingFanOut = useEntityFanOut({
    entities: entitiesQuery.data,
    enabled: allMode,
    keyPrefix: ["operations-onboarding"],
    queryFn: listTenantOnboardings,
    orgWideQueryFn: () => listTenantOnboardings(),
  });
  const documentIntakesFanOut = useEntityFanOut({
    entities: entitiesQuery.data,
    enabled: allMode,
    keyPrefix: ["operations-document-intakes"],
    queryFn: listDocumentIntakes,
    orgWideQueryFn: () => listDocumentIntakes(),
  });
  const maintenanceFanOut = useEntityFanOut({
    entities: entitiesQuery.data,
    enabled: allMode,
    keyPrefix: ["operations-maintenance"],
    queryFn: (entityId) => listMaintenanceWorkOrders({ entity_id: entityId }),
    orgWideQueryFn: () => listMaintenanceWorkOrders({}),
  });
  const invoiceDraftsFanOut = useEntityFanOut({
    entities: entitiesQuery.data,
    enabled: allMode,
    keyPrefix: ["operations-invoice-drafts"],
    queryFn: (entityId) => listInvoiceDrafts({ entity_id: entityId }),
    orgWideQueryFn: () => listInvoiceDrafts({}),
  });
  const arrearsFanOut = useEntityFanOut({
    entities: entitiesQuery.data,
    enabled: allMode,
    keyPrefix: ["operations-arrears"],
    queryFn: (entityId) => listArrearsCases({ entity_id: entityId }),
    orgWideQueryFn: () => listArrearsCases({}),
  });

  const invalidateOperations = () => {
    queryClient.invalidateQueries({
      queryKey: ["operations-obligations", scopedEntityId],
    });
    queryClient.invalidateQueries({
      queryKey: ["operations-compliance-checks"],
    });
    queryClient.invalidateQueries({
      queryKey: ["operations-maintenance"],
    });
    queryClient.invalidateQueries({
      queryKey: ["billing-readiness-maintenance"],
    });
    queryClient.invalidateQueries({
      queryKey: ["operations-arrears"],
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
    onSuccess: (_data, payload) => {
      invalidateOperations();
      setObligationConfirmation({
        id: `${payload.obligation.id}-${payload.status}-${Date.now()}`,
        message:
          payload.status === "completed"
            ? `Marked “${payload.obligation.title}” complete.`
            : `Waived “${payload.obligation.title}”.`,
      });
    },
  });

  const completeComplianceCheckMutation = useMutation({
    mutationFn: (check: ComplianceCheckRecord) =>
      completeComplianceCheck(check.id, {
        operator_approved: true,
        source_document_id: check.source_document_id,
        completed_at: new Date().toISOString(),
        metadata: {
          source: "operations_compliance_tab",
          action: "complete_with_linked_evidence",
        },
      }),
    onSuccess: (completedCheck, check) => {
      queryClient.setQueryData<ComplianceCheckRecord[]>(
        ["operations-compliance-checks", scopedEntityId],
        (current) =>
          current?.map((row) =>
            row.id === completedCheck.id ? completedCheck : row,
          ),
      );
      invalidateOperations();
      setComplianceCompletionConfirmation({
        id: `${check.id}-${Date.now()}`,
        message: `Completed “${check.title}” with linked evidence.`,
      });
    },
  });

  const linkComplianceEvidenceMutation = useMutation({
    mutationFn: async (input: {
      check: ComplianceCheckRecord;
      documentId: string;
      certificateExpiresOn: string;
      file: File | null;
    }) => {
      // A freshly chosen file takes precedence over the stored-document
      // picker. The upload is a local storage write (no provider call)
      // and linking never completes the check.
      let documentId = input.documentId;
      if (input.file) {
        const uploaded = await uploadDocument({
          entityId: scopedEntityId,
          propertyId: input.check.property_id ?? undefined,
          tenantId: input.check.tenant_id ?? undefined,
          leaseId: input.check.lease_id ?? undefined,
          category:
            input.check.kind === "insurance" ||
            input.check.kind === "bank_guarantee"
              ? input.check.kind
              : "other",
          notes: "Compliance evidence upload from the Work tab.",
          file: input.file,
        });
        documentId = uploaded.id;
      }
      return linkComplianceCheckEvidence(input.check.id, {
        source_document_id: documentId,
        certificate_expires_on: input.certificateExpiresOn || null,
        notes: "Linked from the Work compliance tab.",
      });
    },
    onSuccess: (linkedCheck, input) => {
      queryClient.setQueryData<ComplianceCheckRecord[]>(
        ["operations-compliance-checks", scopedEntityId],
        (current) =>
          current?.map((row) =>
            row.id === linkedCheck.id ? linkedCheck : row,
          ),
      );
      invalidateOperations();
      setEvidenceLinkForm(null);
      setComplianceCompletionConfirmation({
        id: `${input.check.id}-evidence-${Date.now()}`,
        message: `Linked evidence to “${input.check.title}”. Review before completing.`,
      });
    },
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
        queryKey: ["operations-maintenance"],
      });
      queryClient.invalidateQueries({
        queryKey: ["billing-readiness-maintenance"],
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
    workOrder: MaintenanceWorkOrderRecord,
    field: MaintenanceUndoField,
    next: string | null,
  ): Promise<void> {
    if (next == null) return;
    const previousValue = workOrder[field];
    if (next === previousValue) return;
    const queryKey = ["operations-maintenance", scopedEntityId];
    const previous =
      queryClient.getQueryData<MaintenanceWorkOrderRecord[]>(queryKey) ?? null;
    if (previous) {
      queryClient.setQueryData<MaintenanceWorkOrderRecord[]>(
        queryKey,
        previous.map((row) =>
          row.id === workOrder.id ? { ...row, [field]: next } : row,
        ),
      );
    }
    try {
      await updateMaintenanceWorkOrder(workOrder.id, {
        [field]: next,
      } as Parameters<typeof updateMaintenanceWorkOrder>[1]);
      setMaintenanceInlineUndo({
        id: `${workOrder.id}-${field}-${Date.now()}`,
        entityId: scopedEntityId,
        workOrderId: workOrder.id,
        title: workOrder.title,
        field,
        previous: previousValue,
        next: next as MaintenanceWorkOrderStatus | MaintenancePriority,
        undoing: false,
        error: null,
      });
      invalidateOperations();
    } catch (err) {
      if (previous) {
        queryClient.setQueryData(queryKey, previous);
      }
      throw err;
    }
  }

  async function undoMaintenanceInlineEdit() {
    if (!maintenanceInlineUndo) return;
    const undo = maintenanceInlineUndo;
    const queryKey = ["operations-maintenance", undo.entityId];
    const previous =
      queryClient.getQueryData<MaintenanceWorkOrderRecord[]>(queryKey) ?? null;
    setMaintenanceInlineUndo({ ...undo, undoing: true, error: null });
    if (previous) {
      queryClient.setQueryData<MaintenanceWorkOrderRecord[]>(
        queryKey,
        previous.map((row) =>
          row.id === undo.workOrderId
            ? { ...row, [undo.field]: undo.previous }
            : row,
        ),
      );
    }
    try {
      await updateMaintenanceWorkOrder(undo.workOrderId, {
        [undo.field]: undo.previous,
      } as Parameters<typeof updateMaintenanceWorkOrder>[1]);
      setMaintenanceInlineUndo(null);
      queryClient.invalidateQueries({
        queryKey: ["operations-maintenance"],
      });
      invalidateOperations();
    } catch (err) {
      if (previous) {
        queryClient.setQueryData(queryKey, previous);
      }
      setMaintenanceInlineUndo({
        ...undo,
        undoing: false,
        error: friendlyError(err),
      });
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
        queryKey: ["operations-arrears"],
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

  const recordArrearsPromiseToPayMutation = useMutation({
    mutationFn: (payload: {
      id: string;
      data: Parameters<typeof recordArrearsPromiseToPay>[1];
    }) => recordArrearsPromiseToPay(payload.id, payload.data),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["operations-arrears"],
      }),
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
        entity_id: scopedEntityId,
        cadence: digestCadence,
        send_email_approved: sendEmailApproved,
      }),
    onSuccess: (result) => setDigestResult(result),
  });

  const operationsLoading =
    entitiesQuery.isLoading ||
    calendarQuery.isLoading ||
    (allMode
      ? propertiesFanOut.isLoading ||
        tenantsFanOut.isLoading ||
        obligationsFanOut.isLoading ||
        complianceChecksFanOut.isLoading ||
        onboardingFanOut.isLoading ||
        documentIntakesFanOut.isLoading ||
        maintenanceFanOut.isLoading ||
        invoiceDraftsFanOut.isLoading ||
        arrearsFanOut.isLoading
      : Boolean(selectedEntityId) &&
        (propertiesQuery.isLoading ||
          tenantsQuery.isLoading ||
          obligationsQuery.isLoading ||
          complianceChecksQuery.isLoading ||
          onboardingQuery.isLoading ||
          documentIntakesQuery.isLoading ||
          maintenanceQuery.isLoading ||
          invoiceDraftsQuery.isLoading ||
          arrearsQuery.isLoading));

  const currentUser = securityWorkspaceQuery.data?.current_user ?? null;
  // Merged views the UI reads regardless of single- vs all-entity mode.
  const properties = useMemo(
    () => (allMode ? propertiesFanOut.data : (propertiesQuery.data ?? EMPTY_PROPERTIES)),
    [allMode, propertiesFanOut.data, propertiesQuery.data],
  );
  const tenants = useMemo(
    () => (allMode ? tenantsFanOut.data : (tenantsQuery.data ?? EMPTY_TENANTS)),
    [allMode, tenantsFanOut.data, tenantsQuery.data],
  );
  const obligations = useMemo(
    () =>
      allMode
        ? obligationsFanOut.data
        : (obligationsQuery.data ?? EMPTY_OBLIGATIONS),
    [allMode, obligationsFanOut.data, obligationsQuery.data],
  );
  const complianceChecks = useMemo(
    () =>
      allMode
        ? complianceChecksFanOut.data
        : (complianceChecksQuery.data ?? EMPTY_COMPLIANCE_CHECKS),
    [allMode, complianceChecksFanOut.data, complianceChecksQuery.data],
  );
  const onboardings = useMemo(
    () =>
      allMode
        ? onboardingFanOut.data
        : (onboardingQuery.data ?? EMPTY_ONBOARDINGS),
    [allMode, onboardingFanOut.data, onboardingQuery.data],
  );
  const intakes = useMemo(
    () =>
      allMode
        ? documentIntakesFanOut.data
        : (documentIntakesQuery.data ?? EMPTY_INTAKES),
    [allMode, documentIntakesFanOut.data, documentIntakesQuery.data],
  );
  const maintenance = useMemo(
    () =>
      allMode
        ? maintenanceFanOut.data
        : (maintenanceQuery.data ?? EMPTY_MAINTENANCE),
    [allMode, maintenanceFanOut.data, maintenanceQuery.data],
  );
  const arrears = useMemo(
    () => (allMode ? arrearsFanOut.data : (arrearsQuery.data ?? EMPTY_ARREARS)),
    [allMode, arrearsFanOut.data, arrearsQuery.data],
  );
  const invoiceDrafts = useMemo(
    () =>
      allMode
        ? invoiceDraftsFanOut.data
        : (invoiceDraftsQuery.data ?? EMPTY_INVOICE_DRAFTS),
    [allMode, invoiceDraftsFanOut.data, invoiceDraftsQuery.data],
  );
  const calendarEvents = useMemo(
    () => sortCalendarEvents(calendarQuery.data ?? EMPTY_CALENDAR_EVENTS),
    [calendarQuery.data],
  );
  const sourceFilteredCalendarEvents = useMemo(
    () =>
      calendarEvents.filter(
        (event) =>
          calendarSourceFilter === "all" ||
          calendarEventSourceFilter(event) === calendarSourceFilter,
      ),
    [calendarEvents, calendarSourceFilter],
  );
  const filteredCalendarEvents = useMemo(
    () =>
      sourceFilteredCalendarEvents.filter((event) =>
        calendarDateFilterMatches(event, calendarDateFilter),
      ),
    [calendarDateFilter, sourceFilteredCalendarEvents],
  );
  const calendarAgendaGroups = useMemo(
    () => groupCalendarEvents(filteredCalendarEvents),
    [filteredCalendarEvents],
  );
  const calendarMonthEvents = useMemo<CalendarMonthGridEvent[]>(
    () =>
      filteredCalendarEvents
        .filter((event) => dueRank(event.date) >= 0)
        .map((event) => ({
          id: event.id,
          title: event.title,
          date: event.date,
          href: event.link,
          tone: event.severity,
        })),
    [filteredCalendarEvents],
  );
  const allCalendarMonthEvents = useMemo<CalendarMonthGridEvent[]>(
    () =>
      filteredCalendarEvents.map((event) => ({
        id: event.id,
        title: event.title,
        date: event.date,
        href: event.link,
        tone: event.severity,
      })),
    [filteredCalendarEvents],
  );
  const visibleCalendarMonthEvents =
    calendarMonthEvents.length > 0 ? calendarMonthEvents : allCalendarMonthEvents;
  const overdueCalendarEventCount = filteredCalendarEvents.filter(
    (event) => dueRank(event.date) < 0,
  ).length;
  const upcomingCalendarEventCount = filteredCalendarEvents.filter((event) => {
    const rank = dueRank(event.date);
    return rank >= 0 && rank <= 30;
  }).length;
  const calendarSourceFilterRows = CALENDAR_SOURCE_FILTERS.map((filter) => ({
    ...filter,
    count:
      filter.id === "all"
        ? calendarEvents.length
        : calendarEvents.filter(
            (event) => calendarEventSourceFilter(event) === filter.id,
          ).length,
  }));
  const calendarDateFilterRows = CALENDAR_DATE_FILTERS.map((filter) => ({
    ...filter,
    count: sourceFilteredCalendarEvents.filter((event) =>
      calendarDateFilterMatches(event, filter.id),
    ).length,
  }));
  const previewCalendarEvent =
    filteredCalendarEvents.find((event) => event.id === previewCalendarEventId) ??
    null;

  useEffect(() => {
    if (
      previewCalendarEventId &&
      !filteredCalendarEvents.some((event) => event.id === previewCalendarEventId)
    ) {
      setPreviewCalendarEventId(null);
    }
  }, [filteredCalendarEvents, previewCalendarEventId]);

  const securityMembers = securityWorkspaceQuery.data?.members ?? EMPTY_MEMBERS;
  const assignableMembers = useMemo(
    () =>
      securityMembers
        .filter((member) => memberCanReceiveWork(member, scopedEntityId))
        .sort((a, b) => memberLabel(a).localeCompare(memberLabel(b))),
    [securityMembers, scopedEntityId],
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
  const visibleWorkItems = filteredOpenQueueItems.filter((item) =>
    workRangeMatches(item, workRange),
  );
  const horizonWorkLaneRows = horizonWorkLanes.map((lane) => ({
    ...lane,
    items: visibleWorkItems.filter(
      (item) => horizonWorkLaneId(item) === lane.id,
    ),
  }));
  const mobileHorizonWorkItems = horizonWorkLaneRows
    .flatMap((lane) => lane.items.map((item) => ({ item, lane })))
    .slice(0, 3);
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
  const approvalCandidates = useMemo(
    () =>
      buildApprovalCandidates({
        intakes,
        maintenance,
        invoiceDrafts,
        complianceChecks,
        onboardings,
        readyNotificationItems,
        properties,
        tenants,
      }),
    [
      complianceChecks,
      intakes,
      invoiceDrafts,
      maintenance,
      onboardings,
      properties,
      readyNotificationItems,
      tenants,
    ],
  );
  const visibleApprovalCandidates = approvalCandidates.filter(
    (candidate) =>
      (approvalGroupFilter === "all" ||
        candidate.group === approvalGroupFilter) &&
      (approvalKindFilter === "all" ||
        candidate.kind === approvalKindFilter) &&
      approvalCandidateMatchesSearch(candidate, approvalSearchQuery),
  );
  const selectedApprovalCandidate =
    visibleApprovalCandidates.find(
      (candidate) => candidate.id === selectedApprovalCandidateId,
    ) ?? null;
  const selectedApprovalGroup = selectedApprovalCandidate
    ? approvalGroups.find((group) => group.id === selectedApprovalCandidate.group)
    : null;
  const selectedApprovalCandidateIndex = selectedApprovalCandidate
    ? visibleApprovalCandidates.findIndex(
        (candidate) => candidate.id === selectedApprovalCandidate.id,
      )
    : -1;
  const selectedApprovalPosition =
    selectedApprovalCandidateIndex >= 0 ? selectedApprovalCandidateIndex + 1 : 0;
  const canPreviewPreviousApproval = selectedApprovalCandidateIndex > 0;
  const canPreviewNextApproval =
    selectedApprovalCandidateIndex >= 0 &&
    selectedApprovalCandidateIndex < visibleApprovalCandidates.length - 1;
  const previewPreviousApprovalCandidate = () => {
    if (!canPreviewPreviousApproval) return;
    setSelectedApprovalCandidateId(
      visibleApprovalCandidates[selectedApprovalCandidateIndex - 1].id,
    );
  };
  const previewNextApprovalCandidate = () => {
    if (!canPreviewNextApproval) return;
    setSelectedApprovalCandidateId(
      visibleApprovalCandidates[selectedApprovalCandidateIndex + 1].id,
    );
  };
  const approvalCandidateGroups = approvalGroups.map((group) => ({
    ...group,
    items: visibleApprovalCandidates.filter(
      (candidate) => candidate.group === group.id,
    ),
  }));
  const approvalGroupFilterRows: Array<{
    id: ApprovalGroupFilter;
    label: string;
    count: number;
  }> = [
    {
      id: "all",
      label: "All",
      count: approvalCandidates.length,
    },
    ...approvalGroups.map((group) => ({
      id: group.id,
      label: group.label,
      count: approvalCandidates.filter(
        (candidate) => candidate.group === group.id,
      ).length,
    })),
  ];
  const approvalFilterActive =
    approvalGroupFilter !== "all" ||
    approvalKindFilter !== "all" ||
    approvalSearchQuery.trim().length > 0;
  useEffect(() => {
    if (!selectedApprovalCandidateId) return;
    if (
      visibleApprovalCandidates.some(
        (candidate) => candidate.id === selectedApprovalCandidateId,
      )
    ) {
      return;
    }
    setSelectedApprovalCandidateId(null);
  }, [selectedApprovalCandidateId, visibleApprovalCandidates]);
  const approvalReadyCount = approvalCandidates.filter(
    (candidate) => candidate.group === "ready",
  ).length;
  const approvalBlockedCount = approvalCandidates.filter(
    (candidate) => candidate.group === "blocked",
  ).length;
  const approvalProviderAdjacentCount = approvalCandidates.filter(
    (candidate) => candidate.group === "provider_adjacent",
  ).length;
  const queueReviewCsv = () =>
    operationsQueueReviewCsv(visibleWorkItems);
  const copyQueueCsv = async () => {
    await copyTextToClipboard(queueReviewCsv());
  };
  const downloadQueueCsv = () => {
    saveBlob(
      new Blob([queueReviewCsv()], {
        type: "text/csv;charset=utf-8",
      }),
      "operations-work-queue-review.csv",
    );
  };
  const approvalsCsvText = () =>
    operationsApprovalsReviewCsv(visibleApprovalCandidates);
  const copyApprovalsCsv = async () => {
    await copyTextToClipboard(approvalsCsvText());
  };
  const downloadApprovalsCsv = () => {
    saveBlob(
      new Blob([approvalsCsvText()], {
        type: "text/csv;charset=utf-8",
      }),
      "operations-approvals-review.csv",
    );
  };
  const selectedApprovalPacketText = () =>
    selectedApprovalCandidate
      ? approvalCandidatePacketCsv(selectedApprovalCandidate)
      : "";
  const copySelectedApprovalPacket = async () => {
    if (!selectedApprovalCandidate) return;
    await copyTextToClipboard(selectedApprovalPacketText());
  };
  const downloadSelectedApprovalPacket = () => {
    if (!selectedApprovalCandidate) return;
    saveBlob(
      new Blob([selectedApprovalPacketText()], {
        type: "text/csv;charset=utf-8",
      }),
      approvalCandidatePacketFilename(selectedApprovalCandidate),
    );
  };
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
        role: memberEntityRole(member, scopedEntityId),
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
  const overdueWorkCount = openQueueItems.filter(
    (item) => queueBucketId(item) === "overdue",
  ).length;
  const dueSoonWorkCount = openQueueItems.filter(
    (item) => queueBucketId(item) === "due_soon",
  ).length;
  const openComplianceChecks = complianceChecks.filter(
    (check) => check.status !== "archived" && !check.deleted_at,
  );
  const overdueComplianceChecks = openComplianceChecks.filter(
    (check) => check.status === "active" && dueRank(check.next_due_date) < 0,
  );
  const dueSoonComplianceChecks = openComplianceChecks.filter((check) => {
    const rank = dueRank(check.next_due_date);
    return check.status === "active" && rank >= 0 && rank <= 30;
  });
  const missingEvidenceComplianceChecks = openComplianceChecks.filter(
    (check) => complianceEvidenceCount(check) === 0,
  );
  const teamWorkloadRows = [
    currentUser
      ? {
          id: currentUser.id,
          label: currentUser.display_name || currentUser.email,
          count: myWorkCount,
          detail: "You",
        }
      : null,
    ...workloadRows.map((row) => ({
      id: row.id,
      label: row.label,
      count: row.count,
      detail: row.role ? label(row.role) : null,
    })),
    {
      id: "unassigned",
      label: "Unassigned",
      count: unassignedWorkCount,
      detail: unassignedWorkCount ? "Needs owner" : "Clear",
    },
  ].filter(
    (
      row,
    ): row is {
      id: string;
      label: string;
      count: number;
      detail: string | null;
    } => Boolean(row),
  );
  const maxTeamWorkloadCount = Math.max(
    1,
    ...teamWorkloadRows.map((row) => row.count),
  );
  const currentComplianceCount =
    openComplianceChecks.length - overdueComplianceChecks.length;
  const nextComplianceCheck = [...openComplianceChecks]
    .filter((check) => check.status === "active")
    .sort((a, b) => dueRank(a.next_due_date) - dueRank(b.next_due_date))[0];
  const complianceObligations = obligations.filter(isComplianceObligation);
  const complianceIntakes = intakes.filter(isComplianceIntake);
  const inspectionWorkOrders = maintenance.filter(isInspectionWorkOrder);
  const complianceCsvText = () =>
    complianceReviewCsv({
      checks: openComplianceChecks,
      obligations: complianceObligations,
      intakes: complianceIntakes,
      workOrders: inspectionWorkOrders,
      properties,
      tenants,
      members: securityMembers,
    });
  const copyComplianceCsv = async () => {
    await copyTextToClipboard(complianceCsvText());
  };
  const downloadComplianceCsv = () => {
    saveBlob(
      new Blob([complianceCsvText()], {
        type: "text/csv;charset=utf-8",
      }),
      "operations-compliance-review.csv",
    );
  };
  const complianceEvidencePacketText = (check: ComplianceCheckRecord) =>
    complianceEvidencePacketCsv({
      check,
      properties,
      tenants,
      members: securityMembers,
    });
  const copyComplianceEvidencePacket = async (check: ComplianceCheckRecord) => {
    await copyTextToClipboard(complianceEvidencePacketText(check));
  };
  const downloadComplianceEvidencePacket = (check: ComplianceCheckRecord) => {
    saveBlob(
      new Blob([complianceEvidencePacketText(check)], {
        type: "text/csv;charset=utf-8",
      }),
      `compliance-evidence-packet-${check.id}.csv`,
    );
  };

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
    calendarQuery.error ||
    (allMode
      ? propertiesFanOut.error ||
        tenantsFanOut.error ||
        obligationsFanOut.error ||
        complianceChecksFanOut.error ||
        onboardingFanOut.error ||
        documentIntakesFanOut.error ||
        maintenanceFanOut.error ||
        invoiceDraftsFanOut.error ||
        arrearsFanOut.error
      : propertiesQuery.error ||
        tenantsQuery.error ||
        obligationsQuery.error ||
        complianceChecksQuery.error ||
        onboardingQuery.error ||
        documentIntakesQuery.error ||
        maintenanceQuery.error ||
        invoiceDraftsQuery.error ||
        arrearsQuery.error) ||
    createMaintenanceMutation.error ||
    updateMaintenanceMutation.error ||
    createArrearsMutation.error ||
    updateArrearsMutation.error ||
    updateObligationMutation.error ||
    assignObligationMutation.error ||
    sendMaintenanceAssignmentNotificationMutation.error ||
    sendArrearsAssignmentNotificationMutation.error ||
    recordArrearsPromiseToPayMutation.error ||
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
    calendarQuery.refetch();
    if (allMode) {
      propertiesFanOut.refetch();
      tenantsFanOut.refetch();
      obligationsFanOut.refetch();
      complianceChecksFanOut.refetch();
      onboardingFanOut.refetch();
      documentIntakesFanOut.refetch();
      maintenanceFanOut.refetch();
      invoiceDraftsFanOut.refetch();
      arrearsFanOut.refetch();
      return;
    }
    propertiesQuery.refetch();
    tenantsQuery.refetch();
    obligationsQuery.refetch();
    complianceChecksQuery.refetch();
    onboardingQuery.refetch();
    documentIntakesQuery.refetch();
    maintenanceQuery.refetch();
    invoiceDraftsQuery.refetch();
    arrearsQuery.refetch();
  }

  function submitMaintenance(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!scopedEntityId || !maintenanceForm.title.trim()) {
      return;
    }
    const quoteAmount = dollarsToCents(maintenanceForm.quote_amount);
    createMaintenanceMutation.mutate({
      entity_id: scopedEntityId,
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
    if (!scopedEntityId || !arrearsForm.tenant_id) {
      return;
    }
    const tenant = tenants.find((item) => item.id === arrearsForm.tenant_id);
    createArrearsMutation.mutate({
      entity_id: scopedEntityId,
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
    tone: StatusTone,
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
      entityId: scopedEntityId,
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
    assigneeAriaLabel,
    collapsible,
  }: {
    itemId: string;
    title: string;
    metadata: Record<string, unknown>;
    onAssign: (assigneeId: string) => void;
    onAction: (action: WorkAssignmentAction) => void;
    onNotify: () => void;
    assigneeAriaLabel?: string;
    collapsible?: boolean;
  }) {
    return (
      <WorkAssignmentControl
        title={title}
        assigneeAriaLabel={assigneeAriaLabel}
        collapsible={collapsible}
        assignment={workAssignment(metadata)}
        members={assignableMembers}
        value={assignmentValue(itemId, metadata)}
        onChange={(value) => setAssignmentValue(itemId, value)}
        onAssign={onAssign}
        onAction={onAction}
        onNotify={onNotify}
        disabled={assignmentPending || allMode}
        membersLoading={securityWorkspaceQuery.isLoading}
      />
    );
  }

  function renderQueueAssignmentControl(
    item: AssignableQueueItem,
    assigneeAriaLabel?: string,
    collapsible?: boolean,
  ) {
    return renderAssignmentControl({
      itemId: item.id,
      title: item.title,
      metadata: item.record.metadata,
      assigneeAriaLabel,
      collapsible,
      onAssign: (assigneeId) => assignQueueItem(item, assigneeId),
      onAction: (action) => actionQueueItem(item, action),
      onNotify: () => sendAssignmentNotification(item),
    });
  }

  function renderMaintenanceAssignmentControl(
    workOrder: MaintenanceWorkOrderRecord,
    assigneeAriaLabel?: string,
  ) {
    return renderAssignmentControl({
      itemId: `maintenance-${workOrder.id}`,
      title: workOrder.title,
      metadata: workOrder.metadata,
      assigneeAriaLabel,
      onAssign: (assigneeId) => assignMaintenance(workOrder, assigneeId),
      onAction: (action) => actionMaintenance(workOrder, action),
      onNotify: () =>
        sendMaintenanceAssignmentNotificationMutation.mutate(workOrder),
    });
  }

  function renderQueueActions(
    item: QueueItem,
    options?: { compactLabels?: boolean },
  ) {
    if (item.kind === "obligation") {
      if (item.completed) {
        return <StatusBadge tone="success">{item.chip}</StatusBadge>;
      }
      return (
        <>
          <SecondaryButton
            type="button"
            className="h-9 px-3"
            aria-label={
              options?.compactLabels
                ? "Mark obligation done from work controls"
                : undefined
            }
            onClick={() =>
              updateObligationMutation.mutate({
                obligation: item.record,
                status: "completed",
              })
            }
            disabled={updateObligationMutation.isPending || allMode}
          >
            <CheckCircle2 size={15} className="text-success" />
            Complete
          </SecondaryButton>
          {waiveConfirmId === item.id ? (
            <span className="inline-flex min-h-9 items-center justify-center gap-2 px-2 text-xs font-medium text-muted-foreground">
              Waive?
              <button
                type="button"
                className="font-semibold text-danger hover:underline"
                onClick={() => {
                  setWaiveConfirmId(null);
                  updateObligationMutation.mutate({
                    obligation: item.record,
                    status: "waived",
                  });
                }}
                disabled={updateObligationMutation.isPending || allMode}
              >
                Confirm
              </button>
              <button
                type="button"
                className="font-semibold hover:underline"
                onClick={() => setWaiveConfirmId(null)}
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="inline-flex min-h-9 items-center justify-center px-2 text-xs font-medium text-muted-foreground transition duration-200 ease-leasium hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={
                options?.compactLabels
                  ? "Skip obligation from work controls"
                  : undefined
              }
              onClick={() => setWaiveConfirmId(item.id)}
              disabled={updateObligationMutation.isPending || allMode}
            >
              Waive
            </button>
          )}
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
          href={item.href}
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
          disabled={updateMaintenanceMutation.isPending || allMode}
          compactLabels={options?.compactLabels}
        />
      );
    }
    return (
      <ArrearsActions
        arrearsCase={item.record}
        onUpdate={(data) =>
          updateArrearsMutation.mutate({ id: item.record.id, data })
        }
        disabled={updateArrearsMutation.isPending || allMode}
        compactLabels={options?.compactLabels}
      />
    );
  }

  const renderHorizonWorkCard = (
    item: QueueItem,
    lane: (typeof horizonWorkLanes)[number],
  ) => {
    const urgency = queueUrgencyChip(item);
    const context = item.description.split(" - ").filter(Boolean);
    const secondaryContext = context.slice(1, 3).join(" - ");

    return (
      <article
        key={item.id}
        className="relative overflow-hidden rounded-[12px] border border-leasium-card-border bg-white p-3 shadow-[0_1px_3px_rgba(16,24,40,0.04)]"
      >
        <span
          className={cn("absolute inset-y-0 left-0 w-1", lane.railClassName)}
          aria-hidden="true"
        />
        <Link
          href={item.href}
          data-ops-row
          className="block min-w-0 rounded-md pl-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
        >
          <div className="flex flex-wrap items-start gap-2">
            <span className="min-w-0 flex-1 text-[13px] font-semibold leading-[18px] text-foreground">
              {item.title}
            </span>
            <StatusBadge tone={urgency.tone} className="text-leasium-micro">
              {urgency.label}
            </StatusBadge>
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {context[0] ?? item.description}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-leasium-micro font-semibold uppercase text-muted-foreground">
              {queueKindLabel(item)}
            </span>
            {secondaryContext ? (
              <span className="truncate text-xs text-muted-foreground">
                {secondaryContext}
              </span>
            ) : null}
            {allMode ? (
              <span className="text-leasium-micro font-semibold uppercase text-muted-foreground">
                {entityNameById.get(item.record.entity_id) ?? "Unknown entity"}
              </span>
            ) : null}
          </div>
        </Link>
        {isAssignableQueueItem(item) ? (
          <div className="mt-3 grid gap-2 pl-1">
            {renderQueueAssignmentControl(item, undefined, true)}
            <div className="hidden flex-wrap gap-2 xl:flex">
              {renderQueueActions(item, {
                compactLabels: true,
              })}
            </div>
            <MobileRowDisclosure
              title="Work controls"
              subtitle={queueMobileActionSummary(item)}
              icon={<UserRound size={15} />}
            >
              {renderQueueAssignmentControl(
                item,
                `Work controls owner selector: ${item.title}`,
              )}
              <div className="grid gap-2">
                {renderQueueActions(item, {
                  compactLabels: true,
                })}
              </div>
            </MobileRowDisclosure>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2 pl-1">
            {renderQueueActions(item, {
              compactLabels: true,
            })}
          </div>
        )}
      </article>
    );
  };

  const renderMobileHorizonWorkAction = (item: QueueItem) => {
    const actionClassName =
      "inline-flex min-h-11 items-center justify-center rounded-[10px] border border-border-strong bg-white px-4 text-xs font-semibold text-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

    if (item.kind === "obligation") {
      return (
        <button
          type="button"
          className={cn(actionClassName, "border-primary bg-primary text-white hover:bg-primary-hover")}
          onClick={() =>
            updateObligationMutation.mutate({
              obligation: item.record,
              status: "completed",
            })
          }
          disabled={updateObligationMutation.isPending || allMode}
        >
          Complete
        </button>
      );
    }

    if (item.kind === "maintenance") {
      return (
        <Link
          href={`/operations/maintenance/${encodeURIComponent(item.record.id)}`}
          className={actionClassName}
        >
          View
        </Link>
      );
    }

    if (item.kind === "arrears") {
      return (
        <Link href="/operations?tab=arrears" className={actionClassName}>
          Review
        </Link>
      );
    }

    return (
      <Link href={item.href} className={actionClassName}>
        Review
      </Link>
    );
  };

  const renderMobileHorizonWorkCard = ({
    item,
    lane,
  }: {
    item: QueueItem;
    lane: (typeof horizonWorkLanes)[number];
  }) => {
    const context = item.description.split(" - ").filter(Boolean);
    const contextLabel =
      item.kind === "arrears" ? (context[1] ?? context[0]) : context[0];
    const chip = queueUrgencyChip(item);

    return (
      <article
        key={item.id}
        data-testid="work-mobile-horizon-card"
        className="relative overflow-hidden rounded-[14px] bg-white p-3 pl-4 shadow-[0_1px_3px_rgba(16,24,40,0.05)]"
      >
        <span
          className={cn("absolute inset-y-0 left-0 w-1", lane.railClassName)}
          aria-hidden="true"
        />
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
          <div className="grid min-w-0 gap-1">
            <Link
              href={item.href}
              data-ops-row
              className="min-w-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <h2 className="line-clamp-2 text-sm font-semibold leading-5 text-foreground">
                {item.title}
              </h2>
            </Link>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {contextLabel ? (
                <span className="truncate text-[11px] leading-4 text-muted-foreground">
                  {contextLabel}
                </span>
              ) : null}
              <StatusBadge tone={chip.tone} className="text-[11px]">
                {chip.label}
              </StatusBadge>
            </div>
            <span
              className="mt-1 size-[22px] rounded-full bg-primary"
              aria-hidden="true"
            />
          </div>
          <div className="flex items-center">{renderMobileHorizonWorkAction(item)}</div>
        </div>
      </article>
    );
  };

  return (
    <main className="min-h-screen bg-leasium-canvas">
      <AppHeader>
        <EntityPicker
          entities={entitiesQuery.data}
          loading={entitiesQuery.isLoading}
          value={selectedEntityId}
          onChange={setSelectedEntityId}
        />
      </AppHeader>

      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-5">
        <section className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <PageTitle>Work</PageTitle>
            <p className="mt-1.5 hidden text-sm leading-5 text-muted-foreground md:block">
              Triage by urgency - clear the red lane and the day is done.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Work range"
              className="inline-flex min-h-11 rounded-full border border-leasium-card-border bg-white p-1 shadow-leasiumXs"
            >
              {workRanges.map((range) => {
                const active = workRange === range.id;
                return (
                  <button
                    key={range.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setWorkRange(range.id)}
                    className={cn(
                      "min-h-11 rounded-full px-3 text-sm font-semibold transition duration-200 ease-leasium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                      active
                        ? "bg-primary text-primary-foreground shadow-leasiumXs"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <span className="md:hidden">{range.mobileLabel}</span>
                    <span className="hidden md:inline">{range.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="hidden items-center gap-2 md:flex">
              <SecondaryButton
                type="button"
                onClick={refresh}
                disabled={!selectedEntityId}
                aria-label="Refresh work"
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
                disabled={!scopedEntityId}
                title={
                  allMode
                    ? "Select a single entity to create a work order"
                    : undefined
                }
              >
                <Plus size={15} />
                New work
              </Button>
            </div>
          </div>
        </section>

        {error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {friendlyError(error)}
          </div>
        ) : null}

        {operationsLoading ? (
          <SectionPanel
            title="Checking operations"
            description={
              selectedEntity
                ? selectedEntity.name
                : "Finding the active entity."
            }
            icon={<RefreshCw size={17} className="animate-spin text-primary" />}
            actions={<StatusBadge tone="neutral">Checking</StatusBadge>}
            className="border-primary/20 bg-primary/5"
          >
            <div className="grid gap-3 p-4 text-sm text-muted-foreground sm:grid-cols-6">
              <div className="rounded-xl border border-border bg-white px-3 py-2">
                Queue
              </div>
              <div className="rounded-xl border border-border bg-white px-3 py-2">
                Approvals
              </div>
              <div className="rounded-xl border border-border bg-white px-3 py-2">
                Calendar
              </div>
              <div className="rounded-xl border border-border bg-white px-3 py-2">
                Maintenance
              </div>
              <div className="rounded-xl border border-border bg-white px-3 py-2">
                Compliance
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
            {activeTab === "queue" ? (
              <section className="grid gap-3 md:hidden" aria-label="Work mobile Horizon summary">
                <div
                  data-testid="work-mobile-horizon-summary"
                  className="flex min-w-0 gap-2 overflow-x-auto pb-0.5"
                  aria-label="Work mobile lane summary"
                >
                  {horizonWorkLaneRows.map((lane) => (
                    <div
                      key={lane.id}
                      className={cn(
                        "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3 text-xs font-semibold",
                        lane.id === "act_now"
                          ? "border border-danger bg-danger-soft text-danger-strong"
                          : lane.id === "scheduled"
                            ? "bg-info-soft text-info-strong"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      <span>{lane.label}</span>
                      <span>{lane.items.length}</span>
                    </div>
                  ))}
                </div>

                <div className="grid gap-2">
                  {mobileHorizonWorkItems.map(renderMobileHorizonWorkCard)}
                  {!operationsLoading && mobileHorizonWorkItems.length === 0 ? (
                    <div className="rounded-[14px] border border-dashed border-border bg-white p-4 text-sm text-muted-foreground">
                      No work in this view.
                    </div>
                  ) : null}
                </div>

                <section
                  data-testid="work-mobile-team-load"
                  className="rounded-[14px] border border-leasium-card-border bg-white p-3 shadow-leasiumXs"
                >
                  <h2 className="text-[9px] font-semibold uppercase tracking-[0.36px] text-muted-foreground">
                    TEAM WORKLOAD
                  </h2>
                  <div className="mt-2 grid gap-2">
                    {teamWorkloadRows.map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() => {
                          if (row.id === "unassigned") {
                            setAssigneeFilter("unassigned");
                          } else if (row.id === currentUser?.id) {
                            setAssigneeFilter("me");
                          } else {
                            setAssigneeFilter(memberAssigneeFilter(row.id));
                          }
                        }}
                        className="grid min-h-11 grid-cols-[minmax(72px,1fr)_90px_auto] items-center gap-2 text-left text-[11px] font-medium text-foreground"
                      >
                        <span className="truncate">{row.label}</span>
                        <span className="h-[5px] overflow-hidden rounded-full bg-muted">
                          <span
                            className="block h-full rounded-full bg-primary"
                            style={{
                              width: `${Math.max(
                                8,
                                (row.count / maxTeamWorkloadCount) * 100,
                              )}%`,
                            }}
                          />
                        </span>
                        <span className="text-[10px] font-semibold text-muted-foreground">
                          {row.count}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

              </section>
            ) : null}

            <div
              className="no-scrollbar flex gap-1.5 overflow-x-auto rounded-full border border-leasium-card-border bg-white p-1.5 shadow-leasiumXs md:grid md:grid-cols-6 md:gap-2 md:rounded-[12px]"
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
                      "grid min-h-11 shrink-0 gap-1 rounded-full px-4 py-2 text-left transition duration-200 ease-leasium md:min-h-14 md:rounded-[10px] md:px-3",
                      isActive
                        ? "bg-primary text-white shadow-leasiumXs md:bg-primary-soft md:text-primary-hover"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <span className="text-sm font-semibold">{tab.label}</span>
                    <span
                      className={cn(
                        "hidden text-xs md:block",
                        isActive && "md:text-primary-hover",
                      )}
                    >
                      {tab.description}
                    </span>
                  </button>
                );
              })}
            </div>

            <div
              className="grid grid-cols-2 gap-2 md:hidden"
              aria-label="Work mobile actions"
            >
              <SecondaryButton
                type="button"
                onClick={refresh}
                disabled={!selectedEntityId}
                aria-label="Refresh work"
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
                disabled={!scopedEntityId}
                title={
                  allMode
                    ? "Select a single entity to create a work order"
                    : undefined
                }
              >
                <Plus size={15} />
                New work
              </Button>
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
                  if (nextTab && tabs.some((entry) => entry.id === nextTab)) {
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
              <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
                <div className="grid min-w-0 gap-3">
                  <div className="rounded-[12px] border border-leasium-card-border bg-white p-3 shadow-leasiumXs">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="inline-flex min-h-11 items-center gap-2 rounded-full bg-muted px-3 text-xs font-semibold text-slate">
                        <UserRound size={14} className="text-primary" />
                        Team workload
                      </span>
                      <button
                        type="button"
                        aria-label={`Show all open work, ${openQueueItems.length}`}
                        onClick={() => setAssigneeFilter("all")}
                        className={cn(
                          "inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition duration-200 ease-leasium",
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
                          "inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition duration-200 ease-leasium",
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
                      <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-white px-3 text-xs font-semibold text-muted-foreground">
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
                          "inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition duration-200 ease-leasium",
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
                            "inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition duration-200 ease-leasium",
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
                              "inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border px-3 text-xs font-semibold transition duration-200 ease-leasium",
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
                              <span className="text-danger-strong">
                                {row.urgentCount} urgent
                              </span>
                            ) : null}
                            {row.followUpCount ? (
                              <span className="text-warning-strong">
                                {row.followUpCount} follow-up
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                      <Select
                        aria-label="Queue assignee"
                        value={assigneeFilter}
                        onChange={(event) =>
                          setAssigneeFilter(
                            event.target.value as AssigneeFilter,
                          )
                        }
                        className="w-full sm:ml-auto sm:w-52"
                      >
                        <option value="all">All open work</option>
                        <option value="unassigned">Unassigned</option>
                        <option value="follow_up">Follow-up due</option>
                        {currentUser ? (
                          <option value="me">My work</option>
                        ) : null}
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
                    {noticeInboxItems.length > 0 ? (
                      <AssignmentNoticeInbox
                        items={noticeInboxItems.slice(0, 4)}
                        counts={noticeInboxCounts}
                      />
                    ) : null}
                  </div>

                  <div
                    className="grid gap-3 lg:grid-cols-3"
                    onKeyDown={handleQueueKeyDown}
                  >
                    {horizonWorkLaneRows.map((lane) => (
                      <section
                        key={lane.id}
                        role="region"
                        aria-label={`${lane.label} ${lane.items.length}`}
                        className="grid content-start gap-2 rounded-[12px] bg-muted p-2.5"
                      >
                        <header className="flex min-h-9 items-center justify-between gap-3 px-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "size-2 rounded-full",
                                lane.dotClassName,
                              )}
                              aria-hidden="true"
                            />
                            <h2 className="text-[13px] font-semibold leading-5 text-foreground">
                              {lane.label}
                            </h2>
                          </div>
                          <StatusBadge tone={lane.tone}>
                            {lane.items.length}
                          </StatusBadge>
                        </header>
                        <div className="grid gap-2">
                          {lane.items.map((item) =>
                            renderHorizonWorkCard(item, lane),
                          )}
                          {!operationsLoading && lane.items.length === 0 ? (
                            <div className="rounded-[12px] border border-dashed border-border bg-white/70 p-3 text-xs text-muted-foreground">
                              No {lane.label.toLowerCase()} work in this view.
                            </div>
                          ) : null}
                        </div>
                      </section>
                    ))}
                  </div>

                  {!operationsLoading && visibleWorkItems.length === 0 ? (
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
                  {digestResult ? (
                    <AssignmentDigestPreview result={digestResult} />
                  ) : null}
                </div>

                <aside className="grid content-start gap-3">
                  <section className="rounded-[12px] border border-leasium-card-border bg-white p-4 shadow-leasiumXs">
                    <h2 className="text-leasium-micro font-semibold uppercase text-muted-foreground">
                      TEAM WORKLOAD
                    </h2>
                    <div className="mt-3 grid gap-3">
                      {teamWorkloadRows.map((row) => (
                        <button
                          key={row.id}
                          type="button"
                          onClick={() => {
                            if (row.id === "unassigned") {
                              setAssigneeFilter("unassigned");
                            } else if (row.id === currentUser?.id) {
                              setAssigneeFilter("me");
                            } else {
                              setAssigneeFilter(memberAssigneeFilter(row.id));
                            }
                          }}
                          className="grid min-h-11 gap-1 text-left"
                        >
                          <span className="flex items-center justify-between gap-3 text-xs font-semibold text-foreground">
                            <span className="truncate">{row.label}</span>
                            <span>{row.count}</span>
                          </span>
                          <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                            <span
                              className="block h-full rounded-full bg-primary"
                              style={{
                                width: `${Math.max(
                                  8,
                                  (row.count / maxTeamWorkloadCount) * 100,
                                )}%`,
                              }}
                            />
                          </span>
                          {row.detail ? (
                            <span className="text-leasium-micro font-semibold uppercase text-muted-foreground">
                              {row.detail}
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-[12px] border border-leasium-card-border bg-white p-4 shadow-leasiumXs">
                    <h2 className="text-leasium-micro font-semibold uppercase text-muted-foreground">
                      COMPLIANCE
                    </h2>
                    <div className="mt-3 flex items-center gap-4">
                      <div
                        className="grid size-20 shrink-0 place-items-center rounded-full"
                        style={{
                          background: `conic-gradient(var(--leasium-success) ${
                            openComplianceChecks.length
                              ? (currentComplianceCount /
                                  openComplianceChecks.length) *
                                100
                              : 100
                          }%, var(--leasium-slate-100) 0)`,
                        }}
                      >
                        <div className="grid size-14 place-items-center rounded-full bg-white text-center">
                          <span className="text-sm font-semibold text-foreground">
                            {currentComplianceCount}/{openComplianceChecks.length}
                          </span>
                        </div>
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground">
                          {currentComplianceCount} of{" "}
                          {openComplianceChecks.length} current
                        </div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          {nextComplianceCheck
                            ? `${nextComplianceCheck.title} due ${formatDate(
                                nextComplianceCheck.next_due_date,
                              )}`
                            : "No active compliance checks."}
                        </p>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-[12px] border border-leasium-card-border bg-white p-4 shadow-leasiumXs">
                    <h2 className="text-leasium-micro font-semibold uppercase text-muted-foreground">
                      EVENING DIGEST
                    </h2>
                    <p className="mt-2 text-sm leading-5 text-muted-foreground">
                      Daily summary drafts at 5pm - you approve before anything
                      sends.
                    </p>
                    <div className="mt-3 grid gap-2">
                      <Button
                        type="button"
                        className="w-full justify-start px-3"
                        disabled={
                          !scopedEntityId ||
                          workAssignmentDigestMutation.isPending
                        }
                        title={
                          allMode
                            ? "Select a single entity to generate a digest"
                            : undefined
                        }
                        onClick={() =>
                          workAssignmentDigestMutation.mutate(false)
                        }
                      >
                        {workAssignmentDigestMutation.isPending ? (
                          <RefreshCw size={15} className="animate-spin" />
                        ) : (
                          <ReceiptText size={15} />
                        )}
                        Preview digest
                      </Button>
                      <ExportDigestMenu>
                        <SecondaryButton
                          type="button"
                          className="min-h-11 w-full justify-start px-3"
                          disabled={!selectedEntityId || operationsLoading}
                          onClick={downloadQueueCsv}
                        >
                          <Download size={15} />
                          Download queue CSV
                        </SecondaryButton>
                        <SecondaryButton
                          type="button"
                          className="min-h-11 w-full justify-start px-3"
                          disabled={!selectedEntityId || operationsLoading}
                          onClick={copyQueueCsv}
                        >
                          <Copy size={15} />
                          Copy queue CSV
                        </SecondaryButton>
                        <SecondaryButton
                          type="button"
                          className="min-h-11 w-full justify-start px-3"
                          disabled={
                            assignmentPending ||
                            allMode ||
                            readyNotificationItems.length === 0
                          }
                          title={
                            allMode
                              ? "Select a single entity to send ready notices"
                              : undefined
                          }
                          onClick={() =>
                            sendReadyAssignmentNotificationsMutation.mutate(
                              readyNotificationItems,
                            )
                          }
                        >
                          <Send size={15} />
                          {sendReadyAssignmentNotificationsMutation.isPending
                            ? "Sending..."
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
                              event.target
                                .value as WorkAssignmentDigestCadence,
                            )
                          }
                          className="w-full"
                        >
                          <option value="daily">Daily digest</option>
                          <option value="weekly">Weekly digest</option>
                        </Select>
                        <SecondaryButton
                          type="button"
                          className="min-h-11 w-full justify-start px-3"
                          disabled={
                            !scopedEntityId ||
                            workAssignmentDigestMutation.isPending
                          }
                          title={
                            allMode
                              ? "Select a single entity to generate a digest"
                              : undefined
                          }
                          onClick={() =>
                            workAssignmentDigestMutation.mutate(false)
                          }
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
                          className="min-h-11 w-full justify-start px-3"
                          disabled={
                            !scopedEntityId ||
                            workAssignmentDigestMutation.isPending
                          }
                          title={
                            allMode
                              ? "Select a single entity to send a digest"
                              : undefined
                          }
                          onClick={() =>
                            workAssignmentDigestMutation.mutate(true)
                          }
                        >
                          <Send size={15} />
                          Send digest
                        </SecondaryButton>
                      </ExportDigestMenu>
                    </div>
                  </section>

                  <div className="inline-flex min-h-11 items-center gap-2 rounded-full border border-accent/30 bg-accent-soft px-3 text-xs font-semibold text-leasium-teal-strong">
                    <ShieldCheck size={14} />
                    Provider sends are review-first.
                  </div>
                </aside>
              </section>
            ) : null}

            {activeTab === "approvals" ? (
              <SectionPanel
                title="Approvals inbox"
                description="Read-only lens over work that needs an operator decision."
                icon={<ClipboardList size={17} className="text-primary" />}
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    <SecondaryButton
                      type="button"
                      aria-label="Download approvals CSV"
                      className="min-h-11 px-3"
                      disabled={
                        !selectedEntityId ||
                        operationsLoading ||
                        visibleApprovalCandidates.length === 0
                      }
                      onClick={downloadApprovalsCsv}
                    >
                      <Download size={15} />
                      Download CSV
                    </SecondaryButton>
                    <SecondaryButton
                      type="button"
                      aria-label="Copy approvals CSV"
                      className="min-h-11 px-3"
                      disabled={
                        !selectedEntityId ||
                        operationsLoading ||
                        visibleApprovalCandidates.length === 0
                      }
                      onClick={copyApprovalsCsv}
                    >
                      <Copy size={15} />
                      Copy CSV
                    </SecondaryButton>
                  </div>
                }
              >
                <div className="border-b border-border bg-muted/30 px-4 py-3">
                  <div className="flex items-center gap-2 overflow-x-auto pb-1 text-sm lg:flex-wrap lg:overflow-visible lg:pb-0">
                    <span className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-white px-3 text-xs font-semibold text-slate shadow-leasiumXs">
                      <ShieldCheck size={14} className="text-primary" />
                      Review-only
                    </span>
                    <span className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-border bg-white px-3 text-xs font-semibold text-muted-foreground">
                      Candidates
                      <span className="text-foreground">
                        {approvalFilterActive
                          ? `${visibleApprovalCandidates.length}/${approvalCandidates.length}`
                          : approvalCandidates.length}
                      </span>
                    </span>
                    <span className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-border bg-white px-3 text-xs font-semibold text-muted-foreground">
                      Ready
                      <span className="text-primary-hover">
                        {approvalReadyCount}
                      </span>
                    </span>
                    <span className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-border bg-white px-3 text-xs font-semibold text-muted-foreground">
                      Needs evidence/setup
                      <span className="text-warning-strong">
                        {approvalBlockedCount}
                      </span>
                    </span>
                    <span className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-border bg-white px-3 text-xs font-semibold text-muted-foreground">
                      Provider-adjacent
                      <span className="text-danger-strong">
                        {approvalProviderAdjacentCount}
                      </span>
                    </span>
                  </div>
                </div>

                <div className="grid gap-3 border-b border-border px-4 pb-20 pt-3 md:py-3 xl:grid-cols-[minmax(0,1fr)_auto]">
                  <div
                    role="group"
                    aria-label="Approval state filters"
                    className="flex min-w-0 gap-2 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-visible lg:pb-0"
                  >
                    {approvalGroupFilterRows.map((filter) => {
                      const active = approvalGroupFilter === filter.id;
                      return (
                        <button
                          key={filter.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setApprovalGroupFilter(filter.id)}
                          className={cn(
                            "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition",
                            active
                              ? "border-primary/30 bg-primary-soft text-primary-hover"
                              : "border-border bg-white text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                        >
                          <span>{filter.label}</span>
                          <span className="text-foreground">
                            {filter.count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2 xl:justify-end">
                    <label className="relative min-w-0 flex-1 sm:min-w-[240px] xl:max-w-[320px]">
                      <span className="sr-only">Search approvals</span>
                      <Search
                        size={15}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                      />
                      <Input
                        aria-label="Search approvals"
                        value={approvalSearchQuery}
                        onChange={(event) =>
                          setApprovalSearchQuery(event.target.value)
                        }
                        placeholder="Search approvals"
                        className="min-h-11 pl-9"
                      />
                    </label>
                    <Select
                      aria-label="Approval source"
                      value={approvalKindFilter}
                      onChange={(event) =>
                        setApprovalKindFilter(
                          event.target.value as ApprovalKindFilter,
                        )
                      }
                      className="min-h-11 w-full min-w-[210px] sm:w-auto"
                    >
                      {approvalKindFilters.map((filter) => (
                        <option key={filter.id} value={filter.id}>
                          {filter.label}
                        </option>
                      ))}
                    </Select>
                    {approvalFilterActive ? (
                      <SecondaryButton
                        type="button"
                        className="min-h-11 px-3"
                        onClick={() => {
                          setApprovalGroupFilter("all");
                          setApprovalKindFilter("all");
                          setApprovalSearchQuery("");
                        }}
                      >
                        <X size={15} />
                        Clear approval filters
                      </SecondaryButton>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-4 p-4">
                  <div className="inline-flex min-h-11 items-center gap-2 rounded-full border border-accent/30 bg-accent-soft px-3 text-xs font-semibold text-leasium-teal-strong">
                    <ShieldCheck size={14} />
                    No provider, comms, payment, or reconciliation action runs
                    from this inbox.
                  </div>

                  <div
                    className={cn(
                      "grid gap-4",
                      selectedApprovalCandidate &&
                        visibleApprovalCandidates.length > 0
                        ? "xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start"
                        : null,
                    )}
                  >
                    {selectedApprovalCandidate ? (
                      <section
                        aria-labelledby="approval-preview-heading"
                        className="grid gap-4 rounded-[12px] border border-primary/20 bg-primary/5 p-4 xl:order-last xl:sticky xl:top-24"
                      >
                      <header className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <ClipboardList
                              size={16}
                              className="text-primary"
                            />
                            <h2
                              id="approval-preview-heading"
                              className="text-sm font-semibold text-foreground"
                            >
                              Approval preview
                            </h2>
                            {selectedApprovalGroup ? (
                              <StatusBadge tone={selectedApprovalGroup.tone}>
                                {selectedApprovalGroup.label}
                              </StatusBadge>
                            ) : null}
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Read-only source context before opening the record.
                          </p>
                        </div>
                        <SecondaryButton
                          type="button"
                          className="min-h-11 px-3"
                          onClick={() => setSelectedApprovalCandidateId(null)}
                        >
                          <X size={15} />
                          Close preview
                        </SecondaryButton>
                      </header>

                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex min-h-11 items-center rounded-full border border-primary/20 bg-white px-3 text-xs font-semibold text-muted-foreground shadow-leasiumXs">
                          Candidate {selectedApprovalPosition} of{" "}
                          {visibleApprovalCandidates.length} visible
                        </span>
                        <SecondaryButton
                          type="button"
                          aria-label="Previous approval candidate"
                          title="Previous candidate"
                          className="h-11 w-11 shrink-0 p-0"
                          disabled={!canPreviewPreviousApproval}
                          onClick={previewPreviousApprovalCandidate}
                        >
                          <ChevronLeft size={15} />
                        </SecondaryButton>
                        <SecondaryButton
                          type="button"
                          aria-label="Next approval candidate"
                          title="Next candidate"
                          className="h-11 w-11 shrink-0 p-0"
                          disabled={!canPreviewNextApproval}
                          onClick={previewNextApprovalCandidate}
                        >
                          <ChevronRight size={15} />
                        </SecondaryButton>
                      </div>

                      <div className="grid gap-3 rounded-[12px] border border-leasium-card-border bg-white p-3 shadow-leasiumXs">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone={selectedApprovalCandidate.tone}>
                            {selectedApprovalCandidate.statusLabel}
                          </StatusBadge>
                          <span className="text-leasium-micro font-semibold uppercase text-muted-foreground">
                            {selectedApprovalCandidate.sourceLabel}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-base font-semibold leading-6 text-foreground">
                            {selectedApprovalCandidate.title}
                          </h3>
                          <p className="mt-1 text-sm leading-5 text-muted-foreground">
                            {selectedApprovalCandidate.reason}
                          </p>
                        </div>
                        <div className="grid gap-2">
                          <span className="rounded-xl bg-muted px-3 py-2 text-xs font-semibold text-slate">
                            {selectedApprovalCandidate.context || "No context"}
                          </span>
                          <span className="rounded-xl bg-muted px-3 py-2 text-xs font-semibold text-slate">
                            Due {formatDate(selectedApprovalCandidate.dueDate)}
                          </span>
                          {selectedApprovalCandidate.previewDetails.map(
                            (detail) => (
                              <span
                                key={detail}
                                className="rounded-xl bg-muted px-3 py-2 text-xs font-semibold text-slate"
                              >
                                {detail}
                              </span>
                            ),
                          )}
                        </div>
                        <div className="rounded-xl border border-accent/30 bg-accent-soft px-3 py-2 text-xs font-semibold leading-5 text-leasium-teal-strong">
                          <ShieldCheck
                            size={14}
                            className="mr-1 inline align-[-2px]"
                          />
                          {selectedApprovalCandidate.guardrail}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={selectedApprovalCandidate.href}
                            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
                          >
                            <Link2 size={15} />
                            Review source
                          </Link>
                          <SecondaryButton
                            type="button"
                            aria-label="Copy approval packet"
                            className="min-h-11 px-3"
                            onClick={copySelectedApprovalPacket}
                          >
                            <Copy size={15} />
                            Copy packet
                          </SecondaryButton>
                          <SecondaryButton
                            type="button"
                            aria-label="Download approval packet"
                            className="min-h-11 px-3"
                            onClick={downloadSelectedApprovalPacket}
                          >
                            <Download size={15} />
                            Download packet
                          </SecondaryButton>
                        </div>
                      </div>
                      </section>
                    ) : null}

                    <div className="grid gap-4 xl:order-first">
                      {approvalCandidates.length === 0 ? (
                        <EmptyState
                          icon={<ClipboardList size={18} />}
                          title="No approval candidates"
                          description="Smart Intake reviews, maintenance approval requests, invoice drafts, compliance evidence, onboarding submissions, and assignment notices will appear here when ready."
                        />
                      ) : null}

                      {approvalCandidates.length > 0 &&
                      visibleApprovalCandidates.length === 0 ? (
                        <EmptyState
                          icon={<ClipboardList size={18} />}
                          title="No approval candidates match these filters"
                          description="Clear filters or search, or choose another state or source to return to the full approvals inbox."
                        />
                      ) : null}

                      {visibleApprovalCandidates.length > 0 ? (
                        <div className="grid gap-3">
                          {approvalCandidateGroups
                            .filter((group) => group.items.length > 0)
                            .map((group) => (
                              <section
                                key={group.id}
                                className="grid gap-2 rounded-[12px] bg-muted p-2.5"
                              >
                            <header className="flex min-h-9 items-center justify-between gap-3 px-1">
                              <div className="min-w-0">
                                <h2 className="text-[13px] font-semibold leading-5 text-foreground">
                                  {group.label}
                                </h2>
                                <p className="text-xs text-muted-foreground">
                                  {group.description}
                                </p>
                              </div>
                              <StatusBadge tone={group.tone}>
                                {group.items.length}
                              </StatusBadge>
                            </header>
                            <div className="grid gap-2">
                              {group.items.map((candidate) => {
                                const selected =
                                  selectedApprovalCandidateId === candidate.id;
                                return (
                                  <article
                                    key={candidate.id}
                                    className={cn(
                                      "grid gap-3 rounded-[12px] border p-3 shadow-leasiumXs md:grid-cols-[minmax(0,1fr)_auto]",
                                      selected
                                        ? "border-primary/35 bg-primary/5"
                                        : "border-leasium-card-border bg-white",
                                    )}
                                  >
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <StatusBadge tone={candidate.tone}>
                                        {candidate.statusLabel}
                                      </StatusBadge>
                                      <span className="text-leasium-micro font-semibold uppercase text-muted-foreground">
                                        {candidate.sourceLabel}
                                      </span>
                                    </div>
                                    <h3 className="mt-2 text-sm font-semibold leading-5 text-foreground">
                                      {candidate.title}
                                    </h3>
                                    <p className="mt-1 text-sm leading-5 text-muted-foreground">
                                      {candidate.reason}
                                    </p>
                                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                      <span className="rounded-full bg-muted px-2 py-1">
                                        {candidate.context || "No context"}
                                      </span>
                                      <span className="rounded-full bg-muted px-2 py-1">
                                        Due {formatDate(candidate.dueDate)}
                                      </span>
                                      <span className="rounded-full bg-muted px-2 py-1">
                                        {candidate.guardrail}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
                                    <SecondaryButton
                                      type="button"
                                      aria-pressed={selected}
                                      className={cn(
                                        "min-h-11 px-3",
                                        selected
                                          ? "border-primary/30 bg-primary-soft text-primary-hover"
                                          : null,
                                      )}
                                      onClick={() =>
                                        setSelectedApprovalCandidateId(
                                          selected ? null : candidate.id,
                                        )
                                      }
                                    >
                                      <ClipboardList size={15} />
                                      Preview
                                    </SecondaryButton>
                                    <Link
                                      href={candidate.href}
                                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
                                    >
                                      <Link2 size={15} />
                                      Review source
                                    </Link>
                                  </div>
                                  </article>
                                );
                              })}
                            </div>
                              </section>
                            ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </SectionPanel>
            ) : null}

            {activeTab === "calendar" ? (
              <SectionPanel
                title="Operations calendar"
                description="Dates from leases, work, compliance, billing, arrears, and onboarding."
                icon={<CalendarDays size={17} className="text-primary" />}
                actions={
                  <div
                    role="group"
                    aria-label="Calendar layout"
                    className="inline-flex rounded-full border border-border bg-white p-1 shadow-leasiumXs"
                  >
                    {(["agenda", "month"] as const).map((layout) => {
                      const active = calendarLayout === layout;
                      return (
                        <button
                          key={layout}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setCalendarLayout(layout)}
                          className={cn(
                            "min-h-11 rounded-full px-4 text-sm font-semibold transition",
                            active
                              ? "bg-primary text-white"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                        >
                          {layout === "agenda" ? "Agenda" : "Month"}
                        </button>
                      );
                    })}
                  </div>
                }
              >
                <div className="border-b border-border bg-muted/30 px-4 py-3">
                  <div className="flex items-center gap-2 overflow-x-auto pb-1 text-sm lg:flex-wrap lg:overflow-visible lg:pb-0">
                    <span className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-white px-3 text-xs font-semibold text-slate shadow-leasiumXs">
                      <CalendarDays size={14} className="text-primary" />
                      {allMode
                        ? "All entities"
                        : selectedEntity?.name ?? "Selected entity"}
                    </span>
                    <span className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-border bg-white px-3 text-xs font-semibold text-muted-foreground">
                      Events
                      <span className="text-foreground">
                        {filteredCalendarEvents.length}
                      </span>
                    </span>
                    <span className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-border bg-white px-3 text-xs font-semibold text-muted-foreground">
                      Overdue
                      <span className="text-danger-strong">
                        {overdueCalendarEventCount}
                      </span>
                    </span>
                    <span className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-border bg-white px-3 text-xs font-semibold text-muted-foreground">
                      Next 30
                      <span className="text-primary-hover">
                        {upcomingCalendarEventCount}
                      </span>
                    </span>
                    <span className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-border bg-white px-3 text-xs font-semibold text-muted-foreground">
                      {formatDate(operationsCalendarWindow.from)} to{" "}
                      {formatDate(operationsCalendarWindow.to)}
                    </span>
                  </div>
                </div>

                <div className="grid gap-3 border-b border-border px-4 py-3 xl:grid-cols-[minmax(0,1fr)_auto]">
                  <div
                    role="group"
                    aria-label="Calendar source filters"
                    className="flex min-w-0 gap-2 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-visible lg:pb-0"
                  >
                    {calendarSourceFilterRows.map((filter) => {
                      const active = calendarSourceFilter === filter.id;
                      return (
                        <button
                          key={filter.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => {
                            setCalendarSourceFilter(filter.id);
                            setPreviewCalendarEventId(null);
                          }}
                          className={cn(
                            "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition",
                            active
                              ? "border-primary/30 bg-primary-soft text-primary-hover"
                              : "border-border bg-white text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                        >
                          <span>{filter.label}</span>
                          <span className="text-foreground">
                            {filter.count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div
                    role="group"
                    aria-label="Calendar date filters"
                    className="flex min-w-0 gap-2 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-visible lg:pb-0 xl:justify-end"
                  >
                    {calendarDateFilterRows.map((filter) => {
                      const active = calendarDateFilter === filter.id;
                      return (
                        <button
                          key={filter.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => {
                            setCalendarDateFilter(filter.id);
                            setPreviewCalendarEventId(null);
                          }}
                          className={cn(
                            "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition",
                            active
                              ? "border-primary/30 bg-primary-soft text-primary-hover"
                              : "border-border bg-white text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                        >
                          <span>{filter.label}</span>
                          <span className="text-foreground">
                            {filter.count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {calendarEvents.length === 0 && !calendarQuery.isLoading ? (
                  <EmptyState
                    icon={<CalendarDays size={18} />}
                    title="No calendar events in this window."
                    description="Lease, work, compliance, billing, arrears, and onboarding dates will appear here."
                  />
                ) : null}

                {calendarEvents.length > 0 &&
                filteredCalendarEvents.length === 0 &&
                !calendarQuery.isLoading ? (
                  <EmptyState
                    icon={<CalendarDays size={18} />}
                    title="No calendar events match these filters."
                    description="Try all sources or all dates to return to the full operations calendar."
                  />
                ) : null}

                {previewCalendarEvent ? (
                  <aside className="m-4 grid gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold text-foreground">
                            {previewCalendarEvent.title}
                          </h3>
                          <StatusBadge tone={previewCalendarEvent.severity}>
                            {calendarEventLabel(previewCalendarEvent)}
                          </StatusBadge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {[
                            previewCalendarEvent.description,
                            propertyName(
                              properties,
                              previewCalendarEvent.property_id,
                            ),
                            tenantName(tenants, previewCalendarEvent.tenant_id),
                          ]
                            .filter(Boolean)
                            .join(" - ")}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label="Close calendar preview"
                        onClick={() => setPreviewCalendarEventId(null)}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-border bg-white text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      >
                        <X size={15} />
                      </button>
                    </div>
                    <dl className="grid gap-2 text-sm sm:grid-cols-3">
                      <div>
                        <dt className="text-xs font-semibold uppercase text-muted-foreground">
                          Due
                        </dt>
                        <dd className="font-semibold text-foreground">
                          {formatDate(previewCalendarEvent.date)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold uppercase text-muted-foreground">
                          Source
                        </dt>
                        <dd className="font-semibold text-foreground">
                          {CALENDAR_EVENT_LABELS[previewCalendarEvent.type]}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold uppercase text-muted-foreground">
                          Record
                        </dt>
                        <dd className="font-semibold text-foreground">
                          {calendarEventSourceLabel(previewCalendarEvent)}
                        </dd>
                      </div>
                    </dl>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={previewCalendarEvent.link}
                        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-white transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                      >
                        <Link2 size={15} />
                        Open source
                      </Link>
                    </div>
                  </aside>
                ) : null}

                {filteredCalendarEvents.length > 0 &&
                calendarLayout === "month" ? (
                  <div className="p-4">
                    <PropertyCalendarMonthGrid
                      events={visibleCalendarMonthEvents}
                    />
                  </div>
                ) : null}

                {filteredCalendarEvents.length > 0 &&
                calendarLayout === "agenda" ? (
                  <div className="divide-y divide-border">
                    {calendarAgendaGroups.map((group) => (
                      <section
                        key={group.date}
                        className="grid gap-3 px-4 py-4 lg:grid-cols-[10rem_minmax(0,1fr)]"
                      >
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-foreground">
                            {formatDate(group.date)}
                          </h3>
                          <StatusBadge
                            tone={
                              dueRank(group.date) < 0
                                ? "danger"
                                : dueRank(group.date) <= 30
                                  ? "primary"
                                  : "neutral"
                            }
                            className="mt-2"
                          >
                            {dueLabel(group.date)}
                          </StatusBadge>
                        </div>
                        <div className="grid gap-2">
                          {group.items.map((event) => (
                            <article
                              key={event.id}
                              className="grid min-h-11 gap-2 rounded-xl border border-border bg-white px-3 py-3"
                            >
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <span className="font-semibold text-foreground">
                                  {event.title}
                                </span>
                                <StatusBadge tone={event.severity}>
                                  {calendarEventLabel(event)}
                                </StatusBadge>
                                {allMode ? (
                                  <span className="text-leasium-micro font-semibold uppercase text-muted-foreground">
                                    {entityNameById.get(event.entity_id) ??
                                      "Unknown entity"}
                                  </span>
                                ) : null}
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {[
                                  event.description,
                                  propertyName(properties, event.property_id),
                                  tenantName(tenants, event.tenant_id),
                                ]
                                  .filter(Boolean)
                                  .join(" - ")}
                              </p>
                              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <span>{dueLabel(event.date)}</span>
                                <span>{CALENDAR_EVENT_LABELS[event.type]}</span>
                                <span>{calendarEventSourceLabel(event)}</span>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  aria-label={`Preview ${event.title}`}
                                  onClick={() =>
                                    setPreviewCalendarEventId(event.id)
                                  }
                                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-white px-3 text-sm font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                                >
                                  <CalendarDays size={15} />
                                  Preview
                                </button>
                                <Link
                                  href={event.link}
                                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-white px-3 text-sm font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                                >
                                  <Link2 size={15} />
                                  Open source
                                </Link>
                              </div>
                            </article>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : null}
              </SectionPanel>
            ) : null}

            {activeTab === "compliance" ? (
              <SectionPanel
                title="Compliance & inspections"
                description="Recurring checks, document reviews, and inspection handoffs."
                icon={<ShieldCheck size={17} className="text-primary" />}
                actions={
                  <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end xl:w-auto">
                    <SecondaryButton
                      type="button"
                      className="min-h-11 w-full px-3 sm:w-auto"
                      disabled={!selectedEntityId || operationsLoading}
                      onClick={downloadComplianceCsv}
                    >
                      <Download size={15} />
                      Download compliance CSV
                    </SecondaryButton>
                    <SecondaryButton
                      type="button"
                      className="min-h-11 w-full px-3 sm:w-auto"
                      disabled={!selectedEntityId || operationsLoading}
                      onClick={copyComplianceCsv}
                    >
                      <Copy size={15} />
                      Copy compliance CSV
                    </SecondaryButton>
                  </div>
                }
              >
                <div className="border-b border-border bg-muted/30 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-3 text-xs font-semibold text-slate shadow-leasiumXs">
                      <ShieldCheck size={14} className="text-primary" />
                      Review queue
                    </span>
                    <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-white px-3 text-xs font-semibold text-muted-foreground">
                      Checks
                      <span className="text-foreground">
                        {openComplianceChecks.length}
                      </span>
                    </span>
                    <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-white px-3 text-xs font-semibold text-muted-foreground">
                      Overdue
                      <span className="text-danger-strong">
                        {overdueComplianceChecks.length}
                      </span>
                    </span>
                    <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-white px-3 text-xs font-semibold text-muted-foreground">
                      Due soon
                      <span className="text-warning-strong">
                        {dueSoonComplianceChecks.length}
                      </span>
                    </span>
                    <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-white px-3 text-xs font-semibold text-muted-foreground">
                      Missing evidence
                      <span className="text-foreground">
                        {missingEvidenceComplianceChecks.length}
                      </span>
                    </span>
                  </div>
                </div>

                <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(19rem,0.9fr)]">
                  <div className="grid gap-4">
                    {!operationsLoading && openComplianceChecks.length === 0 ? (
                      <section className="flex min-h-11 flex-wrap items-center gap-2 rounded-xl border border-border bg-white px-3 py-2">
                        <ShieldCheck
                          size={15}
                          className="shrink-0 text-muted-foreground"
                        />
                        <h3 className="text-sm font-semibold text-foreground">
                          Recurring checks
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          None yet — fire safety, insurance, bank guarantee,
                          make-good, and certificate checks will appear here.
                        </p>
                      </section>
                    ) : (
                    <section className="rounded-xl border border-border bg-white">
                      <div className="border-b border-border px-3 py-2">
                        <h3 className="text-sm font-semibold text-foreground">
                          Recurring checks
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          Register-backed checks and current evidence state.
                        </p>
                      </div>
                      <div className="divide-y divide-border">
                        {openComplianceChecks.map((check) => {
                          const latestCompletion =
                            latestComplianceCompletion(check);
                          const sourceDocumentId =
                            complianceEvidenceDocumentId(check);
                          const latestCompletionDetail =
                            latestComplianceCompletionEntry(check);
                          const detailExpanded =
                            expandedComplianceDetailId === check.id;
                          const certificateDetail =
                            complianceCertificateExpiryLabel(check) ??
                            (check.certificate_expires_on
                              ? `Certificate expires ${formatDate(
                                  check.certificate_expires_on,
                                )}`
                              : "No certificate expiry recorded");
                          const hasEvidencePacket = Boolean(
                            sourceDocumentId || latestCompletion,
                          );
                          const completionEntries =
                            complianceCompletionEntries(check);
                          const historyExpanded =
                            expandedCompletionHistoryId === check.id;
                          const visibleCompletionEntries = historyExpanded
                            ? completionEntries
                            : completionEntries.slice(0, 2);
                          return (
                            <div
                              key={check.id}
                              id={`compliance-check-${encodeURIComponent(check.id)}`}
                              data-testid={`compliance-check-${check.id}`}
                              className="grid scroll-mt-24 gap-2 p-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-foreground">
                                  {check.title}
                                </span>
                                <StatusBadge tone={complianceCheckTone(check)}>
                                  {check.status === "active"
                                    ? dueLabel(check.next_due_date)
                                    : complianceCheckStatusLabel(check)}
                                </StatusBadge>
                                <StatusBadge
                                  tone={complianceEvidenceTone(check)}
                                >
                                  {complianceEvidenceStatusLabel(check)}
                                </StatusBadge>
                                {check.certificate_expiry_status !== "none" ? (
                                  <StatusBadge
                                    tone={complianceCertificateExpiryTone(check)}
                                  >
                                    {complianceCertificateExpiryLabel(check)}
                                  </StatusBadge>
                                ) : null}
                                <span className="text-xs font-medium text-muted-foreground">
                                  {sentenceLabel(check.kind)}
                                </span>
                                {allMode ? (
                                  <span className="text-leasium-micro font-semibold uppercase text-muted-foreground">
                                    {entityNameById.get(check.entity_id) ??
                                      "Unknown entity"}
                                  </span>
                                ) : null}
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {[
                                  complianceScopeContext(
                                    check,
                                    properties,
                                    tenants,
                                  ),
                                  recurrenceLabel(check),
                                  check.certificate_expires_on
                                    ? `Certificate expires ${formatDate(
                                        check.certificate_expires_on,
                                      )}`
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(" - ")}
                              </p>
                              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                <span>{complianceEvidenceLabel(check)}</span>
                                <span>
                                  Owner{" "}
                                  {complianceOwnerLabel(check, securityMembers)}
                                </span>
                                <span>{complianceCheckNextAction(check)}</span>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <SecondaryButton
                                  type="button"
                                  className="min-h-11 w-full px-3 sm:w-auto"
                                  disabled={
                                    !canCompleteComplianceCheck(check) ||
                                    completeComplianceCheckMutation.isPending ||
                                    allMode
                                  }
                                  title={
                                    allMode
                                      ? "Select a single entity to complete a check"
                                      : undefined
                                  }
                                  onClick={() =>
                                    completeComplianceCheckMutation.mutate(check)
                                  }
                                >
                                  {completeComplianceCheckMutation.isPending ? (
                                    <RefreshCw
                                      size={15}
                                      className="animate-spin text-primary"
                                    />
                                  ) : (
                                    <CheckCircle2
                                      size={15}
                                      className="text-success"
                                    />
                                  )}
                                  {complianceCompletionActionLabel(check)}
                                </SecondaryButton>
                                {check.status === "active" &&
                                !check.source_document_id ? (
                                  <SecondaryButton
                                    type="button"
                                    className="min-h-11 w-full px-3 sm:w-auto"
                                    disabled={allMode}
                                    title={
                                      allMode
                                        ? "Select a single entity to add evidence"
                                        : undefined
                                    }
                                    onClick={() =>
                                      setEvidenceLinkForm((current) =>
                                        current?.checkId === check.id
                                          ? null
                                          : {
                                              checkId: check.id,
                                              documentId: "",
                                              certificateExpiresOn: "",
                                              file: null,
                                            },
                                      )
                                    }
                                  >
                                    <Link2 size={15} className="text-primary" />
                                    Add evidence
                                  </SecondaryButton>
                                ) : null}
                                <SecondaryButton
                                  type="button"
                                  className="min-h-11 w-full px-3 sm:w-auto"
                                  aria-expanded={detailExpanded}
                                  aria-controls={`compliance-evidence-detail-${check.id}`}
                                  onClick={() =>
                                    setExpandedComplianceDetailId((current) =>
                                      current === check.id ? null : check.id,
                                    )
                                  }
                                >
                                  <ChevronDown
                                    size={15}
                                    className={
                                      detailExpanded
                                        ? "rotate-180 transition-transform"
                                        : "transition-transform"
                                    }
                                  />
                                  {detailExpanded
                                    ? "Hide evidence detail"
                                    : "Review evidence detail"}
                                </SecondaryButton>
                                {completeComplianceCheckMutation.isError &&
                                completeComplianceCheckMutation.variables?.id ===
                                  check.id ? (
                                  <span
                                    role="alert"
                                    className="text-xs font-medium text-danger"
                                  >
                                    {friendlyError(
                                      completeComplianceCheckMutation.error,
                                    )}
                                  </span>
                                ) : null}
                              </div>
                              {evidenceLinkForm?.checkId === check.id ? (
                                <div className="grid gap-2 rounded-xl border border-border bg-muted/30 p-3">
                                  <p className="text-xs text-muted-foreground">
                                    Link an already-stored document, or upload
                                    a new file, as reviewed evidence. This does
                                    not complete the check and makes no
                                    provider call.
                                  </p>
                                  <Field label="Evidence document">
                                    <Select
                                      value={evidenceLinkForm.documentId}
                                      onChange={(event) =>
                                        setEvidenceLinkForm((current) =>
                                          current
                                            ? {
                                                ...current,
                                                documentId: event.target.value,
                                              }
                                            : current,
                                        )
                                      }
                                    >
                                      <option value="">
                                        Choose a stored document
                                      </option>
                                      {(
                                        evidenceDocumentsQuery.data ??
                                        ([] as DocumentRecord[])
                                      ).map((document) => (
                                        <option
                                          key={document.id}
                                          value={document.id}
                                        >
                                          {document.filename} (
                                          {sentenceLabel(document.category)})
                                        </option>
                                      ))}
                                    </Select>
                                  </Field>
                                  <Field label="Upload a new file (optional)">
                                    <Input
                                      type="file"
                                      onChange={(event) =>
                                        setEvidenceLinkForm((current) =>
                                          current
                                            ? {
                                                ...current,
                                                file:
                                                  event.target.files?.[0] ??
                                                  null,
                                              }
                                            : current,
                                        )
                                      }
                                    />
                                  </Field>
                                  <Field label="Certificate expiry (optional)">
                                    <Input
                                      type="date"
                                      value={
                                        evidenceLinkForm.certificateExpiresOn
                                      }
                                      onChange={(event) =>
                                        setEvidenceLinkForm((current) =>
                                          current
                                            ? {
                                                ...current,
                                                certificateExpiresOn:
                                                  event.target.value,
                                              }
                                            : current,
                                        )
                                      }
                                    />
                                  </Field>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Button
                                      type="button"
                                      className="min-h-11 w-full px-3 sm:w-auto"
                                      disabled={
                                        (!evidenceLinkForm.documentId &&
                                          !evidenceLinkForm.file) ||
                                        linkComplianceEvidenceMutation.isPending
                                      }
                                      onClick={() =>
                                        linkComplianceEvidenceMutation.mutate({
                                          check,
                                          documentId:
                                            evidenceLinkForm.documentId,
                                          certificateExpiresOn:
                                            evidenceLinkForm.certificateExpiresOn,
                                          file: evidenceLinkForm.file,
                                        })
                                      }
                                    >
                                      {linkComplianceEvidenceMutation.isPending ? (
                                        <RefreshCw
                                          size={15}
                                          className="animate-spin"
                                        />
                                      ) : (
                                        <Link2 size={15} />
                                      )}
                                      {evidenceLinkForm.file
                                        ? "Upload & link evidence"
                                        : "Link evidence"}
                                    </Button>
                                    <SecondaryButton
                                      type="button"
                                      className="min-h-11 w-full px-3 sm:w-auto"
                                      onClick={() => setEvidenceLinkForm(null)}
                                    >
                                      Cancel
                                    </SecondaryButton>
                                    {linkComplianceEvidenceMutation.isError &&
                                    linkComplianceEvidenceMutation.variables
                                      ?.check.id === check.id ? (
                                      <span
                                        role="alert"
                                        className="text-xs font-medium text-danger"
                                      >
                                        {friendlyError(
                                          linkComplianceEvidenceMutation.error,
                                        )}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              ) : null}
                              {detailExpanded ? (
                                <div
                                  id={`compliance-evidence-detail-${check.id}`}
                                  className="grid gap-3 border-l-2 border-primary/30 bg-muted/30 py-2 pl-3 pr-2"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                      <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                                        Evidence detail
                                      </h4>
                                      <p className="text-sm font-semibold text-foreground">
                                        {sourceDocumentId
                                          ? "Source document on file"
                                          : "No source document linked"}
                                      </p>
                                    </div>
                                    <StatusBadge
                                      tone={complianceEvidenceTone(check)}
                                    >
                                      {complianceEvidenceStatusLabel(check)}
                                    </StatusBadge>
                                  </div>
                                  <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-3">
                                    <div>
                                      <dt className="font-semibold text-foreground">
                                        Source document
                                      </dt>
                                      <dd>{sourceDocumentId ?? "Not linked"}</dd>
                                    </div>
                                    <div>
                                      <dt className="font-semibold text-foreground">
                                        Current obligation
                                      </dt>
                                      <dd>
                                        {check.current_obligation_id ??
                                          "No current obligation"}
                                      </dd>
                                    </div>
                                    <div>
                                      <dt className="font-semibold text-foreground">
                                        Latest completion
                                      </dt>
                                      <dd>
                                        {complianceCompletionDateLabel(check)}
                                      </dd>
                                    </div>
                                    <div>
                                      <dt className="font-semibold text-foreground">
                                        Approval
                                      </dt>
                                      <dd>
                                        {latestCompletionDetail?.operatorApproved
                                          ? "Operator approved"
                                          : "Approval not recorded"}
                                        {latestCompletionDetail?.approvedBy
                                          ? ` by ${latestCompletionDetail.approvedBy}`
                                          : ""}
                                      </dd>
                                    </div>
                                    <div>
                                      <dt className="font-semibold text-foreground">
                                        Certificate
                                      </dt>
                                      <dd>{certificateDetail}</dd>
                                    </div>
                                    <div>
                                      <dt className="font-semibold text-foreground">
                                        Next due
                                      </dt>
                                      <dd>
                                        {complianceCompletionNextDueLabel(check)}
                                      </dd>
                                    </div>
                                    <div>
                                      <dt className="font-semibold text-foreground">
                                        Owner
                                      </dt>
                                      <dd>
                                        {complianceOwnerLabel(
                                          check,
                                          securityMembers,
                                        )}
                                      </dd>
                                    </div>
                                    <div>
                                      <dt className="font-semibold text-foreground">
                                        Recurrence
                                      </dt>
                                      <dd>{recurrenceLabel(check)}</dd>
                                    </div>
                                    <div>
                                      <dt className="font-semibold text-foreground">
                                        Scope
                                      </dt>
                                      <dd>
                                        {complianceScopeContext(
                                          check,
                                          properties,
                                          tenants,
                                        ) || "Portfolio-wide"}
                                      </dd>
                                    </div>
                                    <div className="sm:col-span-2 xl:col-span-3">
                                      <dt className="font-semibold text-foreground">
                                        Notes
                                      </dt>
                                      <dd>{complianceEvidenceNotes(check)}</dd>
                                    </div>
                                  </dl>
                                  <p className="text-xs text-muted-foreground">
                                    {COMPLIANCE_REVIEW_PACKET_GUARDRAIL}
                                  </p>
                                </div>
                              ) : null}
                              {hasEvidencePacket ? (
                                <div className="grid gap-2 border-l-2 border-primary/30 bg-muted/30 py-2 pl-3 pr-2">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                      <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                                        Completion evidence packet
                                      </h4>
                                      <p className="text-sm font-semibold text-foreground">
                                        {sourceDocumentId ??
                                          "Completion history on file"}
                                      </p>
                                    </div>
                                    <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                                      <SecondaryButton
                                        type="button"
                                        className="min-h-11 w-full px-3 sm:w-auto"
                                        onClick={() =>
                                          copyComplianceEvidencePacket(check)
                                        }
                                      >
                                        <Copy size={15} />
                                        Copy evidence packet
                                      </SecondaryButton>
                                      <SecondaryButton
                                        type="button"
                                        className="min-h-11 w-full px-3 sm:w-auto"
                                        onClick={() =>
                                          downloadComplianceEvidencePacket(check)
                                        }
                                      >
                                        <Download size={15} />
                                        Download evidence packet
                                      </SecondaryButton>
                                    </div>
                                  </div>
                                  <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                                    <div>
                                      <dt className="font-semibold text-foreground">
                                        Source document
                                      </dt>
                                      <dd>{sourceDocumentId ?? "Not linked"}</dd>
                                    </div>
                                    <div>
                                      <dt className="font-semibold text-foreground">
                                        Last completed
                                      </dt>
                                      <dd>
                                        {complianceCompletionDateLabel(check)}
                                      </dd>
                                    </div>
                                    <div>
                                      <dt className="font-semibold text-foreground">
                                        Next due
                                      </dt>
                                      <dd>
                                        {complianceCompletionNextDueLabel(check)}
                                      </dd>
                                    </div>
                                  </dl>
                                  <p className="text-xs text-muted-foreground">
                                    {COMPLIANCE_REVIEW_PACKET_GUARDRAIL}
                                  </p>
                                </div>
                              ) : null}
                              {completionEntries.length > 0 ? (
                                <div className="grid gap-2 rounded-xl border border-border bg-muted/20 p-3">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <History
                                      size={14}
                                      className="shrink-0 text-muted-foreground"
                                    />
                                    <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                                      Completion history
                                    </h4>
                                    <span className="text-xs text-muted-foreground">
                                      {completionEntries.length === 1
                                        ? "1 recorded completion"
                                        : `${completionEntries.length} recorded completions`}
                                    </span>
                                  </div>
                                  <ol className="grid gap-2">
                                    {visibleCompletionEntries.map(
                                      (entry, index) => (
                                        <li
                                          key={`${check.id}-completion-${index}`}
                                          className="grid gap-1 rounded-lg border border-border bg-white px-3 py-2"
                                        >
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-sm font-semibold text-foreground">
                                              {entry.completedAt
                                                ? formatDate(entry.completedAt)
                                                : "Completion date not recorded"}
                                            </span>
                                            {entry.operatorApproved ? (
                                              <StatusBadge tone="success">
                                                Operator approved
                                              </StatusBadge>
                                            ) : (
                                              <StatusBadge tone="neutral">
                                                Approval not recorded
                                              </StatusBadge>
                                            )}
                                          </div>
                                          <p className="text-xs text-muted-foreground">
                                            {[
                                              entry.approvedBy
                                                ? `Approved by ${entry.approvedBy}`
                                                : null,
                                              entry.approvedAt
                                                ? `Approved ${formatDateTime(
                                                    entry.approvedAt,
                                                  )}`
                                                : null,
                                              entry.sourceDocumentId
                                                ? `Evidence ${entry.sourceDocumentId}`
                                                : null,
                                            ]
                                              .filter(Boolean)
                                              .join(" - ") ||
                                              "No approval detail recorded"}
                                          </p>
                                          {entry.notes ? (
                                            <p className="text-xs text-muted-foreground">
                                              {entry.notes}
                                            </p>
                                          ) : null}
                                        </li>
                                      ),
                                    )}
                                  </ol>
                                  {completionEntries.length > 2 ? (
                                    <SecondaryButton
                                      type="button"
                                      className="min-h-11 w-full px-3 sm:w-auto"
                                      onClick={() =>
                                        setExpandedCompletionHistoryId(
                                          (current) =>
                                            current === check.id
                                              ? null
                                              : check.id,
                                        )
                                      }
                                    >
                                      <ChevronDown
                                        size={15}
                                        className={
                                          historyExpanded
                                            ? "rotate-180 transition-transform"
                                            : "transition-transform"
                                        }
                                      />
                                      {historyExpanded
                                        ? "Show fewer completions"
                                        : `Show all ${completionEntries.length} completions`}
                                    </SecondaryButton>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                    )}

                    <section className="rounded-xl border border-border bg-white">
                      <div className="border-b border-border px-3 py-2">
                        <h3 className="text-sm font-semibold text-foreground">
                          Linked obligations
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          Existing critical dates that still need review.
                        </p>
                      </div>
                      <div className="divide-y divide-border">
                        {complianceObligations.map((obligation) => (
                          <div
                            key={obligation.id}
                            id={`compliance-obligation-${encodeURIComponent(obligation.id)}`}
                            className="grid gap-2 scroll-mt-24 p-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-foreground">
                                {obligation.title}
                              </span>
                              <StatusBadge tone={obligationTone(obligation)}>
                                {dueLabel(obligation.due_date)}
                              </StatusBadge>
                              <span className="text-xs font-medium text-muted-foreground">
                                {sentenceLabel(obligation.status)}
                              </span>
                              {allMode ? (
                                <span className="text-leasium-micro font-semibold uppercase text-muted-foreground">
                                  {entityNameById.get(obligation.entity_id) ??
                                    "Unknown entity"}
                                </span>
                              ) : null}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {[
                                complianceScopeContext(
                                  obligation,
                                  properties,
                                  tenants,
                                ),
                                sentenceLabel(obligation.category),
                                obligation.notes,
                              ]
                                .filter(Boolean)
                                .join(" - ")}
                            </p>
                          </div>
                        ))}
                        {!operationsLoading &&
                        complianceObligations.length === 0 ? (
                          <EmptyState
                            icon={<FileWarning size={18} />}
                            title="No linked obligations"
                            description="Open insurance, bank guarantee, make-good, and compliance obligations will appear here."
                          />
                        ) : null}
                      </div>
                    </section>
                  </div>

                  <div className="grid gap-4">
                    {!operationsLoading && complianceIntakes.length === 0 ? (
                      <section className="flex min-h-11 flex-wrap items-center gap-2 rounded-xl border border-border bg-white px-3 py-2">
                        <ClipboardList
                          size={15}
                          className="shrink-0 text-muted-foreground"
                        />
                        <h3 className="text-sm font-semibold text-foreground">
                          Smart Intake reviews
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          None waiting — insurance certificates and inspection
                          reports for review will appear here.
                        </p>
                      </section>
                    ) : (
                    <section className="rounded-xl border border-border bg-white">
                      <div className="border-b border-border px-3 py-2">
                        <h3 className="text-sm font-semibold text-foreground">
                          Smart Intake reviews
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          Compliance and inspection documents waiting for an
                          operator decision.
                        </p>
                      </div>
                      <div className="divide-y divide-border">
                        {complianceIntakes.map((intake) => (
                          <div key={intake.id} className="grid gap-2 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-foreground">
                                {complianceIntakeTitle(intake)}
                              </span>
                              <StatusBadge tone={intakeTone(intake)}>
                                {intakeChip(intake)}
                              </StatusBadge>
                              {allMode ? (
                                <span className="text-leasium-micro font-semibold uppercase text-muted-foreground">
                                  {entityNameById.get(intake.entity_id) ??
                                    "Unknown entity"}
                                </span>
                              ) : null}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {[
                                documentTypeLabel(intake.document_type),
                                intake.filename,
                                intake.summary,
                              ]
                                .filter(Boolean)
                                .join(" - ")}
                            </p>
                            <Link
                              href={intakeReviewHref(intake)}
                              className="inline-flex min-h-11 w-fit items-center gap-2 rounded-xl border border-border px-3 text-sm font-semibold text-foreground transition duration-200 ease-leasium hover:bg-muted hover:text-primary"
                            >
                              <Link2 size={15} />
                              Open inspection intake
                            </Link>
                          </div>
                        ))}
                      </div>
                    </section>
                    )}

                    <section className="rounded-xl border border-border bg-white">
                      <div className="border-b border-border px-3 py-2">
                        <h3 className="text-sm font-semibold text-foreground">
                          Inspection work orders
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          Maintenance jobs created from reviewed inspection
                          findings.
                        </p>
                      </div>
                      <div className="divide-y divide-border">
                        {inspectionWorkOrders.map((workOrder) => {
                          const finding = inspectionWorkOrderFinding(workOrder);
                          return (
                            <div key={workOrder.id} className="grid gap-2 p-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <Link
                                  href={`/operations/maintenance/${workOrder.id}`}
                                  className="font-semibold text-foreground hover:text-primary"
                                >
                                  {workOrder.title}
                                </Link>
                                <StatusBadge tone={maintenanceTone(workOrder)}>
                                  {dueLabel(workOrder.due_date)}
                                </StatusBadge>
                                <StatusBadge tone={maintenanceTone(workOrder)}>
                                  {sentenceLabel(workOrder.status)}
                                </StatusBadge>
                                {allMode ? (
                                  <span className="text-leasium-micro font-semibold uppercase text-muted-foreground">
                                    {entityNameById.get(workOrder.entity_id) ??
                                      "Unknown entity"}
                                  </span>
                                ) : null}
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {[
                                  complianceScopeContext(
                                    workOrder,
                                    properties,
                                    tenants,
                                  ),
                                  stringValue(finding, "location"),
                                  stringValue(finding, "category"),
                                  workOrder.source_reference,
                                ]
                                  .filter(Boolean)
                                  .join(" - ")}
                              </p>
                              {inspectionWorkOrderIntakeId(workOrder) ? (
                                <Link
                                  href={intakeReviewHref({
                                    id: inspectionWorkOrderIntakeId(workOrder)!,
                                    entity_id: workOrder.entity_id,
                                  } as DocumentIntakeRecord)}
                                  className="inline-flex min-h-11 w-fit items-center gap-2 rounded-xl border border-border px-3 text-sm font-semibold text-foreground transition duration-200 ease-leasium hover:bg-muted hover:text-primary"
                                >
                                  <Link2 size={15} />
                                  Source intake
                                </Link>
                              ) : null}
                            </div>
                          );
                        })}
                        {!operationsLoading &&
                        inspectionWorkOrders.length === 0 ? (
                          <EmptyState
                            icon={<Wrench size={18} />}
                            title="No inspection-created work orders"
                            description="Reviewed inspection findings that create maintenance work will appear here."
                          />
                        ) : null}
                      </div>
                    </section>
                  </div>
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
                        className="grid gap-2 px-4 py-3 sm:gap-3 sm:py-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/operations/maintenance/${workOrder.id}`}
                              className="font-semibold text-foreground hover:text-primary"
                            >
                              {workOrder.title}
                            </Link>
                            {allMode ? (
                              <span className="text-leasium-micro font-semibold uppercase text-muted-foreground">
                                {entityNameById.get(workOrder.entity_id) ??
                                  "Unknown entity"}
                              </span>
                            ) : null}
                            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5">
                              <span className="text-leasium-micro uppercase tracking-wide text-muted-foreground">
                                Status
                              </span>
                              <InlineEditCell
                                value={workOrder.status}
                                ariaLabel={`Status for ${workOrder.title}`}
                                placeholder="Set status"
                                options={MAINTENANCE_STATUS_OPTIONS}
                                disabled={allMode}
                                onSave={(next) =>
                                  saveWorkOrderField(workOrder, "status", next)
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
                                disabled={allMode}
                                onSave={(next) =>
                                  saveWorkOrderField(
                                    workOrder,
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
                        <div className="hidden gap-2 xl:grid xl:justify-items-end">
                          {renderMaintenanceAssignmentControl(workOrder)}
                          <MaintenanceActions
                            workOrder={workOrder}
                            onUpdate={(data) =>
                              updateMaintenanceMutation.mutate({
                                id: workOrder.id,
                                data,
                              })
                            }
                            disabled={updateMaintenanceMutation.isPending || allMode}
                            expanded={expandedMaintenanceId === workOrder.id}
                            onToggleDetails={() =>
                              setExpandedMaintenanceId((current) =>
                                current === workOrder.id ? null : workOrder.id,
                              )
                            }
                          />
                        </div>
                        <MobileRowDisclosure
                          title="Work-order actions"
                          subtitle={maintenanceMobileActionSummary(workOrder)}
                          icon={<ClipboardList size={15} />}
                        >
                          {renderMaintenanceAssignmentControl(
                            workOrder,
                            `Work-order owner selector: ${workOrder.title}`,
                          )}
                          <MaintenanceActions
                            workOrder={workOrder}
                            onUpdate={(data) =>
                              updateMaintenanceMutation.mutate({
                                id: workOrder.id,
                                data,
                              })
                            }
                            disabled={updateMaintenanceMutation.isPending || allMode}
                            expanded={expandedMaintenanceId === workOrder.id}
                            onToggleDetails={() =>
                              setExpandedMaintenanceId((current) =>
                                current === workOrder.id ? null : workOrder.id,
                              )
                            }
                            compactLabels
                          />
                        </MobileRowDisclosure>
                        {expandedMaintenanceId === workOrder.id ? (
                          <div className="xl:col-span-2">
                            <MaintenanceDetailPanel
                              workOrder={workOrder}
                              properties={properties}
                              tenants={tenants}
                              invoiceDrafts={invoiceDrafts}
                              disabled={updateMaintenanceMutation.isPending || allMode}
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
                            {allMode ? (
                              <span className="text-leasium-micro font-semibold uppercase text-muted-foreground">
                                {entityNameById.get(arrearsCase.entity_id) ??
                                  "Unknown entity"}
                              </span>
                            ) : null}
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
                            disabled={updateArrearsMutation.isPending || allMode}
                          />
                        </div>
                        <div className="xl:col-span-2">
                          <ArrearsReviewPacketPanel
                            arrearsCase={arrearsCase}
                            tenantLabel={tenantName(
                              tenants,
                              arrearsCase.tenant_id,
                            )}
                            propertyLabel={propertyName(
                              properties,
                              arrearsCase.property_id,
                            )}
                          />
                        </div>
                        <div className="xl:col-span-2">
                          <ArrearsPromiseToPay
                            arrearsCase={arrearsCase}
                            onRecord={(data) =>
                              recordArrearsPromiseToPayMutation.mutateAsync({
                                id: arrearsCase.id,
                                data,
                              })
                            }
                            disabled={
                              recordArrearsPromiseToPayMutation.isPending ||
                              allMode
                            }
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
      {maintenanceInlineUndo ? (
        <div
          className={WORK_MOBILE_TOAST_CLASS}
          role="status"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">
                {sentenceLabel(maintenanceInlineUndo.field)} changed to{" "}
                {label(maintenanceInlineUndo.next)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {maintenanceInlineUndo.title} was previously{" "}
                {label(maintenanceInlineUndo.previous)}.
              </p>
              {maintenanceInlineUndo.error ? (
                <p className="mt-2 text-xs text-danger">
                  {maintenanceInlineUndo.error}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <SecondaryButton
                type="button"
                className="min-h-11 px-3"
                onClick={() => void undoMaintenanceInlineEdit()}
                disabled={maintenanceInlineUndo.undoing}
              >
                {maintenanceInlineUndo.undoing ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                Undo
              </SecondaryButton>
              <button
                type="button"
                className="min-h-11 rounded-xl px-3 text-sm font-semibold text-muted-foreground transition hover:bg-muted"
                onClick={() => setMaintenanceInlineUndo(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {obligationConfirmation ? (
        <div
          className={WORK_MOBILE_TOAST_CLASS}
          role="status"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" />
              <div className="text-sm font-semibold text-foreground">
                {obligationConfirmation.message}
              </div>
            </div>
            <button
              type="button"
              className="min-h-11 shrink-0 rounded-xl px-3 text-sm font-semibold text-muted-foreground transition hover:bg-muted"
              onClick={() => setObligationConfirmation(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
      {complianceCompletionConfirmation ? (
        <div
          className={WORK_MOBILE_TOAST_CLASS}
          role="status"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-success" />
              <div className="text-sm font-semibold text-foreground">
                {complianceCompletionConfirmation.message}
              </div>
            </div>
            <button
              type="button"
              className="min-h-11 shrink-0 rounded-xl px-3 text-sm font-semibold text-muted-foreground transition hover:bg-muted"
              onClick={() => setComplianceCompletionConfirmation(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}

// Local overflow menu for the queue export/digest controls. Review-only
// container: every item keeps its own explicit handler and guard, so no
// provider call fires from opening or closing the menu.
function ExportDigestMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative w-full sm:w-auto">
      <SecondaryButton
        type="button"
        className="min-h-11 w-full px-3 sm:w-auto"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Download size={15} />
        Export & digest
        <ChevronDown
          size={15}
          className={cn(
            "transition duration-200 ease-leasium",
            open && "rotate-180",
          )}
        />
      </SecondaryButton>
      {open ? (
        <div className="absolute right-0 z-30 mt-2 grid w-72 gap-2 rounded-2xl border border-border bg-white p-3 shadow-leasiumSm">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function MobileRowDisclosure({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <details className="rounded-xl border border-border bg-muted/30 text-sm xl:hidden">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2">
        <span className="inline-flex min-w-0 items-center gap-2 font-semibold text-foreground">
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-white text-primary shadow-leasiumXs">
            {icon}
          </span>
          <span className="truncate">{title}</span>
        </span>
        <span className="max-w-[11rem] shrink-0 truncate text-right text-xs font-medium text-muted-foreground">
          {subtitle}
        </span>
      </summary>
      <div className="grid gap-3 border-t border-border bg-white/70 p-3">
        {children}
      </div>
    </details>
  );
}

function WorkAssignmentControl({
  title,
  assigneeAriaLabel,
  assignment,
  members,
  value,
  onChange,
  onAssign,
  onAction,
  onNotify,
  disabled,
  membersLoading,
  collapsible,
}: {
  title: string;
  assigneeAriaLabel?: string;
  assignment: WorkAssignment | null;
  members: SecurityMemberRecord[];
  value: string;
  onChange: (value: string) => void;
  onAssign: (assigneeId: string) => void;
  onAction: (action: WorkAssignmentAction) => void;
  onNotify: () => void;
  disabled: boolean;
  membersLoading: boolean;
  collapsible?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
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
  const showFootnote = Boolean(
    assignment?.assignedAt ||
      notificationReady ||
      notificationDelivered ||
      notificationProblem,
  );

  if (collapsible && !isAssigned) {
    if (!expanded) {
      return (
        <div className="flex min-w-[min(100%,22rem)]">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label={`Assign owner for ${title}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-border bg-white/60 px-3 text-sm font-medium text-muted-foreground transition duration-200 ease-leasium hover:border-primary/40 hover:bg-white hover:text-foreground"
          >
            <UserRound size={15} />
            Assign owner
          </button>
        </div>
      );
    }
    return (
      <div className="grid min-w-[min(100%,22rem)] gap-2 rounded-xl border border-border bg-muted/30 p-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label={assigneeAriaLabel ?? `Assignee for ${title}`}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled || membersLoading || !hasMembers}
            className="h-11 w-44"
          >
            <option value="">
              {membersLoading
                ? "Checking members"
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
            className="h-11 px-3"
            disabled={disabled || !canAssign}
            onClick={() => onAssign(value)}
          >
            <MailCheck size={15} />
            Assign
          </SecondaryButton>
          <button
            type="button"
            onClick={() => {
              onChange("");
              setExpanded(false);
            }}
            className="inline-flex min-h-11 items-center px-3 text-sm font-medium text-muted-foreground transition duration-200 ease-leasium hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

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
          aria-label={assigneeAriaLabel ?? `Assignee for ${title}`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled || membersLoading || !hasMembers}
          className="h-9 w-44"
        >
          <option value="">
            {membersLoading
              ? "Checking members"
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
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold text-muted-foreground">
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
      {showFootnote ? (
        <div className="text-xs text-muted-foreground">
          {assignment?.assignedAt
            ? `Updated ${formatDateTime(assignment.assignedAt)} by ${
                assignment.assignedByName ?? "Leasium"
              }. ${notificationFootnote}`
            : notificationFootnote}
        </div>
      ) : null}
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
      <summary className="min-h-11 cursor-pointer px-2 py-2 text-xs font-semibold text-primary hover:text-primary-hover">
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
  compactLabels,
}: {
  workOrder: MaintenanceWorkOrderRecord;
  onUpdate: (data: Parameters<typeof updateMaintenanceWorkOrder>[1]) => void;
  disabled: boolean;
  expanded?: boolean;
  onToggleDetails?: () => void;
  compactLabels?: boolean;
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
          aria-label={compactLabels ? "Open work-order panel" : undefined}
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
          aria-label={compactLabels ? "Mark work order triaged" : undefined}
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
          aria-label={compactLabels ? "Approve work order" : undefined}
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
          aria-label={compactLabels ? "Start work order" : undefined}
          disabled={disabled}
          onClick={() => onUpdate({ status: "in_progress" })}
        >
          <Wrench size={15} />
          Start
        </SecondaryButton>
      ) : null}
      <Link
        aria-label={compactLabels ? "Open completion review" : undefined}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
        href={`/operations/maintenance/${workOrder.id}`}
      >
        <CheckCircle2 size={15} className="text-success" />
        Review completion
      </Link>
    </div>
  );
}

function ArrearsReviewPacketPanel({
  arrearsCase,
  tenantLabel,
  propertyLabel,
}: {
  arrearsCase: ArrearsCaseRecord;
  tenantLabel: string;
  propertyLabel: string;
}) {
  const [receipt, setReceipt] = useState<string | null>(null);
  const packet = buildArrearsReviewPacket(arrearsCase);
  const copyPacket = async () => {
    const copied = await copyTextToClipboard(
      arrearsReviewPacketText({
        arrearsCase,
        tenantLabel,
        propertyLabel,
        packet,
      }),
    );
    setReceipt(
      copied
        ? "Arrears review packet copied."
        : "Copy unavailable in this browser.",
    );
  };
  const downloadPacketCsv = () => {
    saveBlob(
      new Blob(
        [
          arrearsReviewPacketCsv({
            arrearsCase,
            tenantLabel,
            propertyLabel,
            packet,
          }),
        ],
        { type: "text/csv;charset=utf-8" },
      ),
      `arrears-review-packet-${arrearsCase.id}.csv`,
    );
    setReceipt("Arrears review packet CSV downloaded.");
  };

  return (
    <ArrearsReviewPacketPanelView
      packet={packet}
      receipt={receipt}
      onCopy={copyPacket}
      onDownload={downloadPacketCsv}
      tenantHref={`/tenants/${encodeURIComponent(arrearsCase.tenant_id)}`}
      queueHref="/operations?tab=queue"
      guardrail={ARREARS_REVIEW_PACKET_GUARDRAIL}
      testId={`arrears-review-packet-${arrearsCase.id}`}
    />
  );
}

function ArrearsActions({
  arrearsCase,
  onUpdate,
  disabled,
  compactLabels,
}: {
  arrearsCase: ArrearsCaseRecord;
  onUpdate: (data: Parameters<typeof updateArrearsCase>[1]) => void;
  disabled: boolean;
  compactLabels?: boolean;
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
        aria-label={compactLabels ? "Record arrears follow-up" : undefined}
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
          aria-label={
            compactLabels ? "Queue credit-control escalation" : undefined
          }
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
        aria-label={compactLabels ? "Close arrears case" : undefined}
        disabled={disabled}
        onClick={() => onUpdate({ status: "resolved" })}
      >
        <CheckCircle2 size={15} className="text-success" />
        Resolve
      </SecondaryButton>
    </div>
  );
}

function ArrearsPromiseToPay({
  arrearsCase,
  onRecord,
  disabled,
}: {
  arrearsCase: ArrearsCaseRecord;
  onRecord: (data: {
    promised_amount_cents?: number | null;
    promised_date?: string | null;
    notes: string;
  }) => Promise<unknown>;
  disabled: boolean;
}) {
  const [amount, setAmount] = useState("");
  const [promisedDate, setPromisedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const log = arrearsCase.promise_to_pay_notes_log ?? [];

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedNotes = notes.trim();
    if (!trimmedNotes) {
      setError("Notes are required to record a promise to pay.");
      return;
    }
    setError(null);
    try {
      await onRecord({
        promised_amount_cents: amount.trim()
          ? dollarsToCents(amount)
          : null,
        promised_date: promisedDate || null,
        notes: trimmedNotes,
      });
      setAmount("");
      setPromisedDate("");
      setNotes("");
    } catch {
      setError("Could not record the promise to pay. Try again.");
    }
  }

  return (
    <SectionPanel
      title="Promise to pay"
      description="Record what the tenant told you. This logs an operator note only — it does not take payment, create a charge, reconcile, or contact the tenant."
      icon={<ReceiptText size={17} className="text-primary" />}
    >
      <form
        onSubmit={submit}
        data-testid={`arrears-promise-to-pay-form-${arrearsCase.id}`}
        className="grid gap-3"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Promised amount (optional)">
            <Input
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>
          <Field label="Promised date (optional)">
            <Input
              type="date"
              value={promisedDate}
              onChange={(event) => setPromisedDate(event.target.value)}
            />
          </Field>
        </div>
        <Field label="Notes" error={error ?? undefined}>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            required
            placeholder="What the tenant promised and when."
            className="w-full rounded-xl border border-border bg-white px-3 py-3 text-sm outline-none transition-colors duration-200 ease-leasium focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15"
          />
        </Field>
        <div>
          <Button type="submit" disabled={disabled || !notes.trim()}>
            <ReceiptText size={15} />
            Record promise to pay
          </Button>
        </div>
      </form>
      <div className="mt-4 grid gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Recorded promises
        </span>
        {log.length === 0 ? (
          <EmptyState
            icon={<ReceiptText size={18} />}
            title="No promises recorded"
            description="Recorded promise-to-pay notes will appear here, newest first."
          />
        ) : (
          <ul className="grid gap-2">
            {[...log]
              .sort((a, b) =>
                (b.recorded_at ?? "").localeCompare(a.recorded_at ?? ""),
              )
              .map((promise, index) => (
                <li
                  key={`${promise.recorded_at ?? "promise"}-${index}`}
                  className="rounded-xl border border-border bg-white px-3 py-2.5 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone="primary">
                      {promise.promised_amount_cents != null
                        ? formatMoney(
                            promise.promised_amount_cents,
                            arrearsCase.currency,
                          )
                        : "No amount"}
                    </StatusBadge>
                    <span className="text-xs text-muted-foreground">
                      Promised{" "}
                      {promise.promised_date
                        ? formatDate(promise.promised_date)
                        : "no date"}
                    </span>
                  </div>
                  {promise.notes ? (
                    <p className="mt-1 text-sm text-foreground">
                      {promise.notes}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {promise.recorded_by ?? "Operator"} -{" "}
                    {formatDateTime(promise.recorded_at)}
                  </p>
                </li>
              ))}
          </ul>
        )}
      </div>
    </SectionPanel>
  );
}

export default function OperationsPage() {
  return (
    <QueryProvider>
      <OperationsWorkspace />
    </QueryProvider>
  );
}
