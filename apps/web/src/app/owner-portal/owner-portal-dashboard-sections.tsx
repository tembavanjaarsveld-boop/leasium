"use client";

import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarDays,
  Download,
  FileText,
  ShieldCheck,
  Wrench,
} from "lucide-react";

import {
  EmptyState,
  SecondaryButton,
  SectionPanel,
  StatusBadge,
  type StatusTone,
} from "@/components/ui";
import {
  downloadOwnerPortalAccountDocument,
  type OwnerPortalComplianceItemRecord,
  type OwnerPortalComplianceRecord,
  type OwnerPortalDocumentRecord,
  type OwnerPortalLeaseEventRecord,
  type OwnerPortalLeaseEventsRecord,
  type OwnerPortalMaintenanceItemRecord,
  type OwnerPortalMaintenanceRecord,
} from "@/lib/api";
import { saveBlob } from "@/lib/download";
import { friendlyError } from "@/lib/utils";

const categoryLabels: Record<OwnerPortalDocumentRecord["category"], string> = {
  lease: "Lease",
  insurance: "Insurance",
  bank_guarantee: "Bank guarantee",
  onboarding: "Onboarding",
  invoice: "Invoice",
  other: "Document",
};

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000) {
    return `${bytes} B`;
  }
  if (bytes < 1_000_000) {
    return `${(bytes / 1_000).toFixed(1)} KB`;
  }
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatLeaseRent(cents: number | null): string {
  if (cents === null) {
    return "Rent not shown";
  }
  return `${formatMoney(cents)} annual rent`;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "No date";
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnly
    ? new Date(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3]),
      )
    : new Date(value);
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
  }).format(date);
}

const leaseEventLabels: Record<
  OwnerPortalLeaseEventRecord["event_kind"],
  string
> = {
  lease_expiry: "Lease expiry",
  rent_review: "Rent review",
};

const leaseStatusLabels: Record<
  OwnerPortalLeaseEventRecord["lease_status"],
  string
> = {
  active: "Active",
  expired: "Expired",
  holding_over: "Holding over",
  pending: "Pending",
  terminated: "Terminated",
};

const maintenanceStatusLabels: Record<
  OwnerPortalMaintenanceItemRecord["status"],
  string
