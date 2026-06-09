"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  Copy,
  Clock3,
  Download,
  ExternalLink,
  Gauge,
  LineChart,
  Loader2,
  Receipt,
  RefreshCw,
  Share2,
  ShieldCheck,
  Sparkles,
  TableProperties,
  UserRound,
  Wrench,
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
  type StatusTone,
} from "@/components/ui";
import {
  ArrearsSnapshotItemRecord,
  AutomationActivityRecord,
  ComplianceRiskItemRecord,
  createInsightsSnapshot,
  getInsightsOverview,
  InsightsOverviewRecord,
  InsightsSnapshotCreateRecord,
  InsightsSnapshotRecord,
  InsightsSnapshotType,
  InvoiceStatusItemRecord,
  getPortfolioRollup,
  listEntities,
  listInsightsSnapshots,
  LiveExceptionRecord,
  MaintenanceAgingItemRecord,
  revokeInsightsSnapshot,
  entityTypeLabel,
} from "@/lib/api";
import { csvCell } from "@/lib/csv";
import { saveBlob } from "@/lib/download";
import { cn, friendlyError } from "@/lib/utils";

const ENTITY_STORAGE_KEY = "leasium.entity_id";

const INSIGHTS_TABS = [
  { id: "overview", label: "Overview", description: "Exceptions & billing risk" },
  { id: "money", label: "Money", description: "Finance, invoices, arrears" },
  {
    id: "operations",
    label: "Operations",
    description: "Maintenance, compliance, leases",
  },
  { id: "portfolio", label: "Portfolio", description: "Owner, activity & sharing" },
] as const;

type InsightsTab = (typeof INSIGHTS_TABS)[number]["id"];

type AccountingReadinessView = NonNullable<
  InsightsOverviewRecord["finance_snapshot"]["accounting_readiness"]
> & {
  generated_at?: string | null;
  source?: string | null;
  source_label?: string | null;
  generated_source?: string | null;
};

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

