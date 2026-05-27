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

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileText,
  MailCheck,
  Printer,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { QueryProvider } from "@/components/query-provider";
import {
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
  getOwnerStatements,
  listEntities,
  type InvoiceDraftRecord,
  type OwnerStatementRecord,
  type OwnerStatementsRecord,
  type XeroAccountingFreshnessRecord,
} from "@/lib/api";

const ENTITY_STORAGE_KEY = "leasium.entity_id";

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

function friendlyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
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

function buildStatementPackReadiness({
  statements,
  invoiceDrafts,
  freshness,
  month,
  handoffStatus,
}: {
  statements: OwnerStatementsRecord | undefined;
  invoiceDrafts: InvoiceDraftRecord[];
  freshness: XeroAccountingFreshnessRecord | null;
  month: string;
  handoffStatus: StatementPackStatus | null;
}): StatementPackReadiness {
  const monthlyApproved = invoiceDrafts.filter(
    (draft) => draft.status === "approved" && draft.issue_date?.startsWith(month),
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
      ? "Statement pack ready"
      : status === "blocked"
        ? "Statement pack blocked"
        : status === "unpaid"
          ? "Payment review still open"
          : "Statement pack incomplete";
  const detail =
    status === "ready"
      ? "Owner totals are ready to review from the closed billing run."
      : status === "blocked"
        ? "Resolve the accounting or dispatch blockers before relying on this pack."
        : status === "unpaid"
          ? "Statements can be reviewed, but outstanding or unreconciled payments remain."
          : "Approve invoices for this month before the owner statement pack is complete.";

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

export default function StatementsPage() {
  return (
    <QueryProvider>
      <StatementsContent />
    </QueryProvider>
  );
}

function StatementsContent() {
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
    if (!owners.some((owner) => owner.owner_identity === selectedOwnerIdentity)) {
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
  const portfolioTotals = useMemo(() => {
    return owners.reduce(
      (acc, owner) => ({
        invoiced: acc.invoiced + owner.invoiced_cents,
        paid: acc.paid + owner.paid_cents,
        outstanding: acc.outstanding + owner.outstanding_cents,
        invoiceCount: acc.invoiceCount + owner.invoice_count,
        propertyCount: acc.propertyCount + owner.property_count,
      }),
      { invoiced: 0, paid: 0, outstanding: 0, invoiceCount: 0, propertyCount: 0 },
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
      }),
    [
      handoffStatus,
      invoiceDraftsQuery.data,
      month,
      statementsQuery.data,
      xeroStatusQuery.data?.accounting_freshness,
    ],
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
          title="Owner statements"
          description="Per-owner monthly roll-up of invoiced, paid, and outstanding totals across the portfolio. Read-only — PDF export and email dispatch land in follow-up slices."
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
          <Metric
            label="Paid"
            value={formatMoney(portfolioTotals.paid)}
          />
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

        {!statementsQuery.isLoading && owners.length === 0 && !statementsQuery.error ? (
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

function StatementPreviewPanel({
  owner,
  owners,
  month,
  entityId,
  generatedAt,
  selectedOwnerIdentity,
  onSelectOwner,
}: {
  owner: OwnerStatementRecord;
  owners: OwnerStatementRecord[];
  month: string;
  entityId: string;
  generatedAt: string | null;
  selectedOwnerIdentity: string;
  onSelectOwner: (value: string) => void;
}) {
  const [copyReceipt, setCopyReceipt] = useState<string | null>(null);
  const [dispatchReceipt, setDispatchReceipt] = useState<string | null>(null);
  const [pdfReceipt, setPdfReceipt] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const canPrint = owner.invoice_count > 0;
  const dispatchDraft = statementDispatchDraft({ owner, month });
  const recipientReady = Boolean(owner.billing_email);

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
      [
        `To: ${owner.billing_email ?? "No owner billing email recorded"}`,
        `Subject: ${dispatchDraft.subject}`,
        "",
        dispatchDraft.body,
      ].join("\n"),
    );
    setDispatchReceipt("Dispatch draft copied. No email sent.");
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
      anchor.download = `owner-statement-${month}-${owner.owner_identity
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "owner"}.pdf`;
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

  return (
    <SectionPanel
      title="Statement preview"
      description="Finance review pack before PDF export or owner dispatch."
      icon={<ReceiptText size={17} className="text-primary" />}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={owner.outstanding_cents > 0 ? "warning" : "success"}>
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
            <Metric label="Invoiced" value={formatMoney(owner.invoiced_cents)} />
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

          <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
            Review state: {owner.outstanding_cents > 0 ? "payment review remains open" : "ready for owner dispatch"}. Dispatch is still explicit and separate from this preview.
          </div>
        </div>

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
                  Check the recipient and owner-facing copy before a later send
                  step.
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
                <div className="mt-1 font-medium">{dispatchDraft.subject}</div>
              </div>
            </div>
            <div className="flex items-start lg:justify-end">
              <SecondaryButton type="button" onClick={copyDispatchDraft}>
                <ClipboardCheck size={15} />
                Copy dispatch draft
              </SecondaryButton>
            </div>
          </div>

          <pre className="whitespace-pre-wrap rounded-md border border-border bg-muted p-3 text-sm leading-6 text-foreground">
            {dispatchDraft.body}
          </pre>

          {dispatchReceipt ? (
            <p className="text-sm font-medium text-success">{dispatchReceipt}</p>
          ) : null}

          <div className="flex items-start gap-2 rounded-md bg-muted p-3 text-xs text-muted-foreground">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-primary" />
            Review only. This does not send owner email, attach a PDF, or update
            provider delivery history.
          </div>
        </div>
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
  loading,
  billingHref,
}: {
  readiness: StatementPackReadiness;
  month: string;
  entityId: string;
  openedFromBilling: boolean;
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
      anchor.download = `owner-statement-pack-${month}.zip`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setPackReceipt(
        "Accountant review pack prepared with PDFs and manifest. No owner email sent.",
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
          : "Owner statement readiness for the selected month."
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
              {readiness.ownerCount === 1 ? "owner" : "owners"}
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

function OwnerCard({ owner }: { owner: OwnerStatementRecord }) {
  const trusteeBadge = owner.trustee_name
    ? `Trustee: ${owner.trustee_name}`
    : owner.owner_legal_name
      ? `Owner: ${owner.owner_legal_name}`
      : "Unattributed";
  const outstandingTone =
    owner.outstanding_cents > 0 ? "warning" : "success";
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
                <th className="px-3 py-2 text-right font-semibold">Outstanding</th>
                <th className="px-3 py-2 text-right font-semibold">Invoices</th>
              </tr>
            </thead>
            <tbody>
              {owner.properties.map((line) => (
                <tr key={line.property_id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">
                    <span className="inline-flex items-center gap-2">
                      <FileText
                        size={14}
                        className="text-muted-foreground"
                      />
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
          invoice metadata. Outgoings and management fees roll up in a
          future slice; today this view shows invoiced / paid / outstanding
          only.
        </p>
      </div>
    </SectionPanel>
  );
}
