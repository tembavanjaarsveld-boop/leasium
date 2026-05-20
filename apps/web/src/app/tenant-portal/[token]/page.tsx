"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Bell,
  Building2,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  ReceiptText,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { LeasiumMark } from "@/components/brand";
import { QueryProvider } from "@/components/query-provider";
import {
  Button,
  Field,
  Input,
  Select,
  StatusBadge,
} from "@/components/ui";
import {
  DocumentCategory,
  getTenantPortal,
  tenantPortalDocumentDownloadUrl,
  TenantPortalNotificationPreferencesPayload,
  TenantPortalRecord,
  updateTenantPortalNotificationPreferences,
  uploadTenantPortalDocument,
} from "@/lib/api";

export default function TenantPortalPage() {
  return (
    <QueryProvider>
      <TenantPortalContent />
    </QueryProvider>
  );
}

const categoryLabels: Record<DocumentCategory, string> = {
  lease: "Lease",
  insurance: "Insurance",
  bank_guarantee: "Bank guarantee",
  onboarding: "Onboarding",
  invoice: "Invoice",
  other: "Other",
};

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
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

function formatBytes(bytes: number) {
  if (bytes < 1_000_000) {
    return `${Math.max(1, Math.round(bytes / 1_000))} KB`;
  }
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function label(value: string) {
  return value.replaceAll("_", " ");
}

function paymentTone(status: TenantPortalRecord["payment_summary"]["status"]) {
  if (status === "paid") {
    return "success" as const;
  }
  if (status === "overdue") {
    return "danger" as const;
  }
  if (status === "unpaid") {
    return "warning" as const;
  }
  return "neutral" as const;
}

function complianceTone(status: string) {
  if (status === "received") {
    return "success" as const;
  }
  if (status === "expired") {
    return "danger" as const;
  }
  if (status === "missing") {
    return "warning" as const;
  }
  return "neutral" as const;
}

function PortalShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-4">
          <LeasiumMark />
          <div>
            <h1 className="text-lg font-semibold">Leasium</h1>
            <p className="text-sm text-muted-foreground">Tenant portal</p>
          </div>
        </div>
      </header>
      {children}
    </main>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-white px-4 py-3">
      <div className="text-xs font-semibold uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      {detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}
    </div>
  );
}

