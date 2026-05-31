"use client";

/**
 * /people — People hub (DoorLoop benchmark P0).
 *
 * One surface for every human/relationship in the portfolio: Tenants, Owners,
 * Vendors, and (later) Prospects. Owners is the new first-class directory backed
 * by /api/v1/owners; Tenants and Vendors render inline here so the sidebar can
 * stay at the seven-hub cap in design source of truth s10.5.1.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { QueryProvider } from "@/components/query-provider";
import {
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SecondaryButton,
  SectionPanel,
  Select,
  SkeletonRows,
  StatusBadge,
} from "@/components/ui";
import {
  createOwner,
  deleteOwner,
  listContractors,
  listEntities,
  listOwners,
  listTenants,
  type OwnerRecord,
} from "@/lib/api";
import { friendlyError } from "@/lib/utils";

const ENTITY_STORAGE_KEY = "leasium.entity_id";
const ENTITY_CHANGED_EVENT = "leasium:entity-id-change";

type TabKey = "tenants" | "owners" | "vendors" | "prospects";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "tenants", label: "Tenants" },
  { key: "owners", label: "Owners" },
  { key: "vendors", label: "Vendors" },
  { key: "prospects", label: "Prospects" },
];

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

function ownerName(owner: OwnerRecord) {
  return (
    owner.legal_name ||
    owner.trust_name ||
    owner.trustee_name ||
    owner.invoice_issuer_name ||
    "Unnamed owner"
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
    const first = entitiesQuery.data?.[0]?.id;
    if (first) setSelectedEntityId(first);
  }, [entitiesQuery.data, selectedEntityId]);

  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    if (typeof window === "undefined") return "owners";
    const tab = new URL(window.location.href).searchParams.get("tab");
    return isTabKey(tab) ? tab : "owners";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const tab = new URL(window.location.href).searchParams.get("tab");
    if (isTabKey(tab)) setActiveTab(tab);
  }, []);

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
        <Select
          aria-label="Entity"
          value={selectedEntityId}
          onChange={(event) => setSelectedEntityId(event.target.value)}
        >
          <option value="" disabled>
            Select an entity
          </option>
          {(entitiesQuery.data ?? []).map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))}
        </Select>
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
          {TABS.map((tab) => {
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
                    ? "inline-flex min-h-10 items-center rounded-full border border-primary/30 bg-primary-soft px-4 text-sm font-semibold text-primary-hover transition"
                    : "inline-flex min-h-10 items-center rounded-full border border-border bg-white px-4 text-sm font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
                }
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === "owners" ? (
          <OwnersDirectory entityId={selectedEntityId} />
        ) : null}
        {activeTab === "tenants" ? (
          <TenantsTab entityId={selectedEntityId} />
        ) : null}
        {activeTab === "vendors" ? (
          <VendorsTab entityId={selectedEntityId} />
        ) : null}
        {activeTab === "prospects" ? <ProspectsTab /> : null}
      </div>
    </main>
  );
}

function OwnersDirectory({ entityId }: { entityId: string }) {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const ownersQuery = useQuery({
    queryKey: ["owners", entityId],
    queryFn: () => listOwners(entityId),
    enabled: Boolean(entityId),
  });
  const owners = ownersQuery.data ?? [];

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["owners", entityId] });
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-end">
        <Button type="button" onClick={() => setShowCreate((prev) => !prev)}>
          <Plus size={16} />
          {showCreate ? "Close form" : "Add owner"}
        </Button>
      </div>

      {showCreate ? (
        <AddOwnerForm
          entityId={entityId}
          onSaved={() => {
            setShowCreate(false);
            refresh();
          }}
        />
      ) : null}

      {ownersQuery.isLoading ? (
        <SectionPanel>
          <SkeletonRows rows={4} />
        </SectionPanel>
      ) : null}

      {ownersQuery.error ? (
        <p className="rounded-md border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          {friendlyError(ownersQuery.error)}
        </p>
      ) : null}

      {!ownersQuery.isLoading && owners.length === 0 && !ownersQuery.error ? (
        <EmptyState
          icon={<Building2 size={18} />}
          title="No owners yet."
          description="Owners are now a first-class record. Add one here, or run the backfill (scripts.backfill_owners) to create owners from your existing property fields."
        />
      ) : null}

      {owners.map((owner) => (
        <OwnerCard key={owner.id} owner={owner} onChanged={refresh} />
      ))}
    </div>
  );
}

function OwnerCard({
  owner,
  onChanged,
}: {
  owner: OwnerRecord;
  onChanged: () => void;
}) {
  const deleteMutation = useMutation({
    mutationFn: () => deleteOwner(owner.id),
    onSuccess: () => onChanged(),
  });

  return (
    <SectionPanel
      title={ownerName(owner)}
      icon={<Building2 size={17} />}
      description={
        owner.trust_name && owner.trustee_name
          ? `Trustee: ${owner.trustee_name}`
          : undefined
      }
    >
      <div className="grid gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={owner.property_count > 0 ? "success" : "neutral"}>
            {owner.property_count}{" "}
            {owner.property_count === 1 ? "property" : "properties"}
          </StatusBadge>
          {owner.abn ? (
            <StatusBadge tone="neutral">ABN {owner.abn}</StatusBadge>
          ) : null}
          {owner.gst_registered ? (
            <StatusBadge tone="neutral">GST registered</StatusBadge>
          ) : null}
        </div>

        <dl className="grid gap-1 text-sm text-muted-foreground">
          {owner.billing_email ? (
            <div>Billing email: {owner.billing_email}</div>
          ) : null}
          {owner.invoice_reference ? (
            <div>Invoice ref: {owner.invoice_reference}</div>
          ) : null}
        </dl>

        {owner.properties.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {owner.properties.map((link) => (
              <span
                key={link.property_id}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-white px-3 py-1 text-xs text-foreground"
              >
                {link.property_name}
                <span className="text-muted-foreground">{link.split_pct}%</span>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No linked properties yet.
          </p>
        )}

        {deleteMutation.error ? (
          <p className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
            <AlertTriangle size={16} />
            {friendlyError(deleteMutation.error)}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link href={`/owners/${owner.id}`} className={recordLinkClass}>
            <ArrowUpRight size={15} />
            Open record
          </Link>
          <SecondaryButton
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  `Remove owner "${ownerName(owner)}"? Linked properties stay; only the owner record is soft-deleted.`,
                )
              ) {
                deleteMutation.mutate();
              }
            }}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Trash2 size={15} />
            )}
            Remove
          </SecondaryButton>
        </div>
      </div>
    </SectionPanel>
  );
}

function AddOwnerForm({
  entityId,
  onSaved,
}: {
  entityId: string;
  onSaved: () => void;
}) {
  const [legalName, setLegalName] = useState("");
  const [trustName, setTrustName] = useState("");
  const [abn, setAbn] = useState("");
  const [billingEmail, setBillingEmail] = useState("");

  const createMutation = useMutation({
    mutationFn: () =>
      createOwner({
        entity_id: entityId,
        legal_name: legalName.trim() || null,
        trust_name: trustName.trim() || null,
        abn: abn.trim() || null,
        billing_email: billingEmail.trim() || null,
      }),
    onSuccess: () => onSaved(),
  });

  const canSubmit = Boolean(entityId && (legalName.trim() || trustName.trim()));
  const error = createMutation.error as Error | null;

  return (
    <SectionPanel
      title="Add owner"
      icon={<UserPlus size={17} />}
      description="Give the owner a legal name or trust name. You can link properties and splits after it's created."
    >
      <form
        className="grid gap-3 p-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) createMutation.mutate();
        }}
      >
        <Field label="Legal name">
          <Input
            value={legalName}
            onChange={(event) => setLegalName(event.target.value)}
            placeholder="SKJ Holdings Pty Ltd"
          />
        </Field>
        <Field label="Trust name (optional)">
          <Input
            value={trustName}
            onChange={(event) => setTrustName(event.target.value)}
            placeholder="SKJ Family Trust"
          />
        </Field>
        <Field label="ABN (optional)">
          <Input
            value={abn}
            onChange={(event) => setAbn(event.target.value)}
            placeholder="11 222 333 444"
          />
        </Field>
        <Field label="Billing email (optional)">
          <Input
            type="email"
            value={billingEmail}
            onChange={(event) => setBillingEmail(event.target.value)}
            placeholder="owners@example.com"
          />
        </Field>
        {error ? (
          <p className="md:col-span-2 flex items-center gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
            <AlertTriangle size={16} />
            {friendlyError(error)}
          </p>
        ) : null}
        <div className="md:col-span-2 flex items-center justify-end">
          <Button
            type="submit"
            disabled={!canSubmit || createMutation.isPending}
          >
            {createMutation.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Plus size={16} />
            )}
            {createMutation.isPending ? "Saving…" : "Save owner"}
          </Button>
        </div>
      </form>
    </SectionPanel>
  );
}

function TenantsTab({ entityId }: { entityId: string }) {
  const tenantsQuery = useQuery({
    queryKey: ["tenants", entityId],
    queryFn: () => listTenants(entityId),
    enabled: Boolean(entityId),
  });
  const tenants = tenantsQuery.data ?? [];

  return (
    <SectionPanel
      title="Tenants"
      icon={<Users size={17} />}
      description="Tenant relationships, contacts, billing details, and portal-ready records."
    >
      <div className="p-4">
        {tenantsQuery.isLoading ? <SkeletonRows rows={3} /> : null}
        {tenantsQuery.error ? (
          <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {friendlyError(tenantsQuery.error)}
          </p>
        ) : null}
        {!tenantsQuery.isLoading &&
        tenants.length === 0 &&
        !tenantsQuery.error ? (
          <p className="text-sm text-muted-foreground">No tenants yet.</p>
        ) : null}
        <ul className="grid gap-2">
          {tenants.map((tenant) => (
            <li
              key={tenant.id}
              className="grid gap-2 rounded-lg border border-border bg-white px-3 py-3 text-sm md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">
                  {tenant.legal_name}
                </p>
                <p className="truncate text-muted-foreground">
                  {tenant.trading_name || tenant.abn || "No trading name"}
                </p>
              </div>
              <div className="min-w-0 text-muted-foreground">
                <p className="truncate">
                  {tenant.contact_email || tenant.contact_name || "No contact"}
                </p>
                <p className="truncate">
                  {tenant.billing_email
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
          ))}
        </ul>
      </div>
    </SectionPanel>
  );
}

function VendorsTab({ entityId }: { entityId: string }) {
  const contractorsQuery = useQuery({
    queryKey: ["contractors", entityId],
    queryFn: () => listContractors(entityId),
    enabled: Boolean(entityId),
  });
  const contractors = contractorsQuery.data ?? [];

  return (
    <SectionPanel
      title="Vendors"
      icon={<Wrench size={17} />}
      description="Maintenance vendors, categories, priority, and contact readiness."
    >
      <div className="p-4">
        {contractorsQuery.isLoading ? <SkeletonRows rows={3} /> : null}
        {contractorsQuery.error ? (
          <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {friendlyError(contractorsQuery.error)}
          </p>
        ) : null}
        {!contractorsQuery.isLoading &&
        contractors.length === 0 &&
        !contractorsQuery.error ? (
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
