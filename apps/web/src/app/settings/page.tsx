"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDollarSign,
  Loader2,
  PlugZap,
  RefreshCw,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { QueryProvider } from "@/components/query-provider";
import {
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SecondaryButton,
  SectionPanel,
  Select,
  StatusBadge,
} from "@/components/ui";
import {
  getXeroStatus,
  listEntities,
  updateChargeRule,
  updateXeroConnection,
  type XeroMappingIssueRecord,
  type XeroReadinessSummaryRecord,
} from "@/lib/api";

const ENTITY_STORAGE_KEY = "leasium.entity_id";
const EMPTY_XERO_ISSUES: XeroMappingIssueRecord[] = [];

type StatusTone = "neutral" | "success" | "warning" | "danger" | "primary";

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not recorded";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function issueTone(issue: XeroMappingIssueRecord): StatusTone {
  if (issue.severity === "blocker") {
    return "danger";
  }
  if (issue.severity === "warning") {
    return "warning";
  }
  return "neutral";
}

function readyTone(summary: XeroReadinessSummaryRecord): StatusTone {
  if (summary.total === 0) {
    return "neutral";
  }
  return summary.missing === 0 ? "success" : "warning";
}

function summaryLabel(summary: XeroReadinessSummaryRecord) {
  if (summary.total === 0) {
    return "No records";
  }
  return `${summary.ready}/${summary.total} ready`;
}

