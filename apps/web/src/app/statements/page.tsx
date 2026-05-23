"use client";

/**
 * /statements — Owner monthly statements (v2 frontend).
 *
 * Reads the per-owner JSON from /api/v1/owners/statements and renders
 * one card per owner with a per-property breakdown of invoiced + paid +
 * outstanding totals. Month selector defaults to the previous calendar
 * month (mirrors backend default). Read-only — v3 adds PDF export,
 * v4 dispatch through the comms loop.
 */

import { useQuery } from "@tanstack/react-query";
import { Building2, FileText, RefreshCw, Wallet } from "lucide-react";
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
  SkeletonRows,
  StatusBadge,
} from "@/components/ui";
import {
  getOwnerStatements,
  listEntities,
  type OwnerStatementRecord,
} from "@/lib/api";

const ENTITY_STORAGE_KEY = "leasium.entity_id";

function defaultMonth(): string {
  const now = new Date();
  // Previous calendar month, mirroring the backend default.
  const month = now.getMonth(); // 0-11
  const year = month === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const prevMonth = month === 0 ? 12 : month;
  return `${year}-${String(prevMonth).padStart(2, "0")}`;
}

function formatMoney(cents: number, currency = "AUD"): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function friendlyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
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

  useEffect(() => {
    if (typeof window === "undefined") return;
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

  const owners = useMemo(
    () => statementsQuery.data?.owners ?? [],
    [statementsQuery.data?.owners],
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
