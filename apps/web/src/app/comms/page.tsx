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
  Copy,
  Download,
  ExternalLink,
  Inbox,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { AppHeader } from "@/components/app-shell";
import {
  CommsTemplateEditorDrawer,
  type CommsTemplateEditorAction,
} from "@/components/comms-template-editor-drawer";
import { EntityPicker } from "@/components/entity-picker";
import { QueryProvider } from "@/components/query-provider";
import {
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SecondaryButton,
  SectionPanel,
  SkeletonRows,
  StatusBadge,
  type StatusTone,
} from "@/components/ui";
import {
  type BrandedCommunicationTemplateRecord,
  type CommsCandidateRecord,
  type CommsCorrespondenceEventRecord,
  type CommsKind,
  type CommsSeverity,
  type CommsTemplatePreviewRecord,
  createBrandedCommunicationTemplate,
  createBrandedCommunicationTemplateVersion,
  deleteBrandedCommunicationTemplate,
  dismissCommsCandidate,
  dispatchCommsDraft,
  getCommsOutboundLog,
  getCommsQueue,
  listBrandedCommunicationTemplates,
  listEntities,
  previewCommsTemplate,
  updateBrandedCommunicationTemplate,
  uploadDocument,
} from "@/lib/api";
import { csvCell } from "@/lib/csv";
import { saveBlob } from "@/lib/download";
import {
  ENTITY_CHANGED_EVENT,
  ENTITY_STORAGE_KEY,
  defaultEntitySelection,
  isAllEntities,
  scopeEntityId,
} from "@/lib/entity-selection";
import { useEntityFanOut } from "@/lib/use-entity-fan-out";
import { friendlyError } from "@/lib/utils";

type CommsFilter = "all" | CommsKind;
// All-entities rows carry their source entity alongside the record, since the
// candidate/event payloads have no entity_id field of their own.
type EntityTaggedCandidate = {
  entityId: string;
  candidate: CommsCandidateRecord;
};
type EntityTaggedCommsEvent = {
  entityId: string;
  event: CommsCorrespondenceEventRecord;
};
type OutboundLogFilter = "all" | "attention" | "email" | "sms";
type OutboundLogDownload = {
  events: CommsCorrespondenceEventRecord[];
  filterLabel: string;
  totalEvents: number;
};
type TemplateCatalogDownload = {
  templates: BrandedCommunicationTemplateRecord[];
  entityName: string;
};

const TEMPLATE_CATALOG_GUARDRAIL =
  "Review-only export: copying or downloading this file does not send SendGrid email, send Twilio SMS, dispatch queued drafts, dismiss candidates, refresh providers, mutate communication templates, write provider history, or change tenant, maintenance, invoice, billing, payment, reconciliation, Xero, or Basiq records.";

const KIND_LABEL: Record<CommsKind, string> = {
  arrears_reminder: "Arrears reminder",
  insurance_expiry: "Insurance expiry",
  lease_renewal: "Lease renewal",
  inbound_email: "Inbound email",
  inbound_sms: "Inbound SMS",
  compliance_obligation: "Compliance reminder",
  rent_review: "Rent review",
  tenant_lifecycle_stall: "Tenant lifecycle",
  maintenance_contractor_forward: "Contractor forward",
  maintenance_tenant_forward: "Tenant forward",
};

const OUTBOUND_LOG_FILTERS: OutboundLogFilter[] = [
  "all",
  "attention",
  "email",
  "sms",
];

const OUTBOUND_LOG_FILTER_LABEL: Record<OutboundLogFilter, string> = {
  all: "All receipts",
  attention: "Needs attention",
  email: "Email",
  sms: "SMS",
};
const COMMS_KIND_ORDER: CommsKind[] = [
  "arrears_reminder",
  "insurance_expiry",
  "lease_renewal",
  "tenant_lifecycle_stall",
  "maintenance_contractor_forward",
  "maintenance_tenant_forward",
  "inbound_email",
  "inbound_sms",
  "compliance_obligation",
  "rent_review",
];

const COMMS_TEMPLATE_KEY_BY_KIND: Partial<Record<CommsKind, string>> = {
  maintenance_contractor_forward: "maintenance_contractor_update",
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
const SMS_SINGLE_SEGMENT_GUIDE = 160;

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest("input, textarea, select, button, a, [contenteditable='true']"),
  );
}

function handleCommsDraftListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  if (isEditableKeyboardTarget(event.target)) {
    return;
  }

  const rows = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>("[data-comms-row]"),
  );
  if (rows.length === 0) {
    return;
  }
  const current = rows.findIndex((row) => row === document.activeElement);

  if (["j", "k", "ArrowDown", "ArrowUp"].includes(event.key)) {
    event.preventDefault();
    const forward = event.key === "j" || event.key === "ArrowDown";
    const next =
      current < 0
        ? 0
        : forward
          ? Math.min(current + 1, rows.length - 1)
          : Math.max(current - 1, 0);
    rows[next]?.focus();
    rows[next]?.scrollIntoView({ block: "nearest" });
    return;
  }

  if (event.key === "Enter" && current >= 0) {
    const firstEditable = rows[current]?.querySelector<HTMLElement>(
      "input:not(:disabled), textarea:not(:disabled), select:not(:disabled)",
    );
    if (firstEditable) {
      event.preventDefault();
      firstEditable.focus();
    }
  }
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function commsQueueReviewDate(value: string | null | undefined) {
  return value?.slice(0, 10) || "undated";
}

function commsTemplateCatalogReviewDate(
  templates: BrandedCommunicationTemplateRecord[],
) {
  const dates = templates
    .map((template) => template.updated_at || template.created_at)
    .filter(Boolean)
    .sort();
  return dates.length ? dates[dates.length - 1]?.slice(0, 10) : "undated";
}

