"use client";

import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, Download, FileText, Wrench } from "lucide-react";

import {
  EmptyState,
  SecondaryButton,
  SectionPanel,
  StatusBadge,
} from "@/components/ui";
import {
  downloadOwnerPortalAccountDocument,
  type OwnerPortalDocumentRecord,
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

function formatDate(value: string | null): string {
  if (!value) {
    return "No date";
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
  }).format(date);
}

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
}: {
  documents: OwnerPortalDocumentRecord[];
  accountMode: boolean;
}) {
  const downloadMutation = useMutation({
    mutationFn: async (document: OwnerPortalDocumentRecord) => {
      const blob = await downloadOwnerPortalAccountDocument(document.id);
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
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <FileText className="shrink-0 text-primary" size={16} />
                  <p className="truncate text-sm font-semibold text-foreground">
                    {document.filename}
                  </p>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {document.property_name} - {categoryLabels[document.category]} -{" "}
                  {formatBytes(document.byte_size)} - {document.source_label}
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
