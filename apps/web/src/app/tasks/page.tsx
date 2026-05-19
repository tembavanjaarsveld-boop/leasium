"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ClipboardList,
  Clock3,
  MailCheck,
  RefreshCw,
  Sparkles,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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
  DocumentIntakeRecord,
  listEntities,
  listDocumentIntakes,
  listObligations,
  listTenantOnboardings,
  ObligationRecord,
  TenantOnboardingRecord,
  updateObligation,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const ENTITY_STORAGE_KEY = "leasium.entity_id";

type TaskTone = "neutral" | "success" | "warning" | "danger" | "primary";
type TaskFilter =
  | "all"
  | "overdue"
  | "soon"
  | "intake"
  | "waiting"
  | "submitted"
  | "done";

type WorkTask =
  | {
      id: string;
      kind: "obligation";
      title: string;
      description: string;
      dueDate: string | null;
      tone: TaskTone;
      chip: string;
      href: string;
      record: ObligationRecord;
      completed: boolean;
    }
  | {
      id: string;
      kind: "onboarding";
      title: string;
      description: string;
      dueDate: string | null;
      tone: TaskTone;
      chip: string;
      href: string;
      record: TenantOnboardingRecord;
      completed: boolean;
    }
  | {
      id: string;
      kind: "document_intake";
      title: string;
      description: string;
      dueDate: string | null;
      tone: TaskTone;
      chip: string;
      href: string;
      record: DocumentIntakeRecord;
      completed: boolean;
    };

const filters: Array<{ key: TaskFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "overdue", label: "Overdue" },
  { key: "soon", label: "Due soon" },
  { key: "intake", label: "Smart Intake" },
  { key: "waiting", label: "Waiting on tenant" },
  { key: "submitted", label: "Submitted" },
  { key: "done", label: "Done" },
];

