"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ClipboardList,
  Copy,
  Download,
  FileText,
  History,
  Loader2,
  MailCheck,
  RefreshCw,
  Save,
  Search,
  Send,
  Sparkles,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import {
  EvidenceSourceTrail,
  type EvidenceFieldChange,
  type EvidenceHistoryRow,
  type EvidenceSourceDocument,
  type EvidenceSourceLocation,
} from "@/components/evidence-drawer";
import { QueryProvider } from "@/components/query-provider";
import {
  Button,
  chipClass,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SecondaryButton,
  SectionPanel,
  Select,
  StatusBadge,
  type StatusTone,
} from "@/components/ui";
import {
  createBillingDraftsFromChargeRules,
  createTenantOnboarding,
  listBillingDrafts,
  listDocumentIntakes,
  listEntities,
  listObligations,
  listProperties,
  listRentRoll,
  listTenantOnboardings,
  listTenants,
  TenantPayload,
  TenantRecord,
  updateProperty,
  updateTenant,
  type BillingDraftBatchRecord,
  type BillingDraftRecord,
  type DocumentIntakeRecord,
  type ObligationRecord,
  type PropertyRecord,
  type RentRollRow,
  type TenantOnboardingRecord,
} from "@/lib/api";
import { saveBlob } from "@/lib/download";
import { cn, friendlyError } from "@/lib/utils";

const ENTITY_STORAGE_KEY = "leasium.entity_id";

type QaTab = "issues" | "contacts" | "sources" | "onboarding" | "billing";

type QaIssue = {
  id: string;
  severity: StatusTone;
  area: string;
  title: string;
  detail: string;
  action: string;
  href: string;
};

type QaCompletionItem = {
  id: string;
  label: string;
  ready: number;
  total: number;
  detail: string;
  tab: QaTab;
};

type EnrichmentCandidate = {
  id: string;
  kind: "Property" | "Tenant";
  title: string;
  detail: string;
  href: string;
  fields: string[];
  priority: "high" | "medium";
  reason: string;
  impact: string;
  actionLabel: string;
};

type BlockedFollowup = {
  id: string;
  title: string;
  detail: string;
  tab: QaTab;
  tone: StatusTone;
};

type ReviewSummaryRow = {
  id: string;
  label: string;
  count: number;
  detail: string;
  tone: StatusTone;
  actionLabel?: string;
  tab?: QaTab;
  href?: string;
};

type BulkReviewGroup = {
  id: string;
  title: string;
  detail: string;
  count: number;
  tone: StatusTone;
  tab?: QaTab;
  href?: string;
  actionLabel: string;
  examples: string[];
  blockers: Array<{ label: string; count: number }>;
  rows: BulkReviewRow[];
};

type BulkReviewRow = {
  id: string;
  label: string;
  detail: string;
  blocker: string;
  blockers: string[];
  href?: string;
};

type BlockerReasonRow = {
  id: string;
  label: string;
  detail: string;
  href?: string;
};

type BlockerReason = {
  reason: string;
  explanation: string;
  count: number;
  tone: StatusTone;
  href?: string;
  rows: BlockerReasonRow[];
};

type CompletionReportStatus = "complete" | "review" | "blocked";

type ReadinessVerdict = {
  title: string;
  detail: string;
  tone: StatusTone;
};

type CleanupReportingGate = {
  key: string;
  label: string;
  status: string;
  detail: string;
  tone: StatusTone;
};

type CleanupNextAction = {
  id: string;
  title: string;
  detail: string;
  tone: StatusTone;
  actionLabel: string;
  tab?: QaTab;
  href?: string;
};

type SourceRow = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  source: string;
  href: string;
  evidence?: SourceEvidence;
};

type TenantPrepRow = {
  id: string;
  tenantId: string | null;
  leaseId: string | null;
  tenantName: string;
  propertyName: string;
  unitLabel: string;
  email: string | null;
  ready: boolean;
  blockers: string[];
  onboarding: TenantOnboardingRecord | null;
  tenantHref: string | null;
  propertyHref: string;
};

type TenantContactDraft = {
  contact_name?: string;
  contact_email?: string;
  billing_email?: string;
  abn?: string;
};

type PropertyBillingDraft = {
  owner_legal_name?: string;
  owner_abn?: string;
  trustee_name?: string;
  trust_name?: string;
  invoice_issuer_name?: string;
  billing_contact_name?: string;
  billing_email?: string;
  ownership_split?: string;
};

type SourceEvidence = {
  title: string;
  description?: string;
  sourceDocument?: string | EvidenceSourceDocument | null;
  sourceLocation?: string | EvidenceSourceLocation | null;
  confidence?: number | null;
  appliedAt?: string | null;
  appliedBy?: string | null;
  changes?: EvidenceFieldChange[];
  history?: EvidenceHistoryRow[];
};

const tabs: Array<{ id: QaTab; label: string; description: string }> = [
  { id: "issues", label: "Data QA", description: "Missing or odd records" },
  {
    id: "contacts",
    label: "Tenant contacts",
    description: "Clean invite details",
  },
  {
    id: "sources",
    label: "Source history",
    description: "Spreadsheet and intake trails",
  },
  {
    id: "onboarding",
    label: "Onboarding prep",
    description: "Ready or blocked",
  },
  {
    id: "billing",
    label: "Billing drafts",
    description: "Prepare internal drafts",
  },
];

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dueRank(value: string | null | undefined) {
  if (!value) {
    return 9999;
  }
  const today = new Date(`${dateOnly(new Date())}T00:00:00`).getTime();
  const due = new Date(`${value.slice(0, 10)}T00:00:00`).getTime();
  return Math.ceil((due - today) / 86_400_000);
}

