"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  Eye,
  FileCheck2,
  FileWarning,
  Loader2,
  Mail,
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
  dispatchXeroInvoiceProviders,
  documentDownloadUrl,
  invoiceDraftPreviewUrl,
  listBillingDrafts,
  listEntities,
  listInvoiceDrafts,
  listMaintenanceWorkOrders,
  listRentRoll,
  type MaintenanceWorkOrderRecord,
  prepareInvoiceDraftDelivery,
  recordInvoiceDraftDelivery,
  sendInvoiceDraftDeliveryEmail,
  updateBillingDraft,
  updateInvoiceDraft,
  updateInvoiceDraftPaymentStatus,
  type BillingDraftRecord,
  type BillingDraftStatus,
  type InvoiceDraftRecord,
  type InvoiceDraftStatus,
  type RentRollRow,
} from "@/lib/api";

const ENTITY_STORAGE_KEY = "leasium.entity_id";
const EMPTY_RENT_ROWS: RentRollRow[] = [];
const EMPTY_INVOICE_DRAFTS: InvoiceDraftRecord[] = [];
const EMPTY_MAINTENANCE_WORK_ORDERS: MaintenanceWorkOrderRecord[] = [];

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

type BillingWorkspaceTab =
  | "readiness"
  | "billing-drafts"
  | "invoice-prep"
  | "delivery";

type DeliveryFilter =
  | "all"
  | "needs_action"
  | "ready_dispatch"
  | "complete"
  | "unpaid";

const billingWorkspaceTabs: Array<{
  id: BillingWorkspaceTab;
  label: string;
  description: string;
}> = [
  {
    id: "readiness",
    label: "Fix blockers",
    description: "Clear invoice, GST, Xero",
  },
  {
    id: "billing-drafts",
    label: "Review drafts",
    description: "Source-linked billing work",
  },
  {
    id: "invoice-prep",
    label: "Approve invoices",
    description: "Preview and approve",
  },
  {
    id: "delivery",
    label: "Dispatch & reconcile",
    description: "Send, sync, record payment",
  },
];

const deliveryFilters: Array<{ id: DeliveryFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "needs_action", label: "Needs action" },
  { id: "ready_dispatch", label: "Ready to dispatch" },
  { id: "complete", label: "Complete" },
  { id: "unpaid", label: "Unpaid" },
];

function billingTabFromQuery(value: string | null): BillingWorkspaceTab | null {
  return billingWorkspaceTabs.some((tab) => tab.id === value)
    ? (value as BillingWorkspaceTab)
    : null;
}

function deliveryFilterFromQuery(value: string | null): DeliveryFilter | null {
  return deliveryFilters.some((filter) => filter.id === value)
    ? (value as DeliveryFilter)
    : null;
}

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

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not recorded";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
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

