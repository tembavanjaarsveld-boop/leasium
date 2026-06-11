"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardCopy,
  Clock3,
  MailCheck,
  RefreshCw,
  Search,
  Send,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { DetailDrawer } from "@/components/detail-drawer";
import { EntityPicker } from "@/components/entity-picker";
import { InlineEditCell } from "@/components/inline-edit-cell";
import { QueryProvider } from "@/components/query-provider";
import { SavedViewsMenu } from "@/components/saved-views-menu";
import {
  Button,
  EmptyState,
  Field,
  Input,
  SecondaryButton,
  SectionPanel,
  Select,
  SkeletonRows,
  StatusBadge,
  chipClass,
} from "@/components/ui";
import {
  cancelTenantOnboarding,
  createLease,
  createTenancyUnit,
  createTenant,
  createTenantOnboarding,
  listEntities,
  listProperties,
  listRentRoll,
  listTenancyUnits,
  listTenantOnboardings,
  listTenants,
  runTenantOnboardingReminders,
  sendTenantOnboardingPortalInvite,
  TenantOnboardingRecord,
  TenantRecord,
  updateTenant,
} from "@/lib/api";
import {
  onboardingDeliveryDetail,
  onboardingDeliveryLabel,
  onboardingDeliveryTone,
  onboardingNeedsContactFix,
  onboardingReminderLabel,
  onboardingReminderTone,
} from "@/lib/delivery";
import {
  ENTITY_STORAGE_KEY,
  defaultEntitySelection,
  isAllEntities,
  scopeEntityId,
} from "@/lib/entity-selection";
import { useEntityFanOut } from "@/lib/use-entity-fan-out";
import { cn, friendlyError } from "@/lib/utils";

type FilterKey = "all" | "needs_onboarding" | "sent" | "submitted" | "overdue" | "cancelled";

const tenantActionLinkClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted";

type InviteForm = {
  property_id: string;
  tenancy_unit_id: string;
  legal_name: string;
  contact_name: string;
  contact_email: string;
  due_date: string;
};