function isExpiredDateTime(value: string | null | undefined) {
  if (!value) {
    return false;
  }
  return new Date(value).getTime() <= Date.now();
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

function label(value: string | null | undefined) {
  return value ? value.replaceAll("_", " ") : "None";
}

function cleanText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function metadataText(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return textValue(value);
}

function sourceLabel(metadata: Record<string, unknown>) {
  return (
    metadataText(metadata, "portfolio_import_source") ??
    metadataText(metadata, "source") ??
    metadataText(metadata, "source_sheet") ??
    "Leasium record"
  ).replaceAll("_", " ");
}

function sourceDetail(metadata: Record<string, unknown>) {
  const sheet = metadataText(metadata, "source_sheet");
  const row = metadata.source_row;
  const code = metadataText(metadata, "portfolio_code");
  const tenancyId = metadataText(metadata, "portfolio_tenancy_id");
  return [code, tenancyId, sheet ? `${sheet}${row ? ` row ${row}` : ""}` : null]
    .filter(Boolean)
    .join(" / ");
}

function tenantName(tenant: TenantRecord) {
  return tenant.trading_name
    ? `${tenant.trading_name} (${tenant.legal_name})`
    : tenant.legal_name;
}

function fieldLabel(field: string) {
  return field
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function shortId(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  return value.length > 10 ? `${value.slice(0, 8)}...` : value;
}

function intakeReviewHref(
  entityId: string | null | undefined,
  intakeId: string,
) {
  const params = entityId
    ? new URLSearchParams({ entity_id: entityId, review: intakeId })
    : new URLSearchParams({ review: intakeId });
  return `/intake?${params.toString()}`;
}

function sourceLocationFromParts({
  sheet,
  row,
  sourceHint,
}: {
  sheet?: string | null;
  row?: string | number | null;
  sourceHint?: string | null;
}): EvidenceSourceLocation | null {
  if (sheet) {
    return {
      label: row ? `${sheet} row ${row}` : sheet,
      detail: sourceHint ?? undefined,
    };
  }
  if (sourceHint) {
    return { label: sourceHint };
  }
  return null;
}

function citationLocation(value: unknown): EvidenceSourceLocation | null {
  if (!isRecord(value)) {
    return null;
  }
  const sourceHint = textValue(value.source_hint);
  const citation = textValue(value.citation);
  const url = textValue(value.url);
  const labelText = sourceHint ?? citation;
  if (!labelText) {
    return null;
  }
  return {
    label: labelText,
    href: url ?? undefined,
    detail: sourceHint && citation ? citation : undefined,
  };
}

function confidenceValue(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }
  return numberValue(value.confidence);
}

function evidenceChangesFromUnknown(changes: unknown): EvidenceFieldChange[] {
  if (!Array.isArray(changes)) {
    return [];
  }
  return changes
    .map((change, index): EvidenceFieldChange | null => {
      if (!isRecord(change)) {
        return null;
      }
      const field = textValue(change.field);
      if (!field) {
        return null;
      }
      const source = isRecord(change.source) ? change.source : null;
      return {
        id: `${field}-${index}`,
        field,
        label: textValue(change.label) ?? fieldLabel(field),
        before: change.before,
        after: change.after,
        sourceLocation: citationLocation(source),
        confidence: confidenceValue(source),
      } satisfies EvidenceFieldChange;
    })
    .filter((change): change is EvidenceFieldChange => change !== null);
}

function sourceHistoryRowsFromMetadata(metadata: Record<string, unknown>) {
  const history = Array.isArray(metadata.register_import_history)
    ? metadata.register_import_history
    : isRecord(metadata.last_register_import)
      ? [metadata.last_register_import]
      : [];
  return history.filter(isRecord);
}

function registerImportRows({
  kind,
  title,
  href,
  metadata,
}: {
  kind: string;
  title: string;
  href: string;
  metadata: Record<string, unknown>;
}): SourceRow[] {
  return sourceHistoryRowsFromMetadata(metadata).map((entry, index) => {
    const filename =
      textValue(entry.filename) ?? metadataText(metadata, "source_filename");
    const sheet =
      textValue(entry.sheet) ?? metadataText(metadata, "source_sheet");
    const row = textValue(entry.row) ?? numberValue(entry.row);
    const sourceHint =
      textValue(entry.source_hint) ?? metadataText(metadata, "source_hint");
    const changes = evidenceChangesFromUnknown(entry.changes);
    return {
      id: `${kind.toLowerCase()}-register-${title}-${index}`,
      kind,
      title,
      detail:
        [filename, sheet ? `${sheet}${row ? ` row ${row}` : ""}` : null]
          .filter(Boolean)
          .join(" / ") ||
        sourceHint ||
        "Register import",
      source: "Register import",
      href,
      evidence: {
        title: `${title} register import`,
        description:
          "Workbook action, reviewed field changes, and source row provenance.",
        sourceDocument: filename
          ? { label: filename, detail: "Imported workbook" }
          : "Imported workbook",
        sourceLocation: sourceLocationFromParts({ sheet, row, sourceHint }),
        confidence:
          numberValue(entry.confidence) ?? numberValue(metadata.confidence),
        changes,
        history: [
          {
            label: changes.length
              ? "Import action applied"
              : "Import source recorded",
            description:
              sourceHint ??
              [filename, sheet ? `${sheet}${row ? ` row ${row}` : ""}` : null]
                .filter(Boolean)
                .join(" / "),
            tone: changes.length ? "success" : "neutral",
          },
        ],
      },
    };
  });
}

function citationRows({
  kind,
  title,
  href,
  metadata,
}: {
  kind: string;
  title: string;
  href: string;
  metadata: Record<string, unknown>;
}): SourceRow[] {
  const citations = isRecord(metadata.source_citations)
    ? metadata.source_citations
    : null;
  if (!citations) {
    return [];
  }
  const changes = Object.entries(citations)
    .map(([field, source], index): EvidenceFieldChange | null => {
      const location = citationLocation(source);
      if (!location) {
        return null;
      }
      return {
        id: `${field}-citation-${index}`,
        field,
        label: fieldLabel(field),
        before: null,
        after:
          textValue(isRecord(source) ? source.citation : null) ??
          location.label,
        sourceLocation: location,
        confidence: confidenceValue(source),
      } satisfies EvidenceFieldChange;
    })
    .filter((change): change is EvidenceFieldChange => change !== null);
  if (!changes.length) {
    return [];
  }
  return [
    {
      id: `${kind.toLowerCase()}-citations-${title}`,
      kind,
      title,
      detail: `${changes.length} field citation${changes.length === 1 ? "" : "s"}`,
      source: "Field citations",
      href,
      evidence: {
        title: `${title} field citations`,
        description:
          "Reviewed source citations stored against individual fields.",
        sourceDocument: "Reviewed evidence",
        changes,
        history: changes.map((change) => ({
          label: `${change.label ?? fieldLabel(change.field)} source recorded`,
          description:
            typeof change.sourceLocation === "string"
              ? change.sourceLocation
              : change.sourceLocation?.label,
          tone: "primary",
        })),
      },
    },
  ];
}

function propertyApplyRows(property: PropertyRecord): SourceRow[] {
  const history = Array.isArray(property.metadata.apply_change_history)
    ? property.metadata.apply_change_history
    : [];
  return history.filter(isRecord).map((entry, index) => {
    const intakeId = textValue(entry.document_intake_id);
    const documentId = textValue(entry.document_id);
    const documentType = textValue(entry.document_type);
    const changes = evidenceChangesFromUnknown(entry.changes);
    return {
      id: `property-apply-${property.id}-${index}`,
      kind: "Property",
      title: property.name,
      detail:
        [
          documentType ? label(documentType) : null,
          shortId(intakeId) ?? shortId(documentId),
        ]
          .filter(Boolean)
          .join(" / ") || "Smart Intake apply history",
      source: "Smart Intake",
      href: intakeId
        ? intakeReviewHref(property.entity_id, intakeId)
        : `/properties?entity_id=${property.entity_id}&property_id=${property.id}`,
      evidence: {
        title: `${property.name} Smart Intake history`,
        description:
          "Source document and before/after changes applied to this property.",
        sourceDocument: {
          label: documentType ? label(documentType) : "Smart Intake document",
          href: intakeId
            ? intakeReviewHref(property.entity_id, intakeId)
            : undefined,
          detail: shortId(intakeId) ?? shortId(documentId) ?? undefined,
        },
        changes,
        history: [
          {
            label: "Smart Intake changes applied",
            description: changes.length
              ? `${changes.length} field change${changes.length === 1 ? "" : "s"} recorded.`
              : "No before/after field changes were stored.",
            tone: changes.length ? "success" : "neutral",
          },
        ],
      },
    };
  });
}

function tenantEnrichmentRows(tenant: TenantRecord): SourceRow[] {
  const enrichment = isRecord(tenant.metadata.public_enrichment)
    ? tenant.metadata.public_enrichment
    : null;
  const history = Array.isArray(enrichment?.apply_history)
    ? enrichment.apply_history
    : [];
  return history.filter(isRecord).map((entry, index) => {
    const field = textValue(entry.field) ?? "enrichment";
    const source = isRecord(entry.source) ? entry.source : null;
    const changes = [
      {
        id: `tenant-enrichment-${tenant.id}-${index}`,
        field,
        label: textValue(entry.label) ?? fieldLabel(field),
        before: entry.before,
        after: entry.after,
        sourceLocation: citationLocation(source),
        confidence: confidenceValue(source),
      } satisfies EvidenceFieldChange,
    ];
    return {
      id: `tenant-enrichment-${tenant.id}-${index}`,
      kind: "Tenant",
      title: tenantName(tenant),
      detail: `${fieldLabel(field)} enriched from public source`,
      source: "Public enrichment",
      href: `/tenants/${tenant.id}`,
      evidence: {
        title: `${tenantName(tenant)} public enrichment`,
        description:
          "Reviewed public-source field changes applied to this tenant.",
        sourceDocument: {
          label: "Public enrichment",
          detail: textValue(entry.label) ?? fieldLabel(field),
        },
        sourceLocation: citationLocation(source),
        confidence: confidenceValue(source),
        appliedAt: textValue(entry.applied_at),
        appliedBy: shortId(textValue(entry.applied_by_user_id)) ?? undefined,
        changes,
        history: [
          {
            label: `${fieldLabel(field)} enriched`,
            description:
              textValue(isRecord(source) ? source.citation : null) ?? undefined,
            occurredAt: textValue(entry.applied_at),
            tone: "success",
          },
        ],
      },
    };
  });
}

function severityTone(issue: QaIssue) {
  return issue.severity;
}

function issueSortRank(issue: QaIssue) {
  const ranks: Record<StatusTone, number> = {
    danger: 0,
    warning: 1,
    primary: 2,
    neutral: 3,
    success: 4,
  };
  return ranks[issue.severity];
}

function toneRank(tone: StatusTone) {
  const ranks: Record<StatusTone, number> = {
    danger: 5,
    warning: 4,
    primary: 3,
    neutral: 2,
    success: 1,
  };
  return ranks[tone];
}

function latestOnboarding(
  leaseId: string | null | undefined,
  tenantId: string | null | undefined,
  onboardings: TenantOnboardingRecord[],
) {
  if (!leaseId || !tenantId) {
    return null;
  }
  return (
    onboardings
      .filter(
        (item) =>
          item.lease_id === leaseId &&
          item.tenant_id === tenantId &&
          item.status !== "cancelled",
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
  );
}

function buildIssues({
  properties,
  tenants,
  rentRoll,
  obligations,
  intakes,
}: {
  properties: PropertyRecord[];
  tenants: TenantRecord[];
  rentRoll: RentRollRow[];
  obligations: ObligationRecord[];
  intakes: DocumentIntakeRecord[];
}) {
  const issues: QaIssue[] = [];

  for (const property of properties) {
    const missingAddress = [
      !property.suburb ? "suburb" : null,
      !property.state ? "state" : null,
      !property.postcode ? "postcode" : null,
    ].filter(Boolean);
    if (missingAddress.length) {
      issues.push({
        id: `property-address-${property.id}`,
        severity: "warning",
        area: "Property",
        title: `${property.name} address is incomplete`,
        detail: `Missing ${missingAddress.join(", ")}.`,
        action: "Open property setup",
        href: `/properties?entity_id=${property.entity_id}&property_id=${property.id}`,
      });
    }
    if (
      property.ownership_structure &&
      property.ownership_structure !== "current_entity" &&
      !property.owner_abn
    ) {
      issues.push({
        id: `property-owner-abn-${property.id}`,
        severity: "danger",
        area: "Billing identity",
        title: `${property.name} is missing owner ABN`,
        detail: "Owner/trust billing needs an ABN before invoice approval.",
        action: "Add owner ABN",
        href: `/properties?entity_id=${property.entity_id}&property_id=${property.id}`,
      });
    }
    if (!property.billing_email && !property.billing_contact_name) {
      issues.push({
        id: `property-billing-contact-${property.id}`,
        severity: "warning",
        area: "Billing identity",
        title: `${property.name} has no billing contact`,
        detail: "Useful before invoice approvals and owner snapshots.",
        action: "Add billing contact",
        href: `/properties?entity_id=${property.entity_id}&property_id=${property.id}`,
      });
    }
  }

  for (const tenant of tenants) {
    const missing = [
      !tenant.contact_email ? "contact email" : null,
      !tenant.billing_email ? "billing email" : null,
      !tenant.abn ? "ABN" : null,
      !tenant.contact_name ? "primary contact" : null,
    ].filter(Boolean);
    if (missing.length) {
      issues.push({
        id: `tenant-contact-${tenant.id}`,
        severity:
          !tenant.contact_email && !tenant.billing_email ? "danger" : "warning",
        area: "Tenant",
        title: `${tenantName(tenant)} needs contact cleanup`,
        detail: `Missing ${missing.join(", ")}.`,
        action: "Update tenant details",
        href: `/tenants/${tenant.id}`,
      });
    }
  }

  for (const row of rentRoll) {
    const blockers = [
      ...(row.invoice_readiness_blockers ?? []),
      ...(row.xero_readiness_blockers ?? []),
      ...(row.gst_readiness_blockers ?? []),
    ].filter(Boolean);
    if (blockers.length) {
      issues.push({
        id: `rent-roll-${row.tenancy_unit_id}`,
        severity: row.invoice_readiness_blockers?.length ? "danger" : "warning",
        area: "Billing",
        title: `${row.property_name} ${row.unit_label} billing is blocked`,
        detail: blockers[0],
        action: "Review billing readiness",
        href: "/billing-readiness",
      });
    }
    if (row.lease_id && (!row.commencement_date || !row.expiry_date)) {
      issues.push({
        id: `lease-dates-${row.lease_id}`,
        severity: "warning",
        area: "Lease",
        title: `${row.tenant_name ?? row.unit_label} lease dates need review`,
        detail: "Commencement or expiry date is missing.",
        action: "Open property operations",
        href: `/properties?entity_id=${row.entity_id}&property_id=${row.property_id}`,
      });
    }
  }

  for (const obligation of obligations) {
    if (["completed", "waived"].includes(obligation.status)) {
      continue;
    }
    const rank = dueRank(obligation.due_date);
    if (rank <= 30 || obligation.priority <= 1) {
      issues.push({
        id: `obligation-${obligation.id}`,
        severity: rank < 0 ? "danger" : rank <= 14 ? "warning" : "primary",
        area: "Operations",
        title: obligation.title,
        detail: `${label(obligation.category)} due ${formatDate(obligation.due_date)}.`,
        action: "Open operations",
        href: "/operations",
      });
    }
  }

  for (const intake of intakes) {
    if (
      ["ready_for_review", "needs_attention", "failed"].includes(intake.status)
    ) {
      issues.push({
        id: `intake-${intake.id}`,
        severity: intake.status === "failed" ? "danger" : "primary",
        area: "Smart Intake",
        title: intake.filename,
        detail: `${label(intake.document_type)} is ${label(intake.status)}.`,
        action: "Review document",
        href: intakeReviewHref(intake.entity_id, intake.id),
      });
    }
  }

  return issues.sort((a, b) => issueSortRank(a) - issueSortRank(b));
}

function buildSources({
  properties,
  tenants,
  obligations,
  intakes,
  drafts,
}: {
  properties: PropertyRecord[];
  tenants: TenantRecord[];
  obligations: ObligationRecord[];
  intakes: DocumentIntakeRecord[];
  drafts: BillingDraftRecord[];
}) {
  const rows: SourceRow[] = [];
  for (const property of properties) {
    const href = `/properties?entity_id=${property.entity_id}&property_id=${property.id}`;
    if (
      sourceDetail(property.metadata) ||
      metadataText(property.metadata, "portfolio_import_source")
    ) {
      rows.push({
        id: `property-${property.id}`,
        kind: "Property",
        title: property.name,
        detail: sourceDetail(property.metadata) || property.street_address,
        source: sourceLabel(property.metadata),
        href,
      });
    }
    rows.push(
      ...registerImportRows({
        kind: "Property",
        title: property.name,
        href,
        metadata: property.metadata,
      }),
      ...propertyApplyRows(property),
      ...citationRows({
        kind: "Property",
        title: property.name,
        href,
        metadata: property.metadata,
      }),
    );
  }
  for (const tenant of tenants) {
    const href = `/tenants/${tenant.id}`;
    if (
      sourceDetail(tenant.metadata) ||
      metadataText(tenant.metadata, "insurance_status")
    ) {
      rows.push({
        id: `tenant-${tenant.id}`,
        kind: "Tenant",
        title: tenantName(tenant),
        detail:
          sourceDetail(tenant.metadata) ||
          [
            metadataText(tenant.metadata, "insurance_status"),
            metadataText(tenant.metadata, "arrears"),
          ]
            .filter(Boolean)
            .join(" / "),
        source: sourceLabel(tenant.metadata),
        href,
      });
    }
    rows.push(
      ...registerImportRows({
        kind: "Tenant",
        title: tenantName(tenant),
        href,
        metadata: tenant.metadata,
      }),
      ...tenantEnrichmentRows(tenant),
      ...citationRows({
        kind: "Tenant",
        title: tenantName(tenant),
        href,
        metadata: tenant.metadata,
      }),
    );
  }
  for (const obligation of obligations) {
    if (
      sourceDetail(obligation.metadata) ||
      metadataText(obligation.metadata, "portfolio_import_key")
    ) {
      rows.push({
        id: `obligation-${obligation.id}`,
        kind: "Operations",
        title: obligation.title,
        detail:
          sourceDetail(obligation.metadata) || formatDate(obligation.due_date),
        source: sourceLabel(obligation.metadata),
        href: "/operations",
      });
    }
  }
  for (const intake of intakes) {
    rows.push({
      id: `intake-${intake.id}`,
      kind: "Smart Intake",
      title: intake.filename,
      detail: `${label(intake.document_type)} / ${label(intake.status)}`,
      source: "Uploaded document",
      href: intakeReviewHref(intake.entity_id, intake.id),
    });
  }
  for (const draft of drafts) {
    if (metadataText(draft.metadata, "source")) {
      rows.push({
        id: `billing-draft-${draft.id}`,
        kind: "Billing",
        title: draft.title,
        detail: `${formatMoney(draft.total_cents)} / ${label(draft.status)}`,
        source: sourceLabel(draft.metadata),
        href: "/billing-readiness",
      });
    }
  }
  return rows.slice(0, 120);
}

function buildTenantPrep(
  rentRoll: RentRollRow[],
  tenants: TenantRecord[],
  onboardings: TenantOnboardingRecord[],
) {
  const tenantById = new Map(tenants.map((tenant) => [tenant.id, tenant]));
  return rentRoll
    .filter((row) => row.lease_id || row.tenant_id)
    .map((row) => {
      const tenant = row.tenant_id ? tenantById.get(row.tenant_id) : undefined;
      const onboarding = latestOnboarding(
        row.lease_id,
        row.tenant_id,
        onboardings,
      );
      const email =
        tenant?.billing_email ||
        tenant?.contact_email ||
        row.tenant_billing_email ||
        null;
      const onboardingExpired = isExpiredDateTime(onboarding?.expires_at);
      const blockers = [
        !row.lease_id ? "No active lease" : null,
        !row.tenant_id || !tenant ? "Tenant record missing" : null,
        !email ? "No tenant email" : null,
        onboardingExpired
          ? "Existing onboarding link expired"
          : onboarding
            ? `Existing onboarding ${label(onboarding.status)}`
            : null,
      ].filter((item): item is string => Boolean(item));
      return {
        id: row.lease_id ?? row.tenancy_unit_id,
        tenantId: row.tenant_id,
        leaseId: row.lease_id,
        tenantName: tenant
          ? tenantName(tenant)
          : (row.tenant_name ?? "Tenant missing"),
        propertyName: row.property_name,
        unitLabel: row.unit_label,
        email,
        ready: Boolean(row.lease_id && row.tenant_id && email && !onboarding),
        blockers,
        onboarding,
        tenantHref: row.tenant_id ? `/tenants/${row.tenant_id}` : null,
        propertyHref: `/properties?entity_id=${row.entity_id}&property_id=${row.property_id}`,
      } satisfies TenantPrepRow;
    })
    .sort(
      (a, b) =>
        Number(b.ready) - Number(a.ready) ||
        a.tenantName.localeCompare(b.tenantName),
    );
}

function tenantMissingContactFields(tenant: TenantRecord) {
  return [
    !tenant.contact_name ? "primary contact" : null,
    !tenant.contact_email ? "contact email" : null,
    !tenant.billing_email ? "billing email" : null,
    !tenant.abn ? "ABN" : null,
  ].filter((item): item is string => Boolean(item));
}

function propertyMissingBillingFields(property: PropertyRecord) {
  const ownerScoped =
    property.ownership_structure &&
    property.ownership_structure !== "current_entity";
  return [
    ownerScoped && !property.owner_legal_name ? "legal owner" : null,
    ownerScoped && !property.owner_abn ? "owner ABN" : null,
    !property.invoice_issuer_name ? "invoice issuer" : null,
    !property.billing_contact_name ? "billing contact" : null,
    !property.billing_email ? "billing email" : null,
  ].filter((item): item is string => Boolean(item));
}

function tenantContactPayload(
  tenant: TenantRecord,
  draft: TenantContactDraft,
): Partial<TenantPayload> {
  return {
    contact_name: cleanText(draft.contact_name ?? tenant.contact_name ?? ""),
    contact_email: cleanText(draft.contact_email ?? tenant.contact_email ?? ""),
    billing_email: cleanText(draft.billing_email ?? tenant.billing_email ?? ""),
    abn: cleanText(draft.abn ?? tenant.abn ?? ""),
  };
}

function propertyBillingPayload(
  property: PropertyRecord,
  draft: PropertyBillingDraft,
) {
  return {
    owner_legal_name: cleanText(
      draft.owner_legal_name ?? property.owner_legal_name ?? "",
    ),
    owner_abn: cleanText(draft.owner_abn ?? property.owner_abn ?? ""),
    trustee_name: cleanText(draft.trustee_name ?? property.trustee_name ?? ""),
    trust_name: cleanText(draft.trust_name ?? property.trust_name ?? ""),
    invoice_issuer_name: cleanText(
      draft.invoice_issuer_name ?? property.invoice_issuer_name ?? "",
    ),
    billing_contact_name: cleanText(
      draft.billing_contact_name ?? property.billing_contact_name ?? "",
    ),
    billing_email: cleanText(
      draft.billing_email ?? property.billing_email ?? "",
    ),
    ownership_split: cleanText(
      draft.ownership_split ?? property.ownership_split ?? "",
    ),
  };
}

function buildEnrichmentCandidates({
  properties,
  tenants,
}: {
  properties: PropertyRecord[];
  tenants: TenantRecord[];
}) {
  const propertyFields = [
    "suburb",
    "state",
    "postcode",
    "owner_legal_name",
    "owner_abn",
    "trustee_name",
    "trust_name",
    "invoice_issuer_name",
  ] as const;
  const tenantFields = [
    "legal_name",
    "trading_name",
    "abn",
    "registered_address",
  ] as const;
  const candidates: EnrichmentCandidate[] = [];

  for (const property of properties) {
    const fields = propertyFields.filter((field) => {
      return !property[field];
    });
    if (fields.length) {
      const ownerFields = fields.filter((field) =>
        [
          "owner_legal_name",
          "owner_abn",
          "trustee_name",
          "trust_name",
          "invoice_issuer_name",
        ].includes(field),
      );
      candidates.push({
        id: `property-enrichment-${property.id}`,
        kind: "Property",
        title: property.name,
        detail:
          "Property public enrichment can propose address and ownership fields.",
        href: `/properties?entity_id=${property.entity_id}&property_id=${property.id}`,
        fields: fields.map(fieldLabel),
        priority: ownerFields.length ? "high" : "medium",
        reason: ownerFields.length
          ? "May unblock owner billing identity and statement readiness."
          : "Can tidy address fields before the next register pass.",
        impact: ownerFields.length
          ? "Owner statements and invoice approvals"
          : "Register cleanup and map/search quality",
        actionLabel: ownerFields.length
          ? "Review billing identity"
          : "Review property fields",
      });
    }
  }

  for (const tenant of tenants) {
    const metadata = isRecord(tenant.metadata.public_enrichment)
      ? tenant.metadata.public_enrichment
      : {};
    const fields = tenantFields.filter((field) => {
      if (field === "registered_address") {
        return (
          !tenant.metadata.registered_address && !metadata.registered_address
        );
      }
      return !tenant[field];
    });
    if (fields.length) {
      const identityFields = fields.filter((field) =>
        ["legal_name", "trading_name", "abn"].includes(field),
      );
      candidates.push({
        id: `tenant-enrichment-${tenant.id}`,
        kind: "Tenant",
        title: tenantName(tenant),
        detail:
          "Tenant public enrichment can propose ABN, trading name, and registered address.",
        href: `/tenants/${tenant.id}`,
        fields: fields.map(fieldLabel),
        priority: identityFields.length ? "high" : "medium",
        reason: identityFields.length
          ? "May improve tenant identity, invoice setup, and onboarding review."
          : "Can add context to the tenant record after core fields are clear.",
        impact: identityFields.length
          ? "Tenant identity, billing, and onboarding review"
          : "Tenant context and register completeness",
        actionLabel: identityFields.length
          ? "Review tenant identity"
          : "Review tenant context",
      });
    }
  }

  return candidates
    .sort(
      (a, b) =>
        (b.priority === "high" ? 1 : 0) - (a.priority === "high" ? 1 : 0) ||
        b.fields.length - a.fields.length ||
        a.title.localeCompare(b.title),
    )
    .slice(0, 8);
}

function buildCompletionItems({
  issues,
  tenantsNeedingContact,
  propertiesNeedingBillingFix,
  tenantPrep,
  billingDrafts,
  sources,
}: {
  issues: QaIssue[];
  tenantsNeedingContact: TenantRecord[];
  propertiesNeedingBillingFix: PropertyRecord[];
  tenantPrep: TenantPrepRow[];
  billingDrafts: BillingDraftRecord[];
  sources: SourceRow[];
}): QaCompletionItem[] {
  const dangerIssues = issues.filter(
    (issue) => issue.severity === "danger",
  ).length;
  const warningIssues = issues.filter(
    (issue) => issue.severity === "warning",
  ).length;
  const readyPrep = tenantPrep.filter((row) => row.ready).length;
  const activeBillingDrafts = billingDrafts.filter(
    (draft) => !["void", "superseded"].includes(draft.status),
  ).length;
  return [
    {
      id: "data-qa",
      label: "Data QA",
      ready: Math.max(0, issues.length - dangerIssues - warningIssues),
      total: issues.length,
      detail: issues.length
        ? `${dangerIssues} urgent blockers, ${warningIssues} warnings`
        : "No open QA issues",
      tab: "issues",
    },
    {
      id: "tenant-contacts",
      label: "Tenant contacts",
      ready: Math.max(0, tenantPrep.length - tenantsNeedingContact.length),
      total: tenantPrep.length,
      detail: tenantsNeedingContact.length
        ? `${tenantsNeedingContact.length} tenants need contact fields`
        : "Invite contacts look complete",
      tab: "contacts",
    },
    {
      id: "owner-billing",
      label: "Owner billing",
      ready: Math.max(0, propertiesNeedingBillingFix.length === 0 ? 1 : 0),
      total: 1,
      detail: propertiesNeedingBillingFix.length
        ? `${propertiesNeedingBillingFix.length} properties need billing identity`
        : "Owner billing fields are complete",
      tab: "issues",
    },
    {
      id: "onboarding",
      label: "Onboarding",
      ready: readyPrep,
      total: tenantPrep.length,
      detail: readyPrep
        ? `${readyPrep} leases ready for invite creation`
        : "No leases ready for batch invite",
      tab: "onboarding",
    },
    {
      id: "billing-drafts",
      label: "Billing drafts",
      ready: activeBillingDrafts,
      total: Math.max(activeBillingDrafts, 1),
      detail: activeBillingDrafts
        ? `${activeBillingDrafts} internal drafts available`
        : "Create drafts from charge rules when ready",
      tab: "billing",
    },
    {
      id: "source-trails",
      label: "Source trails",
      ready: sources.length,
      total: Math.max(sources.length, 1),
      detail: sources.length
        ? `${sources.length} provenance rows visible`
        : "No source history visible yet",
      tab: "sources",
    },
  ];
}

function buildBlockedFollowups({
  issues,
  tenantPrep,
}: {
  issues: QaIssue[];
  tenantPrep: TenantPrepRow[];
}): BlockedFollowup[] {
  const issueFollowups = issues
    .filter(
      (issue) => issue.severity === "danger" || issue.severity === "warning",
    )
    .sort((a, b) => issueSortRank(a) - issueSortRank(b))
    .map((issue) => ({
      id: `issue-${issue.id}`,
      title: issue.title,
      detail: issue.detail,
      tab: (issue.area === "Tenant" ? "contacts" : "issues") as QaTab,
      tone: issue.severity,
    }));
  const onboardingFollowups = tenantPrep
    .filter((row) => !row.ready && row.blockers.length)
    .map((row) => ({
      id: `onboarding-${row.id}`,
      title: `${row.tenantName} invite blocked`,
      detail: row.blockers.join(" / "),
      tab: "onboarding" as const,
      tone: "warning" as const,
    }));
  return [...issueFollowups, ...onboardingFollowups].slice(0, 5);
}

function buildOnboardingReviewRows(
  tenantPrep: TenantPrepRow[],
): ReviewSummaryRow[] {
  const readyRows = tenantPrep.filter((row) => row.ready);
  const missingEmailRows = tenantPrep.filter((row) =>
    row.blockers.some((blocker) => blocker.includes("email")),
  );
  const expiredRows = tenantPrep.filter((row) =>
    row.blockers.some((blocker) => blocker.includes("expired")),
  );
  const existingInviteRows = tenantPrep.filter((row) =>
    row.blockers.some((blocker) => blocker.includes("Existing onboarding")),
  );
  const setupRows = tenantPrep.filter((row) =>
    row.blockers.some(
      (blocker) =>
        blocker.includes("No active lease") ||
        blocker.includes("Tenant record missing"),
    ),
  );
  return [
    {
      id: "ready-invites",
      label: "Ready invites",
      count: readyRows.length,
      detail: readyRows.length
        ? "Can be selected for reviewed invite creation."
        : "No tenant rows are ready for batch invite creation yet.",
      tone: readyRows.length ? "success" : "neutral",
    },
    {
      id: "missing-contact",
      label: "Contact blockers",
      count: missingEmailRows.length,
      detail: missingEmailRows.length
        ? "Tenant email is missing before an invite can be created."
        : "Invite contact emails are present.",
      tone: missingEmailRows.length ? "warning" : "success",
      actionLabel: missingEmailRows.length ? "Fix contacts" : undefined,
      tab: missingEmailRows.length ? "contacts" : undefined,
    },
    {
      id: "expired-links",
      label: "Expired links",
      count: expiredRows.length,
      detail: expiredRows.length
        ? "Use the row recovery action before sending another link."
        : "No expired onboarding links in this scan.",
      tone: expiredRows.length ? "warning" : "success",
      actionLabel: expiredRows.length ? "Review rows" : undefined,
      tab: expiredRows.length ? "onboarding" : undefined,
    },
    {
      id: "existing-invites",
      label: "Existing invites",
      count: existingInviteRows.length,
      detail: existingInviteRows.length
        ? "These rows already have an active onboarding workflow."
        : "No existing invite workflows are blocking batch creation.",
      tone: existingInviteRows.length ? "primary" : "success",
      actionLabel: existingInviteRows.length ? "Review rows" : undefined,
      tab: existingInviteRows.length ? "onboarding" : undefined,
    },
    {
      id: "setup-blockers",
      label: "Setup blockers",
      count: setupRows.length,
      detail: setupRows.length
        ? "Lease or tenant records need setup before onboarding."
        : "Lease and tenant links are present.",
      tone: setupRows.length ? "danger" : "success",
    },
  ];
}

function buildBillingReviewRows({
  issues,
  billingDrafts,
}: {
  issues: QaIssue[];
  billingDrafts: BillingDraftRecord[];
}): ReviewSummaryRow[] {
  const ownerBillingIssues = issues.filter(
    (issue) => issue.area === "Billing identity",
  );
  const billingReadinessIssues = issues.filter(
    (issue) => issue.area === "Billing",
  );
  const activeDrafts = billingDrafts.filter(
    (draft) => !["void", "superseded"].includes(draft.status),
  );
  const approvedDrafts = activeDrafts.filter(
    (draft) => draft.status === "approved",
  );
  return [
    {
      id: "owner-billing-fixes",
      label: "Owner billing fixes",
      count: ownerBillingIssues.length,
      detail:
        ownerBillingIssues[0]?.title ?? "Owner billing identity is clear.",
      tone: ownerBillingIssues.length ? "warning" : "success",
      actionLabel: ownerBillingIssues.length ? "Open Data QA" : undefined,
      tab: ownerBillingIssues.length ? "issues" : undefined,
    },
    {
      id: "billing-readiness-blockers",
      label: "Billing readiness blockers",
      count: billingReadinessIssues.length,
      detail:
        billingReadinessIssues[0]?.detail ??
        "No rent-roll billing blockers are visible in Portfolio QA.",
      tone: billingReadinessIssues.length ? "warning" : "success",
      actionLabel: billingReadinessIssues.length
        ? "Open Billing Readiness"
        : undefined,
      href: billingReadinessIssues.length ? "/billing-readiness" : undefined,
    },
    {
      id: "internal-drafts",
      label: "Internal drafts",
      count: activeDrafts.length,
      detail: activeDrafts.length
        ? `${approvedDrafts.length} approved, ${activeDrafts.length - approvedDrafts.length} still in review.`
        : "Create drafts from reviewed charge rules when ready.",
      tone: activeDrafts.length ? "primary" : "neutral",
      actionLabel: activeDrafts.length ? "Review drafts" : undefined,
      href: activeDrafts.length ? "/billing-readiness" : undefined,
    },
  ];
}

function blockerBreakdown(values: string[], limit = 3) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const cleaned = value.trim();
    if (!cleaned) {
      continue;
    }
    counts.set(cleaned, (counts.get(cleaned) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

// Plain-English "why it matters" for the blocker phrases the backend emits.
// Matched case-insensitively as substrings so dynamic charge-type prefixes
// (e.g. "Rent is missing a Xero account code.") still resolve. Any reason not
// matched here falls back to its raw blocker text so nothing is ever hidden.
const BLOCKER_EXPLANATIONS: Array<{ match: string; explanation: string }> = [
  // Onboarding (from buildTenantPrep)
  {
    match: "no tenant email",
    explanation: "Onboarding invites and invoices can't reach the tenant.",
  },
  {
    match: "no active lease",
    explanation: "Without a current lease there is nothing to onboard or bill.",
  },
  {
    match: "tenant record missing",
    explanation: "The lease has no tenant link, so no invite can be addressed.",
  },
  {
    match: "onboarding link expired",
    explanation: "The previous invite lapsed; recover it before sending again.",
  },
  {
    match: "existing onboarding",
    explanation: "A workflow is already running for this row; review it first.",
  },
  // Invoice readiness (blocks creating a billing draft)
  {
    match: "missing a billing email",
    explanation: "Onboarding invites and invoices can't reach the tenant.",
  },
  {
    match: "tenant billing email missing",
    explanation: "Onboarding invites and invoices can't reach the tenant.",
  },
  {
    match: "has no current lease",
    explanation: "Blocks creating a billing draft until a lease is in place.",
  },
  {
    match: "has no charge rules",
    explanation: "Blocks creating a billing draft with no charges to invoice.",
  },
  {
    match: "has no amount",
    explanation: "Blocks creating a billing draft until the charge has a value.",
  },
  {
    match: "missing the next due date",
    explanation: "Blocks scheduling the charge on a billing draft.",
  },
  {
    match: "invoice issuer missing",
    explanation: "Blocks creating a billing draft without a named issuer.",
  },
  {
    match: "abn missing for property owner",
    explanation: "Owner/trust billing needs an ABN before invoice approval.",
  },
  {
    match: "trustee missing",
    explanation: "Trust billing needs a trustee before invoice approval.",
  },
  {
    match: "ownership split incomplete",
    explanation: "Split ownership needs shares set before invoice approval.",
  },
  // Xero readiness (blocks syncing the invoice to Xero)
  {
    match: "not connected to xero",
    explanation: "Blocks syncing the invoice to Xero until connected.",
  },
  {
    match: "missing a xero account code",
    explanation: "Blocks syncing the invoice to Xero without an account code.",
  },
  {
    match: "missing a xero tax type",
    explanation: "Blocks syncing the invoice to Xero without a tax type.",
  },
  {
    match: "xero issuer mapping missing",
    explanation: "Blocks syncing the invoice to Xero without an issuer contact.",
  },
  // GST readiness (blocks posting a taxable charge)
  {
    match: "not gst registered",
    explanation: "Blocks posting a taxable charge until GST status is set.",
  },
];

function blockerExplanation(reason: string) {
  const lower = reason.toLowerCase();
  return (
    BLOCKER_EXPLANATIONS.find((entry) => lower.includes(entry.match))
      ?.explanation ?? reason
  );
}

// Distinct blocker reasons across ALL rows in a group (uncapped), with a count
// and the affected rows per reason. Sorted by count desc so the most common
// reason leads. The group tone colours every reason consistently.
function groupBlockerReasons(group: BulkReviewGroup): BlockerReason[] {
  const reasons = new Map<string, BlockerReason>();
  for (const row of group.rows) {
    const seen = new Set<string>();
    for (const raw of row.blockers) {
      const reason = raw.trim();
      if (!reason || seen.has(reason)) {
        continue;
      }
      seen.add(reason);
      const existing = reasons.get(reason);
      const reasonRow: BlockerReasonRow = {
        id: row.id,
        label: row.label,
        detail: row.detail,
        href: row.href,
      };
      if (existing) {
        existing.count += 1;
        existing.rows.push(reasonRow);
      } else {
        reasons.set(reason, {
          reason,
          explanation: blockerExplanation(reason),
          count: 1,
          tone: group.tone,
          href: row.href,
          rows: [reasonRow],
        });
      }
    }
  }
  return [...reasons.values()].sort(
    (a, b) => b.count - a.count || a.reason.localeCompare(b.reason),
  );
}

function buildBulkReviewGroups({
  tenantPrep,
  issues,
  billingDrafts,
}: {
  tenantPrep: TenantPrepRow[];
  issues: QaIssue[];
  billingDrafts: BillingDraftRecord[];
}): BulkReviewGroup[] {
  const onboardingBlocked = tenantPrep.filter(
    (row) => !row.ready && row.blockers.length > 0,
  );
  const contactBlocked = onboardingBlocked.filter((row) =>
    row.blockers.some((blocker) => blocker.includes("email")),
  );
  const setupBlocked = onboardingBlocked.filter((row) =>
    row.blockers.some(
      (blocker) =>
        blocker.includes("No active lease") ||
        blocker.includes("Tenant record missing"),
    ),
  );
  const existingInviteBlocked = onboardingBlocked.filter((row) =>
    row.blockers.some((blocker) => blocker.includes("Existing onboarding")),
  );
  const ownerBillingIssues = issues.filter(
    (issue) => issue.area === "Billing identity",
  );
  const billingReadinessIssues = issues.filter(
    (issue) => issue.area === "Billing",
  );
  const reviewDrafts = billingDrafts.filter(
    (draft) => !["approved", "void", "superseded"].includes(draft.status),
  );

  const groups: BulkReviewGroup[] = [
    {
      id: "onboarding-contact",
      title: "Onboarding contact fixes",
      detail: "Rows blocked because tenant email details are incomplete.",
      count: contactBlocked.length,
      tone: contactBlocked.length ? "warning" : "success",
      tab: contactBlocked.length ? "contacts" : undefined,
      actionLabel: contactBlocked.length ? "Fix contacts" : "Clear",
      examples: contactBlocked
        .slice(0, 3)
        .map((row) => `${row.tenantName} / ${row.propertyName}`),
      blockers: blockerBreakdown(contactBlocked.flatMap((row) => row.blockers)),
      rows: contactBlocked.map((row) => ({
        id: row.id,
        label: `${row.tenantName} / ${row.propertyName}`,
        detail: row.unitLabel,
        blocker: row.blockers.join(" / "),
        blockers: row.blockers,
        href: row.tenantHref ?? undefined,
      })),
    },
    {
      id: "onboarding-setup",
      title: "Onboarding setup blockers",
      detail: "Rows that need a lease or tenant link before invites can run.",
      count: setupBlocked.length,
      tone: setupBlocked.length ? "danger" : "success",
      tab: setupBlocked.length ? "onboarding" : undefined,
      actionLabel: setupBlocked.length ? "Review setup" : "Clear",
      examples: setupBlocked
        .slice(0, 3)
        .map((row) => `${row.tenantName} / ${row.propertyName}`),
      blockers: blockerBreakdown(setupBlocked.flatMap((row) => row.blockers)),
      rows: setupBlocked.map((row) => ({
        id: row.id,
        label: `${row.tenantName} / ${row.propertyName}`,
        detail: row.unitLabel,
        blocker: row.blockers.join(" / "),
        blockers: row.blockers,
        href: row.propertyHref,
      })),
    },
    {
      id: "onboarding-existing",
      title: "Existing invite workflows",
      detail: "Rows already in an onboarding workflow or needing recovery.",
      count: existingInviteBlocked.length,
      tone: existingInviteBlocked.length ? "primary" : "success",
      tab: existingInviteBlocked.length ? "onboarding" : undefined,
      actionLabel: existingInviteBlocked.length ? "Review invites" : "Clear",
      examples: existingInviteBlocked
        .slice(0, 3)
        .map((row) => `${row.tenantName} / ${row.propertyName}`),
      blockers: blockerBreakdown(
        existingInviteBlocked.flatMap((row) => row.blockers),
      ),
      rows: existingInviteBlocked.map((row) => ({
        id: row.id,
        label: `${row.tenantName} / ${row.propertyName}`,
        detail: row.onboarding
          ? `Onboarding ${label(row.onboarding.status)}`
          : row.unitLabel,
        blocker: row.blockers.join(" / "),
        blockers: row.blockers,
        href: row.tenantHref ?? undefined,
      })),
    },
    {
      id: "billing-owner",
      title: "Owner billing identity",
      detail: "Properties missing owner, trust, ABN, or billing contact data.",
      count: ownerBillingIssues.length,
      tone: ownerBillingIssues.length ? "warning" : "success",
      tab: ownerBillingIssues.length ? "issues" : undefined,
      actionLabel: ownerBillingIssues.length ? "Open fixes" : "Clear",
      examples: ownerBillingIssues.slice(0, 3).map((issue) => issue.title),
      blockers: blockerBreakdown(
        ownerBillingIssues.map((issue) => issue.detail),
      ),
      rows: ownerBillingIssues.map((issue) => ({
        id: issue.id,
        label: issue.title,
        detail: issue.action,
        blocker: issue.detail,
        blockers: [issue.detail],
        href: issue.href,
      })),
    },
    {
      id: "billing-readiness",
      title: "Rent-roll billing blockers",
      detail: "Rows blocked by invoice, GST, or Xero readiness checks.",
      count: billingReadinessIssues.length,
      tone: billingReadinessIssues.length ? "warning" : "success",
      href: billingReadinessIssues.length ? "/billing-readiness" : undefined,
      actionLabel: billingReadinessIssues.length ? "Open billing" : "Clear",
      examples: billingReadinessIssues.slice(0, 3).map((issue) => issue.title),
      blockers: blockerBreakdown(
        billingReadinessIssues.map((issue) => issue.detail),
      ),
      rows: billingReadinessIssues.map((issue) => ({
        id: issue.id,
        label: issue.title,
        detail: issue.action,
        blocker: issue.detail,
        blockers: [issue.detail],
        href: issue.href,
      })),
    },
    {
      id: "billing-review-drafts",
      title: "Drafts still in review",
      detail: "Internal billing drafts that exist but are not approved yet.",
      count: reviewDrafts.length,
      tone: reviewDrafts.length ? "primary" : "success",
      href: reviewDrafts.length ? "/billing-readiness" : undefined,
      actionLabel: reviewDrafts.length ? "Review drafts" : "Clear",
      examples: reviewDrafts.slice(0, 3).map((draft) => draft.title),
      blockers: blockerBreakdown(
        reviewDrafts.map((draft) => label(draft.status)),
      ),
      rows: reviewDrafts.map((draft) => ({
        id: draft.id,
        label: draft.title,
        detail: `${formatMoney(draft.total_cents)} / ${label(draft.status)}`,
        blocker: label(draft.status),
        blockers: [label(draft.status)],
        href: "/billing-readiness",
      })),
    },
  ];

  return groups.sort(
    (a, b) =>
      toneRank(b.tone) - toneRank(a.tone) ||
      b.count - a.count ||
      a.title.localeCompare(b.title),
  );
}

function MetricCard({
  label: metricLabel,
  value,
  detail,
  tone = "neutral",
  icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  tone?: StatusTone;
  icon: ReactNode;
}) {
  const tones = {
    neutral: "bg-muted text-slate",
    success: "bg-success-soft text-success-strong",
    warning: "bg-warning-soft text-warning-strong",
    danger: "bg-danger-soft text-danger-strong",
    primary: "bg-primary-soft text-primary-hover",
  };
  return (
    <div className="rounded-2xl border border-border bg-white p-4 shadow-leasiumXs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-2xl font-semibold">{value}</div>
          <div className="mt-1 text-sm font-medium">{metricLabel}</div>
        </div>
        <div className={cn("rounded-xl p-2", tones[tone])}>{icon}</div>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

function ReviewSummaryStrip({
  title,
  description,
  rows,
  onOpenTab,
}: {
  title: string;
  description: string;
  rows: ReviewSummaryRow[];
  onOpenTab: (tab: QaTab) => void;
}) {
  return (
    <div className="border-b border-border bg-muted/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <StatusBadge
          tone={
            rows.some((row) => row.tone === "danger" || row.tone === "warning")
              ? "warning"
              : "success"
          }
        >
          {rows.reduce((sum, row) => sum + row.count, 0)} tracked
        </StatusBadge>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {rows.map((row) => {
          const body = (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-foreground">
                  {row.label}
                </span>
                <StatusBadge tone={row.tone}>{row.count}</StatusBadge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{row.detail}</p>
              {row.actionLabel ? (
                <span className="mt-3 inline-flex text-xs font-semibold text-primary">
                  {row.actionLabel}
                </span>
              ) : null}
            </>
          );
          const className =
            "rounded-xl border border-border bg-white p-3 text-left shadow-leasiumXs transition hover:bg-muted/60";
          if (row.href) {
            return (
              <Link key={row.id} href={row.href} className={className}>
                {body}
              </Link>
            );
          }
          if (row.tab) {
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => onOpenTab(row.tab as QaTab)}
                className={className}
              >
                {body}
              </button>
            );
          }
          return (
            <div key={row.id} className={className}>
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function cleanupReadinessVerdict({
  completion,
  blockedCount,
  enrichmentCount,
}: {
  completion: number;
  blockedCount: number;
  enrichmentCount: number;
}): ReadinessVerdict {
  if (blockedCount > 0) {
    return {
      title: "Register cleanup still blocked",
      detail: `${blockedCount} follow-up${blockedCount === 1 ? "" : "s"} need review before this register is ready for SKJ tuning.${
        enrichmentCount
          ? ` ${enrichmentCount} enrichment candidate${enrichmentCount === 1 ? "" : "s"} may help fill public-safe fields.`
          : ""
      }`,
      tone: completion >= 60 ? "warning" : "danger",
    };
  }
  if (enrichmentCount > 0) {
    return {
      title: "Ready after enrichment review",
      detail: `${enrichmentCount} enrichment candidate${enrichmentCount === 1 ? "" : "s"} remain. Review or dismiss them before treating the cleanup report as final.`,
      tone: "primary",
    };
  }
  return {
    title: "Ready for SKJ tuning",
    detail:
      "No blocked cleanup rows remain in this scan. The next step is live portfolio tuning and Remba review, not another batch action.",
    tone: completion >= 90 ? "success" : "primary",
  };
}

function cleanupReportingGates({
  completion,
  activeBulkGroups,
  enrichmentCandidates,
  blockedFollowups,
}: {
  completion: number;
  activeBulkGroups: BulkReviewGroup[];
  enrichmentCandidates: EnrichmentCandidate[];
  blockedFollowups: BlockedFollowup[];
}): CleanupReportingGate[] {
  const highImpactEnrichmentCount = enrichmentCandidates.filter(
    (candidate) => candidate.priority === "high",
  ).length;
  const unresolvedCount =
    activeBulkGroups.length +
    enrichmentCandidates.length +
    blockedFollowups.length;

  return [
    {
      key: "blocked-followups",
      label: "Blocked rows",
      status: blockedFollowups.length ? "Needs review" : "Clear",
      detail: blockedFollowups.length
        ? `${blockedFollowups.length} row${blockedFollowups.length === 1 ? "" : "s"} still need manual cleanup.`
        : "No blocked cleanup rows remain in this scan.",
      tone: blockedFollowups.length ? "danger" : "success",
    },
    {
      key: "bulk-review",
      label: "Bulk review",
      status: activeBulkGroups.length ? "Queued" : "Clear",
      detail: activeBulkGroups.length
        ? `${activeBulkGroups.length} grouped pass${activeBulkGroups.length === 1 ? "" : "es"} should be cleared before sign-off.`
        : "No onboarding or billing bulk-review groups are active.",
      tone: activeBulkGroups.length ? "warning" : "success",
    },
    {
      key: "enrichment-review",
      label: "Enrichment",
      status: enrichmentCandidates.length
        ? highImpactEnrichmentCount
          ? "High-impact"
          : "Review"
        : "Clear",
      detail: enrichmentCandidates.length
        ? `${enrichmentCandidates.length} candidate${enrichmentCandidates.length === 1 ? "" : "s"} remain, including ${highImpactEnrichmentCount} high-impact.`
        : "No obvious public enrichment candidates remain.",
      tone: highImpactEnrichmentCount
        ? "warning"
        : enrichmentCandidates.length
          ? "primary"
          : "success",
    },
    {
      key: "report-status",
      label: "Report state",
      status: unresolvedCount
        ? completion >= 60
          ? "Draft"
          : "Blocked"
        : "Ready",
      detail: unresolvedCount
        ? `${unresolvedCount} gate${unresolvedCount === 1 ? "" : "s"} still need attention before the report is final.`
        : "Ready to hand to the SKJ tuning pass.",
      tone: unresolvedCount
        ? completion >= 60
          ? "warning"
          : "danger"
        : "success",
    },
  ];
}

function cleanupReportText({
  completion,
  verdict,
  itemStatuses,
  reportingGates,
  activeBulkGroups,
  nextActions,
  enrichmentCandidates,
  blockedFollowups,
}: {
  completion: number;
  verdict: ReadinessVerdict;
  itemStatuses: Array<{
    item: QaCompletionItem;
    percent: number;
    status: CompletionReportStatus;
  }>;
  reportingGates: CleanupReportingGate[];
  activeBulkGroups: BulkReviewGroup[];
  nextActions: CleanupNextAction[];
  enrichmentCandidates: EnrichmentCandidate[];
  blockedFollowups: BlockedFollowup[];
}) {
  const lines = [
    "Portfolio QA cleanup report",
    `${completion}% checks ready - ${verdict.title}`,
    verdict.detail,
    "",
    "Completion states:",
    ...itemStatuses.map(
      ({ item, percent, status }) =>
        `- ${item.label}: ${percent}% ready (${status}) - ${item.detail}`,
    ),
    "",
    "Reporting gates:",
    ...reportingGates.map(
      (gate) => `- ${gate.label}: ${gate.status} - ${gate.detail}`,
    ),
    "",
    "Next cleanup actions:",
    ...nextActions.map(
      (action) => `- ${action.title}: ${action.actionLabel} - ${action.detail}`,
    ),
    "",
    "Bulk review queue:",
    ...(activeBulkGroups.length
      ? activeBulkGroups.map((group) =>
          [
            `- ${group.title}: ${group.count} rows - ${group.detail}`,
            group.blockers.length
              ? `Top blockers: ${group.blockers
                  .map((blocker) => `${blocker.label} (${blocker.count})`)
                  .join(", ")}`
              : null,
            group.examples.length
              ? `Examples: ${group.examples.join(" / ")}`
              : null,
            group.rows.length
              ? `Rows: ${group.rows
                  .slice(0, 5)
                  .map((row) => `${row.label} - ${row.blocker}`)
                  .join(" / ")}`
              : null,
          ]
            .filter(Boolean)
            .join(" "),
        )
      : ["- Clear: no onboarding or billing bulk-review groups need action."]),
    "",
    "AI-assisted enrichment candidates:",
    ...(enrichmentCandidates.length
      ? enrichmentCandidates
          .slice(0, 8)
          .map(
            (candidate) =>
              `- ${candidate.title}: ${candidate.priority} priority, ${candidate.fields.length} fields - ${candidate.impact} - ${candidate.reason}`,
          )
      : ["- Clear: no obvious enrichment candidates remain."]),
    "",
    "Blocked follow-ups:",
    ...(blockedFollowups.length
      ? blockedFollowups
          .slice(0, 8)
          .map((followup) => `- ${followup.title}: ${followup.detail}`)
      : ["- Clear: no blocked cleanup rows remain in the current scan."]),
  ];
  return lines.join("\n");
}

function csvCell(value: string | number | null | undefined) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function cleanupReportCsv({
  completion,
  verdict,
  itemStatuses,
  reportingGates,
  activeBulkGroups,
  nextActions,
  enrichmentCandidates,
  blockedFollowups,
}: {
  completion: number;
  verdict: ReadinessVerdict;
  itemStatuses: Array<{
    item: QaCompletionItem;
    percent: number;
    status: CompletionReportStatus;
  }>;
  reportingGates: CleanupReportingGate[];
  activeBulkGroups: BulkReviewGroup[];
  nextActions: CleanupNextAction[];
  enrichmentCandidates: EnrichmentCandidate[];
  blockedFollowups: BlockedFollowup[];
}) {
  const rows: Array<Array<string | number | null | undefined>> = [
    ["Category", "Item", "Status", "Metric", "Detail", "Action", "Extra"],
    [
      "Summary",
      verdict.title,
      "Final report",
      `${completion}% checks ready`,
      verdict.detail,
      "Copy report",
      "",
    ],
    ...itemStatuses.map(({ item, percent, status }) => [
      "Completion state",
      item.label,
      status,
      `${percent}% ready`,
      item.detail,
      "Open section",
      item.tab,
    ]),
    ...reportingGates.map((gate) => [
      "Reporting gate",
      gate.label,
      gate.status,
      "",
      gate.detail,
      "",
      gate.tone,
    ]),
    ...nextActions.map((action) => [
      "Next action",
      action.title,
      action.tone,
      "",
      action.detail,
      action.actionLabel,
      action.tab ?? action.href ?? "",
    ]),
    ...(activeBulkGroups.length
      ? activeBulkGroups.flatMap((group) => [
          [
            "Active bulk group",
            group.title,
            group.tone,
            `${group.count} rows`,
            group.detail,
            group.actionLabel,
            [
              group.blockers.length
                ? `Top blockers: ${group.blockers
                    .map((blocker) => `${blocker.label} (${blocker.count})`)
                    .join("; ")}`
                : null,
              group.examples.length
                ? `Examples: ${group.examples.join(" / ")}`
                : null,
            ]
              .filter(Boolean)
              .join(" | "),
          ],
          ...group.rows.map((row) => [
            "Blocker drilldown",
            group.title,
            group.tone,
            row.label,
            row.blocker,
            group.actionLabel,
            row.detail,
          ]),
        ])
      : [
          [
            "Active bulk group",
            "Clear",
            "success",
            "0 rows",
            "No onboarding or billing bulk-review groups need action.",
            "",
            "",
          ],
        ]),
    ...(enrichmentCandidates.length
      ? enrichmentCandidates.map((candidate) => [
          "Enrichment candidate",
          candidate.title,
          candidate.priority,
          `${candidate.fields.length} fields`,
          `${candidate.impact} - ${candidate.reason}`,
          candidate.actionLabel,
          `${candidate.kind}: ${candidate.fields.join("; ")}`,
        ])
      : [
          [
            "Enrichment candidate",
            "Clear",
            "success",
            "0 queued",
            "No obvious enrichment candidates remain.",
            "",
            "",
          ],
        ]),
    ...(blockedFollowups.length
      ? blockedFollowups.map((followup) => [
          "Blocked follow-up",
          followup.title,
          followup.tone,
          "",
          followup.detail,
          "Open follow-up",
          followup.tab,
        ])
      : [
          [
            "Blocked follow-up",
            "Clear",
            "success",
            "0 open",
            "No blocked cleanup rows remain in the current scan.",
            "",
            "",
          ],
        ]),
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function cleanupNextActions({
  itemStatuses,
  activeBulkGroups,
  enrichmentCandidates,
  blockedFollowups,
}: {
  itemStatuses: Array<{
    item: QaCompletionItem;
    percent: number;
    status: CompletionReportStatus;
  }>;
  activeBulkGroups: BulkReviewGroup[];
  enrichmentCandidates: EnrichmentCandidate[];
  blockedFollowups: BlockedFollowup[];
}): CleanupNextAction[] {
  const actions: CleanupNextAction[] = [];
  const blockedSections = itemStatuses.filter(
    (item) => item.status === "blocked",
  );
  const highImpactEnrichment = enrichmentCandidates.filter(
    (candidate) => candidate.priority === "high",
  );

  for (const group of activeBulkGroups.slice(0, 2)) {
    actions.push({
      id: `bulk-${group.id}`,
      title: group.title,
      detail: group.detail,
      tone: group.tone,
      actionLabel: group.actionLabel,
      tab: group.tab,
      href: group.href,
    });
  }

  if (blockedSections.length) {
    const section = blockedSections[0];
    actions.push({
      id: `section-${section.item.id}`,
      title: `${section.item.label} is blocked`,
      detail: section.item.detail,
      tone: "danger",
      actionLabel: "Open section",
      tab: section.item.tab,
    });
  }

  if (highImpactEnrichment.length) {
    actions.push({
      id: "high-impact-enrichment",
      title: "Review high-impact enrichment",
      detail: `${highImpactEnrichment.length} sourced candidate${
        highImpactEnrichment.length === 1 ? "" : "s"
      } may unblock owner, tenant, or billing identity cleanup.`,
      tone: "primary",
      actionLabel: "Review candidates",
      href: highImpactEnrichment[0]?.href,
    });
  }

  if (!actions.length && blockedFollowups.length) {
    const followup = blockedFollowups[0];
    actions.push({
      id: `followup-${followup.id}`,
      title: followup.title,
      detail: followup.detail,
      tone: followup.tone,
      actionLabel: "Open follow-up",
      tab: followup.tab,
    });
  }

  if (!actions.length) {
    actions.push({
      id: "final-signoff",
      title: "Prepare final cleanup signoff",
      detail:
        "No bulk blocker groups are active. Use the copied report as the handoff for live portfolio tuning.",
      tone: "success",
      actionLabel: "Copy report",
    });
  }

  return actions.slice(0, 4);
}

function enrichmentFieldBreakdown(
  candidates: EnrichmentCandidate[],
  limit = 5,
) {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    for (const field of candidate.fields) {
      counts.set(field, (counts.get(field) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function enrichmentQueueText(candidates: EnrichmentCandidate[]) {
  const highImpact = candidates.filter(
    (candidate) => candidate.priority === "high",
  );
  const propertyCount = candidates.filter(
    (candidate) => candidate.kind === "Property",
  ).length;
  const tenantCount = candidates.filter(
    (candidate) => candidate.kind === "Tenant",
  ).length;
  const topFields = enrichmentFieldBreakdown(candidates, 8);
  if (!candidates.length) {
    return [
      "Portfolio QA enrichment queue",
      "No obvious public-safe enrichment candidates remain in the current scan.",
    ].join("\n");
  }
  return [
    "Portfolio QA enrichment queue",
    `${candidates.length} candidates: ${propertyCount} property / ${tenantCount} tenant / ${highImpact.length} high-impact`,
    topFields.length
      ? `Top missing fields: ${topFields.map((field) => `${field.label} (${field.count})`).join(", ")}`
      : "Top missing fields: none",
    "",
    ...candidates
      .slice(0, 8)
      .map((candidate) =>
        [
          `${candidate.title} (${candidate.kind})`,
          `Priority: ${candidate.priority}`,
          `Impact: ${candidate.impact}`,
          `Fields: ${candidate.fields.join(", ")}`,
          `Reason: ${candidate.reason}`,
          `Action: ${candidate.actionLabel}`,
        ].join("\n"),
      ),
    "",
    "Review-only: accept sourced suggestions only after checking citations and before treating the SKJ cleanup report as final.",
  ].join("\n\n");
}

function enrichmentQueueCsv(candidates: EnrichmentCandidate[]) {
  const rows: Array<Array<string | number | null | undefined>> = [
    [
      "Category",
      "Record",
      "Type",
      "Priority",
      "Missing fields",
      "Impact",
      "Reason",
      "Action",
      "Guardrail",
    ],
    ...(candidates.length
      ? candidates.map((candidate) => [
          "Enrichment candidate",
          candidate.title,
          candidate.kind,
          candidate.priority,
          candidate.fields.join("; "),
          candidate.impact,
          candidate.reason,
          candidate.actionLabel,
          "Review-only: accept sourced suggestions only after checking citations.",
        ])
      : [
          [
            "Enrichment candidate",
            "Clear",
            "",
            "success",
            "",
            "No obvious enrichment candidates remain.",
            "",
            "",
            "Review-only: accept sourced suggestions only after checking citations.",
          ],
        ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function blockerTriageText(groups: BulkReviewGroup[]) {
  const activeGroups = groups.filter((group) => group.count > 0);
  if (!activeGroups.length) {
    return [
      "Portfolio QA blocker triage",
      "No onboarding or billing blocker groups need action in the current scan.",
    ].join("\n");
  }
  return [
    "Portfolio QA blocker triage",
    `${activeGroups.reduce((sum, group) => sum + group.count, 0)} rows across ${activeGroups.length} blocker groups`,
    "",
    ...activeGroups.map((group) =>
      [
        `${group.title}: ${group.count} rows`,
        group.detail,
        group.blockers.length
          ? `Top reasons: ${group.blockers
              .map((blocker) => `${blocker.label} (${blocker.count})`)
              .join(", ")}`
          : null,
        group.examples.length
          ? `Examples: ${group.examples.join(" / ")}`
          : null,
        `Next action: ${group.actionLabel}`,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    "",
    "Review-only: apply tenant/contact/billing fixes from the relevant tab after checking the row details.",
  ].join("\n\n");
}

function BlockerReasonBreakdown({
  groups,
  onOpenTab,
}: {
  groups: BulkReviewGroup[];
  onOpenTab: (tab: QaTab) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (key: string) =>
    setExpanded((current) => ({ ...current, [key]: !current[key] }));

  return (
    <div className="mt-3 grid gap-3" data-testid="blocker-reason-breakdown">
      <div className="text-sm font-semibold text-foreground">
        Reason breakdown
      </div>
      <p className="-mt-2 text-sm text-muted-foreground">
        Every distinct blocker reason in each group, why it matters, and a
        guided fix. Review the affected rows before applying any change.
      </p>
      {groups.map((group) => {
        const reasons = groupBlockerReasons(group);
        if (!reasons.length) {
          return null;
        }
        return (
          <div
            key={group.id}
            data-testid={`reason-group-${group.id}`}
            className="grid gap-2 rounded-md border border-border bg-white p-3 shadow-leasiumXs"
          >
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={group.tone}>{group.count}</StatusBadge>
              <span className="font-semibold text-foreground">
                {group.title}
              </span>
            </div>
            <div className="divide-y divide-border">
              {reasons.map((reason) => {
                const key = `${group.id}::${reason.reason}`;
                const isOpen = Boolean(expanded[key]);
                const fixBody = (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
                    {group.actionLabel}
                    <ArrowRight size={13} />
                  </span>
                );
                return (
                  <div key={key} className="grid gap-2 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={chipClass(reason.tone, { bordered: true })}>
                            {reason.count}
                          </span>
                          <span className="font-medium text-foreground">
                            {reason.reason}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {reason.explanation}
                        </p>
                      </div>
                      {reason.href ? (
                        <Link href={reason.href} className="shrink-0">
                          {fixBody}
                        </Link>
                      ) : group.tab ? (
                        <button
                          type="button"
                          onClick={() => group.tab && onOpenTab(group.tab)}
                          className="shrink-0"
                        >
                          {fixBody}
                        </button>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => toggle(key)}
                      aria-expanded={isOpen}
                      className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-muted-foreground transition hover:text-primary"
                    >
                      {isOpen
                        ? "Hide affected rows"
                        : `Show ${reason.count} affected row${
                            reason.count === 1 ? "" : "s"
                          }`}
                    </button>
                    {isOpen ? (
                      <div className="grid gap-1 rounded-md border border-border bg-muted/30 p-2">
                        {reason.rows.map((row, index) => {
                          const rowBody = (
                            <>
                              <span className="truncate font-medium text-foreground">
                                {row.label}
                              </span>
                              {row.detail ? (
                                <span className="shrink-0 text-muted-foreground">
                                  {row.detail}
                                </span>
                              ) : null}
                            </>
                          );
                          const rowClass =
                            "flex items-center justify-between gap-2 px-1 py-1 text-xs";
                          return row.href ? (
                            <Link
                              key={`${row.id}-${index}`}
                              href={row.href}
                              className={cn(
                                rowClass,
                                "transition hover:text-primary",
                              )}
                            >
                              {rowBody}
                            </Link>
                          ) : (
                            <div key={`${row.id}-${index}`} className={rowClass}>
                              {rowBody}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BlockerTriagePanel({
  groups,
  onOpenTab,
}: {
  groups: BulkReviewGroup[];
  onOpenTab: (tab: QaTab) => void;
}) {
  const [copyReceipt, setCopyReceipt] = useState<string | null>(null);
  const activeGroups = groups.filter((group) => group.count > 0);
  const totalRows = activeGroups.reduce((sum, group) => sum + group.count, 0);
  const topReasons = blockerBreakdown(
    activeGroups.flatMap((group) =>
      group.blockers.flatMap((blocker) =>
        Array.from({ length: blocker.count }, () => blocker.label),
      ),
    ),
    5,
  );
  const copyTriage = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setCopyReceipt("Copy unavailable in this browser.");
      return;
    }
    await navigator.clipboard.writeText(blockerTriageText(groups));
    setCopyReceipt("Blocker triage packet copied.");
  };

  return (
    <SectionPanel
      title="Blocker triage packet"
      description="The current onboarding and billing blockers, grouped into the next cleanup pass."
      icon={<AlertTriangle size={17} className="text-primary" />}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <SecondaryButton type="button" onClick={copyTriage}>
            <Copy size={15} />
            Copy triage
          </SecondaryButton>
          <StatusBadge tone={totalRows ? "warning" : "success"}>
            {totalRows ? `${totalRows} rows` : "Clear"}
          </StatusBadge>
        </div>
      }
    >
      <div className="grid gap-4 p-4">
        {copyReceipt ? (
          <p className="text-sm font-medium text-success">{copyReceipt}</p>
        ) : null}

        {!activeGroups.length ? (
          <div className="rounded-md border border-success/20 bg-success-soft px-4 py-3 text-sm text-success-strong">
            No onboarding or billing blocker groups need action in this scan.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone="warning">
                {activeGroups.length} blocker groups
              </StatusBadge>
              {topReasons.map((reason) => (
                <StatusBadge key={reason.label} tone="neutral">
                  {reason.label}: {reason.count}
                </StatusBadge>
              ))}
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              {activeGroups.map((group) => {
                const body = (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-foreground">
                          {group.title}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {group.detail}
                        </p>
                      </div>
                      <StatusBadge tone={group.tone}>{group.count}</StatusBadge>
                    </div>
                    {group.blockers.length ? (
                      <div className="flex flex-wrap gap-1">
                        {group.blockers.map((blocker) => (
                          <span
                            key={blocker.label}
                            className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-leasium-micro font-semibold text-muted-foreground"
                            title={blocker.label}
                          >
                            <span className="truncate">{blocker.label}</span>
                            <span className="rounded-full bg-white px-1 text-[10px] text-foreground">
                              {blocker.count}
                            </span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {group.examples.length ? (
                      <p className="text-xs text-muted-foreground">
                        {group.examples.join(" / ")}
                      </p>
                    ) : null}
                    <span className="text-xs font-semibold text-primary">
                      {group.actionLabel}
                    </span>
                  </>
                );
                const className =
                  "grid gap-3 rounded-md border border-border bg-white p-3 text-left shadow-leasiumXs transition hover:bg-muted/60";
                if (group.href) {
                  return (
                    <Link
                      key={group.id}
                      href={group.href}
                      className={className}
                    >
                      {body}
                    </Link>
                  );
                }
                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => group.tab && onOpenTab(group.tab)}
                    className={className}
                  >
                    {body}
                  </button>
                );
              })}
            </div>

            <BlockerReasonBreakdown
              groups={activeGroups}
              onOpenTab={onOpenTab}
            />
          </>
        )}
      </div>
    </SectionPanel>
  );
}

function PortfolioCompletionPanel({
  items,
  enrichmentCandidates,
  blockedFollowups,
  bulkReviewGroups,
  onOpenTab,
}: {
  items: QaCompletionItem[];
  enrichmentCandidates: EnrichmentCandidate[];
  blockedFollowups: BlockedFollowup[];
  bulkReviewGroups: BulkReviewGroup[];
  onOpenTab: (tab: QaTab) => void;
}) {
  const [reportReceipt, setReportReceipt] = useState<string | null>(null);
  const [enrichmentReceipt, setEnrichmentReceipt] = useState<string | null>(
    null,
  );
  const total = items.reduce((sum, item) => sum + item.total, 0);
  const ready = items.reduce(
    (sum, item) => sum + Math.min(item.ready, item.total),
    0,
  );
  const completion = total > 0 ? Math.round((ready / total) * 100) : 100;
  const verdict = cleanupReadinessVerdict({
    completion,
    blockedCount: blockedFollowups.length,
    enrichmentCount: enrichmentCandidates.length,
  });
  const itemStatuses = items.map((item) => {
    const percent =
      item.total > 0
        ? Math.round((Math.min(item.ready, item.total) / item.total) * 100)
        : 100;
    const status: CompletionReportStatus =
      percent >= 90 ? "complete" : percent >= 60 ? "review" : "blocked";
    return {
      item,
      percent,
      status,
    };
  });
  const completeCount = itemStatuses.filter(
    (item) => item.status === "complete",
  ).length;
  const reviewCount = itemStatuses.filter(
    (item) => item.status === "review",
  ).length;
  const blockedSectionCount = itemStatuses.filter(
    (item) => item.status === "blocked",
  ).length;
  const activeBulkGroups = bulkReviewGroups.filter((group) => group.count > 0);
  const highImpactEnrichmentCount = enrichmentCandidates.filter(
    (candidate) => candidate.priority === "high",
  ).length;
  const propertyEnrichmentCount = enrichmentCandidates.filter(
    (candidate) => candidate.kind === "Property",
  ).length;
  const tenantEnrichmentCount =
    enrichmentCandidates.length - propertyEnrichmentCount;
  const topEnrichmentFields = enrichmentFieldBreakdown(enrichmentCandidates);
  const nextActions = cleanupNextActions({
    itemStatuses,
    activeBulkGroups,
    enrichmentCandidates,
    blockedFollowups,
  });
  const reportingGates = cleanupReportingGates({
    completion,
    activeBulkGroups,
    enrichmentCandidates,
    blockedFollowups,
  });
  const copyReport = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setReportReceipt("Copy unavailable in this browser.");
      return;
    }
    await navigator.clipboard.writeText(
      cleanupReportText({
        completion,
        verdict,
        itemStatuses,
        reportingGates,
        activeBulkGroups,
        nextActions,
        enrichmentCandidates,
        blockedFollowups,
      }),
    );
    setReportReceipt("Cleanup report copied.");
  };
  const downloadReportCsv = () => {
    saveBlob(
      new Blob(
        [
          cleanupReportCsv({
            completion,
            verdict,
            itemStatuses,
            reportingGates,
            activeBulkGroups,
            nextActions,
            enrichmentCandidates,
            blockedFollowups,
          }),
        ],
        { type: "text/csv;charset=utf-8" },
      ),
      "portfolio-qa-cleanup-report.csv",
    );
    setReportReceipt("Cleanup report CSV downloaded.");
  };
  const copyEnrichmentQueue = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setEnrichmentReceipt("Copy unavailable in this browser.");
      return;
    }
    await navigator.clipboard.writeText(
      enrichmentQueueText(enrichmentCandidates),
    );
    setEnrichmentReceipt("Enrichment queue copied.");
  };
  const downloadEnrichmentQueueCsv = () => {
    saveBlob(
      new Blob([enrichmentQueueCsv(enrichmentCandidates)], {
        type: "text/csv;charset=utf-8",
      }),
      "portfolio-qa-enrichment-queue.csv",
    );
    setEnrichmentReceipt("Enrichment queue CSV downloaded.");
  };

  return (
    <SectionPanel
      title="Cleanup readiness report"
      description="A practical scan of what can move now, what needs review, and where public enrichment may help."
      icon={<ClipboardList size={17} className="text-primary" />}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <SecondaryButton type="button" onClick={copyReport}>
            <Copy size={15} />
            Copy report
          </SecondaryButton>
          <SecondaryButton type="button" onClick={downloadReportCsv}>
            <Download size={15} />
            Download report CSV
          </SecondaryButton>
          <StatusBadge
            tone={
              completion >= 90
                ? "success"
                : completion >= 60
                  ? "warning"
                  : "danger"
            }
          >
            {completion}% checks ready
          </StatusBadge>
        </div>
      }
    >
      <div className="border-b border-border bg-muted/30 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">
              {verdict.title}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {verdict.detail}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone={verdict.tone}>Final report</StatusBadge>
            <StatusBadge tone="success">{completeCount} complete</StatusBadge>
            <StatusBadge tone={reviewCount ? "warning" : "neutral"}>
              {reviewCount} review
            </StatusBadge>
            <StatusBadge tone={blockedSectionCount ? "danger" : "neutral"}>
              {blockedSectionCount} blocked
            </StatusBadge>
          </div>
        </div>
        {reportReceipt ? (
          <p className="mt-3 text-sm font-medium text-success">
            {reportReceipt}
          </p>
        ) : null}
      </div>
      <div className="grid gap-3 border-b border-border bg-white p-4 md:grid-cols-4">
        {reportingGates.map((gate) => (
          <div
            key={gate.key}
            className="grid gap-2 rounded-xl border border-border bg-muted/30 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-foreground">
                {gate.label}
              </span>
              <StatusBadge tone={gate.tone}>{gate.status}</StatusBadge>
            </div>
            <p className="text-sm text-muted-foreground">{gate.detail}</p>
          </div>
        ))}
      </div>
      <div className="border-b border-border bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">
              Next cleanup actions
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              The most useful actions to take before treating this scan as ready
              for live portfolio tuning.
            </p>
          </div>
          <StatusBadge
            tone={
              nextActions.some((action) => action.tone === "danger")
                ? "danger"
                : nextActions.some((action) => action.tone === "warning")
                  ? "warning"
                  : nextActions.some((action) => action.tone === "primary")
                    ? "primary"
                    : "success"
            }
          >
            {nextActions.length} next
          </StatusBadge>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-4">
          {nextActions.map((action) => {
            const body = (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-foreground">
                    {action.title}
                  </div>
                  <StatusBadge tone={action.tone}>
                    {tabs.find((tab) => tab.id === action.tab)?.label ??
                      action.actionLabel}
                  </StatusBadge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {action.detail}
                </p>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                  {action.actionLabel}
                  <ArrowRight size={13} />
                </span>
              </>
            );
            const className =
              "rounded-xl border border-border bg-muted/30 p-3 text-left shadow-leasiumXs transition hover:bg-muted/60";
            if (action.href) {
              return (
                <Link key={action.id} href={action.href} className={className}>
                  {body}
                </Link>
              );
            }
            if (action.tab) {
              return (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => onOpenTab(action.tab as QaTab)}
                  className={className}
                >
                  {body}
                </button>
              );
            }
            return (
              <button
                key={action.id}
                type="button"
                onClick={copyReport}
                className={className}
              >
                {body}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {itemStatuses.map(({ item, percent, status }) => {
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenTab(item.tab)}
                aria-label={`Open cleanup report ${item.id}`}
                className="rounded-xl border border-border bg-white p-4 text-left shadow-leasiumXs transition hover:bg-muted/60"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-foreground">
                    {item.label}
                  </div>
                  <StatusBadge
                    tone={
                      status === "complete"
                        ? "success"
                        : status === "review"
                          ? "warning"
                          : "danger"
                    }
                  >
                    {status === "complete"
                      ? "Complete"
                      : status === "review"
                        ? "Review"
                        : "Blocked"}
                  </StatusBadge>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      percent >= 90
                        ? "bg-success"
                        : percent >= 60
                          ? "bg-warning"
                          : "bg-danger",
                    )}
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <div className="mt-2 text-xs font-medium text-muted-foreground">
                  {percent}% ready
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  {item.detail}
                </p>
              </button>
            );
          })}
        </div>

        <div className="rounded-xl border border-border bg-muted/40 p-4">
          <div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-foreground">
                  Bulk review queue
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Grouped onboarding and billing rows for the next cleanup pass.
                </p>
              </div>
              <StatusBadge
                tone={activeBulkGroups.length ? "warning" : "success"}
              >
                {activeBulkGroups.length} groups
              </StatusBadge>
            </div>
            <div className="mt-3 divide-y divide-border">
              {activeBulkGroups.length ? (
                activeBulkGroups.map((group) => {
                  const body = (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone={group.tone}>
                          {group.count}
                        </StatusBadge>
                        <span className="font-semibold">{group.title}</span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {group.detail}
                      </p>
                      {group.examples.length ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {group.examples.join(" / ")}
                        </p>
                      ) : null}
                      {group.blockers.length ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {group.blockers.map((blocker) => (
                            <span
                              key={blocker.label}
                              className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-white px-2 py-0.5 text-leasium-micro font-semibold text-muted-foreground"
                              title={blocker.label}
                            >
                              <span className="truncate">{blocker.label}</span>
                              <span className="rounded-full bg-muted px-1 text-[10px] text-foreground">
                                {blocker.count}
                              </span>
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <span className="mt-2 inline-flex text-xs font-semibold text-primary">
                        {group.actionLabel}
                      </span>
                    </>
                  );
                  const className =
                    "grid w-full gap-1 py-3 text-left transition hover:text-primary";
                  if (group.href) {
                    return (
                      <Link
                        key={group.id}
                        href={group.href}
                        className={className}
                      >
                        {body}
                      </Link>
                    );
                  }
                  return (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => group.tab && onOpenTab(group.tab)}
                      className={className}
                    >
                      {body}
                    </button>
                  );
                })
              ) : (
                <div className="py-4 text-sm text-muted-foreground">
                  No onboarding or billing bulk-review groups need action.
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-foreground">
                  Blocker drilldown
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Row-level blockers from the active bulk groups, ready for the
                  cleanup handoff.
                </p>
              </div>
              <StatusBadge
                tone={activeBulkGroups.some((group) => group.rows.length)
                  ? "warning"
                  : "success"}
              >
                {activeBulkGroups.reduce(
                  (totalRows, group) => totalRows + group.rows.length,
                  0,
                )}{" "}
                rows
              </StatusBadge>
            </div>
            <div className="mt-3 divide-y divide-border rounded-lg border border-border bg-white">
              {activeBulkGroups.some((group) => group.rows.length) ? (
                activeBulkGroups.map((group) =>
                  group.rows.map((row) => (
                    <div
                      key={`${group.id}-${row.id}`}
                      className="grid gap-1 px-3 py-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone={group.tone}>
                          {group.title}
                        </StatusBadge>
                        <span className="font-semibold text-foreground">
                          {row.label}
                        </span>
                      </div>
                      <p className="text-muted-foreground">{row.blocker}</p>
                      {row.detail ? (
                        <p className="text-xs font-medium text-muted-foreground">
                          {row.detail}
                        </p>
                      ) : null}
                    </div>
                  )),
                )
              ) : (
                <div className="px-3 py-4 text-sm text-muted-foreground">
                  No row-level bulk blockers need review.
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-foreground">
                  AI-assisted enrichment candidates
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Prioritized records where sourced suggestions may fill safe
                  public fields.
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <SecondaryButton
                  type="button"
                  onClick={copyEnrichmentQueue}
                  className="min-h-9 rounded-lg px-3"
                >
                  <Copy size={14} />
                  Copy queue
                </SecondaryButton>
                <SecondaryButton
                  type="button"
                  onClick={downloadEnrichmentQueueCsv}
                  className="min-h-9 rounded-lg px-3"
                >
                  <Download size={14} />
                  Download queue CSV
                </SecondaryButton>
                <StatusBadge
                  tone={enrichmentCandidates.length ? "primary" : "success"}
                >
                  {enrichmentCandidates.length} queued
                </StatusBadge>
              </div>
            </div>
            {enrichmentReceipt ? (
              <p className="mt-3 text-sm font-medium text-success">
                {enrichmentReceipt}
              </p>
            ) : null}
            {enrichmentCandidates.length ? (
              <div className="mt-3 grid gap-2 rounded-lg border border-border bg-white p-3 text-sm">
                <div className="flex flex-wrap gap-2">
                  <StatusBadge
                    tone={highImpactEnrichmentCount ? "warning" : "neutral"}
                  >
                    {highImpactEnrichmentCount} high-impact
                  </StatusBadge>
                  <StatusBadge tone="neutral">
                    {propertyEnrichmentCount} property
                  </StatusBadge>
                  <StatusBadge tone="neutral">
                    {tenantEnrichmentCount} tenant
                  </StatusBadge>
                </div>
                {topEnrichmentFields.length ? (
                  <div className="flex flex-wrap gap-1">
                    {topEnrichmentFields.map((field) => (
                      <span
                        key={field.label}
                        className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-leasium-micro font-semibold text-muted-foreground"
                      >
                        <span className="truncate">{field.label}</span>
                        <span className="rounded-full bg-white px-1 text-[10px] text-foreground">
                          {field.count}
                        </span>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="mt-3 divide-y divide-border">
              {enrichmentCandidates.length ? (
                enrichmentCandidates.map((candidate) => (
                  <Link
                    key={candidate.id}
                    href={candidate.href}
                    className="grid gap-2 py-3 transition hover:text-primary"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{candidate.title}</span>
                      <StatusBadge tone="neutral">{candidate.kind}</StatusBadge>
                      <StatusBadge tone="neutral">
                        {candidate.fields.length} fields
                      </StatusBadge>
                      <StatusBadge
                        tone={
                          candidate.priority === "high" ? "warning" : "primary"
                        }
                      >
                        {candidate.priority === "high"
                          ? "High-impact"
                          : "Helpful"}
                      </StatusBadge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {candidate.detail}
                    </p>
                    <p className="text-xs font-semibold text-foreground">
                      {candidate.impact}
                    </p>
                    <p className="text-xs font-medium text-muted-foreground">
                      {candidate.reason}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {candidate.fields.slice(0, 4).join(", ")}
                      {candidate.fields.length > 4 ? "..." : ""}
                    </p>
                    <span className="text-xs font-semibold text-primary">
                      {candidate.actionLabel}
                    </span>
                  </Link>
                ))
              ) : (
                <div className="py-4 text-sm text-muted-foreground">
                  No obvious enrichment candidates remain for this entity.
                </div>
              )}
            </div>
          </div>
          <div className="mt-4 border-t border-border pt-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-foreground">
                  Blocked follow-ups
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  The next review rows to clear before the register is ready.
                </p>
              </div>
              <StatusBadge
                tone={blockedFollowups.length ? "warning" : "success"}
              >
                {blockedFollowups.length} open
              </StatusBadge>
            </div>
            <div className="mt-3 divide-y divide-border">
              {blockedFollowups.length ? (
                blockedFollowups.map((followup) => (
                  <button
                    key={followup.id}
                    type="button"
                    onClick={() => onOpenTab(followup.tab)}
                    className="grid w-full gap-2 py-3 text-left transition hover:text-primary"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={followup.tone}>
                        {tabs.find((tab) => tab.id === followup.tab)?.label ??
                          "Review"}
                      </StatusBadge>
                      <span className="font-semibold">{followup.title}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {followup.detail}
                    </p>
                  </button>
                ))
              ) : (
                <div className="py-4 text-sm text-muted-foreground">
                  No blocked cleanup rows remain in the current scan.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </SectionPanel>
  );
}

function PortfolioQaWorkspace() {
  const queryClient = useQueryClient();
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [activeTab, setActiveTab] = useState<QaTab>("issues");
  const [search, setSearch] = useState("");
  const [selectedLeaseIds, setSelectedLeaseIds] = useState<string[]>([]);
  const [tenantDrafts, setTenantDrafts] = useState<
    Record<string, TenantContactDraft>
  >({});
  const [propertyDrafts, setPropertyDrafts] = useState<
    Record<string, PropertyBillingDraft>
  >({});
  const [focusedTenantId, setFocusedTenantId] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [billingBatch, setBillingBatch] =
    useState<BillingDraftBatchRecord | null>(null);
  const [onboardingResult, setOnboardingResult] = useState("");
  const [propertyFixResult, setPropertyFixResult] = useState("");
  const [tenantFixResult, setTenantFixResult] = useState("");

  const entitiesQuery = useQuery({
    queryKey: ["entities"],
    queryFn: listEntities,
  });
  const entities = useMemo(
    () => entitiesQuery.data ?? [],
    [entitiesQuery.data],
  );

  useEffect(() => {
    const stored = window.localStorage.getItem(ENTITY_STORAGE_KEY);
    if (stored) {
      setSelectedEntityId(stored);
    }
  }, []);

  useEffect(() => {
    if (!entitiesQuery.isSuccess) {
      return;
    }
    const first = entities[0]?.id ?? "";
    if (!selectedEntityId && first) {
      setSelectedEntityId(first);
      window.localStorage.setItem(ENTITY_STORAGE_KEY, first);
    } else if (
      selectedEntityId &&
      !entities.some((entity) => entity.id === selectedEntityId)
    ) {
      setSelectedEntityId(first);
      if (first) {
        window.localStorage.setItem(ENTITY_STORAGE_KEY, first);
      }
    }
  }, [entities, entitiesQuery.isSuccess, selectedEntityId]);

  useEffect(() => {
    if (selectedEntityId) {
      window.localStorage.setItem(ENTITY_STORAGE_KEY, selectedEntityId);
    }
  }, [selectedEntityId]);

  useEffect(() => {
    if (activeTab !== "contacts" || !focusedTenantId) {
      return;
    }
    const timer = window.setTimeout(() => {
      document
        .getElementById(`tenant-contact-${focusedTenantId}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [activeTab, focusedTenantId]);

  const propertiesQuery = useQuery({
    queryKey: ["properties", selectedEntityId],
    queryFn: () => listProperties(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });
  const tenantsQuery = useQuery({
    queryKey: ["tenants", selectedEntityId],
    queryFn: () => listTenants(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });
  const rentRollQuery = useQuery({
    queryKey: ["rent-roll", selectedEntityId],
    queryFn: () => listRentRoll({ entity_id: selectedEntityId }),
    enabled: Boolean(selectedEntityId),
  });
  const obligationsQuery = useQuery({
    queryKey: ["obligations", selectedEntityId],
    queryFn: () => listObligations({ entity_id: selectedEntityId }),
    enabled: Boolean(selectedEntityId),
  });
  const intakesQuery = useQuery({
    queryKey: ["document-intakes", selectedEntityId],
    queryFn: () => listDocumentIntakes(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });
  const onboardingsQuery = useQuery({
    queryKey: ["tenant-onboardings", selectedEntityId],
    queryFn: () => listTenantOnboardings(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });
  const billingDraftsQuery = useQuery({
    queryKey: ["billing-drafts", selectedEntityId],
    queryFn: () => listBillingDrafts({ entity_id: selectedEntityId }),
    enabled: Boolean(selectedEntityId),
  });

  const properties = useMemo(
    () => propertiesQuery.data ?? [],
    [propertiesQuery.data],
  );
  const tenants = useMemo(() => tenantsQuery.data ?? [], [tenantsQuery.data]);
  const rentRoll = useMemo(
    () => rentRollQuery.data ?? [],
    [rentRollQuery.data],
  );
  const obligations = useMemo(
    () => obligationsQuery.data ?? [],
    [obligationsQuery.data],
  );
  const intakes = useMemo(() => intakesQuery.data ?? [], [intakesQuery.data]);
  const onboardings = useMemo(
    () => onboardingsQuery.data ?? [],
    [onboardingsQuery.data],
  );
  const billingDrafts = useMemo(
    () => billingDraftsQuery.data ?? [],
    [billingDraftsQuery.data],
  );

  const issues = useMemo(
    () => buildIssues({ properties, tenants, rentRoll, obligations, intakes }),
    [properties, tenants, rentRoll, obligations, intakes],
  );
  const sources = useMemo(
    () =>
      buildSources({
        properties,
        tenants,
        obligations,
        intakes,
        drafts: billingDrafts,
      }),
    [properties, tenants, obligations, intakes, billingDrafts],
  );
  const tenantPrep = useMemo(
    () => buildTenantPrep(rentRoll, tenants, onboardings),
    [rentRoll, tenants, onboardings],
  );

  const tenantsNeedingContact = tenants.filter(
    (tenant) => tenantMissingContactFields(tenant).length > 0,
  );
  const propertiesNeedingBillingFix = properties.filter(
    (property) => propertyMissingBillingFields(property).length > 0,
  );
  const enrichmentCandidates = useMemo(
    () => buildEnrichmentCandidates({ properties, tenants }),
    [properties, tenants],
  );
  const readyPrepRows = tenantPrep.filter((row) => row.ready);
  const completionItems = useMemo(
    () =>
      buildCompletionItems({
        issues,
        tenantsNeedingContact,
        propertiesNeedingBillingFix,
        tenantPrep,
        billingDrafts,
        sources,
      }),
    [
      billingDrafts,
      issues,
      propertiesNeedingBillingFix,
      sources,
      tenantPrep,
      tenantsNeedingContact,
    ],
  );
  const blockedFollowups = useMemo(
    () => buildBlockedFollowups({ issues, tenantPrep }),
    [issues, tenantPrep],
  );
  const onboardingReviewRows = useMemo(
    () => buildOnboardingReviewRows(tenantPrep),
    [tenantPrep],
  );
  const billingReviewRows = useMemo(
    () => buildBillingReviewRows({ issues, billingDrafts }),
    [billingDrafts, issues],
  );
  const bulkReviewGroups = useMemo(
    () => buildBulkReviewGroups({ tenantPrep, issues, billingDrafts }),
    [billingDrafts, issues, tenantPrep],
  );
  const selectedReadyRows = tenantPrep.filter(
    (row) => row.ready && row.leaseId && selectedLeaseIds.includes(row.leaseId),
  );
  const searchableIssues = issues.filter((issue) =>
    [issue.area, issue.title, issue.detail]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const searchableSources = sources.filter((source) =>
    [
      source.kind,
      source.title,
      source.detail,
      source.source,
      source.evidence?.title,
      source.evidence?.description,
    ]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const selectedSource =
    searchableSources.find((source) => source.id === selectedSourceId) ??
    searchableSources.find((source) => source.evidence) ??
    null;
  const stagedTenantRows = tenants.filter((tenant) => tenantDrafts[tenant.id]);
  const stagedPropertyRows = properties.filter(
    (property) => propertyDrafts[property.id],
  );

  const loading =
    entitiesQuery.isLoading ||
    propertiesQuery.isLoading ||
    tenantsQuery.isLoading ||
    rentRollQuery.isLoading ||
    obligationsQuery.isLoading ||
    intakesQuery.isLoading ||
    onboardingsQuery.isLoading ||
    billingDraftsQuery.isLoading;
  const error =
    entitiesQuery.error ??
    propertiesQuery.error ??
    tenantsQuery.error ??
    rentRollQuery.error ??
    obligationsQuery.error ??
    intakesQuery.error ??
    onboardingsQuery.error ??
    billingDraftsQuery.error;

  const updateTenantMutation = useMutation({
    mutationFn: ({
      tenant,
      draft,
    }: {
      tenant: TenantRecord;
      draft: TenantContactDraft;
    }) => {
      return updateTenant(tenant.id, tenantContactPayload(tenant, draft));
    },
    onSuccess: (_tenant, variables) => {
      setTenantDrafts((current) => {
        const next = { ...current };
        delete next[variables.tenant.id];
        return next;
      });
      setTenantFixResult(
        `${tenantName(variables.tenant)} contact details saved.`,
      );
      queryClient.invalidateQueries({
        queryKey: ["tenants", selectedEntityId],
      });
      queryClient.invalidateQueries({
        queryKey: ["rent-roll", selectedEntityId],
      });
    },
  });

  const updateTenantBatchMutation = useMutation({
    mutationFn: async (
      items: Array<{ tenant: TenantRecord; draft: TenantContactDraft }>,
    ) => {
      const results = await Promise.allSettled(
        items.map(({ tenant, draft }) =>
          updateTenant(tenant.id, tenantContactPayload(tenant, draft)),
        ),
      );
      return { items, results };
    },
    onSuccess: ({ items, results }) => {
      const savedIds = new Set(
        items
          .filter((_item, index) => results[index]?.status === "fulfilled")
          .map((item) => item.tenant.id),
      );
      const saved = savedIds.size;
      const failed = results.length - saved;
      setTenantDrafts((current) => {
        const next = { ...current };
        for (const id of savedIds) {
          delete next[id];
        }
        return next;
      });
      setTenantFixResult(
        failed
          ? `${saved} tenant contact fixes saved; ${failed} need review.`
          : `${saved} tenant contact fixes saved.`,
      );
      queryClient.invalidateQueries({
        queryKey: ["tenants", selectedEntityId],
      });
      queryClient.invalidateQueries({
        queryKey: ["rent-roll", selectedEntityId],
      });
    },
  });

  const updatePropertyMutation = useMutation({
    mutationFn: ({
      property,
      draft,
    }: {
      property: PropertyRecord;
      draft: PropertyBillingDraft;
    }) => updateProperty(property.id, propertyBillingPayload(property, draft)),
    onSuccess: (_property, variables) => {
      setPropertyDrafts((current) => {
        const next = { ...current };
        delete next[variables.property.id];
        return next;
      });
      setPropertyFixResult(
        `${variables.property.name} billing identity saved.`,
      );
      queryClient.invalidateQueries({
        queryKey: ["properties", selectedEntityId],
      });
      queryClient.invalidateQueries({
        queryKey: ["rent-roll", selectedEntityId],
      });
      queryClient.invalidateQueries({
        queryKey: ["billing-drafts", selectedEntityId],
      });
    },
  });

  const updatePropertyBatchMutation = useMutation({
    mutationFn: async (
      items: Array<{ property: PropertyRecord; draft: PropertyBillingDraft }>,
    ) => {
      const results = await Promise.allSettled(
        items.map(({ property, draft }) =>
          updateProperty(property.id, propertyBillingPayload(property, draft)),
        ),
      );
      return { items, results };
    },
    onSuccess: ({ items, results }) => {
      const savedIds = new Set(
        items
          .filter((_item, index) => results[index]?.status === "fulfilled")
          .map((item) => item.property.id),
      );
      const saved = savedIds.size;
      const failed = results.length - saved;
      setPropertyDrafts((current) => {
        const next = { ...current };
        for (const id of savedIds) {
          delete next[id];
        }
        return next;
      });
      setPropertyFixResult(
        failed
          ? `${saved} owner billing fixes saved; ${failed} need review.`
          : `${saved} owner billing fixes saved.`,
      );
      queryClient.invalidateQueries({
        queryKey: ["properties", selectedEntityId],
      });
      queryClient.invalidateQueries({
        queryKey: ["rent-roll", selectedEntityId],
      });
      queryClient.invalidateQueries({
        queryKey: ["billing-drafts", selectedEntityId],
      });
    },
  });

  const batchOnboardingMutation = useMutation({
    mutationFn: async (leaseIds: string[]) => {
      const dueDate = addDays(7);
      const expiresAt = `${addDays(21)}T23:59:59+10:00`;
      const results = await Promise.allSettled(
        leaseIds.map((leaseId) =>
          createTenantOnboarding({
            lease_id: leaseId,
            due_date: dueDate,
            expires_at: expiresAt,
          }),
        ),
      );
      return results;
    },
    onSuccess: (results) => {
      const sent = results.filter((item) => item.status === "fulfilled").length;
      const failed = results.length - sent;
      setOnboardingResult(
        failed
          ? `${sent} invite links created, ${failed} need review.`
          : `${sent} invite links created.`,
      );
      setSelectedLeaseIds([]);
      queryClient.invalidateQueries({
        queryKey: ["tenant-onboardings", selectedEntityId],
      });
    },
  });

  const billingBatchMutation = useMutation({
    mutationFn: () =>
      createBillingDraftsFromChargeRules({
        entity_id: selectedEntityId,
        lease_ids: rentRoll
          .map((row) => row.lease_id)
          .filter((id): id is string => Boolean(id)),
      }),
    onSuccess: (result) => {
      setBillingBatch(result);
      queryClient.invalidateQueries({
        queryKey: ["billing-drafts", selectedEntityId],
      });
    },
  });

  function refreshAll() {
    propertiesQuery.refetch();
    tenantsQuery.refetch();
    rentRollQuery.refetch();
    obligationsQuery.refetch();
    intakesQuery.refetch();
    onboardingsQuery.refetch();
    billingDraftsQuery.refetch();
  }

  function draftValue(tenant: TenantRecord, field: keyof TenantContactDraft) {
    return tenantDrafts[tenant.id]?.[field] ?? tenant[field] ?? "";
  }

  function propertyDraftValue(
    property: PropertyRecord,
    field: keyof PropertyBillingDraft,
  ) {
    return propertyDrafts[property.id]?.[field] ?? property[field] ?? "";
  }

  function updateTenantDraft(
    tenantId: string,
    field: keyof TenantContactDraft,
    value: string,
  ) {
    setTenantDrafts((current) => ({
      ...current,
      [tenantId]: {
        ...current[tenantId],
        [field]: value,
      },
    }));
  }

  function updatePropertyDraft(
    propertyId: string,
    field: keyof PropertyBillingDraft,
    value: string,
  ) {
    setPropertyDrafts((current) => ({
      ...current,
      [propertyId]: {
        ...current[propertyId],
        [field]: value,
      },
    }));
  }

  function stageTenantSuggestions() {
    setTenantDrafts((current) => {
      const next = { ...current };
      for (const tenant of tenantsNeedingContact) {
        const suggestion: TenantContactDraft = { ...next[tenant.id] };
        if (!tenant.contact_name && !suggestion.contact_name) {
          suggestion.contact_name = tenant.trading_name ?? tenant.legal_name;
        }
        if (!tenant.billing_email && !suggestion.billing_email) {
          suggestion.billing_email = tenant.contact_email ?? undefined;
        }
        if (!tenant.contact_email && !suggestion.contact_email) {
          suggestion.contact_email = tenant.billing_email ?? undefined;
        }
        if (Object.values(suggestion).some(Boolean)) {
          next[tenant.id] = suggestion;
        }
      }
      return next;
    });
    setTenantFixResult("Review staged tenant suggestions before saving.");
  }

  function stagePropertySuggestions() {
    setPropertyDrafts((current) => {
      const next = { ...current };
      for (const property of propertiesNeedingBillingFix) {
        const suggestion: PropertyBillingDraft = { ...next[property.id] };
        const ownerLabel =
          property.trust_name ??
          property.trustee_name ??
          property.owner_legal_name ??
          undefined;
        if (!property.invoice_issuer_name && !suggestion.invoice_issuer_name) {
          suggestion.invoice_issuer_name = ownerLabel;
        }
        if (
          !property.billing_contact_name &&
          !suggestion.billing_contact_name
        ) {
          suggestion.billing_contact_name =
            property.trustee_name ?? property.owner_legal_name ?? undefined;
        }
        if (Object.values(suggestion).some(Boolean)) {
          next[property.id] = suggestion;
        }
      }
      return next;
    });
    setPropertyFixResult(
      "Review staged owner billing suggestions before saving.",
    );
  }

  function openTenantContactFix(tenantId: string) {
    setFocusedTenantId(tenantId);
    setActiveTab("contacts");
  }

  function toggleLease(leaseId: string, checked: boolean) {
    setSelectedLeaseIds((current) =>
      checked
        ? Array.from(new Set([...current, leaseId]))
        : current.filter((id) => id !== leaseId),
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
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))}
        </Select>
      </AppHeader>

      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-5">
        <PageHeader
          title="Portfolio QA"
          description="Post-import cleanup for missing data, source trails, onboarding readiness, and billing draft prep."
          actions={
            <SecondaryButton
              type="button"
              onClick={refreshAll}
              disabled={!selectedEntityId || loading}
            >
              <RefreshCw size={15} />
              Refresh
            </SecondaryButton>
          }
        />

        {error ? (
          <div className="rounded-2xl border border-danger/20 bg-danger-soft p-4 text-sm text-danger">
            <div className="font-semibold">QA data did not finish loading.</div>
            <div className="mt-1">{friendlyError(error)}</div>
          </div>
        ) : null}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            label="Open issues"
            value={loading ? "Checking" : issues.length}
            detail="Missing fields, blockers, and urgent review items."
            tone={issues.length ? "warning" : "success"}
            icon={<AlertTriangle size={17} />}
          />
          <MetricCard
            label="Contact cleanup"
            value={loading ? "Checking" : tenantsNeedingContact.length}
            detail="Tenants missing emails, ABNs, or named contacts."
            tone={tenantsNeedingContact.length ? "danger" : "success"}
            icon={<UserRound size={17} />}
          />
          <MetricCard
            label="Ready to invite"
            value={loading ? "Preparing" : readyPrepRows.length}
            detail="Leases with a tenant email and no active invite."
            tone={readyPrepRows.length ? "primary" : "neutral"}
            icon={<MailCheck size={17} />}
          />
          <MetricCard
            label="Source trails"
            value={loading ? "Updating" : sources.length}
            detail="Imported rows, document reviews, and generated sources."
            tone="neutral"
            icon={<FileText size={17} />}
          />
          <MetricCard
            label="Billing drafts"
            value={loading ? "Preparing" : billingDrafts.length}
            detail="Internal drafts waiting for review or approval."
            tone={billingDrafts.length ? "primary" : "neutral"}
            icon={<ClipboardList size={17} />}
          />
        </section>

        <section className="grid gap-2 rounded-2xl border border-border bg-white p-2 shadow-leasiumXs md:grid-cols-5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "rounded-xl px-3 py-3 text-left transition hover:bg-muted",
                activeTab === tab.id &&
                  "bg-primary text-primary-foreground shadow-leasiumXs hover:bg-primary",
              )}
            >
              <div className="text-sm font-semibold">{tab.label}</div>
              <div
                className={cn(
                  "mt-1 text-xs text-muted-foreground",
                  activeTab === tab.id && "text-primary-foreground/80",
                )}
              >
                {tab.description}
              </div>
            </button>
          ))}
        </section>

        {!loading && !error ? (
          <>
            <PortfolioCompletionPanel
              items={completionItems}
              enrichmentCandidates={enrichmentCandidates}
              blockedFollowups={blockedFollowups}
              bulkReviewGroups={bulkReviewGroups}
              onOpenTab={setActiveTab}
            />
            <BlockerTriagePanel
              groups={bulkReviewGroups}
              onOpenTab={setActiveTab}
            />
          </>
        ) : null}

        {loading && !error ? (
          <SectionPanel
            title="Checking the imported portfolio"
            description="Pulling together properties, tenants, tasks, billing, onboarding, and sources."
            icon={<Loader2 size={17} className="animate-spin text-primary" />}
          >
            <div className="p-4 text-sm text-muted-foreground">
              Preparing QA workspace.
            </div>
          </SectionPanel>
        ) : null}

        {!loading && !error && activeTab === "issues" ? (
          <>
            <SectionPanel
              title="Portfolio data QA"
              description="The highest-friction cleanup items from the live register."
              icon={<Search size={17} className="text-primary" />}
              actions={
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search QA issues"
                  className="w-64"
                />
              }
            >
              {searchableIssues.length ? (
                <div className="divide-y divide-border">
                  {searchableIssues.map((issue) => (
                    <Link
                      key={issue.id}
                      href={issue.href}
                      className="grid gap-3 px-4 py-4 transition hover:bg-muted/60 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone={severityTone(issue)}>
                            {issue.area}
                          </StatusBadge>
                          <div className="font-semibold">{issue.title}</div>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {issue.detail}
                        </p>
                      </div>
                      <div className="text-sm font-semibold text-primary">
                        {issue.action}
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<CheckCircle2 size={18} />}
                  title="No QA issues found"
                  description="The imported register is clean for the current checks."
                />
              )}
            </SectionPanel>
            <SectionPanel
              title="Owner and billing guided fixes"
              description="Patch the billing identity fields that block invoice approval, owner snapshots, and accounting readiness."
              icon={<Building2 size={17} className="text-primary" />}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <SecondaryButton
                    type="button"
                    onClick={stagePropertySuggestions}
                    disabled={!propertiesNeedingBillingFix.length}
                  >
                    <Sparkles size={15} />
                    Stage suggestions
                  </SecondaryButton>
                  <Button
                    type="button"
                    onClick={() =>
                      updatePropertyBatchMutation.mutate(
                        stagedPropertyRows.map((property) => ({
                          property,
                          draft: propertyDrafts[property.id] ?? {},
                        })),
                      )
                    }
                    disabled={
                      !stagedPropertyRows.length ||
                      updatePropertyBatchMutation.isPending
                    }
                  >
                    {updatePropertyBatchMutation.isPending ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Save size={15} />
                    )}
                    Save staged fixes
                  </Button>
                </div>
              }
            >
              {propertyFixResult ? (
                <div className="border-b border-border bg-primary/5 px-4 py-3 text-sm font-medium text-primary">
                  {propertyFixResult}
                </div>
              ) : null}
              {propertiesNeedingBillingFix.length ? (
                <div className="divide-y divide-border">
                  {propertiesNeedingBillingFix.map((property) => {
                    const missingFields =
                      propertyMissingBillingFields(property);
                    return (
                      <div
                        key={property.id}
                        className="grid gap-3 px-4 py-4 xl:grid-cols-[minmax(180px,0.9fr)_minmax(0,2fr)_auto] xl:items-end"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/properties?entity_id=${property.entity_id}&property_id=${property.id}`}
                              className="font-semibold text-primary"
                            >
                              {property.name}
                            </Link>
                            <StatusBadge tone="warning">
                              {missingFields.length} missing
                            </StatusBadge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {missingFields.join(", ")}
                          </p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                          <Field label="Legal owner">
                            <Input
                              value={propertyDraftValue(
                                property,
                                "owner_legal_name",
                              )}
                              onChange={(event) =>
                                updatePropertyDraft(
                                  property.id,
                                  "owner_legal_name",
                                  event.target.value,
                                )
                              }
                            />
                          </Field>
                          <Field label="Owner ABN">
                            <Input
                              value={propertyDraftValue(property, "owner_abn")}
                              onChange={(event) =>
                                updatePropertyDraft(
                                  property.id,
                                  "owner_abn",
                                  event.target.value,
                                )
                              }
                            />
                          </Field>
                          <Field label="Invoice issuer">
                            <Input
                              value={propertyDraftValue(
                                property,
                                "invoice_issuer_name",
                              )}
                              onChange={(event) =>
                                updatePropertyDraft(
                                  property.id,
                                  "invoice_issuer_name",
                                  event.target.value,
                                )
                              }
                            />
                          </Field>
                          <Field label="Billing contact">
                            <Input
                              value={propertyDraftValue(
                                property,
                                "billing_contact_name",
                              )}
                              onChange={(event) =>
                                updatePropertyDraft(
                                  property.id,
                                  "billing_contact_name",
                                  event.target.value,
                                )
                              }
                            />
                          </Field>
                          <Field label="Billing email">
                            <Input
                              value={propertyDraftValue(
                                property,
                                "billing_email",
                              )}
                              onChange={(event) =>
                                updatePropertyDraft(
                                  property.id,
                                  "billing_email",
                                  event.target.value,
                                )
                              }
                            />
                          </Field>
                        </div>
                        <Button
                          type="button"
                          onClick={() =>
                            updatePropertyMutation.mutate({
                              property,
                              draft: propertyDrafts[property.id] ?? {},
                            })
                          }
                          disabled={updatePropertyMutation.isPending}
                        >
                          {updatePropertyMutation.isPending ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : (
                            <Save size={15} />
                          )}
                          Save fix
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  icon={<CheckCircle2 size={18} />}
                  title="Owner billing data is complete"
                  description="No property owner or billing identity blockers are visible for this entity."
                />
              )}
            </SectionPanel>
          </>
        ) : null}

        {!loading && !error && activeTab === "contacts" ? (
          <SectionPanel
            title="Tenant contact enrichment"
            description="Fill the details needed before sending onboarding links or invoices."
            icon={<UserRound size={17} className="text-primary" />}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <SecondaryButton
                  type="button"
                  onClick={stageTenantSuggestions}
                  disabled={!tenantsNeedingContact.length}
                >
                  <Sparkles size={15} />
                  Stage suggestions
                </SecondaryButton>
                <Button
                  type="button"
                  onClick={() =>
                    updateTenantBatchMutation.mutate(
                      stagedTenantRows.map((tenant) => ({
                        tenant,
                        draft: tenantDrafts[tenant.id] ?? {},
                      })),
                    )
                  }
                  disabled={
                    !stagedTenantRows.length ||
                    updateTenantBatchMutation.isPending
                  }
                >
                  {updateTenantBatchMutation.isPending ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Save size={15} />
                  )}
                  Save staged fixes
                </Button>
              </div>
            }
          >
            {tenantFixResult ? (
              <div className="border-b border-border bg-primary/5 px-4 py-3 text-sm font-medium text-primary">
                {tenantFixResult}
              </div>
            ) : null}
            {tenantsNeedingContact.length ? (
              <div className="divide-y divide-border">
                {tenantsNeedingContact.map((tenant) => {
                  const missingFields = tenantMissingContactFields(tenant);
                  return (
                    <div
                      key={tenant.id}
                      id={`tenant-contact-${tenant.id}`}
                      className={cn(
                        "grid gap-3 px-4 py-4 xl:grid-cols-[minmax(180px,1.1fr)_repeat(4,minmax(120px,1fr))_auto] xl:items-end",
                        focusedTenantId === tenant.id &&
                          "bg-primary/5 ring-1 ring-inset ring-primary/20",
                      )}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/tenants/${tenant.id}`}
                            className="font-semibold text-primary"
                          >
                            {tenantName(tenant)}
                          </Link>
                          <StatusBadge
                            tone={
                              missingFields.includes("contact email")
                                ? "danger"
                                : "warning"
                            }
                          >
                            {missingFields.length} missing
                          </StatusBadge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {missingFields.join(", ")}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {[
                            metadataText(tenant.metadata, "insurance_status"),
                            metadataText(tenant.metadata, "arrears"),
                          ]
                            .filter(Boolean)
                            .join(" / ") || "Imported tenant"}
                        </p>
                      </div>
                      <Field label="Contact">
                        <Input
                          value={draftValue(tenant, "contact_name")}
                          onChange={(event) =>
                            updateTenantDraft(
                              tenant.id,
                              "contact_name",
                              event.target.value,
                            )
                          }
                        />
                      </Field>
                      <Field label="Contact email">
                        <Input
                          value={draftValue(tenant, "contact_email")}
                          onChange={(event) =>
                            updateTenantDraft(
                              tenant.id,
                              "contact_email",
                              event.target.value,
                            )
                          }
                        />
                      </Field>
                      <Field label="Billing email">
                        <Input
                          value={draftValue(tenant, "billing_email")}
                          onChange={(event) =>
                            updateTenantDraft(
                              tenant.id,
                              "billing_email",
                              event.target.value,
                            )
                          }
                        />
                      </Field>
                      <Field label="ABN">
                        <Input
                          value={draftValue(tenant, "abn")}
                          onChange={(event) =>
                            updateTenantDraft(
                              tenant.id,
                              "abn",
                              event.target.value,
                            )
                          }
                        />
                      </Field>
                      <Button
                        type="button"
                        onClick={() =>
                          updateTenantMutation.mutate({
                            tenant,
                            draft: tenantDrafts[tenant.id] ?? {},
                          })
                        }
                        disabled={updateTenantMutation.isPending}
                      >
                        {updateTenantMutation.isPending ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <Save size={15} />
                        )}
                        Save fix
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                icon={<CheckCircle2 size={18} />}
                title="Tenant contact data is complete"
                description="Every tenant has the current cleanup fields filled."
              />
            )}
          </SectionPanel>
        ) : null}

        {!loading && !error && activeTab === "sources" ? (
          <SectionPanel
            title="Source and apply history"
            description="Where current records came from, including imported workbook rows and Smart Intake documents."
            icon={<Sparkles size={17} className="text-primary" />}
            actions={
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search sources"
                className="w-64"
              />
            }
          >
            {searchableSources.length ? (
              <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_minmax(320px,430px)]">
                <div className="divide-y divide-border">
                  {searchableSources.map((source) => (
                    <div
                      key={source.id}
                      className={cn(
                        "grid gap-3 px-4 py-4 transition md:grid-cols-[120px_minmax(0,1fr)_minmax(190px,auto)] md:items-center",
                        selectedSource?.id === source.id
                          ? "bg-primary/5"
                          : "hover:bg-muted/60",
                      )}
                    >
                      <StatusBadge
                        tone={source.evidence ? "primary" : "neutral"}
                      >
                        {source.kind}
                      </StatusBadge>
                      <div className="min-w-0">
                        <Link
                          href={source.href}
                          className="font-semibold text-primary"
                        >
                          {source.title}
                        </Link>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {source.detail || "No row detail stored"}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 md:justify-end">
                        <span className="text-sm font-semibold text-muted-foreground">
                          {source.source}
                        </span>
                        {source.evidence ? (
                          <SecondaryButton
                            type="button"
                            onClick={() => setSelectedSourceId(source.id)}
                            className="min-h-9 px-3"
                          >
                            <History size={15} />
                            Trail
                          </SecondaryButton>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border-t border-border p-4 xl:border-l xl:border-t-0">
                  {selectedSource?.evidence ? (
                    <EvidenceSourceTrail
                      title={selectedSource.evidence.title}
                      description={selectedSource.evidence.description}
                      sourceDocument={selectedSource.evidence.sourceDocument}
                      sourceLocation={selectedSource.evidence.sourceLocation}
                      confidence={selectedSource.evidence.confidence}
                      appliedAt={selectedSource.evidence.appliedAt}
                      appliedBy={selectedSource.evidence.appliedBy}
                      changes={selectedSource.evidence.changes ?? []}
                      history={selectedSource.evidence.history ?? []}
                      emptyMessage="No detailed source trail is attached to this row yet."
                      className="shadow-none"
                    />
                  ) : (
                    <div className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                      Select a row with a trail to inspect workbook rows, public
                      enrichment, citations, and apply history.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<History size={18} />}
                title="No source trails yet"
                description="Imported rows and document reviews will appear here as metadata is stored."
              />
            )}
          </SectionPanel>
        ) : null}

        {!loading && !error && activeTab === "onboarding" ? (
          <SectionPanel
            title="Batch tenant onboarding prep"
            description="Only rows with a tenant email and no active invite are ready to send."
            icon={<MailCheck size={17} className="text-primary" />}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <SecondaryButton
                  type="button"
                  onClick={() =>
                    setSelectedLeaseIds(
                      readyPrepRows
                        .map((row) => row.leaseId)
                        .filter((id): id is string => Boolean(id)),
                    )
                  }
                  disabled={!readyPrepRows.length}
                >
                  <CheckCircle2 size={15} />
                  Select ready
                </SecondaryButton>
                <Button
                  type="button"
                  onClick={() =>
                    batchOnboardingMutation.mutate(
                      selectedReadyRows
                        .map((row) => row.leaseId)
                        .filter((id): id is string => Boolean(id)),
                    )
                  }
                  disabled={
                    !selectedReadyRows.length ||
                    batchOnboardingMutation.isPending
                  }
                >
                  {batchOnboardingMutation.isPending ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Send size={15} />
                  )}
                  Send selected invites
                </Button>
              </div>
            }
          >
            {onboardingResult ? (
              <div className="border-b border-border bg-primary/5 px-4 py-3 text-sm font-medium text-primary">
                {onboardingResult}
              </div>
            ) : null}
            <ReviewSummaryStrip
              title="Invite blocker review"
              description="A quick scan of which tenant rows are safe to batch and which need contact, recovery, or setup first."
              rows={onboardingReviewRows}
              onOpenTab={setActiveTab}
            />
            <div className="divide-y divide-border">
              {tenantPrep.map((row) => (
                <div
                  key={row.id}
                  className="grid gap-3 px-4 py-4 md:grid-cols-[32px_minmax(0,1fr)_minmax(170px,auto)_minmax(170px,auto)_auto] md:items-center"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={Boolean(
                      row.leaseId && selectedLeaseIds.includes(row.leaseId),
                    )}
                    disabled={!row.ready || !row.leaseId}
                    onChange={(event) =>
                      row.leaseId &&
                      toggleLease(row.leaseId, event.target.checked)
                    }
                    aria-label={`Select ${row.tenantName}`}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-semibold">{row.tenantName}</div>
                      <StatusBadge tone={row.ready ? "success" : "warning"}>
                        {row.ready ? "Ready" : "Not ready"}
                      </StatusBadge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {row.propertyName} / {row.unitLabel}
                    </p>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {row.email ?? "No email"}
                  </div>
                  <div className="text-sm font-medium text-muted-foreground">
                    {row.blockers.length
                      ? row.blockers.join(" / ")
                      : "Ready for batch invite"}
                  </div>
                  <div className="flex flex-wrap justify-start gap-2 md:justify-end">
                    {row.ready && row.leaseId ? (
                      <Button
                        type="button"
                        onClick={() => {
                          if (row.leaseId) {
                            batchOnboardingMutation.mutate([row.leaseId]);
                          }
                        }}
                        disabled={batchOnboardingMutation.isPending}
                        className="min-h-9 px-3"
                      >
                        {batchOnboardingMutation.isPending ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <Send size={15} />
                        )}
                        Create invite
                      </Button>
                    ) : row.tenantId &&
                      row.blockers.some((blocker) =>
                        blocker.includes("email"),
                      ) ? (
                      <SecondaryButton
                        type="button"
                        onClick={() =>
                          openTenantContactFix(row.tenantId as string)
                        }
                        className="min-h-9 px-3"
                      >
                        <UserRound size={15} />
                        Fix contact
                      </SecondaryButton>
                    ) : row.tenantId && row.onboarding ? (
                      <Link
                        href={`/tenants/${row.tenantId}`}
                        className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-border bg-white px-3 text-sm font-semibold text-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
                      >
                        <ArrowRight size={15} />
                        Recover link
                      </Link>
                    ) : (
                      <span className="text-xs font-medium text-muted-foreground">
                        Needs setup
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </SectionPanel>
        ) : null}

        {!loading && !error && activeTab === "billing" ? (
          <SectionPanel
            title="Billing draft generation"
            description="Create internal billing drafts from reviewed rent and outgoings charge rules. No tenant email, PDF, or Xero sync runs here."
            icon={<ClipboardList size={17} className="text-primary" />}
            actions={
              <Button
                type="button"
                onClick={() => billingBatchMutation.mutate()}
                disabled={!selectedEntityId || billingBatchMutation.isPending}
              >
                {billingBatchMutation.isPending ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <ClipboardList size={15} />
                )}
                Create internal drafts
              </Button>
            }
          >
            {billingBatch ? (
              <div className="border-b border-border bg-primary/5 px-4 py-3 text-sm text-primary">
                Created {billingBatch.created}, reused {billingBatch.existing},
                skipped {billingBatch.skipped}.
              </div>
            ) : null}
            {billingBatchMutation.error ? (
              <div className="border-b border-border bg-danger-soft px-4 py-3 text-sm text-danger">
                {friendlyError(billingBatchMutation.error)}
              </div>
            ) : null}
            <ReviewSummaryStrip
              title="Billing cleanup blockers"
              description="Review owner identity, rent-roll blockers, and existing internal drafts before generating more billing work."
              rows={billingReviewRows}
              onOpenTab={setActiveTab}
            />
            {billingDrafts.length ? (
              <div className="divide-y divide-border">
                {billingDrafts.slice(0, 40).map((draft) => (
                  <Link
                    key={draft.id}
                    href="/billing-readiness"
                    className="grid gap-3 px-4 py-4 transition hover:bg-muted/60 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-semibold">{draft.title}</div>
                        <StatusBadge
                          tone={
                            draft.status === "approved" ? "success" : "primary"
                          }
                        >
                          {label(draft.status)}
                        </StatusBadge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {sourceLabel(draft.metadata)} / Due{" "}
                        {formatDate(draft.due_date)}
                      </p>
                    </div>
                    <div className="text-sm font-semibold">
                      {formatMoney(draft.total_cents)}
                    </div>
                    <div className="text-sm font-semibold text-primary">
                      Review
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<FileText size={18} />}
                title="No billing drafts yet"
                description="Create internal drafts from imported charge rules when you are ready to review billing."
              />
            )}
          </SectionPanel>
        ) : null}
      </div>
    </main>
  );
}

export default function PortfolioQaPage() {
  return (
    <QueryProvider>
      <PortfolioQaWorkspace />
    </QueryProvider>
  );
}
