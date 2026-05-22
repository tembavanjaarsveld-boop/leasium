"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ClipboardCopy,
  Clock3,
  MailCheck,
  Plus,
  RefreshCw,
  Search,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { DetailDrawer } from "@/components/detail-drawer";
import { QueryProvider } from "@/components/query-provider";
import {
  Button,
  EmptyState,
  Field,
  Input,
  SecondaryButton,
  SectionPanel,
  Select,
  StatusBadge,
} from "@/components/ui";
import {
  cancelTenantOnboarding,
  createTenant,
  listEntities,
  listRentRoll,
  listTenantOnboardings,
  listTenants,
  runTenantOnboardingReminders,
  TenantOnboardingRecord,
  TenantPayload,
  TenantRecord,
} from "@/lib/api";
import {
  onboardingDeliveryDetail,
  onboardingDeliveryLabel,
  onboardingDeliveryTone,
  onboardingNeedsContactFix,
  onboardingReminderLabel,
  onboardingReminderTone,
} from "@/lib/delivery";
import { cn } from "@/lib/utils";

const ENTITY_STORAGE_KEY = "leasium.entity_id";

type FilterKey = "all" | "needs_onboarding" | "sent" | "submitted" | "overdue" | "cancelled";

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

const emptyForm: TenantForm = {
  legal_name: "",
  trading_name: "",
  abn: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  billing_email: "",
  notes: "",
};

const filters: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "needs_onboarding", label: "Needs onboarding" },
  { key: "sent", label: "Sent" },
  { key: "submitted", label: "Submitted" },
  { key: "overdue", label: "Overdue" },
  { key: "cancelled", label: "Cancelled" },
];

