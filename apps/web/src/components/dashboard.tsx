"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ClipboardList,
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
  applyDocumentIntake,
  createDocumentIntake,
  deleteDocumentIntake,
  DocumentIntakeExtraction,
  DocumentIntakeRecord,
  LeaseRecord,
  listEntities,
  listDocumentIntakes,
  listLeasesByProperty,
  listObligations,
  listProperties,
  listRentRoll,
  listTenancyUnits,
  listTenantOnboardings,
  listTenants,
  ObligationRecord,
  PropertyRecord,
  RentRollRow,
  reviewDocumentIntake,
  TenancyUnitRecord,
  TenantRecord,
  TenantOnboardingRecord,
} from "@/lib/api";

const ENTITY_STORAGE_KEY = "leasium.entity_id";
const DEMO_MODE_STORAGE_KEY = "leasium.demo_mode";
type StatusTone = "neutral" | "success" | "warning" | "danger" | "primary";
type ReviewItemAction = "approve" | "edit" | "ignore";
type ReviewApplyTarget = {
  propertyId: string;
  tenancyUnitId: string;
  tenantId: string;
  leaseId: string;
};
type DocumentApplyOutcome = {
  documentName: string;
  workflowType: string | null;
  obligationCount: number;
  targetLabel: string;
  dueDate: string | null;
  ignoredCount: number;
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

function safeCurrency(value: unknown) {
  const text = fieldText(value) ?? "AUD";
  return /^[A-Z]{3}$/.test(text) ? text : "AUD";
}

function fieldText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

function DashboardMetricCard({
  href,
  label,
  count,
  chip,
  tone,
  nextAction,
  icon,
}: {
  href: string;
  label: string;
  count: number;
  chip: string;
  tone: StatusTone;
  nextAction: string;
  icon: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-border bg-white p-4 shadow-leasiumXs transition duration-200 ease-leasium hover:border-primary/40 hover:shadow-leasiumSm"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-muted-foreground">
          {label}
        </span>
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-leasium-blue-soft text-primary transition group-hover:bg-primary group-hover:text-white">
          {icon}
        </span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="text-3xl font-semibold tracking-normal">{count}</div>
        <StatusBadge tone={tone}>{chip}</StatusBadge>
      </div>
      <p className="mt-3 min-h-10 text-sm leading-5 text-muted-foreground">
        {nextAction}
      </p>
    </Link>
  );
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
      submitted_data: {},
      submitted_at: null,
      review_data: {},
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
      submitted_data: {},
      submitted_at: createdAt,
      review_data: {},
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
  | "obligations";

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
];

function cloneExtraction(
  value: DocumentIntakeExtraction,
): DocumentIntakeExtraction {
  return JSON.parse(JSON.stringify(value)) as DocumentIntakeExtraction;
}

function intakeReviewData(
  intake: DocumentIntakeRecord,
): DocumentIntakeExtraction {
  return Object.keys(intake.review_data).length
    ? (intake.review_data as DocumentIntakeExtraction)
    : intake.extracted_data;
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
      "notice",
    ].includes(type)
    ? type
    : null;
}

