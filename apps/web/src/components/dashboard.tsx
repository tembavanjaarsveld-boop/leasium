"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Download,
  FileText,
  FileUp,
  Layers3,
  Link2,
  Loader2,
  ReceiptText,
  RefreshCw,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { ActivityFeedPanel } from "@/components/dashboard/ActivityFeedPanel";
import { AskLeasiumPanel } from "@/components/dashboard/AskLeasiumPanel";
import {
  type CommandCenterCounts,
  type CommandCenterItem,
  DashboardCommandCenter,
} from "@/components/dashboard/DashboardCommandCenter";
import {
  computeOpenObligationTrend,
  DashboardMetricCard,
  type DashboardMetricTrend,
} from "@/components/dashboard/DashboardMetricCard";
import { UpcomingLeaseEventsPanel } from "@/components/dashboard/UpcomingLeaseEventsPanel";
import { RegisterImportPanel } from "@/app/intake/register-import-panel";
import { saveBlob } from "@/lib/download";
import {
  EvidenceSourceTrail,
  type EvidenceFieldChange,
  type EvidenceHistoryRow,
  type EvidenceSourceLocation,
} from "@/components/evidence-drawer";
import {
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SecondaryButton,
  SectionPanel,
  Select,
  SkeletonRows,
  StatusBadge,
} from "@/components/ui";
import {
  acceptDocumentIntakeLeaseMatch,
  applyDocumentIntake,
  createDocumentIntake,
  deleteDocumentIntake,
  getDashboardOverview,
  DocumentIntakeExtraction,
  DocumentIntakeRecord,
  LeaseRecord,
  listEntities,
  listDocumentIntakes,
  listLeasesByProperty,
  listObligations,
  listProperties,
  getInsightsOverview,
  type InsightsOverviewRecord,
  listRentRoll,
  listTenancyUnits,
  listTenantOnboardings,
  listTenants,
  type DashboardOverviewRecord,
  ObligationRecord,
  PropertyRecord,
  RentRollRow,
  reviewDocumentIntake,
  TenancyUnitRecord,
  TenantRecord,
  TenantOnboardingRecord,
} from "@/lib/api";

const ENTITY_STORAGE_KEY = "leasium.entity_id";
const ENTITY_CHANGED_EVENT = "leasium:entity-id-change";
const DEMO_MODE_STORAGE_KEY = "leasium.demo_mode";
type StatusTone = "neutral" | "success" | "warning" | "danger" | "primary";
type ReviewItemAction = "approve" | "edit" | "ignore";
type ReviewApplyTarget = {
  propertyId: string;
  tenancyUnitId: string;
  tenantId: string;
  leaseId: string;
};
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
  return (
    requestedEntityId ?? window.localStorage.getItem(ENTITY_STORAGE_KEY) ?? ""
  );
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

function friendlyError(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
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

function csvCell(value: string | number | null | undefined) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
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

function safeCurrency(value: unknown) {
  const text = fieldText(value) ?? "AUD";
  return /^[A-Z]{3}$/.test(text) ? text : "AUD";
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

function leaseAutoMatchStatusLabel(status: string) {
  switch (status) {
    case "matched":
      return "Matched to scoped lease";
    case "needs_review":
      return "Needs review";
    default:
      return "Candidate match";
  }
}

function leaseAutoMatchTone(status: string): StatusTone {
  if (status === "matched") {
    return "success";
  }
  if (status === "needs_review") {
    return "warning";
  }
  return "primary";
}

function leaseAutoMatchFieldLabel(field: string) {
  switch (field) {
    case "commencement_date":
      return "Start date";
    case "expiry_date":
      return "Expiry date";
    case "annual_rent_cents":
      return "Annual rent";
    default:
      return field.replaceAll("_", " ");
  }
}

function leaseAutoMatchValue(field: string, value: unknown) {
  if (field === "annual_rent_cents" && typeof value === "number") {
    return formatMoney(value);
  }
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "-";
}

function appliedSource(value: unknown): AppliedPropertySource | null {
  if (!isRecord(value)) {
    return null;
  }
  const source = {
    sourceHint: fieldText(value.source_hint) ?? fieldText(value.hint),
    citation: fieldText(value.citation) ?? fieldText(value.text),
    confidence: fieldNumber(value.confidence),
  };
  return source.sourceHint || source.citation || source.confidence !== null
    ? source
    : null;
}

function appliedPropertyChanges(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }
      const field = fieldText(item.field);
      if (!field) {
        return null;
      }
      return {
        field,
        before: item.before,
        after: item.after,
        source: appliedSource(item.source),
      };
    })
    .filter((item): item is AppliedPropertyChange => item !== null);
}

function appliedScheduleRowSkips(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }
      const blockers = fieldTextList(item.blockers);
      if (blockers.length === 0) {
        return null;
      }
      return {
        unitLabel: fieldText(item.unit_label),
        tenantName: fieldText(item.tenant_name),
        blockers,
      };
    })
    .filter((item): item is AppliedScheduleRowSkip => item !== null);
}

function appliedChargeRuleSummaries(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }
      const id = fieldText(item.id);
      const chargeType = fieldText(item.charge_type);
      if (!id || !chargeType) {
        return null;
      }
      return {
        id,
        leaseId: fieldText(item.lease_id),
        chargeType,
        amountCents: fieldNumber(item.amount_cents),
        frequency: fieldText(item.frequency),
        label: fieldText(item.label),
        sourceHint: fieldText(item.source_hint),
      };
    })
    .filter((item): item is AppliedChargeRuleSummary => item !== null);
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

