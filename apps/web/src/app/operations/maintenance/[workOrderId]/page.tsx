"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Eye,
  FileText,
  FileUp,
  History,
  Link2,
  Loader2,
  Mail,
  PhoneCall,
  ReceiptText,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";

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
  classifyMaintenanceWorkOrder,
  documentDownloadUrl,
  type DocumentRecord,
  getMaintenanceWorkOrder,
  type InvoiceDraftRecord,
  invoiceDraftPreviewUrl,
  listDocuments,
  listInvoiceDrafts,
  listProperties,
  listTenants,
  type MaintenanceWorkOrderPayload,
  type MaintenanceWorkOrderRecord,
  prepareInvoiceDraftDelivery,
  type PropertyRecord,
  sendMaintenanceWorkOrderContractorEmail,
  sendMaintenanceWorkOrderContractorSms,
  type TenantRecord,
  updateMaintenanceWorkOrder,
  updateInvoiceDraft,
  uploadDocument,
  type WorkAssignmentNoticeChannelReceiptRecord,
} from "@/lib/api";

type Tone = "neutral" | "success" | "warning" | "danger" | "primary";
type ContractorEmailTemplateKey =
  | "custom"
  | "attendance_window"
  | "quote_follow_up"
  | "completion_evidence"
  | "billing_documents";

type ContractorEmailTemplate = {
  key: ContractorEmailTemplateKey;
  label: string;
  subject: string;
  body: string;
};

type ContractorSmsTemplateKey =
  | "custom"
  | "attendance_window"
  | "status_update"
  | "completion_check"
  | "billing_documents";

type ContractorSmsTemplate = {
  key: ContractorSmsTemplateKey;
  label: string;
  body: string;
};

type ActivityAudience =
  | "tenant"
  | "contractor"
  | "provider"
  | "internal"
  | "system";

type ActivityTimelineEntry = {
  at: string;
  label: string;
  detail: string;
  meta: string[];
  audience: ActivityAudience;
  audienceLabel: string;
  tone: Tone;
};

type ActivityAuditCard = {
  label: string;
  badge: string;
  value: string;
  detail: string;
  tone: Tone;
};

type CompletionReviewAudience = "owner" | "tenant" | "contractor";

type CompletionReviewRow = {
  audience: CompletionReviewAudience;
  title: string;
  readyLabel: string;
  body: string;
  reviewedAt: string | null;
  note: string | null;
  statusLabel: string;
  buttonLabel: string;
  textareaLabel: string;
  placeholder: string;
};

type ForwardingDraftTarget = "contractor" | "tenant";

type ForwardingDraftRow = {
  target: ForwardingDraftTarget;
  title: string;
  sourceLabel: string;
  statusLabel: string;
  detail: string;
  body: string | null;
};

type LiveReviewCard = {
  id: string;
  title: string;
  statusLabel: string;
  detail: string;
  tone: Tone;
  icon: ReactNode;
};

type LiveActionReviewItem = {
  id: string;
  title: string;
  statusLabel: string;
  detail: string;
  tone: Tone;
  href: string | null;
  actionLabel: string;
  icon: ReactNode;
  secondaryHref?: string | null;
  secondaryLabel?: string;
};

type LiveReviewHandoffStep = {
  id: string;
  title: string;
  statusLabel: string;
  detail: string;
  tone: Tone;
  actionLabel: string;
  href?: string | null;
};

const emptyCompletionReviewNotes: Record<CompletionReviewAudience, string> = {
  owner: "",
  tenant: "",
  contractor: "",
};

const completionCommunicationCopyLabels: Record<
  CompletionReviewAudience,
  string
> = {
  owner: "Copy owner update",
  tenant: "Copy tenant update",
  contractor: "Copy contractor follow-up",
};

const completionCommunicationCopyReceipts: Record<
  CompletionReviewAudience,
  string
> = {
  owner: "Owner update copied. No message sent.",
  tenant: "Tenant update copied. No message sent.",
  contractor: "Contractor follow-up copied. No message sent.",
};

const forwardingDraftCopyLabels: Record<ForwardingDraftTarget, string> = {
  contractor: "Copy contractor forward",
  tenant: "Copy tenant forward",
};

const forwardingDraftCopyReceipts: Record<ForwardingDraftTarget, string> = {
  contractor: "Contractor forward copied. No message sent.",
  tenant: "Tenant forward copied. No message sent.",
};

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

async function copyTextToClipboard(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the document-based copy path below.
    }
  }
  if (typeof document === "undefined") {
    return false;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.left = "-1000px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  return copied;
}

function statusTone(workOrder: MaintenanceWorkOrderRecord): Tone {
  if (workOrder.status === "completed") {
    return "success";
  }
  if (workOrder.status === "cancelled") {
    return "neutral";
  }
  if (
    workOrder.priority === "urgent" ||
    workOrder.approval_status === "pending"
  ) {
    return "warning";
  }
  return "primary";
}

function propertyName(properties: PropertyRecord[], propertyId: string | null) {
  return (
    properties.find((property) => property.id === propertyId)?.name ??
    "Portfolio"
  );
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

function uniqueList(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.filter((item): item is string => Boolean(item))),
  );
}

