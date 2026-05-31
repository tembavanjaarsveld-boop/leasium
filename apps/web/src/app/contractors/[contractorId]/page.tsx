"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  FileText,
  Mail,
  MapPin,
  Phone,
  ReceiptText,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import {
  PeopleRecordLayout,
  peopleRecordTabs,
} from "@/components/people-record-layout";
import { QueryProvider } from "@/components/query-provider";
import {
  EmptyState,
  SecondaryButton,
  SectionPanel,
  Select,
  SkeletonRows,
  StatusBadge,
  type StatusTone,
} from "@/components/ui";
import {
  ApiError,
  type ContractorRecord,
  getContractor,
  listEntities,
} from "@/lib/api";
import { friendlyError } from "@/lib/utils";

const ENTITY_STORAGE_KEY = "leasium.entity_id";
const ENTITY_CHANGED_EVENT = "leasium:entity-id-change";

const PRIORITY_LABEL: Record<number, string> = {
  1: "Preferred",
  2: "Normal",
  3: "Backup",
};

const PRIORITY_TONE: Record<number, StatusTone> = {
  1: "success",
  2: "neutral",
  3: "warning",
};

function paramValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function displayName(contractor: ContractorRecord) {
  return contractor.name || contractor.company_name || "Unnamed vendor";
}

