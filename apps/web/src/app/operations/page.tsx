"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileWarning,
  HandCoins,
  MailCheck,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { QueryProvider } from "@/components/query-provider";
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
  listArrearsCases,
  listDocumentIntakes,
  listEntities,
  listMaintenanceWorkOrders,
  listObligations,
  listProperties,
  listTenantOnboardings,
  listTenants,
  type MaintenancePriority,
  type MaintenanceWorkOrderRecord,
  type MaintenanceWorkOrderStatus,
  type ObligationRecord,
  type PropertyRecord,
  type TenantOnboardingRecord,
  type TenantRecord,
  updateArrearsCase,
  updateMaintenanceWorkOrder,
  updateObligation,
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

const tabs = [
  { id: "queue", label: "Queue", description: "All operational work" },
  { id: "maintenance", label: "Maintenance", description: "Repairs and approvals" },
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

const maintenancePriorities: MaintenancePriority[] = ["low", "normal", "high", "urgent"];
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

type MaintenanceFormState = {
  title: string;
  description: string;
  property_id: string;
  tenant_id: string;
  priority: MaintenancePriority;
  status: MaintenanceWorkOrderStatus;
  due_date: string;
  contractor_name: string;
  quote_amount: string;
  approval_required: boolean;
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
  quote_amount: "",
  approval_required: false,
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

function propertyName(properties: PropertyRecord[], propertyId: string | null | undefined) {
  return properties.find((property) => property.id === propertyId)?.name ?? "No property";
}

function tenantName(tenants: TenantRecord[], tenantId: string | null | undefined) {
  const tenant = tenants.find((item) => item.id === tenantId);
  return tenant?.trading_name || tenant?.legal_name || "No tenant";
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
  return ["uploaded", "reading", "ready_for_review", "needs_attention", "failed"].includes(
    intake.status,
  );
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
      return "Processing";
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
      onboarding.last_sent_at ? `Sent ${formatDateTime(onboarding.last_sent_at)}` : null,
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
      workOrder.contractor_name ? `Contractor: ${workOrder.contractor_name}` : null,
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
      arrearsCase.dispute_status !== "none" ? `Dispute: ${label(arrearsCase.dispute_status)}` : null,
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
  const [maintenanceStatus, setMaintenanceStatus] = useState<MaintenanceWorkOrderStatus | "all">("all");
  const [maintenancePriority, setMaintenancePriority] = useState<MaintenancePriority | "all">("all");
  const [arrearsStatus, setArrearsStatus] = useState<ArrearsCaseStatus | "all">("all");
  const [maintenanceFormOpen, setMaintenanceFormOpen] = useState(false);
  const [arrearsFormOpen, setArrearsFormOpen] = useState(false);
  const [maintenanceForm, setMaintenanceForm] = useState<MaintenanceFormState>(emptyMaintenanceForm);
  const [arrearsForm, setArrearsForm] = useState<ArrearsFormState>(emptyArrearsForm);
  const queryClient = useQueryClient();

  const entitiesQuery = useQuery({
    queryKey: ["operations-entities"],
    queryFn: listEntities,
  });

  useEffect(() => {
    const stored = window.localStorage.getItem(ENTITY_STORAGE_KEY);
    const accessibleIds = new Set((entitiesQuery.data ?? []).map((entity) => entity.id));
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

  const arrearsQuery = useQuery({
    queryKey: ["operations-arrears", selectedEntityId],
    queryFn: () => listArrearsCases({ entity_id: selectedEntityId }),
    enabled: Boolean(selectedEntityId),
  });

  const invalidateOperations = () => {
    queryClient.invalidateQueries({ queryKey: ["operations-obligations", selectedEntityId] });
    queryClient.invalidateQueries({ queryKey: ["operations-maintenance", selectedEntityId] });
    queryClient.invalidateQueries({ queryKey: ["operations-arrears", selectedEntityId] });
  };

  const updateObligationMutation = useMutation({
    mutationFn: (payload: { obligation: ObligationRecord; status: "completed" | "waived" }) =>
      updateObligation(payload.obligation.id, {
        entity_id: payload.obligation.entity_id,
        property_id: payload.obligation.property_id,
        tenancy_unit_id: payload.obligation.tenancy_unit_id,
        lease_id: payload.obligation.lease_id,
        title: payload.obligation.title,
        category: payload.obligation.category,
        status: payload.status,
        due_date: payload.obligation.due_date,
        priority: payload.obligation.priority,
        owner_role: payload.obligation.owner_role,
        notes: payload.obligation.notes,
        metadata: payload.obligation.metadata,
        completed_at: payload.status === "completed" ? new Date().toISOString() : null,
      }),
    onSuccess: invalidateOperations,
  });

  const createMaintenanceMutation = useMutation({
    mutationFn: createMaintenanceWorkOrder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["operations-maintenance", selectedEntityId] });
      setMaintenanceForm(emptyMaintenanceForm);
      setMaintenanceFormOpen(false);
    },
  });

  const updateMaintenanceMutation = useMutation({
    mutationFn: (payload: { id: string; data: Parameters<typeof updateMaintenanceWorkOrder>[1] }) =>
      updateMaintenanceWorkOrder(payload.id, payload.data),
    onSuccess: invalidateOperations,
  });

  const createArrearsMutation = useMutation({
    mutationFn: createArrearsCase,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["operations-arrears", selectedEntityId] });
      setArrearsForm(emptyArrearsForm);
      setArrearsFormOpen(false);
    },
  });

  const updateArrearsMutation = useMutation({
    mutationFn: (payload: { id: string; data: Parameters<typeof updateArrearsCase>[1] }) =>
      updateArrearsCase(payload.id, payload.data),
    onSuccess: invalidateOperations,
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
        arrearsQuery.isLoading));

  const properties = propertiesQuery.data ?? EMPTY_PROPERTIES;
  const tenants = tenantsQuery.data ?? EMPTY_TENANTS;
  const obligations = obligationsQuery.data ?? EMPTY_OBLIGATIONS;
  const onboardings = onboardingQuery.data ?? EMPTY_ONBOARDINGS;
  const intakes = documentIntakesQuery.data ?? EMPTY_INTAKES;
  const maintenance = maintenanceQuery.data ?? EMPTY_MAINTENANCE;
  const arrears = arrearsQuery.data ?? EMPTY_ARREARS;

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
    [arrears, intakes, maintenance, obligations, onboardings, properties, tenants],
  );

  const openQueueItems = queueItems.filter((item) => !item.completed);
  const urgentMaintenance = maintenance.filter(
    (item) => maintenanceIsOpen(item) && ["urgent", "high"].includes(item.priority),
  );
  const awaitingApproval = maintenance.filter(
    (item) =>
      maintenanceIsOpen(item) &&
      (item.status === "awaiting_approval" || item.approval_status === "pending"),
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
    if (maintenancePriority !== "all" && item.priority !== maintenancePriority) {
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
    arrearsQuery.error ||
    createMaintenanceMutation.error ||
    updateMaintenanceMutation.error ||
    createArrearsMutation.error ||
    updateArrearsMutation.error ||
    updateObligationMutation.error;

  function refresh() {
    propertiesQuery.refetch();
    tenantsQuery.refetch();
    obligationsQuery.refetch();
    onboardingQuery.refetch();
    documentIntakesQuery.refetch();
    maintenanceQuery.refetch();
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
      status: maintenanceForm.approval_required ? "awaiting_approval" : maintenanceForm.status,
      due_date: maintenanceForm.due_date || null,
      contractor_name: optionalString(maintenanceForm.contractor_name),
      quote_amount_cents: quoteAmount || null,
      approval_required: maintenanceForm.approval_required,
      approval_status: maintenanceForm.approval_required ? "pending" : "not_required",
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
      promise_to_pay_amount_cents: dollarsToCents(arrearsForm.promise_to_pay_amount) || null,
      notes: optionalString(arrearsForm.notes),
      metadata: {
        source: "operator_operations_workspace",
        tenant_name: tenant?.trading_name || tenant?.legal_name || null,
      },
    });
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
            <CheckCircle2 size={15} className="text-leasium-success" />
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
        <Link className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted" href="/tenants">
          <MailCheck size={15} />
          Open tenants
        </Link>
      );
    }
    if (item.kind === "document_intake") {
      return (
        <Link className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted" href="/intake">
          <Sparkles size={15} />
          Review
        </Link>
      );
    }
    if (item.kind === "maintenance") {
      return (
        <MaintenanceActions
          workOrder={item.record}
          onUpdate={(data) => updateMaintenanceMutation.mutate({ id: item.record.id, data })}
          disabled={updateMaintenanceMutation.isPending}
        />
      );
    }
    return (
      <ArrearsActions
        arrearsCase={item.record}
        onUpdate={(data) => updateArrearsMutation.mutate({ id: item.record.id, data })}
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
              <SecondaryButton type="button" onClick={refresh} disabled={!selectedEntityId}>
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
            description={selectedEntity ? selectedEntity.name : "Finding the active entity."}
            icon={<RefreshCw size={17} className="animate-spin text-primary" />}
            actions={<StatusBadge tone="neutral">Loading</StatusBadge>}
            className="border-primary/20 bg-primary/5"
          >
            <div className="grid gap-3 p-4 text-sm text-muted-foreground sm:grid-cols-3">
              <div className="rounded-xl border border-border bg-white px-3 py-2">Queue</div>
              <div className="rounded-xl border border-border bg-white px-3 py-2">Maintenance</div>
              <div className="rounded-xl border border-border bg-white px-3 py-2">Arrears</div>
            </div>
          </SectionPanel>
        ) : null}

        {!selectedEntityId && !operationsLoading ? (
          <SectionPanel>
            <EmptyState
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
                    <span className={cn("text-xs", isActive && "text-primary-foreground/80")}>
                      {tab.description}
                    </span>
                  </button>
                );
              })}
            </div>

            {activeTab === "queue" ? (
              <SectionPanel
                title="Operations queue"
                description={selectedEntity?.name ?? "Current entity"}
                icon={<ClipboardList size={17} className="text-primary" />}
              >
                <div className="divide-y divide-border">
                  {openQueueItems.map((item) => (
                    <div
                      key={item.id}
                      className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
                    >
                      <Link href={item.href} className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{item.title}</span>
                          <StatusBadge tone={item.tone}>{item.chip}</StatusBadge>
                          <StatusBadge tone={queueKindTone(item)}>
                            {queueKindLabel(item)}
                          </StatusBadge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                      </Link>
                      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                        <StatusBadge tone={item.tone}>{queueDateLabel(item)}</StatusBadge>
                        {renderQueueActions(item)}
                      </div>
                    </div>
                  ))}
                  {!operationsLoading && openQueueItems.length === 0 ? (
                    <EmptyState
                      title="No open operational work"
                      description="New document reviews, maintenance jobs, arrears cases, and tenant follow-ups will appear here."
                      action={
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
                    <form onSubmit={submitMaintenance} className="grid gap-3 p-4 md:grid-cols-2">
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
                              priority: event.target.value as MaintenancePriority,
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
                        <span className="font-medium text-foreground">Description</span>
                        <textarea
                          value={maintenanceForm.description}
                          onChange={(event) =>
                            setMaintenanceForm((current) => ({
                              ...current,
                              description: event.target.value,
                            }))
                          }
                          rows={3}
                          className="w-full rounded-xl border border-border bg-white px-3 py-3 text-sm outline-none transition duration-200 ease-leasium focus:border-primary focus:ring-2 focus:ring-primary/15"
                        />
                      </label>
                      <div className="flex flex-wrap gap-2 md:col-span-2">
                        <Button
                          type="submit"
                          disabled={!maintenanceForm.title.trim() || createMaintenanceMutation.isPending}
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
                          setMaintenanceStatus(event.target.value as MaintenanceWorkOrderStatus | "all")
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
                          setMaintenancePriority(event.target.value as MaintenancePriority | "all")
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
                            <span className="font-semibold">{workOrder.title}</span>
                            <StatusBadge tone={maintenanceTone(workOrder)}>
                              {label(workOrder.status)}
                            </StatusBadge>
                            <StatusBadge tone={workOrder.priority === "urgent" ? "danger" : workOrder.priority === "high" ? "warning" : "neutral"}>
                              {label(workOrder.priority)}
                            </StatusBadge>
                            {workOrder.approval_status === "pending" ? (
                              <StatusBadge tone="warning">Approval pending</StatusBadge>
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
                            <span>Requested {formatDateTime(workOrder.requested_at)}</span>
                            {workOrder.contractor_name ? <span>{workOrder.contractor_name}</span> : null}
                            {workOrder.quote_amount_cents ? (
                              <span>{formatMoney(workOrder.quote_amount_cents)}</span>
                            ) : null}
                          </div>
                        </div>
                        <MaintenanceActions
                          workOrder={workOrder}
                          onUpdate={(data) =>
                            updateMaintenanceMutation.mutate({ id: workOrder.id, data })
                          }
                          disabled={updateMaintenanceMutation.isPending}
                        />
                      </div>
                    ))}
                    {!operationsLoading && filteredMaintenance.length === 0 ? (
                      <EmptyState
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
                    <form onSubmit={submitArrears} className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
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
                            value={arrearsForm[key as keyof ArrearsFormState] as string}
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
                              dispute_status: event.target.value as ArrearsDisputeStatus,
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
                              escalation_status: event.target.value as ArrearsEscalationStatus,
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
                        <span className="font-medium text-foreground">Notes</span>
                        <textarea
                          value={arrearsForm.notes}
                          onChange={(event) =>
                            setArrearsForm((current) => ({
                              ...current,
                              notes: event.target.value,
                            }))
                          }
                          rows={3}
                          className="w-full rounded-xl border border-border bg-white px-3 py-3 text-sm outline-none transition duration-200 ease-leasium focus:border-primary focus:ring-2 focus:ring-primary/15"
                        />
                      </label>
                      <div className="flex flex-wrap gap-2 md:col-span-2 xl:col-span-3">
                        <Button
                          type="submit"
                          disabled={!arrearsForm.tenant_id || createArrearsMutation.isPending}
                        >
                          <Plus size={15} />
                          Create arrears case
                        </Button>
                        <SecondaryButton type="button" onClick={() => setArrearsFormOpen(false)}>
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
                        setArrearsStatus(event.target.value as ArrearsCaseStatus | "all")
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
                              {formatMoney(arrearsCase.total_balance_cents, arrearsCase.currency)}
                            </StatusBadge>
                            <StatusBadge tone={arrearsIsOpen(arrearsCase) ? "warning" : "success"}>
                              {label(arrearsCase.status)}
                            </StatusBadge>
                            {arrearsCase.dispute_status !== "none" ? (
                              <StatusBadge tone="danger">
                                {label(arrearsCase.dispute_status)}
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
                            <span>Current {formatMoney(arrearsCase.balance_current_cents)}</span>
                            <span>1-30 {formatMoney(arrearsCase.balance_1_30_cents)}</span>
                            <span>31-60 {formatMoney(arrearsCase.balance_31_60_cents)}</span>
                            <span>61-90 {formatMoney(arrearsCase.balance_61_90_cents)}</span>
                            <span>90+ {formatMoney(arrearsCase.balance_90_plus_cents)}</span>
                          </div>
                        </div>
                        <div className="grid gap-2">
                          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                            <StatusBadge tone={dueRank(arrearsCase.next_reminder_on) <= 0 ? "warning" : "neutral"}>
                              Reminder {dueLabel(arrearsCase.next_reminder_on)}
                            </StatusBadge>
                            <StatusBadge tone={arrearsCase.escalation_status === "none" ? "neutral" : "danger"}>
                              {label(arrearsCase.escalation_status)}
                            </StatusBadge>
                          </div>
                          <ArrearsActions
                            arrearsCase={arrearsCase}
                            onUpdate={(data) =>
                              updateArrearsMutation.mutate({ id: arrearsCase.id, data })
                            }
                            disabled={updateArrearsMutation.isPending}
                          />
                        </div>
                      </div>
                    ))}
                    {!operationsLoading && filteredArrears.length === 0 ? (
                      <EmptyState
                        title="No arrears cases"
                        description="Open balances, disputes, reminder schedules, and escalation work will appear here."
                        action={
                          <SecondaryButton type="button" onClick={() => setArrearsFormOpen(true)}>
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
        <span className="text-sm font-semibold text-muted-foreground">{metricLabel}</span>
        {icon}
      </div>
      <div className="mt-3 text-3xl font-semibold">{value}</div>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function MaintenanceActions({
  workOrder,
  onUpdate,
  disabled,
}: {
  workOrder: MaintenanceWorkOrderRecord;
  onUpdate: (data: Parameters<typeof updateMaintenanceWorkOrder>[1]) => void;
  disabled: boolean;
}) {
  if (!maintenanceIsOpen(workOrder)) {
    return <StatusBadge tone="success">{label(workOrder.status)}</StatusBadge>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 xl:justify-end">
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
      {workOrder.approval_status === "pending" || workOrder.status === "awaiting_approval" ? (
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
      <SecondaryButton
        type="button"
        className="h-9 px-3"
        disabled={disabled}
        onClick={() =>
          onUpdate({ status: "completed", completed_at: new Date().toISOString() })
        }
      >
        <CheckCircle2 size={15} className="text-leasium-success" />
        Complete
      </SecondaryButton>
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
    return <StatusBadge tone="success">{label(arrearsCase.status)}</StatusBadge>;
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
        <CheckCircle2 size={15} className="text-leasium-success" />
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