function workflowTaskNoun(workflowType: string | null) {
  switch (workflowType) {
    case "invoice_admin":
      return "billing review task";
    case "bank_guarantee":
      return "guarantee task";
    case "compliance":
      return "compliance task";
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
  return Boolean(
    (target.propertyId || fieldText(property?.name ?? property?.address)) &&
    (target.tenancyUnitId || fieldText(property?.unit_label)) &&
    (target.tenantId || reviewedTenantName(data)) &&
    fieldText(start?.date ?? start?.due_date) &&
    fieldText(expiry?.date ?? expiry?.due_date) &&
    fieldText(rent?.amount),
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
      label: "Tasks",
      value:
        obligationCount > 0
          ? `Create ${obligationCount} lease task${obligationCount === 1 ? "" : "s"}`
          : "No dated obligations yet",
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
  const taskNoun = workflowTaskNoun(outcome.workflowType);
  return (
    <SectionPanel
      title={isBilling ? "Prepared for billing" : "Applied to portfolio"}
      description={
        isBilling
          ? "Review-first billing work. Nothing was invoiced or synced."
          : "Review-first automation outcome"
      }
      icon={<Check size={17} className="text-leasium-success" />}
      actions={<StatusBadge tone="success">Applied</StatusBadge>}
    >
      <div className="grid gap-4 p-4">
        <div className="grid gap-3 rounded-2xl border border-leasium-success/20 bg-leasium-success-soft p-3 text-sm">
          <div className="font-semibold text-[#027A48]">
            {outcome.workflowType === "lease"
              ? `Created lease register records and ${outcome.obligationCount} ${
                  outcome.obligationCount === 1 ? "task" : "tasks"
                }.`
              : isBilling
                ? `Prepared ${outcome.obligationCount} billing review ${
                    outcome.obligationCount === 1 ? "task" : "tasks"
                  }. Nothing was posted to Xero.`
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
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <SecondaryButton type="button" onClick={onDismiss}>
            Back to Lease Inbox
          </SecondaryButton>
          {outcome.workflowType === "lease" ? (
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
            href="/tasks"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-transparent bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-leasium-blue-hover"
          >
            View Tasks
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
  onClear,
  saving,
  applying,
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
  onClear: () => void;
  saving: boolean;
  applying: boolean;
  clearing: boolean;
  demo?: boolean;
}) {
  const data = draft;
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
      : canApplyWorkflow &&
          workflowType !== "lease" &&
          obligationApplyCount === 0
        ? "Confirm at least one obligation due date before applying."
        : null;
  const visibleGroups = reviewGroups.filter(
    (group) => groupItems(draft, group.key).length > 0,
  );
  const groupTitle = (group: { key: ReviewGroupKey; title: string }) =>
    workflowType === "insurance_certificate" && group.key === "key_dates"
      ? "Policy dates"
      : workflowType === "lease" && group.key === "key_dates"
        ? "Lease dates"
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

        <div className="rounded-2xl border border-primary/15 bg-leasium-blue-soft p-3 text-sm text-leasium-blue-hover">
          Nothing is applied until you approve the items below and press Apply.
          Ignored items stay out of the reviewed data sent to the workflow.
        </div>

        <Field label="Summary">
          <textarea
            value={fieldText(draft.summary) ?? ""}
            onChange={(event) =>
              onDraftChange({ ...draft, summary: event.target.value })
            }
            className="min-h-20 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
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
          <div className="rounded-xl border border-primary/20 bg-leasium-blue-soft px-3 py-2 text-sm text-leasium-blue-hover">
            Demo preview only. Upload a live document when you are ready to save
            or apply.
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
                    : workflowType === "invoice_admin"
                      ? "Link the billing document to the right property, unit, or lease. Leasium prepares review work only."
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
              <div className="mt-3 grid gap-2 rounded-xl border border-primary/10 bg-leasium-blue-soft/60 p-3">
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
                              <span className="rounded-full bg-leasium-blue-soft px-2 py-1 text-xs font-semibold text-leasium-blue-hover">
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
                                      ? "bg-leasium-danger-soft text-danger"
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
            guarantees, notices, and billing docs first. Other documents can be
            saved as reviewed here for now.
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
                    : workflowType === "invoice_admin"
                      ? `Prepare ${obligationApplyCount} billing review ${obligationApplyCount === 1 ? "task" : "tasks"} at ${applyScope}. Nothing will be invoiced or synced. `
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
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [intakeNotice, setIntakeNotice] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
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
    onSuccess: (_result, payload) => {
      setLastApplyOutcome(payload.outcome);
      setIntakeNotice("Document workflow applied.");
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

  const displayPropertiesCount = demoMode
    ? 1
    : (propertiesQuery.data?.length ?? 0);
  const displayTenantsCount = demoMode ? 3 : (tenantsQuery.data?.length ?? 0);
  const displayObligations = useMemo(
    () => (demoMode ? demoObligationRows : (obligationsQuery.data ?? [])),
    [demoMode, demoObligationRows, obligationsQuery.data],
  );
  const displayRentRoll = useMemo(
    () => (demoMode ? demoRentRows : (rentRollQuery.data ?? [])),
    [demoMode, demoRentRows, rentRollQuery.data],
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
  const activeReviewIntakeId = reviewIntakeId ?? requestedReviewId;
  const selectedReviewIntake =
    reviewIntakes.find((item) => item.id === activeReviewIntakeId) ??
    reviewIntakes[0] ??
    null;
  const needsReviewCount = documentIntakes.filter((item) =>
    ["ready_for_review", "needs_attention"].includes(item.status),
  ).length;
  const failedIntakeCount = documentIntakes.filter(
    (item) => item.status === "failed",
  ).length;

  function uploadSmartIntake(file: File | null | undefined) {
    if (!file || !selectedEntityId || documentIntakeMutation.isPending) {
      return;
    }
    documentIntakeMutation.mutate(file);
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
              ? "Lease Inbox"
              : demoMode
                ? "Leasium demo portfolio"
                : (selectedEntity?.name ?? "Dashboard")
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

        {entitiesQuery.error && !demoMode ? (
          <div className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {friendlyError(entitiesQuery.error)}
          </div>
        ) : null}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <DashboardMetricCard
            href="/properties"
            label="Properties"
            count={displayPropertiesCount}
            chip={displayPropertiesCount ? "Live" : "Setup"}
            tone={displayPropertiesCount ? "success" : "neutral"}
            nextAction={
              displayPropertiesCount
                ? "Open the portfolio workspace."
                : "Create or import your first property."
            }
            icon={<Layers3 size={17} />}
          />
          <DashboardMetricCard
            href="/tenants"
            label="Tenants"
            count={displayTenantsCount}
            chip={activeOnboardings.length ? "Waiting" : "Ready"}
            tone={activeOnboardings.length ? "primary" : "success"}
            nextAction={
              activeOnboardings.length
                ? `${activeOnboardings.length} onboarding link waiting on tenants.`
                : "Add tenants or send onboarding links."
            }
            icon={<UserRound size={17} />}
          />
          <DashboardMetricCard
            href="/tasks"
            label="Attention"
            count={urgentObligations.length}
            chip={urgentObligations.length ? "Act now" : "Clear"}
            tone={urgentObligations.length ? "warning" : "success"}
            nextAction={
              urgentObligations[0]
                ? urgentObligations[0].title
                : "No urgent dates need action."
            }
            icon={<AlertTriangle size={17} />}
          />
          <DashboardMetricCard
            href="/billing-readiness"
            label="Billing blockers"
            count={billingIssues.length}
            chip={billingIssues.length ? "Blocked" : "Ready"}
            tone={billingIssues.length ? "danger" : "success"}
            nextAction={
              billingIssues[0]
                ? billingIssues[0].blockers[0]
                : "Invoice run is ready from current data."
            }
            icon={<ReceiptText size={17} />}
          />
          <DashboardMetricCard
            href="/intake"
            label="Needs review"
            count={needsReviewCount}
            chip={needsReviewCount ? "Review" : "Empty"}
            tone={needsReviewCount ? "primary" : "neutral"}
            nextAction={
              needsReviewCount
                ? "Approve extracted lease and tenant data."
                : "Drop documents into Lease Inbox."
            }
            icon={<Sparkles size={17} />}
          />
          <DashboardMetricCard
            href="/intake"
            label="Blocked docs"
            count={failedIntakeCount}
            chip={failedIntakeCount ? "Fix" : "Clear"}
            tone={failedIntakeCount ? "danger" : "success"}
            nextAction={
              failedIntakeCount
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
                    "grid min-h-32 place-items-center rounded-md border border-dashed p-4 text-center transition",
                    dragActive
                      ? "border-primary bg-primary/5"
                      : "border-border bg-muted/35 hover:border-primary/50 hover:bg-primary/5",
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
                    <span className="font-semibold">
                      {documentIntakeMutation.isPending
                        ? "Uploading document..."
                        : "Drop a document here"}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      Lease, invoice, guarantee, certificate, tenant document
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
                <div className="overflow-hidden rounded-md border border-border">
                  <div className="flex items-center justify-between border-b border-border px-3 py-2">
                    <span className="text-sm font-semibold">Review inbox</span>
                    <StatusBadge
                      tone={needsReviewCount ? "primary" : "neutral"}
                    >
                      {needsReviewCount} waiting
                    </StatusBadge>
                  </div>
                  <div className="divide-y divide-border">
                    {reviewIntakes.slice(0, 5).map((item) => {
                      const propertyName = firstField(
                        item.extracted_data.properties,
                        "name",
                      );
                      const tenantName =
                        firstField(item.extracted_data.parties, "name") ??
                        fieldText(
                          item.extracted_data.suggested_links?.tenant_name,
                        );
                      return (
                        <div
                          key={item.id}
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
                                href={`/intake?review=${item.id}`}
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
                    {reviewIntakes.length === 0 ? (
                      <EmptyState
                        title="No documents waiting for review."
                        description="Drop in a lease, guarantee, insurance certificate, invoice, or tenant document to start your first review."
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            </SectionPanel>

            {!isIntakeWorkspace ? (
              <SectionPanel title="Onboarding">
                <div className="grid gap-3 p-4 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Waiting on tenants
                    </span>
                    <span className="font-semibold">
                      {activeOnboardings.length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Submitted</span>
                    <span className="font-semibold">
                      {submittedOnboardings.length}
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
                      targetLabel:
                        workflowType === "lease"
                          ? reviewedLeaseTargetLabel(
                              reviewData,
                              reviewApplyTarget,
                              propertiesQuery.data ?? [],
                              reviewTenancyUnitsQuery.data ?? [],
                              tenantsQuery.data ?? [],
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
                onClear={() =>
                  deleteDocumentIntakeMutation.mutate(selectedReviewIntake.id)
                }
                saving={reviewDocumentIntakeMutation.isPending}
                applying={applyDocumentIntakeMutation.isPending}
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
                  title="No document selected."
                  description="Drop a lease, certificate, invoice, guarantee, or tenant document to start."
                />
              </SectionPanel>
            ) : null}
            {!isIntakeWorkspace ? (
              <SectionPanel
                title="Needs attention"
                icon={<ClipboardList size={17} className="text-primary" />}
              >
                <div className="divide-y divide-border">
                  {urgentObligations.slice(0, 6).map((item) => (
                    <Link
                      href="/properties"
                      key={item.id}
                      className="grid gap-2 px-4 py-3 transition hover:bg-muted/60 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">{item.title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {item.category.replaceAll("_", " ")}
                        </div>
                      </div>
                      <StatusBadge tone={obligationTone(item)}>
                        {dueLabel(item.due_date)}
                      </StatusBadge>
                    </Link>
                  ))}
                  {urgentObligations.length === 0 ? (
                    <EmptyState title="No urgent dates right now." />
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
                        className="block px-4 py-3 text-sm transition hover:bg-muted/60"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium">{event.title}</span>
                          <StatusBadge tone={event.tone}>
                            {dueLabel(event.date)}
                          </StatusBadge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {event.meta}
                        </div>
                      </Link>
                    ))}
                    {upcomingEvents.length === 0 ? (
                      <EmptyState title="No upcoming events for this entity." />
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
                          className="block px-4 py-3 text-sm transition hover:bg-muted/60"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate font-medium">
                                {row.unit_label}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {row.property_name} -{" "}
                                {row.tenant_name ?? "Vacant"}
                              </div>
                            </div>
                            <span className="text-xs font-medium">
                              {formatMoney(row.charge_rules_total_cents)}
                            </span>
                          </div>
                          <div className="mt-2 rounded bg-accent/10 px-2 py-1 text-xs">
                            {rowBlockers[0]}
                          </div>
                        </Link>
                      ))}
                    {billingIssues.length === 0 ? (
                      <EmptyState title="No billing readiness blockers." />
                    ) : null}
                  </div>
                </SectionPanel>
              </section>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
