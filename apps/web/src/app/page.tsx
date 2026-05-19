"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  ClipboardList,
  FileText,
  FileUp,
  Link2,
  Loader2,
  ReceiptText,
  RefreshCw,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { QueryProvider } from "@/components/query-provider";
import {
  EmptyState,
  PageHeader,
  SecondaryButton,
  SectionPanel,
  Select,
  StatusBadge,
} from "@/components/ui";
import {
  createDocumentIntake,
  deleteDocumentIntake,
  DocumentIntakeRecord,
  listEntities,
  listDocumentIntakes,
  listObligations,
  listProperties,
  listRentRoll,
  listTenantOnboardings,
  listTenants,
  ObligationRecord,
  RentRollRow,
} from "@/lib/api";

const ENTITY_STORAGE_KEY = "leasium.entity_id";
type StatusTone = "neutral" | "success" | "warning" | "danger" | "primary";

function dateOnly(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  const dateValue = value.length === 10 ? `${value}T00:00:00` : value;
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(dateValue));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatMoney(cents: number | null | undefined) {
  if (cents === null || cents === undefined) {
    return "-";
  }
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function friendlyError(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function dueRank(value: string | null | undefined) {
  if (!value) {
    return 9999;
  }
  const today = new Date(dateOnly(new Date())).getTime();
  const due = new Date(`${value.slice(0, 10)}T00:00:00`).getTime();
  return Math.ceil((due - today) / 86_400_000);
}

function dueLabel(value: string | null | undefined) {
  const days = dueRank(value);
  if (days < 0) {
    return `${Math.abs(days)}d overdue`;
  }
  if (days === 0) {
    return "Today";
  }
  if (days === 1) {
    return "Tomorrow";
  }
  if (days < 31) {
    return `In ${days}d`;
  }
  return formatDate(value);
}

function obligationTone(obligation: ObligationRecord): StatusTone {
  const days = dueRank(obligation.due_date);
  if (days < 0) {
    return "danger";
  }
  if (days <= 14 || obligation.priority <= 1) {
    return "warning";
  }
  return "neutral";
}

function blockers(row: RentRollRow) {
  return [
    ...(row.invoice_readiness_blockers ?? []),
    ...(row.xero_readiness_blockers ?? []),
    ...(row.gst_readiness_blockers ?? []),
  ].filter(Boolean);
}

function intakeStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "uploaded":
      return "Uploaded";
    case "reading":
      return "Reading";
    case "ready_for_review":
      return "Needs review";
    case "needs_attention":
      return "Needs match";
    case "applied":
      return "Applied";
    case "failed":
      return "Could not read";
    default:
      return "Review";
  }
}

function intakeStatusTone(status: string | null | undefined): StatusTone {
  switch (status) {
    case "ready_for_review":
      return "primary";
    case "needs_attention":
      return "warning";
    case "applied":
      return "success";
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}

function documentTypeLabel(value: string | null | undefined) {
  if (!value) {
    return "Document";
  }
  return value.replaceAll("_", " ");
}

function confidenceLabel(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "Check details";
  }
  if (value >= 0.8) {
    return "High confidence";
  }
  if (value >= 0.55) {
    return "Check match";
  }
  return "Needs review";
}

function safeCurrency(value: unknown) {
  const text = fieldText(value) ?? "AUD";
  return /^[A-Z]{3}$/.test(text) ? text : "AUD";
}

function fieldText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstField(items: Array<Record<string, unknown>> | null | undefined, key: string) {
  return fieldText(items?.[0]?.[key]);
}

function recordList(items: Array<Record<string, unknown>> | null | undefined) {
  return Array.isArray(items) ? items.slice(0, 4) : [];
}

function intakeIsActive(item: DocumentIntakeRecord) {
  return item.status === "uploaded" || item.status === "reading";
}

