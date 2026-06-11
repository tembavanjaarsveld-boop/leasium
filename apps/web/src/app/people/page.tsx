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
import { ArrowUpRight, Send, Sparkles, Users, Wrench } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { EntityPicker } from "@/components/entity-picker";
import { OwnersDirectory } from "@/components/owners-directory";
import { QueryProvider } from "@/components/query-provider";
import {
  EmptyState,
  PageHeader,
  SectionPanel,
  SkeletonRows,
  StatusBadge,
} from "@/components/ui";
import type { Entity } from "@/lib/api";
import { listContractors, listEntities, listTenants } from "@/lib/api";
import {
  ENTITY_CHANGED_EVENT,
  ENTITY_STORAGE_KEY,
  defaultEntitySelection,
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
function tabsForMode(showOwners: boolean): Array<{ key: TabKey; label: string }> {
  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "tenants", label: "Tenants" },
  ];
  if (showOwners) tabs.push({ key: "owners", label: "Owners" });
  tabs.push({ key: "vendors", label: "Vendors" });
  tabs.push({ key: "prospects", label: "Prospects" });
  return tabs;
}

const recordLinkClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2";

function isTabKey(value: string | null): value is TabKey {
  return (
    value === "tenants" ||
    value === "owners" ||
    value === "vendors" ||
    value === "prospects"
  );
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

  const [selectedEntityId, setSelectedEntityId] = useState("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(ENTITY_STORAGE_KEY);
    if (stored) setSelectedEntityId(stored);
  }, []);
  useEffect(() => {
    if (!selectedEntityId) return;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ENTITY_STORAGE_KEY, selectedEntityId);
    window.dispatchEvent(new Event(ENTITY_CHANGED_EVENT));
  }, [selectedEntityId]);
  useEffect(() => {
    if (selectedEntityId) return;
    const fallback = defaultEntitySelection(entitiesQuery.data ?? []);
    if (fallback) setSelectedEntityId(fallback);
  }, [entitiesQuery.data, selectedEntityId]);

  const { operatingMode, isResolved } = useOperatingMode();
  const showOwners = operatingMode !== "self_managed_owner";
  const TABS = tabsForMode(showOwners);

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

      <div className="mx-auto grid max-w-5xl gap-4 px-5 py-6">
        <PageHeader
          title="People"
          description="Every relationship in one place — tenants, owners, vendors, and (soon) prospects — tied together by leases."
        />

        <div
          role="tablist"
          aria-label="People types"
          className="flex flex-wrap gap-2"
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
                    ? "inline-flex min-h-11 items-center rounded-full border border-primary/30 bg-primary-soft px-4 text-sm font-semibold text-primary-hover transition"
                    : "inline-flex min-h-11 items-center rounded-full border border-border bg-white px-4 text-sm font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
                }
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === "owners" && showOwners ? (
          <OwnersDirectory entityId={scopeEntityId(selectedEntityId)} />
        ) : null}
        {activeTab === "tenants" ? (
          <TenantsTab
            entityId={selectedEntityId}
            entities={entitiesQuery.data}
          />
        ) : null}
        {activeTab === "vendors" ? (
          <VendorsTab
            entityId={selectedEntityId}
            entities={entitiesQuery.data}
          />
        ) : null}
        {activeTab === "prospects" ? <ProspectsTab /> : null}
      </div>
    </main>
  );
}

