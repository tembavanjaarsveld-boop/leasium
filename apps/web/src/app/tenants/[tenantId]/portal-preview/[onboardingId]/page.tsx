"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  Download,
  FileText,
  Loader2,
  ReceiptText,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { AppHeader } from "@/components/app-shell";
import { QueryProvider } from "@/components/query-provider";
import {
  EmptyState,
  PageTitle,
  SectionPanel,
  StatusBadge,
} from "@/components/ui";
import {
  documentDownloadUrl,
  getTenantPortalOperatorPreview,
  TenantPortalDocumentRecord,
  TenantPortalRecord,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const LINK_BUTTON_CLASSES =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs transition hover:bg-muted";

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatMoney(cents: number, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function label(value: string) {
  return value.replaceAll("_", " ");
}

function onboardingStatusLabel(status: TenantPortalRecord["onboarding"]["status"]) {
  if (status === "reviewed") {
    return "In review";
  }
  return label(status);
}

function statusTone(status: string) {
  if (["paid", "received", "complete", "approved"].includes(status)) {
    return "success" as const;
  }
  if (["overdue", "expired", "missing"].includes(status)) {
    return "danger" as const;
  }
  if (["unpaid", "not_on_file", "sent", "requested"].includes(status)) {
    return "warning" as const;
  }
  return "neutral" as const;
}

function maintenanceStatusDetail(
  status: string,
  dueDate?: string | null,
  completedAt?: string | null,
) {
  if (status === "completed") {
    return completedAt
      ? `Completed ${formatDateTime(completedAt)}.`
      : "Completed by the property team.";
  }
  if (status === "cancelled") {
    return "Closed by the property team.";
  }
  if (status === "in_progress") {
    return "A contractor or property team member is working on this.";
  }
  if (status === "assigned") {
    return "Assigned to the right person or contractor.";
  }
  if (status === "awaiting_approval") {
    return "Waiting for property team approval before work starts.";
  }
  if (status === "approved") {
    return "Approved and waiting to be scheduled.";
  }
  if (status === "triaged") {
    return dueDate
      ? `Reviewed by the property team. Target date ${formatDate(dueDate)}.`
      : "Reviewed by the property team.";
  }
  return "Submitted to the property team.";
}

function Metric({
  label: metricLabel,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-white px-4 py-3">
      <div className="text-xs font-semibold uppercase text-muted-foreground">
        {metricLabel}
      </div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      {detail ? (
        <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
      ) : null}
    </div>
  );
}

function DocumentRow({ document }: { document: TenantPortalDocumentRecord }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm first:border-t-0">
      <div className="min-w-0">
        <div className="truncate font-medium">{document.filename}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {label(document.category)} · {label(document.source)} ·{" "}
          {formatDateTime(document.created_at)}
        </div>
      </div>
      <a
        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-white transition hover:bg-muted"
        href={documentDownloadUrl(document.id)}
        aria-label={`Download ${document.filename}`}
      >
        <Download size={15} />
      </a>
    </div>
  );
}

function PreviewLoaded({
  tenantId,
  portal,
}: {
  tenantId: string;
  portal: TenantPortalRecord;
}) {
  const tenantName = portal.tenant.trading_name || portal.tenant.legal_name;
  return (
    <main className="min-h-screen bg-background text-foreground">
      <AppHeader />
      <div className="mx-auto grid max-w-6xl gap-5 px-5 py-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link className="text-sm font-semibold text-primary" href={`/tenants/${tenantId}`}>
              <span className="inline-flex items-center gap-1">
                <ArrowLeft size={15} />
                Back to tenant
              </span>
            </Link>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <PageTitle>Tenant portal preview</PageTitle>
              <StatusBadge tone="primary">Operator preview</StatusBadge>
            </div>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {portal.auth.detail}
            </p>
          </div>
          <Link className={LINK_BUTTON_CLASSES} href={`/tenants/${tenantId}`}>
            <ShieldCheck size={15} />
            Tenant record
          </Link>
        </div>

        <section className="grid gap-3 rounded-2xl border border-primary/20 bg-primary-soft p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-primary-hover">
                {tenantName}
              </div>
              <h2 className="mt-1 text-2xl font-semibold">
                {portal.lease.property_name} - {portal.lease.unit_label}
              </h2>
              {portal.lease.property_address ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {portal.lease.property_address}
                </p>
              ) : null}
            </div>
            <StatusBadge tone={statusTone(portal.onboarding.status)}>
              {onboardingStatusLabel(portal.onboarding.status)}
            </StatusBadge>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <Metric
              label="Lease"
              value={label(portal.lease.status)}
              detail={`${formatDate(portal.lease.commencement_date)} to ${formatDate(
                portal.lease.expiry_date,
              )}`}
            />
            <Metric
              label="Next review"
              value={formatDate(portal.lease.next_review_date)}
            />
            <Metric
              label="Onboarding due"
              value={formatDate(portal.onboarding.due_date)}
            />
            <Metric
              label="Invite expires"
              value={formatDateTime(portal.onboarding.expires_at)}
            />
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="grid gap-5">
            <SectionPanel
              title="Checklist"
              icon={<CalendarClock size={17} className="text-primary" />}
            >
              <div className="grid gap-3 p-4">
                {portal.compliance.items.length ? (
                  portal.compliance.items.map((item) => (
                    <div
                      key={item.key}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-sm"
                    >
                      <div>
                        <div className="font-medium">{item.label}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {item.document_count} document
                          {item.document_count === 1 ? "" : "s"}
                          {item.due_date
                            ? ` · Due ${formatDate(item.due_date)}`
                            : ""}
                        </div>
                      </div>
                      <StatusBadge tone={statusTone(item.status)}>
                        {label(item.status)}
                      </StatusBadge>
                    </div>
                  ))
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium">Required documents</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        No required document checklist for this onboarding.
                      </div>
                    </div>
                    <StatusBadge tone="success">Not required</StatusBadge>
                  </div>
                )}
              </div>
            </SectionPanel>

            <SectionPanel
              title="Documents"
              icon={<FileText size={17} className="text-primary" />}
            >
              {portal.compliance.uploaded_documents.length ? (
                <div>
                  {portal.compliance.uploaded_documents.map((document) => (
                    <DocumentRow key={document.id} document={document} />
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<FileText size={18} />}
                  title="No documents visible"
                  description="Tenant-visible documents will appear here."
                />
              )}
            </SectionPanel>

            <SectionPanel
              title="Maintenance"
              icon={<Wrench size={17} className="text-primary" />}
            >
              {portal.maintenance_requests.length ? (
                <div className="divide-y divide-border">
                  {portal.maintenance_requests.map((request) => (
                    <div key={request.id} className="grid gap-2 px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-medium">{request.title}</div>
                        <StatusBadge tone={statusTone(request.status)}>
                          {label(request.status)}
                        </StatusBadge>
                      </div>
                      {request.description ? (
                        <p className="text-muted-foreground">
                          {request.description}
                        </p>
                      ) : null}
                      <p className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-muted-foreground">
                        {maintenanceStatusDetail(
                          request.status,
                          request.due_date,
                          request.completed_at,
                        )}
                      </p>
                      <div className="text-xs text-muted-foreground">
                        Requested {formatDateTime(request.requested_at)}
                        {request.due_date ? ` · Due ${formatDate(request.due_date)}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<Wrench size={18} />}
                  title="No tenant maintenance requests"
                />
              )}
            </SectionPanel>
          </div>

          <div className="grid content-start gap-5">
            <SectionPanel
              title="Payments"
              icon={<ReceiptText size={17} className="text-primary" />}
            >
              <div className="grid gap-3 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Metric
                    label="Outstanding"
                    value={formatMoney(
                      portal.payment_summary.outstanding_cents,
                    )}
                  />
                  <Metric
                    label="Invoices"
                    value={String(portal.payment_summary.invoice_count)}
                    detail={`${portal.payment_summary.overdue_count} overdue`}
                  />
                </div>
                {portal.invoices.map((invoice) => (
                  <div
                    key={invoice.id}
                    className="grid gap-2 rounded-xl border border-border px-3 py-2 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium">
                        {invoice.invoice_number ?? invoice.title}
                      </div>
                      <StatusBadge tone={statusTone(invoice.payment_status)}>
                        {label(invoice.payment_status)}
                      </StatusBadge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Due {formatDate(invoice.due_date)} ·{" "}
                      {formatMoney(invoice.outstanding_cents, invoice.currency)}{" "}
                      outstanding
                    </div>
                  </div>
                ))}
              </div>
            </SectionPanel>

            <SectionPanel
              title="Tenant contact"
              icon={<Building2 size={17} className="text-primary" />}
            >
              <dl className="grid gap-3 p-4 text-sm">
                {[
                  ["Primary contact", portal.tenant.contact_name],
                  ["Contact email", portal.tenant.contact_email],
                  ["Phone", portal.tenant.contact_phone],
                  ["Billing email", portal.tenant.billing_email],
                ].map(([term, value]) => (
                  <div key={term}>
                    <dt className="text-xs font-semibold uppercase text-muted-foreground">
                      {term}
                    </dt>
                    <dd className="mt-1">{value || "-"}</dd>
                  </div>
                ))}
              </dl>
            </SectionPanel>

            <SectionPanel title="Guardrails" icon={<ShieldCheck size={17} className="text-primary" />}>
              <ul className="grid gap-2 p-4 text-sm text-muted-foreground">
                {portal.guardrails.map((guardrail) => (
                  <li key={guardrail} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <span>{guardrail}</span>
                  </li>
                ))}
              </ul>
            </SectionPanel>
          </div>
        </div>
      </div>
    </main>
  );
}

function TenantPortalOperatorPreview() {
  const params = useParams<{ tenantId: string; onboardingId: string }>();
  const tenantId = params.tenantId;
  const onboardingId = params.onboardingId;
  const previewQuery = useQuery({
    queryKey: ["tenant-portal-operator-preview", onboardingId],
    queryFn: () => getTenantPortalOperatorPreview(onboardingId),
    enabled: Boolean(onboardingId),
  });

  if (previewQuery.isLoading) {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <AppHeader />
        <div className="grid min-h-[70vh] place-items-center">
          <Loader2 className="animate-spin text-primary" size={28} />
        </div>
      </main>
    );
  }

  if (previewQuery.error || !previewQuery.data) {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <AppHeader />
        <div className="mx-auto grid max-w-3xl gap-4 px-5 py-8">
          <Link className={cn(LINK_BUTTON_CLASSES, "justify-self-start")} href={`/tenants/${tenantId}`}>
            <ArrowLeft size={15} />
            Back to tenant
          </Link>
          <SectionPanel title="Preview unavailable">
            <EmptyState
              icon={<ShieldCheck size={18} />}
              title="Tenant portal preview is unavailable"
              description={
                previewQuery.error instanceof Error
                  ? previewQuery.error.message
                  : "Try again from the tenant record."
              }
            />
          </SectionPanel>
        </div>
      </main>
    );
  }

  return <PreviewLoaded tenantId={tenantId} portal={previewQuery.data} />;
}

export default function TenantPortalOperatorPreviewPage() {
  return (
    <QueryProvider>
      <TenantPortalOperatorPreview />
    </QueryProvider>
  );
}
