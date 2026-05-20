"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  Clock3,
  FileText,
  LineChart,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { LeasiumMark } from "@/components/brand";
import { QueryProvider } from "@/components/query-provider";
import { EmptyState, SectionPanel, StatusBadge } from "@/components/ui";
import {
  getPublicInsightsSnapshot,
  InsightsSnapshotPublicRecord,
  InsightsSnapshotType,
} from "@/lib/api";

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
    year: "numeric",
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

function snapshotTypeLabel(value: InsightsSnapshotType) {
  const labels: Record<InsightsSnapshotType, string> = {
    owner: "Owner snapshot",
    finance: "Finance snapshot",
    lease_events: "Lease events",
  };
  return labels[value];
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

function eventKindLabel(value: string) {
  const labels: Record<string, string> = {
    rent_review: "Rent review",
    lease_expiry: "Lease expiry",
    obligation: "Obligation",
    tenant_onboarding: "Tenant onboarding",
  };
  return labels[value] ?? labelStatus(value);
}

function CountTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-border bg-muted/40 p-3">
      <div className="text-xs font-semibold uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function OwnerSnapshot({ snapshot }: { snapshot: InsightsSnapshotPublicRecord }) {
  const owner = snapshot.payload.owner_entity_snapshot;
  return (
    <SectionPanel
      title="Owner / Entity Snapshot"
      description="Billing identity, ownership, GST, and Xero setup."
      icon={<ShieldCheck size={17} className="text-primary" />}
      actions={
        <StatusBadge tone={owner.xero_connected ? "success" : "warning"}>
          {owner.xero_connected ? "Xero connected" : "Xero not connected"}
        </StatusBadge>
      }
    >
      <div className="grid gap-3 p-4 md:grid-cols-2">
        {Object.entries(owner.ownership_profile_counts).map(([profile, count]) => (
          <CountTile key={profile} label={ownershipLabel(profile)} value={count} />
        ))}
        <CountTile label="Missing issuer" value={owner.missing_invoice_issuer_count} />
        <CountTile label="Missing ABN" value={owner.missing_owner_abn_count} />
        <CountTile label="Missing trustee" value={owner.missing_trustee_count} />
        <CountTile label="Missing Xero contact" value={owner.missing_xero_contact_count} />
        <CountTile
          label="Entity GST"
          value={owner.entity_gst_registered ? "Registered" : "Not registered"}
        />
        <CountTile label="Xero last sync" value={formatDateTime(owner.xero_last_sync_at)} />
      </div>
    </SectionPanel>
  );
}

function FinanceSnapshot({ snapshot }: { snapshot: InsightsSnapshotPublicRecord }) {
  const finance = snapshot.payload.finance_snapshot;
  return (
    <SectionPanel
      title="Finance Snapshot"
      description="Billing readiness, invoice draft, payment, and Xero sync risk."
      icon={<LineChart size={17} className="text-primary" />}
    >
      <div className="grid gap-3 p-4 md:grid-cols-2 lg:grid-cols-3">
        <CountTile
          label="Configured charges"
          value={formatMoney(finance.configured_charges_cents)}
        />
        <CountTile label="Ready to bill" value={finance.ready_to_bill_count} />
        <CountTile label="Blocked rows" value={finance.blocked_row_count} />
        <CountTile
          label="Approved not synced"
          value={finance.approved_unsynced_invoice_count}
        />
        <CountTile label="Unpaid invoices" value={finance.unpaid_invoice_count} />
      </div>
    </SectionPanel>
  );
}

function LeaseEventsSnapshot({ snapshot }: { snapshot: InsightsSnapshotPublicRecord }) {
  const leaseEvents = snapshot.payload.lease_event_snapshot;
  return (
    <SectionPanel
      title="Lease Events"
      description="Upcoming rent reviews, expiries, obligations, and onboarding follow-ups."
      icon={<Clock3 size={17} className="text-primary" />}
      actions={<StatusBadge tone="primary">{leaseEvents.next_events.length} events</StatusBadge>}
    >
      <div className="grid gap-3 p-4 md:grid-cols-3">
        <CountTile label="Active leases" value={leaseEvents.active_lease_count} />
        <CountTile label="Rent reviews" value={leaseEvents.next_review_count} />
        <CountTile label="Lease expiries" value={leaseEvents.next_expiry_count} />
      </div>
      <div className="divide-y divide-border border-t border-border">
        {leaseEvents.next_events.map((event) => (
          <div key={event.id} className="grid gap-2 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="font-semibold">{event.title}</div>
              <StatusBadge tone="primary">{eventKindLabel(event.kind)}</StatusBadge>
              <StatusBadge tone="neutral">{event.chip}</StatusBadge>
            </div>
            <div className="text-sm text-muted-foreground">{formatDate(event.date)}</div>
          </div>
        ))}
        {!leaseEvents.next_events.length ? (
          <EmptyState
            title="No upcoming lease events"
            description="No review, expiry, obligation, or onboarding events were captured in this snapshot."
          />
        ) : null}
      </div>
    </SectionPanel>
  );
}