function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  detail: string;
  tone?: StatusTone;
}) {
  const toneClass = {
    neutral: "bg-muted text-leasium-slate-500",
    success: "bg-leasium-success-soft text-[#027A48]",
    warning: "bg-leasium-warning-soft text-[#B54708]",
    danger: "bg-leasium-danger-soft text-[#B42318]",
    primary: "bg-leasium-blue-soft text-leasium-blue-hover",
  }[tone];
  return (
    <div className="rounded-md border border-border bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-2xl font-semibold">{value}</div>
          <div className="mt-1 text-sm font-medium">{label}</div>
        </div>
        <div className={`rounded-xl p-2 ${toneClass}`}>
          {tone === "success" ? (
            <CheckCircle2 size={18} />
          ) : tone === "danger" || tone === "warning" ? (
            <AlertTriangle size={18} />
          ) : (
            <CircleDollarSign size={18} />
          )}
        </div>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

function SettingsWorkspace() {
  const queryClient = useQueryClient();
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [xeroTenantId, setXeroTenantId] = useState("");

  const entitiesQuery = useQuery({
    queryKey: ["entities"],
    queryFn: listEntities,
  });

  useEffect(() => {
    const stored = window.localStorage.getItem(ENTITY_STORAGE_KEY);
    const accessibleIds = new Set(
      (entitiesQuery.data ?? []).map((entity) => entity.id),
    );
    const firstEntity = entitiesQuery.data?.[0]?.id ?? "";
    const next = stored && accessibleIds.has(stored) ? stored : firstEntity;
    if (!selectedEntityId && next) {
      setSelectedEntityId(next);
    }
  }, [entitiesQuery.data, selectedEntityId]);

  useEffect(() => {
    if (selectedEntityId) {
      window.localStorage.setItem(ENTITY_STORAGE_KEY, selectedEntityId);
    }
  }, [selectedEntityId]);

  const selectedEntity = entitiesQuery.data?.find(
    (entity) => entity.id === selectedEntityId,
  );

  const xeroStatusQuery = useQuery({
    queryKey: ["xero-status", selectedEntityId],
    queryFn: () => getXeroStatus(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });

  useEffect(() => {
    setXeroTenantId(xeroStatusQuery.data?.connection.xero_tenant_id ?? "");
  }, [xeroStatusQuery.data?.connection.xero_tenant_id]);

  const connectionMutation = useMutation({
    mutationFn: (payload: { connected: boolean; xero_tenant_id?: string | null }) =>
      updateXeroConnection(selectedEntityId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entities"] });
      queryClient.invalidateQueries({ queryKey: ["xero-status", selectedEntityId] });
    },
  });

  const mappingMutation = useMutation({
    mutationFn: (issue: XeroMappingIssueRecord) => {
      if (!issue.charge_rule_id) {
        throw new Error("This issue is not a charge-rule mapping.");
      }
      return updateChargeRule(issue.charge_rule_id, {
        xero_account_code:
          issue.current_account_code || issue.suggested_account_code || undefined,
        xero_tax_type: issue.current_tax_type || issue.suggested_tax_type || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["xero-status", selectedEntityId] });
    },
  });

  const status = xeroStatusQuery.data;
  const issues = status?.issues ?? EMPTY_XERO_ISSUES;
  const mappingIssues = useMemo(
    () =>
      issues.filter((issue) => issue.kind === "chart" || issue.kind === "tax"),
    [issues],
  );
  const otherIssues = useMemo(
    () =>
      issues.filter((issue) => issue.kind !== "chart" && issue.kind !== "tax"),
    [issues],
  );

  return (
    <main className="min-h-screen">
      <AppHeader>
        <Select
          aria-label="Entity"
          value={selectedEntityId}
          onChange={(event) => setSelectedEntityId(event.target.value)}
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
          title="Settings"
          description={
            selectedEntity
              ? `Xero readiness and sync controls for ${selectedEntity.name}.`
              : "Choose an entity to review Xero readiness."
          }
          actions={
            <SecondaryButton
              type="button"
              onClick={() => xeroStatusQuery.refetch()}
              disabled={!selectedEntityId || xeroStatusQuery.isFetching}
            >
              <RefreshCw size={15} />
              Refresh
            </SecondaryButton>
          }
        />

        {entitiesQuery.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {entitiesQuery.error instanceof Error
              ? entitiesQuery.error.message
              : "Could not load entities."}
          </div>
        ) : null}
        {xeroStatusQuery.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {xeroStatusQuery.error instanceof Error
              ? xeroStatusQuery.error.message
              : "Could not load Xero readiness."}
          </div>
        ) : null}
        {connectionMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {connectionMutation.error instanceof Error
              ? connectionMutation.error.message
              : "Could not update Xero connection status."}
          </div>
        ) : null}
        {mappingMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {mappingMutation.error instanceof Error
              ? mappingMutation.error.message
              : "Could not update the Xero mapping."}
          </div>
        ) : null}

        {!selectedEntityId ? (
          <SectionPanel>
            <EmptyState
              title="No entity selected"
              description="Choose an entity from the header to load Xero status, mappings, invoice sync readiness, and payment reconciliation."
            />
          </SectionPanel>
        ) : null}

        {selectedEntityId && status ? (
          <>
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <MetricCard
                label="Connection"
                value={status.connection.connected ? "Ready" : "Off"}
                detail={status.connection.status_label}
                tone={status.connection.connected ? "success" : "danger"}
              />
              <MetricCard
                label="Contacts"
                value={summaryLabel(status.contact_mapping)}
                detail={`${status.contact_mapping.missing} contact mapping issue${
                  status.contact_mapping.missing === 1 ? "" : "s"
                }.`}
                tone={readyTone(status.contact_mapping)}
              />
              <MetricCard
                label="Accounts"
                value={summaryLabel(status.chart_mapping)}
                detail={`${status.chart_mapping.missing} account code issue${
                  status.chart_mapping.missing === 1 ? "" : "s"
                }.`}
                tone={readyTone(status.chart_mapping)}
              />
              <MetricCard
                label="Tax types"
                value={summaryLabel(status.tax_mapping)}
                detail={`${status.tax_mapping.missing} tax mapping issue${
                  status.tax_mapping.missing === 1 ? "" : "s"
                }.`}
                tone={readyTone(status.tax_mapping)}
              />
              <MetricCard
                label="Payments"
                value={status.payment_reconciliation.reconciliation_ready}
                detail={`${status.payment_reconciliation.unpaid} unpaid, ${status.payment_reconciliation.partially_paid} part-paid, ${status.payment_reconciliation.paid} paid.`}
                tone={
                  status.payment_reconciliation.reconciliation_ready
                    ? "primary"
                    : "neutral"
                }
              />
            </section>

            <SectionPanel
              title="Xero connection"
              description="Record connection state before invoice sync is allowed. This does not call Xero or post invoices."
              icon={<PlugZap size={17} className="text-primary" />}
              actions={
                <StatusBadge
                  tone={status.connection.connected ? "success" : "danger"}
                >
                  {status.connection.status_label}
                </StatusBadge>
              }
            >
              <div className="grid gap-4 p-4 lg:grid-cols-[1fr_420px]">
                <div className="grid gap-3 text-sm">
                  <div>
                    <div className="font-medium">Next action</div>
                    <p className="mt-1 text-muted-foreground">
                      {status.connection.next_action}
                    </p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-md border border-border bg-muted/25 p-3">
                      <div className="text-xs uppercase text-muted-foreground">
                        Connected
                      </div>
                      <div className="mt-1 font-medium">
                        {formatDateTime(status.connection.connected_at)}
                      </div>
                    </div>
                    <div className="rounded-md border border-border bg-muted/25 p-3">
                      <div className="text-xs uppercase text-muted-foreground">
                        Last sync
                      </div>
                      <div className="mt-1 font-medium">
                        {formatDateTime(status.connection.last_sync_at)}
                      </div>
                    </div>
                  </div>
                  <ul className="grid gap-2 text-sm text-muted-foreground">
                    {status.guardrails.map((guardrail) => (
                      <li key={guardrail} className="flex gap-2">
                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary" />
                        <span>{guardrail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <form
                  className="grid gap-3 rounded-md border border-border bg-muted/25 p-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    connectionMutation.mutate({
                      connected: true,
                      xero_tenant_id: xeroTenantId.trim(),
                    });
                  }}
                >
                  <Field label="Xero tenant ID">
                    <Input
                      value={xeroTenantId}
                      onChange={(event) => setXeroTenantId(event.target.value)}
                      placeholder="Tenant or organisation ID"
                    />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="submit"
                      disabled={
                        connectionMutation.isPending || !xeroTenantId.trim()
                      }
                    >
                      {connectionMutation.isPending &&
                      connectionMutation.variables?.connected ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <CheckCircle2 size={15} />
                      )}
                      Save status
                    </Button>
                    <SecondaryButton
                      type="button"
                      className="text-danger"
                      disabled={
                        connectionMutation.isPending ||
                        !status.connection.connected
                      }
                      onClick={() =>
                        connectionMutation.mutate({ connected: false })
                      }
                    >
                      {connectionMutation.isPending &&
                      connectionMutation.variables?.connected === false ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <Ban size={15} />
                      )}
                      Clear
                    </SecondaryButton>
                  </div>
                </form>
              </div>
            </SectionPanel>

            <SectionPanel
              title="Chart and tax mapping"
              description="Review account codes and tax types on charge rules before any Xero posting approval exists."
              icon={<CircleDollarSign size={17} className="text-primary" />}
              actions={
                <StatusBadge tone={mappingIssues.length ? "warning" : "success"}>
                  {mappingIssues.length} issue
                  {mappingIssues.length === 1 ? "" : "s"}
                </StatusBadge>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="bg-muted text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Issue</th>
                      <th className="px-3 py-2 font-semibold">Record</th>
                      <th className="px-3 py-2 font-semibold">Current</th>
                      <th className="px-3 py-2 font-semibold">Suggestion</th>
                      <th className="px-3 py-2 font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappingIssues.map((issue) => {
                      const isApplying =
                        mappingMutation.isPending &&
                        mappingMutation.variables?.id === issue.id;
                      return (
                        <tr key={issue.id} className="border-t border-border align-top">
                          <td className="min-w-64 px-3 py-3">
                            <div className="flex items-center gap-2">
                              <StatusBadge tone={issueTone(issue)}>
                                {issue.kind.replaceAll("_", " ")}
                              </StatusBadge>
                              <span className="font-medium">{issue.label}</span>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {issue.detail}
                            </p>
                          </td>
                          <td className="min-w-56 px-3 py-3 text-xs">
                            <div className="font-medium text-foreground">
                              {issue.property_name ?? "Property"}
                            </div>
                            <div className="mt-1 text-muted-foreground">
                              {issue.unit_label ?? "Unit"}{" "}
                              {issue.tenant_name ? `/ ${issue.tenant_name}` : ""}
                            </div>
                            {issue.property_id ? (
                              <Link
                                href={`/properties?entity_id=${selectedEntityId}&property_id=${issue.property_id}`}
                                className="mt-1 inline-flex font-medium text-primary hover:text-leasium-blue-hover"
                              >
                                Open property
                              </Link>
                            ) : null}
                          </td>
                          <td className="px-3 py-3 text-xs">
                            <div>Account: {issue.current_account_code ?? "-"}</div>
                            <div>Tax: {issue.current_tax_type ?? "-"}</div>
                          </td>
                          <td className="px-3 py-3 text-xs">
                            <div>Account: {issue.suggested_account_code ?? "-"}</div>
                            <div>Tax: {issue.suggested_tax_type ?? "-"}</div>
                          </td>
                          <td className="px-3 py-3">
                            <SecondaryButton
                              type="button"
                              className="min-h-9 rounded-lg px-3"
                              disabled={!issue.charge_rule_id || isApplying}
                              onClick={() => mappingMutation.mutate(issue)}
                            >
                              {isApplying ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <CheckCircle2 size={14} />
                              )}
                              Apply
                            </SecondaryButton>
                          </td>
                        </tr>
                      );
                    })}
                    {!xeroStatusQuery.isLoading && mappingIssues.length === 0 ? (
                      <tr>
                        <td className="px-3 py-10" colSpan={5}>
                          <EmptyState
                            title="Chart and tax mappings look ready"
                            description="Charge-rule account codes and taxable tax types are present for this entity."
                          />
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </SectionPanel>

            <SectionPanel
              title="Sync and reconciliation queue"
              description="A plain-English queue for contacts, approved invoice drafts, and payment statuses before provider-backed sync is enabled."
              icon={<Settings size={17} className="text-primary" />}
              actions={
                <StatusBadge tone={otherIssues.length ? "warning" : "success"}>
                  {otherIssues.length} queue item
                  {otherIssues.length === 1 ? "" : "s"}
                </StatusBadge>
              }
            >
              <div className="grid gap-3 p-4 md:grid-cols-3">
                <div className="rounded-md border border-border bg-muted/25 p-3">
                  <div className="text-xs uppercase text-muted-foreground">
                    Invoice sync
                  </div>
                  <div className="mt-1 text-lg font-semibold">
                    {status.invoice_sync.approved_unsynced}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Approved invoice drafts waiting for future Xero posting.
                  </p>
                </div>
                <div className="rounded-md border border-border bg-muted/25 p-3">
                  <div className="text-xs uppercase text-muted-foreground">
                    Blocked sync
                  </div>
                  <div className="mt-1 text-lg font-semibold">
                    {status.invoice_sync.blocked}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Approved drafts blocked by missing connection state.
                  </p>
                </div>
                <div className="rounded-md border border-border bg-muted/25 p-3">
                  <div className="text-xs uppercase text-muted-foreground">
                    Reconciliation
                  </div>
                  <div className="mt-1 text-lg font-semibold">
                    {status.payment_reconciliation.reconciliation_ready}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Paid or part-paid invoices ready for later reconciliation.
                  </p>
                </div>
              </div>
              <div className="divide-y divide-border border-t border-border">
                {otherIssues.map((issue) => (
                  <div
                    key={issue.id}
                    className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[220px_1fr_220px]"
                  >
                    <div className="flex items-center gap-2">
                      <StatusBadge tone={issueTone(issue)}>
                        {issue.kind.replaceAll("_", " ")}
                      </StatusBadge>
                    </div>
                    <div>
                      <div className="font-medium">{issue.label}</div>
                      <p className="mt-1 text-muted-foreground">{issue.detail}</p>
                    </div>
                    <div className="text-sm text-muted-foreground">{issue.action}</div>
                  </div>
                ))}
                {otherIssues.length === 0 ? (
                  <EmptyState
                    title="No sync queue issues"
                    description="Connection, contact, invoice sync, and payment reconciliation queues are clear for the current records."
                  />
                ) : null}
              </div>
            </SectionPanel>
          </>
        ) : null}
      </div>
    </main>
  );
}

export default function SettingsPage() {
  return (
    <QueryProvider>
      <SettingsWorkspace />
    </QueryProvider>
  );
}