function friendlyError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function shortId(value: string | null | undefined) {
  return value ? value.slice(0, 8) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function metadataRecord(value: unknown) {
  return isRecord(value) ? value : {};
}

function metadataText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function metadataRecordList(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
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

function invoiceDeliveryState(draft: InvoiceDraftRecord) {
  return metadataRecord(draft.metadata.delivery_state);
}

function invoiceDeliveryBlockers(draft: InvoiceDraftRecord) {
  return metadataStringList(draft.metadata.delivery_blockers);
}

function invoiceEmailPreview(draft: InvoiceDraftRecord) {
  const preview = metadataRecord(draft.metadata.delivery_preview);
  const email = metadataRecord(preview.email);
  const rendered = metadataRecord(email.rendered_message_preview);
  return {
    to: metadataText(email.to),
    subject: metadataText(email.subject),
    body: metadataText(email.body),
    bodyText: metadataText(rendered.body_text) ?? metadataText(email.body),
    provider: metadataText(rendered.provider) ?? "sendgrid",
    templateKey:
      metadataText(email.template_key) ?? metadataText(rendered.template_key),
    templateVersion:
      metadataText(email.template_version) ??
      metadataText(rendered.template_version),
    actionLabel: metadataText(rendered.action_label),
    actionUrl: metadataText(rendered.action_url),
  };
}

function invoicePdfArtifact(draft: InvoiceDraftRecord) {
  return metadataRecord(draft.metadata.pdf_artifact);
}

function invoiceDeliverySend(draft: InvoiceDraftRecord) {
  const email = metadataRecord(draft.metadata.delivery_email);
  return metadataRecord(email.send);
}

function invoicePaymentStatus(draft: InvoiceDraftRecord) {
  return metadataRecord(draft.metadata.payment_status);
}

function invoicePaymentReconciliationEntries(draft: InvoiceDraftRecord) {
  const history = metadataRecordList(
    draft.metadata.xero_payment_reconciliation_history,
  );
  if (history.length > 0) {
    return history;
  }
  const latest = metadataRecord(draft.metadata.xero_payment_reconciliation);
  return Object.keys(latest).length > 0 ? [latest] : [];
}

function invoiceXeroSync(draft: InvoiceDraftRecord) {
  return metadataRecord(draft.metadata.xero_sync);
}

function invoicePostingPreparation(draft: InvoiceDraftRecord) {
  return metadataRecord(draft.metadata.posting_preparation);
}

function invoiceXeroPostingApproval(draft: InvoiceDraftRecord) {
  return metadataRecord(draft.metadata.xero_posting_approval);
}

function invoiceProviderDispatch(draft: InvoiceDraftRecord) {
  return metadataRecord(draft.metadata.provider_dispatch);
}

function invoiceProviderReceipts(draft: InvoiceDraftRecord) {
  return metadataRecordList(draft.metadata.provider_status_receipts);
}

function xeroStatusTone(
  statusValue: string | null,
  approved: boolean,
): StatusTone {
  if (statusValue === "draft_created" || statusValue === "DRAFT") {
    return "success";
  }
  if (statusValue === "provider_failed") {
    return "danger";
  }
  if (!approved) {
    return "warning";
  }
  return "primary";
}

function xeroStatusLabel(
  syncState: Record<string, unknown>,
  postingPreparation: Record<string, unknown>,
  approved: boolean,
) {
  if (syncState.xero_synced === true) {
    return `Xero ${metadataText(syncState.xero_status) ?? "draft"}`;
  }
  const externalStatus = metadataText(
    postingPreparation.external_posting_status,
  );
  if (externalStatus === "provider_failed") {
    return "Xero failed";
  }
  if (!approved) {
    return "Needs Xero approval";
  }
  return "Ready for Xero";
}

function invoiceDeliveryReview(draft: InvoiceDraftRecord) {
  const deliveryState = invoiceDeliveryState(draft);
  const emailPreview = invoiceEmailPreview(draft);
  const pdfArtifact = invoicePdfArtifact(draft);
  const sendState = invoiceDeliverySend(draft);
  const paymentStatus = invoicePaymentStatus(draft);
  const xeroSync = invoiceXeroSync(draft);
  const postingPreparation = invoicePostingPreparation(draft);
  const xeroApproval = invoiceXeroPostingApproval(draft);
  const providerDispatch = invoiceProviderDispatch(draft);
  const providerDispatchXero = metadataRecord(providerDispatch.xero);
  const providerReceipts = invoiceProviderReceipts(draft);
  const latestProviderReceipt =
    providerReceipts.find(
      (receipt) => metadataText(receipt.provider) === "xero",
    ) ?? null;
  const latestProviderRetryCount =
    typeof latestProviderReceipt?.retry_count === "number"
      ? latestProviderReceipt.retry_count
      : null;
  const xeroApproved = metadataText(xeroApproval.state) === "approved";
  const xeroSynced = xeroSync.xero_synced === true;
  const xeroExternalStatus =
    metadataText(postingPreparation.external_posting_status) ??
    metadataText(providerDispatchXero.external_posting_status);
  const xeroFailed =
    xeroExternalStatus === "provider_failed" ||
    metadataText(providerDispatchXero.status) === "failed";
  const previewReady = deliveryState.pdf_preview_generated === true;
  const pdfStored =
    deliveryState.pdf_artifact_stored === true ||
    Boolean(metadataText(pdfArtifact.document_id));
  const emailPrepared = deliveryState.tenant_email_prepared === true;
  const deliveryReady = deliveryState.delivery_ready === true;
  const deliverySent =
    deliveryState.tenant_email_sent === true ||
    ["queued", "sent", "delivered", "opened"].includes(
      metadataText(sendState.status) ?? "",
    );
  const emailFailed = metadataText(sendState.status) === "failed";
  const providerComplete = xeroSynced && deliverySent;
  const paymentLabel = metadataText(paymentStatus.status) ?? "unpaid";
  const readyForProviderDispatch =
    deliveryReady && xeroApproved && !providerComplete;
  const needsAction =
    xeroFailed ||
    emailFailed ||
    !xeroApproved ||
    readyForProviderDispatch ||
    paymentLabel !== "paid";

  return {
    deliveryState,
    emailPreview,
    pdfArtifact,
    sendState,
    paymentStatus,
    xeroSync,
    postingPreparation,
    xeroApproval,
    providerDispatch,
    providerDispatchXero,
    providerReceipts,
    latestProviderReceipt,
    latestProviderRetryCount,
    xeroApproved,
    xeroSynced,
    xeroExternalStatus,
    xeroFailed,
    previewReady,
    pdfStored,
    emailPrepared,
    deliveryReady,
    deliverySent,
    emailFailed,
    providerComplete,
    paymentLabel,
    readyForProviderDispatch,
    needsAction,
  };
}

function deliveryFilterMatches(
  draft: InvoiceDraftRecord,
  filter: DeliveryFilter,
) {
  const review = invoiceDeliveryReview(draft);
  switch (filter) {
    case "needs_action":
      return review.needsAction;
    case "ready_dispatch":
      return review.readyForProviderDispatch;
    case "complete":
      return review.providerComplete && review.paymentLabel === "paid";
    case "unpaid":
      return review.paymentLabel !== "paid";
    default:
      return true;
  }
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
    success: "bg-leasium-success-soft text-leasium-success-strong",
    warning: "bg-leasium-warning-soft text-leasium-warning-strong",
    danger: "bg-leasium-danger-soft text-leasium-danger-strong",
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
  const [activeBillingTab, setActiveBillingTab] =
    useState<BillingWorkspaceTab>("readiness");
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>("all");
  const [highlightInvoiceDraftId, setHighlightInvoiceDraftId] = useState("");

  const entitiesQuery = useQuery({
    queryKey: ["entities"],
    queryFn: listEntities,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = billingTabFromQuery(params.get("tab"));
    const filter = deliveryFilterFromQuery(params.get("filter"));
    if (tab) {
      setActiveBillingTab(tab);
    }
    if (filter) {
      setDeliveryFilter(filter);
    }
    setSelectedEntityId(params.get("entity_id") ?? "");
    setHighlightInvoiceDraftId(params.get("invoice_id") ?? "");
  }, []);

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
  const maintenanceQuery = useQuery({
    queryKey: ["billing-readiness-maintenance", selectedEntityId],
    queryFn: () => listMaintenanceWorkOrders({ entity_id: selectedEntityId }),
    enabled: Boolean(selectedEntityId),
  });
  const entitiesLoading =
    !entitiesQuery.data &&
    (entitiesQuery.isLoading || entitiesQuery.isFetching);
  const entitySelectionLoading =
    entitiesLoading ||
    (!selectedEntityId && (entitiesQuery.data?.length ?? 0) > 0);
  const rentRollLoading =
    Boolean(selectedEntityId) &&
    !rentRollQuery.data &&
    (rentRollQuery.isLoading || rentRollQuery.isFetching);
  const billingDraftsLoading =
    Boolean(selectedEntityId) &&
    !billingDraftsQuery.data &&
    (billingDraftsQuery.isLoading || billingDraftsQuery.isFetching);
  const invoiceDraftsLoading =
    Boolean(selectedEntityId) &&
    !invoiceDraftsQuery.data &&
    (invoiceDraftsQuery.isLoading || invoiceDraftsQuery.isFetching);
  const billingReadinessLoading =
    entitySelectionLoading ||
    rentRollLoading ||
    billingDraftsLoading ||
    invoiceDraftsLoading;
  const billingReadinessRefreshing =
    Boolean(selectedEntityId) &&
    (rentRollQuery.isFetching ||
      billingDraftsQuery.isFetching ||
      invoiceDraftsQuery.isFetching) &&
    !billingReadinessLoading;
  const billingReadinessError =
    entitiesQuery.error ??
    rentRollQuery.error ??
    billingDraftsQuery.error ??
    invoiceDraftsQuery.error;

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
    mutationFn: (draftId: string) =>
      createInvoiceDraftFromBillingDraft(draftId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["billing-readiness-drafts", selectedEntityId],
      });
      queryClient.invalidateQueries({
        queryKey: ["billing-readiness-invoice-drafts", selectedEntityId],
      });
    },
  });

  const prepareInvoiceDraftMutation = useMutation({
    mutationFn: (draftId: string) => prepareInvoiceDraftDelivery(draftId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["billing-readiness-invoice-drafts", selectedEntityId],
      });
    },
  });

  const updateInvoiceDraftMutation = useMutation({
    mutationFn: ({
      draftId,
      status,
    }: {
      draftId: string;
      status: InvoiceDraftStatus;
    }) => updateInvoiceDraft(draftId, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["billing-readiness-invoice-drafts", selectedEntityId],
      });
    },
  });

  const recordInvoiceDeliveryMutation = useMutation({
    mutationFn: (draftId: string) =>
      recordInvoiceDraftDelivery(draftId, { method: "manual" }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["billing-readiness-invoice-drafts", selectedEntityId],
      });
    },
  });

  const sendInvoiceDeliveryEmailMutation = useMutation({
    mutationFn: (draftId: string) => sendInvoiceDraftDeliveryEmail(draftId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["billing-readiness-invoice-drafts", selectedEntityId],
      });
    },
  });

  const dispatchInvoiceProvidersMutation = useMutation({
    mutationFn: (draftId: string) =>
      dispatchXeroInvoiceProviders(selectedEntityId, {
        invoice_draft_ids: [draftId],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["billing-readiness-invoice-drafts", selectedEntityId],
      });
      queryClient.invalidateQueries({
        queryKey: ["billing-readiness-rent-roll", selectedEntityId],
      });
    },
  });

  const updatePaymentStatusMutation = useMutation({
    mutationFn: ({
      draftId,
      paymentStatus,
    }: {
      draftId: string;
      paymentStatus: "unpaid" | "partially_paid" | "paid";
    }) =>
      updateInvoiceDraftPaymentStatus(draftId, {
        status: paymentStatus,
        paid_cents: paymentStatus === "paid" ? null : undefined,
      }),
    onSuccess: () => {
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
  const maintenanceWorkOrders =
    maintenanceQuery.data ?? EMPTY_MAINTENANCE_WORK_ORDERS;
  const maintenanceByInvoiceDraftId = useMemo(() => {
    const rows = new Map<string, MaintenanceWorkOrderRecord>();
    for (const workOrder of maintenanceWorkOrders) {
      if (workOrder.invoice_draft_id && !rows.has(workOrder.invoice_draft_id)) {
        rows.set(workOrder.invoice_draft_id, workOrder);
      }
    }
    return rows;
  }, [maintenanceWorkOrders]);
  const highlightedInvoiceDraft = useMemo(
    () =>
      highlightInvoiceDraftId
        ? (invoiceDrafts.find(
            (draft) => draft.id === highlightInvoiceDraftId,
          ) ?? null)
        : null,
    [highlightInvoiceDraftId, invoiceDrafts],
  );
  const highlightedMaintenanceWorkOrder = highlightedInvoiceDraft
    ? (maintenanceByInvoiceDraftId.get(highlightedInvoiceDraft.id) ?? null)
    : null;
  const approvedInvoiceDrafts = useMemo(
    () => invoiceDrafts.filter((draft) => draft.status === "approved"),
    [invoiceDrafts],
  );
  const filteredApprovedInvoiceDrafts = useMemo(
    () =>
      approvedInvoiceDrafts.filter((draft) =>
        deliveryFilterMatches(draft, deliveryFilter),
      ),
    [approvedInvoiceDrafts, deliveryFilter],
  );
  const deliveryFilterCounts = useMemo(
    () =>
      Object.fromEntries(
        deliveryFilters.map((filter) => [
          filter.id,
          approvedInvoiceDrafts.filter((draft) =>
            deliveryFilterMatches(draft, filter.id),
          ).length,
        ]),
      ) as Record<DeliveryFilter, number>,
    [approvedInvoiceDrafts],
  );
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
          <option value="">
            {entitiesLoading ? "Loading entities..." : "Select entity"}
          </option>
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
                  maintenanceQuery.refetch();
                }}
                disabled={
                  !selectedEntityId ||
                  rentRollQuery.isFetching ||
                  billingDraftsQuery.isFetching ||
                  invoiceDraftsQuery.isFetching
                }
              >
                {billingReadinessRefreshing ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <RefreshCw size={15} />
                )}
                {billingReadinessRefreshing ? "Refreshing" : "Refresh"}
              </SecondaryButton>
            </>
          }
        />

        {billingReadinessError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-danger/20 bg-leasium-danger-soft p-4 text-sm text-danger">
            <div>
              <div className="font-semibold">
                Billing data did not finish loading.
              </div>
              <div className="mt-1">
                {friendlyError(
                  billingReadinessError,
                  "Could not load billing readiness.",
                )}
              </div>
            </div>
            <SecondaryButton
              type="button"
              onClick={() => {
                entitiesQuery.refetch();
                if (selectedEntityId) {
                  rentRollQuery.refetch();
                  billingDraftsQuery.refetch();
                  invoiceDraftsQuery.refetch();
                }
              }}
            >
              <RefreshCw size={15} />
              Retry
            </SecondaryButton>
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
        {prepareInvoiceDraftMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {prepareInvoiceDraftMutation.error instanceof Error
              ? prepareInvoiceDraftMutation.error.message
              : "Could not prepare invoice delivery."}
          </div>
        ) : null}
        {updateInvoiceDraftMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {updateInvoiceDraftMutation.error instanceof Error
              ? updateInvoiceDraftMutation.error.message
              : "Could not update the invoice draft."}
          </div>
        ) : null}
        {recordInvoiceDeliveryMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {friendlyError(
              recordInvoiceDeliveryMutation.error,
              "Could not record invoice delivery.",
            )}
          </div>
        ) : null}
        {updatePaymentStatusMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {friendlyError(
              updatePaymentStatusMutation.error,
              "Could not update payment status.",
            )}
          </div>
        ) : null}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <KpiCard
            title="Ready to bill"
            value={billingReadinessLoading ? "..." : counts.ready}
            detail={
              billingReadinessLoading
                ? "Loading rent roll readiness checks."
                : `${rentRows.length} rent roll rows checked as at ${formatDate(asOf)}.`
            }
            icon={<CheckCircle2 size={18} />}
            tone={billingReadinessLoading ? "neutral" : "success"}
          />
          <KpiCard
            title="Blocked tenancies"
            value={billingReadinessLoading ? "..." : rowsWithBlockers.length}
            detail="Tenancies with at least one invoice, Xero, or GST issue."
            icon={<AlertTriangle size={18} />}
            tone={
              billingReadinessLoading
                ? "neutral"
                : rowsWithBlockers.length
                  ? "danger"
                  : "success"
            }
          />
          <KpiCard
            title="Missing billing details"
            value={
              billingReadinessLoading ? "..." : counts.missingBillingDetails
            }
            detail="Tenant billing contacts or invoice details that need cleanup."
            icon={<ReceiptText size={18} />}
            tone={
              billingReadinessLoading
                ? "neutral"
                : counts.missingBillingDetails
                  ? "warning"
                  : "success"
            }
          />
          <KpiCard
            title="Missing Xero mapping"
            value={billingReadinessLoading ? "..." : counts.xero}
            detail="Customer mapping, account code, or tax type issues blocking sync."
            icon={<FileWarning size={18} />}
            tone={
              billingReadinessLoading
                ? "neutral"
                : counts.xero
                  ? "warning"
                  : "success"
            }
          />
          <KpiCard
            title="GST checks"
            value={billingReadinessLoading ? "..." : counts.gst}
            detail="Tax treatment checks that need attention before invoices are raised."
            icon={<ShieldCheck size={18} />}
            tone={
              billingReadinessLoading
                ? "neutral"
                : counts.gst
                  ? "primary"
                  : "success"
            }
          />
        </section>

        {billingReadinessLoading && !billingReadinessError ? (
          <SectionPanel
            title="Loading billing workspace"
            description={
              selectedEntity
                ? `Checking rent roll, billing drafts, and invoice drafts for ${selectedEntity.name}.`
                : "Connecting to the live billing workspace and selecting an entity."
            }
            icon={<Loader2 size={17} className="animate-spin text-primary" />}
            actions={
              <StatusBadge
                tone={billingReadinessRefreshing ? "primary" : "neutral"}
              >
                {billingReadinessRefreshing ? "Refreshing" : "Loading"}
              </StatusBadge>
            }
            className="border-primary/20 bg-primary/5"
          >
            <div className="grid gap-3 p-4 text-sm text-muted-foreground sm:grid-cols-4">
              <div className="rounded-xl border border-border bg-white px-3 py-2">
                Action queue
              </div>
              <div className="rounded-xl border border-border bg-white px-3 py-2">
                Rent roll checks
              </div>
              <div className="rounded-xl border border-border bg-white px-3 py-2">
                Billing drafts
              </div>
              <div className="rounded-xl border border-border bg-white px-3 py-2">
                Invoice staging
              </div>
            </div>
          </SectionPanel>
        ) : null}

        {!selectedEntityId && !billingReadinessLoading ? (
          <SectionPanel>
            <EmptyState
              title="No entity selected"
              description="Choose an entity from the header to load billing readiness checks. Leasium will show invoice, Xero, and GST blockers here."
            />
          </SectionPanel>
        ) : null}

        {selectedEntityId ? (
          <>
            <div
              className="grid gap-2 rounded-2xl border border-border bg-white p-2 shadow-leasiumXs md:grid-cols-4"
              role="tablist"
              aria-label="Billing readiness sections"
            >
              {billingWorkspaceTabs.map((tab) => {
                const isActive = activeBillingTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveBillingTab(tab.id)}
                    className={`grid min-h-16 gap-1 rounded-xl px-3 py-2 text-left transition duration-200 ease-leasium ${
                      isActive
                        ? "bg-primary text-primary-foreground shadow-leasiumXs"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <span className="text-sm font-semibold">{tab.label}</span>
                    <span
                      className={`text-xs ${
                        isActive ? "text-primary-foreground/80" : ""
                      }`}
                    >
                      {tab.description}
                    </span>
                  </button>
                );
              })}
            </div>

            {highlightedInvoiceDraft ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm shadow-leasiumXs">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone="primary">Operations handoff</StatusBadge>
                    <span className="font-semibold text-foreground">
                      {highlightedInvoiceDraft.invoice_number ??
                        `Invoice ${shortId(highlightedInvoiceDraft.id)}`}
                    </span>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    Review this linked maintenance invoice here; provider
                    dispatch, tenant email, and payment reconciliation still
                    require explicit approval.
                  </div>
                </div>
                {highlightedMaintenanceWorkOrder ? (
                  <Link
                    href={`/operations/maintenance/${highlightedMaintenanceWorkOrder.id}`}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border-strong bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
                  >
                    <ArrowUpRight size={15} />
                    Open work order
                  </Link>
                ) : null}
              </div>
            ) : null}

            {activeBillingTab === "billing-drafts" ? (
              <SectionPanel
                title="Billing draft review"
                description="Source-linked Smart Intake drafts for review only. Approve or void updates draft status; it does not post an invoice, email a tenant, or sync to Xero."
                icon={<ReceiptText size={17} className="text-primary" />}
                actions={
                  <StatusBadge
                    tone={
                      billingDraftsLoading
                        ? "neutral"
                        : billingDrafts.length
                          ? "primary"
                          : "neutral"
                    }
                  >
                    {billingDraftsLoading
                      ? "Loading"
                      : `${billingDrafts.length} draft${billingDrafts.length === 1 ? "" : "s"}`}
                  </StatusBadge>
                }
              >
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm tabular-nums">
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
                          draft.status !== "approved" &&
                          draft.status !== "void";
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
                                    <Loader2
                                      size={14}
                                      className="animate-spin"
                                    />
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
                                    <Loader2
                                      size={14}
                                      className="animate-spin"
                                    />
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
                                      createInvoiceDraftMutation.mutate(
                                        draft.id,
                                      )
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
                      {!billingDraftsLoading && billingDrafts.length === 0 ? (
                        <tr>
                          <td className="px-3 py-10" colSpan={6}>
                            <EmptyState
                              title="No billing drafts"
                              description="Reviewed invoice or admin documents will appear here as source-linked billing drafts before any invoice posting or Xero sync exists."
                            />
                          </td>
                        </tr>
                      ) : null}
                      {billingDraftsLoading ? (
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
            ) : null}

            {activeBillingTab === "invoice-prep" ? (
              <SectionPanel
                title="Invoice preparation"
                description="Approved billing drafts become internal invoice drafts. Prepare the preview, store the PDF artifact, and approve only when blockers are clear."
                icon={<FileCheck2 size={17} className="text-primary" />}
                actions={
                  <StatusBadge
                    tone={
                      invoiceDraftsLoading
                        ? "neutral"
                        : invoiceDrafts.length
                          ? "primary"
                          : "neutral"
                    }
                  >
                    {invoiceDraftsLoading
                      ? "Loading"
                      : `${invoiceDrafts.length} invoice draft${invoiceDrafts.length === 1 ? "" : "s"}`}
                  </StatusBadge>
                }
              >
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm tabular-nums">
                    <thead className="bg-muted text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-semibold">
                          Invoice draft
                        </th>
                        <th className="px-3 py-2 font-semibold">Recipient</th>
                        <th className="px-3 py-2 font-semibold">Amount</th>
                        <th className="px-3 py-2 font-semibold">Due</th>
                        <th className="px-3 py-2 font-semibold">Readiness</th>
                        <th className="px-3 py-2 font-semibold">Status</th>
                        <th className="px-3 py-2 font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoiceDrafts.map((draft) => {
                        const blockers = invoiceDraftBlockers(draft);
                        const deliveryBlockers = invoiceDeliveryBlockers(draft);
                        const deliveryState = invoiceDeliveryState(draft);
                        const emailPreview = invoiceEmailPreview(draft);
                        const pdfArtifact = invoicePdfArtifact(draft);
                        const sendState = invoiceDeliverySend(draft);
                        const paymentStatus = invoicePaymentStatus(draft);
                        const previewReady =
                          deliveryState.pdf_preview_generated === true;
                        const pdfStored =
                          deliveryState.pdf_artifact_stored === true ||
                          Boolean(metadataText(pdfArtifact.document_id));
                        const emailPrepared =
                          deliveryState.tenant_email_prepared === true;
                        const deliveryReady =
                          deliveryState.delivery_ready === true;
                        const deliverySent =
                          deliveryState.tenant_email_sent === true ||
                          metadataText(sendState.status) === "sent";
                        const paymentLabel =
                          metadataText(paymentStatus.status) ?? "unpaid";
                        const isPreparing =
                          prepareInvoiceDraftMutation.isPending &&
                          prepareInvoiceDraftMutation.variables === draft.id;
                        const isUpdatingInvoice =
                          updateInvoiceDraftMutation.isPending &&
                          updateInvoiceDraftMutation.variables?.draftId ===
                            draft.id;
                        const canPrepare =
                          draft.status !== "void" &&
                          draft.status !== "approved";
                        const canApprove =
                          draft.status === "ready_for_approval" &&
                          deliveryReady;
                        const canVoid = draft.status !== "void";
                        const linkedWorkOrder = maintenanceByInvoiceDraftId.get(
                          draft.id,
                        );
                        const isHighlighted =
                          highlightInvoiceDraftId === draft.id;
                        return (
                          <tr
                            key={draft.id}
                            className={`border-t border-border align-top ${
                              isHighlighted ? "bg-primary/5" : ""
                            }`}
                          >
                            <td className="min-w-72 px-3 py-3">
                              <div className="font-medium">
                                {draft.invoice_number ??
                                  `Invoice ${shortId(draft.id)}`}
                              </div>
                              <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                {draft.title}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                Source billing draft{" "}
                                {shortId(draft.billing_draft_id)}
                              </div>
                              {linkedWorkOrder ? (
                                <Link
                                  href={`/operations/maintenance/${linkedWorkOrder.id}`}
                                  className="mt-2 inline-flex min-h-8 items-center gap-2 rounded-lg border border-border bg-white px-2.5 text-xs font-semibold text-slate shadow-leasiumXs hover:bg-muted"
                                >
                                  <ArrowUpRight size={13} />
                                  Maintenance: {linkedWorkOrder.title}
                                </Link>
                              ) : null}
                            </td>
                            <td className="min-w-52 px-3 py-3 text-xs">
                              <div className="font-medium text-foreground">
                                {draft.recipient_name ??
                                  "Recipient not confirmed"}
                              </div>
                              <div className="mt-1 text-muted-foreground">
                                {draft.recipient_email ??
                                  "Billing email missing"}
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
                                    <span>
                                      {blockers.length - 3} more blocker(s)
                                    </span>
                                  ) : null}
                                </div>
                              ) : (
                                <span className="text-leasium-success">
                                  Ready for invoice approval
                                </span>
                              )}
                              <div className="mt-2 flex flex-wrap gap-2">
                                <StatusBadge
                                  tone={pdfStored ? "primary" : "neutral"}
                                >
                                  {pdfStored ? "PDF stored" : "No PDF"}
                                </StatusBadge>
                                <StatusBadge
                                  tone={
                                    deliverySent
                                      ? "success"
                                      : emailPrepared
                                        ? "primary"
                                        : "neutral"
                                  }
                                >
                                  {deliverySent
                                    ? "Email sent"
                                    : emailPrepared
                                      ? "Email draft"
                                      : "No email"}
                                </StatusBadge>
                                {emailPreview.templateKey ? (
                                  <StatusBadge tone="neutral">
                                    {emailPreview.templateKey}{" "}
                                    {emailPreview.templateVersion ?? "v1"}
                                  </StatusBadge>
                                ) : null}
                                <StatusBadge
                                  tone={
                                    paymentLabel === "paid"
                                      ? "success"
                                      : "neutral"
                                  }
                                >
                                  {paymentLabel.replaceAll("_", " ")}
                                </StatusBadge>
                                <StatusBadge tone="neutral">
                                  No Xero
                                </StatusBadge>
                              </div>
                              {deliveryBlockers.length ? (
                                <div className="mt-2 grid gap-1 text-danger">
                                  {deliveryBlockers
                                    .slice(0, 2)
                                    .map((blocker) => (
                                      <span key={blocker}>{blocker}</span>
                                    ))}
                                </div>
                              ) : null}
                              {emailPreview.subject ? (
                                <div className="mt-2 line-clamp-2 text-muted-foreground">
                                  {emailPreview.subject}
                                </div>
                              ) : null}
                              {emailPreview.bodyText ? (
                                <details className="mt-2 rounded-lg border border-border bg-white">
                                  <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-primary hover:text-leasium-blue-hover">
                                    Message preview
                                  </summary>
                                  <div className="border-t border-border px-3 py-2 text-xs">
                                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                                      <span>Email</span>
                                      <span>{emailPreview.provider}</span>
                                      {emailPreview.to ? (
                                        <span>{emailPreview.to}</span>
                                      ) : null}
                                      {emailPreview.templateKey ? (
                                        <span>
                                          {emailPreview.templateKey}{" "}
                                          {emailPreview.templateVersion ?? "v1"}
                                        </span>
                                      ) : null}
                                    </div>
                                    {emailPreview.subject ? (
                                      <div className="mt-2 font-semibold text-foreground">
                                        {emailPreview.subject}
                                      </div>
                                    ) : null}
                                    <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap rounded-md bg-muted/45 p-2 font-sans text-xs leading-5 text-muted-foreground">
                                      {emailPreview.bodyText}
                                    </pre>
                                    {emailPreview.actionLabel &&
                                    emailPreview.actionUrl ? (
                                      <a
                                        href={emailPreview.actionUrl}
                                        className="mt-2 inline-flex text-xs font-semibold text-primary hover:text-leasium-blue-hover"
                                      >
                                        {emailPreview.actionLabel}
                                      </a>
                                    ) : null}
                                  </div>
                                </details>
                              ) : null}
                            </td>
                            <td className="px-3 py-3">
                              <StatusBadge
                                tone={invoiceDraftStatusTone(draft.status)}
                              >
                                {invoiceDraftStatusLabel(draft.status)}
                              </StatusBadge>
                            </td>
                            <td className="min-w-72 px-3 py-3">
                              <div className="flex flex-wrap gap-2">
                                <SecondaryButton
                                  type="button"
                                  className="min-h-9 rounded-lg px-3"
                                  onClick={() =>
                                    prepareInvoiceDraftMutation.mutate(draft.id)
                                  }
                                  disabled={!canPrepare || isPreparing}
                                  title="Stores the invoice PDF artifact and prepares the email draft. Nothing is sent or synced."
                                >
                                  {isPreparing ? (
                                    <Loader2
                                      size={14}
                                      className="animate-spin"
                                    />
                                  ) : (
                                    <Mail size={14} />
                                  )}
                                  Prepare
                                </SecondaryButton>
                                {previewReady ? (
                                  <a
                                    href={invoiceDraftPreviewUrl(draft.id)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-white px-3 text-sm font-semibold text-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
                                  >
                                    <Eye size={14} />
                                    Preview
                                  </a>
                                ) : null}
                                {pdfStored &&
                                metadataText(pdfArtifact.document_id) ? (
                                  <a
                                    href={documentDownloadUrl(
                                      metadataText(pdfArtifact.document_id) ??
                                        "",
                                    )}
                                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-white px-3 text-sm font-semibold text-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
                                  >
                                    <ReceiptText size={14} />
                                    PDF
                                  </a>
                                ) : null}
                                <SecondaryButton
                                  type="button"
                                  className="min-h-9 rounded-lg px-3"
                                  onClick={() =>
                                    updateInvoiceDraftMutation.mutate({
                                      draftId: draft.id,
                                      status: "approved",
                                    })
                                  }
                                  disabled={!canApprove || isUpdatingInvoice}
                                  title="Approves the internal invoice draft only. No tenant email or Xero sync is run."
                                >
                                  {isUpdatingInvoice ? (
                                    <Loader2
                                      size={14}
                                      className="animate-spin"
                                    />
                                  ) : (
                                    <CheckCircle2 size={14} />
                                  )}
                                  Approve
                                </SecondaryButton>
                                <SecondaryButton
                                  type="button"
                                  className="min-h-9 rounded-lg px-3 text-danger"
                                  onClick={() =>
                                    updateInvoiceDraftMutation.mutate({
                                      draftId: draft.id,
                                      status: "void",
                                    })
                                  }
                                  disabled={!canVoid || isUpdatingInvoice}
                                  title="Voids this internal invoice draft only."
                                >
                                  {isUpdatingInvoice ? (
                                    <Loader2
                                      size={14}
                                      className="animate-spin"
                                    />
                                  ) : (
                                    <Ban size={14} />
                                  )}
                                  Void
                                </SecondaryButton>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {!invoiceDraftsLoading && invoiceDrafts.length === 0 ? (
                        <tr>
                          <td className="px-3 py-10" colSpan={7}>
                            <EmptyState
                              title="No invoice drafts"
                              description="Approve a billing draft, then create an internal invoice draft from it. Delivery and Xero remain separate approval steps."
                            />
                          </td>
                        </tr>
                      ) : null}
                      {invoiceDraftsLoading ? (
                        <tr>
                          <td
                            className="px-3 py-10 text-center text-sm text-muted-foreground"
                            colSpan={7}
                          >
                            Loading invoice drafts...
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </SectionPanel>
            ) : null}

            {activeBillingTab === "delivery" ? (
              <SectionPanel
                title="Delivery & payments"
                description="Send approved invoice emails when the provider is configured, or record manual delivery and payment status. Xero sync still needs a separate approval."
                icon={<Mail size={17} className="text-primary" />}
                actions={
                  <StatusBadge
                    tone={
                      invoiceDraftsLoading
                        ? "neutral"
                        : approvedInvoiceDrafts.length
                          ? "primary"
                          : "neutral"
                    }
                  >
                    {invoiceDraftsLoading
                      ? "Loading"
                      : `${filteredApprovedInvoiceDrafts.length}/${approvedInvoiceDrafts.length} shown`}
                  </StatusBadge>
                }
              >
                <div className="border-b border-border p-3">
                  <div className="flex flex-wrap gap-2">
                    {deliveryFilters.map((filter) => {
                      const isActive = deliveryFilter === filter.id;
                      return (
                        <button
                          key={filter.id}
                          type="button"
                          aria-pressed={isActive}
                          onClick={() => setDeliveryFilter(filter.id)}
                          className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition duration-200 ease-leasium ${
                            isActive
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-white text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`}
                        >
                          {filter.label}
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${
                              isActive
                                ? "bg-white/20 text-primary-foreground"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {deliveryFilterCounts[filter.id]}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm tabular-nums">
                    <thead className="bg-muted text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Invoice</th>
                        <th className="px-3 py-2 font-semibold">Recipient</th>
                        <th className="px-3 py-2 font-semibold">Delivery</th>
                        <th className="px-3 py-2 font-semibold">Payment</th>
                        <th className="px-3 py-2 font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredApprovedInvoiceDrafts.map((draft) => {
                        const review = invoiceDeliveryReview(draft);
                        const {
                          emailPreview,
                          pdfArtifact,
                          sendState,
                          xeroSync,
                          postingPreparation,
                          providerReceipts,
                          latestProviderReceipt,
                          latestProviderRetryCount,
                          xeroApproved,
                          xeroExternalStatus,
                          xeroFailed,
                          previewReady,
                          pdfStored,
                          emailPrepared,
                          deliveryReady,
                          deliverySent,
                          emailFailed,
                          providerComplete,
                          paymentLabel,
                        } = review;
                        const paymentReconciliationEntries =
                          invoicePaymentReconciliationEntries(draft);
                        const isRecordingDelivery =
                          recordInvoiceDeliveryMutation.isPending &&
                          recordInvoiceDeliveryMutation.variables === draft.id;
                        const isSendingEmail =
                          sendInvoiceDeliveryEmailMutation.isPending &&
                          sendInvoiceDeliveryEmailMutation.variables ===
                            draft.id;
                        const isDispatchingProviders =
                          dispatchInvoiceProvidersMutation.isPending &&
                          dispatchInvoiceProvidersMutation.variables ===
                            draft.id;
                        const isUpdatingPayment =
                          updatePaymentStatusMutation.isPending &&
                          updatePaymentStatusMutation.variables?.draftId ===
                            draft.id;
                        const canRecordDelivery =
                          deliveryReady && !deliverySent;
                        const canDispatchProviders =
                          deliveryReady && xeroApproved && !providerComplete;
                        const canMarkPaid = paymentLabel !== "paid";
                        const linkedWorkOrder = maintenanceByInvoiceDraftId.get(
                          draft.id,
                        );
                        const isHighlighted =
                          highlightInvoiceDraftId === draft.id;
                        const providerExceptionReason = xeroFailed
                          ? (metadataText(
                              postingPreparation.last_provider_reason,
                            ) ??
                            metadataText(latestProviderReceipt?.reason) ??
                            "Xero provider dispatch failed.")
                          : emailFailed
                            ? (metadataText(sendState.error) ??
                              "Tenant invoice email provider delivery failed.")
                            : null;
                        return (
                          <tr
                            key={draft.id}
                            className={`border-t border-border align-top ${
                              isHighlighted ? "bg-primary/5" : ""
                            }`}
                          >
                            <td className="min-w-72 px-3 py-3">
                              <div className="font-medium">
                                {draft.invoice_number ??
                                  `Invoice ${shortId(draft.id)}`}
                              </div>
                              <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                {draft.title}
                              </div>
                              {linkedWorkOrder ? (
                                <Link
                                  href={`/operations/maintenance/${linkedWorkOrder.id}`}
                                  className="mt-2 inline-flex min-h-8 items-center gap-2 rounded-lg border border-border bg-white px-2.5 text-xs font-semibold text-slate shadow-leasiumXs hover:bg-muted"
                                >
                                  <ArrowUpRight size={13} />
                                  Maintenance: {linkedWorkOrder.title}
                                </Link>
                              ) : null}
                              <div className="mt-2 flex flex-wrap gap-2">
                                <StatusBadge tone="success">
                                  Approved
                                </StatusBadge>
                                <StatusBadge
                                  tone={xeroStatusTone(
                                    xeroExternalStatus ??
                                      metadataText(xeroSync.xero_status),
                                    xeroApproved,
                                  )}
                                >
                                  {xeroStatusLabel(
                                    xeroSync,
                                    postingPreparation,
                                    xeroApproved,
                                  )}
                                </StatusBadge>
                              </div>
                              {latestProviderReceipt ? (
                                <div className="mt-2 text-xs text-muted-foreground">
                                  Xero receipt{" "}
                                  {metadataText(latestProviderReceipt.status) ??
                                    "recorded"}
                                  {latestProviderRetryCount
                                    ? ` #${latestProviderRetryCount}`
                                    : ""}
                                </div>
                              ) : null}
                            </td>
                            <td className="min-w-52 px-3 py-3 text-xs">
                              <div className="font-medium text-foreground">
                                {draft.recipient_name ??
                                  "Recipient not confirmed"}
                              </div>
                              <div className="mt-1 text-muted-foreground">
                                {draft.recipient_email ??
                                  "Billing email missing"}
                              </div>
                              {emailPreview.subject ? (
                                <div className="mt-2 line-clamp-2 text-muted-foreground">
                                  {emailPreview.subject}
                                </div>
                              ) : null}
                            </td>
                            <td className="min-w-56 px-3 py-3">
                              <div className="flex flex-wrap gap-2">
                                <StatusBadge
                                  tone={pdfStored ? "primary" : "neutral"}
                                >
                                  {pdfStored ? "PDF stored" : "No PDF"}
                                </StatusBadge>
                                <StatusBadge
                                  tone={
                                    deliverySent
                                      ? "success"
                                      : emailPrepared
                                        ? "primary"
                                        : "neutral"
                                  }
                                >
                                  {deliverySent
                                    ? "Marked sent"
                                    : emailPrepared
                                      ? "Email draft"
                                      : "No email"}
                                </StatusBadge>
                              </div>
                              <div className="mt-2 text-xs text-muted-foreground">
                                {metadataText(sendState.provider)
                                  ? `${metadataText(sendState.provider)}: ${metadataText(sendState.status) ?? "not sent"}`
                                  : "Email is only sent after explicit approval."}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {xeroFailed
                                  ? (metadataText(
                                      postingPreparation.last_provider_reason,
                                    ) ??
                                    "Xero provider failed. Retry when ready.")
                                  : providerComplete
                                    ? "Xero draft and tenant email are recorded."
                                    : xeroApproved
                                      ? "Dispatch creates or reuses Xero first, then sends email."
                                      : "Approve Xero posting in Settings before provider dispatch."}
                              </div>
                              {providerExceptionReason ? (
                                <div className="mt-3 grid gap-2 rounded-md border border-danger/20 bg-leasium-danger-soft p-2 text-xs">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <StatusBadge tone="danger">
                                      Recovery needed
                                      {latestProviderRetryCount
                                        ? ` #${latestProviderRetryCount}`
                                        : ""}
                                    </StatusBadge>
                                    {linkedWorkOrder ? (
                                      <span className="font-semibold text-danger">
                                        Maintenance-linked invoice
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="text-muted-foreground">
                                    {providerExceptionReason}
                                  </div>
                                  {linkedWorkOrder ? (
                                    <div className="grid gap-1 rounded-md border border-border bg-white p-2 text-muted-foreground">
                                      <div>
                                        Work order{" "}
                                        {linkedWorkOrder.status.replaceAll(
                                          "_",
                                          " ",
                                        )}{" "}
                                        / approval{" "}
                                        {linkedWorkOrder.approval_status.replaceAll(
                                          "_",
                                          " ",
                                        )}
                                      </div>
                                      <div>
                                        Contractor{" "}
                                        {linkedWorkOrder.contractor_name ??
                                          "not assigned"}
                                      </div>
                                      <div>
                                        Retry dispatch here, then return to the
                                        work order once the provider receipt
                                        clears.
                                      </div>
                                    </div>
                                  ) : null}
                                  {linkedWorkOrder ? (
                                    <Link
                                      href={`/operations/maintenance/${linkedWorkOrder.id}`}
                                      className="inline-flex min-h-8 w-fit items-center gap-2 rounded-lg border border-border bg-white px-2.5 text-xs font-semibold text-slate shadow-leasiumXs hover:bg-muted"
                                    >
                                      <ArrowUpRight size={13} />
                                      Return to work order
                                    </Link>
                                  ) : null}
                                </div>
                              ) : null}
                              {providerReceipts.length > 0 ||
                              paymentReconciliationEntries.length > 0 ? (
                                <div className="mt-3 grid gap-2 rounded-md border border-border bg-muted/30 p-2 text-xs">
                                  <div className="font-semibold text-foreground">
                                    Provider history
                                  </div>
                                  {providerReceipts.map((receipt, index) => {
                                    const provider =
                                      metadataText(receipt.provider) ?? "xero";
                                    const statusValue =
                                      metadataText(receipt.status) ??
                                      "recorded";
                                    const retryCount =
                                      typeof receipt.retry_count === "number"
                                        ? receipt.retry_count
                                        : index + 1;
                                    const reason = metadataText(receipt.reason);
                                    return (
                                      <div
                                        key={`${provider}-${retryCount}-${metadataText(receipt.received_at) ?? index}`}
                                        className="grid gap-1"
                                      >
                                        <div className="flex flex-wrap items-center gap-2">
                                          <StatusBadge
                                            tone={
                                              statusValue === "failed"
                                                ? "danger"
                                                : "success"
                                            }
                                          >
                                            {provider} {statusValue} #
                                            {retryCount}
                                          </StatusBadge>
                                          <span className="text-muted-foreground">
                                            {formatDateTime(
                                              metadataText(receipt.received_at),
                                            )}
                                          </span>
                                        </div>
                                        {reason ? (
                                          <div className="text-muted-foreground">
                                            {reason}
                                          </div>
                                        ) : null}
                                      </div>
                                    );
                                  })}
                                  {paymentReconciliationEntries.map(
                                    (entry, index) => {
                                      const statusValue =
                                        metadataText(entry.status) ?? "paid";
                                      const matchConfidence = metadataText(
                                        entry.match_confidence,
                                      );
                                      const matchMethod = metadataText(
                                        entry.match_method,
                                      );
                                      const reference = metadataText(
                                        entry.reference,
                                      );
                                      const bankTransactionId = metadataText(
                                        entry.bank_transaction_id,
                                      );
                                      const guardrailFlags = metadataStringList(
                                        entry.guardrail_flags,
                                      );
                                      return (
                                        <div
                                          key={`payment-${metadataText(entry.idempotency_key) ?? index}`}
                                          className="grid gap-1"
                                        >
                                          <div className="flex flex-wrap items-center gap-2">
                                            <StatusBadge tone="success">
                                              Payment {statusValue}
                                            </StatusBadge>
                                            {matchConfidence ? (
                                              <StatusBadge
                                                tone={
                                                  matchConfidence === "high"
                                                    ? "success"
                                                    : matchConfidence ===
                                                        "medium"
                                                      ? "warning"
                                                      : "danger"
                                                }
                                              >
                                                {matchConfidence} confidence
                                              </StatusBadge>
                                            ) : null}
                                            <span className="text-muted-foreground">
                                              {formatDateTime(
                                                metadataText(
                                                  entry.reconciled_at,
                                                ),
                                              )}
                                            </span>
                                          </div>
                                          <div className="text-muted-foreground">
                                            Payment status was reconciled
                                            locally.
                                          </div>
                                          {matchMethod ? (
                                            <div className="text-muted-foreground">
                                              {matchMethod}
                                            </div>
                                          ) : null}
                                          {reference || bankTransactionId ? (
                                            <div className="text-muted-foreground">
                                              {[
                                                reference
                                                  ? `Ref ${reference}`
                                                  : null,
                                                bankTransactionId
                                                  ? `Bank ${bankTransactionId}`
                                                  : null,
                                              ]
                                                .filter(Boolean)
                                                .join(" / ")}
                                            </div>
                                          ) : null}
                                          {guardrailFlags.includes(
                                            "no_bank_feed_mutation",
                                          ) ? (
                                            <div className="text-muted-foreground">
                                              Bank feed was not mutated.
                                            </div>
                                          ) : null}
                                        </div>
                                      );
                                    },
                                  )}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-3 py-3">
                              <StatusBadge
                                tone={
                                  paymentLabel === "paid"
                                    ? "success"
                                    : "neutral"
                                }
                              >
                                {paymentLabel.replaceAll("_", " ")}
                              </StatusBadge>
                              <div className="mt-2 text-xs text-muted-foreground">
                                {formatMoney(draft.total_cents)} due{" "}
                                {formatDate(draft.due_date)}
                              </div>
                            </td>
                            <td className="min-w-72 px-3 py-3">
                              <div className="flex flex-wrap gap-2">
                                {previewReady ? (
                                  <a
                                    href={invoiceDraftPreviewUrl(draft.id)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-white px-3 text-sm font-semibold text-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
                                  >
                                    <Eye size={14} />
                                    Preview
                                  </a>
                                ) : null}
                                {pdfStored &&
                                metadataText(pdfArtifact.document_id) ? (
                                  <a
                                    href={documentDownloadUrl(
                                      metadataText(pdfArtifact.document_id) ??
                                        "",
                                    )}
                                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-white px-3 text-sm font-semibold text-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
                                  >
                                    <ReceiptText size={14} />
                                    PDF
                                  </a>
                                ) : null}
                                <SecondaryButton
                                  type="button"
                                  className="min-h-9 rounded-lg px-3"
                                  onClick={() =>
                                    dispatchInvoiceProvidersMutation.mutate(
                                      draft.id,
                                    )
                                  }
                                  disabled={
                                    !canDispatchProviders ||
                                    isDispatchingProviders
                                  }
                                  title="Creates or reuses the Xero DRAFT first, then sends or reuses the tenant email. Payment reconciliation stays separate."
                                >
                                  {isDispatchingProviders ? (
                                    <Loader2
                                      size={14}
                                      className="animate-spin"
                                    />
                                  ) : (
                                    <RefreshCw size={14} />
                                  )}
                                  {xeroFailed || emailFailed
                                    ? "Retry dispatch"
                                    : "Dispatch"}
                                </SecondaryButton>
                                <SecondaryButton
                                  type="button"
                                  className="min-h-9 rounded-lg px-3"
                                  onClick={() =>
                                    sendInvoiceDeliveryEmailMutation.mutate(
                                      draft.id,
                                    )
                                  }
                                  disabled={
                                    !canRecordDelivery || isSendingEmail
                                  }
                                  title="Sends the approved invoice email through the configured provider. No Xero sync is run."
                                >
                                  {isSendingEmail ? (
                                    <Loader2
                                      size={14}
                                      className="animate-spin"
                                    />
                                  ) : (
                                    <Mail size={14} />
                                  )}
                                  Email
                                </SecondaryButton>
                                <SecondaryButton
                                  type="button"
                                  className="min-h-9 rounded-lg px-3"
                                  onClick={() =>
                                    recordInvoiceDeliveryMutation.mutate(
                                      draft.id,
                                    )
                                  }
                                  disabled={
                                    !canRecordDelivery || isRecordingDelivery
                                  }
                                  title="Records the approved invoice as manually delivered to the tenant. No Xero sync is run."
                                >
                                  {isRecordingDelivery ? (
                                    <Loader2
                                      size={14}
                                      className="animate-spin"
                                    />
                                  ) : (
                                    <Mail size={14} />
                                  )}
                                  Sent
                                </SecondaryButton>
                                <SecondaryButton
                                  type="button"
                                  className="min-h-9 rounded-lg px-3"
                                  onClick={() =>
                                    updatePaymentStatusMutation.mutate({
                                      draftId: draft.id,
                                      paymentStatus: "paid",
                                    })
                                  }
                                  disabled={!canMarkPaid || isUpdatingPayment}
                                  title="Marks the approved internal invoice as paid in Leasium only."
                                >
                                  {isUpdatingPayment ? (
                                    <Loader2
                                      size={14}
                                      className="animate-spin"
                                    />
                                  ) : (
                                    <ReceiptText size={14} />
                                  )}
                                  Paid
                                </SecondaryButton>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {!invoiceDraftsLoading &&
                      approvedInvoiceDrafts.length === 0 ? (
                        <tr>
                          <td className="px-3 py-10" colSpan={5}>
                            <EmptyState
                              title="No approved invoices"
                              description="Approve an internal invoice draft first. Email sending and payment recording stay explicit, and Xero sync needs its own approval."
                            />
                          </td>
                        </tr>
                      ) : null}
                      {!invoiceDraftsLoading &&
                      approvedInvoiceDrafts.length > 0 &&
                      filteredApprovedInvoiceDrafts.length === 0 ? (
                        <tr>
                          <td className="px-3 py-10" colSpan={5}>
                            <EmptyState
                              title="No invoices match this filter"
                              description="Try another delivery filter to review approved invoice delivery, provider history, and payment status."
                            />
                          </td>
                        </tr>
                      ) : null}
                      {invoiceDraftsLoading ? (
                        <tr>
                          <td
                            className="px-3 py-10 text-center text-sm text-muted-foreground"
                            colSpan={5}
                          >
                            Loading delivery records...
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </SectionPanel>
            ) : null}

            {activeBillingTab === "readiness" ? (
              <SectionPanel
                title="Rent roll readiness"
                description="Each tenancy is checked from the rent roll response returned by the API."
                icon={<ReceiptText size={17} className="text-primary" />}
                className="order-2"
              >
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm tabular-nums">
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
                                      className="rounded bg-leasium-warning-soft px-1.5 py-0.5 text-xs text-leasium-warning-strong"
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
                      {!rentRollLoading && rentRows.length === 0 ? (
                        <tr>
                          <td className="px-3 py-10" colSpan={5}>
                            <EmptyState
                              title="No rent roll rows"
                              description="Create leases and charge rules for this entity, then return here to check billing readiness."
                            />
                          </td>
                        </tr>
                      ) : null}
                      {rentRollLoading ? (
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
            ) : null}

            {activeBillingTab === "readiness" ? (
              <SectionPanel
                title="Billing action queue"
                description="Prioritised work with the right record to open next."
                icon={<AlertTriangle size={17} className="text-leasium-warning-strong" />}
                className="order-1"
              >
                {rentRollLoading ? (
                  <EmptyState
                    title="Loading action queue"
                    description="Checking rent roll rows and readiness blockers for this entity."
                  />
                ) : blockerGroups.length ? (
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
                                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border-strong bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
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
            ) : null}
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
