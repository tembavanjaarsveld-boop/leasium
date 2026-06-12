"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Copy,
  FileText,
  Loader2,
  Mail,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { EntityPicker } from "@/components/entity-picker";
import { QueryProvider } from "@/components/query-provider";
import {
  Button,
  EmptyState,
  Field,
  SecondaryButton,
  SectionPanel,
  Select,
  StatusBadge,
  type StatusTone,
} from "@/components/ui";
import {
  type CommsInboundMessageDetailRecord,
  type CommsInboundMessageRecord,
  type InboxPromoteKind,
  type InboxTenantContactField,
  type InboxTenantContactPreviewRecord,
  type InboxTriageKind,
  type InboxTriageRecord,
  type InboxTriageTargetKind,
  discardCommsInboundMessage,
  documentDownloadUrlFromPath,
  getCommsInboundMessage,
  listContractors,
  listCommsInboundMessages,
  listEntities,
  listLeasesByTenant,
  listProperties,
  listTenants,
  previewTenantContactUpdate,
  promoteInboxMessage,
  trustCommsInboundMessageSender,
  triageInboxMessage,
} from "@/lib/api";
import {
  ENTITY_STORAGE_KEY,
  defaultEntitySelection,
  isAllEntities,
  scopeEntityId,
} from "@/lib/entity-selection";
import { cn, friendlyError } from "@/lib/utils";

