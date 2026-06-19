"use client";

import {
  CalendarClock,
  FileText,
  Loader2,
  Mail,
  Paperclip,
  ShieldCheck,
  Sparkles,
  UserCog,
  UserRound,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { Button, StatusBadge } from "@/components/ui";
import { friendlyError } from "@/lib/utils";
import {
  appendConversationTurn,
  createConversationThread,
  listTenants,
  promoteInboxMessage,
  type CommsInboundMessageDetailRecord,
  type ConversationThreadRecord,
  type InboxPromoteKind,
  type InboxPromoteRecord,
  type InboxTriageKind,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// Token-driven primitives — mirror IntakeConversationPanel exactly so the
// inbox review reads identically. Teal = accent (source-backed /
// guardrail). Blue = primary (plan border, one CTA). Info-soft = user bubble.
// ---------------------------------------------------------------------------

function AiTurn({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span
        aria-hidden
        className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-accent-soft text-leasium-teal-strong"
      >
        <Sparkles size={16} />
      </span>
      <div className="min-w-0 flex-1 space-y-3">{children}</div>
    </div>
  );
}

function UserTurn({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-info-soft px-4 py-3 text-sm leading-5 text-foreground">
        {children}
      </div>
    </div>
  );
}

function Prose({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-6 text-foreground">{children}</p>;
}

type ConfidenceLevel = "high" | "med" | "low";

function confidenceLevel(value: number | null | undefined): ConfidenceLevel {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 0.8) return "high";
    if (value >= 0.5) return "med";
    return "low";
  }
  return "med";
}

function ConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  const tone = level === "high" ? "success" : level === "med" ? "warning" : "danger";
  const label = level === "high" ? "HIGH" : level === "med" ? "MED" : "LOW";
  return (
    <StatusBadge tone={tone} className="text-leasium-micro">
      {label}
    </StatusBadge>
  );
}

function GuardrailNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl bg-accent-soft px-3 py-2 text-xs leading-5 text-leasium-teal-strong">
      <ShieldCheck size={14} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

const GUARDRAIL =
  "This creates a local draft only — I won't send an email or SMS reply, or post to Xero, unless you ask.";

function promotedHref(promoted: InboxPromoteRecord) {
  if (promoted.target_kind === "tenant" && promoted.target_id) {
    return `/tenants/${encodeURIComponent(promoted.target_id)}`;
  }
  return promoted.target_href;
}

// ---------------------------------------------------------------------------
// Classification → display + plan helpers.
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<InboxTriageKind, string> = {
  maintenance_request: "Maintenance request",
  payment_or_arrears: "Payment / arrears",
  lease_change: "Lease change",
  tenant_contact: "Tenant contact",
  vendor_or_contractor: "Vendor / contractor",
  property_update: "Property update",
  compliance_or_insurance: "Compliance / insurance",
  task_or_reminder: "Task or reminder",
  owner_or_entity_admin: "Owner / entity admin",
  general: "General enquiry",
  spam_or_noise: "Spam or noise",
};

function isInboxTriageKind(value: string | null): value is InboxTriageKind {
  return value !== null && value in KIND_LABEL;
}

// A plan describes the single bundled next step. `promoteKind` null = nothing
// to create (general / spam, or a kind that still needs a tenant). `needsTenant`
// gates the primary when the message has no attributed tenant.
type Plan = {
  action: string;
  icon: ReactNode;
  promoteKind: InboxPromoteKind | null;
  needsTenant: boolean;
  note: string | null;
};

