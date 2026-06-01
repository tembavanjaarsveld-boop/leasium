"use client";

import {
  AlertTriangle,
  Building2,
  CalendarDays,
  CheckCircle2,
  Mail,
  ReceiptText,
  ShieldCheck,
  WalletCards,
} from "lucide-react";

import { LeasiumMark } from "@/components/brand";
import {
  EmptyState,
  SectionPanel,
  SkeletonRows,
  StatusBadge,
} from "@/components/ui";
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

export function OwnerPortalAccountView({
  portal,
}: {
  portal: OwnerPortalRecord;
}) {
  const statement = portal.statement;
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
                <StatusBadge tone="neutral">
                  <Mail size={13} />
                  {portal.owner.billing_email}
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
            <SectionPanel
              title="Statement"
              description={formatMonth(statement?.month)}
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
                {formatMonth(statement?.month)}
              </div>
            </SectionPanel>
          </aside>
        </div>
      </div>
    </OwnerPortalShell>
  );
}
