"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  Check,
  ChevronDown,
  ClipboardCopy,
  Clock3,
  Download,
  Edit3,
  FileText,
  KeyRound,
  Link2,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

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
  SecondaryButton,
  SectionPanel,
  Select,
  SkeletonRows,
  StatusBadge,
} from "@/components/ui";
import {
  applyPublicEnrichment,
  applyTenantContactChangeRequest,
  cancelTenantOnboarding,
  applyTenantOnboarding,
  createDocumentIntakeFromDocument,
  createTenantOnboarding,
  deleteDocument,
  deleteTenant,
  dismissTenantContactChangeRequest,
  documentDownloadUrl,
  DocumentCategory,
  DocumentIntakeRecord,
  EnrichmentSuggestion,
  getTenant,
  getTenantDetail,
  listDocumentIntakes,
  listDocuments,
  listLeasesByTenant,
  listTenantPortalAccounts,
  listTenantOnboardings,
  previewPublicEnrichment,
  refreshTenantOnboardingLink,
  resendTenantOnboarding,
  reviewTenantOnboarding,
  respondTenantLeaseQuestion,
  sendTenantOnboardingPortalInvite,
  restoreTenantPortalAccount,
  revokeTenantPortalAccount,
  TenantPortalAccountRecord,
  TenantLeaseAgreementRecord,
  TenantLeaseQuestionRecord,
  TenantPayload,
  TenantReviewedChangeRecord,
  TenantRecord,
  unlinkTenantPortalAccount,
  uploadDocument,
  updateTenant,
} from "@/lib/api";
import {
  onboardingDeliveryDetail,
  onboardingDeliveryLabel,
  onboardingDeliveryTone,
  onboardingNeedsContactFix,
  onboardingReminderLabel,
  onboardingReminderSteps,
  onboardingReminderTone,
} from "@/lib/delivery";
import { cn } from "@/lib/utils";

type TenantForm = {
  legal_name: string;
  trading_name: string;
  abn: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  billing_email: string;
  notes: string;
};

function formFromTenant(tenant: TenantRecord): TenantForm {
  return {
    legal_name: tenant.legal_name,
    trading_name: tenant.trading_name ?? "",
    abn: tenant.abn ?? "",
    contact_name: tenant.contact_name ?? "",
    contact_email: tenant.contact_email ?? "",
    contact_phone: tenant.contact_phone ?? "",
    billing_email: tenant.billing_email ?? "",
    notes: tenant.notes ?? "",
  };
}

function cleanText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function tenantName(tenant: TenantRecord) {
  return tenant.trading_name
    ? `${tenant.trading_name} (${tenant.legal_name})`
    : tenant.legal_name;
}

