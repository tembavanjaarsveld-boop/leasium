"use client";

import {
  AlertTriangle,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Mail,
  ReceiptText,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { useState } from "react";

import { LeasiumMark } from "@/components/brand";
import {
  EmptyState,
  SecondaryButton,
  SectionPanel,
  SkeletonRows,
  StatusBadge,
} from "@/components/ui";
import { csvCell } from "@/lib/csv";
import { saveBlob } from "@/lib/download";
import type {
  OwnerPortalPropertyRecord,
  OwnerPortalRecord,
  OwnerPortalStatementPropertyRecord,
} from "@/lib/api";

import {
  OwnerPortalDocumentsPanel,
  OwnerPortalMaintenancePanel,
} from "./owner-portal-dashboard-sections";

export function ownerPortalStatementMonth() {
  return new Date().toISOString().slice(0, 7);
}

export function formatOwnerPortalDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatMonth(value: string | null | undefined): string {
  if (!value) {
    return "Current month";
  }
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) {
    return value;
  }
  return new Intl.DateTimeFormat("en-AU", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
  }).format(date);
}

function formatSplit(split: number): string {
  return `${split.toLocaleString("en-AU", {
    maximumFractionDigits: 3,
  })}%`;
}

export function ownerPortalAuthLabel(mode: OwnerPortalRecord["auth"]["mode"]) {
  return mode === "owner_portal_account" ? "Owner account" : "Operator preview";
}

export function OwnerPortalShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-4">
          <LeasiumMark />
          <div className="min-w-0">
            <p className="text-lg font-semibold leading-6">Leasium</p>
            <p className="text-sm text-muted-foreground">Owner portal</p>
          </div>
        </div>
      </header>
      {children}
    </main>
  );
}

export function OwnerPortalLoading({ title = "Owner portal" }: { title?: string }) {
  return (
    <OwnerPortalShell>
      <div className="mx-auto max-w-5xl px-5 py-6">
        <SectionPanel title={title}>
          <SkeletonRows rows={6} />
        </SectionPanel>
      </div>
    </OwnerPortalShell>
  );
}

export function OwnerPortalNotice({
  eyebrow = "Owner portal",
  title,
  tone = "neutral",
  children,
}: {
  eyebrow?: string;
  title: string;
  tone?: "neutral" | "warning" | "danger";
  children: React.ReactNode;
}) {
  const iconClass =
    tone === "danger"
      ? "text-danger"
      : tone === "warning"
        ? "text-warning"
        : "text-primary";
  return (
    <OwnerPortalShell>
      <div className="mx-auto grid max-w-2xl gap-5 px-5 py-10">
        <section className="rounded-md border border-border bg-white p-6 shadow-leasiumCard">
          <div className="flex items-start gap-3">
            <div className={iconClass}>
              {tone === "neutral" ? (
                <ShieldCheck size={22} />
              ) : (
                <AlertTriangle size={22} />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-primary">{eyebrow}</p>
              <h1 className="mt-1 text-2xl font-semibold leading-8">{title}</h1>
            </div>
          </div>
          <div className="mt-5 grid gap-4 text-sm leading-6 text-muted-foreground">
            {children}
          </div>
        </section>
      </div>
    </OwnerPortalShell>
  );
}

function MetricTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "primary" | "success" | "warning";
}) {
  const toneClass =
    tone === "primary"
      ? "border-primary/25 bg-primary/5"
      : tone === "success"
        ? "border-success/25 bg-success/5"
        : tone === "warning"
          ? "border-warning/25 bg-warning/5"
          : "border-border bg-white";
  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold leading-8 text-foreground">
        {value}
      </p>
    </div>
  );
}

function PropertyList({
  properties,
}: {
  properties: OwnerPortalPropertyRecord[];
}) {
  if (properties.length === 0) {
    return (
      <EmptyState
        title="No linked properties."
        description="The property team has not linked this owner to a property yet."
        icon={<Building2 size={18} />}
      />
    );
  }

  return (
    <div className="divide-y divide-border">
      {properties.map((property) => (
        <div
          key={property.property_id}
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {property.property_name}
            </p>
            <p className="text-xs text-muted-foreground">
              Property ID {property.property_id}
            </p>
          </div>
          <StatusBadge tone="primary">{formatSplit(property.split_pct)}</StatusBadge>
        </div>
      ))}
    </div>
  );
}