function formText(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function templateVersionLabel(
  templateKey: string | null | undefined,
  templateVersion: string | null | undefined,
) {
  if (!templateKey && !templateVersion) {
    return null;
  }
  if (templateKey && templateVersion) {
    return `Template ${templateKey} ${templateVersion}`;
  }
  return `Template ${templateKey ?? templateVersion}`;
}

function invoiceStatusTone(status: InvoiceDraftRecord["status"]): Tone {
  if (status === "approved") {
    return "success";
  }
  if (status === "ready_for_approval") {
    return "primary";
  }
  if (status === "void") {
    return "danger";
  }
  return "neutral";
}

function invoiceReadinessBlockers(draft: InvoiceDraftRecord) {
  return metadataStringList(draft.metadata.readiness_blockers);
}

function invoiceDeliveryState(draft: InvoiceDraftRecord) {
  return metadataRecord(draft.metadata.delivery_state);
}

function invoiceDeliveryBlockers(draft: InvoiceDraftRecord) {
  return metadataStringList(draft.metadata.delivery_blockers);
}

function invoicePdfArtifact(draft: InvoiceDraftRecord) {
  return metadataRecord(draft.metadata.pdf_artifact);
}

function invoicePaymentStatus(draft: InvoiceDraftRecord) {
  return metadataRecord(draft.metadata.payment_status);
}

function invoiceDeliverySend(draft: InvoiceDraftRecord) {
  const email = metadataRecord(draft.metadata.delivery_email);
  return metadataRecord(email.send);
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

function latestContractorComment(workOrder: MaintenanceWorkOrderRecord) {
  const comments = metadataRecordList(workOrder.metadata.comments);
  return (
    comments
      .filter((entry) => metadataText(entry.visibility) === "contractor")
      .sort(
        (a, b) =>
          new Date(metadataText(b.timestamp) ?? "").getTime() -
          new Date(metadataText(a.timestamp) ?? "").getTime(),
      )[0] ?? null
  );
}

function contractorHandoffSummary(workOrder: MaintenanceWorkOrderRecord) {
  if (!workOrder.contractor_name) {
    return "Assign a contractor before the job leaves Operations.";
  }
  if (!workOrder.contractor_email && !workOrder.contractor_phone) {
    return "Add contractor contact details before sending updates.";
  }
  const latestComment = latestContractorComment(workOrder);
  if (latestComment) {
    return `Latest contractor note: ${metadataText(latestComment.body) ?? "recorded"}`;
  }
  return "Contractor is assigned; use the activity comment form for the next update.";
}

function contractorDeliveryEmail(workOrder: MaintenanceWorkOrderRecord) {
  const delivery = metadataRecord(workOrder.metadata.contractor_delivery);
  return metadataRecord(delivery.email);
}

function contractorEmailSendState(workOrder: MaintenanceWorkOrderRecord) {
  return metadataRecord(contractorDeliveryEmail(workOrder).send);
}

function contractorEmailReceipts(workOrder: MaintenanceWorkOrderRecord) {
  return metadataRecordList(contractorDeliveryEmail(workOrder).receipts);
}

function contractorEmailHistory(workOrder: MaintenanceWorkOrderRecord) {
  return metadataRecordList(contractorDeliveryEmail(workOrder).history);
}

function contractorEmailHistoryRows(workOrder: MaintenanceWorkOrderRecord) {
  const attemptRows = contractorEmailHistory(workOrder).map((entry) => ({
    kind: "Attempt",
    status: metadataText(entry.status) ?? metadataText(entry.event) ?? "sent",
    at: metadataText(entry.at) ?? metadataText(entry.timestamp),
    detail:
      metadataText(entry.error) ??
      metadataText(entry.recipient_email) ??
      metadataText(entry.provider) ??
      "Provider delivery attempt recorded.",
    retryCount:
      typeof entry.retry_count === "number" ? entry.retry_count : null,
    templateKey: metadataText(entry.template_key),
    templateVersion: metadataText(entry.template_version),
  }));
  const receiptRows = contractorEmailReceipts(workOrder).map((entry) => ({
    kind: "Receipt",
    status: metadataText(entry.status) ?? "recorded",
    at: metadataText(entry.received_at) ?? metadataText(entry.at),
    detail:
      metadataText(entry.error) ??
      metadataText(entry.recipient_email) ??
      metadataText(entry.provider) ??
      "Provider receipt recorded.",
    retryCount:
      typeof entry.retry_count === "number" ? entry.retry_count : null,
    templateKey: metadataText(entry.template_key),
    templateVersion: metadataText(entry.template_version),
  }));
  return [...attemptRows, ...receiptRows]
    .sort(
      (a, b) => new Date(b.at ?? "").getTime() - new Date(a.at ?? "").getTime(),
    )
    .slice(0, 5);
}

function contractorDeliverySms(workOrder: MaintenanceWorkOrderRecord) {
  const delivery = metadataRecord(workOrder.metadata.contractor_delivery);
  return metadataRecord(delivery.sms);
}

function contractorSmsSendState(workOrder: MaintenanceWorkOrderRecord) {
  return metadataRecord(contractorDeliverySms(workOrder).send);
}

function contractorSmsReceipts(workOrder: MaintenanceWorkOrderRecord) {
  return metadataRecordList(contractorDeliverySms(workOrder).receipts);
}

function contractorSmsHistory(workOrder: MaintenanceWorkOrderRecord) {
  return metadataRecordList(contractorDeliverySms(workOrder).history);
}

function contractorSmsHistoryRows(workOrder: MaintenanceWorkOrderRecord) {
  const attemptRows = contractorSmsHistory(workOrder).map((entry) => ({
    kind: "SMS attempt",
    status: metadataText(entry.status) ?? metadataText(entry.event) ?? "sent",
    at: metadataText(entry.at) ?? metadataText(entry.timestamp),
    detail:
      metadataText(entry.error) ??
      metadataText(entry.recipient_phone) ??
      metadataText(entry.provider) ??
      "SMS provider attempt recorded.",
    retryCount:
      typeof entry.retry_count === "number" ? entry.retry_count : null,
    templateKey: metadataText(entry.template_key),
    templateVersion: metadataText(entry.template_version),
  }));
  const receiptRows = contractorSmsReceipts(workOrder).map((entry) => ({
    kind: "SMS receipt",
    status: metadataText(entry.status) ?? "recorded",
    at: metadataText(entry.received_at) ?? metadataText(entry.at),
    detail:
      metadataText(entry.error) ??
      metadataText(entry.recipient_phone) ??
      metadataText(entry.provider) ??
      "SMS provider receipt recorded.",
    retryCount:
      typeof entry.retry_count === "number" ? entry.retry_count : null,
    templateKey: metadataText(entry.template_key),
    templateVersion: metadataText(entry.template_version),
  }));
  return [...attemptRows, ...receiptRows]
    .sort(
      (a, b) => new Date(b.at ?? "").getTime() - new Date(a.at ?? "").getTime(),
    )
    .slice(0, 4);
}

function closeoutRecord(workOrder: MaintenanceWorkOrderRecord) {
  return metadataRecord(workOrder.metadata.closeout);
}

function ownerReviewRecord(workOrder: MaintenanceWorkOrderRecord) {
  return metadataRecord(closeoutRecord(workOrder).owner_review);
}

function ownerReviewHistoryRows(workOrder: MaintenanceWorkOrderRecord) {
  return metadataRecordList(ownerReviewRecord(workOrder).history)
    .map((entry) => ({
      at: metadataText(entry.reviewed_at) ?? metadataText(entry.at),
      note: metadataText(entry.note),
      status: metadataText(entry.status) ?? "reviewed",
    }))
    .sort(
      (a, b) => new Date(b.at ?? "").getTime() - new Date(a.at ?? "").getTime(),
    )
    .slice(0, 3);
}

function closeoutPhotoDocumentIds(workOrder: MaintenanceWorkOrderRecord) {
  const closeout = closeoutRecord(workOrder);
  return Array.from(
    new Set(
      [
        metadataText(closeout.photo_document_id),
        ...metadataStringList(closeout.photo_document_ids),
      ].filter((id): id is string => Boolean(id)),
    ),
  );
}

function closeoutPhotoRows(
  workOrder: MaintenanceWorkOrderRecord,
  documents: DocumentRecord[],
) {
  const linkedIds = new Set(closeoutPhotoDocumentIds(workOrder));
  return documents.filter((document) => linkedIds.has(document.id));
}

function closeoutHistoryRows(
  workOrder: MaintenanceWorkOrderRecord,
  documents: DocumentRecord[],
) {
  const closeout = closeoutRecord(workOrder);
  const documentsById = new Map(
    documents.map((document) => [document.id, document]),
  );
  return metadataRecordList(closeout.history)
    .map((entry) => {
      const photoIds = Array.from(
        new Set(
          [
            metadataText(entry.photo_document_id),
            ...metadataStringList(entry.photo_document_ids),
          ].filter((id): id is string => Boolean(id)),
        ),
      );
      const photoDocuments = photoIds
        .map((id) => documentsById.get(id))
        .filter((document): document is DocumentRecord => Boolean(document));
      return {
        at: metadataText(entry.at) ?? metadataText(entry.completed_at),
        note: metadataText(entry.note),
        status: metadataText(entry.status) ?? "completed",
        photoCount: photoIds.length,
        photoDocuments,
        missingPhotoCount: photoIds.length - photoDocuments.length,
      };
    })
    .sort(
      (a, b) => new Date(b.at ?? "").getTime() - new Date(a.at ?? "").getTime(),
    )
    .slice(0, 5);
}

function closeoutCommunicationDrafts({
  workOrder,
  linkedInvoiceDraft,
  propertyLabel,
  tenantLabel,
  closeoutNote,
  completedAt,
}: {
  workOrder: MaintenanceWorkOrderRecord;
  linkedInvoiceDraft: InvoiceDraftRecord | null;
  propertyLabel: string;
  tenantLabel: string;
  closeoutNote: string | null;
  completedAt: string;
}) {
  const contractorLabel = workOrder.contractor_name ?? "the contractor";
  const note = closeoutNote ?? "No closeout note was recorded.";
  const billingLine = linkedInvoiceDraft
    ? `Billing handoff: ${linkedInvoiceDraft.invoice_number ?? linkedInvoiceDraft.title} stays in Billing Readiness for dispatch and reconciliation.`
    : "Billing handoff: no invoice is linked yet; Billing Readiness can be linked later.";

  return {
    generated_at: completedAt,
    status: "draft",
    owner_update: [
      `Maintenance completed for ${propertyLabel}: ${workOrder.title}.`,
      `Tenant: ${tenantLabel}. Contractor: ${contractorLabel}.`,
      `Closeout: ${note}`,
      billingLine,
    ].join("\n"),
    contractor_follow_up: [
      `Thanks for completing ${workOrder.title}.`,
      "Please send any final invoice, tax invoice, and remaining completion evidence for the file.",
      `Closeout note recorded by Leasium: ${note}`,
    ].join("\n"),
    tenant_update: [
      `The maintenance job "${workOrder.title}" has been marked complete.`,
      `Closeout note: ${note}`,
      "Please contact the property team if the issue reoccurs.",
    ].join("\n"),
  };
}

function reopenHistoryRows(workOrder: MaintenanceWorkOrderRecord) {
  return metadataRecordList(workOrder.metadata.reopen_history)
    .map((entry) => ({
      at: metadataText(entry.reopened_at) ?? metadataText(entry.at),
      fromStatus: metadataText(entry.reopened_from),
      previousCompletedAt: metadataText(entry.previous_completed_at),
      reason: metadataText(entry.reason),
    }))
    .sort(
      (a, b) => new Date(b.at ?? "").getTime() - new Date(a.at ?? "").getTime(),
    )
    .slice(0, 3);
}

function reopenedMaintenanceStatus(workOrder: MaintenanceWorkOrderRecord) {
  return workOrder.approval_status === "pending"
    ? "awaiting_approval"
    : "in_progress";
}

function contractorEmailTone(statusValue: string | null): Tone {
  if (["queued", "sent", "delivered", "opened"].includes(statusValue ?? "")) {
    return "success";
  }
  if (statusValue === "failed") {
    return "danger";
  }
  if (statusValue === "attention" || statusValue === "skipped") {
    return "warning";
  }
  return "neutral";
}

function contractorEmailNeedsRecovery(statusValue: string | null) {
  return ["failed", "skipped", "attention"].includes(statusValue ?? "");
}

function contractorEmailRecoveryCopy(
  statusValue: string | null,
  error: string | null,
) {
  if (statusValue === "failed") {
    return error
      ? `Last provider attempt failed: ${error}`
      : "Last provider attempt failed. Fix the blocker, then retry the update.";
  }
  if (statusValue === "skipped") {
    return error
      ? `Delivery was skipped: ${error}`
      : "Delivery was skipped. Confirm provider setup and contractor contact details before retrying.";
  }
  if (statusValue === "attention") {
    return error
      ? `Provider returned attention: ${error}`
      : "Provider returned an attention state. Review the latest receipt before retrying.";
  }
  return null;
}

function contractorEmailDefaultSubject(workOrder: MaintenanceWorkOrderRecord) {
  return `Maintenance update: ${workOrder.title}`;
}

function contractorEmailDefaultBody(workOrder: MaintenanceWorkOrderRecord) {
  return [
    `Please review this maintenance work order and reply with your next available attendance window.`,
    "",
    `Work order: ${workOrder.title}`,
    `Priority: ${label(workOrder.priority)}`,
    `Due: ${formatDate(workOrder.due_date)}`,
  ].join("\n");
}

function contractorSmsDefaultBody(workOrder: MaintenanceWorkOrderRecord) {
  return [
    `Please confirm your first available attendance window for ${workOrder.title}.`,
    `Due: ${formatDate(workOrder.due_date)}.`,
  ].join(" ");
}

function contractorEmailTemplates(
  workOrder: MaintenanceWorkOrderRecord,
): ContractorEmailTemplate[] {
  const workOrderDetails = [
    "",
    `Work order: ${workOrder.title}`,
    `Priority: ${label(workOrder.priority)}`,
    `Due: ${formatDate(workOrder.due_date)}`,
  ];
  return [
    {
      key: "attendance_window",
      label: "Attendance window",
      subject: `Attendance window request: ${workOrder.title}`,
      body: [
        "Please confirm your first available attendance window for this maintenance job.",
        ...workOrderDetails,
      ].join("\n"),
    },
    {
      key: "quote_follow_up",
      label: "Quote follow-up",
      subject: `Quote follow-up: ${workOrder.title}`,
      body: [
        "Please send through the quote for this maintenance job, including labour, materials, call-out fees, and any approval deadline.",
        ...workOrderDetails,
      ].join("\n"),
    },
    {
      key: "completion_evidence",
      label: "Completion evidence",
      subject: `Completion evidence request: ${workOrder.title}`,
      body: [
        "Please confirm when this job is complete and send any completion photos, notes, or handover details.",
        ...workOrderDetails,
      ].join("\n"),
    },
    {
      key: "billing_documents",
      label: "Billing documents",
      subject: `Billing documents needed: ${workOrder.title}`,
      body: [
        "Please send the invoice or tax invoice for this job, including the work-order reference and any completion notes.",
        ...workOrderDetails,
      ].join("\n"),
    },
  ];
}

function contractorSmsTemplates(
  workOrder: MaintenanceWorkOrderRecord,
): ContractorSmsTemplate[] {
  // SMS messages must stay under 800 chars (backend schema limit). Keep these
  // tight: one or two sentences plus a short reference line.
  const ref = `Ref: ${workOrder.title}`;
  const dueLine = workOrder.due_date
    ? `Due ${formatDate(workOrder.due_date)}.`
    : "";
  return [
    {
      key: "attendance_window",
      label: "Attendance window",
      body: [
        "Hi, can you reply with your first available attendance window for this job?",
        ref,
        dueLine,
      ]
        .filter(Boolean)
        .join(" "),
    },
    {
      key: "status_update",
      label: "Status update",
      body: ["Hi, can you send a quick status update on this job?", ref].join(
        " ",
      ),
    },
    {
      key: "completion_check",
      label: "Completion check",
      body: [
        "Hi, has this job been completed? Please confirm and send any completion photos when you can.",
        ref,
      ].join(" "),
    },
    {
      key: "billing_documents",
      label: "Billing documents",
      body: [
        "Hi, please send the invoice for this job with the work-order reference and any completion notes.",
        ref,
      ].join(" "),
    },
  ];
}

function invoiceBillingHandoff(
  workOrder: MaintenanceWorkOrderRecord,
  draft: InvoiceDraftRecord,
) {
  const deliveryState = invoiceDeliveryState(draft);
  const sendState = invoiceDeliverySend(draft);
  const paymentStatus = invoicePaymentStatus(draft);
  const xeroSync = invoiceXeroSync(draft);
  const postingPreparation = invoicePostingPreparation(draft);
  const xeroApproval = invoiceXeroPostingApproval(draft);
  const providerDispatch = invoiceProviderDispatch(draft);
  const providerDispatchXero = metadataRecord(providerDispatch.xero);
  const providerReceipts = invoiceProviderReceipts(draft);
  const latestXeroReceipt =
    providerReceipts.find(
      (receipt) => metadataText(receipt.provider) === "xero",
    ) ?? null;
  const xeroApproved = metadataText(xeroApproval.state) === "approved";
  const xeroSynced = xeroSync.xero_synced === true;
  const deliveryReady = deliveryState.delivery_ready === true;
  const emailSent =
    deliveryState.tenant_email_sent === true ||
    ["queued", "sent", "delivered", "opened"].includes(
      metadataText(sendState.status) ?? "",
    );
  const emailFailed = metadataText(sendState.status) === "failed";
  const xeroFailed =
    metadataText(postingPreparation.external_posting_status) ===
      "provider_failed" ||
    metadataText(providerDispatchXero.status) === "failed" ||
    metadataText(latestXeroReceipt?.status) === "failed";
  const paymentLabel = metadataText(paymentStatus.status) ?? "unpaid";
  const params = new URLSearchParams({
    entity_id: workOrder.entity_id,
    invoice_id: draft.id,
    tab: "delivery",
    filter: "needs_action",
  });

  let tone: Tone = "warning";
  let label = "Billing handoff";
  let message =
    "Billing Readiness owns invoice delivery, Xero dispatch, and payment follow-up.";
  let action = "Open billing handoff";

  if (draft.status !== "approved") {
    params.set("tab", "invoice-prep");
    message =
      "Approve the internal invoice draft before tenant delivery or Xero dispatch.";
    action = "Open invoice approval";
  } else if (!deliveryReady) {
    params.set("tab", "invoice-prep");
    message =
      "Prepare the invoice preview, PDF artifact, and tenant email draft before dispatch.";
    action = "Open invoice prep";
  } else if (!xeroApproved) {
    message =
      "Approve Xero posting in Settings, then dispatch from Billing Readiness.";
    action = "Review billing handoff";
  } else if (xeroFailed || emailFailed) {
    message =
      "The latest provider attempt needs recovery in Billing Readiness.";
    action = "Recover dispatch";
  } else if (!xeroSynced || !emailSent) {
    params.set("filter", "ready_dispatch");
    tone = "primary";
    label = "Ready for dispatch";
    message =
      "Billing can create or reuse the Xero draft, then send the approved tenant email.";
    action = "Dispatch invoice";
  } else if (paymentLabel !== "paid") {
    params.set("filter", "unpaid");
    tone = "primary";
    label = "Payment follow-up";
    message =
      "Provider delivery is recorded; Billing owns payment reconciliation.";
    action = "Review payment";
  } else {
    params.set("filter", "complete");
    tone = "success";
    label = "Billing complete";
    message =
      "Invoice dispatch and payment status are complete for this work order.";
  }

  const invoiceLinked = Boolean(
    draft.id || workOrder.invoice_reference || workOrder.invoice_amount_cents,
  );
  const operationsReady =
    invoiceLinked &&
    (workOrder.status === "completed" ||
      workOrder.approval_status !== "pending");

  return {
    tone,
    label,
    message,
    action,
    href: `/billing-readiness?${params.toString()}`,
    xeroApproved,
    deliveryReady,
    operationsReady,
    contractorSummary: contractorHandoffSummary(workOrder),
  };
}

function invoiceRecoveryReasons(draft: InvoiceDraftRecord) {
  const sendState = invoiceDeliverySend(draft);
  const postingPreparation = invoicePostingPreparation(draft);
  const providerDispatch = invoiceProviderDispatch(draft);
  const providerDispatchXero = metadataRecord(providerDispatch.xero);
  const providerReceipts = invoiceProviderReceipts(draft);
  const latestXeroReceipt =
    providerReceipts.find(
      (receipt) => metadataText(receipt.provider) === "xero",
    ) ?? null;
  const reasons: string[] = [];
  if (
    metadataText(postingPreparation.external_posting_status) ===
      "provider_failed" ||
    metadataText(providerDispatchXero.status) === "failed" ||
    metadataText(latestXeroReceipt?.status) === "failed"
  ) {
    reasons.push(
      metadataText(postingPreparation.last_provider_reason) ??
        metadataText(providerDispatchXero.reason) ??
        metadataText(latestXeroReceipt?.reason) ??
        "Xero provider dispatch failed.",
    );
  }
  if (metadataText(sendState.status) === "failed") {
    reasons.push(
      metadataText(sendState.error) ??
        "Tenant invoice email provider delivery failed.",
    );
  }
  return reasons;
}

function invoiceRecoveryPath(draft: InvoiceDraftRecord) {
  const deliveryState = invoiceDeliveryState(draft);
  const sendState = invoiceDeliverySend(draft);
  const paymentStatus = invoicePaymentStatus(draft);
  const xeroSync = invoiceXeroSync(draft);
  const postingPreparation = invoicePostingPreparation(draft);
  const xeroApproval = invoiceXeroPostingApproval(draft);
  const providerDispatch = invoiceProviderDispatch(draft);
  const providerDispatchXero = metadataRecord(providerDispatch.xero);
  const providerReceipts = invoiceProviderReceipts(draft);
  const latestXeroReceipt =
    providerReceipts.find(
      (receipt) => metadataText(receipt.provider) === "xero",
    ) ?? null;
  const deliveryReady = deliveryState.delivery_ready === true;
  const xeroApproved = metadataText(xeroApproval.state) === "approved";
  const xeroSynced = xeroSync.xero_synced === true;
  const emailSent =
    deliveryState.tenant_email_sent === true ||
    ["queued", "sent", "delivered", "opened"].includes(
      metadataText(sendState.status) ?? "",
    );
  const xeroFailed =
    metadataText(postingPreparation.external_posting_status) ===
      "provider_failed" ||
    metadataText(providerDispatchXero.status) === "failed" ||
    metadataText(latestXeroReceipt?.status) === "failed";
  const emailFailed = metadataText(sendState.status) === "failed";
  const paymentLabel = metadataText(paymentStatus.status) ?? "unpaid";
  const reasons = invoiceRecoveryReasons(draft);
  const steps: Array<{ label: string; detail: string; tone: Tone }> = [];

  if (draft.status !== "approved") {
    steps.push({
      label: "Approve invoice",
      detail:
        "Finish internal invoice approval before tenant email or Xero dispatch.",
      tone: "warning",
    });
  } else if (!deliveryReady) {
    steps.push({
      label: "Prepare delivery",
      detail:
        "Prepare the invoice preview, PDF artifact, and tenant email draft.",
      tone: "warning",
    });
  } else if (!xeroApproved) {
    steps.push({
      label: "Xero approval pending",
      detail: "Approve Xero posting in Settings before provider dispatch.",
      tone: "warning",
    });
  } else if (xeroFailed || emailFailed) {
    steps.push({
      label: "Retry provider dispatch",
      detail:
        reasons[0] ??
        "Recover the provider failure from Billing Readiness before payment follow-up.",
      tone: "danger",
    });
  } else if (!xeroSynced || !emailSent) {
    steps.push({
      label: "Ready for dispatch",
      detail:
        "Billing Readiness can create or reuse the Xero draft, then send tenant email.",
      tone: "primary",
    });
  } else if (paymentLabel !== "paid") {
    steps.push({
      label: "Reconcile payment",
      detail:
        "Provider delivery is recorded; payment status still needs follow-up.",
      tone: "primary",
    });
  } else {
    steps.push({
      label: "No recovery needed",
      detail: "Invoice dispatch and payment status are complete.",
      tone: "success",
    });
  }

  const tone: Tone = steps.some((step) => step.tone === "danger")
    ? "danger"
    : steps.some((step) => step.tone === "warning")
      ? "warning"
      : steps.some((step) => step.tone === "primary")
        ? "primary"
        : "success";

  return {
    tone,
    steps,
  };
}

function maintenanceCompletionReadiness(
  workOrder: MaintenanceWorkOrderRecord,
  linkedInvoiceDraft: InvoiceDraftRecord | null,
  quoteDocuments: ReturnType<typeof quoteDocumentRows>,
) {
  const checks: Array<{
    label: string;
    detail: string;
    tone: Tone;
    blocking: boolean;
  }> = [];
  if (workOrder.status === "cancelled") {
    checks.push({
      label: "Work order cancelled",
      detail: "Cancelled work orders need to be reopened before completion.",
      tone: "neutral",
      blocking: true,
    });
  }
  checks.push({
    label:
      workOrder.status === "completed"
        ? "Job complete"
        : "Job completion not recorded",
    detail: workOrder.completed_at
      ? `Completed ${formatDateTime(workOrder.completed_at)}.`
      : "Record completion when the contractor work is finished.",
    tone: workOrder.status === "completed" ? "success" : "warning",
    blocking: false,
  });
  checks.push({
    label:
      workOrder.approval_status === "pending"
        ? "Approval still pending"
        : "Approval clear",
    detail:
      workOrder.approval_status === "pending"
        ? "Approve the quote before closing this operational job."
        : "Quote approval is no longer blocking completion.",
    tone: workOrder.approval_status === "pending" ? "warning" : "success",
    blocking: workOrder.approval_status === "pending",
  });
  checks.push({
    label: workOrder.contractor_name
      ? "Contractor assigned"
      : "No contractor assigned",
    detail: workOrder.contractor_name
      ? workOrder.contractor_name
      : "Assign or record the contractor before closing the job.",
    tone: workOrder.contractor_name ? "success" : "warning",
    blocking: !workOrder.contractor_name,
  });
  if (workOrder.contractor_name) {
    checks.push({
      label:
        workOrder.contractor_email || workOrder.contractor_phone
          ? "Contractor contact recorded"
          : "Contractor contact missing",
      detail:
        workOrder.contractor_email ||
        workOrder.contractor_phone ||
        "Add email or phone before future contractor follow-up.",
      tone:
        workOrder.contractor_email || workOrder.contractor_phone
          ? "success"
          : "warning",
      blocking: false,
    });
  }
  checks.push({
    label: quoteDocuments.length
      ? "Quote/evidence attached"
      : "No quote or evidence attached",
    detail: quoteDocuments.length
      ? `${quoteDocuments.length} evidence item${quoteDocuments.length === 1 ? "" : "s"} linked to this job.`
      : "Attach quote, photo, or contractor evidence if it exists.",
    tone: quoteDocuments.length ? "success" : "warning",
    blocking: false,
  });
  checks.push({
    label: linkedInvoiceDraft ? "Invoice linked" : "No invoice linked",
    detail: linkedInvoiceDraft
      ? `${linkedInvoiceDraft.invoice_number ?? linkedInvoiceDraft.title} is linked for Billing Readiness.`
      : "Billing can still be linked later from an approved invoice draft.",
    tone: linkedInvoiceDraft ? "success" : "warning",
    blocking: false,
  });
  if (linkedInvoiceDraft) {
    const deliveryReady =
      invoiceDeliveryState(linkedInvoiceDraft).delivery_ready === true;
    checks.push({
      label: deliveryReady
        ? "Invoice delivery ready"
        : "Invoice delivery not ready",
      detail: deliveryReady
        ? "Billing Readiness has the PDF/email preparation context."
        : "Billing Readiness needs invoice preparation before dispatch.",
      tone: deliveryReady ? "success" : "warning",
      blocking: false,
    });
    const recoveryReasons = invoiceRecoveryReasons(linkedInvoiceDraft);
    if (recoveryReasons.length) {
      checks.push({
        label: "Provider recovery needed in Billing",
        detail: recoveryReasons.join(" "),
        tone: "danger",
        blocking: false,
      });
    }
  }
  const blockers = checks
    .filter((check) => check.blocking)
    .map((check) => check.label);
  const canStart =
    !["in_progress", "completed", "cancelled"].includes(workOrder.status) &&
    workOrder.approval_status !== "pending";
  const canComplete =
    blockers.length === 0 &&
    !["completed", "cancelled"].includes(workOrder.status);
  const statusLabel =
    workOrder.status === "completed"
      ? "Operations complete"
      : blockers.length
        ? "Needs operations action"
        : "Ready to close Operations";
  const tone: Tone =
    workOrder.status === "completed"
      ? "success"
      : blockers.length
        ? "warning"
        : "primary";
  let handoff =
    "No linked invoice yet; close the job once operational work is complete, then attach billing documents if needed.";
  if (linkedInvoiceDraft) {
    handoff =
      workOrder.status === "completed"
        ? "Operations is complete. Billing Readiness owns tenant email, Xero dispatch, and payment follow-up."
        : "Mark Operations complete when the job is finished; Billing Readiness owns provider dispatch and payment follow-up.";
  } else if (workOrder.invoice_reference || workOrder.invoice_amount_cents) {
    handoff =
      "Invoice details are recorded on the job, but no approved invoice draft is linked yet.";
  }
  return {
    blockers,
    checks,
    canStart,
    canComplete,
    statusLabel,
    tone,
    handoff,
  };
}

function activityRows(workOrder: MaintenanceWorkOrderRecord) {
  const rawHistory = workOrder.metadata.activity_history;
  if (!Array.isArray(rawHistory)) {
    return [];
  }
  return rawHistory
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry): ActivityTimelineEntry => {
      const event =
        typeof entry.event === "string"
          ? entry.event
          : typeof entry.action === "string"
            ? entry.action
            : "Activity";
      const visibility =
        typeof entry.visibility === "string" ? entry.visibility : null;
      const source = typeof entry.source === "string" ? entry.source : null;
      const actor = typeof entry.actor === "string" ? entry.actor : null;
      const status = typeof entry.status === "string" ? entry.status : null;
      const audience = activityAudience({ visibility, source, actor, event });
      return {
        at:
          typeof entry.timestamp === "string"
            ? entry.timestamp
            : typeof entry.at === "string"
              ? entry.at
              : workOrder.updated_at,
        label: label(event),
        meta: uniqueList([
          status ? label(status) : null,
          source ? label(source) : null,
          actor,
        ]),
        detail:
          typeof entry.summary === "string"
            ? entry.summary
            : [actor, source].filter(Boolean).join(" - ") ||
              "Maintenance activity updated.",
        audience,
        audienceLabel: activityAudienceLabel(audience),
        tone: activityTone(status, audience),
      };
    })
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

function buildActivityAuditCards({
  timeline,
  quoteDocumentsCount,
  closeoutPhotoCount,
  closeoutHistoryCount,
  ownerReviewAt,
  contractorEmailEvidenceCount,
  contractorSmsEvidenceCount,
}: {
  timeline: ActivityTimelineEntry[];
  quoteDocumentsCount: number;
  closeoutPhotoCount: number;
  closeoutHistoryCount: number;
  ownerReviewAt: string | null;
  contractorEmailEvidenceCount: number;
  contractorSmsEvidenceCount: number;
}): ActivityAuditCard[] {
  const latest = timeline[0] ?? null;
  const tenantVisibleCount = timeline.filter(
    (entry) => entry.audience === "tenant",
  ).length;
  const contractorVisibleCount = timeline.filter(
    (entry) => entry.audience === "contractor",
  ).length;
  const providerEvidenceCount =
    timeline.filter((entry) => entry.audience === "provider").length +
    contractorEmailEvidenceCount +
    contractorSmsEvidenceCount;
  const evidenceCount = quoteDocumentsCount + closeoutPhotoCount;
  return [
    {
      label: "Latest update",
      badge: "Live",
      value: latest ? latest.label : "None",
      detail: latest
        ? `${formatDateTime(latest.at)} · ${latest.audienceLabel}`
        : "No activity has been recorded yet.",
      tone: latest?.tone ?? "neutral",
    },
    {
      label: "External visibility",
      badge: "Visible",
      value: `${tenantVisibleCount + contractorVisibleCount}`,
      detail: `${tenantVisibleCount} tenant-visible · ${contractorVisibleCount} contractor-visible`,
      tone:
        tenantVisibleCount || contractorVisibleCount ? "primary" : "neutral",
    },
    {
      label: "Provider evidence",
      badge: "Evidence",
      value: `${providerEvidenceCount}`,
      detail:
        providerEvidenceCount > 0
          ? "Email, SMS, or provider receipt rows are attached."
          : "No provider evidence has been recorded yet.",
      tone: providerEvidenceCount > 0 ? "success" : "warning",
    },
    {
      label: "Closeout trail",
      badge: "Closeout",
      value: `${evidenceCount}`,
      detail: closeoutHistoryCount
        ? `${closeoutHistoryCount} closeout event${closeoutHistoryCount === 1 ? "" : "s"} · ${
            ownerReviewAt ? "owner reviewed" : "owner review pending"
          }`
        : "No closeout evidence or completion audit yet.",
      tone: closeoutHistoryCount
        ? ownerReviewAt
          ? "success"
          : "warning"
        : evidenceCount
          ? "primary"
          : "neutral",
    },
  ];
}

function phoneReviewDetail(phone: string | null | undefined) {
  if (!phone) {
    return "No contractor phone recorded.";
  }
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+") && cleaned.replace(/\D/g, "").length >= 9) {
    return `${phone} looks ready for SMS review.`;
  }
  return `${phone} should be checked on a real phone before relying on SMS.`;
}

