"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { DetailDrawer } from "@/components/detail-drawer";
import { Button, Field, SecondaryButton, Select, StatusBadge } from "@/components/ui";
import {
  applyPropertyReassign,
  type Entity,
  previewPropertyReassign,
  type PropertyReassignResult,
} from "@/lib/api";

const HISTORY_LABELS: Record<string, string> = {
  billing_drafts: "billing drafts",
  invoice_drafts: "invoice drafts",
  maintenance_work_orders: "work orders",
  arrears_cases: "arrears cases",
  xero_contact: "Xero contact",
};

function historyLabel(kind: string): string {
  return HISTORY_LABELS[kind] ?? kind.replace(/_/g, " ");
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Review-first drawer for moving one or more properties to a different
 * entity (trust). The operator picks the target, sees exactly what the move
 * carries — obligations, tenants wholly within the move, and what stays put
 * (spanning tenants, existing accounting history) — then confirms. Mirrors the
 * backend preview/apply contract; the apply is a local re-filing with no
 * provider call.
 */
export function PropertyEntityReassignDrawer({
  open,
  onClose,
  propertyIds,
  entities,
  presetTargetEntityId,
  currentEntityName,
  contextLabel,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  propertyIds: string[];
  entities: Entity[];
  presetTargetEntityId?: string;
  currentEntityName?: string | null;
  contextLabel?: string;
  onApplied?: (result: PropertyReassignResult) => void;
}) {
  const queryClient = useQueryClient();
  const [targetEntityId, setTargetEntityId] = useState(presetTargetEntityId ?? "");
  const [applied, setApplied] = useState<PropertyReassignResult | null>(null);

  // Reset only on the open→true edge. Resetting on every prop change would
  // wipe the success summary when a caller clears its selection on apply
  // (e.g. the property editor closes, changing propertyIds mid-flow).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setTargetEntityId(presetTargetEntityId ?? "");
      setApplied(null);
    }
    wasOpen.current = open;
  }, [open, presetTargetEntityId]);

  const previewQuery = useQuery({
    queryKey: ["reassign-preview", propertyIds, targetEntityId],
    queryFn: () =>
      previewPropertyReassign({
        property_ids: propertyIds,
        target_entity_id: targetEntityId,
      }),
    enabled: open && propertyIds.length > 0 && Boolean(targetEntityId) && !applied,
  });

  const applyMutation = useMutation({
    mutationFn: () =>
      applyPropertyReassign({
        property_ids: propertyIds,
        target_entity_id: targetEntityId,
      }),
    onSuccess: (result) => {
      setApplied(result);
      for (const key of [
        ["properties"],
        ["entities"],
        ["entities-xero-overview"],
        ["ownership-split-plan"],
        ["entity-reassign-suggestions"],
      ]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      onApplied?.(result);
    },
  });

  const preview = previewQuery.data;
  const canConfirm =
    Boolean(targetEntityId) &&
    Boolean(preview) &&
    preview!.moved_property_count > 0 &&
    !applyMutation.isPending;

  const targetEntity = entities.find((entity) => entity.id === targetEntityId);
  const heading = contextLabel ?? plural(propertyIds.length, "property");

  return (
    <DetailDrawer
      open={open}
      onClose={onClose}
      title="Move to entity"
      description={`Re-file ${heading} under a different trust. Review what moves before confirming.`}
      testId="property-entity-reassign-drawer"
    >
      {applied ? (
        <div className="grid gap-3" data-testid="reassign-applied-summary">
          <p className="text-sm text-foreground">
            Moved {plural(applied.moved_property_count, "property")}
            {targetEntity ? ` to ${targetEntity.name}` : ""}.
          </p>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone="success">
              {plural(applied.moved_obligation_count, "obligation")} moved
            </StatusBadge>
            {applied.moved_tenant_count > 0 ? (
              <StatusBadge tone="success">
                {plural(applied.moved_tenant_count, "tenant")} moved
              </StatusBadge>
            ) : null}
            {applied.flagged_tenant_count > 0 ? (
              <StatusBadge tone="warning">
                {plural(applied.flagged_tenant_count, "tenant")} left in place
              </StatusBadge>
            ) : null}
          </div>
          {applied.notes.length > 0 ? (
            <ul className="grid gap-1 text-xs text-muted-foreground">
              {applied.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
          <div className="pt-1">
            <Button type="button" onClick={onClose} data-testid="reassign-done">
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {currentEntityName ? (
            <p className="text-xs text-muted-foreground">
              Currently filed under{" "}
              <span className="font-medium text-foreground">
                {currentEntityName}
              </span>
              .
            </p>
          ) : null}

          <Field label="Move to entity">
            <Select
              value={targetEntityId}
              onChange={(event) => setTargetEntityId(event.target.value)}
              data-testid="reassign-target-select"
            >
              <option value="">Select a trust…</option>
              {[...entities]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.name}
                  </option>
                ))}
            </Select>
          </Field>

          {!targetEntityId ? (
            <p className="text-sm text-muted-foreground">
              Pick the trust this property should belong to.
            </p>
          ) : previewQuery.isPending ? (
            <p className="text-sm text-muted-foreground">Checking what moves…</p>
          ) : previewQuery.isError ? (
            <p className="text-sm text-danger">
              Could not load the move preview. Try again.
            </p>
          ) : preview ? (
            <div className="grid gap-3" data-testid="reassign-preview-summary">
              {preview.moved_property_count > 0 ? (
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <ArrowRight size={15} className="text-primary" />
                  Moving {plural(preview.moved_property_count, "property")}
                  {targetEntity ? ` to ${targetEntity.name}` : ""}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nothing to move — see below.
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <StatusBadge tone="neutral">
                  {plural(preview.moved_obligation_count, "obligation")}
                </StatusBadge>
                <StatusBadge tone="neutral">
                  {plural(preview.moved_tenant_count, "tenant")} moving
                </StatusBadge>
                {preview.flagged_tenant_count > 0 ? (
                  <StatusBadge tone="warning">
                    {plural(preview.flagged_tenant_count, "tenant")} stays
                  </StatusBadge>
                ) : null}
                {preview.skipped_property_count > 0 ? (
                  <StatusBadge tone="neutral">
                    {plural(preview.skipped_property_count, "property")} skipped
                  </StatusBadge>
                ) : null}
              </div>

              {preview.warnings.map((warning) => (
                <div
                  key={warning}
                  className="flex gap-2 rounded-md border border-warning-strong/30 bg-warning-soft px-3 py-2 text-xs text-warning-strong"
                >
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>{warning}</span>
                </div>
              ))}

              {preview.properties.some(
                (plan) => plan.history_flags.length > 0,
              ) ? (
                <ul className="grid gap-1 text-xs text-muted-foreground">
                  {preview.properties
                    .filter((plan) => plan.history_flags.length > 0)
                    .map((plan) => (
                      <li key={plan.property_id}>
                        <span className="font-medium text-foreground">
                          {plan.property_name}
                        </span>{" "}
                        keeps{" "}
                        {plan.history_flags
                          .map((flag) =>
                            flag.kind === "xero_contact"
                              ? historyLabel(flag.kind)
                              : plural(flag.count, historyLabel(flag.kind).replace(/s$/, "")),
                          )
                          .join(", ")}{" "}
                        under the current entity.
                      </li>
                    ))}
                </ul>
              ) : null}

              {preview.tenants
                .filter((tenant) => tenant.disposition === "flag")
                .map((tenant) => (
                  <p
                    key={tenant.tenant_id}
                    className="text-xs text-muted-foreground"
                  >
                    <span className="font-medium text-foreground">
                      {tenant.tenant_name}
                    </span>{" "}
                    stays put{tenant.reason ? ` — ${tenant.reason}` : ""}
                  </p>
                ))}

              {preview.skipped.map((skipped) => (
                <p
                  key={skipped.property_id}
                  className="text-xs text-muted-foreground"
                >
                  Skipped: {skipped.reason}
                </p>
              ))}
            </div>
          ) : null}

          {applyMutation.isError ? (
            <p className="text-sm text-danger">
              The move did not apply. Try again.
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-1">
            <SecondaryButton type="button" onClick={onClose}>
              Cancel
            </SecondaryButton>
            <Button
              type="button"
              disabled={!canConfirm}
              onClick={() => applyMutation.mutate()}
              data-testid="reassign-confirm"
            >
              {applyMutation.isPending
                ? "Moving…"
                : preview && preview.moved_property_count > 0
                  ? `Move ${plural(preview.moved_property_count, "property")}`
                  : "Move"}
            </Button>
          </div>
        </div>
      )}
    </DetailDrawer>
  );
}
