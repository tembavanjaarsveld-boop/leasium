"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  FileCheck2,
  FileWarning,
  Loader2,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { QueryProvider } from "@/components/query-provider";
import {
  EmptyState,
  Input,
  PageHeader,
  SecondaryButton,
  SectionPanel,
  Select,
  StatusBadge,
} from "@/components/ui";
import {
  createInvoiceDraftFromBillingDraft,
  listBillingDrafts,
  listEntities,
  listInvoiceDrafts,
  listRentRoll,
  updateBillingDraft,
  type BillingDraftRecord,
  type BillingDraftStatus,
  type InvoiceDraftRecord,
  type InvoiceDraftStatus,
  type RentRollRow,
} from "@/lib/api";

const ENTITY_STORAGE_KEY = "leasium.entity_id";
const EMPTY_RENT_ROWS: RentRollRow[] = [];
const EMPTY_INVOICE_DRAFTS: InvoiceDraftRecord[] = [];

type BlockerKind = "invoice" | "xero" | "gst";

type BlockerItem = {
  id: string;
  row: RentRollRow;
  kind: BlockerKind;
  message: string;
};

type BlockerGroup = {
  id: string;
  title: string;
  subtitle: string;
  row: RentRollRow;
  items: BlockerItem[];
};

type BlockerAction = {
  label: string;
  href: string;
};

type StatusTone = "neutral" | "success" | "warning" | "danger" | "primary";

