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
  ExternalLink,
  Inbox,
  Loader2,
  Paperclip,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { QueryProvider } from "@/components/query-provider";
import {
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SecondaryButton,
  Select,
  SectionPanel,
  SkeletonRows,
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
  uploadDocument,
} from "@/lib/api";

const ENTITY_STORAGE_KEY = "leasium.entity_id";

type StatusTone = "neutral" | "success" | "warning" | "danger" | "primary";
type CommsFilter = "all" | CommsKind;

const KIND_LABEL: Record<CommsKind, string> = {
  arrears_reminder: "Arrears reminder",
  insurance_expiry: "Insurance expiry",
  lease_renewal: "Lease renewal",
  inbound_email: "Inbound email",
  inbound_sms: "Inbound SMS",
  compliance_obligation: "Compliance reminder",
  rent_review: "Rent review",
};
const COMMS_KIND_ORDER: CommsKind[] = [
  "arrears_reminder",
  "insurance_expiry",
  "lease_renewal",
  "inbound_email",
  "inbound_sms",
  "compliance_obligation",
  "rent_review",
];

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
const SMS_SINGLE_SEGMENT_GUIDE = 160;

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

  const [selectedFilter, setSelectedFilter] = useState<CommsFilter>("all");
  const candidates = useMemo(
    () => queueQuery.data?.candidates ?? [],
    [queueQuery.data?.candidates],
  );
  const counts = useMemo(() => {
    const tally: Record<CommsKind, number> = {
      arrears_reminder: 0,
      insurance_expiry: 0,
      lease_renewal: 0,
      inbound_email: 0,
      inbound_sms: 0,
      compliance_obligation: 0,
      rent_review: 0,
    };
    for (const candidate of candidates) {
      tally[candidate.kind]++;
    }
    return tally;
  }, [candidates]);
  const visibleFilterKinds = useMemo(
    () => COMMS_KIND_ORDER.filter((kind) => counts[kind] > 0),
    [counts],
  );
  const filteredCandidates = useMemo(
    () =>
      selectedFilter === "all"
        ? candidates
        : candidates.filter((candidate) => candidate.kind === selectedFilter),
    [candidates, selectedFilter],
  );
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
      <div className="mx-auto grid max-w-5xl gap-4 px-5 py-6">
        <PageHeader
          title="Comms queue"
          description="Drafts the platform has staged for your review. Approve to send the email or SMS; dismiss to defer the candidate by seven days."
        />
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Total drafts" value={candidates.length} />
          <Metric label="Urgent" value={urgentCount} tone="danger" />
          <Metric label="Arrears" value={counts.arrears_reminder} />
          <Metric
            label="Insurance + lease"
            value={counts.insurance_expiry + counts.lease_renewal}
          />
        </section>
        {candidates.length ? (
          <div
            className="flex flex-wrap gap-2 rounded-md border border-border bg-white p-2"
            role="tablist"
            aria-label="Filter comms drafts"
          >
            <CommsFilterButton
              active={selectedFilter === "all"}
              label="All drafts"
              count={candidates.length}
              onClick={() => setSelectedFilter("all")}
            />
            {visibleFilterKinds.map((kind) => (
              <CommsFilterButton
                key={kind}
                active={selectedFilter === kind}
                label={KIND_LABEL[kind]}
                count={counts[kind]}
                onClick={() => setSelectedFilter(kind)}
              />
            ))}
          </div>
        ) : null}

        {queueQuery.isLoading ? (
          <SectionPanel>
            <SkeletonRows rows={4} />
          </SectionPanel>
        ) : null}

        {queueQuery.error ? (
          <p className="rounded-md border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
            {friendlyError(queueQuery.error)}
          </p>
        ) : null}

        {!queueQuery.isLoading && candidates.length === 0 && !queueQuery.error ? (
          <EmptyState
            icon={<CheckCircle2 size={18} />}
            title="Inbox zero. No drafts to review."
            description="As arrears age, insurance certificates approach expiry, or leases approach renewal, drafts will appear here for one-click approval."
          />
        ) : null}

        {!queueQuery.isLoading &&
        candidates.length > 0 &&
        filteredCandidates.length === 0 &&
        !queueQuery.error ? (
          <EmptyState
            icon={<Inbox size={18} />}
            title="No drafts in this filter."
            description="Switch back to All drafts to continue reviewing the queue."
          />
        ) : null}

        {filteredCandidates.map((candidate) => (
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

function CommsFilterButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium transition ${
        active
          ? "border-primary bg-primary text-primary-foreground shadow-leasiumXs"
          : "border-border bg-muted/20 text-muted-foreground hover:border-primary/40 hover:text-foreground"
      }`}
    >
      <span>{label}</span>
      <span
        className={`rounded-full px-2 py-0.5 text-leasium-micro font-semibold ${
          active ? "bg-white/20 text-primary-foreground" : "bg-white text-muted-foreground"
        }`}
      >
        {count}
      </span>
    </button>
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
  const channel = candidate.kind === "inbound_sms" ? "sms" : "email";
  const isSms = channel === "sms";
  const [subject, setSubject] = useState(candidate.subject);
  const [body, setBody] = useState(candidate.body);
  const [recipientEmail, setRecipientEmail] = useState(
    candidate.recipient_email ?? "",
  );
  const [recipientPhone, setRecipientPhone] = useState(
    candidate.recipient_phone ?? "",
  );
  const [dispatchedStatus, setDispatchedStatus] = useState<string | null>(null);

  const dispatchMutation = useMutation({
    mutationFn: () =>
      dispatchCommsDraft({
        kind: candidate.kind,
        target_kind: candidate.target_kind,
        target_id: candidate.target_id,
        subject: isSms ? candidate.subject : subject,
        body,
        recipient_email: isSms ? null : recipientEmail || null,
        recipient_phone: isSms ? recipientPhone || null : null,
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
  const providerName = isSms ? "Twilio" : "SendGrid";
  const recipientReady = isSms
    ? Boolean(recipientPhone.trim())
    : Boolean(recipientEmail.trim());
  const smsBodyLength = body.length;
  const smsBodyOverGuide = smsBodyLength > SMS_SINGLE_SEGMENT_GUIDE;

  // Evidence-attach lives on compliance obligations only. Smart Intake is
  // the recommended path (AI extracts metadata + attributes the document);
  // the manual file picker is a last-resort fallback so operators don't
  // need to navigate elsewhere mid-flow. Backend v1 lands the upload in
  // StoredDocument keyed to entity + tenant; v2 plumbs back-attribution
  // into obligation_metadata.
  const showEvidencePanel = candidate.kind === "compliance_obligation";
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [evidenceFilename, setEvidenceFilename] = useState<string | null>(null);
  const evidenceMutation = useMutation({
    mutationFn: (file: File) =>
      uploadDocument({
        entityId,
        tenantId: candidate.tenant_id ?? undefined,
        category: "other",
        notes: `Compliance evidence for "${candidate.subject}"`,
        file,
      }),
    onSuccess: (record) => {
      setEvidenceFilename(record.filename);
    },
  });
  const evidenceError = evidenceMutation.error as Error | null;

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
          <div className="flex items-center gap-2 rounded-md border border-success-strong/30 bg-success-soft px-3 py-2 text-sm text-success-strong">
            <CheckCircle2 size={16} />
            Sent — status <strong>{dispatchedStatus}</strong>.
            {dispatchedStatus === "skipped" ? (
              <span className="text-xs">
                {" "}
                {isSms
                  ? "Twilio Messaging is not configured yet, so the SMS was skipped. Wire the Twilio settings to enable."
                  : "SendGrid is not configured yet, so the email was skipped. Wire SENDGRID_API_KEY to enable."}
              </span>
            ) : null}
          </div>
        ) : null}

        <div
          className={
            isSms ? "grid gap-3 md:grid-cols-[220px]" : "grid gap-3 md:grid-cols-[1fr_220px]"
          }
        >
          {!isSms ? (
            <Field label="Subject">
              <Input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
              />
            </Field>
          ) : null}
          <Field label="Recipient">
            <Input
              type={isSms ? "tel" : "email"}
              value={isSms ? recipientPhone : recipientEmail}
              onChange={(event) => {
                if (isSms) {
                  setRecipientPhone(event.target.value);
                } else {
                  setRecipientEmail(event.target.value);
                }
              }}
              placeholder={isSms ? "+61400111222" : "tenant@example.com"}
            />
          </Field>
        </div>

        <Field label="Body">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            className="min-h-[180px] w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none transition-colors duration-200 ease-leasium focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15"
          />
        </Field>
        {isSms ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <div>
              <span className="font-medium text-foreground">
                SMS body review
              </span>{" "}
              {smsBodyOverGuide
                ? "May split into multiple SMS segments."
                : "Under the 160-character single SMS guide."}
            </div>
            <StatusBadge tone={smsBodyOverGuide ? "warning" : "success"}>
              {smsBodyLength}/{SMS_SINGLE_SEGMENT_GUIDE} chars
            </StatusBadge>
          </div>
        ) : null}

        {showEvidencePanel ? (
          <div className="grid gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <Paperclip size={15} className="text-primary" />
              Attach evidence
            </div>
            <p className="text-xs text-muted-foreground">
              The recommended path: drop the document into Smart Intake so the
              AI extracts the insurer / certificate detail and the file is
              attributed automatically. The manual fallback below is for one-off
              attachments only.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/intake"
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-primary/30 bg-primary px-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary-hover"
              >
                <Sparkles size={15} />
                Upload via Smart Intake
                <ExternalLink size={13} />
              </Link>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    evidenceMutation.mutate(file);
                  }
                  // Reset so the same filename can be re-picked.
                  event.target.value = "";
                }}
              />
              <SecondaryButton
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={evidenceMutation.isPending}
              >
                {evidenceMutation.isPending ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Paperclip size={15} />
                )}
                {evidenceMutation.isPending
                  ? "Uploading…"
                  : "Or attach a file manually"}
              </SecondaryButton>
            </div>
            {evidenceFilename ? (
              <p className="text-xs text-success-strong">
                Uploaded {evidenceFilename}. The file is stored against the
                tenant; finish review in Smart Intake to formally link it to
                this compliance obligation.
              </p>
            ) : null}
            {evidenceError ? (
              <p className="text-xs text-danger">
                {friendlyError(evidenceError)}
              </p>
            ) : null}
          </div>
        ) : null}

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
            Approve sends the {isSms ? "SMS" : "email"} through {providerName}.
            {isSms
              ? " Edit body or recipient before approving."
              : " Edit subject, body, or recipient before approving."}
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
                (!isSms && !subject.trim()) ||
                !body.trim() ||
                !recipientReady
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