function planForKind(kind: InboxTriageKind): Plan {
  switch (kind) {
    case "maintenance_request":
      return {
        action: "Create a maintenance work order",
        icon: <Wrench size={16} />,
        promoteKind: "maintenance_request",
        needsTenant: false,
        note: null,
      };
    case "task_or_reminder":
      return {
        action: "Create an Operations task",
        icon: <Wrench size={16} />,
        promoteKind: "task_or_reminder",
        needsTenant: false,
        note: null,
      };
    case "payment_or_arrears":
      return {
        action: "Open an arrears case",
        icon: <CalendarClock size={16} />,
        promoteKind: "payment_or_arrears",
        needsTenant: true,
        note: "An arrears case needs a tenant. Attribute this email to a tenant before promoting.",
      };
    case "tenant_contact":
      return {
        action: "Update the tenant's contact details",
        icon: <UserRound size={16} />,
        promoteKind: "tenant_contact",
        needsTenant: true,
        note: "Updating contact details needs a tenant. Attribute this email to a tenant before promoting.",
      };
    case "vendor_or_contractor":
      return {
        action: "Add / link the contractor",
        icon: <UserCog size={16} />,
        promoteKind: "vendor_or_contractor",
        needsTenant: false,
        note: null,
      };
    case "lease_change":
    case "property_update":
    case "compliance_or_insurance":
    case "owner_or_entity_admin":
      return {
        action: "Open a Smart Intake review",
        icon: <FileText size={16} />,
        promoteKind: kind,
        needsTenant: false,
        note: null,
      };
    case "general":
    case "spam_or_noise":
      return {
        action: "Nothing to create — file or discard",
        icon: <Mail size={16} />,
        promoteKind: null,
        needsTenant: false,
        note: null,
      };
  }
}

type UnderstandingRow = { label: string; value: string };

// ---------------------------------------------------------------------------