function SnapshotBody({ snapshot }: { snapshot: InsightsSnapshotPublicRecord }) {
  if (snapshot.snapshot_type === "finance") {
    return <FinanceSnapshot snapshot={snapshot} />;
  }
  if (snapshot.snapshot_type === "lease_events") {
    return <LeaseEventsSnapshot snapshot={snapshot} />;
  }
  return <OwnerSnapshot snapshot={snapshot} />;
}

function PublicSnapshotContent() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const snapshotQuery = useQuery({
    queryKey: ["public-insights-snapshot", token],
    queryFn: () => getPublicInsightsSnapshot(token),
    enabled: Boolean(token),
  });
  const snapshot = snapshotQuery.data;

  return (
    <main className="min-h-screen bg-leasium-bg px-5 py-8 text-foreground">
      <div className="mx-auto grid max-w-5xl gap-5">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <LeasiumMark className="h-12 w-12" />
            <div>
              <div className="text-sm font-semibold text-primary">Leasium snapshot</div>
              <h1 className="text-2xl font-semibold">
                {snapshot ? snapshotTypeLabel(snapshot.snapshot_type) : "Portfolio snapshot"}
              </h1>
            </div>
          </div>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
          >
            Open Leasium
          </Link>
        </header>

        {snapshotQuery.isLoading ? (
          <SectionPanel
            title="Loading snapshot"
            icon={<Loader2 size={17} className="animate-spin text-primary" />}
          >
            <div className="p-4 text-sm text-muted-foreground">
              Preparing the shared view.
            </div>
          </SectionPanel>
        ) : null}

        {snapshotQuery.error ? (
          <SectionPanel>
            <EmptyState
              title="Snapshot unavailable"
              description="This link may have expired, been revoked, or never existed."
            />
          </SectionPanel>
        ) : null}

        {snapshot ? (
          <>
            <SectionPanel
              title={snapshot.payload.entity.name}
              description={`As at ${formatDate(snapshot.as_of)}. Created ${formatDateTime(
                snapshot.created_at,
              )}. Expires ${formatDateTime(snapshot.expires_at)}.`}
              icon={<Building2 size={17} className="text-primary" />}
              actions={<StatusBadge tone="neutral">Frozen view</StatusBadge>}
            >
              <div className="grid gap-3 p-4 md:grid-cols-4">
                <CountTile
                  label="Properties"
                  value={snapshot.payload.portfolio_health.property_count}
                />
                <CountTile
                  label="Active leases"
                  value={snapshot.payload.portfolio_health.active_lease_count}
                />
                <CountTile
                  label="Live exceptions"
                  value={snapshot.payload.live_exceptions.length}
                />
                <CountTile
                  label="Configured charges"
                  value={formatMoney(
                    snapshot.payload.finance_snapshot.configured_charges_cents,
                  )}
                />
              </div>
            </SectionPanel>

            <SnapshotBody snapshot={snapshot} />

            <SectionPanel
              title="Snapshot Controls"
              description="This public link is read-only and cannot change Leasium records."
              icon={<FileText size={17} className="text-primary" />}
            >
              <div className="grid gap-2 p-4 text-sm text-muted-foreground">
                {snapshot.guardrails.map((item) => (
                  <div key={item} className="flex items-start gap-2">
                    <AlertTriangle size={15} className="mt-0.5 text-primary" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </SectionPanel>
          </>
        ) : null}
      </div>
    </main>
  );
}

export default function PublicSnapshotPage() {
  return (
    <QueryProvider>
      <PublicSnapshotContent />
    </QueryProvider>
  );
}
