"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  ClipboardList,
  FileUp,
  Link2,
  ReceiptText,
  RefreshCw,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { QueryProvider } from "@/components/query-provider";
import {
  EmptyState,
  PageHeader,
  SecondaryButton,
  SectionPanel,
  Select,
  StatusBadge,
} from "@/components/ui";
import {
  listEntities,
  listObligations,
  listProperties,
  listRentRoll,
  listTenantOnboardings,
  listTenants,
  ObligationRecord,
  RentRollRow,
} from "@/lib/api";

const ENTITY_STORAGE_KEY = "leasium.entity_id";
type StatusTone = "neutral" | "success" | "warning" | "danger" | "primary";

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

function friendlyError(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function dueRank(value: string | null | undefined) {
  if (!value) {
    return 9999;
  }
  const today = new Date(dateOnly(new Date())).getTime();
  const due = new Date(`${value.slice(0, 10)}T00:00:00`).getTime();
  return Math.ceil((due - today) / 86_400_000);
}

function dueLabel(value: string | null | undefined) {
  const days = dueRank(value);
  if (days < 0) {
    return `${Math.abs(days)}d overdue`;
  }
  if (days === 0) {
    return "Today";
  }
  if (days === 1) {
    return "Tomorrow";
  }
  if (days < 31) {
    return `In ${days}d`;
  }
  return formatDate(value);
}

function obligationTone(obligation: ObligationRecord): StatusTone {
  const days = dueRank(obligation.due_date);
  if (days < 0) {
    return "danger";
  }
  if (days <= 14 || obligation.priority <= 1) {
    return "warning";
  }
  return "neutral";
}

function blockers(row: RentRollRow) {
  return [
    ...(row.invoice_readiness_blockers ?? []),
    ...(row.xero_readiness_blockers ?? []),
    ...(row.gst_readiness_blockers ?? []),
  ].filter(Boolean);
}

function Dashboard() {
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const asOf = dateOnly(new Date());

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

  const selectedEntity = entitiesQuery.data?.find(
    (entity) => entity.id === selectedEntityId,
  );

  const propertiesQuery = useQuery({
    queryKey: ["dashboard-properties", selectedEntityId],
    queryFn: () => listProperties(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });
  const tenantsQuery = useQuery({
    queryKey: ["dashboard-tenants", selectedEntityId],
    queryFn: () => listTenants(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });
  const obligationsQuery = useQuery({
    queryKey: ["dashboard-obligations", selectedEntityId],
    queryFn: () => listObligations({ entity_id: selectedEntityId }),
    enabled: Boolean(selectedEntityId),
  });
  const rentRollQuery = useQuery({
    queryKey: ["dashboard-rent-roll", selectedEntityId, asOf],
    queryFn: () => listRentRoll({ entity_id: selectedEntityId, as_of: asOf }),
    enabled: Boolean(selectedEntityId),
  });
  const onboardingQuery = useQuery({
    queryKey: ["dashboard-onboarding", selectedEntityId],
    queryFn: () => listTenantOnboardings(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });

  const openObligations = useMemo(
    () =>
      [...(obligationsQuery.data ?? [])]
        .filter((item) => !["completed", "waived"].includes(item.status))
        .sort((a, b) => dueRank(a.due_date) - dueRank(b.due_date)),
    [obligationsQuery.data],
  );

  const urgentObligations = openObligations.filter(
    (item) => dueRank(item.due_date) <= 14 || item.priority <= 1,
  );
  const billingIssues = (rentRollQuery.data ?? [])
    .map((row) => ({ row, blockers: blockers(row) }))
    .filter((item) => item.blockers.length > 0);
  const activeOnboardings = (onboardingQuery.data ?? []).filter(
    (item) => item.status === "sent",
  );
  const submittedOnboardings = (onboardingQuery.data ?? []).filter(
    (item) => item.status === "submitted",
  );

  const upcomingEvents = [
    ...openObligations.slice(0, 5).map((item) => ({
      id: item.id,
      title: item.title,
      meta: item.category.replaceAll("_", " "),
      date: item.due_date,
      tone: obligationTone(item),
    })),
    ...activeOnboardings.slice(0, 3).map((item) => ({
      id: item.id,
      title: "Tenant onboarding due",
      meta: item.status,
      date: item.due_date,
      tone: "primary" as StatusTone,
    })),
  ].sort((a, b) => dueRank(a.date) - dueRank(b.date));

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
          title={selectedEntity?.name ?? "Dashboard"}
          description="Quick adds, attention items, lease events, and operational updates."
          actions={
            <SecondaryButton
              type="button"
              onClick={() => {
                propertiesQuery.refetch();
                tenantsQuery.refetch();
                obligationsQuery.refetch();
                rentRollQuery.refetch();
                onboardingQuery.refetch();
              }}
              disabled={!selectedEntityId}
            >
              <RefreshCw size={15} />
              Refresh
            </SecondaryButton>
          }
        />

        {entitiesQuery.error ? (
          <div className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {friendlyError(entitiesQuery.error)}
          </div>
        ) : null}

        <section className="grid gap-3 md:grid-cols-4">
          <Link
            href="/properties"
            className="rounded-md border border-border bg-white p-4 transition hover:border-primary/40 hover:shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Properties</span>
              <Building2 size={16} className="text-primary" />
            </div>
            <div className="mt-2 text-2xl font-semibold">
              {propertiesQuery.data?.length ?? 0}
            </div>
          </Link>
          <Link
            href="/tenants"
            className="rounded-md border border-border bg-white p-4 transition hover:border-primary/40 hover:shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Tenants</span>
              <UserRound size={16} className="text-primary" />
            </div>
            <div className="mt-2 text-2xl font-semibold">
              {tenantsQuery.data?.length ?? 0}
            </div>
          </Link>
          <Link
            href="/properties"
            className="rounded-md border border-border bg-white p-4 transition hover:border-primary/40 hover:shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Attention</span>
              <AlertTriangle size={16} className="text-accent" />
            </div>
            <div className="mt-2 text-2xl font-semibold">
              {urgentObligations.length}
            </div>
          </Link>
          <Link
            href="/properties"
            className="rounded-md border border-border bg-white p-4 transition hover:border-primary/40 hover:shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Billing blockers</span>
              <ReceiptText size={16} className="text-primary" />
            </div>
            <div className="mt-2 text-2xl font-semibold">
              {billingIssues.length}
            </div>
          </Link>
        </section>

        <section className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="grid gap-5">
            <SectionPanel title="Quick add">
              <div className="grid gap-2 p-4">
                <Link
                  href="/properties"
                  className="inline-flex h-9 items-center justify-start gap-2 rounded-md border border-transparent bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:brightness-95"
                >
                  <FileUp size={16} />
                  Upload lease
                </Link>
                <Link
                  href="/properties"
                  className="inline-flex h-9 items-center justify-start gap-2 rounded-md border border-border bg-white px-3 text-sm font-medium transition hover:bg-muted"
                >
                  <Building2 size={16} />
                  Add property or unit
                </Link>
                <Link
                  href="/tenants"
                  className="inline-flex h-9 items-center justify-start gap-2 rounded-md border border-border bg-white px-3 text-sm font-medium transition hover:bg-muted"
                >
                  <UserRound size={16} />
                  Add tenant
                </Link>
              </div>
            </SectionPanel>

            <SectionPanel title="Onboarding">
              <div className="grid gap-3 p-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Waiting on tenants</span>
                  <span className="font-semibold">{activeOnboardings.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Submitted</span>
                  <span className="font-semibold">{submittedOnboardings.length}</span>
                </div>
                <Link
                  href="/properties"
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-medium transition hover:bg-muted"
                >
                  <Link2 size={15} />
                  Manage links
                </Link>
              </div>
            </SectionPanel>
          </div>

          <div className="grid gap-5">
            <SectionPanel
              title="Needs attention"
              icon={<ClipboardList size={17} className="text-primary" />}
            >
              <div className="divide-y divide-border">
                {urgentObligations.slice(0, 6).map((item) => (
                  <Link
                    href="/properties"
                    key={item.id}
                    className="grid gap-2 px-4 py-3 transition hover:bg-muted/60 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{item.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {item.category.replaceAll("_", " ")}
                      </div>
                    </div>
                    <StatusBadge tone={obligationTone(item)}>
                      {dueLabel(item.due_date)}
                    </StatusBadge>
                  </Link>
                ))}
                {urgentObligations.length === 0 ? (
                  <EmptyState title="No urgent dates right now." />
                ) : null}
              </div>
            </SectionPanel>

            <section className="grid gap-5 xl:grid-cols-2">
              <SectionPanel
                title="Events"
                icon={<CalendarClock size={17} className="text-primary" />}
              >
                <div className="divide-y divide-border">
                  {upcomingEvents.slice(0, 8).map((event) => (
                    <Link
                      href="/properties"
                      key={event.id}
                      className="block px-4 py-3 text-sm transition hover:bg-muted/60"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{event.title}</span>
                        <StatusBadge tone={event.tone}>
                          {dueLabel(event.date)}
                        </StatusBadge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {event.meta}
                      </div>
                    </Link>
                  ))}
                  {upcomingEvents.length === 0 ? (
                    <EmptyState title="No upcoming events for this entity." />
                  ) : null}
                </div>
              </SectionPanel>

              <SectionPanel
                title="Billing updates"
                icon={<ReceiptText size={17} className="text-primary" />}
              >
                <div className="divide-y divide-border">
                  {billingIssues.slice(0, 6).map(({ row, blockers: rowBlockers }) => (
                    <Link
                      href="/properties"
                      key={`${row.property_id}-${row.tenancy_unit_id}`}
                      className="block px-4 py-3 text-sm transition hover:bg-muted/60"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {row.unit_label}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {row.property_name} - {row.tenant_name ?? "Vacant"}
                          </div>
                        </div>
                        <span className="text-xs font-medium">
                          {formatMoney(row.charge_rules_total_cents)}
                        </span>
                      </div>
                      <div className="mt-2 rounded bg-accent/10 px-2 py-1 text-xs">
                        {rowBlockers[0]}
                      </div>
                    </Link>
                  ))}
                  {billingIssues.length === 0 ? (
                    <EmptyState title="No billing readiness blockers." />
                  ) : null}
                </div>
              </SectionPanel>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <QueryProvider>
      <Dashboard />
    </QueryProvider>
  );
}
