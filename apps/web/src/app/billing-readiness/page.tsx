"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  FileWarning,
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

type BlockerGroup = {
  id: string;
  title: string;
  subtitle: string;
  row: RentRollRow;
  items: BlockerItem[];
};

type BlockerAction = {
  label: string;
  href: string;
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
                      const blockers = blockerItems(row);
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
                                    key={blocker.id}
                                    className="rounded bg-leasium-warning-soft px-1.5 py-0.5 text-xs text-[#B54708]"
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
              title="Billing action queue"
              description="Prioritised work with the right record to open next."
              icon={<AlertTriangle size={17} className="text-[#B54708]" />}
            >
              {blockerGroups.length ? (
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
                          {group.items.length} blocker{group.items.length === 1 ? "" : "s"}
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
                                  {item.row.unit_label} / {item.row.property_name}
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {blockerGuidance(item)}
                                </div>
                              </div>
                              <Link
                                href={action.href}
                                className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border-strong bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
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