function dateOnly(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function shortId(value: string | null | undefined) {
  return value ? value.slice(0, 8) : null;
}

function billingDraftStatusLabel(status: BillingDraftStatus) {
  return status.replaceAll("_", " ");
}

function billingDraftStatusTone(status: BillingDraftStatus): StatusTone {
  switch (status) {
    case "approved":
      return "success";
    case "needs_review":
      return "warning";
    case "void":
      return "danger";
    default:
      return "neutral";
  }
}

function billingDraftSourceContext(draft: BillingDraftRecord) {
  const lineSources = draft.lines
    .map((line) => line.source_hint)
    .filter((value): value is string => Boolean(value));
  const primarySource = lineSources[0] ?? "Smart Intake source document";
  const extraSources = Math.max(new Set(lineSources).size - 1, 0);
  const documentId = shortId(draft.document_id);
  const intakeId = shortId(draft.document_intake_id);
  return {
    primarySource,
    extraSources,
    documentId,
    intakeId,
    lineCount: draft.lines.length,
  };
}

function invoiceDraftStatusLabel(status: InvoiceDraftStatus) {
  return status.replaceAll("_", " ");
}

function invoiceDraftStatusTone(status: InvoiceDraftStatus): StatusTone {
  switch (status) {
    case "approved":
      return "success";
    case "ready_for_approval":
      return "primary";
    case "void":
      return "danger";
    default:
      return "neutral";
  }
}

function invoiceDraftBlockers(draft: InvoiceDraftRecord) {
  const value = draft.metadata.readiness_blockers;
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function blockerItems(row: RentRollRow): BlockerItem[] {
  const rows: BlockerItem[] = [];
  const push = (kind: BlockerKind, messages: string[] | undefined) => {
    for (const [index, message] of (messages ?? []).filter(Boolean).entries()) {
      rows.push({
        id: `${row.tenancy_unit_id}-${kind}-${index}-${message}`,
        row,
        kind,
        message,
      });
    }
  };
  push("invoice", row.invoice_readiness_blockers);
  push("xero", row.xero_readiness_blockers);
  push("gst", row.gst_readiness_blockers);
  return rows;
}

function kindTone(kind: BlockerKind) {
  switch (kind) {
    case "invoice":
      return "danger" as const;
    case "xero":
      return "warning" as const;
    case "gst":
      return "primary" as const;
  }
}

function propertyHref(row: RentRollRow) {
  const params = new URLSearchParams({
    entity_id: row.entity_id,
    property_id: row.property_id,
  });
  return `/properties?${params.toString()}`;
}

function tenantHref(row: RentRollRow) {
  return row.tenant_id ? `/tenants/${row.tenant_id}` : propertyHref(row);
}

function blockerTitle(item: BlockerItem) {
  const message = item.message.toLowerCase();
  if (/billing|email/.test(message)) {
    return "Missing billing email";
  }
  if (/charge/.test(message) && /no|missing|active|rule/.test(message)) {
    return "No active charge rule";
  }
  if (item.kind === "xero" && /customer|map|mapping/.test(message)) {
    return "Xero customer not mapped";
  }
  if (item.kind === "xero") {
    return "Xero mapping needs review";
  }
  if (item.kind === "gst" || /gst|tax/.test(message)) {
    return "GST treatment needs review";
  }
  if (/date|commencement|expiry|start/.test(message)) {
    return "Lease dates incomplete";
  }
  if (/lease/.test(message)) {
    return "Lease setup needs review";
  }
  return item.message.replace(/\.$/, "");
}

function blockerChipLabel(item: BlockerItem) {
  const message = item.message.toLowerCase();
  if (/billing|email|tenant/.test(message)) {
    return "Missing details";
  }
  if (item.kind === "xero") {
    return "Xero mapping";
  }
  if (item.kind === "gst") {
    return "GST check";
  }
  if (/charge|rule/.test(message)) {
    return "Charge rules";
  }
  return "Blocked";
}

function blockerGuidance(item: BlockerItem) {
  const title = blockerTitle(item);
  switch (title) {
    case "Missing billing email":
      return "Add a billing contact before the next invoice run.";
    case "No active charge rule":
      return "Create or activate a charge rule before billing.";
    case "Xero customer not mapped":
    case "Xero mapping needs review":
      return "Map the Xero customer, account code, or tax type before sync.";
    case "GST treatment needs review":
      return "Confirm GST treatment before invoices are prepared.";
    case "Lease dates incomplete":
      return "Confirm lease dates before this tenancy is billed.";
    default:
      return "Review the linked record before the next invoice run.";
  }
}

function blockerAction(item: BlockerItem): BlockerAction {
  const message = item.message.toLowerCase();
  if (/billing|email|tenant/.test(message) && item.row.tenant_id) {
    return {
      label: "Open tenant",
      href: tenantHref(item.row),
    };
  }
  if (
    item.kind === "xero" ||
    item.kind === "gst" ||
    /charge|xero|tax|gst|account|mapping/.test(message)
  ) {
    return {
      label:
        item.kind === "xero"
          ? "Map Xero"
          : item.kind === "gst"
            ? "Review GST"
            : "Fix charge rules",
      href: propertyHref(item.row),
    };
  }
  if (!item.row.lease_id || /lease|vacant|unit/.test(message)) {
    return {
      label: "Open property",
      href: propertyHref(item.row),
    };
  }
  return {
    label: item.row.tenant_id ? "Open tenant" : "Open property",
    href: tenantHref(item.row),
  };
}

function leaseContext(row: RentRollRow) {
  if (!row.lease_id) {
    return "No lease attached";
  }
  const status = row.lease_status?.replaceAll("_", " ") ?? "Lease";
  return `${status} lease, next due ${formatDate(row.next_due_date)}`;
}

function KpiCard({
  title,
  value,
  detail,
  icon,
  tone = "neutral",
}: {
  title: string;
  value: string | number;
  detail: string;
  icon: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "primary";
}) {
  const toneClass = {
    neutral: "bg-muted text-leasium-slate-500",
    success: "bg-leasium-success-soft text-[#027A48]",
    warning: "bg-leasium-warning-soft text-[#B54708]",
    danger: "bg-leasium-danger-soft text-[#B42318]",
    primary: "bg-leasium-blue-soft text-leasium-blue-hover",
  }[tone];

  return (
    <div className="rounded-2xl border border-border bg-white p-4 shadow-leasiumXs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-2xl font-semibold">{value}</div>
          <div className="mt-1 text-sm font-medium">{title}</div>
        </div>
        <div className={`rounded-xl p-2 ${toneClass}`}>{icon}</div>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

function BillingReadinessWorkspace() {
  const queryClient = useQueryClient();
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [asOf, setAsOf] = useState(() => dateOnly(new Date()));

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

  const rentRollQuery = useQuery({
    queryKey: ["billing-readiness-rent-roll", selectedEntityId, asOf],
    queryFn: () => listRentRoll({ entity_id: selectedEntityId, as_of: asOf }),
    enabled: Boolean(selectedEntityId),
  });

  const billingDraftsQuery = useQuery({
    queryKey: ["billing-readiness-drafts", selectedEntityId],
    queryFn: () => listBillingDrafts({ entity_id: selectedEntityId }),
    enabled: Boolean(selectedEntityId),
  });

  const invoiceDraftsQuery = useQuery({
    queryKey: ["billing-readiness-invoice-drafts", selectedEntityId],
    queryFn: () => listInvoiceDrafts({ entity_id: selectedEntityId }),
    enabled: Boolean(selectedEntityId),
  });

  const updateDraftMutation = useMutation({
    mutationFn: ({
      draftId,
      status,
    }: {
      draftId: string;
      status: BillingDraftStatus;
    }) => updateBillingDraft(draftId, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["billing-readiness-drafts", selectedEntityId],
      });
    },
  });

  const createInvoiceDraftMutation = useMutation({
    mutationFn: (draftId: string) => createInvoiceDraftFromBillingDraft(draftId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["billing-readiness-drafts", selectedEntityId],
      });
      queryClient.invalidateQueries({
        queryKey: ["billing-readiness-invoice-drafts", selectedEntityId],
      });
    },
  });

  const selectedEntity = entitiesQuery.data?.find(
    (entity) => entity.id === selectedEntityId,
  );

  const rentRows = rentRollQuery.data ?? EMPTY_RENT_ROWS;
  const blockerRows = useMemo(
    () => rentRows.flatMap((row) => blockerItems(row)),
    [rentRows],
  );
  const blockerGroups = useMemo(() => {
    const groups = new Map<string, BlockerGroup>();
    for (const item of blockerRows) {
      const row = item.row;
      const id = `${row.property_id}-${row.tenant_id ?? row.tenancy_unit_id}`;
      const existing = groups.get(id);
      if (existing) {
        existing.items.push(item);
        continue;
      }
      groups.set(id, {
        id,
        title: row.tenant_name ?? row.unit_label,
        subtitle: `${row.property_name} / ${row.unit_label}`,
        row,
        items: [item],
      });
    }
    return Array.from(groups.values());
  }, [blockerRows]);
  const rowsWithBlockers = useMemo(
    () => rentRows.filter((row) => blockerItems(row).length > 0),
    [rentRows],
  );
  const billingDrafts = billingDraftsQuery.data ?? [];

  const counts = useMemo(() => {
    const xero = rentRows.reduce(
      (total, row) => total + (row.xero_readiness_blockers?.length ?? 0),
      0,
    );
    const gst = rentRows.reduce(
      (total, row) => total + (row.gst_readiness_blockers?.length ?? 0),
      0,
    );
    const missingBillingDetails = rentRows.reduce(
      (total, row) =>
        total +
        (row.invoice_readiness_blockers ?? []).filter((blocker) =>
          /billing|email|tenant/i.test(blocker),
        ).length,
      0,
    );
    return {
      xero,
      gst,
      missingBillingDetails,
      ready: Math.max(rentRows.length - rowsWithBlockers.length, 0),
    };
  }, [rentRows, rowsWithBlockers.length]);
  const invoiceDrafts = invoiceDraftsQuery.data ?? EMPTY_INVOICE_DRAFTS;
  const invoiceDraftByBillingDraftId = useMemo(() => {
    const drafts = new Map<string, InvoiceDraftRecord>();
    for (const draft of invoiceDrafts) {
      drafts.set(draft.billing_draft_id, draft);
    }
    return drafts;
  }, [invoiceDrafts]);

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
          title="Billing Readiness"
          description={
            selectedEntity
              ? `Review invoice, Xero, and GST blockers for ${selectedEntity.name}.`
              : "Select an entity to review invoice, Xero, and GST blockers."
          }
          actions={
            <>
              <Input
                aria-label="As of date"
                type="date"
                value={asOf}
                onChange={(event) => setAsOf(event.target.value)}
                className="w-40"
              />
              <SecondaryButton
                type="button"
                onClick={() => {
                  rentRollQuery.refetch();
                  billingDraftsQuery.refetch();
                  invoiceDraftsQuery.refetch();
                }}
                disabled={
                  !selectedEntityId ||
                  rentRollQuery.isFetching ||
                  billingDraftsQuery.isFetching ||
                  invoiceDraftsQuery.isFetching
                }
              >
                <RefreshCw size={15} />
                Refresh
              </SecondaryButton>
            </>
          }
        />

        {entitiesQuery.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {entitiesQuery.error instanceof Error
              ? entitiesQuery.error.message
              : "Could not load entities."}
          </div>
        ) : null}
        {rentRollQuery.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {rentRollQuery.error instanceof Error
              ? rentRollQuery.error.message
              : "Could not load billing readiness."}
          </div>
        ) : null}
        {billingDraftsQuery.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {billingDraftsQuery.error instanceof Error
              ? billingDraftsQuery.error.message
              : "Could not load billing drafts."}
          </div>
        ) : null}
        {invoiceDraftsQuery.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {invoiceDraftsQuery.error instanceof Error
              ? invoiceDraftsQuery.error.message
              : "Could not load invoice drafts."}
          </div>
        ) : null}
        {updateDraftMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {updateDraftMutation.error instanceof Error
              ? updateDraftMutation.error.message
              : "Could not update the billing draft."}
          </div>
        ) : null}
        {createInvoiceDraftMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {createInvoiceDraftMutation.error instanceof Error
              ? createInvoiceDraftMutation.error.message
              : "Could not create the invoice draft."}
          </div>
        ) : null}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <KpiCard
            title="Ready to bill"
            value={counts.ready}
            detail={`${rentRows.length} rent roll rows checked as at ${formatDate(asOf)}.`}
            icon={<CheckCircle2 size={18} />}
            tone="success"
          />
          <KpiCard
            title="Blocked tenancies"
            value={rowsWithBlockers.length}
            detail="Tenancies with at least one invoice, Xero, or GST issue."
            icon={<AlertTriangle size={18} />}
            tone={rowsWithBlockers.length ? "danger" : "success"}
          />
          <KpiCard
            title="Missing billing details"
            value={counts.missingBillingDetails}
            detail="Tenant billing contacts or invoice details that need cleanup."
            icon={<ReceiptText size={18} />}
            tone={counts.missingBillingDetails ? "warning" : "success"}
          />
          <KpiCard
            title="Missing Xero mapping"
            value={counts.xero}
            detail="Customer mapping, account code, or tax type issues blocking sync."
            icon={<FileWarning size={18} />}
            tone={counts.xero ? "warning" : "success"}
          />
          <KpiCard
            title="GST checks"
            value={counts.gst}
            detail="Tax treatment checks that need attention before invoices are raised."
            icon={<ShieldCheck size={18} />}
            tone={counts.gst ? "primary" : "success"}
          />
        </section>

        {!selectedEntityId ? (
          <SectionPanel>
            <EmptyState
              title="No entity selected"
              description="Choose an entity from the header to load billing readiness checks. Leasium will show invoice, Xero, and GST blockers here."
            />
          </SectionPanel>
        ) : null}

        {selectedEntityId ? (
          <>
            <SectionPanel
              title="Billing draft review"
              description="Source-linked Smart Intake drafts for review only. Approve or void updates draft status; it does not post an invoice, email a tenant, or sync to Xero."
              icon={<ReceiptText size={17} className="text-primary" />}
              actions={
                <StatusBadge
                  tone={billingDrafts.length ? "primary" : "neutral"}
                >
                  {billingDrafts.length} draft
                  {billingDrafts.length === 1 ? "" : "s"}
                </StatusBadge>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="bg-muted text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Draft</th>
                      <th className="px-3 py-2 font-semibold">Amount</th>
                      <th className="px-3 py-2 font-semibold">Due</th>
                      <th className="px-3 py-2 font-semibold">Source</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="px-3 py-2 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billingDrafts.map((draft) => {
                      const source = billingDraftSourceContext(draft);
                      const isUpdating =
                        updateDraftMutation.isPending &&
                        updateDraftMutation.variables?.draftId === draft.id;
                      const canApprove =
                        draft.status !== "approved" && draft.status !== "void";
                      const canVoid = draft.status !== "void";
                      const invoiceDraft = invoiceDraftByBillingDraftId.get(
                        draft.id,
                      );
                      const isCreatingInvoice =
                        createInvoiceDraftMutation.isPending &&
                        createInvoiceDraftMutation.variables === draft.id;
                      return (
                        <tr
                          key={draft.id}
                          className="border-t border-border align-top"
                        >
                          <td className="min-w-72 px-3 py-3">
                            <div className="font-medium">{draft.title}</div>
                            <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                              {draft.notes ??
                                "Draft prepared from source review. No invoice has been posted."}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-sm font-medium">
                            {formatMoney(draft.total_cents)}
                          </td>
                          <td className="px-3 py-3 text-xs">
                            {formatDate(draft.due_date)}
                          </td>
                          <td className="min-w-64 px-3 py-3 text-xs">
                            <div className="font-medium text-foreground">
                              {source.primarySource}
                            </div>
                            <div className="mt-1 text-muted-foreground">
                              {source.lineCount} line
                              {source.lineCount === 1 ? "" : "s"}
                              {source.extraSources
                                ? `, ${source.extraSources} more source${
                                    source.extraSources === 1 ? "" : "s"
                                  }`
                                : ""}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-2 text-muted-foreground">
                              {source.intakeId && draft.document_intake_id ? (
                                <Link
                                  href={`/intake?review=${draft.document_intake_id}`}
                                  className="inline-flex items-center gap-1 font-medium text-primary hover:text-leasium-blue-hover"
                                >
                                  Intake {source.intakeId}
                                  <ArrowUpRight size={12} />
                                </Link>
                              ) : null}
                              {source.documentId ? (
                                <span>Document {source.documentId}</span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <StatusBadge
                              tone={billingDraftStatusTone(draft.status)}
                            >
                              {billingDraftStatusLabel(draft.status)}
                            </StatusBadge>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap gap-2">
                              <SecondaryButton
                                type="button"
                                className="min-h-9 rounded-lg px-3"
                                onClick={() =>
                                  updateDraftMutation.mutate({
                                    draftId: draft.id,
                                    status: "approved",
                                  })
                                }
                                disabled={!canApprove || isUpdating}
                                title="Marks this draft approved for later billing steps. No invoice is posted or synced."
                              >
                                {isUpdating ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <CheckCircle2 size={14} />
                                )}
                                Approve
                              </SecondaryButton>
                              <SecondaryButton
                                type="button"
                                className="min-h-9 rounded-lg px-3 text-danger"
                                onClick={() =>
                                  updateDraftMutation.mutate({
                                    draftId: draft.id,
                                    status: "void",
                                  })
                                }
                                disabled={!canVoid || isUpdating}
                                title="Voids this draft only. No invoice is posted or synced."
                              >
                                {isUpdating ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <Ban size={14} />
                                )}
                                Void
                              </SecondaryButton>
                              {invoiceDraft ? (
                                <StatusBadge
                                  tone={invoiceDraftStatusTone(
                                    invoiceDraft.status,
                                  )}
                                >
                                  Invoice {shortId(invoiceDraft.id)}
                                </StatusBadge>
                              ) : draft.status === "approved" ? (
                                <SecondaryButton
                                  type="button"
                                  className="min-h-9 rounded-lg px-3"
                                  onClick={() =>
                                    createInvoiceDraftMutation.mutate(draft.id)
                                  }
                                  disabled={isCreatingInvoice}
                                  title="Creates an internal invoice draft only. No PDF, tenant email, or Xero sync."
                                >
                                  {isCreatingInvoice ? (
                                    <Loader2
                                      size={14}
                                      className="animate-spin"
                                    />
                                  ) : (
                                    <FileCheck2 size={14} />
                                  )}
                                  Invoice draft
                                </SecondaryButton>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {!billingDraftsQuery.isLoading &&
                    billingDrafts.length === 0 ? (
                      <tr>
                        <td className="px-3 py-10" colSpan={6}>
                          <EmptyState
                            title="No billing drafts"
                            description="Reviewed invoice or admin documents will appear here as source-linked billing drafts before any invoice posting or Xero sync exists."
                          />
                        </td>
                      </tr>
                    ) : null}
                    {billingDraftsQuery.isLoading ? (
                      <tr>
                        <td
                          className="px-3 py-10 text-center text-sm text-muted-foreground"
                          colSpan={6}
                        >
                          Loading billing drafts...
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </SectionPanel>

            <SectionPanel
              title="Invoice draft staging"
              description="Approved billing drafts become internal invoice drafts here. No PDF, tenant email, or Xero sync is run from this step."
              icon={<FileCheck2 size={17} className="text-primary" />}
              actions={
                <StatusBadge tone={invoiceDrafts.length ? "primary" : "neutral"}>
                  {invoiceDrafts.length} invoice draft
                  {invoiceDrafts.length === 1 ? "" : "s"}
                </StatusBadge>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="bg-muted text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Invoice draft</th>
                      <th className="px-3 py-2 font-semibold">Recipient</th>
                      <th className="px-3 py-2 font-semibold">Amount</th>
                      <th className="px-3 py-2 font-semibold">Due</th>
                      <th className="px-3 py-2 font-semibold">Readiness</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoiceDrafts.map((draft) => {
                      const blockers = invoiceDraftBlockers(draft);
                      return (
                        <tr
                          key={draft.id}
                          className="border-t border-border align-top"
                        >
                          <td className="min-w-72 px-3 py-3">
                            <div className="font-medium">
                              {draft.invoice_number ?? `Invoice ${shortId(draft.id)}`}
                            </div>
                            <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                              {draft.title}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              Source billing draft {shortId(draft.billing_draft_id)}
                            </div>
                          </td>
                          <td className="min-w-52 px-3 py-3 text-xs">
                            <div className="font-medium text-foreground">
                              {draft.recipient_name ?? "Recipient not confirmed"}
                            </div>
                            <div className="mt-1 text-muted-foreground">
                              {draft.recipient_email ?? "Billing email missing"}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-sm font-medium">
                            {formatMoney(draft.total_cents)}
                            {draft.gst_cents ? (
                              <div className="mt-1 text-xs font-normal text-muted-foreground">
                                GST {formatMoney(draft.gst_cents)}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-3 text-xs">
                            {formatDate(draft.due_date)}
                          </td>
                          <td className="min-w-64 px-3 py-3 text-xs">
                            {blockers.length ? (
                              <div className="grid gap-1 text-muted-foreground">
                                {blockers.slice(0, 3).map((blocker) => (
                                  <span key={blocker}>{blocker}</span>
                                ))}
                                {blockers.length > 3 ? (
                                  <span>{blockers.length - 3} more blocker(s)</span>
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-leasium-success">
                                Ready for invoice approval
                              </span>
                            )}
                            <div className="mt-2 flex flex-wrap gap-2">
                              <StatusBadge tone="neutral">No PDF</StatusBadge>
                              <StatusBadge tone="neutral">No email</StatusBadge>
                              <StatusBadge tone="neutral">No Xero</StatusBadge>
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <StatusBadge tone={invoiceDraftStatusTone(draft.status)}>
                              {invoiceDraftStatusLabel(draft.status)}
                            </StatusBadge>
                          </td>
                        </tr>
                      );
                    })}
                    {!invoiceDraftsQuery.isLoading &&
                    invoiceDrafts.length === 0 ? (
                      <tr>
                        <td className="px-3 py-10" colSpan={6}>
                          <EmptyState
                            title="No invoice drafts"
                            description="Approve a billing draft, then create an internal invoice draft from it. Delivery and Xero remain separate approval steps."
                          />
                        </td>
                      </tr>
                    ) : null}
                    {invoiceDraftsQuery.isLoading ? (
                      <tr>
                        <td
                          className="px-3 py-10 text-center text-sm text-muted-foreground"
                          colSpan={6}
                        >
                          Loading invoice drafts...
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </SectionPanel>

            <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
              <SectionPanel
                title="Rent roll readiness"
                description="Each tenancy is checked from the rent roll response returned by the API."
                icon={<ReceiptText size={17} className="text-primary" />}
              >
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead className="bg-muted text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Tenancy</th>
                        <th className="px-3 py-2 font-semibold">Rent</th>
                        <th className="px-3 py-2 font-semibold">Rules</th>
                        <th className="px-3 py-2 font-semibold">Next due</th>
                        <th className="px-3 py-2 font-semibold">Readiness</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rentRows.map((row) => {
                        const blockers = blockerItems(row);
                        return (
                          <tr
                            key={`${row.property_id}-${row.tenancy_unit_id}-${row.lease_id ?? "none"}`}
                            className="border-t border-border align-top"
                          >
                            <td className="px-3 py-3">
                              <div className="font-medium">
                                {row.unit_label}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {row.property_name}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {row.tenant_name ?? "Vacant"}
                              </div>
                            </td>
                            <td className="px-3 py-3 text-xs">
                              <div>{formatMoney(row.annual_rent_cents)}</div>
                              <div className="text-muted-foreground">
                                {row.rent_frequency ?? "No frequency"}
                              </div>
                            </td>
                            <td className="px-3 py-3 text-xs">
                              <div>
                                {formatMoney(row.charge_rules_total_cents)}
                              </div>
                              <div className="text-muted-foreground">
                                {row.charge_rules?.length ?? 0} rules
                              </div>
                            </td>
                            <td className="px-3 py-3 text-xs">
                              {formatDate(row.next_due_date)}
                            </td>
                            <td className="px-3 py-3">
                              {blockers.length ? (
                                <div className="grid gap-1">
                                  {blockers.slice(0, 2).map((blocker) => (
                                    <span
                                      key={blocker.id}
                                      className="rounded bg-leasium-warning-soft px-1.5 py-0.5 text-xs text-[#B54708]"
                                    >
                                      {blockerTitle(blocker)}
                                    </span>
                                  ))}
                                  {blockers.length > 2 ? (
                                    <span className="text-xs text-muted-foreground">
                                      +{blockers.length - 2} more
                                    </span>
                                  ) : null}
                                </div>
                              ) : (
                                <StatusBadge tone="success">Ready</StatusBadge>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {!rentRollQuery.isLoading && rentRows.length === 0 ? (
                        <tr>
                          <td className="px-3 py-10" colSpan={5}>
                            <EmptyState
                              title="No rent roll rows"
                              description="Create leases and charge rules for this entity, then return here to check billing readiness."
                            />
                          </td>
                        </tr>
                      ) : null}
                      {rentRollQuery.isLoading ? (
                        <tr>
                          <td
                            className="px-3 py-10 text-center text-sm text-muted-foreground"
                            colSpan={5}
                          >
                            Loading rent roll checks...
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </SectionPanel>

              <SectionPanel
                title="Billing action queue"
                description="Prioritised work with the right record to open next."
                icon={<AlertTriangle size={17} className="text-[#B54708]" />}
              >
                {blockerGroups.length ? (
                  <div className="divide-y divide-border">
                    {blockerGroups.map((group) => (
                      <article key={group.id} className="grid gap-3 px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-medium">{group.title}</div>
                            <div className="mt-1 text-sm text-muted-foreground">
                              {group.subtitle}
                            </div>
                          </div>
                          <StatusBadge tone="warning">
                            {group.items.length} blocker
                            {group.items.length === 1 ? "" : "s"}
                          </StatusBadge>
                        </div>
                        <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                          {leaseContext(group.row)}
                        </div>
                        <div className="grid gap-2">
                          {group.items.map((item) => {
                            const action = blockerAction(item);
                            return (
                              <div
                                key={item.id}
                                className="grid gap-2 rounded-lg border border-border bg-white p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                              >
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <StatusBadge tone={kindTone(item.kind)}>
                                      {blockerChipLabel(item)}
                                    </StatusBadge>
                                    <span className="font-medium">
                                      {blockerTitle(item)}
                                    </span>
                                  </div>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {item.row.tenant_name ?? "Vacant"} /{" "}
                                    {item.row.unit_label} /{" "}
                                    {item.row.property_name}
                                  </div>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {blockerGuidance(item)}
                                  </div>
                                </div>
                                <Link
                                  href={action.href}
                                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border-strong bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
                                >
                                  <ArrowUpRight size={15} />
                                  {action.label}
                                </Link>
                              </div>
                            );
                          })}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="No billing blockers"
                    description={
                      rentRows.length
                        ? "This portfolio is ready for the next invoice run. Leasium will flag missing tenant details, charge rules, Xero mapping, and GST checks here."
                        : "Blockers will appear here once rent roll rows are available."
                    }
                  />
                )}
              </SectionPanel>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}

export default function BillingReadinessPage() {
  return (
    <QueryProvider>
      <BillingReadinessWorkspace />
    </QueryProvider>
  );
}