function SmartReviewSummary({
  intake,
  onClear,
  clearing,
}: {
  intake: DocumentIntakeRecord;
  onClear: () => void;
  clearing: boolean;
}) {
  const data = intake.extracted_data;
  const warnings = [
    ...(data.warnings ?? []),
    ...(data.missing_information ?? []),
  ].slice(0, 4);
  return (
    <div className="grid gap-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Review summary</div>
          <div className="text-xs text-muted-foreground">
            {documentTypeLabel(intake.document_type)} - {confidenceLabel(intake.confidence)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge tone={intakeStatusTone(intake.status)}>
            {intakeStatusLabel(intake.status)}
          </StatusBadge>
          <SecondaryButton
            type="button"
            className="h-8"
            onClick={onClear}
            disabled={clearing}
          >
            <X size={14} />
            Clear
          </SecondaryButton>
        </div>
      </div>

      <div className="grid gap-3 text-sm">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
            Summary
          </div>
          <p className="text-muted-foreground">
            {intake.summary ?? "No summary yet."}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <ReviewGroup
            title="Parties"
            empty="No parties found."
            items={recordList(data.parties).map((item) =>
              [
                fieldText(item.name),
                fieldText(item.role),
                fieldText(item.contact),
              ]
                .filter(Boolean)
                .join(" - "),
            )}
          />
          <ReviewGroup
            title="Dates"
            empty="No dates found."
            items={recordList(data.key_dates).map((item) =>
              [fieldText(item.label), fieldText(item.date)].filter(Boolean).join(" - "),
            )}
          />
          <ReviewGroup
            title="Money"
            empty="No money found."
            items={recordList(data.money_amounts).map((item) =>
              [
                fieldText(item.label),
                item.amount === null || item.amount === undefined
                  ? null
                  : new Intl.NumberFormat("en-AU", {
                      style: "currency",
                      currency: safeCurrency(item.currency),
                      maximumFractionDigits: 0,
                    }).format(Number(item.amount)),
                fieldText(item.frequency),
              ]
                .filter(Boolean)
                .join(" - "),
            )}
          />
          <ReviewGroup
            title="Warnings"
            empty="No warnings."
            items={warnings}
            tone={warnings.length ? "danger" : "neutral"}
          />
        </div>
      </div>
    </div>
  );
}

function ReviewGroup({
  title,
  empty,
  items,
  tone = "neutral",
}: {
  title: string;
  empty: string;
  items: Array<string | null>;
  tone?: "neutral" | "danger";
}) {
  const visibleItems = items.filter(Boolean);
  return (
    <div className="rounded-md bg-muted/40 p-3">
      <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
        {title}
      </div>
      <div className="grid gap-1.5">
        {visibleItems.length ? (
          visibleItems.map((item) => (
            <div
              key={item}
              className={tone === "danger" ? "text-danger" : "text-foreground"}
            >
              {item}
            </div>
          ))
        ) : (
          <div className="text-muted-foreground">{empty}</div>
        )}
      </div>
    </div>
  );
}

function Dashboard() {
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [intakeNotice, setIntakeNotice] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [reviewIntakeId, setReviewIntakeId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const queryClient = useQueryClient();
  const asOf = dateOnly(new Date());

  const entitiesQuery = useQuery({
    queryKey: ["entities"],
    queryFn: listEntities,
  });

  useEffect(() => {
    const stored = window.localStorage.getItem(ENTITY_STORAGE_KEY);
    const accessibleIds = new Set((entitiesQuery.data ?? []).map((entity) => entity.id));
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

  const propertiesQuery = useQuery({
    queryKey: ["dashboard-properties", selectedEntityId],
    queryFn: () => listProperties(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });
  const tenantsQuery = useQuery({
    queryKey: ["dashboard-tenants", selectedEntityId],
    queryFn: () => listTenants(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });
  const obligationsQuery = useQuery({
    queryKey: ["dashboard-obligations", selectedEntityId],
    queryFn: () => listObligations({ entity_id: selectedEntityId }),
    enabled: Boolean(selectedEntityId),
  });
  const rentRollQuery = useQuery({
    queryKey: ["dashboard-rent-roll", selectedEntityId, asOf],
    queryFn: () => listRentRoll({ entity_id: selectedEntityId, as_of: asOf }),
    enabled: Boolean(selectedEntityId),
  });
  const onboardingQuery = useQuery({
    queryKey: ["dashboard-onboarding", selectedEntityId],
    queryFn: () => listTenantOnboardings(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });
  const documentIntakesQuery = useQuery({
    queryKey: ["dashboard-document-intakes", selectedEntityId],
    queryFn: () => listDocumentIntakes(selectedEntityId),
    enabled: Boolean(selectedEntityId),
    refetchInterval: (query) =>
      query.state.data?.some(intakeIsActive) ? 2500 : false,
  });

  const documentIntakeMutation = useMutation({
    mutationFn: (file: File) =>
      createDocumentIntake({
        entityId: selectedEntityId,
        file,
      }),
    onMutate: () => {
      setIntakeError(null);
      setIntakeNotice(null);
    },
    onSuccess: (created) => {
      setReviewIntakeId(created.id);
      queryClient.invalidateQueries({
        queryKey: ["dashboard-document-intakes", selectedEntityId],
      });
    },
    onError: (error) => {
      setIntakeError(friendlyError(error));
    },
  });
  const deleteDocumentIntakeMutation = useMutation({
    mutationFn: deleteDocumentIntake,
    onMutate: () => {
      setIntakeError(null);
      setIntakeNotice(null);
    },
    onSuccess: (_data, deletedId) => {
      if (reviewIntakeId === deletedId) {
        setReviewIntakeId(null);
      }
      setIntakeNotice("Removed from review inbox.");
      queryClient.invalidateQueries({
        queryKey: ["dashboard-document-intakes", selectedEntityId],
      });
    },
    onError: (error) => {
      setIntakeError(friendlyError(error));
    },
  });

  const openObligations = useMemo(
    () =>
      [...(obligationsQuery.data ?? [])]
        .filter((item) => !["completed", "waived"].includes(item.status))
        .sort((a, b) => dueRank(a.due_date) - dueRank(b.due_date)),
    [obligationsQuery.data],
  );

  const urgentObligations = openObligations.filter(
    (item) => dueRank(item.due_date) <= 14 || item.priority <= 1,
  );
  const billingIssues = (rentRollQuery.data ?? [])
    .map((row) => ({ row, blockers: blockers(row) }))
    .filter((item) => item.blockers.length > 0);
  const activeOnboardings = (onboardingQuery.data ?? []).filter(
    (item) => item.status === "sent",
  );
  const submittedOnboardings = (onboardingQuery.data ?? []).filter(
    (item) => item.status === "submitted",
  );
  const documentIntakes = documentIntakesQuery.data ?? [];
  const reviewIntakes = documentIntakes.filter((item) => item.status !== "applied");
  const selectedReviewIntake =
    reviewIntakes.find((item) => item.id === reviewIntakeId) ?? reviewIntakes[0] ?? null;
  const needsReviewCount = documentIntakes.filter((item) =>
    ["ready_for_review", "needs_attention"].includes(item.status),
  ).length;
  const failedIntakeCount = documentIntakes.filter((item) => item.status === "failed").length;

  function uploadSmartIntake(file: File | null | undefined) {
    if (!file || !selectedEntityId || documentIntakeMutation.isPending) {
      return;
    }
    documentIntakeMutation.mutate(file);
  }

  const upcomingEvents = [
    ...openObligations.slice(0, 5).map((item) => ({
      id: item.id,
      title: item.title,
      meta: item.category.replaceAll("_", " "),
      date: item.due_date,
      tone: obligationTone(item),
    })),
    ...activeOnboardings.slice(0, 3).map((item) => ({
      id: item.id,
      title: "Tenant onboarding due",
      meta: item.status,
      date: item.due_date,
      tone: "primary" as StatusTone,
    })),
  ].sort((a, b) => dueRank(a.date) - dueRank(b.date));

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
          title={selectedEntity?.name ?? "Dashboard"}
          description="Quick adds, attention items, lease events, and operational updates."
          actions={
            <SecondaryButton
              type="button"
              onClick={() => {
                propertiesQuery.refetch();
                tenantsQuery.refetch();
                obligationsQuery.refetch();
                rentRollQuery.refetch();
                onboardingQuery.refetch();
                documentIntakesQuery.refetch();
              }}
              disabled={!selectedEntityId}
            >
              <RefreshCw size={15} />
              Refresh
            </SecondaryButton>
          }
        />

        {entitiesQuery.error ? (
          <div className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {friendlyError(entitiesQuery.error)}
          </div>
        ) : null}

        <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Link
            href="/properties"
            className="rounded-md border border-border bg-white p-4 transition hover:border-primary/40 hover:shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Properties</span>
              <Building2 size={16} className="text-primary" />
            </div>
            <div className="mt-2 text-2xl font-semibold">
              {propertiesQuery.data?.length ?? 0}
            </div>
          </Link>
          <Link
            href="/tenants"
            className="rounded-md border border-border bg-white p-4 transition hover:border-primary/40 hover:shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Tenants</span>
              <UserRound size={16} className="text-primary" />
            </div>
            <div className="mt-2 text-2xl font-semibold">
              {tenantsQuery.data?.length ?? 0}
            </div>
          </Link>
          <Link
            href="/properties"
            className="rounded-md border border-border bg-white p-4 transition hover:border-primary/40 hover:shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Attention</span>
              <AlertTriangle size={16} className="text-accent" />
            </div>
            <div className="mt-2 text-2xl font-semibold">
              {urgentObligations.length}
            </div>
          </Link>
          <Link
            href="/properties"
            className="rounded-md border border-border bg-white p-4 transition hover:border-primary/40 hover:shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Billing blockers</span>
              <ReceiptText size={16} className="text-primary" />
            </div>
            <div className="mt-2 text-2xl font-semibold">
              {billingIssues.length}
            </div>
          </Link>
          <div className="rounded-md border border-border bg-white p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Needs review</span>
              <Sparkles size={16} className="text-primary" />
            </div>
            <div className="mt-2 text-2xl font-semibold">{needsReviewCount}</div>
          </div>
          <div className="rounded-md border border-border bg-white p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Blocked docs</span>
              <FileText size={16} className="text-accent" />
            </div>
            <div className="mt-2 text-2xl font-semibold">{failedIntakeCount}</div>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[430px_minmax(0,1fr)]">
          <div className="grid gap-5">
            <SectionPanel
              title="Smart intake"
              description="Nothing is applied until you review it."
              icon={<Sparkles size={17} className="text-primary" />}
            >
              <div className="grid gap-4 p-4">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setDragActive(true);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault();
                    setDragActive(false);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragActive(false);
                    uploadSmartIntake(event.dataTransfer.files[0]);
                  }}
                  disabled={!selectedEntityId || documentIntakeMutation.isPending}
                  className={[
                    "grid min-h-32 place-items-center rounded-md border border-dashed p-4 text-center transition",
                    dragActive
                      ? "border-primary bg-primary/5"
                      : "border-border bg-muted/35 hover:border-primary/50 hover:bg-primary/5",
                    !selectedEntityId || documentIntakeMutation.isPending
                      ? "cursor-not-allowed opacity-60"
                      : "",
                  ].join(" ")}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.docx,.txt,.md,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={(event) => {
                      uploadSmartIntake(event.target.files?.[0]);
                      event.currentTarget.value = "";
                    }}
                  />
                  <span className="grid justify-items-center gap-2">
                    {documentIntakeMutation.isPending ? (
                      <Loader2 size={24} className="animate-spin text-primary" />
                    ) : (
                      <FileUp size={24} className="text-primary" />
                    )}
                    <span className="font-semibold">
                      {documentIntakeMutation.isPending
                        ? "Uploading document..."
                        : "Drop a property document here"}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      PDF, Word, Markdown, or text file
                    </span>
                  </span>
                </button>
                {documentIntakeMutation.isPending ? (
                  <div className="rounded-md bg-primary/5 px-3 py-2 text-sm text-primary">
                    Reading document and preparing review.
                  </div>
                ) : null}
                {intakeError ? (
                  <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
                    {intakeError}
                  </div>
                ) : null}
                {intakeNotice ? (
                  <div className="rounded-md bg-primary/5 px-3 py-2 text-sm text-primary">
                    {intakeNotice}
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Link
                    href="/properties"
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-medium transition hover:bg-muted"
                  >
                    <Building2 size={16} />
                    Add property
                  </Link>
                  <Link
                    href="/tenants"
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-medium transition hover:bg-muted"
                  >
                    <UserRound size={16} />
                    Add tenant
                  </Link>
                </div>
                <div className="overflow-hidden rounded-md border border-border">
                  <div className="flex items-center justify-between border-b border-border px-3 py-2">
                    <span className="text-sm font-semibold">Review inbox</span>
                    <StatusBadge tone={needsReviewCount ? "primary" : "neutral"}>
                      {needsReviewCount} waiting
                    </StatusBadge>
                  </div>
                  <div className="divide-y divide-border">
                    {reviewIntakes.slice(0, 5).map((item) => {
                      const propertyName = firstField(
                        item.extracted_data.properties,
                        "name",
                      );
                      const tenantName =
                        firstField(item.extracted_data.parties, "name") ??
                        fieldText(item.extracted_data.suggested_links?.tenant_name);
                      return (
                        <div key={item.id} className="grid gap-2 px-3 py-3 text-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate font-medium">{item.filename}</div>
                              <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                <span>{documentTypeLabel(item.document_type)}</span>
                                <span>{formatDateTime(item.created_at)}</span>
                              </div>
                            </div>
                            <StatusBadge tone={intakeStatusTone(item.status)}>
                              {intakeStatusLabel(item.status)}
                            </StatusBadge>
                          </div>
                          {item.status === "reading" || item.status === "uploaded" ? (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Loader2 size={13} className="animate-spin" />
                              Reading document and preparing review.
                            </div>
                          ) : null}
                          {item.summary ? (
                            <p className="line-clamp-2 text-sm text-muted-foreground">
                              {item.summary}
                            </p>
                          ) : null}
                          <div className="flex flex-wrap gap-2 text-xs">
                            {propertyName ? (
                              <span className="rounded bg-muted px-2 py-1">
                                {propertyName}
                              </span>
                            ) : null}
                            {tenantName ? (
                              <span className="rounded bg-muted px-2 py-1">
                                {tenantName}
                              </span>
                            ) : null}
                            <span className="rounded bg-muted px-2 py-1">
                              {confidenceLabel(item.confidence)}
                            </span>
                          </div>
                          <div className="flex justify-end gap-2">
                            <SecondaryButton
                              type="button"
                              className="h-8"
                              onClick={() => setReviewIntakeId(item.id)}
                            >
                              Review
                            </SecondaryButton>
                            <SecondaryButton
                              type="button"
                              className="h-8"
                              title={
                                intakeIsActive(item)
                                  ? "Stop reviewing and clear"
                                  : "Clear"
                              }
                              onClick={() => deleteDocumentIntakeMutation.mutate(item.id)}
                              disabled={deleteDocumentIntakeMutation.isPending}
                            >
                              <X size={14} />
                              Clear
                            </SecondaryButton>
                          </div>
                        </div>
                      );
                    })}
                    {reviewIntakes.length === 0 ? (
                      <EmptyState
                        title="No documents waiting for review."
                        description="Drop a lease, invoice, guarantee, certificate, or tenant document."
                      />
                    ) : null}
                  </div>
                </div>
                {selectedReviewIntake ? (
                  <SmartReviewSummary
                    intake={selectedReviewIntake}
                    onClear={() =>
                      deleteDocumentIntakeMutation.mutate(selectedReviewIntake.id)
                    }
                    clearing={deleteDocumentIntakeMutation.isPending}
                  />
                ) : null}
              </div>
            </SectionPanel>

            <SectionPanel title="Onboarding">
              <div className="grid gap-3 p-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Waiting on tenants</span>
                  <span className="font-semibold">{activeOnboardings.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Submitted</span>
                  <span className="font-semibold">{submittedOnboardings.length}</span>
                </div>
                <Link
                  href="/properties"
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-medium transition hover:bg-muted"
                >
                  <Link2 size={15} />
                  Manage links
                </Link>
              </div>
            </SectionPanel>
          </div>

          <div className="grid gap-5">
            <SectionPanel
              title="Needs attention"
              icon={<ClipboardList size={17} className="text-primary" />}
            >
              <div className="divide-y divide-border">
                {urgentObligations.slice(0, 6).map((item) => (
                  <Link
                    href="/properties"
                    key={item.id}
                    className="grid gap-2 px-4 py-3 transition hover:bg-muted/60 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{item.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {item.category.replaceAll("_", " ")}
                      </div>
                    </div>
                    <StatusBadge tone={obligationTone(item)}>
                      {dueLabel(item.due_date)}
                    </StatusBadge>
                  </Link>
                ))}
                {urgentObligations.length === 0 ? (
                  <EmptyState title="No urgent dates right now." />
                ) : null}
              </div>
            </SectionPanel>

            <section className="grid gap-5 xl:grid-cols-2">
              <SectionPanel
                title="Events"
                icon={<CalendarClock size={17} className="text-primary" />}
              >
                <div className="divide-y divide-border">
                  {upcomingEvents.slice(0, 8).map((event) => (
                    <Link
                      href="/properties"
                      key={event.id}
                      className="block px-4 py-3 text-sm transition hover:bg-muted/60"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{event.title}</span>
                        <StatusBadge tone={event.tone}>
                          {dueLabel(event.date)}
                        </StatusBadge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {event.meta}
                      </div>
                    </Link>
                  ))}
                  {upcomingEvents.length === 0 ? (
                    <EmptyState title="No upcoming events for this entity." />
                  ) : null}
                </div>
              </SectionPanel>

              <SectionPanel
                title="Billing updates"
                icon={<ReceiptText size={17} className="text-primary" />}
              >
                <div className="divide-y divide-border">
                  {billingIssues.slice(0, 6).map(({ row, blockers: rowBlockers }) => (
                    <Link
                      href="/properties"
                      key={`${row.property_id}-${row.tenancy_unit_id}`}
                      className="block px-4 py-3 text-sm transition hover:bg-muted/60"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {row.unit_label}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {row.property_name} - {row.tenant_name ?? "Vacant"}
                          </div>
                        </div>
                        <span className="text-xs font-medium">
                          {formatMoney(row.charge_rules_total_cents)}
                        </span>
                      </div>
                      <div className="mt-2 rounded bg-accent/10 px-2 py-1 text-xs">
                        {rowBlockers[0]}
                      </div>
                    </Link>
                  ))}
                  {billingIssues.length === 0 ? (
                    <EmptyState title="No billing readiness blockers." />
                  ) : null}
                </div>
              </SectionPanel>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <QueryProvider>
      <Dashboard />
    </QueryProvider>
  );
}
