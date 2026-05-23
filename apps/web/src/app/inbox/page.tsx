"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Loader2,
  Mail,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { QueryProvider } from "@/components/query-provider";
import {
  Button,
  EmptyState,
  Field,
  SecondaryButton,
  SectionPanel,
  Select,
  StatusBadge,
} from "@/components/ui";
import {
  type InboxPromoteKind,
  type InboxTriageKind,
  type InboxTriageRecord,
  listContractors,
  listEntities,
  listLeasesByTenant,
  listProperties,
  listTenants,
  promoteInboxMessage,
  triageInboxMessage,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const ENTITY_STORAGE_KEY = "leasium.entity_id";

type StatusTone = "neutral" | "success" | "warning" | "danger" | "primary";

const KIND_LABEL: Record<InboxTriageKind, string> = {
  maintenance_request: "Maintenance request",
  payment_or_arrears: "Payment or arrears",
  lease_change: "Lease change",
  tenant_contact: "Tenant contact",
  vendor_or_contractor: "Vendor / contractor",
  general: "General enquiry",
  spam_or_noise: "Spam or noise",
};

const PROMOTE_KIND_LABEL: Record<InboxPromoteKind, string> = {
  maintenance_request: "Create maintenance work order",
  payment_or_arrears: "Open arrears case",
  lease_change: "Send to Smart Intake review",
  vendor_or_contractor: "Add to contractor directory",
};

function isPromotable(kind: InboxTriageKind): kind is InboxPromoteKind {
  return (
    kind === "maintenance_request" ||
    kind === "payment_or_arrears" ||
    kind === "lease_change" ||
    kind === "vendor_or_contractor"
  );
}

const KIND_TONE: Record<InboxTriageKind, StatusTone> = {
  maintenance_request: "warning",
  payment_or_arrears: "danger",
  lease_change: "primary",
  tenant_contact: "primary",
  vendor_or_contractor: "neutral",
  general: "neutral",
  spam_or_noise: "neutral",
};

const SAMPLE_BODY = `Hi team,

The kitchen tap at Unit 3, 28 Queen Street has been leaking for two
days and is now dripping into the cabinet underneath. Can someone
take a look this week? It's not urgent enough to call a plumber out
of hours but the cabinet base is starting to swell.

Thanks,
Sarah (tenant, Acme Bakery)
`;

function friendlyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return "High confidence";
  if (confidence >= 0.5) return "Medium confidence";
  return "Low confidence";
}

function confidenceTone(confidence: number): StatusTone {
  if (confidence >= 0.8) return "success";
  if (confidence >= 0.5) return "primary";
  return "warning";
}

