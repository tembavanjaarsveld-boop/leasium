"use client";

/**
 * /money — finance hub (DoorLoop benchmark P0, Phase 3).
 *
 * Groups the finance surfaces that previously competed for sidebar space:
 * Billing, owner statements, Xero, and Basiq. The underlying workspaces stay
 * alive so existing bookmarks and review-first provider guardrails keep working.
 */

import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Landmark,
  PlugZap,
  ReceiptText,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { QueryProvider } from "@/components/query-provider";
import { PageHeader, SectionPanel, Select, StatusBadge } from "@/components/ui";
import { listEntities } from "@/lib/api";
import {
  isManagingAgentOperatingMode,
  useOperatingMode,
} from "@/lib/use-operating-mode";

const ENTITY_STORAGE_KEY = "leasium.entity_id";

type MoneyTab = "billing" | "statements" | "xero" | "basiq";

const MONEY_TABS: Array<{ key: MoneyTab; label: string }> = [
  { key: "billing", label: "Billing" },
  { key: "statements", label: "Statements" },
  { key: "xero", label: "Xero" },
  { key: "basiq", label: "Basiq" },
];

type MoneyDestination = {
  key: MoneyTab;
  title: string;
  description: string;
  href: string;
  action: string;
  icon: ReactNode;
  badges: string[];
};

function moneyDestinations(showOwnerDispatch: boolean): MoneyDestination[] {
  return [
    {
      key: "billing",
      title: "Billing Readiness",
      description:
        "Invoice blockers, delivery approvals, payment state, and month-end handoff.",
      href: "/billing-readiness",
      action: "Open Billing Readiness",
      icon: <Wallet size={17} />,
      badges: ["Invoices", "Delivery", "Payments"],
    },
    {
      key: "statements",
      title: showOwnerDispatch ? "Owner statements" : "Entity statements",
      description: showOwnerDispatch
        ? "Monthly owner packs, invoice evidence, PDFs, and dispatch review."
        : "Entity-grouped statement reports, invoice evidence, and local PDF packs.",
      href: "/statements",
      action: showOwnerDispatch
        ? "Open owner statements"
        : "Open entity statements",
      icon: <ReceiptText size={17} />,
      badges: showOwnerDispatch
        ? ["Owners", "PDF packs", "Review-only"]
        : ["Entities", "PDF packs", "Local report"],
    },
    {
      key: "xero",
      title: "Xero",
      description:
        "Connection diagnostics, contact mapping, draft posting review, and exceptions.",
      href: "/settings?tab=xero",
      action: "Open Xero settings",
      icon: <PlugZap size={17} />,
      badges: ["Diagnostics", "Mappings", "No direct write"],
    },
    {
      key: "basiq",
      title: "Basiq bank feed",
      description:
        "Read-only bank connection status and reconciliation preview controls.",
      href: "/settings?tab=xero",
      action: "Open Basiq controls",
      icon: <Landmark size={17} />,
      badges: ["Bank feed", "Preview", "Review-first"],
    },
  ];
}

function isMoneyTab(value: string | null): value is MoneyTab {
  return (
    value === "billing" ||
    value === "statements" ||
    value === "xero" ||
    value === "basiq"
  );
}

export default function MoneyPage() {
  return (
    <QueryProvider>
      <MoneyContent />
    </QueryProvider>
  );
}

function MoneyContent() {
  const { operatingMode } = useOperatingMode();
  const showOwnerDispatch = isManagingAgentOperatingMode(operatingMode);
  const entitiesQuery = useQuery({
    queryKey: ["entities"],
    queryFn: listEntities,
  });
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [activeTab, setActiveTab] = useState<MoneyTab>("billing");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(ENTITY_STORAGE_KEY);
    if (stored) setSelectedEntityId(stored);
    const tab = new URL(window.location.href).searchParams.get("tab");
    if (isMoneyTab(tab)) setActiveTab(tab);
  }, []);

  useEffect(() => {
    if (!selectedEntityId) return;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ENTITY_STORAGE_KEY, selectedEntityId);
  }, [selectedEntityId]);

  useEffect(() => {
    if (selectedEntityId) return;
    const first = entitiesQuery.data?.[0]?.id;
    if (first) setSelectedEntityId(first);
  }, [entitiesQuery.data, selectedEntityId]);

  function selectTab(tab: MoneyTab) {
    setActiveTab(tab);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", url.toString());
  }

  const destinations = moneyDestinations(showOwnerDispatch);
  const activeDestination =
    destinations.find((destination) => destination.key === activeTab) ??
    destinations[0];

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
          title="Money"
          description={
            showOwnerDispatch
              ? "Billing, owner statements, Xero, and bank-feed review in one finance hub."
              : "Billing, statements, Xero, and bank-feed review in one finance hub."
          }
        />

        <div
          role="tablist"
          aria-label="Money areas"
          className="flex flex-wrap gap-2"
        >
          {MONEY_TABS.map((tab) => {
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

        <SectionPanel
          title={activeDestination.title}
          icon={activeDestination.icon}
          description={activeDestination.description}
          actions={
            <Link
              href={activeDestination.href}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-white px-3 text-sm font-semibold text-primary-hover transition duration-200 ease-leasium hover:bg-primary-soft"
            >
              {activeDestination.action}
              <ArrowUpRight size={15} />
            </Link>
          }
        >
          <div className="grid gap-4 p-4">
            <div className="flex flex-wrap gap-2">
              {activeDestination.badges.map((badge) => (
                <StatusBadge key={badge} tone="neutral">
                  {badge}
                </StatusBadge>
              ))}
            </div>
            <p className="flex items-start gap-2 rounded-md border border-primary/20 bg-primary-soft/60 px-3 py-2 text-sm text-muted-foreground">
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-primary" />
              Provider actions remain review-first and operator-approved.
            </p>
          </div>
        </SectionPanel>
      </div>
    </main>
  );
}