const KIND_LABEL: Record<InboxTriageKind, string> = {
  maintenance_request: "Maintenance request",
  payment_or_arrears: "Payment or arrears",
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

const PROMOTE_KIND_LABEL: Record<InboxPromoteKind, string> = {
  maintenance_request: "Create maintenance work order",
  payment_or_arrears: "Open arrears case",
  lease_change: "Send to Smart Intake review",
  tenant_contact: "Update tenant contact details",
  vendor_or_contractor: "Add to contractor directory",
  compliance_or_insurance: "Send to Smart Intake review",
};

const PROMOTE_TARGET_KIND: Record<InboxPromoteKind, InboxTriageTargetKind> = {
  maintenance_request: "maintenance_work_order",
  payment_or_arrears: "arrears_case",
  lease_change: "smart_intake",
  tenant_contact: "tenant",
  vendor_or_contractor: "none",
  compliance_or_insurance: "smart_intake",
};

function isPromotable(kind: InboxTriageKind): kind is InboxPromoteKind {
  return (
    kind === "maintenance_request" ||
    kind === "payment_or_arrears" ||
    kind === "lease_change" ||
    kind === "tenant_contact" ||
    kind === "vendor_or_contractor" ||
    kind === "compliance_or_insurance"
  );
}

function isInboxTriageKind(value: string | null): value is InboxTriageKind {
  return value !== null && value in KIND_LABEL;
}

const KIND_TONE: Record<InboxTriageKind, StatusTone> = {
  maintenance_request: "warning",
  payment_or_arrears: "danger",
  lease_change: "primary",
  tenant_contact: "primary",
  vendor_or_contractor: "neutral",
  property_update: "primary",
  compliance_or_insurance: "warning",
  task_or_reminder: "primary",
  owner_or_entity_admin: "neutral",
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

const MAILBOX_ADDRESS = "ai@leasium.ai";

type MailboxReviewSource = {
  messageId: string;
  subject: string;
  sender: string;
  originalSender: string | null;
  rawEmailDownloadPath: string | null;
  classificationConfidence: number | null;
  classificationSummary: string | null;
};

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

function mailboxSubject(message: CommsInboundMessageRecord): string {
  return message.subject?.trim() || "(No subject)";
}

function mailboxSender(message: CommsInboundMessageRecord): string {
  return (
    message.original_sender?.trim() ||
    message.from_address?.trim() ||
    "Unknown sender"
  );
}

function formatMailboxReason(value: string | null): string {
  return value ? value.replaceAll("_", " ") : "No reason recorded";
}

function quarantineSummaryLabel(value: string | null): string {
  if (value === "sender_not_trusted") return "Untrusted sender";
  if (value === "auth_not_passed") return "Authentication failed";
  if (value === "inbound_secret_not_configured") return "Mailbox not configured";
  return "Quarantined";
}

function formatMailboxKind(value: string | null): string {
  return value ? value.replaceAll("_", " ") : "Awaiting review";
}

function mailboxAuthLabel(
  authResult: Record<string, string>,
  key: "spf" | "dkim",
): string {
  return `${key.toUpperCase()} ${authResult[key] ?? "unknown"}`;
}

function mailboxStateTone(
  trustState: CommsInboundMessageRecord["trust_state"],
): StatusTone {
  if (trustState === "trusted") return "success";
  if (trustState === "discarded") return "neutral";
  return "warning";
}

function mailboxStateLabel(message: CommsInboundMessageRecord): string {
  if (message.trust_state === "trusted") return "Trusted";
  if (message.trust_state === "discarded") return "Discarded";
  return formatMailboxReason(message.quarantine_reason);
}

function mailboxAuthPassed(message: CommsInboundMessageRecord): boolean {
  return (
    message.auth_result.spf === "pass" && message.auth_result.dkim === "pass"
  );
}

function mailboxReviewSource(
  message: CommsInboundMessageDetailRecord,
): MailboxReviewSource {
  return {
    messageId: message.id,
    subject: mailboxSubject(message),
    sender: mailboxSender(message),
    originalSender: message.original_sender,
    rawEmailDownloadPath: message.raw_email_download_path,
    classificationConfidence: message.classification_confidence,
    classificationSummary: message.classification_summary,
  };
}

function mailboxStoredTriageResult(
  message: CommsInboundMessageDetailRecord,
): InboxTriageRecord | null {
  if (!isInboxTriageKind(message.classification_kind)) return null;
  const confidence = Math.max(
    0,
    Math.min(1, message.classification_confidence ?? 0),
  );
  const summary =
    message.classification_summary?.trim() ||
    `${KIND_LABEL[message.classification_kind]} from AI mailbox.`;
  return {
    kind: message.classification_kind,
    confidence,
    summary,
    suggested_action: isPromotable(message.classification_kind)
      ? "Review the stored mailbox classification, choose any target records, then promote a local draft."
      : "Review the stored mailbox classification and handle from the appropriate surface.",
    suggested_target_kind: isPromotable(message.classification_kind)
      ? PROMOTE_TARGET_KIND[message.classification_kind]
      : "none",
    suggested_target_href: null,
    suggested_property: null,
    suggested_tenant: null,
    suggested_lease: null,
    suggested_contractor: null,
    key_facts: [
      { label: "Source", value: "AI mailbox" },
      { label: "Sender", value: mailboxSender(message) },
    ],
    warnings: [],
    guardrails: [
      "Stored AI mailbox classification is review-first. It creates only a local draft after operator approval and never sends email, syncs Xero, reconciles payments, or applies Smart Intake automatically.",
    ],
    response_id: null,
  };
}

function InboxWorkspace() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [body, setBody] = useState("");
  const [result, setResult] = useState<InboxTriageRecord | null>(null);
  const [mailboxReview, setMailboxReview] =
    useState<MailboxReviewSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promotePropertyId, setPromotePropertyId] = useState("");
  const [promoteTenantId, setPromoteTenantId] = useState("");
  const [promoteLeaseId, setPromoteLeaseId] = useState("");
  const [promoteContractorId, setPromoteContractorId] = useState("");
  const [tenantContactPreview, setTenantContactPreview] =
    useState<InboxTenantContactPreviewRecord | null>(null);
  const [selectedTenantContactFields, setSelectedTenantContactFields] =
    useState<Partial<Record<InboxTenantContactField, boolean>>>({});
  const [promoteError, setPromoteError] = useState<string | null>(null);
  const [selectedMailboxMessageId, setSelectedMailboxMessageId] =
    useState<string | null>(null);
  const [mailboxAddressCopied, setMailboxAddressCopied] = useState(false);
  const [mailboxActionMessage, setMailboxActionMessage] = useState<
    string | null
  >(null);
  const [mailboxActionError, setMailboxActionError] = useState<string | null>(
    null,
  );

  const entitiesQuery = useQuery({
    queryKey: ["entities"],
    queryFn: listEntities,
  });

  // The inbox is a paste-and-classify tool, not a stored-list surface, so there
  // is no primary per-entity list to fan out. All-entities mode here just
  // collapses the scope to "" (disabling the secondary promote pickers) and
  // gates the single-entity classify/promote actions; useEntityFanOut is not
  // needed. scopedEntityId is the safe id to feed the API.
  const allMode = isAllEntities(selectedEntityId);
  const scopedEntityId = scopeEntityId(selectedEntityId);

  const mailboxQuery = useQuery({
    queryKey: ["inbox-ai-mailbox", selectedEntityId],
    queryFn: () =>
      listCommsInboundMessages({
        entity_id: scopedEntityId || undefined,
        source: "ai_mailbox",
        limit: 25,
      }),
    enabled: Boolean(selectedEntityId),
  });

  const selectedMailboxMessageQuery = useQuery({
    queryKey: ["inbox-ai-mailbox-message", selectedMailboxMessageId],
    queryFn: () => {
      if (!selectedMailboxMessageId) {
        throw new Error("Missing mailbox message id.");
      }
      return getCommsInboundMessage(selectedMailboxMessageId);
    },
    enabled: Boolean(selectedMailboxMessageId),
  });

  const propertiesQuery = useQuery({
    queryKey: ["inbox-promote-properties", scopedEntityId],
    queryFn: () => listProperties(scopedEntityId),
    enabled: Boolean(scopedEntityId) && Boolean(result),
  });

  const tenantsQuery = useQuery({
    queryKey: ["inbox-promote-tenants", scopedEntityId],
    queryFn: () => listTenants(scopedEntityId),
    enabled: Boolean(scopedEntityId) && Boolean(result),
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
    queryKey: ["inbox-promote-contractors", scopedEntityId],
    queryFn: () => listContractors(scopedEntityId),
    enabled:
      Boolean(scopedEntityId) &&
      Boolean(result) &&
      result?.kind === "vendor_or_contractor",
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(ENTITY_STORAGE_KEY);
    const accessibleIds = new Set(
      (entitiesQuery.data ?? []).map((entity) => entity.id),
    );
    // The All-entities sentinel is a valid restore target even though it is not
    // a real entity id, so the cross-entity view survives navigation/reload.
    const next =
      stored && (isAllEntities(stored) || accessibleIds.has(stored))
        ? stored
        : defaultEntitySelection(entitiesQuery.data ?? []);
    if (!selectedEntityId && next) {
      setSelectedEntityId(next);
    }
  }, [entitiesQuery.data, selectedEntityId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedEntityId) {
      window.localStorage.setItem(ENTITY_STORAGE_KEY, selectedEntityId);
    }
  }, [selectedEntityId]);

  useEffect(() => {
    setSelectedMailboxMessageId(null);
  }, [selectedEntityId]);

  useEffect(() => {
    setMailboxActionMessage(null);
    setMailboxActionError(null);
  }, [selectedMailboxMessageId]);

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
      setTenantContactPreview(null);
      setSelectedTenantContactFields({});
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

  const tenantContactPreviewMutation = useMutation({
    mutationFn: previewTenantContactUpdate,
    onMutate: () => {
      setPromoteError(null);
      setTenantContactPreview(null);
      setSelectedTenantContactFields({});
    },
    onSuccess: (data) => {
      setTenantContactPreview(data);
      setSelectedTenantContactFields(
        Object.fromEntries(
          data.proposed_updates.map((proposal) => [
            proposal.field,
            proposal.selected_by_default,
          ]),
        ) as Partial<Record<InboxTenantContactField, boolean>>,
      );
    },
    onError: (err) => setPromoteError(friendlyError(err)),
  });

  const trustSenderMutation = useMutation({
    mutationFn: trustCommsInboundMessageSender,
    onMutate: () => {
      setMailboxActionMessage(null);
      setMailboxActionError(null);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(
        ["inbox-ai-mailbox-message", data.id],
        data,
      );
      void queryClient.invalidateQueries({
        queryKey: ["inbox-ai-mailbox", selectedEntityId],
      });
      setMailboxActionMessage("Sender trusted for future authenticated mail.");
    },
    onError: (err) => setMailboxActionError(friendlyError(err)),
  });

  const discardMailboxMutation = useMutation({
    mutationFn: discardCommsInboundMessage,
    onMutate: () => {
      setMailboxActionMessage(null);
      setMailboxActionError(null);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(
        ["inbox-ai-mailbox-message", data.id],
        data,
      );
      void queryClient.invalidateQueries({
        queryKey: ["inbox-ai-mailbox", selectedEntityId],
      });
      setMailboxActionMessage("Mailbox row discarded; evidence retained.");
    },
    onError: (err) => setMailboxActionError(friendlyError(err)),
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || !scopedEntityId) return;
    setMailboxReview(null);
    triageMutation.mutate({ entity_id: scopedEntityId, body: trimmed });
  }

  function handleReset() {
    setBody("");
    setResult(null);
    setMailboxReview(null);
    setError(null);
    setPromoteError(null);
    setPromotePropertyId("");
    setPromoteTenantId("");
    setPromoteLeaseId("");
    setPromoteContractorId("");
    setTenantContactPreview(null);
    setSelectedTenantContactFields({});
  }

  function handleSample() {
    setBody(SAMPLE_BODY);
    setResult(null);
    setMailboxReview(null);
    setError(null);
    setPromoteError(null);
    setTenantContactPreview(null);
    setSelectedTenantContactFields({});
  }

  async function handleCopyMailboxAddress() {
    try {
      await navigator.clipboard.writeText(MAILBOX_ADDRESS);
      setMailboxAddressCopied(true);
      window.setTimeout(() => setMailboxAddressCopied(false), 1600);
    } catch {
      setMailboxAddressCopied(false);
    }
  }

  function handlePromote() {
    if (!result || !scopedEntityId) return;
    if (!isPromotable(result.kind)) return;
    if (result.kind === "compliance_or_insurance" && !mailboxReview) {
      setPromoteError(
        "Compliance or insurance promote requires a reviewed mailbox email.",
      );
      return;
    }
    const tenantContactUpdates =
      result.kind === "tenant_contact" && tenantContactPreview
        ? Object.fromEntries(
            tenantContactPreview.proposed_updates
              .filter(
                (proposal) => selectedTenantContactFields[proposal.field],
              )
              .map((proposal) => [proposal.field, proposal.proposed_value]),
          )
        : undefined;
    promoteMutation.mutate({
      entity_id: scopedEntityId,
      kind: result.kind,
      summary: result.summary,
      body: body.trim(),
      inbound_message_id: mailboxReview?.messageId,
      property_id: promotePropertyId || null,
      tenant_id: promoteTenantId || null,
      lease_id: promoteLeaseId || null,
      contractor_id: promoteContractorId || null,
      tenant_contact_updates: tenantContactUpdates,
    });
  }

  function handlePrepareTenantContact() {
    if (!scopedEntityId || !promoteTenantId) return;
    tenantContactPreviewMutation.mutate({
      entity_id: scopedEntityId,
      tenant_id: promoteTenantId,
      body: body.trim(),
    });
  }

  function handleTrustMailboxSender() {
    if (!selectedMailboxMessage) return;
    trustSenderMutation.mutate(selectedMailboxMessage.id);
  }

  function handleDiscardMailboxMessage() {
    if (!selectedMailboxMessage) return;
    discardMailboxMutation.mutate(selectedMailboxMessage.id);
  }

  function handleReviewMailboxMessage() {
    if (!selectedMailboxMessage || !scopedEntityId) return;
    const reviewBody = (
      selectedMailboxMessage.body_text ||
      selectedMailboxMessage.body_preview ||
      ""
    ).trim();
    if (!reviewBody) {
      setMailboxActionError("No stored message body is available to review.");
      return;
    }
    const storedResult = mailboxStoredTriageResult(selectedMailboxMessage);
    if (!storedResult) {
      setMailboxActionError(
        "No stored mailbox classification is available to review.",
      );
      return;
    }
    setBody(reviewBody);
    setResult(storedResult);
    setPromoteError(null);
    setPromotePropertyId("");
    setPromoteTenantId(selectedMailboxMessage.attributed_tenant_id ?? "");
    setPromoteLeaseId("");
    setPromoteContractorId("");
    setTenantContactPreview(null);
    setSelectedTenantContactFields({});
    setMailboxActionMessage(null);
    setMailboxActionError(null);
    setMailboxReview(mailboxReviewSource(selectedMailboxMessage));
  }

  const showPromote =
    result !== null &&
    isPromotable(result.kind) &&
    (result.kind !== "compliance_or_insurance" || mailboxReview !== null);
  const promoteRequiresTenant =
    result?.kind === "payment_or_arrears" || result?.kind === "tenant_contact";
  const promoteShowsLeasePicker = result?.kind === "lease_change";
  const promoteShowsTenantContactPreview = result?.kind === "tenant_contact";
  const promoteShowsContractorPicker =
    result?.kind === "vendor_or_contractor";
  const selectedTenantContactUpdateCount =
    tenantContactPreview?.proposed_updates.filter(
      (proposal) => selectedTenantContactFields[proposal.field],
    ).length ?? 0;
  const promoteDisabled =
    !showPromote ||
    !scopedEntityId ||
    promoteMutation.isPending ||
    (promoteRequiresTenant && !promoteTenantId) ||
    (promoteShowsTenantContactPreview &&
      (!tenantContactPreview || selectedTenantContactUpdateCount === 0));

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

  const mailboxMessages = mailboxQuery.data?.messages ?? [];
  const trustedMailboxMessages = mailboxMessages.filter(
    (message) => message.trust_state === "trusted",
  );
  const quarantinedMailboxMessages = mailboxMessages.filter(
    (message) => message.trust_state === "quarantined",
  );
  const selectedMailboxMessage = selectedMailboxMessageQuery.data ?? null;
  const mailboxActionPending =
    trustSenderMutation.isPending || discardMailboxMutation.isPending;
  const canTrustSelectedMailboxSender =
    selectedMailboxMessage?.trust_state === "quarantined" &&
    selectedMailboxMessage.quarantine_reason === "sender_not_trusted" &&
    mailboxAuthPassed(selectedMailboxMessage);
  const canDiscardSelectedMailboxMessage =
    selectedMailboxMessage?.trust_state === "quarantined";
  const mailboxStatusText = mailboxQuery.isLoading
    ? "Loading mailbox"
    : `${trustedMailboxMessages.length} ready · ${quarantinedMailboxMessages.length} quarantined`;

  const submitDisabled =
    !scopedEntityId || !body.trim() || triageMutation.isPending;

  return (
    <main className="min-h-screen">
      <AppHeader>
        <EntityPicker
          entities={entitiesQuery.data}
          loading={entitiesQuery.isLoading}
          value={selectedEntityId}
          onChange={setSelectedEntityId}
        />
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

        <section className="grid gap-4 rounded-2xl border border-primary/20 bg-white px-5 py-4 shadow-leasiumXs">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-1">
              <div className="flex items-center gap-2">
                <div className="grid h-9 w-9 place-items-center rounded-full bg-primary-soft text-primary">
                  <ShieldCheck size={17} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">AI Mailbox</h2>
                  <p className="text-sm text-muted-foreground">
                    Forward an email to ai@leasium.ai. Review what Leasium
                    found. Apply only what you approve.
                  </p>
                </div>
              </div>
              <div className="mt-3 rounded-lg border border-dashed border-primary/30 bg-primary-soft/30 p-4">
                <p className="text-sm font-semibold text-foreground">
                  Forward anything — agent updates, notices, quotes, renewals
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Trusted senders only. Leasium reads the email, suggests where
                  details and tasks belong, and waits for your approval.
                </p>
              </div>
            </div>
            <div className="grid min-w-[220px] justify-items-start gap-2 sm:justify-items-end">
              <Button type="button" onClick={handleCopyMailboxAddress}>
                <Copy size={14} />
                {mailboxAddressCopied ? "Copied" : "Copy address"}
              </Button>
              <p className="text-xs text-muted-foreground">
                {MAILBOX_ADDRESS} · {mailboxStatusText}
              </p>
            </div>
          </div>

          {mailboxQuery.isError ? (
            <div
              role="alert"
              className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger"
            >
              Mailbox unavailable: {friendlyError(mailboxQuery.error)}
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionPanel
              title={`MAILBOX QUEUE — ${trustedMailboxMessages.length}`}
              description="Trusted mailbox rows that are ready for operator review."
              icon={<Mail size={17} className="text-primary" />}
              actions={
                <SecondaryButton
                  type="button"
                  onClick={() => mailboxQuery.refetch()}
                  disabled={mailboxQuery.isFetching}
                >
                  {mailboxQuery.isFetching ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                  Refresh
                </SecondaryButton>
              }
            >
              <div className="grid gap-2 p-4">
                {mailboxQuery.isError ? (
                  <EmptyState
                    icon={<Mail size={18} />}
                    title="Mailbox unavailable."
                    description="Refresh the mailbox after the API is reachable again."
                  />
                ) : trustedMailboxMessages.length ? (
                  trustedMailboxMessages.map((message) => (
                    <div
                      key={message.id}
                      className="grid gap-2 rounded-md border border-border bg-muted/20 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-foreground">
                            {mailboxSubject(message)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {mailboxSender(message)}
                          </div>
                        </div>
                        <StatusBadge tone="success">Trusted</StatusBadge>
                      </div>
                      {message.classification_summary ? (
                        <p className="text-xs text-muted-foreground">
                          {message.classification_summary}
                        </p>
                      ) : message.body_preview ? (
                        <p className="text-xs text-muted-foreground">
                          {message.body_preview}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                        <span>{formatMailboxKind(message.classification_kind)}</span>
                        {message.classification_confidence !== null ? (
                          <span>
                            ·{" "}
                            {Math.round(
                              message.classification_confidence * 100,
                            )}
                            %
                          </span>
                        ) : null}
                        {message.attachment_intake_count ? (
                          <span>
                            · {message.attachment_intake_count} attachment
                            {message.attachment_intake_count === 1 ? "" : "s"}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex justify-end">
                        <SecondaryButton
                          type="button"
                          onClick={() => setSelectedMailboxMessageId(message.id)}
                        >
                          <FileText size={14} />
                          Review email
                        </SecondaryButton>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState
                    icon={<Mail size={18} />}
                    title={
                      mailboxQuery.isLoading
                        ? "Checking mailbox."
                        : "No trusted mailbox rows."
                    }
                    description="Forwarded emails from trusted senders will appear here after Leasium has stored the raw email provenance."
                  />
                )}
              </div>
            </SectionPanel>

            <SectionPanel
              title={`QUARANTINE — AWAITING TRUST DECISION — ${quarantinedMailboxMessages.length}`}
              description="Blocked rows keep provenance visible without trusting the sender."
              icon={<ShieldCheck size={17} className="text-warning" />}
            >
              <div className="grid gap-2 p-4">
                {mailboxQuery.isError ? (
                  <EmptyState
                    icon={<ShieldCheck size={18} />}
                    title="Quarantine unavailable."
                    description="Refresh the mailbox after the API is reachable again."
                  />
                ) : quarantinedMailboxMessages.length ? (
                  quarantinedMailboxMessages.map((message) => (
                    <div
                      key={message.id}
                      className="grid gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-foreground">
                            {mailboxSubject(message)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {mailboxSender(message)}
                          </div>
                        </div>
                        <StatusBadge tone="warning">Quarantined</StatusBadge>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                          <span>
                            {quarantineSummaryLabel(
                              message.quarantine_reason,
                            )}
                          </span>
                          <span>
                            · Auth {message.auth_result.spf ?? "unknown"} /{" "}
                            {message.auth_result.dkim ?? "unknown"}
                          </span>
                        </div>
                        <SecondaryButton
                          type="button"
                          onClick={() => setSelectedMailboxMessageId(message.id)}
                        >
                          <FileText size={14} />
                          View email
                        </SecondaryButton>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState
                    icon={<ShieldCheck size={18} />}
                    title={
                      mailboxQuery.isLoading
                        ? "Checking quarantine."
                        : "No quarantined mailbox rows."
                    }
                    description="Untrusted senders and failed authentication stay here until you trust or discard them."
                  />
                )}
              </div>
            </SectionPanel>
          </div>

          {selectedMailboxMessageId ? (
            <SectionPanel
              title={
                selectedMailboxMessage
                  ? mailboxSubject(selectedMailboxMessage)
                  : "Loading email"
              }
              description="Review sender, authentication, body, and raw evidence before deciding."
              icon={<FileText size={17} className="text-primary" />}
              actions={
                <SecondaryButton
                  type="button"
                  onClick={() => setSelectedMailboxMessageId(null)}
                >
                  Close
                </SecondaryButton>
              }
            >
              <div className="grid gap-3 p-4">
                {selectedMailboxMessageQuery.isLoading ? (
                  <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 size={14} className="animate-spin" />
                    Loading email provenance
                  </div>
                ) : selectedMailboxMessageQuery.isError ? (
                  <div className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
                    {friendlyError(selectedMailboxMessageQuery.error)}
                  </div>
                ) : selectedMailboxMessage ? (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge
                        tone={mailboxStateTone(
                          selectedMailboxMessage.trust_state,
                        )}
                      >
                        {mailboxStateLabel(selectedMailboxMessage)}
                      </StatusBadge>
                      <StatusBadge tone="neutral">
                        {mailboxAuthLabel(
                          selectedMailboxMessage.auth_result,
                          "spf",
                        )}
                      </StatusBadge>
                      <StatusBadge tone="neutral">
                        {mailboxAuthLabel(
                          selectedMailboxMessage.auth_result,
                          "dkim",
                        )}
                      </StatusBadge>
                    </div>
                    <div className="grid gap-1 rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                      <div>
                        From:{" "}
                        <span className="font-medium text-foreground">
                          {selectedMailboxMessage.from_address ??
                            "Unknown sender"}
                        </span>
                      </div>
                      <div>
                        To:{" "}
                        <span className="font-medium text-foreground">
                          {selectedMailboxMessage.to_address ?? MAILBOX_ADDRESS}
                        </span>
                      </div>
                      {selectedMailboxMessage.original_sender ? (
                        <div>
                          Original sender:{" "}
                          <span className="font-medium text-foreground">
                            {selectedMailboxMessage.original_sender}
                          </span>
                        </div>
                      ) : null}
                    </div>
                    {canDiscardSelectedMailboxMessage ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 p-3">
                        {canTrustSelectedMailboxSender ? (
                          <Button
                            type="button"
                            onClick={handleTrustMailboxSender}
                            disabled={mailboxActionPending}
                          >
                            {trustSenderMutation.isPending ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <ShieldCheck size={14} />
                            )}
                            Trust sender
                          </Button>
                        ) : null}
                        <SecondaryButton
                          type="button"
                          onClick={handleDiscardMailboxMessage}
                          disabled={mailboxActionPending}
                        >
                          {discardMailboxMutation.isPending ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <AlertTriangle size={14} />
                          )}
                          Discard
                        </SecondaryButton>
                      </div>
                    ) : null}
                    {selectedMailboxMessage.trust_state === "trusted" ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/20 bg-primary-soft/30 p-3">
                        <Button
                          type="button"
                          onClick={handleReviewMailboxMessage}
                          disabled={!scopedEntityId}
                        >
                          <Sparkles size={14} />
                          Review promotion
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          Opens the stored mailbox classification for review.
                          Nothing is applied, sent, or synced.
                        </p>
                      </div>
                    ) : null}
                    {mailboxActionMessage ? (
                      <div
                        role="status"
                        className="rounded-md border border-success/30 bg-success/5 p-3 text-sm text-success"
                      >
                        {mailboxActionMessage}
                      </div>
                    ) : null}
                    {mailboxActionError ? (
                      <div
                        role="alert"
                        className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger"
                      >
                        {mailboxActionError}
                      </div>
                    ) : null}
                    <div className="whitespace-pre-wrap rounded-md border border-border bg-white p-3 text-sm text-foreground">
                      {selectedMailboxMessage.body_text ||
                        selectedMailboxMessage.body_preview ||
                        "No body text was stored for this message."}
                    </div>
                    {selectedMailboxMessage.raw_email_download_path ? (
                      <a
                        href={documentDownloadUrlFromPath(
                          selectedMailboxMessage.raw_email_download_path,
                        )}
                        className="inline-flex min-h-11 w-fit items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-3 text-sm font-semibold text-primary transition hover:bg-primary/10"
                        target="_blank"
                        rel="noreferrer"
                      >
                        <FileText size={14} />
                        Open raw email
                      </a>
                    ) : null}
                  </>
                ) : null}
              </div>
            </SectionPanel>
          ) : null}

          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/20 bg-primary-soft/30 px-3 py-1 text-xs font-semibold text-primary">
            <ShieldCheck size={13} />
            Email intake is review-first — senders verified, nothing applies
            without you.
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
                onChange={(event) => {
                  setBody(event.target.value);
                  if (mailboxReview) {
                    setMailboxReview(null);
                  }
                }}
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
              <Button
                type="submit"
                disabled={submitDisabled}
                title={
                  allMode
                    ? "Select a single entity to classify a message"
                    : undefined
                }
              >
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
                        {promoteKindLabel}.{" "}
                        {promoteShowsTenantContactPreview
                          ? "Leasium updates only the checked fields; nothing is sent."
                          : "Leasium creates the draft; nothing is sent until you approve from inside the target surface."}
                      </p>
                    </div>
                  </div>

                  {mailboxReview ? (
                    <div
                      className="grid gap-2 rounded-md border border-primary/25 bg-white p-3 text-xs text-muted-foreground"
                      data-testid="mailbox-review-provenance"
                    >
                      <div className="font-semibold uppercase tracking-wide text-primary">
                        Source email
                      </div>
                      <div className="grid gap-1 sm:grid-cols-2">
                        <div>
                          From:{" "}
                          <span className="font-medium text-foreground">
                            {mailboxReview.sender}
                          </span>
                        </div>
                        <div>
                          Subject:{" "}
                          <span className="font-medium text-foreground">
                            {mailboxReview.subject}
                          </span>
                        </div>
                        {mailboxReview.originalSender ? (
                          <div>
                            Original sender:{" "}
                            <span className="font-medium text-foreground">
                              {mailboxReview.originalSender}
                            </span>
                          </div>
                        ) : null}
                        {mailboxReview.classificationConfidence !== null ? (
                          <div>
                            Stored mailbox confidence:{" "}
                            <span className="font-medium text-foreground">
                              {Math.round(
                                mailboxReview.classificationConfidence * 100,
                              )}
                              %
                            </span>
                          </div>
                        ) : null}
                      </div>
                      {mailboxReview.classificationSummary ? (
                        <p>{mailboxReview.classificationSummary}</p>
                      ) : null}
                      {mailboxReview.rawEmailDownloadPath ? (
                        <a
                          href={documentDownloadUrlFromPath(
                            mailboxReview.rawEmailDownloadPath,
                          )}
                          className="inline-flex min-h-11 w-fit items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-3 text-sm font-semibold text-primary transition hover:bg-primary/10"
                          target="_blank"
                          rel="noreferrer"
                        >
                          <FileText size={14} />
                          Open raw email
                        </a>
                      ) : null}
                    </div>
                  ) : null}

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
                            {result.suggested_property &&
                            promotePropertyId === result.suggested_property.id &&
                            !(propertiesQuery.data ?? []).some(
                              (property) =>
                                property.id === result.suggested_property?.id,
                            ) ? (
                              <option value={result.suggested_property.id}>
                                {result.suggested_property.label}
                              </option>
                            ) : null}
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
                              setTenantContactPreview(null);
                              setSelectedTenantContactFields({});
                            }}
                          >
                            <option value="">
                              {promoteRequiresTenant
                                ? "Pick a tenant"
                                : "No tenant attached"}
                            </option>
                            {result.suggested_tenant &&
                            promoteTenantId === result.suggested_tenant.id &&
                            !(tenantsQuery.data ?? []).some(
                              (tenant) =>
                                tenant.id === result.suggested_tenant?.id,
                            ) ? (
                              <option value={result.suggested_tenant.id}>
                                {result.suggested_tenant.label}
                              </option>
                            ) : null}
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

                  {promoteShowsTenantContactPreview ? (
                    <div className="grid gap-3 rounded-md border border-border bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">
                            Contact updates
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Review proposed values before updating the tenant
                            record.
                          </p>
                        </div>
                        <SecondaryButton
                          type="button"
                          onClick={handlePrepareTenantContact}
                          disabled={
                            !promoteTenantId ||
                            tenantContactPreviewMutation.isPending
                          }
                        >
                          {tenantContactPreviewMutation.isPending ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Sparkles size={14} />
                          )}
                          Prepare updates
                        </SecondaryButton>
                      </div>

                      {tenantContactPreview ? (
                        <div className="grid gap-2">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>{tenantContactPreview.summary}</span>
                            {tenantContactPreview.confidence !== null ? (
                              <StatusBadge
                                tone={confidenceTone(
                                  tenantContactPreview.confidence,
                                )}
                              >
                                {Math.round(
                                  tenantContactPreview.confidence * 100,
                                )}
                                %
                              </StatusBadge>
                            ) : null}
                          </div>
                          {tenantContactPreview.proposed_updates.length ? (
                            <div className="grid gap-2">
                              {tenantContactPreview.proposed_updates.map(
                                (proposal) => (
                                  <label
                                    key={proposal.field}
                                    className="grid gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm md:grid-cols-[auto_160px_minmax(0,1fr)] md:items-center"
                                  >
                                    <input
                                      type="checkbox"
                                      className="mt-1 md:mt-0"
                                      checked={Boolean(
                                        selectedTenantContactFields[
                                          proposal.field
                                        ],
                                      )}
                                      onChange={(event) =>
                                        setSelectedTenantContactFields(
                                          (current) => ({
                                            ...current,
                                            [proposal.field]:
                                              event.target.checked,
                                          }),
                                        )
                                      }
                                    />
                                    <span className="font-medium">
                                      {proposal.label}
                                    </span>
                                    <span className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                                      <span>
                                        Current:{" "}
                                        {proposal.current_value || "Blank"}
                                      </span>
                                      <span className="font-semibold text-foreground">
                                        Proposed: {proposal.proposed_value}
                                      </span>
                                    </span>
                                  </label>
                                ),
                              )}
                            </div>
                          ) : (
                            <div className="rounded-md border border-warning/30 bg-warning/5 p-2 text-xs text-warning">
                              No changed contact fields were found.
                            </div>
                          )}
                          {tenantContactPreview.warnings.length ? (
                            <div className="grid gap-1 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs text-warning">
                              {tenantContactPreview.warnings.map((warning) => (
                                <div key={warning}>{warning}</div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

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
                      title={
                        allMode
                          ? "Select a single entity to promote to a draft"
                          : undefined
                      }
                    >
                      {promoteMutation.isPending ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 size={14} className="animate-spin" />{" "}
                          Promoting…
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <ArrowRight size={14} />{" "}
                          {promoteShowsTenantContactPreview
                            ? "Apply selected fields"
                            : "Promote to draft"}
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
                  <summary className="min-h-11 cursor-pointer py-2">
                    Guardrails
                  </summary>
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