function formatCategory(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function contactStatus(contractor: ContractorRecord) {
  if (contractor.email && contractor.phone) {
    return { label: "Email and phone ready", tone: "success" as const };
  }
  if (contractor.email || contractor.phone) {
    return { label: "Partial contact", tone: "warning" as const };
  }
  return { label: "Needs contact", tone: "danger" as const };
}

function serviceRadiusLabel(contractor: ContractorRecord) {
  if (contractor.service_radius_km == null) {
    return "No radius set";
  }
  return `${contractor.service_radius_km} km service radius`;
}

function isNotFoundError(error: unknown) {
  return error instanceof ApiError && error.status === 404;
}

function DetailItem({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
}) {
  return (
    <div className="grid gap-1 rounded-lg border border-border bg-white px-3 py-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

function PlaceholderPanel({
  id,
  title,
  description,
  icon,
}: {
  id: (typeof peopleRecordTabs)[number]["id"];
  title: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <div id={id}>
      <SectionPanel title={title} icon={icon}>
        <EmptyState title={title} description={description} />
      </SectionPanel>
    </div>
  );
}

export default function ContractorDetailPage() {
  return (
    <QueryProvider>
      <ContractorDetailContent />
    </QueryProvider>
  );
}

function ContractorDetailContent() {
  const params = useParams();
  const contractorId = paramValue(params.contractorId);

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

  const contractorQuery = useQuery({
    queryKey: ["contractor", contractorId],
    queryFn: () => getContractor(contractorId ?? ""),
    enabled: Boolean(contractorId),
  });

  useEffect(() => {
    if (!contractorQuery.data) return;
    if (contractorQuery.data.entity_id !== selectedEntityId) {
      setSelectedEntityId(contractorQuery.data.entity_id);
    }
  }, [contractorQuery.data, selectedEntityId]);

  const isLoading = entitiesQuery.isLoading || contractorQuery.isLoading;
  const vendorNotFound = isNotFoundError(contractorQuery.error);
  const genericError =
    entitiesQuery.error || (vendorNotFound ? null : contractorQuery.error);

  return (
    <main className="min-h-screen">
      <AppHeader>
        <Select
          value={selectedEntityId}
          onChange={(event) => setSelectedEntityId(event.target.value)}
          aria-label="Select entity"
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

      <div className="mx-auto grid max-w-6xl gap-5 px-5 py-6">
        {isLoading ? (
          <PeopleRecordLayout
            backHref="/people?tab=vendors"
            backLabel="Vendors"
            title="Loading vendor"
            description="Fetching the vendor record and contact readiness."
          >
            <SectionPanel>
              <SkeletonRows rows={5} />
            </SectionPanel>
          </PeopleRecordLayout>
        ) : null}

        {genericError ? (
          <PeopleRecordLayout
            backHref="/people?tab=vendors"
            backLabel="Vendors"
            title="Vendor unavailable"
            description="The vendor record could not be loaded."
          >
            <p className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
              <AlertTriangle size={16} />
              {friendlyError(genericError)}
            </p>
          </PeopleRecordLayout>
        ) : null}

        {!isLoading && vendorNotFound ? (
          <PeopleRecordLayout
            backHref="/people?tab=vendors"
            backLabel="Vendors"
            title="Vendor not found"
            description="This vendor record could not be found in the current workspace."
          >
            <SectionPanel>
              <EmptyState
                icon={<AlertTriangle size={18} />}
                title="No vendor record found."
                description="This vendor record may have been deleted or moved. Return to the vendor directory to choose another record."
                action={
                  <Link href="/people?tab=vendors">
                    <SecondaryButton type="button">
                      Back to vendors
                    </SecondaryButton>
                  </Link>
                }
              />
            </SectionPanel>
          </PeopleRecordLayout>
        ) : null}

        {contractorQuery.data ? (
          <ContractorRecordView contractor={contractorQuery.data} />
        ) : null}
      </div>
    </main>
  );
}

function ContractorRecordView({
  contractor,
}: {
  contractor: ContractorRecord;
}) {
  const contact = contactStatus(contractor);
  const priorityLabel =
    PRIORITY_LABEL[contractor.priority] ?? `Priority ${contractor.priority}`;

  return (
    <PeopleRecordLayout
      backHref="/people?tab=vendors"
      backLabel="Vendors"
      title={displayName(contractor)}
      description="Vendor profile, contact readiness, service coverage, and relationship notes."
      actions={
        <StatusBadge tone={contact.tone}>{contact.label}</StatusBadge>
      }
      summary={
        <div className="grid gap-3 md:grid-cols-4">
          <DetailItem
            label="Primary contact"
            value={contractor.name}
            icon={<Wrench size={14} />}
          />
          <DetailItem
            label="Priority"
            value={priorityLabel}
            icon={<AlertTriangle size={14} />}
          />
          <DetailItem
            label="Coverage"
            value={serviceRadiusLabel(contractor)}
            icon={<MapPin size={14} />}
          />
          <DetailItem
            label="Categories"
            value={
              contractor.categories.length
                ? `${contractor.categories.length} active`
                : "No categories"
            }
            icon={<Building2 size={14} />}
          />
        </div>
      }
    >
      <div className="grid gap-5">
        <div id="overview">
          <SectionPanel
            title="Overview"
            icon={<Wrench size={17} />}
            actions={
              <StatusBadge
                tone={PRIORITY_TONE[contractor.priority] ?? "neutral"}
              >
                {priorityLabel}
              </StatusBadge>
            }
          >
            <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
              <div className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <DetailItem
                    label="Company"
                    value={contractor.company_name || "Independent vendor"}
                    icon={<Building2 size={14} />}
                  />
                  <DetailItem
                    label="Service priority"
                    value={priorityLabel}
                    icon={<AlertTriangle size={14} />}
                  />
                  <DetailItem
                    label="Email"
                    value={contractor.email || "No email on file"}
                    icon={<Mail size={14} />}
                  />
                  <DetailItem
                    label="Phone"
                    value={contractor.phone || "No phone on file"}
                    icon={<Phone size={14} />}
                  />
                </div>

                <div className="grid gap-2">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    Categories
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {contractor.categories.length ? (
                      contractor.categories.map((category) => (
                        <StatusBadge key={category} tone="primary">
                          {formatCategory(category)}
                        </StatusBadge>
                      ))
                    ) : (
                      <StatusBadge tone="warning">No categories</StatusBadge>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid gap-4">
                <div className="grid gap-2 rounded-lg border border-border bg-white px-3 py-3">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    Notes
                  </div>
                  <div className="text-sm leading-6 text-muted-foreground">
                    {contractor.notes?.trim() ||
                      "No notes have been added for this vendor yet."}
                  </div>
                </div>
                <div className="grid gap-2 rounded-lg border border-border bg-white px-3 py-3">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    Readiness
                  </div>
                  <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                    <span>Contact details</span>
                    <StatusBadge tone={contact.tone}>
                      {contact.label}
                    </StatusBadge>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                    <span>Maintenance matching</span>
                    <StatusBadge
                      tone={
                        contractor.categories.length ? "success" : "warning"
                      }
                    >
                      {contractor.categories.length
                        ? "Categories ready"
                        : "Needs category"}
                    </StatusBadge>
                  </div>
                </div>
              </div>
            </div>
          </SectionPanel>
        </div>

        <PlaceholderPanel
          id="financials"
          title="Financials"
          icon={<ReceiptText size={17} />}
          description="Bills, payout preferences, and statement history will appear here when vendor finance records are connected."
        />

        <div id="tasks">
          <SectionPanel title="Tasks" icon={<AlertTriangle size={17} />}>
            <EmptyState
              title="No open tasks"
              description="Assigned work orders and follow-ups for this vendor will appear here."
            />
          </SectionPanel>
        </div>

        <div id="notes">
          <SectionPanel title="Notes" icon={<FileText size={17} />}>
            <div className="p-4 text-sm leading-6 text-muted-foreground">
              {contractor.notes?.trim() ||
                "No relationship notes have been added yet."}
            </div>
          </SectionPanel>
        </div>

        <PlaceholderPanel
          id="files"
          title="Files"
          icon={<FileText size={17} />}
          description="Insurance certificates, licences, and onboarding documents will appear here."
        />

        <PlaceholderPanel
          id="activity"
          title="Activity"
          icon={<ReceiptText size={17} />}
          description="Recent vendor changes, dispatches, and correspondence receipts will appear here."
        />
      </div>
    </PeopleRecordLayout>
  );
}