function phoneActionHref(
  phone: string | null | undefined,
  scheme: "tel" | "sms",
) {
  const cleaned = phone?.replace(/[^\d+]/g, "");
  return cleaned ? `${scheme}:${cleaned}` : null;
}

function buildLiveReviewCards({
  workOrder,
  timeline,
  completionReviewRows,
  contractorSendStatus,
  contractorSmsStatus,
}: {
  workOrder: MaintenanceWorkOrderRecord;
  timeline: ActivityTimelineEntry[];
  completionReviewRows: CompletionReviewRow[];
  contractorSendStatus: string;
  contractorSmsStatus: string;
}): LiveReviewCard[] {
  const hasContractor = Boolean(workOrder.contractor_name);
  const hasEmail = Boolean(workOrder.contractor_email);
  const hasPhone = Boolean(workOrder.contractor_phone);
  const phoneLooksInternational = Boolean(
    workOrder.contractor_phone?.replace(/[^\d+]/g, "").startsWith("+"),
  );
  const reviewedRecipients = completionReviewRows.filter(
    (row) => row.reviewedAt,
  ).length;
  const latestActivity = timeline[0] ?? null;
  const externalActivityCount = timeline.filter((entry) =>
    ["tenant", "contractor", "provider"].includes(entry.audience),
  ).length;

  return [
    {
      id: "contractor-recipient",
      title: "Contractor recipient",
      statusLabel: hasContractor
        ? hasEmail || hasPhone
          ? "Contact ready"
          : "Contact missing"
        : "No contractor",
      detail: hasContractor
        ? [
            workOrder.contractor_name,
            workOrder.contractor_email,
            workOrder.contractor_phone,
          ]
            .filter(Boolean)
            .join(" · ") || "Add email or phone before contractor updates."
        : "Assign the contractor before live review.",
      tone: hasContractor && (hasEmail || hasPhone) ? "success" : "warning",
      icon: <UserRound size={16} />,
    },
    {
      id: "phone-review",
      title: "Real-phone review",
      statusLabel: hasPhone
        ? phoneLooksInternational
          ? "SMS ready"
          : "Check format"
        : "No phone",
      detail: phoneReviewDetail(workOrder.contractor_phone),
      tone: hasPhone
        ? phoneLooksInternational
          ? "success"
          : "warning"
        : "neutral",
      icon: <PhoneCall size={16} />,
    },
    {
      id: "provider-actions",
      title: "Work-order actions",
      statusLabel:
        contractorSendStatus === "not_sent" &&
        contractorSmsStatus === "not_sent"
          ? "Not sent"
          : `Email ${label(contractorSendStatus)} · SMS ${label(contractorSmsStatus)}`,
      detail:
        "Email and SMS buttons remain explicit actions; this panel only reviews readiness.",
      tone:
        contractorEmailNeedsRecovery(contractorSendStatus) ||
        contractorEmailNeedsRecovery(contractorSmsStatus)
          ? "danger"
          : contractorSendStatus !== "not_sent" ||
              contractorSmsStatus !== "not_sent"
            ? "primary"
            : "neutral",
      icon: <Send size={16} />,
    },
    {
      id: "completion-recipients",
      title: "Completion recipients",
      statusLabel: completionReviewRows.length
        ? `${reviewedRecipients}/${completionReviewRows.length} reviewed`
        : workOrder.status === "completed"
          ? "No copy ready"
          : "Locked",
      detail: completionReviewRows.length
        ? "Owner, tenant, and contractor closeout copy can be reviewed below."
        : "Complete the job before recipient-review cards unlock.",
      tone:
        completionReviewRows.length === 0
          ? "neutral"
          : reviewedRecipients === completionReviewRows.length
            ? "success"
            : "warning",
      icon: <CheckCircle2 size={16} />,
    },
    {
      id: "activity-audit",
      title: "Activity audit",
      statusLabel: latestActivity ? latestActivity.label : "No activity",
      detail: latestActivity
        ? `${formatDateTime(latestActivity.at)} · ${externalActivityCount} external/provider rows`
        : "Comments, provider receipts, and closeout events will appear below.",
      tone: latestActivity?.tone ?? "neutral",
      icon: <Activity size={16} />,
    },
  ];
}

function buildLiveActionReviewItems({
  workOrder,
  completionReadiness,
  linkedInvoiceHandoff,
  completionReviewRows,
  contractorSendStatus,
  contractorSmsStatus,
}: {
  workOrder: MaintenanceWorkOrderRecord;
  completionReadiness: ReturnType<typeof maintenanceCompletionReadiness>;
  linkedInvoiceHandoff: ReturnType<typeof invoiceBillingHandoff> | null;
  completionReviewRows: CompletionReviewRow[];
  contractorSendStatus: string;
  contractorSmsStatus: string;
}): LiveActionReviewItem[] {
  const phoneHref = phoneActionHref(workOrder.contractor_phone, "tel");
  const smsHref = phoneActionHref(workOrder.contractor_phone, "sms");
  const phoneLooksInternational = Boolean(
    workOrder.contractor_phone?.replace(/[^\d+]/g, "").startsWith("+"),
  );
  const reviewedCount = completionReviewRows.filter(
    (row) => row.reviewedAt,
  ).length;
  const completionCopyReady = completionReviewRows.length > 0;

  return [
    {
      id: "phone",
      title: "Real-phone check",
      statusLabel: workOrder.contractor_phone
        ? phoneLooksInternational
          ? "Phone ready"
          : "Check format"
        : "No phone",
      detail: phoneReviewDetail(workOrder.contractor_phone),
      tone: workOrder.contractor_phone
        ? phoneLooksInternational
          ? "success"
          : "warning"
        : "neutral",
      href: phoneHref,
      actionLabel: "Call",
      secondaryHref: smsHref,
      secondaryLabel: "SMS app",
      icon: <PhoneCall size={16} />,
    },
    {
      id: "email",
      title: "Contractor email",
      statusLabel:
        contractorSendStatus === "not_sent"
          ? "Not sent"
          : label(contractorSendStatus),
      detail: workOrder.contractor_email
        ? "Review the email copy and provider receipt history before sending."
        : "Add a contractor email before sending an update.",
      tone: contractorEmailNeedsRecovery(contractorSendStatus)
        ? "danger"
        : contractorSendStatus === "not_sent"
          ? "neutral"
          : "primary",
      href: "#contractor-email-review",
      actionLabel: "Review email",
      icon: <Mail size={16} />,
    },
    {
      id: "sms",
      title: "Contractor SMS",
      statusLabel:
        contractorSmsStatus === "not_sent"
          ? "Not sent"
          : label(contractorSmsStatus),
      detail: workOrder.contractor_phone
        ? "Review the short SMS body and phone format before sending."
        : "Add a contractor phone before sending an SMS.",
      tone: contractorEmailNeedsRecovery(contractorSmsStatus)
        ? "danger"
        : contractorSmsStatus === "not_sent"
          ? "neutral"
          : "primary",
      href: "#contractor-sms-review",
      actionLabel: "Review SMS",
      icon: <Send size={16} />,
    },
    {
      id: "completion",
      title: "Completion closeout",
      statusLabel: completionCopyReady
        ? `${reviewedCount}/${completionReviewRows.length} reviewed`
        : completionReadiness.statusLabel,
      detail: completionCopyReady
        ? "Recipient closeout copy is generated; review each audience before external updates."
        : completionReadiness.handoff,
      tone: completionCopyReady
        ? reviewedCount === completionReviewRows.length
          ? "success"
          : "warning"
        : completionReadiness.tone,
      href: "#job-completion-handoff",
      actionLabel: completionCopyReady ? "Review copy" : "Review closeout",
      icon: <CheckCircle2 size={16} />,
    },
    {
      id: "billing",
      title: "Billing handoff",
      statusLabel: linkedInvoiceHandoff?.label ?? "No invoice link",
      detail:
        linkedInvoiceHandoff?.message ??
        "Link an approved invoice draft when billing needs dispatch or reconciliation.",
      tone: linkedInvoiceHandoff?.tone ?? "neutral",
      href: linkedInvoiceHandoff?.href ?? "#job-completion-handoff",
      actionLabel: linkedInvoiceHandoff?.action ?? "Review link",
      icon: <ReceiptText size={16} />,
    },
  ];
}

function linkedDocuments(
  workOrder: MaintenanceWorkOrderRecord,
  documents: DocumentRecord[],
) {
  const linkedIds = new Set(
    [
      workOrder.source_document_id,
      ...workOrder.document_ids,
      ...workOrder.photo_document_ids,
    ].filter(Boolean),
  );
  return documents.filter((document) => linkedIds.has(document.id));
}

function quoteDocumentRows(
  workOrder: MaintenanceWorkOrderRecord,
  documents: DocumentRecord[],
) {
  const rawQuoteDocuments = Array.isArray(workOrder.metadata.quote_documents)
    ? workOrder.metadata.quote_documents
    : [];
  const rows = rawQuoteDocuments.filter(isRecord).map((entry) => {
    const documentId = metadataText(entry.document_id);
    const document = documents.find((item) => item.id === documentId);
    return {
      id:
        documentId ??
        `${metadataText(entry.filename) ?? "quote"}-${metadataText(entry.uploaded_at) ?? ""}`,
      documentId,
      filename:
        metadataText(entry.filename) ??
        document?.filename ??
        "Contractor quote",
      notes: metadataText(entry.notes) ?? document?.notes ?? null,
      uploadedAt:
        metadataText(entry.uploaded_at) ?? document?.created_at ?? null,
      category: document?.category ?? null,
      byteSize: document?.byte_size ?? null,
    };
  });
  if (rows.length) {
    return rows;
  }
  return linkedDocuments(workOrder, documents).map((document) => ({
    id: document.id,
    documentId: document.id,
    filename: document.filename,
    notes: document.notes,
    uploadedAt: document.created_at,
    category: document.category,
    byteSize: document.byte_size,
  }));
}

function activityAudience({
  visibility,
  source,
  actor,
  event,
}: {
  visibility: string | null;
  source: string | null;
  actor: string | null;
  event: string | null;
}): ActivityAudience {
  const normalized = [visibility, source, actor, event]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (visibility === "tenant" || normalized.includes("tenant_portal")) {
    return "tenant";
  }
  if (visibility === "contractor") {
    return "contractor";
  }
  if (
    normalized.includes("provider") ||
    normalized.includes("sendgrid") ||
    normalized.includes("twilio") ||
    normalized.includes("sms") ||
    normalized.includes("email_attempted")
  ) {
    return "provider";
  }
  if (source === "system" || actor === "system") {
    return "system";
  }
  return "internal";
}

function activityAudienceLabel(audience: ActivityAudience) {
  const labels: Record<ActivityAudience, string> = {
    tenant: "Tenant visible",
    contractor: "Contractor visible",
    provider: "Provider evidence",
    internal: "Internal audit",
    system: "System audit",
  };
  return labels[audience];
}

function activityAudienceTone(audience: ActivityAudience): Tone {
  if (audience === "tenant") {
    return "primary";
  }
  if (audience === "contractor") {
    return "warning";
  }
  if (audience === "provider") {
    return "success";
  }
  return "neutral";
}

function activityTone(status: string | null, audience: ActivityAudience): Tone {
  const normalized = status?.toLowerCase();
  if (["failed", "declined", "cancelled"].includes(normalized ?? "")) {
    return "danger";
  }
  if (
    ["pending", "queued", "attention", "skipped"].includes(normalized ?? "")
  ) {
    return "warning";
  }
  if (
    ["completed", "approved", "sent", "delivered", "opened"].includes(
      normalized ?? "",
    )
  ) {
    return "success";
  }
  return activityAudienceTone(audience);
}

function latestActivityForAudience(
  timeline: ActivityTimelineEntry[],
  audience: ActivityAudience,
) {
  return timeline
    .filter((entry) => entry.audience === audience)
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))[0];
}

function maintenanceForwardingDraftRows({
  workOrder,
  tenantLabel,
  timeline,
}: {
  workOrder: MaintenanceWorkOrderRecord;
  tenantLabel: string;
  timeline: ActivityTimelineEntry[];
}): ForwardingDraftRow[] {
  const contractorLabel = workOrder.contractor_name ?? "the contractor";
  const tenantActivity = latestActivityForAudience(timeline, "tenant");
  const contractorActivity = latestActivityForAudience(timeline, "contractor");
  return [
    {
      target: "contractor",
      title: "Tenant to contractor",
      sourceLabel: "Tenant visible",
      statusLabel: tenantActivity ? "Draft ready" : "Waiting for tenant note",
      detail: tenantActivity
        ? "Draft from latest tenant-visible activity for the contractor."
        : "Add or receive a tenant-visible update before drafting the contractor forward.",
      body: tenantActivity
        ? [
            `Hi ${contractorLabel},`,
            "",
            `Please note the latest tenant-facing update for ${workOrder.title}:`,
            tenantActivity.detail,
            "",
            "Please confirm the next action or timing before we send anything further.",
          ].join("\n")
        : null,
    },
    {
      target: "tenant",
      title: "Contractor to tenant",
      sourceLabel: "Contractor visible",
      statusLabel: contractorActivity
        ? "Draft ready"
        : "Waiting for contractor note",
      detail: contractorActivity
        ? "Draft from latest contractor-visible activity for the tenant."
        : "Add a contractor-visible update before drafting the tenant forward.",
      body: contractorActivity
        ? [
            `Hi ${tenantLabel},`,
            "",
            `Update from ${contractorLabel} on ${workOrder.title}:`,
            contractorActivity.detail,
            "",
            "We will keep this with Operations until the message is reviewed.",
          ].join("\n")
        : null,
    },
  ];
}

