"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Download,
  FileUp,
  History,
  Link2,
  Loader2,
  ReceiptText,
  RefreshCw,
  Send,
  ShieldCheck,
  UserRound,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";

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
  addMaintenanceWorkOrderComment,
  documentDownloadUrl,
  type DocumentRecord,
  getMaintenanceWorkOrder,
  type InvoiceDraftRecord,
  listDocuments,
  listInvoiceDrafts,
  listProperties,
  listTenants,
  type MaintenanceWorkOrderPayload,
  type MaintenanceWorkOrderRecord,
  type PropertyRecord,
  type TenantRecord,
  updateMaintenanceWorkOrder,
  uploadDocument,
} from "@/lib/api";

type Tone = "neutral" | "success" | "warning" | "danger" | "primary";

function label(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium" }).format(
    new Date(`${value.slice(0, 10)}T00:00:00`),
  );
}

function formatMoney(cents: number | null | undefined) {
  if (cents == null) {
    return "-";
  }
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function friendlyError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong.";
}

function statusTone(workOrder: MaintenanceWorkOrderRecord): Tone {
  if (workOrder.status === "completed") {
    return "success";
  }
  if (workOrder.status === "cancelled") {
    return "neutral";
  }
  if (workOrder.priority === "urgent" || workOrder.approval_status === "pending") {
    return "warning";
  }
  return "primary";
}

function propertyName(properties: PropertyRecord[], propertyId: string | null) {
  return properties.find((property) => property.id === propertyId)?.name ?? "Portfolio";
}

function tenantName(tenants: TenantRecord[], tenantId: string | null) {
  const tenant = tenants.find((row) => row.id === tenantId);
  return tenant?.trading_name ?? tenant?.legal_name ?? "No tenant linked";
}

function invoiceDraftLabel(draft: InvoiceDraftRecord) {
  return [
    draft.invoice_number ?? draft.title,
    label(draft.status),
    formatMoney(draft.total_cents),
  ]
    .filter(Boolean)
    .join(" - ");
}

function activityRows(workOrder: MaintenanceWorkOrderRecord) {
  const rawHistory = workOrder.metadata.activity_history;
  if (!Array.isArray(rawHistory)) {
    return [];
  }
  return rawHistory
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => ({
      at:
        typeof entry.timestamp === "string"
          ? entry.timestamp
          : typeof entry.at === "string"
            ? entry.at
            : workOrder.updated_at,
      label: label(
        typeof entry.event === "string"
          ? entry.event
          : typeof entry.action === "string"
            ? entry.action
            : "Activity",
      ),
      detail:
        typeof entry.summary === "string"
          ? typeof entry.visibility === "string"
            ? `${entry.summary} (${label(entry.visibility)})`
            : entry.summary
          : [entry.actor, entry.source].filter(Boolean).join(" - ") ||
            "Maintenance activity updated.",
    }))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

function linkedDocuments(
  workOrder: MaintenanceWorkOrderRecord,
  documents: DocumentRecord[],
) {
  const linkedIds = new Set([
    workOrder.source_document_id,
    ...workOrder.document_ids,
    ...workOrder.photo_document_ids,
  ].filter(Boolean));
  return documents.filter((document) => linkedIds.has(document.id));
}