function providerLabel(value: string | null | undefined) {
  if (!value) return "Provider";
  if (value.toLowerCase() === "sendgrid") return "SendGrid";
  if (value.toLowerCase() === "twilio") return "Twilio";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function channelLabel(value: BrandedCommunicationTemplateRecord["channel"]) {
  if (value === "sms") return "SMS";
  if (value === "in_app") return "In-app";
  return "email";
}

function templateChannelProviderLabel(
  template: BrandedCommunicationTemplateRecord,
) {
  return `${providerLabel(template.provider)} ${channelLabel(template.channel)}`;
}

function templateSourceLabel(template: BrandedCommunicationTemplateRecord) {
  return template.is_system ? "System" : "Override";
}

function commsTemplateCatalogCsv({
  templates,
  entityName,
}: TemplateCatalogDownload) {
  const rows: Array<Array<string | number | null | undefined>> = [
    [
      "Category",
      "Name",
      "Key",
      "Version",
      "Channel",
      "Provider",
      "Status",
      "Source",
      "Subject",
      "Body preview",
      "Action label",
      "Action URL template",
      "Notes",
      "Entity",
      "Updated",
      "Guardrail",
    ],
    [
      "Template catalog",
      `${templates.length} active ${templates.length === 1 ? "template" : "templates"}`,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      entityName,
      commsTemplateCatalogReviewDate(templates),
      TEMPLATE_CATALOG_GUARDRAIL,
    ],
    ...templates.map((template) => [
      "Template",
      template.name,
      template.key,
      template.version,
      template.channel,
      template.provider,
      template.is_active ? "active" : "inactive",
      templateSourceLabel(template),
      template.subject_template,
      template.body_template,
      template.action_label,
      template.action_url_template,
      template.notes,
      entityName,
      formatDateTime(template.updated_at),
      TEMPLATE_CATALOG_GUARDRAIL,
    ]),
    [
      "Export guardrail",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      TEMPLATE_CATALOG_GUARDRAIL,
      entityName,
      "",
      TEMPLATE_CATALOG_GUARDRAIL,
    ],
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function commsQueueReviewCsv({
  candidates,
  generatedAt,
  filterSummaryLabel,
  progressSummaryLabel,
  settledCount,
  remainingCount,
}: {
  candidates: CommsCandidateRecord[];
  generatedAt: string | null | undefined;
  filterSummaryLabel: string;
  progressSummaryLabel: string;
  settledCount: number;
  remainingCount: number;
}) {
  const guardrail =
    "Review-only export: downloading this file does not send SendGrid email, send Twilio SMS, dismiss candidates, upload evidence, write provider history, settle candidates, mutate the queue, or refresh provider state.";
  const rows: Array<Array<string | number | null | undefined>> = [
    [
      "Category",
      "Kind",
      "Tenant",
      "Property",
      "Unit",
      "Channel",
      "Recipient",
      "Recipient readiness",
      "Severity",
      "Due",
      "Generated",
      "Subject",
      "Body preview",
      "Detail",
      "Session",
      "Guardrail",
    ],
    [
      "Queue summary",
      "All drafts",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      formatDateTime(generatedAt),
      "",
      "",
      filterSummaryLabel,
      `${progressSummaryLabel} Remaining ${remainingCount}; settled ${settledCount}.`,
      guardrail,
    ],
    ...candidates.map((candidate) => {
      const isSms = candidate.kind === "inbound_sms";
      const recipient = isSms
        ? candidate.recipient_phone
        : candidate.recipient_email;
      return [
        "Candidate",
        KIND_LABEL[candidate.kind],
        candidate.tenant_name,
        candidate.property_name,
        candidate.unit_label,
        isSms ? "Twilio SMS" : "SendGrid email",
        recipient,
        recipient ? "Ready" : "Missing recipient",
        SEVERITY_LABEL[candidate.severity],
        formatDateTime(candidate.due_at),
        formatDateTime(candidate.generated_at),
        candidate.subject,
        candidate.body,
        candidate.detail,
        "",
        guardrail,
      ];
    }),
    [
      "Export guardrail",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      guardrail,
      "",
      guardrail,
    ],
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function commsEventKindLabel(event: CommsCorrespondenceEventRecord) {
  const kind = event.metadata.kind;
  if (typeof kind === "string" && kind in KIND_LABEL) {
    return KIND_LABEL[kind as CommsKind];
  }
  return event.event_type;
}

function commsDraftRowLabel(candidate: CommsCandidateRecord) {
  const context = [
    candidate.tenant_name,
    candidate.property_name,
    candidate.unit_label,
  ]
    .filter(Boolean)
    .join(", ");
  return `Review ${KIND_LABEL[candidate.kind]} draft${context ? ` for ${context}` : ""}`;
}

function commsEventChannelLabel(event: CommsCorrespondenceEventRecord) {
  if (event.channel === "sms") return "Twilio SMS";
  if (event.channel === "email") return "SendGrid email";
  return event.channel ?? "Stored receipt";
}

function commsTargetValue(event: CommsCorrespondenceEventRecord) {
  if (!event.target_kind || !event.target_id) return "";
  return `${event.target_kind}:${event.target_id}`;
}

function commsEventMetadataString(
  event: CommsCorrespondenceEventRecord,
  key: string,
) {
  const value = event.metadata[key];
  return typeof value === "string" ? value : null;
}

function commsTargetLink(event: CommsCorrespondenceEventRecord) {
  if (!event.target_kind || !event.target_id) return null;
  const tenantId = commsEventMetadataString(event, "tenant_id");
  if (event.target_kind === "arrears_case") {
    return { href: "/operations?tab=arrears", label: "Open arrears case" };
  }
  if (event.target_kind === "maintenance_work_order") {
    return {
      href: `/operations/maintenance/${encodeURIComponent(event.target_id)}`,
      label: "Open work order",
    };
  }
  if (event.target_kind === "inbound_message") {
    return { href: "/comms", label: "Open comms queue" };
  }
  if (event.target_kind === "tenant") {
    return {
      href: `/tenants/${encodeURIComponent(event.target_id)}`,
      label: "Open tenant",
    };
  }
  if (event.target_kind === "tenant_onboarding" || event.target_kind === "lease") {
    return tenantId
      ? {
          href: `/tenants/${encodeURIComponent(tenantId)}`,
          label: "Open tenant workflow",
        }
      : { href: "/tenants", label: "Open tenants" };
  }
  if (event.target_kind === "obligation") {
    return { href: "/operations", label: "Open work queue" };
  }
  return null;
}

function commsCandidateTargetLink(candidate: CommsCandidateRecord) {
  if (!candidate.target_kind || !candidate.target_id) return null;
  if (candidate.target_kind === "arrears_case") {
    return { href: "/operations?tab=arrears", label: "Open arrears case" };
  }
  if (candidate.target_kind === "maintenance_work_order") {
    return {
      href: `/operations/maintenance/${encodeURIComponent(candidate.target_id)}`,
      label: "Open work order",
    };
  }
  if (
    candidate.target_kind === "inbound_message" &&
    candidate.detail?.toLowerCase().includes("smart intake")
  ) {
    return { href: "/intake", label: "Open Leasium AI" };
  }
  if (candidate.target_kind === "tenant") {
    return {
      href: `/tenants/${encodeURIComponent(candidate.target_id)}`,
      label: "Open tenant",
    };
  }
  if (candidate.target_kind === "tenant_onboarding" && candidate.tenant_id) {
    return {
      href: `/tenants/${encodeURIComponent(candidate.tenant_id)}`,
      label: "Open tenant review",
    };
  }
  if (candidate.target_kind === "lease" && candidate.tenant_id) {
    return {
      href: `/tenants/${encodeURIComponent(candidate.tenant_id)}`,
      label: "Open tenant workflow",
    };
  }
  if (candidate.target_kind === "obligation") {
    return {
      href: "/operations?tab=compliance",
      label: "Open compliance work",
    };
  }
  return null;
}

function complianceObligationAnchorId(obligationId: string) {
  return `compliance-obligation-${encodeURIComponent(obligationId)}`;
}

function complianceObligationHref(obligationId: string) {
  return `/operations?tab=compliance#${complianceObligationAnchorId(obligationId)}`;
}

function complianceCandidateSourceIds(candidate: CommsCandidateRecord) {
  if (
    candidate.kind !== "compliance_obligation" ||
    candidate.target_kind !== "obligation"
  ) {
    return [];
  }
  return Array.from(
    new Set(
      [candidate.target_id, ...(candidate.related_target_ids ?? [])].filter(
        Boolean,
      ),
    ),
  );
}

function templateVersionRank(version: string) {
  const match = version.trim().match(/^v(\d+)$/i);
  return match ? Number(match[1]) : 0;
}

function templateForCandidate(
  candidate: CommsCandidateRecord,
  templates: BrandedCommunicationTemplateRecord[],
) {
  if (candidate.kind === "inbound_sms") return null;
  const key = COMMS_TEMPLATE_KEY_BY_KIND[candidate.kind];
  if (!key) return null;
  return templates
    .filter(
      (template) =>
        template.key === key &&
        template.channel === "email" &&
        template.is_active &&
        template.deleted_at === null,
    )
    .reduce<BrandedCommunicationTemplateRecord | null>((best, template) => {
      if (!best) return template;
      const rank = templateVersionRank(template.version);
      const bestRank = templateVersionRank(best.version);
      if (rank !== bestRank) {
        return rank > bestRank ? template : best;
      }
      return Date.parse(template.updated_at) > Date.parse(best.updated_at)
        ? template
        : best;
    }, null);
}

function commsEventStatusTone(
  status: string | null | undefined,
): StatusTone {
  if (status === "success") return "success";
  if (status === "error" || status === "failed") return "danger";
  if (status === "skipped") return "warning";
  return "neutral";
}

function isAttentionOutboundStatus(status: string | null | undefined) {
  return status === "error" || status === "failed" || status === "skipped";
}

function matchesOutboundLogFilter(
  event: CommsCorrespondenceEventRecord,
  filter: OutboundLogFilter,
) {
  if (filter === "all") return true;
  if (filter === "attention") return isAttentionOutboundStatus(event.status);
  return event.channel === filter;
}

function commsOutboundLogCsv({
  events,
  generatedAt,
  filterLabel = "All",
  totalEvents,
}: {
  events: CommsCorrespondenceEventRecord[];
  generatedAt: string | null | undefined;
  filterLabel?: string;
  totalEvents?: number;
}) {
  const totalLabel =
    totalEvents && totalEvents !== events.length
      ? `${events.length} of ${totalEvents}`
      : `${events.length}`;
  const receiptNoun =
    totalEvents && totalEvents !== events.length
      ? "receipts"
      : events.length === 1
        ? "receipt"
        : "receipts";
  const guardrail =
    "Read-only export: downloading this file does not send SendGrid email, send Twilio SMS, dismiss candidates, upload evidence, write provider history, settle candidates, mutate the queue, or refresh provider state.";
  const rows: Array<Array<string | number | null | undefined>> = [
    [
      "Category",
      "Kind",
      "Channel",
      "Recipient",
      "Status",
      "Provider",
      "Occurred",
      "Summary",
      "Target",
      "Generated",
      "Guardrail",
    ],
    [
      "Outbound log",
      `${filterLabel} dispatch receipts`,
      "",
      "",
      "",
      "",
      "",
      `${totalLabel} ${receiptNoun}`,
      "",
      formatDateTime(generatedAt),
      guardrail,
    ],
    ...events.map((event) => [
      "Dispatch receipt",
      commsEventKindLabel(event),
      commsEventChannelLabel(event),
      event.recipient,
      event.status,
      event.provider,
      formatDateTime(event.occurred_at),
      event.summary,
      commsTargetValue(event),
      formatDateTime(generatedAt),
      guardrail,
    ]),
    [
      "Export guardrail",
      "",
      "",
      "",
      "",
      "",
      "",
      guardrail,
      "",
      "",
      guardrail,
    ],
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
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
    const params = new URLSearchParams(window.location.search);
    const requestedEntityId = params.get("entity_id");
    if (requestedEntityId) {
      setSelectedEntityId(requestedEntityId);
      return;
    }
    const stored = window.localStorage.getItem(ENTITY_STORAGE_KEY);
    // The All-entities sentinel is a valid restore target even though it is not
    // a real entity id, so the cross-entity view survives navigation/reload.
    if (stored) setSelectedEntityId(stored);
  }, []);
  useEffect(() => {
    if (!selectedEntityId) return;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ENTITY_STORAGE_KEY, selectedEntityId);
    window.dispatchEvent(new Event(ENTITY_CHANGED_EVENT));
  }, [selectedEntityId]);
  useEffect(() => {
    if (selectedEntityId) return;
    const fallback = defaultEntitySelection(entitiesQuery.data ?? []);
    if (fallback) setSelectedEntityId(fallback);
  }, [entitiesQuery.data, selectedEntityId]);

  // All-entities mode: entity-scoped queries use scopedEntityId (empty in
  // all-mode, so they stay disabled) and the page reads merged fan-out results.
  const allMode = isAllEntities(selectedEntityId);
  const scopedEntityId = scopeEntityId(selectedEntityId);
  const entityNameById = useMemo(
    () =>
      new Map(
        (entitiesQuery.data ?? []).map((entity) => [entity.id, entity.name]),
      ),
    [entitiesQuery.data],
  );

  const queueQuery = useQuery({
    queryKey: ["comms-queue", scopedEntityId],
    queryFn: () => getCommsQueue(scopedEntityId),
    enabled: Boolean(scopedEntityId),
  });
  const outboundLogQuery = useQuery({
    queryKey: ["comms-outbound-log", scopedEntityId],
    queryFn: () => getCommsOutboundLog(scopedEntityId),
    enabled: Boolean(scopedEntityId),
  });
  const templateCatalogQuery = useQuery({
    queryKey: ["comms-template-catalog", scopedEntityId],
    queryFn: () =>
      listBrandedCommunicationTemplates({
        entityId: scopedEntityId,
        includeInactive: true,
      }),
    enabled: Boolean(scopedEntityId),
  });

  // Fan-out copies of the composite queue + outbound log. The fan-out hook
  // flattens arrays, so each per-entity queryFn extracts the composite's
  // items[] and tags every row with its entityId during concatenation (the
  // candidate/event records carry no entity_id of their own). A distinct
  // keyPrefix keeps these tagged arrays out of the single-entity composite
  // cache. Summary fields (generated_at) are not merged here — the UI derives
  // summary counts from the merged rows.
  const queueFanOut = useEntityFanOut<EntityTaggedCandidate>({
    entities: entitiesQuery.data,
    enabled: allMode,
    keyPrefix: ["comms-queue-fanout"],
    queryFn: async (entityId) => {
      const record = await getCommsQueue(entityId);
      return record.candidates.map((candidate) => ({ entityId, candidate }));
    },
  });
  const outboundLogFanOut = useEntityFanOut<EntityTaggedCommsEvent>({
    entities: entitiesQuery.data,
    enabled: allMode,
    keyPrefix: ["comms-outbound-log-fanout"],
    queryFn: async (entityId) => {
      const record = await getCommsOutboundLog(entityId);
      return record.events.map((event) => ({ entityId, event }));
    },
  });
  const [templateEditorState, setTemplateEditorState] = useState<{
    mode: "create" | "edit";
    template: BrandedCommunicationTemplateRecord | null;
  } | null>(null);
  const invalidateTemplateCatalog = () =>
    queryClient.invalidateQueries({
      queryKey: ["comms-template-catalog", selectedEntityId],
    });
  const storeTemplateCatalogRecord = (
    record: BrandedCommunicationTemplateRecord,
  ) => {
    queryClient.setQueryData<BrandedCommunicationTemplateRecord[]>(
      ["comms-template-catalog", selectedEntityId],
      (previous) => {
        if (!previous) return previous;
        const withoutRecord = previous.filter(
          (template) => template.id !== record.id,
        );
        if (record.deleted_at) {
          return withoutRecord;
        }
        return [...withoutRecord, record];
      },
    );
    void invalidateTemplateCatalog();
  };
  const createTemplateMutation = useMutation({
    mutationFn: createBrandedCommunicationTemplate,
    onSuccess: (record) => {
      storeTemplateCatalogRecord(record);
    },
  });
  const updateTemplateMutation = useMutation({
    mutationFn: ({
      templateId,
      payload,
    }: Extract<CommsTemplateEditorAction, { type: "update" }>) =>
      updateBrandedCommunicationTemplate(templateId, payload),
    onSuccess: (record) => {
      storeTemplateCatalogRecord(record);
    },
  });
  const saveTemplateVersionMutation = useMutation({
    mutationFn: ({
      templateId,
      payload,
    }: Extract<CommsTemplateEditorAction, { type: "save_version" }>) =>
      createBrandedCommunicationTemplateVersion(templateId, payload),
    onSuccess: (record) => {
      storeTemplateCatalogRecord(record);
    },
  });
  const deleteTemplateMutation = useMutation({
    mutationFn: ({
      templateId,
    }: Extract<CommsTemplateEditorAction, { type: "delete" }>) =>
      deleteBrandedCommunicationTemplate(templateId),
    onSuccess: (record) => {
      storeTemplateCatalogRecord(record);
    },
  });
  const handleTemplateEditorSaved = async (
    action: CommsTemplateEditorAction,
  ) => {
    if (action.type === "create") {
      await createTemplateMutation.mutateAsync(action.payload);
      return;
    }
    if (action.type === "update") {
      await updateTemplateMutation.mutateAsync(action);
      return;
    }
    if (action.type === "save_version") {
      await saveTemplateVersionMutation.mutateAsync(action);
      return;
    }
    await deleteTemplateMutation.mutateAsync(action);
  };

  const [selectedFilter, setSelectedFilter] = useState<CommsFilter>("all");
  const [settledCandidateIds, setSettledCandidateIds] = useState<Set<string>>(
    () => new Set(),
  );
  useEffect(() => {
    setSettledCandidateIds(new Set());
  }, [selectedEntityId]);
  // Merged candidate list the UI reads regardless of single- vs all-entity
  // mode. In all-mode the fan-out rows are concatenated (already per-entity
  // tagged); the entity label for each candidate id is looked up below.
  const candidates = useMemo<CommsCandidateRecord[]>(
    () =>
      allMode
        ? queueFanOut.data.map((row) => row.candidate)
        : (queueQuery.data?.candidates ?? []),
    [allMode, queueFanOut.data, queueQuery.data?.candidates],
  );
  const candidateEntityNameById = useMemo(() => {
    if (!allMode) return new Map<string, string>();
    return new Map(
      queueFanOut.data.map((row) => [
        row.candidate.id,
        entityNameById.get(row.entityId) ?? "Unknown entity",
      ]),
    );
  }, [allMode, queueFanOut.data, entityNameById]);
  useEffect(() => {
    setSettledCandidateIds((previous) => {
      if (previous.size === 0) return previous;
      if (candidates.length === 0) return new Set();
      const currentIds = new Set(candidates.map((candidate) => candidate.id));
      const next = new Set(
        [...previous].filter((candidateId) => currentIds.has(candidateId)),
      );
      return next.size === previous.size ? previous : next;
    });
  }, [candidates]);
  const counts = useMemo(() => {
    const tally: Record<CommsKind, number> = {
      arrears_reminder: 0,
      insurance_expiry: 0,
      lease_renewal: 0,
      inbound_email: 0,
      inbound_sms: 0,
      compliance_obligation: 0,
      rent_review: 0,
      tenant_lifecycle_stall: 0,
      maintenance_contractor_forward: 0,
      maintenance_tenant_forward: 0,
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
  const selectedFilterLabel =
    selectedFilter === "all" ? "all drafts" : KIND_LABEL[selectedFilter];
  const filterSummaryLabel =
    selectedFilter === "all"
      ? `Showing all ${candidates.length} ${candidates.length === 1 ? "draft" : "drafts"}`
      : `Showing ${filteredCandidates.length} of ${candidates.length} drafts in ${selectedFilterLabel}`;
  const urgentCount = useMemo(
    () => candidates.filter((c) => c.severity === "danger").length,
    [candidates],
  );
  const settledCount = settledCandidateIds.size;
  const remainingCount = Math.max(candidates.length - settledCount, 0);
  const progressSummaryLabel =
    settledCount === 0
      ? `${remainingCount} ${remainingCount === 1 ? "draft" : "drafts"} remaining this session.`
      : `${remainingCount} ${remainingCount === 1 ? "draft" : "drafts"} remaining, ${settledCount} settled this session.`;
  const queueGeneratedLabel = allMode
    ? null
    : formatDateTime(queueQuery.data?.generated_at);
  // Merged outbound log events + the per-event entity label (all-mode only).
  const outboundLogEvents = useMemo<CommsCorrespondenceEventRecord[]>(
    () =>
      allMode
        ? outboundLogFanOut.data.map((row) => row.event)
        : (outboundLogQuery.data?.events ?? []),
    [allMode, outboundLogFanOut.data, outboundLogQuery.data?.events],
  );
  const outboundEventEntityNameById = useMemo(() => {
    if (!allMode) return new Map<string, string>();
    return new Map(
      outboundLogFanOut.data.map((row) => [
        row.event.id,
        entityNameById.get(row.entityId) ?? "Unknown entity",
      ]),
    );
  }, [allMode, outboundLogFanOut.data, entityNameById]);
  const selectedEntityName = allMode
    ? "All entities"
    : (entitiesQuery.data?.find((entity) => entity.id === selectedEntityId)
        ?.name ?? "Selected entity");
  const storedTemplates = useMemo(
    () => templateCatalogQuery.data ?? [],
    [templateCatalogQuery.data],
  );
  const activeTemplates = useMemo(
    () =>
      storedTemplates.filter(
        (template) => template.is_active && !template.deleted_at,
      ),
    [storedTemplates],
  );
  const inactiveTemplates = useMemo(
    () =>
      storedTemplates.filter(
        (template) => !template.is_active && !template.deleted_at,
      ),
    [storedTemplates],
  );
  const templateEditorHistory = useMemo(() => {
    const editingKey = templateEditorState?.template?.key;
    if (!editingKey) return [];
    return storedTemplates.filter(
      (template) => template.key === editingKey && !template.deleted_at,
    );
  }, [storedTemplates, templateEditorState]);
  // Loading/error/fetching routed through allMode so the cross-entity view
  // reflects the merged fan-out state, not the (disabled) single-entity query.
  const queueIsLoading = allMode
    ? queueFanOut.isLoading
    : queueQuery.isLoading;
  const queueIsFetching = allMode
    ? queueFanOut.isFetching
    : queueQuery.isFetching;
  const queueError = allMode ? queueFanOut.error : queueQuery.error;
  const queueLoaded = allMode
    ? !queueFanOut.isLoading
    : Boolean(queueQuery.data);
  const queueRefreshDisabled = !selectedEntityId || queueIsFetching;
  const [reviewCsvCopyReceipt, setReviewCsvCopyReceipt] = useState<string | null>(
    null,
  );
  const [outboundLogCsvCopyReceipt, setOutboundLogCsvCopyReceipt] = useState<
    string | null
  >(null);
  const [templateCatalogCsvCopyReceipt, setTemplateCatalogCsvCopyReceipt] =
    useState<string | null>(null);
  // In all-mode the merged rows have no single generated_at; pass null so the
  // CSV records "undated" while still exporting every entity's drafts.
  const queueGeneratedAt = allMode
    ? null
    : (queueQuery.data?.generated_at ?? null);
  const outboundLogGeneratedAt = allMode
    ? null
    : (outboundLogQuery.data?.generated_at ?? null);
  const reviewCsv = () => {
    if (!queueLoaded) {
      return null;
    }
    return commsQueueReviewCsv({
      candidates,
      generatedAt: queueGeneratedAt,
      filterSummaryLabel,
      progressSummaryLabel,
      settledCount,
      remainingCount,
    });
  };
  const copyReviewCsv = async () => {
    const csv = reviewCsv();
    if (!csv) {
      return;
    }
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setReviewCsvCopyReceipt("Clipboard is not available.");
      return;
    }
    await navigator.clipboard.writeText(csv);
    setReviewCsvCopyReceipt("Review CSV copied.");
  };
  const downloadReviewCsv = () => {
    const csv = reviewCsv();
    if (!queueLoaded || !csv) {
      return;
    }
    saveBlob(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      `comms-queue-review-${commsQueueReviewDate(queueGeneratedAt)}.csv`,
    );
  };
  const outboundLogLoaded = allMode
    ? !outboundLogFanOut.isLoading
    : Boolean(outboundLogQuery.data);
  const outboundLogCsv = ({
    events,
    filterLabel,
    totalEvents,
  }: OutboundLogDownload) => {
    if (!outboundLogLoaded) {
      return null;
    }
    return commsOutboundLogCsv({
      events,
      generatedAt: outboundLogGeneratedAt,
      filterLabel,
      totalEvents,
    });
  };
  const copyOutboundLogCsv = async (download: OutboundLogDownload) => {
    const csv = outboundLogCsv(download);
    if (!csv) {
      return;
    }
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setOutboundLogCsvCopyReceipt("Clipboard is not available.");
      return;
    }
    await navigator.clipboard.writeText(csv);
    setOutboundLogCsvCopyReceipt("Outbound log CSV copied.");
  };
  const downloadOutboundLogCsv = (download: OutboundLogDownload) => {
    const csv = outboundLogCsv(download);
    if (!outboundLogLoaded || !csv) {
      return;
    }
    saveBlob(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      `comms-outbound-log-${commsQueueReviewDate(outboundLogGeneratedAt)}.csv`,
    );
  };
  const templateCatalogCsv = (download: TemplateCatalogDownload) =>
    commsTemplateCatalogCsv(download);
  const copyTemplateCatalogCsv = async (download: TemplateCatalogDownload) => {
    const csv = templateCatalogCsv(download);
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setTemplateCatalogCsvCopyReceipt("Clipboard is not available.");
      return;
    }
    await navigator.clipboard.writeText(csv);
    setTemplateCatalogCsvCopyReceipt("Template catalog CSV copied.");
  };
  const downloadTemplateCatalogCsv = (download: TemplateCatalogDownload) => {
    const csv = templateCatalogCsv(download);
    saveBlob(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      `comms-template-catalog-${commsTemplateCatalogReviewDate(download.templates)}.csv`,
    );
  };

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
      <div className="mx-auto grid max-w-5xl gap-4 px-5 py-6">
        <PageHeader
          title="Comms queue"
          description="Drafts the platform has staged for your review. Approve to send the email or SMS; dismiss to defer the candidate by seven days."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {queueGeneratedLabel ? (
                <StatusBadge tone="neutral">
                  Queue generated {queueGeneratedLabel}
                </StatusBadge>
              ) : null}
              <SecondaryButton
                type="button"
                onClick={() => {
                  void copyReviewCsv();
                }}
                disabled={!queueLoaded || candidates.length === 0}
              >
                <Copy size={15} />
                Copy review CSV
              </SecondaryButton>
              <SecondaryButton
                type="button"
                onClick={downloadReviewCsv}
                disabled={!queueLoaded || candidates.length === 0}
              >
                <Download size={15} />
                Download review CSV
              </SecondaryButton>
              {reviewCsvCopyReceipt ? (
                <StatusBadge tone="success">{reviewCsvCopyReceipt}</StatusBadge>
              ) : null}
              <SecondaryButton
                type="button"
                onClick={() => {
                  if (allMode) {
                    queueFanOut.refetch();
                    outboundLogFanOut.refetch();
                  } else {
                    void queueQuery.refetch();
                    void outboundLogQuery.refetch();
                    void queryClient.invalidateQueries({
                      queryKey: ["comms-queue-counts", selectedEntityId],
                    });
                  }
                }}
                disabled={queueRefreshDisabled}
              >
                {queueIsFetching ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <RefreshCw size={15} />
                )}
                {queueIsFetching ? "Refreshing…" : "Refresh queue"}
              </SecondaryButton>
            </div>
          }
        />
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Metric label="Total drafts" value={candidates.length} />
          <Metric label="Urgent" value={urgentCount} tone="danger" />
          <Metric label="Remaining now" value={remainingCount} />
          <Metric label="Settled now" value={settledCount} />
          <Metric label="Arrears" value={counts.arrears_reminder} />
          <Metric
            label="Insurance + lease"
            value={
              counts.insurance_expiry +
              counts.lease_renewal +
              counts.tenant_lifecycle_stall
            }
          />
        </section>
        <TemplateCatalogPanel
          templates={activeTemplates}
          inactiveTemplates={inactiveTemplates}
          entityName={selectedEntityName}
          allMode={allMode}
          isLoading={templateCatalogQuery.isLoading}
          error={templateCatalogQuery.error}
          onCopy={copyTemplateCatalogCsv}
          onDownload={downloadTemplateCatalogCsv}
          copyReceipt={templateCatalogCsvCopyReceipt}
          onCreate={() =>
            setTemplateEditorState({ mode: "create", template: null })
          }
          onEdit={(template) =>
            setTemplateEditorState({ mode: "edit", template })
          }
        />
        <OutboundLogPanel
          events={outboundLogEvents}
          guardrails={
            allMode
              ? [
                  "Read-only cross-entity view: merged from every accessible entity. Sending stays per entity — select a single entity to dispatch or dismiss.",
                ]
              : (outboundLogQuery.data?.guardrails ?? [])
          }
          isLoading={allMode ? outboundLogFanOut.isLoading : outboundLogQuery.isLoading}
          error={allMode ? outboundLogFanOut.error : outboundLogQuery.error}
          allMode={allMode}
          entityNameById={outboundEventEntityNameById}
          onCopy={copyOutboundLogCsv}
          onDownload={downloadOutboundLogCsv}
          copyReceipt={outboundLogCsvCopyReceipt}
          downloadDisabled={!outboundLogLoaded || outboundLogEvents.length === 0}
        />
        {candidates.length ? (
          <div className="rounded-md border border-border bg-white p-2">
            <div
              className="flex flex-wrap gap-2"
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
            <p className="mt-2 text-xs text-muted-foreground">
              {filterSummaryLabel}.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {progressSummaryLabel}
            </p>
          </div>
        ) : null}

        {queueIsLoading ? (
          <SectionPanel>
            <SkeletonRows rows={4} />
          </SectionPanel>
        ) : null}

        {queueError ? (
          <p className="rounded-md border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
            {friendlyError(queueError)}
          </p>
        ) : null}

        {!queueIsLoading && candidates.length === 0 && !queueError ? (
          <EmptyState
            icon={<CheckCircle2 size={18} />}
            title="Inbox zero. No drafts to review."
            description="As arrears age, insurance certificates approach expiry, or leases approach renewal, drafts will appear here for one-click approval."
          />
        ) : null}

        {!queueIsLoading &&
        candidates.length > 0 &&
        filteredCandidates.length === 0 &&
        !queueError ? (
          <EmptyState
            icon={<Inbox size={18} />}
            title="No drafts in this filter."
            description="Switch back to All drafts to continue reviewing the queue."
          />
        ) : null}

        {!queueIsLoading &&
        filteredCandidates.length > 0 &&
        !queueError ? (
          <div
            role="list"
            aria-label="Comms draft review queue"
            className="grid gap-4"
            onKeyDown={handleCommsDraftListKeyDown}
          >
            {filteredCandidates.map((candidate) => (
              <div
                key={candidate.id}
                role="listitem"
                tabIndex={0}
                data-comms-row
                aria-label={commsDraftRowLabel(candidate)}
                className="rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
              >
                <CandidateCard
                  candidate={candidate}
                  entityId={scopedEntityId}
                  template={templateForCandidate(candidate, activeTemplates)}
                  allMode={allMode}
                  entityName={
                    allMode
                      ? (candidateEntityNameById.get(candidate.id) ?? null)
                      : null
                  }
                  onSettled={(candidateId) => {
                    setSettledCandidateIds((previous) => {
                      const next = new Set(previous);
                      next.add(candidateId);
                      return next;
                    });
                    void queryClient.invalidateQueries({
                      queryKey: ["comms-queue", scopedEntityId],
                    });
                    void queryClient.invalidateQueries({
                      queryKey: ["comms-queue-counts", scopedEntityId],
                    });
                    void queryClient.invalidateQueries({
                      queryKey: ["comms-outbound-log", scopedEntityId],
                    });
                  }}
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <CommsTemplateEditorDrawer
        open={Boolean(templateEditorState)}
        mode={templateEditorState?.mode ?? "create"}
        template={templateEditorState?.template ?? null}
        templateHistory={templateEditorHistory}
        entityId={scopedEntityId || null}
        onClose={() => setTemplateEditorState(null)}
        onSaved={handleTemplateEditorSaved}
      />
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
    <div
      className="rounded-md border border-border bg-white p-4"
      role="group"
      aria-label={`${label}: ${value}`}
    >
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

function TemplateCatalogPanel({
  templates,
  inactiveTemplates,
  entityName,
  allMode,
  isLoading,
  error,
  onCopy,
  onDownload,
  copyReceipt,
  onCreate,
  onEdit,
}: {
  templates: BrandedCommunicationTemplateRecord[];
  inactiveTemplates: BrandedCommunicationTemplateRecord[];
  entityName: string;
  allMode: boolean;
  isLoading: boolean;
  error: unknown;
  onCopy: (download: TemplateCatalogDownload) => void | Promise<void>;
  onDownload: (download: TemplateCatalogDownload) => void;
  copyReceipt: string | null;
  onCreate: () => void;
  onEdit: (template: BrandedCommunicationTemplateRecord) => void;
}) {
  const download: TemplateCatalogDownload = { templates, entityName };
  const templateCountLabel = `${templates.length} active ${
    templates.length === 1 ? "template" : "templates"
  }`;
  // Templates are configured per entity, so management is single-entity only.
  // In all-mode the panel shows a "select a single entity" note instead.
  const actionDisabled =
    allMode || isLoading || Boolean(error) || templates.length === 0;
  const editorDisabled = allMode || isLoading || Boolean(error);

  return (
    <SectionPanel
      title="Template catalog"
      description="Stored communication templates for the selected entity."
      icon={<Sparkles size={17} />}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <SecondaryButton
            type="button"
            onClick={onCreate}
            disabled={editorDisabled}
            title={
              allMode ? "Select a single entity to manage templates" : undefined
            }
          >
            <Plus size={15} />
            New template
          </SecondaryButton>
          <StatusBadge tone="neutral">{templateCountLabel}</StatusBadge>
          <SecondaryButton
            type="button"
            onClick={() => {
              void onCopy(download);
            }}
            disabled={actionDisabled}
          >
            <Copy size={15} />
            Copy template catalog CSV
          </SecondaryButton>
          <SecondaryButton
            type="button"
            onClick={() => onDownload(download)}
            disabled={actionDisabled}
          >
            <Download size={15} />
            Download template catalog CSV
          </SecondaryButton>
          {copyReceipt ? (
            <StatusBadge tone="success">{copyReceipt}</StatusBadge>
          ) : null}
        </div>
      }
    >
      {allMode ? (
        <div className="p-4 text-sm text-muted-foreground">
          Templates are configured per entity. Select a single entity to view
          and manage its communication templates.
        </div>
      ) : null}
      {!allMode && isLoading ? (
        <div className="p-4">
          <SkeletonRows rows={2} />
        </div>
      ) : null}
      {!allMode && error ? (
        <p className="m-4 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          {friendlyError(error)}
        </p>
      ) : null}
      {!allMode && !isLoading && !error && templates.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">
          No active communication templates are stored for {entityName}.
        </div>
      ) : null}
      {!allMode && !isLoading && !error && templates.length > 0 ? (
        <div aria-label="Active templates" className="divide-y divide-border">
          {templates.map((template) => (
            <TemplateCatalogCard
              key={template.id}
              template={template}
              onEdit={onEdit}
            />
          ))}
        </div>
      ) : null}
      {!allMode && !isLoading && !error && inactiveTemplates.length > 0 ? (
        <details className="border-t border-border bg-muted/10" open>
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">
            Inactive templates ({inactiveTemplates.length})
          </summary>
          <div aria-label="Disabled templates" className="divide-y divide-border">
            {inactiveTemplates.map((template) => (
              <TemplateCatalogCard
                key={template.id}
                template={template}
                onEdit={onEdit}
              />
            ))}
          </div>
        </details>
      ) : null}
      <div className="border-t border-border bg-muted/20 px-4 py-3">
        <p className="text-xs text-muted-foreground">
          {TEMPLATE_CATALOG_GUARDRAIL}
        </p>
      </div>
    </SectionPanel>
  );
}

function TemplateCatalogCard({
  template,
  onEdit,
}: {
  template: BrandedCommunicationTemplateRecord;
  onEdit: (template: BrandedCommunicationTemplateRecord) => void;
}) {
  return (
    <article
      aria-label={template.name}
      className="grid gap-2 p-4 text-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-foreground">{template.name}</p>
          <p className="mt-1 break-words text-xs text-muted-foreground">
            {template.key}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="neutral">{template.version}</StatusBadge>
          <StatusBadge tone={template.channel === "sms" ? "primary" : "neutral"}>
            {templateChannelProviderLabel(template)}
          </StatusBadge>
          <StatusBadge tone={template.is_system ? "neutral" : "primary"}>
            {templateSourceLabel(template)}
          </StatusBadge>
          {!template.is_active ? (
            <StatusBadge tone="warning">Inactive</StatusBadge>
          ) : null}
          <SecondaryButton
            type="button"
            onClick={() => onEdit(template)}
            aria-label={`Edit ${template.name}`}
          >
            <Pencil size={15} />
            Edit
          </SecondaryButton>
        </div>
      </div>
      {template.subject_template ? (
        <p className="text-xs text-muted-foreground">
          Subject: {template.subject_template}
        </p>
      ) : null}
      <p className="text-xs leading-5 text-muted-foreground">
        {template.body_template}
      </p>
      {template.notes ? (
        <p className="text-xs text-muted-foreground">{template.notes}</p>
      ) : null}
      {template.action_label || template.action_url_template ? (
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {template.action_label ? (
            <span>Action {template.action_label}</span>
          ) : null}
          {template.action_url_template ? (
            <span>{template.action_url_template}</span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function OutboundLogPanel({
  events,
  guardrails,
  isLoading,
  error,
  allMode,
  entityNameById,
  onCopy,
  onDownload,
  copyReceipt,
  downloadDisabled,
}: {
  events: CommsCorrespondenceEventRecord[];
  guardrails: string[];
  isLoading: boolean;
  error: unknown;
  allMode: boolean;
  entityNameById: Map<string, string>;
  onCopy: (download: OutboundLogDownload) => void | Promise<void>;
  onDownload: (download: OutboundLogDownload) => void;
  copyReceipt: string | null;
  downloadDisabled: boolean;
}) {
  const [selectedOutboundFilter, setSelectedOutboundFilter] =
    useState<OutboundLogFilter>("all");
  const counts = useMemo(() => {
    const tally: Record<OutboundLogFilter, number> = {
      all: events.length,
      attention: 0,
      email: 0,
      sms: 0,
    };
    for (const event of events) {
      if (isAttentionOutboundStatus(event.status)) tally.attention += 1;
      if (event.channel === "email") tally.email += 1;
      if (event.channel === "sms") tally.sms += 1;
    }
    return tally;
  }, [events]);
  const filteredEvents = useMemo(
    () =>
      events.filter((event) =>
        matchesOutboundLogFilter(event, selectedOutboundFilter),
      ),
    [events, selectedOutboundFilter],
  );
  const countLabel = `${events.length} dispatch ${
    events.length === 1 ? "receipt" : "receipts"
  }`;
  const selectedFilterLabel = OUTBOUND_LOG_FILTER_LABEL[selectedOutboundFilter];
  const filterSummaryLabel =
    selectedOutboundFilter === "all"
      ? `Showing all ${events.length} dispatch ${
          events.length === 1 ? "receipt" : "receipts"
        }.`
      : `Showing ${filteredEvents.length} of ${events.length} dispatch receipts in ${selectedFilterLabel}.`;
  const isDownloadDisabled =
    downloadDisabled || filteredEvents.length === 0 || isLoading || Boolean(error);
  const outboundLogExport: OutboundLogDownload = {
    events: filteredEvents,
    filterLabel:
      selectedOutboundFilter === "all" ? "All" : selectedFilterLabel,
    totalEvents: events.length,
  };
  return (
    <SectionPanel
      title="Outbound log"
      description="Recent dispatch receipts from stored comms audit history."
      icon={<Send size={17} />}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="neutral">{countLabel}</StatusBadge>
          <SecondaryButton
            type="button"
            onClick={() => {
              void onCopy(outboundLogExport);
            }}
            disabled={isDownloadDisabled}
          >
            <Copy size={15} />
            Copy outbound log CSV
          </SecondaryButton>
          <SecondaryButton
            type="button"
            onClick={() => onDownload(outboundLogExport)}
            disabled={isDownloadDisabled}
          >
            <Download size={15} />
            Download outbound log CSV
          </SecondaryButton>
          {copyReceipt ? (
            <StatusBadge tone="success">{copyReceipt}</StatusBadge>
          ) : null}
        </div>
      }
    >
      {isLoading ? (
        <div className="p-4">
          <SkeletonRows rows={2} />
        </div>
      ) : null}
      {error ? (
        <p className="m-4 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          {friendlyError(error)}
        </p>
      ) : null}
      {!isLoading && !error && events.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">
          No dispatch receipts recorded yet.
        </div>
      ) : null}
      {!isLoading && !error && events.length > 0 ? (
        <div className="border-b border-border bg-muted/10 px-4 py-3">
          <div
            className="flex flex-wrap gap-2"
            role="tablist"
            aria-label="Filter outbound receipts"
          >
            {OUTBOUND_LOG_FILTERS.map((filter) => (
              <CommsFilterButton
                key={filter}
                active={selectedOutboundFilter === filter}
                label={OUTBOUND_LOG_FILTER_LABEL[filter]}
                count={counts[filter]}
                onClick={() => setSelectedOutboundFilter(filter)}
              />
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {filterSummaryLabel}
          </p>
        </div>
      ) : null}
      {!isLoading &&
      !error &&
      events.length > 0 &&
      filteredEvents.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">
          No dispatch receipts in this view.
        </div>
      ) : null}
      {!isLoading && !error && filteredEvents.length > 0 ? (
        <div className="divide-y divide-border">
          {filteredEvents.map((event) => {
            const targetLink = commsTargetLink(event);
            const occurredLabel = formatDateTime(event.occurred_at);
            return (
              <div
                key={event.id}
                className="grid gap-2 p-4 text-sm"
                data-testid="outbound-log-event"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">
                      {event.summary ?? event.event_type}
                    </p>
                    {allMode ? (
                      <p className="mt-1 text-leasium-micro font-semibold uppercase text-muted-foreground">
                        {entityNameById.get(event.id) ?? "Unknown entity"}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {commsEventKindLabel(event)}
                      {event.recipient ? ` to ${event.recipient}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      tone={event.channel === "sms" ? "primary" : "neutral"}
                    >
                      {commsEventChannelLabel(event)}
                    </StatusBadge>
                    {event.status ? (
                      <StatusBadge tone={commsEventStatusTone(event.status)}>
                        {event.status}
                      </StatusBadge>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {event.provider ? <span>Provider {event.provider}</span> : null}
                  {occurredLabel ? <span>{occurredLabel}</span> : null}
                  {commsTargetValue(event) ? (
                    <span>{commsTargetValue(event)}</span>
                  ) : null}
                </div>
                {targetLink ? (
                  <div>
                    <Link
                      href={targetLink.href}
                      className="inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-xs font-semibold text-primary hover:text-primary-hover"
                    >
                      <ExternalLink size={13} />
                      {targetLink.label}
                    </Link>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {guardrails.length > 0 ? (
        <div className="border-t border-border bg-muted/20 px-4 py-3">
          {guardrails.map((guardrail) => (
            <p key={guardrail} className="text-xs text-muted-foreground">
              {guardrail}
            </p>
          ))}
        </div>
      ) : null}
    </SectionPanel>
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
      className={`inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm font-medium transition ${
        active
          ? "border-primary bg-primary text-primary-foreground shadow-leasiumXs"
          : "border-border bg-muted/20 text-muted-foreground hover:border-primary/40 hover:text-foreground"
      }`}
    >
      <span>{label}</span>
      <span
        className={`rounded-full px-2 py-0.5 text-leasium-micro font-semibold ${
          active ? "bg-white text-primary-pressed" : "bg-white text-muted-foreground"
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
  template,
  allMode,
  entityName,
  onSettled,
}: {
  candidate: CommsCandidateRecord;
  entityId: string;
  template: BrandedCommunicationTemplateRecord | null;
  allMode: boolean;
  entityName: string | null;
  onSettled: (candidateId: string) => void;
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
  const [dismissedUntil, setDismissedUntil] = useState<string | null>(null);
  const [templatePreview, setTemplatePreview] =
    useState<CommsTemplatePreviewRecord | null>(null);
  const approvalBlockerId = useId();
  const canPreviewTemplate = Boolean(template && !allMode && !isSms);
  const templateLabel = template
    ? `Template ${template.key} ${template.version}`
    : null;
  const templateMatchLabel = template
    ? `${KIND_LABEL[candidate.kind]} maps to ${template.key} · ${template.version}`
    : null;
  const previewMutation = useMutation({
    mutationFn: () => {
      if (!template) {
        throw new Error("No stored template is available for this draft.");
      }
      return previewCommsTemplate({
        kind: candidate.kind,
        target_kind: candidate.target_kind,
        target_id: candidate.target_id,
        related_target_ids: candidate.related_target_ids ?? [],
        template_key: template.key,
        template_version: template.version,
        channel,
      });
    },
    onSuccess: (preview) => {
      setTemplatePreview(preview);
    },
  });

  const dispatchMutation = useMutation({
    mutationFn: () =>
      dispatchCommsDraft({
        kind: candidate.kind,
        target_kind: candidate.target_kind,
        target_id: candidate.target_id,
        related_target_ids: candidate.related_target_ids ?? [],
        subject: isSms ? candidate.subject : subject,
        body,
        recipient_email: isSms ? null : recipientEmail || null,
        recipient_phone: isSms ? recipientPhone || null : null,
        template_key: template?.key ?? null,
        template_version: template?.version ?? null,
        original_subject: candidate.subject,
        original_body: candidate.body,
      }),
    onSuccess: (result) => {
      setDispatchedStatus(result.status);
      onSettled(candidate.id);
    },
  });

  const dismissMutation = useMutation({
    mutationFn: () =>
      dismissCommsCandidate({
        kind: candidate.kind,
        target_kind: candidate.target_kind,
        target_id: candidate.target_id,
        related_target_ids: candidate.related_target_ids ?? [],
      }),
    onSuccess: (result) => {
      setDismissedUntil(result.deferred_until);
      onSettled(candidate.id);
    },
  });

  const dispatchError = dispatchMutation.error as Error | null;
  const dismissError = dismissMutation.error as Error | null;
  const previewError = previewMutation.error as Error | null;
  const actionPending = dispatchMutation.isPending || dismissMutation.isPending;
  const draftSettled = Boolean(dispatchedStatus) || Boolean(dismissedUntil);
  const draftInputsDisabled = actionPending || draftSettled;
  const tone = SEVERITY_TONE[candidate.severity];
  const providerName = isSms ? "Twilio" : "SendGrid";
  const originalRecipient = isSms
    ? candidate.recipient_phone ?? ""
    : candidate.recipient_email ?? "";
  const currentRecipient = isSms ? recipientPhone : recipientEmail;
  const draftEdited =
    body !== candidate.body ||
    currentRecipient !== originalRecipient ||
    (!isSms && subject !== candidate.subject);
  const resetDraft = () => {
    setSubject(candidate.subject);
    setBody(candidate.body);
    if (isSms) {
      setRecipientPhone(candidate.recipient_phone ?? "");
    } else {
      setRecipientEmail(candidate.recipient_email ?? "");
    }
  };
  const recipientReady = isSms
    ? Boolean(recipientPhone.trim())
    : Boolean(recipientEmail.trim());
  const dispatchBlockers = [
    !recipientReady
      ? `Add a ${isSms ? "phone" : "email"} recipient before approving.`
      : null,
    !body.trim() ? "Add a message body before approving." : null,
    !isSms && !subject.trim() ? "Add a subject before approving." : null,
  ].filter((blocker): blocker is string => Boolean(blocker));
  const dispatchBlocked = dispatchBlockers.length > 0;
  const smsBodyLength = body.length;
  const smsBodyOverGuide = smsBodyLength > SMS_SINGLE_SEGMENT_GUIDE;
  const dueLabel = formatDateTime(candidate.due_at);
  const generatedLabel = formatDateTime(candidate.generated_at);
  const handoffLink = commsCandidateTargetLink(candidate);
  const dismissedUntilLabel = formatDateTime(dismissedUntil);
  const dispatchReceiptLabel =
    dispatchedStatus === "skipped"
      ? `${isSms ? "SMS" : "Email"} send skipped`
      : `${isSms ? "SMS" : "Email"} dispatch recorded`;
  const dispatchReceiptDetail = `${providerName} ${isSms ? "SMS" : "email"} to ${currentRecipient.trim()}`;
  const settledBadge = dismissedUntil
    ? { label: "Deferred", tone: "neutral" as const }
    : dispatchedStatus === "skipped"
      ? { label: "Send skipped", tone: "warning" as const }
      : dispatchedStatus
        ? { label: "Dispatch recorded", tone: "success" as const }
        : null;
  const actionGuidance = draftSettled
    ? "This draft is locked because a dispatch or dismiss receipt has been recorded."
    : `Approve sends the ${isSms ? "SMS" : "email"} through ${providerName}.${
        isSms
          ? " Edit body or recipient before approving."
          : " Edit subject, body, or recipient before approving."
      }`;

  // Evidence-attach lives on compliance obligations only. Smart Intake is
  // the recommended path (AI extracts metadata + attributes the document);
  // the manual file picker is a last-resort fallback so operators don't
  // need to navigate elsewhere mid-flow.
  const showEvidencePanel = candidate.kind === "compliance_obligation";
  const complianceSourceIds = complianceCandidateSourceIds(candidate);
  const relatedTargetCount = complianceSourceIds.length;
  const groupedComplianceEvidence =
    candidate.kind === "compliance_obligation" && complianceSourceIds.length > 1;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [evidenceFilename, setEvidenceFilename] = useState<string | null>(null);
  const evidenceMutation = useMutation({
    mutationFn: (file: File) =>
      uploadDocument({
        entityId,
        tenantId: candidate.tenant_id ?? undefined,
        obligationId:
          candidate.kind === "compliance_obligation" &&
          candidate.target_kind === "obligation" &&
          !groupedComplianceEvidence
            ? candidate.target_id
            : undefined,
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
          {allMode && entityName ? (
            <span className="text-leasium-micro font-semibold uppercase text-muted-foreground">
              {entityName}
            </span>
          ) : null}
          <StatusBadge tone={isSms ? "primary" : "neutral"}>
            {isSms ? "Twilio SMS" : "SendGrid email"}
          </StatusBadge>
          {draftEdited ? (
            <StatusBadge tone="warning">Edited draft</StatusBadge>
          ) : null}
          {templateLabel ? (
            <StatusBadge tone="neutral">{templateLabel}</StatusBadge>
          ) : null}
          {settledBadge ? (
            <StatusBadge tone={settledBadge.tone}>{settledBadge.label}</StatusBadge>
          ) : null}
          <StatusBadge tone={tone}>{SEVERITY_LABEL[candidate.severity]}</StatusBadge>
          {candidate.detail ? (
            <span className="text-xs text-muted-foreground">{candidate.detail}</span>
          ) : null}
        </div>
      }
    >
      <div className="grid gap-3 p-4">
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {dueLabel ? (
            <span className="rounded-full border border-border bg-muted/30 px-2.5 py-1">
              Due {dueLabel}
            </span>
          ) : null}
          {generatedLabel ? (
            <span className="rounded-full border border-border bg-muted/30 px-2.5 py-1">
              Drafted {generatedLabel}
            </span>
          ) : null}
          {handoffLink ? (
            <Link
              href={handoffLink.href}
              className="inline-flex min-h-11 items-center justify-center gap-1 rounded-full border border-primary/30 bg-primary-soft px-3 font-medium text-primary-hover transition hover:border-primary/50 hover:bg-primary/10"
            >
              {handoffLink.label}
              <ExternalLink size={12} />
            </Link>
          ) : null}
        </div>

        {dispatchedStatus ? (
          <div
            className="flex items-center gap-2 rounded-md border border-success-strong/30 bg-success-soft px-3 py-2 text-sm text-success-strong"
            role="status"
            aria-live="polite"
          >
            <CheckCircle2 size={16} />
            {dispatchReceiptLabel} — status{" "}
            <strong>{dispatchedStatus}</strong>.
            <span className="text-xs"> {dispatchReceiptDetail}.</span>
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
        {dismissedUntilLabel ? (
          <div
            className="flex items-center gap-2 rounded-md border border-success-strong/30 bg-success-soft px-3 py-2 text-sm text-success-strong"
            role="status"
            aria-live="polite"
          >
            <CheckCircle2 size={16} />
            Draft deferred until <strong>{dismissedUntilLabel}</strong>.
          </div>
        ) : null}

        {canPreviewTemplate && template ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/15 bg-primary-soft px-3 py-3 text-sm">
            <div className="min-w-0">
              <p className="text-leasium-micro font-semibold uppercase text-primary-hover">
                Template match
              </p>
              <p className="mt-1 font-semibold text-foreground">
                {templateMatchLabel}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Preview is review-only; edited subject or body wins at approve
                time.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="primary">Email only</StatusBadge>
              <SecondaryButton
                type="button"
                className="border-primary/30 bg-white text-primary-hover hover:bg-primary/10"
                onClick={() => previewMutation.mutate()}
                disabled={previewMutation.isPending || draftSettled}
              >
                {previewMutation.isPending ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Sparkles size={15} />
                )}
                {previewMutation.isPending
                  ? "Previewing…"
                  : "Preview stored template"}
              </SecondaryButton>
            </div>
          </div>
        ) : null}

        <div
          className={
            canPreviewTemplate && template
              ? "grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,340px)] lg:items-start"
              : "grid gap-3"
          }
        >
          <div className="grid gap-3">
            <div
              className={
                isSms
                  ? "grid gap-3 md:grid-cols-[220px]"
                  : "grid gap-3 md:grid-cols-[1fr_220px]"
              }
            >
              {!isSms ? (
                <Field label="Subject">
                  <Input
                    value={subject}
                    onChange={(event) => setSubject(event.target.value)}
                    disabled={draftInputsDisabled}
                  />
                </Field>
              ) : null}
              <Field label={isSms ? "Phone recipient" : "Email recipient"}>
                <Input
                  type={isSms ? "tel" : "email"}
                  value={isSms ? recipientPhone : recipientEmail}
                  disabled={draftInputsDisabled}
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
                disabled={draftInputsDisabled}
                onChange={(event) => setBody(event.target.value)}
                className="min-h-[180px] w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none transition-colors duration-200 ease-leasium focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
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
          </div>

          {canPreviewTemplate && template ? (
            <div
              aria-label="Comms template preview"
              className="grid gap-3 rounded-md border border-border bg-white p-3 text-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-foreground">
                    Stored template output
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Generated from the current draft context.
                  </p>
                </div>
                <StatusBadge tone="success">Review-only</StatusBadge>
              </div>
              {templatePreview ? (
                <>
                  {templatePreview.subject ? (
                    <div>
                      <p className="text-leasium-micro font-semibold uppercase text-muted-foreground">
                        Subject
                      </p>
                      <p className="text-sm font-medium text-foreground">
                        {templatePreview.subject}
                      </p>
                    </div>
                  ) : null}
                  <div>
                    <p className="text-leasium-micro font-semibold uppercase text-muted-foreground">
                      Body
                    </p>
                    <p className="whitespace-pre-wrap text-sm text-foreground">
                      {templatePreview.body}
                    </p>
                  </div>
                  <div className="grid gap-1 rounded-md bg-muted/40 p-2">
                    {templatePreview.guardrails.map((guardrail) => (
                      <p
                        key={guardrail}
                        className="text-xs text-muted-foreground"
                      >
                        {guardrail}
                      </p>
                    ))}
                  </div>
                </>
              ) : (
                <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                  Preview stored template to compare the rendered subject and
                  body before approving any provider send.
                </div>
              )}
              {previewError ? (
                <p className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
                  <AlertTriangle size={16} />
                  {friendlyError(previewError)}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

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
            {groupedComplianceEvidence ? (
              <p className="rounded-md border border-warning-strong/30 bg-warning-soft px-3 py-2 text-xs text-warning-strong">
                This draft covers {relatedTargetCount} compliance items. Use
                Smart Intake or open Compliance Work to link evidence to the
                right source item; one-off manual attach is hidden for grouped
                drafts.
              </p>
            ) : null}
            {groupedComplianceEvidence ? (
              <div
                aria-label="Grouped compliance source items"
                className="flex flex-wrap gap-2"
              >
                {complianceSourceIds.map((obligationId, index) => (
                  <Link
                    key={obligationId}
                    href={complianceObligationHref(obligationId)}
                    className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-border bg-white px-3 text-xs font-semibold text-foreground transition hover:border-primary/50 hover:bg-primary-soft"
                  >
                    Open source item {index + 1}
                    <ExternalLink size={12} />
                  </Link>
                ))}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/intake"
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-primary/30 bg-primary px-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary-hover"
              >
                <Sparkles size={15} />
                Upload via Leasium AI
                <ExternalLink size={13} />
              </Link>
              {!groupedComplianceEvidence ? (
                <>
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
                    disabled={evidenceMutation.isPending || allMode}
                    title={
                      allMode ? "Select a single entity to send" : undefined
                    }
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
                </>
              ) : null}
            </div>
            {evidenceFilename ? (
              <p className="text-xs text-success-strong">
                Uploaded {evidenceFilename}. The file is stored against the
                tenant and linked to this compliance obligation for audit
                follow-up.
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
        {dispatchBlocked && !draftSettled ? (
          <div
            id={approvalBlockerId}
            className="grid gap-1 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning-foreground"
          >
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle size={16} />
              Approval needs review
            </div>
            {dispatchBlockers.map((blocker) => (
              <p key={blocker} className="text-xs">
                {blocker}
              </p>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {actionGuidance}
          </p>
          <div className="flex flex-wrap gap-2">
            {draftEdited && !draftSettled ? (
              <SecondaryButton
                type="button"
                onClick={resetDraft}
                disabled={actionPending}
              >
                <RotateCcw size={15} />
                Reset draft
              </SecondaryButton>
            ) : null}
            <SecondaryButton
              type="button"
              onClick={() => dismissMutation.mutate()}
              disabled={
                actionPending ||
                draftSettled ||
                allMode
              }
              title={allMode ? "Select a single entity to send" : undefined}
            >
              <X size={15} />
              Dismiss
            </SecondaryButton>
            <Button
              type="button"
              onClick={() => dispatchMutation.mutate()}
              aria-describedby={
                dispatchBlocked && !draftSettled
                  ? approvalBlockerId
                  : undefined
              }
              disabled={
                actionPending ||
                draftSettled ||
                dispatchBlocked ||
                allMode
              }
              title={allMode ? "Select a single entity to send" : undefined}
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
