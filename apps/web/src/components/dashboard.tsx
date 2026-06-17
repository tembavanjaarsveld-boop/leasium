"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Copy,
  Download,
  FileText,
  FileUp,
  Layers3,
  Loader2,
  ReceiptText,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { EntityPicker } from "@/components/entity-picker";
import { ActivityFeedPanel } from "@/components/dashboard/ActivityFeedPanel";
import { AskLeasiumPanel } from "@/components/dashboard/AskLeasiumPanel";
import { CompliancePanel } from "@/components/dashboard/CompliancePanel";
import {
  type CommandCenterCounts,
  type CommandCenterItem,
  DashboardCommandCenter,
} from "@/components/dashboard/DashboardCommandCenter";
import { UpcomingLeaseEventsPanel } from "@/components/dashboard/UpcomingLeaseEventsPanel";
import { RegisterImportPanel } from "@/app/intake/register-import-panel";
import { IntakeConversationPanel } from "@/components/intake/IntakeConversationPanel";
import { csvCell } from "@/lib/csv";
import { saveBlob } from "@/lib/download";
import {
  ENTITY_STORAGE_KEY,
  ENTITY_CHANGED_EVENT,
  defaultEntitySelection,
  isAllEntities,
  scopeEntityId,
} from "@/lib/entity-selection";
import { useEntityFanOut } from "@/lib/use-entity-fan-out";
import { cn, friendlyError } from "@/lib/utils";
import {
  EvidenceSourceTrail,
  type EvidenceFieldChange,
  type EvidenceHistoryRow,
  type EvidenceSourceLocation,
} from "@/components/evidence-drawer";
import {
  Button,
  EmptyState,
  PageTitle,
  SecondaryButton,
  SectionPanel,
  Select,
  SkeletonRows,
  StatusBadge,
  type StatusTone,
} from "@/components/ui";
import {
  askLeasium,
  type AskCitationRecord,
  createConversationThread,
  createDocumentIntake,
  deleteDocumentIntake,
  getConversationThread,
  getDashboardOverview,
  DocumentIntakeExtraction,
  DocumentIntakeRecord,
  listEntities,
  listDocumentIntakes,
  listObligations,
  listProperties,
  getInsightsOverview,
  type InsightsOverviewRecord,
  listRentRoll,
  listTenantOnboardings,
  listTenants,
  type DashboardOverviewRecord,
  ObligationRecord,
  RentRollRow,
  TenantOnboardingRecord,
} from "@/lib/api";

const DEMO_MODE_STORAGE_KEY = "leasium.demo_mode";
type ReviewItemAction = "approve" | "edit" | "ignore";
type ReviewApplyTarget = {
  propertyId: string;
  tenancyUnitId: string;
  tenantId: string;
  leaseId: string;
};

function queryRecordRefs(search: URLSearchParams): Record<string, unknown> {
  const raw = search.get("context_record_refs");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

type ReviewQueueFilter =
  | "all"
  | "tenant_portal"
  | "inbound_email_attachment"
  | "lease_match"
  | "insurance_certificate"
  | "inspection_report"
  | "lease";

function initialSelectedEntityId(mode: "dashboard" | "intake") {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  const requestedEntityId = mode === "intake" ? params.get("entity_id") : null;
  const stored = window.localStorage.getItem(ENTITY_STORAGE_KEY) ?? "";
  // Intake is a single-entity document-review flow: never seed it from the
  // all-entities sentinel. Dashboard mode treats the sentinel as a valid value.
  const resolvedStored =
    mode === "intake" && isAllEntities(stored) ? "" : stored;
  return requestedEntityId ?? resolvedStored;
}
type LeaseAutoMatchField = {
  field: string;
  current: unknown;
  extracted: unknown;
};
type LeaseAutoMatchRecommendation = {
  status: string;
  leaseId: string | null;
  matchedFields: LeaseAutoMatchField[];
  differences: LeaseAutoMatchField[];
  missingFields: string[];
  guardrail: string | null;
};
type AppliedPropertySource = {
  sourceHint: string | null;
  citation: string | null;
  confidence: number | null;
};
type AppliedPropertyChange = {
  field: string;
  before: unknown;
  after: unknown;
  source: AppliedPropertySource | null;
};
type AppliedScheduleRowSkip = {
  unitLabel: string | null;
  tenantName: string | null;
  blockers: string[];
};
type AppliedChargeRuleSummary = {
  id: string;
  leaseId: string | null;
  chargeType: string;
  amountCents: number | null;
  frequency: string | null;
  label: string | null;
  sourceHint: string | null;
};
type DocumentApplyOutcome = {
  documentName: string;
  workflowType: string | null;
  obligationCount: number;
  billingDraftCount?: number;
  billingDraftId?: string | null;
  leaseCount?: number;
  leaseIds?: string[];
  workOrderCount?: number;
  workOrderIds?: string[];
  chargeRuleCount?: number;
  chargeRuleIds?: string[];
  chargeRuleSummaries?: AppliedChargeRuleSummary[];
  skippedTenancyScheduleRows?: AppliedScheduleRowSkip[];
  propertyChanges?: AppliedPropertyChange[];
  targetLabel: string;
  dueDate: string | null;
  ignoredCount: number;
  appliedAt?: string | null;
  appliedBy?: string | null;
};

const propertyFieldLabels: Record<string, string> = {
  name: "Property name",
  street_address: "Street address",
  suburb: "Suburb",
  state: "State",
  postcode: "Postcode",
  parcel_id: "Parcel ID",
  land_sqm: "Land area",
  building_sqm: "Building area",
  parking_spaces: "Parking",
  ownership_structure: "Ownership path",
  owner_legal_name: "Owner",
  owner_abn: "Owner ABN",
  trustee_name: "Trustee",
  trust_name: "Trust",
  invoice_issuer_name: "Invoice issuer",
  billing_contact_name: "Billing contact",
  billing_email: "Billing email",
  invoice_reference: "Invoice reference",
  ownership_split: "Ownership split",
  owner_gst_registered: "Owner GST registered",
  xero_contact_id: "Xero contact",
  xero_tracking_category: "Xero tracking",
};

function dateOnly(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return dateOnly(date);
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  const dateValue = value.length === 10 ? `${value}T00:00:00` : value;
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(dateValue));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatCompactDate(value: string | null | undefined) {
  if (!value) {
    return "No date";
  }
  const dateValue = value.length === 10 ? `${value}T00:00:00` : value;
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
  }).format(new Date(dateValue));
}

function formatDashboardTodayLabel() {
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    day: "2-digit",
    month: "long",
    timeZone: "Australia/Brisbane",
  }).format(new Date());
}

function formatMoney(cents: number | null | undefined) {
  if (cents === null || cents === undefined) {
    return "-";
  }
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
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
  return formatDate(value);
}

function urgencyWeight(value: string | null | undefined) {
  const days = dueRank(value);
  if (days < 0) {
    return 0;
  }
  if (days === 0) {
    return 1;
  }
  if (days <= 7) {
    return 2;
  }
  if (days <= 14) {
    return 4;
  }
  if (days <= 30) {
    return 7;
  }
  return 10;
}

function obligationTone(obligation: ObligationRecord): StatusTone {
  const days = dueRank(obligation.due_date);
  if (days < 0) {
    return "danger";
  }
  if (days <= 14 || obligation.priority <= 1) {
    return "warning";
  }
  return "neutral";
}

function commandCenterSort(a: CommandCenterItem, b: CommandCenterItem) {
  const scoreDelta = a.score - b.score;
  if (scoreDelta !== 0) {
    return scoreDelta;
  }
  const dateDelta = dueRank(a.date) - dueRank(b.date);
  if (dateDelta !== 0) {
    return dateDelta;
  }
  return a.title.localeCompare(b.title);
}

function blockers(row: RentRollRow) {
  return [
    ...(row.invoice_readiness_blockers ?? []),
    ...(row.xero_readiness_blockers ?? []),
    ...(row.gst_readiness_blockers ?? []),
  ].filter(Boolean);
}

function intakeStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "uploaded":
      return "Uploaded";
    case "reading":
      return "Reading";
    case "ready_for_review":
      return "Needs review";
    case "needs_attention":
      return "Needs match";
    case "applied":
      return "Applied";
    case "failed":
      return "Could not read";
    default:
      return "Review";
  }
}