function MaintenanceDetailRoute() {
  const params = useParams<{ workOrderId: string }>();
  const workOrderId = params.workOrderId;
  const queryClient = useQueryClient();
  const [quoteFile, setQuoteFile] = useState<File | null>(null);
  const [quoteNotes, setQuoteNotes] = useState("");
  const [invoiceDraftId, setInvoiceDraftId] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [commentVisibility, setCommentVisibility] = useState<
    "internal" | "contractor" | "tenant"
  >("internal");

  const workOrderQuery = useQuery({
    queryKey: ["maintenance-work-order", workOrderId],
    queryFn: () => getMaintenanceWorkOrder(workOrderId),
    enabled: Boolean(workOrderId),
  });
  const workOrder = workOrderQuery.data ?? null;
  const entityId = workOrder?.entity_id ?? "";

  const propertiesQuery = useQuery({
    queryKey: ["maintenance-detail-properties", entityId],
    queryFn: () => listProperties(entityId),
    enabled: Boolean(entityId),
  });
  const tenantsQuery = useQuery({
    queryKey: ["maintenance-detail-tenants", entityId],
    queryFn: () => listTenants(entityId),
    enabled: Boolean(entityId),
  });
  const invoiceDraftsQuery = useQuery({
    queryKey: ["maintenance-detail-invoice-drafts", entityId],
    queryFn: () => listInvoiceDrafts({ entity_id: entityId }),
    enabled: Boolean(entityId),
  });
  const documentsQuery = useQuery({
    queryKey: ["maintenance-detail-documents", entityId],
    queryFn: () => listDocuments({ entity_id: entityId }),
    enabled: Boolean(entityId),
  });

  const properties = propertiesQuery.data ?? [];
  const tenants = tenantsQuery.data ?? [];
  const invoiceDrafts = invoiceDraftsQuery.data ?? [];
  const documents = documentsQuery.data ?? [];
  const visibleDocuments = workOrder ? linkedDocuments(workOrder, documents) : [];
  const timeline = workOrder ? activityRows(workOrder) : [];
  const matchingInvoiceDrafts = invoiceDrafts.filter((draft) => {
    if (!workOrder) {
      return false;
    }
    if (workOrder.tenant_id && draft.tenant_id && draft.tenant_id !== workOrder.tenant_id) {
      return false;
    }
    if (
      workOrder.property_id &&
      draft.property_id &&
      draft.property_id !== workOrder.property_id
    ) {
      return false;
    }
    return draft.status === "approved" || draft.id === workOrder.invoice_draft_id;
  });
  const selectedInvoiceDraft = matchingInvoiceDrafts.find(
    (draft) => draft.id === invoiceDraftId,
  );

  const refresh = () => {
    workOrderQuery.refetch();
    documentsQuery.refetch();
    invoiceDraftsQuery.refetch();
  };

  const updateMutation = useMutation({
    mutationFn: (payload: Partial<MaintenanceWorkOrderPayload>) =>
      updateMaintenanceWorkOrder(workOrderId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-work-order", workOrderId] });
      queryClient.invalidateQueries({ queryKey: ["operations-maintenance", entityId] });
    },
  });

  const uploadQuoteMutation = useMutation({
    mutationFn: async () => {
      if (!workOrder || !quoteFile) {
        throw new Error("Choose a quote document first.");
      }
      const document = await uploadDocument({
        entityId: workOrder.entity_id,
        propertyId: workOrder.property_id ?? undefined,
        tenancyUnitId: workOrder.tenancy_unit_id ?? undefined,
        tenantId: workOrder.tenant_id ?? undefined,
        leaseId: workOrder.lease_id ?? undefined,
        category: "other",
        notes: quoteNotes || `Contractor quote for ${workOrder.title}`,
        file: quoteFile,
      });
      const quoteDocuments = Array.isArray(workOrder.metadata.quote_documents)
        ? workOrder.metadata.quote_documents
        : [];
      await updateMaintenanceWorkOrder(workOrder.id, {
        document_ids: Array.from(new Set([...workOrder.document_ids, document.id])),
        metadata: {
          quote_documents: [
            ...quoteDocuments,
            {
              document_id: document.id,
              filename: document.filename,
              uploaded_at: new Date().toISOString(),
              notes: quoteNotes || null,
            },
          ],
        },
      });
      return document;
    },
    onSuccess: () => {
      setQuoteFile(null);
      setQuoteNotes("");
      queryClient.invalidateQueries({ queryKey: ["maintenance-work-order", workOrderId] });
      queryClient.invalidateQueries({ queryKey: ["maintenance-detail-documents", entityId] });
      queryClient.invalidateQueries({ queryKey: ["operations-maintenance", entityId] });
    },
  });

  const handleQuoteUpload = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    uploadQuoteMutation.mutate();
  };

  const commentMutation = useMutation({
    mutationFn: () =>
      addMaintenanceWorkOrderComment(workOrderId, {
        body: commentBody,
        visibility: commentVisibility,
      }),
    onSuccess: () => {
      setCommentBody("");
      setCommentVisibility("internal");
      queryClient.invalidateQueries({ queryKey: ["maintenance-work-order", workOrderId] });
      queryClient.invalidateQueries({ queryKey: ["operations-maintenance", entityId] });
    },
  });

  const handleCommentSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!commentBody.trim()) {
      return;
    }
    commentMutation.mutate();
  };

  return (
    <main className="min-h-screen">
      <AppHeader />
      <div className="mx-auto grid max-w-6xl gap-5 px-5 py-5">
        <PageHeader
          title={workOrder?.title ?? "Maintenance work order"}
          description={
            workOrder
              ? `${propertyName(properties, workOrder.property_id)} - ${tenantName(
                  tenants,
                  workOrder.tenant_id,
                )}`
              : "Loading work-order context."
          }
          actions={
            <div className="flex flex-wrap gap-2">
              <Link
                href="/operations"
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
              >
                <ArrowLeft size={16} />
                Operations
              </Link>
              <SecondaryButton type="button" onClick={refresh}>
                <RefreshCw size={15} />
                Refresh
              </SecondaryButton>
            </div>
          }
        />

        {workOrderQuery.isLoading ? (
          <SectionPanel>
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin text-primary" />
              Loading work order.
            </div>
          </SectionPanel>
        ) : null}

        {workOrderQuery.error ? (
          <SectionPanel>
            <EmptyState
              title="Work order unavailable"
              description={friendlyError(workOrderQuery.error)}
            />
          </SectionPanel>
        ) : null}

        {workOrder ? (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <SectionPanel title="Status" icon={<Wrench size={17} />}>
                <div className="grid gap-3 p-4 text-sm">
                  <StatusBadge tone={statusTone(workOrder)}>
                    {label(workOrder.status)}
                  </StatusBadge>
                  <div className="text-muted-foreground">
                    Priority: {label(workOrder.priority)}
                  </div>
                  <div className="text-muted-foreground">
                    Due: {formatDate(workOrder.due_date)}
                  </div>
                </div>
              </SectionPanel>

              <SectionPanel title="Approval" icon={<ShieldCheck size={17} />}>
                <div className="grid gap-2 p-4 text-sm">
                  <div>Quote {formatMoney(workOrder.quote_amount_cents)}</div>
                  <div>Limit {formatMoney(workOrder.approval_limit_cents)}</div>
                  <StatusBadge
                    tone={
                      workOrder.approval_status === "approved"
                        ? "success"
                        : workOrder.approval_status === "pending"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {label(workOrder.approval_status)}
                  </StatusBadge>
                  {workOrder.approval_status === "pending" ? (
                    <Button
                      type="button"
                      onClick={() =>
                        updateMutation.mutate({
                          status: "approved",
                          approval_status: "approved",
                          approved_at: new Date().toISOString(),
                          approval_notes:
                            workOrder.approval_notes ||
                            "Approved from work-order detail.",
                        })
                      }
                      disabled={updateMutation.isPending}
                    >
                      <CheckCircle2 size={16} />
                      Approve quote
                    </Button>
                  ) : null}
                </div>
              </SectionPanel>

              <SectionPanel title="Contractor" icon={<UserRound size={17} />}>
                <dl className="grid gap-2 p-4 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Name</dt>
                    <dd className="font-medium">
                      {workOrder.contractor_name ?? "Not assigned"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Contact</dt>
                    <dd>{workOrder.contractor_email ?? workOrder.contractor_phone ?? "-"}</dd>
                  </div>
                </dl>
              </SectionPanel>

              <SectionPanel title="Invoice" icon={<ReceiptText size={17} />}>
                <div className="grid gap-2 p-4 text-sm">
                  <Select
                    aria-label="Linked maintenance invoice"
                    value={invoiceDraftId || workOrder.invoice_draft_id || ""}
                    onChange={(event) => setInvoiceDraftId(event.target.value)}
                  >
                    <option value="">No linked invoice</option>
                    {matchingInvoiceDrafts.map((draft) => (
                      <option key={draft.id} value={draft.id}>
                        {invoiceDraftLabel(draft)}
                      </option>
                    ))}
                  </Select>
                  <div className="text-xs text-muted-foreground">
                    {workOrder.invoice_reference ?? "No invoice reference yet."}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <SecondaryButton
                      type="button"
                      disabled={updateMutation.isPending || !invoiceDraftId}
                      onClick={() =>
                        updateMutation.mutate({
                          invoice_draft_id: invoiceDraftId || null,
                          invoice_reference:
                            selectedInvoiceDraft?.invoice_number ??
                            selectedInvoiceDraft?.title ??
                            workOrder.invoice_reference,
                          invoice_amount_cents:
                            selectedInvoiceDraft?.total_cents ??
                            workOrder.invoice_amount_cents,
                        })
                      }
                    >
                      <Link2 size={15} />
                      Link
                    </SecondaryButton>
                    {workOrder.invoice_draft_id ? (
                      <SecondaryButton
                        type="button"
                        disabled={updateMutation.isPending}
                        onClick={() =>
                          updateMutation.mutate({
                            invoice_draft_id: null,
                            invoice_reference: null,
                            invoice_amount_cents: null,
                          })
                        }
                      >
                        <Ban size={15} />
                        Unlink
                      </SecondaryButton>
                    ) : null}
                  </div>
                </div>
              </SectionPanel>
            </div>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
              <SectionPanel
                title="Quote documents"
                description="Attach contractor quotes or supporting evidence to this work order."
                icon={<FileUp size={17} />}
              >
                <form className="grid gap-3 border-b border-border p-4" onSubmit={handleQuoteUpload}>
                  <Field label="Quote document">
                    <Input
                      type="file"
                      onChange={(event) => setQuoteFile(event.target.files?.[0] ?? null)}
                    />
                  </Field>
                  <Field label="Notes">
                    <Input
                      value={quoteNotes}
                      onChange={(event) => setQuoteNotes(event.target.value)}
                      placeholder="Contractor quote, approval pack, or site evidence."
                    />
                  </Field>
                  <Button
                    type="submit"
                    disabled={!quoteFile || uploadQuoteMutation.isPending}
                  >
                    {uploadQuoteMutation.isPending ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <FileUp size={16} />
                    )}
                    Attach quote
                  </Button>
                </form>

                <div className="grid gap-3 p-4">
                  {visibleDocuments.map((document) => (
                    <div
                      key={document.id}
                      className="grid gap-2 rounded-md border border-border bg-white p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-medium">{document.filename}</div>
                        <a
                          href={documentDownloadUrl(document.id)}
                          className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border-strong bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs hover:bg-muted"
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Download size={15} />
                          Download
                        </a>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {label(document.category)} - {document.notes ?? "No notes"} -{" "}
                        {formatDateTime(document.created_at)}
                      </div>
                    </div>
                  ))}
                  {!documentsQuery.isLoading && visibleDocuments.length === 0 ? (
                    <EmptyState
                      title="No quote documents"
                      description="Upload a contractor quote or evidence file before approval."
                    />
                  ) : null}
                  {uploadQuoteMutation.error ? (
                    <p className="text-sm text-danger">
                      {friendlyError(uploadQuoteMutation.error)}
                    </p>
                  ) : null}
                </div>
              </SectionPanel>

              <SectionPanel title="Activity" icon={<History size={17} />}>
                <div className="grid gap-3 p-4">
                  <form className="grid gap-3" onSubmit={handleCommentSubmit}>
                    <label className="grid gap-1.5 text-sm">
                      <span className="font-medium text-foreground">Comment</span>
                      <textarea
                        value={commentBody}
                        onChange={(event) => setCommentBody(event.target.value)}
                        rows={3}
                        className="w-full rounded-xl border border-border bg-white px-3 py-3 text-sm outline-none transition duration-200 ease-leasium focus:border-primary focus:ring-2 focus:ring-primary/15"
                        placeholder="Add an internal note, contractor update, or tenant-facing comment."
                      />
                    </label>
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                      <Select
                        aria-label="Comment visibility"
                        value={commentVisibility}
                        onChange={(event) =>
                          setCommentVisibility(
                            event.target.value as "internal" | "contractor" | "tenant",
                          )
                        }
                      >
                        <option value="internal">Internal</option>
                        <option value="contractor">Contractor</option>
                        <option value="tenant">Tenant-facing</option>
                      </Select>
                      <Button
                        type="submit"
                        disabled={!commentBody.trim() || commentMutation.isPending}
                      >
                        {commentMutation.isPending ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <Send size={16} />
                        )}
                        Add comment
                      </Button>
                    </div>
                    {commentMutation.error ? (
                      <p className="text-sm text-danger">
                        {friendlyError(commentMutation.error)}
                      </p>
                    ) : null}
                  </form>

                  {timeline.map((entry, index) => (
                    <div key={`${entry.at}-${entry.label}-${index}`} className="grid gap-1 text-sm">
                      <div className="font-medium">{entry.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDateTime(entry.at)}
                      </div>
                      <div className="text-muted-foreground">{entry.detail}</div>
                    </div>
                  ))}
                  {timeline.length === 0 ? (
                    <EmptyState
                      title="No activity yet"
                      description="Updates and approval actions will appear here."
                    />
                  ) : null}
                </div>
              </SectionPanel>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}

export default function MaintenanceWorkOrderPage() {
  return (
    <QueryProvider>
      <MaintenanceDetailRoute />
    </QueryProvider>
  );
}
