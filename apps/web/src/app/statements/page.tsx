"use client";

/**
 * /statements — Owner monthly statements (v2 frontend).
 *
 * Reads the per-owner JSON from /api/v1/owners/statements and renders
 * one card per owner with a per-property breakdown of invoiced + paid +
 * outstanding totals. Month selector defaults to the previous calendar
 * month (mirrors backend default). PDF export is review-only; owner
 * dispatch still lands through a later explicit approval flow.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Download,
  FileText,
  ListChecks,
  LockKeyhole,
  MailCheck,
  Printer,
  ReceiptText,
  RefreshCw,
  Send,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { QueryProvider } from "@/components/query-provider";
import {
  Button,
  chipClass,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SectionPanel,
  Select,
  SecondaryButton,
  SkeletonRows,
  StatusBadge,
} from "@/components/ui";
import {
  getXeroStatus,
  listInvoiceDrafts,
  downloadOwnerStatementPdf,
  downloadOwnerStatementPdfPack,
  getOwnerStatementDispatch,
  getOwnerStatements,
  listEntities,
  sendOwnerStatement,
  type InvoiceDraftRecord,
  type OwnerStatementDispatchReceipt,
  type OwnerStatementRecord,
  type OwnerStatementsRecord,
  type XeroAccountingFreshnessRecord,
  type XeroStatusRecord,
} from "@/lib/api";
import { csvCell } from "@/lib/csv";
import { saveBlob } from "@/lib/download";
import {
  isManagingAgentOperatingMode,
  useOperatingMode,
} from "@/lib/use-operating-mode";
import { friendlyError } from "@/lib/utils";

const ENTITY_STORAGE_KEY = "leasium.entity_id";
const DISPATCH_APPROVAL_EXPORT_GUARDRAIL =
  "Review-only export: downloading this file does not download owner PDFs, download PDF packs, send owner email, dispatch comms, dispatch invoices, write Xero data, preview or apply payment reconciliation, refresh providers, or mutate provider history.";
const DISPATCH_DRAFT_EXPORT_GUARDRAIL =
  "Review-only export: downloading this file does not send owner email, dispatch comms, attach or download owner PDFs, write Xero data, preview or apply payment reconciliation, dispatch invoices, refresh providers, or mutate provider history.";

type StatementPackStatus = "ready" | "incomplete" | "unpaid" | "blocked";

type StatementPackReadiness = {
  status: StatementPackStatus;
  title: string;
  detail: string;
  statementInvoiceCount: number;
  localApprovedCount: number;
  unpaidLocalCount: number;
  ownerCount: number;
  outstandingCents: number;
};

type FinanceChecklistItemStatus = "complete" | "review" | "blocked" | "locked";

type FinanceChecklistItem = {
  id: string;
  title: string;
  detail: string;
  status: FinanceChecklistItemStatus;
  metric: string;
};

type FinanceChecklist = {
  status: "ready" | "review" | "blocked";
  title: string;
  detail: string;
  completedCount: number;
  reviewCount: number;
  blockedCount: number;
  lockedCount: number;
  items: FinanceChecklistItem[];
};

type StatementDispatchReviewStatus =
  | "ready"
  | "payment_review"
  | "missing_recipient"
  | "locked";

type StatementDispatchReviewRow = {
  ownerIdentity: string;
  recipient: string | null;
  subject: string;
  status: StatementDispatchReviewStatus;
  invoiceCount: number;
  outstandingCents: number;
  propertyCount: number;
};

type StatementExceptionKind = "missing_recipient" | "payment_review";

type StatementExceptionRow = {
  id: string;
  kind: StatementExceptionKind;
  ownerIdentity: string;
  detail: string;
  metric: string;
  outstandingCents: number;
  propertyCount: number;
  invoiceCount: number;
};

type DispatchApprovalStep = {
  id: string;
  title: string;
  detail: string;
  metric: string;
  tone: "neutral" | "success" | "warning" | "danger" | "primary";
};

function defaultMonth(): string {
  const now = new Date();
  // Previous calendar month, mirroring the backend default.
  const month = now.getMonth(); // 0-11
  const year = month === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const prevMonth = month === 0 ? 12 : month;
  return `${year}-${String(prevMonth).padStart(2, "0")}`;
}

function validMonth(value: string | null) {
  return value && /^\d{4}-\d{2}$/.test(value) ? value : null;
}

function formatMoney(cents: number, currency = "AUD"): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatMonthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  return new Intl.DateTimeFormat("en-AU", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, monthNumber - 1, 1));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value: string | null): string {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function metadataText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function invoicePaymentLabel(draft: InvoiceDraftRecord) {
  const paymentStatus = metadataRecord(draft.metadata.payment_status);
  return metadataText(paymentStatus.status) ?? "unpaid";
}

function statementPackStatusFromQuery(
  value: string | null,
): StatementPackStatus | null {
  return value === "ready" ||
    value === "incomplete" ||
    value === "unpaid" ||
    value === "blocked"
    ? value
    : null;
}

function statementPackTone(status: StatementPackStatus) {
  if (status === "ready") return "success" as const;
  if (status === "blocked") return "danger" as const;
  return "warning" as const;
}

function statementPackLabel(status: StatementPackStatus) {
  if (status === "ready") return "Ready";
  if (status === "blocked") return "Blocked";
  if (status === "unpaid") return "Unpaid";
  return "Incomplete";
}

function checklistStatusLabel(status: FinanceChecklistItemStatus) {
  if (status === "complete") return "Done";
  if (status === "blocked") return "Blocked";
  if (status === "locked") return "Locked";
  return "Review";
}

function checklistStatusTone(status: FinanceChecklistItemStatus) {
  if (status === "complete") return "success" as const;
  if (status === "blocked") return "danger" as const;
  if (status === "locked") return "neutral" as const;
  return "warning" as const;
}

function checklistOverallTone(status: FinanceChecklist["status"]) {
  if (status === "ready") return "success" as const;
  if (status === "blocked") return "danger" as const;
  return "warning" as const;
}

function dispatchReviewStatusLabel(status: StatementDispatchReviewStatus) {
  if (status === "ready") return "Ready";
  if (status === "payment_review") return "Payment review";
  if (status === "missing_recipient") return "Needs recipient";
  return "No statement";
}

function dispatchReviewStatusTone(status: StatementDispatchReviewStatus) {
  if (status === "ready") return "success" as const;
  if (status === "missing_recipient") return "danger" as const;
  if (status === "locked") return "neutral" as const;
  return "warning" as const;
}

function dispatchReceiptStatusLabel(status: string) {
  if (status === "sent") return "Sent";
  if (status === "delivered") return "Delivered";
  if (status === "queued") return "Queued";
  if (status === "failed") return "Failed";
  if (status === "skipped") return "Skipped";
  return invoiceEvidenceStatusLabel(status);
}

function dispatchReceiptStatusTone(status: string) {
  if (status === "sent" || status === "delivered") return "success" as const;
  if (status === "failed") return "danger" as const;
  if (status === "skipped") return "warning" as const;
  return "primary" as const;
}

function invoiceEvidenceStatusLabel(status: string) {
  return status
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function invoiceEvidenceSources(invoice: {
  invoice_draft_id: string | null;
  xero_invoice_id: string | null;
  reconciliation_reference: string | null;
  reconciliation_bank_transaction_id: string | null;
}) {
  return [
    invoice.invoice_draft_id ? "Local invoice draft" : null,
    invoice.xero_invoice_id ? `Xero ${invoice.xero_invoice_id}` : null,
    invoice.reconciliation_reference
      ? `Reconciliation ${invoice.reconciliation_reference}`
      : null,
    invoice.reconciliation_bank_transaction_id
      ? `Bank txn ${invoice.reconciliation_bank_transaction_id}`
      : null,
  ].filter(Boolean);
}

function financeChecklistText(
  checklist: FinanceChecklist,
  showOwnerDispatch: boolean,
) {
  return [
    showOwnerDispatch
      ? "Owner statements finance checklist"
      : "Entity statements finance checklist",
    `${checklist.title}: ${checklist.detail}`,
    `${checklist.completedCount} complete / ${checklist.reviewCount} review / ${checklist.blockedCount} blocked / ${checklist.lockedCount} locked`,
    "",
    ...checklist.items.map(
      (item) =>
        `- ${item.title}: ${checklistStatusLabel(item.status)} (${item.metric}) - ${item.detail}`,
    ),
    "",
    showOwnerDispatch
      ? "Review-only: owner dispatch remains locked until the explicit approval workflow is wired."
      : "Review-only: local entity-reporting remains internal until finance signoff.",
  ].join("\n");
}

function financeChecklistCsv(checklist: FinanceChecklist) {
  return [
    ["Status", "Item", "Metric", "Detail"].map(csvCell).join(","),
    ...checklist.items.map((item) =>
      [checklistStatusLabel(item.status), item.title, item.metric, item.detail]
        .map(csvCell)
        .join(","),
    ),
  ].join("\n");
}

function ownerSlug(ownerIdentity: string) {
  return (
    ownerIdentity
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "owner"
  );
}

function ownerInvoiceEvidenceCsv(owner: OwnerStatementRecord) {
  return [
    [
      "Owner",
      "Property",
      "Invoice",
      "Title",
      "Issue date",
      "Due date",
      "Total",
      "Paid",
      "Outstanding",
      "Payment status",
      "Evidence sources",
      "Xero invoice ID",
      "Reconciliation reference",
      "Bank transaction ID",
    ]
      .map(csvCell)
      .join(","),
    ...owner.properties.flatMap((property) =>
      property.invoices.map((invoice) =>
        [
          owner.owner_identity,
          property.property_name,
          invoice.invoice_number ?? invoice.invoice_draft_id,
          invoice.title,
          invoice.issue_date,
          invoice.due_date,
          formatMoney(invoice.total_cents),
          formatMoney(invoice.paid_cents),
          formatMoney(invoice.outstanding_cents),
          invoiceEvidenceStatusLabel(invoice.payment_status),
          invoiceEvidenceSources(invoice).join(" · "),
          invoice.xero_invoice_id,
          invoice.reconciliation_reference,
          invoice.reconciliation_bank_transaction_id,
        ]
          .map(csvCell)
          .join(","),
      ),
    ),
  ].join("\n");
}

function financeSignoffStatus({
  readiness,
  checklist,
  exceptions,
  dispatchRows,
  showOwnerDispatch = true,
}: {
  readiness: StatementPackReadiness;
  checklist: FinanceChecklist;
  exceptions: StatementExceptionRow[];
  dispatchRows: StatementDispatchReviewRow[];
  showOwnerDispatch?: boolean;
}) {
  const readyDispatchCount = dispatchRows.filter(
    (row) => row.status === "ready",
  ).length;
  const missingRecipientCount = exceptions.filter(
    (row) => row.kind === "missing_recipient",
  ).length;
  const paymentReviewCount = exceptions.filter(
    (row) => row.kind === "payment_review",
  ).length;
  const blocked =
    readiness.status === "blocked" ||
    checklist.blockedCount > 0 ||
    missingRecipientCount > 0;
  const review =
    readiness.status === "unpaid" ||
    checklist.reviewCount > 0 ||
    paymentReviewCount > 0;
  const locked =
    readiness.statementInvoiceCount === 0 || checklist.lockedCount > 0;

  if (blocked) {
    return {
      label: "Blocked",
      tone: "danger" as const,
      detail:
        showOwnerDispatch
          ? "Clear blocked finance checks or missing owner recipients before month-end signoff."
          : "Clear blocked finance checks before local entity-reporting signoff.",
      readyDispatchCount,
      missingRecipientCount,
      paymentReviewCount,
    };
  }
  if (review) {
    return {
      label: "Review",
      tone: "warning" as const,
      detail:
        "Finance can review the statement pack, but payment or accounting checks still need signoff.",
      readyDispatchCount,
      missingRecipientCount,
      paymentReviewCount,
    };
  }
  if (locked) {
    return {
      label: "Locked",
      tone: "neutral" as const,
      detail:
        showOwnerDispatch
          ? "Approve this month’s invoices before finance can complete the owner statement signoff."
          : "Approve this month’s invoices before finance can complete the local entity-reporting signoff.",
      readyDispatchCount,
      missingRecipientCount,
      paymentReviewCount,
    };
  }
  return {
    label: "Ready",
    tone: "success" as const,
    detail:
      showOwnerDispatch
        ? "The review pack is ready for finance signoff. Owner dispatch remains a separate approval workflow."
        : "The local entity-reporting pack is ready for finance signoff.",
    readyDispatchCount,
    missingRecipientCount,
    paymentReviewCount,
  };
}

function statementPackDetail(
  readiness: StatementPackReadiness,
  showOwnerDispatch: boolean,
) {
  if (showOwnerDispatch) return readiness.detail;
  if (readiness.status === "ready") {
    return "Entity totals are ready to review from the closed billing run.";
  }
  if (readiness.status === "blocked") {
    return "Resolve accounting blockers before relying on this local entity-reporting pack.";
  }
  if (readiness.status === "incomplete") {
    return "Approve invoices for this month before the local entity-reporting pack is complete.";
  }
  return "Local entity-reporting can be reviewed, but outstanding or unreconciled payments remain.";
}

function financeSignoffPacketText({
  month,
  readiness,
  checklist,
  exceptions,
  dispatchRows,
  showOwnerDispatch,
}: {
  month: string;
  readiness: StatementPackReadiness;
  checklist: FinanceChecklist;
  exceptions: StatementExceptionRow[];
  dispatchRows: StatementDispatchReviewRow[];
  showOwnerDispatch: boolean;
}) {
  const status = financeSignoffStatus({
    readiness,
    checklist,
    exceptions,
    dispatchRows,
    showOwnerDispatch,
  });
  const approvalSteps = buildDispatchApprovalSteps(dispatchRows);
  const statementLabel = showOwnerDispatch
    ? "Owner statements"
    : "Entity statements";
  const audienceLabel = showOwnerDispatch ? "owners" : "entities";
  const guardrail = showOwnerDispatch
    ? "Review-only: this packet does not send owner email, attach PDFs to outbound messages, or update provider delivery history."
    : "Review-only: this packet keeps local entity-reporting steps explicit and does not send email, attach PDFs to outbound messages, or update provider delivery history.";
  const packDetail = statementPackDetail(readiness, showOwnerDispatch);
  return [
    `${statementLabel} month-end signoff`,
    `Month: ${formatMonthLabel(month)}`,
    `Status: ${status.label} - ${status.detail}`,
    "",
    "Statement pack:",
    `- ${readiness.title}: ${packDetail}`,
    `- ${readiness.ownerCount} ${audienceLabel} / ${readiness.statementInvoiceCount} statement invoices / ${formatMoney(readiness.outstandingCents)} outstanding`,
    "",
    "Finance checklist:",
    `- ${checklist.completedCount} complete / ${checklist.reviewCount} review / ${checklist.blockedCount} blocked / ${checklist.lockedCount} locked`,
    ...checklist.items.map(
      (item) =>
        `- ${item.title}: ${checklistStatusLabel(item.status)} (${item.metric})`,
    ),
    "",
    "Exceptions:",
    ...(exceptions.length
      ? exceptions.map(
          (row) =>
            `- ${row.ownerIdentity}: ${statementExceptionKindLabel(row.kind)} - ${row.metric}`,
        )
      : ["- None"]),
    "",
    ...(showOwnerDispatch
      ? [
          "Dispatch approval runway:",
          ...approvalSteps.map(
            (step) => `- ${step.title}: ${step.metric} - ${step.detail}`,
          ),
        ]
      : [
          "Local reporting:",
          "- Entity statement pack: local entity-reporting remains review-only until finance signoff.",
        ]),
    "",
    guardrail,
  ].join("\n");
}

function financeSignoffPacketCsv({
  month,
  readiness,
  checklist,
  exceptions,
  dispatchRows,
  showOwnerDispatch,
}: {
  month: string;
  readiness: StatementPackReadiness;
  checklist: FinanceChecklist;
  exceptions: StatementExceptionRow[];
  dispatchRows: StatementDispatchReviewRow[];
  showOwnerDispatch: boolean;
}) {
  const status = financeSignoffStatus({
    readiness,
    checklist,
    exceptions,
    dispatchRows,
    showOwnerDispatch,
  });
  const approvalSteps = buildDispatchApprovalSteps(dispatchRows);
  const audienceLabel = showOwnerDispatch ? "owners" : "entities";
  const guardrail = showOwnerDispatch
    ? "This packet does not send owner email, attach PDFs to outbound messages, or update provider delivery history."
    : "This packet keeps local entity-reporting steps explicit and does not send email, attach PDFs to outbound messages, or update provider delivery history.";
  const packDetail = statementPackDetail(readiness, showOwnerDispatch);
  return [
    ["Section", "Item", "Status", "Metric", "Detail"].map(csvCell).join(","),
    [
      "Signoff",
      showOwnerDispatch ? formatMonthLabel(month) : "Entity statements",
      status.label,
      "",
      status.detail,
    ]
      .map(csvCell)
      .join(","),
    [
      "Statement pack",
      readiness.title,
      statementPackLabel(readiness.status),
      `${readiness.ownerCount} ${audienceLabel} / ${readiness.statementInvoiceCount} statement invoices / ${formatMoney(readiness.outstandingCents)} outstanding`,
      packDetail,
    ]
      .map(csvCell)
      .join(","),
    [
      "Finance checklist",
      checklist.title,
      checklist.status,
      `${checklist.completedCount} complete / ${checklist.reviewCount} review / ${checklist.blockedCount} blocked / ${checklist.lockedCount} locked`,
      checklist.detail,
    ]
      .map(csvCell)
      .join(","),
    ...checklist.items.map((item) =>
      [
        "Checklist item",
        item.title,
        checklistStatusLabel(item.status),
        item.metric,
        item.detail,
      ]
        .map(csvCell)
        .join(","),
    ),
    ...(exceptions.length
      ? exceptions.map((row) =>
          [
            "Exception",
            row.ownerIdentity,
            statementExceptionKindLabel(row.kind),
            row.metric,
            row.detail,
          ]
            .map(csvCell)
            .join(","),
        )
      : [["Exception", "None", "Clear", "", ""].map(csvCell).join(",")]),
    ...(showOwnerDispatch
      ? approvalSteps.map((step) =>
          [
            "Dispatch approval",
            step.title,
            step.title,
            step.metric,
            step.detail,
          ]
            .map(csvCell)
            .join(","),
        )
      : [
          [
            "Local reporting",
            "Entity statement pack",
            "Review-only",
            "local entity-reporting",
            "Finance signoff stays local for this account mode.",
          ]
            .map(csvCell)
            .join(","),
        ]),
    [
      "Guardrail",
      "Review-only",
      "",
      "",
      guardrail,
    ]
      .map(csvCell)
      .join(","),
  ].join("\n");
}

function buildDispatchReviewRows(
  owners: OwnerStatementRecord[],
  month: string,
): StatementDispatchReviewRow[] {
  return owners.map((owner) => {
    const dispatchDraft = statementDispatchDraft({ owner, month });
    const status: StatementDispatchReviewStatus =
      owner.invoice_count === 0
        ? "locked"
        : !owner.billing_email
          ? "missing_recipient"
          : owner.outstanding_cents > 0
            ? "payment_review"
            : "ready";
    return {
      ownerIdentity: owner.owner_identity,
      recipient: owner.billing_email,
      subject: dispatchDraft.subject,
      status,
      invoiceCount: owner.invoice_count,
      outstandingCents: owner.outstanding_cents,
      propertyCount: owner.property_count,
    };
  });
}

function dispatchApprovalPacketText(
  rows: StatementDispatchReviewRow[],
  month: string,
) {
  const readyCount = rows.filter((row) => row.status === "ready").length;
  const reviewCount = rows.filter(
    (row) => row.status === "payment_review",
  ).length;
  const blockedCount = rows.filter(
    (row) => row.status === "missing_recipient",
  ).length;
  const approvalSteps = buildDispatchApprovalSteps(rows);
  return [
    "Owner statement dispatch approval queue",
    `Month: ${formatMonthLabel(month)}`,
    `${readyCount} ready / ${reviewCount} payment review / ${blockedCount} missing recipient`,
    "",
    "Approval runway:",
    ...approvalSteps.map(
      (step) => `- ${step.title}: ${step.metric} - ${step.detail}`,
    ),
    "",
    ...rows.map(
      (row) =>
        `- ${row.ownerIdentity}: ${dispatchReviewStatusLabel(row.status)} | To: ${
          row.recipient ?? "missing"
        } | Outstanding: ${formatMoney(row.outstandingCents)} | ${row.subject}`,
    ),
    "",
    "Review-only: this queue does not send owner email or update provider delivery history.",
  ].join("\n");
}

function dispatchApprovalCsv(
  rows: StatementDispatchReviewRow[],
  month: string,
) {
  const readyCount = rows.filter((row) => row.status === "ready").length;
  const reviewCount = rows.filter(
    (row) => row.status === "payment_review",
  ).length;
  const missingRecipientCount = rows.filter(
    (row) => row.status === "missing_recipient",
  ).length;
  const approvalSteps = buildDispatchApprovalSteps(rows);
  const tableRows: Array<Array<string | number | null | undefined>> = [
    [
      "Section",
      "Owner or item",
      "Status",
      "Recipient",
      "Subject",
      "Invoices",
      "Properties",
      "Outstanding",
      "Detail",
      "Guardrail",
    ],
    [
      "Queue summary",
      formatMonthLabel(month),
      `${readyCount} ready / ${reviewCount} payment review / ${missingRecipientCount} missing recipient`,
      "",
      "",
      rows.reduce((total, row) => total + row.invoiceCount, 0),
      rows.reduce((total, row) => total + row.propertyCount, 0),
      formatMoney(rows.reduce((total, row) => total + row.outstandingCents, 0)),
      "Dispatch approval queue review only.",
      DISPATCH_APPROVAL_EXPORT_GUARDRAIL,
    ],
    ...approvalSteps.map((step) => [
      "Approval runway",
      step.title,
      step.metric,
      "",
      "",
      "",
      "",
      "",
      step.detail,
      DISPATCH_APPROVAL_EXPORT_GUARDRAIL,
    ]),
    ...rows.map((row) => [
      "Owner row",
      row.ownerIdentity,
      dispatchReviewStatusLabel(row.status),
      row.recipient ?? "Missing owner billing email",
      row.subject,
      row.invoiceCount,
      row.propertyCount,
      formatMoney(row.outstandingCents),
      row.status === "ready"
        ? "Ready for send-candidate review once explicit approval is wired."
        : row.status === "payment_review"
          ? "Review outstanding or unreconciled owner balance before dispatch approval."
          : row.status === "missing_recipient"
            ? "Add owner billing email before dispatch approval."
            : "Approve monthly invoices before dispatch approval.",
      DISPATCH_APPROVAL_EXPORT_GUARDRAIL,
    ]),
    [
      "Guardrail",
      "Review-only",
      "",
      "",
      "",
      "",
      "",
      "",
      DISPATCH_APPROVAL_EXPORT_GUARDRAIL,
      DISPATCH_APPROVAL_EXPORT_GUARDRAIL,
    ],
  ];

  return tableRows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function buildDispatchApprovalSteps(
  rows: StatementDispatchReviewRow[],
): DispatchApprovalStep[] {
  const invoicedRows = rows.filter((row) => row.invoiceCount > 0);
  const readyRows = rows.filter((row) => row.status === "ready");
  const paymentReviewRows = rows.filter(
    (row) => row.status === "payment_review",
  );
  const missingRecipientRows = rows.filter(
    (row) => row.status === "missing_recipient",
  );

  return [
    {
      id: "statement-pack",
      title: "Statement pack",
      detail: invoicedRows.length
        ? "Owner statement rows exist for this month."
        : "Approve monthly invoices before finance can review owner statements.",
      metric: invoicedRows.length
        ? `${invoicedRows.length} owner row${invoicedRows.length === 1 ? "" : "s"}`
        : "No statement rows",
      tone: invoicedRows.length ? "success" : "neutral",
    },
    {
      id: "recipient-gate",
      title: "Recipient gate",
      detail: missingRecipientRows.length
        ? "Add owner billing emails before those statements can enter send approval."
        : invoicedRows.length
          ? "Every invoiced owner row has a billing recipient."
          : "Recipient review unlocks once owner statements exist.",
      metric: missingRecipientRows.length
        ? `${missingRecipientRows.length} missing`
        : invoicedRows.length
          ? "Recipients ready"
          : "Locked",
      tone: missingRecipientRows.length
        ? "danger"
        : invoicedRows.length
          ? "success"
          : "neutral",
    },
    {
      id: "payment-gate",
      title: "Payment gate",
      detail: paymentReviewRows.length
        ? "Review outstanding or unreconciled owner balances before dispatch approval."
        : invoicedRows.length
          ? "No outstanding owner balances are blocking dispatch review."
          : "Payment review unlocks once owner statements exist.",
      metric: paymentReviewRows.length
        ? `${paymentReviewRows.length} review`
        : invoicedRows.length
          ? "Payments clear"
          : "Locked",
      tone: paymentReviewRows.length
        ? "warning"
        : invoicedRows.length
          ? "success"
          : "neutral",
    },
    {
      id: "approval-queue",
      title: "Approval queue",
      detail: readyRows.length
        ? "These rows can be reviewed as send candidates once the explicit approval workflow is wired."
        : invoicedRows.length
          ? "No owner rows are ready for send-candidate review yet."
          : "No approval queue until monthly statements are present.",
      metric: readyRows.length
        ? `${readyRows.length} send candidate${readyRows.length === 1 ? "" : "s"}`
        : "None ready",
      tone: readyRows.length
        ? missingRecipientRows.length || paymentReviewRows.length
          ? "primary"
          : "success"
        : invoicedRows.length
          ? "warning"
          : "neutral",
    },
  ];
}

function statementExceptionKindLabel(kind: StatementExceptionKind) {
  if (kind === "missing_recipient") return "Missing recipient";
  return "Payment review";
}

function statementExceptionKindTone(kind: StatementExceptionKind) {
  if (kind === "missing_recipient") return "danger" as const;
  return "warning" as const;
}

function buildStatementExceptionRows({
  owners,
  showOwnerDispatch,
}: {
  owners: OwnerStatementRecord[];
  showOwnerDispatch: boolean;
}): StatementExceptionRow[] {
  const rows: StatementExceptionRow[] = [];
  for (const owner of owners) {
    if (owner.invoice_count === 0) {
      continue;
    }
    if (showOwnerDispatch && !owner.billing_email) {
      rows.push({
        id: `${owner.owner_identity}-missing-recipient`,
        kind: "missing_recipient",
        ownerIdentity: owner.owner_identity,
        detail:
          "Add an owner billing email before this statement can move into dispatch approval.",
        metric: `${owner.invoice_count} invoice${
          owner.invoice_count === 1 ? "" : "s"
        } waiting`,
        outstandingCents: owner.outstanding_cents,
        propertyCount: owner.property_count,
        invoiceCount: owner.invoice_count,
      });
    }
    if (owner.outstanding_cents > 0) {
      rows.push({
        id: `${owner.owner_identity}-payment-review`,
        kind: "payment_review",
        ownerIdentity: owner.owner_identity,
        detail: showOwnerDispatch
          ? "Review outstanding or unreconciled payment state before sending this owner statement."
          : "Review outstanding or unreconciled payment state before completing local entity-reporting signoff.",
        metric: `${formatMoney(owner.outstanding_cents)} outstanding`,
        outstandingCents: owner.outstanding_cents,
        propertyCount: owner.property_count,
        invoiceCount: owner.invoice_count,
      });
    }
  }
  return rows.sort(
    (left, right) =>
      (left.kind === "missing_recipient" ? 0 : 1) -
        (right.kind === "missing_recipient" ? 0 : 1) ||
      right.outstandingCents - left.outstandingCents ||
      left.ownerIdentity.localeCompare(right.ownerIdentity),
  );
}

function statementExceptionsText(
  rows: StatementExceptionRow[],
  month: string,
  showOwnerDispatch: boolean,
) {
  const title = showOwnerDispatch
    ? "Owner statement finance exceptions"
    : "Entity statement finance exceptions";
  if (!rows.length) {
    return [
      title,
      `Month: ${formatMonthLabel(month)}`,
      "No recipient or payment exceptions are showing for the current statement pack.",
    ].join("\n");
  }
  return [
    title,
    `Month: ${formatMonthLabel(month)}`,
    "",
    ...rows.map(
      (row) =>
        `- ${row.ownerIdentity}: ${statementExceptionKindLabel(row.kind)} | ${row.metric} | ${row.propertyCount} propert${
          row.propertyCount === 1 ? "y" : "ies"
        } | ${row.invoiceCount} invoice${row.invoiceCount === 1 ? "" : "s"}`,
    ),
    "",
    showOwnerDispatch
      ? "Review-only: resolve these before owner statement dispatch approval."
      : "Review-only: resolve these before local entity-reporting signoff.",
  ].join("\n");
}

function buildStatementPackReadiness({
  statements,
  invoiceDrafts,
  freshness,
  month,
  handoffStatus,
  showOwnerDispatch,
}: {
  statements: OwnerStatementsRecord | undefined;
  invoiceDrafts: InvoiceDraftRecord[];
  freshness: XeroAccountingFreshnessRecord | null;
  month: string;
  handoffStatus: StatementPackStatus | null;
  showOwnerDispatch: boolean;
}): StatementPackReadiness {
  const monthlyApproved = invoiceDrafts.filter(
    (draft) =>
      draft.status === "approved" && draft.issue_date?.startsWith(month),
  );
  const localApprovedCount = monthlyApproved.length;
  const unpaidLocalCount = monthlyApproved.filter(
    (draft) => invoicePaymentLabel(draft) !== "paid",
  ).length;
  const owners = statements?.owners ?? [];
  const statementInvoiceCount = owners.reduce(
    (total, owner) => total + owner.invoice_count,
    0,
  );
  const outstandingCents = owners.reduce(
    (total, owner) => total + owner.outstanding_cents,
    0,
  );
  const accountingBlocked =
    freshness?.status === "attention" ||
    (freshness?.readiness_blocker_count ?? 0) > 0;
  const status: StatementPackStatus =
    handoffStatus === "blocked" || accountingBlocked
      ? "blocked"
      : statementInvoiceCount === 0
        ? "incomplete"
        : handoffStatus === "unpaid" ||
            outstandingCents > 0 ||
            unpaidLocalCount > 0
          ? "unpaid"
          : "ready";
  const title =
    status === "ready"
      ? showOwnerDispatch
        ? "Statement pack ready"
        : "Entity statement pack ready"
      : status === "blocked"
        ? showOwnerDispatch
          ? "Statement pack blocked"
          : "Entity statement pack blocked"
        : status === "unpaid"
          ? "Payment review still open"
          : showOwnerDispatch
            ? "Statement pack incomplete"
            : "Entity statement pack incomplete";
  const detail =
    status === "ready"
      ? showOwnerDispatch
        ? "Owner totals are ready to review from the closed billing run."
        : "Entity totals are ready to review from the closed billing run."
      : status === "blocked"
        ? showOwnerDispatch
          ? "Resolve the accounting or dispatch blockers before relying on this pack."
          : "Resolve accounting blockers before relying on this local entity-reporting pack."
        : status === "unpaid"
          ? showOwnerDispatch
            ? "Statements can be reviewed, but outstanding or unreconciled payments remain."
            : "Local entity-reporting can be reviewed, but outstanding or unreconciled payments remain."
          : showOwnerDispatch
            ? "Approve invoices for this month before the owner statement pack is complete."
            : "Approve invoices for this month before the local entity-reporting pack is complete.";

  return {
    status,
    title,
    detail,
    statementInvoiceCount,
    localApprovedCount,
    unpaidLocalCount,
    ownerCount: owners.length,
    outstandingCents,
  };
}

function buildFinanceChecklist({
  readiness,
  owners,
  xeroStatus,
  showOwnerDispatch,
}: {
  readiness: StatementPackReadiness;
  owners: OwnerStatementRecord[];
  xeroStatus: XeroStatusRecord | undefined;
  showOwnerDispatch: boolean;
}): FinanceChecklist {
  const ownersWithInvoices = owners.filter((owner) => owner.invoice_count > 0);
  const missingRecipientCount = ownersWithInvoices.filter(
    (owner) => !owner.billing_email,
  ).length;
  const paymentReviewCount = ownersWithInvoices.filter(
    (owner) => owner.outstanding_cents > 0,
  ).length;
  const accountingFreshness = xeroStatus?.accounting_freshness;
  const issueBlockers =
    xeroStatus?.issues.filter((issue) => issue.severity === "blocker").length ??
    0;
  const issueWarnings =
    xeroStatus?.issues.filter((issue) => issue.severity === "warning").length ??
    0;
  const accountingBlockers = Math.max(
    accountingFreshness?.readiness_blocker_count ?? 0,
    issueBlockers,
  );
  const accountingWarnings = Math.max(
    accountingFreshness?.readiness_warning_count ?? 0,
    issueWarnings,
  );
  const approvedUnsynced =
    accountingFreshness?.approved_unsynced_invoice_count ?? 0;
  const accountingStatus = accountingFreshness?.status ?? "missing";
  const accountingIssueCount =
    accountingBlockers + accountingWarnings + approvedUnsynced;

  const items: FinanceChecklistItem[] = [
    {
      id: "billing-close",
      title: "Billing close",
      detail:
        readiness.statementInvoiceCount > 0
          ? "Approved invoices are present for this statement month."
          : "Approve this month's invoices before finance can close statements.",
      status: readiness.statementInvoiceCount > 0 ? "complete" : "blocked",
      metric: `${readiness.statementInvoiceCount} statement invoices`,
    },
    {
      id: "accounting-readiness",
      title: "Accounting readiness",
      detail:
        accountingBlockers > 0 || accountingStatus === "attention"
          ? "Xero readiness has blockers that should be cleared before relying on this pack."
          : accountingIssueCount > 0 || accountingStatus !== "ready"
            ? showOwnerDispatch
              ? "Xero readiness needs a finance review before dispatch approval."
              : "Xero readiness needs a finance review before local entity-reporting signoff."
            : "Xero readiness is clear for this statement cycle.",
      status:
        accountingBlockers > 0 || accountingStatus === "attention"
          ? "blocked"
          : accountingIssueCount > 0 || accountingStatus !== "ready"
            ? "review"
            : "complete",
      metric:
        accountingIssueCount > 0
          ? `${accountingIssueCount} accounting checks`
          : "No accounting issues",
    },
    {
      id: "recipient-review",
      title: "Recipient review",
      detail: !showOwnerDispatch
        ? "Billing recipients are not required for local entity statement reports."
        : ownersWithInvoices.length === 0
          ? "Recipient review unlocks once owner statements have invoices."
          : missingRecipientCount > 0
            ? "Add owner billing emails before statements can move to send approval."
            : "Every invoiced owner has a billing recipient recorded.",
      status: !showOwnerDispatch
        ? "complete"
        : ownersWithInvoices.length === 0
          ? "locked"
          : missingRecipientCount > 0
            ? "blocked"
            : "complete",
      metric: !showOwnerDispatch
        ? "Not required"
        : missingRecipientCount > 0
          ? `${missingRecipientCount} missing`
          : `${ownersWithInvoices.length} reviewed`,
    },
    {
      id: "payment-review",
      title: "Payment review",
      detail:
        ownersWithInvoices.length === 0
          ? "Payment review unlocks once this month has approved invoices."
          : paymentReviewCount > 0 || readiness.unpaidLocalCount > 0
            ? "Outstanding or unreconciled payments remain; statements can be exported for review only."
            : showOwnerDispatch
              ? "No outstanding owner balances are showing for this statement cycle."
              : "No outstanding balances are showing for this statement cycle.",
      status:
        ownersWithInvoices.length === 0
          ? "locked"
          : paymentReviewCount > 0 || readiness.unpaidLocalCount > 0
            ? "review"
            : "complete",
      metric:
        readiness.outstandingCents > 0
          ? formatMoney(readiness.outstandingCents)
          : "Fully paid",
    },
    {
      id: "pdf-pack",
      title: "PDF pack",
      detail:
        readiness.statementInvoiceCount > 0
          ? "The accountant PDF pack and manifest are available for download."
          : "The PDF pack is held until statement invoices exist.",
      status: readiness.statementInvoiceCount > 0 ? "complete" : "locked",
      metric:
        readiness.statementInvoiceCount > 0
          ? "Export available"
          : "Awaiting invoices",
    },
    {
      id: "dispatch-lock",
      title: showOwnerDispatch
        ? "Owner dispatch"
        : "Local reporting mode",
      detail: showOwnerDispatch
        ? readiness.status === "ready" && missingRecipientCount === 0
          ? "Send approval is ready for the next workflow slice; this page still cannot send owner emails."
          : "Owner email dispatch remains locked while finance review is incomplete."
        : "Self-managed accounts keep entity-grouped statements local; external delivery workflows stay unavailable.",
      status: showOwnerDispatch ? "locked" : "complete",
      metric: showOwnerDispatch ? "No email sent" : "Local reports only",
    },
  ];

  const actionableItems = items.filter((item) => item.status !== "locked");
  const completedCount = actionableItems.filter(
    (item) => item.status === "complete",
  ).length;
  const reviewCount = items.filter((item) => item.status === "review").length;
  const blockedCount = items.filter((item) => item.status === "blocked").length;
  const lockedCount = items.filter((item) => item.status === "locked").length;
  const status =
    blockedCount > 0 ? "blocked" : reviewCount > 0 ? "review" : "ready";
  const title =
    status === "ready"
      ? "Finance checklist ready"
      : status === "blocked"
        ? "Finance checklist blocked"
        : "Finance checklist needs review";
  const detail =
    status === "ready"
      ? showOwnerDispatch
        ? "The review pack is ready for finance sign-off. Owner send still requires a separate approval workflow."
        : "The local entity-reporting pack is ready for finance sign-off."
      : status === "blocked"
        ? showOwnerDispatch
          ? "Clear the blocked checks before finance signs off the month-end statement pack."
          : "Clear the blocked checks before finance signs off the local entity-reporting pack."
        : showOwnerDispatch
          ? "The pack can be reviewed, but finance should resolve the highlighted checks before dispatch approval."
          : "The pack can be reviewed, but finance should resolve the highlighted checks before local entity-reporting signoff.";

  return {
    status,
    title,
    detail,
    completedCount,
    reviewCount,
    blockedCount,
    lockedCount,
    items,
  };
}

export default function StatementsPage() {
  return (
    <QueryProvider>
      <StatementsContent />
    </QueryProvider>
  );
}

function StatementsContent() {
  const { operatingMode } = useOperatingMode();
  const showOwnerDispatch = isManagingAgentOperatingMode(operatingMode);
  const entitiesQuery = useQuery({
    queryKey: ["entities"],
    queryFn: listEntities,
  });

  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [month, setMonth] = useState(defaultMonth());
  const [handoffSource, setHandoffSource] = useState<string | null>(null);
  const [handoffStatus, setHandoffStatus] =
    useState<StatementPackStatus | null>(null);
  const [selectedOwnerIdentity, setSelectedOwnerIdentity] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const entityId = params.get("entity_id");
    const queryMonth = validMonth(params.get("month"));
    const source = params.get("from");
    const closeStatus = statementPackStatusFromQuery(
      params.get("close_status"),
    );
    if (queryMonth) setMonth(queryMonth);
    if (source) setHandoffSource(source);
    if (closeStatus) setHandoffStatus(closeStatus);
    if (entityId) {
      setSelectedEntityId(entityId);
      return;
    }
    const stored = window.localStorage.getItem(ENTITY_STORAGE_KEY);
    if (stored) setSelectedEntityId(stored);
  }, []);
  useEffect(() => {
    if (!selectedEntityId) return;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ENTITY_STORAGE_KEY, selectedEntityId);
  }, [selectedEntityId]);
  useEffect(() => {
    if (selectedEntityId) return;
    const first = entitiesQuery.data?.[0]?.id;
    if (first) setSelectedEntityId(first);
  }, [entitiesQuery.data, selectedEntityId]);

  const statementsQuery = useQuery({
    queryKey: ["owner-statements", selectedEntityId, month],
    queryFn: () => getOwnerStatements(selectedEntityId, month),
    enabled: Boolean(selectedEntityId && month),
  });

  const dispatchQuery = useQuery({
    queryKey: ["owner-statement-dispatch", selectedEntityId, month],
    queryFn: () =>
      getOwnerStatementDispatch({ entityId: selectedEntityId, month }),
    enabled: Boolean(showOwnerDispatch && selectedEntityId && month),
  });

  const invoiceDraftsQuery = useQuery({
    queryKey: ["owner-statement-readiness-invoice-drafts", selectedEntityId],
    queryFn: () => listInvoiceDrafts({ entity_id: selectedEntityId }),
    enabled: Boolean(selectedEntityId),
  });

  const xeroStatusQuery = useQuery({
    queryKey: ["owner-statement-readiness-xero-status", selectedEntityId],
    queryFn: () => getXeroStatus(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });

  const owners = useMemo(
    () => statementsQuery.data?.owners ?? [],
    [statementsQuery.data?.owners],
  );
  useEffect(() => {
    if (owners.length === 0) {
      setSelectedOwnerIdentity("");
      return;
    }
    if (
      !owners.some((owner) => owner.owner_identity === selectedOwnerIdentity)
    ) {
      setSelectedOwnerIdentity(owners[0].owner_identity);
    }
  }, [owners, selectedOwnerIdentity]);
  const selectedOwner = useMemo(
    () =>
      owners.find((owner) => owner.owner_identity === selectedOwnerIdentity) ??
      owners[0] ??
      null,
    [owners, selectedOwnerIdentity],
  );
  const receiptsByOwner = useMemo(() => {
    const map = new Map<string, OwnerStatementDispatchReceipt>();
    for (const receipt of dispatchQuery.data?.receipts ?? []) {
      const existing = map.get(receipt.owner_identity);
      if (!existing || receipt.created_at > existing.created_at) {
        map.set(receipt.owner_identity, receipt);
      }
    }
    return map;
  }, [dispatchQuery.data?.receipts]);
  const portfolioTotals = useMemo(() => {
    return owners.reduce(
      (acc, owner) => ({
        invoiced: acc.invoiced + owner.invoiced_cents,
        paid: acc.paid + owner.paid_cents,
        outstanding: acc.outstanding + owner.outstanding_cents,
        invoiceCount: acc.invoiceCount + owner.invoice_count,
        propertyCount: acc.propertyCount + owner.property_count,
      }),
      {
        invoiced: 0,
        paid: 0,
        outstanding: 0,
        invoiceCount: 0,
        propertyCount: 0,
      },
    );
  }, [owners]);
  const statementReadiness = useMemo(
    () =>
      buildStatementPackReadiness({
        statements: statementsQuery.data,
        invoiceDrafts: invoiceDraftsQuery.data ?? [],
        freshness: xeroStatusQuery.data?.accounting_freshness ?? null,
        month,
        handoffStatus,
        showOwnerDispatch,
      }),
    [
      handoffStatus,
      invoiceDraftsQuery.data,
      month,
      showOwnerDispatch,
      statementsQuery.data,
      xeroStatusQuery.data?.accounting_freshness,
    ],
  );
  const financeChecklist = useMemo(
    () =>
      buildFinanceChecklist({
        readiness: statementReadiness,
        owners,
        xeroStatus: xeroStatusQuery.data,
        showOwnerDispatch,
      }),
    [owners, showOwnerDispatch, statementReadiness, xeroStatusQuery.data],
  );
  const dispatchReviewRows = useMemo(
    () => buildDispatchReviewRows(owners, month),
    [month, owners],
  );
  const statementExceptionRows = useMemo(
    () => buildStatementExceptionRows({ owners, showOwnerDispatch }),
    [owners, showOwnerDispatch],
  );
  const openedFromBilling = handoffSource === "billing-readiness";

  return (
    <main className="min-h-screen">
      <AppHeader>
        <Select
          value={selectedEntityId}
          onChange={(event) => setSelectedEntityId(event.target.value)}
          aria-label="Select entity"
        >
          <option value="" disabled>
            Select an entity
          </option>
          {(entitiesQuery.data ?? []).map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))}
        </Select>
      </AppHeader>

      <div className="mx-auto grid max-w-5xl gap-4 px-5 py-6">
        <PageHeader
          title={showOwnerDispatch ? "Owner statements" : "Entity statements"}
          description={
            showOwnerDispatch
              ? "Per-owner monthly roll-up of invoiced, paid, and outstanding totals across the portfolio. PDF exports are review-only; owner email dispatch stays locked until an explicit approval flow is wired."
              : "Entity-grouped monthly roll-up of invoiced, paid, and outstanding totals across the portfolio. PDF exports stay local to finance review."
          }
        />

        <section className="grid gap-3 sm:grid-cols-2">
          <Field label="Month">
            <Input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </Field>
          <div className="flex items-end justify-end text-sm text-muted-foreground">
            {statementsQuery.isFetching ? (
              <span className="inline-flex items-center gap-1">
                <RefreshCw size={14} className="animate-spin" /> Refreshing…
              </span>
            ) : null}
          </div>
        </section>

        <StatementReadinessPanel
          readiness={statementReadiness}
          month={month}
          entityId={selectedEntityId}
          openedFromBilling={openedFromBilling}
          showOwnerDispatch={showOwnerDispatch}
          loading={
            statementsQuery.isLoading ||
            invoiceDraftsQuery.isLoading ||
            xeroStatusQuery.isLoading
          }
          billingHref={`/billing-readiness?${new URLSearchParams({
            entity_id: selectedEntityId,
            tab: "delivery",
          }).toString()}`}
        />

        <FinanceChecklistPanel
          checklist={financeChecklist}
          month={month}
          showOwnerDispatch={showOwnerDispatch}
          loading={
            statementsQuery.isLoading ||
            invoiceDraftsQuery.isLoading ||
            xeroStatusQuery.isLoading
          }
        />

        <FinanceSignoffPanel
          readiness={statementReadiness}
          checklist={financeChecklist}
          exceptions={statementExceptionRows}
          dispatchRows={showOwnerDispatch ? dispatchReviewRows : []}
          month={month}
          showOwnerDispatch={showOwnerDispatch}
          loading={
            statementsQuery.isLoading ||
            invoiceDraftsQuery.isLoading ||
            xeroStatusQuery.isLoading
          }
        />

        <StatementExceptionsPanel
          rows={statementExceptionRows}
          month={month}
          loading={statementsQuery.isLoading}
          selectedOwnerIdentity={selectedOwnerIdentity}
          onSelectOwner={setSelectedOwnerIdentity}
          showOwnerDispatch={showOwnerDispatch}
        />

        {showOwnerDispatch ? (
          <DispatchReviewPanel
            rows={dispatchReviewRows}
            month={month}
            loading={statementsQuery.isLoading}
            selectedOwnerIdentity={selectedOwnerIdentity}
            onSelectOwner={setSelectedOwnerIdentity}
          />
        ) : (
          <SelfManagedDispatchGuardrailPanel />
        )}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Owners"
            value={String(owners.length)}
            detail={`${portfolioTotals.propertyCount} ${
              portfolioTotals.propertyCount === 1 ? "property" : "properties"
            }`}
          />
          <Metric
            label="Invoiced"
            value={formatMoney(portfolioTotals.invoiced)}
            detail={`${portfolioTotals.invoiceCount} ${
              portfolioTotals.invoiceCount === 1 ? "invoice" : "invoices"
            }`}
          />
          <Metric label="Paid" value={formatMoney(portfolioTotals.paid)} />
          <Metric
            label="Outstanding"
            value={formatMoney(portfolioTotals.outstanding)}
            tone={portfolioTotals.outstanding > 0 ? "warning" : undefined}
          />
        </section>

        {selectedOwner ? (
          <StatementPreviewPanel
            owner={selectedOwner}
            owners={owners}
            month={month}
            entityId={selectedEntityId}
            generatedAt={statementsQuery.data?.generated_at ?? null}
            selectedOwnerIdentity={selectedOwnerIdentity}
            onSelectOwner={setSelectedOwnerIdentity}
            liveReceipt={
              showOwnerDispatch
                ? (receiptsByOwner.get(selectedOwner.owner_identity) ?? null)
                : null
            }
            showOwnerDispatch={showOwnerDispatch}
          />
        ) : null}

        {statementsQuery.isLoading ? (
          <SectionPanel>
            <SkeletonRows rows={3} />
          </SectionPanel>
        ) : null}

        {statementsQuery.error ? (
          <p className="rounded-md border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
            {friendlyError(statementsQuery.error)}
          </p>
        ) : null}

        {!statementsQuery.isLoading &&
        owners.length === 0 &&
        !statementsQuery.error ? (
          <EmptyState
            icon={<Wallet size={18} />}
            title="No invoiced amounts for this month."
            description="Statements roll up approved invoices whose issue date falls in the selected month. Once invoices are approved through Billing Readiness, owners will appear here."
          />
        ) : null}

        {owners.map((owner) => (
          <OwnerCard key={owner.owner_identity} owner={owner} />
        ))}
      </div>
    </main>
  );
}

function statementSummaryText({
  owner,
  month,
}: {
  owner: OwnerStatementRecord;
  month: string;
}) {
  const lines = [
    `Owner statement review: ${owner.owner_identity}`,
    `Month: ${formatMonthLabel(month)}`,
    `Properties: ${owner.property_count}`,
    `Invoices: ${owner.invoice_count}`,
    `Invoiced: ${formatMoney(owner.invoiced_cents)}`,
    `Paid: ${formatMoney(owner.paid_cents)}`,
    `Outstanding: ${formatMoney(owner.outstanding_cents)}`,
  ];
  if (owner.billing_email) {
    lines.push(`Billing email: ${owner.billing_email}`);
  }
  return lines.join("\n");
}

function statementDispatchDraft({
  owner,
  month,
}: {
  owner: OwnerStatementRecord;
  month: string;
}) {
  const monthLabel = formatMonthLabel(month);
  const outstandingLine =
    owner.outstanding_cents > 0
      ? `There is ${formatMoney(owner.outstanding_cents)} still showing as outstanding. Please review the payment notes before the statement is sent.`
      : "The statement is showing as fully paid in Leasium.";
  return {
    subject: `Owner statement for ${monthLabel} - ${owner.owner_identity}`,
    body: [
      `Hi ${owner.billing_contact_name || owner.owner_identity},`,
      "",
      `Your owner statement for ${monthLabel} is ready for review.`,
      "",
      `Invoiced: ${formatMoney(owner.invoiced_cents)}`,
      `Paid: ${formatMoney(owner.paid_cents)}`,
      `Outstanding: ${formatMoney(owner.outstanding_cents)}`,
      "",
      outstandingLine,
      "",
      "Kind regards,",
      "Leasium",
    ].join("\n"),
  };
}

function statementDispatchDraftText({
  owner,
  month,
}: {
  owner: OwnerStatementRecord;
  month: string;
}) {
  const dispatchDraft = statementDispatchDraft({ owner, month });
  return [
    `To: ${owner.billing_email ?? "No owner billing email recorded"}`,
    `Subject: ${dispatchDraft.subject}`,
    "",
    dispatchDraft.body,
    "",
    DISPATCH_DRAFT_EXPORT_GUARDRAIL,
  ].join("\n");
}

function StatementPreviewPanel({
  owner,
  owners,
  month,
  entityId,
  generatedAt,
  selectedOwnerIdentity,
  onSelectOwner,
  liveReceipt,
  showOwnerDispatch,
}: {
  owner: OwnerStatementRecord;
  owners: OwnerStatementRecord[];
  month: string;
  entityId: string;
  generatedAt: string | null;
  selectedOwnerIdentity: string;
  onSelectOwner: (value: string) => void;
  liveReceipt: OwnerStatementDispatchReceipt | null;
  showOwnerDispatch: boolean;
}) {
  const queryClient = useQueryClient();
  const [copyReceipt, setCopyReceipt] = useState<string | null>(null);
  const [dispatchReceipt, setDispatchReceipt] = useState<string | null>(null);
  const [pdfReceipt, setPdfReceipt] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [confirmingSend, setConfirmingSend] = useState(false);
  const canPrint = owner.invoice_count > 0;
  const dispatchDraft = statementDispatchDraft({ owner, month });
  const recipientReady = Boolean(owner.billing_email);
  const hasInvoices = owner.invoice_count > 0;
  const alreadySent = Boolean(liveReceipt);
  const sendDisabledReason = !recipientReady
    ? "No billing email"
    : !hasInvoices
      ? "Awaiting invoices"
      : null;
  const sendMutation = useMutation({
    mutationFn: () =>
      sendOwnerStatement({
        entityId,
        ownerIdentity: owner.owner_identity,
        month,
        resend: alreadySent,
      }),
    onSuccess: () => {
      setConfirmingSend(false);
      queryClient.invalidateQueries({
        queryKey: ["owner-statement-dispatch", entityId, month],
      });
    },
  });
  // Reset the inline confirm + mutation state whenever the selected owner or
  // month changes so a primed confirm never carries across to another owner.
  useEffect(() => {
    setConfirmingSend(false);
    sendMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner.owner_identity, month]);
  const sendReceipt = sendMutation.data ?? null;
  const invoiceEvidenceRows = owner.properties.flatMap((property) =>
    property.invoices.map((invoice) => ({
      ...invoice,
      propertyName: property.property_name,
    })),
  );

  const copySummary = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setCopyReceipt("Copy unavailable in this browser.");
      return;
    }
    await navigator.clipboard.writeText(statementSummaryText({ owner, month }));
    setCopyReceipt("Review summary copied.");
  };
  const copyDispatchDraft = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setDispatchReceipt("Copy unavailable in this browser.");
      return;
    }
    await navigator.clipboard.writeText(
      statementDispatchDraftText({ owner, month }),
    );
    setDispatchReceipt("Dispatch draft copied. No email sent.");
  };
  const downloadDispatchDraft = () => {
    saveBlob(
      new Blob([statementDispatchDraftText({ owner, month })], {
        type: "text/plain;charset=utf-8",
      }),
      `owner-statement-dispatch-draft-${month}-${ownerSlug(
        owner.owner_identity,
      )}.txt`,
    );
    setDispatchReceipt("Dispatch draft downloaded. No email sent.");
  };
  const downloadPdf = async () => {
    setPdfLoading(true);
    setPdfReceipt(null);
    try {
      const blob = await downloadOwnerStatementPdf({
        entityId,
        month,
        ownerIdentity: owner.owner_identity,
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `owner-statement-${month}-${ownerSlug(
        owner.owner_identity,
      )}.pdf`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setPdfReceipt("PDF prepared. No email sent.");
    } catch (error) {
      setPdfReceipt(friendlyError(error));
    } finally {
      setPdfLoading(false);
    }
  };
  const downloadInvoiceEvidence = () => {
    saveBlob(
      new Blob([ownerInvoiceEvidenceCsv(owner)], {
        type: "text/csv;charset=utf-8",
      }),
      `owner-statement-invoice-evidence-${month}-${ownerSlug(
        owner.owner_identity,
      )}.csv`,
    );
  };

  return (
    <SectionPanel
      title="Statement preview"
      description="Finance review pack before PDF export or owner dispatch."
      icon={<ReceiptText size={17} className="text-primary" />}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            tone={owner.outstanding_cents > 0 ? "warning" : "success"}
          >
            {owner.outstanding_cents > 0 ? "Payment review" : "Ready to print"}
          </StatusBadge>
        </div>
      }
    >
      <div className="grid gap-4 p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <Field label="Owner">
            <Select
              value={selectedOwnerIdentity}
              onChange={(event) => onSelectOwner(event.target.value)}
              aria-label="Select statement owner"
            >
              {owners.map((item) => (
                <option key={item.owner_identity} value={item.owner_identity}>
                  {item.owner_identity}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap items-end gap-2 lg:justify-end">
            <SecondaryButton type="button" onClick={copySummary}>
              <ClipboardCheck size={15} />
              Copy summary
            </SecondaryButton>
            <SecondaryButton
              type="button"
              onClick={() => window.print()}
              disabled={!canPrint}
            >
              <Printer size={15} />
              Print / save PDF
            </SecondaryButton>
            <SecondaryButton
              type="button"
              onClick={downloadPdf}
              disabled={!canPrint || pdfLoading || !entityId}
            >
              {pdfLoading ? (
                <RefreshCw size={15} className="animate-spin" />
              ) : (
                <Download size={15} />
              )}
              Download PDF
            </SecondaryButton>
          </div>
        </div>

        {copyReceipt || pdfReceipt ? (
          <p className="text-sm font-medium text-success">
            {[copyReceipt, pdfReceipt].filter(Boolean).join(" ")}
          </p>
        ) : null}

        <div className="grid gap-4 rounded-md border border-border bg-white p-5 text-sm shadow-leasiumXs">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
            <div>
              <div className="text-xs font-semibold uppercase text-muted-foreground">
                Owner statement
              </div>
              <h2 className="mt-1 text-2xl font-semibold text-foreground">
                {owner.owner_identity}
              </h2>
              <p className="mt-1 text-muted-foreground">
                {formatMonthLabel(month)}
              </p>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              {generatedAt ? (
                <div>Generated {formatDateTime(generatedAt)}</div>
              ) : null}
              {owner.billing_contact_name ? (
                <div>{owner.billing_contact_name}</div>
              ) : null}
              {owner.billing_email ? <div>{owner.billing_email}</div> : null}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Metric
              label="Invoiced"
              value={formatMoney(owner.invoiced_cents)}
            />
            <Metric label="Paid" value={formatMoney(owner.paid_cents)} />
            <Metric
              label="Outstanding"
              value={formatMoney(owner.outstanding_cents)}
              tone={owner.outstanding_cents > 0 ? "warning" : undefined}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left text-sm tabular-nums">
              <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-semibold">Property</th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Invoiced
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">Paid</th>
                  <th className="py-2 pl-3 text-right font-semibold">
                    Outstanding
                  </th>
                </tr>
              </thead>
              <tbody>
                {owner.properties.map((line) => (
                  <tr key={line.property_id} className="border-b border-border">
                    <td className="py-2 pr-3 font-medium">
                      {line.property_name}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatMoney(line.invoiced_cents)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatMoney(line.paid_cents)}
                    </td>
                    <td className="py-2 pl-3 text-right font-semibold">
                      {formatMoney(line.outstanding_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <section
            aria-label="Invoice evidence"
            className="grid gap-3 rounded-md border border-border bg-muted/40 p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Invoice evidence
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Source invoice lines included in this owner statement.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="neutral">
                  {invoiceEvidenceRows.length}{" "}
                  {invoiceEvidenceRows.length === 1 ? "invoice" : "invoices"}
                </StatusBadge>
                <SecondaryButton
                  type="button"
                  onClick={downloadInvoiceEvidence}
                  disabled={invoiceEvidenceRows.length === 0}
                >
                  <Download size={15} />
                  Download invoice evidence CSV
                </SecondaryButton>
              </div>
            </div>

            {invoiceEvidenceRows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-left text-xs tabular-nums">
                  <thead className="border-b border-border uppercase text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3 font-semibold">Invoice</th>
                      <th className="px-3 py-2 font-semibold">Property</th>
                      <th className="px-3 py-2 font-semibold">Due</th>
                      <th className="px-3 py-2 text-right font-semibold">
                        Amount
                      </th>
                      <th className="px-3 py-2 text-right font-semibold">
                        Paid
                      </th>
                      <th className="px-3 py-2 text-right font-semibold">
                        Due
                      </th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="py-2 pl-3 font-semibold">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoiceEvidenceRows.map((invoice) => {
                      const sources = invoiceEvidenceSources(invoice);
                      return (
                        <tr
                          key={
                            invoice.invoice_draft_id ?? invoice.invoice_number
                          }
                          className="border-b border-border last:border-0"
                        >
                          <td className="py-2 pr-3 align-top">
                            <div className="font-semibold text-foreground">
                              {invoice.invoice_number ??
                                invoice.invoice_draft_id ??
                                "Unnumbered invoice"}
                            </div>
                            <div className="mt-0.5 text-muted-foreground">
                              {invoice.title}
                            </div>
                          </td>
                          <td className="px-3 py-2 align-top font-medium text-foreground">
                            {invoice.propertyName}
                          </td>
                          <td className="px-3 py-2 align-top text-muted-foreground">
                            Due {formatDate(invoice.due_date)}
                          </td>
                          <td className="px-3 py-2 text-right align-top">
                            {formatMoney(invoice.total_cents)}
                          </td>
                          <td className="px-3 py-2 text-right align-top text-muted-foreground">
                            {formatMoney(invoice.paid_cents)} paid
                          </td>
                          <td className="px-3 py-2 text-right align-top font-semibold">
                            {formatMoney(invoice.outstanding_cents)} due
                          </td>
                          <td className="px-3 py-2 align-top">
                            <StatusBadge
                              tone={
                                invoice.outstanding_cents > 0
                                  ? "warning"
                                  : "success"
                              }
                            >
                              {invoiceEvidenceStatusLabel(
                                invoice.payment_status,
                              )}
                            </StatusBadge>
                          </td>
                          <td className="py-2 pl-3 align-top text-muted-foreground">
                            {sources.length ? sources.join(" · ") : "API row"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-md border border-border bg-white p-3 text-xs text-muted-foreground">
                No invoice evidence rows were returned for this owner.
              </p>
            )}
          </section>

          <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
            Review state:{" "}
            {showOwnerDispatch
              ? owner.outstanding_cents > 0
                ? "payment review remains open. Dispatch is still explicit and separate from this preview"
                : "ready for owner dispatch. Dispatch is still explicit and separate from this preview"
              : owner.outstanding_cents > 0
                ? "payment review remains open. This account mode keeps statements local"
                : "ready for local entity reporting"}
            .
          </div>
        </div>

        {showOwnerDispatch ? (
          <div className="grid gap-4 rounded-md border border-border bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <MailCheck size={17} />
                </span>
                <div>
                  <h3 className="text-base font-semibold text-foreground">
                    Dispatch review
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Check the recipient and owner-facing copy before a later
                    send step.
                  </p>
                </div>
              </div>
              <StatusBadge tone={recipientReady ? "success" : "warning"}>
                {recipientReady ? "Recipient ready" : "Needs owner email"}
              </StatusBadge>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
              <div className="grid gap-2 text-sm">
                <div>
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    To
                  </div>
                  <div className="mt-1 font-medium">
                    {owner.billing_email ?? "No owner billing email recorded"}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    Subject
                  </div>
                  <div className="mt-1 font-medium">
                    {dispatchDraft.subject}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-start gap-2 lg:justify-end">
                <SecondaryButton type="button" onClick={copyDispatchDraft}>
                  <ClipboardCheck size={15} />
                  Copy dispatch draft
                </SecondaryButton>
                <SecondaryButton type="button" onClick={downloadDispatchDraft}>
                  <Download size={15} />
                  Download dispatch draft
                </SecondaryButton>
              </div>
            </div>

            <pre className="whitespace-pre-wrap rounded-md border border-border bg-muted p-3 text-sm leading-6 text-foreground">
              {dispatchDraft.body}
            </pre>

            {dispatchReceipt ? (
              <p className="text-sm font-medium text-success">
                {dispatchReceipt}
              </p>
            ) : null}

            <div className="flex items-start gap-2 rounded-md bg-muted p-3 text-xs text-muted-foreground">
              <ShieldCheck size={14} className="mt-0.5 shrink-0 text-primary" />
              Review only. This does not send owner email, attach a PDF, or
              update provider delivery history.
            </div>

            <div className="grid gap-3 border-t border-border pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-foreground">
                    Send statement
                  </h4>
                  {liveReceipt ? (
                    <StatusBadge
                      tone={dispatchReceiptStatusTone(liveReceipt.status)}
                    >
                      {dispatchReceiptStatusLabel(liveReceipt.status)}
                    </StatusBadge>
                  ) : null}
                </div>
                {sendDisabledReason ? (
                  <span className={chipClass("warning", { bordered: true })}>
                    {sendDisabledReason}
                  </span>
                ) : null}
              </div>

              {confirmingSend ? (
                <div className="grid gap-3 rounded-md border border-warning-strong/30 bg-warning-soft p-3">
                  <p className="text-sm font-medium text-warning-strong">
                    {`Send this statement as a real email to ${owner.billing_email}? This does not post to Xero, reconcile payments, or dispatch invoices.`}
                    {alreadySent
                      ? " A statement was already sent to this owner for this month; this resends it."
                      : ""}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      onClick={() => sendMutation.mutate()}
                      disabled={sendMutation.isPending}
                    >
                      {sendMutation.isPending ? (
                        <RefreshCw size={15} className="animate-spin" />
                      ) : (
                        <Send size={15} />
                      )}
                      Confirm send
                    </Button>
                    <SecondaryButton
                      type="button"
                      onClick={() => setConfirmingSend(false)}
                      disabled={sendMutation.isPending}
                    >
                      Cancel
                    </SecondaryButton>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    onClick={() => {
                      sendMutation.reset();
                      setConfirmingSend(true);
                    }}
                    disabled={Boolean(sendDisabledReason)}
                  >
                    <Send size={15} />
                    {alreadySent ? "Resend statement" : "Send statement"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    A confirm step appears before any email is sent.
                  </p>
                </div>
              )}

              {sendReceipt ? (
                <div className="grid gap-2 rounded-md border border-border bg-white p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      tone={dispatchReceiptStatusTone(sendReceipt.status)}
                    >
                      {dispatchReceiptStatusLabel(sendReceipt.status)}
                    </StatusBadge>
                    {sendReceipt.recipient_email ? (
                      <span className="text-muted-foreground">
                        to {sendReceipt.recipient_email}
                      </span>
                    ) : null}
                  </div>
                  {sendReceipt.provider_message_id ? (
                    <div className="text-xs text-muted-foreground">
                      Provider message id: {sendReceipt.provider_message_id}
                    </div>
                  ) : null}
                  {(sendReceipt.status === "failed" ||
                    sendReceipt.status === "skipped") &&
                  sendReceipt.error ? (
                    <div className="text-xs font-medium text-danger">
                      {sendReceipt.error}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {sendMutation.isError ? (
                <p className="text-sm font-medium text-danger">
                  {friendlyError(sendMutation.error)}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </SectionPanel>
  );
}

function Metric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "warning";
}) {
  return (
    <div className="rounded-md border border-border bg-white p-4">
      <div
        className={
          tone === "warning"
            ? "text-2xl font-semibold text-danger"
            : "text-2xl font-semibold"
        }
      >
        {value}
      </div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
      {detail ? (
        <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>
      ) : null}
    </div>
  );
}

function StatementReadinessPanel({
  readiness,
  month,
  entityId,
  openedFromBilling,
  showOwnerDispatch,
  loading,
  billingHref,
}: {
  readiness: StatementPackReadiness;
  month: string;
  entityId: string;
  openedFromBilling: boolean;
  showOwnerDispatch: boolean;
  loading: boolean;
  billingHref: string;
}) {
  const [packLoading, setPackLoading] = useState(false);
  const [packReceipt, setPackReceipt] = useState<string | null>(null);
  const tone = statementPackTone(readiness.status);
  const icon =
    readiness.status === "ready" ? (
      <CheckCircle2 size={17} />
    ) : readiness.status === "blocked" ? (
      <AlertTriangle size={17} />
    ) : (
      <ReceiptText size={17} />
    );
  const downloadPack = async () => {
    setPackLoading(true);
    setPackReceipt(null);
    try {
      const blob = await downloadOwnerStatementPdfPack({ entityId, month });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = showOwnerDispatch
        ? `owner-statement-pack-${month}.zip`
        : `entity-statement-pack-${month}.zip`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setPackReceipt(
        showOwnerDispatch
          ? "Accountant review pack prepared with PDFs and manifest. No owner email sent."
          : "Accountant review pack prepared with PDFs and manifest for local reporting.",
      );
    } catch (error) {
      setPackReceipt(friendlyError(error));
    } finally {
      setPackLoading(false);
    }
  };
  return (
    <SectionPanel
      title="Statement pack readiness"
      description={
        openedFromBilling
          ? "Opened from the Billing Readiness month-end checklist."
          : showOwnerDispatch
            ? "Owner statement readiness for the selected month."
            : "Entity statement readiness for the selected month."
      }
      icon={<span className="text-primary">{icon}</span>}
      actions={
        <StatusBadge tone={loading ? "neutral" : tone}>
          {loading ? "Checking" : statementPackLabel(readiness.status)}
        </StatusBadge>
      }
    >
      <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid gap-2">
          <div className="text-sm font-semibold text-foreground">
            {readiness.title}
          </div>
          <p className="text-sm text-muted-foreground">{readiness.detail}</p>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone="neutral">Month {month}</StatusBadge>
            <StatusBadge tone="neutral">
              {readiness.ownerCount}{" "}
              {showOwnerDispatch
                ? readiness.ownerCount === 1
                  ? "owner"
                  : "owners"
                : readiness.ownerCount === 1
                  ? "entity"
                  : "entities"}
            </StatusBadge>
            <StatusBadge tone="primary">
              {readiness.statementInvoiceCount} statement{" "}
              {readiness.statementInvoiceCount === 1 ? "invoice" : "invoices"}
            </StatusBadge>
            <StatusBadge tone="neutral">
              {readiness.localApprovedCount} approved locally
            </StatusBadge>
            <StatusBadge
              tone={readiness.unpaidLocalCount > 0 ? "warning" : "success"}
            >
              {readiness.unpaidLocalCount} unpaid locally
            </StatusBadge>
            <StatusBadge
              tone={readiness.outstandingCents > 0 ? "warning" : "success"}
            >
              {formatMoney(readiness.outstandingCents)} outstanding
            </StatusBadge>
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-2 lg:justify-end">
          <SecondaryButton
            type="button"
            onClick={downloadPack}
            disabled={
              loading ||
              packLoading ||
              !entityId ||
              readiness.statementInvoiceCount === 0
            }
          >
            {packLoading ? (
              <RefreshCw size={15} className="animate-spin" />
            ) : (
              <Download size={15} />
            )}
            Download accountant pack
          </SecondaryButton>
          <Link
            href={billingHref}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
          >
            <ArrowUpRight size={15} />
            Open Billing Readiness
          </Link>
        </div>
        {packReceipt ? (
          <p className="text-sm font-medium text-success lg:col-span-2">
            {packReceipt}
          </p>
        ) : null}
      </div>
    </SectionPanel>
  );
}

function FinanceChecklistPanel({
  checklist,
  month,
  showOwnerDispatch,
  loading,
}: {
  checklist: FinanceChecklist;
  month: string;
  showOwnerDispatch: boolean;
  loading: boolean;
}) {
  const [copyReceipt, setCopyReceipt] = useState<string | null>(null);
  const actionableTotal = checklist.items.length - checklist.lockedCount;
  const copyChecklist = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setCopyReceipt("Copy unavailable in this browser.");
      return;
    }
    await navigator.clipboard.writeText(
      financeChecklistText(checklist, showOwnerDispatch),
    );
    setCopyReceipt("Finance checklist copied.");
  };
  const downloadChecklist = () => {
    saveBlob(
      new Blob([financeChecklistCsv(checklist)], {
        type: "text/csv;charset=utf-8",
      }),
      showOwnerDispatch
        ? `owner-statement-checklist-${month}.csv`
        : `entity-statement-checklist-${month}.csv`,
    );
  };

  return (
    <SectionPanel
      title="Finance checklist"
      description={
        showOwnerDispatch
          ? "Automated month-end checks for the owner statement pack."
          : "Automated month-end checks for the local entity-reporting pack."
      }
      icon={<ListChecks size={17} className="text-primary" />}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <SecondaryButton type="button" onClick={copyChecklist}>
            <ClipboardCheck size={15} />
            Copy checklist
          </SecondaryButton>
          <SecondaryButton
            type="button"
            onClick={downloadChecklist}
            disabled={loading}
          >
            <Download size={15} />
            Download checklist CSV
          </SecondaryButton>
          <StatusBadge
            tone={loading ? "neutral" : checklistOverallTone(checklist.status)}
          >
            {loading
              ? "Checking"
              : checklist.status === "ready"
                ? "Ready"
                : checklist.status === "blocked"
                  ? "Blocked"
                  : "Review"}
          </StatusBadge>
        </div>
      }
    >
      <div className="grid gap-4 p-4">
        {copyReceipt ? (
          <p className="text-sm font-medium text-success">{copyReceipt}</p>
        ) : null}
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <div className="text-sm font-semibold text-foreground">
              {checklist.title}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {checklist.detail}
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2 lg:justify-end">
            <StatusBadge tone="success">
              {checklist.completedCount}/{actionableTotal} done
            </StatusBadge>
            <StatusBadge
              tone={checklist.blockedCount > 0 ? "danger" : "neutral"}
            >
              {checklist.blockedCount} blocked
            </StatusBadge>
            <StatusBadge
              tone={checklist.reviewCount > 0 ? "warning" : "neutral"}
            >
              {checklist.reviewCount} review
            </StatusBadge>
            <StatusBadge tone="neutral">
              {checklist.lockedCount} locked
            </StatusBadge>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {checklist.items.map((item) => {
            const tone = checklistStatusTone(item.status);
            const icon =
              item.status === "complete" ? (
                <CheckCircle2 size={16} />
              ) : item.status === "locked" ? (
                <LockKeyhole size={16} />
              ) : (
                <AlertTriangle size={16} />
              );
            return (
              <div
                key={item.id}
                className="grid gap-2 rounded-md border border-border bg-white p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2">
                    <span className="mt-0.5 text-primary">{icon}</span>
                    <div className="min-w-0">
                      <div className="font-semibold text-foreground">
                        {item.title}
                      </div>
                      <p className="mt-1 text-sm leading-5 text-muted-foreground">
                        {item.detail}
                      </p>
                    </div>
                  </div>
                  <StatusBadge tone={tone}>
                    {checklistStatusLabel(item.status)}
                  </StatusBadge>
                </div>
                <div className="text-xs font-medium text-muted-foreground">
                  {item.metric}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </SectionPanel>
  );
}

function FinanceSignoffPanel({
  readiness,
  checklist,
  exceptions,
  dispatchRows,
  month,
  showOwnerDispatch,
  loading,
}: {
  readiness: StatementPackReadiness;
  checklist: FinanceChecklist;
  exceptions: StatementExceptionRow[];
  dispatchRows: StatementDispatchReviewRow[];
  month: string;
  showOwnerDispatch: boolean;
  loading: boolean;
}) {
  const [copyReceipt, setCopyReceipt] = useState<string | null>(null);
  const status = financeSignoffStatus({
    readiness,
    checklist,
    exceptions,
    dispatchRows,
    showOwnerDispatch,
  });
  const copySignoff = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setCopyReceipt("Copy unavailable in this browser.");
      return;
    }
    await navigator.clipboard.writeText(
      financeSignoffPacketText({
        month,
        readiness,
        checklist,
        exceptions,
        dispatchRows,
        showOwnerDispatch,
      }),
    );
    setCopyReceipt("Month-end signoff packet copied.");
  };
  const downloadSignoff = () => {
    saveBlob(
      new Blob(
        [
          financeSignoffPacketCsv({
            month,
            readiness,
            checklist,
            exceptions,
            dispatchRows,
            showOwnerDispatch,
          }),
        ],
        {
          type: "text/csv;charset=utf-8",
        },
      ),
      showOwnerDispatch
        ? `owner-statement-signoff-${month}.csv`
        : `entity-statement-signoff-${month}.csv`,
    );
  };

  return (
    <SectionPanel
      title="Month-end signoff packet"
      description={
        showOwnerDispatch
          ? "One finance handoff for statement readiness, checklist state, exceptions, and dispatch approval gates."
          : "One finance handoff for statement readiness, checklist state, and local reporting exceptions."
      }
      icon={<ClipboardCheck size={17} className="text-primary" />}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <SecondaryButton
            type="button"
            onClick={copySignoff}
            disabled={loading}
          >
            <Copy size={15} />
            Copy signoff
          </SecondaryButton>
          <SecondaryButton
            type="button"
            onClick={downloadSignoff}
            disabled={loading}
          >
            <Download size={15} />
            Download signoff CSV
          </SecondaryButton>
          <StatusBadge tone={loading ? "neutral" : status.tone}>
            {loading ? "Checking" : status.label}
          </StatusBadge>
        </div>
      }
    >
      <div className="grid gap-4 p-4">
        {copyReceipt ? (
          <p className="text-sm font-medium text-success">{copyReceipt}</p>
        ) : null}
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <div className="text-sm font-semibold text-foreground">
              {loading ? "Checking statement signoff" : status.detail}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {showOwnerDispatch
                ? `Month ${month} remains review-only until explicit owner dispatch is wired.`
                : `Month ${month} remains a local entity-reporting pack for this account mode.`}
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2 lg:justify-end">
            <StatusBadge tone="primary">
              {readiness.ownerCount}{" "}
              {showOwnerDispatch
                ? `owner${readiness.ownerCount === 1 ? "" : "s"}`
                : `entit${readiness.ownerCount === 1 ? "y" : "ies"}`}
            </StatusBadge>
            {showOwnerDispatch ? (
              <>
                <StatusBadge
                  tone={status.readyDispatchCount ? "success" : "neutral"}
                >
                  {status.readyDispatchCount} dispatch-ready
                </StatusBadge>
                <StatusBadge
                  tone={status.missingRecipientCount ? "danger" : "success"}
                >
                  {status.missingRecipientCount} missing recipient
                </StatusBadge>
              </>
            ) : (
              <StatusBadge tone="neutral">Local reporting</StatusBadge>
            )}
            <StatusBadge
              tone={status.paymentReviewCount ? "warning" : "success"}
            >
              {status.paymentReviewCount} payment review
            </StatusBadge>
          </div>
        </div>

        <div
          className={`grid gap-3 ${showOwnerDispatch ? "md:grid-cols-4" : "md:grid-cols-3"}`}
        >
          <div className="rounded-md border border-border bg-white p-3">
            <div className="text-xs font-semibold uppercase text-muted-foreground">
              Pack
            </div>
            <div className="mt-1 font-semibold text-foreground">
              {statementPackLabel(readiness.status)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {readiness.statementInvoiceCount} statement invoice
              {readiness.statementInvoiceCount === 1 ? "" : "s"}
            </div>
          </div>
          <div className="rounded-md border border-border bg-white p-3">
            <div className="text-xs font-semibold uppercase text-muted-foreground">
              Checklist
            </div>
            <div className="mt-1 font-semibold text-foreground">
              {checklist.status === "ready"
                ? "Ready"
                : checklist.status === "blocked"
                  ? "Blocked"
                  : "Review"}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {checklist.completedCount} complete · {checklist.reviewCount}{" "}
              review
            </div>
          </div>
          <div className="rounded-md border border-border bg-white p-3">
            <div className="text-xs font-semibold uppercase text-muted-foreground">
              Exceptions
            </div>
            <div className="mt-1 font-semibold text-foreground">
              {exceptions.length ? `${exceptions.length} open` : "Clear"}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Recipient and payment cleanup
            </div>
          </div>
          {showOwnerDispatch ? (
            <div className="rounded-md border border-border bg-white p-3">
              <div className="text-xs font-semibold uppercase text-muted-foreground">
                Dispatch
              </div>
              <div className="mt-1 font-semibold text-foreground">
                {status.readyDispatchCount} ready
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Approval queue only
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </SectionPanel>
  );
}

function StatementExceptionsPanel({
  rows,
  month,
  loading,
  selectedOwnerIdentity,
  onSelectOwner,
  showOwnerDispatch,
}: {
  rows: StatementExceptionRow[];
  month: string;
  loading: boolean;
  selectedOwnerIdentity: string;
  onSelectOwner: (value: string) => void;
  showOwnerDispatch: boolean;
}) {
  const [copyReceipt, setCopyReceipt] = useState<string | null>(null);
  const missingRecipientCount = rows.filter(
    (row) => row.kind === "missing_recipient",
  ).length;
  const paymentReviewCount = rows.filter(
    (row) => row.kind === "payment_review",
  ).length;
  const outstandingCents = rows.reduce(
    (total, row) =>
      row.kind === "payment_review" ? total + row.outstandingCents : total,
    0,
  );
  const copyExceptions = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setCopyReceipt("Copy unavailable in this browser.");
      return;
    }
    await navigator.clipboard.writeText(
      statementExceptionsText(rows, month, showOwnerDispatch),
    );
    setCopyReceipt("Finance exceptions copied.");
  };

  return (
    <SectionPanel
      title="Finance exceptions"
      description={
        showOwnerDispatch
          ? "Owner rows that need recipient or payment cleanup before dispatch approval."
          : "Entity rows that need recipient or payment cleanup before finance signoff."
      }
      icon={<AlertTriangle size={17} className="text-primary" />}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <SecondaryButton
            type="button"
            onClick={copyExceptions}
            disabled={loading}
          >
            <ClipboardCheck size={15} />
            Copy exceptions
          </SecondaryButton>
          <StatusBadge
            tone={
              loading
                ? "neutral"
                : missingRecipientCount > 0
                  ? "danger"
                  : paymentReviewCount > 0
                    ? "warning"
                    : "success"
            }
          >
            {loading
              ? "Checking"
              : rows.length
                ? `${rows.length} open`
                : "Clear"}
          </StatusBadge>
        </div>
      }
    >
      <div className="grid gap-4 p-4">
        {copyReceipt ? (
          <p className="text-sm font-medium text-success">{copyReceipt}</p>
        ) : null}

        {loading ? (
          <SkeletonRows rows={2} />
        ) : !rows.length ? (
          <div className="rounded-md border border-success/20 bg-success-soft px-4 py-3 text-sm text-success-strong">
            No recipient or payment exceptions are showing for this statement
            month.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone={missingRecipientCount ? "danger" : "neutral"}>
                {missingRecipientCount} missing recipient
              </StatusBadge>
              <StatusBadge tone={paymentReviewCount ? "warning" : "neutral"}>
                {paymentReviewCount} payment review
              </StatusBadge>
              <StatusBadge tone={outstandingCents ? "warning" : "success"}>
                {formatMoney(outstandingCents)} outstanding
              </StatusBadge>
              <StatusBadge tone="neutral">Month {month}</StatusBadge>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              {rows.map((row) => {
                const isSelected = selectedOwnerIdentity === row.ownerIdentity;
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => onSelectOwner(row.ownerIdentity)}
                    className={`grid gap-2 rounded-md border p-3 text-left transition hover:bg-muted/50 ${
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border bg-white"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-foreground">
                          {row.ownerIdentity}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {row.propertyCount}{" "}
                          {row.propertyCount === 1 ? "property" : "properties"}{" "}
                          · {row.invoiceCount}{" "}
                          {row.invoiceCount === 1 ? "invoice" : "invoices"}
                        </div>
                      </div>
                      <StatusBadge tone={statementExceptionKindTone(row.kind)}>
                        {statementExceptionKindLabel(row.kind)}
                      </StatusBadge>
                    </div>
                    <p className="text-sm leading-5 text-muted-foreground">
                      {row.detail}
                    </p>
                    <div className="text-xs font-semibold text-muted-foreground">
                      {row.metric}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </SectionPanel>
  );
}

function SelfManagedDispatchGuardrailPanel() {
  return (
    <SectionPanel
      title="Local reporting mode"
      description="Self-managed accounts keep entity-grouped statements local to finance review."
      icon={<ShieldCheck size={17} className="text-primary" />}
      actions={<StatusBadge tone="neutral">Local reports only</StatusBadge>}
    >
      <div className="grid gap-3 p-4">
        <p className="text-sm text-muted-foreground">
          Statement PDFs, accountant packs, and invoice evidence stay available
          for internal reporting. External delivery controls are only shown for
          managing-agent or hybrid accounts.
        </p>
      </div>
    </SectionPanel>
  );
}

function DispatchReviewPanel({
  rows,
  month,
  loading,
  selectedOwnerIdentity,
  onSelectOwner,
}: {
  rows: StatementDispatchReviewRow[];
  month: string;
  loading: boolean;
  selectedOwnerIdentity: string;
  onSelectOwner: (value: string) => void;
}) {
  const [copyReceipt, setCopyReceipt] = useState<string | null>(null);
  const readyCount = rows.filter((row) => row.status === "ready").length;
  const reviewCount = rows.filter(
    (row) => row.status === "payment_review",
  ).length;
  const missingRecipientCount = rows.filter(
    (row) => row.status === "missing_recipient",
  ).length;
  const approvalSteps = buildDispatchApprovalSteps(rows);
  const overallTone =
    missingRecipientCount > 0
      ? "danger"
      : reviewCount > 0
        ? "warning"
        : readyCount > 0
          ? "success"
          : "neutral";
  const copyApprovalPacket = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setCopyReceipt("Copy unavailable in this browser.");
      return;
    }
    await navigator.clipboard.writeText(
      dispatchApprovalPacketText(rows, month),
    );
    setCopyReceipt("Dispatch approval packet copied.");
  };
  const downloadDispatchCsv = () => {
    saveBlob(
      new Blob([dispatchApprovalCsv(rows, month)], {
        type: "text/csv;charset=utf-8",
      }),
      `owner-statement-dispatch-review-${month}.csv`,
    );
  };

  return (
    <SectionPanel
      title="Dispatch approval queue"
      description="Pack-level recipient and owner-facing copy review. This is still review-only; no owner email is sent."
      icon={<MailCheck size={17} className="text-primary" />}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <SecondaryButton
            type="button"
            onClick={copyApprovalPacket}
            disabled={loading || rows.length === 0}
          >
            <ClipboardCheck size={15} />
            Copy approval packet
          </SecondaryButton>
          <SecondaryButton
            type="button"
            onClick={downloadDispatchCsv}
            disabled={loading || rows.length === 0}
          >
            <Download size={15} />
            Download dispatch CSV
          </SecondaryButton>
          <StatusBadge tone={loading ? "neutral" : overallTone}>
            {loading
              ? "Checking"
              : missingRecipientCount > 0
                ? "Blocked"
                : reviewCount > 0
                  ? "Review"
                  : readyCount > 0
                    ? "Ready"
                    : "Locked"}
          </StatusBadge>
        </div>
      }
    >
      <div className="grid gap-4 p-4">
        {copyReceipt ? (
          <p className="text-sm font-medium text-success">{copyReceipt}</p>
        ) : null}

        {loading ? (
          <SkeletonRows rows={3} />
        ) : !rows.length ? (
          <div className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            Dispatch review will appear once owner statements exist for this
            month.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone="success">{readyCount} ready</StatusBadge>
              <StatusBadge tone={reviewCount ? "warning" : "neutral"}>
                {reviewCount} payment review
              </StatusBadge>
              <StatusBadge tone={missingRecipientCount ? "danger" : "neutral"}>
                {missingRecipientCount} missing recipient
              </StatusBadge>
              <StatusBadge tone="neutral">Month {month}</StatusBadge>
            </div>

            <div className="grid gap-3 lg:grid-cols-4">
              {approvalSteps.map((step) => (
                <div
                  key={step.id}
                  className="grid gap-2 rounded-md border border-border bg-white p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-foreground">
                      {step.title}
                    </div>
                    <StatusBadge tone={step.tone}>{step.metric}</StatusBadge>
                  </div>
                  <p className="text-sm leading-5 text-muted-foreground">
                    {step.detail}
                  </p>
                </div>
              ))}
            </div>

            <div className="overflow-x-auto rounded-md border border-border bg-white">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead className="bg-muted text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Owner</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 font-semibold">Recipient</th>
                    <th className="px-3 py-2 font-semibold">Subject</th>
                    <th className="px-3 py-2 text-right font-semibold">
                      Outstanding
                    </th>
                    <th className="w-24 px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const isSelected =
                      selectedOwnerIdentity === row.ownerIdentity;
                    return (
                      <tr
                        key={row.ownerIdentity}
                        className={`border-t border-border ${
                          isSelected ? "bg-primary/5" : ""
                        }`}
                      >
                        <td className="px-3 py-3">
                          <div className="font-medium text-foreground">
                            {row.ownerIdentity}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {row.propertyCount}{" "}
                            {row.propertyCount === 1
                              ? "property"
                              : "properties"}{" "}
                            · {row.invoiceCount}{" "}
                            {row.invoiceCount === 1 ? "invoice" : "invoices"}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <StatusBadge
                            tone={dispatchReviewStatusTone(row.status)}
                          >
                            {dispatchReviewStatusLabel(row.status)}
                          </StatusBadge>
                        </td>
                        <td className="px-3 py-3">
                          {row.recipient ?? (
                            <span className="text-warning">
                              Missing owner billing email
                            </span>
                          )}
                        </td>
                        <td className="max-w-[18rem] truncate px-3 py-3">
                          {row.subject}
                        </td>
                        <td className="px-3 py-3 text-right font-semibold tabular-nums">
                          {formatMoney(row.outstandingCents)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <SecondaryButton
                            type="button"
                            onClick={() => onSelectOwner(row.ownerIdentity)}
                            className="h-8 px-2.5 text-xs"
                          >
                            Review
                          </SecondaryButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </SectionPanel>
  );
}

function OwnerCard({ owner }: { owner: OwnerStatementRecord }) {
  const trusteeBadge = owner.trustee_name
    ? `Trustee: ${owner.trustee_name}`
    : owner.owner_legal_name
      ? `Owner: ${owner.owner_legal_name}`
      : "Unattributed";
  const outstandingTone = owner.outstanding_cents > 0 ? "warning" : "success";
  return (
    <SectionPanel
      title={owner.owner_identity}
      description={[trusteeBadge, owner.billing_email]
        .filter(Boolean)
        .join(" · ")}
      icon={<Building2 size={17} />}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="neutral">
            {owner.property_count}{" "}
            {owner.property_count === 1 ? "property" : "properties"}
          </StatusBadge>
          <StatusBadge tone="primary">
            {owner.invoice_count}{" "}
            {owner.invoice_count === 1 ? "invoice" : "invoices"}
          </StatusBadge>
          <StatusBadge tone={outstandingTone}>
            {formatMoney(owner.outstanding_cents)} outstanding
          </StatusBadge>
        </div>
      }
    >
      <div className="grid gap-3 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric label="Invoiced" value={formatMoney(owner.invoiced_cents)} />
          <Metric label="Paid" value={formatMoney(owner.paid_cents)} />
          <Metric
            label="Outstanding"
            value={formatMoney(owner.outstanding_cents)}
            tone={owner.outstanding_cents > 0 ? "warning" : undefined}
          />
        </div>

        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse text-left text-sm tabular-nums">
            <thead className="bg-muted text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-semibold">Property</th>
                <th className="px-3 py-2 text-right font-semibold">Invoiced</th>
                <th className="px-3 py-2 text-right font-semibold">Paid</th>
                <th className="px-3 py-2 text-right font-semibold">
                  Outstanding
                </th>
                <th className="px-3 py-2 text-right font-semibold">Invoices</th>
              </tr>
            </thead>
            <tbody>
              {owner.properties.map((line) => (
                <tr key={line.property_id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">
                    <span className="inline-flex items-center gap-2">
                      <FileText size={14} className="text-muted-foreground" />
                      {line.property_name}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatMoney(line.invoiced_cents)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatMoney(line.paid_cents)}
                  </td>
                  <td
                    className={
                      line.outstanding_cents > 0
                        ? "px-3 py-2 text-right font-semibold tabular-nums text-danger"
                        : "px-3 py-2 text-right tabular-nums"
                    }
                  >
                    {formatMoney(line.outstanding_cents)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {line.invoice_count}
                  </td>
                </tr>
              ))}
              {owner.properties.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-3 text-muted-foreground">
                    No invoiced properties in this month.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Wallet size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
          Paid totals are sourced from Xero reconciliation receipts on the
          invoice metadata. Outgoings and management fees roll up in a future
          slice; today this view shows invoiced / paid / outstanding only.
        </p>
      </div>
    </SectionPanel>
  );
}
