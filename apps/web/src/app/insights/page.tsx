"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  Copy,
  Clock3,
  ExternalLink,
  Gauge,
  LineChart,
  Loader2,
  RefreshCw,
  Share2,
  ShieldCheck,
  Sparkles,
  TableProperties,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { QueryProvider } from "@/components/query-provider";
import {
  Button,
  EmptyState,
  Field,
  PageHeader,
  SecondaryButton,
  SectionPanel,
  Select,
  StatusBadge,
} from "@/components/ui";
import {
  AutomationActivityRecord,
  createInsightsSnapshot,
  getInsightsOverview,
  InsightsOverviewRecord,
  InsightsSnapshotCreateRecord,
  InsightsSnapshotRecord,
  InsightsSnapshotType,
  listEntities,
  listInsightsSnapshots,
  LiveExceptionRecord,
  revokeInsightsSnapshot,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const ENTITY_STORAGE_KEY = "leasium.entity_id";

type Tone = "neutral" | "success" | "warning" | "danger" | "primary";
type AccountingReadinessView = NonNullable<
  InsightsOverviewRecord["finance_snapshot"]["accounting_readiness"]
> & {
  generated_at?: string | null;
  source?: string | null;
  source_label?: string | null;
  generated_source?: string | null;
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

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Never";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
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

function labelStatus(value: string | null | undefined) {
  return value ? value.replaceAll("_", " ") : "None";
}

function accountingTone(status: string | null | undefined) {
  if (status === "ready") {
    return "success" as const;
  }
  if (status === "stale" || status === "attention") {
    return "warning" as const;
  }
  if (status === "missing") {
    return "danger" as const;
  }
  return "neutral" as const;
}

function accountingCheckpointRows(accounting: AccountingReadinessView) {
  return [
    ["Posting preview", accounting.last_invoice_posting_preview_at],
    ["Draft created", accounting.last_invoice_draft_create_at],
    ["Provider dispatch", accounting.last_invoice_provider_dispatch_at],
    ["Payment preview", accounting.last_payment_reconciliation_preview_at],
    ["Payment apply", accounting.last_payment_reconciliation_apply_at],
  ] as const;
}

function accountingSourceLabel(accounting: AccountingReadinessView) {
  const source =
    accounting.source_label ?? accounting.source ?? accounting.generated_source;
  return source ? labelStatus(source) : "Live accounting";
}

function AccountingReadinessTrail({
  accounting,
}: {
  accounting: AccountingReadinessView;
}) {
  const staleLabel =
    accounting.stale_reconciliation && accounting.stale_after_days
      ? `Stale after ${accounting.stale_after_days} days`
      : accounting.stale_reconciliation
        ? "Reconciliation stale"
        : "Reconciliation current";
  const sourceGeneratedAt =
    accounting.generated_at ?? accounting.last_chart_tax_validation_at;

  return (
    <div className="grid gap-3 border-t border-border p-3 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="rounded-2xl border border-border bg-white p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold">Accounting readiness</div>
            <p className="mt-1 text-muted-foreground">{accounting.summary}</p>
          </div>
          <StatusBadge tone={accountingTone(accounting.status)}>
            {labelStatus(accounting.status)}
          </StatusBadge>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {accountingCheckpointRows(accounting).map(([checkpoint, value]) => (
            <div
              key={checkpoint}
              className="rounded-xl border border-border bg-muted/35 p-3"
            >
              <div className="text-xs font-semibold uppercase text-muted-foreground">
                {checkpoint}
              </div>
              <div className="mt-1 font-medium">{formatDateTime(value)}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border border-border bg-muted/35 px-2.5 py-1">
            Source {accountingSourceLabel(accounting)}
          </span>
          <span className="rounded-full border border-border bg-muted/35 px-2.5 py-1">
            Checked {formatDateTime(sourceGeneratedAt)}
          </span>
          <span className="rounded-full border border-border bg-muted/35 px-2.5 py-1">
            {staleLabel}
          </span>
          {accounting.last_payment_reconciliation_source ? (
            <span className="rounded-full border border-border bg-muted/35 px-2.5 py-1">
              Payment source{" "}
              {labelStatus(accounting.last_payment_reconciliation_source)}
            </span>
          ) : null}
          {accounting.last_payment_reconciliation_mode ? (
            <span className="rounded-full border border-border bg-muted/35 px-2.5 py-1">
              Payment mode {labelStatus(accounting.last_payment_reconciliation_mode)}
            </span>
          ) : null}
        </div>
        <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
          <span>
            Chart {accounting.chart_ready} ready / {accounting.chart_missing} missing
          </span>
          <span>
            Tax {accounting.tax_ready} ready / {accounting.tax_missing} missing
          </span>
          <span>
            Open in Xero {accounting.xero_linked_open_invoice_count}
          </span>
        </div>
      </div>
      <div className="rounded-2xl border border-border bg-muted/35 p-4 text-sm">
        <div className="font-semibold">Guardrails</div>
        <div className="mt-3 grid gap-2 text-muted-foreground">
          {accounting.guardrails.map((guardrail) => (
            <div key={guardrail} className="flex items-start gap-2">
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-primary" />
              <span>{guardrail}</span>
            </div>
          ))}
          {!accounting.guardrails.length ? (
            <div>No extra guardrails flagged.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function plural(value: number, singular: string, pluralLabel = `${singular}s`) {
  return value === 1 ? singular : pluralLabel;
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

function CountPill({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-border bg-muted/40 p-3">
      <div className="text-xs font-semibold uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function ExceptionRow({ item }: { item: LiveExceptionRecord }) {
  return (
    <Link
      href={item.href}
      className="grid gap-3 px-4 py-4 transition hover:bg-muted/60 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-semibold">{item.title}</div>
          <StatusBadge tone={item.severity}>{item.chip}</StatusBadge>
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
          {item.detail}
        </p>
      </div>
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <span>{item.source}</span>
        {item.due_date ? <span>{formatDate(item.due_date)}</span> : null}
      </div>
    </Link>
  );
}

function ActivityRow({ item }: { item: AutomationActivityRecord }) {
  const tone: Tone = item.outcome === "success" ? "success" : "warning";
  return (
    <div className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-semibold">{item.label}</div>
          <StatusBadge tone={tone}>{labelStatus(item.outcome)}</StatusBadge>
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
          {item.detail || item.source}
        </p>
      </div>
      <div className="text-xs font-semibold text-muted-foreground">
        {formatDateTime(item.occurred_at)}
      </div>
    </div>
  );
}

function ownershipLabel(value: string) {
  const labels: Record<string, string> = {
    current_entity: "Current entity",
    property_owner: "Property owner",
    trust: "Trust",
    split: "Split ownership",
  };
  return labels[value] ?? labelStatus(value);
}

function snapshotTypeLabel(value: InsightsSnapshotType) {
  const labels: Record<InsightsSnapshotType, string> = {
    owner: "Owner snapshot",
    finance: "Finance snapshot",
    lease_events: "Lease events",
  };
  return labels[value];
}

function snapshotTypeDescription(value: InsightsSnapshotType) {
  const descriptions: Record<InsightsSnapshotType, string> = {
    owner: "Ownership, billing identity, GST, and Xero readiness.",
    finance: "Billing readiness, draft status, unpaid invoices, and Xero sync risk.",
    lease_events: "Rent reviews, expiries, obligations, and onboarding follow-ups.",
  };
  return descriptions[value];
}

function eventKindLabel(value: string) {
  const labels: Record<string, string> = {
    rent_review: "Rent review",
    lease_expiry: "Lease expiry",
    obligation: "Obligation",
    tenant_onboarding: "Tenant onboarding",
  };
  return labels[value] ?? labelStatus(value);
}

function SnapshotShareLink({
  snapshot,
  copied,
  onCopy,
}: {
  snapshot: InsightsSnapshotCreateRecord;
  copied: boolean;
  onCopy: (value: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Snapshot link ready</div>
          <p className="mt-1 text-sm text-muted-foreground">
            This link is shown once. It expires {formatDateTime(snapshot.expires_at)}.
          </p>
        </div>
        <StatusBadge tone="primary">{snapshotTypeLabel(snapshot.snapshot_type)}</StatusBadge>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SecondaryButton type="button" onClick={() => onCopy(snapshot.share_url)}>
          <Copy size={15} />
          {copied ? "Copied" : "Copy link"}
        </SecondaryButton>
        <Link
          href={snapshot.share_url}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
        >
          <ExternalLink size={15} />
          Open snapshot
        </Link>
      </div>
    </div>
  );
}

function SnapshotHistoryRow({
  snapshot,
  onRevoke,
  revoking,
}: {
  snapshot: InsightsSnapshotRecord;
  onRevoke: (snapshotId: string) => void;
  revoking: boolean;
}) {
  const expired = snapshot.expires_at
    ? new Date(snapshot.expires_at).getTime() < Date.now()
    : false;
  const inactive = Boolean(snapshot.revoked_at) || expired;
  return (
    <div className="grid gap-3 border-t border-border px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-semibold">{snapshotTypeLabel(snapshot.snapshot_type)}</div>
          <StatusBadge tone={inactive ? "neutral" : "success"}>
            {snapshot.revoked_at ? "Revoked" : expired ? "Expired" : "Active"}
          </StatusBadge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          As at {formatDate(snapshot.as_of)}. Expires {formatDateTime(snapshot.expires_at)}.
        </p>
      </div>
      {!inactive ? (
        <SecondaryButton
          type="button"
          onClick={() => onRevoke(snapshot.id)}
          disabled={revoking}
        >
          {revoking ? <Loader2 size={15} className="animate-spin" /> : null}
          Revoke
        </SecondaryButton>
      ) : null}
    </div>
  );
}

function InsightsWorkspace() {
  const queryClient = useQueryClient();
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [snapshotType, setSnapshotType] = useState<InsightsSnapshotType>("owner");
  const [latestSnapshot, setLatestSnapshot] =
    useState<InsightsSnapshotCreateRecord | null>(null);
  const [copiedSnapshotId, setCopiedSnapshotId] = useState<string | null>(null);
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

  const overviewQuery = useQuery({
    queryKey: ["insights-overview", activeEntityId, asOf],
    queryFn: () => getInsightsOverview(activeEntityId, asOf),
    enabled: Boolean(activeEntityId),
  });

  const snapshotsQuery = useQuery({
    queryKey: ["insights-snapshots", activeEntityId],
    queryFn: () => listInsightsSnapshots(activeEntityId),
    enabled: Boolean(activeEntityId),
  });

  const createSnapshotMutation = useMutation({
    mutationFn: () =>
      createInsightsSnapshot({
        entity_id: activeEntityId,
        snapshot_type: snapshotType,
        as_of: asOf,
        expires_in_days: 30,
      }),
    onSuccess: (snapshot) => {
      setLatestSnapshot(snapshot);
      setCopiedSnapshotId(null);
      void queryClient.invalidateQueries({
        queryKey: ["insights-snapshots", activeEntityId],
      });
    },
  });

  const revokeSnapshotMutation = useMutation({
    mutationFn: revokeInsightsSnapshot,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["insights-snapshots", activeEntityId],
      });
    },
  });

  const overview = overviewQuery.data;
  const entityError = entitiesQuery.error;
  const overviewError = overviewQuery.error;
  const isOverviewLoading =
    Boolean(activeEntityId) &&
    !overview &&
    (overviewQuery.isLoading || overviewQuery.isFetching);
  const isOverviewFetching = Boolean(activeEntityId) && overviewQuery.isFetching;
  const showOverviewEmpty =
    Boolean(activeEntityId) && overviewQuery.isSuccess && !overview;

  const health = overview?.portfolio_health;
  const billing = overview?.billing_risk;
  const ownerSnapshot = overview?.owner_entity_snapshot;
  const financeSnapshot = overview?.finance_snapshot;
  const accountingReadiness = financeSnapshot?.accounting_readiness;
  const leaseEventSnapshot = overview?.lease_event_snapshot;
  const snapshots = snapshotsQuery.data ?? [];

  async function copySnapshotLink(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      window.prompt("Copy snapshot link", value);
    }
    setCopiedSnapshotId(latestSnapshot?.id ?? "snapshot-link");
  }

  const metricCards = overview
    ? [
        {
          label: "Portfolio",
          value: health?.property_count ?? 0,
          detail: `${health?.tenant_count ?? 0} ${plural(
            health?.tenant_count ?? 0,
            "tenant",
          )}, ${health?.unit_count ?? 0} ${plural(health?.unit_count ?? 0, "unit")}.`,
          tone: "primary" as const,
          icon: <Building2 size={18} />,
        },
        {
          label: "Active Leases",
          value: health?.active_lease_count ?? 0,
          detail: `${health?.vacant_unit_count ?? 0} ${plural(
            health?.vacant_unit_count ?? 0,
            "vacant unit",
          )} visible today.`,
          tone: health?.vacant_unit_count ? ("warning" as const) : ("success" as const),
          icon: <UserRound size={18} />,
        },
        {
          label: "Live Exceptions",
          value: overview.live_exceptions.length,
          detail: "Documents, dates, onboarding, billing, and Xero readiness.",
          tone: overview.live_exceptions.length ? ("danger" as const) : ("success" as const),
          icon: <AlertTriangle size={18} />,
        },
        {
          label: "Ready To Bill",
          value: billing?.ready_to_bill_count ?? 0,
          detail: `${billing?.blocked_row_count ?? 0} blocked ${
            billing?.blocked_row_count === 1 ? "tenancy" : "tenancies"
          }.`,
          tone: billing?.blocked_row_count ? ("warning" as const) : ("success" as const),
          icon: <CheckCircle2 size={18} />,
        },
        {
          label: "Configured Charges",
          value: formatMoney(billing?.configured_charges_cents ?? 0),
          detail: "Rent roll value currently visible to Leasium.",
          tone: "neutral" as const,
          icon: <LineChart size={18} />,
        },
      ]
    : [];

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
            overview
              ? `${overview.entity.name} live portfolio, exception, billing, and owner/entity view.`
              : "Live portfolio, exception, billing, and owner/entity view."
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/intake"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
              >
                <Sparkles size={15} />
                Smart Intake
              </Link>
              <Link
                href="/portfolio-qa"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
              >
                <TableProperties size={15} />
                Portfolio QA
              </Link>
              <SecondaryButton
                type="button"
                onClick={() => void overviewQuery.refetch()}
                disabled={!activeEntityId || isOverviewFetching}
              >
                {isOverviewFetching ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <RefreshCw size={15} />
                )}
                {isOverviewFetching ? "Refreshing" : "Refresh"}
              </SecondaryButton>
            </div>
          }
        />

        {entityError ? (
          <div className="rounded-2xl border border-danger/20 bg-leasium-danger-soft p-4 text-sm text-danger">
            {friendlyError(entityError)}
          </div>
        ) : null}

        {overviewError && activeEntityId && !overview ? (
          <SectionPanel>
            <EmptyState
              title="Insights could not load"
              description={friendlyError(overviewError)}
              action={
                <SecondaryButton
                  type="button"
                  onClick={() => void overviewQuery.refetch()}
                >
                  <RefreshCw size={15} />
                  Retry
                </SecondaryButton>
              }
            />
          </SectionPanel>
        ) : null}

        {!activeEntityId ? (
          <SectionPanel>
            <EmptyState
              title="Select an entity"
              description="Insights will load once an entity is selected."
            />
          </SectionPanel>
        ) : null}

        {isOverviewLoading ? (
          <SectionPanel
            title="Loading live insights"
            description="Preparing the latest portfolio, exception, billing, and owner/entity view."
            icon={<Loader2 size={17} className="animate-spin text-primary" />}
            actions={<StatusBadge tone="neutral">Loading</StatusBadge>}
            className="border-primary/20 bg-primary/5"
          >
            <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
              {[
                "Portfolio",
                "Active leases",
                "Live exceptions",
                "Ready to bill",
                "Configured charges",
              ].map((label) => (
                <div
                  key={label}
                  className="rounded-2xl border border-border bg-white p-4 text-sm text-muted-foreground"
                >
                  <div className="h-6 w-16 rounded bg-muted" />
                  <div className="mt-3 font-semibold text-foreground">
                    {label}
                  </div>
                  <div className="mt-2 h-4 w-full rounded bg-muted" />
                </div>
              ))}
            </div>
          </SectionPanel>
        ) : null}

        {showOverviewEmpty ? (
          <SectionPanel>
            <EmptyState
              title="No insights available"
              description="There is no overview data for this entity yet."
            />
          </SectionPanel>
        ) : null}

        {overview ? (
          <>
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {metricCards.map((card) => (
                <MetricCard key={card.label} {...card} />
              ))}
            </section>

            <SectionPanel
              title="Shareable Snapshots"
              description="Freeze the current owner, finance, or lease-event view into a revocable link."
              icon={<Share2 size={17} className="text-primary" />}
              actions={<StatusBadge tone="neutral">{snapshots.length} saved</StatusBadge>}
            >
              <div className="grid gap-4 p-4 lg:grid-cols-[280px_minmax(0,1fr)]">
                <div className="grid content-start gap-3">
                  <Field label="Snapshot type">
                    <Select
                      value={snapshotType}
                      onChange={(event) =>
                        setSnapshotType(event.target.value as InsightsSnapshotType)
                      }
                    >
                      <option value="owner">Owner snapshot</option>
                      <option value="finance">Finance snapshot</option>
                      <option value="lease_events">Lease events</option>
                    </Select>
                  </Field>
                  <p className="text-sm text-muted-foreground">
                    {snapshotTypeDescription(snapshotType)}
                  </p>
                  <Button
                    type="button"
                    onClick={() => createSnapshotMutation.mutate()}
                    disabled={!activeEntityId || createSnapshotMutation.isPending}
                  >
                    {createSnapshotMutation.isPending ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Share2 size={15} />
                    )}
                    Generate link
                  </Button>
                  {createSnapshotMutation.error ? (
                    <div className="rounded-xl border border-danger/20 bg-leasium-danger-soft p-3 text-sm text-danger">
                      {friendlyError(createSnapshotMutation.error)}
                    </div>
                  ) : null}
                </div>
                <div className="grid gap-3">
                  {latestSnapshot ? (
                    <SnapshotShareLink
                      snapshot={latestSnapshot}
                      copied={copiedSnapshotId === latestSnapshot.id}
                      onCopy={copySnapshotLink}
                    />
                  ) : (
                    <div className="rounded-2xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                      Generated links appear here once. Existing links can be revoked
                      from the history below.
                    </div>
                  )}
                  <div className="overflow-hidden rounded-2xl border border-border bg-white">
                    <div className="px-4 py-3 text-sm font-semibold">Snapshot history</div>
                    {snapshots.map((snapshot) => (
                      <SnapshotHistoryRow
                        key={snapshot.id}
                        snapshot={snapshot}
                        onRevoke={(snapshotId) => revokeSnapshotMutation.mutate(snapshotId)}
                        revoking={
                          revokeSnapshotMutation.isPending &&
                          revokeSnapshotMutation.variables === snapshot.id
                        }
                      />
                    ))}
                    {!snapshots.length ? (
                      <div className="border-t border-border px-4 py-4 text-sm text-muted-foreground">
                        No snapshots have been generated for this entity yet.
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </SectionPanel>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
              <SectionPanel
                title="Live Exceptions"
                description="The highest-signal items across documents, tenants, dates, billing, and Xero."
                icon={<Gauge size={17} className="text-primary" />}
                actions={
                  <StatusBadge tone={overview.live_exceptions.length ? "warning" : "success"}>
                    {overview.live_exceptions.length
                      ? `${overview.live_exceptions.length} active`
                      : "Clear"}
                  </StatusBadge>
                }
              >
                <div className="divide-y divide-border">
                  {overview.live_exceptions.map((item) => (
                    <ExceptionRow key={item.id} item={item} />
                  ))}
                  {overview.live_exceptions.length === 0 ? (
                    <EmptyState
                      title="No active exceptions"
                      description="Documents, overdue dates, onboarding follow-ups, and billing blockers will appear here."
                    />
                  ) : null}
                </div>
              </SectionPanel>

              <SectionPanel
                title="Billing Risk"
                description="Readiness signals from invoice, GST, Xero, and payment status."
                icon={<AlertTriangle size={17} className="text-primary" />}
              >
                <div className="grid gap-3 p-3">
                  <CountPill label="Readiness blockers" value={billing?.blocker_count ?? 0} />
                  <CountPill label="Xero issues" value={billing?.xero_issue_count ?? 0} />
                  <CountPill
                    label="Approved not synced"
                    value={billing?.approved_unsynced_invoice_count ?? 0}
                  />
                  <CountPill label="Unpaid invoices" value={billing?.unpaid_invoice_count ?? 0} />
                  <div className="rounded-2xl border border-border bg-white p-4">
                    <div className="text-sm font-semibold">Draft status</div>
                    <div className="mt-3 grid gap-2 text-sm text-muted-foreground">
                      {Object.entries(billing?.billing_draft_counts ?? {}).map(
                        ([status, count]) => (
                          <div key={status} className="flex items-center justify-between gap-3">
                            <span>{labelStatus(status)}</span>
                            <span className="font-semibold text-foreground">{count}</span>
                          </div>
                        ),
                      )}
                      {Object.keys(billing?.billing_draft_counts ?? {}).length === 0 ? (
                        <div>No billing drafts yet</div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </SectionPanel>
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
              <SectionPanel
                title="Finance Snapshot"
                description="A share-ready summary of billing readiness and draft invoice risk."
                icon={<LineChart size={17} className="text-primary" />}
                actions={
                  accountingReadiness ? (
                    <StatusBadge tone={accountingTone(accountingReadiness.status)}>
                      Accounting {labelStatus(accountingReadiness.status)}
                    </StatusBadge>
                  ) : null
                }
              >
                <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
                  <CountPill
                    label="Configured charges"
                    value={formatMoney(financeSnapshot?.configured_charges_cents ?? 0)}
                  />
                  <CountPill
                    label="Ready to bill"
                    value={financeSnapshot?.ready_to_bill_count ?? 0}
                  />
                  <CountPill
                    label="Blocked rows"
                    value={financeSnapshot?.blocked_row_count ?? 0}
                  />
                  <CountPill
                    label="Approved not synced"
                    value={financeSnapshot?.approved_unsynced_invoice_count ?? 0}
                  />
                  <CountPill
                    label="Unpaid invoices"
                    value={financeSnapshot?.unpaid_invoice_count ?? 0}
                  />
                  <CountPill
                    label="Contacts ready"
                    value={`${accountingReadiness?.contact_ready ?? 0} / ${
                      (accountingReadiness?.contact_ready ?? 0) +
                      (accountingReadiness?.contact_missing ?? 0)
                    }`}
                  />
                </div>
                {accountingReadiness ? (
                  <AccountingReadinessTrail accounting={accountingReadiness} />
                ) : null}
              </SectionPanel>

              <SectionPanel
                title="Lease Events"
                description="Upcoming reviews, expiries, obligations, and onboarding follow-ups."
                icon={<Clock3 size={17} className="text-primary" />}
                actions={
                  <StatusBadge tone={leaseEventSnapshot?.next_events.length ? "warning" : "success"}>
                    {leaseEventSnapshot?.next_events.length ?? 0} upcoming
                  </StatusBadge>
                }
              >
                <div className="divide-y divide-border">
                  {(leaseEventSnapshot?.next_events ?? []).map((event) => (
                    <Link
                      key={event.id}
                      href={event.href}
                      className="grid gap-2 px-4 py-3 transition hover:bg-muted/60"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-semibold">{event.title}</div>
                        <StatusBadge tone="primary">{eventKindLabel(event.kind)}</StatusBadge>
                        <StatusBadge tone="neutral">{event.chip}</StatusBadge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {formatDate(event.date)}
                      </div>
                    </Link>
                  ))}
                  {(leaseEventSnapshot?.next_events.length ?? 0) === 0 ? (
                    <EmptyState
                      title="No upcoming lease events"
                      description="Rent reviews, expiries, obligations, and onboarding follow-ups will appear here."
                    />
                  ) : null}
                </div>
              </SectionPanel>
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
              <SectionPanel
                title="Automation Activity"
                description="Recent review, apply, readiness, and delivery events from the audit trail."
                icon={<Activity size={17} className="text-primary" />}
                actions={
                  <StatusBadge tone={overview.automation_activity.length ? "primary" : "neutral"}>
                    {overview.automation_activity.length} recent
                  </StatusBadge>
                }
              >
                <div className="divide-y divide-border">
                  {overview.automation_activity.map((item) => (
                    <ActivityRow key={item.id} item={item} />
                  ))}
                  {overview.automation_activity.length === 0 ? (
                    <EmptyState
                      title="No recent activity"
                      description="Review and apply events will appear once work starts on this entity."
                    />
                  ) : null}
                </div>
              </SectionPanel>

              <SectionPanel
                title="Owner / Entity Snapshot"
                description="Billing identity, ownership, GST, and Xero setup at a glance."
                icon={<ShieldCheck size={17} className="text-primary" />}
                actions={
                  <StatusBadge tone={ownerSnapshot?.xero_connected ? "success" : "warning"}>
                    {ownerSnapshot?.xero_connected ? "Xero connected" : "Xero not connected"}
                  </StatusBadge>
                }
              >
                <div className="grid gap-3 p-3">
                  <div className="grid gap-2">
                    {Object.entries(ownerSnapshot?.ownership_profile_counts ?? {}).map(
                      ([profile, count]) => (
                        <div
                          key={profile}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-muted/40 px-3 py-2 text-sm"
                        >
                          <span>{ownershipLabel(profile)}</span>
                          <span className="font-semibold">{count}</span>
                        </div>
                      ),
                    )}
                    {Object.keys(ownerSnapshot?.ownership_profile_counts ?? {}).length === 0 ? (
                      <div className="rounded-2xl border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                        No ownership profiles yet
                      </div>
                    ) : null}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <CountPill
                      label="Missing issuer"
                      value={ownerSnapshot?.missing_invoice_issuer_count ?? 0}
                    />
                    <CountPill
                      label="Missing ABN"
                      value={ownerSnapshot?.missing_owner_abn_count ?? 0}
                    />
                    <CountPill
                      label="Missing trustee"
                      value={ownerSnapshot?.missing_trustee_count ?? 0}
                    />
                    <CountPill
                      label="Missing Xero contact"
                      value={ownerSnapshot?.missing_xero_contact_count ?? 0}
                    />
                  </div>
                  <div className="rounded-2xl border border-border bg-white p-4 text-sm text-muted-foreground">
                    <div className="flex items-center justify-between gap-3">
                      <span>Entity GST</span>
                      <StatusBadge tone={ownerSnapshot?.entity_gst_registered ? "success" : "warning"}>
                        {ownerSnapshot?.entity_gst_registered ? "Registered" : "Not registered"}
                      </StatusBadge>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span>Xero last sync</span>
                      <span className="font-semibold text-foreground">
                        {formatDateTime(ownerSnapshot?.xero_last_sync_at)}
                      </span>
                    </div>
                  </div>
                </div>
              </SectionPanel>
            </div>

            <SectionPanel
              title="Controls"
              description="Insights stays read-only; the linked workspaces handle review and apply steps."
              icon={<Clock3 size={17} className="text-primary" />}
            >
              <div className="flex flex-wrap gap-2 p-4">
                {[
                  ["Smart Intake", "/intake"],
                  ["Portfolio QA", "/portfolio-qa"],
                  ["Operations", "/operations"],
                  ["Billing Readiness", "/billing-readiness"],
                  ["Properties", "/properties"],
                  ["Xero Settings", "/settings"],
                ].map(([label, href]) => (
                  <Link
                    key={href}
                    href={href}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
                  >
                    {label}
                  </Link>
                ))}
              </div>
            </SectionPanel>
          </>
        ) : null}
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