function InboxWorkspace() {
  const router = useRouter();
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [body, setBody] = useState("");
  const [result, setResult] = useState<InboxTriageRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promotePropertyId, setPromotePropertyId] = useState("");
  const [promoteTenantId, setPromoteTenantId] = useState("");
  const [promoteLeaseId, setPromoteLeaseId] = useState("");
  const [promoteContractorId, setPromoteContractorId] = useState("");
  const [promoteError, setPromoteError] = useState<string | null>(null);

  const entitiesQuery = useQuery({
    queryKey: ["entities"],
    queryFn: listEntities,
  });

  const propertiesQuery = useQuery({
    queryKey: ["inbox-promote-properties", selectedEntityId],
    queryFn: () => listProperties(selectedEntityId),
    enabled: Boolean(selectedEntityId) && Boolean(result),
  });

  const tenantsQuery = useQuery({
    queryKey: ["inbox-promote-tenants", selectedEntityId],
    queryFn: () => listTenants(selectedEntityId),
    enabled: Boolean(selectedEntityId) && Boolean(result),
  });

  const leasesQuery = useQuery({
    queryKey: ["inbox-promote-leases", promoteTenantId],
    queryFn: () => listLeasesByTenant(promoteTenantId),
    enabled:
      Boolean(promoteTenantId) &&
      Boolean(result) &&
      result?.kind === "lease_change",
  });

  const contractorsQuery = useQuery({
    queryKey: ["inbox-promote-contractors", selectedEntityId],
    queryFn: () => listContractors(selectedEntityId),
    enabled:
      Boolean(selectedEntityId) &&
      Boolean(result) &&
      result?.kind === "vendor_or_contractor",
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(ENTITY_STORAGE_KEY);
    if (stored) {
      setSelectedEntityId(stored);
    }
  }, []);

  useEffect(() => {
    if (!selectedEntityId && entitiesQuery.data?.length) {
      setSelectedEntityId(entitiesQuery.data[0].id);
    }
  }, [entitiesQuery.data, selectedEntityId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedEntityId) {
      window.localStorage.setItem(ENTITY_STORAGE_KEY, selectedEntityId);
    }
  }, [selectedEntityId]);

  const triageMutation = useMutation({
    mutationFn: (payload: { entity_id: string; body: string }) =>
      triageInboxMessage(payload),
    onMutate: () => {
      setError(null);
      setPromoteError(null);
    },
    onSuccess: (data) => {
      setResult(data);
      setPromotePropertyId(data.suggested_property?.id ?? "");
      setPromoteTenantId(data.suggested_tenant?.id ?? "");
      setPromoteLeaseId(data.suggested_lease?.id ?? "");
      setPromoteContractorId(data.suggested_contractor?.id ?? "");
    },
    onError: (err) => {
      setError(friendlyError(err));
      setResult(null);
    },
  });

  const promoteMutation = useMutation({
    mutationFn: promoteInboxMessage,
    onMutate: () => setPromoteError(null),
    onSuccess: (data) => {
      router.push(data.target_href);
    },
    onError: (err) => setPromoteError(friendlyError(err)),
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || !selectedEntityId) return;
    triageMutation.mutate({ entity_id: selectedEntityId, body: trimmed });
  }

  function handleReset() {
    setBody("");
    setResult(null);
    setError(null);
    setPromoteError(null);
    setPromotePropertyId("");
    setPromoteTenantId("");
    setPromoteLeaseId("");
    setPromoteContractorId("");
  }

  function handleSample() {
    setBody(SAMPLE_BODY);
    setResult(null);
    setError(null);
    setPromoteError(null);
  }

  function handlePromote() {
    if (!result || !selectedEntityId) return;
    if (!isPromotable(result.kind)) return;
    promoteMutation.mutate({
      entity_id: selectedEntityId,
      kind: result.kind,
      summary: result.summary,
      body: body.trim(),
      property_id: promotePropertyId || null,
      tenant_id: promoteTenantId || null,
      lease_id: promoteLeaseId || null,
      contractor_id: promoteContractorId || null,
    });
  }

  const showPromote = result !== null && isPromotable(result.kind);
  const promoteRequiresTenant = result?.kind === "payment_or_arrears";
  const promoteShowsLeasePicker = result?.kind === "lease_change";
  const promoteShowsContractorPicker =
    result?.kind === "vendor_or_contractor";
  const promoteDisabled =
    !showPromote ||
    promoteMutation.isPending ||
    (promoteRequiresTenant && !promoteTenantId);

  const promoteKindLabel = useMemo(() => {
    if (!result || !isPromotable(result.kind)) return null;
    if (
      result.kind === "vendor_or_contractor" &&
      promoteContractorId
    ) {
      return "Open contractor profile";
    }
    return PROMOTE_KIND_LABEL[result.kind];
  }, [result, promoteContractorId]);

  const submitDisabled =
    !selectedEntityId || !body.trim() || triageMutation.isPending;

  return (
    <main className="min-h-screen">
      <AppHeader>
        <Select
          aria-label="Entity"
          value={selectedEntityId}
          onChange={(event) => setSelectedEntityId(event.target.value)}
        >
          {(entitiesQuery.data ?? []).map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))}
        </Select>
      </AppHeader>
      <div className="mx-auto grid max-w-5xl gap-5 px-5 py-6">
        <section className="relative overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-primary-soft/40 via-white to-accent-soft/25 px-5 py-4 shadow-leasiumXs">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent"
          />
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-leasium-teal text-white shadow-leasiumXs">
              <Sparkles size={18} />
            </div>
            <div className="min-w-0">
              <h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                Leasium AI Inbox
                <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0 text-leasium-micro font-bold uppercase tracking-wide text-primary">
                  Beta
                </span>
              </h1>
              <p className="text-sm text-muted-foreground">
                Paste an inbound email, SMS, or message. Leasium AI classifies
                it and points you at the right next step. Read-only — Leasium
                AI will never act on a message without you.
              </p>
            </div>
          </div>
        </section>

        <SectionPanel
          title="Classify a message"
          description="Strip out signatures and confidential headers before pasting. The AI doesn't echo personal details — it paraphrases."
          icon={<Mail size={17} className="text-primary" />}
          actions={
            <div className="flex gap-1">
              <SecondaryButton type="button" onClick={handleSample}>
                Try sample
              </SecondaryButton>
              {body || result ? (
                <SecondaryButton type="button" onClick={handleReset}>
                  Reset
                </SecondaryButton>
              ) : null}
            </div>
          }
        >
          <form onSubmit={handleSubmit} className="grid gap-4 p-4">
            <Field label="Message body">
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={10}
                placeholder="Paste the email or message here…"
                disabled={triageMutation.isPending}
                aria-label="Inbox message body"
                className="min-h-[200px] w-full rounded-md border border-border bg-white p-3 text-sm outline-none focus-visible:border-primary"
              />
            </Field>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Tip: pressing Cmd/Ctrl + Enter inside the textarea will
                classify.
              </p>
              <Button type="submit" disabled={submitDisabled}>
                {triageMutation.isPending ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" /> Classifying…
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <Sparkles size={14} /> Classify
                  </span>
                )}
              </Button>
            </div>
          </form>

          {error ? (
            <div className="m-4 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
              {error}
            </div>
          ) : null}
        </SectionPanel>

        {result ? (
          <SectionPanel
            title="Classification"
            description={result.summary}
            icon={<Sparkles size={17} className="text-primary" />}
            actions={
              <div className="flex items-center gap-1">
                <StatusBadge tone={KIND_TONE[result.kind]}>
                  {KIND_LABEL[result.kind]}
                </StatusBadge>
                <StatusBadge tone={confidenceTone(result.confidence)}>
                  {confidenceLabel(result.confidence)} ·{" "}
                  {Math.round(result.confidence * 100)}%
                </StatusBadge>
              </div>
            }
          >
            <div className="grid gap-4 p-4">
              <div className="grid gap-2 rounded-md border border-border bg-white p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Suggested next step
                </div>
                <p className="text-sm text-foreground">
                  {result.suggested_action}
                </p>
                {result.suggested_target_href ? (
                  <Link
                    href={result.suggested_target_href}
                    className="inline-flex min-h-11 w-fit items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-3 text-sm font-semibold text-primary transition hover:bg-primary/10"
                  >
                    Take it from here <ArrowRight size={12} />
                  </Link>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No clear Leasium surface for this message. Handle outside
                    the platform or paste a fuller message.
                  </p>
                )}
              </div>

              {showPromote ? (
                <div
                  className="grid gap-3 rounded-md border border-primary/30 bg-primary-soft/30 p-3"
                  data-testid="promote-panel"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-primary">
                        Promote to a Leasium draft
                      </div>
                      <p className="text-sm text-foreground">
                        {promoteKindLabel}. Leasium creates the draft;
                        nothing is sent until you approve from inside the
                        target surface.
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {promoteShowsContractorPicker ? (
                      <Field label="Contractor">
                        <Select
                          aria-label="Promote contractor"
                          value={promoteContractorId}
                          onChange={(event) =>
                            setPromoteContractorId(event.target.value)
                          }
                        >
                          <option value="">Create new contractor</option>
                          {(contractorsQuery.data ?? []).map((contractor) => (
                            <option key={contractor.id} value={contractor.id}>
                              {contractor.name}
                              {contractor.company_name
                                ? ` (${contractor.company_name})`
                                : ""}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    ) : (
                      <>
                        <Field label="Property">
                          <Select
                            aria-label="Promote property"
                            value={promotePropertyId}
                            onChange={(event) =>
                              setPromotePropertyId(event.target.value)
                            }
                          >
                            <option value="">No property attached</option>
                            {(propertiesQuery.data ?? []).map((property) => (
                              <option key={property.id} value={property.id}>
                                {property.name}
                                {property.street_address
                                  ? ` — ${property.street_address}`
                                  : ""}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field
                          label={
                            promoteRequiresTenant
                              ? "Tenant (required)"
                              : "Tenant"
                          }
                        >
                          <Select
                            aria-label="Promote tenant"
                            value={promoteTenantId}
                            onChange={(event) => {
                              setPromoteTenantId(event.target.value);
                              setPromoteLeaseId("");
                            }}
                          >
                            <option value="">
                              {promoteRequiresTenant
                                ? "Pick a tenant"
                                : "No tenant attached"}
                            </option>
                            {(tenantsQuery.data ?? []).map((tenant) => (
                              <option key={tenant.id} value={tenant.id}>
                                {tenant.trading_name || tenant.legal_name}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        {promoteShowsLeasePicker ? (
                          <Field label="Lease">
                            <Select
                              aria-label="Promote lease"
                              value={promoteLeaseId}
                              onChange={(event) =>
                                setPromoteLeaseId(event.target.value)
                              }
                              disabled={!promoteTenantId}
                            >
                              <option value="">No lease attached</option>
                              {(leasesQuery.data ?? []).map((lease) => (
                                <option key={lease.id} value={lease.id}>
                                  {lease.status} —{" "}
                                  {lease.commencement_date ?? "no start"}
                                  {lease.expiry_date
                                    ? ` → ${lease.expiry_date}`
                                    : ""}
                                </option>
                              ))}
                            </Select>
                          </Field>
                        ) : null}
                      </>
                    )}
                  </div>

                  {(result.suggested_property ||
                    result.suggested_tenant ||
                    result.suggested_lease ||
                    result.suggested_contractor) ? (
                    <div className="text-xs text-muted-foreground">
                      AI suggested
                      {result.suggested_property
                        ? ` property “${result.suggested_property.label}”`
                        : ""}
                      {result.suggested_tenant
                        ? `${result.suggested_property ? "," : ""} tenant “${result.suggested_tenant.label}”`
                        : ""}
                      {result.suggested_lease
                        ? `${
                            result.suggested_property ||
                            result.suggested_tenant
                              ? ","
                              : ""
                          } lease “${result.suggested_lease.label}”`
                        : ""}
                      {result.suggested_contractor
                        ? `${
                            result.suggested_property ||
                            result.suggested_tenant ||
                            result.suggested_lease
                              ? ","
                              : ""
                          } contractor “${result.suggested_contractor.label}”`
                        : ""}
                      . Override above if needed.
                    </div>
                  ) : null}

                  {promoteError ? (
                    <div className="rounded-md border border-danger/30 bg-danger/5 p-2 text-xs text-danger">
                      {promoteError}
                    </div>
                  ) : null}

                  <div className="flex items-center justify-end">
                    <Button
                      type="button"
                      onClick={handlePromote}
                      disabled={promoteDisabled}
                    >
                      {promoteMutation.isPending ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 size={14} className="animate-spin" />{" "}
                          Promoting…
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <ArrowRight size={14} /> Promote to draft
                        </span>
                      )}
                    </Button>
                  </div>
                </div>
              ) : null}

              {result.key_facts.length ? (
                <div className="grid gap-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Key facts
                  </div>
                  <div className="grid gap-1.5">
                    {result.key_facts.map((fact, idx) => (
                      <div
                        key={`${fact.label}-${idx}`}
                        className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm"
                      >
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {fact.label}
                        </span>
                        <span className="text-right text-sm text-foreground">
                          {fact.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {result.warnings.length ? (
                <div className="grid gap-1 rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-warning-foreground">
                  <div className="font-semibold uppercase tracking-wide">
                    Warnings
                  </div>
                  {result.warnings.map((warning, idx) => (
                    <div key={idx} className="flex items-start gap-1.5">
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                      <span>{warning}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {result.guardrails.length ? (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Guardrails</summary>
                  <ul className="mt-1.5 ml-4 list-disc space-y-0.5">
                    {result.guardrails.map((line, idx) => (
                      <li key={idx}>{line}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          </SectionPanel>
        ) : !triageMutation.isPending && !error ? (
          <SectionPanel
            title="How this works"
            description="A quick run-down so you know what to expect."
            icon={<Sparkles size={17} className="text-primary" />}
          >
            <div className="grid gap-3 p-4 text-sm text-muted-foreground">
              <ol className="ml-4 list-decimal space-y-1.5">
                <li>
                  Forward or paste an email, SMS, or chat message from a
                  tenant, contractor, agent, or supplier.
                </li>
                <li>
                  Leasium classifies it into one of seven kinds (maintenance,
                  payment, lease, tenant contact, vendor, general, spam).
                </li>
                <li>
                  You get a short summary, the suggested next action, and a
                  deep-link to the right Leasium surface so the reviewed
                  workflow can take over.
                </li>
                <li>
                  No records are created automatically in v1. You stay the
                  approver.
                </li>
              </ol>
              <p
                className={cn(
                  "rounded-md border border-border bg-muted/20 p-3 text-xs",
                )}
              >
                Personal details in the message body are paraphrased, not
                echoed verbatim. The full body is not stored; only the
                length, classification kind, and confidence are audited.
              </p>
            </div>
            {!body ? (
              <div className="border-t border-border p-4">
                <EmptyState
                  icon={<Mail size={18} />}
                  title="Nothing pasted yet."
                  description="Paste a message above, or click Try sample for a real-looking maintenance request."
                />
              </div>
            ) : null}
          </SectionPanel>
        ) : null}
      </div>
    </main>
  );
}

export default function InboxPage() {
  return (
    <QueryProvider>
      <InboxWorkspace />
    </QueryProvider>
  );
}
