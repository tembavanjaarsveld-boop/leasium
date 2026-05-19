"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileClock,
  Gauge,
  LineChart,
  RefreshCw,
  Sparkles,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";

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
  DocumentIntakeRecord,
  listDocumentIntakes,
  listEntities,
  listObligations,
  listProperties,
  listRentRoll,
  listTenantOnboardings,
  listTenants,
  ObligationRecord,
  RentRollRow,
  TenantOnboardingRecord,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const ENTITY_STORAGE_KEY = "leasium.entity_id";

type Tone = "neutral" | "success" | "warning" | "danger" | "primary";

type InsightItem = {
  id: string;
  title: string;
  description: string;
  chip: string;
  tone: Tone;
  href: string;
  source: string;
  rank: number;
};

function friendlyError(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function dateOnly(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "No date";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
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

function dueRank(value: string | null | undefined) {
  if (!value) {
    return 9999;
  }
  const today = new Date(dateOnly(new Date())).getTime();
  const due = new Date(`${value.slice(0, 10)}T00:00:00`).getTime();
  return Math.ceil((due - today) / 86_400_000);
}

function dueChip(value: string | null | undefined) {
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

function blockers(row: RentRollRow) {
  return [
    ...(row.invoice_readiness_blockers ?? []),
    ...(row.xero_readiness_blockers ?? []),
    ...(row.gst_readiness_blockers ?? []),
  ].filter(Boolean);
}

function openObligation(obligation: ObligationRecord) {
  return !["completed", "waived"].includes(obligation.status);
}

function intakeWaiting(intake: DocumentIntakeRecord) {
  return ["uploaded", "reading", "ready_for_review", "needs_attention", "failed"].includes(
    intake.status,
  );
}

function intakeTone(intake: DocumentIntakeRecord): Tone {
  if (intake.status === "failed") {
    return "danger";
  }
  if (intake.status === "needs_attention") {
    return "warning";
  }
  if (intake.status === "ready_for_review") {
    return "primary";
  }
  return "neutral";
}

function onboardingTone(onboarding: TenantOnboardingRecord): Tone {
  if (onboarding.status === "submitted") {
    return "primary";
  }
  if (onboarding.status === "sent" && dueRank(onboarding.due_date) < 0) {
    return "danger";
  }
  if (onboarding.status === "sent") {
    return "warning";
  }
  return "neutral";
}

function labelStatus(value: string | null | undefined) {
  return value ? value.replaceAll("_", " ") : "Check";
}

function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
  icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  tone?: Tone;
  icon: ReactNode;
}) {
  const tones = {
    neutral: "bg-muted text-slate",
    success: "bg-leasium-success-soft text-[#027A48]",
    warning: "bg-leasium-warning-soft text-[#B54708]",
    danger: "bg-leasium-danger-soft text-[#B42318]",
    primary: "bg-leasium-blue-soft text-leasium-blue-hover",
  };
  return (
    <div className="rounded-2xl border border-border bg-white p-4 shadow-leasiumXs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-2xl font-semibold">{value}</div>
          <div className="mt-1 text-sm font-medium">{label}</div>
        </div>
        <div className={cn("rounded-xl p-2", tones[tone])}>{icon}</div>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

function InsightsWorkspace() {
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const asOf = dateOnly(new Date());

  const entitiesQuery = useQuery({
    queryKey: ["entities"],
    queryFn: listEntities,
  });

  const entities = useMemo(() => entitiesQuery.data ?? [], [entitiesQuery.data]);

  useEffect(() => {
    const stored = window.localStorage.getItem(ENTITY_STORAGE_KEY);
    if (stored) {
      setSelectedEntityId(stored);
    }
  }, []);

  useEffect(() => {
    if (!entitiesQuery.isSuccess) {
      return;
    }
    if (!entities.length) {
      if (selectedEntityId) {
        setSelectedEntityId("");
        window.localStorage.removeItem(ENTITY_STORAGE_KEY);
      }
      return;
    }
    if (!selectedEntityId || !entities.some((entity) => entity.id === selectedEntityId)) {
      const firstEntityId = entities[0].id;
      setSelectedEntityId(firstEntityId);
      window.localStorage.setItem(ENTITY_STORAGE_KEY, firstEntityId);
    }
  }, [entities, entitiesQuery.isSuccess, selectedEntityId]);

  const selectedEntity = entities.find((entity) => entity.id === selectedEntityId);
  const activeEntityId = selectedEntity?.id ?? "";
  const enabled = Boolean(activeEntityId);

  const propertiesQuery = useQuery({
    queryKey: ["properties", activeEntityId],
    queryFn: () => listProperties(activeEntityId),
    enabled,
  });
  const tenantsQuery = useQuery({
    queryKey: ["tenants", activeEntityId],
    queryFn: () => listTenants(activeEntityId),
    enabled,
  });
  const obligationsQuery = useQuery({
    queryKey: ["obligations", activeEntityId],
    queryFn: () => listObligations({ entity_id: activeEntityId }),
    enabled,
  });
  const onboardingsQuery = useQuery({
    queryKey: ["tenant-onboardings", activeEntityId],
    queryFn: () => listTenantOnboardings(activeEntityId),
    enabled,
  });
  const intakesQuery = useQuery({
    queryKey: ["document-intakes", activeEntityId],
    queryFn: () => listDocumentIntakes(activeEntityId),
    enabled,
  });
  const rentRollQuery = useQuery({
    queryKey: ["rent-roll", activeEntityId, asOf],
    queryFn: () => listRentRoll({ entity_id: activeEntityId, as_of: asOf }),
    enabled,
  });

  const properties = useMemo(() => propertiesQuery.data ?? [], [propertiesQuery.data]);
  const tenants = useMemo(() => tenantsQuery.data ?? [], [tenantsQuery.data]);
  const obligations = useMemo(() => obligationsQuery.data ?? [], [obligationsQuery.data]);
  const onboardings = useMemo(
    () => onboardingsQuery.data ?? [],
    [onboardingsQuery.data],
  );
  const intakes = useMemo(() => intakesQuery.data ?? [], [intakesQuery.data]);
  const rentRoll = useMemo(() => rentRollQuery.data ?? [], [rentRollQuery.data]);

  const refreshAll = () => {
    void Promise.all([
      entitiesQuery.refetch(),
      propertiesQuery.refetch(),
      tenantsQuery.refetch(),
      obligationsQuery.refetch(),
      onboardingsQuery.refetch(),
      intakesQuery.refetch(),
      rentRollQuery.refetch(),
    ]);
  };

  const isLoading =
    entitiesQuery.isLoading ||
    propertiesQuery.isLoading ||
    tenantsQuery.isLoading ||
    obligationsQuery.isLoading ||
    onboardingsQuery.isLoading ||
    intakesQuery.isLoading ||
    rentRollQuery.isLoading;

  const errors = [
    entitiesQuery.error,
    propertiesQuery.error,
    tenantsQuery.error,
    obligationsQuery.error,
    onboardingsQuery.error,
    intakesQuery.error,
    rentRollQuery.error,
  ].filter(Boolean);

  const openObligations = obligations.filter(openObligation);
  const overdueObligations = openObligations.filter((item) => dueRank(item.due_date) < 0);
  const dueSoonObligations = openObligations.filter((item) => {
    const rank = dueRank(item.due_date);
    return rank >= 0 && rank <= 30;
  });
  const waitingOnTenant = onboardings.filter((item) => item.status === "sent");
  const submittedOnboardings = onboardings.filter((item) => item.status === "submitted");
  const waitingIntakes = intakes.filter(intakeWaiting);
  const blockedRows = rentRoll.filter((row) => blockers(row).length > 0);
  const blockerCount = blockedRows.reduce((total, row) => total + blockers(row).length, 0);
  const readyRows = rentRoll.filter((row) => row.lease_id && blockers(row).length === 0);
  const configuredChargesCents = rentRoll.reduce(
    (total, row) => total + (row.charge_rules_total_cents ?? row.annual_rent_cents ?? 0),
    0,
  );

  const exceptionItems = useMemo<InsightItem[]>(() => {
    const obligationItems = openObligations
      .filter((item) => dueRank(item.due_date) <= 30)
      .map((item) => {
        const rank = dueRank(item.due_date);
        return {
          id: `obligation-${item.id}`,
          title: item.title,
          description: `${labelStatus(item.category)} obligation due ${formatDate(item.due_date)}.`,
          chip: dueChip(item.due_date),
          tone: rank < 0 ? ("danger" as const) : ("warning" as const),
          href: "/tasks",
          source: "Tasks",
          rank,
        };
      });

    const onboardingItems = onboardings
      .filter((item) => ["sent", "submitted"].includes(item.status))
      .map((item) => ({
        id: `onboarding-${item.id}`,
        title:
          item.status === "submitted"
            ? "Tenant onboarding ready for review"
            : "Tenant onboarding waiting",
        description:
          item.status === "submitted"
            ? "Review submitted tenant details and documents before applying."
            : `Follow up the tenant link due ${formatDate(item.due_date)}.`,
        chip: item.status === "submitted" ? "Needs review" : dueChip(item.due_date),
        tone: onboardingTone(item),
        href: "/tenants",
        source: "Tenants",
        rank: item.status === "submitted" ? -2 : dueRank(item.due_date),
      }));

    const intakeItems = intakes.filter(intakeWaiting).map((item) => ({
      id: `intake-${item.id}`,
      title: item.filename,
      description: item.summary || "Smart Intake document is waiting for review.",
      chip: labelStatus(item.status),
      tone: intakeTone(item),
      href: `/intake?review=${item.id}`,
      source: "Lease Inbox",
      rank: item.status === "ready_for_review" ? -1 : 20,
    }));

    const billingItems = blockedRows.map((row) => ({
      id: `billing-${row.tenancy_unit_id}`,
      title: row.tenant_name || row.unit_label,
      description: blockers(row).slice(0, 2).join(" "),
      chip: `${blockers(row).length} blocker${blockers(row).length === 1 ? "" : "s"}`,
      tone: "danger" as const,
      href: "/billing-readiness",
      source: "Billing Readiness",
      rank: 0,
    }));

    return [...obligationItems, ...onboardingItems, ...intakeItems, ...billingItems]
      .sort((left, right) => left.rank - right.rank)
      .slice(0, 8);
  }, [blockedRows, intakes, onboardings, openObligations]);

  const healthCards = [
    {
      label: "Lease Inbox",
      value: waitingIntakes.length,
      detail:
        waitingIntakes.length === 1
          ? "document waiting for review"
          : "documents waiting for review",
      tone: waitingIntakes.length ? ("primary" as const) : ("success" as const),
      href: "/intake",
      icon: <Sparkles size={18} />,
    },
    {
      label: "Tasks",
      value: overdueObligations.length + dueSoonObligations.length,
      detail: "critical dates and obligations in the next 30 days",
      tone: overdueObligations.length ? ("danger" as const) : ("warning" as const),
      href: "/tasks",
      icon: <Clock3 size={18} />,
    },
    {
      label: "Billing Readiness",
      value: blockerCount,
      detail:
        blockerCount === 1
          ? "blocker before invoices are clean"
          : "blockers before invoices are clean",
      tone: blockerCount ? ("danger" as const) : ("success" as const),
      href: "/billing-readiness",
      icon: <Gauge size={18} />,
    },
    {
      label: "Tenant Onboarding",
      value: waitingOnTenant.length + submittedOnboardings.length,
      detail: "tenant setup items waiting or ready for review",
      tone: submittedOnboardings.length ? ("primary" as const) : ("neutral" as const),
      href: "/tenants",
      icon: <UserRound size={18} />,
    },
  ];

  return (
    <main className="min-h-screen">
      <AppHeader>
        <Select
          value={activeEntityId}
          onChange={(event) => {
            setSelectedEntityId(event.target.value);
            if (event.target.value) {
              window.localStorage.setItem(ENTITY_STORAGE_KEY, event.target.value);
            }
          }}
          aria-label="Entity"
          disabled={!entities.length}
        >
          <option value="">Select entity</option>
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))}
        </Select>
      </AppHeader>

      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-5">
        <PageHeader
          title="Insights"
          description={
            selectedEntity
              ? `${selectedEntity.name} portfolio health, exceptions, and automation activity.`
              : "Live dashboards for portfolio health, exceptions, and automation activity."
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/intake"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
              >
                <Sparkles size={15} />
                Open Lease Inbox
              </Link>
              <SecondaryButton
                type="button"
                onClick={refreshAll}
                disabled={!activeEntityId || isLoading}
              >
                <RefreshCw size={15} />
                Refresh
              </SecondaryButton>
            </div>
          }
        />

        {errors.length ? (
          <div className="rounded-2xl border border-danger/20 bg-leasium-danger-soft p-4 text-sm text-danger">
            {friendlyError(errors[0])}
          </div>
        ) : null}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            label="Portfolio"
            value={properties.length}
            detail={`${tenants.length} tenant${tenants.length === 1 ? "" : "s"} under watch.`}
            tone="primary"
            icon={<Activity size={18} />}
          />
          <MetricCard
            label="Ready to bill"
            value={readyRows.length}
            detail={`${blockedRows.length} blocked tenanc${blockedRows.length === 1 ? "y" : "ies"}.`}
            tone={blockedRows.length ? "warning" : "success"}
            icon={<CheckCircle2 size={18} />}
          />
          <MetricCard
            label="Billing blockers"
            value={blockerCount}
            detail="Invoice, Xero, and GST issues found in the rent roll."
            tone={blockerCount ? "danger" : "success"}
            icon={<AlertTriangle size={18} />}
          />
          <MetricCard
            label="Dates to watch"
            value={overdueObligations.length + dueSoonObligations.length}
            detail={`${overdueObligations.length} overdue, ${dueSoonObligations.length} due soon.`}
            tone={overdueObligations.length ? "danger" : "warning"}
            icon={<FileClock size={18} />}
          />
          <MetricCard
            label="Configured charges"
            value={formatMoney(configuredChargesCents)}
            detail="Rent roll value currently visible to Leasium."
            tone="neutral"
            icon={<LineChart size={18} />}
          />
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <SectionPanel
            title="Exception Dashboard"
            description="The highest-signal items across documents, tenants, dates, and billing."
            icon={<Gauge size={17} className="text-primary" />}
            actions={
              activeEntityId ? (
                <StatusBadge tone={exceptionItems.length ? "warning" : "success"}>
                  {exceptionItems.length ? `${exceptionItems.length} active` : "Clear"}
                </StatusBadge>
              ) : null
            }
          >
            <div className="divide-y divide-border">
              {exceptionItems.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="grid gap-3 px-4 py-4 transition hover:bg-muted/60 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-semibold">{item.title}</div>
                      <StatusBadge tone={item.tone}>{item.chip}</StatusBadge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                  <div className="text-xs font-semibold text-muted-foreground">
                    {item.source}
                  </div>
                </Link>
              ))}
              {exceptionItems.length === 0 ? (
                <EmptyState
                  title={activeEntityId ? "No active exceptions" : "Select an entity"}
                  description={
                    activeEntityId
                      ? "Leasium will surface document reviews, overdue dates, onboarding follow-ups, and billing blockers here."
                      : "Choose an entity from the header to load the portfolio dashboard."
                  }
                  action={
                    activeEntityId ? (
                      <div className="flex flex-wrap justify-center gap-2">
                        <Link
                          href="/intake"
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
                        >
                          <Sparkles size={15} />
                          Open Lease Inbox
                        </Link>
                        <Link
                          href="/billing-readiness"
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
                        >
                          <Gauge size={15} />
                          Review billing readiness
                        </Link>
                      </div>
                    ) : null
                  }
                />
              ) : null}
            </div>
          </SectionPanel>

          <SectionPanel
            title="Operational Health"
            description="Fast paths into the dashboards that do the work."
            icon={<Activity size={17} className="text-primary" />}
          >
            <div className="grid gap-3 p-3">
              {healthCards.map((card) => (
                <Link
                  key={card.label}
                  href={card.href}
                  className="rounded-2xl border border-border bg-white p-4 transition hover:border-primary/30 hover:bg-muted/50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{card.label}</div>
                      <div className="mt-2 text-2xl font-semibold">{card.value}</div>
                    </div>
                    <div className="rounded-xl bg-leasium-blue-soft p-2 text-leasium-blue-hover">
                      {card.icon}
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{card.detail}</p>
                  <div className="mt-3">
                    <StatusBadge tone={card.tone}>
                      {card.value ? "Needs attention" : "No blockers"}
                    </StatusBadge>
                  </div>
                </Link>
              ))}
            </div>
          </SectionPanel>
        </div>

        <SectionPanel
          title="Shareable Snapshots"
          description="Live signals stay first. Owner, finance, and lease-event snapshots can come later from the same source of truth."
          icon={<LineChart size={17} className="text-primary" />}
          actions={<StatusBadge tone="neutral">Later</StatusBadge>}
        >
          <div className="grid gap-3 p-4 md:grid-cols-3">
            {[
              "Owner snapshot",
              "Finance pack",
              "Lease event schedule",
            ].map((label) => (
              <div key={label} className="rounded-2xl border border-border bg-muted/40 p-4">
                <div className="text-sm font-semibold">{label}</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Packaged from Insights once the live dashboards are mature.
                </p>
              </div>
            ))}
          </div>
        </SectionPanel>
      </div>
    </main>
  );
}

export default function InsightsPage() {
  return (
    <QueryProvider>
      <InsightsWorkspace />
    </QueryProvider>
  );
}