function appliedReviewData(record: DocumentIntakeRecord) {
  const applied = record.review_data?.applied;
  return applied && typeof applied === "object"
    ? (applied as Record<string, unknown>)
    : {};
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

function itemConfidence(
  item: Record<string, unknown>,
  fallback: number | null | undefined,
) {
  return typeof item.confidence === "number" ? item.confidence : fallback;
}

function itemSource(item: Record<string, unknown>) {
  const page = typeof item.page === "number" ? `Page ${item.page}` : null;
  return (
    fieldText(item.source_hint) ??
    fieldText(item.source) ??
    fieldText(item.source_clause) ??
    fieldText(item.clause) ??
    page
  );
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

const reviewGroups: Array<{
  key: ReviewGroupKey;
  title: string;
  fields: Array<{
    key: string;
    label: string;
    type?: "text" | "date" | "number";
  }>;
}> = [
  {
    key: "parties",
    title: "Parties",
    fields: [
      { key: "name", label: "Name" },
      { key: "role", label: "Role" },
      { key: "contact", label: "Contact" },
    ],
  },
  {
    key: "properties",
    title: "Properties",
    fields: [
      { key: "name", label: "Name" },
      { key: "address", label: "Address" },
      { key: "unit_label", label: "Unit" },
    ],
  },
  {
    key: "key_dates",
    title: "Dates",
    fields: [
      { key: "label", label: "Label" },
      { key: "date", label: "Date", type: "date" },
      { key: "source_hint", label: "Source" },
    ],
  },
  {
    key: "money_amounts",
    title: "Money",
    fields: [
      { key: "label", label: "Label" },
      { key: "amount", label: "Amount", type: "number" },
      { key: "currency", label: "Currency" },
      { key: "frequency", label: "Frequency" },
    ],
  },
  {
    key: "obligations",
    title: "Obligations",
    fields: [
      { key: "title", label: "Title" },
      { key: "due_date", label: "Due", type: "date" },
      { key: "category", label: "Category" },
    ],
  },
  {
    key: "inspection_findings",
    title: "Inspection findings",
    fields: [
      { key: "title", label: "Title" },
      { key: "description", label: "Description" },
      { key: "location", label: "Location" },
      { key: "category", label: "Category" },
      { key: "priority", label: "Priority" },
      { key: "due_date", label: "Due", type: "date" },
      { key: "source_hint", label: "Source" },
    ],
  },
];

function cloneExtraction(
  value: DocumentIntakeExtraction,
): DocumentIntakeExtraction {
  return JSON.parse(JSON.stringify(value)) as DocumentIntakeExtraction;
}

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
  return {
    label: "Inbound email attachment",
    detail: subject ? `Email subject: ${subject}` : "Routed from tenant email",
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

function intakeReviewHref(entityId: string, intakeId: string) {
  const params = new URLSearchParams({
    entity_id: entityId,
    review: intakeId,
  });
  return `/intake?${params.toString()}`;
}

function groupItems(
  draft: DocumentIntakeExtraction,
  key: ReviewGroupKey,
): Array<Record<string, unknown>> {
  const value = draft[key];
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "object")
    : [];
}

function updateGroupItem(
  draft: DocumentIntakeExtraction,
  key: ReviewGroupKey,
  index: number,
  field: string,
  value: string,
): DocumentIntakeExtraction {
  const next = cloneExtraction(draft);
  const items = groupItems(next, key).map((item) => ({ ...item }));
  items[index] = { ...(items[index] ?? {}), [field]: value };
  next[key] = items as never;
  return next;
}

function itemReviewAction(item: Record<string, unknown>): ReviewItemAction {
  const action = fieldText(item._review_action);
  return action === "edit" || action === "ignore" ? action : "approve";
}

function setGroupItemAction(
  draft: DocumentIntakeExtraction,
  key: ReviewGroupKey,
  index: number,
  action: ReviewItemAction,
): DocumentIntakeExtraction {
  return updateGroupItem(draft, key, index, "_review_action", action);
}

function cleanReviewItem(item: Record<string, unknown>) {
  const { _review_action: _reviewAction, ...cleaned } = item;
  void _reviewAction;
  return cleaned;
}

function buildIncludedReviewData(
  draft: DocumentIntakeExtraction,
  included: Record<ReviewGroupKey, boolean>,
): DocumentIntakeExtraction {
  const next = cloneExtraction(draft);
  reviewGroups.forEach((group) => {
    if (!included[group.key]) {
      next[group.key] = [] as never;
      return;
    }
    next[group.key] = groupItems(next, group.key)
      .filter((item) => itemReviewAction(item) !== "ignore")
      .map(cleanReviewItem) as never;
  });
  return next;
}

function insuranceExpiryDate(data: DocumentIntakeExtraction) {
  const labels = [
    "expiry",
    "expires",
    "expiration",
    "valid until",
    "policy end",
    "period end",
  ];
  return groupItems(data, "key_dates").find((item) => {
    const label = fieldText(item.label)?.toLowerCase() ?? "";
    return (
      labels.some((fragment) => label.includes(fragment)) &&
      fieldText(item.date)
    );
  });
}

function documentWorkflowType(
  draft: DocumentIntakeExtraction,
  intake: DocumentIntakeRecord,
) {
  const type = fieldText(draft.document_type ?? intake.document_type);
  return type &&
    [
      "lease",
      "insurance_certificate",
      "bank_guarantee",
      "compliance",
      "invoice_admin",
      "purchase_contract",
      "inspection_report",
      "notice",
    ].includes(type)
    ? type
    : null;
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

function reviewItemWithLabel(
  data: DocumentIntakeExtraction,
  group: ReviewGroupKey,
  labels: string[],
) {
  return groupItems(data, group).find((item) => {
    const label =
      fieldText(item.label ?? item.title ?? item.role)?.toLowerCase() ?? "";
    return labels.some((fragment) => label.includes(fragment));
  });
}

function reviewDateWithLabel(data: DocumentIntakeExtraction, labels: string[]) {
  return reviewItemWithLabel(data, "key_dates", labels);
}

function reviewedTenantName(data: DocumentIntakeExtraction) {
  const tenant =
    groupItems(data, "parties").find((item) =>
      (fieldText(item.role)?.toLowerCase() ?? "").includes("tenant"),
    ) ?? groupItems(data, "parties")[0];
  return fieldText(tenant?.name);
}

function hasReviewedLeaseBasics(
  data: DocumentIntakeExtraction,
  target: ReviewApplyTarget,
) {
  const property = groupItems(data, "properties")[0];
  const start = reviewDateWithLabel(data, ["commencement", "start"]);
  const expiry = reviewDateWithLabel(data, ["expiry", "expires", "end"]);
  const rent = reviewItemWithLabel(data, "money_amounts", [
    "annual rent",
    "base rent",
    "rent",
  ]);
  const rentAmount = rent?.amount;
  return Boolean(
    (target.propertyId || fieldText(property?.name ?? property?.address)) &&
    (target.tenancyUnitId || fieldText(property?.unit_label)) &&
    (target.tenantId || reviewedTenantName(data)) &&
    fieldText(start?.date ?? start?.due_date) &&
    fieldText(expiry?.date ?? expiry?.due_date) &&
    (fieldText(rentAmount) !== null || fieldNumber(rentAmount) !== null),
  );
}

function leaseGeneratedTaskCount(data: DocumentIntakeExtraction) {
  const datedObligations = groupItems(data, "obligations").filter(
    (item) => fieldText(item.due_date ?? item.date) && fieldText(item.title),
  ).length;
  const expiry = reviewDateWithLabel(data, ["expiry", "expires", "end"]);
  const review = reviewDateWithLabel(data, [
    "rent review",
    "review date",
    "cpi review",
  ]);
  return (
    datedObligations +
    (fieldText(expiry?.date ?? expiry?.due_date) ? 1 : 0) +
    (fieldText(review?.date ?? review?.due_date) ? 1 : 0)
  );
}

function applicableObligationCount(
  data: DocumentIntakeExtraction,
  workflowType: string | null,
) {
  if (workflowType === "inspection_report") {
    return groupItems(data, "inspection_findings").filter((item) =>
      fieldText(item.title),
    ).length;
  }
  if (workflowType === "lease") {
    return leaseGeneratedTaskCount(data);
  }
  const datedObligations = groupItems(data, "obligations").filter(
    (item) => fieldText(item.due_date ?? item.date) && fieldText(item.title),
  ).length;
  if (datedObligations > 0) {
    return datedObligations;
  }
  if (!workflowType) {
    return 0;
  }
  if (workflowType === "insurance_certificate") {
    return insuranceExpiryDate(data) ? 1 : 0;
  }
  const datedKeyDate = groupItems(data, "key_dates").some((item) =>
    fieldText(item.date ?? item.due_date),
  );
  return datedKeyDate ? 1 : 0;
}

function firstApplicableDueDate(
  data: DocumentIntakeExtraction,
  workflowType: string | null,
) {
  if (workflowType === "inspection_report") {
    return (
      groupItems(data, "inspection_findings")
        .map((item) => fieldText(item.due_date ?? item.date))
        .find(Boolean) ?? null
    );
  }
  const obligationDate = groupItems(data, "obligations")
    .map((item) => fieldText(item.due_date ?? item.date))
    .find(Boolean);
  if (obligationDate) {
    return obligationDate;
  }
  if (workflowType === "lease") {
    const start = reviewDateWithLabel(data, ["commencement", "start"]);
    return fieldText(start?.date ?? start?.due_date);
  }
  if (workflowType === "insurance_certificate") {
    const expiry = insuranceExpiryDate(data);
    return fieldText(expiry?.date ?? expiry?.due_date);
  }
  return (
    groupItems(data, "key_dates")
      .map((item) => fieldText(item.date ?? item.due_date))
      .find(Boolean) ?? null
  );
}

function ignoredReviewItemCount(
  draft: DocumentIntakeExtraction,
  included: Record<ReviewGroupKey, boolean>,
) {
  return reviewGroups.reduce(
    (total, group) =>
      total +
      (included[group.key]
        ? groupItems(draft, group.key).filter(
            (item) => itemReviewAction(item) === "ignore",
          ).length
        : groupItems(draft, group.key).length),
    0,
  );
}

function applyTargetLabel(
  target: ReviewApplyTarget,
  properties: PropertyRecord[],
  units: TenancyUnitRecord[],
  leases: LeaseRecord[],
) {
  const property = properties.find((item) => item.id === target.propertyId);
  const unit = units.find((item) => item.id === target.tenancyUnitId);
  const lease = leases.find((item) => item.id === target.leaseId);
  const parts = [
    property?.name,
    unit?.unit_label,
    lease ? `${lease.status} lease` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" / ") : "Portfolio level";
}

function reviewedLeaseTargetLabel(
  data: DocumentIntakeExtraction,
  target: ReviewApplyTarget,
  properties: PropertyRecord[],
  units: TenancyUnitRecord[],
  tenants: TenantRecord[],
) {
  const property = properties.find((item) => item.id === target.propertyId);
  const unit = units.find((item) => item.id === target.tenancyUnitId);
  const tenant = tenants.find((item) => item.id === target.tenantId);
  const reviewedProperty = groupItems(data, "properties")[0];
  const parts = [
    property?.name ?? fieldText(reviewedProperty?.name),
    unit?.unit_label ?? fieldText(reviewedProperty?.unit_label),
    tenant?.legal_name ?? reviewedTenantName(data),
  ].filter(Boolean);
  return parts.length ? parts.join(" / ") : "Reviewed lease details";
}

function reviewedPropertyTargetLabel(
  data: DocumentIntakeExtraction,
  target: ReviewApplyTarget,
  properties: PropertyRecord[],
  units: TenancyUnitRecord[],
) {
  const property = properties.find((item) => item.id === target.propertyId);
  const unit = units.find((item) => item.id === target.tenancyUnitId);
  const reviewedProperty = groupItems(data, "properties")[0];
  const parts = [
    property?.name ??
      fieldText(reviewedProperty?.name ?? reviewedProperty?.address),
    unit?.unit_label ?? fieldText(reviewedProperty?.unit_label),
  ].filter(Boolean);
  return parts.length ? parts.join(" / ") : "Reviewed property details";
}

function leaseApplyPlanRows(
  data: DocumentIntakeExtraction,
  target: ReviewApplyTarget,
  properties: PropertyRecord[],
  units: TenancyUnitRecord[],
  tenants: TenantRecord[],
  obligationCount: number,
) {
  const property = properties.find((item) => item.id === target.propertyId);
  const unit = units.find((item) => item.id === target.tenancyUnitId);
  const tenant = tenants.find((item) => item.id === target.tenantId);
  const reviewedProperty = groupItems(data, "properties")[0];
  const reviewedPropertyName = fieldText(
    reviewedProperty?.name ?? reviewedProperty?.address,
  );
  const reviewedUnitLabel = fieldText(reviewedProperty?.unit_label);
  const reviewedTenant = reviewedTenantName(data);
  return [
    {
      label: "Property",
      value: property
        ? `Link only to ${property.name}`
        : reviewedPropertyName
          ? `Create new property: ${reviewedPropertyName}`
          : "Property detail needed",
      tone:
        property || reviewedPropertyName
          ? ("success" as const)
          : ("danger" as const),
    },
    {
      label: "Unit",
      value: unit
        ? `Link only to ${unit.unit_label}`
        : reviewedUnitLabel
          ? `Create new unit: ${reviewedUnitLabel}`
          : "Unit detail needed",
      tone:
        unit || reviewedUnitLabel ? ("success" as const) : ("danger" as const),
    },
    {
      label: "Tenant",
      value: tenant
        ? `Link only to ${tenant.legal_name}`
        : reviewedTenant
          ? `Create new tenant: ${reviewedTenant}`
          : "Tenant detail needed",
      tone:
        tenant || reviewedTenant ? ("success" as const) : ("danger" as const),
    },
    {
      label: "Lease",
      value: "Create new lease after apply",
      tone: "primary" as const,
    },
    {
      label: "Operations",
      value:
        obligationCount > 0
          ? `Create ${obligationCount} lease task${obligationCount === 1 ? "" : "s"}`
          : "No dated obligations yet",
      tone: obligationCount > 0 ? ("success" as const) : ("neutral" as const),
    },
  ];
}

function hasReviewedPropertyIdentity(
  data: DocumentIntakeExtraction,
  target: ReviewApplyTarget,
) {
  const property = groupItems(data, "properties")[0];
  return Boolean(
    target.propertyId || fieldText(property?.name ?? property?.address),
  );
}

function propertyApplyPlanRows(
  data: DocumentIntakeExtraction,
  target: ReviewApplyTarget,
  properties: PropertyRecord[],
  units: TenancyUnitRecord[],
  obligationCount: number,
) {
  const property = properties.find((item) => item.id === target.propertyId);
  const unit = units.find((item) => item.id === target.tenancyUnitId);
  const reviewedProperty = groupItems(data, "properties")[0];
  const reviewedPropertyName = fieldText(
    reviewedProperty?.name ?? reviewedProperty?.address,
  );
  const reviewedUnitLabel = fieldText(reviewedProperty?.unit_label);
  return [
    {
      label: "Property",
      value: property
        ? `Link existing: ${property.name}`
        : reviewedPropertyName
          ? `Create new property: ${reviewedPropertyName}`
          : "Property detail needed",
      tone:
        property || reviewedPropertyName
          ? ("success" as const)
          : ("danger" as const),
    },
    {
      label: "Units",
      value: unit
        ? `Link existing unit: ${unit.unit_label}`
        : reviewedUnitLabel
          ? `Create reviewed unit: ${reviewedUnitLabel}`
          : "Skip units",
      tone:
        unit || reviewedUnitLabel ? ("success" as const) : ("neutral" as const),
    },
    {
      label: "Source",
      value: "Link document to the property records",
      tone: "primary" as const,
    },
    {
      label: "Operations",
      value:
        obligationCount > 0
          ? `Create ${obligationCount} milestone task${obligationCount === 1 ? "" : "s"}`
          : "No contract dates yet",
      tone: obligationCount > 0 ? ("success" as const) : ("neutral" as const),
    },
  ];
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
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-success/20 bg-white px-3 text-sm font-medium text-success-strong transition hover:bg-success-soft"
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

function DocumentIntakeReviewPanel({
  intake,
  draft,
  included,
  applyTarget,
  properties,
  tenancyUnits,
  tenants,
  leases,
  onDraftChange,
  onIncludedChange,
  onApplyTargetChange,
  onSave,
  onApply,
  onAcceptLeaseMatch,
  onClear,
  saving,
  applying,
  acceptingLeaseMatch,
  clearing,
  demo = false,
}: {
  intake: DocumentIntakeRecord;
  draft: DocumentIntakeExtraction;
  included: Record<ReviewGroupKey, boolean>;
  applyTarget: ReviewApplyTarget;
  properties: PropertyRecord[];
  tenancyUnits: TenancyUnitRecord[];
  tenants: TenantRecord[];
  leases: LeaseRecord[];
  onDraftChange: (draft: DocumentIntakeExtraction) => void;
  onIncludedChange: (group: ReviewGroupKey, checked: boolean) => void;
  onApplyTargetChange: (target: ReviewApplyTarget) => void;
  onSave: () => void;
  onApply: () => void;
  onAcceptLeaseMatch: () => void;
  onClear: () => void;
  saving: boolean;
  applying: boolean;
  acceptingLeaseMatch: boolean;
  clearing: boolean;
  demo?: boolean;
}) {
  const data = draft;
  const leaseAutoMatch = leaseAutoMatchRecommendation(draft);
  const warnings = [
    ...(data.warnings ?? []),
    ...(data.missing_information ?? []),
  ];
  const workflowType = documentWorkflowType(draft, intake);
  const canApplyWorkflow = Boolean(workflowType);
  const reviewedDraft = buildIncludedReviewData(draft, included);
  const obligationApplyCount = applicableObligationCount(
    reviewedDraft,
    workflowType,
  );
  const applyBlocker =
    workflowType === "lease" &&
    !hasReviewedLeaseBasics(reviewedDraft, applyTarget)
      ? "Confirm property, unit, tenant, start, expiry, and rent before applying."
      : workflowType === "purchase_contract" &&
          !hasReviewedPropertyIdentity(reviewedDraft, applyTarget)
        ? "Choose or confirm the property before applying."
        : workflowType === "inspection_report" && obligationApplyCount === 0
          ? "Confirm at least one inspection finding before applying."
          : canApplyWorkflow &&
              workflowType !== "lease" &&
              workflowType !== "purchase_contract" &&
              workflowType !== "inspection_report" &&
              obligationApplyCount === 0
            ? "Confirm at least one obligation due date before applying."
            : null;
  const visibleGroups = reviewGroups.filter(
    (group) => groupItems(draft, group.key).length > 0,
  );
  const sourceInfo = intakeSourceInfo(intake);
  const groupTitle = (group: { key: ReviewGroupKey; title: string }) =>
    workflowType === "insurance_certificate" && group.key === "key_dates"
      ? "Policy dates"
      : workflowType === "lease" && group.key === "key_dates"
        ? "Lease dates"
        : workflowType === "inspection_report" &&
            group.key === "inspection_findings"
          ? "Work order drafts"
          : group.title;
  const canSelectLease = workflowType !== "lease";
  const scopedLeases = applyTarget.tenancyUnitId
    ? leases.filter(
        (lease) => lease.tenancy_unit_id === applyTarget.tenancyUnitId,
      )
    : leases;
  const approvedCount = reviewGroups.reduce(
    (total, group) => total + groupItems(reviewedDraft, group.key).length,
    0,
  );
  const ignoredCount = reviewGroups.reduce(
    (total, group) =>
      total +
      (included[group.key]
        ? groupItems(draft, group.key).filter(
            (item) => itemReviewAction(item) === "ignore",
          ).length
        : groupItems(draft, group.key).length),
    0,
  );
  const matchedProperty = properties.find(
    (property) => property.id === applyTarget.propertyId,
  );
  const matchedUnit = tenancyUnits.find(
    (unit) => unit.id === applyTarget.tenancyUnitId,
  );
  const matchedLease = leases.find((lease) => lease.id === applyTarget.leaseId);
  const applyScope =
    workflowType === "lease"
      ? reviewedLeaseTargetLabel(
          reviewedDraft,
          applyTarget,
          properties,
          tenancyUnits,
          tenants,
        )
      : workflowType === "purchase_contract"
        ? reviewedPropertyTargetLabel(
            reviewedDraft,
            applyTarget,
            properties,
            tenancyUnits,
          )
        : matchedLease && matchedUnit
          ? `${matchedUnit.unit_label} lease`
          : matchedUnit
            ? matchedUnit.unit_label
            : matchedProperty
              ? matchedProperty.name
              : "portfolio level";
  const leasePlanRows =
    workflowType === "lease"
      ? leaseApplyPlanRows(
          reviewedDraft,
          applyTarget,
          properties,
          tenancyUnits,
          tenants,
          obligationApplyCount,
        )
      : [];
  const propertyPlanRows =
    workflowType === "purchase_contract"
      ? propertyApplyPlanRows(
          reviewedDraft,
          applyTarget,
          properties,
          tenancyUnits,
          obligationApplyCount,
        )
      : [];
  return (
    <SectionPanel
      title="Review document"
      description="Confirm suggested details before Leasium creates work from this document."
      icon={<Sparkles size={17} className="text-primary" />}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={intakeStatusTone(intake.status)}>
            {intakeStatusLabel(intake.status)}
          </StatusBadge>
          <SecondaryButton
            type="button"
            className="h-8"
            onClick={onClear}
            disabled={demo || clearing}
          >
            <X size={14} />
            Clear
          </SecondaryButton>
        </div>
      }
    >
      <div className="grid gap-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-semibold">{intake.filename}</div>
            <div className="text-xs text-muted-foreground">
              {documentTypeLabel(intake.document_type)} -{" "}
              {confidenceLabel(intake.confidence)}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone="primary">{approvedCount} to apply</StatusBadge>
            {ignoredCount ? (
              <StatusBadge tone="neutral">{ignoredCount} ignored</StatusBadge>
            ) : null}
          </div>
        </div>

        {sourceInfo ? (
          <div className="grid gap-2 rounded-xl border border-primary/15 bg-primary-soft/60 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="primary">{sourceInfo.label}</StatusBadge>
              <span className="text-muted-foreground">{sourceInfo.detail}</span>
            </div>
            {sourceInfo.guardrail ? (
              <div className="text-muted-foreground">
                {sourceInfo.guardrail}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="rounded-2xl border border-primary/15 bg-primary-soft p-3 text-sm text-primary-hover">
          Nothing is applied until you approve the items below and press Apply.
          Ignored items stay out of the reviewed data sent to the workflow.
        </div>

        <Field label="Summary">
          <textarea
            value={fieldText(draft.summary) ?? ""}
            onChange={(event) =>
              onDraftChange({ ...draft, summary: event.target.value })
            }
            className="min-h-20 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none transition focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15"
          />
        </Field>

        {warnings.length ? (
          <div className="rounded-md border border-danger/20 bg-danger/5 p-3 text-sm text-danger">
            {warnings.slice(0, 4).map((warning) => (
              <div key={warning}>{warning}</div>
            ))}
          </div>
        ) : null}
        {demo ? (
          <div className="rounded-xl border border-primary/20 bg-primary-soft px-3 py-2 text-sm text-primary-hover">
            Demo preview only. Upload a live document when you are ready to save
            or apply.
          </div>
        ) : null}

        {leaseAutoMatch ? (
          <div className="grid gap-3 rounded-2xl border border-primary/15 bg-white p-3 shadow-leasiumXs">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Lease upload match</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Review-only comparison against the lease this tenant portal is
                  scoped to.
                </p>
              </div>
              <StatusBadge tone={leaseAutoMatchTone(leaseAutoMatch.status)}>
                {leaseAutoMatchStatusLabel(leaseAutoMatch.status)}
              </StatusBadge>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone="success">
                {countLabel(
                  leaseAutoMatch.matchedFields.length,
                  "matched field",
                )}
              </StatusBadge>
              <StatusBadge
                tone={leaseAutoMatch.differences.length ? "warning" : "neutral"}
              >
                {countLabel(leaseAutoMatch.differences.length, "difference")}
              </StatusBadge>
              <StatusBadge
                tone={
                  leaseAutoMatch.missingFields.length ? "warning" : "neutral"
                }
              >
                {countLabel(
                  leaseAutoMatch.missingFields.length,
                  "missing field",
                )}
              </StatusBadge>
            </div>
            {leaseAutoMatch.differences.length ? (
              <div className="grid gap-2 rounded-xl border border-warning/20 bg-warning/5 p-3">
                {leaseAutoMatch.differences.slice(0, 4).map((item) => (
                  <div
                    key={item.field}
                    className="grid gap-1 text-sm md:grid-cols-[160px_1fr]"
                  >
                    <span className="font-medium">
                      {leaseAutoMatchFieldLabel(item.field)}
                    </span>
                    <span className="text-muted-foreground">
                      Current {leaseAutoMatchValue(item.field, item.current)} -
                      extracted{" "}
                      {leaseAutoMatchValue(item.field, item.extracted)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            {leaseAutoMatch.guardrail ? (
              <div className="rounded-xl bg-muted/45 px-3 py-2 text-sm text-muted-foreground">
                {leaseAutoMatch.guardrail}
              </div>
            ) : null}
            {leaseAutoMatch.status === "matched" &&
            intake.status !== "applied" ? (
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={onAcceptLeaseMatch}
                  disabled={demo || acceptingLeaseMatch}
                >
                  {acceptingLeaseMatch ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Check size={15} />
                  )}
                  Accept match
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {canApplyWorkflow ? (
          <div className="rounded-2xl border border-border bg-white p-3 shadow-leasiumXs">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Apply target</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {workflowType === "lease"
                    ? "Choose existing records to link only, or let Leasium create new records from the reviewed fields."
                    : workflowType === "purchase_contract"
                      ? "Choose an existing property to link, or let Leasium create property setup records from the reviewed contract fields."
                      : workflowType === "invoice_admin"
                        ? "Link the billing document to the right property, unit, or lease. Leasium prepares review work only."
                        : workflowType === "inspection_report"
                          ? "Link the inspection findings to the right property, unit, or lease. Leasium creates requested work orders only after approval."
                          : "Link the source document and created work to the right property, unit, or lease before applying."}
                </p>
              </div>
              <StatusBadge
                tone={
                  workflowType === "lease"
                    ? applyBlocker
                      ? "danger"
                      : "primary"
                    : applyTarget.propertyId
                      ? "success"
                      : "neutral"
                }
              >
                {workflowType === "lease"
                  ? "Apply plan"
                  : workflowType === "purchase_contract"
                    ? "Apply plan"
                    : applyTarget.propertyId
                      ? "Matched"
                      : "Portfolio level"}
              </StatusBadge>
            </div>
            <div className="mt-3 rounded-xl bg-muted/45 px-3 py-2 text-sm text-muted-foreground">
              Target:{" "}
              <span className="font-medium text-foreground">{applyScope}</span>
            </div>
            {workflowType === "lease" ? (
              <div className="mt-3 grid gap-2 rounded-xl border border-primary/10 bg-primary-soft/60 p-3">
                {leasePlanRows.map((row) => (
                  <div
                    key={row.label}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <span className="font-medium text-foreground">
                      {row.label}
                    </span>
                    <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                      <span className="truncate text-right text-muted-foreground">
                        {row.value}
                      </span>
                      <StatusBadge tone={row.tone}>
                        {row.tone === "danger"
                          ? "Needs detail"
                          : row.tone === "primary"
                            ? "Create"
                            : row.value.startsWith("Link")
                              ? "Link only"
                              : row.tone === "neutral"
                                ? "Optional"
                                : "Create new"}
                      </StatusBadge>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {workflowType === "purchase_contract" ? (
              <div className="mt-3 grid gap-2 rounded-xl border border-primary/10 bg-primary-soft/60 p-3">
                {propertyPlanRows.map((row) => (
                  <div
                    key={row.label}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <span className="font-medium text-foreground">
                      {row.label}
                    </span>
                    <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                      <span className="truncate text-right text-muted-foreground">
                        {row.value}
                      </span>
                      <StatusBadge tone={row.tone}>
                        {row.tone === "danger"
                          ? "Needs detail"
                          : row.value.startsWith("Link")
                            ? "Link only"
                            : row.value.startsWith("Skip")
                              ? "Skip"
                              : row.tone === "primary"
                                ? "Source"
                                : row.tone === "neutral"
                                  ? "Optional"
                                  : "Create"}
                      </StatusBadge>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <div className={["mt-3 grid gap-3", "md:grid-cols-3"].join(" ")}>
              <Field label="Property">
                <Select
                  value={applyTarget.propertyId}
                  onChange={(event) =>
                    onApplyTargetChange({
                      propertyId: event.target.value,
                      tenancyUnitId: "",
                      tenantId: applyTarget.tenantId,
                      leaseId: "",
                    })
                  }
                  disabled={demo}
                >
                  <option value="">
                    {workflowType === "lease"
                      ? "Create new from reviewed fields"
                      : workflowType === "purchase_contract"
                        ? "Create new from reviewed property"
                        : "Portfolio level"}
                  </option>
                  {properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Unit">
                <Select
                  value={applyTarget.tenancyUnitId}
                  onChange={(event) =>
                    onApplyTargetChange({
                      ...applyTarget,
                      tenancyUnitId: event.target.value,
                      leaseId: "",
                    })
                  }
                  disabled={demo || !applyTarget.propertyId}
                >
                  <option value="">
                    {workflowType === "lease"
                      ? "Create new from reviewed unit"
                      : workflowType === "purchase_contract"
                        ? "Skip units"
                        : "No unit scope"}
                  </option>
                  {tenancyUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.unit_label}
                    </option>
                  ))}
                </Select>
              </Field>
              {workflowType === "lease" ? (
                <Field label="Tenant">
                  <Select
                    value={applyTarget.tenantId}
                    onChange={(event) =>
                      onApplyTargetChange({
                        ...applyTarget,
                        tenantId: event.target.value,
                      })
                    }
                    disabled={demo}
                  >
                    <option value="">Create new from reviewed tenant</option>
                    {tenants.map((tenant) => (
                      <option key={tenant.id} value={tenant.id}>
                        {tenant.legal_name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : canSelectLease ? (
                <Field label="Lease">
                  <Select
                    value={applyTarget.leaseId}
                    onChange={(event) =>
                      onApplyTargetChange({
                        ...applyTarget,
                        leaseId: event.target.value,
                      })
                    }
                    disabled={demo || !applyTarget.propertyId}
                  >
                    <option value="">No lease scope</option>
                    {scopedLeases.map((lease) => (
                      <option key={lease.id} value={lease.id}>
                        {lease.status} - {formatDate(lease.commencement_date)}{" "}
                        to {formatDate(lease.expiry_date)}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="grid gap-3">
          {visibleGroups.map((group) => (
            <div
              key={group.key}
              className="rounded-2xl border border-border bg-muted/25 p-3"
            >
              <label className="mb-3 flex items-center justify-between gap-3 text-sm font-semibold">
                <span>{groupTitle(group)}</span>
                <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  Include
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={included[group.key]}
                    onChange={(event) =>
                      onIncludedChange(group.key, event.target.checked)
                    }
                  />
                </span>
              </label>
              <div
                className={
                  included[group.key] ? "grid gap-3" : "grid gap-3 opacity-45"
                }
              >
                {groupItems(draft, group.key)
                  .slice(0, 3)
                  .map((item, index) => {
                    const action = itemReviewAction(item);
                    const ignored = action === "ignore";
                    return (
                      <div
                        key={index}
                        className={[
                          "grid gap-3 rounded-xl border bg-white p-3 shadow-leasiumXs transition",
                          ignored
                            ? "border-border opacity-60"
                            : "border-primary/20",
                        ].join(" ")}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge
                              tone={
                                itemConfidence(item, intake.confidence) &&
                                itemConfidence(item, intake.confidence)! >= 0.8
                                  ? "success"
                                  : "warning"
                              }
                            >
                              {confidenceLabel(
                                itemConfidence(item, intake.confidence),
                              )}
                            </StatusBadge>
                            {itemSource(item) ? (
                              <span className="rounded-full bg-primary-soft px-2 py-1 text-xs font-semibold text-primary-hover">
                                {itemSource(item)}
                              </span>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-muted p-1">
                            {(
                              [
                                "approve",
                                "edit",
                                "ignore",
                              ] as ReviewItemAction[]
                            ).map((nextAction) => (
                              <button
                                key={nextAction}
                                type="button"
                                onClick={() => {
                                  onIncludedChange(group.key, true);
                                  onDraftChange(
                                    setGroupItemAction(
                                      draft,
                                      group.key,
                                      index,
                                      nextAction,
                                    ),
                                  );
                                }}
                                disabled={!included[group.key]}
                                className={[
                                  "rounded-lg px-2 py-1 text-xs font-semibold capitalize transition disabled:cursor-not-allowed disabled:opacity-50",
                                  action === nextAction
                                    ? nextAction === "ignore"
                                      ? "bg-danger-soft text-danger"
                                      : "bg-primary text-white"
                                    : "text-muted-foreground hover:bg-white hover:text-foreground",
                                ].join(" ")}
                              >
                                {nextAction}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div
                          className={
                            ignored
                              ? "pointer-events-none grid gap-3"
                              : "grid gap-3"
                          }
                        >
                          {group.fields.map((field) => (
                            <Field key={field.key} label={field.label}>
                              <Input
                                type={field.type ?? "text"}
                                value={String(item[field.key] ?? "")}
                                onFocus={() => {
                                  if (action === "approve") {
                                    onDraftChange(
                                      setGroupItemAction(
                                        draft,
                                        group.key,
                                        index,
                                        "edit",
                                      ),
                                    );
                                  }
                                }}
                                onChange={(event) =>
                                  onDraftChange(
                                    updateGroupItem(
                                      setGroupItemAction(
                                        draft,
                                        group.key,
                                        index,
                                        "edit",
                                      ),
                                      group.key,
                                      index,
                                      field.key,
                                      event.target.value,
                                    ),
                                  )
                                }
                                disabled={!included[group.key] || ignored}
                              />
                            </Field>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                {groupItems(draft, group.key).length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    No suggestions.
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        {!canApplyWorkflow ? (
          <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            Apply is available for leases, certificates, compliance docs,
            guarantees, notices, billing docs, inspection reports, and
            acquisition contracts first. Other documents can be saved as
            reviewed here for now.
          </div>
        ) : null}
        {applyBlocker ? (
          <div className="rounded-md border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger">
            {applyBlocker}
          </div>
        ) : null}
        {canApplyWorkflow ? (
          <div className="rounded-2xl border border-border bg-muted/35 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Ready to apply</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {workflowType === "lease"
                    ? `Create the lease register records, source document link, and ${obligationApplyCount} task${obligationApplyCount === 1 ? "" : "s"} from ${applyScope}. `
                    : workflowType === "purchase_contract"
                      ? `Apply property setup records, link the source document, and ${
                          obligationApplyCount
                            ? `create ${obligationApplyCount} milestone ${obligationApplyCount === 1 ? "task" : "tasks"}`
                            : "skip milestone tasks"
                        } from ${applyScope}. `
                      : workflowType === "invoice_admin"
                        ? `Prepare ${obligationApplyCount} billing review ${obligationApplyCount === 1 ? "task" : "tasks"} at ${applyScope}. Nothing will be invoiced or synced. `
                        : workflowType === "inspection_report"
                          ? `Create ${obligationApplyCount} requested work order ${obligationApplyCount === 1 ? "draft" : "drafts"} at ${applyScope}. No contractor message will be sent. `
                          : `Create ${obligationApplyCount} document-driven ${obligationApplyCount === 1 ? "task" : "tasks"} at ${applyScope}. `}
                  {ignoredCount
                    ? `${ignoredCount} ignored item${ignoredCount === 1 ? "" : "s"} will be left out.`
                    : "No ignored items will be included."}
                </p>
              </div>
              <StatusBadge tone={applyBlocker ? "danger" : "success"}>
                {applyBlocker ? "Blocked" : "Review first"}
              </StatusBadge>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          <SecondaryButton
            type="button"
            onClick={onSave}
            disabled={demo || saving || applying}
          >
            {saving ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Check size={15} />
            )}
            Save review
          </SecondaryButton>
          <Button
            type="button"
            onClick={onApply}
            disabled={
              applying ||
              saving ||
              demo ||
              intake.status === "applied" ||
              !canApplyWorkflow ||
              Boolean(applyBlocker)
            }
          >
            {applying ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Check size={15} />
            )}
            Apply reviewed items
          </Button>
        </div>
      </div>
    </SectionPanel>
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
  const [reviewQueueFilter, setReviewQueueFilter] =
    useState<ReviewQueueFilter>("all");
  const [reviewIntakeId, setReviewIntakeId] = useState<string | null>(null);
  const [requestedReviewId, setRequestedReviewId] = useState<string | null>(
    null,
  );
  const [reviewDraftId, setReviewDraftId] = useState<string | null>(null);
  const [reviewDraft, setReviewDraft] =
    useState<DocumentIntakeExtraction | null>(null);
  const [reviewApplyTarget, setReviewApplyTarget] = useState<ReviewApplyTarget>(
    {
      propertyId: "",
      tenancyUnitId: "",
      tenantId: "",
      leaseId: "",
    },
  );
  const [lastApplyOutcome, setLastApplyOutcome] =
    useState<DocumentApplyOutcome | null>(null);
  const [includedGroups, setIncludedGroups] = useState<
    Record<ReviewGroupKey, boolean>
  >({
    parties: true,
    properties: true,
    key_dates: true,
    money_amounts: true,
    obligations: true,
    inspection_findings: true,
  });
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
    const next =
      requestedEntityId && accessibleIds.has(requestedEntityId)
        ? requestedEntityId
        : stored && accessibleIds.has(stored)
          ? stored
          : firstEntity;
    if (next && (!selectedEntityId || !accessibleIds.has(selectedEntityId))) {
      setSelectedEntityId(next);
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

  const selectedEntity = entitiesQuery.data?.find(
    (entity) => entity.id === selectedEntityId,
  );
  const dashboardOverviewQuery = useQuery<DashboardOverviewRecord>({
    queryKey: ["dashboard-overview", selectedEntityId, asOf],
    queryFn: () => getDashboardOverview(selectedEntityId, asOf || undefined),
    enabled: !demoMode && Boolean(selectedEntityId),
  });
  const dashboardOverview = demoMode
    ? null
    : (dashboardOverviewQuery.data ?? null);
  const selectedEntityName =
    selectedEntity?.name ?? dashboardOverview?.entity.name;

  const propertiesQuery = useQuery({
    queryKey: ["dashboard-properties", selectedEntityId],
    queryFn: () => listProperties(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });
  const tenantsQuery = useQuery({
    queryKey: ["dashboard-tenants", selectedEntityId],
    queryFn: () => listTenants(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });
  const obligationsQuery = useQuery({
    queryKey: ["dashboard-obligations", selectedEntityId],
    queryFn: () => listObligations({ entity_id: selectedEntityId }),
    enabled: Boolean(selectedEntityId),
  });
  const rentRollQuery = useQuery({
    queryKey: ["dashboard-rent-roll", selectedEntityId, asOf],
    queryFn: () => listRentRoll({ entity_id: selectedEntityId, as_of: asOf }),
    enabled: Boolean(selectedEntityId),
  });
  const insightsOverviewQuery = useQuery<InsightsOverviewRecord>({
    queryKey: ["dashboard-insights-overview", selectedEntityId, asOf],
    queryFn: () => getInsightsOverview(selectedEntityId, asOf || undefined),
    enabled: Boolean(selectedEntityId),
  });
  const onboardingQuery = useQuery({
    queryKey: ["dashboard-onboarding", selectedEntityId],
    queryFn: () => listTenantOnboardings(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });
  const documentIntakesQuery = useQuery({
    queryKey: ["dashboard-document-intakes", selectedEntityId],
    queryFn: () => listDocumentIntakes(selectedEntityId),
    enabled: Boolean(selectedEntityId),
    refetchInterval: (query) =>
      query.state.data?.some(intakeIsActive) ? 2500 : false,
  });
  const reviewTenancyUnitsQuery = useQuery({
    queryKey: ["dashboard-review-tenancy-units", reviewApplyTarget.propertyId],
    queryFn: () => listTenancyUnits(reviewApplyTarget.propertyId),
    enabled: isIntakeWorkspace && Boolean(reviewApplyTarget.propertyId),
  });
  const reviewLeasesQuery = useQuery({
    queryKey: ["dashboard-review-leases", reviewApplyTarget.propertyId],
    queryFn: () => listLeasesByProperty(reviewApplyTarget.propertyId),
    enabled: isIntakeWorkspace && Boolean(reviewApplyTarget.propertyId),
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
  const reviewDocumentIntakeMutation = useMutation({
    mutationFn: (payload: {
      intakeId: string;
      reviewData: DocumentIntakeExtraction;
    }) =>
      reviewDocumentIntake(payload.intakeId, {
        reviewData: payload.reviewData,
      }),
    onMutate: () => {
      setIntakeError(null);
      setIntakeNotice(null);
    },
    onSuccess: () => {
      setIntakeNotice("Review saved.");
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
  const applyDocumentIntakeMutation = useMutation({
    mutationFn: (payload: {
      intakeId: string;
      reviewData: DocumentIntakeExtraction;
      target: ReviewApplyTarget;
      outcome: DocumentApplyOutcome;
    }) =>
      applyDocumentIntake(payload.intakeId, {
        reviewData: payload.reviewData,
        propertyId: payload.target.propertyId,
        tenancyUnitId: payload.target.tenancyUnitId,
        tenantId: payload.target.tenantId,
        leaseId: payload.target.leaseId,
      }),
    onMutate: () => {
      setIntakeError(null);
      setIntakeNotice(null);
    },
    onSuccess: (result, payload) => {
      const applied = appliedReviewData(result);
      setLastApplyOutcome({
        ...payload.outcome,
        obligationCount:
          fieldNumber(applied.obligation_count) ??
          payload.outcome.obligationCount,
        billingDraftCount:
          fieldNumber(applied.billing_draft_count) ??
          payload.outcome.billingDraftCount,
        billingDraftId:
          fieldText(applied.billing_draft_id) ?? payload.outcome.billingDraftId,
        leaseCount:
          fieldNumber(applied.created_lease_count) ??
          payload.outcome.leaseCount,
        leaseIds: fieldTextList(applied.lease_ids),
        workOrderCount:
          fieldNumber(applied.work_order_count) ??
          payload.outcome.workOrderCount,
        workOrderIds: fieldTextList(applied.work_order_ids),
        chargeRuleCount:
          fieldNumber(applied.created_charge_rule_count) ??
          payload.outcome.chargeRuleCount,
        chargeRuleIds: fieldTextList(applied.charge_rule_ids),
        chargeRuleSummaries: appliedChargeRuleSummaries(
          applied.charge_rule_summaries,
        ),
        skippedTenancyScheduleRows: appliedScheduleRowSkips(
          applied.skipped_tenancy_schedule_rows,
        ),
        propertyChanges: appliedPropertyChanges(applied.property_changes),
        appliedAt: result.applied_at,
        appliedBy: result.applied_by_user_id,
      });
      setIntakeNotice("Document workflow applied.");
      queryClient.invalidateQueries({
        queryKey: ["dashboard-overview", selectedEntityId],
      });
      queryClient.invalidateQueries({
        queryKey: ["dashboard-document-intakes", selectedEntityId],
      });
      queryClient.invalidateQueries({
        queryKey: ["dashboard-obligations", selectedEntityId],
      });
      queryClient.invalidateQueries({
        queryKey: ["dashboard-properties", selectedEntityId],
      });
      queryClient.invalidateQueries({
        queryKey: ["dashboard-tenants", selectedEntityId],
      });
      queryClient.invalidateQueries({
        queryKey: ["dashboard-rent-roll", selectedEntityId],
      });
    },
    onError: (error) => {
      setIntakeError(friendlyError(error));
    },
  });
  const acceptLeaseMatchMutation = useMutation({
    mutationFn: acceptDocumentIntakeLeaseMatch,
    onMutate: () => {
      setIntakeError(null);
      setIntakeNotice(null);
    },
    onSuccess: () => {
      setIntakeNotice("Lease match accepted.");
      queryClient.invalidateQueries({
        queryKey: ["dashboard-overview", selectedEntityId],
      });
      queryClient.invalidateQueries({
        queryKey: ["dashboard-document-intakes", selectedEntityId],
      });
      queryClient.invalidateQueries({
        queryKey: ["dashboard-rent-roll", selectedEntityId],
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
      Boolean(selectedEntityId) &&
      !obligationsQuery.data &&
      (obligationsQuery.isLoading || obligationsQuery.isFetching));
  const rentRollLoading =
    entitySelectionLoading ||
    (!demoMode &&
      Boolean(selectedEntityId) &&
      !rentRollQuery.data &&
      (rentRollQuery.isLoading || rentRollQuery.isFetching));
  const onboardingLoading =
    entitySelectionLoading ||
    (!demoMode &&
      Boolean(selectedEntityId) &&
      !onboardingQuery.data &&
      (onboardingQuery.isLoading || onboardingQuery.isFetching));
  const documentIntakesLoading =
    entitySelectionLoading ||
    (!demoMode &&
      Boolean(selectedEntityId) &&
      !documentIntakesQuery.data &&
      (documentIntakesQuery.isLoading || documentIntakesQuery.isFetching));
  const dashboardDataQueries = [
    propertiesQuery,
    tenantsQuery,
    obligationsQuery,
    rentRollQuery,
    onboardingQuery,
    documentIntakesQuery,
  ];
  const dashboardLoading =
    !demoMode &&
    !dashboardOverview &&
    (entitySelectionLoading ||
      (Boolean(selectedEntityId) &&
        dashboardDataQueries.some(
          (query) => !query.data && (query.isLoading || query.isFetching),
        )));
  const dashboardRefreshing =
    !demoMode &&
    Boolean(selectedEntityId) &&
    (dashboardOverviewQuery.isFetching ||
      dashboardDataQueries.some(
        (query) => query.isFetching && !query.isLoading,
      ));
  const dashboardError =
    !demoMode &&
    (entitiesQuery.error ??
      propertiesQuery.error ??
      tenantsQuery.error ??
      obligationsQuery.error ??
      rentRollQuery.error ??
      onboardingQuery.error ??
      documentIntakesQuery.error);
  const displayObligations = useMemo(
    () => (demoMode ? demoObligationRows : (obligationsQuery.data ?? [])),
    [demoMode, demoObligationRows, obligationsQuery.data],
  );
  const displayRentRoll = useMemo(
    () => (demoMode ? demoRentRows : (rentRollQuery.data ?? [])),
    [demoMode, demoRentRows, rentRollQuery.data],
  );
  const obligationsTrend = useMemo<DashboardMetricTrend | null>(
    () =>
      computeOpenObligationTrend({
        records: demoMode ? null : (obligationsQuery.data ?? null),
      }),
    [demoMode, obligationsQuery.data],
  );

  const displayOnboardings = useMemo(
    () => (demoMode ? demoOnboardingRows : (onboardingQuery.data ?? [])),
    [demoMode, demoOnboardingRows, onboardingQuery.data],
  );
  const liveDocumentIntakes = documentIntakesQuery.data ?? [];
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
  const selectedReviewIntake =
    filteredReviewIntakes.find((item) => item.id === activeReviewIntakeId) ??
    filteredReviewIntakes[0] ??
    null;
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
  const commandCenterItems: CommandCenterItem[] = [];
  const topSmartReview = smartReviewIntakes[0];
  if (topSmartReview) {
    commandCenterItems.push({
      id: "smart-intake-review",
      area: "Smart Intake",
      title: `${smartReviewIntakes.length} Smart Intake ${
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
      area: "Smart Intake",
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
      area: "Billing",
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
      area: "Onboarding",
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
      area: "Operations",
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
      area: "Onboarding",
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
        area: "Smart Intake",
        title: `${overviewDocumentNeedsReviewCount} Smart Intake ${
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
        area: "Smart Intake",
        title: `${overviewDocumentFailedCount} document ${
          overviewDocumentFailedCount === 1 ? "read" : "reads"
        } failed`,
        why: "Some uploaded documents could not become source-backed review data and need a quick operator check.",
        href: "/intake",
        nextStep: "Fix intake",
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
  const operationsMetricLoading = obligationsLoading && !dashboardOverview;
  const operationsMetricCount =
    demoMode || obligationsQuery.data
      ? urgentObligations.length
      : overviewOperationsCount;
  const operationsMetricChip = operationsMetricCount ? "Act now" : "Clear";
  const operationsMetricTone = operationsMetricCount ? "warning" : "success";
  const operationsMetricNextAction =
    urgentObligations[0]?.title ??
    (operationsMetricCount
      ? "Review overdue and due-soon lease work."
      : "No urgent dates need action.");
  const billingMetricLoading = rentRollLoading && !dashboardOverview;
  const billingMetricCount =
    demoMode || rentRollQuery.data
      ? billingIssues.length
      : overviewBillingBlockerCount;
  const billingMetricNextAction =
    billingIssues[0]?.blockers[0] ??
    (billingMetricCount
      ? "Review blocked billing rows."
      : "Invoice run is ready from current data.");
  const reviewMetricLoading = documentIntakesLoading && !dashboardOverview;
  const reviewMetricCount =
    demoMode || documentIntakesQuery.data
      ? needsReviewCount
      : overviewDocumentNeedsReviewCount;
  const failedIntakeMetricCount =
    demoMode || documentIntakesQuery.data
      ? failedIntakeCount
      : overviewDocumentFailedCount;

  function uploadSmartIntake(file: File | null | undefined) {
    if (!file || !selectedEntityId || documentIntakeMutation.isPending) {
      return;
    }
    documentIntakeMutation.mutate(file);
  }

  function downloadReviewQueueCsv() {
    saveBlob(
      new Blob([smartIntakeReviewQueueCsv(filteredReviewIntakes)], {
        type: "text/csv;charset=utf-8",
      }),
      `smart-intake-review-queue-${reviewQueueFilter}.csv`,
    );
  }

  useEffect(() => {
    if (!selectedReviewIntake) {
      setReviewDraftId(null);
      setReviewDraft(null);
      return;
    }
    if (reviewDraftId !== selectedReviewIntake.id) {
      setReviewDraftId(selectedReviewIntake.id);
      setReviewDraft(cloneExtraction(intakeReviewData(selectedReviewIntake)));
      setReviewApplyTarget({
        propertyId: "",
        tenancyUnitId: "",
        tenantId: "",
        leaseId: "",
      });
      setIncludedGroups({
        parties: true,
        properties: true,
        key_dates: true,
        money_amounts: true,
        obligations: true,
        inspection_findings: true,
      });
    }
  }, [reviewDraftId, selectedReviewIntake]);

  const upcomingEvents = [
    ...openObligations.slice(0, 5).map((item) => ({
      id: item.id,
      title: item.title,
      meta: item.category.replaceAll("_", " "),
      date: item.due_date,
      tone: obligationTone(item),
    })),
    ...activeOnboardings.slice(0, 3).map((item) => ({
      id: item.id,
      title: "Tenant onboarding due",
      meta: item.status,
      date: item.due_date,
      tone: "primary" as StatusTone,
    })),
  ].sort((a, b) => dueRank(a.date) - dueRank(b.date));

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
          title={
            isIntakeWorkspace
              ? "Smart Intake"
              : demoMode
                ? "Leasium demo portfolio"
                : (selectedEntityName ?? "Dashboard")
          }
          description={
            isIntakeWorkspace
              ? "Drop a document. Review what Leasium found. Apply only what you approve."
              : "Your lease operations command centre for review queues, key dates, billing blockers, and tenant workflow."
          }
          actions={
            <>
              {!isIntakeWorkspace || demoMode ? (
                <SecondaryButton
                  type="button"
                  onClick={() => setDemoMode((current) => !current)}
                >
                  <Layers3 size={15} />
                  {demoMode ? "View live portfolio" : "View demo portfolio"}
                </SecondaryButton>
              ) : null}
              <SecondaryButton
                type="button"
                onClick={() => {
                  dashboardOverviewQuery.refetch();
                  propertiesQuery.refetch();
                  tenantsQuery.refetch();
                  obligationsQuery.refetch();
                  rentRollQuery.refetch();
                  onboardingQuery.refetch();
                  documentIntakesQuery.refetch();
                }}
                disabled={!selectedEntityId}
              >
                <RefreshCw size={15} />
                Refresh
              </SecondaryButton>
            </>
          }
        />

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
                dashboardOverviewQuery.refetch();
                propertiesQuery.refetch();
                tenantsQuery.refetch();
                obligationsQuery.refetch();
                rentRollQuery.refetch();
                onboardingQuery.refetch();
                documentIntakesQuery.refetch();
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
              selectedEntityName
                ? `Checking records for ${selectedEntityName}.`
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
          />
        ) : null}

        {/* Metric grid trimmed 2026-05-23 (external design review §3.1):
            6 → 4 operational cards. Properties + Tenants counts are not
            "act now" metrics — they're navigational, and the sidebar
            already links to both. The four operational cards (Operations,
            Billing blockers, Needs review, Blocked docs) all answer
            "what needs me right now?" which is what the metric strip is for.
            Pending Remba review. */}
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DashboardMetricCard
            href="/operations"
            label="Operations"
            count={operationsMetricLoading ? "Checking" : operationsMetricCount}
            chip={operationsMetricLoading ? "Checking" : operationsMetricChip}
            tone={operationsMetricLoading ? "neutral" : operationsMetricTone}
            nextAction={
              operationsMetricLoading
                ? "Checking key dates."
                : operationsMetricNextAction
            }
            icon={<AlertTriangle size={17} />}
            trend={obligationsTrend}
          />
          <DashboardMetricCard
            href="/billing-readiness"
            label="Billing blockers"
            count={billingMetricLoading ? "Checking" : billingMetricCount}
            chip={
              billingMetricLoading
                ? "Checking"
                : billingMetricCount
                  ? "Blocked"
                  : "Ready"
            }
            tone={
              billingMetricLoading
                ? "neutral"
                : billingMetricCount
                  ? "danger"
                  : "success"
            }
            nextAction={
              billingMetricLoading
                ? "Checking billing readiness."
                : billingMetricNextAction
            }
            icon={<ReceiptText size={17} />}
          />
          <DashboardMetricCard
            href="/intake"
            label="Needs review"
            count={reviewMetricLoading ? "Preparing" : reviewMetricCount}
            chip={
              reviewMetricLoading
                ? "Preparing"
                : reviewMetricCount
                  ? "Review"
                  : "Empty"
            }
            tone={
              reviewMetricLoading
                ? "neutral"
                : reviewMetricCount
                  ? "primary"
                  : "neutral"
            }
            nextAction={
              reviewMetricLoading
                ? "Preparing review queue."
                : reviewMetricCount
                  ? "Approve extracted document data."
                  : "Drop documents into Smart Intake."
            }
            icon={<Sparkles size={17} />}
          />
          <DashboardMetricCard
            href="/intake"
            label="Blocked docs"
            count={reviewMetricLoading ? "Checking" : failedIntakeMetricCount}
            chip={
              reviewMetricLoading
                ? "Checking"
                : failedIntakeMetricCount
                  ? "Fix"
                  : "Clear"
            }
            tone={
              reviewMetricLoading
                ? "neutral"
                : failedIntakeMetricCount
                  ? "danger"
                  : "success"
            }
            nextAction={
              reviewMetricLoading
                ? "Checking document reads."
                : failedIntakeMetricCount
                  ? "Review documents Leasium could not read."
                  : "No intake failures right now."
            }
            icon={<FileText size={17} />}
          />
        </section>

        <section className="grid gap-5 lg:grid-cols-[430px_minmax(0,1fr)]">
          <div className="grid gap-5">
            <SectionPanel
              title="Smart Intake"
              description="Upload. Review. Automate. Every change stays under your control."
              icon={<Sparkles size={17} className="text-primary" />}
            >
              <div className="grid gap-4 p-4">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
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
                  disabled={
                    !selectedEntityId || documentIntakeMutation.isPending
                  }
                  className={[
                    "grid min-h-32 place-items-center rounded-xl border border-dashed p-4 text-center transition",
                    dragActive
                      ? "border-primary bg-primary/5"
                      : "border-primary/25 bg-primary-soft/25 hover:border-primary/50 hover:bg-primary/5",
                    !selectedEntityId || documentIntakeMutation.isPending
                      ? "cursor-not-allowed opacity-60"
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
                  <span className="grid justify-items-center gap-2">
                    {documentIntakeMutation.isPending ? (
                      <Loader2
                        size={24}
                        className="animate-spin text-primary"
                      />
                    ) : (
                      <FileUp size={24} className="text-primary" />
                    )}
                    <span className="text-leasium-body-compact font-semibold leading-5">
                      {documentIntakeMutation.isPending
                        ? "Uploading document"
                        : "Drop a document here"}
                    </span>
                    <span className="max-w-sm text-sm leading-5 text-muted-foreground">
                      Lease, purchase contract, tenancy schedule, invoice,
                      certificate, handover file, or tenant document
                    </span>
                  </span>
                </button>
                {documentIntakeMutation.isPending ? (
                  <div className="rounded-md bg-primary/5 px-3 py-2 text-sm text-primary">
                    Reading document and preparing review.
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
                <div className="flex flex-wrap gap-2">
                  <Link
                    href="/properties"
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-medium transition hover:bg-muted"
                  >
                    <Layers3 size={16} />
                    Add property
                  </Link>
                  <Link
                    href="/tenants"
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-medium transition hover:bg-muted"
                  >
                    <UserRound size={16} />
                    Add tenant
                  </Link>
                </div>
                <div className="overflow-hidden rounded-xl border border-border">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/25 px-3 py-2.5">
                    <span className="text-sm font-semibold leading-5">
                      Review queue
                    </span>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Select
                        aria-label="Review filter"
                        className="h-9 min-h-9 w-52 rounded-md"
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
                        <option value="tenant_portal">
                          Tenant portal uploads
                        </option>
                        <option value="inbound_email_attachment">
                          Inbound email attachments
                        </option>
                        <option value="lease_match">Lease matches</option>
                        <option value="insurance_certificate">Insurance</option>
                        <option value="inspection_report">Inspections</option>
                        <option value="lease">Leases</option>
                      </Select>
                      <SecondaryButton
                        type="button"
                        className="h-9"
                        onClick={downloadReviewQueueCsv}
                        disabled={
                          documentIntakesLoading ||
                          filteredReviewIntakes.length === 0
                        }
                      >
                        <Download size={15} />
                        Download queue CSV
                      </SecondaryButton>
                      <StatusBadge
                        tone={needsReviewCount ? "primary" : "neutral"}
                      >
                        {documentIntakesLoading
                          ? "Preparing"
                          : `${needsReviewCount} waiting`}
                      </StatusBadge>
                    </div>
                  </div>
                  <div className="divide-y divide-border">
                    {filteredReviewIntakes.slice(0, 5).map((item) => {
                      const propertyName = firstField(
                        item.extracted_data.properties,
                        "name",
                      );
                      const tenantName =
                        firstField(item.extracted_data.parties, "name") ??
                        fieldText(
                          item.extracted_data.suggested_links?.tenant_name,
                        );
                      const sourceInfo = intakeSourceInfo(item);
                      return (
                        <div
                          key={item.id}
                          data-testid={`review-intake-${item.id}`}
                          className="grid gap-2 px-3 py-3 text-sm"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate font-medium">
                                {item.filename}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                <span>
                                  {documentTypeLabel(item.document_type)}
                                </span>
                                <span>{formatDateTime(item.created_at)}</span>
                              </div>
                            </div>
                            <StatusBadge tone={intakeStatusTone(item.status)}>
                              {intakeStatusLabel(item.status)}
                            </StatusBadge>
                          </div>
                          {item.status === "reading" ||
                          item.status === "uploaded" ? (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Loader2 size={13} className="animate-spin" />
                              Reading document and preparing review.
                            </div>
                          ) : null}
                          {item.summary ? (
                            <p className="line-clamp-2 text-sm text-muted-foreground">
                              {item.summary}
                            </p>
                          ) : null}
                          {sourceInfo ? (
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <StatusBadge tone="primary">
                                {sourceInfo.label}
                              </StatusBadge>
                              <span className="text-muted-foreground">
                                {sourceInfo.detail}
                              </span>
                            </div>
                          ) : null}
                          <div className="flex flex-wrap gap-2 text-xs">
                            {propertyName ? (
                              <span className="rounded bg-muted px-2 py-1">
                                {propertyName}
                              </span>
                            ) : null}
                            {tenantName ? (
                              <span className="rounded bg-muted px-2 py-1">
                                {tenantName}
                              </span>
                            ) : null}
                            <span className="rounded bg-muted px-2 py-1">
                              {confidenceLabel(item.confidence)}
                            </span>
                          </div>
                          <div className="flex justify-end gap-2">
                            {isIntakeWorkspace ? (
                              <SecondaryButton
                                type="button"
                                className="h-8"
                                onClick={() => setReviewIntakeId(item.id)}
                              >
                                Review
                              </SecondaryButton>
                            ) : (
                              <Link
                                href={intakeReviewHref(item.entity_id, item.id)}
                                className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-medium transition hover:bg-muted"
                              >
                                Review
                              </Link>
                            )}
                            <SecondaryButton
                              type="button"
                              className="h-8"
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
                        description="Drop in a lease, acquisition contract, invoice, guarantee, insurance certificate, or tenant document to start your first review."
                      />
                    ) : filteredReviewIntakes.length === 0 ? (
                      <EmptyState
                        icon={<CheckCircle2 size={18} />}
                        title="No matching reviews."
                        description="Change the review filter to see other waiting documents."
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            </SectionPanel>

            {isIntakeWorkspace ? (
              <RegisterImportPanel
                entityId={selectedEntityId}
                onApplied={() => {
                  dashboardOverviewQuery.refetch();
                  propertiesQuery.refetch();
                  tenantsQuery.refetch();
                  obligationsQuery.refetch();
                  rentRollQuery.refetch();
                  documentIntakesQuery.refetch();
                }}
              />
            ) : null}

            {!isIntakeWorkspace ? (
              <SectionPanel title="Onboarding">
                <div className="grid gap-3 p-4 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Waiting on tenants
                    </span>
                    <span className="font-semibold">
                      {onboardingLoading
                        ? "Checking"
                        : activeOnboardings.length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Submitted</span>
                    <span className="font-semibold">
                      {onboardingLoading
                        ? "Updating"
                        : submittedOnboardings.length}
                    </span>
                  </div>
                  <Link
                    href="/properties"
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-medium transition hover:bg-muted"
                  >
                    <Link2 size={15} />
                    Manage links
                  </Link>
                </div>
              </SectionPanel>
            ) : null}
          </div>

          <div className="grid gap-5">
            {isIntakeWorkspace && lastApplyOutcome ? (
              <DocumentIntakeApplyOutcomeCard
                outcome={lastApplyOutcome}
                onDismiss={() => setLastApplyOutcome(null)}
              />
            ) : null}
            {isIntakeWorkspace && selectedReviewIntake && reviewDraft ? (
              <DocumentIntakeReviewPanel
                intake={selectedReviewIntake}
                draft={reviewDraft}
                included={includedGroups}
                applyTarget={reviewApplyTarget}
                properties={propertiesQuery.data ?? []}
                tenancyUnits={reviewTenancyUnitsQuery.data ?? []}
                tenants={tenantsQuery.data ?? []}
                leases={reviewLeasesQuery.data ?? []}
                onDraftChange={setReviewDraft}
                onIncludedChange={(group, checked) =>
                  setIncludedGroups((current) => ({
                    ...current,
                    [group]: checked,
                  }))
                }
                onApplyTargetChange={setReviewApplyTarget}
                onSave={() =>
                  reviewDocumentIntakeMutation.mutate({
                    intakeId: selectedReviewIntake.id,
                    reviewData: buildIncludedReviewData(
                      reviewDraft,
                      includedGroups,
                    ),
                  })
                }
                onApply={() => {
                  const reviewData = buildIncludedReviewData(
                    reviewDraft,
                    includedGroups,
                  );
                  const workflowType = documentWorkflowType(
                    reviewDraft,
                    selectedReviewIntake,
                  );
                  applyDocumentIntakeMutation.mutate({
                    intakeId: selectedReviewIntake.id,
                    reviewData,
                    target: reviewApplyTarget,
                    outcome: {
                      documentName: selectedReviewIntake.filename,
                      workflowType,
                      obligationCount: applicableObligationCount(
                        reviewData,
                        workflowType,
                      ),
                      workOrderCount:
                        workflowType === "inspection_report"
                          ? applicableObligationCount(reviewData, workflowType)
                          : undefined,
                      targetLabel:
                        workflowType === "lease"
                          ? reviewedLeaseTargetLabel(
                              reviewData,
                              reviewApplyTarget,
                              propertiesQuery.data ?? [],
                              reviewTenancyUnitsQuery.data ?? [],
                              tenantsQuery.data ?? [],
                            )
                          : workflowType === "purchase_contract"
                            ? reviewedPropertyTargetLabel(
                                reviewData,
                                reviewApplyTarget,
                                propertiesQuery.data ?? [],
                                reviewTenancyUnitsQuery.data ?? [],
                              )
                            : applyTargetLabel(
                                reviewApplyTarget,
                                propertiesQuery.data ?? [],
                                reviewTenancyUnitsQuery.data ?? [],
                                reviewLeasesQuery.data ?? [],
                              ),
                      dueDate: firstApplicableDueDate(reviewData, workflowType),
                      ignoredCount: ignoredReviewItemCount(
                        reviewDraft,
                        includedGroups,
                      ),
                    },
                  });
                }}
                onAcceptLeaseMatch={() => {
                  acceptLeaseMatchMutation.mutate(selectedReviewIntake.id);
                }}
                onClear={() =>
                  deleteDocumentIntakeMutation.mutate(selectedReviewIntake.id)
                }
                saving={reviewDocumentIntakeMutation.isPending}
                applying={applyDocumentIntakeMutation.isPending}
                acceptingLeaseMatch={acceptLeaseMatchMutation.isPending}
                clearing={deleteDocumentIntakeMutation.isPending}
                demo={selectedReviewIntake.id.startsWith("demo-")}
              />
            ) : null}
            {isIntakeWorkspace && !selectedReviewIntake ? (
              <SectionPanel
                title="Review document"
                description="Extracted terms, dates, parties, and obligations will wait here until you approve them."
                icon={<Sparkles size={17} className="text-primary" />}
              >
                <EmptyState
                  icon={<FileText size={18} />}
                  title="No document selected."
                  description="Drop a lease, acquisition contract, invoice, guarantee, certificate, or tenant document to start."
                />
              </SectionPanel>
            ) : null}
            {!isIntakeWorkspace ? (
              <SectionPanel
                title="Needs attention"
                icon={<ClipboardList size={17} className="text-primary" />}
              >
                <div className="divide-y divide-border">
                  {obligationsLoading ? (
                    <SkeletonRows rows={4} />
                  ) : (
                    urgentObligations.slice(0, 6).map((item) => (
                      <Link
                        href="/properties"
                        key={item.id}
                        className="grid gap-2 px-4 py-3.5 transition hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"
                      >
                        <div className="min-w-0">
                          <div className="line-clamp-2 text-leasium-body-compact font-medium leading-5 text-foreground">
                            {item.title}
                          </div>
                          <div className="mt-1 text-xs capitalize leading-4 text-muted-foreground">
                            {item.category.replaceAll("_", " ")}
                          </div>
                        </div>
                        <StatusBadge tone={obligationTone(item)}>
                          {dueLabel(item.due_date)}
                        </StatusBadge>
                      </Link>
                    ))
                  )}
                  {!obligationsLoading && urgentObligations.length === 0 ? (
                    <EmptyState
                      icon={<CheckCircle2 size={18} />}
                      title="No urgent dates right now."
                    />
                  ) : null}
                </div>
              </SectionPanel>
            ) : null}

            {!isIntakeWorkspace ? (
              <section className="grid gap-5 xl:grid-cols-2">
                <SectionPanel
                  title="Events"
                  icon={<CalendarClock size={17} className="text-primary" />}
                >
                  <div className="divide-y divide-border">
                    {upcomingEvents.slice(0, 8).map((event) => (
                      <Link
                        href="/properties"
                        key={event.id}
                        className="block px-4 py-3.5 text-sm transition hover:bg-muted/50"
                      >
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                          <span className="line-clamp-2 text-leasium-body-compact font-medium leading-5 text-foreground">
                            {event.title}
                          </span>
                          <StatusBadge tone={event.tone}>
                            {dueLabel(event.date)}
                          </StatusBadge>
                        </div>
                        <div className="mt-1 text-xs capitalize leading-4 text-muted-foreground">
                          {event.meta}
                        </div>
                      </Link>
                    ))}
                    {obligationsLoading ? (
                      <SkeletonRows rows={3} />
                    ) : upcomingEvents.length === 0 ? (
                      <EmptyState
                        icon={<Clock3 size={18} />}
                        title="No upcoming events for this entity."
                      />
                    ) : null}
                  </div>
                </SectionPanel>

                <SectionPanel
                  title="Billing updates"
                  icon={<ReceiptText size={17} className="text-primary" />}
                >
                  <div className="divide-y divide-border">
                    {billingIssues
                      .slice(0, 6)
                      .map(({ row, blockers: rowBlockers }) => (
                        <Link
                          href="/properties"
                          key={`${row.property_id}-${row.tenancy_unit_id}`}
                          className="block px-4 py-3.5 text-sm transition hover:bg-muted/50"
                        >
                          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-leasium-body-compact font-semibold leading-5 text-foreground">
                                {row.unit_label}
                              </div>
                              <div className="mt-0.5 truncate text-xs leading-4 text-muted-foreground">
                                {row.property_name} -{" "}
                                {row.tenant_name ?? "Vacant"}
                              </div>
                            </div>
                            <span className="pt-0.5 text-xs font-semibold tabular-nums text-foreground">
                              {formatMoney(row.charge_rules_total_cents)}
                            </span>
                          </div>
                          <div className="mt-2 rounded-md bg-muted/60 px-2.5 py-1.5 text-xs leading-4 text-muted-foreground">
                            {rowBlockers[0]}
                          </div>
                        </Link>
                      ))}
                    {rentRollLoading ? (
                      <SkeletonRows rows={3} />
                    ) : billingIssues.length === 0 ? (
                      <EmptyState
                        icon={<CheckCircle2 size={18} />}
                        title="No billing readiness blockers."
                      />
                    ) : null}
                  </div>
                </SectionPanel>
              </section>
            ) : null}
          </div>
        </section>

        {!isIntakeWorkspace ? (
          <UpcomingLeaseEventsPanel
            overview={insightsOverviewQuery.data}
            isLoading={insightsOverviewQuery.isLoading}
          />
        ) : null}

        <AskLeasiumPanel entityId={selectedEntityId} />

        <ActivityFeedPanel entityId={selectedEntityId} />
      </div>
    </main>
  );
}