> = {
  requested: "Requested",
  triaged: "Triaged",
  assigned: "Assigned",
  awaiting_approval: "Awaiting approval",
  approved: "Approved",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const maintenancePriorityLabels: Record<
  OwnerPortalMaintenanceItemRecord["priority"],
  string
> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

function maintenancePriorityTone(
  priority: OwnerPortalMaintenanceItemRecord["priority"],
): "neutral" | "primary" | "warning" | "danger" {
  if (priority === "urgent") return "danger";
  if (priority === "high") return "warning";
  if (priority === "normal") return "primary";
  return "neutral";
}

function titleCaseValue(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function complianceKindLabel(kind: string): string {
  return titleCaseValue(kind);
}

function complianceDueLabel(dueStatus: string): string {
  if (dueStatus === "due_soon") return "Due soon";
  return titleCaseValue(dueStatus);
}

function complianceEvidenceLabel(evidenceStatus: string): string {
  if (evidenceStatus === "missing") return "Missing evidence";
  if (evidenceStatus === "linked") return "Evidence linked";
  if (evidenceStatus === "uploaded") return "Evidence uploaded";
  return titleCaseValue(evidenceStatus);
}

function complianceDueTone(dueStatus: string): StatusTone {
  if (dueStatus === "overdue") return "danger";
  if (dueStatus === "due_soon") return "warning";
  return "neutral";
}

function complianceEvidenceTone(evidenceStatus: string): StatusTone {
  if (evidenceStatus === "missing") return "danger";
  if (evidenceStatus === "linked" || evidenceStatus === "uploaded") {
    return "success";
  }
  return "neutral";
}

function complianceStatusTone(status: string): StatusTone {
  if (["completed", "compliant"].includes(status)) {
    return "success";
  }
  if (status === "archived") {
    return "danger";
  }
  if (status === "paused") {
    return "warning";
  }
  if (status === "active") {
    return "primary";
  }
  return "neutral";
}

export function OwnerPortalLeaseEventsPanel({
  leaseEvents,
}: {
  leaseEvents: OwnerPortalLeaseEventsRecord;
}) {
  return (
    <SectionPanel
      title="Lease events"
      description={`${leaseEvents.upcoming_count} upcoming / ${leaseEvents.rent_review_count} rent reviews / ${leaseEvents.expiry_count} expiries`}
      icon={<CalendarDays size={17} />}
    >
      {leaseEvents.events.length ? (
        <div className="divide-y divide-border">
          {leaseEvents.events.map((event) => (
            <div
              key={`${event.lease_id}-${event.event_kind}-${event.event_date}`}
              className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <p className="min-w-0 truncate text-sm font-semibold text-foreground">
                    {leaseEventLabels[event.event_kind]}
                  </p>
                  <StatusBadge tone="primary">
                    {leaseStatusLabels[event.lease_status]}
                  </StatusBadge>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {event.property_name} - {event.unit_label}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs leading-5 text-muted-foreground">
                  <CalendarDays size={13} />
                  {formatDate(event.event_date)}
                </p>
              </div>
              <div className="text-sm font-semibold text-foreground md:text-right">
                {formatLeaseRent(event.annual_rent_cents)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No upcoming lease events."
          description="Rent reviews and lease expiries for linked properties will appear here."
          icon={<CalendarDays size={18} />}
        />
      )}
    </SectionPanel>
  );
}

export function OwnerPortalCompliancePanel({
  compliance,
}: {
  compliance: OwnerPortalComplianceRecord;
}) {
  return (
    <SectionPanel
      title="Compliance snapshot"
      description={`${compliance.open_count} open / ${compliance.overdue_count} overdue / ${compliance.due_soon_count} due soon / ${compliance.missing_evidence_count} missing evidence`}
      icon={<ShieldCheck size={17} />}
    >
      {compliance.items.length ? (
        <div className="divide-y divide-border">
          {compliance.items.map((item: OwnerPortalComplianceItemRecord) => (
            <div
              key={item.id}
              className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <p className="min-w-0 truncate text-sm font-semibold text-foreground">
                    {item.title}
                  </p>
                  <StatusBadge tone={complianceDueTone(item.due_status)}>
                    {complianceDueLabel(item.due_status)}
                  </StatusBadge>
                  <StatusBadge
                    tone={complianceEvidenceTone(item.evidence_status)}
                  >
                    {complianceEvidenceLabel(item.evidence_status)}
                  </StatusBadge>
                  <StatusBadge tone={complianceStatusTone(item.status)}>
                    {titleCaseValue(item.status)}
                  </StatusBadge>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {item.property_name} - {complianceKindLabel(item.kind)}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs leading-5 text-muted-foreground">
                  <CalendarDays size={13} />
                  Next due {formatDate(item.next_due_date)}
                  {item.certificate_expires_on ? (
                    <span>
                      Certificate expires{" "}
                      {formatDate(item.certificate_expires_on)}
                    </span>
                  ) : null}
                  {item.last_checked_at ? (
                    <span>Checked {formatDateTime(item.last_checked_at)}</span>
                  ) : null}
                </p>
              </div>
              {item.certificate_expires_on ? (
                <div className="text-sm font-semibold text-foreground md:text-right">
                  Expires {formatDate(item.certificate_expires_on)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No compliance items."
          description="Owner-visible compliance dates and evidence status for linked properties will appear here."
          icon={<ShieldCheck size={18} />}
        />
      )}
    </SectionPanel>
  );
}

export function OwnerPortalMaintenancePanel({
  maintenance,
}: {
  maintenance: OwnerPortalMaintenanceRecord;
}) {
  return (
    <SectionPanel
      title="Maintenance snapshot"
      description={`${maintenance.open_count} open / ${maintenance.urgent_count} urgent / ${maintenance.awaiting_approval_count} awaiting approval`}
      icon={<Wrench size={17} />}
    >
      {maintenance.items.length ? (
        <div className="divide-y divide-border">
          {maintenance.items.map((item) => (
            <div
              key={item.id}
              className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <p className="min-w-0 truncate text-sm font-semibold text-foreground">
                    {item.title}
                  </p>
                  <StatusBadge tone={maintenancePriorityTone(item.priority)}>
                    {maintenancePriorityLabels[item.priority]}
                  </StatusBadge>
                  <StatusBadge tone="neutral">
                    {maintenanceStatusLabels[item.status]}
                  </StatusBadge>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {item.property_name}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs leading-5 text-muted-foreground">
                  <CalendarDays size={13} />
                  Due {formatDate(item.due_date)}
                  {item.approval_required ? (
                    <span className="inline-flex items-center gap-1">
                      <AlertTriangle size={13} />
                      {item.approval_status === "pending"
                        ? "Approval pending"
                        : "Approval tracked"}
                    </span>
                  ) : null}
                </p>
              </div>
              {item.quote_amount_cents !== null ? (
                <div className="text-sm font-semibold text-foreground md:text-right">
                  {formatMoney(item.quote_amount_cents)} quote
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No open maintenance."
          description="Open owner-visible maintenance items for linked properties will appear here."
          icon={<Wrench size={18} />}
        />
      )}
    </SectionPanel>
  );
}

export function OwnerPortalDocumentsPanel({
  documents,
  accountMode,
  getAuthToken,
  requiresAuthToken = false,
}: {
  documents: OwnerPortalDocumentRecord[];
  accountMode: boolean;
  getAuthToken?: () => Promise<string | null>;
  requiresAuthToken?: boolean;
}) {
  const downloadMutation = useMutation({
    mutationFn: async (document: OwnerPortalDocumentRecord) => {
      const authToken = getAuthToken ? await getAuthToken() : null;
      if (requiresAuthToken && !authToken) {
        throw new Error("Sign in before downloading owner documents.");
      }
      const blob = await downloadOwnerPortalAccountDocument(
        document.id,
        authToken,
      );
      saveBlob(blob, document.filename);
    },
  });

  return (
    <SectionPanel
      title="Shared documents"
      description="Files explicitly shared by the property team for this owner account."
      icon={<FileText size={17} />}
    >
      {documents.length ? (
        <div className="divide-y divide-border">
          {documents.map((document) => (
            <div
              key={document.id}
              className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="min-w-0 [overflow-wrap:anywhere]">
                <div className="flex min-w-0 items-center gap-2">
                  <FileText className="shrink-0 text-primary" size={16} />
                  <p className="truncate text-sm font-semibold text-foreground">
                    {document.filename}
                  </p>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {document.property_name} - {categoryLabels[document.category]}{" "}
                  - {formatBytes(document.byte_size)} - {document.source_label}
                </p>
                <p className="text-xs leading-5 text-muted-foreground">
                  Shared {formatDateTime(document.created_at)}
                </p>
                {document.notes ? (
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {document.notes}
                  </p>
                ) : null}
              </div>
              {accountMode ? (
                <SecondaryButton
                  aria-label={`Download ${document.filename} for ${document.property_name}`}
                  className="w-fit justify-self-start md:justify-self-end"
                  disabled={downloadMutation.isPending}
                  type="button"
                  onClick={() => downloadMutation.mutate(document)}
                >
                  <Download size={16} />
                  Download {document.filename}
                </SecondaryButton>
              ) : (
                <StatusBadge tone="neutral">Account download only</StatusBadge>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No shared documents."
          description="The property team has not shared owner documents in this portal yet."
          icon={<FileText size={18} />}
        />
      )}
      {downloadMutation.error ? (
        <div className="border-t border-border px-4 py-3 text-sm text-danger">
          {friendlyError(downloadMutation.error)}
        </div>
      ) : null}
    </SectionPanel>
  );
}