function sentenceStatus(value: string | null | undefined) {
  const label = labelStatus(value);
  return `${label.slice(0, 1).toUpperCase()}${label.slice(1)}`;
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
          {accounting.guardrails.map((guardrail) => {
            // C8: a couple of guardrails phrase the read-only state as
            // "<action> does not …", which reads as one run-on line.
            // Split the leading status clause onto its own quiet label so
            // the caption beneath stands as a separate sentence. Purely
            // presentational; the guardrail text is unchanged.
            const split = guardrail.match(/^(.*?) (does not .*)$/);
            return (
              <div key={guardrail} className="flex items-start gap-2">
                <ShieldCheck
                  size={15}
                  className="mt-0.5 shrink-0 text-primary"
                />
                {split ? (
                  <span className="grid gap-0.5">
                    <span className="font-medium text-foreground">
                      {split[1]}
                    </span>
                    <span>{split[2]}</span>
                  </span>
                ) : (
                  <span>{guardrail}</span>
                )}
              </div>
            );
          })}
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
  tone?: StatusTone;
  icon: ReactNode;
}) {
  const tones = {
    neutral: "bg-muted text-slate",
    success: "bg-success-soft text-success-strong",
    warning: "bg-warning-soft text-warning-strong",
    danger: "bg-danger-soft text-danger-strong",
    primary: "bg-primary-soft text-primary-hover",
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

type GroupedLiveException = {
  item: LiveExceptionRecord;
  chip: string;
  count: number;
  details: string[];
};

function chipLeadingCount(chip: string) {
  const match = /^(\d+)\b/.exec(chip);
  return match ? Number(match[1]) : null;
}

// Collapse near-duplicate live exceptions: rows sharing title + source +
// destination merge into one row with a ×N count chip. Differing details
// (e.g. per-unit billing blockers for the same tenant) join into one
// description, and the chip keeps the highest blocker count.
function groupLiveExceptions(
  items: LiveExceptionRecord[],
): GroupedLiveException[] {
  const groups: GroupedLiveException[] = [];
  const byKey = new Map<string, GroupedLiveException>();
  for (const item of items) {
    const key = `${item.title}|${item.source}|${item.href}`;
    const group = byKey.get(key);
    if (!group) {
      const next = { item, chip: item.chip, count: 1, details: [item.detail] };
      byKey.set(key, next);
      groups.push(next);
      continue;
    }
    group.count += 1;
    if (!group.details.includes(item.detail)) {
      group.details.push(item.detail);
    }
    const currentCount = chipLeadingCount(group.chip);
    const nextCount = chipLeadingCount(item.chip);
    if (nextCount !== null && (currentCount === null || nextCount > currentCount)) {
      group.chip = item.chip;
    }
  }
  return groups;
}

// Sentence-case joined blocker fragments at render time, e.g.
// "…not connected to Xero. base rent is missing…" → "…Base rent is missing…".
function formatExceptionDetail(detail: string) {
  return detail
    .replace(/^[a-z]/, (letter) => letter.toUpperCase())
    .replace(/\. [a-z]/g, (joined) => joined.toUpperCase());
}

function ExceptionRow({ group }: { group: GroupedLiveException }) {
  const { item } = group;
  return (
    <Link
      href={item.href}
      className="grid gap-3 px-4 py-4 transition hover:bg-muted/60 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-semibold">{item.title}</div>
          <StatusBadge tone={item.severity}>{group.chip}</StatusBadge>
          {group.count > 1 ? (
            <StatusBadge tone="neutral">×{group.count}</StatusBadge>
          ) : null}
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
          {formatExceptionDetail(group.details.join(" "))}
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
  const tone: StatusTone = item.outcome === "success" ? "success" : "warning";
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

function complianceTone(item: ComplianceRiskItemRecord): StatusTone {
  if (item.status === "overdue" || item.rank < 0) {
    return "danger";
  }
  if (item.status === "due_soon" || item.rank <= 30 || item.evidence_count === 0) {
    return "warning";
  }
  return "neutral";
}

function maintenanceAgingTone(item: MaintenanceAgingItemRecord): StatusTone {
  if (item.priority === "urgent" || item.rank < 0) {
    return "danger";
  }
  if (
    item.priority === "high" ||
    item.status === "awaiting_approval" ||
    item.approval_status === "pending" ||
    item.age_days >= 14
  ) {
    return "warning";
  }
  return "neutral";
}

function arrearsTone(item: ArrearsSnapshotItemRecord): StatusTone {
  if (
    item.rank < 0 ||
    item.dispute_status === "escalated" ||
    ["queued", "in_progress", "referred"].includes(item.escalation_status)
  ) {
    return "danger";
  }
  if (
    item.total_balance_cents > 0 ||
    item.dispute_status === "raised" ||
    item.dispute_status === "under_review" ||
    item.age_days >= 30
  ) {
    return "warning";
  }
  return "neutral";
}

function invoiceStatusTone(item: InvoiceStatusItemRecord): StatusTone {
  if (
    item.posting_status === "provider_failed" ||
    item.delivery_status === "blocked" ||
    item.chip.includes("overdue")
  ) {
    return "danger";
  }
  if (
    item.posting_status === "approved_not_synced" ||
    item.delivery_status === "ready" ||
    item.payment_status !== "paid"
  ) {
    return "warning";
  }
  return "success";
}

function ComplianceRiskRow({ item }: { item: ComplianceRiskItemRecord }) {
  const context = [
    item.property_name,
    item.unit_label,
    item.tenant_name,
  ].filter(Boolean);
  const ownerLabel = item.owner_role
    ? `Owner ${labelStatus(item.owner_role)}`
    : "No owner";
  const evidenceLabel =
    item.evidence_count > 0
      ? `${item.evidence_count} evidence ${plural(item.evidence_count, "file")}`
      : "Missing evidence";

  return (
    <Link
      href={item.href}
      className="grid gap-3 border-t border-border px-4 py-4 transition hover:bg-muted/60 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-semibold">{item.title}</div>
          <StatusBadge tone={complianceTone(item)}>{item.chip}</StatusBadge>
          <StatusBadge tone="neutral">{labelStatus(item.category)}</StatusBadge>
          {item.register_check_id ? (
            <StatusBadge
              tone={item.operator_approved_evidence ? "success" : "warning"}
            >
              {item.operator_approved_evidence
                ? "Evidence on file"
                : "Evidence missing"}
            </StatusBadge>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {context.length ? context.join(" · ") : "Portfolio-level obligation"}
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs font-medium text-muted-foreground">
          <span>{ownerLabel}</span>
          <span>{evidenceLabel}</span>
          {item.latest_evidence_actor ? (
            <span>Latest evidence {item.latest_evidence_actor}</span>
          ) : null}
          {item.inspection_type ? (
            <span>{labelStatus(item.inspection_type)}</span>
          ) : null}
        </div>
        {item.register_check_id && item.last_completed_at ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Last completed {formatDate(item.last_completed_at)}
            {item.last_completed_by ? ` by ${item.last_completed_by}` : ""}
          </p>
        ) : null}
      </div>
      <div className="text-xs font-semibold text-muted-foreground">
        {formatDate(item.due_date)}
      </div>
    </Link>
  );
}

function MaintenanceAgingRow({ item }: { item: MaintenanceAgingItemRecord }) {
  const context = [
    item.property_name,
    item.unit_label,
    item.tenant_name,
  ].filter(Boolean);
  const contractorLabel = item.contractor_name ?? "No contractor";
  const quoteLabel =
    item.quote_amount_cents !== null
      ? `${formatMoney(item.quote_amount_cents)} quote`
      : "No quote";

  return (
    <Link
      href={item.href}
      className="grid gap-3 border-t border-border px-4 py-4 transition hover:bg-muted/60 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-semibold">{item.title}</div>
          <StatusBadge tone={maintenanceAgingTone(item)}>
            {item.chip}
          </StatusBadge>
          <StatusBadge tone="neutral">{labelStatus(item.priority)}</StatusBadge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {context.length ? context.join(" · ") : "Portfolio-level work order"}
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs font-medium text-muted-foreground">
          <span>{item.age_days} days open</span>
          <span>{contractorLabel}</span>
          <span>{quoteLabel}</span>
          <span>Approval {labelStatus(item.approval_status)}</span>
        </div>
      </div>
      <div className="text-xs font-semibold text-muted-foreground">
        {formatDate(item.due_date)}
      </div>
    </Link>
  );
}

function ArrearsSnapshotRow({ item }: { item: ArrearsSnapshotItemRecord }) {
  const context = [
    item.property_name,
    item.unit_label,
    item.tenant_name,
  ].filter(Boolean);
  const promiseLabel = item.promise_to_pay_date
    ? `Promise ${formatDate(item.promise_to_pay_date)}`
    : "No promise";
  const escalationLabel =
    item.escalation_status === "none"
      ? "Escalation none"
      : `Escalation ${labelStatus(item.escalation_status)}`;

  return (
    <Link
      href={item.href}
      className="grid gap-3 border-t border-border px-4 py-4 transition hover:bg-muted/60 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-semibold">{item.title}</div>
          <StatusBadge tone={arrearsTone(item)}>{item.chip}</StatusBadge>
          <StatusBadge tone="neutral">{labelStatus(item.status)}</StatusBadge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {context.length ? context.join(" · ") : "Tenant arrears"}
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs font-medium text-muted-foreground">
          <span>{item.age_days} days aged</span>
          <span>{promiseLabel}</span>
          <span>Dispute {labelStatus(item.dispute_status)}</span>
          <span>{escalationLabel}</span>
        </div>
      </div>
      <div className="text-xs font-semibold text-foreground">
        {formatMoney(item.total_balance_cents)}
      </div>
    </Link>
  );
}

function InvoiceStatusRow({ item }: { item: InvoiceStatusItemRecord }) {
  const context = [
    item.property_name,
    item.unit_label,
    item.tenant_name ?? item.recipient_name,
  ].filter(Boolean);
  const invoiceLabel = item.invoice_number ?? "No invoice number";
  const recipientLabel = item.recipient_email
    ? `Email ${item.recipient_email}`
    : "No recipient email";

  return (
    <Link
      href={item.href}
      className="grid gap-3 border-t border-border px-4 py-4 transition hover:bg-muted/60 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-semibold">{item.title}</div>
          <StatusBadge tone={invoiceStatusTone(item)}>{item.chip}</StatusBadge>
          <StatusBadge tone="neutral">
            {sentenceStatus(item.posting_status)}
          </StatusBadge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {context.length ? context.join(" · ") : "Invoice draft"}
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs font-medium text-muted-foreground">
          <span>{invoiceLabel}</span>
          <span>Payment {sentenceStatus(item.payment_status)}</span>
          <span>Delivery {sentenceStatus(item.delivery_status)}</span>
          <span>{recipientLabel}</span>
        </div>
      </div>
      <div className="text-xs font-semibold text-foreground">
        {formatMoney(item.outstanding_cents)}
      </div>
    </Link>
  );
}

const INSIGHTS_REVIEW_EXPORT_GUARDRAIL =
  "Review-only export: downloading this file does not create or revoke snapshots, write Xero data, refresh providers, send SendGrid or Twilio messages, send tenant, owner, or provider email, apply payment reconciliation, generate billing drafts, dispatch providers, or mutate provider history.";

function insightsReviewPacketCsv(
  overview: InsightsOverviewRecord,
  snapshots: InsightsSnapshotRecord[],
) {
  const accounting = overview.finance_snapshot.accounting_readiness;
  const ownerSnapshot = overview.owner_entity_snapshot;
  const leaseSnapshot = overview.lease_event_snapshot;
  const complianceSnapshot = overview.compliance_snapshot;
  const maintenanceSnapshot = overview.maintenance_snapshot;
  const arrearsSnapshot = overview.arrears_snapshot;
  const invoiceStatusSnapshot = overview.invoice_status_snapshot;
  const rows: Array<Array<string | number | null | undefined>> = [
    ["Category", "Item", "Status", "Count", "Amount", "Detail", "Guardrail"],
    [
      "Portfolio summary",
      overview.entity.name,
      overview.as_of,
      overview.portfolio_health.property_count,
      "",
      `${overview.portfolio_health.tenant_count} tenants; ${overview.portfolio_health.active_lease_count} active leases; ${overview.portfolio_health.vacant_unit_count} vacant units.`,
      INSIGHTS_REVIEW_EXPORT_GUARDRAIL,
    ],
    ...overview.live_exceptions.map((item) => [
      "Live exception",
      item.title,
      item.severity,
      item.rank,
      "",
      `${item.detail} Source: ${item.source}. Due: ${formatDate(item.due_date)}.`,
      INSIGHTS_REVIEW_EXPORT_GUARDRAIL,
    ]),
    ...overview.automation_activity.map((item) => [
      "Automation activity",
      item.label,
      labelStatus(item.outcome),
      "",
      "",
      `${item.detail ?? item.source} Occurred: ${formatDateTime(item.occurred_at)}.`,
      INSIGHTS_REVIEW_EXPORT_GUARDRAIL,
    ]),
    [
      "Finance snapshot",
      "Billing readiness",
      `${overview.finance_snapshot.ready_to_bill_count} ready / ${overview.finance_snapshot.blocked_row_count} blocked`,
      overview.finance_snapshot.ready_to_bill_count,
      formatMoney(overview.finance_snapshot.configured_charges_cents),
      `${overview.finance_snapshot.approved_unsynced_invoice_count} approved not synced; ${overview.finance_snapshot.unpaid_invoice_count} unpaid.`,
      INSIGHTS_REVIEW_EXPORT_GUARDRAIL,
    ],
    [
      "Finance snapshot",
      "Accounting readiness",
      accounting ? labelStatus(accounting.status) : "Not available",
      accounting?.readiness_issue_count ?? "",
      "",
      accounting
        ? `${accounting.summary} Contact ${accounting.contact_ready} ready / ${accounting.contact_missing} missing; chart ${accounting.chart_ready} ready / ${accounting.chart_missing} missing; tax ${accounting.tax_ready} ready / ${accounting.tax_missing} missing.`
        : "No accounting readiness snapshot loaded.",
      INSIGHTS_REVIEW_EXPORT_GUARDRAIL,
    ],
    [
      "Owner / entity snapshot",
      "Ownership and Xero readiness",
      ownerSnapshot.xero_connected ? "Xero connected" : "Xero not connected",
      ownerSnapshot.missing_xero_contact_count,
      "",
      `${ownerSnapshot.missing_invoice_issuer_count} missing issuers; ${ownerSnapshot.missing_owner_abn_count} missing owner ABNs; ${ownerSnapshot.missing_trustee_count} missing trustees; GST ${ownerSnapshot.entity_gst_registered ? "registered" : "not registered"}.`,
      INSIGHTS_REVIEW_EXPORT_GUARDRAIL,
    ],
    ...Object.entries(ownerSnapshot.ownership_profile_counts).map(
      ([profile, count]) => [
        "Owner / entity snapshot",
        ownershipLabel(profile),
        "Ownership profile",
        count,
        "",
        `${count} properties use ${ownershipLabel(profile)}.`,
        INSIGHTS_REVIEW_EXPORT_GUARDRAIL,
      ],
    ),
    [
      "Compliance snapshot",
      "Compliance & inspections",
      `${complianceSnapshot.open_count} open`,
      complianceSnapshot.open_count,
      "",
      `${complianceSnapshot.overdue_count} overdue; ${complianceSnapshot.due_soon_count} due soon; ${complianceSnapshot.missing_evidence_count} missing evidence; ${complianceSnapshot.fire_safety_count} fire safety.`,
      INSIGHTS_REVIEW_EXPORT_GUARDRAIL,
    ],
    ...complianceSnapshot.next_items.map((item) => [
      "Compliance snapshot",
      item.title,
      labelStatus(item.status),
      item.rank,
      "",
      `${item.property_name ?? "Portfolio"}${item.unit_label ? ` ${item.unit_label}` : ""}; ${item.tenant_name ?? "No tenant"}; ${item.evidence_count} evidence files; latest evidence ${item.latest_evidence_actor ?? "not linked"}; due ${formatDate(item.due_date)}.`,
      INSIGHTS_REVIEW_EXPORT_GUARDRAIL,
    ]),
    [
      "Maintenance snapshot",
      "Maintenance aging",
      `${maintenanceSnapshot.open_count} open`,
      maintenanceSnapshot.open_count,
      "",
      `${maintenanceSnapshot.urgent_count} urgent; ${maintenanceSnapshot.overdue_count} overdue; ${maintenanceSnapshot.contractor_assigned_count} assigned to contractors; ${maintenanceSnapshot.aged_14_day_count} aged 14+ days; oldest ${maintenanceSnapshot.oldest_age_days} days open.`,
      INSIGHTS_REVIEW_EXPORT_GUARDRAIL,
    ],
    ...maintenanceSnapshot.next_items.map((item) => [
      "Maintenance snapshot",
      item.title,
      labelStatus(item.status),
      item.age_days,
      formatMoney(item.quote_amount_cents),
      `${item.property_name ?? "Portfolio"}${item.unit_label ? ` ${item.unit_label}` : ""}; ${item.tenant_name ?? "No tenant"}; ${item.contractor_name ?? "No contractor"}; ${item.age_days} days open; ${labelStatus(item.priority)} priority; ${item.chip}; due ${formatDate(item.due_date)}.`,
      INSIGHTS_REVIEW_EXPORT_GUARDRAIL,
    ]),
    [
      "Arrears snapshot",
      "Credit control",
      `${arrearsSnapshot.open_count} open`,
      arrearsSnapshot.open_count,
      formatMoney(arrearsSnapshot.total_balance_cents),
      `${arrearsSnapshot.overdue_reminder_count} reminders due; ${arrearsSnapshot.disputed_count} disputed; ${arrearsSnapshot.escalated_count} escalated; ${arrearsSnapshot.promise_to_pay_count} promises to pay; oldest ${arrearsSnapshot.oldest_age_days} days aged.`,
      INSIGHTS_REVIEW_EXPORT_GUARDRAIL,
    ],
    ...arrearsSnapshot.next_items.map((item) => [
      "Arrears snapshot",
      item.title,
      labelStatus(item.status),
      item.age_days,
      formatMoney(item.total_balance_cents),
      `${item.property_name ?? "Portfolio"}${item.unit_label ? ` ${item.unit_label}` : ""}; ${item.tenant_name ?? "No tenant"}; ${item.age_days} days aged; ${labelStatus(item.dispute_status)} dispute; ${labelStatus(item.escalation_status)} escalation; ${item.promise_to_pay_date ? `promise ${formatDate(item.promise_to_pay_date)}` : "no promise"}; reminder ${formatDate(item.next_reminder_on)}.`,
      INSIGHTS_REVIEW_EXPORT_GUARDRAIL,
    ]),
    [
      "Invoice status",
      "Invoice delivery and posting",
      `${invoiceStatusSnapshot.total_invoice_count} invoices`,
      invoiceStatusSnapshot.total_invoice_count,
      formatMoney(invoiceStatusSnapshot.outstanding_cents),
      `${invoiceStatusSnapshot.approved_count} approved; ${invoiceStatusSnapshot.approved_unsynced_count} approved not synced; ${invoiceStatusSnapshot.ready_to_send_count} ready to send; ${invoiceStatusSnapshot.unpaid_count} unpaid; ${invoiceStatusSnapshot.xero_failed_count} provider failed.`,
      INSIGHTS_REVIEW_EXPORT_GUARDRAIL,
    ],
    ...invoiceStatusSnapshot.next_items.map((item) => [
      "Invoice status",
      item.title,
      sentenceStatus(item.posting_status),
      item.rank,
      formatMoney(item.outstanding_cents),
      `${item.invoice_number ?? "No invoice number"}; ${item.property_name ?? "Portfolio"}${item.unit_label ? ` ${item.unit_label}` : ""}; ${item.tenant_name ?? item.recipient_name ?? "No recipient"}; ${sentenceStatus(item.payment_status)} payment; ${sentenceStatus(item.delivery_status)} delivery; ${sentenceStatus(item.posting_status)}; due ${formatDate(item.due_date)}.`,
      INSIGHTS_REVIEW_EXPORT_GUARDRAIL,
    ]),
    [
      "Lease event",
      "Lease event snapshot",
      `${leaseSnapshot.next_events.length} upcoming`,
      leaseSnapshot.next_events.length,
      "",
      `${leaseSnapshot.next_review_count} rent reviews; ${leaseSnapshot.next_expiry_count} expiries; ${leaseSnapshot.due_soon_obligation_count} due soon obligations; ${leaseSnapshot.tenant_onboarding_waiting_count} onboarding follow-ups.`,
      INSIGHTS_REVIEW_EXPORT_GUARDRAIL,
    ],
    ...leaseSnapshot.next_events.map((event) => [
      "Lease event",
      event.title,
      eventKindLabel(event.kind),
      event.rank,
      "",
      `${formatDate(event.date)}; ${event.chip}; ${event.href}.`,
      INSIGHTS_REVIEW_EXPORT_GUARDRAIL,
    ]),
    ...(snapshots.length
      ? snapshots.map((snapshot) => [
          "Snapshot history",
          snapshotTypeLabel(snapshot.snapshot_type),
          snapshot.revoked_at ? "Revoked" : "Saved",
          "",
          "",
          `As at ${snapshot.as_of}; expires ${formatDateTime(snapshot.expires_at)}; created ${formatDateTime(snapshot.created_at)}.`,
          INSIGHTS_REVIEW_EXPORT_GUARDRAIL,
        ])
      : [
          [
            "Snapshot history",
            "No saved snapshots",
            "None",
            0,
            "",
            "No saved snapshots are loaded for this entity.",
            INSIGHTS_REVIEW_EXPORT_GUARDRAIL,
          ],
        ]),
    ...overview.guardrails.map((guardrail) => [
      "Overview guardrail",
      guardrail,
      "Read-only",
      "",
      "",
      guardrail,
      INSIGHTS_REVIEW_EXPORT_GUARDRAIL,
    ]),
    [
      "Export guardrail",
      "",
      "Review-only",
      "",
      "",
      INSIGHTS_REVIEW_EXPORT_GUARDRAIL,
      INSIGHTS_REVIEW_EXPORT_GUARDRAIL,
    ],
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
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
  const [activeTab, setActiveTab] = useState<InsightsTab>("overview");
  const [snapshotType, setSnapshotType] = useState<InsightsSnapshotType>("owner");
  const [latestSnapshot, setLatestSnapshot] =
    useState<InsightsSnapshotCreateRecord | null>(null);
  const [copiedSnapshotId, setCopiedSnapshotId] = useState<string | null>(null);
  const [reviewExportReceipt, setReviewExportReceipt] = useState<string | null>(
    null,
  );
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
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab && INSIGHTS_TABS.some((entry) => entry.id === tab)) {
      setActiveTab(tab as InsightsTab);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (activeTab === "overview") {
      params.delete("tab");
    } else {
      params.set("tab", activeTab);
    }
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      query ? `${window.location.pathname}?${query}` : window.location.pathname,
    );
  }, [activeTab]);

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

  const portfolioRollupQuery = useQuery({
    queryKey: ["insights-portfolio-rollup"],
    queryFn: getPortfolioRollup,
    enabled: activeTab === "portfolio",
  });
  const portfolioRollup = portfolioRollupQuery.data;

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
  const complianceSnapshot = overview?.compliance_snapshot;
  const maintenanceSnapshot = overview?.maintenance_snapshot;
  const arrearsSnapshot = overview?.arrears_snapshot;
  const invoiceStatusSnapshot = overview?.invoice_status_snapshot;
  const snapshots = snapshotsQuery.data ?? [];

  function downloadReviewCsv() {
    if (!overview) {
      return;
    }
    saveBlob(
      new Blob([insightsReviewPacketCsv(overview, snapshots)], {
        type: "text/csv;charset=utf-8",
      }),
      `insights-review-packet-${overview.as_of}.csv`,
    );
    setReviewExportReceipt("Insights review CSV downloaded.");
  }

  async function copyReviewPacket() {
    if (!overview) {
      return;
    }
    const packet = insightsReviewPacketCsv(overview, snapshots);
    try {
      await navigator.clipboard.writeText(packet);
    } catch {
      window.prompt("Copy insights review packet", packet);
    }
    setReviewExportReceipt("Insights review packet copied.");
  }

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
                {isOverviewFetching ? "Refreshing…" : "Refresh"}
              </SecondaryButton>
              <SecondaryButton
                type="button"
                onClick={() => void copyReviewPacket()}
                disabled={!overview}
              >
                <Copy size={15} />
                Copy review packet
              </SecondaryButton>
              <SecondaryButton
                type="button"
                onClick={downloadReviewCsv}
                disabled={!overview}
              >
                <Download size={15} />
                Download review CSV
              </SecondaryButton>
            </div>
          }
        />
        {reviewExportReceipt ? (
          <p className="text-sm font-medium text-success">
            {reviewExportReceipt}
          </p>
        ) : null}

        {entityError ? (
          <div className="rounded-2xl border border-danger/20 bg-danger-soft p-4 text-sm text-danger">
            {friendlyError(entityError)}
          </div>
        ) : null}

        {overviewError && activeEntityId && !overview ? (
          <SectionPanel>
            <EmptyState
              icon={<AlertTriangle size={18} />}
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
              icon={<Building2 size={18} />}
              title="Select an entity"
              description="Insights will load once an entity is selected."
            />
          </SectionPanel>
        ) : null}

        {isOverviewLoading ? (
          <SectionPanel
            title="Checking live insights"
            description="Preparing the latest portfolio, exception, billing, and owner/entity view."
            icon={<Loader2 size={17} className="animate-spin text-primary" />}
            actions={<StatusBadge tone="neutral">Checking</StatusBadge>}
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
              icon={<Gauge size={18} />}
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

            <div
              className="grid gap-2 rounded-2xl border border-border bg-white p-2 shadow-leasiumXs sm:grid-cols-2 lg:grid-cols-4"
              role="tablist"
              aria-label="Insights sections"
            >
              {INSIGHTS_TABS.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "grid min-h-16 gap-1 rounded-xl px-3 py-2 text-left transition duration-200 ease-leasium",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-leasiumXs"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <span className="text-sm font-semibold">{tab.label}</span>
                    <span
                      className={cn(
                        "text-xs",
                        isActive && "text-primary-foreground",
                      )}
                    >
                      {tab.description}
                    </span>
                  </button>
                );
              })}
            </div>

            {activeTab === "portfolio" ? (
            <>
            {portfolioRollup && portfolioRollup.totals.entity_count > 1 ? (
              <SectionPanel
                title="Portfolio rollup"
                description="Occupancy and obligation health across every entity. Books stay separate per entity; this is the single portfolio view over them."
                icon={<Building2 size={17} className="text-primary" />}
                actions={
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge tone="neutral">
                      {portfolioRollup.totals.entity_count} entities
                    </StatusBadge>
                    <StatusBadge tone="primary">
                      {portfolioRollup.totals.property_count} properties
                    </StatusBadge>
                    {portfolioRollup.totals.occupancy_pct !== null ? (
                      <StatusBadge tone="success">
                        {portfolioRollup.totals.occupancy_pct}% occupied
                      </StatusBadge>
                    ) : null}
                    {portfolioRollup.totals.overdue_obligation_count > 0 ? (
                      <StatusBadge tone="danger">
                        {portfolioRollup.totals.overdue_obligation_count} overdue
                      </StatusBadge>
                    ) : null}
                  </div>
                }
              >
                <div className="overflow-x-auto p-4">
                  <table className="w-full min-w-[680px] border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-xs font-semibold uppercase text-muted-foreground">
                        <th className="px-3 py-2">Entity</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Properties</th>
                        <th className="px-3 py-2">Occupancy</th>
                        <th className="px-3 py-2">Overdue</th>
                        <th className="px-3 py-2">Due soon</th>
                      </tr>
                    </thead>
                    <tbody>
                      {portfolioRollup.entities.map((row) => (
                        <tr
                          key={row.id}
                          className="border-t border-border"
                        >
                          <td className="px-3 py-2 font-medium text-foreground">
                            {row.name}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {entityTypeLabel(row.entity_type)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {row.property_count}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {row.occupancy_pct === null
                              ? "—"
                              : `${row.occupancy_pct}% (${row.active_lease_count}/${row.unit_count})`}
                          </td>
                          <td className="px-3 py-2">
                            {row.overdue_obligation_count > 0 ? (
                              <StatusBadge tone="danger">
                                {row.overdue_obligation_count}
                              </StatusBadge>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {row.due_soon_obligation_count}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionPanel>
            ) : null}
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
                    <div className="rounded-xl border border-danger/20 bg-danger-soft p-3 text-sm text-danger">
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
            </>
            ) : null}

            {activeTab === "overview" ? (
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
                  {groupLiveExceptions(overview.live_exceptions).map((group) => (
                    <ExceptionRow key={group.item.id} group={group} />
                  ))}
                  {overview.live_exceptions.length === 0 ? (
                    <EmptyState
                      icon={<CheckCircle2 size={18} />}
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
            ) : null}

            {activeTab === "operations" ? (
            <>
            <SectionPanel
              title="Compliance & Inspections"
              description="Certificate expiry, fire and safety obligations, delegated owners, and evidence status."
              icon={<ShieldCheck size={17} className="text-primary" />}
              actions={
                <StatusBadge
                  tone={
                    complianceSnapshot?.overdue_count
                      ? "danger"
                      : complianceSnapshot?.due_soon_count
                        ? "warning"
                        : "success"
                  }
                >
                  {complianceSnapshot?.open_count ?? 0} open
                </StatusBadge>
              }
            >
              <div className="grid gap-4 p-4 lg:grid-cols-[280px_minmax(0,1fr)]">
                <div className="grid content-start gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <CountPill
                    label="Overdue"
                    value={complianceSnapshot?.overdue_count ?? 0}
                  />
                  <CountPill
                    label="Due soon"
                    value={complianceSnapshot?.due_soon_count ?? 0}
                  />
                  <CountPill
                    label="Missing evidence"
                    value={complianceSnapshot?.missing_evidence_count ?? 0}
                  />
                  <CountPill
                    label="Delegated owners"
                    value={complianceSnapshot?.delegated_owner_count ?? 0}
                  />
                  <CountPill
                    label="Tracked checks"
                    value={complianceSnapshot?.tracked_check_count ?? 0}
                  />
                  <CountPill
                    label="Approved evidence"
                    value={complianceSnapshot?.operator_approved_evidence_count ?? 0}
                  />
                  <CountPill
                    label="Recently completed"
                    value={complianceSnapshot?.recently_completed_count ?? 0}
                  />
                  <div className="rounded-2xl border border-border bg-white p-4 text-sm">
                    <div className="font-semibold">Categories</div>
                    <div className="mt-3 grid gap-2 text-muted-foreground">
                      {Object.entries(complianceSnapshot?.category_counts ?? {}).map(
                        ([category, count]) => (
                          <div
                            key={category}
                            className="flex items-center justify-between gap-3"
                          >
                            <span>{labelStatus(category)}</span>
                            <span className="font-semibold text-foreground">
                              {count}
                            </span>
                          </div>
                        ),
                      )}
                      {Object.keys(complianceSnapshot?.category_counts ?? {})
                        .length === 0 ? (
                        <div>No open compliance categories</div>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="overflow-hidden rounded-2xl border border-border bg-white">
                  <div className="grid gap-1 px-4 py-3">
                    <div className="text-sm font-semibold">
                      Certificates and inspection follow-ups
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {complianceSnapshot?.fire_safety_count ?? 0} fire safety;{" "}
                      {complianceSnapshot?.inspection_report_count ?? 0} inspection
                      report.
                    </div>
                  </div>
                  {(complianceSnapshot?.next_items ?? []).map((item) => (
                    <ComplianceRiskRow key={item.id} item={item} />
                  ))}
                  {(complianceSnapshot?.next_items.length ?? 0) === 0 ? (
                    <EmptyState
                      icon={<ShieldCheck size={18} />}
                      title="No open compliance follow-ups"
                      description="Certificate expiries, safety checks, and inspection evidence follow-ups will appear here."
                    />
                  ) : null}
                </div>
              </div>
            </SectionPanel>

            <SectionPanel
              title="Maintenance Aging"
              description="Open work orders ranked by due date, age, contractor, and approval focus."
              icon={<Wrench size={17} className="text-primary" />}
              actions={
                <StatusBadge
                  tone={
                    maintenanceSnapshot?.overdue_count ||
                    maintenanceSnapshot?.urgent_count
                      ? "danger"
                      : maintenanceSnapshot?.aged_14_day_count
                        ? "warning"
                        : "success"
                  }
                >
                  {maintenanceSnapshot?.open_count ?? 0} open
                </StatusBadge>
              }
            >
              <div className="grid gap-4 p-4 lg:grid-cols-[280px_minmax(0,1fr)]">
                <div className="grid content-start gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <CountPill
                    label="Urgent"
                    value={maintenanceSnapshot?.urgent_count ?? 0}
                  />
                  <CountPill
                    label="Overdue"
                    value={maintenanceSnapshot?.overdue_count ?? 0}
                  />
                  <CountPill
                    label="Aged 14+ days"
                    value={maintenanceSnapshot?.aged_14_day_count ?? 0}
                  />
                  <CountPill
                    label="Oldest open"
                    value={`${maintenanceSnapshot?.oldest_age_days ?? 0} days`}
                  />
                  <div className="rounded-2xl border border-border bg-white p-4 text-sm">
                    <div className="font-semibold">Status mix</div>
                    <div className="mt-3 grid gap-2 text-muted-foreground">
                      {Object.entries(maintenanceSnapshot?.status_counts ?? {}).map(
                        ([status, count]) => (
                          <div
                            key={status}
                            className="flex items-center justify-between gap-3"
                          >
                            <span>{labelStatus(status)}</span>
                            <span className="font-semibold text-foreground">
                              {count}
                            </span>
                          </div>
                        ),
                      )}
                      {Object.keys(maintenanceSnapshot?.status_counts ?? {})
                        .length === 0 ? (
                        <div>No open maintenance statuses</div>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="overflow-hidden rounded-2xl border border-border bg-white">
                  <div className="grid gap-1 px-4 py-3">
                    <div className="text-sm font-semibold">
                      Open work-order aging
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {maintenanceSnapshot?.contractor_assigned_count ?? 0} assigned
                      to contractors;{" "}
                      {maintenanceSnapshot?.awaiting_approval_count ?? 0} awaiting
                      approval.
                    </div>
                  </div>
                  {(maintenanceSnapshot?.next_items ?? []).map((item) => (
                    <MaintenanceAgingRow key={item.id} item={item} />
                  ))}
                  {(maintenanceSnapshot?.next_items.length ?? 0) === 0 ? (
                    <EmptyState
                      icon={<Wrench size={18} />}
                      title="No open maintenance aging"
                      description="Requested, assigned, approval, and in-progress work orders will appear here."
                    />
                  ) : null}
                </div>
              </div>
            </SectionPanel>
            </>
            ) : null}

            {activeTab === "money" ? (
            <>
            <SectionPanel
              title="Arrears Snapshot"
              description="Credit-control balances, reminder timing, disputes, promises, and escalation focus."
              icon={<CircleDollarSign size={17} className="text-primary" />}
              actions={
                <StatusBadge
                  tone={
                    arrearsSnapshot?.overdue_reminder_count ||
                    arrearsSnapshot?.escalated_count
                      ? "danger"
                      : arrearsSnapshot?.disputed_count
                        ? "warning"
                        : "success"
                  }
                >
                  {arrearsSnapshot?.open_count ?? 0} open
                </StatusBadge>
              }
            >
              <div className="grid gap-4 p-4 lg:grid-cols-[280px_minmax(0,1fr)]">
                <div className="grid content-start gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <CountPill
                    label="Balance"
                    value={formatMoney(arrearsSnapshot?.total_balance_cents ?? 0)}
                  />
                  <CountPill
                    label="Reminders due"
                    value={arrearsSnapshot?.overdue_reminder_count ?? 0}
                  />
                  <CountPill
                    label="Disputed"
                    value={arrearsSnapshot?.disputed_count ?? 0}
                  />
                  <CountPill
                    label="Escalated"
                    value={arrearsSnapshot?.escalated_count ?? 0}
                  />
                  <CountPill
                    label="Oldest aged"
                    value={`${arrearsSnapshot?.oldest_age_days ?? 0} days`}
                  />
                  <div className="rounded-2xl border border-border bg-white p-4 text-sm">
                    <div className="font-semibold">Status mix</div>
                    <div className="mt-3 grid gap-2 text-muted-foreground">
                      {Object.entries(arrearsSnapshot?.status_counts ?? {}).map(
                        ([status, count]) => (
                          <div
                            key={status}
                            className="flex items-center justify-between gap-3"
                          >
                            <span>{labelStatus(status)}</span>
                            <span className="font-semibold text-foreground">
                              {count}
                            </span>
                          </div>
                        ),
                      )}
                      {Object.keys(arrearsSnapshot?.status_counts ?? {}).length === 0 ? (
                        <div>No open arrears statuses</div>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="overflow-hidden rounded-2xl border border-border bg-white">
                  <div className="grid gap-1 px-4 py-3">
                    <div className="text-sm font-semibold">
                      Credit-control focus
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {arrearsSnapshot?.promise_to_pay_count ?? 0} promises to pay;{" "}
                      {arrearsSnapshot?.aged_90_day_count ?? 0} aged 90+ days.
                    </div>
                  </div>
                  {(arrearsSnapshot?.next_items ?? []).map((item) => (
                    <ArrearsSnapshotRow key={item.id} item={item} />
                  ))}
                  {(arrearsSnapshot?.next_items.length ?? 0) === 0 ? (
                    <EmptyState
                      icon={<CircleDollarSign size={18} />}
                      title="No open arrears"
                      description="Active or monitoring credit-control cases will appear here."
                    />
                  ) : null}
                </div>
              </div>
            </SectionPanel>

            <SectionPanel
              title="Invoice Status"
              description="Draft invoice delivery, unpaid balance, and Xero posting follow-up."
              icon={<Receipt size={17} className="text-primary" />}
              actions={
                <StatusBadge
                  tone={
                    invoiceStatusSnapshot?.xero_failed_count ||
                    invoiceStatusSnapshot?.overdue_count
                      ? "danger"
                      : invoiceStatusSnapshot?.approved_unsynced_count ||
                          invoiceStatusSnapshot?.ready_to_send_count ||
                          invoiceStatusSnapshot?.unpaid_count
                        ? "warning"
                        : "success"
                  }
                >
                  {invoiceStatusSnapshot?.total_invoice_count ?? 0} invoices
                </StatusBadge>
              }
            >
              <div className="grid gap-4 p-4 lg:grid-cols-[280px_minmax(0,1fr)]">
                <div className="grid content-start gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <CountPill
                    label="Outstanding"
                    value={formatMoney(invoiceStatusSnapshot?.outstanding_cents ?? 0)}
                  />
                  <CountPill
                    label="Approved not synced"
                    value={invoiceStatusSnapshot?.approved_unsynced_count ?? 0}
                  />
                  <CountPill
                    label="Ready to send"
                    value={invoiceStatusSnapshot?.ready_to_send_count ?? 0}
                  />
                  <CountPill
                    label="Unpaid"
                    value={invoiceStatusSnapshot?.unpaid_count ?? 0}
                  />
                  <CountPill
                    label="Provider failed"
                    value={invoiceStatusSnapshot?.xero_failed_count ?? 0}
                  />
                  <div className="rounded-2xl border border-border bg-white p-4 text-sm">
                    <div className="font-semibold">Posting mix</div>
                    <div className="mt-3 grid gap-2 text-muted-foreground">
                      {Object.entries(
                        invoiceStatusSnapshot?.posting_status_counts ?? {},
                      ).map(([status, count]) => (
                        <div
                          key={status}
                          className="flex items-center justify-between gap-3"
                        >
                          <span>{sentenceStatus(status)}</span>
                          <span className="font-semibold text-foreground">
                            {count}
                          </span>
                        </div>
                      ))}
                      {Object.keys(
                        invoiceStatusSnapshot?.posting_status_counts ?? {},
                      ).length === 0 ? (
                        <div>No invoice posting statuses</div>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="overflow-hidden rounded-2xl border border-border bg-white">
                  <div className="grid gap-1 px-4 py-3">
                    <div className="text-sm font-semibold">Invoice follow-up</div>
                    <div className="text-xs text-muted-foreground">
                      {invoiceStatusSnapshot?.overdue_count ?? 0} overdue;{" "}
                      {invoiceStatusSnapshot?.sent_count ?? 0} sent.
                    </div>
                  </div>
                  {(invoiceStatusSnapshot?.next_items ?? []).map((item) => (
                    <InvoiceStatusRow key={item.id} item={item} />
                  ))}
                  {(invoiceStatusSnapshot?.next_items.length ?? 0) === 0 ? (
                    <EmptyState
                      icon={<Receipt size={18} />}
                      title="No invoice follow-up"
                      description="Approved, unsent, unpaid, and posting-risk invoice drafts will appear here."
                    />
                  ) : null}
                </div>
              </div>
            </SectionPanel>

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
            </>
            ) : null}

            {activeTab === "operations" ? (
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
                    icon={<Clock3 size={18} />}
                    title="No upcoming lease events"
                    description="Rent reviews, expiries, obligations, and onboarding follow-ups will appear here."
                  />
                ) : null}
              </div>
            </SectionPanel>
            ) : null}

            {activeTab === "portfolio" ? (
            <>
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
                      icon={<Activity size={18} />}
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
