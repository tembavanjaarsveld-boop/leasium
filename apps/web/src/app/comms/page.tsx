"use client";

/**
 * /comms — Scheduled comms queue.
 *
 * Foundation surface from docs/automation-strategy-2026-05-23.md. The
 * operator's working list of draft communications: arrears reminders,
 * insurance expiry chase, lease renewal openers. The AI / templates draft;
 * the operator reviews, edits inline, and clicks Approve. Approve fires
 * the SendGrid pipe through /api/v1/comms/dispatch — the click is the
 * explicit operator approval under the provider-mutation guardrail.
 *
 * Dismiss records the operator's deferral so the candidate doesn't
 * re-appear in the queue until the deferred-until date.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Inbox,
  Loader2,
  Send,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { QueryProvider } from "@/components/query-provider";
import {
  Button,
  EmptyState,
  Field,
  Input,
  SecondaryButton,
  Select,
  SectionPanel,
  StatusBadge,
} from "@/components/ui";
import {
  type CommsCandidateRecord,
  type CommsKind,
  type CommsSeverity,
  dismissCommsCandidate,
  dispatchCommsDraft,
  getCommsQueue,
  listEntities,
} from "@/lib/api";

const ENTITY_STORAGE_KEY = "leasium.entity_id";

type StatusTone = "neutral" | "success" | "warning" | "danger" | "primary";

const KIND_LABEL: Record<CommsKind, string> = {
  arrears_reminder: "Arrears reminder",
  insurance_expiry: "Insurance expiry",
  lease_renewal: "Lease renewal",
};

const SEVERITY_TONE: Record<CommsSeverity, StatusTone> = {
  info: "neutral",
  warning: "warning",
  danger: "danger",
};

const SEVERITY_LABEL: Record<CommsSeverity, string> = {
  info: "Heads up",
  warning: "Due soon",
  danger: "Urgent",
};

function friendlyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

export default function CommsPage() {
  return (
    <QueryProvider>
      <CommsContent />
    </QueryProvider>
  );
}

function CommsContent() {
  const queryClient = useQueryClient();
  const entitiesQuery = useQuery({
    queryKey: ["entities"],
    queryFn: listEntities,
  });

  const [selectedEntityId, setSelectedEntityId] = useState("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(ENTITY_STORAGE_KEY);
    if (stored) setSelectedEntityId(stored);
  }, []);
  useEffect(() => {
    if (!selectedEntityId) return;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ENTITY_STORAGE_KEY, selectedEntityId);
  }, [selectedEntityId]);
  useEffect(() => {
    if (selectedEntityId) return;
    const first = entitiesQuery.data?.[0]?.id;
    if (first) setSelectedEntityId(first);
  }, [entitiesQuery.data, selectedEntityId]);

  const queueQuery = useQuery({
    queryKey: ["comms-queue", selectedEntityId],
    queryFn: () => getCommsQueue(selectedEntityId),
    enabled: Boolean(selectedEntityId),
  });

  const candidates = useMemo(
    () => queueQuery.data?.candidates ?? [],
    [queueQuery.data?.candidates],
  );
  const counts = useMemo(() => {
    const tally: Record<CommsKind, number> = {
      arrears_reminder: 0,
      insurance_expiry: 0,
      lease_renewal: 0,
    };
    for (const candidate of candidates) {
      tally[candidate.kind]++;
    }
    return tally;
  }, [candidates]);
  const urgentCount = useMemo(
    () => candidates.filter((c) => c.severity === "danger").length,
    [candidates],
  );

  return (
    <main className="min-h-screen">
      <AppHeader>
        <Select
          value={selectedEntityId}
          onChange={(event) => setSelectedEntityId(event.target.value)}
          aria-label="Select entity"
        >
          <option value="" disabled>
            Select an entity
          </option>
          {(entitiesQuery.data ?? []).map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))}
        </Select>
      </AppHeader>
      <div className="mx-auto max-w-5xl px-5 pt-6">
        <h1 className="text-2xl font-semibold">Comms queue</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Drafts the platform has staged for your review. Approve to send the
          email; dismiss to defer the candidate by seven days.
        </p>
      </div>

      <div className="mx-auto grid max-w-5xl gap-4 px-5 py-6">
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Total drafts" value={candidates.length} />
          <Metric label="Urgent" value={urgentCount} tone="danger" />
          <Metric label="Arrears" value={counts.arrears_reminder} />
          <Metric
            label="Insurance + lease"
            value={counts.insurance_expiry + counts.lease_renewal}
          />
        </section>

        {queueQuery.isLoading ? (
          <EmptyState title="Loading queue." />
        ) : null}

        {queueQuery.error ? (
          <p className="rounded-md border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
            {friendlyError(queueQuery.error)}
          </p>
        ) : null}

        {!queueQuery.isLoading && candidates.length === 0 && !queueQuery.error ? (
          <EmptyState
            title="Inbox zero. No drafts to review."
            description="As arrears age, insurance certificates approach expiry, or leases approach renewal, drafts will appear here for one-click approval."
          />
        ) : null}

        {candidates.map((candidate) => (
          <CandidateCard
            key={candidate.id}
            candidate={candidate}
            entityId={selectedEntityId}
            onSettled={() => {
              queryClient.invalidateQueries({
                queryKey: ["comms-queue", selectedEntityId],
              });
            }}
          />
        ))}
      </div>
    </main>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "danger";
}) {
  return (
    <div className="rounded-md border border-border bg-white p-4">
      <div
        className={
          tone === "danger" && value > 0
            ? "text-2xl font-semibold text-danger"
            : "text-2xl font-semibold"
        }
      >
        {value}
      </div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

function CandidateCard({
  candidate,
  entityId,
  onSettled,
}: {
  candidate: CommsCandidateRecord;
  entityId: string;
  onSettled: () => void;
}) {
  const [subject, setSubject] = useState(candidate.subject);
  const [body, setBody] = useState(candidate.body);
  const [recipient, setRecipient] = useState(candidate.recipient_email ?? "");
  const [dispatchedStatus, setDispatchedStatus] = useState<string | null>(null);

  const dispatchMutation = useMutation({
    mutationFn: () =>
      dispatchCommsDraft({
        kind: candidate.kind,
        target_kind: candidate.target_kind,
        target_id: candidate.target_id,
        subject,
        body,
        recipient_email: recipient || null,
      }),
    onSuccess: (result) => {
      setDispatchedStatus(result.status);
      onSettled();
    },
  });

  const dismissMutation = useMutation({
    mutationFn: () =>
      dismissCommsCandidate({
        kind: candidate.kind,
        target_kind: candidate.target_kind,
        target_id: candidate.target_id,
      }),
    onSuccess: () => {
      onSettled();
    },
  });

  const dispatchError = dispatchMutation.error as Error | null;
  const dismissError = dismissMutation.error as Error | null;
  const tone = SEVERITY_TONE[candidate.severity];

  return (
    <SectionPanel
      title={KIND_LABEL[candidate.kind]}
      description={[
        candidate.tenant_name,
        candidate.property_name,
        candidate.unit_label,
      ]
        .filter(Boolean)
        .join(" · ")}
      icon={<Inbox size={17} />}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={tone}>{SEVERITY_LABEL[candidate.severity]}</StatusBadge>
          {candidate.detail ? (
            <span className="text-xs text-muted-foreground">{candidate.detail}</span>
          ) : null}
        </div>
      }
    >
      <div className="grid gap-3 p-4">
        {dispatchedStatus ? (
          <div className="flex items-center gap-2 rounded-md border border-leasium-success-strong/30 bg-leasium-success-soft px-3 py-2 text-sm text-[#027A48]">
            <CheckCircle2 size={16} />
            Sent — status <strong>{dispatchedStatus}</strong>.
            {dispatchedStatus === "skipped" ? (
              <span className="text-xs">
                {" "}
                SendGrid is not configured yet, so the send was skipped. Wire
                SENDGRID_API_KEY to enable.
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-[1fr_220px]">
          <Field label="Subject">
            <Input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
          </Field>
          <Field label="Recipient">
            <Input
              type="email"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="tenant@example.com"
            />
          </Field>
        </div>

        <Field label="Body">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            className="min-h-[180px] w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none transition duration-200 ease-leasium focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
        </Field>

        {dispatchError ? (
          <p className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
            <AlertTriangle size={16} />
            {friendlyError(dispatchError)}
          </p>
        ) : null}
        {dismissError ? (
          <p className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
            <AlertTriangle size={16} />
            {friendlyError(dismissError)}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Approve sends the email through SendGrid. Edit subject, body, or
            recipient before approving.
          </p>
          <div className="flex flex-wrap gap-2">
            <SecondaryButton
              type="button"
              onClick={() => dismissMutation.mutate()}
              disabled={
                dismissMutation.isPending ||
                Boolean(dispatchedStatus)
              }
            >
              <X size={15} />
              Dismiss
            </SecondaryButton>
            <Button
              type="button"
              onClick={() => dispatchMutation.mutate()}
              disabled={
                dispatchMutation.isPending ||
                Boolean(dispatchedStatus) ||
                !subject.trim() ||
                !body.trim() ||
                !recipient.trim()
              }
            >
              {dispatchMutation.isPending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Send size={16} />
              )}
              {dispatchMutation.isPending ? "Sending…" : "Approve & send"}
            </Button>
          </div>
        </div>
      </div>
    </SectionPanel>
  );
}

CommsPage.displayName = "CommsPage";
