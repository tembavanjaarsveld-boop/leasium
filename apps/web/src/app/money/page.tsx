"use client";

/**
 * /money — Horizon finance cockpit.
 *
 * Read-only summaries and review route handoffs only. No Xero, Basiq,
 * reconciliation, delivery, or payment mutation fires from this screen.
 */

import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CheckCircle2,
  FileText,
  Landmark,
  PlugZap,
  ReceiptText,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { QueryProvider } from "@/components/query-provider";
import { SkeletonLine, StatusBadge } from "@/components/ui";
import { EntityPicker } from "@/components/entity-picker";
import {
  getBasiqConnectionStatus,
  getXeroStatus,
  listArrearsCases,
  listEntities,
  listInvoiceDrafts,
  listRentRoll,
  type ArrearsCaseRecord,
  type InvoiceDraftRecord,
  type RentRollRow,
} from "@/lib/api";
import { ENTITY_STORAGE_KEY, isAllEntities } from "@/lib/entity-selection";
import {
  isManagingAgentOperatingMode,
  useOperatingMode,
} from "@/lib/use-operating-mode";

type InvoiceRunRow = {
  id: string;
  title: string;
  amountCents: number;
  delivery: string;
};

type RouteCard = {
  title: string;
  description: string;
  href: string;
  action: string;
  icon: ReactNode;
  status: string;
};

const BILLING_REVIEW_HREF = "/billing-readiness?tab=delivery";

const horizonActionLinkClass =
  "inline-flex min-h-11 items-center justify-center rounded-[12px] border border-leasium-card-border bg-white px-4 text-sm font-semibold text-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:border-primary/30 hover:bg-primary-soft";

const horizonPrimaryLinkClass =
  "inline-flex min-h-11 items-center justify-center rounded-[12px] bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-primary-hover";

const horizonCardClass =
  "rounded-[18px] border border-leasium-card-border bg-white p-[18px] shadow-leasiumCard";