function StatementPropertyLines({
  properties,
}: {
  properties: OwnerPortalStatementPropertyRecord[];
}) {
  if (properties.length === 0) {
    return (
      <EmptyState
        title="No statement lines."
        description="There are no approved invoices for the selected month."
        icon={<ReceiptText size={18} />}
      />
    );
  }

  return (
    <div className="divide-y divide-border">
      {properties.map((property) => (
        <div
          key={property.property_id}
          className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto]"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {property.property_name}
            </p>
            <p className="text-xs text-muted-foreground">
              {property.invoice_count}{" "}
              {property.invoice_count === 1 ? "invoice" : "invoices"}
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-3 text-right text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Invoiced</dt>
              <dd className="font-semibold">
                {formatMoney(property.invoiced_cents)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Paid</dt>
              <dd className="font-semibold">
                {formatMoney(property.paid_cents)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Outstanding</dt>
              <dd className="font-semibold">
                {formatMoney(property.outstanding_cents)}
              </dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  );
}

function GuardrailPanel({ guardrails }: { guardrails: string[] }) {
  return (
    <SectionPanel title="Access boundary" icon={<ShieldCheck size={17} />}>
      <div className="grid gap-3 p-4">
        {guardrails.map((guardrail) => (
          <div
            key={guardrail}
            className="flex gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm leading-6 text-slate"
          >
            <CheckCircle2 className="mt-0.5 shrink-0 text-primary" size={17} />
            <p>{guardrail}</p>
          </div>
        ))}
      </div>
    </SectionPanel>
  );
}

const OWNER_VISIBLE_PACKET_GUARDRAIL =
  "Review-only export: copying or downloading this packet does not send owner email, dispatch invoices, generate owner statement PDFs, call providers, write Xero or Basiq data, reconcile payments, download shared documents, or mutate provider history.";

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

function titleCaseStatus(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ownerVisiblePacketFilename(
  portal: OwnerPortalRecord,
  selectedMonth?: string | null,
) {
  const month =
    portal.statement?.month ?? selectedMonth ?? portal.generated_at.slice(0, 7);
  const ownerId = portal.owner.id.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return `owner-visible-review-packet-${month}-${ownerId || "owner"}.csv`;
}

function ownerVisiblePacketRows(
  portal: OwnerPortalRecord,
  selectedMonth?: string | null,
) {
  const statement = portal.statement;
  const periodMonth = statement?.month ?? selectedMonth;
  const rows: Array<[string, string, string, string]> = [
    [
      "Owner",
      "Display name",
      portal.owner.display_name,
      portal.owner.billing_email ?? "No billing email",
    ],
    [
      "Owner",
      "Auth boundary",
      ownerPortalAuthLabel(portal.auth.mode),
      portal.auth.detail,
    ],
    [
      "Portal",
      "Generated at",
      formatOwnerPortalDateTime(portal.generated_at),
      "Already-loaded owner portal response.",
    ],
    [
      "Statement",
      "Period",
      formatMonth(periodMonth),
      statement ? "Owner statement totals are visible." : "No statement linked.",
    ],
    [
      "Statement",
      "Invoiced",
      formatMoney(statement?.invoiced_cents ?? 0),
      `${statement?.invoice_count ?? 0} invoice(s)`,
    ],
    [
      "Statement",
      "Paid",
      formatMoney(statement?.paid_cents ?? 0),
      "Payment summary shown in the portal.",
    ],
    [
      "Statement",
      "Outstanding",
      formatMoney(statement?.outstanding_cents ?? 0),
      "Outstanding owner statement balance.",
    ],
  ];

  rows.push(
    ...portal.properties.map(
      (property): [string, string, string, string] => [
        "Property split",
        property.property_name,
        formatSplit(property.split_pct),
        `Property ID ${property.property_id}`,
      ],
    ),
  );

  rows.push(
    ...(statement?.properties ?? []).map(
      (property): [string, string, string, string] => [
        "Statement property",
        property.property_name,
        formatMoney(property.outstanding_cents),
        `${property.invoice_count} invoice(s), ${formatMoney(
          property.invoiced_cents,
        )} invoiced, ${formatMoney(property.paid_cents)} paid`,
      ],
    ),
  );

  rows.push(
    ...portal.documents.map(
      (document): [string, string, string, string] => [
        "Shared document",
        document.filename,
        document.property_name,
        `${document.source_label}; ${
          document.notes ?? "No document note"
        }; download not triggered by packet export`,
      ],
    ),
  );

  rows.push(
    ...portal.maintenance.items.map(
      (item): [string, string, string, string] => [
        "Maintenance",
        item.title,
        item.quote_amount_cents === null
          ? "No quote amount"
          : formatMoney(item.quote_amount_cents),
        `${item.property_name}; ${titleCaseStatus(item.priority)} priority; ${titleCaseStatus(
          item.status,
        )}; due ${formatDate(item.due_date)}; ${
          item.approval_required
            ? `approval ${titleCaseStatus(item.approval_status)}`
            : "no approval required"
        }`,
      ],
    ),
  );

  rows.push(
    [
      "Maintenance",
      "Snapshot totals",
      `${portal.maintenance.open_count} open / ${portal.maintenance.urgent_count} urgent / ${portal.maintenance.awaiting_approval_count} awaiting approval`,
      "Owner-visible maintenance rows only.",
    ],
    ...portal.guardrails.map(
      (guardrail, index): [string, string, string, string] => [
        "Access boundary",
        `Guardrail ${index + 1}`,
        guardrail,
        "Shown in the owner portal.",
      ],
    ),
    [
      "Access boundary",
      "Review-only export",
      OWNER_VISIBLE_PACKET_GUARDRAIL,
      "Local copy/download only.",
    ],
  );

  return rows;
}

function ownerVisiblePacketCsv(
  portal: OwnerPortalRecord,
  selectedMonth?: string | null,
) {
  const header = ["section", "label", "value", "detail"];
  return [header, ...ownerVisiblePacketRows(portal, selectedMonth)]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}

export function OwnerVisibleReviewPacketPanel({
  portal,
  selectedMonth,
}: {
  portal: OwnerPortalRecord;
  selectedMonth?: string | null;
}) {
  const [receipt, setReceipt] = useState<string | null>(null);
  const statement = portal.statement;
  const copyPacket = async () => {
    const copied = await copyTextToClipboard(
      ownerVisiblePacketCsv(portal, selectedMonth),
    );
    setReceipt(
      copied
        ? "Owner-visible packet copied."
        : "Copy unavailable in this browser.",
    );
  };
  const downloadPacketCsv = () => {
    saveBlob(
      new Blob([ownerVisiblePacketCsv(portal, selectedMonth)], {
        type: "text/csv;charset=utf-8",
      }),
      ownerVisiblePacketFilename(portal, selectedMonth),
    );
    setReceipt("Owner-visible packet CSV downloaded.");
  };

  return (
    <SectionPanel
      title="Owner-visible packet"
      description="Local review export from the owner-visible data already shown in this portal."
      icon={<ClipboardCheck size={17} />}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <SecondaryButton type="button" onClick={copyPacket}>
            <ClipboardCheck size={15} />
            Copy packet
          </SecondaryButton>
          <SecondaryButton type="button" onClick={downloadPacketCsv}>
            <Download size={15} />
            Download packet CSV
          </SecondaryButton>
        </div>
      }
    >
      <div className="grid gap-3 p-4 text-sm">
        {receipt ? (
          <p aria-live="polite" className="font-medium text-success" role="status">
            {receipt}
          </p>
        ) : null}
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Owner
            </p>
            <p className="mt-1 font-semibold text-foreground">
              {portal.owner.display_name}
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Property split
            </p>
            <p className="mt-1 font-semibold text-foreground">
              {portal.properties.length} linked
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Statement
            </p>
            <p className="mt-1 font-semibold text-foreground">
              {formatMoney(statement?.outstanding_cents ?? 0)} outstanding
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Maintenance
            </p>
            <p className="mt-1 font-semibold text-foreground">
              {portal.maintenance.open_count} open
            </p>
          </div>
        </div>
        <p className="rounded-md bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
          {OWNER_VISIBLE_PACKET_GUARDRAIL}
        </p>
      </div>
    </SectionPanel>
  );
}

export function OwnerPortalAccountView({
  portal,
  selectedMonth,
  getAuthToken,
  requiresAuthToken = false,
}: {
  portal: OwnerPortalRecord;
  selectedMonth?: string | null;
  getAuthToken?: () => Promise<string | null>;
  requiresAuthToken?: boolean;
}) {
  const statement = portal.statement;
  const periodMonth = statement?.month ?? selectedMonth;
  const propertyCount = portal.properties.length;

  return (
    <OwnerPortalShell>
      <div className="mx-auto grid max-w-6xl gap-5 px-5 py-6">
        <section className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold leading-9">Owner portal</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              {portal.owner.display_name}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {portal.owner.billing_contact_name ? (
                <StatusBadge tone="neutral">
                  {portal.owner.billing_contact_name}
                </StatusBadge>
              ) : null}
              {portal.owner.billing_email ? (
                <StatusBadge
                  className="max-w-full min-w-0 items-start whitespace-normal break-all text-left leading-5"
                  tone="neutral"
                >
                  <Mail className="mt-0.5 shrink-0" size={13} />
                  <span className="min-w-0 break-all">
                    {portal.owner.billing_email}
                  </span>
                </StatusBadge>
              ) : null}
              {portal.owner.gst_registered ? (
                <StatusBadge tone="success">GST registered</StatusBadge>
              ) : null}
            </div>
          </div>
          <StatusBadge tone="primary">
            {ownerPortalAuthLabel(portal.auth.mode)}
          </StatusBadge>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile
            label="Properties"
            value={`${propertyCount}`}
            tone={propertyCount > 0 ? "success" : "neutral"}
          />
          <MetricTile
            label="Invoiced"
            value={formatMoney(statement?.invoiced_cents ?? 0)}
            tone="primary"
          />
          <MetricTile
            label="Paid"
            value={formatMoney(statement?.paid_cents ?? 0)}
            tone="success"
          />
          <MetricTile
            label="Outstanding"
            value={formatMoney(statement?.outstanding_cents ?? 0)}
            tone={
              statement && statement.outstanding_cents > 0 ? "warning" : "neutral"
            }
          />
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <div className="grid gap-5">
            <OwnerVisibleReviewPacketPanel
              portal={portal}
              selectedMonth={periodMonth}
            />

            <SectionPanel
              title="Statement"
              description={formatMonth(periodMonth)}
              icon={<ReceiptText size={17} />}
            >
              {statement ? (
                <>
                  <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-3">
                    <MetricTile
                      label="Invoiced"
                      value={formatMoney(statement.invoiced_cents)}
                      tone="primary"
                    />
                    <MetricTile
                      label="Paid"
                      value={formatMoney(statement.paid_cents)}
                      tone="success"
                    />
                    <MetricTile
                      label="Outstanding"
                      value={formatMoney(statement.outstanding_cents)}
                      tone={
                        statement.outstanding_cents > 0 ? "warning" : "neutral"
                      }
                    />
                  </div>
                  <StatementPropertyLines properties={statement.properties} />
                </>
              ) : (
                <EmptyState
                  title="No statement available."
                  description="Approved monthly invoice data has not been linked to this owner yet."
                  icon={<ReceiptText size={18} />}
                />
              )}
            </SectionPanel>

            <OwnerPortalMaintenancePanel maintenance={portal.maintenance} />

            <OwnerPortalDocumentsPanel
              accountMode={portal.auth.mode === "owner_portal_account"}
              documents={portal.documents}
              getAuthToken={getAuthToken}
              requiresAuthToken={requiresAuthToken}
            />

            <GuardrailPanel guardrails={portal.guardrails} />
          </div>

          <aside className="grid content-start gap-5">
            <SectionPanel title="Owner" icon={<Building2 size={17} />}>
              <dl className="grid gap-3 p-4 text-sm">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Legal name
                  </dt>
                  <dd className="mt-1 break-words">
                    {portal.owner.legal_name ?? "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    ABN
                  </dt>
                  <dd className="mt-1">{portal.owner.abn ?? "-"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Trust
                  </dt>
                  <dd className="mt-1">{portal.owner.trust_name ?? "-"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Trustee
                  </dt>
                  <dd className="mt-1">{portal.owner.trustee_name ?? "-"}</dd>
                </div>
              </dl>
            </SectionPanel>

            <SectionPanel title="Property split" icon={<WalletCards size={17} />}>
              <PropertyList properties={portal.properties} />
            </SectionPanel>

            <SectionPanel title="Period" icon={<CalendarDays size={17} />}>
              <div className="p-4 text-sm text-muted-foreground">
                {formatMonth(periodMonth)}
              </div>
            </SectionPanel>
          </aside>
        </div>
      </div>
    </OwnerPortalShell>
  );
}
