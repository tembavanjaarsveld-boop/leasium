"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { useParams } from "next/navigation";

import { LeasiumMark } from "@/components/brand";
import { QueryProvider } from "@/components/query-provider";
import {
  EmptyState,
  SectionPanel,
  SkeletonRows,
  StatusBadge,
} from "@/components/ui";
import {
  getVendorPortal,
  type VendorPortalRecord,
  type VendorPortalWorkOrderItemRecord,
} from "@/lib/api";
import { friendlyError } from "@/lib/utils";

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function titleCase(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function PortalShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-4">
          <LeasiumMark />
          <div className="min-w-0">
            <p className="text-lg font-semibold leading-6">Leasium</p>
            <p className="text-sm text-muted-foreground">Vendor portal</p>
          </div>
        </div>
      </header>
      {children}
    </main>
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

function WorkOrderRow({ item }: { item: VendorPortalWorkOrderItemRecord }) {
  return (
    <article className="grid gap-3 border-b border-border px-4 py-4 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-6">{item.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {item.property_name}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone={item.priority === "urgent" ? "warning" : "neutral"}>
            {item.priority}
          </StatusBadge>
          <StatusBadge tone="primary">{titleCase(item.status)}</StatusBadge>
        </div>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Requested
          </dt>
          <dd className="mt-1">{formatDateTime(item.requested_at)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Due
          </dt>
          <dd className="mt-1">{formatDate(item.due_date)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Quote
          </dt>
          <dd className="mt-1">
            {item.quote_amount_cents == null
              ? "-"
              : `${formatMoney(item.quote_amount_cents)} quote`}
          </dd>
        </div>
      </dl>
      {item.comments.length > 0 ? (
        <div className="grid gap-2 rounded-lg border border-border bg-white p-3">
          {item.comments.map((comment) => (
            <p
              key={`${comment.timestamp ?? "comment"}-${comment.body}`}
              className="text-sm leading-6 text-slate"
            >
              {comment.body}
            </p>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function WorkOrdersPanel({ portal }: { portal: VendorPortalRecord }) {
  const workOrders = portal.work_orders.items;
  return (
    <SectionPanel title="Work orders" icon={<ClipboardList size={17} />}>
      {workOrders.length === 0 ? (
        <EmptyState
          title="No shared work orders."
          description="The property team has not shared active work with this vendor preview."
          icon={<Wrench size={18} />}
        />
      ) : (
        <div>{workOrders.map((item) => <WorkOrderRow item={item} key={item.id} />)}</div>
      )}
    </SectionPanel>
  );
}

function VendorPortalView({ portal }: { portal: VendorPortalRecord }) {
  const vendor = portal.vendor;
  const categories = vendor.categories.length > 0 ? vendor.categories : ["other"];

  return (
    <div className="mx-auto grid max-w-6xl gap-5 px-5 py-6">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold leading-9">Vendor portal</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            {vendor.name}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {vendor.company_name ? (
              <StatusBadge tone="neutral">{vendor.company_name}</StatusBadge>
            ) : null}
            {vendor.email ? (
              <StatusBadge tone="neutral">
                <Mail size={13} />
                {vendor.email}
              </StatusBadge>
            ) : null}
            {vendor.phone ? (
              <StatusBadge tone="neutral">
                <Phone size={13} />
                {vendor.phone}
              </StatusBadge>
            ) : null}
          </div>
        </div>
        <StatusBadge tone="primary">Operator preview</StatusBadge>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          label="Open work"
          value={`${portal.work_orders.open_count}`}
          tone={portal.work_orders.open_count > 0 ? "primary" : "neutral"}
        />
        <MetricTile
          label="Urgent"
          value={`${portal.work_orders.urgent_count}`}
          tone={portal.work_orders.urgent_count > 0 ? "warning" : "neutral"}
        />
        <MetricTile
          label="Overdue"
          value={`${portal.work_orders.overdue_count}`}
          tone={portal.work_orders.overdue_count > 0 ? "warning" : "success"}
        />
        <MetricTile
          label="Priority"
          value={`Tier ${vendor.priority}`}
          tone={vendor.priority === 1 ? "success" : "neutral"}
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="grid gap-5">
          <WorkOrdersPanel portal={portal} />
          <GuardrailPanel guardrails={portal.guardrails} />
        </div>

        <aside className="grid content-start gap-5">
          <SectionPanel title="Vendor" icon={<Wrench size={17} />}>
            <dl className="grid gap-3 p-4 text-sm">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Company
                </dt>
                <dd className="mt-1 break-words">
                  {vendor.company_name ?? "-"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Categories
                </dt>
                <dd className="mt-2 flex flex-wrap gap-2">
                  {categories.map((category) => (
                    <StatusBadge key={category} tone="neutral">
                      {category}
                    </StatusBadge>
                  ))}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Service radius
                </dt>
                <dd className="mt-1 flex items-center gap-2">
                  <MapPin size={14} />
                  {vendor.service_radius_km == null
                    ? "-"
                    : `${vendor.service_radius_km} km`}
                </dd>
              </div>
            </dl>
          </SectionPanel>

          <SectionPanel title="Preview" icon={<Clock3 size={17} />}>
            <div className="grid gap-3 p-4 text-sm text-muted-foreground">
              <p>{portal.auth.detail}</p>
              <p>Generated {formatDateTime(portal.generated_at)}</p>
            </div>
          </SectionPanel>

          <SectionPanel title="Next appointment" icon={<CalendarDays size={17} />}>
            <div className="p-4 text-sm text-muted-foreground">
              {portal.work_orders.items[0]
                ? formatDate(portal.work_orders.items[0].due_date)
                : "-"}
            </div>
          </SectionPanel>
        </aside>
      </div>
    </div>
  );
}

function VendorPortalContent() {
  const params = useParams<{ contractorId?: string | string[] }>();
  const contractorId = Array.isArray(params.contractorId)
    ? params.contractorId[0]
    : params.contractorId;

  const portalQuery = useQuery({
    queryKey: ["vendor-portal", contractorId],
    queryFn: () => getVendorPortal(contractorId ?? ""),
    enabled: Boolean(contractorId),
  });

  if (portalQuery.isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-6">
        <SectionPanel title="Vendor portal">
          <SkeletonRows rows={6} />
        </SectionPanel>
      </div>
    );
  }

  if (portalQuery.error) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-8">
        <SectionPanel title="Vendor portal unavailable">
          <div className="flex items-start gap-3 p-4 text-sm text-danger">
            <AlertTriangle className="mt-0.5 shrink-0" size={17} />
            <p>{friendlyError(portalQuery.error)}</p>
          </div>
        </SectionPanel>
      </div>
    );
  }

  if (!portalQuery.data) {
    return null;
  }

  return <VendorPortalView portal={portalQuery.data} />;
}

export default function VendorPortalPage() {
  return (
    <QueryProvider>
      <PortalShell>
        <VendorPortalContent />
      </PortalShell>
    </QueryProvider>
  );
}
