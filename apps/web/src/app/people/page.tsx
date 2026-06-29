"use client";

/**
 * /people — People hub (DoorLoop benchmark P0).
 *
 * One surface for every human/relationship in the portfolio: Tenants, Owners,
 * Vendors, and (later) Prospects. Owners is the new first-class directory backed
 * by /api/v1/owners; Tenants and Vendors render inline here so the sidebar can
 * stay at the seven-hub cap in design source of truth s10.5.1.
 */

import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Plus,
  Send,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { OwnersDirectory } from "@/components/owners-directory";
import { QueryProvider } from "@/components/query-provider";
import { SkeletonRows, StatusBadge } from "@/components/ui";
import type { ContractorRecord, OwnerRecord, TenantRecord } from "@/lib/api";
import {
  listContractors,
  listEntities,
  listOwners,
  listTenants,
} from "@/lib/api";
import {
  ALL_ENTITIES_VALUE,
  isAllEntities,
  scopeEntityId,
} from "@/lib/entity-selection";
import { useEntityFanOut } from "@/lib/use-entity-fan-out";
import { useOperatingMode } from "@/lib/use-operating-mode";
import { friendlyError } from "@/lib/utils";

type TabKey = "tenants" | "owners" | "vendors" | "prospects";

// The People → Owners *hub* is managing_agent framing ("owner clients"); a
// self_managed_owner has no third-party owners, so the tab is dropped for that
// mode (docs/account-operating-mode-ia.md). Their owner-entity CRUD still lives
// in Settings → Entities via the shared OwnersDirectory.
function tabsForMode(
  showOwners: boolean,
): Array<{ key: TabKey; label: string }> {
  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "tenants", label: "Tenants" },
  ];
  if (showOwners) tabs.push({ key: "owners", label: "Owners" });
  tabs.push({ key: "vendors", label: "Vendors" });
  tabs.push({ key: "prospects", label: "Prospects" });
  return tabs;
}

const horizonActionLinkClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2";

const horizonPrimaryLinkClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-transparent bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2";

const horizonCardClass =
  "group relative min-h-[92px] overflow-hidden rounded-[18px] border border-leasium-card-border bg-white p-4 shadow-leasiumCard transition duration-200 ease-leasium hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-leasiumElevated motion-reduce:transition-none motion-reduce:hover:translate-y-0";

const horizonMutedCardClass =
  "relative min-h-[92px] overflow-hidden rounded-[18px] border border-dashed border-primary/25 bg-leasium-canvas p-4 text-center";

function isTabKey(value: string | null): value is TabKey {
  return (
    value === "tenants" ||
    value === "owners" ||
    value === "vendors" ||
    value === "prospects"
  );
}

function countLabel(count: number | null) {
  return count == null ? "—" : String(count);
}