function liveReviewChecklistText(cards: LiveReviewCard[]) {
  return [
    "Operations live review checklist",
    ...cards.map(
      (card) => `- ${card.title}: ${card.statusLabel} - ${card.detail}`,
    ),
    "",
    "Review-only: sending email, SMS, billing handoff, and closeout remain explicit actions.",
  ].join("\n");
}

function liveReviewHandoffSteps({
  cards,
  items,
}: {
  cards: LiveReviewCard[];
  items: LiveActionReviewItem[];
}): LiveReviewHandoffStep[] {
  const reviewSteps = cards
    .filter((card) => ["danger", "warning"].includes(card.tone))
    .map((card) => ({
      id: `review-${card.id}`,
      title: card.title,
      statusLabel: card.statusLabel,
      detail: card.detail,
      tone: card.tone,
      actionLabel: "Resolve review item",
      href: null,
    }));
  const actionSteps = items
    .filter((item) => ["danger", "warning"].includes(item.tone))
    .map((item) => ({
      id: `action-${item.id}`,
      title: item.title,
      statusLabel: item.statusLabel,
      detail: item.detail,
      tone: item.tone,
      actionLabel: item.actionLabel,
      href: item.href,
    }));

  const steps = [...reviewSteps, ...actionSteps];
  if (steps.length) {
    return steps.slice(0, 4);
  }

  const primaryActions = items
    .filter((item) => item.tone === "primary")
    .map((item) => ({
      id: `action-${item.id}`,
      title: item.title,
      statusLabel: item.statusLabel,
      detail: item.detail,
      tone: item.tone,
      actionLabel: item.actionLabel,
      href: item.href,
    }));
  if (primaryActions.length) {
    return primaryActions.slice(0, 3);
  }

  return [
    {
      id: "ready",
      title: "Live controls reviewed",
      statusLabel: "Ready",
      detail:
        "No urgent live-review blockers are showing. Continue with explicit email, SMS, closeout, or billing actions as needed.",
      tone: "success",
      actionLabel: "Continue review",
      href: null,
    },
  ];
}

function liveReviewHandoffText(steps: LiveReviewHandoffStep[]) {
  return [
    "Operations live review handoff",
    ...steps.map(
      (step) =>
        `- ${step.title}: ${step.statusLabel} - ${step.actionLabel} - ${step.detail}`,
    ),
    "",
    "Review-only: this handoff does not send email, SMS, billing updates, or closeout messages.",
  ].join("\n");
}

function liveActionDockText(items: LiveActionReviewItem[]) {
  return [
    "Operations live action dock",
    ...items.map((item) =>
      [
        `- ${item.title}: ${item.statusLabel}`,
        item.actionLabel,
        item.detail,
        item.secondaryLabel ? `Secondary: ${item.secondaryLabel}` : null,
      ]
        .filter(Boolean)
        .join(" - "),
    ),
    "",
    "Review-only: this checklist does not place calls, open SMS, send email, complete work, or update billing.",
  ].join("\n");
}

function activityAuditText({
  workOrder,
  cards,
  timeline,
}: {
  workOrder: MaintenanceWorkOrderRecord;
  cards: ActivityAuditCard[];
  timeline: ActivityTimelineEntry[];
}) {
  return [
    "Operations activity audit",
    `Work order: ${workOrder.title}`,
    `Status: ${label(workOrder.status)}`,
    "",
    "Audit strip:",
    ...(cards.length
      ? cards.map(
          (card) =>
            `- ${card.label}: ${card.value} (${card.badge}) - ${card.detail}`,
        )
      : ["- No activity audit cards are available."]),
    "",
    "Timeline:",
    ...(timeline.length
      ? timeline
          .slice(0, 12)
          .map(
            (entry) =>
              `- ${formatDateTime(entry.at)} | ${entry.audienceLabel} | ${entry.label} | ${entry.detail}`,
          )
      : ["- No activity has been recorded yet."]),
    "",
    "Review-only: this audit does not add comments, send updates, or change the work order.",
  ].join("\n");
}

function completionReviewPacketSummary({
  workOrder,
  rows,
  completionReadiness,
}: {
  workOrder: MaintenanceWorkOrderRecord;
  rows: CompletionReviewRow[];
  completionReadiness: ReturnType<typeof maintenanceCompletionReadiness>;
}) {
  const reviewedCount = rows.filter((row) => row.reviewedAt).length;
  const pendingRows = rows.filter((row) => !row.reviewedAt);
  const blockers = uniqueList([
    workOrder.status !== "completed" ? "Job is not marked complete" : null,
    rows.length === 0 ? "Completion copy has not been generated" : null,
    ...completionReadiness.blockers,
    ...pendingRows.map((row) => row.statusLabel),
  ]);
  const tone: Tone =
    rows.length === 0 ? "neutral" : blockers.length ? "warning" : "success";
  const statusLabel =
    rows.length === 0
      ? "No packet ready"
      : blockers.length
        ? `${blockers.length} open item${blockers.length === 1 ? "" : "s"}`
        : "Packet reviewed";

  return {
    reviewedCount,
    blockers,
    tone,
    statusLabel,
  };
}

function completionReviewPacketText({
  workOrder,
  rows,
  completionReadiness,
  closeoutPhotoCount,
  closeoutHistoryCount,
  latestActivity,
  linkedInvoiceDraft,
}: {
  workOrder: MaintenanceWorkOrderRecord;
  rows: CompletionReviewRow[];
  completionReadiness: ReturnType<typeof maintenanceCompletionReadiness>;
  closeoutPhotoCount: number;
  closeoutHistoryCount: number;
  latestActivity: ActivityTimelineEntry | null;
  linkedInvoiceDraft: InvoiceDraftRecord | null;
}) {
  const packet = completionReviewPacketSummary({
    workOrder,
    rows,
    completionReadiness,
  });
  const recipientLines = rows.flatMap((row) =>
    [
      `${row.title}: ${row.reviewedAt ? `reviewed ${formatDateTime(row.reviewedAt)}` : row.statusLabel}`,
      row.note ? `Review note: ${row.note}` : null,
      row.body,
      "",
    ].filter((line): line is string => line !== null),
  );

  return [
    "Operations completion review packet",
    `Work order: ${workOrder.title}`,
    `Status: ${label(workOrder.status)} - ${packet.statusLabel}`,
    `Completed: ${formatDateTime(workOrder.completed_at)}`,
    `Closeout evidence: ${closeoutHistoryCount} closeout event${closeoutHistoryCount === 1 ? "" : "s"}; ${closeoutPhotoCount} photo${closeoutPhotoCount === 1 ? "" : "s"}`,
    `Billing handoff: ${
      linkedInvoiceDraft
        ? `${linkedInvoiceDraft.invoice_number ?? linkedInvoiceDraft.title} - ${label(linkedInvoiceDraft.status)}`
        : "No linked invoice draft"
    }`,
    `Latest activity: ${
      latestActivity
        ? `${latestActivity.label} at ${formatDateTime(latestActivity.at)} (${latestActivity.audienceLabel})`
        : "No activity recorded"
    }`,
    "",
    "Open review items:",
    ...(packet.blockers.length
      ? packet.blockers.map((blocker) => `- ${blocker}`)
      : ["- None"]),
    "",
    "Recipient copy:",
    ...(recipientLines.length ? recipientLines : ["No recipient copy ready."]),
    "Review-only: no owner, tenant, contractor, email, SMS, provider dispatch, or portal message has been sent from this packet.",
  ].join("\n");
}