function cleanText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function formatAnnualRent(cents: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function tenantName(tenant: TenantRecord) {
  return tenant.trading_name
    ? `${tenant.trading_name} (${tenant.legal_name})`
    : tenant.legal_name;
}

function friendlyError(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
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

function dueLabel(value: string | null | undefined) {
  const days = dueRank(value);
  if (days === 9999) {
    return "No due date";
  }
  if (days < 0) {
    return `${Math.abs(days)}d overdue`;
  }
  if (days === 0) {
    return "Today";
  }
  if (days === 1) {
    return "Tomorrow";
  }
  return `In ${days}d`;
}

function statusTone(status: string, dueDate?: string | null) {
  if (status === "cancelled") {
    return "neutral" as const;
  }
  if (status === "submitted") {
    return "success" as const;
  }
  if (dueRank(dueDate) < 0) {
    return "danger" as const;
  }
  if (status === "sent") {
    return "primary" as const;
  }
  return "warning" as const;
}

function isExpiredDateTime(value: string | null | undefined) {
  if (!value) {
    return false;
  }
  return new Date(value).getTime() <= Date.now();
}

function latestOnboarding(
  tenantId: string,
  onboardings: TenantOnboardingRecord[],
) {
  return onboardings
    .filter((item) => item.tenant_id === tenantId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

const TENANT_FILTER_KEYS: FilterKey[] = [
  "all",
  "needs_onboarding",
  "sent",
  "submitted",
  "overdue",
  "cancelled",
];

function isTenantFilterKey(value: string | null): value is FilterKey {
  return Boolean(value && TENANT_FILTER_KEYS.includes(value as FilterKey));
}

function TenantWorkspace() {
  const queryClient = useQueryClient();
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<TenantForm>(emptyForm);
  const [reminderRunSummary, setReminderRunSummary] = useState("");
  const [drawerTenantId, setDrawerTenantId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const initialFilter = params.get("tenant_filter");
    if (isTenantFilterKey(initialFilter)) {
      setFilter(initialFilter);
    }
    const initialSearch = params.get("q") ?? "";
    if (initialSearch) {
      setSearch(initialSearch);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (filter === "all") {
      url.searchParams.delete("tenant_filter");
    } else {
      url.searchParams.set("tenant_filter", filter);
    }
    const trimmedSearch = search.trim();
    if (trimmedSearch) {
      url.searchParams.set("q", trimmedSearch);
    } else {
      url.searchParams.delete("q");
    }
    window.history.replaceState(null, "", url);
  }, [filter, search]);

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

  const tenantsQuery = useQuery({
    queryKey: ["tenants", selectedEntityId],
    queryFn: () => listTenants(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });

  const onboardingQuery = useQuery({
    queryKey: ["tenant-onboardings", selectedEntityId],
    queryFn: () => listTenantOnboardings(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });

  const rentRollQuery = useQuery({
    queryKey: ["rent-roll", selectedEntityId],
    queryFn: () => listRentRoll({ entity_id: selectedEntityId }),
    enabled: Boolean(selectedEntityId),
  });

  const tenantLeaseSummaries = useMemo(() => {
    const map = new Map<
      string,
      { activeLeases: number; totalAnnualCents: number }
    >();
    const rows = rentRollQuery.data ?? [];
    const occupied = new Set(["active", "holding_over"]);
    for (const row of rows) {
      if (
        !row.tenant_id ||
        !row.lease_id ||
        !row.lease_status ||
        !occupied.has(row.lease_status)
      ) {
        continue;
      }
      const prev = map.get(row.tenant_id) ?? {
        activeLeases: 0,
        totalAnnualCents: 0,
      };
      map.set(row.tenant_id, {
        activeLeases: prev.activeLeases + 1,
        totalAnnualCents:
          prev.totalAnnualCents + (row.annual_rent_cents ?? 0),
      });
    }
    return map;
  }, [rentRollQuery.data]);
  const entitySelectionLoading =
    entitiesQuery.isLoading ||
    (!selectedEntityId && (entitiesQuery.data?.length ?? 0) > 0);
  const tenantsLoading =
    entitySelectionLoading ||
    (Boolean(selectedEntityId) &&
      (tenantsQuery.isLoading || onboardingQuery.isLoading));

  const tenantRows = useMemo(() => {
    const onboardings = onboardingQuery.data ?? [];
    const needle = search.trim().toLowerCase();
    return (tenantsQuery.data ?? [])
      .map((tenant) => ({
        tenant,
        onboarding: latestOnboarding(tenant.id, onboardings),
      }))
      .filter(({ tenant, onboarding }) => {
        const matchesSearch =
          !needle ||
          [
            tenant.legal_name,
            tenant.trading_name,
            tenant.abn,
            tenant.contact_name,
            tenant.contact_email,
            tenant.billing_email,
          ]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(needle));
        if (!matchesSearch) {
          return false;
        }
        if (filter === "all") {
          return true;
        }
        if (filter === "needs_onboarding") {
          return !onboarding || onboarding.status === "draft";
        }
        if (filter === "overdue") {
          return Boolean(onboarding && onboarding.status === "sent" && dueRank(onboarding.due_date) < 0);
        }
        return onboarding?.status === filter;
      })
      .sort((a, b) => {
        const aRank = a.onboarding ? dueRank(a.onboarding.due_date) : -1;
        const bRank = b.onboarding ? dueRank(b.onboarding.due_date) : -1;
        return aRank - bRank || tenantName(a.tenant).localeCompare(tenantName(b.tenant));
      });
  }, [filter, onboardingQuery.data, search, tenantsQuery.data]);

  const counts = useMemo(() => {
    const onboardings = onboardingQuery.data ?? [];
    return {
      all: tenantsQuery.data?.length ?? 0,
      sent: onboardings.filter((item) => item.status === "sent").length,
      submitted: onboardings.filter((item) => item.status === "submitted").length,
      overdue: onboardings.filter(
        (item) => item.status === "sent" && dueRank(item.due_date) < 0,
      ).length,
    };
  }, [onboardingQuery.data, tenantsQuery.data]);

  const createMutation = useMutation({
    mutationFn: (values: TenantForm) => {
      const payload: TenantPayload = {
        entity_id: selectedEntityId,
        legal_name: values.legal_name.trim(),
        trading_name: cleanText(values.trading_name),
        abn: cleanText(values.abn),
        contact_name: cleanText(values.contact_name),
        contact_email: cleanText(values.contact_email),
        contact_phone: cleanText(values.contact_phone),
        billing_email: cleanText(values.billing_email),
        notes: cleanText(values.notes),
      };
      return createTenant(payload);
    },
    onSuccess: (tenant) => {
      queryClient.invalidateQueries({ queryKey: ["tenants", selectedEntityId] });
      setShowCreate(false);
      setForm(emptyForm);
      window.location.href = `/tenants/${tenant.id}`;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelTenantOnboarding,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-onboardings", selectedEntityId] });
    },
  });

  const runRemindersMutation = useMutation({
    mutationFn: () => runTenantOnboardingReminders(selectedEntityId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["tenant-onboardings", selectedEntityId] });
      setReminderRunSummary(
        result.sent
          ? `${result.sent} reminder${result.sent === 1 ? "" : "s"} sent.`
          : "No reminders due right now.",
      );
    },
  });

  function updateField(field: keyof TenantForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function submitForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEntityId || !form.legal_name.trim()) {
      return;
    }
    createMutation.mutate(form);
  }

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
        <section className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Tenant workspace</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Find tenants, watch onboarding, and jump into the profile when work is needed.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SecondaryButton
              type="button"
              onClick={() => {
                tenantsQuery.refetch();
                onboardingQuery.refetch();
              }}
              disabled={!selectedEntityId}
            >
              <RefreshCw size={15} />
              Refresh
            </SecondaryButton>
            <SecondaryButton
              type="button"
              onClick={() => runRemindersMutation.mutate()}
              disabled={!selectedEntityId || runRemindersMutation.isPending}
            >
              <Clock3 size={15} />
              Run reminders
            </SecondaryButton>
            <Button type="button" onClick={() => setShowCreate(true)}>
              <Plus size={16} />
              Add tenant
            </Button>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-4">
          <div className="rounded-md border border-border bg-white p-4">
            <div className="text-2xl font-semibold">
              {tenantsLoading ? "..." : counts.all}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">Tenants</div>
          </div>
          <div className="rounded-md border border-border bg-white p-4">
            <div className="text-2xl font-semibold">
              {tenantsLoading ? "..." : counts.sent}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">Waiting on tenants</div>
          </div>
          <div className="rounded-md border border-border bg-white p-4">
            <div className="text-2xl font-semibold">
              {tenantsLoading ? "..." : counts.submitted}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">Submitted for review</div>
          </div>
          <div className="rounded-md border border-border bg-white p-4">
            <div className="text-2xl font-semibold">
              {tenantsLoading ? "..." : counts.overdue}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">Overdue</div>
          </div>
        </section>

        {showCreate ? (
          <SectionPanel
            title="Add tenant"
            description="Create the tenant record here, then finish leases and onboarding from the profile."
            actions={
              <SecondaryButton
                type="button"
                onClick={() => {
                  setShowCreate(false);
                  setForm(emptyForm);
                }}
                className="h-8 w-8 px-0"
                aria-label="Close add tenant"
              >
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
                <Button type="submit" disabled={!form.legal_name.trim() || createMutation.isPending}>
                  <Check size={16} />
                  Create tenant
                </Button>
                {createMutation.error ? (
                  <p className="mt-2 text-sm text-danger">{friendlyError(createMutation.error)}</p>
                ) : null}
              </div>
            </form>
          </SectionPanel>
        ) : null}

        <SectionPanel
          title="Onboarding command center"
          description="A working list for tenant setup, follow-up, and submitted details."
          icon={<MailCheck size={17} />}
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <div className="relative min-w-64 flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tenants" className="pl-9" />
            </div>
            <div className="flex flex-wrap gap-1">
              {filters.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setFilter(item.key)}
                  className={cn(
                    "h-9 rounded-md px-3 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground",
                    filter === item.key && "bg-primary/10 text-primary",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            {reminderRunSummary ? (
              <div className="border-b border-border px-3 py-2 text-sm text-muted-foreground">
                {reminderRunSummary}
              </div>
            ) : null}
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-muted text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-semibold">Tenant</th>
                  <th className="px-3 py-2 font-semibold">Onboarding</th>
                  <th className="px-3 py-2 font-semibold">Due</th>
                  <th className="px-3 py-2 font-semibold">Contact</th>
                  <th className="px-3 py-2 font-semibold">Next action</th>
                </tr>
              </thead>
              <tbody>
                {tenantsLoading ? (
                  <tr>
                    <td colSpan={5}>
                      <EmptyState title="Loading tenants." />
                    </td>
                  </tr>
                ) : null}
                {tenantRows.map(({ tenant, onboarding }) => {
                  const summary = tenantLeaseSummaries.get(tenant.id);
                  return (
                  <tr
                    key={tenant.id}
                    className="cursor-pointer border-t border-border align-top transition hover:bg-muted/50"
                    onClick={(event) => {
                      const target = event.target as HTMLElement;
                      if (target.closest("a, button")) return;
                      setDrawerTenantId(tenant.id);
                    }}
                  >
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        className="text-left font-medium text-primary hover:underline"
                        onClick={(event) => {
                          event.stopPropagation();
                          setDrawerTenantId(tenant.id);
                        }}
                      >
                        {tenantName(tenant)}
                      </button>
                      <div className="text-xs text-muted-foreground">{tenant.abn ?? "No ABN recorded"}</div>
                      {summary ? (
                        <div className="mt-1 inline-flex items-center rounded-full border border-leasium-success-strong/30 bg-leasium-success-soft px-2 py-0.5 text-[11px] font-semibold leading-4 text-[#027A48]">
                          {summary.activeLeases}{" "}
                          {summary.activeLeases === 1 ? "active lease" : "active leases"}
                          {summary.totalAnnualCents > 0
                            ? ` · ${formatAnnualRent(summary.totalAnnualCents)}/yr`
                            : ""}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      {onboarding ? (
                        <div className="grid gap-1">
                          <StatusBadge tone={statusTone(onboarding.status, onboarding.due_date)}>
                            {onboarding.status.replaceAll("_", " ")}
                          </StatusBadge>
                          <StatusBadge tone={onboardingDeliveryTone(onboarding.delivery_data)}>
                            {onboardingDeliveryLabel(onboarding.delivery_data)}
                          </StatusBadge>
                          <StatusBadge tone={onboardingReminderTone(onboarding.delivery_data)}>
                            {onboardingReminderLabel(onboarding.delivery_data)}
                          </StatusBadge>
                          {onboardingNeedsContactFix(onboarding.delivery_data) ? (
                            <div className="max-w-xs text-xs text-muted-foreground">
                              {onboardingDeliveryDetail(onboarding.delivery_data)}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <StatusBadge tone="warning">not started</StatusBadge>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <div className={cn(dueRank(onboarding?.due_date) < 0 && "font-medium text-danger")}>
                        {dueLabel(onboarding?.due_date)}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <div>{tenant.contact_name ?? "-"}</div>
                      <div className="text-muted-foreground">{tenant.contact_email ?? tenant.contact_phone ?? "-"}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Link href={`/tenants/${tenant.id}`}>
                          <SecondaryButton type="button">
                            <UserRound size={15} />
                            {onboardingNeedsContactFix(onboarding?.delivery_data) ? "Fix contact" : "Open"}
                          </SecondaryButton>
                        </Link>
                        {onboarding?.status === "sent" &&
                        onboarding.onboarding_url &&
                        !isExpiredDateTime(onboarding.expires_at) ? (
                          <SecondaryButton type="button" onClick={() => navigator.clipboard.writeText(onboarding.onboarding_url)}>
                            <ClipboardCopy size={15} />
                            Copy link
                          </SecondaryButton>
                        ) : null}
                        {onboarding?.status === "sent" ? (
                          <SecondaryButton type="button" onClick={() => cancelMutation.mutate(onboarding.id)}>
                            <X size={15} />
                            Cancel
                          </SecondaryButton>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  );
                })}
                {!tenantsLoading && tenantRows.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <EmptyState
                        title="No tenants match this view"
                        description="Clear the search or switch filters to see the full tenant list."
                      />
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {onboardingQuery.error || tenantsQuery.error ? (
            <p className="border-t border-border p-3 text-sm text-danger">
              {friendlyError(onboardingQuery.error ?? tenantsQuery.error)}
            </p>
          ) : null}
        </SectionPanel>
      </div>
      <TenantQuickViewDrawer
        tenantId={drawerTenantId}
        tenants={tenantsQuery.data ?? []}
        onboardings={onboardingQuery.data ?? []}
        leaseSummaries={tenantLeaseSummaries}
        onClose={() => setDrawerTenantId(null)}
      />
    </main>
  );
}

function TenantQuickViewDrawer({
  tenantId,
  tenants,
  onboardings,
  leaseSummaries,
  onClose,
}: {
  tenantId: string | null;
  tenants: TenantRecord[];
  onboardings: TenantOnboardingRecord[];
  leaseSummaries: Map<
    string,
    { activeLeases: number; totalAnnualCents: number }
  >;
  onClose: () => void;
}) {
  const tenant = tenantId
    ? tenants.find((entry) => entry.id === tenantId) ?? null
    : null;
  const onboarding = tenantId
    ? latestOnboarding(tenantId, onboardings)
    : null;
  const summary = tenantId ? leaseSummaries.get(tenantId) : undefined;
  return (
    <DetailDrawer
      open={Boolean(tenant)}
      title={tenant ? tenantName(tenant) : "Tenant"}
      description={tenant?.abn ?? "No ABN recorded"}
      onClose={onClose}
      primaryAction={
        tenant
          ? { label: "Open full record", href: `/tenants/${tenant.id}` }
          : undefined
      }
      footerNote="Quick view. Lease editing, documents, and onboarding controls live on the full record."
    >
      {tenant ? (
        <div className="grid gap-4">
          <section className="grid gap-2">
            <div className="text-xs font-semibold uppercase text-muted-foreground">
              Contact
            </div>
            <dl className="grid gap-1 text-sm">
              <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
                <dt className="text-muted-foreground">Name</dt>
                <dd>{tenant.contact_name ?? "-"}</dd>
              </div>
              <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
                <dt className="text-muted-foreground">Email</dt>
                <dd>{tenant.contact_email ?? "-"}</dd>
              </div>
              <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
                <dt className="text-muted-foreground">Phone</dt>
                <dd>{tenant.contact_phone ?? "-"}</dd>
              </div>
              <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
                <dt className="text-muted-foreground">Billing email</dt>
                <dd>{tenant.billing_email ?? "-"}</dd>
              </div>
            </dl>
          </section>
          {summary ? (
            <section className="rounded-md border border-border bg-leasium-success-soft p-3 text-sm">
              <div className="font-semibold text-[#027A48]">
                {summary.activeLeases}{" "}
                {summary.activeLeases === 1
                  ? "active lease"
                  : "active leases"}
                {summary.totalAnnualCents > 0
                  ? ` · ${formatAnnualRent(summary.totalAnnualCents)}/yr`
                  : ""}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Open the full record to view lease terms, documents,
                charges, and payment history.
              </p>
            </section>
          ) : (
            <section className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-sm text-muted-foreground">
              No active leases recorded for this tenant yet.
            </section>
          )}
          {onboarding ? (
            <section className="grid gap-2">
              <div className="text-xs font-semibold uppercase text-muted-foreground">
                Latest onboarding
              </div>
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-white p-3 text-sm">
                <StatusBadge
                  tone={statusTone(onboarding.status, onboarding.due_date)}
                >
                  {onboarding.status.replaceAll("_", " ")}
                </StatusBadge>
                <StatusBadge
                  tone={onboardingDeliveryTone(onboarding.delivery_data)}
                >
                  {onboardingDeliveryLabel(onboarding.delivery_data)}
                </StatusBadge>
                <span className="text-xs text-muted-foreground">
                  Due {onboarding.due_date ?? "-"}
                </span>
              </div>
              {onboardingNeedsContactFix(onboarding.delivery_data) ? (
                <p className="text-xs text-muted-foreground">
                  {onboardingDeliveryDetail(onboarding.delivery_data)}
                </p>
              ) : null}
            </section>
          ) : (
            <section className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-sm text-muted-foreground">
              No onboarding link sent yet.
            </section>
          )}
        </div>
      ) : null}
    </DetailDrawer>
  );
}

export default function TenantsPage() {
  return (
    <QueryProvider>
      <TenantWorkspace />
    </QueryProvider>
  );
}