function personInitials(name: string) {
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return "L";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function tenantStatus(tenant: TenantRecord) {
  if (!tenant.contact_email) {
    return {
      tone: "warning" as const,
      label: "Needs contact",
      detail: "Contact missing",
      avatarClass: "bg-warning text-white",
      railClass: "bg-warning",
    };
  }
  if (tenant.billing_email) {
    return {
      tone: "success" as const,
      label: "Billing ready",
      detail: "Portal active",
      avatarClass: "bg-primary text-white",
      railClass: "",
    };
  }
  return {
    tone: "primary" as const,
    label: "Contact ready",
    detail: "Billing email missing",
    avatarClass: "bg-primary text-white",
    railClass: "",
  };
}

function vendorStatus(contractor: ContractorRecord) {
  if (!contractor.email && !contractor.phone) {
    return {
      tone: "warning" as const,
      label: "Needs contact",
      detail: "Contact missing",
      avatarClass: "bg-warning text-white",
      railClass: "bg-warning",
    };
  }
  if (contractor.priority === 1) {
    return {
      tone: "success" as const,
      label: "Preferred",
      detail: contractor.email ? "Email ready" : "Phone ready",
      avatarClass: "bg-accent text-white",
      railClass: "",
    };
  }
  return {
    tone: "primary" as const,
    label: "Vendor ready",
    detail: contractor.email ? "Email ready" : "Phone ready",
    avatarClass: "bg-primary text-white",
    railClass: "",
  };
}

export default function PeoplePage() {
  return (
    <QueryProvider>
      <PeopleContent />
    </QueryProvider>
  );
}

function PeopleContent() {
  const entitiesQuery = useQuery({
    queryKey: ["entities"],
    queryFn: listEntities,
  });

  // The portfolio is all-entities by default — the global entity switcher is
  // gone and the entity is now a per-list trust tag (?trust_tag, below). The
  // org-wide read path always runs; a single entity is reached via the tag, not
  // a page-level pin.
  const selectedEntityId = ALL_ENTITIES_VALUE;

  const { operatingMode, isResolved } = useOperatingMode();
  const showOwners = operatingMode !== "self_managed_owner";
  const TABS = tabsForMode(showOwners);
  const allMode = isAllEntities(selectedEntityId);
  const scopedEntityId = scopeEntityId(selectedEntityId);
  const entityNameById = useMemo(
    () =>
      new Map(
        (entitiesQuery.data ?? []).map((entity) => [entity.id, entity.name]),
      ),
    [entitiesQuery.data],
  );

  // Trust-as-tag filter: clicking a row's trust tag narrows the all-entities
  // list to that entity. Held in ?trust_tag so it is shareable and can later be
  // set from the command bar. Only meaningful in all-entities mode.
  const [trustTagFilter, setTrustTagFilter] = useState("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const tag = new URL(window.location.href).searchParams.get("trust_tag");
    setTrustTagFilter(tag ?? "");
  }, []);
  const applyTrustTag = (entityId: string) => {
    setTrustTagFilter(entityId);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (entityId) url.searchParams.set("trust_tag", entityId);
    else url.searchParams.delete("trust_tag");
    window.history.replaceState({}, "", url);
  };
  const clearTrustTag = () => applyTrustTag("");
  const trustTagName = trustTagFilter
    ? (entityNameById.get(trustTagFilter) ?? "Unknown entity")
    : "";

  const tenantsQuery = useQuery({
    queryKey: ["tenants", scopedEntityId],
    queryFn: () => listTenants(scopedEntityId),
    enabled: Boolean(scopedEntityId),
  });
  const tenantsFanOut = useEntityFanOut({
    entities: entitiesQuery.data,
    enabled: allMode,
    keyPrefix: ["tenants"],
    queryFn: listTenants,
    orgWideQueryFn: () => listTenants(),
  });
  const tenants = allMode ? tenantsFanOut.data : (tenantsQuery.data ?? []);
  const tenantsLoading = allMode
    ? tenantsFanOut.isLoading
    : tenantsQuery.isLoading;
  const tenantsError = allMode ? tenantsFanOut.error : tenantsQuery.error;

  const contractorsQuery = useQuery({
    queryKey: ["contractors", scopedEntityId],
    queryFn: () => listContractors(scopedEntityId),
    enabled: Boolean(scopedEntityId),
  });
  const contractorsFanOut = useEntityFanOut({
    entities: entitiesQuery.data,
    enabled: allMode,
    keyPrefix: ["contractors"],
    queryFn: listContractors,
    orgWideQueryFn: () => listContractors(),
  });
  const contractors = allMode
    ? contractorsFanOut.data
    : (contractorsQuery.data ?? []);
  const contractorsLoading = allMode
    ? contractorsFanOut.isLoading
    : contractorsQuery.isLoading;
  const contractorsError = allMode
    ? contractorsFanOut.error
    : contractorsQuery.error;
  const ownersFanOut = useEntityFanOut<OwnerRecord>({
    entities: entitiesQuery.data,
    enabled: allMode && showOwners,
    keyPrefix: ["owners"],
    queryFn: listOwners,
  });
  const ownersLoading =
    allMode && showOwners
      ? entitiesQuery.isLoading || ownersFanOut.isLoading
      : false;
  const ownersError =
    allMode && showOwners
      ? (entitiesQuery.error ?? ownersFanOut.error)
      : null;

  // Default toward "tenants": until the mode resolves we assume self-managed
  // (Owners hidden), so the initial tab must not be "owners" or it would render
  // a hub the user shouldn't see. Once resolved, a managing agent with no
  // explicit ?tab still lands on Owners via the effect below.
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    if (typeof window === "undefined") return "tenants";
    const tab = new URL(window.location.href).searchParams.get("tab");
    return isTabKey(tab) && tab !== "owners" ? tab : "tenants";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const tab = new URL(window.location.href).searchParams.get("tab");
    // Honour an explicit ?tab only if it resolves to a tab this mode exposes;
    // a hand-typed ?tab=owners under self_managed_owner falls back to tenants
    // once the operating mode is known.
    if (isTabKey(tab) && (tab !== "owners" || showOwners)) {
      setActiveTab(tab);
    } else if (!tab && showOwners) {
      setActiveTab("owners");
    } else if (isResolved && tab) {
      setActiveTab("tenants");
      const url = new URL(window.location.href);
      url.searchParams.set("tab", "tenants");
      window.history.replaceState(null, "", url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isResolved, showOwners]);

  function selectTab(tab: TabKey) {
    setActiveTab(tab);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", url.toString());
  }

  const tabCounts: Record<TabKey, number | null> = {
    tenants: tenantsLoading ? null : tenants.length,
    owners:
      allMode && showOwners
        ? ownersLoading || ownersError
          ? null
          : ownersFanOut.data.length
        : null,
    vendors: contractorsLoading ? null : contractors.length,
    prospects: 0,
  };

  return (
    <main className="min-h-screen">
      <AppHeader />

      <div className="mx-auto grid max-w-[1040px] gap-[14px] px-5 pb-28 pt-6 lg:px-9 lg:pb-6">
        <section className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold leading-tight tracking-normal text-foreground">
              People
            </h1>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              Tenants and vendors across the portfolio.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/tenants?action=invite"
              className={horizonActionLinkClass}
            >
              <Send size={15} />
              Invite tenant
            </Link>
            <Link
              href="/tenants?action=invite"
              className={horizonPrimaryLinkClass}
            >
              <Plus size={15} />
              Add person
            </Link>
          </div>
        </section>

        <div
          role="tablist"
          aria-label="People types"
          className="inline-flex w-fit max-w-full flex-wrap gap-0.5 rounded-full border border-leasium-card-border bg-white p-1 shadow-leasiumXs"
        >
          {(isResolved ? TABS : tabsForMode(false)).map((tab) => {
            const isActive = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                role="tab"
                type="button"
                aria-selected={isActive}
                onClick={() => selectTab(tab.key)}
                className={
                  isActive
                    ? "inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-primary-hover"
                    : "inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold text-muted-foreground transition duration-200 ease-leasium hover:bg-muted hover:text-foreground"
                }
              >
                {isActive ? (
                  <span
                    aria-hidden="true"
                    data-ui="people-tab-brand-dot"
                    className="h-2 w-2 shrink-0 rounded-full bg-accent shadow-[0_0_0_2px_rgba(255,255,255,0.18)]"
                  />
                ) : null}
                <span>{tab.label}</span>
                <span
                  className={
                    isActive
                      ? "text-xs font-semibold text-primary-foreground/90"
                      : "text-xs font-semibold text-muted-foreground"
                  }
                >
                  {countLabel(tabCounts[tab.key])}
                </span>
              </button>
            );
          })}
        </div>

        {activeTab === "owners" && showOwners ? (
          <OwnersDirectory
            entityId={scopedEntityId}
            owners={allMode ? ownersFanOut.data : undefined}
            isLoading={allMode ? ownersLoading : undefined}
            error={allMode ? ownersError : undefined}
            onRefresh={allMode ? ownersFanOut.refetch : undefined}
          />
        ) : null}
        {activeTab === "tenants" ? (
          <TenantsTab
            allMode={allMode}
            entityNameById={entityNameById}
            tenants={tenants}
            isLoading={tenantsLoading}
            error={tenantsError}
            trustTagFilter={trustTagFilter}
            trustTagName={trustTagName}
            onSelectTrust={applyTrustTag}
            onClearTrust={clearTrustTag}
          />
        ) : null}
        {activeTab === "vendors" ? (
          <VendorsTab
            allMode={allMode}
            entityNameById={entityNameById}
            contractors={contractors}
            isLoading={contractorsLoading}
            error={contractorsError}
            trustTagFilter={trustTagFilter}
            trustTagName={trustTagName}
            onSelectTrust={applyTrustTag}
            onClearTrust={clearTrustTag}
          />
        ) : null}
        {activeTab === "prospects" ? <ProspectsTab /> : null}
      </div>
    </main>
  );
}