function CompletionReviewPacketPanel({
  workOrder,
  rows,
  completionReadiness,
  closeoutPhotoCount,
  closeoutHistoryCount,
  latestActivity,
  linkedInvoiceDraft,
}: {
  workOrder: MaintenanceWorkOrderRecord;
  rows: CompletionReviewRow[];
  completionReadiness: ReturnType<typeof maintenanceCompletionReadiness>;
  closeoutPhotoCount: number;
  closeoutHistoryCount: number;
  latestActivity: ActivityTimelineEntry | null;
  linkedInvoiceDraft: InvoiceDraftRecord | null;
}) {
  const [copyReceipt, setCopyReceipt] = useState<string | null>(null);
  const packet = completionReviewPacketSummary({
    workOrder,
    rows,
    completionReadiness,
  });
  const copyPacket = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setCopyReceipt("Copy unavailable in this browser.");
      return;
    }
    await navigator.clipboard.writeText(
      completionReviewPacketText({
        workOrder,
        rows,
        completionReadiness,
        closeoutPhotoCount,
        closeoutHistoryCount,
        latestActivity,
        linkedInvoiceDraft,
      }),
    );
    setCopyReceipt("Completion review packet copied.");
  };

  return (
    <div className="grid gap-3 rounded-md border border-border bg-white px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="font-semibold text-foreground">
            Completion review packet
          </div>
          <div className="text-muted-foreground">
            Operator-ready closeout summary before external copy is sent.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={packet.tone}>{packet.statusLabel}</StatusBadge>
          <SecondaryButton
            type="button"
            className="min-h-9 rounded-lg px-3 text-xs"
            onClick={copyPacket}
          >
            <ClipboardCheck size={14} />
            Copy packet
          </SecondaryButton>
        </div>
      </div>
      {copyReceipt ? (
        <p className="text-xs font-medium text-success">{copyReceipt}</p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-md border border-border bg-muted/30 px-2 py-2">
          <div className="font-semibold text-foreground">Recipient review</div>
          <div className="text-muted-foreground">
            {packet.reviewedCount}/{rows.length} reviewed
          </div>
        </div>
        <div className="rounded-md border border-border bg-muted/30 px-2 py-2">
          <div className="font-semibold text-foreground">Evidence</div>
          <div className="text-muted-foreground">
            {closeoutHistoryCount} event
            {closeoutHistoryCount === 1 ? "" : "s"} · {closeoutPhotoCount} photo
            {closeoutPhotoCount === 1 ? "" : "s"}
          </div>
        </div>
        <div className="rounded-md border border-border bg-muted/30 px-2 py-2">
          <div className="font-semibold text-foreground">Latest activity</div>
          <div className="text-muted-foreground">
            {latestActivity
              ? `${latestActivity.label} · ${latestActivity.audienceLabel}`
              : "No activity recorded"}
          </div>
        </div>
      </div>
      {packet.blockers.length ? (
        <div className="grid gap-1 rounded-md border border-warning/20 bg-warning-soft px-2 py-2">
          <div className="font-semibold text-warning-strong">
            Open review items
          </div>
          {packet.blockers.map((blocker) => (
            <div key={blocker} className="text-muted-foreground">
              {blocker}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-success/20 bg-success-soft px-2 py-2 font-medium text-success-strong">
          Recipient copy and closeout evidence have been reviewed.
        </div>
      )}
    </div>
  );
}

function LiveReviewStrip({ cards }: { cards: LiveReviewCard[] }) {
  const [copyReceipt, setCopyReceipt] = useState<string | null>(null);
  const copyChecklist = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setCopyReceipt("Copy unavailable in this browser.");
      return;
    }
    await navigator.clipboard.writeText(liveReviewChecklistText(cards));
    setCopyReceipt("Live review checklist copied.");
  };

  return (
    <SectionPanel
      title="Live review"
      description="Phone, recipient, action, completion, and activity checks before touching live work controls."
      icon={<Activity size={17} className="text-primary" />}
      actions={
        <SecondaryButton type="button" onClick={copyChecklist}>
          <ClipboardCheck size={15} />
          Copy checklist
        </SecondaryButton>
      }
    >
      <div className="grid gap-3 p-4">
        {copyReceipt ? (
          <p className="text-sm font-medium text-success">{copyReceipt}</p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {cards.map((card) => (
            <div
              key={card.id}
              className="grid gap-2 rounded-md border border-border bg-white p-3 text-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary-soft text-primary">
                  {card.icon}
                </span>
                <StatusBadge tone={card.tone}>{card.statusLabel}</StatusBadge>
              </div>
              <div className="font-semibold text-foreground">{card.title}</div>
              <p className="text-sm leading-5 text-muted-foreground">
                {card.detail}
              </p>
            </div>
          ))}
        </div>
      </div>
    </SectionPanel>
  );
}

function LiveReviewHandoffPanel({ steps }: { steps: LiveReviewHandoffStep[] }) {
  const [copyReceipt, setCopyReceipt] = useState<string | null>(null);
  const firstStep = steps[0];
  const overallTone =
    steps.find((step) => step.tone === "danger")?.tone ??
    steps.find((step) => step.tone === "warning")?.tone ??
    firstStep?.tone ??
    "neutral";
  const copyHandoff = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setCopyReceipt("Copy unavailable in this browser.");
      return;
    }
    await navigator.clipboard.writeText(liveReviewHandoffText(steps));
    setCopyReceipt("Live handoff copied.");
  };

  return (
    <SectionPanel
      title="Live review handoff"
      description="The next practical checks before operators touch live work-order actions."
      icon={<ShieldCheck size={17} className="text-primary" />}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <SecondaryButton type="button" onClick={copyHandoff}>
            <ClipboardCheck size={15} />
            Copy handoff
          </SecondaryButton>
          <StatusBadge tone={overallTone}>
            {firstStep?.statusLabel ?? "No checks"}
          </StatusBadge>
        </div>
      }
    >
      <div className="grid gap-4 p-4">
        {copyReceipt ? (
          <p className="text-sm font-medium text-success">{copyReceipt}</p>
        ) : null}
        {firstStep ? (
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-foreground">
                First action: {firstStep.title}
              </div>
              <StatusBadge tone={firstStep.tone}>
                {firstStep.statusLabel}
              </StatusBadge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {firstStep.detail}
            </p>
          </div>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {steps.map((step) => {
            const body = (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-foreground">
                    {step.title}
                  </div>
                  <StatusBadge tone={step.tone}>{step.statusLabel}</StatusBadge>
                </div>
                <p className="text-sm leading-5 text-muted-foreground">
                  {step.detail}
                </p>
                <span className="text-xs font-semibold text-primary">
                  {step.actionLabel}
                </span>
              </>
            );
            const className =
              "grid gap-2 rounded-md border border-border bg-white p-3 text-left text-sm shadow-leasiumXs transition hover:bg-muted/60";
            if (step.href) {
              return (
                <a key={step.id} href={step.href} className={className}>
                  {body}
                </a>
              );
            }
            return (
              <div key={step.id} className={className}>
                {body}
              </div>
            );
          })}
        </div>
      </div>
    </SectionPanel>
  );
}

function LiveActionDock({ items }: { items: LiveActionReviewItem[] }) {
  const [copyReceipt, setCopyReceipt] = useState<string | null>(null);
  const blockedCount = items.filter((item) =>
    ["danger", "warning"].includes(item.tone),
  ).length;
  const copyActionDock = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setCopyReceipt("Copy unavailable in this browser.");
      return;
    }
    await navigator.clipboard.writeText(liveActionDockText(items));
    setCopyReceipt("Action dock copied.");
  };

  return (
    <SectionPanel
      title="Live action dock"
      description="Quick review jumps for the actions operators touch on a phone or during a live work-order check."
      icon={<PhoneCall size={17} className="text-primary" />}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <SecondaryButton type="button" onClick={copyActionDock}>
            <ClipboardCheck size={15} />
            Copy dock
          </SecondaryButton>
          <StatusBadge tone={blockedCount ? "warning" : "success"}>
            {blockedCount ? `${blockedCount} checks` : "Ready"}
          </StatusBadge>
        </div>
      }
    >
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
        {copyReceipt ? (
          <p className="text-sm font-medium text-success sm:col-span-2 xl:col-span-5">
            {copyReceipt}
          </p>
        ) : null}
        {items.map((item) => (
          <div
            key={item.id}
            className="grid min-w-0 gap-3 rounded-md border border-border bg-white p-3 text-sm shadow-leasiumXs"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
                {item.icon}
              </span>
              <StatusBadge tone={item.tone}>{item.statusLabel}</StatusBadge>
            </div>
            <div className="grid gap-1">
              <div className="font-semibold text-foreground">{item.title}</div>
              <p className="text-sm leading-5 text-muted-foreground">
                {item.detail}
              </p>
            </div>
            <div className="mt-auto flex flex-wrap gap-2">
              {item.href ? (
                <a
                  href={item.href}
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border-strong bg-white px-3 text-xs font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
                >
                  <ArrowUpRight size={13} />
                  {item.actionLabel}
                </a>
              ) : (
                <StatusBadge tone="neutral">{item.actionLabel}</StatusBadge>
              )}
              {item.secondaryHref && item.secondaryLabel ? (
                <a
                  href={item.secondaryHref}
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border bg-muted/40 px-3 text-xs font-semibold text-slate transition duration-200 ease-leasium hover:bg-muted"
                >
                  {item.secondaryLabel}
                </a>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </SectionPanel>
  );
}

function MaintenanceDetailRoute() {
  const params = useParams<{ workOrderId: string }>();
  const workOrderId = params.workOrderId;
  const queryClient = useQueryClient();
  const [quoteFile, setQuoteFile] = useState<File | null>(null);
  const [quoteNotes, setQuoteNotes] = useState("");
  const [invoiceDraftId, setInvoiceDraftId] = useState("");
  const [contractorEmailTemplate, setContractorEmailTemplate] =
    useState<ContractorEmailTemplateKey>("custom");
  const [contractorEmailSubject, setContractorEmailSubject] = useState("");
  const [contractorEmailBody, setContractorEmailBody] = useState("");
  const [contractorSmsTemplate, setContractorSmsTemplate] =
    useState<ContractorSmsTemplateKey>("custom");
  const [contractorSmsBody, setContractorSmsBody] = useState("");
  const [closeoutNoteDraft, setCloseoutNoteDraft] = useState("");
  const [closeoutPhoto, setCloseoutPhoto] = useState<File | null>(null);
  const [completionReviewNotes, setCompletionReviewNotes] = useState<
    Record<CompletionReviewAudience, string>
  >(emptyCompletionReviewNotes);
  const [
    completionCommunicationCopyReceipt,
    setCompletionCommunicationCopyReceipt,
  ] = useState<Partial<Record<CompletionReviewAudience, string>>>({});
  const [forwardingDraftCopyReceipt, setForwardingDraftCopyReceipt] = useState<
    Partial<Record<ForwardingDraftTarget, string>>
  >({});
  const [commentBody, setCommentBody] = useState("");
  const [commentVisibility, setCommentVisibility] = useState<
    "internal" | "contractor" | "tenant"
  >("internal");
  const [activityAuditReceipt, setActivityAuditReceipt] = useState<
    string | null
  >(null);

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
  const quoteDocuments = workOrder
    ? quoteDocumentRows(workOrder, documents)
    : [];
  const closeout = workOrder ? closeoutRecord(workOrder) : {};
  const savedCloseoutNote = metadataText(closeout.note);
  const savedCloseoutAt = metadataText(closeout.completed_at);
  const closeoutCommunication = metadataRecord(closeout.communication);
  const ownerUpdateCopy = metadataText(closeoutCommunication.owner_update);
  const tenantUpdateCopy = metadataText(closeoutCommunication.tenant_update);
  const contractorFollowUpCopy = metadataText(
    closeoutCommunication.contractor_follow_up,
  );
  const communicationReview = metadataRecord(closeout.communication_review);
  const ownerReview = workOrder ? ownerReviewRecord(workOrder) : {};
  const ownerCommunicationReview = metadataRecord(communicationReview.owner);
  const tenantCommunicationReview = metadataRecord(communicationReview.tenant);
  const contractorCommunicationReview = metadataRecord(
    communicationReview.contractor,
  );
  const ownerReviewAt =
    metadataText(ownerCommunicationReview.reviewed_at) ??
    metadataText(ownerReview.reviewed_at);
  const ownerReviewNoteSaved =
    metadataText(ownerCommunicationReview.note) ??
    metadataText(ownerReview.note);
  const tenantReviewAt = metadataText(tenantCommunicationReview.reviewed_at);
  const tenantReviewNoteSaved = metadataText(tenantCommunicationReview.note);
  const contractorReviewAt = metadataText(
    contractorCommunicationReview.reviewed_at,
  );
  const contractorReviewNoteSaved = metadataText(
    contractorCommunicationReview.note,
  );
  const ownerReviewHistory = workOrder ? ownerReviewHistoryRows(workOrder) : [];
  const completionReviewRows: CompletionReviewRow[] = [
    {
      audience: "owner",
      title: "Owner completion review",
      readyLabel: "Owner update ready",
      body: ownerUpdateCopy,
      reviewedAt: ownerReviewAt,
      note: ownerReviewNoteSaved,
      statusLabel: ownerReviewAt
        ? "Owner review recorded"
        : "Needs owner review",
      buttonLabel: "Mark owner reviewed",
      textareaLabel: "Owner review note",
      placeholder: "Record owner approval, wording edits, or send readiness.",
    },
    {
      audience: "contractor",
      title: "Contractor closeout review",
      readyLabel: "Contractor follow-up ready",
      body: contractorFollowUpCopy,
      reviewedAt: contractorReviewAt,
      note: contractorReviewNoteSaved,
      statusLabel: contractorReviewAt
        ? "Contractor review recorded"
        : "Needs contractor review",
      buttonLabel: "Mark contractor reviewed",
      textareaLabel: "Contractor review note",
      placeholder: "Record contractor wording edits or follow-up readiness.",
    },
    {
      audience: "tenant",
      title: "Tenant closeout review",
      readyLabel: "Tenant update ready",
      body: tenantUpdateCopy,
      reviewedAt: tenantReviewAt,
      note: tenantReviewNoteSaved,
      statusLabel: tenantReviewAt
        ? "Tenant review recorded"
        : "Needs tenant review",
      buttonLabel: "Mark tenant reviewed",
      textareaLabel: "Tenant review note",
      placeholder: "Record tenant wording edits or portal update readiness.",
    },
  ].filter((row): row is CompletionReviewRow => Boolean(row.body));
  const closeoutPhotos = workOrder
    ? closeoutPhotoRows(workOrder, documents)
    : [];
  const closeoutHistory = workOrder
    ? closeoutHistoryRows(workOrder, documents)
    : [];
  const reopenHistory = workOrder ? reopenHistoryRows(workOrder) : [];
  const timeline = workOrder ? activityRows(workOrder) : [];
  const forwardingDraftRows = workOrder
    ? maintenanceForwardingDraftRows({
        workOrder,
        tenantLabel: tenantName(tenants, workOrder.tenant_id),
        timeline,
      })
    : [];
  const linkedInvoiceDraft = workOrder?.invoice_draft_id
    ? (invoiceDrafts.find((draft) => draft.id === workOrder.invoice_draft_id) ??
      null)
    : null;
  const matchingInvoiceDrafts = invoiceDrafts.filter((draft) => {
    if (!workOrder) {
      return false;
    }
    if (
      workOrder.tenant_id &&
      draft.tenant_id &&
      draft.tenant_id !== workOrder.tenant_id
    ) {
      return false;
    }
    if (
      workOrder.property_id &&
      draft.property_id &&
      draft.property_id !== workOrder.property_id
    ) {
      return false;
    }
    return (
      draft.status === "approved" || draft.id === workOrder.invoice_draft_id
    );
  });
  const selectedInvoiceDraft = matchingInvoiceDrafts.find(
    (draft) => draft.id === invoiceDraftId,
  );
  const linkedInvoiceDeliveryState = linkedInvoiceDraft
    ? invoiceDeliveryState(linkedInvoiceDraft)
    : {};
  const linkedInvoiceDeliveryReady =
    linkedInvoiceDeliveryState.delivery_ready === true;
  const linkedInvoicePdfArtifact = linkedInvoiceDraft
    ? invoicePdfArtifact(linkedInvoiceDraft)
    : {};
  const linkedInvoicePdfDocumentId = metadataText(
    linkedInvoicePdfArtifact.document_id,
  );
  const linkedInvoicePaymentStatus = linkedInvoiceDraft
    ? (metadataText(invoicePaymentStatus(linkedInvoiceDraft).status) ??
      "unpaid")
    : null;
  const linkedInvoiceBlockers = linkedInvoiceDraft
    ? [
        ...invoiceReadinessBlockers(linkedInvoiceDraft),
        ...invoiceDeliveryBlockers(linkedInvoiceDraft),
      ]
    : [];
  const linkedInvoiceHandoff =
    linkedInvoiceDraft && workOrder
      ? invoiceBillingHandoff(workOrder, linkedInvoiceDraft)
      : null;
  const linkedInvoiceRecoveryReasons = linkedInvoiceDraft
    ? invoiceRecoveryReasons(linkedInvoiceDraft)
    : [];
  const linkedInvoiceRecoveryPath = linkedInvoiceDraft
    ? invoiceRecoveryPath(linkedInvoiceDraft)
    : null;
  const completionReadiness = workOrder
    ? maintenanceCompletionReadiness(
        workOrder,
        linkedInvoiceDraft,
        quoteDocuments,
      )
    : null;
  const contractorSendState = workOrder
    ? contractorEmailSendState(workOrder)
    : {};
  const contractorSendStatus =
    metadataText(contractorSendState.status) ?? "not_sent";
  const contractorSendSubject = metadataText(contractorSendState.subject);
  const contractorSendError = metadataText(contractorSendState.error);
  const contractorSendBody = metadataText(contractorSendState.body);
  const contractorSendTemplateLabel = templateVersionLabel(
    metadataText(contractorSendState.template_key),
    metadataText(contractorSendState.template_version),
  );
  const contractorRetryCount =
    typeof contractorSendState.retry_count === "number"
      ? contractorSendState.retry_count
      : null;
  const contractorNeedsRecovery =
    contractorEmailNeedsRecovery(contractorSendStatus);
  const contractorRecoveryCopy = contractorEmailRecoveryCopy(
    contractorSendStatus,
    contractorSendError,
  );
  const contractorReceiptRows = workOrder
    ? contractorEmailReceipts(workOrder)
    : [];
  const contractorHistoryRows = workOrder
    ? contractorEmailHistoryRows(workOrder)
    : [];
  const contractorSmsState = workOrder ? contractorSmsSendState(workOrder) : {};
  const contractorSmsStatus =
    metadataText(contractorSmsState.status) ?? "not_sent";
  const contractorSmsError = metadataText(contractorSmsState.error);
  const contractorSmsStoredBody = metadataText(contractorSmsState.body);
  const contractorSmsRetryCount =
    typeof contractorSmsState.retry_count === "number"
      ? contractorSmsState.retry_count
      : null;
  const contractorSmsNeedsRecovery =
    contractorEmailNeedsRecovery(contractorSmsStatus);
  const contractorSmsRecoveryCopy = contractorEmailRecoveryCopy(
    contractorSmsStatus,
    contractorSmsError,
  );
  const contractorSmsRows = workOrder
    ? contractorSmsHistoryRows(workOrder)
    : [];
  const activityAuditCards = workOrder
    ? buildActivityAuditCards({
        timeline,
        quoteDocumentsCount: quoteDocuments.length,
        closeoutPhotoCount: closeoutPhotos.length,
        closeoutHistoryCount: closeoutHistory.length,
        ownerReviewAt,
        contractorEmailEvidenceCount: contractorHistoryRows.length,
        contractorSmsEvidenceCount: contractorSmsRows.length,
      })
    : [];
  const copyActivityAudit = async () => {
    if (!workOrder) {
      return;
    }
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setActivityAuditReceipt("Copy unavailable in this browser.");
      return;
    }
    await navigator.clipboard.writeText(
      activityAuditText({
        workOrder,
        cards: activityAuditCards,
        timeline,
      }),
    );
    setActivityAuditReceipt("Activity audit copied.");
  };
  const latestContractorReceipt = contractorReceiptRows[0] ?? null;
  const latestContractorReceiptStatus =
    metadataText(latestContractorReceipt?.status) ?? null;
  const latestContractorReceiptAt =
    metadataText(latestContractorReceipt?.received_at) ??
    metadataText(contractorSendState.attempted_at);
  const contractorMessageDefault = workOrder
    ? contractorNeedsRecovery && contractorSendBody
      ? contractorSendBody
      : contractorEmailDefaultBody(workOrder)
    : "";
  const contractorSubjectDefault = workOrder
    ? contractorNeedsRecovery && contractorSendSubject
      ? contractorSendSubject
      : contractorEmailDefaultSubject(workOrder)
    : "";
  const contractorSmsDefault = workOrder
    ? contractorSmsNeedsRecovery && contractorSmsStoredBody
      ? contractorSmsStoredBody
      : contractorSmsDefaultBody(workOrder)
    : "";
  const liveReviewCards = workOrder
    ? buildLiveReviewCards({
        workOrder,
        timeline,
        completionReviewRows,
        contractorSendStatus,
        contractorSmsStatus,
      })
    : [];
  const liveActionReviewItems =
    workOrder && completionReadiness
      ? buildLiveActionReviewItems({
          workOrder,
          completionReadiness,
          linkedInvoiceHandoff,
          completionReviewRows,
          contractorSendStatus,
          contractorSmsStatus,
        })
      : [];
  const liveReviewHandoff = liveReviewHandoffSteps({
    cards: liveReviewCards,
    items: liveActionReviewItems,
  });
  const contractorTemplateOptions = useMemo(
    () => (workOrder ? contractorEmailTemplates(workOrder) : []),
    [workOrder],
  );
  const contractorSmsTemplateOptions = useMemo(
    () => (workOrder ? contractorSmsTemplates(workOrder) : []),
    [workOrder],
  );
  const canReopenWorkOrder =
    workOrder !== null && ["completed", "cancelled"].includes(workOrder.status);

  const refresh = () => {
    workOrderQuery.refetch();
    documentsQuery.refetch();
    invoiceDraftsQuery.refetch();
  };

  const updateMutation = useMutation({
    mutationFn: (payload: Partial<MaintenanceWorkOrderPayload>) =>
      updateMaintenanceWorkOrder(workOrderId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["maintenance-work-order", workOrderId],
      });
      queryClient.invalidateQueries({
        queryKey: ["operations-maintenance", entityId],
      });
    },
  });

  // v2 maintenance categorisation: the operator clicks Classify with AI and
  // the backend stamps work_order_metadata.ai_classification with a
  // suggested contractor. Soft-fails 503 when OPENAI_API_KEY is unset.
  const classifyMutation = useMutation({
    mutationFn: () => classifyMaintenanceWorkOrder(workOrderId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["maintenance-work-order", workOrderId],
      });
    },
  });

  const prepareInvoiceMutation = useMutation({
    mutationFn: (draftId: string) => prepareInvoiceDraftDelivery(draftId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["maintenance-detail-invoice-drafts", entityId],
      });
    },
  });

  const approveInvoiceMutation = useMutation({
    mutationFn: (draftId: string) =>
      updateInvoiceDraft(draftId, { status: "approved" }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["maintenance-detail-invoice-drafts", entityId],
      });
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
        document_ids: Array.from(
          new Set([...workOrder.document_ids, document.id]),
        ),
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
      queryClient.invalidateQueries({
        queryKey: ["maintenance-work-order", workOrderId],
      });
      queryClient.invalidateQueries({
        queryKey: ["maintenance-detail-documents", entityId],
      });
      queryClient.invalidateQueries({
        queryKey: ["operations-maintenance", entityId],
      });
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
      queryClient.invalidateQueries({
        queryKey: ["maintenance-work-order", workOrderId],
      });
      queryClient.invalidateQueries({
        queryKey: ["operations-maintenance", entityId],
      });
    },
  });

  const handleCommentSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!commentBody.trim()) {
      return;
    }
    commentMutation.mutate();
  };

  const contractorEmailMutation = useMutation({
    mutationFn: () => {
      if (!workOrder) {
        throw new Error("Work order is still loading.");
      }
      return sendMaintenanceWorkOrderContractorEmail(workOrderId, {
        subject: contractorEmailSubject.trim() || contractorSubjectDefault,
        body: contractorEmailBody.trim() || contractorMessageDefault,
        include_comment:
          !contractorNeedsRecovery || Boolean(contractorEmailBody.trim()),
      });
    },
    onSuccess: () => {
      setContractorEmailTemplate("custom");
      setContractorEmailSubject("");
      setContractorEmailBody("");
      queryClient.invalidateQueries({
        queryKey: ["maintenance-work-order", workOrderId],
      });
      queryClient.invalidateQueries({
        queryKey: ["operations-maintenance", entityId],
      });
    },
  });

  const contractorSmsMutation = useMutation({
    mutationFn: () => {
      if (!workOrder) {
        throw new Error("Work order is still loading.");
      }
      return sendMaintenanceWorkOrderContractorSms(workOrderId, {
        body: contractorSmsBody.trim() || contractorSmsDefault,
        include_comment:
          !contractorSmsNeedsRecovery || Boolean(contractorSmsBody.trim()),
      });
    },
    onSuccess: () => {
      setContractorSmsTemplate("custom");
      setContractorSmsBody("");
      queryClient.invalidateQueries({
        queryKey: ["maintenance-work-order", workOrderId],
      });
      queryClient.invalidateQueries({
        queryKey: ["operations-maintenance", entityId],
      });
    },
  });

  const handleContractorEmailTemplateChange = (
    templateKey: ContractorEmailTemplateKey,
  ) => {
    setContractorEmailTemplate(templateKey);
    if (templateKey === "custom") {
      return;
    }
    const template = contractorTemplateOptions.find(
      (option) => option.key === templateKey,
    );
    if (!template) {
      return;
    }
    setContractorEmailSubject(template.subject);
    setContractorEmailBody(template.body);
  };

  const handleContractorSmsTemplateChange = (
    templateKey: ContractorSmsTemplateKey,
  ) => {
    setContractorSmsTemplate(templateKey);
    if (templateKey === "custom") {
      return;
    }
    const template = contractorSmsTemplateOptions.find(
      (option) => option.key === templateKey,
    );
    if (!template) {
      return;
    }
    setContractorSmsBody(template.body);
  };

  const handleContractorEmailSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!workOrder?.contractor_email) {
      return;
    }
    contractorEmailMutation.mutate();
  };

  const handleContractorSmsSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!workOrder?.contractor_phone) {
      return;
    }
    contractorSmsMutation.mutate();
  };

  const closeoutMutation = useMutation({
    mutationFn: async () => {
      if (!workOrder) {
        throw new Error("Work order is still loading.");
      }
      const closeoutNote = closeoutNoteDraft.trim();
      const completedAt = new Date().toISOString();
      let uploadedDocument: DocumentRecord | null = null;
      if (closeoutPhoto) {
        uploadedDocument = await uploadDocument({
          entityId: workOrder.entity_id,
          propertyId: workOrder.property_id ?? undefined,
          tenancyUnitId: workOrder.tenancy_unit_id ?? undefined,
          tenantId: workOrder.tenant_id ?? undefined,
          leaseId: workOrder.lease_id ?? undefined,
          category: "other",
          notes: closeoutNote || "Maintenance closeout photo",
          file: closeoutPhoto,
        });
      }
      const existingCloseout = closeoutRecord(workOrder);
      const closeoutPhotoIds = uploadedDocument
        ? Array.from(
            new Set([
              ...closeoutPhotoDocumentIds(workOrder),
              uploadedDocument.id,
            ]),
          )
        : closeoutPhotoDocumentIds(workOrder);
      const closeoutNoteValue =
        closeoutNote || metadataText(existingCloseout.note);
      const closeoutPhotoId =
        uploadedDocument?.id ??
        metadataText(existingCloseout.photo_document_id);
      const closeoutCompletedAt = workOrder.completed_at ?? completedAt;
      const existingHistory = metadataRecordList(existingCloseout.history);
      const closeoutHistoryEntry = {
        at: closeoutCompletedAt,
        status: "completed",
        note: closeoutNoteValue,
        photo_document_id: closeoutPhotoId,
        photo_document_ids: closeoutPhotoIds,
      };
      const payload: Partial<MaintenanceWorkOrderPayload> = {
        status: "completed",
        completed_at: closeoutCompletedAt,
      };
      if (uploadedDocument) {
        payload.photo_document_ids = Array.from(
          new Set([...workOrder.photo_document_ids, uploadedDocument.id]),
        );
      }
      payload.metadata = {
        closeout: {
          ...existingCloseout,
          note: closeoutNoteValue,
          completed_at: closeoutCompletedAt,
          photo_document_id: closeoutPhotoId,
          photo_document_ids: closeoutPhotoIds,
          history: [...existingHistory, closeoutHistoryEntry],
          communication: closeoutCommunicationDrafts({
            workOrder,
            linkedInvoiceDraft,
            propertyLabel: propertyName(properties, workOrder.property_id),
            tenantLabel: tenantName(tenants, workOrder.tenant_id),
            closeoutNote: closeoutNoteValue,
            completedAt: closeoutCompletedAt,
          }),
        },
      };
      return updateMaintenanceWorkOrder(workOrder.id, payload);
    },
    onSuccess: () => {
      setCloseoutNoteDraft("");
      setCloseoutPhoto(null);
      queryClient.invalidateQueries({
        queryKey: ["maintenance-work-order", workOrderId],
      });
      queryClient.invalidateQueries({
        queryKey: ["maintenance-detail-documents", entityId],
      });
      queryClient.invalidateQueries({
        queryKey: ["operations-maintenance", entityId],
      });
    },
  });

  const completionReviewMutation = useMutation({
    mutationFn: (audience: CompletionReviewAudience) => {
      if (!workOrder) {
        throw new Error("Work order is still loading.");
      }
      const existingCloseout = closeoutRecord(workOrder);
      const communication = metadataRecord(existingCloseout.communication);
      const copyByAudience: Record<CompletionReviewAudience, string | null> = {
        owner: metadataText(communication.owner_update),
        tenant: metadataText(communication.tenant_update),
        contractor: metadataText(communication.contractor_follow_up),
      };
      const reviewCopy = copyByAudience[audience];
      if (!reviewCopy) {
        throw new Error("Complete the work order before closeout review.");
      }
      const existingCommunicationReview = metadataRecord(
        existingCloseout.communication_review,
      );
      const existingAudienceReview = metadataRecord(
        existingCommunicationReview[audience],
      );
      const existingCommunicationHistory = metadataRecordList(
        existingCommunicationReview.history,
      );
      const existingOwnerReview = metadataRecord(existingCloseout.owner_review);
      const existingHistory = metadataRecordList(existingOwnerReview.history);
      const reviewedAt = new Date().toISOString();
      const note = completionReviewNotes[audience].trim();
      const nextCommunicationReview = {
        ...existingCommunicationReview,
        [audience]: {
          ...existingAudienceReview,
          status: "reviewed",
          reviewed_at: reviewedAt,
          note: note || null,
          copy: reviewCopy,
        },
        history: [
          ...existingCommunicationHistory,
          {
            audience,
            status: "reviewed",
            reviewed_at: reviewedAt,
            note: note || null,
          },
        ],
      };
      const nextCloseout: Record<string, unknown> = {
        ...existingCloseout,
        communication_review: nextCommunicationReview,
      };
      if (audience === "owner") {
        nextCloseout.owner_review = {
          ...existingOwnerReview,
          status: "reviewed",
          reviewed_at: reviewedAt,
          note: note || null,
          owner_update: reviewCopy,
          history: [
            ...existingHistory,
            {
              status: "reviewed",
              reviewed_at: reviewedAt,
              note: note || null,
            },
          ],
        };
      }
      return updateMaintenanceWorkOrder(workOrder.id, {
        metadata: {
          closeout: nextCloseout,
        },
      });
    },
    onSuccess: (_data, audience) => {
      setCompletionReviewNotes((current) => ({
        ...current,
        [audience]: "",
      }));
      queryClient.invalidateQueries({
        queryKey: ["maintenance-work-order", workOrderId],
      });
      queryClient.invalidateQueries({
        queryKey: ["operations-maintenance", entityId],
      });
    },
  });

  const copyCompletionCommunication = async (row: CompletionReviewRow) => {
    const copied = await copyTextToClipboard(row.body);
    setCompletionCommunicationCopyReceipt((current) => ({
      ...current,
      [row.audience]: copied
        ? completionCommunicationCopyReceipts[row.audience]
        : "Copy unavailable in this browser.",
    }));
  };

  const copyForwardingDraft = async (row: ForwardingDraftRow) => {
    if (!row.body) {
      return;
    }
    const copied = await copyTextToClipboard(row.body);
    setForwardingDraftCopyReceipt((current) => ({
      ...current,
      [row.target]: copied
        ? forwardingDraftCopyReceipts[row.target]
        : "Copy unavailable in this browser.",
    }));
  };

  const handleCloseoutSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!completionReadiness?.canComplete) {
      return;
    }
    closeoutMutation.mutate();
  };

  const handleDetailsSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!workOrder) {
      return;
    }
    const data = new FormData(event.currentTarget);
    const title = formText(data, "title") ?? workOrder.title;
    const priority = formText(data, "priority") ?? workOrder.priority;
    updateMutation.mutate({
      title,
      description: formText(data, "description"),
      priority: priority as MaintenanceWorkOrderPayload["priority"],
      contractor_name: formText(data, "contractor_name"),
      contractor_email: formText(data, "contractor_email"),
      contractor_phone: formText(data, "contractor_phone"),
      due_date: formText(data, "due_date"),
      notes: formText(data, "notes"),
    });
  };

  const handleReopenWorkOrder = () => {
    if (!workOrder || !canReopenWorkOrder) {
      return;
    }
    const reopenedAt = new Date().toISOString();
    const existingHistory = metadataRecordList(
      workOrder.metadata.reopen_history,
    );
    updateMutation.mutate({
      status: reopenedMaintenanceStatus(workOrder),
      completed_at: null,
      metadata: {
        reopen_history: [
          ...existingHistory,
          {
            reopened_at: reopenedAt,
            reopened_from: workOrder.status,
            previous_completed_at: workOrder.completed_at,
            closeout_note: savedCloseoutNote,
            reason: "Reopened from work-order detail.",
          },
        ],
      },
    });
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
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
              >
                <ArrowLeft size={16} />
                Operations
              </Link>
              <SecondaryButton type="button" onClick={refresh}>
                <RefreshCw size={15} />
                Refresh
              </SecondaryButton>
              {canReopenWorkOrder ? (
                <Button
                  type="button"
                  disabled={updateMutation.isPending}
                  onClick={handleReopenWorkOrder}
                >
                  {updateMutation.isPending ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <RefreshCw size={15} />
                  )}
                  Reopen job
                </Button>
              ) : null}
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
              icon={<AlertTriangle size={18} />}
              title="Work order unavailable"
              description={friendlyError(workOrderQuery.error)}
            />
          </SectionPanel>
        ) : null}

        {workOrder ? (
          <>
            <LiveReviewHandoffPanel steps={liveReviewHandoff} />
            <LiveReviewStrip cards={liveReviewCards} />
            <LiveActionDock items={liveActionReviewItems} />

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
                  {workOrder.completed_at ? (
                    <div className="text-muted-foreground">
                      Completed {formatDateTime(workOrder.completed_at)}
                    </div>
                  ) : null}
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

              <AiClassificationPanel
                workOrder={workOrder}
                onClassify={() => classifyMutation.mutate()}
                isClassifying={classifyMutation.isPending}
                error={classifyMutation.error as Error | null}
                onApplySuggestion={(contractorName) => {
                  updateMutation.mutate({ contractor_name: contractorName });
                }}
                applying={updateMutation.isPending}
              />

              <SectionPanel title="Contractor" icon={<UserRound size={17} />}>
                <div className="grid gap-3 p-4 text-sm">
                  <dl className="grid gap-2">
                    <div>
                      <dt className="text-muted-foreground">Name</dt>
                      <dd className="font-medium">
                        {workOrder.contractor_name ?? "Not assigned"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Contact</dt>
                      <dd className="grid gap-0.5">
                        <span>{workOrder.contractor_email ?? "-"}</span>
                        {workOrder.contractor_phone ? (
                          <span className="text-muted-foreground">
                            {workOrder.contractor_phone}
                          </span>
                        ) : null}
                      </dd>
                    </div>
                  </dl>

                  <form
                    id="contractor-email-review"
                    className="grid gap-3 rounded-md border border-border bg-muted/30 p-3"
                    onSubmit={handleContractorEmailSubmit}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge
                        tone={contractorEmailTone(contractorSendStatus)}
                      >
                        {contractorSendStatus === "not_sent"
                          ? "Email not sent"
                          : `Email ${label(contractorSendStatus)}${
                              contractorRetryCount
                                ? ` #${contractorRetryCount}`
                                : ""
                            }`}
                      </StatusBadge>
                      {latestContractorReceiptStatus ? (
                        <StatusBadge
                          tone={contractorEmailTone(
                            latestContractorReceiptStatus,
                          )}
                        >
                          Receipt {label(latestContractorReceiptStatus)}
                        </StatusBadge>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {contractorSendSubject
                        ? `${contractorSendSubject} - ${formatDateTime(
                            latestContractorReceiptAt,
                          )}`
                        : "SendGrid delivery and receipts will be stored on this work order."}
                    </div>
                    {contractorSendTemplateLabel ? (
                      <div className="text-xs font-semibold text-muted-foreground">
                        {contractorSendTemplateLabel}
                      </div>
                    ) : null}
                    {contractorRecoveryCopy ? (
                      <div
                        className={`rounded-md border p-2 text-xs ${
                          contractorNeedsRecovery
                            ? "border-warning/30 bg-warning/10 text-warning"
                            : "border-border bg-white text-muted-foreground"
                        }`}
                      >
                        {contractorRecoveryCopy}
                      </div>
                    ) : null}
                    {contractorHistoryRows.length ? (
                      <div className="grid gap-2 rounded-md border border-border bg-white p-2 text-xs">
                        <div className="font-semibold text-foreground">
                          Provider history
                        </div>
                        {contractorHistoryRows.map((entry, index) => (
                          <div
                            key={`${entry.kind}-${entry.status}-${entry.at ?? index}`}
                            className="grid gap-1 border-t border-border pt-2 first:border-t-0 first:pt-0"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusBadge
                                tone={contractorEmailTone(entry.status)}
                              >
                                {entry.kind} {label(entry.status)}
                                {entry.retryCount
                                  ? ` #${entry.retryCount}`
                                  : ""}
                              </StatusBadge>
                              <span className="text-muted-foreground">
                                {formatDateTime(entry.at)}
                              </span>
                            </div>
                            <div className="text-muted-foreground">
                              {entry.detail}
                            </div>
                            {entry.templateKey || entry.templateVersion ? (
                              <div className="text-muted-foreground">
                                {templateVersionLabel(
                                  entry.templateKey,
                                  entry.templateVersion,
                                )}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <Field label="Contractor update template">
                      <Select
                        value={contractorEmailTemplate}
                        onChange={(event) =>
                          handleContractorEmailTemplateChange(
                            event.target.value as ContractorEmailTemplateKey,
                          )
                        }
                      >
                        <option value="custom">Custom message</option>
                        {contractorTemplateOptions.map((template) => (
                          <option key={template.key} value={template.key}>
                            {template.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Email subject">
                      <Input
                        value={contractorEmailSubject}
                        onChange={(event) => {
                          setContractorEmailTemplate("custom");
                          setContractorEmailSubject(event.target.value);
                        }}
                        placeholder={contractorSubjectDefault}
                      />
                    </Field>
                    <label className="grid gap-1.5">
                      <span className="font-medium text-foreground">
                        Contractor email message
                      </span>
                      <textarea
                        aria-label="Contractor email message"
                        value={contractorEmailBody}
                        onChange={(event) => {
                          setContractorEmailTemplate("custom");
                          setContractorEmailBody(event.target.value);
                        }}
                        rows={4}
                        className="w-full rounded-xl border border-border bg-white px-3 py-3 text-sm outline-none transition-colors duration-200 ease-leasium focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15"
                        placeholder={contractorMessageDefault}
                      />
                    </label>
                    <Button
                      type="submit"
                      disabled={
                        !workOrder.contractor_email ||
                        contractorEmailMutation.isPending
                      }
                      title={
                        workOrder.contractor_email
                          ? "Send a provider-backed contractor update and keep the receipt on the work order."
                          : "Add a contractor email before sending."
                      }
                    >
                      {contractorEmailMutation.isPending ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Mail size={16} />
                      )}
                      {contractorNeedsRecovery ? "Retry update" : "Send update"}
                    </Button>
                    {contractorEmailMutation.error ? (
                      <p className="text-sm text-danger">
                        {friendlyError(contractorEmailMutation.error)}
                      </p>
                    ) : null}
                  </form>

                  <form
                    id="contractor-sms-review"
                    className="grid gap-3 rounded-md border border-border bg-white p-3"
                    onSubmit={handleContractorSmsSubmit}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge
                        tone={contractorEmailTone(contractorSmsStatus)}
                      >
                        {contractorSmsStatus === "not_sent"
                          ? "SMS not sent"
                          : `SMS ${label(contractorSmsStatus)}${
                              contractorSmsRetryCount
                                ? ` #${contractorSmsRetryCount}`
                                : ""
                            }`}
                      </StatusBadge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {workOrder.contractor_phone
                        ? "Twilio send attempts and delivery receipts will be stored on this work order."
                        : "Add a contractor phone number before sending an SMS."}
                    </div>
                    {contractorSmsRecoveryCopy ? (
                      <div
                        className={`rounded-md border p-2 text-xs ${
                          contractorSmsNeedsRecovery
                            ? "border-warning/30 bg-warning/10 text-warning"
                            : "border-border bg-white text-muted-foreground"
                        }`}
                      >
                        {contractorSmsRecoveryCopy}
                      </div>
                    ) : null}
                    {contractorSmsRows.length ? (
                      <div className="grid gap-2 rounded-md border border-border bg-muted/30 p-2 text-xs">
                        <div className="font-semibold text-foreground">
                          SMS provider history
                        </div>
                        {contractorSmsRows.map((entry, index) => (
                          <div
                            key={`${entry.kind}-${entry.status}-${entry.at ?? index}`}
                            className="grid gap-1 border-t border-border pt-2 first:border-t-0 first:pt-0"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusBadge
                                tone={contractorEmailTone(entry.status)}
                              >
                                {entry.kind} {label(entry.status)}
                                {entry.retryCount
                                  ? ` #${entry.retryCount}`
                                  : ""}
                              </StatusBadge>
                              <span className="text-muted-foreground">
                                {formatDateTime(entry.at)}
                              </span>
                            </div>
                            <div className="text-muted-foreground">
                              {entry.detail}
                            </div>
                            {entry.templateKey || entry.templateVersion ? (
                              <div className="text-muted-foreground">
                                {templateVersionLabel(
                                  entry.templateKey,
                                  entry.templateVersion,
                                )}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <Field label="Contractor SMS template">
                      <Select
                        value={contractorSmsTemplate}
                        onChange={(event) =>
                          handleContractorSmsTemplateChange(
                            event.target.value as ContractorSmsTemplateKey,
                          )
                        }
                      >
                        <option value="custom">Custom message</option>
                        {contractorSmsTemplateOptions.map((template) => (
                          <option key={template.key} value={template.key}>
                            {template.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <label className="grid gap-1.5">
                      <span className="font-medium text-foreground">
                        Contractor SMS message
                      </span>
                      <textarea
                        aria-label="Contractor SMS message"
                        value={contractorSmsBody}
                        onChange={(event) => {
                          setContractorSmsTemplate("custom");
                          setContractorSmsBody(event.target.value);
                        }}
                        rows={3}
                        className="w-full rounded-xl border border-border bg-white px-3 py-3 text-sm outline-none transition-colors duration-200 ease-leasium focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15"
                        placeholder={contractorSmsDefault}
                      />
                    </label>
                    <Button
                      type="submit"
                      disabled={
                        !workOrder.contractor_phone ||
                        contractorSmsMutation.isPending
                      }
                      title={
                        workOrder.contractor_phone
                          ? "Send an SMS update and keep the provider receipt on the work order."
                          : "Add a contractor phone before sending."
                      }
                    >
                      {contractorSmsMutation.isPending ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Send size={16} />
                      )}
                      {contractorSmsNeedsRecovery ? "Retry SMS" : "Send SMS"}
                    </Button>
                    {contractorSmsMutation.error ? (
                      <p className="text-sm text-danger">
                        {friendlyError(contractorSmsMutation.error)}
                      </p>
                    ) : null}
                  </form>
                  {workOrder.channel_receipts.length ? (
                    <ContractorChannelEvidence
                      receipts={workOrder.channel_receipts}
                    />
                  ) : null}
                </div>
              </SectionPanel>

              <SectionPanel title="Invoice" icon={<ReceiptText size={17} />}>
                <div className="grid gap-3 p-4 text-sm">
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
                  {linkedInvoiceDraft ? (
                    <div className="grid gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-foreground">
                          {linkedInvoiceDraft.invoice_number ??
                            linkedInvoiceDraft.title}
                        </span>
                        <StatusBadge
                          tone={invoiceStatusTone(linkedInvoiceDraft.status)}
                        >
                          {label(linkedInvoiceDraft.status)}
                        </StatusBadge>
                      </div>
                      <div className="grid gap-1 text-muted-foreground">
                        <span>
                          Amount {formatMoney(linkedInvoiceDraft.total_cents)}
                        </span>
                        <span>Payment {label(linkedInvoicePaymentStatus)}</span>
                        <span>
                          Delivery{" "}
                          {linkedInvoiceDeliveryReady
                            ? "ready"
                            : "needs preparation"}
                        </span>
                      </div>
                      {linkedInvoiceBlockers.length ? (
                        <div className="grid gap-1 text-danger">
                          {linkedInvoiceBlockers.slice(0, 2).map((blocker) => (
                            <span key={blocker}>{blocker}</span>
                          ))}
                        </div>
                      ) : null}
                      {linkedInvoiceHandoff ? (
                        <div className="grid gap-2 rounded-md border border-border bg-white p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge tone={linkedInvoiceHandoff.tone}>
                              {linkedInvoiceHandoff.label}
                            </StatusBadge>
                            <StatusBadge
                              tone={
                                linkedInvoiceHandoff.operationsReady
                                  ? "success"
                                  : "warning"
                              }
                            >
                              {linkedInvoiceHandoff.operationsReady
                                ? "Operations ready"
                                : "Operations still active"}
                            </StatusBadge>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {linkedInvoiceHandoff.message}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {linkedInvoiceHandoff.contractorSummary}
                          </div>
                          <Link
                            href={linkedInvoiceHandoff.href}
                            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border-strong bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
                          >
                            <ArrowUpRight size={14} />
                            {linkedInvoiceHandoff.action}
                          </Link>
                        </div>
                      ) : null}
                      {linkedInvoiceHandoff &&
                      linkedInvoiceRecoveryReasons.length > 0 ? (
                        <div className="grid gap-2 rounded-md border border-danger/20 bg-danger-soft p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge tone="danger">
                              Recovery needed
                            </StatusBadge>
                            <span className="text-xs font-semibold text-danger">
                              Billing Readiness owns retry and provider
                              recovery.
                            </span>
                          </div>
                          <div className="grid gap-1 text-xs text-muted-foreground">
                            {linkedInvoiceRecoveryReasons.map((reason) => (
                              <span key={reason}>{reason}</span>
                            ))}
                          </div>
                          <Link
                            href={linkedInvoiceHandoff.href}
                            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border-strong bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
                          >
                            <ArrowUpRight size={14} />
                            Recover in Billing
                          </Link>
                        </div>
                      ) : null}
                      {linkedInvoiceRecoveryPath ? (
                        <div className="grid gap-2 rounded-md border border-border bg-white p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge tone={linkedInvoiceRecoveryPath.tone}>
                              Billing recovery path
                            </StatusBadge>
                            <span className="text-xs font-semibold text-muted-foreground">
                              Dispatch, retry, and payment follow-up stay in
                              Billing Readiness.
                            </span>
                          </div>
                          <div className="grid gap-2">
                            {linkedInvoiceRecoveryPath.steps.map((step) => (
                              <div
                                key={step.label}
                                className="grid gap-1 rounded-md border border-border bg-muted/30 px-2 py-2"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <StatusBadge tone={step.tone}>
                                    {step.label}
                                  </StatusBadge>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {step.detail}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        {linkedInvoiceDraft.status !== "approved" &&
                        linkedInvoiceDraft.status !== "void" ? (
                          <SecondaryButton
                            type="button"
                            className="min-h-9 rounded-lg px-3"
                            onClick={() =>
                              prepareInvoiceMutation.mutate(
                                linkedInvoiceDraft.id,
                              )
                            }
                            disabled={prepareInvoiceMutation.isPending}
                            title="Prepare the invoice preview, PDF artifact, and email draft. Nothing is sent or synced."
                          >
                            {prepareInvoiceMutation.isPending ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Mail size={14} />
                            )}
                            Prepare
                          </SecondaryButton>
                        ) : null}
                        <a
                          href={invoiceDraftPreviewUrl(linkedInvoiceDraft.id)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-white px-3 text-sm font-semibold text-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
                        >
                          <Eye size={14} />
                          Preview
                        </a>
                        {linkedInvoicePdfDocumentId ? (
                          <a
                            href={documentDownloadUrl(
                              linkedInvoicePdfDocumentId,
                            )}
                            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-white px-3 text-sm font-semibold text-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
                          >
                            <Download size={14} />
                            PDF
                          </a>
                        ) : null}
                        {linkedInvoiceDraft.status === "ready_for_approval" &&
                        linkedInvoiceDeliveryReady ? (
                          <SecondaryButton
                            type="button"
                            className="min-h-9 rounded-lg px-3"
                            onClick={() =>
                              approveInvoiceMutation.mutate(
                                linkedInvoiceDraft.id,
                              )
                            }
                            disabled={approveInvoiceMutation.isPending}
                            title="Approve the internal invoice draft only. No tenant email or Xero sync is run."
                          >
                            {approveInvoiceMutation.isPending ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <CheckCircle2 size={14} />
                            )}
                            Approve invoice
                          </SecondaryButton>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
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

            <SectionPanel
              title="Edit work-order details"
              description="Correct the operational record without changing billing or provider delivery."
              icon={<Wrench size={17} />}
              actions={
                <StatusBadge tone="neutral">
                  Activity tracked on save
                </StatusBadge>
              }
            >
              <form
                className="grid gap-4 p-4 text-sm lg:grid-cols-3"
                onSubmit={handleDetailsSubmit}
              >
                <Field label="Work-order title">
                  <Input
                    name="title"
                    defaultValue={workOrder.title}
                    placeholder="Work order title"
                  />
                </Field>
                <Field label="Priority">
                  <Select name="priority" defaultValue={workOrder.priority}>
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </Select>
                </Field>
                <Field label="Due date">
                  <Input
                    name="due_date"
                    type="date"
                    defaultValue={workOrder.due_date?.slice(0, 10) ?? ""}
                  />
                </Field>
                <Field label="Contractor name">
                  <Input
                    name="contractor_name"
                    defaultValue={workOrder.contractor_name ?? ""}
                    placeholder="Contractor or supplier"
                  />
                </Field>
                <Field label="Contractor email">
                  <Input
                    name="contractor_email"
                    type="email"
                    defaultValue={workOrder.contractor_email ?? ""}
                    placeholder="dispatch@example.com"
                  />
                </Field>
                <Field label="Contractor phone">
                  <Input
                    name="contractor_phone"
                    defaultValue={workOrder.contractor_phone ?? ""}
                    placeholder="Phone"
                  />
                </Field>
                <label className="grid gap-1.5 lg:col-span-3">
                  <span className="font-medium text-foreground">
                    Description
                  </span>
                  <textarea
                    aria-label="Work-order description"
                    name="description"
                    defaultValue={workOrder.description ?? ""}
                    rows={3}
                    className="w-full rounded-xl border border-border bg-white px-3 py-3 text-sm outline-none transition-colors duration-200 ease-leasium focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15"
                    placeholder="Describe the maintenance issue."
                  />
                </label>
                <label className="grid gap-1.5 lg:col-span-3">
                  <span className="font-medium text-foreground">
                    Operational note
                  </span>
                  <textarea
                    aria-label="Operational note"
                    name="notes"
                    defaultValue={workOrder.notes ?? ""}
                    rows={3}
                    className="w-full rounded-xl border border-border bg-white px-3 py-3 text-sm outline-none transition-colors duration-200 ease-leasium focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15"
                    placeholder="Internal handling note for this job."
                  />
                </label>
                <div className="flex flex-wrap items-center gap-2 lg:col-span-3">
                  <Button type="submit" disabled={updateMutation.isPending}>
                    {updateMutation.isPending ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <CheckCircle2 size={16} />
                    )}
                    Save details
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Billing links, tenant messages, and provider dispatch stay
                    separate.
                  </span>
                </div>
              </form>
            </SectionPanel>

            {completionReadiness ? (
              <SectionPanel
                title="Job completion handoff"
                description="Close the operational job only when contractor, approval, and billing handoff context are clear."
                icon={<CheckCircle2 size={17} />}
                actions={
                  <StatusBadge tone={completionReadiness.tone}>
                    {completionReadiness.statusLabel}
                  </StatusBadge>
                }
              >
                <div
                  id="job-completion-handoff"
                  className="grid scroll-mt-24 gap-4 p-4 text-sm lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]"
                >
                  <div className="grid gap-3">
                    <div className="font-semibold text-foreground">
                      Operational readiness
                    </div>
                    <div className="grid gap-2">
                      {completionReadiness.checks.map((check) => (
                        <div
                          key={check.label}
                          className="grid gap-1 rounded-md border border-border bg-white px-3 py-2 text-xs"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge tone={check.tone}>
                              {check.label}
                            </StatusBadge>
                            {check.blocking ? (
                              <span className="font-semibold text-warning">
                                Blocks completion
                              </span>
                            ) : null}
                          </div>
                          <div className="text-muted-foreground">
                            {check.detail}
                          </div>
                        </div>
                      ))}
                    </div>
                    {!completionReadiness.blockers.length ? (
                      <div className="rounded-md border border-success/20 bg-success-soft px-3 py-2 text-xs text-success-strong">
                        Operations completion ready
                      </div>
                    ) : null}
                    <div className="text-xs text-muted-foreground">
                      {completionReadiness.handoff}
                    </div>
                  </div>
                  <form
                    className="grid content-start gap-3 rounded-md border border-border bg-muted/30 p-3"
                    onSubmit={handleCloseoutSubmit}
                  >
                    <div className="flex flex-wrap gap-2">
                      <SecondaryButton
                        type="button"
                        className="min-h-9 rounded-lg px-3"
                        disabled={
                          !completionReadiness.canStart ||
                          updateMutation.isPending ||
                          closeoutMutation.isPending
                        }
                        onClick={() =>
                          updateMutation.mutate({ status: "in_progress" })
                        }
                      >
                        <Wrench size={14} />
                        Start job
                      </SecondaryButton>
                      <Button
                        type="submit"
                        disabled={
                          !completionReadiness.canComplete ||
                          closeoutMutation.isPending
                        }
                      >
                        {closeoutMutation.isPending ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <CheckCircle2 size={16} />
                        )}
                        Complete job
                      </Button>
                    </div>
                    <label className="grid gap-1.5 text-sm">
                      <span className="font-medium text-foreground">
                        Closeout note
                      </span>
                      <textarea
                        aria-label="Closeout note"
                        value={closeoutNoteDraft}
                        onChange={(event) =>
                          setCloseoutNoteDraft(event.target.value)
                        }
                        rows={3}
                        className="w-full rounded-xl border border-border bg-white px-3 py-3 text-sm outline-none transition-colors duration-200 ease-leasium focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15"
                        placeholder={
                          savedCloseoutNote ??
                          "Record final attendance, evidence, or handoff notes."
                        }
                      />
                    </label>
                    <Field label="Closeout photo">
                      <Input
                        type="file"
                        accept="image/*"
                        onChange={(event) =>
                          setCloseoutPhoto(event.target.files?.[0] ?? null)
                        }
                      />
                    </Field>
                    {savedCloseoutNote || savedCloseoutAt ? (
                      <div className="grid gap-1 rounded-md border border-border bg-white px-3 py-2 text-xs">
                        <div className="font-semibold text-foreground">
                          Closeout recorded
                        </div>
                        {savedCloseoutNote ? (
                          <div className="text-muted-foreground">
                            {savedCloseoutNote}
                          </div>
                        ) : null}
                        {savedCloseoutAt ? (
                          <div className="text-muted-foreground">
                            {formatDateTime(savedCloseoutAt)}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {closeoutPhotos.length ? (
                      <div className="grid gap-2 rounded-md border border-border bg-white px-3 py-2 text-xs">
                        <div className="font-semibold text-foreground">
                          Closeout photos
                        </div>
                        {closeoutPhotos.map((document) => (
                          <a
                            key={document.id}
                            href={documentDownloadUrl(document.id)}
                            className="inline-flex items-center gap-2 font-semibold text-primary hover:text-primary-hover"
                            target="_blank"
                            rel="noreferrer"
                          >
                            <FileUp size={13} />
                            {document.filename}
                          </a>
                        ))}
                      </div>
                    ) : null}
                    {closeoutHistory.length ? (
                      <div className="grid gap-2 rounded-md border border-border bg-white px-3 py-2 text-xs">
                        <div className="font-semibold text-foreground">
                          Closeout history
                        </div>
                        {closeoutHistory.map((entry, index) => (
                          <div
                            key={`${entry.at ?? "closeout"}-${index}`}
                            className="grid gap-1 border-t border-border pt-2 first:border-t-0 first:pt-0"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusBadge tone="success">
                                {label(entry.status)}
                              </StatusBadge>
                              <span className="text-muted-foreground">
                                {formatDateTime(entry.at)}
                              </span>
                            </div>
                            <div className="text-muted-foreground">
                              {entry.note ?? "No closeout note recorded."}
                            </div>
                            <div className="text-muted-foreground">
                              {entry.photoCount
                                ? `${entry.photoCount} closeout photo${entry.photoCount === 1 ? "" : "s"}`
                                : "No closeout photo attached."}
                            </div>
                            {entry.photoDocuments.length ? (
                              <div className="grid gap-1 rounded-md border border-border bg-muted/30 px-2 py-2">
                                <div className="font-semibold text-foreground">
                                  Source evidence
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {entry.photoDocuments.map((document) => (
                                    <a
                                      key={document.id}
                                      href={documentDownloadUrl(document.id)}
                                      className="inline-flex items-center gap-1 font-semibold text-primary hover:text-primary-hover"
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      <FileUp size={12} />
                                      {document.filename}
                                    </a>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                            {entry.missingPhotoCount > 0 ? (
                              <div className="text-muted-foreground">
                                {entry.missingPhotoCount} source document
                                {entry.missingPhotoCount === 1 ? "" : "s"} not
                                loaded in this view.
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {reopenHistory.length ? (
                      <div className="grid gap-2 rounded-md border border-border bg-white px-3 py-2 text-xs">
                        <div className="font-semibold text-foreground">
                          Reopen history
                        </div>
                        {reopenHistory.map((entry, index) => (
                          <div
                            key={`${entry.at ?? "reopen"}-${index}`}
                            className="grid gap-1 border-t border-border pt-2 first:border-t-0 first:pt-0"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusBadge tone="primary">
                                Job reopened
                              </StatusBadge>
                              <span className="text-muted-foreground">
                                {formatDateTime(entry.at)}
                              </span>
                            </div>
                            <div className="text-muted-foreground">
                              From {label(entry.fromStatus)}.{" "}
                              {entry.previousCompletedAt
                                ? `Previous completion ${formatDateTime(entry.previousCompletedAt)}.`
                                : ""}
                            </div>
                            {entry.reason ? (
                              <div className="text-muted-foreground">
                                {entry.reason}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {completionReviewRows.length ? (
                      <div className="grid gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
                        <div className="font-semibold text-foreground">
                          Completion communications
                        </div>
                        <CompletionReviewPacketPanel
                          workOrder={workOrder}
                          rows={completionReviewRows}
                          completionReadiness={completionReadiness}
                          closeoutPhotoCount={closeoutPhotos.length}
                          closeoutHistoryCount={closeoutHistory.length}
                          latestActivity={timeline[0] ?? null}
                          linkedInvoiceDraft={linkedInvoiceDraft}
                        />
                        {completionReviewRows.map((row) => (
                          <div
                            key={row.audience}
                            className="grid gap-2 rounded-md border border-border bg-white px-2 py-2"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="font-semibold text-foreground">
                                {row.title}
                              </div>
                              <StatusBadge tone="primary">
                                {row.readyLabel}
                              </StatusBadge>
                              <StatusBadge
                                tone={row.reviewedAt ? "success" : "warning"}
                              >
                                {row.statusLabel}
                              </StatusBadge>
                            </div>
                            <div className="whitespace-pre-line text-muted-foreground">
                              {row.body}
                            </div>
                            {completionCommunicationCopyReceipt[
                              row.audience
                            ] ? (
                              <p className="text-xs font-medium text-success">
                                {
                                  completionCommunicationCopyReceipt[
                                    row.audience
                                  ]
                                }
                              </p>
                            ) : null}
                            {row.reviewedAt ? (
                              <div className="grid gap-1 rounded-md border border-border bg-muted/30 px-2 py-2">
                                <div className="font-semibold text-foreground">
                                  {row.statusLabel}
                                </div>
                                <div className="text-muted-foreground">
                                  {formatDateTime(row.reviewedAt)}
                                </div>
                                {row.note ? (
                                  <div className="text-muted-foreground">
                                    {row.note}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                            <label className="grid gap-1.5">
                              <span className="font-medium text-foreground">
                                {row.textareaLabel}
                              </span>
                              <textarea
                                aria-label={row.textareaLabel}
                                value={completionReviewNotes[row.audience]}
                                onChange={(event) =>
                                  setCompletionReviewNotes((current) => ({
                                    ...current,
                                    [row.audience]: event.target.value,
                                  }))
                                }
                                rows={2}
                                className="w-full rounded-xl border border-border bg-white px-3 py-3 text-sm outline-none transition-colors duration-200 ease-leasium focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15"
                                placeholder={row.placeholder}
                              />
                            </label>
                            <div className="flex flex-wrap items-center gap-2">
                              <SecondaryButton
                                type="button"
                                className="min-h-9 rounded-lg px-3 text-xs"
                                onClick={() => copyCompletionCommunication(row)}
                              >
                                <ClipboardCheck size={14} />
                                {
                                  completionCommunicationCopyLabels[
                                    row.audience
                                  ]
                                }
                              </SecondaryButton>
                              <Button
                                type="button"
                                className="w-fit"
                                disabled={
                                  workOrder.status !== "completed" ||
                                  completionReviewMutation.isPending
                                }
                                onClick={() =>
                                  completionReviewMutation.mutate(row.audience)
                                }
                              >
                                {completionReviewMutation.isPending ? (
                                  <Loader2
                                    size={16}
                                    className="animate-spin"
                                  />
                                ) : (
                                  <CheckCircle2 size={16} />
                                )}
                                {row.buttonLabel}
                              </Button>
                            </div>
                          </div>
                        ))}
                        <div className="text-muted-foreground">
                          Review this copy before sending anything outside
                          Leasium.
                        </div>
                        {ownerReviewHistory.length > 1 ? (
                          <div className="grid gap-1 rounded-md border border-border bg-white px-2 py-2">
                            <div className="font-semibold text-foreground">
                              Review history
                            </div>
                            {ownerReviewHistory.map((entry, index) => (
                              <div
                                key={`${entry.at ?? "owner-review"}-${index}`}
                                className="text-muted-foreground"
                              >
                                {label(entry.status)} {formatDateTime(entry.at)}
                                {entry.note ? ` - ${entry.note}` : ""}
                              </div>
                            ))}
                          </div>
                        ) : null}
                        <div className="text-muted-foreground">
                          Review-only; no owner, tenant, contractor, email, or
                          portal message is sent from this panel.
                        </div>
                        {completionReviewMutation.error ? (
                          <p className="text-sm text-danger">
                            {friendlyError(completionReviewMutation.error)}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="text-xs text-muted-foreground">
                      {linkedInvoiceDraft
                        ? "The linked invoice remains in Billing Readiness for dispatch and reconciliation."
                        : "Billing can be linked later from an approved invoice draft."}
                    </div>
                    {closeoutMutation.error ? (
                      <p className="text-sm text-danger">
                        {friendlyError(closeoutMutation.error)}
                      </p>
                    ) : null}
                  </form>
                </div>
              </SectionPanel>
            ) : null}

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
              <SectionPanel
                title="Quote documents"
                description="Attach contractor quotes or supporting evidence to this work order."
                icon={<FileUp size={17} />}
              >
                <form
                  className="grid gap-3 border-b border-border p-4"
                  onSubmit={handleQuoteUpload}
                >
                  <Field label="Quote document">
                    <Input
                      type="file"
                      onChange={(event) =>
                        setQuoteFile(event.target.files?.[0] ?? null)
                      }
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
                  {quoteDocuments.map((document) => (
                    <div
                      key={document.id}
                      className="grid gap-2 rounded-md border border-border bg-white p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-medium">{document.filename}</div>
                        {document.documentId ? (
                          <a
                            href={documentDownloadUrl(document.documentId)}
                            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border-strong bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs hover:bg-muted"
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Download size={15} />
                            Download
                          </a>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {document.category ? label(document.category) : "Quote"}{" "}
                        - {document.notes ?? "No notes"} -{" "}
                        {formatDateTime(document.uploadedAt)}
                        {document.byteSize
                          ? ` - ${Math.round(document.byteSize / 1000)} KB`
                          : ""}
                      </div>
                    </div>
                  ))}
                  {!documentsQuery.isLoading && quoteDocuments.length === 0 ? (
                    <EmptyState
                      icon={<FileText size={18} />}
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

              <SectionPanel
                title="Activity"
                icon={<History size={17} />}
                actions={
                  <SecondaryButton
                    type="button"
                    onClick={copyActivityAudit}
                    disabled={!workOrder}
                  >
                    <ClipboardCheck size={15} />
                    Copy audit
                  </SecondaryButton>
                }
              >
                <div className="grid gap-3 p-4">
                  {activityAuditReceipt ? (
                    <p className="text-sm font-medium text-success">
                      {activityAuditReceipt}
                    </p>
                  ) : null}
                  {activityAuditCards.length ? (
                    <div className="grid gap-2 rounded-xl bg-muted/40 p-3 md:grid-cols-4">
                      {activityAuditCards.map((card) => (
                        <div key={card.label} className="grid gap-1 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {card.label}
                            </span>
                            <StatusBadge tone={card.tone}>
                              {card.badge}
                            </StatusBadge>
                          </div>
                          <div className="truncate text-base font-semibold text-foreground">
                            {card.value}
                          </div>
                          <div className="text-xs leading-5 text-muted-foreground">
                            {card.detail}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {forwardingDraftRows.length ? (
                    <div className="grid gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-semibold text-foreground">
                          Forwarding drafts
                        </div>
                        <StatusBadge tone="primary">Review-only</StatusBadge>
                      </div>
                      <div className="grid gap-2 lg:grid-cols-2">
                        {forwardingDraftRows.map((row) => (
                          <div
                            key={row.target}
                            className="grid gap-2 rounded-md border border-border bg-white px-3 py-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-foreground">
                                {row.title}
                              </span>
                              <StatusBadge
                                tone={row.body ? "success" : "warning"}
                              >
                                {row.statusLabel}
                              </StatusBadge>
                              <StatusBadge tone="neutral">
                                {row.sourceLabel}
                              </StatusBadge>
                            </div>
                            <div className="text-muted-foreground">
                              {row.detail}
                            </div>
                            {row.body ? (
                              <div className="whitespace-pre-line rounded-md border border-border bg-muted/30 px-3 py-2 text-muted-foreground">
                                {row.body}
                              </div>
                            ) : null}
                            {forwardingDraftCopyReceipt[row.target] ? (
                              <p className="text-xs font-medium text-success">
                                {forwardingDraftCopyReceipt[row.target]}
                              </p>
                            ) : null}
                            <SecondaryButton
                              type="button"
                              className="w-fit"
                              disabled={!row.body}
                              onClick={() => copyForwardingDraft(row)}
                            >
                              <ClipboardCheck size={15} />
                              {forwardingDraftCopyLabels[row.target]}
                            </SecondaryButton>
                          </div>
                        ))}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Review-only; copying these drafts does not send email,
                        SMS, portal messages, or provider updates.
                      </div>
                    </div>
                  ) : null}
                  <form className="grid gap-3" onSubmit={handleCommentSubmit}>
                    <label className="grid gap-1.5 text-sm">
                      <span className="font-medium text-foreground">
                        Comment
                      </span>
                      <textarea
                        value={commentBody}
                        onChange={(event) => setCommentBody(event.target.value)}
                        rows={3}
                        className="w-full rounded-xl border border-border bg-white px-3 py-3 text-sm outline-none transition-colors duration-200 ease-leasium focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15"
                        placeholder="Add an internal note, contractor update, or tenant-facing comment."
                      />
                    </label>
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                      <Select
                        aria-label="Comment visibility"
                        value={commentVisibility}
                        onChange={(event) =>
                          setCommentVisibility(
                            event.target.value as
                              | "internal"
                              | "contractor"
                              | "tenant",
                          )
                        }
                      >
                        <option value="internal">Internal</option>
                        <option value="contractor">Contractor</option>
                        <option value="tenant">Tenant-facing</option>
                      </Select>
                      <Button
                        type="submit"
                        disabled={
                          !commentBody.trim() || commentMutation.isPending
                        }
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
                    <div
                      key={`${entry.at}-${entry.label}-${index}`}
                      className="grid gap-1 rounded-lg border border-border bg-white px-3 py-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone={entry.tone}>
                          {entry.audienceLabel}
                        </StatusBadge>
                        <span className="font-medium">{entry.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(entry.at)}
                        </span>
                        {entry.meta.map((item) => (
                          <span
                            key={item}
                            className="rounded-full bg-muted px-2 py-0.5 text-leasium-micro font-semibold text-muted-foreground"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                      <div className="text-muted-foreground">
                        {entry.detail}
                      </div>
                    </div>
                  ))}
                  {timeline.length === 0 ? (
                    <EmptyState
                      icon={<Activity size={18} />}
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

function ContractorChannelEvidence({
  receipts,
}: {
  receipts: WorkAssignmentNoticeChannelReceiptRecord[];
}) {
  if (!receipts.length) {
    return null;
  }
  return (
    <details className="mt-1 rounded-md border border-border bg-white">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-primary hover:text-primary-hover">
        Channel evidence
      </summary>
      <div className="grid gap-2 border-t border-border px-3 py-3">
        {receipts.map((receipt) => (
          <div
            key={receipt.channel}
            className="grid gap-1 rounded-md bg-muted/40 px-3 py-2 text-xs"
          >
            <div className="flex flex-wrap items-center gap-2 text-foreground">
              <StatusBadge tone={receipt.message_sent ? "success" : "warning"}>
                {receipt.label}
              </StatusBadge>
              {receipt.provider ? (
                <span className="font-medium">{label(receipt.provider)}</span>
              ) : null}
              {receipt.status ? <span>{label(receipt.status)}</span> : null}
            </div>
            <div className="grid gap-0.5 text-muted-foreground">
              {receipt.recipient_email ? (
                <span>To {receipt.recipient_email}</span>
              ) : null}
              {receipt.recipient_phone ? (
                <span>To {receipt.recipient_phone}</span>
              ) : null}
              {receipt.template_key ? (
                <span>
                  Template {receipt.template_key}{" "}
                  {receipt.template_version ?? ""}
                </span>
              ) : null}
              {receipt.delivery_attempt_count ? (
                <span>Attempt {receipt.delivery_attempt_count}</span>
              ) : null}
              {receipt.sent_at ? (
                <span>Sent {formatDateTime(receipt.sent_at)}</span>
              ) : null}
              {receipt.receipt_at ? (
                <span>Receipt {formatDateTime(receipt.receipt_at)}</span>
              ) : null}
              {receipt.provider_message_id ? (
                <span>ID {receipt.provider_message_id}</span>
              ) : null}
              {receipt.detail ? <span>{receipt.detail}</span> : null}
            </div>
            {receipt.rendered_message_preview?.body_text ? (
              <details className="mt-1">
                <summary className="cursor-pointer text-primary hover:text-primary-hover">
                  Message preview
                </summary>
                <div className="mt-1 whitespace-pre-line rounded-md border border-border bg-white p-2 text-foreground">
                  {receipt.rendered_message_preview.subject ? (
                    <div className="mb-1 font-semibold">
                      {receipt.rendered_message_preview.subject}
                    </div>
                  ) : null}
                  {receipt.rendered_message_preview.body_text}
                </div>
              </details>
            ) : null}
          </div>
        ))}
      </div>
    </details>
  );
}

type AiClassification = {
  category?: string | null;
  confidence?: number | null;
  summary?: string | null;
  is_urgent?: boolean | null;
  warnings?: string[] | null;
  suggested_contractor_id?: string | null;
  suggested_contractor_name?: string | null;
  suggested_contractor_email?: string | null;
  suggested_contractor_phone?: string | null;
  classified_at?: string | null;
};

function aiCategoryTone(category: string | null | undefined): Tone {
  if (!category) return "neutral";
  if (category === "urgent") return "danger";
  if (category === "plumbing" || category === "electrical") return "primary";
  return "neutral";
}

function AiClassificationPanel({
  workOrder,
  onClassify,
  isClassifying,
  error,
  onApplySuggestion,
  applying,
}: {
  workOrder: MaintenanceWorkOrderRecord;
  onClassify: () => void;
  isClassifying: boolean;
  error: Error | null;
  onApplySuggestion: (name: string) => void;
  applying: boolean;
}) {
  const raw =
    (workOrder.metadata as { ai_classification?: AiClassification } | undefined)
      ?.ai_classification ?? null;

  const hasClassification = Boolean(raw && raw.category);
  const confidencePct =
    raw && typeof raw.confidence === "number"
      ? Math.round(raw.confidence * 100)
      : null;
  const suggestionAlreadyApplied =
    raw?.suggested_contractor_name != null &&
    workOrder.contractor_name === raw.suggested_contractor_name;

  return (
    <SectionPanel
      title="AI classification"
      icon={<Sparkles size={17} className="text-primary" />}
      actions={
        hasClassification ? (
          <StatusBadge tone={aiCategoryTone(raw?.category)}>
            {raw?.category ?? "unclassified"}
            {confidencePct !== null ? ` · ${confidencePct}%` : ""}
          </StatusBadge>
        ) : null
      }
    >
      <div className="grid gap-3 p-4 text-sm">
        {!hasClassification ? (
          <p className="text-muted-foreground">
            Run the AI categoriser to classify this work order into a trade
            subcategory (electrical / plumbing / hvac / locks / structural /
            appliance / cleaning / pest / urgent / other) and surface a
            suggested contractor from your directory.
          </p>
        ) : null}

        {hasClassification ? (
          <>
            {raw?.summary ? (
              <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-foreground">
                {raw.summary}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2 text-xs">
              {raw?.is_urgent ? (
                <StatusBadge tone="danger">Same-day</StatusBadge>
              ) : null}
              {raw?.classified_at ? (
                <span className="text-muted-foreground">
                  Classified{" "}
                  {new Date(raw.classified_at).toLocaleString(undefined, {
                    day: "numeric",
                    month: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              ) : null}
            </div>

            {(raw?.warnings ?? []).length > 0 ? (
              <ul className="grid gap-1 text-xs text-warning">
                {(raw?.warnings ?? []).map((warning) => (
                  <li key={warning} className="flex items-start gap-1">
                    <Ban size={12} className="mt-0.5 shrink-0" /> {warning}
                  </li>
                ))}
              </ul>
            ) : null}

            {raw?.suggested_contractor_name ? (
              <div className="grid gap-2 rounded-md border border-primary/30 bg-primary-soft p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-primary-hover">
                    Suggested contractor
                  </span>
                  {suggestionAlreadyApplied ? (
                    <StatusBadge tone="success">Applied</StatusBadge>
                  ) : null}
                </div>
                <div className="font-medium text-foreground">
                  {raw.suggested_contractor_name}
                </div>
                {raw.suggested_contractor_email ||
                raw.suggested_contractor_phone ? (
                  <div className="text-xs text-muted-foreground">
                    {raw.suggested_contractor_email ?? "-"}
                    {raw.suggested_contractor_phone
                      ? ` · ${raw.suggested_contractor_phone}`
                      : ""}
                  </div>
                ) : null}
                {!suggestionAlreadyApplied ? (
                  <div>
                    <Button
                      type="button"
                      onClick={() =>
                        onApplySuggestion(raw.suggested_contractor_name ?? "")
                      }
                      disabled={applying}
                    >
                      {applying ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <CheckCircle2 size={14} />
                      )}
                      Apply to contractor
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                No contractor in the directory matched the
                <strong> {raw?.category} </strong>
                category. Add a contractor on{" "}
                <Link
                  href="/contractors"
                  className="text-primary hover:underline"
                >
                  /contractors
                </Link>{" "}
                with this category, then re-classify.
              </div>
            )}
          </>
        ) : null}

        {error ? (
          <p className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
            {error.message}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            AI never dispatches anything — the operator still clicks Send.
            Soft-fails 503 when OPENAI_API_KEY is unset.
          </p>
          <SecondaryButton
            type="button"
            onClick={onClassify}
            disabled={isClassifying}
          >
            {isClassifying ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Sparkles size={15} />
            )}
            {hasClassification ? "Re-classify" : "Classify with AI"}
          </SecondaryButton>
        </div>
      </div>
    </SectionPanel>
  );
}

export default function MaintenanceWorkOrderPage() {
  return (
    <QueryProvider>
      <MaintenanceDetailRoute />
    </QueryProvider>
  );
}