export function InboxConversationPanel({
  entityId,
  message,
  onPromoted,
}: {
  entityId: string;
  message: CommsInboundMessageDetailRecord;
  onPromoted?: (record: InboxPromoteRecord) => void;
}) {
  const kind = isInboxTriageKind(message.classification_kind)
    ? message.classification_kind
    : null;
  const plan = useMemo(() => (kind ? planForKind(kind) : null), [kind]);

  // Resolve the attributed tenant to a friendly label for the understanding +
  // plan rows. Mirrors IntakeConversationPanel's match-query pattern.
  const tenantsQuery = useQuery({
    queryKey: ["inbox-conversation-tenants", entityId],
    queryFn: () => listTenants(entityId),
    enabled: Boolean(entityId) && Boolean(message.attributed_tenant_id),
    staleTime: 60_000,
  });
  const attributedTenantLabel = useMemo(() => {
    if (!message.attributed_tenant_id) return null;
    const match = (tenantsQuery.data ?? []).find(
      (tenant) => tenant.id === message.attributed_tenant_id,
    );
    return match ? match.trading_name || match.legal_name : null;
  }, [message.attributed_tenant_id, tenantsQuery.data]);

  const subject = message.subject?.trim() || "(No subject)";
  const fromAddress = message.from_address?.trim() || "Unknown sender";
  const summary =
    message.classification_summary?.trim() || "I read this forwarded email.";
  const authPassed =
    message.auth_result.spf === "pass" && message.auth_result.dkim === "pass";

  const understanding = useMemo<UnderstandingRow[]>(() => {
    const rows: UnderstandingRow[] = [];
    rows.push({ label: "Sender", value: fromAddress });
    if (message.original_sender?.trim()) {
      rows.push({ label: "Forwarded by", value: message.original_sender.trim() });
    }
    if (message.attachment_intake_count > 0) {
      rows.push({
        label: "Attachments",
        value: `${message.attachment_intake_count} routed`,
      });
    }
    if (attributedTenantLabel) {
      rows.push({ label: "Tenant", value: attributedTenantLabel });
    }
    return rows;
  }, [
    fromAddress,
    message.original_sender,
    message.attachment_intake_count,
    attributedTenantLabel,
  ]);

  const [promoting, setPromoting] = useState(false);
  const [promoteError, setPromoteError] = useState<string | null>(null);
  const [promoted, setPromoted] = useState<InboxPromoteRecord | null>(null);
  const [thread, setThread] = useState<ConversationThreadRecord | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const threadRequestRef = useRef<Promise<ConversationThreadRecord> | null>(null);
  const threadSeed = useMemo(
    () => ({
      entity_id: entityId,
      source: "inbox",
      context_route: "/inbox",
      context_record_refs: { inbound_message_id: message.id },
      title: subject,
      initial_turn: {
        role: "user" as const,
        kind: "text" as const,
        payload: {
          text: `Forwarded email: ${subject}`,
          subject,
          from_address: fromAddress,
          inbound_message_id: message.id,
        },
      },
    }),
    [entityId, fromAddress, message.id, subject],
  );

  async function ensureThread() {
    if (thread) return thread;
    if (!threadRequestRef.current) {
      threadRequestRef.current = createConversationThread(threadSeed);
    }
    const request = threadRequestRef.current;
    try {
      const created = await request;
      setThread(created);
      setThreadError(null);
      return created;
    } catch (error) {
      setThreadError(friendlyError(error));
      return null;
    } finally {
      if (threadRequestRef.current === request) {
        threadRequestRef.current = null;
      }
    }
  }

  useEffect(() => {
    let cancelled = false;
    setThread(null);
    setThreadError(null);
    const request = createConversationThread(threadSeed);
    threadRequestRef.current = request;
    request
      .then((created) => {
        if (!cancelled) setThread(created);
      })
      .catch((error) => {
        if (!cancelled) setThreadError(friendlyError(error));
      })
      .finally(() => {
        if (threadRequestRef.current === request) {
          threadRequestRef.current = null;
        }
      });
    return () => {
      cancelled = true;
      if (threadRequestRef.current === request) {
        threadRequestRef.current = null;
      }
    };
  }, [threadSeed]);

  const primaryDisabled =
    promoting ||
    !plan ||
    plan.promoteKind === null ||
    (plan.needsTenant && !message.attributed_tenant_id);

  async function handlePromote() {
    if (promoting || !plan || plan.promoteKind === null) return;
    setPromoting(true);
    setPromoteError(null);
    try {
      const currentThread = await ensureThread();
      if (!currentThread) {
        throw new Error("Couldn't start the conversation thread.");
      }
      const result = await promoteInboxMessage({
        entity_id: entityId,
        kind: plan.promoteKind,
        summary,
        body: (message.body_text || message.body_preview || "").trim(),
        inbound_message_id: message.id,
        tenant_id: message.attributed_tenant_id ?? undefined,
      });
      appendConversationTurn(currentThread.id, {
        role: "ai",
        kind: "created",
        payload: {
          summary: "Promoted email to a Leasium draft.",
          target_kind: result.target_kind,
          target_id: result.target_id,
          target_label: result.target_label,
          target_href: promotedHref(result),
          provider_gate: true,
        },
      }).catch((error) => setThreadError(friendlyError(error)));
      setPromoted(result);
      onPromoted?.(result);
    } catch (error) {
      setPromoteError(friendlyError(error));
    } finally {
      setPromoting(false);
    }
  }

  return (
    <div
      data-testid="inbox-conversation"
      className="mx-auto w-full max-w-[760px] space-y-5"
    >
      {/* 1. User turn — the forwarded email. */}
      <UserTurn>
        <div className="mb-1 inline-flex items-center gap-2 rounded-lg bg-white/70 px-2 py-1 text-xs font-medium text-foreground">
          <Mail size={13} />
          {subject}
        </div>
        <div className="mb-1 text-xs text-foreground/80">{fromAddress}</div>
        {message.original_sender?.trim() ? (
          <div className="mb-1 text-xs text-foreground/80">
            Originally from {message.original_sender.trim()}
          </div>
        ) : null}
        {message.attachment_intake_count > 0 ? (
          <div className="mb-1 inline-flex items-center gap-1.5 rounded-lg bg-white/70 px-2 py-1 text-xs font-medium text-foreground">
            <Paperclip size={12} />
            {message.attachment_intake_count} attachment
            {message.attachment_intake_count === 1 ? "" : "s"}
          </div>
        ) : null}
        <div>Forwarded this email.</div>
      </UserTurn>

      {/* 2. AI turn — plain-English read + understanding card. */}
      <AiTurn>
        <Prose>{summary}</Prose>
        <div
          data-testid="inbox-understanding"
          className="rounded-2xl border border-border bg-white p-4 shadow-leasiumXs"
        >
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              What I understood
            </h3>
            <span className="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-leasium-micro font-semibold text-leasium-teal-strong">
              SOURCE-BACKED
            </span>
          </div>
          <dl className="space-y-2">
            {kind ? (
              <div className="flex items-start gap-3 text-sm">
                <dt className="w-[120px] shrink-0 text-muted-foreground">Type</dt>
                <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <span className="font-semibold text-foreground">
                    {KIND_LABEL[kind]}
                  </span>
                  <ConfidenceBadge
                    level={confidenceLevel(message.classification_confidence)}
                  />
                </dd>
              </div>
            ) : null}
            {understanding.map((row, i) => (
              <div key={`${row.label}-${i}`} className="flex items-start gap-3 text-sm">
                <dt className="w-[120px] shrink-0 text-muted-foreground">
                  {row.label}
                </dt>
                <dd className="min-w-0 flex-1 font-semibold text-foreground">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          {authPassed ? (
            <p className="mt-3 text-leasium-micro text-muted-foreground">
              Verified — SPF/DKIM pass
            </p>
          ) : null}
        </div>
      </AiTurn>

      {/* 3. AI turn — bundled plan card (hidden once promoted). */}
      {!promoted && plan ? (
        <AiTurn>
          <div
            data-testid="inbox-plan"
            className="rounded-2xl border-[1.5px] border-primary bg-white p-4 shadow-leasiumXs"
          >
            <h3 className="mb-3 text-sm font-semibold text-foreground">
              Proposed next step
            </h3>
            <div className="flex items-center gap-3 rounded-xl border border-border px-3 py-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                {plan.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">
                  {plan.action}
                </span>
                {attributedTenantLabel ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    Tenant — {attributedTenantLabel}
                  </span>
                ) : null}
              </span>
              {plan.promoteKind ? (
                <StatusBadge tone="primary" className="text-leasium-micro">
                  DRAFT
                </StatusBadge>
              ) : null}
            </div>
            {plan.needsTenant && !message.attributed_tenant_id && plan.note ? (
              <div className="mt-3 flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-xs leading-5 text-warning-strong">
                <span aria-hidden>⚑</span>
                <span>{plan.note}</span>
              </div>
            ) : null}
            <div className="mt-3">
              <GuardrailNote>{GUARDRAIL}</GuardrailNote>
            </div>
            {promoteError ? (
              <p className="mt-3 text-sm text-danger">{promoteError}</p>
            ) : null}
            {threadError ? (
              <p className="mt-3 text-sm text-muted-foreground">{threadError}</p>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                data-testid="inbox-promote"
                onClick={handlePromote}
                disabled={primaryDisabled}
              >
                {promoting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Promoting…
                  </>
                ) : (
                  "Promote to draft"
                )}
              </Button>
            </div>
          </div>
        </AiTurn>
      ) : null}

      {/* 4. Done turn — after a successful promote. */}
      {promoted ? (
        <AiTurn>
          <div
            data-testid="inbox-promoted"
            className="rounded-2xl border-[1.5px] border-success bg-white p-4 shadow-leasiumXs"
          >
            <h3 className="mb-3 text-sm font-semibold text-foreground">
              Promoted — draft created
            </h3>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-foreground">{promoted.target_label}</span>
              <Link
                href={promotedHref(promoted)}
                className="text-xs font-medium text-primary hover:underline"
              >
                View →
              </Link>
            </div>
            <div className="mt-3">
              <GuardrailNote>{GUARDRAIL}</GuardrailNote>
            </div>
          </div>
        </AiTurn>
      ) : null}
    </div>
  );
}
