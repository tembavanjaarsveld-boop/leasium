"use client";

import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  FileUp,
  Loader2,
  Play,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  applyRegisterImportPlan,
  dryRunRegisterImport,
  type RegisterImportActionItem,
  type RegisterImportApplyRecord,
  type RegisterImportDryRunRecord,
  type RegisterImportFinding,
} from "@/lib/api";
import {
  Button,
  EmptyState,
  SecondaryButton,
  SectionPanel,
  StatusBadge,
} from "@/components/ui";

function friendlyError(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function actionTone(item: RegisterImportActionItem) {
  if (item.blockers.length) {
    return "danger" as const;
  }
  if (item.warnings.length || item.default_decision === "review") {
    return "warning" as const;
  }
  if (item.default_decision === "approve") {
    return "success" as const;
  }
  return "neutral" as const;
}

function findingTone(finding: RegisterImportFinding) {
  if (finding.severity === "blocker") {
    return "danger" as const;
  }
  if (finding.severity === "warning") {
    return "warning" as const;
  }
  return "neutral" as const;
}

function formatNumber(value: number | undefined) {
  return new Intl.NumberFormat("en-AU").format(value ?? 0);
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "Blank";
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

function createdSummary(result: RegisterImportApplyRecord | null) {
  if (!result) {
    return [];
  }
  return Object.entries(result.created)
    .filter(([, count]) => count > 0)
    .map(
      ([target, count]) =>
        `${formatNumber(count)} ${target.replaceAll("_", " ")}`,
    );
}

export function RegisterImportPanel({
  entityId,
  onApplied,
}: {
  entityId: string;
  onApplied?: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState<RegisterImportDryRunRecord | null>(null);
  const [selectedActionIds, setSelectedActionIds] = useState<string[]>([]);
  const [applyResult, setApplyResult] =
    useState<RegisterImportApplyRecord | null>(null);

  const selectedActionSet = useMemo(
    () => new Set(selectedActionIds),
    [selectedActionIds],
  );
  const approvedCount = selectedActionIds.length;
  const blockedCount =
    dryRun?.action_items.filter((item) => item.blockers.length).length ?? 0;
  const recommendedCount =
    dryRun?.action_items.filter(
      (item) => item.default_decision === "approve" && !item.blockers.length,
    ).length ?? 0;

  useEffect(() => {
    if (dryRun && dryRun.entity_id !== entityId) {
      setDryRun(null);
      setApplyResult(null);
      setSelectedActionIds([]);
      setSelectedFile(null);
    }
  }, [dryRun, entityId]);

  const dryRunMutation = useMutation({
    mutationFn: (file: File) => dryRunRegisterImport({ entityId, file }),
    onMutate: () => {
      setDryRun(null);
      setApplyResult(null);
      setSelectedActionIds([]);
    },
    onSuccess: (result) => {
      setDryRun(result);
      setSelectedActionIds(
        result.action_items
          .filter(
            (item) =>
              item.default_decision === "approve" && !item.blockers.length,
          )
          .map((item) => item.id),
      );
    },
  });

  const applyMutation = useMutation({
    mutationFn: () => {
      if (!dryRun) {
        throw new Error("Run the spreadsheet review before applying.");
      }
      return applyRegisterImportPlan({
        entityId,
        filename: dryRun.filename,
        actionItems: dryRun.action_items,
        approvedActionIds: selectedActionIds,
        ignoredActionIds: dryRun.action_items
          .map((item) => item.id)
          .filter((id) => !selectedActionSet.has(id)),
      });
    },
    onSuccess: (result) => {
      setApplyResult(result);
      onApplied?.();
    },
  });

  function chooseFile(file: File | null | undefined) {
    if (!file) {
      return;
    }
    setSelectedFile(file);
    dryRunMutation.mutate(file);
  }

  function toggleAction(item: RegisterImportActionItem) {
    if (item.blockers.length) {
      return;
    }
    setSelectedActionIds((current) =>
      current.includes(item.id)
        ? current.filter((id) => id !== item.id)
        : [...current, item.id],
    );
  }

  return (
    <SectionPanel
      title="Spreadsheet import"
      description="Review workbook rows before they touch the portfolio register."
      icon={<FileSpreadsheet size={17} className="text-primary" />}
      actions={
        dryRun ? (
          <StatusBadge tone={blockedCount ? "warning" : "success"}>
            {blockedCount ? `${blockedCount} blocked` : "Ready"}
          </StatusBadge>
        ) : null
      }
    >
      <div className="grid gap-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => {
              chooseFile(event.target.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          <SecondaryButton
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={
              !entityId || dryRunMutation.isPending || applyMutation.isPending
            }
          >
            {dryRunMutation.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <FileUp size={15} />
            )}
            {selectedFile ? selectedFile.name : "Choose workbook"}
          </SecondaryButton>
          <Button
            type="button"
            disabled={!dryRun || approvedCount === 0 || applyMutation.isPending}
            onClick={() => applyMutation.mutate()}
          >
            {applyMutation.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Play size={15} />
            )}
            Apply {approvedCount ? formatNumber(approvedCount) : ""}
          </Button>
          {dryRun ? (
            <SecondaryButton
              type="button"
              onClick={() =>
                setSelectedActionIds(
                  dryRun.action_items
                    .filter(
                      (item) =>
                        item.default_decision === "approve" &&
                        !item.blockers.length,
                    )
                    .map((item) => item.id),
                )
              }
            >
              <RefreshCw size={15} />
              Recommended
            </SecondaryButton>
          ) : null}
        </div>

        {!entityId ? (
          <div className="rounded-md border border-warning/25 bg-leasium-warning-soft px-3 py-2 text-sm text-[#B54708]">
            Select an entity before importing a workbook.
          </div>
        ) : null}
        {dryRunMutation.error ? (
          <div className="rounded-md border border-danger/25 bg-leasium-danger-soft px-3 py-2 text-sm text-danger">
            {friendlyError(dryRunMutation.error)}
          </div>
        ) : null}
        {applyMutation.error ? (
          <div className="rounded-md border border-danger/25 bg-leasium-danger-soft px-3 py-2 text-sm text-danger">
            {friendlyError(applyMutation.error)}
          </div>
        ) : null}

        {dryRun ? (
          <>
            <div className="grid gap-2 text-sm sm:grid-cols-4">
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <div className="text-xs text-muted-foreground">Workbook</div>
                <div className="truncate font-semibold">{dryRun.filename}</div>
              </div>
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <div className="text-xs text-muted-foreground">Rows</div>
                <div className="font-semibold">
                  {formatNumber(
                    dryRun.totals.properties + dryRun.totals.tenancies,
                  )}
                </div>
              </div>
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <div className="text-xs text-muted-foreground">Recommended</div>
                <div className="font-semibold">
                  {formatNumber(recommendedCount)}
                </div>
              </div>
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <div className="text-xs text-muted-foreground">Findings</div>
                <div className="font-semibold">
                  {formatNumber(dryRun.findings.length)}
                </div>
              </div>
            </div>

            {applyResult ? (
              <div className="rounded-md border border-success/25 bg-leasium-success-soft px-3 py-2 text-sm text-[#027A48]">
                <div className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 size={15} />
                  Applied {formatNumber(applyResult.applied)} action
                  {applyResult.applied === 1 ? "" : "s"}
                </div>
                {createdSummary(applyResult).length ? (
                  <div className="mt-1 text-xs">
                    {createdSummary(applyResult).join(", ")}
                  </div>
                ) : null}
              </div>
            ) : null}

            {dryRun.findings.length ? (
              <div className="grid gap-2">
                {dryRun.findings.slice(0, 4).map((finding, index) => (
                  <div
                    key={`${finding.sheet}-${finding.row}-${finding.message}-${index}`}
                    className="flex items-start gap-2 rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <AlertTriangle
                      size={15}
                      className="mt-0.5 text-[#B54708]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone={findingTone(finding)}>
                          {finding.severity}
                        </StatusBadge>
                        <span className="text-xs text-muted-foreground">
                          {finding.sheet}
                          {finding.row ? ` row ${finding.row}` : ""}
                        </span>
                      </div>
                      <div className="mt-1">{finding.message}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="overflow-hidden rounded-md border border-border">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                <div className="text-sm font-semibold">Review actions</div>
                <div className="text-xs text-muted-foreground">
                  {formatNumber(approvedCount)} approved,{" "}
                  {formatNumber(dryRun.action_items.length - approvedCount)}{" "}
                  ignored
                </div>
              </div>
              <div className="max-h-96 divide-y divide-border overflow-auto">
                {dryRun.action_items.map((item) => {
                  const checked = selectedActionSet.has(item.id);
                  return (
                    <label
                      key={item.id}
                      className={[
                        "grid cursor-pointer gap-2 px-3 py-3 text-sm sm:grid-cols-[auto_minmax(0,1fr)_auto]",
                        item.blockers.length
                          ? "cursor-not-allowed bg-muted/40"
                          : "hover:bg-muted/35",
                      ].join(" ")}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 rounded border-border"
                        checked={checked}
                        disabled={item.blockers.length > 0}
                        onChange={() => toggleAction(item)}
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{item.label}</span>
                          <StatusBadge tone={actionTone(item)}>
                            {item.blockers.length ? "blocked" : item.operation}
                          </StatusBadge>
                          <span className="text-xs text-muted-foreground">
                            {item.source.source_hint}
                          </span>
                        </span>
                        <span className="mt-1 block text-muted-foreground">
                          {item.summary}
                        </span>
                        {item.blockers.length || item.warnings.length ? (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {[...item.blockers, ...item.warnings].join(" ")}
                          </span>
                        ) : null}
                        {item.changes[0] ? (
                          <span className="mt-1 block truncate text-xs text-muted-foreground">
                            {item.changes[0].label}:{" "}
                            {formatValue(item.changes[0].before)} to{" "}
                            {formatValue(item.changes[0].after)}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {item.target.replaceAll("_", " ")}
                      </span>
                    </label>
                  );
                })}
                {!dryRun.action_items.length ? (
                  <EmptyState title="No register actions found." />
                ) : null}
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            title="No workbook review yet."
            description="Choose an .xlsx file to stage property, tenancy, lease, rent, and obligation actions."
          />
        )}
      </div>
    </SectionPanel>
  );
}
