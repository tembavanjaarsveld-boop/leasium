"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ClipboardList,
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
import { cn } from "@/lib/utils";

const ENTITY_STORAGE_KEY = "leasium.entity_id";

type Tone = "neutral" | "success" | "warning" | "danger" | "primary";
type QaTab = "issues" | "contacts" | "sources" | "onboarding" | "billing";

type QaIssue = {
  id: string;
  severity: Tone;
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
  title: string;
  detail: string;
  href: string;
  fields: string[];
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
  { id: "contacts", label: "Tenant contacts", description: "Clean invite details" },
  { id: "sources", label: "Source history", description: "Spreadsheet and intake trails" },
  { id: "onboarding", label: "Onboarding prep", description: "Ready or blocked" },
  { id: "billing", label: "Billing drafts", description: "Prepare internal drafts" },
];

function friendlyError(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

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
    const filename = textValue(entry.filename) ?? metadataText(metadata, "source_filename");
    const sheet = textValue(entry.sheet) ?? metadataText(metadata, "source_sheet");
    const row = textValue(entry.row) ?? numberValue(entry.row);
    const sourceHint = textValue(entry.source_hint) ?? metadataText(metadata, "source_hint");
    const changes = evidenceChangesFromUnknown(entry.changes);
    return {
      id: `${kind.toLowerCase()}-register-${title}-${index}`,
      kind,
      title,
      detail:
        [filename, sheet ? `${sheet}${row ? ` row ${row}` : ""}` : null]
          .filter(Boolean)
          .join(" / ") || sourceHint || "Register import",
      source: "Register import",
      href,
      evidence: {
        title: `${title} register import`,
        description: "Workbook action, reviewed field changes, and source row provenance.",
        sourceDocument: filename ? { label: filename, detail: "Imported workbook" } : "Imported workbook",
        sourceLocation: sourceLocationFromParts({ sheet, row, sourceHint }),
        confidence: numberValue(entry.confidence) ?? numberValue(metadata.confidence),
        changes,
        history: [
          {
            label: changes.length ? "Import action applied" : "Import source recorded",
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
  const citations = isRecord(metadata.source_citations) ? metadata.source_citations : null;
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
        after: textValue(isRecord(source) ? source.citation : null) ?? location.label,
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
        description: "Reviewed source citations stored against individual fields.",
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
        [documentType ? label(documentType) : null, shortId(intakeId) ?? shortId(documentId)]
          .filter(Boolean)
          .join(" / ") || "Smart Intake apply history",
      source: "Smart Intake",
      href: intakeId ? `/intake?review=${intakeId}` : `/properties?entity_id=${property.entity_id}&property_id=${property.id}`,
      evidence: {
        title: `${property.name} Smart Intake history`,
        description: "Source document and before/after changes applied to this property.",
        sourceDocument: {
          label: documentType ? label(documentType) : "Smart Intake document",
          href: intakeId ? `/intake?review=${intakeId}` : undefined,
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
        description: "Reviewed public-source field changes applied to this tenant.",
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
            description: textValue(isRecord(source) ? source.citation : null) ?? undefined,
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
  const ranks: Record<Tone, number> = {
    danger: 0,
    warning: 1,
    primary: 2,
    neutral: 3,
    success: 4,
  };
  return ranks[issue.severity];
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
        severity: !tenant.contact_email && !tenant.billing_email ? "danger" : "warning",
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
    if (["ready_for_review", "needs_attention", "failed"].includes(intake.status)) {
      issues.push({
        id: `intake-${intake.id}`,
        severity: intake.status === "failed" ? "danger" : "primary",
        area: "Smart Intake",
        title: intake.filename,
        detail: `${label(intake.document_type)} is ${label(intake.status)}.`,
        action: "Review document",
        href: `/intake?review=${intake.id}`,
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
    if (sourceDetail(property.metadata) || metadataText(property.metadata, "portfolio_import_source")) {
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
    if (sourceDetail(tenant.metadata) || metadataText(tenant.metadata, "insurance_status")) {
      rows.push({
        id: `tenant-${tenant.id}`,
        kind: "Tenant",
        title: tenantName(tenant),
        detail:
          sourceDetail(tenant.metadata) ||
          [metadataText(tenant.metadata, "insurance_status"), metadataText(tenant.metadata, "arrears")]
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
    if (sourceDetail(obligation.metadata) || metadataText(obligation.metadata, "portfolio_import_key")) {
      rows.push({
        id: `obligation-${obligation.id}`,
        kind: "Operations",
        title: obligation.title,
        detail: sourceDetail(obligation.metadata) || formatDate(obligation.due_date),
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
      href: `/intake?review=${intake.id}`,
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
      const onboarding = latestOnboarding(row.lease_id, row.tenant_id, onboardings);
      const email = tenant?.billing_email || tenant?.contact_email || row.tenant_billing_email || null;
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
        tenantName: tenant ? tenantName(tenant) : (row.tenant_name ?? "Tenant missing"),
        propertyName: row.property_name,
        unitLabel: row.unit_label,
        email,
        ready: Boolean(row.lease_id && row.tenant_id && email && !onboarding),
        blockers,
        onboarding,
      } satisfies TenantPrepRow;
    })
    .sort((a, b) => Number(b.ready) - Number(a.ready) || a.tenantName.localeCompare(b.tenantName));
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
    property.ownership_structure && property.ownership_structure !== "current_entity";
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
    billing_email: cleanText(draft.billing_email ?? property.billing_email ?? ""),
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
  const tenantFields = ["legal_name", "trading_name", "abn", "registered_address"] as const;
  const candidates: EnrichmentCandidate[] = [];

  for (const property of properties) {
    const fields = propertyFields.filter((field) => {
      return !property[field];
    });
    if (fields.length) {
      candidates.push({
        id: `property-enrichment-${property.id}`,
        title: property.name,
        detail: "Property public enrichment can propose address and ownership fields.",
        href: `/properties?entity_id=${property.entity_id}&property_id=${property.id}`,
        fields: fields.map(fieldLabel),
      });
    }
  }

  for (const tenant of tenants) {
    const metadata = isRecord(tenant.metadata.public_enrichment)
      ? tenant.metadata.public_enrichment
      : {};
    const fields = tenantFields.filter((field) => {
      if (field === "registered_address") {
        return !tenant.metadata.registered_address && !metadata.registered_address;
      }
      return !tenant[field];
    });
    if (fields.length) {
      candidates.push({
        id: `tenant-enrichment-${tenant.id}`,
        title: tenantName(tenant),
        detail: "Tenant public enrichment can propose ABN, trading name, and registered address.",
        href: `/tenants/${tenant.id}`,
        fields: fields.map(fieldLabel),
      });
    }
  }

  return candidates
    .sort((a, b) => b.fields.length - a.fields.length || a.title.localeCompare(b.title))
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
  const readyPrep = tenantPrep.filter((row) => row.ready).length;
  const activeBillingDrafts = billingDrafts.filter(
    (draft) => !["void", "superseded"].includes(draft.status),
  ).length;
  return [
    {
      id: "data-qa",
      label: "Data QA",
      ready: Math.max(0, issues.length - issues.filter((issue) => issue.severity === "danger").length),
      total: issues.length,
      detail: issues.length
        ? `${issues.filter((issue) => issue.severity === "danger").length} urgent blockers`
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
  tone?: Tone;
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

function PortfolioCompletionPanel({
  items,
  enrichmentCandidates,
  onOpenTab,
}: {
  items: QaCompletionItem[];
  enrichmentCandidates: EnrichmentCandidate[];
  onOpenTab: (tab: QaTab) => void;
}) {
  const total = items.reduce((sum, item) => sum + item.total, 0);
  const ready = items.reduce((sum, item) => sum + Math.min(item.ready, item.total), 0);
  const completion = total > 0 ? Math.round((ready / total) * 100) : 100;
  return (
    <SectionPanel
      title="Cleanup completion report"
      description="One scan for the import shakeout: what is ready, what needs review, and where AI enrichment can help."
      icon={<ClipboardList size={17} className="text-primary" />}
      actions={
        <StatusBadge tone={completion >= 90 ? "success" : completion >= 60 ? "warning" : "danger"}>
          {completion}% ready
        </StatusBadge>
      }
    >
      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const percent = item.total > 0 ? Math.round((Math.min(item.ready, item.total) / item.total) * 100) : 100;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenTab(item.tab)}
                aria-label={`Open cleanup report ${item.id}`}
                className="rounded-xl border border-border bg-white p-4 text-left shadow-leasiumXs transition hover:bg-muted/60"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-foreground">{item.label}</div>
                  <StatusBadge tone={percent >= 90 ? "success" : percent >= 60 ? "warning" : "danger"}>
                    {percent}%
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
                <p className="mt-3 text-sm text-muted-foreground">{item.detail}</p>
              </button>
            );
          })}
        </div>

        <div className="rounded-xl border border-border bg-muted/40 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-foreground">
                AI-assisted enrichment candidates
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Review public suggestions from the record detail before applying fields.
              </p>
            </div>
            <StatusBadge tone={enrichmentCandidates.length ? "primary" : "success"}>
              {enrichmentCandidates.length} queued
            </StatusBadge>
          </div>
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
                    <StatusBadge tone="neutral">
                      {candidate.fields.length} fields
                    </StatusBadge>
                  </div>
                  <p className="text-sm text-muted-foreground">{candidate.detail}</p>
                  <p className="text-xs text-muted-foreground">
                    {candidate.fields.slice(0, 4).join(", ")}
                    {candidate.fields.length > 4 ? "..." : ""}
                  </p>
                </Link>
              ))
            ) : (
              <div className="py-4 text-sm text-muted-foreground">
                No obvious enrichment candidates remain for this entity.
              </div>
            )}
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
  const [tenantDrafts, setTenantDrafts] = useState<Record<string, TenantContactDraft>>({});
  const [propertyDrafts, setPropertyDrafts] = useState<Record<string, PropertyBillingDraft>>({});
  const [focusedTenantId, setFocusedTenantId] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [billingBatch, setBillingBatch] = useState<BillingDraftBatchRecord | null>(null);
  const [onboardingResult, setOnboardingResult] = useState("");
  const [propertyFixResult, setPropertyFixResult] = useState("");
  const [tenantFixResult, setTenantFixResult] = useState("");

  const entitiesQuery = useQuery({ queryKey: ["entities"], queryFn: listEntities });
  const entities = useMemo(() => entitiesQuery.data ?? [], [entitiesQuery.data]);

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
    } else if (selectedEntityId && !entities.some((entity) => entity.id === selectedEntityId)) {
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

  const properties = useMemo(() => propertiesQuery.data ?? [], [propertiesQuery.data]);
  const tenants = useMemo(() => tenantsQuery.data ?? [], [tenantsQuery.data]);
  const rentRoll = useMemo(() => rentRollQuery.data ?? [], [rentRollQuery.data]);
  const obligations = useMemo(() => obligationsQuery.data ?? [], [obligationsQuery.data]);
  const intakes = useMemo(() => intakesQuery.data ?? [], [intakesQuery.data]);
  const onboardings = useMemo(() => onboardingsQuery.data ?? [], [onboardingsQuery.data]);
  const billingDrafts = useMemo(
    () => billingDraftsQuery.data ?? [],
    [billingDraftsQuery.data],
  );

  const issues = useMemo(
    () => buildIssues({ properties, tenants, rentRoll, obligations, intakes }),
    [properties, tenants, rentRoll, obligations, intakes],
  );
  const sources = useMemo(
    () => buildSources({ properties, tenants, obligations, intakes, drafts: billingDrafts }),
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
  const selectedReadyRows = tenantPrep.filter(
    (row) => row.ready && row.leaseId && selectedLeaseIds.includes(row.leaseId),
  );
  const searchableIssues = issues.filter((issue) =>
    [issue.area, issue.title, issue.detail].join(" ").toLowerCase().includes(search.toLowerCase()),
  );
  const searchableSources = sources.filter((source) =>
    [source.kind, source.title, source.detail, source.source, source.evidence?.title, source.evidence?.description]
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
    mutationFn: ({ tenant, draft }: { tenant: TenantRecord; draft: TenantContactDraft }) => {
      return updateTenant(tenant.id, tenantContactPayload(tenant, draft));
    },
    onSuccess: (_tenant, variables) => {
      setTenantDrafts((current) => {
        const next = { ...current };
        delete next[variables.tenant.id];
        return next;
      });
      setTenantFixResult(`${tenantName(variables.tenant)} contact details saved.`);
      queryClient.invalidateQueries({ queryKey: ["tenants", selectedEntityId] });
      queryClient.invalidateQueries({ queryKey: ["rent-roll", selectedEntityId] });
    },
  });

  const updateTenantBatchMutation = useMutation({
    mutationFn: async (items: Array<{ tenant: TenantRecord; draft: TenantContactDraft }>) => {
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
      queryClient.invalidateQueries({ queryKey: ["tenants", selectedEntityId] });
      queryClient.invalidateQueries({ queryKey: ["rent-roll", selectedEntityId] });
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
      setPropertyFixResult(`${variables.property.name} billing identity saved.`);
      queryClient.invalidateQueries({ queryKey: ["properties", selectedEntityId] });
      queryClient.invalidateQueries({ queryKey: ["rent-roll", selectedEntityId] });
      queryClient.invalidateQueries({ queryKey: ["billing-drafts", selectedEntityId] });
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
      queryClient.invalidateQueries({ queryKey: ["properties", selectedEntityId] });
      queryClient.invalidateQueries({ queryKey: ["rent-roll", selectedEntityId] });
      queryClient.invalidateQueries({ queryKey: ["billing-drafts", selectedEntityId] });
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
        failed ? `${sent} invite links created, ${failed} need review.` : `${sent} invite links created.`,
      );
      setSelectedLeaseIds([]);
      queryClient.invalidateQueries({ queryKey: ["tenant-onboardings", selectedEntityId] });
    },
  });

  const billingBatchMutation = useMutation({
    mutationFn: () =>
      createBillingDraftsFromChargeRules({
        entity_id: selectedEntityId,
        lease_ids: rentRoll.map((row) => row.lease_id).filter((id): id is string => Boolean(id)),
      }),
    onSuccess: (result) => {
      setBillingBatch(result);
      queryClient.invalidateQueries({ queryKey: ["billing-drafts", selectedEntityId] });
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

  function propertyDraftValue(property: PropertyRecord, field: keyof PropertyBillingDraft) {
    return propertyDrafts[property.id]?.[field] ?? property[field] ?? "";
  }

  function updateTenantDraft(tenantId: string, field: keyof TenantContactDraft, value: string) {
    setTenantDrafts((current) => ({
      ...current,
      [tenantId]: {
        ...current[tenantId],
        [field]: value,
      },
    }));
  }

  function updatePropertyDraft(propertyId: string, field: keyof PropertyBillingDraft, value: string) {
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
        if (!property.billing_contact_name && !suggestion.billing_contact_name) {
          suggestion.billing_contact_name =
            property.trustee_name ?? property.owner_legal_name ?? undefined;
        }
        if (Object.values(suggestion).some(Boolean)) {
          next[property.id] = suggestion;
        }
      }
      return next;
    });
    setPropertyFixResult("Review staged owner billing suggestions before saving.");
  }

  function openTenantContactFix(tenantId: string) {
    setFocusedTenantId(tenantId);
    setActiveTab("contacts");
  }

  function toggleLease(leaseId: string, checked: boolean) {
    setSelectedLeaseIds((current) =>
      checked ? Array.from(new Set([...current, leaseId])) : current.filter((id) => id !== leaseId),
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
            <SecondaryButton type="button" onClick={refreshAll} disabled={!selectedEntityId || loading}>
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
            value={loading ? "..." : issues.length}
            detail="Missing fields, blockers, and urgent review items."
            tone={issues.length ? "warning" : "success"}
            icon={<AlertTriangle size={17} />}
          />
          <MetricCard
            label="Contact cleanup"
            value={loading ? "..." : tenantsNeedingContact.length}
            detail="Tenants missing emails, ABNs, or named contacts."
            tone={tenantsNeedingContact.length ? "danger" : "success"}
            icon={<UserRound size={17} />}
          />
          <MetricCard
            label="Ready to invite"
            value={loading ? "..." : readyPrepRows.length}
            detail="Leases with a tenant email and no active invite."
            tone={readyPrepRows.length ? "primary" : "neutral"}
            icon={<MailCheck size={17} />}
          />
          <MetricCard
            label="Source trails"
            value={loading ? "..." : sources.length}
            detail="Imported rows, document reviews, and generated sources."
            tone="neutral"
            icon={<FileText size={17} />}
          />
          <MetricCard
            label="Billing drafts"
            value={loading ? "..." : billingDrafts.length}
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
                activeTab === tab.id && "bg-primary text-primary-foreground shadow-leasiumXs hover:bg-primary",
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
          <PortfolioCompletionPanel
            items={completionItems}
            enrichmentCandidates={enrichmentCandidates}
            onOpenTab={setActiveTab}
          />
        ) : null}

        {loading && !error ? (
          <SectionPanel
            title="Checking the imported portfolio"
            description="Pulling together properties, tenants, tasks, billing, onboarding, and sources."
            icon={<Loader2 size={17} className="animate-spin text-primary" />}
          >
            <div className="p-4 text-sm text-muted-foreground">Loading QA workspace.</div>
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
                        <StatusBadge tone={severityTone(issue)}>{issue.area}</StatusBadge>
                        <div className="font-semibold">{issue.title}</div>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{issue.detail}</p>
                    </div>
                    <div className="text-sm font-semibold text-primary">{issue.action}</div>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState icon={<CheckCircle2 size={18} />} title="No QA issues found" description="The imported register is clean for the current checks." />
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
                  const missingFields = propertyMissingBillingFields(property);
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
                            value={propertyDraftValue(property, "owner_legal_name")}
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
                              updatePropertyDraft(property.id, "owner_abn", event.target.value)
                            }
                          />
                        </Field>
                        <Field label="Invoice issuer">
                          <Input
                            value={propertyDraftValue(property, "invoice_issuer_name")}
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
                            value={propertyDraftValue(property, "billing_contact_name")}
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
                            value={propertyDraftValue(property, "billing_email")}
                            onChange={(event) =>
                              updatePropertyDraft(property.id, "billing_email", event.target.value)
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
              <EmptyState icon={<CheckCircle2 size={18} />} title="Owner billing data is complete" description="No property owner or billing identity blockers are visible for this entity." />
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
                    !stagedTenantRows.length || updateTenantBatchMutation.isPending
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
                        focusedTenantId === tenant.id && "bg-primary/5 ring-1 ring-inset ring-primary/20",
                      )}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/tenants/${tenant.id}`} className="font-semibold text-primary">
                            {tenantName(tenant)}
                          </Link>
                          <StatusBadge tone={missingFields.includes("contact email") ? "danger" : "warning"}>
                            {missingFields.length} missing
                          </StatusBadge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {missingFields.join(", ")}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {[metadataText(tenant.metadata, "insurance_status"), metadataText(tenant.metadata, "arrears")]
                            .filter(Boolean)
                            .join(" / ") || "Imported tenant"}
                        </p>
                      </div>
                      <Field label="Contact">
                        <Input
                          value={draftValue(tenant, "contact_name")}
                          onChange={(event) =>
                            updateTenantDraft(tenant.id, "contact_name", event.target.value)
                          }
                        />
                      </Field>
                      <Field label="Contact email">
                        <Input
                          value={draftValue(tenant, "contact_email")}
                          onChange={(event) =>
                            updateTenantDraft(tenant.id, "contact_email", event.target.value)
                          }
                        />
                      </Field>
                      <Field label="Billing email">
                        <Input
                          value={draftValue(tenant, "billing_email")}
                          onChange={(event) =>
                            updateTenantDraft(tenant.id, "billing_email", event.target.value)
                          }
                        />
                      </Field>
                      <Field label="ABN">
                        <Input
                          value={draftValue(tenant, "abn")}
                          onChange={(event) => updateTenantDraft(tenant.id, "abn", event.target.value)}
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
              <EmptyState icon={<CheckCircle2 size={18} />} title="Tenant contact data is complete" description="Every tenant has the current cleanup fields filled." />
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
                        selectedSource?.id === source.id ? "bg-primary/5" : "hover:bg-muted/60",
                      )}
                    >
                      <StatusBadge tone={source.evidence ? "primary" : "neutral"}>
                        {source.kind}
                      </StatusBadge>
                      <div className="min-w-0">
                        <Link href={source.href} className="font-semibold text-primary">
                          {source.title}
                        </Link>
                        <p className="mt-1 text-sm text-muted-foreground">{source.detail || "No row detail stored"}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 md:justify-end">
                        <span className="text-sm font-semibold text-muted-foreground">{source.source}</span>
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
                      Select a row with a trail to inspect workbook rows, public enrichment, citations, and apply history.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <EmptyState icon={<History size={18} />} title="No source trails yet" description="Imported rows and document reviews will appear here as metadata is stored." />
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
                  onClick={() => setSelectedLeaseIds(readyPrepRows.map((row) => row.leaseId).filter((id): id is string => Boolean(id)))}
                  disabled={!readyPrepRows.length}
                >
                  <CheckCircle2 size={15} />
                  Select ready
                </SecondaryButton>
                <Button
                  type="button"
                  onClick={() =>
                    batchOnboardingMutation.mutate(
                      selectedReadyRows.map((row) => row.leaseId).filter((id): id is string => Boolean(id)),
                    )
                  }
                  disabled={!selectedReadyRows.length || batchOnboardingMutation.isPending}
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
            <div className="divide-y divide-border">
              {tenantPrep.map((row) => (
                <div key={row.id} className="grid gap-3 px-4 py-4 md:grid-cols-[32px_minmax(0,1fr)_minmax(170px,auto)_minmax(170px,auto)_auto] md:items-center">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={Boolean(row.leaseId && selectedLeaseIds.includes(row.leaseId))}
                    disabled={!row.ready || !row.leaseId}
                    onChange={(event) => row.leaseId && toggleLease(row.leaseId, event.target.checked)}
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
                  <div className="text-sm text-muted-foreground">{row.email ?? "No email"}</div>
                  <div className="text-sm font-medium text-muted-foreground">
                    {row.blockers.length ? row.blockers.join(" / ") : "Ready for batch invite"}
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
                    ) : row.tenantId && row.blockers.some((blocker) => blocker.includes("email")) ? (
                      <SecondaryButton
                        type="button"
                        onClick={() => openTenantContactFix(row.tenantId as string)}
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
                      <span className="text-xs font-medium text-muted-foreground">Needs setup</span>
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
                Created {billingBatch.created}, reused {billingBatch.existing}, skipped {billingBatch.skipped}.
              </div>
            ) : null}
            {billingBatchMutation.error ? (
              <div className="border-b border-border bg-danger-soft px-4 py-3 text-sm text-danger">
                {friendlyError(billingBatchMutation.error)}
              </div>
            ) : null}
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
                        <StatusBadge tone={draft.status === "approved" ? "success" : "primary"}>
                          {label(draft.status)}
                        </StatusBadge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {sourceLabel(draft.metadata)} / Due {formatDate(draft.due_date)}
                      </p>
                    </div>
                    <div className="text-sm font-semibold">{formatMoney(draft.total_cents)}</div>
                    <div className="text-sm font-semibold text-primary">Review</div>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState icon={<FileText size={18} />} title="No billing drafts yet" description="Create internal drafts from imported charge rules when you are ready to review billing." />
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
