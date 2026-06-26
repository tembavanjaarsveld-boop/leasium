"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  Copy,
  Download,
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
  SkeletonRows,
  StatusBadge,
  type StatusTone,
} from "@/components/ui";
import { EntityPicker } from "@/components/entity-picker";
import {
  ApiError,
  type CommsContractorCorrespondenceRecord,
  type CommsCorrespondenceEventRecord,
  type ContractorRecord,
  getContractorCommsCorrespondence,
  getContractor,
  listEntities,
} from "@/lib/api";
import { csvRows } from "@/lib/csv";
import { saveBlob } from "@/lib/download";
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

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function label(value: string | null | undefined) {
  if (!value) return "";
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function correspondenceEventLabel(event: CommsCorrespondenceEventRecord) {
  if (event.event_type === "dispatch") return "Dispatch";
  if (event.event_type === "dismiss") return "Dismiss";
  return label(event.event_type) || "Correspondence";
}

function correspondenceEventTone(
  event: CommsCorrespondenceEventRecord,
): StatusTone {
  if (event.event_type === "dispatch") return "success";
  if (event.event_type === "dismiss") return "warning";
  return "neutral";
}

function correspondenceStatusTone(status: string | null | undefined): StatusTone {
  if (!status) return "neutral";
  if (["success", "queued", "sent", "delivered"].includes(status)) {
    return "success";
  }
  if (["error", "failed", "skipped", "bounced"].includes(status)) {
    return "danger";
  }
  return "neutral";
}

function correspondenceCounterparty(event: CommsCorrespondenceEventRecord) {
  if (event.direction === "inbound") {
    return event.from_address ?? event.provider ?? "Inbound";
  }
  return event.recipient ?? event.provider ?? "Reviewed comms";
}

function correspondenceTargetLink(event: CommsCorrespondenceEventRecord) {
  if (!event.target_kind || !event.target_id) return null;
  if (event.target_kind === "maintenance_work_order") {
    return {
      href: `/operations/maintenance/${encodeURIComponent(event.target_id)}`,
      label: "Open work order",
    };
  }
  if (event.target_kind === "contractor") {
    return {
      href: `/contractors/${encodeURIComponent(event.target_id)}`,
      label: "Open vendor",
    };
  }
  return { href: "/comms", label: "Open Comms queue" };
}

function slugifyFilename(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const VENDOR_CORRESPONDENCE_EXPORT_GUARDRAIL =
  "Review-only export: copying or downloading this file does not send email, send SMS, change queue state, refresh providers, mutate vendor records, mutate maintenance records, or write provider history.";

function vendorCorrespondenceCsv(data: CommsContractorCorrespondenceRecord) {
  return csvRows([
    [
      "Section",
      "Vendor",
      "Generated at",
      "Occurred at",
      "Event",
      "Direction",
      "Channel",
      "Counterparty",
      "Summary",
      "Status",
      "Provider",
      "Target",
      "Guardrail",
    ],
    ...data.events.map((event) => [
      "Vendor correspondence",
      data.contractor_name,
      data.generated_at,
      event.occurred_at,
      correspondenceEventLabel(event),
      event.direction,
      event.channel,
      correspondenceCounterparty(event),
      event.summary,
      event.status,
      event.provider,
      [event.metadata.kind, event.target_kind, event.target_id]
        .filter(Boolean)
        .join(":"),
      VENDOR_CORRESPONDENCE_EXPORT_GUARDRAIL,
    ]),
    ...data.guardrails.map((guardrail) => [
      "Endpoint guardrail",
      data.contractor_name,
      data.generated_at,
      "",
      "",
      "",
      "",
      "",
      guardrail,
      "",
      "",
      "",
      VENDOR_CORRESPONDENCE_EXPORT_GUARDRAIL,
    ]),
    [
      "Export guardrail",
      data.contractor_name,
      data.generated_at,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      VENDOR_CORRESPONDENCE_EXPORT_GUARDRAIL,
    ],
  ]);
}

function vendorCorrespondenceCsvExport(
  data: CommsContractorCorrespondenceRecord,
  fallbackContractorId: string,
) {
  const filenameName =
    slugifyFilename(data.contractor_name) || fallbackContractorId;
  return {
    csv: vendorCorrespondenceCsv(data),
    filename: `vendor-correspondence-${filenameName}.csv`,
  };
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
      <AppHeader />

      <div className="mx-auto grid max-w-6xl gap-5 px-5 py-6">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            Entity
          </span>
          <div className="w-full max-w-xs">
            <EntityPicker
              entities={entitiesQuery.data}
              loading={entitiesQuery.isLoading}
              value={selectedEntityId}
              onChange={setSelectedEntityId}
              allowAllEntities={false}
              tone="inline"
            />
          </div>
        </div>
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
  const [correspondenceCopyReceipt, setCorrespondenceCopyReceipt] = useState<
    string | null
  >(null);
  const correspondenceQuery = useQuery({
    queryKey: ["contractor-correspondence", contractor.id],
    queryFn: () => getContractorCommsCorrespondence(contractor.id),
  });

  function correspondenceCsvExport() {
    const correspondence = correspondenceQuery.data;
    if (!correspondence) {
      return null;
    }
    return vendorCorrespondenceCsvExport(correspondence, contractor.id);
  }

  async function copyCorrespondenceCsv() {
    const exportFile = correspondenceCsvExport();
    if (
      !exportFile ||
      typeof navigator === "undefined" ||
      !navigator.clipboard
    ) {
      setCorrespondenceCopyReceipt("Copy unavailable in this browser.");
      return;
    }
    await navigator.clipboard
      .writeText(exportFile.csv)
      .then(() => {
        setCorrespondenceCopyReceipt("Correspondence CSV copied.");
      })
      .catch(() => {
        setCorrespondenceCopyReceipt("Copy unavailable in this browser.");
      });
  }

  function downloadCorrespondenceCsv() {
    const exportFile = correspondenceCsvExport();
    if (!exportFile) return;
    saveBlob(
      new Blob([exportFile.csv], {
        type: "text/csv;charset=utf-8",
      }),
      exportFile.filename,
    );
  }

  return (
    <PeopleRecordLayout
      backHref="/people?tab=vendors"
      backLabel="Vendors"
      title={displayName(contractor)}
      description="Vendor profile, contact readiness, service coverage, and relationship notes."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Link
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted active:scale-[0.98] active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:active:scale-100"
            href={`/vendor-portal/${contractor.id}`}
          >
            Open portal preview
          </Link>
          <StatusBadge tone={contact.tone}>{contact.label}</StatusBadge>
        </div>
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

        <div id="activity">
          <VendorCorrespondencePanel
            events={correspondenceQuery.data?.events ?? []}
            guardrails={correspondenceQuery.data?.guardrails ?? []}
            isLoading={correspondenceQuery.isLoading}
            error={correspondenceQuery.error}
            onCopy={() => void copyCorrespondenceCsv()}
            onDownload={downloadCorrespondenceCsv}
            copyReceipt={correspondenceCopyReceipt}
            actionsDisabled={
              !correspondenceQuery.data ||
              correspondenceQuery.data.events.length === 0
            }
          />
        </div>
      </div>
    </PeopleRecordLayout>
  );
}

function VendorCorrespondencePanel({
  events,
  guardrails,
  isLoading,
  error,
  onCopy,
  onDownload,
  copyReceipt,
  actionsDisabled,
}: {
  events: CommsCorrespondenceEventRecord[];
  guardrails: string[];
  isLoading: boolean;
  error: unknown;
  onCopy: () => void;
  onDownload: () => void;
  copyReceipt: string | null;
  actionsDisabled: boolean;
}) {
  const countLabel = `${events.length} correspondence ${
    events.length === 1 ? "event" : "events"
  }`;

  return (
    <SectionPanel
      title="Activity"
      icon={<ReceiptText size={17} />}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="neutral">{countLabel}</StatusBadge>
          <SecondaryButton
            type="button"
            onClick={onCopy}
            disabled={actionsDisabled}
          >
            <Copy size={15} />
            Copy correspondence CSV
          </SecondaryButton>
          <SecondaryButton
            type="button"
            onClick={onDownload}
            disabled={actionsDisabled}
          >
            <Download size={15} />
            Download correspondence CSV
          </SecondaryButton>
        </div>
      }
    >
      <div className="grid gap-3 p-4 text-sm">
        {copyReceipt ? (
          <p className="text-sm font-medium text-success">{copyReceipt}</p>
        ) : null}
        {isLoading ? <SkeletonRows rows={3} /> : null}
        {error ? (
          <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-danger">
            {friendlyError(error)}
          </p>
        ) : null}
        {!isLoading && !error && events.length === 0 ? (
          <EmptyState
            icon={<ReceiptText size={18} />}
            title="No correspondence receipts"
            description="Contractor-facing comms receipts linked to this vendor will appear here."
          />
        ) : null}
        {!isLoading && !error && events.length > 0 ? (
          <div className="grid gap-2">
            {events.slice(0, 5).map((event) => {
              const targetLink = correspondenceTargetLink(event);
              return (
                <div
                  key={event.id}
                  className="grid gap-2 rounded-md border border-border bg-white px-3 py-3"
                  data-testid="vendor-correspondence-event"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-foreground">
                        {event.summary ?? correspondenceEventLabel(event)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {correspondenceCounterparty(event)}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={correspondenceEventTone(event)}>
                        {correspondenceEventLabel(event)}
                      </StatusBadge>
                      {event.channel ? (
                        <StatusBadge tone="neutral">
                          {label(event.channel)}
                        </StatusBadge>
                      ) : null}
                      {event.status ? (
                        <StatusBadge tone={correspondenceStatusTone(event.status)}>
                          {label(event.status)}
                        </StatusBadge>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {event.provider ? (
                      <span>Provider {event.provider}</span>
                    ) : null}
                    <span>{formatDateTime(event.occurred_at)}</span>
                    {event.target_kind && event.target_id ? (
                      <span>
                        {event.target_kind}:{event.target_id}
                      </span>
                    ) : null}
                  </div>
                  {targetLink ? (
                    <div>
                      <Link
                        href={targetLink.href}
                        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs hover:bg-muted"
                      >
                        <ArrowUpRight size={14} />
                        {targetLink.label}
                      </Link>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
        {events.length > 5 ? (
          <p className="text-xs text-muted-foreground">
            Showing the five most recent correspondence receipts.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Link
            href="/comms"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs hover:bg-muted"
          >
            <ArrowUpRight size={14} />
            Open Comms queue
          </Link>
        </div>
        {guardrails.length ? (
          <div className="grid gap-2 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
            {guardrails.map((guardrail) => (
              <p key={guardrail}>{guardrail}</p>
            ))}
          </div>
        ) : null}
      </div>
    </SectionPanel>
  );
}