function Panel({
  title,
  icon,
  actions,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-primary">{icon}</span>
          <h2 className="text-base font-semibold">{title}</h2>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function PreferencesForm({
  token,
  portal,
  onSaved,
}: {
  token: string;
  portal: TenantPortalRecord;
  onSaved: () => void;
}) {
  const [preferences, setPreferences] =
    useState<TenantPortalNotificationPreferencesPayload>(
      portal.notification_preferences,
    );

  useEffect(() => {
    setPreferences(portal.notification_preferences);
  }, [portal.notification_preferences]);

  const saveMutation = useMutation({
    mutationFn: () => updateTenantPortalNotificationPreferences(token, preferences),
    onSuccess: onSaved,
  });

  function setField<K extends keyof TenantPortalNotificationPreferencesPayload>(
    field: K,
    value: boolean,
  ) {
    setPreferences((current) => ({ ...current, [field]: value }));
  }

  return (
    <Panel
      title="Notification Preferences"
      icon={<Bell size={18} />}
      actions={
        <StatusBadge tone="neutral">
          {label(portal.notification_preferences.preferred_channel)}
        </StatusBadge>
      }
    >
      <div className="grid gap-3 p-4">
        {[
          ["email_enabled", "Email updates"],
          ["sms_enabled", "SMS updates"],
          ["billing_email_enabled", "Billing notices"],
          ["compliance_reminders_enabled", "Compliance reminders"],
        ].map(([key, text]) => (
          <label
            key={key}
            className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
          >
            <span>{text}</span>
            <input
              className="h-4 w-4 accent-primary"
              type="checkbox"
              checked={Boolean(
                preferences[key as keyof TenantPortalNotificationPreferencesPayload],
              )}
              onChange={(event) =>
                setField(
                  key as keyof TenantPortalNotificationPreferencesPayload,
                  event.target.checked,
                )
              }
            />
          </label>
        ))}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {saveMutation.error ? (
            <span className="text-sm text-danger">{saveMutation.error.message}</span>
          ) : null}
          <Button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <CheckCircle2 size={16} />
            )}
            Save
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function TenantPortalContent() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const portalQuery = useQuery({
    queryKey: ["tenant-portal", token],
    queryFn: () => getTenantPortal(token),
    enabled: Boolean(token),
  });
  const portal = portalQuery.data;
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadCategory, setUploadCategory] = useState<DocumentCategory>("insurance");
  const [uploadNotes, setUploadNotes] = useState("");

  useEffect(() => {
    if (!portal || portal.compliance.accepted_categories.includes(uploadCategory)) {
      return;
    }
    setUploadCategory(portal.compliance.accepted_categories[0] ?? "insurance");
  }, [portal, uploadCategory]);

  const uploadMutation = useMutation({
    mutationFn: () => {
      if (!uploadFile) {
        throw new Error("Choose a file first.");
      }
      return uploadTenantPortalDocument({
        token,
        category: uploadCategory,
        notes: uploadNotes,
        file: uploadFile,
      });
    },
    onSuccess: () => {
      setUploadFile(null);
      setUploadNotes("");
      portalQuery.refetch();
    },
  });

  const visibleCategories = useMemo(
    () =>
      (portal?.compliance.accepted_categories ?? []).filter(
        (category) => category !== "invoice",
      ),
    [portal?.compliance.accepted_categories],
  );

  if (portalQuery.isLoading) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6">
        <Loader2 className="animate-spin text-primary" size={28} />
      </main>
    );
  }

  if (portalQuery.error || !portal) {
    return (
      <PortalShell>
        <div className="grid min-h-[70vh] place-items-center px-5 py-8">
          <div className="max-w-md rounded-md border border-border bg-white p-6 text-center">
            <LeasiumMark className="mx-auto mb-4" />
            <h2 className="text-lg font-semibold">Portal unavailable</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Ask the property team for a fresh tenant portal link.
            </p>
          </div>
        </div>
      </PortalShell>
    );
  }

  return (
    <PortalShell>
      <div className="mx-auto grid max-w-6xl gap-5 px-5 py-6">
        <section className="rounded-md border border-border bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-primary">Tenant Portal</p>
              <h2 className="mt-1 text-2xl font-semibold">
                {portal.tenant.trading_name || portal.tenant.legal_name}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {portal.lease.property_name} - {portal.lease.unit_label}
              </p>
            </div>
            <div className="grid gap-2 text-right">
              <StatusBadge tone={portal.auth.dev_fallback ? "warning" : "primary"}>
                {portal.auth.dev_fallback ? "Token fallback" : "Token scoped"}
              </StatusBadge>
              <span className="text-xs text-muted-foreground">
                {portal.auth.boundary}
              </span>
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-4">
          <Metric
            label="Onboarding"
            value={label(portal.onboarding.status)}
            detail={
              portal.onboarding.submitted_at
                ? `Submitted ${formatDateTime(portal.onboarding.submitted_at)}`
                : portal.onboarding.due_date
                  ? `Due ${formatDate(portal.onboarding.due_date)}`
                  : undefined
            }
          />
          <Metric
            label="Outstanding"
            value={formatMoney(portal.payment_summary.outstanding_cents)}
            detail={`${portal.payment_summary.invoice_count} invoice${
              portal.payment_summary.invoice_count === 1 ? "" : "s"
            }`}
          />
          <Metric
            label="Next Due"
            value={formatDate(portal.payment_summary.next_due_date)}
            detail={label(portal.payment_summary.status)}
          />
          <Metric
            label="Documents"
            value={String(portal.compliance.uploaded_documents.length)}
            detail="Tenant files"
          />
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid gap-5">
            <Panel
              title="Payments"
              icon={<ReceiptText size={18} />}
              actions={
                <StatusBadge tone={paymentTone(portal.payment_summary.status)}>
                  {label(portal.payment_summary.status)}
                </StatusBadge>
              }
            >
              <div className="grid gap-3 p-4">
                {portal.invoices.map((invoice) => (
                  <div
                    key={invoice.id}
                    className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate font-semibold">
                          {invoice.invoice_number ?? invoice.title}
                        </div>
                        <StatusBadge tone={invoice.outstanding_cents ? "warning" : "success"}>
                          {label(invoice.payment_status)}
                        </StatusBadge>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        Due {formatDate(invoice.due_date)} - Total{" "}
                        {formatMoney(invoice.total_cents, invoice.currency)}
                      </div>
                      {invoice.invoice_number ? (
                        <div className="mt-1 text-sm">{invoice.title}</div>
                      ) : null}
                      {invoice.lines.length ? (
                        <div className="mt-3 grid gap-1 text-sm">
                          {invoice.lines.map((line) => (
                            <div
                              key={line.id}
                              className="flex items-center justify-between gap-3"
                            >
                              <span className="truncate">{line.description}</span>
                              <span className="shrink-0">
                                {formatMoney(
                                  line.amount_cents + line.gst_cents,
                                  line.currency,
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="grid content-start justify-items-end gap-2 text-sm">
                      <div className="font-semibold">
                        {formatMoney(invoice.outstanding_cents, invoice.currency)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatMoney(invoice.paid_cents, invoice.currency)} paid
                      </div>
                      {invoice.pdf_document_id ? (
                        <a
                          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-semibold hover:bg-muted"
                          href={tenantPortalDocumentDownloadUrl(
                            token,
                            invoice.pdf_document_id,
                          )}
                        >
                          <Download size={15} />
                          PDF
                        </a>
                      ) : null}
                    </div>
                  </div>
                ))}
                {!portal.invoices.length ? (
                  <div className="rounded-md border border-border bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
                    No approved invoices are available.
                  </div>
                ) : null}
              </div>
            </Panel>

            <Panel title="Compliance" icon={<ShieldCheck size={18} />}>
              <div className="grid gap-3 p-4">
                <div className="grid gap-3 md:grid-cols-3">
                  {portal.compliance.items.map((item) => (
                    <div key={item.key} className="rounded-md border border-border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold">{item.label}</div>
                        <StatusBadge tone={complianceTone(item.status)}>
                          {label(item.status)}
                        </StatusBadge>
                      </div>
                      <div className="mt-2 text-sm text-muted-foreground">
                        {item.document_count} file{item.document_count === 1 ? "" : "s"}
                        {item.due_date ? ` - ${formatDate(item.due_date)}` : ""}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid gap-3 rounded-md border border-border bg-muted/30 p-3">
                  <Field label="Document">
                    <Input
                      type="file"
                      onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                    />
                  </Field>
                  <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
                    <Field label="Type">
                      <Select
                        value={uploadCategory}
                        onChange={(event) =>
                          setUploadCategory(event.target.value as DocumentCategory)
                        }
                      >
                        {visibleCategories.map((category) => (
                          <option key={category} value={category}>
                            {categoryLabels[category]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Notes">
                      <Input
                        value={uploadNotes}
                        onChange={(event) => setUploadNotes(event.target.value)}
                      />
                    </Field>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {uploadMutation.error ? (
                      <span className="text-sm text-danger">
                        {uploadMutation.error.message}
                      </span>
                    ) : null}
                    <Button
                      type="button"
                      onClick={() => uploadMutation.mutate()}
                      disabled={!uploadFile || uploadMutation.isPending}
                    >
                      {uploadMutation.isPending ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <UploadCloud size={16} />
                      )}
                      Upload
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2">
                  {portal.compliance.uploaded_documents.map((document) => (
                    <a
                      key={document.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
                      href={tenantPortalDocumentDownloadUrl(token, document.id)}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <FileText size={15} className="shrink-0 text-primary" />
                        <span className="truncate">{document.filename}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        {categoryLabels[document.category]} - {formatBytes(document.byte_size)}
                        <Download size={14} />
                      </span>
                    </a>
                  ))}
                  {!portal.compliance.uploaded_documents.length ? (
                    <div className="rounded-md border border-border bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
                      No tenant documents are available.
                    </div>
                  ) : null}
                </div>
              </div>
            </Panel>
          </div>

          <aside className="grid content-start gap-5">
            <Panel title="Lease" icon={<Building2 size={18} />}>
              <dl className="grid gap-3 p-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Property</dt>
                  <dd className="font-medium">{portal.lease.property_name}</dd>
                  {portal.lease.property_address ? (
                    <dd className="text-muted-foreground">{portal.lease.property_address}</dd>
                  ) : null}
                </div>
                <div>
                  <dt className="text-muted-foreground">Unit</dt>
                  <dd className="font-medium">{portal.lease.unit_label}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Lease dates</dt>
                  <dd className="font-medium">
                    {formatDate(portal.lease.commencement_date)} to{" "}
                    {formatDate(portal.lease.expiry_date)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Next review</dt>
                  <dd className="font-medium">
                    {formatDate(portal.lease.next_review_date)}
                  </dd>
                </div>
              </dl>
            </Panel>

            <PreferencesForm
              token={token}
              portal={portal}
              onSaved={() => portalQuery.refetch()}
            />

            <Panel
              title="Access Boundary"
              icon={<ShieldCheck size={18} />}
              actions={
                <StatusBadge tone={portal.auth.dev_fallback ? "warning" : "primary"}>
                  {label(portal.auth.mode)}
                </StatusBadge>
              }
            >
              <div className="grid gap-2 p-4 text-sm text-muted-foreground">
                <p>{portal.auth.detail}</p>
                {portal.guardrails.map((guardrail) => (
                  <p key={guardrail}>{guardrail}</p>
                ))}
              </div>
            </Panel>
          </aside>
        </div>
      </div>
    </PortalShell>
  );
}
