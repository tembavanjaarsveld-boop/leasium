"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  FileWarning,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
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
import { listEntities, listRentRoll, type RentRollRow } from "@/lib/api";

const ENTITY_STORAGE_KEY = "leasium.entity_id";
const EMPTY_RENT_ROWS: RentRollRow[] = [];

type BlockerKind = "invoice" | "xero" | "gst";

type BlockerItem = {
  id: string;
  row: RentRollRow;
  kind: BlockerKind;
  message: string;
};

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

function allBlockers(row: RentRollRow) {
  return blockerItems(row).map((item) => item.message);
}

function kindLabel(kind: BlockerKind) {
  switch (kind) {
    case "invoice":
      return "Invoice";
    case "xero":
      return "Xero";
    case "gst":
      return "GST";
  }
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
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [asOf, setAsOf] = useState(() => dateOnly(new Date()));

  const entitiesQuery = useQuery({
    queryKey: ["entities"],
    queryFn: listEntities,
  });

  useEffect(() => {
    const stored = window.localStorage.getItem(ENTITY_STORAGE_KEY);
    const accessibleIds = new Set((entitiesQuery.data ?? []).map((entity) => entity.id));
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

  const selectedEntity = entitiesQuery.data?.find(
    (entity) => entity.id === selectedEntityId,
  );

  const rentRows = rentRollQuery.data ?? EMPTY_RENT_ROWS;
  const blockerRows = useMemo(
    () => rentRows.flatMap((row) => blockerItems(row)),
    [rentRows],
  );
  const rowsWithBlockers = useMemo(
    () => rentRows.filter((row) => allBlockers(row).length > 0),
    [rentRows],
  );

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
                onClick={() => rentRollQuery.refetch()}
                disabled={!selectedEntityId || rentRollQuery.isFetching}
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
                      const blockers = allBlockers(row);
                      return (
                        <tr
                          key={`${row.property_id}-${row.tenancy_unit_id}-${row.lease_id ?? "none"}`}
                          className="border-t border-border align-top"
                        >
                          <td className="px-3 py-3">
                            <div className="font-medium">{row.unit_label}</div>
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
                            <div>{formatMoney(row.charge_rules_total_cents)}</div>
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
                                    key={blocker}
                                    className="rounded bg-leasium-warning-soft px-1.5 py-0.5 text-xs text-[#B54708]"
                                  >
                                    {blocker}
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
              title="Blocker queue"
              description="Prioritised by invoice, Xero, and GST readiness findings."
              icon={<AlertTriangle size={17} className="text-[#B54708]" />}
            >
              {blockerRows.length ? (
                <div className="divide-y divide-border">
                  {blockerRows.map((item) => (
                    <article key={item.id} className="grid gap-2 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium">{item.message}</div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            {item.row.tenant_name ?? "Vacant tenancy"}
                          </div>
                        </div>
                        <StatusBadge tone={kindTone(item.kind)}>
                          {kindLabel(item.kind)}
                        </StatusBadge>
                      </div>
                      <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                        <div>
                          {item.row.property_name} / {item.row.unit_label}
                        </div>
                        <div className="mt-1">{leaseContext(item.row)}</div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No billing blockers"
                  description={
                    rentRows.length
                      ? "Every rent roll row is clear for invoice, Xero, and GST readiness."
                      : "Blockers will appear here once rent roll rows are available."
                  }
                />
              )}
            </SectionPanel>
          </section>
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