function intakeStatusTone(status: string | null | undefined): StatusTone {
  switch (status) {
    case "ready_for_review":
      return "primary";
    case "needs_attention":
      return "warning";
    case "applied":
      return "success";
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}

function intakeStatusRailClassName(status: string | null | undefined) {
  switch (status) {
    case "needs_attention":
      return "bg-warning";
    case "failed":
      return "bg-danger";
    case "ready_for_review":
    case "applied":
      return "bg-accent";
    default:
      return "bg-info";
  }
}

function documentTypeLabel(value: string | null | undefined) {
  if (!value) {
    return "Document";
  }
  return value.replaceAll("_", " ");
}

function confidenceLabel(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "Check details";
  }
  if (value >= 0.8) {
    return "High confidence";
  }
  if (value >= 0.55) {
    return "Check match";
  }
  return "Needs review";
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function overviewStatusCount(
  counts: Record<string, number> | null | undefined,
  statuses: string[],
) {
  return statuses.reduce((total, status) => total + (counts?.[status] ?? 0), 0);
}

function fieldText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function fieldNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fieldTextList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const text = fieldText(item);
    return text ? [text] : [];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function leaseAutoMatchField(value: unknown): LeaseAutoMatchField | null {
  if (!isRecord(value)) {
    return null;
  }
  const field = fieldText(value.field);
  if (!field) {
    return null;
  }
  return {
    field,
    current: value.current,
    extracted: value.extracted,
  };
}

function leaseAutoMatchRecommendation(
  data: DocumentIntakeExtraction,
): LeaseAutoMatchRecommendation | null {
  if (!isRecord(data.lease_auto_match)) {
    return null;
  }
  const match = data.lease_auto_match;
  return {
    status: fieldText(match.status) ?? "needs_review",
    leaseId: fieldText(match.lease_id),
    matchedFields: Array.isArray(match.matched_fields)
      ? match.matched_fields.flatMap((item) => {
          const field = leaseAutoMatchField(item);
          return field ? [field] : [];
        })
      : [],
    differences: Array.isArray(match.differences)
      ? match.differences.flatMap((item) => {
          const field = leaseAutoMatchField(item);
          return field ? [field] : [];
        })
      : [],
    missingFields: fieldTextList(match.missing_fields),
    guardrail: fieldText(match.guardrail),
  };
}

function propertyFieldLabel(field: string) {
  return (
    propertyFieldLabels[field] ??
    field
      .split("_")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function propertyEvidenceSourceLocation(
  source: AppliedPropertySource | null | undefined,
): EvidenceSourceLocation | null {
  if (!source) {
    return null;
  }
  const label = source.sourceHint ?? source.citation;
  if (!label) {
    return null;
  }
  return {
    label,
    detail: source.sourceHint && source.citation ? source.citation : undefined,
  };
}

function propertyEvidenceChanges(
  changes: AppliedPropertyChange[] | null | undefined,
): EvidenceFieldChange[] {
  return (changes ?? []).map((change, index) => ({
    id: `${change.field}-${index}`,
    field: change.field,
    label: propertyFieldLabel(change.field),
    before: change.before,
    after: change.after,
    sourceLocation: propertyEvidenceSourceLocation(change.source),
    confidence: change.source?.confidence,
  }));
}

function propertyEvidenceConfidence(
  changes: AppliedPropertyChange[] | null | undefined,
) {
  return changes?.find(
    (change) => typeof change.source?.confidence === "number",
  )?.source?.confidence;
}

function propertyEvidenceHistory(
  outcome: DocumentApplyOutcome,
): EvidenceHistoryRow[] {
  const changeCount = outcome.propertyChanges?.length ?? 0;
  if (changeCount === 0) {
    return [];
  }
  return [
    {
      id: "smart-intake-property-apply",
      label: "Applied after Smart Intake review",
      description: `${changeCount} reviewed property field ${
        changeCount === 1 ? "change was" : "changes were"
      } recorded from the acquisition source. This evidence view is read-only.`,
      actor: outcome.appliedBy ?? undefined,
      occurredAt: outcome.appliedAt ?? undefined,
      tone: "success",
    },
  ];
}

function shortRecordId(value: string) {
  return value.slice(0, 8);
}

function chargeTypeLabel(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function chargeSummaryCaption(summary: AppliedChargeRuleSummary) {
  const amount = formatMoney(summary.amountCents);
  const frequency = summary.frequency ? ` ${summary.frequency}` : "";
  const source = summary.sourceHint ? ` - ${summary.sourceHint}` : "";
  return `${amount}${frequency}${source}`;
}

function firstField(
  items: Array<Record<string, unknown>> | null | undefined,
  key: string,
) {
  return fieldText(items?.[0]?.[key]);
}

function recordList(items: Array<Record<string, unknown>> | null | undefined) {
  return Array.isArray(items) ? items.slice(0, 4) : [];
}

function intakeIsActive(item: DocumentIntakeRecord) {
  return item.status === "uploaded" || item.status === "reading";
}

function demoIntake(createdAt: string): DocumentIntakeRecord {
  return {
    id: "demo-intake-lease",
    entity_id: "demo-entity",
    document_id: "demo-document",
    status: "ready_for_review",
    document_type: "lease",
    summary:
      "Lease for Queen Street Retail Centre with rent review, option notice, and billing setup items.",
    confidence: 0.88,
    extracted_data: {
      document_type: "lease",
      summary: "Lease terms extracted for review.",
      confidence: 0.88,
      parties: [{ name: "Acme Retail Pty Ltd", role: "tenant" }],
      properties: [
        { name: "Queen Street Retail Centre", unit_label: "Shop 3" },
      ],
      key_dates: [{ label: "Rent review", date: "2026-06-30" }],
      money_amounts: [
        { label: "Annual rent", amount: 126000, currency: "AUD" },
      ],
      obligations: [],
      suggested_links: { tenant_name: "Acme Retail Pty Ltd" },
      warnings: [],
      missing_information: [],
    },
    review_data: {},
    openai_response_id: null,
    error_message: null,
    reviewed_at: null,
    reviewed_by_user_id: null,
    applied_at: null,
    applied_by_user_id: null,
    created_at: createdAt,
    updated_at: createdAt,
    filename: "acme-retail-lease.pdf",
    content_type: "application/pdf",
    byte_size: 840_000,
    category: "lease",
  };
}

function demoObligations(): ObligationRecord[] {
  return [
    {
      id: "demo-obligation-insurance",
      entity_id: "demo-entity",
      property_id: "demo-property-queen",
      tenancy_unit_id: "demo-unit-shop-3",
      lease_id: "demo-lease-acme",
      title: "Insurance certificate overdue",
      category: "insurance_certificate",
      status: "open",
      due_date: addDays(-2),
      completed_at: null,
      priority: 1,
      owner_role: "tenant",
      notes: "Waiting on Acme Retail to upload current cover.",
      metadata: { demo: true },
    },
    {
      id: "demo-obligation-rent-review",
      entity_id: "demo-entity",
      property_id: "demo-property-queen",
      tenancy_unit_id: "demo-unit-shop-1",
      lease_id: "demo-lease-north",
      title: "Annual CPI rent review",
      category: "rent_review",
      status: "open",
      due_date: addDays(7),
      completed_at: null,
      priority: 1,
      owner_role: "manager",
      notes: "Prepare notice before the invoice run.",
      metadata: { demo: true },
    },
    {
      id: "demo-obligation-option",
      entity_id: "demo-entity",
      property_id: "demo-property-queen",
      tenancy_unit_id: "demo-unit-shop-4",
      lease_id: "demo-lease-coffee",
      title: "Option notice window check",
      category: "option_notice",
      status: "open",
      due_date: addDays(28),
      completed_at: null,
      priority: 2,
      owner_role: "manager",
      notes: "Confirm notice dates against lease clause 12.",
      metadata: { demo: true },
    },
  ];
}

function demoRentRoll(): RentRollRow[] {
  return [
    {
      entity_id: "demo-entity",
      entity_name: "Demo portfolio",
      property_id: "demo-property-queen",
      property_name: "Queen Street Retail Centre",
      tenancy_unit_id: "demo-unit-shop-3",
      unit_label: "Shop 3",
      lease_id: "demo-lease-acme",
      tenant_id: "demo-tenant-acme",
      tenant_name: "Acme Retail Pty Ltd",
      lease_status: "active",
      commencement_date: "2025-07-01",
      expiry_date: "2028-06-30",
      tenant_billing_email: null,
      annual_rent_cents: 126_000_00,
      rent_frequency: "monthly",
      charge_rules: [],
      charge_rules_total_cents: 10_500_00,
      next_due_date: addDays(12),
      gst_readiness_blockers: [],
      xero_readiness_blockers: ["Xero customer mapping missing"],
      invoice_readiness_blockers: ["Tenant billing email missing"],
    },
    {
      entity_id: "demo-entity",
      entity_name: "Demo portfolio",
      property_id: "demo-property-queen",
      property_name: "Queen Street Retail Centre",
      tenancy_unit_id: "demo-unit-shop-1",
      unit_label: "Shop 1",
      lease_id: "demo-lease-north",
      tenant_id: "demo-tenant-north",
      tenant_name: "Northlake Health Pty Ltd",
      lease_status: "active",
      commencement_date: "2024-01-01",
      expiry_date: "2028-12-31",
      tenant_billing_email: "accounts@northlake.example",
      annual_rent_cents: 180_000_00,
      rent_frequency: "annual",
      charge_rules: [],
      charge_rules_total_cents: 180_000_00,
      next_due_date: addDays(20),
      gst_readiness_blockers: ["GST treatment missing on outgoings rule"],
      xero_readiness_blockers: [],
      invoice_readiness_blockers: [],
    },
  ];
}

function demoOnboardings(createdAt: string): TenantOnboardingRecord[] {
  return [
    {
      id: "demo-onboarding-sent",
      entity_id: "demo-entity",
      lease_id: "demo-lease-acme",
      tenant_id: "demo-tenant-acme",
      token: "demo-sent",
      status: "sent",
      due_date: addDays(3),
      expires_at: addDays(14),
      last_sent_at: createdAt,
      resent_at: null,
      cancel_reason: null,
      onboarding_url: "/onboarding/demo-sent",
      portal_url: "/tenant-portal/demo-sent",
      submitted_data: {},
      submitted_at: null,
      review_data: {},
      delivery_data: {
        channels: {
          email: { channel: "email", status: "queued", provider: "sendgrid" },
          sms: { channel: "sms", status: "skipped", provider: "twilio" },
        },
      },
      reviewed_at: null,
      reviewed_by_user_id: null,
      applied_at: null,
      applied_by_user_id: null,
      created_at: createdAt,
      updated_at: createdAt,
      deleted_at: null,
    },
    {
      id: "demo-onboarding-submitted",
      entity_id: "demo-entity",
      lease_id: "demo-lease-coffee",
      tenant_id: "demo-tenant-coffee",
      token: "demo-submitted",
      status: "submitted",
      due_date: addDays(5),
      expires_at: addDays(14),
      last_sent_at: createdAt,
      resent_at: null,
      cancel_reason: null,
      onboarding_url: "/onboarding/demo-submitted",
      portal_url: "/tenant-portal/demo-submitted",
      submitted_data: {},
      submitted_at: createdAt,
      review_data: {},
      delivery_data: {
        channels: {
          email: { channel: "email", status: "queued", provider: "sendgrid" },
          sms: { channel: "sms", status: "queued", provider: "twilio" },
        },
      },
      reviewed_at: null,
      reviewed_by_user_id: null,
      applied_at: null,
      applied_by_user_id: null,
      created_at: createdAt,
      updated_at: createdAt,
      deleted_at: null,
    },
  ];
}

type ReviewGroupKey =
  | "parties"
  | "properties"
  | "key_dates"
  | "money_amounts"
  | "obligations"
  | "inspection_findings";

function intakeReviewData(
  intake: DocumentIntakeRecord,
): DocumentIntakeExtraction {
  const extractionKeys = [
    "document_type",
    "summary",
    "confidence",
    "parties",
    "properties",
    "key_dates",
    "money_amounts",
    "obligations",
    "inspection_findings",
    "suggested_links",
    "warnings",
    "missing_information",
    "lease_auto_match",
  ];
  const hasReviewedExtraction = extractionKeys.some(
    (key) => key in intake.review_data,
  );
  return hasReviewedExtraction
    ? (intake.review_data as DocumentIntakeExtraction)
    : intake.extracted_data;
}

function intakeSourceInfo(intake: DocumentIntakeRecord) {
  const reviewData = intake.review_data;
  const source = fieldText(reviewData.source);
  const candidate = fieldText(reviewData.candidate);
  const guardrail = fieldText(reviewData.guardrail);
  if (source === "tenant_portal") {
    const candidateDetail =
      candidate === "tenant_uploaded_insurance_auto_update"
        ? "Tenant-uploaded insurance review"
        : candidate === "tenant_uploaded_lease_auto_match"
          ? "Tenant-uploaded lease match review"
          : "Tenant-uploaded document review";
    return {
      label: "Tenant portal upload",
      detail: candidateDetail,
      guardrail,
    };
  }
  if (
    source !== "sendgrid_inbound_parse" &&
    candidate !== "inbound_email_attachment"
  ) {
    return null;
  }

  const subject = fieldText(reviewData.inbound_subject);
  const sender = fieldText(reviewData.inbound_sender);
  const receivedRaw = fieldText(reviewData.inbound_received_at);
  const received = receivedRaw
    ? new Date(receivedRaw).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";
  const detailParts = [
    sender ? `From ${sender}` : "",
    subject ? `Subject: ${subject}` : "",
    received ? `Received ${received}` : "",
  ].filter(Boolean);
  return {
    label: "Inbound email attachment",
    detail: detailParts.length > 0 ? detailParts.join(" · ") : "Routed from tenant email",
    guardrail,
  };
}

function intakeReviewFilterMatch(
  intake: DocumentIntakeRecord,
  filter: ReviewQueueFilter,
) {
  if (filter === "all") {
    return true;
  }
  const reviewData = intake.review_data;
  const source = fieldText(reviewData.source);
  const candidate = fieldText(reviewData.candidate);
  if (filter === "tenant_portal") {
    return source === "tenant_portal";
  }
  if (filter === "inbound_email_attachment") {
    return (
      source === "sendgrid_inbound_parse" ||
      candidate === "inbound_email_attachment"
    );
  }
  if (filter === "lease_match") {
    return leaseAutoMatchRecommendation(intakeReviewData(intake)) !== null;
  }
  return intake.document_type === filter;
}

function smartIntakeReviewQueueCsv(intakes: DocumentIntakeRecord[]) {
  const rows: Array<Array<string | number | null | undefined>> = [
    [
      "Filename",
      "Status",
      "Document type",
      "Source",
      "Source detail",
      "Confidence",
      "Summary",
      "Created",
      "Review URL",
    ],
    ...intakes.map((intake) => {
      const sourceInfo = intakeSourceInfo(intake);
      return [
        intake.filename,
        intakeStatusLabel(intake.status),
        documentTypeLabel(intake.document_type),
        sourceInfo?.label ?? "",
        sourceInfo?.detail ?? "",
        confidenceLabel(intake.confidence),
        intake.summary,
        formatDateTime(intake.created_at),
        intakeReviewHref(intake.entity_id, intake.id),
      ];
    }),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function smartIntakeAppliedChips(intake: DocumentIntakeRecord) {
  const reviewData = intake.review_data;
  const applied = isRecord(reviewData.applied) ? reviewData.applied : {};
  const chips: string[] = [];
  const obligationCount =
    fieldNumber(applied.obligation_count) ??
    (fieldText(applied.obligation_id) ? 1 : null);
  const billingDraftCount = fieldNumber(applied.billing_draft_count);
  const leaseCount = fieldNumber(applied.created_lease_count);
  const chargeRuleCount = fieldNumber(applied.created_charge_rule_count);
  const workOrderCount = fieldNumber(applied.work_order_count);

  if (billingDraftCount) {
    chips.push(countLabel(billingDraftCount, "invoice draft"));
  }
  if (obligationCount) {
    chips.push(countLabel(obligationCount, "obligation"));
  }
  if (leaseCount) {
    chips.push(countLabel(leaseCount, "lease update"));
  }
  if (chargeRuleCount) {
    chips.push(countLabel(chargeRuleCount, "charge rule"));
  }
  if (workOrderCount) {
    chips.push(countLabel(workOrderCount, "task"));
  }

  if (chips.length === 0) {
    if (intake.document_type === "insurance_certificate") {
      chips.push("1 obligation");
    } else if (intake.document_type === "lease") {
      chips.push("1 lease update");
    } else if (intake.document_type === "inspection_report") {
      chips.push("1 task");
    } else {
      chips.push(documentTypeLabel(intake.document_type));
    }
  }

  return chips.slice(0, 3);
}

function intakeReviewHref(entityId: string, intakeId: string) {
  const params = new URLSearchParams({
    entity_id: entityId,
    review: intakeId,
  });
  return `/intake?${params.toString()}`;
}

function workflowTaskNoun(workflowType: string | null) {
  switch (workflowType) {
    case "invoice_admin":
      return "billing review task";
    case "purchase_contract":
      return "contract milestone task";
    case "bank_guarantee":
      return "guarantee task";
    case "compliance":
      return "compliance task";
    case "inspection_report":
      return "work order draft";
    case "notice":
      return "notice task";
    default:
      return "document-driven task";
  }
}

function DocumentIntakeApplyOutcomeCard({
  outcome,
  onDismiss,
}: {
  outcome: DocumentApplyOutcome;
  onDismiss: () => void;
}) {
  const isBilling = outcome.workflowType === "invoice_admin";
  const isPropertySetup = outcome.workflowType === "purchase_contract";
  const isInspection = outcome.workflowType === "inspection_report";
  const taskNoun = workflowTaskNoun(outcome.workflowType);
  const shownLeaseIds = outcome.leaseIds?.slice(0, 4) ?? [];
  const shownWorkOrderIds = outcome.workOrderIds?.slice(0, 4) ?? [];
  const shownChargeSummaries = outcome.chargeRuleSummaries?.slice(0, 5) ?? [];
  const shownChargeIds = outcome.chargeRuleIds?.slice(0, 4) ?? [];
  const skippedScheduleRows = outcome.skippedTenancyScheduleRows ?? [];
  const propertyEvidenceChangeRows = propertyEvidenceChanges(
    outcome.propertyChanges,
  );
  return (
    <SectionPanel
      title={isBilling ? "Prepared for billing" : "Applied to portfolio"}
      description={
        isBilling
          ? "Review-first billing work. Nothing was invoiced or synced."
          : "Review-first automation outcome"
      }
      icon={<Check size={17} className="text-success" />}
      actions={<StatusBadge tone="success">Applied</StatusBadge>}
    >
      <div className="grid gap-4 p-4">
        <div className="grid gap-3 rounded-2xl border border-success/20 bg-success-soft p-3 text-sm">
          <div className="font-semibold text-success-strong">
            {outcome.workflowType === "lease"
              ? `Created lease register records and ${outcome.obligationCount} ${
                  outcome.obligationCount === 1 ? "task" : "tasks"
                }.`
              : isPropertySetup
                ? `Applied property records and ${outcome.obligationCount} ${
                    outcome.obligationCount === 1
                      ? "milestone task"
                      : "milestone tasks"
                  }.`
                : isBilling
                  ? `Prepared ${outcome.obligationCount} billing review ${
                      outcome.obligationCount === 1 ? "task" : "tasks"
                    }. Nothing was posted to Xero.`
                  : isInspection
                    ? `Created ${outcome.workOrderCount ?? outcome.obligationCount} requested work order${
                        (outcome.workOrderCount ?? outcome.obligationCount) ===
                        1
                          ? ""
                          : "s"
                      }. No contractor message was sent.`
                    : `Created ${outcome.obligationCount} ${taskNoun}${
                        outcome.obligationCount === 1 ? "" : "s"
                      }.`}
          </div>
          <div className="grid gap-2 text-foreground sm:grid-cols-2">
            <div>
              <div className="text-xs font-semibold uppercase text-muted-foreground">
                Target
              </div>
              <div>{outcome.targetLabel}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-muted-foreground">
                First due date
              </div>
              <div>{formatDate(outcome.dueDate)}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-muted-foreground">
                Source document
              </div>
              <div>{outcome.documentName}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-muted-foreground">
                Ignored
              </div>
              <div>
                {outcome.ignoredCount}{" "}
                {outcome.ignoredCount === 1 ? "item was" : "items were"} left
                out.
              </div>
            </div>
            {isBilling ? (
              <div>
                <div className="text-xs font-semibold uppercase text-muted-foreground">
                  Billing draft
                </div>
                <div>
                  {outcome.billingDraftCount
                    ? `${outcome.billingDraftCount} draft${
                        outcome.billingDraftCount === 1 ? "" : "s"
                      } waiting for review`
                    : "No draft created"}
                </div>
              </div>
            ) : null}
            {isPropertySetup ? (
              <>
                <div>
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    Pending leases
                  </div>
                  <div>{outcome.leaseCount ?? 0}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    Draft charges
                  </div>
                  <div>{outcome.chargeRuleCount ?? 0}</div>
                </div>
              </>
            ) : null}
            {isInspection ? (
              <div>
                <div className="text-xs font-semibold uppercase text-muted-foreground">
                  Work orders
                </div>
                <div>
                  {outcome.workOrderCount ?? outcome.obligationCount} requested
                  work order
                  {(outcome.workOrderCount ?? outcome.obligationCount) === 1
                    ? ""
                    : "s"}{" "}
                  ready in Operations
                </div>
              </div>
            ) : null}
          </div>
          {isInspection ? (
            <div className="grid gap-3 border-t border-success/20 pt-3">
              {shownWorkOrderIds.length ? (
                <div>
                  <div className="text-xs font-semibold uppercase text-success-strong">
                    Created work orders
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {shownWorkOrderIds.map((workOrderId) => (
                      <span
                        key={workOrderId}
                        className="rounded-full border border-success/20 bg-white px-2 py-1"
                      >
                        {shortRecordId(workOrderId)}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="rounded-xl border border-success/20 bg-white px-3 py-2 text-sm text-success-strong">
                No contractor email, SMS, assignment notification, billing
                draft, Xero action, or provider history was created.
              </div>
              <div>
                <Link
                  href="/operations?tab=maintenance"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-success/20 bg-white px-3 text-sm font-medium text-success-strong transition hover:bg-success-soft"
                >
                  <ClipboardList size={15} />
                  Open Operations
                </Link>
              </div>
            </div>
          ) : null}
          {isPropertySetup &&
          (shownLeaseIds.length > 0 ||
            shownChargeSummaries.length > 0 ||
            shownChargeIds.length > 0 ||
            skippedScheduleRows.length > 0) ? (
            <div className="grid gap-3 border-t border-success/20 pt-3">
              {shownLeaseIds.length > 0 ? (
                <div>
                  <div className="text-xs font-semibold uppercase text-success-strong">
                    Created pending leases
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {shownLeaseIds.map((leaseId) => (
                      <span
                        key={leaseId}
                        className="rounded-full border border-success/20 bg-white px-2 py-1"
                      >
                        {shortRecordId(leaseId)}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {shownChargeSummaries.length > 0 ? (
                <div>
                  <div className="text-xs font-semibold uppercase text-success-strong">
                    Draft charges prepared
                  </div>
                  <div className="mt-2 grid gap-2">
                    {shownChargeSummaries.map((summary) => (
                      <div
                        key={summary.id}
                        className="grid gap-0.5 text-xs text-muted-foreground sm:grid-cols-[minmax(8rem,12rem)_1fr]"
                      >
                        <span className="font-medium text-foreground">
                          {summary.label ?? chargeTypeLabel(summary.chargeType)}
                        </span>
                        <span>{chargeSummaryCaption(summary)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : shownChargeIds.length > 0 ? (
                <div>
                  <div className="text-xs font-semibold uppercase text-success-strong">
                    Draft charge rules
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {shownChargeIds.map((chargeRuleId) => (
                      <span
                        key={chargeRuleId}
                        className="rounded-full border border-success/20 bg-white px-2 py-1"
                      >
                        {shortRecordId(chargeRuleId)}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {skippedScheduleRows.length > 0 ? (
                <div>
                  <div className="text-xs font-semibold uppercase text-success-strong">
                    Schedule rows needing review
                  </div>
                  <div className="mt-2 grid gap-2">
                    {skippedScheduleRows.slice(0, 3).map((row, index) => (
                      <div
                        key={`${row.unitLabel ?? "unit"}-${index}`}
                        className="grid gap-1 text-xs text-muted-foreground"
                      >
                        <div className="font-medium text-foreground">
                          {[row.unitLabel, row.tenantName]
                            .filter(Boolean)
                            .join(" - ") || "Schedule row"}
                        </div>
                        <div>{row.blockers.join(" ")}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {isPropertySetup && propertyEvidenceChangeRows.length ? (
          <EvidenceSourceTrail
            title="Property evidence trail"
            description="Review-first property changes from the acquisition source. This display is read-only and does not apply additional changes."
            sourceDocument={{
              label: outcome.documentName,
              detail: "Purchase contract",
            }}
            confidence={propertyEvidenceConfidence(outcome.propertyChanges)}
            appliedAt={outcome.appliedAt}
            appliedBy={outcome.appliedBy}
            changes={propertyEvidenceChangeRows}
            history={propertyEvidenceHistory(outcome)}
            className="border-success/20 shadow-none"
          />
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <SecondaryButton type="button" onClick={onDismiss}>
            Back to Smart Intake
          </SecondaryButton>
          {outcome.workflowType === "lease" ? (
            <Link
              href="/properties"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-white px-4 text-sm font-semibold text-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
            >
              Open Properties
            </Link>
          ) : null}
          {isPropertySetup ? (
            <Link
              href="/properties"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-white px-4 text-sm font-semibold text-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
            >
              Open Properties
            </Link>
          ) : null}
          {isBilling ? (
            <Link
              href="/billing-readiness"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-white px-4 text-sm font-semibold text-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
            >
              Open Billing Readiness
            </Link>
          ) : null}
          <Link
            href="/operations"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-transparent bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-primary-hover"
          >
            View Operations
          </Link>
        </div>
      </div>
    </SectionPanel>
  );
}

type HorizonDashboardEvent = {
  id: string;
  title: string;
  detail: string;
  date: string | null;
  href: string;
  tone: StatusTone;
};

function eventToneFromDueDate(date: string | null): StatusTone {
  const days = dueRank(date);
  if (days < 0) {
    return "danger";
  }
  if (days <= 14) {
    return "warning";
  }
  return "primary";
}

function compactEntityDetail(parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(" · ");
}

function dashboardCardLabelId(label: string) {
  return `dashboard-bento-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function DashboardBentoCard({
  label,
  icon,
  href,
  children,
  dashed = false,
  className = "",
}: {
  label: string;
  icon: ReactNode;
  href?: string;
  children: ReactNode;
  dashed?: boolean;
  className?: string;
}) {
  const labelId = dashboardCardLabelId(label);
  const cardClass = [
    "group flex min-h-[98px] flex-col overflow-hidden rounded-[14px] border bg-white p-3 shadow-[0_1px_3px_rgba(16,24,40,0.04)] transition duration-200 ease-leasium sm:min-h-[128px] sm:rounded-[18px] sm:p-[18px]",
    dashed
      ? "border-dashed border-primary/70 hover:border-primary"
      : "border-leasium-card-border hover:border-primary/40 hover:shadow-leasiumMd",
    className,
  ].join(" ");
  const content = (
    <>
      <div className="flex items-center justify-between gap-3">
        <span
          id={labelId}
          className="text-leasium-micro font-semibold uppercase tracking-[0.04em] text-muted-foreground"
        >
          {label}
        </span>
        <span className="hidden h-7 w-7 place-items-center rounded-lg text-leasium-slate-400 transition group-hover:bg-primary-soft group-hover:text-primary sm:grid">
          {icon}
        </span>
      </div>
      <div className="mt-2 flex flex-1 flex-col sm:mt-3">{children}</div>
    </>
  );

  if (href) {
    return (
      <Link href={href} aria-labelledby={labelId} className={cardClass}>
        {content}
      </Link>
    );
  }

  return (
    <section aria-labelledby={labelId} className={cardClass}>
      {content}
    </section>
  );
}

function DashboardOccupancyRing({ percent }: { percent: number }) {
  return (
    <div
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full sm:h-[54px] sm:w-[54px]"
      aria-label={`${percent}% occupied`}
      style={{
        background: `conic-gradient(var(--leasium-teal) ${percent}%, var(--leasium-slate-150) 0)`,
      }}
    >
      <div className="grid h-8 w-8 place-items-center rounded-full bg-white text-[0px] font-bold text-foreground sm:h-[40px] sm:w-[40px] sm:text-[11px]">
        {percent}%
      </div>
    </div>
  );
}

function DashboardSegmentBar({
  segments,
}: {
  segments: Array<{ label: string; value: number; className: string }>;
}) {
  const hasSignal = segments.some((segment) => segment.value > 0);
  return (
    <div className="flex h-2 w-full max-w-[220px] gap-[3px] overflow-hidden rounded-full">
      {hasSignal ? (
        segments.map((segment) =>
          segment.value > 0 ? (
            <span
              key={segment.label}
              aria-label={`${segment.label}: ${segment.value}`}
              className={`h-full rounded-full ${segment.className}`}
              style={{ flexGrow: segment.value, flexBasis: 0 }}
            />
          ) : null,
        )
      ) : (
        <span
          aria-hidden="true"
          className="h-full rounded-full bg-leasium-slate-150"
          style={{ flexGrow: 1, flexBasis: 0 }}
        />
      )}
    </div>
  );
}

function DashboardLeaseHorizon({
  events,
  loading,
  className,
}: {
  events: HorizonDashboardEvent[];
  loading: boolean;
  className?: string;
}) {
  return (
    <section
      aria-labelledby="dashboard-lease-horizon"
      data-testid="dashboard-mobile-horizon"
      className={cn(
        "rounded-[14px] border border-leasium-card-border bg-white p-3 shadow-[0_1px_3px_rgba(16,24,40,0.04)] sm:min-h-[116px] sm:rounded-[18px] sm:p-[18px]",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="dashboard-lease-horizon"
          className="text-leasium-micro font-semibold uppercase tracking-[0.04em] text-muted-foreground"
        >
          <span className="sm:hidden">Next on the horizon</span>
          <span className="hidden sm:inline">Lease horizon - next 120 days</span>
        </h2>
        <CalendarClock
          size={14}
          className="hidden text-leasium-slate-400 sm:block"
        />
      </div>
      {loading ? (
        <div className="mt-4 rounded-md border border-border bg-muted/25 px-3 py-2 text-sm text-muted-foreground">
          Preparing lease horizon.
        </div>
      ) : events.length ? (
        <div className="mt-2 grid gap-0 sm:mt-4 sm:gap-3 sm:grid-cols-4">
          {events.slice(0, 4).map((event, index) => (
            <Link
              key={event.id}
              href={event.href}
              className={cn(
                "grid min-h-11 min-w-0 grid-cols-[8px_minmax(0,1fr)_auto] items-center gap-2 py-1 text-xs transition hover:text-primary sm:min-h-0 sm:grid-cols-1 sm:items-start sm:gap-1 sm:border-t sm:border-border sm:pt-2",
                index > 1 && "hidden sm:grid",
              )}
            >
              <span
                className={[
                  "h-2 w-2 rounded-full",
                  event.tone === "danger"
                    ? "bg-danger"
                    : event.tone === "warning"
                      ? "bg-warning"
                      : "bg-primary",
                ].join(" ")}
              />
              <span className="truncate font-medium text-foreground">
                {event.title}
              </span>
              <span className="truncate text-[11px] leading-4 text-muted-foreground sm:hidden">
                {formatCompactDate(event.date)}
              </span>
              <span className="hidden truncate text-[11px] leading-4 text-muted-foreground sm:inline">
                {event.detail || dueLabel(event.date)}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-md border border-border bg-muted/25 px-3 py-2 text-sm text-muted-foreground">
          No lease events in the next 120 days.
        </div>
      )}
    </section>
  );
}

function DashboardTrustRibbon({
  variant = "desktop",
}: {
  variant?: "desktop" | "mobile";
}) {
  const mobile = variant === "mobile";
  return (
    <div className="flex items-center justify-center">
      <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--leasium-teal-soft)] px-3 py-2 text-[11px] font-semibold text-[var(--leasium-teal-strong)] sm:gap-2 sm:px-4 sm:text-xs">
        <ShieldCheck size={mobile ? 12 : 14} aria-hidden="true" />
        <span>
          {mobile
            ? "Nothing applies until you approve it."
            : "Nothing is applied until you approve it."}
        </span>
      </div>
    </div>
  );
}

export function Dashboard({
  mode = "dashboard",
}: {
  mode?: "dashboard" | "intake";
}) {
  const [selectedEntityId, setSelectedEntityId] = useState(() =>
    initialSelectedEntityId(mode),
  );
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [intakeNotice, setIntakeNotice] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [landingQuestion, setLandingQuestion] = useState("");
  const [landingAsking, setLandingAsking] = useState(false);
  const [landingAsks, setLandingAsks] = useState<
    Array<{
      question: string;
      answer: string | null;
      citations: AskCitationRecord[];
      error: string | null;
    }>
  >([]);
  const handleLandingAsk = async (override?: string) => {
    const trimmed = (override ?? landingQuestion).trim();
    if (!trimmed || landingAsking || !selectedEntityId) return;
    setLandingAsking(true);
    setLandingQuestion("");
    const index = landingAsks.length;
    setLandingAsks((current) => [
      ...current,
      { question: trimmed, answer: null, citations: [], error: null },
    ]);
    try {
      const params = new URLSearchParams(window.location.search);
      const contextRoute = params.get("context_route") || "/intake";
      const contextRefs = queryRecordRefs(params);
      const thread = await createConversationThread({
        entity_id: selectedEntityId,
        source: params.get("context_route") ? "cmdk" : "intake",
        context_route: contextRoute,
        context_record_refs: contextRefs,
        title: trimmed.slice(0, 120),
      });
      const result = await askLeasium({
        entity_id: selectedEntityId,
        question: trimmed,
        thread_id: thread.id,
      });
      queryClient.invalidateQueries({
        queryKey: ["conversation-threads", selectedEntityId],
      });
      setLandingAsks((current) =>
        current.map((turn, i) =>
          i === index
            ? { ...turn, answer: result.answer, citations: result.citations }
            : turn,
        ),
      );
    } catch (err) {
      const message = friendlyError(err);
      setLandingAsks((current) =>
        current.map((turn, i) => (i === index ? { ...turn, error: message } : turn)),
      );
    } finally {
      setLandingAsking(false);
    }
  };
  const [reviewQueueFilter, setReviewQueueFilter] =
    useState<ReviewQueueFilter>("all");
  const [reviewIntakeId, setReviewIntakeId] = useState<string | null>(null);
  const [requestedReviewId, setRequestedReviewId] = useState<string | null>(
    null,
  );
  const [lastApplyOutcome, setLastApplyOutcome] =
    useState<DocumentApplyOutcome | null>(null);
  const [demoMode, setDemoMode] = useState(
    () =>
      typeof window !== "undefined" &&
      window.localStorage.getItem(DEMO_MODE_STORAGE_KEY) === "true",
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const queryClient = useQueryClient();
  const asOf = dateOnly(new Date());
  const isIntakeWorkspace = mode === "intake";
  const demoCreatedAt = useMemo(() => new Date().toISOString(), []);
  const demoDocumentIntake = useMemo(
    () => demoIntake(demoCreatedAt),
    [demoCreatedAt],
  );
  const demoObligationRows = useMemo(() => demoObligations(), []);
  const demoRentRows = useMemo(() => demoRentRoll(), []);
  const demoOnboardingRows = useMemo(
    () => demoOnboardings(demoCreatedAt),
    [demoCreatedAt],
  );

  const entitiesQuery = useQuery({
    queryKey: ["entities"],
    queryFn: listEntities,
  });

  useEffect(() => {
    if (!entitiesQuery.data) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const requestedEntityId = isIntakeWorkspace
      ? params.get("entity_id")
      : null;
    const stored = window.localStorage.getItem(ENTITY_STORAGE_KEY);
    const accessibleIds = new Set(
      (entitiesQuery.data ?? []).map((entity) => entity.id),
    );
    const firstEntity = entitiesQuery.data?.[0]?.id ?? "";
    // The All-entities sentinel is a valid restore target in dashboard mode only
    // (it survives navigation/reload there); intake stays single-entity.
    const storedIsRestorable = Boolean(
      stored &&
        ((!isIntakeWorkspace && isAllEntities(stored)) ||
          accessibleIds.has(stored)),
    );
    // Fresh selection: multi-entity orgs default to All entities in dashboard
    // mode; intake stays single-entity, so it keeps the first entity.
    const fallbackEntity = isIntakeWorkspace
      ? firstEntity
      : defaultEntitySelection(entitiesQuery.data ?? []);
    const next =
      requestedEntityId && accessibleIds.has(requestedEntityId)
        ? requestedEntityId
        : storedIsRestorable
          ? (stored as string)
          : fallbackEntity;
    const selectionValid =
      (!isIntakeWorkspace && isAllEntities(selectedEntityId)) ||
      accessibleIds.has(selectedEntityId);
    if (next) {
      if (!selectedEntityId || !selectionValid) {
        setSelectedEntityId(next);
      }
    } else if (selectedEntityId && !selectionValid) {
      // No accessible entity to fall back to and the stored selection is not
      // valid for this account — e.g. a brand-new account with no entities, or
      // one switched from a different login in the same browser (the entity id
      // is persisted in a shared localStorage key). Clear it so entity-scoped
      // queries stay disabled and we never query an entity this account cannot
      // access (which would 403 as "you do not have access to this entity").
      setSelectedEntityId("");
      window.localStorage.removeItem(ENTITY_STORAGE_KEY);
    }
  }, [entitiesQuery.data, isIntakeWorkspace, selectedEntityId]);

  useEffect(() => {
    if (selectedEntityId) {
      window.localStorage.setItem(ENTITY_STORAGE_KEY, selectedEntityId);
      window.dispatchEvent(new Event(ENTITY_CHANGED_EVENT));
    }
  }, [selectedEntityId]);

  useEffect(() => {
    window.localStorage.setItem(DEMO_MODE_STORAGE_KEY, String(demoMode));
  }, [demoMode]);

  useEffect(() => {
    if (!isIntakeWorkspace) {
      return;
    }
    setRequestedReviewId(
      new URLSearchParams(window.location.search).get("review"),
    );
  }, [isIntakeWorkspace]);

  // Global ⌘K "Ask Leasium AI" hands a question to /intake?ask=… — run it once
  // in the landing composer, then strip the param so refresh/back won't re-ask.
  const askConsumedRef = useRef(false);
  useEffect(() => {
    if (!isIntakeWorkspace || askConsumedRef.current || !selectedEntityId) {
      return;
    }
    const ask = new URLSearchParams(window.location.search).get("ask");
    if (!ask || !ask.trim()) {
      return;
    }
    askConsumedRef.current = true;
    void handleLandingAsk(ask);
    const url = new URL(window.location.href);
    url.searchParams.delete("ask");
    window.history.replaceState(null, "", url.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isIntakeWorkspace, selectedEntityId]);

  // Cross-entity "All entities" view (dashboard command-center mode only).
  // The intake document-review flow stays strictly single-entity. In all-mode
  // every entity-scoped query uses scopedEntityId (empty, so it stays disabled)
  // and the command center reads merged fan-out results across all entities.
  const allMode = isAllEntities(selectedEntityId) && !isIntakeWorkspace;
  const scopedEntityId = scopeEntityId(selectedEntityId);
  const entityNameById = useMemo(
    () =>
      new Map(
        (entitiesQuery.data ?? []).map((entity) => [entity.id, entity.name]),
      ),
    [entitiesQuery.data],
  );

  const dashboardOverviewQuery = useQuery<DashboardOverviewRecord>({
    queryKey: ["dashboard-overview", scopedEntityId, asOf],
    queryFn: () => getDashboardOverview(scopedEntityId, asOf || undefined),
    enabled: !demoMode && Boolean(scopedEntityId),
  });
  const dashboardOverview = demoMode
    ? null
    : (dashboardOverviewQuery.data ?? null);
  const propertiesQuery = useQuery({
    queryKey: ["dashboard-properties", scopedEntityId],
    queryFn: () => listProperties(scopedEntityId),
    enabled: Boolean(scopedEntityId),
  });
  const tenantsQuery = useQuery({
    queryKey: ["dashboard-tenants", scopedEntityId],
    queryFn: () => listTenants(scopedEntityId),
    enabled: Boolean(scopedEntityId),
  });
  const obligationsQuery = useQuery({
    queryKey: ["dashboard-obligations", scopedEntityId],
    queryFn: () => listObligations({ entity_id: scopedEntityId }),
    enabled: Boolean(scopedEntityId),
  });
  const rentRollQuery = useQuery({
    queryKey: ["dashboard-rent-roll", scopedEntityId, asOf],
    queryFn: () => listRentRoll({ entity_id: scopedEntityId, as_of: asOf }),
    enabled: Boolean(scopedEntityId),
  });
  const insightsOverviewQuery = useQuery<InsightsOverviewRecord>({
    queryKey: ["dashboard-insights-overview", scopedEntityId, asOf],
    queryFn: () => getInsightsOverview(scopedEntityId, asOf || undefined),
    // Feeds UpcomingLeaseEventsPanel + CompliancePanel, both hidden in intake.
    enabled: !isIntakeWorkspace && Boolean(scopedEntityId),
  });
  const onboardingQuery = useQuery({
    queryKey: ["dashboard-onboarding", scopedEntityId],
    queryFn: () => listTenantOnboardings(scopedEntityId),
    enabled: Boolean(scopedEntityId),
  });
  const documentIntakesQuery = useQuery({
    queryKey: ["dashboard-document-intakes", scopedEntityId],
    queryFn: () => listDocumentIntakes(scopedEntityId),
    enabled: Boolean(scopedEntityId),
    refetchInterval: (query) =>
      query.state.data?.some(intakeIsActive) ? 2500 : false,
  });
  const requestedThreadId =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("thread_id");
  const selectedThreadQuery = useQuery({
    queryKey: ["conversation-thread", requestedThreadId],
    queryFn: () => getConversationThread(requestedThreadId ?? ""),
    enabled: isIntakeWorkspace && Boolean(requestedThreadId),
    staleTime: 30_000,
  });

  useEffect(() => {
    const thread = selectedThreadQuery.data;
    if (!isIntakeWorkspace || !thread) return;
    const restored: typeof landingAsks = [];
    for (const turn of thread.turns) {
      const textValue = turn.payload.text;
      if (turn.role === "user" && typeof textValue === "string") {
        restored.push({
          question: textValue,
          answer: null,
          citations: [],
          error: null,
        });
        continue;
      }
      if (
        turn.role === "ai" &&
        turn.kind === "text" &&
        typeof textValue === "string" &&
        restored.length > 0
      ) {
        const last = restored[restored.length - 1];
        if (last.answer === null) {
          last.answer = textValue;
        }
      }
    }
    if (restored.length > 0) {
      setLandingAsks(restored);
    }
  }, [isIntakeWorkspace, selectedThreadQuery.data]);

  // All-entities command center reads. Each uses one org-wide request (the
  // API scopes a missing entity_id to every readable entity) instead of a
  // per-entity fan-out. The command center re-builds from these merged lists;
  // not-safely-additive panels (overview-derived events/compliance, demo
  // mode) are scoped off below.
  const obligationsFanOut = useEntityFanOut({
    entities: entitiesQuery.data,
    enabled: allMode && !demoMode,
    keyPrefix: ["dashboard-obligations"],
    queryFn: (entityId) => listObligations({ entity_id: entityId }),
    orgWideQueryFn: () => listObligations({}),
  });
  const rentRollFanOut = useEntityFanOut({
    entities: entitiesQuery.data,
    enabled: allMode && !demoMode,
    keyPrefix: ["dashboard-rent-roll", asOf],
    queryFn: (entityId) => listRentRoll({ entity_id: entityId, as_of: asOf }),
    orgWideQueryFn: () => listRentRoll({ as_of: asOf }),
  });
  const onboardingFanOut = useEntityFanOut({
    entities: entitiesQuery.data,
    enabled: allMode && !demoMode,
    keyPrefix: ["dashboard-onboarding"],
    queryFn: listTenantOnboardings,
    orgWideQueryFn: () => listTenantOnboardings(),
  });
  const documentIntakesFanOut = useEntityFanOut({
    entities: entitiesQuery.data,
    enabled: allMode && !demoMode,
    keyPrefix: ["dashboard-document-intakes"],
    queryFn: listDocumentIntakes,
    orgWideQueryFn: () => listDocumentIntakes(),
  });
  const documentIntakeMutation = useMutation({
    mutationFn: (file: File) =>
      createDocumentIntake({
        entityId: selectedEntityId,
        file,
      }),
    onMutate: () => {
      setIntakeError(null);
      setIntakeNotice(null);
      setLastApplyOutcome(null);
    },
    onSuccess: (created) => {
      setReviewIntakeId(created.id);
      queryClient.invalidateQueries({
        queryKey: ["dashboard-overview", selectedEntityId],
      });
      queryClient.invalidateQueries({
        queryKey: ["dashboard-document-intakes", selectedEntityId],
      });
    },
    onError: (error) => {
      setIntakeError(friendlyError(error));
    },
  });
  const deleteDocumentIntakeMutation = useMutation({
    mutationFn: deleteDocumentIntake,
    onMutate: () => {
      setIntakeError(null);
      setIntakeNotice(null);
    },
    onSuccess: (_data, deletedId) => {
      if (reviewIntakeId === deletedId) {
        setReviewIntakeId(null);
      }
      setIntakeNotice("Removed from review inbox.");
      queryClient.invalidateQueries({
        queryKey: ["dashboard-overview", selectedEntityId],
      });
      queryClient.invalidateQueries({
        queryKey: ["dashboard-document-intakes", selectedEntityId],
      });
    },
    onError: (error) => {
      setIntakeError(friendlyError(error));
    },
  });

  const entitiesLoading =
    !demoMode &&
    !entitiesQuery.data &&
    (entitiesQuery.isLoading || entitiesQuery.isFetching);
  const entitySelectionLoading =
    entitiesLoading ||
    (!demoMode && !selectedEntityId && (entitiesQuery.data?.length ?? 0) > 0);
  const overviewDocumentNeedsReviewCount = overviewStatusCount(
    dashboardOverview?.intake.document_counts,
    ["ready_for_review", "needs_attention"],
  );
  const overviewDocumentFailedCount = overviewStatusCount(
    dashboardOverview?.intake.document_counts,
    ["failed"],
  );
  const overviewOnboardingSubmittedCount = overviewStatusCount(
    dashboardOverview?.intake.onboarding_counts,
    ["submitted"],
  );
  const overviewOnboardingSentCount = overviewStatusCount(
    dashboardOverview?.intake.onboarding_counts,
    ["sent"],
  );
  const overviewOperationsCount =
    (dashboardOverview?.counts.overdue_obligation_count ?? 0) +
    (dashboardOverview?.counts.due_soon_obligation_count ?? 0);
  const overviewBillingBlockerCount =
    dashboardOverview?.rent_roll.blocked_row_count ?? 0;
  const obligationsLoading =
    entitySelectionLoading ||
    (!demoMode &&
      (allMode
        ? obligationsFanOut.isLoading
        : Boolean(selectedEntityId) &&
          !obligationsQuery.data &&
          (obligationsQuery.isLoading || obligationsQuery.isFetching)));
  const rentRollLoading =
    entitySelectionLoading ||
    (!demoMode &&
      (allMode
        ? rentRollFanOut.isLoading
        : Boolean(selectedEntityId) &&
          !rentRollQuery.data &&
          (rentRollQuery.isLoading || rentRollQuery.isFetching)));
  const onboardingLoading =
    entitySelectionLoading ||
    (!demoMode &&
      (allMode
        ? onboardingFanOut.isLoading
        : Boolean(selectedEntityId) &&
          !onboardingQuery.data &&
          (onboardingQuery.isLoading || onboardingQuery.isFetching)));
  const documentIntakesLoading =
    entitySelectionLoading ||
    (!demoMode &&
      (allMode
        ? documentIntakesFanOut.isLoading
        : Boolean(selectedEntityId) &&
          !documentIntakesQuery.data &&
          (documentIntakesQuery.isLoading || documentIntakesQuery.isFetching)));
  const dashboardDataQueries = [
    propertiesQuery,
    tenantsQuery,
    obligationsQuery,
    rentRollQuery,
    onboardingQuery,
    documentIntakesQuery,
  ];
  const dashboardFanOuts = [
    obligationsFanOut,
    rentRollFanOut,
    onboardingFanOut,
    documentIntakesFanOut,
  ];
  const dashboardLoading =
    !demoMode &&
    !dashboardOverview &&
    (entitySelectionLoading ||
      (allMode
        ? dashboardFanOuts.some((fanOut) => fanOut.isLoading)
        : Boolean(selectedEntityId) &&
          dashboardDataQueries.some(
            (query) => !query.data && (query.isLoading || query.isFetching),
          )));
  const dashboardRefreshing =
    !demoMode &&
    (allMode
      ? dashboardFanOuts.some((fanOut) => fanOut.isFetching)
      : Boolean(selectedEntityId) &&
        (dashboardOverviewQuery.isFetching ||
          dashboardDataQueries.some(
            (query) => query.isFetching && !query.isLoading,
          )));
  const dashboardError =
    !demoMode &&
    (allMode
      ? (entitiesQuery.error ??
        obligationsFanOut.error ??
        rentRollFanOut.error ??
        onboardingFanOut.error ??
        documentIntakesFanOut.error)
      : (entitiesQuery.error ??
        propertiesQuery.error ??
        tenantsQuery.error ??
        obligationsQuery.error ??
        rentRollQuery.error ??
        onboardingQuery.error ??
        documentIntakesQuery.error));
  const displayObligations = useMemo(
    () =>
      demoMode
        ? demoObligationRows
        : allMode
          ? obligationsFanOut.data
          : (obligationsQuery.data ?? []),
    [allMode, demoMode, demoObligationRows, obligationsFanOut.data, obligationsQuery.data],
  );
  const displayRentRoll = useMemo(
    () =>
      demoMode
        ? demoRentRows
        : allMode
          ? rentRollFanOut.data
          : (rentRollQuery.data ?? []),
    [allMode, demoMode, demoRentRows, rentRollFanOut.data, rentRollQuery.data],
  );
  const displayOnboardings = useMemo(
    () =>
      demoMode
        ? demoOnboardingRows
        : allMode
          ? onboardingFanOut.data
          : (onboardingQuery.data ?? []),
    [allMode, demoMode, demoOnboardingRows, onboardingFanOut.data, onboardingQuery.data],
  );
  const liveDocumentIntakes = allMode
    ? documentIntakesFanOut.data
    : (documentIntakesQuery.data ?? []);
  const documentIntakes = demoMode
    ? [demoDocumentIntake, ...liveDocumentIntakes]
    : liveDocumentIntakes;

  const openObligations = useMemo(
    () =>
      [...displayObligations]
        .filter((item) => !["completed", "waived"].includes(item.status))
        .sort((a, b) => dueRank(a.due_date) - dueRank(b.due_date)),
    [displayObligations],
  );

  const urgentObligations = openObligations.filter(
    (item) => dueRank(item.due_date) <= 14 || item.priority <= 1,
  );
  const billingIssues = displayRentRoll
    .map((row) => ({ row, blockers: blockers(row) }))
    .filter((item) => item.blockers.length > 0);
  const activeOnboardings = displayOnboardings.filter(
    (item) => item.status === "sent",
  );
  const submittedOnboardings = displayOnboardings.filter(
    (item) => item.status === "submitted",
  );
  const reviewIntakes = documentIntakes.filter(
    (item) => item.status !== "applied",
  );
  const filteredReviewIntakes = reviewIntakes.filter((item) =>
    intakeReviewFilterMatch(item, reviewQueueFilter),
  );
  const activeReviewIntakeId = reviewIntakeId ?? requestedReviewId;
  const selectedReviewIntake = activeReviewIntakeId
    ? (filteredReviewIntakes.find((item) => item.id === activeReviewIntakeId) ??
      null)
    : null;
  const needsReviewCount = documentIntakes.filter((item) =>
    ["ready_for_review", "needs_attention"].includes(item.status),
  ).length;
  const failedIntakeCount = documentIntakes.filter(
    (item) => item.status === "failed",
  ).length;
  const smartReviewIntakes = documentIntakes
    .filter((item) =>
      ["ready_for_review", "needs_attention"].includes(item.status),
    )
    .sort((a, b) => {
      const aRank = a.status === "needs_attention" ? 0 : 1;
      const bRank = b.status === "needs_attention" ? 0 : 1;
      if (aRank !== bRank) {
        return aRank - bRank;
      }
      return a.created_at.localeCompare(b.created_at);
    });
  const failedIntakes = documentIntakes
    .filter((item) => item.status === "failed")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const rankedBillingIssues = [...billingIssues].sort((a, b) => {
    const aHardBlocker = [
      ...(a.row.invoice_readiness_blockers ?? []),
      ...(a.row.xero_readiness_blockers ?? []),
    ].length;
    const bHardBlocker = [
      ...(b.row.invoice_readiness_blockers ?? []),
      ...(b.row.xero_readiness_blockers ?? []),
    ].length;
    if (aHardBlocker !== bHardBlocker) {
      return bHardBlocker - aHardBlocker;
    }
    return dueRank(a.row.next_due_date) - dueRank(b.row.next_due_date);
  });
  const rankedSubmittedOnboardings = [...submittedOnboardings].sort(
    (a, b) => dueRank(a.due_date) - dueRank(b.due_date),
  );
  const urgentOnboardingFollowUps = activeOnboardings
    .filter((item) => dueRank(item.due_date) <= 7)
    .sort((a, b) => dueRank(a.due_date) - dueRank(b.due_date));
  // In all-mode each merged command-center row references a top record that
  // belongs to one entity; tag the row's metadata line (the `area` field, which
  // renders as muted uppercase-adjacent text) with that owning entity so the
  // operator can see which entity the action is for.
  function commandCenterArea(area: string, entityId: string | null) {
    if (!allMode || !entityId) {
      return area;
    }
    const name = entityNameById.get(entityId);
    return name ? `${area} · ${name.toUpperCase()}` : area;
  }
  const commandCenterItems: CommandCenterItem[] = [];
  const topSmartReview = smartReviewIntakes[0];
  if (topSmartReview) {
    commandCenterItems.push({
      id: "smart-intake-review",
      area: commandCenterArea("Leasium AI", topSmartReview.entity_id),
      title: `${smartReviewIntakes.length} Leasium AI ${
        smartReviewIntakes.length === 1 ? "review" : "reviews"
      } waiting`,
      why:
        topSmartReview.status === "needs_attention"
          ? `${topSmartReview.filename} needs a human match before Leasium can turn it into reviewed workflow data.`
          : `${topSmartReview.filename} has extracted terms waiting for approval before lease, billing, or task work is created.`,
      href: intakeReviewHref(topSmartReview.entity_id, topSmartReview.id),
      nextStep: "Review document",
      chip: "Review first",
      tone: "primary",
      score: 0,
      date: topSmartReview.created_at,
      dateLabel: `Waiting since ${formatDateTime(topSmartReview.created_at)}`,
      icon: <Sparkles size={16} />,
    });
  }
  const topFailedIntake = failedIntakes[0];
  if (topFailedIntake) {
    commandCenterItems.push({
      id: "smart-intake-failed",
      area: commandCenterArea("Leasium AI", topFailedIntake.entity_id),
      title: `${failedIntakes.length} document ${
        failedIntakes.length === 1 ? "read" : "reads"
      } failed`,
      why: `${topFailedIntake.filename} could not become source-backed review data, so downstream workflow should wait until it is fixed or cleared.`,
      href: intakeReviewHref(topFailedIntake.entity_id, topFailedIntake.id),
      nextStep: "Fix intake",
      chip: "Could not read",
      tone: "danger",
      score: 6,
      date: topFailedIntake.created_at,
      dateLabel: formatDateTime(topFailedIntake.created_at),
      icon: <FileText size={16} />,
    });
  }
  const topBillingIssue = rankedBillingIssues[0];
  if (topBillingIssue) {
    const hardBlocker = [
      ...(topBillingIssue.row.invoice_readiness_blockers ?? []),
      ...(topBillingIssue.row.xero_readiness_blockers ?? []),
    ].length;
    const nextCharge = topBillingIssue.row.next_due_date
      ? ` Next charge is ${dueLabel(topBillingIssue.row.next_due_date).toLowerCase()}.`
      : "";
    commandCenterItems.push({
      id: "billing-readiness",
      area: commandCenterArea("Billing", topBillingIssue.row.entity_id),
      title: `${rankedBillingIssues.length} billing ${
        rankedBillingIssues.length === 1 ? "blocker" : "blockers"
      } before invoices`,
      why: `${topBillingIssue.row.unit_label} has ${topBillingIssue.blockers[0]}.${nextCharge}`,
      href: "/billing-readiness",
      nextStep: "Open billing readiness",
      chip: hardBlocker ? "Blocked" : "Check GST",
      tone: hardBlocker ? "danger" : "warning",
      score: 18 + urgencyWeight(topBillingIssue.row.next_due_date),
      date: topBillingIssue.row.next_due_date,
      dateLabel: topBillingIssue.row.next_due_date
        ? dueLabel(topBillingIssue.row.next_due_date)
        : "No charge date",
      icon: <ReceiptText size={16} />,
    });
  }
  const topSubmittedOnboarding = rankedSubmittedOnboardings[0];
  if (topSubmittedOnboarding) {
    commandCenterItems.push({
      id: "submitted-onboarding",
      area: commandCenterArea("Onboarding", topSubmittedOnboarding.entity_id),
      title: `${rankedSubmittedOnboardings.length} submitted onboarding ${
        rankedSubmittedOnboardings.length === 1 ? "item" : "items"
      } need review`,
      why: "Tenant data has arrived; review it before relying on contact, billing, portal, or lease setup details.",
      href: "/tenants",
      nextStep: "Review submissions",
      chip: "Submitted",
      tone:
        dueRank(topSubmittedOnboarding.due_date) < 0 ? "warning" : "primary",
      score: 28 + urgencyWeight(topSubmittedOnboarding.due_date),
      date: topSubmittedOnboarding.due_date,
      dateLabel: dueLabel(topSubmittedOnboarding.due_date),
      icon: <UserRound size={16} />,
    });
  }
  const topUrgentObligation = urgentObligations[0];
  if (topUrgentObligation) {
    const notes = topUrgentObligation.notes
      ? ` ${topUrgentObligation.notes}`
      : "";
    commandCenterItems.push({
      id: "urgent-operations",
      area: commandCenterArea("Operations", topUrgentObligation.entity_id),
      title: `${urgentObligations.length} urgent ${
        urgentObligations.length === 1 ? "date" : "dates"
      } or task${urgentObligations.length === 1 ? "" : "s"}`,
      why: `${topUrgentObligation.title} is ${dueLabel(
        topUrgentObligation.due_date,
      ).toLowerCase()}.${notes}`,
      href: "/operations",
      nextStep: "Open operations",
      chip: dueLabel(topUrgentObligation.due_date),
      tone: obligationTone(topUrgentObligation),
      score: 34 + urgencyWeight(topUrgentObligation.due_date),
      date: topUrgentObligation.due_date,
      dateLabel: formatDate(topUrgentObligation.due_date),
      icon: <AlertTriangle size={16} />,
    });
  }
  const topOnboardingFollowUp = urgentOnboardingFollowUps[0];
  if (topOnboardingFollowUp) {
    commandCenterItems.push({
      id: "onboarding-follow-up",
      area: commandCenterArea("Onboarding", topOnboardingFollowUp.entity_id),
      title: `${urgentOnboardingFollowUps.length} tenant onboarding follow-up${
        urgentOnboardingFollowUps.length === 1 ? "" : "s"
      } due`,
      why: "Tenant details are still outstanding and may block contact, billing, and portal readiness.",
      href: "/tenants",
      nextStep: "Open tenant queue",
      chip: dueRank(topOnboardingFollowUp.due_date) < 0 ? "Overdue" : "Waiting",
      tone: dueRank(topOnboardingFollowUp.due_date) < 0 ? "warning" : "primary",
      score: 45 + urgencyWeight(topOnboardingFollowUp.due_date),
      date: topOnboardingFollowUp.due_date,
      dateLabel: dueLabel(topOnboardingFollowUp.due_date),
      icon: <CalendarClock size={16} />,
    });
  }
  commandCenterItems.sort(commandCenterSort);
  const overviewCommandCenterItems: CommandCenterItem[] = [];
  if (dashboardOverview) {
    if (overviewDocumentNeedsReviewCount) {
      overviewCommandCenterItems.push({
        id: "overview-smart-intake-review",
        area: "Leasium AI",
        title: `${overviewDocumentNeedsReviewCount} Leasium AI ${
          overviewDocumentNeedsReviewCount === 1 ? "review" : "reviews"
        } waiting`,
        why: "Extracted document data is ready for operator review before any portfolio changes are applied.",
        href: "/intake",
        nextStep: "Review documents",
        chip: "Review first",
        tone: "primary",
        score: 0,
        date: dashboardOverview.as_of,
        dateLabel: "Waiting",
        icon: <Sparkles size={16} />,
      });
    }
    if (overviewDocumentFailedCount) {
      overviewCommandCenterItems.push({
        id: "overview-smart-intake-failed",
        area: "Leasium AI",
        title: `${overviewDocumentFailedCount} document ${
          overviewDocumentFailedCount === 1 ? "read" : "reads"
        } failed`,
        why: "Some uploaded documents could not become source-backed review data and need a quick operator check.",
        href: "/intake",
        nextStep: "Fix in Leasium AI",
        chip: "Could not read",
        tone: "danger",
        score: 6,
        date: dashboardOverview.as_of,
        dateLabel: "Needs fix",
        icon: <FileText size={16} />,
      });
    }
    if (overviewBillingBlockerCount) {
      overviewCommandCenterItems.push({
        id: "overview-billing-readiness",
        area: "Billing",
        title: `${overviewBillingBlockerCount} billing ${
          overviewBillingBlockerCount === 1 ? "blocker" : "blockers"
        } before invoices`,
        why: "Billing readiness found rows that need operator cleanup before invoices are trusted.",
        href: "/billing-readiness",
        nextStep: "Open billing readiness",
        chip: "Blocked",
        tone: "danger",
        score: 18,
        date: dashboardOverview.as_of,
        dateLabel: "Blocked",
        icon: <ReceiptText size={16} />,
      });
    }
    if (overviewOnboardingSubmittedCount) {
      overviewCommandCenterItems.push({
        id: "overview-submitted-onboarding",
        area: "Onboarding",
        title: `${overviewOnboardingSubmittedCount} submitted onboarding ${
          overviewOnboardingSubmittedCount === 1 ? "item" : "items"
        } need review`,
        why: "Tenant details have arrived and should be reviewed before they become operating data.",
        href: "/tenants",
        nextStep: "Review submissions",
        chip: "Submitted",
        tone: "primary",
        score: 28,
        date: dashboardOverview.as_of,
        dateLabel: "Submitted",
        icon: <UserRound size={16} />,
      });
    }
    if (overviewOperationsCount) {
      overviewCommandCenterItems.push({
        id: "overview-urgent-operations",
        area: "Operations",
        title: `${overviewOperationsCount} urgent ${
          overviewOperationsCount === 1 ? "date" : "dates"
        } or task${overviewOperationsCount === 1 ? "" : "s"}`,
        why: "Lease dates and obligations need attention soon, including overdue or due-soon work.",
        href: "/operations",
        nextStep: "Open operations",
        chip:
          dashboardOverview.counts.overdue_obligation_count > 0
            ? "Overdue"
            : "Due soon",
        tone:
          dashboardOverview.counts.overdue_obligation_count > 0
            ? "danger"
            : "warning",
        score: 34,
        date: dashboardOverview.as_of,
        dateLabel:
          dashboardOverview.counts.overdue_obligation_count > 0
            ? "Overdue"
            : "Due soon",
        icon: <AlertTriangle size={16} />,
      });
    }
    if (overviewOnboardingSentCount) {
      overviewCommandCenterItems.push({
        id: "overview-onboarding-follow-up",
        area: "Onboarding",
        title: `${overviewOnboardingSentCount} tenant onboarding follow-up${
          overviewOnboardingSentCount === 1 ? "" : "s"
        } due`,
        why: "Tenant details are still outstanding and may block contact, billing, and portal readiness.",
        href: "/tenants",
        nextStep: "Open tenant queue",
        chip: "Waiting",
        tone: "primary",
        score: 45,
        date: dashboardOverview.as_of,
        dateLabel: "Waiting",
        icon: <CalendarClock size={16} />,
      });
    }
  }
  overviewCommandCenterItems.sort(commandCenterSort);
  const commandCenterCounts = {
    intake: smartReviewIntakes.length + failedIntakes.length,
    billing: rankedBillingIssues.length,
    onboarding:
      rankedSubmittedOnboardings.length + urgentOnboardingFollowUps.length,
    operations: urgentObligations.length,
  };
  const overviewCommandCenterCounts = {
    intake: overviewDocumentNeedsReviewCount + overviewDocumentFailedCount,
    billing: overviewBillingBlockerCount,
    onboarding: overviewOnboardingSubmittedCount + overviewOnboardingSentCount,
    operations: overviewOperationsCount,
  };
  const commandCenterDetailsReady =
    demoMode ||
    allMode ||
    Boolean(
      documentIntakesQuery.data &&
      rentRollQuery.data &&
      onboardingQuery.data &&
      obligationsQuery.data,
    );
  const displayedCommandCenterItems =
    commandCenterDetailsReady || !dashboardOverview
      ? commandCenterItems
      : overviewCommandCenterItems;
  const displayedCommandCenterCounts =
    commandCenterDetailsReady || !dashboardOverview
      ? commandCenterCounts
      : overviewCommandCenterCounts;
  const commandCenterLoading =
    !demoMode &&
    !dashboardOverview &&
    (documentIntakesLoading ||
      rentRollLoading ||
      onboardingLoading ||
      obligationsLoading);
  const dashboardFocusItemCount = displayedCommandCenterItems.length;
  const dashboardMobileFocusSummary = commandCenterLoading
    ? "checking today's focus"
    : dashboardFocusItemCount === 0
      ? "portfolio clear right now"
      : dashboardFocusItemCount === 1
        ? "one thing needs you"
        : `${dashboardFocusItemCount} things need you`;
  function renderDashboardActions() {
    return (
      <>
        <SecondaryButton
          type="button"
          onClick={() => setDemoMode((current) => !current)}
        >
          <Layers3 size={15} />
          {demoMode ? "View live portfolio" : "View demo portfolio"}
        </SecondaryButton>
        <SecondaryButton
          type="button"
          onClick={refreshDashboardData}
          disabled={!selectedEntityId}
        >
          <RefreshCw size={15} />
          Refresh
        </SecondaryButton>
      </>
    );
  }
  const billingMetricLoading = rentRollLoading && !dashboardOverview;
  const billingMetricCount =
    demoMode || allMode || rentRollQuery.data
      ? billingIssues.length
      : overviewBillingBlockerCount;
  const billingMetricNextAction =
    billingIssues[0]?.blockers[0] ??
    (billingMetricCount
      ? "Review blocked billing rows."
      : "Invoice run is ready from current data.");
  const recentlyAppliedIntakes = documentIntakes
    .filter((item) => item.status === "applied")
    .sort((a, b) =>
      (b.applied_at ?? b.updated_at ?? b.created_at).localeCompare(
        a.applied_at ?? a.updated_at ?? a.created_at,
      ),
    )
    .slice(0, 3);

  function uploadSmartIntake(file: File | null | undefined) {
    if (!file || !selectedEntityId || documentIntakeMutation.isPending) {
      return;
    }
    documentIntakeMutation.mutate(file);
  }

  // Refresh routes through fan-outs in all-mode (single-entity queries are
  // disabled there) and through the single-entity queries otherwise.
  function refreshDashboardData() {
    if (allMode) {
      dashboardFanOuts.forEach((fanOut) => fanOut.refetch());
      return;
    }
    dashboardOverviewQuery.refetch();
    propertiesQuery.refetch();
    tenantsQuery.refetch();
    obligationsQuery.refetch();
    rentRollQuery.refetch();
    onboardingQuery.refetch();
    documentIntakesQuery.refetch();
  }

  function reviewQueueCsv() {
    return smartIntakeReviewQueueCsv(filteredReviewIntakes);
  }

  async function copyReviewQueueCsv() {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setIntakeNotice("Clipboard is not available in this browser.");
      return;
    }

    try {
      await navigator.clipboard.writeText(reviewQueueCsv());
      setIntakeNotice("Review queue CSV copied.");
    } catch {
      setIntakeNotice("Clipboard is not available in this browser.");
    }
  }

  function downloadReviewQueueCsv() {
    saveBlob(
      new Blob([reviewQueueCsv()], {
        type: "text/csv;charset=utf-8",
      }),
      `smart-intake-review-queue-${reviewQueueFilter}.csv`,
    );
  }

  function closeDocumentReview() {
    setReviewIntakeId(null);
    setRequestedReviewId(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("review");
      window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    }
  }

  const selectedDocumentReviewPanel = selectedReviewIntake ? (
    <section data-testid="leasium-ai-document-chat" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={closeDocumentReview}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-primary transition hover:bg-primary/5"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Back to Leasium AI
        </button>
      </div>
      <IntakeConversationPanel
        entityId={selectedEntityId}
        intake={selectedReviewIntake}
        onApplied={() => {
          setIntakeNotice("Document workflow applied.");
          refreshDashboardData();
          queryClient.invalidateQueries({
            queryKey: ["dashboard-document-intakes", selectedEntityId],
          });
        }}
      />
    </section>
  ) : null;

  const upcomingEvents = [
    ...openObligations.slice(0, 5).map((item) => ({
      id: item.id,
      title: item.title,
      meta: item.category.replaceAll("_", " "),
      date: item.due_date,
      tone: obligationTone(item),
      href: "/properties",
    })),
    ...activeOnboardings.slice(0, 3).map((item) => ({
      id: item.id,
      title: "Tenant onboarding",
      meta: item.status,
      date: item.due_date,
      tone: "primary" as StatusTone,
      href: "/tenants",
    })),
  ].sort((a, b) => dueRank(a.date) - dueRank(b.date));

  const rentRollDetailsReady =
    demoMode || allMode || Boolean(rentRollQuery.data);
  const dashboardUnitCount = rentRollDetailsReady
    ? displayRentRoll.length
    : (dashboardOverview?.rent_roll.unit_count ?? 0);
  const dashboardOccupiedUnitCount = rentRollDetailsReady
    ? displayRentRoll.filter((row) => Boolean(row.lease_id)).length
    : (dashboardOverview?.rent_roll.occupied_unit_count ?? 0);
  const occupancyPercent = dashboardUnitCount
    ? Math.round((dashboardOccupiedUnitCount / dashboardUnitCount) * 100)
    : 0;
  const arrearsSnapshot =
    !allMode && !isIntakeWorkspace
      ? insightsOverviewQuery.data?.arrears_snapshot
      : null;
  const arrearsLoading =
    !allMode &&
    !isIntakeWorkspace &&
    insightsOverviewQuery.isLoading &&
    !insightsOverviewQuery.data;
  const arrearsHeadline = allMode
    ? "Single entity"
    : arrearsLoading
      ? "Checking"
      : arrearsSnapshot
        ? formatMoney(arrearsSnapshot.total_balance_cents)
        : formatMoney(0);
  const arrearsDetail = allMode
    ? "Select one entity for ageing detail."
    : arrearsLoading
      ? "Preparing arrears signal."
      : arrearsSnapshot && arrearsSnapshot.open_count > 0
        ? `${countLabel(arrearsSnapshot.open_count, "tenancy", "tenancies")} · ${arrearsSnapshot.oldest_age_days} days · ${
            arrearsSnapshot.promise_to_pay_count > 0 ? "promise logged" : "review"
          }`
        : "No active arrears right now.";
  const workQueueOpenCount = openObligations.length;
  const workQueueOverdueCount = openObligations.filter(
    (item) => dueRank(item.due_date) < 0,
  ).length;
  const workQueueScheduledCount = openObligations.filter(
    (item) => dueRank(item.due_date) >= 0,
  ).length;
  const workQueueUndatedCount = displayObligations.filter(
    (item) => !item.due_date,
  ).length;
  const workQueueDetail =
    obligationsLoading && !openObligations.length
      ? "Preparing work queue."
      : `${workQueueOverdueCount} overdue · ${workQueueScheduledCount} scheduled${
          workQueueUndatedCount ? ` · ${workQueueUndatedCount} undated` : ""
        }`;
  const workQueueNextAction =
    urgentObligations[0]?.title ??
    (workQueueOpenCount
      ? "Review open lease and compliance work."
      : "No urgent work needs action.");
  const billingReady = !billingMetricLoading && billingMetricCount === 0;
  const billingHeadline = billingMetricLoading
    ? "Checking"
    : billingReady
      ? "Invoice run ready"
      : `${billingMetricCount} ${billingMetricCount === 1 ? "blocker" : "blockers"}`;
  const billingDetail = billingMetricLoading
    ? "Checking billing readiness."
    : billingReady
      ? "No blockers from current data."
      : billingMetricNextAction;
  const overviewLeaseEvents = !allMode
    ? (insightsOverviewQuery.data?.lease_event_snapshot.next_events ?? [])
    : [];
  const dashboardOverviewEvents = dashboardOverview?.upcoming_lease_events ?? [];
  const dashboardHorizonEvents: HorizonDashboardEvent[] = overviewLeaseEvents
    .slice(0, 4)
    .map((event) => ({
      id: event.id,
      title: event.title,
      detail: dueLabel(event.date),
      date: event.date,
      href: event.href || "/properties",
      tone: eventToneFromDueDate(event.date),
    }));
  if (dashboardHorizonEvents.length === 0) {
    dashboardHorizonEvents.push(
      ...dashboardOverviewEvents.slice(0, 4).map((event) => ({
        id: event.id,
        title: event.title,
        detail: compactEntityDetail([
          event.property_name,
          event.unit_label,
          dueLabel(event.date),
        ]),
        date: event.date,
        href: "/properties",
        tone: eventToneFromDueDate(event.date),
      })),
    );
  }
  if (dashboardHorizonEvents.length === 0) {
    dashboardHorizonEvents.push(
      ...upcomingEvents.slice(0, 4).map((event) => ({
        id: event.id,
        title: event.title,
        detail: compactEntityDetail([event.meta, dueLabel(event.date)]),
        date: event.date,
        href: event.href,
        tone: eventToneFromDueDate(event.date),
      })),
    );
  }
  const leaseHorizonLoading =
    !allMode &&
    !isIntakeWorkspace &&
    insightsOverviewQuery.isLoading &&
    !insightsOverviewQuery.data &&
    !dashboardOverview;

  // Brand-new account (no entities/properties yet): show a friendly onboarding
  // welcome instead of firing entity-scoped queries and surfacing a red error.
  const zeroEntities =
    !demoMode &&
    !isIntakeWorkspace &&
    Boolean(entitiesQuery.data) &&
    (entitiesQuery.data?.length ?? 0) === 0;

  if (zeroEntities) {
    return (
      <main className="min-h-screen bg-leasium-canvas">
        <AppHeader>
          <EntityPicker
            entities={entitiesQuery.data}
            loading={entitiesQuery.isLoading}
            value={selectedEntityId}
            onChange={setSelectedEntityId}
            allowAllEntities={false}
          />
        </AppHeader>
        <div className="mx-auto grid max-w-none gap-[18px] px-5 py-5 lg:px-9 lg:py-7">
          <h1 className="sr-only">Dashboard</h1>
          <SectionPanel
            title="Welcome to Leasium"
            description="This workspace doesn't have any properties yet."
            icon={<Sparkles size={17} className="text-primary" />}
          >
            <div className="grid gap-4 p-5">
              <p className="max-w-2xl text-sm text-muted-foreground">
                Add your first property to get started — you can create its
                owning entity (a trust or company) in the same step. Or drop a
                lease, rent roll, or purchase contract into Leasium AI and let
                it extract the details for your review.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  onClick={() => window.location.assign("/properties")}
                >
                  <Building2 size={15} />
                  Add a property
                </Button>
                <SecondaryButton
                  type="button"
                  onClick={() => window.location.assign("/intake")}
                >
                  <FileUp size={15} />
                  Open Leasium AI
                </SecondaryButton>
              </div>
            </div>
          </SectionPanel>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-leasium-canvas">
      <AppHeader>
        <EntityPicker
          entities={entitiesQuery.data}
          loading={entitiesQuery.isLoading}
          value={selectedEntityId}
          onChange={setSelectedEntityId}
          allowAllEntities={!isIntakeWorkspace}
        />
      </AppHeader>

      <div className="mx-auto grid max-w-none gap-3 px-4 py-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] sm:gap-[18px] sm:px-5 sm:py-5 md:pb-7 lg:px-9 lg:py-7">
        {isIntakeWorkspace ? (
          <section className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <PageTitle className="text-[21px] leading-7 tracking-[-0.02em] sm:text-3xl sm:leading-9">
                Leasium AI
              </PageTitle>
              <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground sm:mt-1.5 sm:text-sm">
                <span className="sm:hidden">Drop a document or ask in plain English.</span>
                <span className="hidden sm:inline">
                  Drop a lease, invoice, contract, or question. Leasium AI reads first and asks before anything changes.
                </span>
              </p>
            </div>
            <div className="hidden flex-wrap items-center gap-2 sm:flex">
              {demoMode ? (
                <SecondaryButton
                  type="button"
                  onClick={() => setDemoMode((current) => !current)}
                >
                  <Layers3 size={15} />
                  View live portfolio
                </SecondaryButton>
              ) : null}
              <SecondaryButton
                type="button"
                onClick={refreshDashboardData}
                disabled={!selectedEntityId}
              >
                <RefreshCw size={15} />
                Refresh
              </SecondaryButton>
            </div>
          </section>
        ) : (
          <h1 className="sr-only">Dashboard</h1>
        )}

        {!isIntakeWorkspace ? (
          <section
            data-testid="dashboard-mobile-cockpit"
            className="grid gap-3 md:hidden"
            aria-label="Dashboard mobile summary"
          >
            <div>
              <p className="text-[19px] font-bold leading-6 tracking-normal text-foreground">
                Good morning, Temba
              </p>
              <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
                {formatDashboardTodayLabel()} · {dashboardMobileFocusSummary}
              </p>
            </div>
            <Link
              href="#ask-leasium"
              aria-label="Ask Leasium anything"
              className="flex min-h-11 items-center gap-2 rounded-full border border-leasium-card-border bg-white px-3.5 py-2.5 text-[13px] leading-5 text-muted-foreground shadow-[0_2px_8px_rgba(16,24,40,0.06)] transition duration-200 ease-leasium hover:border-primary/30 hover:text-foreground"
            >
              <Sparkles size={14} className="shrink-0 text-primary" />
              <span>Ask Leasium anything...</span>
            </Link>
          </section>
        ) : null}

        {dashboardError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-danger/20 bg-danger-soft p-4 text-sm text-danger">
            <div>
              <div className="font-semibold">
                Live data did not finish loading.
              </div>
              <div className="mt-1">{friendlyError(dashboardError)}</div>
            </div>
            <SecondaryButton
              type="button"
              onClick={() => {
                entitiesQuery.refetch();
                refreshDashboardData();
              }}
            >
              <RefreshCw size={15} />
              Retry
            </SecondaryButton>
          </div>
        ) : null}

        {dashboardLoading && !dashboardError ? (
          <SectionPanel
            title="Checking live portfolio"
            description={
              selectedEntityId
                ? "Checking portfolio records."
                : "Connecting to the live portfolio and selecting an entity."
            }
            icon={<Loader2 size={17} className="animate-spin text-primary" />}
            actions={
              dashboardRefreshing ? (
                <StatusBadge tone="primary">Refreshing</StatusBadge>
              ) : (
                <StatusBadge tone="neutral">Checking</StatusBadge>
              )
            }
            className="border-primary/20 bg-primary/5"
          >
            <div className="grid gap-3 p-4 text-sm text-muted-foreground sm:grid-cols-3">
              <div className="rounded-xl border border-border bg-white px-3 py-2">
                Entity access
              </div>
              <div className="rounded-xl border border-border bg-white px-3 py-2">
                Portfolio records
              </div>
              <div className="rounded-xl border border-border bg-white px-3 py-2">
                Dashboard queues
              </div>
            </div>
          </SectionPanel>
        ) : null}

        {!isIntakeWorkspace ? (
          <DashboardCommandCenter
            items={displayedCommandCenterItems}
            loading={commandCenterLoading}
            refreshing={dashboardRefreshing}
            counts={displayedCommandCenterCounts}
            actions={renderDashboardActions()}
          />
        ) : null}

        {!isIntakeWorkspace ? (
          <>
            <section
              data-testid="dashboard-horizon-bento"
              className="grid grid-cols-2 gap-3 sm:gap-[14px] lg:grid-cols-4"
            >
              <DashboardBentoCard
                href="/properties"
                label="Occupancy"
                icon={<Building2 size={14} />}
                className="h-[104px] sm:h-auto"
              >
                <div className="flex items-center gap-3 sm:gap-4">
                  <DashboardOccupancyRing percent={occupancyPercent} />
                  <div className="min-w-0">
                    <div className="text-lg font-bold leading-6 tracking-normal text-foreground sm:text-2xl">
                      {rentRollLoading && !dashboardUnitCount ? (
                        "Checking"
                      ) : (
                        <>
                          <span className="sm:hidden">
                            {dashboardOccupiedUnitCount}/{dashboardUnitCount}
                          </span>
                          <span className="hidden sm:inline">
                            {dashboardOccupiedUnitCount} of {dashboardUnitCount}
                          </span>
                        </>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                      <span className="sm:hidden">occupied</span>
                      <span className="hidden sm:inline">units occupied</span>
                    </p>
                  </div>
                </div>
              </DashboardBentoCard>

              <DashboardBentoCard
                href="/operations?tab=arrears"
                label="Arrears"
                icon={<ReceiptText size={14} />}
                className="h-[104px] sm:h-auto"
              >
                <div className="text-lg font-bold leading-6 tracking-normal text-foreground sm:text-2xl">
                  {arrearsHeadline}
                </div>
                <svg
                  className="mt-2 h-5 w-24 sm:h-7 sm:w-28"
                  viewBox="0 0 112 28"
                  role="presentation"
                  aria-hidden="true"
                >
                  <polyline
                    fill="none"
                    points="2,19 18,17 31,19 44,12 58,14 72,8 88,10 108,6"
                    stroke="var(--leasium-warning)"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                  />
                </svg>
                <p className="mt-auto line-clamp-1 pt-1 text-[10px] leading-4 text-warning-strong sm:line-clamp-none sm:pt-2 sm:text-[11px]">
                  <span className="sm:hidden">
                    {arrearsSnapshot && arrearsSnapshot.open_count > 0
                      ? `${arrearsSnapshot.oldest_age_days} days · ${
                          arrearsSnapshot.promise_to_pay_count > 0
                            ? "promise"
                            : "review"
                        }`
                      : arrearsDetail}
                  </span>
                  <span className="hidden sm:inline">{arrearsDetail}</span>
                </p>
              </DashboardBentoCard>

              <DashboardBentoCard
                href="/operations"
                label="Work queue"
                icon={<ClipboardList size={14} />}
                className="h-[104px] sm:h-auto"
              >
                <div className="text-lg font-bold leading-6 tracking-normal text-foreground sm:text-2xl">
                  {obligationsLoading && !workQueueOpenCount
                    ? "Checking"
                    : `${workQueueOpenCount} open`}
                </div>
                <div className="mt-2 sm:mt-3">
                  <DashboardSegmentBar
                    segments={[
                      {
                        label: "Overdue",
                        value: workQueueOverdueCount,
                        className: "bg-danger",
                      },
                      {
                        label: "Scheduled",
                        value: workQueueScheduledCount,
                        className: "bg-info",
                      },
                      {
                        label: "Undated",
                        value: workQueueUndatedCount,
                        className: "bg-leasium-slate-150",
                      },
                    ]}
                  />
                </div>
                <p className="mt-1 line-clamp-1 text-[10px] leading-4 text-muted-foreground sm:mt-2 sm:line-clamp-none sm:text-[11px]">
                  <span className="sm:hidden">
                    {workQueueOverdueCount
                      ? `${workQueueOverdueCount} needs you`
                      : `${workQueueScheduledCount} scheduled`}
                  </span>
                  <span className="hidden sm:inline">{workQueueDetail}</span>
                </p>
                <p className="mt-auto hidden line-clamp-1 pt-1 text-[10px] font-medium leading-4 text-foreground sm:block sm:pt-2 sm:text-[11px]">
                  {workQueueNextAction}
                </p>
              </DashboardBentoCard>

              <DashboardBentoCard
                href="/billing-readiness"
                label="Billing"
                icon={<CheckCircle2 size={14} />}
                className="h-[104px] sm:h-auto"
              >
                <div className="flex items-center gap-2 sm:gap-3">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-[10px] bg-accent-soft text-leasium-teal-strong sm:h-9 sm:w-9">
                    <CheckCircle2 size={16} className="sm:hidden" />
                    <CheckCircle2 size={17} className="hidden sm:block" />
                  </span>
                  <div className="min-w-0 text-[14px] font-semibold leading-5 text-foreground sm:text-[15px]">
                    {billingHeadline}
                  </div>
                </div>
                <p className="mt-1 hidden line-clamp-1 text-[10px] leading-4 text-muted-foreground sm:mt-2 sm:block sm:line-clamp-none sm:text-[11px]">
                  {billingDetail}
                </p>
                <span className="mt-auto pt-1 text-[11px] font-semibold text-primary sm:pt-2 sm:text-xs">
                  <span className="sm:hidden">Approve →</span>
                  <span className="hidden sm:inline">Review &amp; approve →</span>
                </span>
              </DashboardBentoCard>

              {/* Second bento row lives in the same grid so its column
                  edges land exactly on the 4-column tracks above (a
                  separate 2fr/1fr/1fr grid drifts ~6px per gutter) and
                  the row gap stays on the Figma 14px bento rhythm. */}
              <DashboardLeaseHorizon
                events={dashboardHorizonEvents}
                loading={leaseHorizonLoading}
                className="col-span-2"
              />

              <div className="col-span-2 md:hidden">
                <DashboardTrustRibbon variant="mobile" />
              </div>

              <div className="col-span-2 flex flex-wrap items-center justify-center gap-2 md:hidden">
                {renderDashboardActions()}
              </div>

              <DashboardBentoCard
                label="Onboarding"
                icon={<UserRound size={14} />}
                className="col-span-2 lg:col-span-1"
              >
                <div className="text-base font-bold tracking-normal text-foreground">
                  {onboardingLoading
                    ? "Checking"
                    : `${activeOnboardings.length} waiting · ${submittedOnboardings.length} in`}
                </div>
                <div className="mt-3">
                  <DashboardSegmentBar
                    segments={[
                      {
                        label: "Waiting",
                        value: activeOnboardings.length,
                        className: "bg-primary-soft",
                      },
                      {
                        label: "Submitted",
                        value: submittedOnboardings.length,
                        className: "bg-primary",
                      },
                    ]}
                  />
                </div>
                <Link
                  href="/properties"
                  className="mt-auto inline-flex min-h-11 items-center text-xs font-semibold text-primary transition hover:text-primary-hover"
                >
                  Manage links →
                </Link>
              </DashboardBentoCard>

              <DashboardBentoCard
                label="Leasium AI"
                icon={<FileUp size={14} />}
                dashed
                className="col-span-2 lg:col-span-1"
              >
                <div className="flex items-center gap-2">
                  <FileUp size={18} className="text-primary" />
                  <div className="text-sm font-semibold text-foreground">
                    Ask with a document
                  </div>
                </div>
                <p className="mt-2 max-w-[220px] text-[11px] leading-4 text-muted-foreground">
                  Lease, invoice, contract - Leasium AI reviews before anything changes.
                </p>
                <Link
                  href="/intake"
                  className="mt-auto inline-flex min-h-11 items-center text-xs font-semibold text-primary transition hover:text-primary-hover"
                >
                  Open Leasium AI
                </Link>
              </DashboardBentoCard>
            </section>

            <div className="hidden md:block">
              <DashboardTrustRibbon variant="desktop" />
            </div>
          </>
        ) : null}

        {isIntakeWorkspace ? (
          <section
            data-testid="leasium-ai-home"
            className={cn(
              "grid gap-3 sm:gap-4",
              selectedDocumentReviewPanel
                ? "mx-auto w-full max-w-5xl"
                : "mx-auto w-full max-w-6xl",
            )}
          >
            {lastApplyOutcome ? (
              <DocumentIntakeApplyOutcomeCard
                outcome={lastApplyOutcome}
                onDismiss={() => setLastApplyOutcome(null)}
              />
            ) : null}
            {selectedDocumentReviewPanel}

            {!selectedDocumentReviewPanel ? (
            <section
              data-testid="leasium-ai-home-composer"
              onDragEnter={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setDragActive(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                uploadSmartIntake(event.dataTransfer.files[0]);
              }}
              className={[
                "overflow-hidden rounded-[22px] border bg-[linear-gradient(135deg,var(--leasium-hero-wash-from)_0%,rgba(255,255,255,0.94)_46%,var(--leasium-hero-wash-to)_100%)] px-4 py-6 shadow-[0_18px_44px_rgba(36,91,255,0.08),0_1px_3px_rgba(16,24,40,0.04)] transition sm:px-6 sm:py-10 xl:px-10",
                dragActive
                  ? "border-primary ring-2 ring-primary/20"
                  : "border-primary/35",
                !selectedEntityId || documentIntakeMutation.isPending
                  ? "opacity-75"
                  : "",
              ].join(" ")}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.docx,.txt,.md,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(event) => {
                  uploadSmartIntake(event.target.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
                <div className="text-center">
                  <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-primary to-leasium-teal text-white shadow-leasiumXs">
                    <Sparkles size={22} />
                  </div>
                  <p className="text-2xl font-semibold leading-8 text-foreground sm:text-4xl sm:leading-[44px]">
                    Leasium AI
                  </p>
                  <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                    Ask a question, drop in a lease or invoice, and I&apos;ll talk you
                    through the next step before anything changes.
                  </p>
                </div>

                <div className="overflow-hidden rounded-[20px] border border-primary/20 bg-white/95 shadow-leasiumCard">
                  <textarea
                    value={landingQuestion}
                    onChange={(event) => setLandingQuestion(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        handleLandingAsk();
                      }
                    }}
                    placeholder="Ask Leasium anything, or add a file..."
                    className="min-h-[112px] w-full resize-none bg-white/95 px-4 py-4 text-base leading-7 text-foreground outline-none placeholder:text-muted-foreground sm:min-h-[132px] sm:px-5"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-primary/10 bg-gradient-to-r from-primary-soft/60 via-white to-accent-soft/70 px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={!selectedEntityId || documentIntakeMutation.isPending}
                        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-primary/20 bg-white px-3 text-sm font-medium text-primary-hover shadow-leasiumXs transition hover:border-primary/35 hover:bg-primary-soft disabled:opacity-50"
                      >
                        {documentIntakeMutation.isPending ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <FileUp size={16} />
                        )}
                        Files
                      </button>
                      <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-accent/25 bg-white px-3 text-sm font-medium text-leasium-teal-strong shadow-leasiumXs">
                        <Building2 size={16} />
                        <span className="sm:hidden">Portfolio</span>
                        <span className="hidden sm:inline">Current portfolio</span>
                      </span>
                      <span className="hidden min-h-11 items-center gap-2 rounded-full border border-warning/25 bg-white px-3 text-sm font-medium text-warning-strong shadow-leasiumXs sm:inline-flex">
                        <ShieldCheck size={16} />
                        Approval first
                      </span>
                    </div>
                    <Button
                      type="button"
                      onClick={() => {
                        if (landingQuestion.trim()) handleLandingAsk();
                        else fileInputRef.current?.click();
                      }}
                      disabled={landingAsking || !selectedEntityId}
                      className="min-h-11"
                    >
                      {landingAsking ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          Asking
                        </>
                      ) : (
                        <>
                          <Send size={16} />
                          Ask
                        </>
                      )}
                    </Button>
                    <div
                      data-testid="leasium-ai-home-guardrail"
                      className="flex min-h-9 w-full items-center gap-2 rounded-xl border border-accent/20 bg-accent-soft px-3 py-2 text-sm font-medium text-leasium-teal-strong"
                    >
                      <ShieldCheck size={15} className="shrink-0" />
                      <span>Nothing is sent, synced, charged, or changed until you approve it.</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap justify-center gap-2">
                  {[
                    { label: "Add a lease", icon: <FileText size={15} /> },
                    {
                      label: "Use an old invoice",
                      mobileLabel: "Old invoice",
                      icon: <ReceiptText size={15} />,
                    },
                    {
                      label: "What's overdue?",
                      mobileLabel: "Overdue?",
                      icon: <ClipboardList size={15} />,
                      ask: "What's overdue?",
                    },
                    {
                      label: "Onboard a tenant",
                      mobileLabel: "Onboard",
                      icon: <UserRound size={15} />,
                    },
                    {
                      label: "Draft a rent review",
                      icon: <FileText size={15} />,
                    },
                  ].map(
                    (chip) => (
                      <button
                        key={chip.label}
                        type="button"
                        onClick={() => {
                          if ("ask" in chip && chip.ask) {
                            void handleLandingAsk(chip.ask);
                            return;
                          }
                          fileInputRef.current?.click();
                        }}
                        disabled={!selectedEntityId}
                        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-primary/15 bg-white px-3 text-sm font-medium text-primary-hover shadow-leasiumXs transition hover:border-primary/35 hover:bg-primary-soft disabled:opacity-50"
                      >
                        {chip.icon}
                        {chip.mobileLabel ? (
                          <>
                            <span className="sm:hidden">{chip.mobileLabel}</span>
                            <span className="hidden sm:inline">{chip.label}</span>
                          </>
                        ) : (
                          chip.label
                        )}
                      </button>
                    ),
                  )}
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    or email to intake@leasium.ai
                  </span>
                </div>
                {documentIntakeMutation.isPending ? (
                  <div className="flex flex-col gap-3 border-t border-border pt-4">
                    {documentIntakeMutation.variables ? (
                      <div className="flex justify-end">
                        <div className="inline-flex max-w-[85%] items-center gap-2 rounded-2xl rounded-tr-md bg-info-soft px-3 py-2 text-sm text-foreground">
                          <FileText size={14} className="shrink-0" />
                          <span className="truncate">
                            {documentIntakeMutation.variables.name}
                          </span>
                        </div>
                      </div>
                    ) : null}
	                    <div className="flex gap-2">
	                      <span
	                        aria-hidden
	                        className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-leasium-teal-strong"
	                      >
	                        <Sparkles size={14} />
	                      </span>
                      <p
                        aria-live="polite"
                        className="inline-flex items-center gap-2 pt-1 text-sm text-muted-foreground"
                      >
                        <Loader2 size={14} className="animate-spin" />
                        Reading your document…
                      </p>
                    </div>
                  </div>
                ) : null}
                {intakeError ? (
                  <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
                    {intakeError}
                  </div>
                ) : null}
                {intakeNotice ? (
                  <div className="rounded-md bg-primary/5 px-3 py-2 text-sm text-primary">
                    {intakeNotice}
                  </div>
                ) : null}
                {landingAsks.length > 0 ? (
                  <div className="flex flex-col gap-3 border-t border-border pt-4">
                    {landingAsks.map((turn, i) => (
                      <div key={i} className="flex flex-col gap-2">
                        <div className="flex justify-end">
                          <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-info-soft px-3 py-2 text-sm text-foreground">
                            {turn.question}
                          </div>
                        </div>
	                        <div className="flex gap-2">
	                          <span
	                            aria-hidden
	                            className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-leasium-teal-strong"
	                          >
	                            <Sparkles size={14} />
	                          </span>
                          <div className="min-w-0 flex-1 space-y-2">
                            {turn.error ? (
                              <p className="text-sm text-danger">{turn.error}</p>
                            ) : turn.answer === null ? (
                              <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 size={14} className="animate-spin" /> Thinking…
                              </p>
                            ) : (
                              <>
                                <p className="text-sm leading-6 text-foreground">
                                  {turn.answer}
                                </p>
                                {turn.citations.length > 0 ? (
                                  <div className="flex flex-wrap gap-2">
                                    {turn.citations.map((citation, ci) => (
                                      <span
                                        key={ci}
                                        className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                                      >
                                        {(typeof citation.label === "string" &&
                                          citation.label) ||
                                          "Source"}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="hidden flex-wrap items-center gap-2 rounded-xl border border-primary/15 bg-white px-3 py-2 text-xs leading-5 text-muted-foreground sm:flex">
                  <StatusBadge tone="primary">Local-only until approval</StatusBadge>
                  <span>
                    I can read and suggest from here. Xero, email, payments, and reconciliation still need a separate approval.
                  </span>
                </div>
              </div>
            </section>
            ) : null}

            {!selectedDocumentReviewPanel ? (
            <section
              data-testid="leasium-ai-home-rail"
              className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]"
            >
              <div
                data-testid="smart-intake-review-panel"
                className="overflow-visible sm:overflow-hidden sm:rounded-2xl sm:border sm:border-border sm:bg-white sm:shadow-leasiumCard xl:rounded-[16px]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 pb-0 sm:border-b sm:border-border sm:px-4 sm:py-3">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">
                      Documents waiting
                    </h2>
                    <p className="mt-1 hidden text-sm leading-5 text-muted-foreground sm:block">
                      Open one document at a time. Leasium AI will ask what it needs before anything changes.
                    </p>
                  </div>
                  <StatusBadge
                    tone={needsReviewCount ? "primary" : "neutral"}
                    className="hidden sm:inline-flex xl:inline-flex"
                  >
                    {documentIntakesLoading
                      ? "Preparing"
                      : `${filteredReviewIntakes.length}`}
                  </StatusBadge>
                </div>
                <div className="hidden flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/25 px-4 py-3 sm:flex">
                  <Select
                    aria-label="Review filter"
                    className="h-11 min-h-11 w-full rounded-md sm:w-56"
                    value={reviewQueueFilter}
                    onChange={(event) => {
                      setReviewQueueFilter(
                        event.target.value as ReviewQueueFilter,
                      );
                      setReviewIntakeId(null);
                      setRequestedReviewId(null);
                    }}
                  >
                    <option value="all">All reviews</option>
                    <option value="tenant_portal">Tenant portal uploads</option>
                    <option value="inbound_email_attachment">
                      Inbound email attachments
                    </option>
                    <option value="lease_match">Lease matches</option>
                    <option value="insurance_certificate">Insurance</option>
                    <option value="inspection_report">Inspections</option>
                    <option value="lease">Leases</option>
                  </Select>
                  <div className="flex flex-wrap gap-2">
                    <SecondaryButton
                      type="button"
                      className="h-11"
                      onClick={() => {
                        void copyReviewQueueCsv();
                      }}
                      disabled={
                        documentIntakesLoading ||
                        filteredReviewIntakes.length === 0
                      }
                    >
                      <Copy size={15} />
                      Copy review queue CSV
                    </SecondaryButton>
                    <SecondaryButton
                      type="button"
                      className="h-11"
                      onClick={downloadReviewQueueCsv}
                      disabled={
                        documentIntakesLoading ||
                        filteredReviewIntakes.length === 0
                      }
                    >
                      <Download size={15} />
                      Download queue CSV
                    </SecondaryButton>
                  </div>
                </div>
                <div className="grid gap-3 pt-3 sm:block sm:divide-y sm:divide-border sm:pt-0">
                  {filteredReviewIntakes.slice(0, 3).map((item, index) => {
                    const propertyName = firstField(
                      item.extracted_data.properties,
                      "name",
                    );
                    const tenantName =
                      firstField(item.extracted_data.parties, "name") ??
                      fieldText(item.extracted_data.suggested_links?.tenant_name);
                    const sourceInfo = intakeSourceInfo(item);
                    return (
                      <div
                        key={item.id}
                        data-testid={`review-intake-${item.id}`}
                        className={cn(
                          "relative grid gap-2 overflow-hidden rounded-[14px] border border-border bg-white py-3 pl-[18px] pr-[14px] text-sm shadow-leasiumCard sm:gap-3 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent sm:px-4 sm:shadow-none sm:grid-cols-[3px_minmax(0,1fr)_auto] sm:items-start",
                          index > 1 ? "hidden sm:grid" : null,
                        )}
                      >
                        <div
                          aria-hidden="true"
                          className={cn(
                            "absolute inset-y-0 left-0 w-1 sm:static sm:block sm:h-full sm:min-h-14 sm:rounded-full",
                            intakeStatusRailClassName(item.status),
                          )}
                        />
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-foreground">
                            {item.filename}
                          </div>
                          <div className="mt-1 hidden flex-wrap gap-2 text-xs text-muted-foreground sm:flex">
                            <span>{documentTypeLabel(item.document_type)}</span>
                            <span>{formatDateTime(item.created_at)}</span>
                          </div>
                          {item.status === "reading" ||
                          item.status === "uploaded" ? (
                            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                              <Loader2 size={13} className="animate-spin" />
                              Reading document and preparing review.
                            </div>
                          ) : null}
                          {item.summary ? (
                            <p className="mt-1 line-clamp-1 text-[11px] leading-4 text-muted-foreground sm:mt-2 sm:line-clamp-2 sm:text-sm sm:leading-5">
                              {item.summary}
                            </p>
                          ) : null}
                          {sourceInfo ? (
                            <div className="mt-2 hidden flex-wrap items-center gap-2 text-xs sm:flex">
                              <StatusBadge tone="primary">
                                {sourceInfo.label}
                              </StatusBadge>
                              <span className="text-muted-foreground">
                                {sourceInfo.detail}
                              </span>
                            </div>
                          ) : null}
                          <div className="mt-2 hidden flex-wrap gap-2 text-xs sm:flex">
                            {propertyName ? (
                              <span className="rounded-md bg-muted px-2 py-1">
                                {propertyName}
                              </span>
                            ) : null}
                            {tenantName ? (
                              <span className="rounded-md bg-muted px-2 py-1">
                                {tenantName}
                              </span>
                            ) : null}
                            <span className="rounded-md bg-muted px-2 py-1">
                              {confidenceLabel(item.confidence)}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2 pt-1 sm:flex-col sm:items-end sm:pt-0">
                          <StatusBadge
                            tone={intakeStatusTone(item.status)}
                            className="hidden sm:inline-flex"
                          >
                            {intakeStatusLabel(item.status)}
                          </StatusBadge>
                          <SecondaryButton
                            type="button"
                            className="min-h-11"
                            onClick={() => setReviewIntakeId(item.id)}
                          >
                            Review
                          </SecondaryButton>
                          <SecondaryButton
                            type="button"
                            className="hidden min-h-11 sm:inline-flex"
                            title={
                              intakeIsActive(item)
                                ? "Stop reviewing and clear"
                                : "Clear"
                            }
                            onClick={() =>
                              deleteDocumentIntakeMutation.mutate(item.id)
                            }
                            disabled={
                              item.id.startsWith("demo-") ||
                              deleteDocumentIntakeMutation.isPending
                            }
                          >
                            <X size={14} />
                            Clear
                          </SecondaryButton>
                        </div>
                      </div>
                    );
                  })}
                  {documentIntakesLoading ? (
                    <SkeletonRows rows={3} />
                  ) : reviewIntakes.length === 0 ? (
                    <EmptyState
                      icon={<CheckCircle2 size={18} />}
                      title="No documents waiting for review."
                      description="Ask Leasium AI with a lease, acquisition contract, invoice, guarantee, insurance certificate, or tenant document to start your first review."
                    />
                  ) : filteredReviewIntakes.length === 0 ? (
                    <EmptyState
                      icon={<CheckCircle2 size={18} />}
                      title="No matching reviews."
                      description="Change the review filter to see other waiting documents."
                    />
                  ) : null}
                </div>
                <div className="hidden flex-wrap gap-2 border-t border-border bg-muted/25 px-4 py-3 sm:flex">
                  <Link
                    href="/properties?action=new"
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-border bg-white px-3 text-sm font-medium shadow-leasiumXs transition hover:bg-muted"
                  >
                    <Layers3 size={16} />
                    Add property
                  </Link>
                  <Link
                    href="/tenants?action=invite"
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-border bg-white px-3 text-sm font-medium shadow-leasiumXs transition hover:bg-muted"
                  >
                    <UserRound size={16} />
                    Add tenant
                  </Link>
                </div>
              </div>

              <div
                data-testid="smart-intake-applied-panel"
                className="hidden overflow-hidden rounded-2xl border border-border bg-white shadow-leasiumCard xl:block"
              >
                <div className="border-b border-border px-4 py-3">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Recently applied — full provenance
                  </h2>
                  <p className="mt-1 text-sm leading-5 text-muted-foreground">
                    Approved documents stay visible with the workflow evidence
                    they created.
                  </p>
                </div>
                <div className="divide-y divide-border">
                  {recentlyAppliedIntakes.map((item) => (
                    <div
                      key={item.id}
                      className="grid gap-2 px-4 py-4 text-sm"
                    >
                      <div className="flex items-start gap-3">
                        <span className="mt-1 h-2 w-2 rounded-full bg-success" />
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-foreground">
                            {item.filename}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {formatDateTime(
                              item.applied_at ??
                                item.reviewed_at ??
                                item.updated_at,
                            )}{" "}
                            · approved by operator
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 pl-5 text-xs">
                        {smartIntakeAppliedChips(item).map((chip) => (
                          <span
                            key={chip}
                            className="rounded-md bg-success/10 px-2 py-1 text-success"
                          >
                            {chip}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                  {documentIntakesLoading ? (
                    <SkeletonRows rows={3} />
                  ) : recentlyAppliedIntakes.length === 0 ? (
                    <EmptyState
                      icon={<Clock3 size={18} />}
                      title="No recently applied documents."
                      description="Approved reviews will appear here with source-backed provenance."
                    />
                  ) : null}
                </div>
              </div>
            </section>
            ) : null}

            {!selectedDocumentReviewPanel ? (
              <RegisterImportPanel
                entityId={selectedEntityId}
                onApplied={refreshDashboardData}
              />
            ) : null}
          </section>
        ) : null}

        {/* UpcomingLeaseEventsPanel + CompliancePanel are driven by the
            single-entity insights rollup (getInsightsOverview), which is not
            a safely additive cross-entity number. In all-mode we scope them off
            with a clear note rather than fabricating a merged value. */}
        {!isIntakeWorkspace && allMode ? (
          <SectionPanel
            title="Lease events & compliance"
            icon={<CalendarClock size={17} className="text-primary" />}
          >
            <div className="p-4 text-sm text-muted-foreground">
              Lease events and compliance roll-ups are shown when a single entity
              is selected.
            </div>
          </SectionPanel>
        ) : null}

        {!isIntakeWorkspace && !allMode ? (
          <UpcomingLeaseEventsPanel
            overview={insightsOverviewQuery.data}
            isLoading={insightsOverviewQuery.isLoading}
          />
        ) : null}

        {!isIntakeWorkspace && !allMode ? (
          <CompliancePanel
            overview={insightsOverviewQuery.data}
            isLoading={insightsOverviewQuery.isLoading}
          />
        ) : null}

        {/* Ask Leasium + Activity feed are single-entity scoped surfaces. In
            all-mode we pass the empty scoped id so they fall back to their
            "select an entity" state rather than firing with the sentinel. */}
        {!isIntakeWorkspace ? (
          <AskLeasiumPanel entityId={scopedEntityId} />
        ) : null}

        {!isIntakeWorkspace ? (
          <ActivityFeedPanel entityId={scopedEntityId} />
        ) : null}
      </div>
    </main>
  );
}
