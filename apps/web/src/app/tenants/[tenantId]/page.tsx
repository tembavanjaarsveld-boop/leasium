"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  ClipboardCopy,
  Edit3,
  FileText,
  Link2,
  Plus,
  Save,
  ShieldCheck,
  X,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { QueryProvider } from "@/components/query-provider";
import {
  Button,
  EmptyState,
  Field,
  Input,
  SecondaryButton,
  SectionPanel,
  StatusBadge,
} from "@/components/ui";
import {
  cancelTenantOnboarding,
  applyTenantOnboarding,
  createTenantOnboarding,
  getTenant,
  listLeasesByTenant,
  listTenantOnboardings,
  resendTenantOnboarding,
  reviewTenantOnboarding,
  TenantPayload,
  TenantRecord,
  updateTenant,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type TenantForm = {
  legal_name: string;
  trading_name: string;
  abn: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  billing_email: string;
  notes: string;
};

function formFromTenant(tenant: TenantRecord): TenantForm {
  return {
    legal_name: tenant.legal_name,
    trading_name: tenant.trading_name ?? "",
    abn: tenant.abn ?? "",
    contact_name: tenant.contact_name ?? "",
    contact_email: tenant.contact_email ?? "",
    contact_phone: tenant.contact_phone ?? "",
    billing_email: tenant.billing_email ?? "",
    notes: tenant.notes ?? "",
  };
}

function cleanText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function tenantName(tenant: TenantRecord) {
  return tenant.trading_name
    ? `${tenant.trading_name} (${tenant.legal_name})`
    : tenant.legal_name;
}

function friendlyError(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

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

function dateOnly(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dueRank(value: string | null | undefined) {
  if (!value) {
    return 9999;
  }
  const today = new Date(dateOnly(new Date())).getTime();
  const due = new Date(`${value.slice(0, 10)}T00:00:00`).getTime();
  return Math.ceil((due - today) / 86_400_000);
}

function statusTone(status: string, dueDate?: string | null) {
  if (status === "submitted") {
    return "success" as const;
  }
  if (status === "cancelled") {
    return "neutral" as const;
  }
  if (dueRank(dueDate) < 0) {
    return "danger" as const;
  }
  return status === "sent" ? ("primary" as const) : ("warning" as const);
}

function TenantDetail() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId;
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<TenantForm | null>(null);

  const tenantQuery = useQuery({
    queryKey: ["tenant", tenantId],
    queryFn: () => getTenant(tenantId),
    enabled: Boolean(tenantId),
  });

  const leasesQuery = useQuery({
    queryKey: ["tenant-leases", tenantId],
    queryFn: () => listLeasesByTenant(tenantId),
    enabled: Boolean(tenantId),
  });

  const onboardingQuery = useQuery({
    queryKey: ["tenant-onboardings", tenantQuery.data?.entity_id],
    queryFn: () => listTenantOnboardings(tenantQuery.data!.entity_id),
    enabled: Boolean(tenantQuery.data?.entity_id),
  });

  const tenant = tenantQuery.data;
  const tenantOnboardings = (onboardingQuery.data ?? [])
    .filter((item) => item.tenant_id === tenantId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const updateMutation = useMutation({
    mutationFn: (values: TenantForm) => {
      const payload: Partial<TenantPayload> = {
        legal_name: values.legal_name.trim(),
        trading_name: cleanText(values.trading_name),
        abn: cleanText(values.abn),
        contact_name: cleanText(values.contact_name),
        contact_email: cleanText(values.contact_email),
        contact_phone: cleanText(values.contact_phone),
        billing_email: cleanText(values.billing_email),
        notes: cleanText(values.notes),
      };
      return updateTenant(tenantId, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      setEditing(false);
    },
  });

  const createOnboardingMutation = useMutation({
    mutationFn: (leaseId: string) =>
      createTenantOnboarding({
        lease_id: leaseId,
        due_date: dateOnly(new Date(Date.now() + 7 * 86_400_000)),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-onboardings", tenant?.entity_id] });
    },
  });

  const cancelOnboardingMutation = useMutation({
    mutationFn: cancelTenantOnboarding,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-onboardings", tenant?.entity_id] });
    },
  });

  const resendOnboardingMutation = useMutation({
    mutationFn: resendTenantOnboarding,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-onboardings", tenant?.entity_id] });
    },
  });

  const reviewOnboardingMutation = useMutation({
    mutationFn: (onboardingId: string) =>
      reviewTenantOnboarding(onboardingId, {
        approved: true,
        notes: "Reviewed in Leasium tenant workspace.",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-onboardings", tenant?.entity_id] });
    },
  });

  const applyOnboardingMutation = useMutation({
    mutationFn: applyTenantOnboarding,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-onboardings", tenant?.entity_id] });
      queryClient.invalidateQueries({ queryKey: ["tenant", tenantId] });
    },
  });

  function startEdit() {
    if (!tenant) {
      return;
    }
    setForm(formFromTenant(tenant));
    setEditing(true);
  }

  function updateField(field: keyof TenantForm, value: string) {
    setForm((current) => (current ? { ...current, [field]: value } : current));
  }

  function submitForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form?.legal_name.trim()) {
      return;
    }
    updateMutation.mutate(form);
  }

  if (tenantQuery.isLoading) {
    return (
      <main className="min-h-screen">
        <AppHeader />
        <div className="mx-auto max-w-7xl px-5 py-5">
          <SectionPanel>
            <EmptyState title="Loading tenant" />
          </SectionPanel>
        </div>
      </main>
    );
  }

  if (!tenant) {
    return (
      <main className="min-h-screen">
        <AppHeader />
        <div className="mx-auto max-w-7xl px-5 py-5">
          <SectionPanel>
            <EmptyState title="Tenant not found" action={<Link href="/tenants"><SecondaryButton type="button">Back to tenants</SecondaryButton></Link>} />
          </SectionPanel>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <AppHeader />

      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-5">
        <section className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/tenants" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft size={14} />
              Tenants
            </Link>
            <h2 className="text-xl font-semibold">{tenantName(tenant)}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Contact, billing, onboarding, documents, and lease history.
            </p>
          </div>
          <SecondaryButton type="button" onClick={startEdit}>
            <Edit3 size={15} />
            Edit profile
          </SecondaryButton>
        </section>

        {editing && form ? (
          <SectionPanel
            title="Edit tenant profile"
            description="Keep admin changes focused, then return to the profile."
            actions={
              <SecondaryButton type="button" onClick={() => setEditing(false)} className="h-8 w-8 px-0" aria-label="Close edit">
                <X size={15} />
              </SecondaryButton>
            }
          >
            <form className="grid gap-3 p-4 md:grid-cols-2" onSubmit={submitForm}>
              <Field label="Legal name">
                <Input value={form.legal_name} onChange={(event) => updateField("legal_name", event.target.value)} />
              </Field>
              <Field label="Trading as">
                <Input value={form.trading_name} onChange={(event) => updateField("trading_name", event.target.value)} />
              </Field>
              <Field label="ABN">
                <Input value={form.abn} onChange={(event) => updateField("abn", event.target.value)} />
              </Field>
              <Field label="Contact">
                <Input value={form.contact_name} onChange={(event) => updateField("contact_name", event.target.value)} />
              </Field>
              <Field label="Contact email">
                <Input type="email" value={form.contact_email} onChange={(event) => updateField("contact_email", event.target.value)} />
              </Field>
              <Field label="Billing email">
                <Input type="email" value={form.billing_email} onChange={(event) => updateField("billing_email", event.target.value)} />
              </Field>
              <Field label="Phone">
                <Input value={form.contact_phone} onChange={(event) => updateField("contact_phone", event.target.value)} />
              </Field>
              <Field label="Notes">
                <Input value={form.notes} onChange={(event) => updateField("notes", event.target.value)} />
              </Field>
              <div className="md:col-span-2">
                <Button type="submit" disabled={!form.legal_name.trim() || updateMutation.isPending}>
                  <Save size={16} />
                  Save profile
                </Button>
                {updateMutation.error ? (
                  <p className="mt-2 text-sm text-danger">{friendlyError(updateMutation.error)}</p>
                ) : null}
              </div>
            </form>
          </SectionPanel>
        ) : null}

        <section className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <div className="grid gap-5">
            <SectionPanel title="Profile" icon={<UserRound size={17} />}>
              <dl className="grid gap-3 p-4 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Legal name</dt>
                  <dd className="font-medium">{tenant.legal_name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Trading as</dt>
                  <dd>{tenant.trading_name ?? "-"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">ABN</dt>
                  <dd>{tenant.abn ?? "-"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Primary contact</dt>
                  <dd>{tenant.contact_name ?? "-"}</dd>
                  <dd className="text-muted-foreground">{tenant.contact_email ?? tenant.contact_phone ?? "-"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Billing email</dt>
                  <dd>{tenant.billing_email ?? tenant.contact_email ?? "-"}</dd>
                </div>
              </dl>
            </SectionPanel>

            <SectionPanel title="Documents" icon={<FileText size={17} />}>
              <EmptyState
                title="Document storage is next"
                description="Insurance certificates, guarantees, signed leases, and onboarding uploads will live here."
              />
            </SectionPanel>
          </div>

          <div className="grid gap-5">
            <SectionPanel title="Onboarding workflow" icon={<ShieldCheck size={17} />}>
              <div className="divide-y divide-border">
                {tenantOnboardings.map((item) => (
                  <div key={item.id} className="grid gap-3 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <StatusBadge tone={statusTone(item.status, item.due_date)}>
                          {item.status.replaceAll("_", " ")}
                        </StatusBadge>
                        <span className={cn("text-sm text-muted-foreground", dueRank(item.due_date) < 0 && "font-medium text-danger")}>
                          Due {formatDate(item.due_date)}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <SecondaryButton type="button" onClick={() => navigator.clipboard.writeText(item.onboarding_url)}>
                          <ClipboardCopy size={15} />
                          Copy link
                        </SecondaryButton>
                        {item.status === "sent" ? (
                          <SecondaryButton type="button" onClick={() => cancelOnboardingMutation.mutate(item.id)}>
                            <X size={15} />
                            Cancel
                          </SecondaryButton>
                        ) : null}
                        {item.status === "sent" ? (
                          <SecondaryButton type="button" onClick={() => resendOnboardingMutation.mutate(item.id)}>
                            <Link2 size={15} />
                            Resend
                          </SecondaryButton>
                        ) : null}
                        {item.status === "submitted" ? (
                          <Button type="button" onClick={() => reviewOnboardingMutation.mutate(item.id)}>
                            <Check size={16} />
                            Review
                          </Button>
                        ) : null}
                        {item.status === "submitted" || item.status === "reviewed" ? (
                          <Button type="button" onClick={() => applyOnboardingMutation.mutate(item.id)}>
                            <Save size={16} />
                            Apply
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                      <div>Last sent {formatDate(item.last_sent_at)}</div>
                      <div>Expires {formatDate(item.expires_at)}</div>
                      <div>Applied {formatDate(item.applied_at)}</div>
                    </div>
                    {item.status === "submitted" ? (
                      <div className="rounded-md border border-border bg-muted p-3 text-xs">
                        <div className="mb-2 font-semibold">Submitted details</div>
                        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words">
                          {JSON.stringify(item.submitted_data, null, 2)}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                ))}
                {tenantOnboardings.length === 0 ? (
                  <EmptyState
                    title="No onboarding has been sent"
                    description="Start from a linked lease below when tenant setup details are needed."
                  />
                ) : null}
              </div>
            </SectionPanel>

            <SectionPanel title="Linked leases" icon={<Link2 size={17} />}>
              <div className="divide-y divide-border">
                {(leasesQuery.data ?? []).map((lease) => {
                  const activeOnboarding = tenantOnboardings.find(
                    (item) => item.lease_id === lease.id && item.status !== "cancelled",
                  );
                  return (
                    <div key={lease.id} className="grid gap-3 p-4 text-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">Lease {lease.status}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {formatDate(lease.commencement_date)} to {formatDate(lease.expiry_date)}
                          </div>
                        </div>
                        <StatusBadge tone={lease.status === "active" ? "success" : "neutral"}>
                          {formatMoney(lease.annual_rent_cents)}
                        </StatusBadge>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {activeOnboarding ? (
                          <SecondaryButton type="button" onClick={() => navigator.clipboard.writeText(activeOnboarding.onboarding_url)}>
                            <ClipboardCopy size={15} />
                            Copy onboarding link
                          </SecondaryButton>
                        ) : (
                          <Button type="button" onClick={() => createOnboardingMutation.mutate(lease.id)}>
                            <Plus size={16} />
                            Send onboarding
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {!leasesQuery.isLoading && (leasesQuery.data ?? []).length === 0 ? (
                  <EmptyState
                    title="No leases linked yet"
                    description="Lease intake or the property workspace will attach leases to this tenant."
                  />
                ) : null}
              </div>
            </SectionPanel>

            <SectionPanel title="Activity">
              <div className="grid gap-2 p-4 text-sm">
                {tenantOnboardings.slice(0, 5).map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3">
                    <span>Onboarding {item.status}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(item.submitted_at ?? item.created_at)}</span>
                  </div>
                ))}
                {tenantOnboardings.length === 0 ? (
                  <div className="text-muted-foreground">No activity yet.</div>
                ) : null}
              </div>
            </SectionPanel>
          </div>
        </section>

        {tenantQuery.error || leasesQuery.error || onboardingQuery.error ? (
          <p className="text-sm text-danger">
            {friendlyError(tenantQuery.error ?? leasesQuery.error ?? onboardingQuery.error)}
          </p>
        ) : null}
      </div>
    </main>
  );
}

export default function TenantDetailPage() {
  return (
    <QueryProvider>
      <TenantDetail />
    </QueryProvider>
  );
}
