"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  ClipboardList,
  FileText,
  Mail,
  ReceiptText,
  WalletCards,
} from "lucide-react";
import { useParams } from "next/navigation";

import { AppHeader } from "@/components/app-shell";
import { PeopleRecordLayout } from "@/components/people-record-layout";
import { QueryProvider } from "@/components/query-provider";
import {
  EmptyState,
  SecondaryButton,
  SectionPanel,
  SkeletonRows,
  StatusBadge,
} from "@/components/ui";
import { getOwner, type OwnerPropertyLink, type OwnerRecord } from "@/lib/api";
import { friendlyError } from "@/lib/utils";

function ownerName(owner: OwnerRecord) {
  return (
    owner.legal_name ||
    owner.trust_name ||
    owner.trustee_name ||
    owner.invoice_issuer_name ||
    "Unnamed owner"
  );
}

function valueOrDash(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return value;
}

function yesNo(value: boolean | null | undefined) {
  if (value === null || value === undefined) {
    return "Not set";
  }
  return value ? "Yes" : "No";
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function propertySplitLabel(link: OwnerPropertyLink) {
  return `${link.split_pct}%`;
}

function DetailGrid({
  items,
}: {
  items: Array<{ label: string; value: string | number | null | undefined }>;
}) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="grid gap-1">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {item.label}
          </dt>
          <dd className="break-words text-sm text-foreground">
            {valueOrDash(item.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function OwnerPageContent() {
  const params = useParams<{ ownerId?: string | string[] }>();
  const ownerId = Array.isArray(params.ownerId)
    ? params.ownerId[0]
    : params.ownerId;

  const ownerQuery = useQuery({
    queryKey: ["owner", ownerId],
    queryFn: () => getOwner(ownerId ?? ""),
    enabled: Boolean(ownerId),
  });

  return (
    <main className="min-h-screen">
      <AppHeader />

      <div className="mx-auto grid max-w-6xl gap-5 px-5 py-6">
        {ownerQuery.isLoading ? (
          <PeopleRecordLayout
            backHref="/people?tab=owners"
            backLabel="Owners"
            title="Loading owner"
            description="Fetching the owner record and property links."
          >
            <SectionPanel>
              <SkeletonRows rows={5} />
            </SectionPanel>
          </PeopleRecordLayout>
        ) : null}

        {ownerQuery.error ? (
          <PeopleRecordLayout
            backHref="/people?tab=owners"
            backLabel="Owners"
            title="Owner unavailable"
            description="The owner record could not be loaded."
          >
            <p className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
              <AlertTriangle size={16} />
              {friendlyError(ownerQuery.error)}
            </p>
          </PeopleRecordLayout>
        ) : null}

        {ownerQuery.data ? <OwnerRecordView owner={ownerQuery.data} /> : null}
      </div>
    </main>
  );
}

function OwnerRecordView({ owner }: { owner: OwnerRecord }) {
  const properties = owner.properties ?? [];
  const hasBillingEmail = Boolean(owner.billing_email);

  return (
    <PeopleRecordLayout
      backHref="/people?tab=owners"
      backLabel="Owners"
      title={ownerName(owner)}
      description={
        owner.trust_name && owner.trustee_name
          ? `${owner.trustee_name} as trustee for ${owner.trust_name}`
          : "Owner billing identity, property split, and finance readiness."
      }
      actions={
        hasBillingEmail ? (
          <SecondaryButton
            type="button"
            onClick={() => {
              window.location.href = `mailto:${owner.billing_email}`;
            }}
          >
            <Mail size={15} />
            Email owner
          </SecondaryButton>
        ) : null
      }
      summary={
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={owner.property_count > 0 ? "success" : "neutral"}>
            {owner.property_count}{" "}
            {owner.property_count === 1 ? "property" : "properties"}
          </StatusBadge>
          {owner.abn ? (
            <StatusBadge tone="neutral">ABN {owner.abn}</StatusBadge>
          ) : null}
          <StatusBadge tone={owner.gst_registered ? "success" : "neutral"}>
            {owner.gst_registered ? "GST registered" : "GST not set"}
          </StatusBadge>
          <StatusBadge tone={owner.xero_contact_id ? "success" : "neutral"}>
            {owner.xero_contact_id ? "Xero contact linked" : "Xero not linked"}
          </StatusBadge>
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <div className="grid gap-4">
          <div id="overview">
            <SectionPanel title="Overview" icon={<Building2 size={17} />}>
              <div className="grid gap-4 p-4">
                <DetailGrid
                  items={[
                    { label: "Legal name", value: owner.legal_name },
                    { label: "Trust name", value: owner.trust_name },
                    { label: "Trustee", value: owner.trustee_name },
                    { label: "ABN", value: owner.abn },
                    {
                      label: "Invoice issuer",
                      value: owner.invoice_issuer_name,
                    },
                    {
                      label: "Created",
                      value: formatDateTime(owner.created_at),
                    },
                  ]}
                />
              </div>
            </SectionPanel>
          </div>

          <SectionPanel
            title="Property Split"
            description="Linked properties and their owner split percentages."
            icon={<WalletCards size={17} />}
          >
            {properties.length > 0 ? (
              <div className="divide-y divide-border">
                {properties.map((link) => (
                  <div
                    key={link.property_id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-foreground">
                        {link.property_name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Property ID {link.property_id}
                      </div>
                    </div>
                    <StatusBadge tone="primary">
                      {propertySplitLabel(link)}
                    </StatusBadge>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No linked properties."
                description="This owner has not been attached to any properties yet."
                icon={<Building2 size={18} />}
              />
            )}
          </SectionPanel>

          <div id="financials">
            <SectionPanel title="Financials" icon={<ReceiptText size={17} />}>
              <div className="grid gap-4 p-4">
                <DetailGrid
                  items={[
                    {
                      label: "Billing contact",
                      value: owner.billing_contact_name,
                    },
                    { label: "Billing email", value: owner.billing_email },
                    {
                      label: "Invoice reference",
                      value: owner.invoice_reference,
                    },
                    {
                      label: "GST registered",
                      value: yesNo(owner.gst_registered),
                    },
                    { label: "Xero contact ID", value: owner.xero_contact_id },
                    {
                      label: "Last updated",
                      value: formatDateTime(owner.updated_at),
                    },
                  ]}
                />
              </div>
            </SectionPanel>
          </div>
        </div>

        <aside className="grid content-start gap-4">
          <div id="tasks">
            <SectionPanel
              title="Tasks"
              description="Owner follow-ups will appear here when assigned."
              icon={<ClipboardList size={17} />}
            >
              <EmptyState
                title="No open tasks."
                description="There are no owner-specific tasks on this record."
              />
            </SectionPanel>
          </div>

          <div id="notes">
            <SectionPanel title="Notes">
              <EmptyState
                title="No notes yet."
                description="Notes are quiet until an operator adds record context."
              />
            </SectionPanel>
          </div>

          <div id="files">
            <SectionPanel title="Files" icon={<FileText size={17} />}>
              <EmptyState
                title="No files attached."
                description="Owner statements, trust documents, and evidence files can be surfaced here later."
              />
            </SectionPanel>
          </div>

          <div id="activity">
            <SectionPanel title="Activity">
              <EmptyState
                title="No recent activity."
                description="Record activity will appear once owner events are captured."
              />
            </SectionPanel>
          </div>
        </aside>
      </div>
    </PeopleRecordLayout>
  );
}

export default function OwnerPage() {
  return (
    <QueryProvider>
      <OwnerPageContent />
    </QueryProvider>
  );
}
