"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarClock,
  Clock3,
  Copy,
  Download,
  FileText,
  Loader2,
  MessageSquare,
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
  SecondaryButton,
  SectionPanel,
  StatusBadge,
} from "@/components/ui";
import {
  ApiError,
  documentDownloadUrl,
  getTenantPortalOperatorPreview,
  TenantPortalDocumentRecord,
  TenantPortalRecord,
} from "@/lib/api";
import { saveBlob } from "@/lib/download";
import { cn, friendlyError } from "@/lib/utils";

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

function maintenanceEventLabel(value: string) {
  if (value === "tenant_submitted") {
    return "Request submitted";
  }
  if (value === "comment_added") {
    return "Team update";
  }
  return label(value);
}

function csvCell(value: string | number | null | undefined) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function slugifyFilename(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const PORTAL_PREVIEW_EXPORT_GUARDRAIL =
  "Review-only export: downloading this file does not create tenant portal accounts, send portal invites, submit tenant details, apply or dismiss contact changes, send email or SMS, upload or delete documents, fetch document bytes, write Xero data, dispatch providers, refresh providers, or mutate provider history.";

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

function isNotFoundError(error: unknown) {
  return error instanceof ApiError && error.status === 404;
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

type TenantPortalPreviewActivityItem = {
  key: string;
  title: string;
  detail: string;
  timestamp: string;
  tone: "primary" | "success" | "warning" | "danger" | "neutral";
};

function buildTenantPortalPreviewActivity(portal: TenantPortalRecord) {
  const items: TenantPortalPreviewActivityItem[] = [];

  function addActivity(item: TenantPortalPreviewActivityItem | null) {
    if (item?.timestamp) {
      items.push(item);
    }
  }

  addActivity(
    portal.onboarding.submitted_at
      ? {
          key: `onboarding-${portal.onboarding.id}`,
          title: "Onboarding sent",
          detail: "Tenant details were sent to the property team for review.",
          timestamp: portal.onboarding.submitted_at,
          tone: "primary",
        }
      : portal.onboarding.last_sent_at
        ? {
            key: `invite-${portal.onboarding.id}`,
            title: "Portal invite sent",
            detail: "The property team sent this tenant portal invite.",
            timestamp: portal.onboarding.last_sent_at,
            tone: "neutral",
          }
        : null,
  );

  addActivity(
    portal.lease_agreement.signed_at
      ? {
          key: "lease-signed",
          title: "Lease signed",
          detail: "The lease pack has been signed.",
          timestamp: portal.lease_agreement.signed_at,
          tone: "success",
        }
      : null,
  );

  portal.lease_agreement.questions.forEach((question) => {
    addActivity(
      question.answered_at
        ? {
            key: `lease-question-answered-${question.id}`,
            title: "Lease question answered",
            detail: question.clause_reference
              ? `The team responded to the question about ${question.clause_reference}.`
              : "The team responded to a lease question.",
            timestamp: question.answered_at,
            tone: "success",
          }
        : question.asked_at
          ? {
              key: `lease-question-asked-${question.id}`,
              title: "Lease question sent",
              detail: question.clause_reference
                ? `Question raised for ${question.clause_reference}.`
                : "A lease question was sent to the property team.",
              timestamp: question.asked_at,
              tone: "warning",
            }
          : null,
    );
  });

  portal.compliance.uploaded_documents.forEach((document) => {
    addActivity({
      key: `document-${document.id}`,
      title: "Document uploaded",
      detail: `${document.filename} - ${label(document.category)}.`,
      timestamp: document.created_at,
      tone: "success",
    });
  });

  portal.maintenance_requests.forEach((request) => {
    if (request.history.length) {
      request.history.forEach((entry, index) => {
        addActivity({
          key: `maintenance-history-${request.id}-${index}`,
          title: maintenanceEventLabel(entry.event),
          detail: `${request.title} - ${entry.summary}`,
          timestamp: entry.timestamp,
          tone:
            entry.status === "completed"
              ? "success"
              : entry.status === "cancelled"
                ? "neutral"
                : "primary",
        });
      });
      return;
    }

    addActivity({
      key: `maintenance-${request.id}`,
      title: "Maintenance request sent",
      detail: request.title,
      timestamp: request.requested_at,
      tone: "primary",
    });
  });

  portal.contact_change_requests.forEach((request) => {
    addActivity(
      request.applied_at
        ? {
            key: `contact-change-applied-${request.id}`,
            title: "Contact details updated",
            detail: "Saved contact details were updated.",
            timestamp: request.applied_at,
            tone: "success",
          }
        : request.dismissed_at
          ? {
              key: `contact-change-dismissed-${request.id}`,
              title: "Contact request closed",
              detail:
                "The property team reviewed the contact detail request and left saved details unchanged.",
              timestamp: request.dismissed_at,
              tone: "neutral",
            }
          : request.submitted_at
            ? {
                key: `contact-change-submitted-${request.id}`,
                title: "Contact request sent",
                detail:
                  "Requested contact detail changes are with the property team.",
                timestamp: request.submitted_at,
                tone: "warning",
              }
            : null,
    );
  });

  addActivity(
    portal.notification_preferences.updated_at
      ? {
          key: "notification-preferences",
          title: "Preferences saved",
          detail: "Your portal notification preferences were updated.",
          timestamp: portal.notification_preferences.updated_at,
          tone: "neutral",
        }
      : null,
  );

  return items
    .sort(
      (left, right) =>
        new Date(right.timestamp).getTime() -
        new Date(left.timestamp).getTime(),
    )
    .slice(0, 6);
}

function tenantPortalPreviewActivitySummary(
  activities: TenantPortalPreviewActivityItem[],
) {
  if (!activities.length) {
    return "Tenant portal activity summary\nNo recent portal activity is available yet.";
  }
  return [
    "Tenant portal activity summary",
    `${activities.length} recent portal update${
      activities.length === 1 ? "" : "s"
    }`,
    "",
    ...activities.map(
      (activity) =>
        `- ${formatDateTime(activity.timestamp)} | ${activity.title} | ${
          activity.detail
        }`,
    ),
  ].join("\n");
}

function tenantPortalPreviewCsv(portal: TenantPortalRecord) {
  const tenantName = portal.tenant.trading_name || portal.tenant.legal_name;
  const recentActivity = buildTenantPortalPreviewActivity(portal);
  const rows: Array<Array<string | number | null | undefined>> = [
    ["Category", "Item", "Status", "Count", "Amount", "Detail", "Guardrail"],
    [
      "Operator preview",
      tenantName,
      portal.auth.mode,
      "",
      "",
      portal.auth.detail,
      PORTAL_PREVIEW_EXPORT_GUARDRAIL,
    ],
    [
      "Lease",
      `${portal.lease.property_name} - ${portal.lease.unit_label}`,
      portal.lease.status,
      "",
      "",
      `${formatDate(portal.lease.commencement_date)} to ${formatDate(
        portal.lease.expiry_date,
      )}; next review ${formatDate(portal.lease.next_review_date)}.`,
      PORTAL_PREVIEW_EXPORT_GUARDRAIL,
    ],
    [
      "Onboarding",
      portal.onboarding.id,
      onboardingStatusLabel(portal.onboarding.status),
      portal.onboarding.document_count,
      "",
      `Due ${formatDate(portal.onboarding.due_date)}; invite expires ${formatDateTime(
        portal.onboarding.expires_at,
      )}.`,
      PORTAL_PREVIEW_EXPORT_GUARDRAIL,
    ],
    ...portal.compliance.items.map((item) => [
      "Checklist",
      item.label,
      label(item.status),
      item.document_count,
      "",
      item.due_date ? `Due ${formatDate(item.due_date)}.` : "No due date.",
      PORTAL_PREVIEW_EXPORT_GUARDRAIL,
    ]),
    ...(portal.compliance.items.length
      ? []
      : [
          [
            "Checklist",
            "Required documents",
            "Not required",
            0,
            "",
            "No required document checklist for this onboarding.",
            PORTAL_PREVIEW_EXPORT_GUARDRAIL,
          ],
        ]),
    ...portal.compliance.uploaded_documents.map((document) => [
      "Document",
      document.filename,
      label(document.category),
      document.byte_size,
      "",
      `${label(document.source)}; uploaded ${formatDateTime(document.created_at)}.`,
      PORTAL_PREVIEW_EXPORT_GUARDRAIL,
    ]),
    [
      "Payment summary",
      "Visible tenant invoices",
      label(portal.payment_summary.status),
      portal.payment_summary.invoice_count,
      formatMoney(portal.payment_summary.outstanding_cents),
      `${portal.payment_summary.overdue_count} overdue; manual only ${portal.payment_summary.manual_only ? "yes" : "no"}.`,
      PORTAL_PREVIEW_EXPORT_GUARDRAIL,
    ],
    ...portal.invoices.map((invoice) => [
      "Invoice",
      invoice.invoice_number ?? invoice.title,
      label(invoice.payment_status),
      invoice.lines.length,
      formatMoney(invoice.outstanding_cents, invoice.currency),
      `Due ${formatDate(invoice.due_date)}; total ${formatMoney(
        invoice.total_cents,
        invoice.currency,
      )}; paid ${formatMoney(invoice.paid_cents, invoice.currency)}.`,
      PORTAL_PREVIEW_EXPORT_GUARDRAIL,
    ]),
    ...portal.maintenance_requests.map((request) => [
      "Maintenance",
      request.title,
      label(request.status),
      request.document_ids.length + request.photo_document_ids.length,
      "",
      `${request.description ?? maintenanceStatusDetail(
        request.status,
        request.due_date,
        request.completed_at,
      )} Requested ${formatDateTime(request.requested_at)}.`,
      PORTAL_PREVIEW_EXPORT_GUARDRAIL,
    ]),
    ...portal.contact_change_requests.flatMap((request) => [
      [
        "Contact change request",
        request.id,
        label(request.status),
        request.changes.length,
        "",
        request.notes ?? `Submitted ${formatDateTime(request.submitted_at)}.`,
        PORTAL_PREVIEW_EXPORT_GUARDRAIL,
      ],
      ...request.changes.map((change) => [
        "Contact change request",
        change.label,
        label(request.status),
        "",
        "",
        String(change.after ?? "-"),
        PORTAL_PREVIEW_EXPORT_GUARDRAIL,
      ]),
    ]),
    ...recentActivity.map((activity) => [
      "Recent Activity",
      activity.title,
      label(activity.tone),
      "",
      "",
      `${formatDateTime(activity.timestamp)}; ${activity.detail}`,
      PORTAL_PREVIEW_EXPORT_GUARDRAIL,
    ]),
    ...portal.guardrails.map((guardrail) => [
      "Preview guardrail",
      guardrail,
      "Read-only",
      "",
      "",
      guardrail,
      PORTAL_PREVIEW_EXPORT_GUARDRAIL,
    ]),
    [
      "Export guardrail",
      "",
      "Review-only",
      "",
      "",
      PORTAL_PREVIEW_EXPORT_GUARDRAIL,
      PORTAL_PREVIEW_EXPORT_GUARDRAIL,
    ],
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
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

function RecentActivityPanel({
  activities,
}: {
  activities: TenantPortalPreviewActivityItem[];
}) {
  const latestActivity = activities[0] ?? null;
  const copyActivitySummary = () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    void navigator.clipboard.writeText(
      tenantPortalPreviewActivitySummary(activities),
    );
  };

  return (
    <SectionPanel
      title="Recent Activity"
      icon={<Clock3 size={17} className="text-primary" />}
      actions={
        <SecondaryButton
          type="button"
          onClick={copyActivitySummary}
          className="min-h-9 rounded-xl px-3"
        >
          <Copy size={15} />
          Copy summary
        </SecondaryButton>
      }
    >
      <div className="grid gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm">
          <span className="font-medium">Activity rows</span>
          <StatusBadge tone={latestActivity?.tone ?? "neutral"}>
            {activities.length} event{activities.length === 1 ? "" : "s"}
          </StatusBadge>
        </div>
        {activities.length ? (
          activities.map((activity) => (
            <div key={activity.key} className="grid gap-1 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">{activity.title}</div>
                <StatusBadge tone={activity.tone}>
                  {formatDate(activity.timestamp)}
                </StatusBadge>
              </div>
              <p className="text-muted-foreground">{activity.detail}</p>
            </div>
          ))
        ) : (
          <div className="rounded-xl border border-border bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
            Activity will appear here as the tenant portal updates.
          </div>
        )}
      </div>
    </SectionPanel>
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
  const latestContactRequest = portal.contact_change_requests[0] ?? null;
  const recentActivity = buildTenantPortalPreviewActivity(portal);
  const downloadPreviewCsv = () => {
    const filenameName = slugifyFilename(tenantName || "tenant");
    saveBlob(
      new Blob([tenantPortalPreviewCsv(portal)], {
        type: "text/csv;charset=utf-8",
      }),
      `tenant-portal-preview-${filenameName}.csv`,
    );
  };
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
          <div className="flex flex-wrap gap-2">
            <SecondaryButton
              type="button"
              onClick={downloadPreviewCsv}
              className="min-h-10 rounded-xl px-3"
            >
              <Download size={15} />
              Download preview CSV
            </SecondaryButton>
            <Link className={LINK_BUTTON_CLASSES} href={`/tenants/${tenantId}`}>
              <ShieldCheck size={15} />
              Tenant record
            </Link>
          </div>
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
            <RecentActivityPanel activities={recentActivity} />

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
              <div className="grid gap-3 p-4 text-sm">
                <dl className="grid gap-3">
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
                {latestContactRequest ? (
                  <div className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-medium">
                        <MessageSquare size={15} className="text-primary" />
                        Contact change request
                      </div>
                      <StatusBadge
                        tone={
                          latestContactRequest.status === "submitted"
                            ? "warning"
                            : statusTone(latestContactRequest.status)
                        }
                      >
                        {label(latestContactRequest.status)}
                      </StatusBadge>
                    </div>
                    <div className="grid gap-1 text-xs text-muted-foreground">
                      {latestContactRequest.changes.map((change) => (
                        <div key={change.field}>
                          <span className="font-medium text-foreground">
                            {change.label}
                          </span>
                          : {String(change.after ?? "-")}
                        </div>
                      ))}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {latestContactRequest.applied_at
                        ? `Applied ${formatDateTime(latestContactRequest.applied_at)}`
                        : latestContactRequest.dismissed_at
                          ? `Closed ${formatDateTime(latestContactRequest.dismissed_at)}`
                          : `Submitted ${formatDateTime(latestContactRequest.submitted_at)}`}
                    </div>
                  </div>
                ) : null}
              </div>
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
    refetchOnMount: "always",
    retry: false,
    staleTime: 0,
  });
  const previewNotFound = isNotFoundError(previewQuery.error);

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
          <SectionPanel
            title={
              previewNotFound
                ? "Tenant portal preview not found"
                : "Tenant portal preview unavailable"
            }
          >
            <EmptyState
              icon={<AlertTriangle size={18} />}
              title={
                previewNotFound
                  ? "Tenant portal preview not found"
                  : "Tenant portal preview unavailable"
              }
              description={
                previewNotFound
                  ? "This tenant portal preview may have been deleted or moved. Return to the tenant record to choose another onboarding."
                  : previewQuery.error
                    ? friendlyError(previewQuery.error)
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