function formatMoney(cents: number | null | undefined) {
  const value = Math.max(0, cents ?? 0) / 100;
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCount(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function metadataText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function blockerCount(row: RentRollRow) {
  return (
    (row.invoice_readiness_blockers?.length ?? 0) +
    (row.xero_readiness_blockers?.length ?? 0) +
    (row.gst_readiness_blockers?.length ?? 0)
  );
}

function draftReadinessBlockers(draft: InvoiceDraftRecord) {
  const readiness = draft.metadata.readiness_blockers;
  const delivery = draft.metadata.delivery_blockers;
  return [
    ...(Array.isArray(readiness) ? readiness : []),
    ...(Array.isArray(delivery) ? delivery : []),
  ];
}

function invoicePaidCents(draft: InvoiceDraftRecord) {
  const payment = metadataRecord(draft.metadata.payment_status);
  const explicitPaid =
    metadataNumber(payment.paid_cents) ??
    metadataNumber(payment.amount_paid_cents) ??
    metadataNumber(payment.applied_cents);
  if (explicitPaid !== null) return explicitPaid;
  return metadataText(payment.status) === "paid" ? draft.total_cents : 0;
}

function isOpenArrearsCase(item: ArrearsCaseRecord) {
  return (
    !item.deleted_at &&
    item.status !== "resolved" &&
    item.status !== "written_off"
  );
}

function invoiceRunRows(
  drafts: InvoiceDraftRecord[],
  rentRows: RentRollRow[],
): InvoiceRunRow[] {
  const draftRows = drafts.slice(0, 3).map((draft) => ({
    id: draft.id,
    title: `${draft.recipient_name ?? "Invoice draft"} - ${draft.title}`,
    amountCents: draft.total_cents,
    delivery: draft.recipient_email
      ? "Xero draft -> email"
      : "Xero draft -> portal",
  }));
  if (draftRows.length) return draftRows;

  return rentRows
    .filter((row) => row.lease_id && (row.charge_rules_total_cents ?? 0) > 0)
    .slice(0, 3)
    .map((row) => ({
      id:
        row.lease_id ??
        row.tenancy_unit_id ??
        row.property_id ??
        row.unit_label,
      title: `${row.tenant_name ?? "Tenant"} - next rent run`,
      amountCents: row.charge_rules_total_cents ?? 0,
      delivery: row.tenant_billing_email
        ? "Xero draft -> email"
        : "Xero draft -> portal",
    }));
}

function routeCards(
  showOwnerDispatch: boolean,
  xeroStatus: string,
  basiqStatus: string,
): RouteCard[] {
  return [
    {
      title: showOwnerDispatch ? "Owner statements" : "Entity statements",
      description: showOwnerDispatch
        ? "Monthly owner packs, invoice evidence, PDFs, and dispatch review."
        : "Entity-grouped statement reports, invoice evidence, and local PDF packs.",
      href: "/statements",
      action: showOwnerDispatch
        ? "Open owner statements"
        : "Open entity statements",
      icon: <ReceiptText size={17} />,
      status: showOwnerDispatch ? "Review dispatch" : "Local reports",
    },
    {
      title: "Xero settings",
      description:
        "Connection diagnostics, mappings, draft posting approvals, and exceptions.",
      href: "/settings?tab=xero",
      action: "Open Xero settings",
      icon: <PlugZap size={17} />,
      status: xeroStatus,
    },
    {
      title: "Basiq controls",
      description:
        "Read-only bank-feed connection status and reconciliation preview controls.",
      href: "/settings?tab=xero",
      action: "Open Basiq controls",
      icon: <Landmark size={17} />,
      status: basiqStatus,
    },
  ];
}

function MoneyMetricCard({
  label,
  value,
  detail,
  tone,
  progress,
  children,
}: {
  label: string;
  value?: string;
  detail?: ReactNode;
  tone?: "danger" | "success";
  progress?: number;
  children?: ReactNode;
}) {
  const valueTone =
    tone === "danger"
      ? "text-danger-strong"
      : tone === "success"
        ? "text-success-strong"
        : "text-foreground";

  return (
    <section className={`${horizonCardClass} min-h-[112px]`}>
      <p className="text-[11px] font-semibold uppercase leading-4 text-muted-foreground">
        {label}
      </p>
      {children ?? (
        <>
          <p className={`mt-2 text-2xl font-bold leading-8 ${valueTone}`}>
            {value}
          </p>
          {typeof progress === "number" ? (
            <div
              aria-label={`${label} progress`}
              className="mt-2 h-[7px] w-[150px] max-w-full overflow-hidden rounded-full bg-border"
            >
              <div
                className="h-full rounded-full bg-success"
                style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
              />
            </div>
          ) : null}
          {detail ? (
            <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
              {detail}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

export default function MoneyPage() {
  return (
    <QueryProvider>
      <MoneyContent />
    </QueryProvider>
  );
}

function MoneyContent() {
  const { operatingMode } = useOperatingMode();
  const showOwnerDispatch = isManagingAgentOperatingMode(operatingMode);
  const entitiesQuery = useQuery({
    queryKey: ["entities"],
    queryFn: listEntities,
  });
  const [selectedEntityId, setSelectedEntityId] = useState("");

  const rentRollQuery = useQuery({
    queryKey: ["money-rent-roll", selectedEntityId],
    queryFn: () => listRentRoll({ entity_id: selectedEntityId }),
    enabled: Boolean(selectedEntityId),
  });
  const invoiceDraftsQuery = useQuery({
    queryKey: ["money-invoice-drafts", selectedEntityId],
    queryFn: () => listInvoiceDrafts({ entity_id: selectedEntityId }),
    enabled: Boolean(selectedEntityId),
  });
  const arrearsQuery = useQuery({
    queryKey: ["money-arrears", selectedEntityId],
    queryFn: () => listArrearsCases({ entity_id: selectedEntityId }),
    enabled: Boolean(selectedEntityId),
  });
  const xeroStatusQuery = useQuery({
    queryKey: ["money-xero-status", selectedEntityId],
    queryFn: () => getXeroStatus(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });
  const basiqStatusQuery = useQuery({
    queryKey: ["money-basiq-status", selectedEntityId],
    queryFn: () => getBasiqConnectionStatus(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(ENTITY_STORAGE_KEY);
    if (stored && !isAllEntities(stored)) setSelectedEntityId(stored);
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

  const metrics = useMemo(() => {
    const rentRows = rentRollQuery.data ?? [];
    const drafts = invoiceDraftsQuery.data ?? [];
    const openArrears = (arrearsQuery.data ?? []).filter(isOpenArrearsCase);
    const billableRows = rentRows.filter(
      (row) => row.lease_id && (row.charge_rules_total_cents ?? 0) > 0,
    );
    const invoiceTotalCents = drafts.reduce(
      (total, draft) => total + draft.total_cents,
      0,
    );
    const rentRunCents = billableRows.reduce(
      (total, row) => total + (row.charge_rules_total_cents ?? 0),
      0,
    );
    const collectedCents = drafts.reduce(
      (total, draft) => total + invoicePaidCents(draft),
      0,
    );
    const collectionBaseCents = invoiceTotalCents || rentRunCents;
    const collectionProgress = collectionBaseCents
      ? Math.round((collectedCents / collectionBaseCents) * 100)
      : 0;
    const arrearsCents = openArrears.reduce(
      (total, item) => total + item.total_balance_cents,
      0,
    );
    const draftBlockers = drafts.reduce(
      (total, draft) => total + draftReadinessBlockers(draft).length,
      0,
    );
    const rentBlockers = rentRows.reduce(
      (total, row) => total + blockerCount(row),
      0,
    );

    return {
      drafts,
      rentRows,
      invoiceRunRows: invoiceRunRows(drafts, rentRows),
      invoiceCount: drafts.length || billableRows.length,
      thisMonthCents: invoiceTotalCents || rentRunCents,
      collectedCents,
      collectionProgress,
      arrearsCents,
      arrearsCount: openArrears.length,
      runBlockers: drafts.length ? draftBlockers : rentBlockers,
    };
  }, [arrearsQuery.data, invoiceDraftsQuery.data, rentRollQuery.data]);

  const xeroStatus = xeroStatusQuery.data;
  const xeroConnected = Boolean(xeroStatus?.connection.connected);
  const xeroIssueCount = xeroStatus?.issues.length ?? 0;
  const xeroFreshness = xeroStatus?.accounting_freshness ?? null;
  const xeroHeadline = xeroConnected
    ? xeroIssueCount
      ? "Needs review - per entity"
      : "Synced - per entity"
    : "Connection review";
  const xeroDetail = xeroFreshness?.last_payment_reconciliation_at
    ? `Last reconciliation ${new Intl.DateTimeFormat("en-AU", {
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(xeroFreshness.last_payment_reconciliation_at))} - ${xeroIssueCount} exceptions`
    : `${xeroIssueCount} exception${xeroIssueCount === 1 ? "" : "s"} - review in Settings`;

  const basiqStatus = basiqStatusQuery.data;
  const xeroRouteStatus = xeroConnected
    ? xeroIssueCount
      ? `${xeroIssueCount} review item${xeroIssueCount === 1 ? "" : "s"}`
      : "Synced"
    : "Not connected";
  const basiqRouteStatus = basiqStatus?.connected
    ? "Connected"
    : basiqStatus?.configured
      ? "Consent ready"
      : "Not connected";
  const lowerRoutes = routeCards(
    showOwnerDispatch,
    xeroRouteStatus,
    basiqRouteStatus,
  );

  const invoiceLoading =
    invoiceDraftsQuery.isLoading || rentRollQuery.isLoading || !selectedEntityId;
  const runBlockerLabel = metrics.runBlockers
    ? `${metrics.runBlockers} blocker${metrics.runBlockers === 1 ? "" : "s"}`
    : "No blockers";

  return (
    <main className="min-h-screen bg-leasium-canvas">
      <AppHeader>
        <EntityPicker
          entities={entitiesQuery.data}
          loading={entitiesQuery.isLoading}
          value={selectedEntityId}
          onChange={setSelectedEntityId}
          allowAllEntities={false}
        />
      </AppHeader>

      <div className="mx-auto grid max-w-6xl gap-4 px-5 py-6 md:px-9">
        <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-2xl font-bold leading-8 text-foreground">
              Money
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Billing readiness, arrears, and Xero - review-first end to end.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={BILLING_REVIEW_HREF} className={horizonActionLinkClass}>
              Reconcile payments
            </Link>
            <Link href={BILLING_REVIEW_HREF} className={horizonPrimaryLinkClass}>
              Run invoices
            </Link>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MoneyMetricCard
            label="THIS MONTH"
            value={invoiceLoading ? "Checking" : formatMoney(metrics.thisMonthCents)}
            detail={
              invoiceLoading ? (
                <SkeletonLine className="h-3 w-44" />
              ) : (
                `${formatCount(metrics.invoiceCount, "invoice")} - all drafted from current data`
              )
            }
          />
          <MoneyMetricCard
            label="COLLECTED"
            value={invoiceLoading ? "Checking" : formatMoney(metrics.collectedCents)}
            progress={metrics.collectionProgress}
            detail={
              invoiceLoading ? (
                <SkeletonLine className="h-3 w-32" />
              ) : (
                `${metrics.collectionProgress}% of month - review payment state`
              )
            }
          />
          <MoneyMetricCard
            label="ARREARS"
            value={arrearsQuery.isLoading ? "Checking" : formatMoney(metrics.arrearsCents)}
            tone="danger"
            detail={
              arrearsQuery.isLoading ? (
                <SkeletonLine className="h-3 w-36" />
              ) : metrics.arrearsCount ? (
                <Link
                  href="/operations?tab=arrears"
                  className="font-semibold text-primary-hover hover:text-primary"
                >
                  {formatCount(metrics.arrearsCount, "tenancy", "tenancies")} -
                  escalation in Work
                </Link>
              ) : (
                "No active arrears cases"
              )
            }
          />
          <MoneyMetricCard label="XERO">
            <div className="mt-3 flex items-center gap-2">
              <CheckCircle2
                size={17}
                className={xeroConnected && !xeroIssueCount ? "text-success" : "text-warning"}
              />
              <p className="text-sm font-semibold text-foreground">
                {xeroStatusQuery.isLoading ? "Checking" : xeroHeadline}
              </p>
            </div>
            <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
              {xeroStatusQuery.isLoading ? "Loading Xero status" : xeroDetail}
            </p>
          </MoneyMetricCard>
        </section>

        <section className={horizonCardClass}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[11px] font-semibold uppercase leading-4 text-muted-foreground">
              INVOICE RUN - READY FOR YOUR APPROVAL
            </h2>
            <div className="flex-1" />
            <StatusBadge tone={metrics.runBlockers ? "warning" : "success"}>
              {runBlockerLabel}
            </StatusBadge>
          </div>

          <div className="mt-3 divide-y divide-leasium-card-border">
            {invoiceLoading ? (
              <>
                <SkeletonLine className="my-3 h-6 w-full" />
                <SkeletonLine className="my-3 h-6 w-11/12" />
                <SkeletonLine className="my-3 h-6 w-10/12" />
              </>
            ) : metrics.invoiceRunRows.length ? (
              metrics.invoiceRunRows.map((row) => (
                <div
                  key={row.id}
                  className="grid gap-2 py-3 text-sm md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText
                      size={16}
                      className="shrink-0 text-muted-foreground"
                    />
                    <p className="min-w-0 truncate font-medium text-foreground">
                      {row.title}
                    </p>
                  </div>
                  <p className="font-semibold text-foreground md:text-right">
                    {formatMoney(row.amountCents)}
                  </p>
                  <p className="text-xs text-muted-foreground md:text-right">
                    {row.delivery}
                  </p>
                </div>
              ))
            ) : (
              <div className="py-4 text-sm text-muted-foreground">
                No invoice drafts are ready yet. Open Billing Readiness to review
                the next rent run.
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 border-t border-leasium-card-border pt-4 md:flex-row md:items-center">
            <p className="flex min-w-0 items-start gap-2 text-sm font-medium text-success-strong">
              <ShieldCheck size={16} className="mt-0.5 shrink-0" />
              <span>
                Drafts only - nothing posts to Xero or sends without you.
              </span>
            </p>
            <div className="flex-1" />
            <Link
              href={BILLING_REVIEW_HREF}
              className={`${horizonPrimaryLinkClass} w-full md:w-auto`}
            >
              Approve run...
            </Link>
          </div>
        </section>

        <section
          aria-label="Finance review routes"
          className="grid gap-3 lg:grid-cols-3"
        >
          {lowerRoutes.map((route) => (
            <Link
              key={route.title}
              href={route.href}
              className="group flex min-h-[132px] flex-col justify-between rounded-[18px] border border-leasium-card-border bg-white p-4 shadow-leasiumXs transition duration-200 ease-leasium hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-leasiumCard motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              <span className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px] bg-primary-soft text-primary">
                  {route.icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">
                    {route.title}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    {route.description}
                  </span>
                </span>
              </span>
              <span className="mt-4 flex items-center justify-between gap-2">
                <StatusBadge tone="neutral">{route.status}</StatusBadge>
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-primary-hover">
                  {route.action}
                  <ArrowUpRight size={14} />
                </span>
              </span>
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}
