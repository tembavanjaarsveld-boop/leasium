"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  ClipboardCopy,
  Clock3,
  Download,
  Edit3,
  FileText,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Save,
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
import { QueryProvider } from "@/components/query-provider";
import {
  Button,
  EmptyState,
  Field,
  Input,
  SecondaryButton,
  SectionPanel,
  Select,
  StatusBadge,
} from "@/components/ui";
import {
  applyPublicEnrichment,
  cancelTenantOnboarding,
  applyTenantOnboarding,
  createDocumentIntakeFromDocument,
  createTenantOnboarding,
  deleteDocument,
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
  restoreTenantPortalAccount,
  revokeTenantPortalAccount,
  TenantPortalAccountRecord,
  TenantPayload,
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
  return documentCategories.find((item) => item.value === value)?.label ?? value;
}

function documentTypeLabel(value: string | null | undefined) {
  return value ? value.replaceAll("_", " ") : "document";
}

function metadataString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function documentSourceLabel(document: { tenant_onboarding_id: string | null; metadata: Record<string, unknown> }) {
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
  key: keyof TenantForm | "insurance_confirmed" | "insurance_expiry_date" | "emergency_contact_name" | "emergency_contact_phone";
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

function TenantDetail() {
  const params = useParams<{ tenantId: string }>();
  const router = useRouter();
  const tenantId = params.tenantId;
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<TenantForm | null>(null);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const documentFileInputRef = useRef<HTMLInputElement>(null);
  const [documentCategory, setDocumentCategory] = useState<DocumentCategory>("insurance");
  const [documentNotes, setDocumentNotes] = useState("");
  const [reviewNotesById, setReviewNotesById] = useState<Record<string, string>>({});
  const [enrichmentSuggestions, setEnrichmentSuggestions] = useState<EnrichmentSuggestion[]>([]);
  const [freshLinkNotice, setFreshLinkNotice] = useState<string | null>(null);

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

  const tenantOnboardings = (onboardingQuery.data ?? [])
    .filter((item) => item.tenant_id === tenantId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const portalAccounts = portalAccountsQuery.data ?? [];
  const latestSentOnboarding = tenantOnboardings.find((item) => item.status === "sent");
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

  const revokePortalAccountMutation = useMutation({
    mutationFn: (accountId: string) =>
      revokeTenantPortalAccount(tenantId, accountId, {
        reason: "Operator revoked access from the tenant profile.",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-portal-accounts", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-detail", tenantId] });
    },
  });

  const restorePortalAccountMutation = useMutation({
    mutationFn: (accountId: string) =>
      restoreTenantPortalAccount(tenantId, accountId, {
        reason: "Operator restored access from the tenant profile.",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-portal-accounts", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-detail", tenantId] });
    },
  });

  const unlinkPortalAccountMutation = useMutation({
    mutationFn: (accountId: string) =>
      unlinkTenantPortalAccount(tenantId, accountId, {
        reason: "Operator unlinked access so the tenant can reconnect.",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-portal-accounts", tenantId] });
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
      queryClient.invalidateQueries({ queryKey: ["tenant-onboardings", tenant?.entity_id] });
    },
  });

  const cancelOnboardingMutation = useMutation({
    mutationFn: cancelTenantOnboarding,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-onboardings", tenant?.entity_id] });
    },
  });

  const resendOnboardingMutation = useMutation({
    mutationFn: resendTenantOnboarding,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-onboardings", tenant?.entity_id] });
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
      queryClient.invalidateQueries({ queryKey: ["tenant-onboardings", tenant?.entity_id] });
      setFreshLinkNotice(`Fresh portal link copied. Expires ${formatDate(updated.expires_at)}.`);
      if (typeof navigator !== "undefined") {
        await navigator.clipboard.writeText(updated.portal_url).catch(() => undefined);
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
      queryClient.invalidateQueries({ queryKey: ["tenant-onboardings", tenant?.entity_id] });
    },
  });

  const applyOnboardingMutation = useMutation({
    mutationFn: applyTenantOnboarding,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-onboardings", tenant?.entity_id] });
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
            <EmptyState title="Loading tenant" />
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
            <EmptyState title="Tenant not found" action={<Link href="/tenants"><SecondaryButton type="button">Back to tenants</SecondaryButton></Link>} />
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
            <Link href="/tenants" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft size={14} />
              Tenants
            </Link>
            <h2 className="text-xl font-semibold">{tenantName(tenant)}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Contact, billing, onboarding, documents, and lease history.
            </p>
          </div>
          <SecondaryButton type="button" onClick={startEdit}>
            <Edit3 size={15} />
            Edit profile
          </SecondaryButton>
        </section>

        {editing && form ? (
          <SectionPanel
            title="Edit tenant profile"
            description="Keep admin changes focused, then return to the profile."
            actions={
              <SecondaryButton type="button" onClick={() => setEditing(false)} className="h-8 w-8 px-0" aria-label="Close edit">
                <X size={15} />
              </SecondaryButton>
            }
          >
            <form className="grid gap-3 p-4 md:grid-cols-2" onSubmit={submitForm}>
              <Field label="Legal name">
                <Input value={form.legal_name} onChange={(event) => updateField("legal_name", event.target.value)} />
              </Field>
              <Field label="Trading as">
                <Input value={form.trading_name} onChange={(event) => updateField("trading_name", event.target.value)} />
              </Field>
              <Field label="ABN">
                <Input value={form.abn} onChange={(event) => updateField("abn", event.target.value)} />
              </Field>
              <Field label="Contact">
                <Input value={form.contact_name} onChange={(event) => updateField("contact_name", event.target.value)} />
              </Field>
              <Field label="Contact email">
                <Input type="email" value={form.contact_email} onChange={(event) => updateField("contact_email", event.target.value)} />
              </Field>
              <Field label="Billing email">
                <Input type="email" value={form.billing_email} onChange={(event) => updateField("billing_email", event.target.value)} />
              </Field>
              <Field label="Phone">
                <Input value={form.contact_phone} onChange={(event) => updateField("contact_phone", event.target.value)} />
              </Field>
              <Field label="Notes">
                <Input value={form.notes} onChange={(event) => updateField("notes", event.target.value)} />
              </Field>
              <div className="md:col-span-2">
                <Button type="submit" disabled={!form.legal_name.trim() || updateMutation.isPending}>
                  <Save size={16} />
                  Save profile
                </Button>
                {updateMutation.error ? (
                  <p className="mt-2 text-sm text-danger">{friendlyError(updateMutation.error)}</p>
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
                <div>
                  <dt className="text-xs text-muted-foreground">Trading as</dt>
                  <dd>{tenant.trading_name ?? "-"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">ABN</dt>
                  <dd>{tenant.abn ?? "-"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Primary contact</dt>
                  <dd>{tenant.contact_name ?? "-"}</dd>
                  <dd className="text-muted-foreground">{tenant.contact_email ?? tenant.contact_phone ?? "-"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Billing email</dt>
                  <dd>{tenant.billing_email ?? tenant.contact_email ?? "-"}</dd>
                </div>
              </dl>
            </SectionPanel>

            <SectionPanel title="Portal access" icon={<ShieldCheck size={17} />}>
              <div className="grid gap-3 p-4 text-sm">
                {portalAccounts.map((account) => {
                  const accountOnboarding =
                    tenantOnboardings.find((item) => item.id === account.tenant_onboarding_id) ??
                    latestSentOnboarding;
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
                          <StatusBadge tone={portalAccountTone(account.status)}>
                            {portalAccountLabel(account.status)}
                          </StatusBadge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {portalAccountDetail(account)}
                        </div>
                        {portalAccountRecoveryDetail(account) ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            Recovery receipt: {portalAccountRecoveryDetail(account)}
                          </div>
                        ) : null}
                        <div className="mt-1 truncate text-xs text-muted-foreground">
                          {account.auth_provider} account {account.auth_provider_id}
                        </div>
                      </div>
                      {account.status === "active" ? (
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <SecondaryButton
                            type="button"
                            className="h-8"
                            onClick={() => unlinkPortalAccountMutation.mutate(account.id)}
                            disabled={unlinkPortalAccountMutation.isPending}
                          >
                            <Link2 size={15} />
                            Unlink
                          </SecondaryButton>
                          <SecondaryButton
                            type="button"
                            className="h-8 border-danger/30 text-danger hover:bg-danger/5"
                            onClick={() => revokePortalAccountMutation.mutate(account.id)}
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
                            onClick={() => restorePortalAccountMutation.mutate(account.id)}
                            disabled={restorePortalAccountMutation.isPending}
                          >
                            <Check size={15} />
                            Restore
                          </SecondaryButton>
                        </div>
                      ) : account.status === "unlinked" && accountOnboarding?.status === "sent" ? (
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <SecondaryButton
                            type="button"
                            className="h-8"
                            onClick={() =>
                              freshLinkMutation.mutate({
                                onboardingId: accountOnboarding.id,
                                reason: "Operator sent a fresh portal link from the tenant profile.",
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
                {!portalAccountsQuery.isLoading && portalAccounts.length === 0 ? (
                  <EmptyState
                    title="No tenant login linked"
                    description="The tenant can connect a login from an active onboarding or portal link."
                    action={
                      latestSentOnboarding ? (
                        <SecondaryButton
                          type="button"
                          onClick={() =>
                            freshLinkMutation.mutate({
                              onboardingId: latestSentOnboarding.id,
                              reason: "Operator sent a fresh portal link from the tenant profile.",
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
                freshLinkMutation.error ? (
                  <p className="text-sm text-danger">
                    {friendlyError(
                      portalAccountsQuery.error ??
                        revokePortalAccountMutation.error ??
                        restorePortalAccountMutation.error ??
                        unlinkPortalAccountMutation.error ??
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
                              <div className="font-medium">{suggestion.value}</div>
                            </div>
                            <StatusBadge tone="primary">
                              {confidenceLabel(suggestion.confidence)}
                            </StatusBadge>
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">
                            {suggestion.source.source_hint} - {suggestion.source.citation}
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
                    Missing public fields like ABN or registered address can be suggested with citations before applying.
                  </div>
                )}
                {previewEnrichmentMutation.error || applyEnrichmentMutation.error ? (
                  <p className="text-sm text-danger">
                    {friendlyError(
                      previewEnrichmentMutation.error ?? applyEnrichmentMutation.error,
                    )}
                  </p>
                ) : null}
              </div>
            </SectionPanel>

            <SectionPanel title="Documents" icon={<FileText size={17} />}>
              <form className="grid gap-3 border-b border-border p-4" onSubmit={submitDocument}>
                <label className="grid min-h-28 cursor-pointer place-items-center rounded-md border border-dashed border-border bg-muted/40 px-4 py-5 text-center transition hover:border-primary hover:bg-primary/5">
                  <input
                    ref={documentFileInputRef}
                    type="file"
                    className="sr-only"
                    onChange={(event) => setDocumentFile(event.target.files?.[0] ?? null)}
                  />
                  <span className="grid justify-items-center gap-2">
                    <UploadCloud size={22} className="text-primary" />
                    <span className="text-sm font-semibold">
                      {documentFile ? documentFile.name : "Drop in a tenant document"}
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
                        setDocumentCategory(event.target.value as DocumentCategory)
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
                <Button type="submit" disabled={!documentFile || uploadDocumentMutation.isPending}>
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
                            <span>{documentCategoryLabel(document.category)}</span>
                            <span>{formatBytes(document.byte_size)}</span>
                            <span>{formatDate(document.created_at)}</span>
                            <span>Source: {documentSourceLabel(document)}</span>
                            {intake?.document_type ? (
                              <span>{documentTypeLabel(intake.document_type)}</span>
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
                {!documentsQuery.isLoading && (documentsQuery.data ?? []).length === 0 ? (
                  <EmptyState
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
            <SectionPanel title="Onboarding workflow" icon={<ShieldCheck size={17} />}>
              <div className="divide-y divide-border">
                {tenantOnboardings.map((item) => {
                  const onboardingDocuments = (documentsQuery.data ?? []).filter(
                    (document) => document.tenant_onboarding_id === item.id,
                  );
                  const submittedData = item.submitted_data ?? {};
                  const linkExpired = isExpiredDateTime(item.expires_at);
                  return (
                  <div key={item.id} className="grid gap-3 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <StatusBadge tone={statusTone(item.status, item.due_date)}>
                          {item.status.replaceAll("_", " ")}
                        </StatusBadge>
                        {linkExpired && item.status === "sent" ? (
                          <StatusBadge tone="warning">Link expired</StatusBadge>
                        ) : null}
                        <span className={cn("text-sm text-muted-foreground", dueRank(item.due_date) < 0 && "font-medium text-danger")}>
                          Due {formatDate(item.due_date)}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {item.status === "sent" && !linkExpired ? (
                          <SecondaryButton type="button" onClick={() => navigator.clipboard.writeText(item.onboarding_url)}>
                            <ClipboardCopy size={15} />
                            Copy link
                          </SecondaryButton>
                        ) : null}
                        {item.status === "sent" && linkExpired ? (
                          <SecondaryButton
                            type="button"
                            onClick={() =>
                              freshLinkMutation.mutate({
                                onboardingId: item.id,
                                reason: "Operator renewed an expired onboarding link.",
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
                          <SecondaryButton type="button" onClick={() => cancelOnboardingMutation.mutate(item.id)} disabled={cancelOnboardingMutation.isPending}>
                            <X size={15} />
                            Cancel
                          </SecondaryButton>
                        ) : null}
                        {item.status === "sent" ? (
                          <SecondaryButton type="button" onClick={() => resendOnboardingMutation.mutate(item.id)} disabled={resendOnboardingMutation.isPending || linkExpired}>
                            <Link2 size={15} />
                            Resend
                          </SecondaryButton>
                        ) : null}
                        {item.status === "submitted" ? (
                          <Button type="button" onClick={() => reviewOnboardingMutation.mutate(item.id)} disabled={reviewOnboardingMutation.isPending}>
                            <Check size={16} />
                            Review
                          </Button>
                        ) : null}
                        {item.status === "submitted" || item.status === "reviewed" ? (
                          <Button type="button" onClick={() => applyOnboardingMutation.mutate(item.id)} disabled={applyOnboardingMutation.isPending}>
                            <Save size={16} />
                            Apply
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-4">
                      <div>Last sent {formatDate(item.last_sent_at)}</div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span>Delivery</span>
                        <StatusBadge tone={onboardingDeliveryTone(item.delivery_data)}>
                          {onboardingDeliveryLabel(item.delivery_data)}
                        </StatusBadge>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span>Reminders</span>
                        <StatusBadge tone={onboardingReminderTone(item.delivery_data)}>
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
                          {onboardingReminderSteps(item.delivery_data).map((step) => (
                            <div
                              key={step.key ?? step.label}
                              className="rounded border border-border bg-white px-3 py-2"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium">
                                  {step.label ?? "Reminder"}
                                </span>
                                <StatusBadge tone={reminderStepTone(step.status)}>
                                  {reminderStepLabel(step.status)}
                                </StatusBadge>
                              </div>
                              <div className="mt-1 text-muted-foreground">
                                {step.sent_at
                                  ? `Sent ${formatDateTime(step.sent_at)}`
                                  : `If incomplete after ${step.after_days ?? "-"} days`}
                              </div>
                            </div>
                          ))}
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
                        {(item.delivery_data.receipts ?? []).slice(0, 3).map((receipt, index) => (
                          <div
                            key={`${String(receipt.channel)}-${String(receipt.received_at)}-${index}`}
                            className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground"
                          >
                            <span className="capitalize">
                              {String(receipt.channel ?? "message")} {String(receipt.status ?? "updated").replaceAll("_", " ")}
                            </span>
                            <span>{formatDateTime(String(receipt.received_at ?? ""))}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {item.status === "submitted" ? (
                      <div className="grid gap-3 rounded-md border border-border bg-muted/30 p-3 text-xs">
                        <div className="font-semibold">Submitted for review</div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {submittedFields.map((field) => {
                            const submittedValue = reviewValue(submittedData[field.key]);
                            const currentValue = reviewValue(
                              field.key in tenant ? tenant[field.key as keyof TenantRecord] : undefined,
                            );
                            const changed =
                              field.key in tenant && submittedValue !== currentValue;
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
                                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                      changed
                                    </span>
                                  ) : null}
                                </div>
                                <div className="mt-1 font-medium">{submittedValue}</div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="grid gap-2">
                          <div className="font-semibold">Uploaded documents</div>
                          {onboardingDocuments.map((document) => {
                            const intake = intakeByDocumentId.get(document.id);
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
                                  <StatusBadge tone={intakeStatusTone(intake)}>
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
                                        prepareReviewMutation.mutate(document.id)
                                      }
                                      disabled={prepareReviewMutation.isPending}
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
                            placeholder="Optional note before marking reviewed"
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
                  </div>
                  );
                })}
                {tenantOnboardings.length === 0 ? (
                  <EmptyState
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
                    (item) => item.lease_id === lease.lease_id && item.status !== "cancelled",
                  );
                  const activeOnboardingExpired = isExpiredDateTime(activeOnboarding?.expires_at);
                  return (
                    <div key={lease.lease_id} className="grid gap-3 p-4 text-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">
                            {lease.property_name} - {lease.unit_label}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Lease {lease.status} - {formatDate(lease.commencement_date)} to {formatDate(lease.expiry_date)}
                          </div>
                          {lease.property_address ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {lease.property_address}
                            </div>
                          ) : null}
                        </div>
                        <StatusBadge tone={lease.status === "active" ? "success" : "neutral"}>
                          {formatMoney(lease.annual_rent_cents)}
                        </StatusBadge>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {activeOnboarding &&
                        activeOnboarding.status === "sent" &&
                        !activeOnboardingExpired ? (
                          <SecondaryButton type="button" onClick={() => navigator.clipboard.writeText(activeOnboarding.onboarding_url)}>
                            <ClipboardCopy size={15} />
                            Copy onboarding link
                          </SecondaryButton>
                        ) : activeOnboarding && activeOnboarding.status === "sent" ? (
                          <SecondaryButton
                            type="button"
                            onClick={() =>
                              freshLinkMutation.mutate({
                                onboardingId: activeOnboarding.id,
                                reason: "Operator renewed an expired onboarding link.",
                              })
                            }
                            disabled={freshLinkMutation.isPending}
                          >
                            <RefreshCw size={15} />
                            Fresh link
                          </SecondaryButton>
                        ) : activeOnboarding ? (
                          <StatusBadge tone="neutral">
                            Onboarding {activeOnboarding.status.replaceAll("_", " ")}
                          </StatusBadge>
                        ) : (
                          <Button type="button" onClick={() => createOnboardingMutation.mutate(lease.lease_id)}>
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
                    title="No leases linked yet"
                    description="Lease intake or the property workspace will attach leases to this tenant."
                  />
                ) : null}
              </div>
            </SectionPanel>

            <SectionPanel title="Activity">
              <div className="grid gap-2 p-4 text-sm">
                {(tenantDetail?.activity ?? []).slice(0, 10).map((item) => (
                  <div key={`${item.kind}-${item.related_id}-${item.occurred_at}`} className="flex items-start justify-between gap-3">
                    <span>
                      <span className="font-medium">{item.label}</span>
                      {item.detail ? (
                        <span className="ml-1 text-muted-foreground">{item.detail}</span>
                      ) : null}
                      <span className="ml-1 text-xs text-muted-foreground">
                        {item.source}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(item.occurred_at)}</span>
                  </div>
                ))}
                {!tenantDetailQuery.isLoading && (tenantDetail?.activity ?? []).length === 0 ? (
                  <div className="text-muted-foreground">No activity yet.</div>
                ) : null}
              </div>
            </SectionPanel>

            <SectionPanel title="Reviewed changes">
              <div className="grid gap-3 p-4 text-sm">
                {(tenantDetail?.reviewed_changes ?? []).slice(0, 6).map((entry) => (
                  <div
                    key={`${entry.source}-${entry.source_id}-${entry.occurred_at}`}
                    className="rounded-md border border-border bg-white p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium">{entry.source_label}</div>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(entry.occurred_at)}
                      </span>
                    </div>
                    {entry.notes ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {entry.notes}
                      </div>
                    ) : null}
                    <div className="mt-2 grid gap-2">
                      {entry.changes.slice(0, 4).map((change) => (
                        <div
                          key={`${change.field}-${reviewValue(change.after)}`}
                          className="grid gap-1 rounded border border-border bg-muted/30 px-3 py-2 text-xs"
                        >
                          <div className="font-semibold">{change.label}</div>
                          <div className="text-muted-foreground">
                            {reviewValue(change.before)} to {reviewValue(change.after)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {!tenantDetailQuery.isLoading &&
                (tenantDetail?.reviewed_changes ?? []).length === 0 ? (
                  <div className="text-muted-foreground">
                    Reviewed onboarding and Smart Intake changes will appear here.
                  </div>
                ) : null}
              </div>
            </SectionPanel>
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