function TrustTag({
  entityId,
  entityName,
  active,
  onSelect,
}: {
  entityId: string;
  entityName: string | undefined;
  active: boolean;
  onSelect: (entityId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(entityId)}
      title={`Filter by ${entityName ?? "this trust"}`}
      className={`mt-1 inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-leasium-micro font-semibold uppercase transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
        active
          ? "bg-primary-soft text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {entityName ?? "Unknown entity"}
    </button>
  );
}

function TrustFilterBar({
  name,
  onClear,
}: {
  name: string;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-full border border-leasium-card-border bg-muted px-3 py-1.5">
      <span className="truncate text-xs font-semibold text-foreground">
        Showing {name} only
      </span>
      <button
        type="button"
        onClick={onClear}
        className="inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-xs font-semibold text-primary transition hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        Clear
      </button>
    </div>
  );
}

function TenantsTab({
  allMode,
  entityNameById,
  tenants,
  isLoading,
  error,
  trustTagFilter,
  trustTagName,
  onSelectTrust,
  onClearTrust,
}: {
  allMode: boolean;
  entityNameById: Map<string, string>;
  tenants: TenantRecord[];
  isLoading: boolean;
  error: unknown;
  trustTagFilter: string;
  trustTagName: string;
  onSelectTrust: (entityId: string) => void;
  onClearTrust: () => void;
}) {
  const visibleTenants =
    allMode && trustTagFilter
      ? tenants.filter((tenant) => tenant.entity_id === trustTagFilter)
      : tenants;
  return (
    <section aria-labelledby="people-tenants-heading" className="grid gap-3">
      <div className="sr-only">
        <h2 id="people-tenants-heading">Tenants</h2>
      </div>
      {allMode && trustTagFilter ? (
        <TrustFilterBar name={trustTagName} onClear={onClearTrust} />
      ) : null}
      {isLoading ? (
        <div className="rounded-[18px] border border-leasium-card-border bg-white p-4 shadow-leasiumCard">
          <SkeletonRows rows={3} />
        </div>
      ) : null}
      {error ? (
        <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          {friendlyError(error)}
        </p>
      ) : null}
      {!isLoading && visibleTenants.length === 0 && !error ? (
        <div className={horizonMutedCardClass}>
          <Users size={20} className="mx-auto text-primary" />
          <p className="mt-2 text-sm font-semibold text-foreground">
            No tenants yet
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Invite the first tenant from the reviewed tenant workflow.
          </p>
        </div>
      ) : null}
      <ul className="grid gap-[14px] md:grid-cols-2 xl:grid-cols-3">
        {visibleTenants.map((tenant) => {
          const contactEmail = tenant.contact_email || null;
          // Avoid repeating the same email: rows whose display name is the
          // contact email show it once, and identical billing emails render
          // as "same as contact".
          const nameIsContactEmail = Boolean(
            contactEmail &&
            tenant.legal_name.trim().toLowerCase() ===
              contactEmail.toLowerCase(),
          );
          const billingSameAsContact = Boolean(
            tenant.billing_email &&
            contactEmail &&
            tenant.billing_email.toLowerCase() === contactEmail.toLowerCase(),
          );
          const contactLine = nameIsContactEmail
            ? tenant.contact_name
            : contactEmail || tenant.contact_name || "No contact";
          const status = tenantStatus(tenant);
          const entityName = entityNameById.get(tenant.entity_id);
          return (
            <li key={tenant.id} className={horizonCardClass}>
              {status.railClass ? (
                <div
                  className={`absolute inset-y-0 left-0 w-[3px] ${status.railClass}`}
                />
              ) : null}
              <div className="flex min-w-0 gap-3">
                <div
                  className={`flex size-[34px] shrink-0 items-center justify-center rounded-full text-xs font-bold ${status.avatarClass}`}
                >
                  {personInitials(tenant.legal_name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {tenant.legal_name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {tenant.trading_name ||
                          tenant.abn ||
                          contactLine ||
                          "No trading name"}
                      </p>
                    </div>
                    <Link
                      href={`/tenants/${tenant.id}`}
                      className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full px-2 text-primary transition hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                      aria-label={`Open ${tenant.legal_name}`}
                    >
                      <ArrowUpRight size={16} />
                    </Link>
                  </div>
                  {allMode ? (
                    <TrustTag
                      entityId={tenant.entity_id}
                      entityName={entityName}
                      active={trustTagFilter === tenant.entity_id}
                      onSelect={onSelectTrust}
                    />
                  ) : null}
                  <div className="mt-3 flex items-center gap-2">
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    <div className="min-w-0 flex-1" />
                    <p className="truncate text-xs text-muted-foreground">
                      {status.detail}
                    </p>
                  </div>
                  <p className="mt-2 truncate text-xs text-muted-foreground">
                    {tenant.billing_email
                      ? billingSameAsContact
                        ? "Billing: same as contact"
                        : `Billing: ${tenant.billing_email}`
                      : "Billing email not set"}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
        <li className={horizonMutedCardClass}>
          <Link
            href="/tenants?action=invite"
            className="flex min-h-[72px] flex-col items-center justify-center gap-2 text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <Plus size={18} />
            <span className="text-sm font-semibold">Add person</span>
          </Link>
        </li>
      </ul>
    </section>
  );
}

function VendorsTab({
  allMode,
  entityNameById,
  contractors,
  isLoading,
  error,
  trustTagFilter,
  trustTagName,
  onSelectTrust,
  onClearTrust,
}: {
  allMode: boolean;
  entityNameById: Map<string, string>;
  contractors: ContractorRecord[];
  isLoading: boolean;
  error: unknown;
  trustTagFilter: string;
  trustTagName: string;
  onSelectTrust: (entityId: string) => void;
  onClearTrust: () => void;
}) {
  const visibleContractors =
    allMode && trustTagFilter
      ? contractors.filter(
          (contractor) => contractor.entity_id === trustTagFilter,
        )
      : contractors;
  return (
    <section aria-labelledby="people-vendors-heading" className="grid gap-3">
      <div className="sr-only">
        <h2 id="people-vendors-heading">Vendors</h2>
      </div>
      {allMode && trustTagFilter ? (
        <TrustFilterBar name={trustTagName} onClear={onClearTrust} />
      ) : null}
      {isLoading ? (
        <div className="rounded-[18px] border border-leasium-card-border bg-white p-4 shadow-leasiumCard">
          <SkeletonRows rows={3} />
        </div>
      ) : null}
      {error ? (
        <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          {friendlyError(error)}
        </p>
      ) : null}
      {!isLoading && visibleContractors.length === 0 && !error ? (
        <div className={horizonMutedCardClass}>
          <Wrench size={20} className="mx-auto text-primary" />
          <p className="mt-2 text-sm font-semibold text-foreground">
            No vendors yet
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add preferred contractors from the vendor directory.
          </p>
        </div>
      ) : null}
      <ul className="grid gap-[14px] md:grid-cols-2 xl:grid-cols-3">
        {visibleContractors.map((contractor) => {
          const status = vendorStatus(contractor);
          const entityName = entityNameById.get(contractor.entity_id);
          return (
            <li key={contractor.id} className={horizonCardClass}>
              {status.railClass ? (
                <div
                  className={`absolute inset-y-0 left-0 w-[3px] ${status.railClass}`}
                />
              ) : null}
              <div className="flex min-w-0 gap-3">
                <div
                  className={`flex size-[34px] shrink-0 items-center justify-center rounded-full text-xs font-bold ${status.avatarClass}`}
                >
                  {personInitials(contractor.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {contractor.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {contractor.company_name || "Independent vendor"}
                      </p>
                    </div>
                    <Link
                      href={`/contractors/${contractor.id}`}
                      className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full px-2 text-primary transition hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                      aria-label={`Open ${contractor.name}`}
                    >
                      <ArrowUpRight size={16} />
                    </Link>
                  </div>
                  {allMode ? (
                    <TrustTag
                      entityId={contractor.entity_id}
                      entityName={entityName}
                      active={trustTagFilter === contractor.entity_id}
                      onSelect={onSelectTrust}
                    />
                  ) : null}
                  <div className="mt-3 flex items-center gap-2">
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    <div className="min-w-0 flex-1" />
                    <p className="truncate text-xs text-muted-foreground">
                      {status.detail}
                    </p>
                  </div>
                  <p className="mt-2 truncate text-xs text-muted-foreground">
                    {contractor.categories.length > 0
                      ? contractor.categories.join(", ")
                      : "No categories"}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
        <li className={horizonMutedCardClass}>
          <Link
            href="/contractors"
            className="flex min-h-[72px] flex-col items-center justify-center gap-2 text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <Plus size={18} />
            <span className="text-sm font-semibold">Add vendor</span>
          </Link>
        </li>
      </ul>
    </section>
  );
}

function ProspectsTab() {
  return (
    <section aria-labelledby="people-prospects-heading" className="grid gap-3">
      <div className="sr-only">
        <h2 id="people-prospects-heading">Prospects</h2>
      </div>
      <div className="grid gap-[14px] md:grid-cols-2 xl:grid-cols-3">
        <div className={horizonMutedCardClass}>
          <Sparkles size={20} className="mx-auto text-primary" />
          <p className="mt-2 text-sm font-semibold text-foreground">
            Prospects are on the roadmap
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Leasing CRM, applications, screening, and signed-lease conversion
            will join the People hub later.
          </p>
        </div>
        <div className={horizonMutedCardClass}>
          <Plus size={20} className="mx-auto text-primary" />
          <p className="mt-2 text-sm font-semibold text-primary">
            Add prospect
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Not available yet; use Smart Intake or Tenants for reviewed records
            today.
          </p>
        </div>
      </div>
    </section>
  );
}
