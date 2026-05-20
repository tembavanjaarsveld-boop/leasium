"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FileText,
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

type SourceRow = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  source: string;
  href: string;
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

function dueRank(value: string | null | undefined) {
  if (!value) {
    return 9999;
  }
  const today = new Date(`${dateOnly(new Date())}T00:00:00`).getTime();
  const due = new Date(`${value.slice(0, 10)}T00:00:00`).getTime();
  return Math.ceil((due - today) / 86_400_000);
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
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
        area: "Task",
        title: obligation.title,
        detail: `${label(obligation.category)} due ${formatDate(obligation.due_date)}.`,
        action: "Open task queue",
        href: "/tasks",
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
    if (sourceDetail(property.metadata) || metadataText(property.metadata, "portfolio_import_source")) {
      rows.push({
        id: `property-${property.id}`,
        kind: "Property",
        title: property.name,
        detail: sourceDetail(property.metadata) || property.street_address,
        source: sourceLabel(property.metadata),
        href: `/properties?entity_id=${property.entity_id}&property_id=${property.id}`,
      });
    }
  }
  for (const tenant of tenants) {
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
        href: `/tenants/${tenant.id}`,
      });
    }
  }
  for (const obligation of obligations) {
    if (sourceDetail(obligation.metadata) || metadataText(obligation.metadata, "portfolio_import_key")) {
      rows.push({
        id: `obligation-${obligation.id}`,
        kind: "Task",
        title: obligation.title,
        detail: sourceDetail(obligation.metadata) || formatDate(obligation.due_date),
        source: sourceLabel(obligation.metadata),
        href: "/tasks",
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
      const blockers = [
        !row.lease_id ? "No active lease" : null,
        !row.tenant_id || !tenant ? "Tenant record missing" : null,
        !email ? "No tenant email" : null,
        onboarding ? `Existing onboarding ${label(onboarding.status)}` : null,
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
    success: "bg-leasium-success-soft text-[#027A48]",
    warning: "bg-leasium-warning-soft text-[#B54708]",
    danger: "bg-leasium-danger-soft text-[#B42318]",
    primary: "bg-leasium-blue-soft text-leasium-blue-hover",
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

function PortfolioQaWorkspace() {
  const queryClient = useQueryClient();
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [activeTab, setActiveTab] = useState<QaTab>("issues");
  const [search, setSearch] = useState("");
  const [selectedLeaseIds, setSelectedLeaseIds] = useState<string[]>([]);
  const [tenantDrafts, setTenantDrafts] = useState<Record<string, TenantContactDraft>>({});
  const [billingBatch, setBillingBatch] = useState<BillingDraftBatchRecord | null>(null);
  const [onboardingResult, setOnboardingResult] = useState("");

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
    (tenant) => !tenant.contact_email || !tenant.billing_email || !tenant.abn || !tenant.contact_name,
  );
  const readyPrepRows = tenantPrep.filter((row) => row.ready);
  const selectedReadyRows = tenantPrep.filter(
    (row) => row.ready && row.leaseId && selectedLeaseIds.includes(row.leaseId),
  );
  const searchableIssues = issues.filter((issue) =>
    [issue.area, issue.title, issue.detail].join(" ").toLowerCase().includes(search.toLowerCase()),
  );
  const searchableSources = sources.filter((source) =>
    [source.kind, source.title, source.detail, source.source]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()),
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
      const payload: Partial<TenantPayload> = {
        contact_name: cleanText(draft.contact_name ?? tenant.contact_name ?? ""),
        contact_email: cleanText(draft.contact_email ?? tenant.contact_email ?? ""),
        billing_email: cleanText(draft.billing_email ?? tenant.billing_email ?? ""),
        abn: cleanText(draft.abn ?? tenant.abn ?? ""),
      };
      return updateTenant(tenant.id, payload);
    },
    onSuccess: (_tenant, variables) => {
      setTenantDrafts((current) => {
        const next = { ...current };
        delete next[variables.tenant.id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["tenants", selectedEntityId] });
      queryClient.invalidateQueries({ queryKey: ["rent-roll", selectedEntityId] });
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

  function updateTenantDraft(tenantId: string, field: keyof TenantContactDraft, value: string) {
    setTenantDrafts((current) => ({
      ...current,
      [tenantId]: {
        ...current[tenantId],
        [field]: value,
      },
    }));
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
          <div className="rounded-2xl border border-danger/20 bg-leasium-danger-soft p-4 text-sm text-danger">
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
              <EmptyState title="No QA issues found" description="The imported register is clean for the current checks." />
            )}
          </SectionPanel>
        ) : null}

        {!loading && !error && activeTab === "contacts" ? (
          <SectionPanel
            title="Tenant contact enrichment"
            description="Fill the details needed before sending onboarding links or invoices."
            icon={<UserRound size={17} className="text-primary" />}
          >
            {tenantsNeedingContact.length ? (
              <div className="divide-y divide-border">
                {tenantsNeedingContact.map((tenant) => (
                  <div key={tenant.id} className="grid gap-3 px-4 py-4 xl:grid-cols-[minmax(180px,1.1fr)_repeat(4,minmax(120px,1fr))_auto] xl:items-end">
                    <div className="min-w-0">
                      <Link href={`/tenants/${tenant.id}`} className="font-semibold text-primary">
                        {tenantName(tenant)}
                      </Link>
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
                      Save
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Tenant contact data is complete" description="Every tenant has the current cleanup fields filled." />
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
              <div className="divide-y divide-border">
                {searchableSources.map((source) => (
                  <Link
                    key={source.id}
                    href={source.href}
                    className="grid gap-3 px-4 py-4 transition hover:bg-muted/60 md:grid-cols-[120px_minmax(0,1fr)_minmax(180px,auto)] md:items-center"
                  >
                    <StatusBadge tone="neutral">{source.kind}</StatusBadge>
                    <div className="min-w-0">
                      <div className="font-semibold">{source.title}</div>
                      <p className="mt-1 text-sm text-muted-foreground">{source.detail || "No row detail stored"}</p>
                    </div>
                    <div className="text-sm font-semibold text-muted-foreground">{source.source}</div>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState title="No source trails yet" description="Imported rows and document reviews will appear here as metadata is stored." />
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
                <div key={row.id} className="grid gap-3 px-4 py-4 md:grid-cols-[32px_minmax(0,1fr)_minmax(170px,auto)_minmax(170px,auto)] md:items-center">
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
              <div className="border-b border-border bg-leasium-danger-soft px-4 py-3 text-sm text-danger">
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
              <EmptyState title="No billing drafts yet" description="Create internal drafts from imported charge rules when you are ready to review billing." />
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