const emptyForm: InviteForm = {
  property_id: "",
  tenancy_unit_id: "",
  legal_name: "",
  contact_name: "",
  contact_email: "",
  due_date: "",
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
  const [showReminderApproval, setShowReminderApproval] = useState(false);
  const [form, setForm] = useState<InviteForm>(emptyForm);
  const [reminderRunSummary, setReminderRunSummary] = useState("");
  const [drawerTenantId, setDrawerTenantId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const initialFilter = params.get("tenant_filter");
    if (isTenantFilterKey(initialFilter)) {
      setFilter(initialFilter);
    }
    if (params.get("action") === "invite") {
      setShowCreate(true);
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
    // The All-entities sentinel is a valid restore target even though it is not
    // a real entity id, so the cross-entity view survives navigation/reload.
    const next =
      stored && (isAllEntities(stored) || accessibleIds.has(stored))
        ? stored
        : defaultEntitySelection(entitiesQuery.data ?? []);
    if (!selectedEntityId && next) {
      setSelectedEntityId(next);
    }
  }, [entitiesQuery.data, selectedEntityId]);

  useEffect(() => {
    if (selectedEntityId) {
      window.localStorage.setItem(ENTITY_STORAGE_KEY, selectedEntityId);
    }
  }, [selectedEntityId]);

  // All-entities mode: entity-scoped queries use scopedEntityId (empty in
  // all-mode, so they stay disabled) and the page reads merged fan-out results.
  const allMode = isAllEntities(selectedEntityId);
  const scopedEntityId = scopeEntityId(selectedEntityId);
  const entityNameById = useMemo(
    () =>
      new Map(
        (entitiesQuery.data ?? []).map((entity) => [entity.id, entity.name]),
      ),
    [entitiesQuery.data],
  );

  const tenantsQuery = useQuery({
    queryKey: ["tenants", scopedEntityId],
    queryFn: () => listTenants(scopedEntityId),
    enabled: Boolean(scopedEntityId),
  });

  const onboardingQuery = useQuery({
    queryKey: ["tenant-onboardings", scopedEntityId],
    queryFn: () => listTenantOnboardings(scopedEntityId),
    enabled: Boolean(scopedEntityId),
  });

  const rentRollQuery = useQuery({
    queryKey: ["rent-roll", scopedEntityId],
    queryFn: () => listRentRoll({ entity_id: scopedEntityId }),
    enabled: Boolean(scopedEntityId),
  });

  const tenantsFanOut = useEntityFanOut({
    entities: entitiesQuery.data,
    enabled: allMode,
    keyPrefix: ["tenants"],
    queryFn: listTenants,
  });
  const onboardingsFanOut = useEntityFanOut({
    entities: entitiesQuery.data,
    enabled: allMode,
    keyPrefix: ["tenant-onboardings"],
    queryFn: listTenantOnboardings,
    orgWideQueryFn: () => listTenantOnboardings(),
  });
  const rentRollFanOut = useEntityFanOut({
    entities: entitiesQuery.data,
    enabled: allMode,
    keyPrefix: ["rent-roll"],
    queryFn: (entityId) => listRentRoll({ entity_id: entityId }),
    orgWideQueryFn: () => listRentRoll({}),
  });

  // Merged views the UI reads regardless of single- vs all-entity mode.
  const tenants = useMemo(
    () => (allMode ? tenantsFanOut.data : (tenantsQuery.data ?? [])),
    [allMode, tenantsFanOut.data, tenantsQuery.data],
  );
  const onboardings = useMemo(
    () => (allMode ? onboardingsFanOut.data : (onboardingQuery.data ?? [])),
    [allMode, onboardingsFanOut.data, onboardingQuery.data],
  );
  const rentRollRows = useMemo(
    () => (allMode ? rentRollFanOut.data : (rentRollQuery.data ?? [])),
    [allMode, rentRollFanOut.data, rentRollQuery.data],
  );

  // Properties + units feed the Send-invite form. Properties are loaded
  // once per entity; units are loaded per selected property so the unit
  // dropdown only shows units that belong to the chosen property.
  const propertiesQuery = useQuery({
    queryKey: ["properties", scopedEntityId],
    queryFn: () => listProperties(scopedEntityId),
    enabled: Boolean(scopedEntityId),
  });

  const unitsQuery = useQuery({
    queryKey: ["tenancy-units", form.property_id],
    queryFn: () => listTenancyUnits(form.property_id),
    enabled: Boolean(form.property_id),
  });

  // 0 units → hide picker, auto-create "Main premises" at submit time.
  // 1 unit → auto-select + show as a chip (still a real id, no auto-create).
  // 2+ units → keep dropdown required.
  const unitsForProperty = unitsQuery.data ?? [];
  const unitPickerMode: "auto-create" | "auto-select" | "pick" = !form.property_id
    ? "pick"
    : unitsQuery.isLoading
      ? "pick"
      : unitsForProperty.length === 0
        ? "auto-create"
        : unitsForProperty.length === 1
          ? "auto-select"
          : "pick";
  const autoSelectedUnit =
    unitPickerMode === "auto-select" ? unitsForProperty[0] : null;

  const tenantLeaseSummaries = useMemo(() => {
    const map = new Map<
      string,
      { activeLeases: number; totalAnnualCents: number }
    >();
    const rows = rentRollRows;
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
  }, [rentRollRows]);
  const entitySelectionLoading =
    entitiesQuery.isLoading ||
    (!selectedEntityId && (entitiesQuery.data?.length ?? 0) > 0);
  const tenantsLoading =
    entitySelectionLoading ||
    (allMode
      ? tenantsFanOut.isLoading || onboardingsFanOut.isLoading
      : Boolean(selectedEntityId) &&
        (tenantsQuery.isLoading || onboardingQuery.isLoading));

  const tenantRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return tenants
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
  }, [filter, onboardings, search, tenants]);

  const counts = useMemo(() => {
    return {
      all: tenants.length,
      sent: onboardings.filter((item) => item.status === "sent").length,
      submitted: onboardings.filter((item) => item.status === "submitted").length,
      overdue: onboardings.filter(
        (item) => item.status === "sent" && dueRank(item.due_date) < 0,
      ).length,
    };
  }, [onboardings, tenants]);

  // Send-invite is the new primary path: the operator enters minimum
  // info (where + who + email), and the chain (tenant -> lease ->
  // onboarding -> portal invite) is created in one click. The tenant
  // then fills the rest of their record themselves via the portal,
  // gated by Clerk sign-up so submitted data is bound to an
  // authenticated identity rather than just an email-borne token.
  const sendInviteMutation = useMutation({
    mutationFn: async ({
      values,
      entityId,
    }: {
      values: InviteForm;
      entityId: string;
    }) => {
      // Resolve the unit id based on the picker mode:
      //   - auto-create → make a "Main premises" unit now
      //   - auto-select → use the single existing unit
      //   - pick → the operator already filled tenancy_unit_id
      let resolvedUnitId = values.tenancy_unit_id;
      if (unitPickerMode === "auto-create") {
        const created = await createTenancyUnit({
          property_id: values.property_id,
          unit_label: "Main premises",
          sqm: null,
          parking_spaces: null,
        });
        resolvedUnitId = created.id;
      } else if (unitPickerMode === "auto-select" && autoSelectedUnit) {
        resolvedUnitId = autoSelectedUnit.id;
      }
      const tenant = await createTenant({
        entity_id: entityId,
        legal_name: values.legal_name.trim(),
        trading_name: null,
        abn: null,
        contact_name: cleanText(values.contact_name),
        contact_email: cleanText(values.contact_email),
        contact_phone: null,
        billing_email: null,
        notes: null,
      });
      const lease = await createLease({
        tenancy_unit_id: resolvedUnitId,
        tenant_id: tenant.id,
        status: "pending",
        commencement_date: null,
        expiry_date: null,
        annual_rent_cents: null,
        rent_frequency: "annual",
        outgoings_recoverable: true,
        next_review_date: null,
        option_summary: null,
        security_summary: null,
        notes: null,
      });
      const onboarding = await createTenantOnboarding({
        lease_id: lease.id,
        due_date: values.due_date || null,
        // The next call sends the account-first portal invite. Suppress the
        // legacy token email so tenants do not receive two setup emails.
        send_initial_invite: false,
      });
      const sent = await sendTenantOnboardingPortalInvite(onboarding.id);
      return { tenant, lease, onboarding: sent };
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["tenants", variables.entityId] });
      queryClient.invalidateQueries({
        queryKey: ["tenant-onboardings", variables.entityId],
      });
      queryClient.invalidateQueries({ queryKey: ["rent-roll", variables.entityId] });
      setShowCreate(false);
      setForm(emptyForm);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelTenantOnboarding,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-onboardings", selectedEntityId] });
    },
  });

  const runRemindersMutation = useMutation({
    mutationFn: (entityId: string) => runTenantOnboardingReminders(entityId),
    onSuccess: (result, entityId) => {
      queryClient.invalidateQueries({ queryKey: ["tenant-onboardings", entityId] });
      setReminderRunSummary(
        result.sent
          ? `${result.sent} reminder${result.sent === 1 ? "" : "s"} sent.`
          : "No reminders due right now.",
      );
      setShowReminderApproval(false);
    },
  });

  // Inline-edit handler for tenant contact fields. Optimistic update
  // patches the React Query cache immediately so the row reflects the
  // change without a refetch; if PATCH fails we roll back to the
  // previous list and rethrow so InlineEditCell surfaces the error.
  async function saveTenantField(
    tenantId: string,
    field: "contact_email" | "contact_phone" | "billing_email" | "contact_name",
    next: string | null,
  ): Promise<void> {
    const queryKey = ["tenants", selectedEntityId];
    const previous =
      queryClient.getQueryData<TenantRecord[]>(queryKey) ?? null;
    if (previous) {
      queryClient.setQueryData<TenantRecord[]>(
        queryKey,
        previous.map((row) =>
          row.id === tenantId ? { ...row, [field]: next } : row,
        ),
      );
    }
    try {
      await updateTenant(tenantId, { [field]: next });
      // The PATCH response is already reflected by the optimistic
      // update; trigger a background revalidation so other derived
      // queries (drawer, lease summaries) stay aligned.
      queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      if (previous) {
        queryClient.setQueryData(queryKey, previous);
      }
      throw err;
    }
  }

  function updateField(field: keyof InviteForm, value: string) {
    setForm((current) =>
      field === "property_id"
        ? { ...current, property_id: value, tenancy_unit_id: "" }
        : { ...current, [field]: value },
    );
  }

  // Unit is satisfied if the operator picked one OR there's a single
  // unit we'll auto-select OR there are zero units we'll auto-create.
  // Loading state is the only mode where we wait.
  const unitReady =
    unitPickerMode === "auto-create" ||
    unitPickerMode === "auto-select" ||
    Boolean(form.tenancy_unit_id);
  const canSubmitInvite =
    Boolean(scopedEntityId) &&
    Boolean(form.property_id) &&
    !unitsQuery.isLoading &&
    unitReady &&
    Boolean(form.legal_name.trim()) &&
    Boolean(form.contact_email.trim());

  function submitForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmitInvite || !scopedEntityId) {
      return;
    }
    sendInviteMutation.mutate({ values: form, entityId: scopedEntityId });
  }

  return (
    <main className="min-h-screen">
      <AppHeader>
        <EntityPicker
          entities={entitiesQuery.data}
          loading={entitiesQuery.isLoading}
          value={selectedEntityId}
          onChange={setSelectedEntityId}
        />
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
                if (allMode) {
                  tenantsFanOut.refetch();
                  onboardingsFanOut.refetch();
                } else {
                  tenantsQuery.refetch();
                  onboardingQuery.refetch();
                }
              }}
              disabled={!selectedEntityId}
            >
              <RefreshCw size={15} />
              Refresh
            </SecondaryButton>
            <SecondaryButton
              type="button"
              onClick={() => setShowReminderApproval(true)}
              disabled={
                !scopedEntityId || runRemindersMutation.isPending
              }
              title={
                allMode ? "Select a single entity to send reminders" : undefined
              }
            >
              <Clock3 size={15} />
              Review reminders
            </SecondaryButton>
            <Button
              type="button"
              onClick={() => setShowCreate(true)}
              disabled={!scopedEntityId}
              title={
                allMode ? "Select a single entity to send an invite" : undefined
              }
            >
              <Send size={16} />
              Send invite
            </Button>
          </div>
        </section>

        {showReminderApproval ? (
          <SectionPanel
            title="Send due reminders?"
            description="Review due tenant onboarding follow-ups before anything is sent through the configured email or SMS channels."
            icon={<Clock3 size={17} />}
            actions={
              <SecondaryButton
                type="button"
                onClick={() => setShowReminderApproval(false)}
                disabled={runRemindersMutation.isPending}
              >
                Cancel
              </SecondaryButton>
            }
          >
            <div className="grid gap-3 p-4 text-sm leading-6 text-muted-foreground">
              <p>
                This checks sent onboarding rows and sends due reminder messages
                to tenants through SendGrid or Twilio when those channels are
                configured.
              </p>
              <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-warning-foreground">
                Continue only after reviewing that due reminders should go now.
              </p>
              {runRemindersMutation.error ? (
                <p className="text-danger">
                  {friendlyError(runRemindersMutation.error)}
                </p>
              ) : null}
              <div>
                <Button
                  type="button"
                  onClick={() => {
                    if (scopedEntityId) {
                      runRemindersMutation.mutate(scopedEntityId);
                    }
                  }}
                  disabled={
                    !scopedEntityId || runRemindersMutation.isPending
                  }
                >
                  <Clock3 size={15} />
                  {runRemindersMutation.isPending
                    ? "Sending reminders..."
                    : "Send due reminders"}
                </Button>
              </div>
            </div>
          </SectionPanel>
        ) : null}

        <section className="grid gap-3 md:grid-cols-4">
          <div className="rounded-md border border-border bg-white p-4">
            <div
              className={cn(
                "font-semibold",
                tenantsLoading ? "text-sm" : "text-2xl",
              )}
            >
              {tenantsLoading ? "Checking" : counts.all}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">Tenants</div>
          </div>
          <div className="rounded-md border border-border bg-white p-4">
            <div
              className={cn(
                "font-semibold",
                tenantsLoading ? "text-sm" : "text-2xl",
              )}
            >
              {tenantsLoading ? "Checking" : counts.sent}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">Waiting on tenants</div>
          </div>
          <div className="rounded-md border border-border bg-white p-4">
            <div
              className={cn(
                "font-semibold",
                tenantsLoading ? "text-sm" : "text-2xl",
              )}
            >
              {tenantsLoading ? "Checking" : counts.submitted}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">Submitted for review</div>
          </div>
          <div className="rounded-md border border-border bg-white p-4">
            <div
              className={cn(
                "font-semibold",
                tenantsLoading ? "text-sm" : "text-2xl",
              )}
            >
              {tenantsLoading ? "Checking" : counts.overdue}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">Overdue</div>
          </div>
        </section>

        {showCreate ? (
          <SectionPanel
            title="Send invite"
            description="Tell us where the tenant is going and where to email them. We'll create the records and send the portal invite — the tenant fills in the rest themselves."
            actions={
              <SecondaryButton
                type="button"
                onClick={() => {
                  setShowCreate(false);
                  setForm(emptyForm);
                }}
                className="h-11 w-11 px-0"
                aria-label="Close send invite"
              >
                <X size={15} />
              </SecondaryButton>
            }
          >
            <form className="grid gap-3 p-4 md:grid-cols-2" onSubmit={submitForm}>
              <Field label="Property">
                <Select
                  value={form.property_id}
                  onChange={(event) =>
                    updateField("property_id", event.target.value)
                  }
                  disabled={
                    propertiesQuery.isLoading || !scopedEntityId
                  }
                >
                  <option value="">Select a property</option>
                  {(propertiesQuery.data ?? []).map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Unit">
                {unitPickerMode === "auto-create" && form.property_id ? (
                  <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                    <span className="rounded-full bg-primary-soft px-2 py-0.5 text-leasium-micro font-semibold uppercase tracking-wide text-primary">
                      Auto
                    </span>
                    <span>
                      No sub-units on this property — we&apos;ll create
                      &ldquo;Main premises&rdquo; on send.
                    </span>
                  </div>
                ) : unitPickerMode === "auto-select" && autoSelectedUnit ? (
                  <div className="flex items-center gap-2 rounded-md border border-border bg-white px-3 py-2 text-sm">
                    <span className="rounded-full bg-primary-soft px-2 py-0.5 text-leasium-micro font-semibold uppercase tracking-wide text-primary">
                      Auto
                    </span>
                    <span className="text-foreground">
                      {autoSelectedUnit.unit_label}
                    </span>
                  </div>
                ) : (
                  <Select
                    value={form.tenancy_unit_id}
                    onChange={(event) =>
                      updateField("tenancy_unit_id", event.target.value)
                    }
                    disabled={!form.property_id || unitsQuery.isLoading}
                  >
                    <option value="">
                      {form.property_id
                        ? "Select a unit"
                        : "Choose a property first"}
                    </option>
                    {unitsForProperty.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.unit_label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Tenant name">
                <Input
                  value={form.legal_name}
                  onChange={(event) =>
                    updateField("legal_name", event.target.value)
                  }
                  placeholder="Business or personal name"
                />
              </Field>
              <Field label="Contact email">
                <Input
                  type="email"
                  value={form.contact_email}
                  onChange={(event) =>
                    updateField("contact_email", event.target.value)
                  }
                  placeholder="Where the invite is sent"
                />
              </Field>
              <Field label="Contact name (optional)">
                <Input
                  value={form.contact_name}
                  onChange={(event) =>
                    updateField("contact_name", event.target.value)
                  }
                  placeholder="Used to personalise the email"
                />
              </Field>
              <Field label="Onboarding due (optional)">
                <Input
                  type="date"
                  value={form.due_date}
                  onChange={(event) =>
                    updateField("due_date", event.target.value)
                  }
                />
              </Field>
              <div className="md:col-span-2">
                <Button
                  type="submit"
                  disabled={!canSubmitInvite || sendInviteMutation.isPending}
                >
                  <Send size={16} />
                  {sendInviteMutation.isPending ? "Sending…" : "Send invite"}
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">
                  Clicking sends a portal-claim email to the tenant. They sign
                  in with Clerk and complete the rest of their onboarding from
                  the portal — you review and apply when they submit.
                </p>
                {sendInviteMutation.error ? (
                  <p className="mt-2 text-sm text-danger">
                    {friendlyError(sendInviteMutation.error)}
                  </p>
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
            <SavedViewsMenu
              surface="tenants"
              currentFilters={{
                tenant_filter: filter === "all" ? null : filter,
                q: search.trim() || null,
              }}
              onApplyView={(filters) => {
                const nextFilter = filters.tenant_filter;
                setFilter(
                  isTenantFilterKey(nextFilter) ? nextFilter : "all",
                );
                setSearch(filters.q ?? "");
              }}
            />
            <div className="flex flex-wrap gap-1">
              {filters.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setFilter(item.key)}
                  className={cn(
                    "min-h-11 min-w-11 rounded-md px-3 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground",
                    filter === item.key && "bg-primary/10 text-primary",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {reminderRunSummary ? (
            <div className="border-b border-border px-3 py-2 text-sm text-muted-foreground">
              {reminderRunSummary}
            </div>
          ) : null}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-left text-sm tabular-nums">
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
                    <td colSpan={5} className="p-0">
                      <SkeletonRows rows={4} />
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
                        className="inline-flex min-h-11 max-w-xs items-center rounded-md px-2 py-2 text-left font-medium text-primary transition hover:bg-primary/5 hover:underline"
                        onClick={(event) => {
                          event.stopPropagation();
                          setDrawerTenantId(tenant.id);
                        }}
                      >
                        {tenantName(tenant)}
                      </button>
                      {allMode ? (
                        <div className="mt-0.5 text-leasium-micro font-semibold uppercase text-muted-foreground">
                          {entityNameById.get(tenant.entity_id) ??
                            "Unknown entity"}
                        </div>
                      ) : null}
                      <div className="text-xs text-muted-foreground">{tenant.abn ?? "No ABN recorded"}</div>
                      {summary ? (
                        <div className={`mt-1 ${chipClass("success", { density: "compact", bordered: true })}`}>
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
                    <td
                      className="px-3 py-3 text-xs"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="grid gap-0.5">
                        <InlineEditCell
                          value={tenant.contact_name}
                          ariaLabel={`Contact name for ${tenantName(tenant)}`}
                          placeholder="Add contact name"
                          touchSafe
                          onSave={(next) =>
                            saveTenantField(tenant.id, "contact_name", next)
                          }
                        />
                        <InlineEditCell
                          value={tenant.contact_email}
                          ariaLabel={`Contact email for ${tenantName(tenant)}`}
                          placeholder="Add email"
                          type="email"
                          className="text-muted-foreground"
                          touchSafe
                          onSave={(next) =>
                            saveTenantField(tenant.id, "contact_email", next)
                          }
                        />
                        <InlineEditCell
                          value={tenant.contact_phone}
                          ariaLabel={`Contact phone for ${tenantName(tenant)}`}
                          placeholder="Add phone"
                          type="tel"
                          className="text-muted-foreground"
                          touchSafe
                          onSave={(next) =>
                            saveTenantField(tenant.id, "contact_phone", next)
                          }
                        />
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={`/tenants/${tenant.id}`}
                          className={tenantActionLinkClass}
                        >
                          <UserRound size={15} />
                          {onboardingNeedsContactFix(onboarding?.delivery_data)
                            ? "Fix contact"
                            : "Open"}
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
                        icon={<UserRound size={18} />}
                        title="No tenants match this view"
                        description="Clear the search or switch filters to see the full tenant list."
                      />
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="md:hidden">
            {tenantsLoading ? <SkeletonRows rows={4} /> : null}
            <ul className="divide-y divide-border">
              {tenantRows.map(({ tenant, onboarding }) => {
                const needsFix = onboardingNeedsContactFix(
                  onboarding?.delivery_data,
                );
                const onboardingStatusLabel = onboarding
                  ? onboarding.status.replaceAll("_", " ")
                  : "not started";
                const onboardingTone = onboarding
                  ? statusTone(onboarding.status, onboarding.due_date)
                  : "warning";
                return (
                  <li key={tenant.id} data-testid="tenant-mobile-row">
                    <button
                      type="button"
                      onClick={() => setDrawerTenantId(tenant.id)}
                      className="grid min-h-11 w-full gap-1.5 px-3 py-3 text-left transition active:bg-muted/60"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 break-words font-medium leading-5 text-primary">
                          {tenantName(tenant)}
                        </span>
                        <StatusBadge tone={onboardingTone}>
                          {onboardingStatusLabel}
                        </StatusBadge>
                      </div>
                      {allMode ? (
                        <div className="text-leasium-micro font-semibold uppercase text-muted-foreground">
                          {entityNameById.get(tenant.entity_id) ??
                            "Unknown entity"}
                        </div>
                      ) : null}
                      <div className="text-xs text-muted-foreground">
                        {tenant.contact_email ?? tenant.contact_phone ?? "No contact on file"}
                      </div>
                      {onboarding?.due_date ? (
                        <div
                          className={cn(
                            "text-xs text-muted-foreground",
                            dueRank(onboarding.due_date) < 0 &&
                              "font-medium text-danger",
                          )}
                        >
                          {dueLabel(onboarding.due_date)}
                        </div>
                      ) : null}
                      {needsFix ? (
                        <div className="text-xs font-medium text-danger">
                          Contact needs fixing — open to update.
                        </div>
                      ) : null}
                    </button>
                    <div className="flex flex-wrap gap-2 px-3 pb-3">
                      <Link
                        href={`/tenants/${tenant.id}`}
                        className={cn(tenantActionLinkClass, "min-w-[8rem] flex-1 rounded-lg px-3")}
                      >
                        <UserRound size={15} />
                        {needsFix ? "Fix contact" : "Open"}
                      </Link>
                      {onboarding?.status === "sent" &&
                      onboarding.onboarding_url &&
                      !isExpiredDateTime(onboarding.expires_at) ? (
                        <SecondaryButton
                          type="button"
                          className="min-w-[8rem] flex-1 rounded-lg px-3"
                          onClick={() =>
                            navigator.clipboard.writeText(
                              onboarding.onboarding_url,
                            )
                          }
                        >
                          <ClipboardCopy size={15} />
                          Copy link
                        </SecondaryButton>
                      ) : null}
                      {onboarding?.status === "sent" ? (
                        <SecondaryButton
                          type="button"
                          className="min-w-[8rem] flex-1 rounded-lg px-3"
                          onClick={() => cancelMutation.mutate(onboarding.id)}
                        >
                          <X size={15} />
                          Cancel
                        </SecondaryButton>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            {!tenantsLoading && tenantRows.length === 0 ? (
              <EmptyState
                icon={<UserRound size={18} />}
                title="No tenants match this view"
                description="Clear the search or switch filters to see the full tenant list."
              />
            ) : null}
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
        tenants={tenants}
        onboardings={onboardings}
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
            <section className="rounded-md border border-border bg-success-soft p-3 text-sm">
              <div className="font-semibold text-success-strong">
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