function TenantsTab({
  entityId,
  entities,
}: {
  entityId: string;
  entities: Entity[] | undefined;
}) {
  const allMode = isAllEntities(entityId);
  const scopedEntityId = scopeEntityId(entityId);
  const entityNameById = useMemo(
    () => new Map((entities ?? []).map((entity) => [entity.id, entity.name])),
    [entities],
  );
  const tenantsQuery = useQuery({
    queryKey: ["tenants", scopedEntityId],
    queryFn: () => listTenants(scopedEntityId),
    enabled: Boolean(scopedEntityId),
  });
  const tenantsFanOut = useEntityFanOut({
    entities,
    enabled: allMode,
    keyPrefix: ["tenants"],
    queryFn: listTenants,
  });
  const tenants = allMode ? tenantsFanOut.data : (tenantsQuery.data ?? []);
  const isLoading = allMode ? tenantsFanOut.isLoading : tenantsQuery.isLoading;
  const error = allMode ? tenantsFanOut.error : tenantsQuery.error;

  return (
    <SectionPanel
      title="Tenants"
      icon={<Users size={17} />}
      description="Tenant relationships, contacts, billing details, and portal-ready records."
      actions={
        <Link
          href="/tenants?action=invite"
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-transparent bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-primary-hover"
        >
          <Send size={14} />
          Add tenant
        </Link>
      }
    >
      <div className="p-4">
        {isLoading ? <SkeletonRows rows={3} /> : null}
        {error ? (
          <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {friendlyError(error)}
          </p>
        ) : null}
        {!isLoading && tenants.length === 0 && !error ? (
          <p className="text-sm text-muted-foreground">No tenants yet.</p>
        ) : null}
        <ul className="grid gap-2">
          {tenants.map((tenant) => {
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
                tenant.billing_email.toLowerCase() ===
                  contactEmail.toLowerCase(),
            );
            const contactLine = nameIsContactEmail
              ? tenant.contact_name
              : contactEmail || tenant.contact_name || "No contact";
            return (
            <li
              key={tenant.id}
              className="grid gap-2 rounded-lg border border-border bg-white px-3 py-3 text-sm md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">
                  {tenant.legal_name}
                </p>
                {allMode ? (
                  <p className="truncate text-leasium-micro font-semibold uppercase text-muted-foreground">
                    {entityNameById.get(tenant.entity_id) ?? "Unknown entity"}
                  </p>
                ) : null}
                <p className="truncate text-muted-foreground">
                  {tenant.trading_name || tenant.abn || "No trading name"}
                </p>
              </div>
              <div className="min-w-0 text-muted-foreground">
                {contactLine ? <p className="truncate">{contactLine}</p> : null}
                <p className="truncate">
                  {billingSameAsContact
                    ? "Billing: same as contact"
                    : tenant.billing_email
                      ? `Billing: ${tenant.billing_email}`
                      : "Billing email not set"}
                </p>
              </div>
              <div className="flex flex-wrap items-start justify-start gap-2 md:justify-end">
                <StatusBadge
                  tone={tenant.contact_email ? "success" : "warning"}
                >
                  {tenant.contact_email ? "Contact ready" : "Needs contact"}
                </StatusBadge>
                <Link href={`/tenants/${tenant.id}`} className={recordLinkClass}>
                  <ArrowUpRight size={15} />
                  Open record
                </Link>
              </div>
            </li>
            );
          })}
        </ul>
      </div>
    </SectionPanel>
  );
}

function VendorsTab({
  entityId,
  entities,
}: {
  entityId: string;
  entities: Entity[] | undefined;
}) {
  const allMode = isAllEntities(entityId);
  const scopedEntityId = scopeEntityId(entityId);
  const entityNameById = useMemo(
    () => new Map((entities ?? []).map((entity) => [entity.id, entity.name])),
    [entities],
  );
  const contractorsQuery = useQuery({
    queryKey: ["contractors", scopedEntityId],
    queryFn: () => listContractors(scopedEntityId),
    enabled: Boolean(scopedEntityId),
  });
  const contractorsFanOut = useEntityFanOut({
    entities,
    enabled: allMode,
    keyPrefix: ["contractors"],
    queryFn: listContractors,
  });
  const contractors = allMode
    ? contractorsFanOut.data
    : (contractorsQuery.data ?? []);
  const isLoading = allMode
    ? contractorsFanOut.isLoading
    : contractorsQuery.isLoading;
  const error = allMode ? contractorsFanOut.error : contractorsQuery.error;

  return (
    <SectionPanel
      title="Vendors"
      icon={<Wrench size={17} />}
      description="Maintenance vendors, categories, priority, and contact readiness."
    >
      <div className="p-4">
        {isLoading ? <SkeletonRows rows={3} /> : null}
        {error ? (
          <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {friendlyError(error)}
          </p>
        ) : null}
        {!isLoading && contractors.length === 0 && !error ? (
          <p className="text-sm text-muted-foreground">No vendors yet.</p>
        ) : null}
        <ul className="grid gap-2">
          {contractors.map((contractor) => (
            <li
              key={contractor.id}
              className="grid gap-2 rounded-lg border border-border bg-white px-3 py-3 text-sm md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">
                  {contractor.name}
                </p>
                {allMode ? (
                  <p className="truncate text-leasium-micro font-semibold uppercase text-muted-foreground">
                    {entityNameById.get(contractor.entity_id) ??
                      "Unknown entity"}
                  </p>
                ) : null}
                <p className="truncate text-muted-foreground">
                  {contractor.company_name || "Independent vendor"}
                </p>
              </div>
              <div className="min-w-0 text-muted-foreground">
                <p className="truncate">
                  {contractor.categories.length > 0
                    ? contractor.categories.join(", ")
                    : "No categories"}
                </p>
                <p className="truncate">
                  {contractor.email || contractor.phone || "No contact"}
                </p>
              </div>
              <div className="flex flex-wrap items-start justify-start gap-2 md:justify-end">
                <StatusBadge tone={contractor.email ? "success" : "warning"}>
                  {contractor.email ? "Contact ready" : "Needs contact"}
                </StatusBadge>
                <Link
                  href={`/contractors/${contractor.id}`}
                  className={recordLinkClass}
                >
                  <ArrowUpRight size={15} />
                  Open record
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </SectionPanel>
  );
}

function ProspectsTab() {
  return (
    <EmptyState
      icon={<Sparkles size={18} />}
      title="Prospects are on the roadmap."
      description="A leasing CRM (lead → application → screening → signed lease) joins the People hub in a later phase. For now, owners, tenants, and vendors live here."
    />
  );
}
