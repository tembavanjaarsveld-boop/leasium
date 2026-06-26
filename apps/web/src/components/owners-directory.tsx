"use client";

/**
 * OwnersDirectory — the owner-entity directory (list + create) backed by
 * /api/v1/owners.
 *
 * Shared so it can render in BOTH the People hub (managing_agent framing,
 * "owner clients") and Settings → Entities (self_managed_owner fallback,
 * "your entities / trusts"). The People → Owners *hub* is agent-only, but the
 * owner *entity data* is shared infrastructure both modes rely on (see
 * docs/account-operating-mode-ia.md), so hiding the hub must not orphan owner
 * CRUD for self-managed owners.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  Loader2,
  Plus,
  Trash2,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  Button,
  EmptyState,
  Field,
  Input,
  SecondaryButton,
  SectionPanel,
  SkeletonRows,
  StatusBadge,
} from "@/components/ui";
import {
  createOwner,
  deleteOwner,
  listOwners,
  type OwnerRecord,
} from "@/lib/api";
import { friendlyError } from "@/lib/utils";

const recordLinkClass =
  "inline-flex min-h-11 scroll-mb-28 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2";

function ownerName(owner: OwnerRecord) {
  return (
    owner.legal_name ||
    owner.trust_name ||
    owner.trustee_name ||
    owner.invoice_issuer_name ||
    "Unnamed owner"
  );
}

type OwnersDirectoryProps = {
  entityId: string | null;
  owners?: OwnerRecord[];
  isLoading?: boolean;
  error?: unknown;
  onRefresh?: () => void;
};

export function OwnersDirectory({
  entityId,
  owners: providedOwners,
  isLoading: providedLoading,
  error: providedError,
  onRefresh,
}: OwnersDirectoryProps) {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const ownersQuery = useQuery({
    queryKey: ["owners", entityId],
    queryFn: () => listOwners(entityId ?? ""),
    enabled: Boolean(entityId && providedOwners === undefined),
  });
  const owners = providedOwners ?? ownersQuery.data ?? [];
  const isLoading = providedLoading ?? ownersQuery.isLoading;
  const error = providedError ?? ownersQuery.error;

  function refresh() {
    onRefresh?.();
    if (entityId) {
      queryClient.invalidateQueries({ queryKey: ["owners", entityId] });
    }
  }

  return (
    <div className="grid gap-4">
      {entityId ? (
        <div className="flex items-center justify-end">
          <Button type="button" onClick={() => setShowCreate((prev) => !prev)}>
            <Plus size={16} />
            {showCreate ? "Close form" : "Add owner"}
          </Button>
        </div>
      ) : null}

      {showCreate && entityId ? (
        <AddOwnerForm
          entityId={entityId}
          onSaved={() => {
            setShowCreate(false);
            refresh();
          }}
        />
      ) : null}

      {isLoading ? (
        <SectionPanel>
          <SkeletonRows rows={4} />
        </SectionPanel>
      ) : null}

      {error ? (
        <p className="rounded-md border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          {friendlyError(error)}
        </p>
      ) : null}

      {!isLoading && owners.length === 0 && !error ? (
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
            className="scroll-mb-28"
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
          <Button type="submit" disabled={!canSubmit || createMutation.isPending}>
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
