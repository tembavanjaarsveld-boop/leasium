"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { QueryProvider } from "@/components/query-provider";
import {
  Button,
  EmptyState,
  PageHeader,
  SecondaryButton,
  SectionPanel,
  Select,
  StatusBadge,
} from "@/components/ui";
import {
  applyRegisterImportPlan,
  dryRunRegisterImport,
  listEntities,
  type RegisterImportActionItem,
  type RegisterImportApplyRecord,
  type RegisterImportDryRunRecord,
} from "@/lib/api";

const ENTITY_STORAGE_KEY = "leasium.entity_id";

function friendlyError(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function valueLabel(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function targetLabel(value: string) {
  return value.replaceAll("_", " ");
}

function summarizeCounts(values: Record<string, number>) {
  const entries = Object.entries(values).filter(([, count]) => count > 0);
  if (!entries.length) {
    return "No records changed.";
  }
  return entries
    .map(([key, count]) => `${count} ${targetLabel(key)}`)
    .join(", ");
}

function SpreadsheetImportWorkspace() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [plan, setPlan] = useState<RegisterImportDryRunRecord | null>(null);
  const [approvedIds, setApprovedIds] = useState<Record<string, boolean>>({});
  const [applyResult, setApplyResult] = useState<RegisterImportApplyRecord | null>(
    null,
  );

  const entitiesQuery = useQuery({
    queryKey: ["entities"],
    queryFn: listEntities,
  });

  useEffect(() => {
    const stored = window.localStorage.getItem(ENTITY_STORAGE_KEY);
    if (stored) {
      setSelectedEntityId(stored);
    }
  }, []);

  useEffect(() => {
    if (!entitiesQuery.isSuccess) {
      return;
    }
    const entities = entitiesQuery.data ?? [];
    if (!entities.length) {
      return;
    }
    if (!selectedEntityId || !entities.some((entity) => entity.id === selectedEntityId)) {
      const firstEntityId = entities[0].id;
      setSelectedEntityId(firstEntityId);
      window.localStorage.setItem(ENTITY_STORAGE_KEY, firstEntityId);
    }
  }, [entitiesQuery.data, entitiesQuery.isSuccess, selectedEntityId]);

  const dryRunMutation = useMutation({
    mutationFn: (file: File) =>
      dryRunRegisterImport({ entityId: selectedEntityId, file }),
    onSuccess: (nextPlan) => {
      setPlan(nextPlan);
      setApplyResult(null);
      setApprovedIds(
        Object.fromEntries(
          nextPlan.action_items.map((item) => [
            item.id,
            item.default_decision === "approve" && item.blockers.length === 0,
          ]),
        ),
      );
    },
  });

  const applyMutation = useMutation({
    mutationFn: () => {
      if (!plan) {
        throw new Error("Run a workbook review before applying.");
      }
      const approvedActionIds = Object.entries(approvedIds)
        .filter(([, approved]) => approved)
        .map(([id]) => id);
      return applyRegisterImportPlan({
        entityId: selectedEntityId,
        filename: plan.filename,
        planId: plan.plan_id,
        actionItems: plan.action_items,
        approvedActionIds,
        ignoredActionIds: plan.action_items
          .map((item) => item.id)
          .filter((id) => !approvedIds[id]),
      });
    },
    onSuccess: setApplyResult,
  });

  const approvedCount = useMemo(
    () => Object.values(approvedIds).filter(Boolean).length,
    [approvedIds],
  );
  const blockerCount = plan?.findings.filter((item) => item.severity === "blocker").length ?? 0;
  const warningCount = plan?.findings.filter((item) => item.severity === "warning").length ?? 0;

  function reviewWorkbook(file: File | null | undefined) {
    if (!file || !selectedEntityId) {
      return;
    }
    dryRunMutation.mutate(file);
  }

  return (
    <main className="min-h-screen">
      <AppHeader>
        <Select
          aria-label="Entity"
          value={selectedEntityId}
          onChange={(event) => {
            setSelectedEntityId(event.target.value);
            if (event.target.value) {
              window.localStorage.setItem(ENTITY_STORAGE_KEY, event.target.value);
            }
          }}
        >
          <option value="">Select entity</option>
          {entitiesQuery.data?.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))}
        </Select>
      </AppHeader>

      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-5">
        <PageHeader
          title="Spreadsheet Intake"
          description="Review a portfolio workbook before Leasium creates or updates register records."
          actions={
            <div className="flex flex-wrap gap-2">
              <Link
                href="/intake"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
              >
                <FileSpreadsheet size={15} />
                Smart Intake
              </Link>
              <SecondaryButton
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!selectedEntityId || dryRunMutation.isPending}
              >
                {dryRunMutation.isPending ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Upload size={15} />
                )}
                Review workbook
              </SecondaryButton>
            </div>
          }
        />

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => {
            reviewWorkbook(event.target.files?.[0]);
            event.currentTarget.value = "";
          }}
        />

        <section className="grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-border bg-white p-4 shadow-leasiumXs">
            <div className="text-2xl font-semibold">
              {plan?.totals.properties ?? "-"}
            </div>
            <div className="mt-1 text-sm font-medium">Properties</div>
          </div>
          <div className="rounded-2xl border border-border bg-white p-4 shadow-leasiumXs">
            <div className="text-2xl font-semibold">
              {plan?.totals.tenancies ?? "-"}
            </div>
            <div className="mt-1 text-sm font-medium">Tenancies</div>
          </div>
          <div className="rounded-2xl border border-border bg-white p-4 shadow-leasiumXs">
            <div className="text-2xl font-semibold">{blockerCount}</div>
            <div className="mt-1 text-sm font-medium">Blockers</div>
          </div>
          <div className="rounded-2xl border border-border bg-white p-4 shadow-leasiumXs">
            <div className="text-2xl font-semibold">{approvedCount}</div>
            <div className="mt-1 text-sm font-medium">Approved actions</div>
          </div>
        </section>

        {dryRunMutation.error ? (
          <div className="rounded-2xl border border-danger/20 bg-leasium-danger-soft p-4 text-sm text-danger">
            {friendlyError(dryRunMutation.error)}
          </div>
        ) : null}
        {applyMutation.error ? (
          <div className="rounded-2xl border border-danger/20 bg-leasium-danger-soft p-4 text-sm text-danger">
            {friendlyError(applyMutation.error)}
          </div>
        ) : null}

        {applyResult ? (
          <SectionPanel
            title="Apply complete"
            description={`${applyResult.applied} applied, ${applyResult.skipped} skipped, ${applyResult.blocked} blocked.`}
            icon={<CheckCircle2 size={17} className="text-primary" />}
            actions={<StatusBadge tone="success">Reviewed apply</StatusBadge>}
          >
            <div className="grid gap-3 p-4 text-sm md:grid-cols-2">
              <div className="rounded-xl border border-border bg-muted/40 p-3">
                <div className="font-semibold">Created</div>
                <div className="mt-1 text-muted-foreground">
                  {summarizeCounts(applyResult.created)}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-muted/40 p-3">
                <div className="font-semibold">Updated</div>
                <div className="mt-1 text-muted-foreground">
                  {summarizeCounts(applyResult.updated)}
                </div>
              </div>
            </div>
          </SectionPanel>
        ) : null}

        {!plan ? (
          <SectionPanel
            title="Portfolio workbook review"
            description="Upload an .xlsx source-of-truth workbook to stage a no-mutation plan."
            icon={<FileSpreadsheet size={17} className="text-primary" />}
          >
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!selectedEntityId || dryRunMutation.isPending}
              className="m-4 grid min-h-36 place-items-center rounded-md border border-dashed border-border bg-muted/35 p-4 text-center transition hover:border-primary/50 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="grid justify-items-center gap-2">
                {dryRunMutation.isPending ? (
                  <Loader2 size={24} className="animate-spin text-primary" />
                ) : (
                  <FileSpreadsheet size={24} className="text-primary" />
                )}
                <span className="font-semibold">
                  {dryRunMutation.isPending
                    ? "Reviewing workbook..."
                    : "Drop in the portfolio spreadsheet"}
                </span>
                <span className="text-sm text-muted-foreground">
                  Leasium will only stage proposed actions. Nothing changes until Apply.
                </span>
              </span>
            </button>
          </SectionPanel>
        ) : (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <SectionPanel
              title={plan.filename}
              description={plan.summary}
              icon={<FileSpreadsheet size={17} className="text-primary" />}
              actions={
                <Button
                  type="button"
                  onClick={() => applyMutation.mutate()}
                  disabled={
                    !approvedCount ||
                    applyMutation.isPending ||
                    dryRunMutation.isPending
                  }
                >
                  {applyMutation.isPending ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={15} />
                  )}
                  Apply approved
                </Button>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="bg-muted text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Apply</th>
                      <th className="px-3 py-2 font-semibold">Action</th>
                      <th className="px-3 py-2 font-semibold">Source</th>
                      <th className="px-3 py-2 font-semibold">Changes</th>
                      <th className="px-3 py-2 font-semibold">Checks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.action_items.map((item: RegisterImportActionItem) => {
                      const blocked = item.blockers.length > 0;
                      const approved = Boolean(approvedIds[item.id]);
                      return (
                        <tr key={item.id} className="border-t border-border align-top">
                          <td className="px-3 py-3">
                            <input
                              type="checkbox"
                              aria-label={`Approve ${item.label}`}
                              checked={approved}
                              disabled={blocked}
                              onChange={(event) =>
                                setApprovedIds((current) => ({
                                  ...current,
                                  [item.id]: event.target.checked,
                                }))
                              }
                              className="h-4 w-4 rounded border-border text-primary"
                            />
                          </td>
                          <td className="min-w-64 px-3 py-3">
                            <div className="font-medium">{item.label}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {targetLabel(item.operation)} {targetLabel(item.target)}
                            </div>
                            <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                              {item.summary}
                            </p>
                          </td>
                          <td className="min-w-40 px-3 py-3 text-xs text-muted-foreground">
                            <div>{item.source.sheet}</div>
                            <div>Row {item.source.row ?? "-"}</div>
                            <div className="mt-1">{item.source.source_hint}</div>
                          </td>
                          <td className="min-w-72 px-3 py-3">
                            <div className="grid gap-2 text-xs">
                              {item.changes.slice(0, 4).map((change) => (
                                <div
                                  key={`${item.id}-${change.field}`}
                                  className="rounded-md border border-border bg-muted/40 p-2"
                                >
                                  <div className="font-semibold text-foreground">
                                    {change.label}
                                  </div>
                                  <div className="mt-1 text-muted-foreground">
                                    {valueLabel(change.before)} {"->"}{" "}
                                    {valueLabel(change.after)}
                                  </div>
                                </div>
                              ))}
                              {item.changes.length > 4 ? (
                                <div className="text-muted-foreground">
                                  +{item.changes.length - 4} more
                                </div>
                              ) : null}
                            </div>
                          </td>
                          <td className="min-w-56 px-3 py-3">
                            <div className="flex flex-wrap gap-2">
                              <StatusBadge tone={blocked ? "danger" : "success"}>
                                {blocked ? "Blocked" : "Ready"}
                              </StatusBadge>
                              {item.warnings.length ? (
                                <StatusBadge tone="warning">
                                  {item.warnings.length} warning
                                </StatusBadge>
                              ) : null}
                            </div>
                            {[...item.blockers, ...item.warnings].slice(0, 3).map((message) => (
                              <div
                                key={message}
                                className="mt-2 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
                              >
                                {message}
                              </div>
                            ))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </SectionPanel>

            <div className="grid content-start gap-5">
              <SectionPanel
                title="Workbook checks"
                icon={<AlertTriangle size={17} className="text-primary" />}
                actions={
                  <StatusBadge tone={blockerCount ? "danger" : "success"}>
                    {blockerCount ? `${blockerCount} blockers` : "Ready"}
                  </StatusBadge>
                }
              >
                <div className="grid gap-3 p-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Warnings</span>
                    <span className="font-semibold">{warningCount}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Actions staged</span>
                    <span className="font-semibold">{plan.action_items.length}</span>
                  </div>
                  <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                    Every applied record stores workbook filename, sheet, row, action ID,
                    and before/after source context where available.
                  </div>
                </div>
              </SectionPanel>

              <SectionPanel title="Findings">
                <div className="divide-y divide-border">
                  {plan.findings.slice(0, 8).map((finding, index) => (
                    <div key={`${finding.message}-${index}`} className="px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge
                          tone={
                            finding.severity === "blocker"
                              ? "danger"
                              : finding.severity === "warning"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {finding.severity}
                        </StatusBadge>
                        <span className="font-medium">{finding.message}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {finding.sheet ?? "Workbook"} row {finding.row ?? "-"}
                      </div>
                    </div>
                  ))}
                  {!plan.findings.length ? (
                    <EmptyState title="No findings" description="The workbook is ready to apply." />
                  ) : null}
                </div>
              </SectionPanel>

              <SecondaryButton
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!selectedEntityId || dryRunMutation.isPending}
              >
                <RefreshCw size={15} />
                Review another workbook
              </SecondaryButton>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default function SpreadsheetImportPage() {
  return (
    <QueryProvider>
      <SpreadsheetImportWorkspace />
    </QueryProvider>
  );
}