function friendlyError(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function dateOnly(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
  if (!value) {
    return "No date";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "No date";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function categoryLabel(value: string) {
  return value.replaceAll("_", " ");
}

function documentTypeLabel(value: string | null | undefined) {
  return value ? value.replaceAll("_", " ") : "document";
}

function obligationTone(obligation: ObligationRecord): TaskTone {
  const days = dueRank(obligation.due_date);
  if (["completed", "waived"].includes(obligation.status)) {
    return "success";
  }
  if (days < 0) {
    return "danger";
  }
  if (days <= 14 || obligation.priority <= 1) {
    return "warning";
  }
  return "neutral";
}

function onboardingTone(onboarding: TenantOnboardingRecord): TaskTone {
  if (["applied", "reviewed", "cancelled"].includes(onboarding.status)) {
    return "success";
  }
  if (onboarding.status === "submitted") {
    return "primary";
  }
  if (dueRank(onboarding.due_date) < 0) {
    return "danger";
  }
  if (dueRank(onboarding.due_date) <= 7) {
    return "warning";
  }
  return "neutral";
}

function intakeIsOpen(intake: DocumentIntakeRecord) {
  return ["uploaded", "reading", "ready_for_review", "needs_attention", "failed"].includes(
    intake.status,
  );
}

function intakeTone(intake: DocumentIntakeRecord): TaskTone {
  if (intake.status === "failed") {
    return "danger";
  }
  if (intake.status === "needs_attention") {
    return "warning";
  }
  if (intake.status === "ready_for_review") {
    return "primary";
  }
  return "neutral";
}

function intakeChip(intake: DocumentIntakeRecord) {
  switch (intake.status) {
    case "failed":
      return "Could not read";
    case "needs_attention":
      return "Needs match";
    case "ready_for_review":
      return "Needs review";
    case "reading":
      return "Reading";
    default:
      return "Processing";
  }
}

function intakeTitle(intake: DocumentIntakeRecord) {
  switch (intake.status) {
    case "failed":
      return "Document could not be read";
    case "needs_attention":
      return "Document needs match";
    case "ready_for_review":
      return "Document waiting for review";
    default:
      return "Document still processing";
  }
}

function intakeDescription(intake: DocumentIntakeRecord) {
  return [
    `Smart Intake - ${documentTypeLabel(intake.document_type)}`,
    intake.filename,
    intake.summary,
  ]
    .filter(Boolean)
    .join(" - ");
}

function obligationDescription(obligation: ObligationRecord) {
  return [
    categoryLabel(obligation.category),
    obligation.owner_role ? `Owner: ${obligation.owner_role}` : null,
    obligation.notes,
  ]
    .filter(Boolean)
    .join(" - ");
}

function buildTasks(
  obligations: ObligationRecord[],
  onboardings: TenantOnboardingRecord[],
  documentIntakes: DocumentIntakeRecord[],
): WorkTask[] {
  const obligationTasks: WorkTask[] = obligations.map((obligation) => ({
    id: `obligation-${obligation.id}`,
    kind: "obligation",
    title: obligation.title,
    description: obligationDescription(obligation),
    dueDate: obligation.due_date,
    tone: obligationTone(obligation),
    chip: ["completed", "waived"].includes(obligation.status)
      ? obligation.status
      : dueLabel(obligation.due_date),
    href: "/properties",
    record: obligation,
    completed: ["completed", "waived"].includes(obligation.status),
  }));

  const onboardingTasks: WorkTask[] = onboardings
    .filter((onboarding) => onboarding.status !== "cancelled")
    .map((onboarding) => {
      const submitted = onboarding.status === "submitted";
      return {
        id: `onboarding-${onboarding.id}`,
        kind: "onboarding",
        title: submitted ? "Tenant onboarding submitted" : "Tenant onboarding follow-up",
        description: submitted
          ? "Review submitted tenant details and documents."
          : "Waiting on tenant onboarding response.",
        dueDate: onboarding.due_date,
        tone: onboardingTone(onboarding),
        chip: submitted ? "Needs review" : dueLabel(onboarding.due_date),
        href: "/tenants",
        record: onboarding,
        completed: ["applied", "reviewed"].includes(onboarding.status),
      } satisfies WorkTask;
    });

  const intakeTasks: WorkTask[] = documentIntakes
    .filter(intakeIsOpen)
    .map((intake) => ({
      id: `document-intake-${intake.id}`,
      kind: "document_intake",
      title: intakeTitle(intake),
      description: intakeDescription(intake),
      dueDate: intake.created_at,
      tone: intakeTone(intake),
      chip: intakeChip(intake),
      href: `/intake?review=${intake.id}`,
      record: intake,
      completed: false,
    }));

  return [...obligationTasks, ...onboardingTasks, ...intakeTasks].sort((a, b) => {
    if (a.completed !== b.completed) {
      return a.completed ? 1 : -1;
    }
    return taskSortRank(a) - taskSortRank(b);
  });
}

function taskSortRank(task: WorkTask) {
  if (task.kind === "document_intake") {
    if (task.record.status === "failed") {
      return -30;
    }
    if (task.record.status === "needs_attention") {
      return -20;
    }
    if (task.record.status === "ready_for_review") {
      return 5;
    }
    return 20;
  }
  return dueRank(task.dueDate);
}

function taskKindLabel(task: WorkTask) {
  if (task.kind === "onboarding") {
    return "Onboarding";
  }
  if (task.kind === "document_intake") {
    return "Smart Intake";
  }
  return "Lease date";
}

function taskKindTone(task: WorkTask): TaskTone {
  if (task.kind === "document_intake") {
    return "primary";
  }
  return task.kind === "onboarding" ? "primary" : "neutral";
}

function taskDateLabel(task: WorkTask) {
  if (task.kind === "document_intake") {
    return formatDateTime(task.dueDate);
  }
  return dueLabel(task.dueDate);
}

function taskMatchesFilter(task: WorkTask, filter: TaskFilter) {
  if (filter === "all") {
    return !task.completed;
  }
  if (filter === "overdue") {
    return !task.completed && task.kind !== "document_intake" && dueRank(task.dueDate) < 0;
  }
  if (filter === "soon") {
    return (
      !task.completed &&
      task.kind !== "document_intake" &&
      dueRank(task.dueDate) >= 0 &&
      dueRank(task.dueDate) <= 7
    );
  }
  if (filter === "intake") {
    return !task.completed && task.kind === "document_intake";
  }
  if (filter === "waiting") {
    return (
      !task.completed &&
      task.kind === "onboarding" &&
      task.record.status === "sent"
    );
  }
  if (filter === "submitted") {
    return (
      !task.completed &&
      task.kind === "onboarding" &&
      task.record.status === "submitted"
    );
  }
  return task.completed;
}

function TasksWorkspace() {
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [filter, setFilter] = useState<TaskFilter>("all");
  const queryClient = useQueryClient();

  const entitiesQuery = useQuery({
    queryKey: ["tasks-entities"],
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

  const obligationsQuery = useQuery({
    queryKey: ["tasks-obligations", selectedEntityId],
    queryFn: () => listObligations({ entity_id: selectedEntityId }),
    enabled: Boolean(selectedEntityId),
  });

  const onboardingQuery = useQuery({
    queryKey: ["tasks-onboarding", selectedEntityId],
    queryFn: () => listTenantOnboardings(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });

  const documentIntakesQuery = useQuery({
    queryKey: ["tasks-document-intakes", selectedEntityId],
    queryFn: () => listDocumentIntakes(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });
  const entitySelectionLoading =
    entitiesQuery.isLoading ||
    (!selectedEntityId && (entitiesQuery.data?.length ?? 0) > 0);
  const tasksLoading =
    entitySelectionLoading ||
    (Boolean(selectedEntityId) &&
      (obligationsQuery.isLoading ||
        onboardingQuery.isLoading ||
        documentIntakesQuery.isLoading));

  const updateMutation = useMutation({
    mutationFn: (payload: { obligation: ObligationRecord; status: "completed" | "waived" }) =>
      updateObligation(payload.obligation.id, {
        entity_id: payload.obligation.entity_id,
        property_id: payload.obligation.property_id,
        tenancy_unit_id: payload.obligation.tenancy_unit_id,
        lease_id: payload.obligation.lease_id,
        title: payload.obligation.title,
        category: payload.obligation.category,
        status: payload.status,
        due_date: payload.obligation.due_date,
        priority: payload.obligation.priority,
        owner_role: payload.obligation.owner_role,
        notes: payload.obligation.notes,
        metadata: payload.obligation.metadata,
        completed_at: payload.status === "completed" ? new Date().toISOString() : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["tasks-obligations", selectedEntityId],
      });
    },
  });

  const tasks = useMemo(
    () =>
      buildTasks(
        obligationsQuery.data ?? [],
        onboardingQuery.data ?? [],
        documentIntakesQuery.data ?? [],
      ),
    [documentIntakesQuery.data, obligationsQuery.data, onboardingQuery.data],
  );

  const visibleTasks = tasks.filter((task) => taskMatchesFilter(task, filter));
  const openTasks = tasks.filter((task) => !task.completed);
  const overdueTasks = openTasks.filter((task) => dueRank(task.dueDate) < 0);
  const dueSoonTasks = openTasks.filter(
    (task) => dueRank(task.dueDate) >= 0 && dueRank(task.dueDate) <= 7,
  );
  const waitingOnTenantTasks = openTasks.filter(
    (task) => task.kind === "onboarding" && task.record.status === "sent",
  );
  const submittedTasks = openTasks.filter(
    (task) => task.kind === "onboarding" && task.record.status === "submitted",
  );
  const smartIntakeTasks = openTasks.filter(
    (task) => task.kind === "document_intake",
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
          title="Tasks"
          description="Prioritise approvals, date checks, tenant follow-ups, and operational exceptions."
          actions={
            <SecondaryButton
              type="button"
              onClick={() => {
                obligationsQuery.refetch();
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
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {friendlyError(entitiesQuery.error)}
          </div>
        ) : null}
        {obligationsQuery.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {friendlyError(obligationsQuery.error)}
          </div>
        ) : null}
        {onboardingQuery.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {friendlyError(onboardingQuery.error)}
          </div>
        ) : null}
        {documentIntakesQuery.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {friendlyError(documentIntakesQuery.error)}
          </div>
        ) : null}
        {updateMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {friendlyError(updateMutation.error)}
          </div>
        ) : null}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-2xl border border-border bg-white p-4 shadow-leasiumXs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-muted-foreground">Overdue</span>
              <AlertTriangle size={17} className="text-primary" />
            </div>
            <div className="mt-3 text-3xl font-semibold">
              {tasksLoading ? "..." : overdueTasks.length}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Items already past their target date.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-white p-4 shadow-leasiumXs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-muted-foreground">Due this week</span>
              <Clock3 size={17} className="text-primary" />
            </div>
            <div className="mt-3 text-3xl font-semibold">
              {tasksLoading ? "..." : dueSoonTasks.length}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Work that needs attention before the week gets away.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-white p-4 shadow-leasiumXs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-muted-foreground">Waiting on tenant</span>
              <UserRound size={17} className="text-primary" />
            </div>
            <div className="mt-3 text-3xl font-semibold">
              {tasksLoading ? "..." : waitingOnTenantTasks.length}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Sent onboarding links still awaiting response.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-white p-4 shadow-leasiumXs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-muted-foreground">Submitted</span>
              <MailCheck size={17} className="text-primary" />
            </div>
            <div className="mt-3 text-3xl font-semibold">
              {tasksLoading ? "..." : submittedTasks.length}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Tenant submissions ready for internal review.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-white p-4 shadow-leasiumXs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-muted-foreground">Smart Intake</span>
              <Sparkles size={17} className="text-primary" />
            </div>
            <div className="mt-3 text-3xl font-semibold">
              {tasksLoading ? "..." : smartIntakeTasks.length}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Documents waiting for review, match, or recovery.
            </p>
          </div>
        </section>

        <SectionPanel
          title="Work queue"
          description={selectedEntity ? selectedEntity.name : "Select an entity to see work."}
          icon={<Clock3 size={17} className="text-primary" />}
          actions={
            <div className="flex flex-wrap gap-1">
              {filters.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setFilter(item.key)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                    filter === item.key
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          }
        >
          <div className="divide-y divide-border">
            {tasksLoading ? (
              <EmptyState title="Loading work queue." />
            ) : null}
            {visibleTasks.map((task) => (
              <div
                key={task.id}
                className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
              >
                <Link href={task.href} className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{task.title}</span>
                    <StatusBadge tone={task.tone}>{task.chip}</StatusBadge>
                    <StatusBadge tone={taskKindTone(task)}>
                      {taskKindLabel(task)}
                    </StatusBadge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>
                </Link>
                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <StatusBadge tone={task.tone}>{taskDateLabel(task)}</StatusBadge>
                  {task.kind === "obligation" && !task.completed ? (
                    <>
                      <SecondaryButton
                        type="button"
                        className="h-9 px-3"
                        onClick={() =>
                          updateMutation.mutate({
                            obligation: task.record,
                            status: "completed",
                          })
                        }
                        disabled={updateMutation.isPending}
                      >
                        <CheckCircle2 size={15} className="text-leasium-success" />
                        Complete
                      </SecondaryButton>
                      <SecondaryButton
                        type="button"
                        className="h-9 px-3"
                        onClick={() =>
                          updateMutation.mutate({
                            obligation: task.record,
                            status: "waived",
                          })
                        }
                        disabled={updateMutation.isPending}
                      >
                        <Ban size={15} className="text-danger" />
                        Waive
                      </SecondaryButton>
                    </>
                  ) : null}
                  {task.kind === "onboarding" ? (
                    <Link
                      href="/tenants"
                      className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
                    >
                      <MailCheck size={15} />
                      Open tenants
                    </Link>
                  ) : null}
                  {task.kind === "document_intake" ? (
                    <Link
                      href={task.href}
                      className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
                    >
                      <Sparkles size={15} />
                      Review in Smart Intake
                    </Link>
                  ) : null}
                </div>
              </div>
            ))}
            {!tasksLoading && visibleTasks.length === 0 ? (
              <EmptyState
                title={
                  filter === "intake"
                    ? "No documents waiting for review"
                    : selectedEntityId
                    ? "No open tasks"
                    : "Select an entity to see tasks."
                }
                description={
                  filter === "intake"
                    ? "Reviewed documents and applied work will move into the right workspace automatically."
                    : selectedEntityId
                    ? "Leasium will surface rent reviews, expiries, onboarding follow-ups, and document-driven obligations here."
                    : "Choose an entity from the top right to load the work queue."
                }
                action={
                  selectedEntityId ? (
                    <div className="flex flex-wrap justify-center gap-2">
                      {filter === "intake" ? null : (
                        <Link
                          href="/properties"
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
                        >
                          <ClipboardList size={15} />
                          Add critical date
                        </Link>
                      )}
                      <Link
                        href="/intake"
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
                      >
                        <Sparkles size={15} />
                        Open Smart Intake
                      </Link>
                    </div>
                  ) : null
                }
              />
            ) : null}
          </div>
        </SectionPanel>
      </div>
    </main>
  );
}

export default function TasksPage() {
  return (
    <QueryProvider>
      <TasksWorkspace />
    </QueryProvider>
  );
}