function friendlyError(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
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

function formatBytes(bytes: number) {
  if (bytes < 1_000_000) {
    return `${Math.max(1, Math.round(bytes / 1_000))} KB`;
  }
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function dateOnly(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dueRank(value: string | null | undefined) {
  if (!value) {
    return 9999;
  }
  const today = new Date(dateOnly(new Date())).getTime();
  const due = new Date(`${value.slice(0, 10)}T00:00:00`).getTime();
  return Math.ceil((due - today) / 86_400_000);
}

function isExpiredDateTime(value: string | null | undefined) {
  if (!value) {
    return false;
  }
  return new Date(value).getTime() <= Date.now();
}

function statusTone(status: string, dueDate?: string | null) {
  if (status === "submitted") {
    return "success" as const;
  }
  if (status === "cancelled") {
    return "neutral" as const;
  }
  if (dueRank(dueDate) < 0) {
    return "danger" as const;
  }
  return status === "sent" ? ("primary" as const) : ("warning" as const);
}

function leaseAgreementFromDelivery(
  deliveryData:
    | { lease_agreement?: TenantLeaseAgreementRecord }
    | null
    | undefined,
) {
  return deliveryData?.lease_agreement ?? null;
}

function leaseAgreementBlocksApply(
  agreement: TenantLeaseAgreementRecord | null,
) {
  if (!agreement) {
    return false;
  }
  return agreement.open_question_count > 0 || agreement.status !== "signed";
}

function leaseAgreementApplyReason(
  agreement: TenantLeaseAgreementRecord | null,
) {
  if (!agreement) {
    return null;
  }
  if (agreement.open_question_count > 0) {
    return "Answer lease questions before applying.";
  }
  if (agreement.status !== "signed") {
    return "Lease agreement needs signing before applying.";
  }
  return null;
}

function leaseAgreementTone(agreement: TenantLeaseAgreementRecord | null) {
  if (!agreement) {
    return "neutral" as const;
  }
  if (agreement.status === "signed") {
    return "success" as const;
  }
  if (agreement.open_question_count > 0) {
    return "warning" as const;
  }
  if (agreement.status === "ready_to_sign") {
    return "primary" as const;
  }
  return "neutral" as const;
}

function leaseAgreementLabel(agreement: TenantLeaseAgreementRecord | null) {
  if (!agreement) {
    return "Not started";
  }
  if (agreement.status === "signed") {
    return "Signed";
  }
  if (agreement.open_question_count > 0) {
    return "Questions open";
  }
  if (agreement.status === "ready_to_sign") {
    return "Ready to sign";
  }
  return "Review pending";
}

function leaseQuestionTone(status: TenantLeaseQuestionRecord["status"]) {
  if (status === "answered" || status === "resolved") {
    return "success" as const;
  }
  if (status === "needs_revision" || status === "legal_review") {
    return "warning" as const;
  }
  return "primary" as const;
}

function leaseQuestionLabel(status: TenantLeaseQuestionRecord["status"]) {
  if (status === "legal_review") {
    return "Legal review";
  }
  if (status === "needs_revision") {
    return "Needs revision";
  }
  return status.replaceAll("_", " ");
}

function portalAccountTone(status: TenantPortalAccountRecord["status"]) {
  if (status === "active") {
    return "success" as const;
  }
  if (status === "revoked") {
    return "danger" as const;
  }
  return "neutral" as const;
}

function portalAccountLabel(status: TenantPortalAccountRecord["status"]) {
  return status.replaceAll("_", " ");
}

function portalAccountDetail(account: TenantPortalAccountRecord) {
  if (account.status === "revoked") {
    return `Revoked ${formatDateTime(account.revoked_at)}`;
  }
  if (account.status === "unlinked") {
    return `Unlinked ${formatDateTime(account.deleted_at)}`;
  }
  return `Linked ${formatDateTime(account.linked_at)} - Last seen ${formatDateTime(
    account.last_seen_at,
  )}`;
}

function portalAccountRecoveryDetail(account: TenantPortalAccountRecord) {
  if (!account.recovery_action) {
    return null;
  }
  const action = portalAccountLabel(account.recovery_action);
  const at = formatDateTime(account.recovery_at);
  const reason = account.recovery_reason ? ` - ${account.recovery_reason}` : "";
  return `${action} by staff ${at}${reason}`;
}

function reminderStepTone(statusValue: string | null | undefined) {
  if (statusValue === "sent") {
    return "success" as const;
  }
  if (statusValue === "needs_attention" || statusValue === "paused") {
    return "warning" as const;
  }
  return "neutral" as const;
}

function reminderStepLabel(statusValue: string | null | undefined) {
  if (statusValue === "needs_attention") {
    return "Needs attention";
  }
  return statusValue?.replaceAll("_", " ") ?? "scheduled";
}

const documentCategories: Array<{ value: DocumentCategory; label: string }> = [
  { value: "insurance", label: "Insurance" },
  { value: "bank_guarantee", label: "Bank guarantee" },
  { value: "lease", label: "Signed lease" },
  { value: "onboarding", label: "Onboarding" },
  { value: "invoice", label: "Invoice" },
  { value: "other", label: "Other" },
];

function documentCategoryLabel(value: DocumentCategory) {
  return (
    documentCategories.find((item) => item.value === value)?.label ?? value
  );
}

function documentTypeLabel(value: string | null | undefined) {
  return value ? value.replaceAll("_", " ") : "document";
}

function metadataString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function documentSourceLabel(document: {
  tenant_onboarding_id: string | null;
  metadata: Record<string, unknown>;
}) {
  if (document.tenant_onboarding_id) {
    return "Onboarding";
  }
  if (metadataString(document.metadata.source) === "smart_intake") {
    return "Smart Intake";
  }
  return "Tenant profile";
}

function intakeStatusLabel(intake: DocumentIntakeRecord | undefined) {
  if (!intake) {
    return "Stored";
  }
  if (intake.status === "applied") {
    return "Applied";
  }
  if (intake.reviewed_at) {
    return "Reviewed";
  }
  switch (intake.status) {
    case "uploaded":
      return "Sent to Smart Intake";
    case "reading":
      return "Reading";
    case "ready_for_review":
      return "Needs review";
    case "needs_attention":
      return "Needs match";
    case "failed":
      return "Could not read";
    default:
      return "Stored";
  }
}

function intakeStatusTone(intake: DocumentIntakeRecord | undefined) {
  if (!intake) {
    return "neutral" as const;
  }
  if (intake.status === "applied") {
    return "success" as const;
  }
  if (intake.status === "failed") {
    return "danger" as const;
  }
  if (intake.status === "needs_attention") {
    return "warning" as const;
  }
  if (intake.status === "ready_for_review" || intake.reviewed_at) {
    return "primary" as const;
  }
  return "neutral" as const;
}

function intakeProvenanceNote(
  intake: DocumentIntakeRecord | undefined,
  metadata: Record<string, unknown>,
) {
  if (!intake) {
    return "Stored only - no tenant fields changed.";
  }
  if (intake.status === "failed") {
    return "Could not read - send again or download.";
  }
  if (intake.status === "applied") {
    const appliedType =
      metadataString(metadata.applied_document_type) ??
      documentTypeLabel(intake.document_type);
    return `Applied - ${appliedType} reviewed in Smart Intake.`;
  }
  if (intake.reviewed_at) {
    return "Reviewed in Smart Intake - nothing applied until approved.";
  }
  if (intake.status === "reading" || intake.status === "uploaded") {
    return "Waiting in Smart Intake - nothing applied yet.";
  }
  return "Waiting in Smart Intake - review before anything changes.";
}

const submittedFields: Array<{
  key:
    | keyof TenantForm
    | "insurance_confirmed"
    | "insurance_expiry_date"
    | "emergency_contact_name"
    | "emergency_contact_phone";
  label: string;
}> = [
  { key: "legal_name", label: "Legal name" },
  { key: "trading_name", label: "Trading as" },
  { key: "abn", label: "ABN" },
  { key: "contact_name", label: "Primary contact" },
  { key: "contact_email", label: "Contact email" },
  { key: "contact_phone", label: "Phone" },
  { key: "billing_email", label: "Billing email" },
  { key: "insurance_confirmed", label: "Insurance confirmed" },
  { key: "insurance_expiry_date", label: "Insurance expiry" },
  { key: "emergency_contact_name", label: "Emergency contact" },
  { key: "emergency_contact_phone", label: "Emergency phone" },
  { key: "notes", label: "Notes" },
];

function reviewValue(value: unknown) {
  if (value === true) {
    return "Yes";
  }
  if (value === false) {
    return "No";
  }
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return String(value);
}

function confidenceLabel(value: number | null | undefined) {
  return value === null || value === undefined
    ? "confidence pending"
    : `${Math.round(value * 100)}% confidence`;
}

type TenantEvidenceSource = {
  source_hint: string | null;
  citation: string | null;
  confidence: number | null;
  url: string | null;
};

type TenantEnrichmentHistoryEntry = {
  field: string;
  label: string | null;
  before: unknown;
  after: unknown;
  source: TenantEvidenceSource | null;
  applied_at: string | null;
  applied_by_user_id: string | null;
};

type TenantEvidenceChangeSet = {
  sourceDocument: EvidenceSourceDocument;
  sourceLocation?: EvidenceSourceLocation | null;
  confidence?: number | null;
  appliedAt?: string | null;
  appliedBy?: string | null;
  changes: EvidenceFieldChange[];
};

function tenantFieldLabel(field: string) {
  const submittedLabel = submittedFields.find(
    (item) => item.key === field,
  )?.label;
  if (submittedLabel) {
    return submittedLabel;
  }
  if (field === "registered_address") {
    return "Registered address";
  }
  return field
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function timestamp(value: string | null | undefined) {
  if (!value) {
    return 0;
  }
  const date = new Date(value).getTime();
  return Number.isNaN(date) ? 0 : date;
}

function shortId(value: string | null | undefined) {
  return value ? value.slice(0, 8) : null;
}

function evidenceStatusLabel(status: string) {
  const value = status.split(".").at(-1) ?? status;
  return value.replaceAll("_", " ");
}

function evidenceStatusIsApplied(status: string) {
  return evidenceStatusLabel(status) === "applied";
}

function tenantMetadata(tenant: TenantRecord | null | undefined) {
  return isRecord(tenant?.metadata) ? tenant.metadata : {};
}

function tenantPublicEnrichmentMetadata(
  tenant: TenantRecord | null | undefined,
) {
  const publicEnrichment = tenantMetadata(tenant).public_enrichment;
  return isRecord(publicEnrichment) ? publicEnrichment : {};
}

function tenantEvidenceSource(value: unknown): TenantEvidenceSource | null {
  if (!isRecord(value)) {
    return null;
  }
  const source = {
    source_hint:
      metadataString(value.source_hint) ?? metadataString(value.hint),
    citation: metadataString(value.citation) ?? metadataString(value.text),
    confidence: numberValue(value.confidence),
    url: metadataString(value.url) ?? metadataString(value.source_url),
  };
  return source.source_hint ||
    source.citation ||
    source.confidence !== null ||
    source.url
    ? source
    : null;
}

function tenantSourceCitations(tenant: TenantRecord | null | undefined) {
  const legacyCitations = tenantMetadata(tenant).source_citations;
  const publicCitations =
    tenantPublicEnrichmentMetadata(tenant).source_citations;
  const citations: Record<string, unknown> = {
    ...(isRecord(legacyCitations) ? legacyCitations : {}),
    ...(isRecord(publicCitations) ? publicCitations : {}),
  };

  return Object.entries(citations)
    .map(([field, value]) => ({
      field,
      source: tenantEvidenceSource(value),
    }))
    .filter(
      (item): item is { field: string; source: TenantEvidenceSource } =>
        item.source !== null,
    )
    .sort((a, b) =>
      tenantFieldLabel(a.field).localeCompare(tenantFieldLabel(b.field)),
    );
}

function tenantEnrichmentHistory(
  tenant: TenantRecord | null | undefined,
): TenantEnrichmentHistoryEntry[] {
  const history = tenantPublicEnrichmentMetadata(tenant).apply_history;
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }
      const field = metadataString(entry.field);
      if (!field) {
        return null;
      }
      return {
        field,
        label: metadataString(entry.label),
        before: entry.before,
        after: entry.after,
        source: tenantEvidenceSource(entry.source),
        applied_at: metadataString(entry.applied_at),
        applied_by_user_id: metadataString(entry.applied_by_user_id),
      };
    })
    .filter((entry): entry is TenantEnrichmentHistoryEntry => entry !== null)
    .sort((a, b) => timestamp(b.applied_at) - timestamp(a.applied_at));
}

function confidencePercent(value: number | null | undefined) {
  return value === null || value === undefined
    ? null
    : `${Math.round(value * 100)}% confidence`;
}

function sourceCaption(source: TenantEvidenceSource | null | undefined) {
  if (!source) {
    return null;
  }
  return [
    source.source_hint,
    source.citation,
    confidencePercent(source.confidence),
  ]
    .filter(Boolean)
    .join(" - ");
}

function tenantEvidenceSourceLocation(
  source: TenantEvidenceSource | null | undefined,
): EvidenceSourceLocation | null {
  if (!source) {
    return null;
  }
  const label = source.source_hint ?? source.citation;
  if (!label) {
    return null;
  }
  return {
    label,
    href: source.url ?? undefined,
    detail: source.source_hint && source.citation ? source.citation : undefined,
  };
}

function reviewedChangeEvidenceChanges(
  entry: TenantReviewedChangeRecord | null | undefined,
): EvidenceFieldChange[] {
  if (!entry) {
    return [];
  }
  return entry.changes.map((change, index) => ({
    id: `${entry.source_id ?? entry.source}-${change.field}-${index}`,
    field: change.field,
    label: change.label || tenantFieldLabel(change.field),
    before: change.before,
    after: change.after,
  }));
}

function enrichmentEvidenceChanges(
  entry: TenantEnrichmentHistoryEntry | null | undefined,
): EvidenceFieldChange[] {
  if (!entry) {
    return [];
  }
  return [
    {
      id: `public-enrichment-${entry.field}`,
      field: entry.field,
      label: entry.label ?? tenantFieldLabel(entry.field),
      before: entry.before,
      after: entry.after,
      sourceLocation: tenantEvidenceSourceLocation(entry.source),
      confidence: entry.source?.confidence,
    },
  ];
}

function reviewedSourceDocument(
  entry: TenantReviewedChangeRecord,
): EvidenceSourceDocument {
  const isIntakeSource = entry.source.includes("intake");
  return {
    label: entry.source_label,
    href:
      isIntakeSource && entry.source_id
        ? `/intake?review=${entry.source_id}`
        : undefined,
    detail: shortId(entry.source_id) ?? undefined,
  };
}

function latestEvidenceChangeSet(
  reviewedChanges: TenantReviewedChangeRecord[],
  enrichmentHistory: TenantEnrichmentHistoryEntry[],
): TenantEvidenceChangeSet | null {
  const latestReviewed = reviewedChanges[0] ?? null;
  const latestEnrichment = enrichmentHistory[0] ?? null;
  const reviewedTime = timestamp(latestReviewed?.occurred_at);
  const enrichmentTime = timestamp(latestEnrichment?.applied_at);

  if (latestEnrichment && enrichmentTime > reviewedTime) {
    return {
      sourceDocument: {
        label: "Public enrichment",
        detail:
          latestEnrichment.label ?? tenantFieldLabel(latestEnrichment.field),
      },
      sourceLocation: tenantEvidenceSourceLocation(latestEnrichment.source),
      confidence: latestEnrichment.source?.confidence,
      appliedAt: latestEnrichment.applied_at,
      appliedBy: shortId(latestEnrichment.applied_by_user_id)
        ? `Operator ${shortId(latestEnrichment.applied_by_user_id)}`
        : null,
      changes: enrichmentEvidenceChanges(latestEnrichment),
    };
  }

  if (latestReviewed) {
    return {
      sourceDocument: reviewedSourceDocument(latestReviewed),
      appliedAt: evidenceStatusIsApplied(latestReviewed.status)
        ? latestReviewed.occurred_at
        : null,
      changes: reviewedChangeEvidenceChanges(latestReviewed),
    };
  }

  if (latestEnrichment) {
    return {
      sourceDocument: {
        label: "Public enrichment",
        detail:
          latestEnrichment.label ?? tenantFieldLabel(latestEnrichment.field),
      },
      sourceLocation: tenantEvidenceSourceLocation(latestEnrichment.source),
      confidence: latestEnrichment.source?.confidence,
      appliedAt: latestEnrichment.applied_at,
      appliedBy: shortId(latestEnrichment.applied_by_user_id)
        ? `Operator ${shortId(latestEnrichment.applied_by_user_id)}`
        : null,
      changes: enrichmentEvidenceChanges(latestEnrichment),
    };
  }

  return null;
}

function documentEvidenceSource(
  documents: Array<{
    id: string;
    filename: string;
    created_at: string;
    tenant_onboarding_id: string | null;
  }>,
): EvidenceSourceDocument | null {
  const latestDocument = documents
    .slice()
    .sort((a, b) => timestamp(b.created_at) - timestamp(a.created_at))[0];
  if (!latestDocument) {
    return null;
  }
  return {
    label: latestDocument.filename,
    href: documentDownloadUrl(latestDocument.id),
    detail: latestDocument.tenant_onboarding_id
      ? "Onboarding document"
      : "Tenant document",
  };
}

function reviewedChangeHistoryRows(
  reviewedChanges: TenantReviewedChangeRecord[],
): EvidenceHistoryRow[] {
  return reviewedChanges.map((entry) => ({
    id: `reviewed-${entry.source}-${entry.source_id ?? entry.occurred_at}`,
    label: `${entry.source_label} ${evidenceStatusLabel(entry.status)}`,
    description: [
      `${entry.changes.length} field change${entry.changes.length === 1 ? "" : "s"} recorded.`,
      entry.notes,
    ]
      .filter(Boolean)
      .join(" "),
    occurredAt: entry.occurred_at,
    tone: evidenceStatusIsApplied(entry.status) ? "success" : "primary",
  }));
}

function enrichmentHistoryRows(
  history: TenantEnrichmentHistoryEntry[],
): EvidenceHistoryRow[] {
  return history.map((entry) => ({
    id: `enrichment-${entry.field}-${entry.applied_at ?? ""}`,
    label: `Applied ${entry.label ?? tenantFieldLabel(entry.field)}`,
    description:
      sourceCaption(entry.source) ?? "Public enrichment citation stored.",
    actor: shortId(entry.applied_by_user_id)
      ? `Operator ${shortId(entry.applied_by_user_id)}`
      : undefined,
    occurredAt: entry.applied_at,
    tone: "success",
  }));
}

function documentHistoryRows(
  documents: Array<{
    id: string;
    filename: string;
    category: DocumentCategory;
    tenant_onboarding_id: string | null;
    created_at: string;
    metadata: Record<string, unknown>;
  }>,
  intakeByDocumentId: Map<string, DocumentIntakeRecord>,
): EvidenceHistoryRow[] {
  return documents.map((document) => {
    const intake = intakeByDocumentId.get(document.id);
    const documentType = intake?.document_type
      ? documentTypeLabel(intake.document_type)
      : documentCategoryLabel(document.category);
    const reviewedAt = intake?.applied_at ?? intake?.reviewed_at ?? null;
    const label = intake?.applied_at
      ? `Applied ${documentType}`
      : intake?.reviewed_at
        ? `Reviewed ${documentType}`
        : document.tenant_onboarding_id
          ? "Onboarding document uploaded"
          : "Tenant document uploaded";

    return {
      id: `document-${document.id}`,
      label,
      description: `${document.filename} - ${intakeProvenanceNote(intake, document.metadata)}`,
      occurredAt: reviewedAt ?? document.created_at,
      tone: intakeStatusTone(intake),
    };
  });
}

function citationHistoryRows(
  citations: Array<{ field: string; source: TenantEvidenceSource }>,
  enrichmentHistory: TenantEnrichmentHistoryEntry[],
): EvidenceHistoryRow[] {
  const appliedFields = new Set(enrichmentHistory.map((entry) => entry.field));
  return citations
    .filter((item) => !appliedFields.has(item.field))
    .slice(0, 4)
    .map((item) => ({
      id: `citation-${item.field}`,
      label: `Citation stored for ${tenantFieldLabel(item.field)}`,
      description: sourceCaption(item.source) ?? "Source citation stored.",
      tone: "primary",
    }));
}

function tenantEvidenceHistoryRows(
  reviewedChanges: TenantReviewedChangeRecord[],
  enrichmentHistory: TenantEnrichmentHistoryEntry[],
  citations: Array<{ field: string; source: TenantEvidenceSource }>,
  documents: Array<{
    id: string;
    filename: string;
    category: DocumentCategory;
    tenant_onboarding_id: string | null;
    created_at: string;
    metadata: Record<string, unknown>;
  }>,
  intakeByDocumentId: Map<string, DocumentIntakeRecord>,
) {
  const datedRows = [
    ...reviewedChangeHistoryRows(reviewedChanges),
    ...enrichmentHistoryRows(enrichmentHistory),
    ...documentHistoryRows(documents, intakeByDocumentId),
  ]
    .sort(
      (a, b) =>
        timestamp(String(b.occurredAt ?? "")) -
        timestamp(String(a.occurredAt ?? "")),
    )
    .slice(0, 10);

  return [...datedRows, ...citationHistoryRows(citations, enrichmentHistory)];
}

function TenantDetail() {
  const params = useParams<{ tenantId: string }>();
  const router = useRouter();
  const tenantId = params.tenantId;
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<TenantForm | null>(null);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const documentFileInputRef = useRef<HTMLInputElement>(null);
  const [documentCategory, setDocumentCategory] =
    useState<DocumentCategory>("insurance");
  const [documentNotes, setDocumentNotes] = useState("");
  const [reviewNotesById, setReviewNotesById] = useState<
    Record<string, string>
  >({});
  const [leaseQuestionAnswersById, setLeaseQuestionAnswersById] = useState<
    Record<string, string>
  >({});
  const [enrichmentSuggestions, setEnrichmentSuggestions] = useState<
    EnrichmentSuggestion[]
  >([]);
  const [freshLinkNotice, setFreshLinkNotice] = useState<string | null>(null);
  const [portalInviteNotice, setPortalInviteNotice] = useState<string | null>(
    null,
  );

  const tenantQuery = useQuery({
    queryKey: ["tenant", tenantId],
    queryFn: () => getTenant(tenantId),
    enabled: Boolean(tenantId),
  });

  const tenantDetailQuery = useQuery({
    queryKey: ["tenant-detail", tenantId],
    queryFn: () => getTenantDetail(tenantId),
    enabled: Boolean(tenantId),
  });

  const portalAccountsQuery = useQuery({
    queryKey: ["tenant-portal-accounts", tenantId],
    queryFn: () => listTenantPortalAccounts(tenantId),
    enabled: Boolean(tenantId),
  });

  const leasesQuery = useQuery({
    queryKey: ["tenant-leases", tenantId],
    queryFn: () => listLeasesByTenant(tenantId),
    enabled: Boolean(tenantId),
  });

  const onboardingQuery = useQuery({
    queryKey: ["tenant-onboardings", tenantQuery.data?.entity_id],
    queryFn: () => listTenantOnboardings(tenantQuery.data!.entity_id),
    enabled: Boolean(tenantQuery.data?.entity_id),
  });

  const tenant = tenantQuery.data;
  const tenantDetail = tenantDetailQuery.data;
  const tenantLeaseContexts = tenantDetail?.leases ?? [];
  // A tenant is "residential" if any of their leases is on a residential
  // property. Residential leases don't carry ABN or trading-name in the
  // way commercial business tenants do — we hide those fields on the
  // edit form to keep it focused. Defaults to false until the detail
  // query resolves, so the commercial-style form renders by default.
  const tenantIsResidential = tenantLeaseContexts.some(
    (context) => context.property_type === "residential",
  );

  const documentsQuery = useQuery({
    queryKey: ["tenant-documents", tenant?.entity_id, tenantId],
    queryFn: () =>
      listDocuments({
        entity_id: tenant!.entity_id,
        tenant_id: tenantId,
      }),
    enabled: Boolean(tenant?.entity_id && tenantId),
  });

  const documentIntakesQuery = useQuery({
    queryKey: ["tenant-document-intakes", tenant?.entity_id],
    queryFn: () => listDocumentIntakes(tenant!.entity_id),
    enabled: Boolean(tenant?.entity_id),
  });

  const intakeByDocumentId = useMemo(
    () =>
      new Map(
        (documentIntakesQuery.data ?? []).map((intake) => [
          intake.document_id,
          intake,
        ]),
      ),
    [documentIntakesQuery.data],
  );

  const tenantDocuments = documentsQuery.data ?? [];
  const tenantReviewedChanges = tenantDetail?.reviewed_changes ?? [];
  const pendingContactRequests = tenantReviewedChanges.filter(
    (entry) =>
      entry.source === "tenant_portal_contact_request" &&
      entry.status === "submitted" &&
      entry.source_id,
  );
  const tenantEnrichmentHistoryRows = tenantEnrichmentHistory(tenant);
  const tenantSourceCitationRows = tenantSourceCitations(tenant);
  const latestTenantEvidence = latestEvidenceChangeSet(
    tenantReviewedChanges,
    tenantEnrichmentHistoryRows,
  );
  const firstTenantCitation = tenantSourceCitationRows[0]?.source;
  const latestTenantDocumentSource = documentEvidenceSource(tenantDocuments);
  const tenantEvidenceHistory = tenantEvidenceHistoryRows(
    tenantReviewedChanges,
    tenantEnrichmentHistoryRows,
    tenantSourceCitationRows,
    tenantDocuments,
    intakeByDocumentId,
  );

  const tenantOnboardings = (onboardingQuery.data ?? [])
    .filter((item) => item.tenant_id === tenantId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const portalAccounts = portalAccountsQuery.data ?? [];
  const latestSentOnboarding = tenantOnboardings.find(
    (item) => item.status === "sent",
  );
  const latestSentOnboardingExpired = isExpiredDateTime(
    latestSentOnboarding?.expires_at,
  );
  const hasActivePortalAccount = portalAccounts.some(
    (account) => account.status === "active",
  );
  const linkedLeases = tenantLeaseContexts.length
    ? tenantLeaseContexts
    : (leasesQuery.data ?? []).map((lease) => ({
        lease_id: lease.id,
        status: lease.status,
        property_name: "Property context pending",
        property_address: null,
        unit_label: "Unit context pending",
        commencement_date: lease.commencement_date,
        expiry_date: lease.expiry_date,
        annual_rent_cents: lease.annual_rent_cents,
      }));

  const updateMutation = useMutation({
    mutationFn: (values: TenantForm) => {
      const payload: Partial<TenantPayload> = {
        legal_name: values.legal_name.trim(),
        trading_name: cleanText(values.trading_name),
        abn: cleanText(values.abn),
        contact_name: cleanText(values.contact_name),
        contact_email: cleanText(values.contact_email),
        contact_phone: cleanText(values.contact_phone),
        billing_email: cleanText(values.billing_email),
        notes: cleanText(values.notes),
      };
      return updateTenant(tenantId, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-detail", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      setEditing(false);
    },
  });

  const applyContactRequestMutation = useMutation({
    mutationFn: (requestId: string) =>
      applyTenantContactChangeRequest(tenantId, requestId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-detail", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
    },
  });
  const dismissContactRequestMutation = useMutation({
    mutationFn: (requestId: string) =>
      dismissTenantContactChangeRequest(tenantId, requestId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-detail", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
    },
  });

  const revokePortalAccountMutation = useMutation({
    mutationFn: (accountId: string) =>
      revokeTenantPortalAccount(tenantId, accountId, {
        reason: "Operator revoked access from the tenant profile.",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["tenant-portal-accounts", tenantId],
      });
      queryClient.invalidateQueries({ queryKey: ["tenant-detail", tenantId] });
    },
  });

  const restorePortalAccountMutation = useMutation({
    mutationFn: (accountId: string) =>
      restoreTenantPortalAccount(tenantId, accountId, {
        reason: "Operator restored access from the tenant profile.",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["tenant-portal-accounts", tenantId],
      });
      queryClient.invalidateQueries({ queryKey: ["tenant-detail", tenantId] });
    },
  });

  const unlinkPortalAccountMutation = useMutation({
    mutationFn: (accountId: string) =>
      unlinkTenantPortalAccount(tenantId, accountId, {
        reason: "Operator unlinked access so the tenant can reconnect.",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["tenant-portal-accounts", tenantId],
      });
      queryClient.invalidateQueries({ queryKey: ["tenant-detail", tenantId] });
    },
  });

  const createOnboardingMutation = useMutation({
    mutationFn: (leaseId: string) =>
      createTenantOnboarding({
        lease_id: leaseId,
        due_date: dateOnly(new Date(Date.now() + 7 * 86_400_000)),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["tenant-onboardings", tenant?.entity_id],
      });
    },
  });

  const cancelOnboardingMutation = useMutation({
    mutationFn: cancelTenantOnboarding,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["tenant-onboardings", tenant?.entity_id],
      });
    },
  });

  const resendOnboardingMutation = useMutation({
    mutationFn: resendTenantOnboarding,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["tenant-onboardings", tenant?.entity_id],
      });
    },
  });

  const sendPortalInviteMutation = useMutation({
    mutationFn: sendTenantOnboardingPortalInvite,
    onSuccess: (updated) => {
      queryClient.invalidateQueries({
        queryKey: ["tenant-onboardings", tenant?.entity_id],
      });
      setFreshLinkNotice(null);
      setPortalInviteNotice(
        `Portal invite sent. Link expires ${formatDate(updated.expires_at)}.`,
      );
    },
  });

  const freshLinkMutation = useMutation({
    mutationFn: ({
      onboardingId,
      reason,
    }: {
      onboardingId: string;
      reason: string;
    }) =>
      refreshTenantOnboardingLink(onboardingId, {
        reason,
        expires_in_days: 14,
      }),
    onSuccess: async (updated) => {
      queryClient.invalidateQueries({
        queryKey: ["tenant-onboardings", tenant?.entity_id],
      });
      setPortalInviteNotice(null);
      setFreshLinkNotice(
        `Fresh portal link copied. Expires ${formatDate(updated.expires_at)}.`,
      );
      if (typeof navigator !== "undefined") {
        await navigator.clipboard
          .writeText(updated.portal_url)
          .catch(() => undefined);
      }
    },
  });

  const reviewOnboardingMutation = useMutation({
    mutationFn: (onboardingId: string) =>
      reviewTenantOnboarding(onboardingId, {
        approved: true,
        notes: cleanText(reviewNotesById[onboardingId] ?? ""),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["tenant-onboardings", tenant?.entity_id],
      });
    },
  });

  const approveAndApplyOnboardingMutation = useMutation({
    mutationFn: async (onboardingId: string) => {
      await reviewTenantOnboarding(onboardingId, {
        approved: true,
        notes: cleanText(reviewNotesById[onboardingId] ?? ""),
      });
      return applyTenantOnboarding(onboardingId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["tenant-onboardings", tenant?.entity_id],
      });
      queryClient.invalidateQueries({ queryKey: ["tenant", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-detail", tenantId] });
    },
  });

  const respondLeaseQuestionMutation = useMutation({
    mutationFn: ({
      onboardingId,
      questionId,
      status,
    }: {
      onboardingId: string;
      questionId: string;
      status: Exclude<TenantLeaseQuestionRecord["status"], "open">;
    }) =>
      respondTenantLeaseQuestion(onboardingId, questionId, {
        status,
        answer: cleanText(leaseQuestionAnswersById[questionId] ?? ""),
      }),
    onSuccess: (_updated, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["tenant-onboardings", tenant?.entity_id],
      });
      setLeaseQuestionAnswersById((current) => ({
        ...current,
        [variables.questionId]: "",
      }));
    },
  });

  const applyOnboardingMutation = useMutation({
    mutationFn: applyTenantOnboarding,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["tenant-onboardings", tenant?.entity_id],
      });
      queryClient.invalidateQueries({ queryKey: ["tenant", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-detail", tenantId] });
    },
  });

  const uploadDocumentMutation = useMutation({
    mutationFn: () => {
      if (!tenant || !documentFile) {
        throw new Error("Choose a document first.");
      }
      return uploadDocument({
        entityId: tenant.entity_id,
        tenantId,
        category: documentCategory,
        notes: documentNotes,
        file: documentFile,
      });
    },
    onSuccess: () => {
      setDocumentFile(null);
      setDocumentNotes("");
      queryClient.invalidateQueries({
        queryKey: ["tenant-documents", tenant?.entity_id, tenantId],
      });
    },
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: deleteDocument,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["tenant-documents", tenant?.entity_id, tenantId],
      });
    },
  });

  const deleteTenantMutation = useMutation({
    mutationFn: () => deleteTenant(tenantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      queryClient.invalidateQueries({ queryKey: ["tenant", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-detail", tenantId] });
      router.push("/tenants");
    },
  });

  const prepareReviewMutation = useMutation({
    mutationFn: createDocumentIntakeFromDocument,
    onSuccess: (intake) => {
      router.push(`/intake?review=${intake.id}`);
    },
  });

  const previewEnrichmentMutation = useMutation({
    mutationFn: () =>
      previewPublicEnrichment({
        target_type: "tenant",
        target_id: tenantId,
      }),
    onSuccess: (result) => {
      setEnrichmentSuggestions(result.suggestions);
    },
  });

  const applyEnrichmentMutation = useMutation({
    mutationFn: () =>
      applyPublicEnrichment({
        target_type: "tenant",
        target_id: tenantId,
        suggestions: enrichmentSuggestions,
      }),
    onSuccess: () => {
      setEnrichmentSuggestions([]);
      queryClient.invalidateQueries({ queryKey: ["tenant", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-detail", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
    },
  });

  function startEdit() {
    if (!tenant) {
      return;
    }
    setForm(formFromTenant(tenant));
    setEditing(true);
  }

  function updateField(field: keyof TenantForm, value: string) {
    setForm((current) => (current ? { ...current, [field]: value } : current));
  }

  function submitForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form?.legal_name.trim()) {
      return;
    }
    updateMutation.mutate(form);
  }

  function submitDocument(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    uploadDocumentMutation.mutate();
  }

  if (tenantQuery.isLoading) {
    return (
      <main className="min-h-screen">
        <AppHeader />
        <div className="mx-auto max-w-7xl px-5 py-5">
          <SectionPanel>
            <SkeletonRows rows={5} />
          </SectionPanel>
        </div>
      </main>
    );
  }

  if (!tenant) {
    return (
      <main className="min-h-screen">
        <AppHeader />
        <div className="mx-auto max-w-7xl px-5 py-5">
          <SectionPanel>
            <EmptyState
              icon={<AlertTriangle size={18} />}
              title="Tenant not found"
              action={
                <Link href="/tenants">
                  <SecondaryButton type="button">
                    Back to tenants
                  </SecondaryButton>
                </Link>
              }
            />
          </SectionPanel>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <AppHeader />

      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-5">
        <section className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link
              href="/tenants"
              className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft size={14} />
              Tenants
            </Link>
            <h2 className="text-xl font-semibold">{tenantName(tenant)}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Contact, billing, onboarding, documents, and lease history.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SecondaryButton type="button" onClick={startEdit}>
              <Edit3 size={15} />
              Edit profile
            </SecondaryButton>
            <SecondaryButton
              type="button"
              onClick={() => {
                const activeLeases = linkedLeases.filter(
                  (lease) =>
                    lease.status === "active" ||
                    lease.status === "holding_over",
                ).length;
                const warning =
                  activeLeases > 0
                    ? `\n\n${activeLeases} active lease${
                        activeLeases === 1 ? "" : "s"
                      } will stay on file but lose their tenant link.`
                    : "";
                if (
                  typeof window === "undefined" ||
                  window.confirm(
                    `Delete ${tenantName(tenant)}? This soft-deletes the tenant and can be restored from the database if needed.${warning}`,
                  )
                ) {
                  deleteTenantMutation.mutate();
                }
              }}
              disabled={deleteTenantMutation.isPending}
              className="text-danger hover:bg-danger/5"
              aria-label="Delete tenant"
            >
              {deleteTenantMutation.isPending ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Trash2 size={15} />
              )}
              Delete tenant
            </SecondaryButton>
          </div>
        </section>
        {deleteTenantMutation.error ? (
          <p className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
            {friendlyError(deleteTenantMutation.error)}
          </p>
        ) : null}

        {editing && form ? (
          <SectionPanel
            title="Edit tenant profile"
            description="Keep admin changes focused, then return to the profile."
            actions={
              <SecondaryButton
                type="button"
                onClick={() => setEditing(false)}
                className="h-8 w-8 px-0"
                aria-label="Close edit"
              >
                <X size={15} />
              </SecondaryButton>
            }
          >
            <form
              className="grid gap-3 p-4 md:grid-cols-2"
              onSubmit={submitForm}
            >
              <Field label="Legal name">
                <Input
                  value={form.legal_name}
                  onChange={(event) =>
                    updateField("legal_name", event.target.value)
                  }
                />
              </Field>
              {tenantIsResidential ? null : (
                <>
                  <Field label="Trading as">
                    <Input
                      value={form.trading_name}
                      onChange={(event) =>
                        updateField("trading_name", event.target.value)
                      }
                    />
                  </Field>
                  <Field label="ABN">
                    <Input
                      value={form.abn}
                      onChange={(event) => updateField("abn", event.target.value)}
                    />
                  </Field>
                </>
              )}
              <Field label="Contact">
                <Input
                  value={form.contact_name}
                  onChange={(event) =>
                    updateField("contact_name", event.target.value)
                  }
                />
              </Field>
              <Field label="Contact email">
                <Input
                  type="email"
                  value={form.contact_email}
                  onChange={(event) =>
                    updateField("contact_email", event.target.value)
                  }
                />
              </Field>
              <Field label="Billing email">
                <Input
                  type="email"
                  value={form.billing_email}
                  onChange={(event) =>
                    updateField("billing_email", event.target.value)
                  }
                />
              </Field>
              <Field label="Phone">
                <Input
                  value={form.contact_phone}
                  onChange={(event) =>
                    updateField("contact_phone", event.target.value)
                  }
                />
              </Field>
              <Field label="Notes">
                <Input
                  value={form.notes}
                  onChange={(event) => updateField("notes", event.target.value)}
                />
              </Field>
              <div className="md:col-span-2">
                <Button
                  type="submit"
                  disabled={!form.legal_name.trim() || updateMutation.isPending}
                >
                  <Save size={16} />
                  Save profile
                </Button>
                {updateMutation.error ? (
                  <p className="mt-2 text-sm text-danger">
                    {friendlyError(updateMutation.error)}
                  </p>
                ) : null}
              </div>
            </form>
          </SectionPanel>
        ) : null}

        <section className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <div className="grid gap-5">
            <SectionPanel title="Profile" icon={<UserRound size={17} />}>
              <dl className="grid gap-3 p-4 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Legal name</dt>
                  <dd className="font-medium">{tenant.legal_name}</dd>
                </div>
                {tenantIsResidential ? null : (
                  <>
                    <div>
                      <dt className="text-xs text-muted-foreground">Trading as</dt>
                      <dd>{tenant.trading_name ?? "-"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">ABN</dt>
                      <dd>{tenant.abn ?? "-"}</dd>
                    </div>
                  </>
                )}
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Primary contact
                  </dt>
                  <dd>{tenant.contact_name ?? "-"}</dd>
                  <dd className="text-muted-foreground">
                    {tenant.contact_email ?? tenant.contact_phone ?? "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Billing email
                  </dt>
                  <dd>{tenant.billing_email ?? tenant.contact_email ?? "-"}</dd>
                </div>
              </dl>
            </SectionPanel>

            {pendingContactRequests.length ? (
              <SectionPanel
                title="Tenant requests"
                icon={<MessageSquare size={17} />}
              >
                <div className="grid gap-3 p-4 text-sm">
                  {pendingContactRequests.map((request) => (
                    <div
                      key={request.source_id ?? request.occurred_at}
                      className="grid gap-3 rounded-md border border-warning/30 bg-warning/5 p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="font-medium">
                            Contact change requested
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Submitted {formatDateTime(request.occurred_at)}
                          </div>
                        </div>
                        <StatusBadge tone="warning">Review</StatusBadge>
                      </div>
                      <div className="grid gap-2">
                        {request.changes.map((change) => (
                          <div
                            key={change.field}
                            className="grid gap-1 rounded-md border border-border bg-white px-3 py-2"
                          >
                            <div className="text-xs font-semibold text-muted-foreground">
                              {change.label}
                            </div>
                            <div className="grid gap-1 text-xs">
                              <span className="text-muted-foreground">
                                Current: {String(change.before ?? "-")}
                              </span>
                              <span className="font-medium">
                                Requested: {String(change.after ?? "-")}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                      {request.notes ? (
                        <p className="text-xs text-muted-foreground">
                          {request.notes}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {applyContactRequestMutation.error ? (
                          <span className="text-sm text-danger">
                            {friendlyError(applyContactRequestMutation.error)}
                          </span>
                        ) : null}
                        {dismissContactRequestMutation.error ? (
                          <span className="text-sm text-danger">
                            {friendlyError(dismissContactRequestMutation.error)}
                          </span>
                        ) : null}
                        <SecondaryButton
                          type="button"
                          disabled={
                            !request.source_id ||
                            dismissContactRequestMutation.isPending ||
                            applyContactRequestMutation.isPending
                          }
                          onClick={() => {
                            if (request.source_id) {
                              dismissContactRequestMutation.mutate(
                                request.source_id,
                              );
                            }
                          }}
                        >
                          {dismissContactRequestMutation.isPending ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <X size={15} />
                          )}
                          Dismiss
                        </SecondaryButton>
                        <Button
                          type="button"
                          disabled={
                            !request.source_id ||
                            applyContactRequestMutation.isPending ||
                            dismissContactRequestMutation.isPending
                          }
                          onClick={() => {
                            if (request.source_id) {
                              applyContactRequestMutation.mutate(
                                request.source_id,
                              );
                            }
                          }}
                        >
                          {applyContactRequestMutation.isPending ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <Check size={16} />
                          )}
                          Apply request
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </SectionPanel>
            ) : null}

            <SectionPanel
              title="Portal access"
              icon={<ShieldCheck size={17} />}
            >
              <div className="grid gap-3 p-4 text-sm">
                {hasActivePortalAccount &&
                latestSentOnboarding &&
                !latestSentOnboardingExpired ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/20 bg-primary/5 p-3">
                    <div className="min-w-0">
                      <div className="font-medium">
                        Invite another portal login
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        For a co-tenant or second contact. Existing logins stay
                        linked.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        onClick={() =>
                          sendPortalInviteMutation.mutate(
                            latestSentOnboarding.id,
                          )
                        }
                        disabled={sendPortalInviteMutation.isPending}
                      >
                        <Send size={16} />
                        Send invite
                      </Button>
                      <SecondaryButton
                        type="button"
                        onClick={() =>
                          freshLinkMutation.mutate({
                            onboardingId: latestSentOnboarding.id,
                            reason:
                              "Operator copied a fresh co-tenant portal link from the tenant profile.",
                          })
                        }
                        disabled={freshLinkMutation.isPending}
                      >
                        <ClipboardCopy size={15} />
                        Copy link
                      </SecondaryButton>
                    </div>
                  </div>
                ) : null}
                {portalAccounts.map((account) => {
                  const accountOnboarding =
                    tenantOnboardings.find(
                      (item) => item.id === account.tenant_onboarding_id,
                    ) ?? latestSentOnboarding;
                  return (
                    <div
                      key={account.id}
                      className="grid gap-3 rounded-md border border-border bg-white p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">
                              {account.email ?? "Tenant login"}
                            </span>
                            <StatusBadge
                              tone={portalAccountTone(account.status)}
                            >
                              {portalAccountLabel(account.status)}
                            </StatusBadge>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {portalAccountDetail(account)}
                          </div>
                          {portalAccountRecoveryDetail(account) ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              Recovery receipt:{" "}
                              {portalAccountRecoveryDetail(account)}
                            </div>
                          ) : null}
                          <div className="mt-1 truncate text-xs text-muted-foreground">
                            {account.auth_provider} account{" "}
                            {account.auth_provider_id}
                          </div>
                        </div>
                        {account.status === "active" ? (
                          <div className="flex shrink-0 flex-wrap gap-2">
                            <SecondaryButton
                              type="button"
                              className="h-8"
                              onClick={() =>
                                unlinkPortalAccountMutation.mutate(account.id)
                              }
                              disabled={unlinkPortalAccountMutation.isPending}
                            >
                              <Link2 size={15} />
                              Unlink
                            </SecondaryButton>
                            <SecondaryButton
                              type="button"
                              className="h-8 border-danger/30 text-danger hover:bg-danger/5"
                              onClick={() =>
                                revokePortalAccountMutation.mutate(account.id)
                              }
                              disabled={revokePortalAccountMutation.isPending}
                            >
                              <X size={15} />
                              Revoke
                            </SecondaryButton>
                          </div>
                        ) : account.status === "revoked" ? (
                          <div className="flex shrink-0 flex-wrap gap-2">
                            <SecondaryButton
                              type="button"
                              className="h-8"
                              onClick={() =>
                                restorePortalAccountMutation.mutate(account.id)
                              }
                              disabled={restorePortalAccountMutation.isPending}
                            >
                              <Check size={15} />
                              Restore
                            </SecondaryButton>
                          </div>
                        ) : account.status === "unlinked" &&
                          accountOnboarding?.status === "sent" ? (
                          <div className="flex shrink-0 flex-wrap gap-2">
                            <SecondaryButton
                              type="button"
                              className="h-8"
                              onClick={() =>
                                freshLinkMutation.mutate({
                                  onboardingId: accountOnboarding.id,
                                  reason:
                                    "Operator sent a fresh portal link from the tenant profile.",
                                })
                              }
                              disabled={freshLinkMutation.isPending}
                            >
                              <RefreshCw size={15} />
                              Fresh link
                            </SecondaryButton>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                {freshLinkNotice ? (
                  <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs font-medium text-primary">
                    {freshLinkNotice}
                  </div>
                ) : null}
                {portalInviteNotice ? (
                  <div className="rounded-md border border-success/20 bg-success/5 px-3 py-2 text-xs font-medium text-success">
                    {portalInviteNotice}
                  </div>
                ) : null}
                {!portalAccountsQuery.isLoading &&
                portalAccounts.length === 0 ? (
                  <EmptyState
                    icon={<KeyRound size={18} />}
                    title="No tenant login linked"
                    description="The tenant can connect a login from an active onboarding or portal link."
                    action={
                      latestSentOnboarding ? (
                        <SecondaryButton
                          type="button"
                          onClick={() =>
                            freshLinkMutation.mutate({
                              onboardingId: latestSentOnboarding.id,
                              reason:
                                "Operator sent a fresh portal link from the tenant profile.",
                            })
                          }
                          disabled={freshLinkMutation.isPending}
                        >
                          <RefreshCw size={15} />
                          Send fresh link
                        </SecondaryButton>
                      ) : null
                    }
                  />
                ) : null}
                {portalAccountsQuery.error ||
                revokePortalAccountMutation.error ||
                restorePortalAccountMutation.error ||
                unlinkPortalAccountMutation.error ||
                sendPortalInviteMutation.error ||
                freshLinkMutation.error ? (
                  <p className="text-sm text-danger">
                    {friendlyError(
                      portalAccountsQuery.error ??
                        revokePortalAccountMutation.error ??
                        restorePortalAccountMutation.error ??
                        unlinkPortalAccountMutation.error ??
                        sendPortalInviteMutation.error ??
                        freshLinkMutation.error,
                    )}
                  </p>
                ) : null}
              </div>
            </SectionPanel>

            <SectionPanel
              title="Public facts"
              icon={<Sparkles size={17} />}
              actions={
                <SecondaryButton
                  type="button"
                  className="h-8"
                  onClick={() => previewEnrichmentMutation.mutate()}
                  disabled={previewEnrichmentMutation.isPending}
                >
                  {previewEnrichmentMutation.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Sparkles size={14} />
                  )}
                  Suggest
                </SecondaryButton>
              }
            >
              <div className="grid gap-3 p-4 text-sm">
                {enrichmentSuggestions.length ? (
                  <>
                    <div className="grid gap-2">
                      {enrichmentSuggestions.map((suggestion) => (
                        <div
                          key={`${suggestion.field}-${suggestion.value}`}
                          className="rounded-md border border-border bg-white p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className="text-xs text-muted-foreground">
                                {suggestion.label}
                              </div>
                              <div className="font-medium">
                                {suggestion.value}
                              </div>
                            </div>
                            <StatusBadge tone="primary">
                              {confidenceLabel(suggestion.confidence)}
                            </StatusBadge>
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">
                            {suggestion.source.source_hint} -{" "}
                            {suggestion.source.citation}
                          </div>
                        </div>
                      ))}
                    </div>
                    <Button
                      type="button"
                      onClick={() => applyEnrichmentMutation.mutate()}
                      disabled={applyEnrichmentMutation.isPending}
                    >
                      {applyEnrichmentMutation.isPending ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Check size={16} />
                      )}
                      Apply reviewed facts
                    </Button>
                  </>
                ) : (
                  <div className="text-muted-foreground">
                    Missing public fields like ABN or registered address can be
                    suggested with citations before applying.
                  </div>
                )}
                {previewEnrichmentMutation.error ||
                applyEnrichmentMutation.error ? (
                  <p className="text-sm text-danger">
                    {friendlyError(
                      previewEnrichmentMutation.error ??
                        applyEnrichmentMutation.error,
                    )}
                  </p>
                ) : null}
              </div>
            </SectionPanel>

            <SectionPanel title="Documents" icon={<FileText size={17} />}>
              <form
                className="grid gap-3 border-b border-border p-4"
                onSubmit={submitDocument}
              >
                <label className="grid min-h-28 cursor-pointer place-items-center rounded-md border border-dashed border-border bg-muted/40 px-4 py-5 text-center transition hover:border-primary hover:bg-primary/5">
                  <input
                    ref={documentFileInputRef}
                    type="file"
                    className="sr-only"
                    onChange={(event) =>
                      setDocumentFile(event.target.files?.[0] ?? null)
                    }
                  />
                  <span className="grid justify-items-center gap-2">
                    <UploadCloud size={22} className="text-primary" />
                    <span className="text-sm font-semibold">
                      {documentFile
                        ? documentFile.name
                        : "Drop in a tenant document"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      PDF, image, Word, or text file up to 15 MB
                    </span>
                  </span>
                </label>
                <div className="grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
                  <Field label="Type">
                    <Select
                      value={documentCategory}
                      onChange={(event) =>
                        setDocumentCategory(
                          event.target.value as DocumentCategory,
                        )
                      }
                    >
                      {documentCategories.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Notes">
                    <Input
                      value={documentNotes}
                      onChange={(event) => setDocumentNotes(event.target.value)}
                      placeholder="Optional"
                    />
                  </Field>
                </div>
                <Button
                  type="submit"
                  disabled={!documentFile || uploadDocumentMutation.isPending}
                >
                  <UploadCloud size={16} />
                  Upload document
                </Button>
                {uploadDocumentMutation.error ? (
                  <p className="text-sm text-danger">
                    {friendlyError(uploadDocumentMutation.error)}
                  </p>
                ) : null}
              </form>

              <div className="divide-y divide-border">
                {(documentsQuery.data ?? []).map((document) => {
                  const intake = intakeByDocumentId.get(document.id);
                  return (
                    <div key={document.id} className="grid gap-3 p-4 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="truncate font-medium">
                              {document.filename}
                            </div>
                            <StatusBadge tone={intakeStatusTone(intake)}>
                              {intakeStatusLabel(intake)}
                            </StatusBadge>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span>
                              {documentCategoryLabel(document.category)}
                            </span>
                            <span>{formatBytes(document.byte_size)}</span>
                            <span>{formatDate(document.created_at)}</span>
                            <span>Source: {documentSourceLabel(document)}</span>
                            {intake?.document_type ? (
                              <span>
                                {documentTypeLabel(intake.document_type)}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">
                            {intakeProvenanceNote(intake, document.metadata)}
                          </div>
                          {document.notes ? (
                            <div className="mt-2 text-xs text-muted-foreground">
                              {document.notes}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 gap-2">
                          {intake ? (
                            <Link
                              href={`/intake?review=${intake.id}`}
                              className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-medium transition hover:bg-muted"
                            >
                              <Sparkles size={15} />
                              Open review
                            </Link>
                          ) : (
                            <SecondaryButton
                              type="button"
                              className="h-8"
                              onClick={() =>
                                prepareReviewMutation.mutate(document.id)
                              }
                              disabled={prepareReviewMutation.isPending}
                            >
                              <Sparkles size={15} />
                              Send to review
                            </SecondaryButton>
                          )}
                          <a
                            className={cn(
                              "inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-white transition hover:bg-muted",
                            )}
                            href={documentDownloadUrl(document.id)}
                            aria-label={`Download ${document.filename}`}
                          >
                            <Download size={15} />
                          </a>
                          <SecondaryButton
                            type="button"
                            className="h-8 w-8 px-0"
                            onClick={() =>
                              deleteDocumentMutation.mutate(document.id)
                            }
                            aria-label={`Delete ${document.filename}`}
                          >
                            <Trash2 size={15} />
                          </SecondaryButton>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {!documentsQuery.isLoading &&
                (documentsQuery.data ?? []).length === 0 ? (
                  <EmptyState
                    icon={<FileText size={18} />}
                    title="No tenant documents yet"
                    description="Upload leases, insurance certificates, guarantees, onboarding files, or tenant correspondence. Nothing updates the tenant profile until reviewed."
                    action={
                      <div className="flex flex-wrap justify-center gap-2">
                        <Button
                          type="button"
                          onClick={() => documentFileInputRef.current?.click()}
                        >
                          <UploadCloud size={16} />
                          Upload document
                        </Button>
                        <Link
                          href="/intake"
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
                        >
                          <Sparkles size={15} />
                          Open Smart Intake
                        </Link>
                      </div>
                    }
                  />
                ) : null}
              </div>
            </SectionPanel>
          </div>

          <div className="grid gap-5">
            <SectionPanel
              title="Onboarding workflow"
              icon={<ShieldCheck size={17} />}
            >
              <div className="divide-y divide-border">
                {tenantOnboardings.map((item) => {
                  const onboardingDocuments = (
                    documentsQuery.data ?? []
                  ).filter(
                    (document) => document.tenant_onboarding_id === item.id,
                  );
                  const submittedData = item.submitted_data ?? {};
                  const linkExpired = isExpiredDateTime(item.expires_at);
                  const leaseAgreement = leaseAgreementFromDelivery(
                    item.delivery_data,
                  );
                  const applyBlocked =
                    leaseAgreementBlocksApply(leaseAgreement);
                  const applyBlockReason =
                    leaseAgreementApplyReason(leaseAgreement);
                  const hasBlockingLeaseQuestions =
                    (leaseAgreement?.open_question_count ?? 0) > 0;
                  const submittedActionLabel = applyBlocked
                    ? hasBlockingLeaseQuestions
                      ? "Mark reviewed"
                      : "Approve for signing"
                    : "Approve & apply";
                  const submittedActionIcon = applyBlocked ? (
                    <Check size={16} />
                  ) : (
                    <Save size={16} />
                  );
                  const onboardingActionPending =
                    reviewOnboardingMutation.isPending ||
                    approveAndApplyOnboardingMutation.isPending ||
                    applyOnboardingMutation.isPending;
                  const onboardingActionError =
                    reviewOnboardingMutation.error ??
                    approveAndApplyOnboardingMutation.error ??
                    applyOnboardingMutation.error;
                  const providerDetail = (
                    <>
                      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-4">
                        <div>Last sent {formatDate(item.last_sent_at)}</div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span>Delivery</span>
                          <StatusBadge
                            tone={onboardingDeliveryTone(item.delivery_data)}
                          >
                            {onboardingDeliveryLabel(item.delivery_data)}
                          </StatusBadge>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span>Reminders</span>
                          <StatusBadge
                            tone={onboardingReminderTone(item.delivery_data)}
                          >
                            {onboardingReminderLabel(item.delivery_data)}
                          </StatusBadge>
                        </div>
                        <div>Expires {formatDate(item.expires_at)}</div>
                        <div>Applied {formatDate(item.applied_at)}</div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {onboardingDeliveryDetail(item.delivery_data)}
                      </div>
                      {onboardingReminderSteps(item.delivery_data).length ? (
                        <div className="grid gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
                          <div className="flex items-center gap-2 font-semibold">
                            <Clock3 size={14} />
                            Reminder schedule
                          </div>
                          <div className="grid gap-2 sm:grid-cols-3">
                            {onboardingReminderSteps(item.delivery_data).map(
                              (step) => (
                                <div
                                  key={step.key ?? step.label}
                                  className="rounded border border-border bg-white px-3 py-2"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium">
                                      {step.label ?? "Reminder"}
                                    </span>
                                    <StatusBadge
                                      tone={reminderStepTone(step.status)}
                                    >
                                      {reminderStepLabel(step.status)}
                                    </StatusBadge>
                                  </div>
                                  <div className="mt-1 text-muted-foreground">
                                    {step.sent_at
                                      ? `Sent ${formatDateTime(step.sent_at)}`
                                      : `If incomplete after ${step.after_days ?? "-"} days`}
                                  </div>
                                </div>
                              ),
                            )}
                          </div>
                          {item.delivery_data.reminders?.paused ? (
                            <div className="text-muted-foreground">
                              Reminder paused until contact is fixed.
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {(item.delivery_data.receipts ?? []).length ? (
                        <div className="grid gap-2 rounded-md border border-border bg-white p-3 text-xs">
                          <div className="font-semibold">Delivery timeline</div>
                          {(item.delivery_data.receipts ?? [])
                            .slice(0, 3)
                            .map((receipt, index) => (
                              <div
                                key={`${String(receipt.channel)}-${String(receipt.received_at)}-${index}`}
                                className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground"
                              >
                                <span className="capitalize">
                                  {String(receipt.channel ?? "message")}{" "}
                                  {String(
                                    receipt.status ?? "updated",
                                  ).replaceAll("_", " ")}
                                </span>
                                <span>
                                  {formatDateTime(
                                    String(receipt.received_at ?? ""),
                                  )}
                                </span>
                              </div>
                            ))}
                        </div>
                      ) : null}
                    </>
                  );
                  return (
                    <div key={item.id} className="grid gap-3 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <StatusBadge
                            tone={statusTone(item.status, item.due_date)}
                          >
                            {item.status.replaceAll("_", " ")}
                          </StatusBadge>
                          {linkExpired && item.status === "sent" ? (
                            <StatusBadge tone="warning">
                              Link expired
                            </StatusBadge>
                          ) : null}
                          <span
                            className={cn(
                              "text-sm text-muted-foreground",
                              dueRank(item.due_date) < 0 &&
                                "font-medium text-danger",
                            )}
                          >
                            Due {formatDate(item.due_date)}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {item.status === "sent" && !linkExpired ? (
                            <Button
                              type="button"
                              onClick={() =>
                                sendPortalInviteMutation.mutate(item.id)
                              }
                              disabled={sendPortalInviteMutation.isPending}
                            >
                              <Send size={16} />
                              Invite to portal
                            </Button>
                          ) : null}
                          {item.status === "sent" && !linkExpired ? (
                            <SecondaryButton
                              type="button"
                              onClick={() =>
                                navigator.clipboard.writeText(
                                  item.onboarding_url,
                                )
                              }
                            >
                              <ClipboardCopy size={15} />
                              Copy onboarding link
                            </SecondaryButton>
                          ) : null}
                          {item.status === "sent" && linkExpired ? (
                            <SecondaryButton
                              type="button"
                              onClick={() =>
                                freshLinkMutation.mutate({
                                  onboardingId: item.id,
                                  reason:
                                    "Operator renewed an expired onboarding link.",
                                })
                              }
                              disabled={freshLinkMutation.isPending}
                            >
                              <RefreshCw size={15} />
                              Fresh link
                            </SecondaryButton>
                          ) : null}
                          {onboardingNeedsContactFix(item.delivery_data) ? (
                            <SecondaryButton type="button" onClick={startEdit}>
                              <Edit3 size={15} />
                              Fix contact
                            </SecondaryButton>
                          ) : null}
                          {item.status === "sent" ? (
                            <SecondaryButton
                              type="button"
                              onClick={() =>
                                cancelOnboardingMutation.mutate(item.id)
                              }
                              disabled={cancelOnboardingMutation.isPending}
                            >
                              <X size={15} />
                              Cancel
                            </SecondaryButton>
                          ) : null}
                          {item.status === "sent" ? (
                            <SecondaryButton
                              type="button"
                              onClick={() =>
                                resendOnboardingMutation.mutate(item.id)
                              }
                              disabled={
                                resendOnboardingMutation.isPending ||
                                linkExpired
                              }
                            >
                              <Link2 size={15} />
                              Resend
                            </SecondaryButton>
                          ) : null}
                          {item.status === "submitted" ? (
                            <Button
                              type="button"
                              onClick={() => {
                                if (applyBlocked) {
                                  reviewOnboardingMutation.mutate(item.id);
                                  return;
                                }
                                approveAndApplyOnboardingMutation.mutate(
                                  item.id,
                                );
                              }}
                              disabled={onboardingActionPending}
                            >
                              {submittedActionIcon}
                              {submittedActionLabel}
                            </Button>
                          ) : null}
                          {item.status === "reviewed" ? (
                            <Button
                              type="button"
                              onClick={() =>
                                applyOnboardingMutation.mutate(item.id)
                              }
                              disabled={
                                applyOnboardingMutation.isPending ||
                                applyBlocked
                              }
                            >
                              <Save size={16} />
                              Apply
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      <details className="group md:hidden">
                        <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                          Provider detail
                          <ChevronDown
                            size={12}
                            className="transition group-open:rotate-180"
                          />
                        </summary>
                        <div className="mt-3 grid gap-3">{providerDetail}</div>
                      </details>
                      <div className="hidden gap-3 md:grid">
                        {providerDetail}
                      </div>
                      {leaseAgreement ? (
                        <div className="grid gap-3 rounded-md border border-border bg-muted/30 p-3 text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 font-semibold">
                              <MessageSquare size={14} />
                              Lease agreement
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {leaseAgreement.signed_at ? (
                                <span className="text-muted-foreground">
                                  Signed{" "}
                                  {formatDateTime(leaseAgreement.signed_at)}
                                </span>
                              ) : null}
                              <StatusBadge
                                tone={leaseAgreementTone(leaseAgreement)}
                              >
                                {leaseAgreementLabel(leaseAgreement)}
                              </StatusBadge>
                            </div>
                          </div>
                          {applyBlockReason ? (
                            <div className="text-muted-foreground">
                              {applyBlockReason}
                            </div>
                          ) : null}
                          <div className="grid gap-2">
                            {leaseAgreement.questions.map((question) => {
                              const answerDraft =
                                leaseQuestionAnswersById[question.id] ??
                                question.answer ??
                                "";
                              return (
                                <div
                                  key={question.id}
                                  className="grid gap-2 rounded border border-border bg-white px-3 py-2"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="font-medium">
                                      {question.clause_reference ||
                                        "Lease agreement"}
                                    </div>
                                    <StatusBadge
                                      tone={leaseQuestionTone(question.status)}
                                    >
                                      {leaseQuestionLabel(question.status)}
                                    </StatusBadge>
                                  </div>
                                  <div className="text-muted-foreground">
                                    {question.question}
                                  </div>
                                  {question.answered_at ? (
                                    <div className="text-muted-foreground">
                                      Answered{" "}
                                      {formatDateTime(question.answered_at)}
                                    </div>
                                  ) : null}
                                  <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                                    <Field label="Response">
                                      <Input
                                        value={answerDraft}
                                        placeholder="Answer the tenant's question"
                                        onChange={(event) =>
                                          setLeaseQuestionAnswersById(
                                            (current) => ({
                                              ...current,
                                              [question.id]: event.target.value,
                                            }),
                                          )
                                        }
                                      />
                                    </Field>
                                    <div className="flex flex-wrap gap-2">
                                      <SecondaryButton
                                        type="button"
                                        className="h-10"
                                        disabled={
                                          respondLeaseQuestionMutation.isPending ||
                                          !answerDraft.trim()
                                        }
                                        onClick={() =>
                                          respondLeaseQuestionMutation.mutate({
                                            onboardingId: item.id,
                                            questionId: question.id,
                                            status: "answered",
                                          })
                                        }
                                      >
                                        <Send size={14} />
                                        Send
                                      </SecondaryButton>
                                      <SecondaryButton
                                        type="button"
                                        className="h-10"
                                        disabled={
                                          respondLeaseQuestionMutation.isPending ||
                                          !answerDraft.trim()
                                        }
                                        onClick={() =>
                                          respondLeaseQuestionMutation.mutate({
                                            onboardingId: item.id,
                                            questionId: question.id,
                                            status: "resolved",
                                          })
                                        }
                                      >
                                        <Check size={14} />
                                        Resolve
                                      </SecondaryButton>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                            {!leaseAgreement.questions.length ? (
                              <div className="rounded border border-border bg-white px-3 py-2 text-muted-foreground">
                                No lease agreement questions yet.
                              </div>
                            ) : null}
                          </div>
                          {respondLeaseQuestionMutation.error ? (
                            <div className="text-danger">
                              {friendlyError(
                                respondLeaseQuestionMutation.error,
                              )}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {item.status === "submitted" ? (
                        <div className="grid gap-3 rounded-md border border-border bg-muted/30 p-3 text-xs">
                          <div className="font-semibold">
                            Submitted for review
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {submittedFields.map((field) => {
                              const submittedValue = reviewValue(
                                submittedData[field.key],
                              );
                              const currentValue = reviewValue(
                                field.key in tenant
                                  ? tenant[field.key as keyof TenantRecord]
                                  : undefined,
                              );
                              const changed =
                                field.key in tenant &&
                                submittedValue !== currentValue;
                              return (
                                <div
                                  key={field.key}
                                  className={cn(
                                    "rounded border border-border bg-white px-3 py-2",
                                    changed && "border-primary/30 bg-primary/5",
                                  )}
                                >
                                  <div className="flex items-center justify-between gap-2 text-muted-foreground">
                                    <span>{field.label}</span>
                                    {changed ? (
                                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-leasium-micro font-medium text-primary">
                                        changed
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="mt-1 font-medium">
                                    {submittedValue}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <div className="grid gap-2">
                            <div className="font-semibold">
                              Uploaded documents
                            </div>
                            {onboardingDocuments.map((document) => {
                              const intake = intakeByDocumentId.get(
                                document.id,
                              );
                              return (
                                <div
                                  key={document.id}
                                  className="flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-white px-3 py-2"
                                >
                                  <span className="min-w-0 truncate">
                                    {document.filename}
                                  </span>
                                  <span className="flex shrink-0 items-center gap-2">
                                    <span className="text-muted-foreground">
                                      {documentCategoryLabel(document.category)}
                                    </span>
                                    <StatusBadge
                                      tone={intakeStatusTone(intake)}
                                    >
                                      {intakeStatusLabel(intake)}
                                    </StatusBadge>
                                    {intake ? (
                                      <Link
                                        href={`/intake?review=${intake.id}`}
                                        className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-medium transition hover:bg-muted"
                                      >
                                        <Sparkles size={14} />
                                        Open review
                                      </Link>
                                    ) : (
                                      <SecondaryButton
                                        type="button"
                                        className="h-8"
                                        onClick={() =>
                                          prepareReviewMutation.mutate(
                                            document.id,
                                          )
                                        }
                                        disabled={
                                          prepareReviewMutation.isPending
                                        }
                                      >
                                        <Sparkles size={14} />
                                        Send to review
                                      </SecondaryButton>
                                    )}
                                    <a
                                      href={documentDownloadUrl(document.id)}
                                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-white transition hover:bg-muted"
                                      aria-label={`Download ${document.filename}`}
                                    >
                                      <Download size={14} />
                                    </a>
                                  </span>
                                </div>
                              );
                            })}
                            {onboardingDocuments.length === 0 ? (
                              <div className="rounded border border-border bg-white px-3 py-2 text-muted-foreground">
                                No documents uploaded with this onboarding.
                              </div>
                            ) : null}
                          </div>
                          <Field label="Review notes">
                            <Input
                              value={reviewNotesById[item.id] ?? ""}
                              placeholder="Optional note before approval"
                              onChange={(event) =>
                                setReviewNotesById((current) => ({
                                  ...current,
                                  [item.id]: event.target.value,
                                }))
                              }
                            />
                          </Field>
                        </div>
                      ) : null}
                      {onboardingActionError ? (
                        <div className="text-sm text-danger">
                          {friendlyError(onboardingActionError)}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {tenantOnboardings.length === 0 ? (
                  <EmptyState
                    icon={<Send size={18} />}
                    title="No onboarding has been sent"
                    description="Start from a linked lease below when tenant setup details are needed."
                  />
                ) : null}
              </div>
            </SectionPanel>

            <SectionPanel title="Linked leases" icon={<Link2 size={17} />}>
              <div className="divide-y divide-border">
                {linkedLeases.map((lease) => {
                  const activeOnboarding = tenantOnboardings.find(
                    (item) =>
                      item.lease_id === lease.lease_id &&
                      item.status !== "cancelled",
                  );
                  const activeOnboardingExpired = isExpiredDateTime(
                    activeOnboarding?.expires_at,
                  );
                  return (
                    <div
                      key={lease.lease_id}
                      className="grid gap-3 p-4 text-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">
                            {lease.property_name} - {lease.unit_label}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Lease {lease.status} -{" "}
                            {formatDate(lease.commencement_date)} to{" "}
                            {formatDate(lease.expiry_date)}
                          </div>
                          {lease.property_address ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {lease.property_address}
                            </div>
                          ) : null}
                        </div>
                        <StatusBadge
                          tone={
                            lease.status === "active" ? "success" : "neutral"
                          }
                        >
                          {formatMoney(lease.annual_rent_cents)}
                        </StatusBadge>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {activeOnboarding && !activeOnboardingExpired ? (
                          <Link
                            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
                            href={`/tenants/${tenantId}/portal-preview/${activeOnboarding.id}`}
                            title="Open a read-only operator preview of the tenant portal."
                          >
                            <ShieldCheck size={15} />
                            Preview portal
                          </Link>
                        ) : null}
                        {activeOnboarding &&
                        activeOnboarding.status === "sent" &&
                        !activeOnboardingExpired ? (
                          <SecondaryButton
                            type="button"
                            onClick={() =>
                              navigator.clipboard.writeText(
                                activeOnboarding.onboarding_url,
                              )
                            }
                          >
                            <ClipboardCopy size={15} />
                            Copy onboarding link
                          </SecondaryButton>
                        ) : activeOnboarding &&
                          activeOnboarding.status === "sent" ? (
                          <SecondaryButton
                            type="button"
                            onClick={() =>
                              freshLinkMutation.mutate({
                                onboardingId: activeOnboarding.id,
                                reason:
                                  "Operator renewed an expired onboarding link.",
                              })
                            }
                            disabled={freshLinkMutation.isPending}
                          >
                            <RefreshCw size={15} />
                            Fresh link
                          </SecondaryButton>
                        ) : activeOnboarding ? (
                          <StatusBadge tone="neutral">
                            Onboarding{" "}
                            {activeOnboarding.status.replaceAll("_", " ")}
                          </StatusBadge>
                        ) : (
                          <Button
                            type="button"
                            onClick={() =>
                              createOnboardingMutation.mutate(lease.lease_id)
                            }
                          >
                            <Plus size={16} />
                            Send onboarding
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {!leasesQuery.isLoading && linkedLeases.length === 0 ? (
                  <EmptyState
                    icon={<CalendarClock size={18} />}
                    title="No leases linked yet"
                    description="Lease intake or the property workspace will attach leases to this tenant."
                  />
                ) : null}
              </div>
            </SectionPanel>

            <SectionPanel title="Activity">
              <div className="grid gap-2 p-4 text-sm">
                {(tenantDetail?.activity ?? []).slice(0, 10).map((item) => (
                  <div
                    key={`${item.kind}-${item.related_id}-${item.occurred_at}`}
                    className="flex items-start justify-between gap-3"
                  >
                    <span>
                      <span className="font-medium">{item.label}</span>
                      {item.detail ? (
                        <span className="ml-1 text-muted-foreground">
                          {item.detail}
                        </span>
                      ) : null}
                      <span className="ml-1 text-xs text-muted-foreground">
                        {item.source}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(item.occurred_at)}
                    </span>
                  </div>
                ))}
                {!tenantDetailQuery.isLoading &&
                (tenantDetail?.activity ?? []).length === 0 ? (
                  <div className="text-muted-foreground">No activity yet.</div>
                ) : null}
              </div>
            </SectionPanel>

            <EvidenceSourceTrail
              title="Source history"
              description="Reviewed onboarding changes, document provenance, and public enrichment citations."
              sourceDocument={
                latestTenantEvidence?.sourceDocument ??
                latestTenantDocumentSource
              }
              sourceLocation={
                latestTenantEvidence?.sourceLocation ??
                tenantEvidenceSourceLocation(firstTenantCitation)
              }
              confidence={
                latestTenantEvidence?.confidence ??
                firstTenantCitation?.confidence
              }
              appliedAt={latestTenantEvidence?.appliedAt}
              appliedBy={latestTenantEvidence?.appliedBy}
              changes={latestTenantEvidence?.changes ?? []}
              history={tenantEvidenceHistory}
              emptyMessage="Reviewed onboarding changes, Smart Intake reviews, documents, and public enrichment citations will appear here."
              className="rounded-2xl"
            />
          </div>
        </section>

        {tenantQuery.error ||
        tenantDetailQuery.error ||
        portalAccountsQuery.error ||
        leasesQuery.error ||
        onboardingQuery.error ||
        documentsQuery.error ||
        documentIntakesQuery.error ? (
          <p className="text-sm text-danger">
            {friendlyError(
              tenantQuery.error ??
                tenantDetailQuery.error ??
                portalAccountsQuery.error ??
                leasesQuery.error ??
                onboardingQuery.error ??
                documentsQuery.error ??
                documentIntakesQuery.error,
            )}
          </p>
        ) : null}
      </div>
    </main>
  );
}

export default function TenantDetailPage() {
  return (
    <QueryProvider>
      <TenantDetail />
    </QueryProvider>
  );
}
