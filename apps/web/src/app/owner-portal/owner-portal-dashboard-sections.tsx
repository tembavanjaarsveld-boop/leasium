"use client";

import { useMutation } from "@tanstack/react-query";
import { Download, FileText } from "lucide-react";

import {
  EmptyState,
  SecondaryButton,
  SectionPanel,
  StatusBadge,
} from "@/components/ui";
import {
  downloadOwnerPortalAccountDocument,
  type OwnerPortalDocumentRecord,
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
