"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  Bell,
  BellOff,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Copy,
  Download,
  ExternalLink,
  FileText,
  KeyRound,
  Loader2,
  MailCheck,
  Monitor,
  Moon,
  PlugZap,
  RefreshCw,
  SearchCheck,
  Send,
  ShieldCheck,
  Smartphone,
  Sun,
  Tags,
  UserPlus,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { AppHeader } from "@/components/app-shell";
import { OwnersDirectory } from "@/components/owners-directory";
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
  type StatusTone,
} from "@/components/ui";
import {
  APPEARANCE_CHANGED_EVENT,
  APPEARANCE_STORAGE_KEY,
  appearanceModeFromEvent,
  applyAppearancePreference,
  createAppearanceChangeEvent,
  labelAppearanceMode,
  readAppearancePreference,
  SYSTEM_DARK_QUERY,
  type AppearanceMode,
} from "@/lib/appearance";
import {
  applyBasiqReconciliation,
  applyXeroContactPreview,
  applyXeroPaymentReconciliation,
  approveXeroInvoicePosting,
  createSecurityMember,
  createXeroInvoiceDrafts,
  getApiHealth,
  getBasiqConnectionStatus,
  getSecurityWorkspace,
  getWorkAssignmentNotificationTemplates,
  getXeroConnectionDiagnostics,
  getXeroExceptionQueue,
  getIntegrationStatus,
  revokeBasiqConnection,
  startBasiqConnect,
  type ApiHealthRecord,
  type BasiqConnectionStatus,
  type BasiqConnectStart,
  type BasiqImportedTransaction,
  type BasiqReconciliationResponse,
  type IntegrationStatusRecord,
  type OperatingMode,
  type ProviderStatusRecord,
  getPaymentInstructions,
  getXeroStatus,
  applyOwnershipSplit,
  entityTypeLabel,
  getEntitiesXeroOverview,
  getOwnershipSplitPlan,
  listBrandedCommunicationTemplates,
  listEntities,
  listProperties,
  previewBasiqReconciliation,
  previewXeroChartTaxValidation,
  previewXeroContactSync,
  previewXeroInvoicePosting,
  previewXeroPaymentReconciliation,
  resendSecurityMemberInvite,
  setOperatingMode,
  startXeroOAuth,
  updatePaymentInstructions,
  updateSecurityMember,
  updateChargeRule,
  unlinkSecurityMemberLogin,
  updateXeroConnection,
  type XeroContactApplyPreviewRecord,
  type XeroChartTaxValidationPreviewRecord,
  type XeroChartTaxValidationResultRecord,
  type XeroContactMatchRecord,
  type XeroContactSyncPreviewRecord,
  type XeroExceptionQueueRecord,
  type XeroExceptionQueueItemRecord,
  type XeroInvoiceDraftCreateRecord,
  type XeroInvoiceDraftCreateResultRecord,
  type XeroInvoicePostingApprovalRecord,
  type XeroInvoicePostingPreviewRecord,
  type XeroInvoicePostingPreviewResultRecord,
  type XeroPaymentReconciliationRecord,
  type XeroPaymentReconciliationResultRecord,
  type XeroAccountingFreshnessRecord,
  type XeroConnectionDiagnosticsRecord,
  type BrandedCommunicationTemplateRecord,
  type SecurityMemberRecord,
  type SecurityMemberUpdatePayload,
  type SecurityNotificationPreferences,
  type SecurityRole,
  type SecurityRoleAssignment,
  type SecurityWorkAssignmentDigestCadence,
  type XeroMappingIssueRecord,
  type XeroReadinessSummaryRecord,
  type EntityXeroStatusValue,
  type OwnershipSplitApplyResult,
  type WorkAssignmentNotificationTemplateCatalogRecord,
  type WorkAssignmentNotificationTemplateKind,
  type WorkAssignmentNotificationTemplateRecord,
  type PaymentInstructionPayload,
  type PaymentInstructionRecord,
} from "@/lib/api";
import { csvCell } from "@/lib/csv";
import { saveBlob } from "@/lib/download";
import {
  ownershipChipClassName,
  propertyOwnershipTagDirectory,
} from "@/lib/property-ownership";
import { friendlyError } from "@/lib/utils";

const ENTITY_STORAGE_KEY = "leasium.entity_id";
const EMPTY_XERO_ISSUES: XeroMappingIssueRecord[] = [];
const EMPTY_BRANDED_TEMPLATES: BrandedCommunicationTemplateRecord[] = [];

type SettingsTab = "security" | "organisation" | "connect";
type PanelRef = { current: HTMLDivElement | null };
type NotificationTemplateDraft = {
  noticeKey: string;
  noticeVersion: string;
  digestKey: string;
  digestVersion: string;
};
type CommunicationTemplateCard = {
  id: string;
  title: string;
  audience: string;
  channel: "email" | "sms" | "portal";
  provider: string;
  templateKey: string;
  templateVersion: string;
  brand: string;
  subjectPreview: string;
  bodyPreview: string;
  actionLabel: string;
  receiptLabel: string;
  receiptEndpoint: string | null;
  receiptDetail: string;
  sourceLabel: string;
  tone: StatusTone;
};
type TemplateOverrideCoverage = {
  active: number;
  covered: string[];
  unmatched: string[];
};
type AccountingNextStep = {
  title: string;
  detail: string;
  tone: StatusTone;
  action: "exceptions" | "payments" | "billing" | null;
  actionLabel: string | null;
};
type XeroChargeRuleMappingInput = Pick<
  XeroMappingIssueRecord,
  | "id"
  | "charge_rule_id"
  | "current_account_code"
  | "current_tax_type"
  | "suggested_account_code"
  | "suggested_tax_type"
>;
type XeroCallbackFeedback =
  | { tone: "success"; title: "Xero connected"; detail: string }
  | {
      tone: "danger";
      title: "Xero connection needs attention";
      detail: string;
    };

const settingsTabs: Array<{
  id: SettingsTab;
  label: string;
  icon: ReactNode;
}> = [
  { id: "security", label: "Security", icon: <ShieldCheck size={15} /> },
  { id: "organisation", label: "Organisation", icon: <Building2 size={15} /> },
  { id: "connect", label: "Connect", icon: <PlugZap size={15} /> },
];

function EntityPropertiesList({ entityId }: { entityId: string }) {
  const query = useQuery({
    queryKey: ["entity-properties", entityId],
    queryFn: () => listProperties(entityId),
  });
  if (query.isLoading) {
    return (
      <div className="px-3 py-2 text-sm text-muted-foreground">
        Loading properties…
      </div>
    );
  }
  const properties = query.data ?? [];
  if (properties.length === 0) {
    return (
      <div className="px-3 py-2 text-sm text-muted-foreground">
        No properties under this entity yet.
      </div>
    );
  }
  return (
    <ul className="grid gap-1 px-3 py-2">
      {properties.map((property) => (
        <li
          key={property.id}
          className="flex flex-wrap items-baseline gap-2 text-sm"
        >
          <span className="font-medium text-foreground">{property.name}</span>
          <span className="text-muted-foreground">
            {[property.suburb, property.state].filter(Boolean).join(", ")}
          </span>
        </li>
      ))}
    </ul>
  );
}

const roleOptions: Array<{ value: SecurityRole; label: string }> = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "finance", label: "Finance" },
  { value: "ops", label: "Ops" },
  { value: "viewer", label: "Viewer" },
  { value: "agent", label: "Agent" },
];

const roleLabels = Object.fromEntries(
  roleOptions.map((option) => [option.value, option.label]),
) as Record<SecurityRole, string>;

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

function SettingsAppearancePanel() {
  const [mode, setMode] = useState<AppearanceMode>("system");
  const modeRef = useRef<AppearanceMode>("system");

  useEffect(() => {
    function syncPreference(event?: Event) {
      const nextMode = event
        ? (appearanceModeFromEvent(event) ?? readAppearancePreference())
        : readAppearancePreference();
      applyAppearancePreference(nextMode);
      modeRef.current = nextMode;
      setMode(nextMode);
    }
    function onStorage(event: StorageEvent) {
      if (event.key && event.key !== APPEARANCE_STORAGE_KEY) return;
      syncPreference();
    }
    function onSystemPreferenceChange() {
      if (modeRef.current === "system") syncPreference();
    }

    syncPreference();
    const mediaQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia(SYSTEM_DARK_QUERY)
        : null;
    window.addEventListener("storage", onStorage);
    window.addEventListener(APPEARANCE_CHANGED_EVENT, syncPreference);
    mediaQuery?.addEventListener("change", onSystemPreferenceChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(APPEARANCE_CHANGED_EVENT, syncPreference);
      mediaQuery?.removeEventListener("change", onSystemPreferenceChange);
    };
  }, []);

  const options: Array<{
    mode: AppearanceMode;
    label: string;
    icon: ReactNode;
  }> = [
    {
      mode: "system",
      label: "System",
      icon: <Monitor size={16} />,
    },
    {
      mode: "light",
      label: "Light",
      icon: <Sun size={16} />,
    },
    {
      mode: "dark",
      label: "Dark",
      icon: <Moon size={16} />,
    },
  ];

  function chooseAppearance(nextMode: AppearanceMode) {
    applyAppearancePreference(nextMode);
    modeRef.current = nextMode;
    setMode(nextMode);
    window.dispatchEvent(createAppearanceChangeEvent(nextMode));
  }

  const activeLabel = labelAppearanceMode(mode);

  return (
    <SectionPanel
      title="Appearance"
      description="Choose a workspace appearance or follow this device."
      className="max-w-3xl"
      icon={
        mode === "dark" ? (
          <Moon size={17} className="text-primary" />
        ) : mode === "system" ? (
          <Monitor size={17} className="text-primary" />
        ) : (
          <Sun size={17} className="text-primary" />
        )
      }
      actions={<StatusBadge tone="neutral">{activeLabel} active</StatusBadge>}
    >
      <div className="flex flex-wrap items-center gap-2 p-3">
        {options.map((option) => {
          const isActive = mode === option.mode;
          return (
            <button
              key={option.mode}
              type="button"
              aria-label={`${option.label} appearance${
                isActive ? " selected" : ""
              }`}
              aria-pressed={isActive}
              onClick={() => chooseAppearance(option.mode)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition hover:bg-muted/70 ${
                isActive
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-white text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.icon}
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </SectionPanel>
  );
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Not recorded";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

function formatCurrencyCents(value: number, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", {
    currency,
    style: "currency",
  }).format(value / 100);
}

function billingReadinessHandoffHref({
  entityId,
  invoiceDraftId,
  filter = "needs_action",
}: {
  entityId: string;
  invoiceDraftId: string | null | undefined;
  filter?: "needs_action" | "ready_dispatch" | "complete" | "unpaid";
}) {
  const params = new URLSearchParams({
    entity_id: entityId,
    tab: "delivery",
    filter,
  });
  if (invoiceDraftId) {
    params.set("invoice_id", invoiceDraftId);
  }
  return `/billing-readiness?${params.toString()}`;
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

function exceptionTone(issue: XeroExceptionQueueItemRecord): StatusTone {
  if (issue.severity === "blocker") {
    return "danger";
  }
  if (issue.severity === "warning") {
    return "warning";
  }
  return "neutral";
}

function exceptionKindLabel(kind: XeroExceptionQueueItemRecord["kind"]) {
  return kind.replaceAll("_", " ");
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ");
}

function providerLabel(value: string | null) {
  if (!value) {
    return null;
  }
  return value.toLowerCase() === "xero" ? "Xero" : statusLabel(value);
}

function cleanXeroCallbackError(value: string | null) {
  if (!value) {
    return "Xero did not return a detailed error.";
  }
  return value
    .replaceAll("+", " ")
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readyTone(summary: XeroReadinessSummaryRecord): StatusTone {
  if (summary.total === 0) {
    return "neutral";
  }
  return summary.missing === 0 ? "success" : "warning";
}

function accountingFreshnessTone(
  status: "ready" | "stale" | "missing" | "attention",
): StatusTone {
  if (status === "ready") {
    return "success";
  }
  if (status === "missing") {
    return "danger";
  }
  return "warning";
}

function accountingCheckpointRows(freshness: XeroAccountingFreshnessRecord) {
  return [
    ["Contact preview", freshness.last_contact_sync_at],
    ["Chart/tax validation", freshness.last_chart_tax_validation_at],
    ["Posting preview", freshness.last_invoice_posting_preview_at],
    ["Xero draft", freshness.last_invoice_draft_create_at],
    ["Provider dispatch", freshness.last_invoice_provider_dispatch_at],
    ["Payment preview", freshness.last_payment_reconciliation_preview_at],
    ["Payment apply", freshness.last_payment_reconciliation_apply_at],
  ] as const;
}

function diagnosticsReadinessRows(
  diagnostics: XeroConnectionDiagnosticsRecord,
) {
  return [
    ["OAuth", diagnostics.can_start_oauth],
    ["Contacts", diagnostics.can_preview_contacts],
    ["Chart/tax", diagnostics.can_validate_chart_tax],
    ["Invoice preview", diagnostics.can_preview_invoice_posting],
    ["Draft creation", diagnostics.can_create_xero_drafts],
    ["Payments", diagnostics.can_preview_payment_reconciliation],
  ] as const;
}

function diagnosticsReadinessDetailRows(
  diagnostics: XeroConnectionDiagnosticsRecord,
) {
  const providerMissing = diagnostics.missing_config.length
    ? `Missing provider config: ${diagnostics.missing_config.join(", ")}.`
    : "Set the required Xero API config before OAuth can start.";
  const providerBlocked =
    diagnostics.next_steps[0] ??
    "Your role or authorised scopes do not allow this provider action.";
  const connectionReasons: Record<string, string> = {
    Contacts: "Connect Xero before contact previews are available.",
    "Chart/tax": "Connect Xero before chart and tax validation is available.",
    "Invoice preview":
      "Connect Xero before invoice posting previews are available.",
    "Draft creation":
      "Connect Xero before provider previews and draft creation are available.",
    Payments:
      "Connect Xero before payment reconciliation previews are available.",
  };
  return diagnosticsReadinessRows(diagnostics).map(([label, ready]) => {
    let detail = "";
    if (ready) {
      detail =
        label === "OAuth"
          ? "Provider setup is ready for an explicit OAuth connection."
          : "Provider connection and authorised scopes allow this reviewed action.";
    } else if (!diagnostics.provider_configured) {
      detail = providerMissing;
    } else if (!diagnostics.connected) {
      detail =
        label === "OAuth"
          ? "Provider setup is ready; start OAuth when the operator approves."
          : (connectionReasons[label] ?? providerBlocked);
    } else if (label === "Draft creation") {
      detail =
        "Approve invoice drafts for Xero before creating provider drafts.";
    } else if (label === "Payments") {
      detail =
        "Create or link a Xero draft before reviewing provider payments.";
    } else {
      detail = providerBlocked;
    }
    return { label, ready, detail };
  });
}

function xeroProviderSetupPacket(diagnostics: XeroConnectionDiagnosticsRecord) {
  const preflight = diagnostics.provider_setup_preflight;
  return [
    "Xero provider setup packet",
    "",
    `Expected redirect URI: ${preflight.expected_redirect_uri}`,
    "",
    "Required env vars:",
    ...preflight.required_env_vars.map((envVar) => `- ${envVar}`),
    "",
    "Missing env vars:",
    ...(preflight.missing_env_vars.length
      ? preflight.missing_env_vars.map((envVar) => `- ${envVar}`)
      : ["- None"]),
    "",
    "Required scopes:",
    ...preflight.required_scopes.map((scope) => `- ${scope}`),
    "",
    "Setup checklist:",
    ...preflight.setup_checklist.map((step) => `- ${step}`),
    "",
    "Guardrails:",
    ...diagnostics.guardrails.map((guardrail) => `- ${guardrail}`),
  ].join("\n");
}

const DOCUSIGN_SETUP_PACKET_GUARDRAIL =
  "Review-only export: copying or downloading this packet does not call DocuSign, send envelopes, accept Connect events, download signed PDFs, activate leases, or mutate provider history.";

function docusignProviderSetupPacket(status: ProviderStatusRecord) {
  return [
    "DocuSign provider setup packet",
    "",
    `Status: ${status.live_ready ? "Live ready" : status.configured ? "Setup needed" : "Not configured"}`,
    `Detail: ${status.detail}`,
    "",
    `Webhook URL: ${status.webhook_url ?? "Set PUBLIC_API_URL on the API service to expose the Connect webhook URL."}`,
    "",
    "Required env vars:",
    "- DOCUSIGN_ACCOUNT_ID",
    "- DOCUSIGN_INTEGRATION_KEY",
    "- DOCUSIGN_USER_ID",
    "- DOCUSIGN_RSA_PRIVATE_KEY",
    "- DOCUSIGN_WEBHOOK_SECRET",
    "- PUBLIC_API_URL",
    "",
    "Missing production setup:",
    ...(status.missing_config.length
      ? status.missing_config.map((envVar) => `- ${envVar}`)
      : ["- None"]),
    "",
    "Production endpoints:",
    "- Set DOCUSIGN_BASE_URL=https://www.docusign.net/restapi for live envelopes.",
    "- Set DOCUSIGN_AUTH_BASE_URL=https://account.docusign.com for live JWT grants.",
    "",
    "DocuSign Connect:",
    "- Subscribe to completed envelope events.",
    "- Send DOCUSIGN_WEBHOOK_SECRET as x-docusign-webhook-secret or token query parameter.",
    "- Keep signer, envelope, and custom-field review in Leasium before activating leases.",
    "",
    "Guardrails:",
    `- ${DOCUSIGN_SETUP_PACKET_GUARDRAIL}`,
  ].join("\n");
}

const XERO_DIAGNOSTICS_EXPORT_GUARDRAIL =
  "Review-only export: downloading this file does not start OAuth, call or refresh Xero, preview or apply payment reconciliation, create Xero drafts, dispatch invoices or providers, send email or SMS, refresh providers, or mutate provider history.";

function xeroConnectionDiagnosticsPacket(
  diagnostics: XeroConnectionDiagnosticsRecord,
) {
  const preflight = diagnostics.provider_setup_preflight;
  return [
    "Xero connection diagnostics packet",
    "",
    `Entity: ${diagnostics.entity_name}`,
    `Connection source: ${statusLabel(diagnostics.connection_source)}`,
    `Tenant ID: ${diagnostics.xero_tenant_id ?? "Missing"}`,
    `Tenant name: ${diagnostics.tenant_name ?? "Missing"}`,
    `Token expires: ${
      diagnostics.token_expires_at
        ? formatDateTime(diagnostics.token_expires_at)
        : "No provider token"
    }`,
    "",
    "Local readiness check:",
    ...diagnosticsReadinessDetailRows(diagnostics).map(
      ({ label, ready, detail }) =>
        `- ${label}: ${ready ? "Ready" : "Blocked"} - ${detail}`,
    ),
    "",
    "Provider setup:",
    `- Provider configured: ${diagnostics.provider_configured ? "Ready" : "Blocked"}`,
    `- Missing config: ${
      diagnostics.missing_config.length
        ? diagnostics.missing_config.join(", ")
        : "None"
    }`,
    `- Redirect URI: ${diagnostics.redirect_uri}`,
    `- Expected redirect URI: ${preflight.expected_redirect_uri}`,
    "",
    "Required env vars:",
    ...preflight.required_env_vars.map((envVar) => `- ${envVar}`),
    "",
    "Missing env vars:",
    ...(preflight.missing_env_vars.length
      ? preflight.missing_env_vars.map((envVar) => `- ${envVar}`)
      : ["- None"]),
    "",
    "Required scopes:",
    ...preflight.required_scopes.map((scope) => `- ${scope}`),
    "",
    "Next steps:",
    ...(diagnostics.next_steps.length
      ? diagnostics.next_steps.map((step) => `- ${step}`)
      : ["- None"]),
    "",
    "Guardrails:",
    ...diagnostics.guardrails.map((guardrail) => `- ${guardrail}`),
    `- ${XERO_DIAGNOSTICS_EXPORT_GUARDRAIL}`,
  ].join("\n");
}

const XERO_EXCEPTION_EXPORT_GUARDRAIL =
  "No Xero API refresh, invoice posting, tenant email, provider dispatch, or payment reconciliation is run by this export.";
const XERO_FRESHNESS_EXPORT_GUARDRAIL =
  "Review-only export: downloading this file does not refresh Xero, preview or apply payment reconciliation, create Xero drafts, dispatch invoices, send email or SMS, refresh providers, or mutate provider history.";
const TEMPLATE_OVERRIDE_EXPORT_GUARDRAIL =
  "Review-only export: downloading this file does not wire stored templates into send paths, edit templates, send notifications, run digests, send invoices, send tenant onboarding messages, send contractor updates, mutate preferences, or write provider history.";

function xeroExceptionRecordLine(issue: XeroExceptionQueueItemRecord) {
  return [
    issue.property_name,
    issue.unit_label,
    issue.tenant_name,
    issue.invoice_number ?? issue.invoice_title,
    issue.total_cents !== null
      ? formatCurrencyCents(issue.total_cents, issue.currency ?? "AUD")
      : null,
  ]
    .filter(Boolean)
    .join(" / ");
}

function xeroExceptionReviewPacket(queue: XeroExceptionQueueRecord) {
  return [
    "Xero exception review packet",
    `Generated: ${formatDateTime(queue.generated_at)}`,
    `${queue.summary.total} open exceptions (${queue.summary.blockers} blockers, ${queue.summary.warnings} warnings, ${queue.summary.info} info)`,
    "",
    "Guardrails:",
    `- ${XERO_EXCEPTION_EXPORT_GUARDRAIL}`,
    ...queue.guardrails.map((guardrail) => `- ${guardrail}`),
    "",
    "Exceptions:",
    ...(queue.items.length
      ? queue.items.map((issue) =>
          [
            `- ${issue.label} [${issue.severity} / ${exceptionKindLabel(issue.kind)}]`,
            issue.detail,
            `Next action: ${issue.action}`,
            xeroExceptionRecordLine(issue)
              ? `Record: ${xeroExceptionRecordLine(issue)}`
              : null,
            issue.charge_rule_id
              ? `Mapping: account ${issue.current_account_code ?? "-"} -> ${issue.suggested_account_code ?? "-"}; tax ${issue.current_tax_type ?? "-"} -> ${issue.suggested_tax_type ?? "-"}`
              : null,
            issue.xero_invoice_id
              ? `Xero invoice: ${issue.xero_invoice_id}`
              : null,
            issue.provider_status
              ? `Provider status: ${issue.provider_status}`
              : null,
            issue.retry_count ? `Retry count: ${issue.retry_count}` : null,
          ]
            .filter(Boolean)
            .join("\n  "),
        )
      : ["- No Xero sync exceptions."]),
  ].join("\n");
}

function xeroExceptionCsv(queue: XeroExceptionQueueRecord) {
  const rows: Array<Array<string | number | null | undefined>> = [
    [
      "Severity",
      "Kind",
      "Label",
      "Detail",
      "Next action",
      "Property",
      "Unit",
      "Tenant",
      "Invoice",
      "Amount",
      "Current account",
      "Suggested account",
      "Current tax",
      "Suggested tax",
      "Posting status",
      "Provider",
      "Provider status",
      "Xero invoice ID",
      "Receipt time",
      "Retry count",
      "Guardrail",
    ],
    ...queue.items.map((issue) => [
      issue.severity,
      exceptionKindLabel(issue.kind),
      issue.label,
      issue.detail,
      issue.action,
      issue.property_name,
      issue.unit_label,
      issue.tenant_name,
      issue.invoice_number ?? issue.invoice_title,
      issue.total_cents !== null
        ? formatCurrencyCents(issue.total_cents, issue.currency ?? "AUD")
        : "",
      issue.current_account_code,
      issue.suggested_account_code,
      issue.current_tax_type,
      issue.suggested_tax_type,
      issue.external_posting_status ?? issue.xero_status,
      issue.provider,
      issue.provider_status,
      issue.xero_invoice_id,
      issue.received_at,
      issue.retry_count,
      XERO_EXCEPTION_EXPORT_GUARDRAIL,
    ]),
  ];
  if (!queue.items.length) {
    rows.push([
      "info",
      "clear",
      "No Xero sync exceptions",
      "Approved drafts, provider receipts, and reconciliation state are clear.",
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
      "",
      "",
      "",
      "",
      XERO_EXCEPTION_EXPORT_GUARDRAIL,
    ]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function xeroConnectionDiagnosticsCsv(
  diagnostics: XeroConnectionDiagnosticsRecord,
) {
  const preflight = diagnostics.provider_setup_preflight;
  const rows: Array<Array<string | number | null | undefined>> = [
    ["Section", "Item", "Status", "Metric", "Detail", "Guardrail"],
    [
      "Connection diagnostics",
      "Local readiness check",
      diagnostics.connected ? "Ready" : "Blocked",
      diagnostics.connection_source,
      diagnostics.entity_name,
      XERO_DIAGNOSTICS_EXPORT_GUARDRAIL,
    ],
    [
      "Connection diagnostics",
      "Provider setup",
      diagnostics.provider_configured ? "Ready" : "Blocked",
      diagnostics.missing_config.length
        ? diagnostics.missing_config.join("; ")
        : "No missing config",
      diagnostics.redirect_uri,
      XERO_DIAGNOSTICS_EXPORT_GUARDRAIL,
    ],
    [
      "Connection diagnostics",
      "Tenant",
      diagnostics.xero_tenant_id ? "Ready" : "Blocked",
      diagnostics.xero_tenant_id,
      diagnostics.tenant_name,
      XERO_DIAGNOSTICS_EXPORT_GUARDRAIL,
    ],
    [
      "Connection diagnostics",
      "Token expiry",
      diagnostics.token_expires_at ? "Ready" : "Blocked",
      diagnostics.token_expires_at
        ? formatDateTime(diagnostics.token_expires_at)
        : "No provider token",
      "",
      XERO_DIAGNOSTICS_EXPORT_GUARDRAIL,
    ],
    ...diagnosticsReadinessDetailRows(diagnostics).map(
      ({ label, ready, detail }) => [
        "Readiness gate",
        label,
        ready ? "Ready" : "Blocked",
        ready ? "Available" : "Disabled",
        detail,
        XERO_DIAGNOSTICS_EXPORT_GUARDRAIL,
      ],
    ),
    ...preflight.required_env_vars.map((envVar) => [
      "Required env var",
      envVar,
      preflight.missing_env_vars.includes(envVar) ? "Blocked" : "Ready",
      preflight.missing_env_vars.includes(envVar) ? "Missing" : "Present",
      "",
      XERO_DIAGNOSTICS_EXPORT_GUARDRAIL,
    ]),
    ...(preflight.missing_env_vars.length
      ? preflight.missing_env_vars.map((envVar) => [
          "Missing config",
          envVar,
          "Blocked",
          "Missing",
          "",
          XERO_DIAGNOSTICS_EXPORT_GUARDRAIL,
        ])
      : [
          [
            "Missing config",
            "None",
            "Ready",
            "No missing config",
            "",
            XERO_DIAGNOSTICS_EXPORT_GUARDRAIL,
          ],
        ]),
    [
      "Redirect URI",
      "Expected redirect URI",
      "Ready",
      preflight.expected_redirect_uri,
      diagnostics.redirect_uri,
      XERO_DIAGNOSTICS_EXPORT_GUARDRAIL,
    ],
    ...preflight.required_scopes.map((scope) => [
      "Required scope",
      scope,
      diagnostics.scopes.includes(scope) ? "Ready" : "Blocked",
      diagnostics.scopes.includes(scope) ? "Authorised" : "Missing",
      "",
      XERO_DIAGNOSTICS_EXPORT_GUARDRAIL,
    ]),
    ...diagnostics.next_steps.map((step) => [
      "Next step",
      step,
      "",
      "",
      "",
      XERO_DIAGNOSTICS_EXPORT_GUARDRAIL,
    ]),
    ...diagnostics.guardrails.map((guardrail) => [
      "Diagnostics guardrail",
      guardrail,
      "",
      "",
      "",
      XERO_DIAGNOSTICS_EXPORT_GUARDRAIL,
    ]),
    [
      "Export guardrail",
      "Review-only",
      "",
      "",
      XERO_DIAGNOSTICS_EXPORT_GUARDRAIL,
      XERO_DIAGNOSTICS_EXPORT_GUARDRAIL,
    ],
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function xeroAccountingFreshnessCsv({
  freshness,
  nextStep,
}: {
  freshness: XeroAccountingFreshnessRecord;
  nextStep: AccountingNextStep | null;
}) {
  const rows: Array<Array<string | number | null | undefined>> = [
    ["Section", "Item", "Status", "Metric", "Detail", "Guardrail"],
    [
      "Accounting freshness",
      "Summary",
      statusLabel(freshness.status),
      freshness.stale_reconciliation
        ? `Reconciliation stale after ${freshness.stale_after_days} days`
        : "Reconciliation current",
      freshness.summary,
      XERO_FRESHNESS_EXPORT_GUARDRAIL,
    ],
    [
      "Accounting freshness",
      "Readiness",
      statusLabel(freshness.source),
      `${freshness.readiness_issue_count} issues / ${freshness.readiness_blocker_count} blockers / ${freshness.readiness_warning_count} warnings`,
      `${freshness.approved_unsynced_invoice_count} approved unsynced invoices`,
      XERO_FRESHNESS_EXPORT_GUARDRAIL,
    ],
    [
      "Payment cue",
      "Xero-linked open invoices",
      freshness.stale_reconciliation ? "Stale" : "Current",
      freshness.xero_linked_open_invoice_count,
      freshness.last_payment_reconciliation_at
        ? `Last reconciliation ${formatDateTime(freshness.last_payment_reconciliation_at)}`
        : "No payment reconciliation applied",
      XERO_FRESHNESS_EXPORT_GUARDRAIL,
    ],
    [
      "Payment cue",
      "Payment source",
      freshness.last_payment_reconciliation_source
        ? statusLabel(freshness.last_payment_reconciliation_source)
        : "Missing",
      freshness.last_payment_reconciliation_mode
        ? statusLabel(freshness.last_payment_reconciliation_mode)
        : "Missing",
      "Local payment metadata only.",
      XERO_FRESHNESS_EXPORT_GUARDRAIL,
    ],
    ...accountingCheckpointRows(freshness).map(([checkpoint, value]) => [
      "Checkpoint",
      checkpoint,
      value ? "Recorded" : "Missing",
      value ? formatDateTime(value) : "No timestamp",
      "",
      XERO_FRESHNESS_EXPORT_GUARDRAIL,
    ]),
    ...(nextStep
      ? [
          [
            "Next accounting step",
            nextStep.title,
            nextStep.actionLabel,
            nextStep.action,
            nextStep.detail,
            XERO_FRESHNESS_EXPORT_GUARDRAIL,
          ],
        ]
      : []),
    ...freshness.guardrails.map((guardrail) => [
      "Freshness guardrail",
      guardrail,
      "",
      "",
      "",
      XERO_FRESHNESS_EXPORT_GUARDRAIL,
    ]),
    [
      "Export guardrail",
      "Review-only",
      "",
      "",
      XERO_FRESHNESS_EXPORT_GUARDRAIL,
      XERO_FRESHNESS_EXPORT_GUARDRAIL,
    ],
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function xeroAccountingFreshnessPacket({
  freshness,
  nextStep,
}: {
  freshness: XeroAccountingFreshnessRecord;
  nextStep: AccountingNextStep | null;
}) {
  return [
    "Xero accounting freshness packet",
    "",
    `Status: ${statusLabel(freshness.status)}`,
    `Summary: ${freshness.summary}`,
    freshness.stale_reconciliation
      ? `Reconciliation stale after ${freshness.stale_after_days} days`
      : "Reconciliation current",
    "",
    "Readiness:",
    `- ${freshness.readiness_issue_count} issues`,
    `- ${freshness.readiness_blocker_count} blockers`,
    `- ${freshness.readiness_warning_count} warnings`,
    `- ${freshness.approved_unsynced_invoice_count} approved unsynced invoices`,
    `- ${freshness.xero_linked_open_invoice_count} Xero-linked open invoices`,
    "",
    "Checkpoints:",
    ...accountingCheckpointRows(freshness).map(
      ([checkpoint, value]) =>
        `- ${checkpoint}: ${value ? formatDateTime(value) : "No timestamp"}`,
    ),
    "",
    "Payment reconciliation:",
    `- Last reconciliation: ${
      freshness.last_payment_reconciliation_at
        ? formatDateTime(freshness.last_payment_reconciliation_at)
        : "No payment reconciliation applied"
    }`,
    `- Source: ${
      freshness.last_payment_reconciliation_source
        ? statusLabel(freshness.last_payment_reconciliation_source)
        : "Missing"
    }`,
    `- Mode: ${
      freshness.last_payment_reconciliation_mode
        ? statusLabel(freshness.last_payment_reconciliation_mode)
        : "Missing"
    }`,
    "",
    "Next accounting step:",
    nextStep
      ? `- ${nextStep.title}: ${nextStep.detail}`
      : "- No next step available.",
    "",
    "Guardrails:",
    ...freshness.guardrails.map((guardrail) => `- ${guardrail}`),
    `- ${XERO_FRESHNESS_EXPORT_GUARDRAIL}`,
  ].join("\n");
}

function communicationTemplateOverrideCsv({
  runtimeTemplates,
  brandedTemplates,
}: {
  runtimeTemplates: CommunicationTemplateCard[];
  brandedTemplates: BrandedCommunicationTemplateRecord[];
}) {
  const runtimeTemplateKeys = new Set(
    runtimeTemplates.map((template) => template.templateKey),
  );
  const activeOverrideKeys = new Set(
    brandedTemplates
      .filter((template) => template.is_active)
      .map((template) => template.key),
  );
  const rows: Array<Array<string | number | null | undefined>> = [
    [
      "Category",
      "Template key",
      "Name",
      "Version",
      "Channel",
      "Provider",
      "State",
      "Coverage",
      "Detail",
      "Guardrail",
    ],
    ...runtimeTemplates.map((template) => [
      "Runtime template",
      template.templateKey,
      template.title,
      template.templateVersion,
      template.channel === "portal" ? "in_app" : template.channel,
      template.provider,
      template.sourceLabel,
      activeOverrideKeys.has(template.templateKey)
        ? "Runtime-aligned"
        : "Runtime only",
      template.actionLabel,
      TEMPLATE_OVERRIDE_EXPORT_GUARDRAIL,
    ]),
    ...brandedTemplates.map((template) => {
      const isRuntimeAligned = runtimeTemplateKeys.has(template.key);
      return [
        "Stored override",
        template.key,
        template.name,
        template.version,
        template.channel,
        template.provider,
        `${template.is_active ? "Active" : "Inactive"} ${
          template.is_system ? "system" : "override"
        }`,
        template.is_active
          ? isRuntimeAligned
            ? "Runtime-aligned"
            : "Needs wiring"
          : isRuntimeAligned
            ? "Inactive runtime-aligned"
            : "Inactive needs wiring",
        template.notes ?? template.body_template,
        TEMPLATE_OVERRIDE_EXPORT_GUARDRAIL,
      ];
    }),
    [
      "Export guardrail",
      "",
      "",
      "",
      "",
      "",
      "Review-only",
      "",
      TEMPLATE_OVERRIDE_EXPORT_GUARDRAIL,
      TEMPLATE_OVERRIDE_EXPORT_GUARDRAIL,
    ],
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

async function copyTextToClipboard(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the textarea copy path below.
    }
  }
  if (typeof document === "undefined") {
    return false;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

function accountingNextStep({
  freshness,
  exceptionBlockers,
  exceptionWarnings,
}: {
  freshness: XeroAccountingFreshnessRecord;
  exceptionBlockers: number;
  exceptionWarnings: number;
}): AccountingNextStep {
  if (freshness.readiness_blocker_count > 0 || exceptionBlockers > 0) {
    return {
      title: "Resolve accounting blockers",
      detail: `${freshness.readiness_blocker_count + exceptionBlockers} blocker${
        freshness.readiness_blocker_count + exceptionBlockers === 1 ? "" : "s"
      } need review before Xero-linked billing can be treated as ready.`,
      tone: "danger",
      action: "exceptions",
      actionLabel: "Review exception queue",
    };
  }
  if (freshness.approved_unsynced_invoice_count > 0) {
    return {
      title: "Create approved Xero drafts",
      detail: `${freshness.approved_unsynced_invoice_count} approved invoice${
        freshness.approved_unsynced_invoice_count === 1 ? "" : "s"
      } still need explicit Xero draft creation.`,
      tone: "warning",
      action: "exceptions",
      actionLabel: "Review Xero approvals",
    };
  }
  if (
    freshness.xero_linked_open_invoice_count > 0 &&
    (freshness.stale_reconciliation ||
      freshness.last_payment_reconciliation_at === null ||
      freshness.status === "missing")
  ) {
    return {
      title: "Review Xero-linked payments",
      detail: `${freshness.xero_linked_open_invoice_count} open Xero-linked invoice${
        freshness.xero_linked_open_invoice_count === 1 ? "" : "s"
      } ${
        freshness.xero_linked_open_invoice_count === 1 ? "needs" : "need"
      } a payment reconciliation preview before month-end reporting.`,
      tone: "warning",
      action: "payments",
      actionLabel: "Open payment review",
    };
  }
  if (freshness.readiness_warning_count > 0 || exceptionWarnings > 0) {
    return {
      title: "Review accounting warnings",
      detail: `${freshness.readiness_warning_count + exceptionWarnings} warning${
        freshness.readiness_warning_count + exceptionWarnings === 1 ? "" : "s"
      } remain. They may not block the run, but should be checked before sharing reports.`,
      tone: "warning",
      action: "exceptions",
      actionLabel: "Review warnings",
    };
  }
  return {
    title: "Ready for month-end review",
    detail:
      "Accounting checkpoints are current. Continue from Billing Readiness or Statements when the invoice run is ready to close.",
    tone: "success",
    action: "billing",
    actionLabel: "Open Billing Readiness",
  };
}

function summaryLabel(summary: XeroReadinessSummaryRecord) {
  if (summary.total === 0) {
    return "No records";
  }
  return `${summary.ready}/${summary.total} ready`;
}

function roleLabel(role: SecurityRole) {
  return roleLabels[role] ?? role;
}

function xeroContactMatchKey(match: XeroContactMatchRecord) {
  return `${match.target_type}:${match.target_id}:${match.xero_contact_id}`;
}

function chartTaxStatusTone(
  result: XeroChartTaxValidationResultRecord,
): StatusTone {
  if (result.status === "ready") {
    return "success";
  }
  if (result.status === "not_found") {
    return "danger";
  }
  return "warning";
}

function chartTaxStatusLabel(
  status: XeroChartTaxValidationResultRecord["status"],
) {
  if (status === "needs_mapping") {
    return "Needs mapping";
  }
  if (status === "not_found") {
    return "Not found";
  }
  return "Ready";
}

function invoicePostingStatusTone(
  status: XeroInvoicePostingPreviewResultRecord["status"],
): StatusTone {
  return status === "ready" ? "success" : "danger";
}

function xeroDraftCreateTone(
  status: XeroInvoiceDraftCreateResultRecord["status"],
): StatusTone {
  if (status === "created") {
    return "success";
  }
  if (status === "blocked" || status === "failed") {
    return "danger";
  }
  return "warning";
}

function paymentReconciliationTone(
  status: XeroPaymentReconciliationResultRecord["status"],
): StatusTone {
  if (status === "ready" || status === "applied") {
    return "success";
  }
  if (status === "blocked") {
    return "danger";
  }
  return "neutral";
}

function paymentConfidenceTone(
  confidence: XeroPaymentReconciliationResultRecord["match_confidence"],
): StatusTone {
  if (confidence === "high") {
    return "success";
  }
  if (confidence === "medium") {
    return "warning";
  }
  return "danger";
}

function roleForEntity(member: SecurityMemberRecord, entityId: string) {
  return member.roles.find((role) => role.entity_id === entityId);
}

function accessStatusTone(member: SecurityMemberRecord): StatusTone {
  if (member.access_status === "login_linked") {
    return "success";
  }
  if (member.access_status === "invited") {
    return "primary";
  }
  if (member.access_status === "disabled") {
    return "neutral";
  }
  return "warning";
}

function accessStatusLabel(member: SecurityMemberRecord) {
  if (member.access_status === "login_linked") {
    return "Login linked";
  }
  if (member.access_status === "invited") {
    return "Invited";
  }
  if (member.access_status === "disabled") {
    return "Disabled";
  }
  return "Not linked";
}

function authModeLabel(mode: string) {
  if (mode === "clerk") {
    return "Clerk";
  }
  if (mode === "dev") {
    return "Dev";
  }
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function inviteTone(member: SecurityMemberRecord): StatusTone {
  if (member.login_linked || member.invite_email_status === "accepted") {
    return "success";
  }
  const detail = member.invite_email_detail.toLowerCase();
  if (
    detail.includes("delivered") ||
    detail.includes("opened") ||
    detail.includes("clicked")
  ) {
    return "success";
  }
  if (detail.includes("trying to deliver")) {
    return "warning";
  }
  if (
    member.invite_email_status === "failed" ||
    member.invite_email_status === "expired"
  ) {
    return "danger";
  }
  if (member.invite_email_status === "sent") {
    return "primary";
  }
  return "warning";
}

function inviteLabel(member: SecurityMemberRecord) {
  if (member.login_linked || member.invite_email_status === "accepted") {
    return "Login linked";
  }
  if (member.invite_email_status === "sent") {
    const detail = member.invite_email_detail.toLowerCase();
    if (detail.includes("clicked")) {
      return "Invite clicked";
    }
    if (detail.includes("opened")) {
      return "Invite opened";
    }
    if (detail.includes("delivered")) {
      return "Delivered";
    }
    if (detail.includes("processed")) {
      return "Processed";
    }
    if (detail.includes("trying to deliver")) {
      return "Delayed";
    }
    return "Invite sent";
  }
  if (member.invite_email_status === "failed") {
    return "Invite failed";
  }
  if (member.invite_email_status === "skipped") {
    return "Email skipped";
  }
  if (member.invite_email_status === "expired") {
    return "Invite expired";
  }
  return "No email sent";
}

function workAssignmentEmailEnabled(member: SecurityMemberRecord) {
  return member.notification_preferences.work_assignment_email_enabled;
}

function workAssignmentSmsEnabled(member: SecurityMemberRecord) {
  return member.notification_preferences.work_assignment_sms_enabled;
}

function workAssignmentSmsPhone(member: SecurityMemberRecord) {
  return member.notification_preferences.work_assignment_sms_phone ?? "";
}

function workAssignmentDigestCadence(member: SecurityMemberRecord) {
  return (
    member.notification_preferences.work_assignment_digest_cadence ?? "daily"
  );
}

function workNotificationTemplateDraft(
  member: SecurityMemberRecord,
): NotificationTemplateDraft {
  return {
    noticeKey:
      member.notification_preferences.work_assignment_notice_template_key ||
      "work_assignment_notification",
    noticeVersion:
      member.notification_preferences.work_assignment_notice_template_version ||
      "v1",
    digestKey:
      member.notification_preferences.work_assignment_digest_template_key ||
      "work_assignment_digest",
    digestVersion:
      member.notification_preferences.work_assignment_digest_template_version ||
      "v1",
  };
}

function normalisedTemplateDraft(draft: NotificationTemplateDraft) {
  return {
    noticeKey: draft.noticeKey.trim() || "work_assignment_notification",
    noticeVersion: draft.noticeVersion.trim() || "v1",
    digestKey: draft.digestKey.trim() || "work_assignment_digest",
    digestVersion: draft.digestVersion.trim() || "v1",
  };
}

function templateDraftChanged(
  member: SecurityMemberRecord,
  draft: NotificationTemplateDraft,
) {
  const current = workNotificationTemplateDraft(member);
  const next = normalisedTemplateDraft(draft);
  return (
    current.noticeKey !== next.noticeKey ||
    current.noticeVersion !== next.noticeVersion ||
    current.digestKey !== next.digestKey ||
    current.digestVersion !== next.digestVersion
  );
}

function notificationTemplateTitle(templateKey: string) {
  const titles: Record<string, string> = {
    work_assignment_notification: "Standard work assignment",
    work_assignment_follow_up: "Follow-up assignment notice",
    work_assignment_digest: "Standard work digest",
    work_assignment_digest_owner_review: "Owner review digest",
  };
  return titles[templateKey] ?? templateKey.replaceAll("_", " ");
}

function notificationTemplateByKey(
  templates: WorkAssignmentNotificationTemplateRecord[] | undefined,
  key: string,
) {
  return templates?.find((template) => template.key === key) ?? null;
}

function customNotificationTemplate(
  kind: WorkAssignmentNotificationTemplateKind,
  key: string,
  version: string,
): WorkAssignmentNotificationTemplateRecord {
  const name = notificationTemplateTitle(key);
  return {
    kind,
    key,
    name,
    default_version: version || "v1",
    channel: "email",
    provider: "sendgrid",
    subject_preview:
      kind === "digest" ? "Leasium Work digest" : "New Leasium work assigned",
    content_summary:
      "Custom template key stored on this operator; provider sends still require explicit approval.",
    recovery_summary: null,
    is_system: false,
  };
}

function notificationTemplateOptions({
  templates,
  currentKey,
  currentVersion,
  kind,
}: {
  templates: WorkAssignmentNotificationTemplateRecord[] | undefined;
  currentKey: string;
  currentVersion: string;
  kind: WorkAssignmentNotificationTemplateKind;
}) {
  const base = templates ?? [];
  if (!currentKey || base.some((template) => template.key === currentKey)) {
    return base;
  }
  return [
    customNotificationTemplate(kind, currentKey, currentVersion),
    ...base,
  ];
}

function notificationTemplatePreview(
  member: SecurityMemberRecord,
  draft: NotificationTemplateDraft,
  catalog: WorkAssignmentNotificationTemplateCatalogRecord | undefined,
) {
  const cleanDraft = normalisedTemplateDraft(draft);
  const noticeTemplate = notificationTemplateByKey(
    catalog?.notice_templates,
    cleanDraft.noticeKey,
  );
  const digestTemplate = notificationTemplateByKey(
    catalog?.digest_templates,
    cleanDraft.digestKey,
  );
  return {
    noticeTitle:
      noticeTemplate?.name ?? notificationTemplateTitle(cleanDraft.noticeKey),
    noticeSubject: `${
      noticeTemplate?.subject_preview ?? "New Leasium work assigned"
    } to ${member.display_name}`,
    noticeDetail:
      noticeTemplate?.content_summary ??
      "Includes the work title, due date, source workspace, and a link back to Leasium.",
    digestTitle:
      digestTemplate?.name ?? notificationTemplateTitle(cleanDraft.digestKey),
    digestSubject: `${
      digestTemplate?.subject_preview ??
      digestCadenceLabel(workAssignmentDigestCadence(member))
    } for ${member.display_name}`,
    digestDetail:
      digestTemplate?.content_summary ??
      "Groups assigned work by urgency, follow-up status, and source workspace.",
    noticeVersion: cleanDraft.noticeVersion,
    digestVersion: cleanDraft.digestVersion,
    noticeManaged: Boolean(noticeTemplate?.is_system),
    digestManaged: Boolean(digestTemplate?.is_system),
  };
}

function communicationTemplateCatalog({
  catalog,
  brandName,
}: {
  catalog: WorkAssignmentNotificationTemplateCatalogRecord | undefined;
  brandName: string;
}): CommunicationTemplateCard[] {
  const workNotice = notificationTemplateByKey(
    catalog?.notice_templates,
    "work_assignment_notification",
  );
  const workDigest = notificationTemplateByKey(
    catalog?.digest_templates,
    "work_assignment_digest",
  );
  return [
    {
      id: "invoice-delivery",
      title: "Invoice delivery",
      audience: "Tenants",
      channel: "email",
      provider: "SendGrid",
      templateKey: "invoice_delivery",
      templateVersion: "v1",
      brand: brandName,
      subjectPreview: "Invoice INV-1001",
      bodyPreview:
        "Approved invoice email with issuer, due date, total, and the generated PDF attached.",
      actionLabel:
        "Billing Readiness prepares the draft, then sends after explicit approval.",
      receiptLabel: "Invoice SendGrid events",
      receiptEndpoint: "/api/v1/invoice-drafts/webhooks/sendgrid-events",
      receiptDetail:
        "Provider receipts update invoice delivery history and payment follow-up cues.",
      sourceLabel: "Runtime setting",
      tone: "primary",
    },
    {
      id: "tenant-onboarding",
      title: "Tenant onboarding invite",
      audience: "Tenants",
      channel: "email",
      provider: "SendGrid",
      templateKey: "tenant_onboarding_invite",
      templateVersion: "v1",
      brand: brandName,
      subjectPreview: "Complete tenant onboarding",
      bodyPreview:
        "Invitation with property, unit, due date, expiry guidance, and review-first guardrails.",
      actionLabel:
        "Tenant detail and Portfolio QA create reviewed invite links.",
      receiptLabel: "Onboarding SendGrid events",
      receiptEndpoint: "/api/v1/tenant-onboarding/webhooks/sendgrid-events",
      receiptDetail:
        "Receipts update onboarding delivery state without changing tenant profile data.",
      sourceLabel: "Runtime setting",
      tone: "primary",
    },
    {
      id: "tenant-onboarding-sms",
      title: "Tenant onboarding SMS",
      audience: "Tenants",
      channel: "sms",
      provider: "Twilio",
      templateKey: "tenant_onboarding_invite",
      templateVersion: "v1",
      brand: brandName,
      subjectPreview: "SMS invite link",
      bodyPreview:
        "Short tenant onboarding reminder with a scoped link and expiry context.",
      actionLabel:
        "Only sent when SMS delivery is explicitly reviewed and approved.",
      receiptLabel: "Onboarding Twilio callbacks",
      receiptEndpoint: "/api/v1/tenant-onboarding/webhooks/twilio-status",
      receiptDetail:
        "Callbacks record queued, delivered, failed, and recovery states on the onboarding row.",
      sourceLabel: "Runtime setting",
      tone: "neutral",
    },
    {
      id: "operator-invite",
      title: "Operator invite",
      audience: "Operators",
      channel: "email",
      provider: "SendGrid",
      templateKey: "operator_invite",
      templateVersion: "v1",
      brand: brandName,
      subjectPreview: "Join SKJ Capital on Leasium",
      bodyPreview:
        "Owner/admin invite with organisation context, Clerk sign-in handoff, and expiry copy.",
      actionLabel:
        "Security settings sends or resends invites after explicit admin action.",
      receiptLabel: "Operator SendGrid events",
      receiptEndpoint: "/api/v1/security/webhooks/sendgrid-events",
      receiptDetail:
        "Receipts update the operator row so Settings can show queued, delivered, opened, clicked, or failed.",
      sourceLabel: "Runtime setting",
      tone: "success",
    },
    {
      id: "work-assignment",
      title: workNotice?.name ?? "Standard assignment notice",
      audience: "Operators",
      channel: "email",
      provider: "SendGrid",
      templateKey: workNotice?.key ?? "work_assignment_notification",
      templateVersion: workNotice?.default_version ?? "v1",
      brand: "Leasium",
      subjectPreview:
        workNotice?.subject_preview ?? "New Leasium work assigned",
      bodyPreview:
        workNotice?.content_summary ??
        "Includes the work title, due date, source workspace, and a link back to Leasium.",
      actionLabel:
        "Work rows and Notifications send notices only after operator action.",
      receiptLabel: "Work SendGrid events",
      receiptEndpoint: "/api/v1/work-assignments/webhooks/sendgrid-events",
      receiptDetail:
        "Receipts update maintenance, arrears, and critical-date assignment history.",
      sourceLabel: workNotice?.is_system ? "Named template" : "Fallback",
      tone: "success",
    },
    {
      id: "work-digest",
      title: workDigest?.name ?? "Standard work digest",
      audience: "Operators",
      channel: "email",
      provider: "SendGrid",
      templateKey: workDigest?.key ?? "work_assignment_digest",
      templateVersion: workDigest?.default_version ?? "v1",
      brand: "Leasium",
      subjectPreview:
        workDigest?.subject_preview ?? "Leasium daily or weekly Work digest",
      bodyPreview:
        workDigest?.content_summary ??
        "Groups assigned work by urgency, follow-up status, and source workspace.",
      actionLabel:
        "Digest previews stay review-only until send approval is explicit.",
      receiptLabel: "Work digest SendGrid events",
      receiptEndpoint: "/api/v1/work-assignments/webhooks/sendgrid-events",
      receiptDetail:
        "Digest receipts are stored against the operator notification history.",
      sourceLabel: workDigest?.is_system ? "Named template" : "Fallback",
      tone: "success",
    },
    {
      id: "contractor-update",
      title: "Maintenance contractor update",
      audience: "Contractors",
      channel: "email",
      provider: "SendGrid",
      templateKey: "maintenance_contractor_update",
      templateVersion: "v1",
      brand: "Leasium",
      subjectPreview: "Maintenance update request",
      bodyPreview:
        "Reviewed contractor email with attendance, quote, completion evidence, or billing-document copy.",
      actionLabel:
        "Maintenance detail pre-fills a template, then sends after review.",
      receiptLabel: "Maintenance SendGrid events",
      receiptEndpoint: "/api/v1/maintenance/webhooks/sendgrid-events",
      receiptDetail:
        "Receipts are shown in contractor provider history and work-order activity.",
      sourceLabel: "Runtime setting",
      tone: "primary",
    },
    {
      id: "contractor-sms",
      title: "Maintenance contractor SMS",
      audience: "Contractors",
      channel: "sms",
      provider: "Twilio",
      templateKey: "maintenance_contractor_sms",
      templateVersion: "v1",
      brand: "Leasium",
      subjectPreview: "SMS contractor update",
      bodyPreview:
        "Short reviewed SMS for attendance windows, quote follow-up, or completion evidence.",
      actionLabel:
        "Maintenance detail sends SMS separately from contractor email.",
      receiptLabel: "Maintenance Twilio callbacks",
      receiptEndpoint: "/api/v1/maintenance/webhooks/twilio-status",
      receiptDetail:
        "Callbacks update SMS attempt history and contractor delivery recovery cues.",
      sourceLabel: "Runtime setting",
      tone: "neutral",
    },
    {
      id: "tenant-portal-preferences",
      title: "Tenant portal notification preferences",
      audience: "Tenants",
      channel: "portal",
      provider: "Leasium",
      templateKey: "tenant_portal_preferences",
      templateVersion: "v1",
      brand: brandName,
      subjectPreview: "Portal preference receipt",
      bodyPreview:
        "Tenant-facing saved receipt for billing email, compliance reminders, email, and SMS preferences.",
      actionLabel:
        "Tenant portal stores preferences immediately inside the tenant boundary.",
      receiptLabel: "Portal audit receipt",
      receiptEndpoint: null,
      receiptDetail:
        "This is an in-app receipt; no provider webhook is required for the saved preference state.",
      sourceLabel: "Portal UI",
      tone: "neutral",
    },
  ];
}

function brandedTemplateChannelLabel(
  channel: BrandedCommunicationTemplateRecord["channel"],
) {
  return channel === "in_app" ? "In-app" : channel.toUpperCase();
}

function templateOverrideCoverage({
  runtimeTemplates,
  brandedTemplates,
}: {
  runtimeTemplates: CommunicationTemplateCard[];
  brandedTemplates: BrandedCommunicationTemplateRecord[];
}): TemplateOverrideCoverage {
  const runtimeTemplateKeys = new Set(
    runtimeTemplates.map((template) => template.templateKey),
  );
  const activeOverrides = brandedTemplates.filter(
    (template) => template.is_active,
  );

  return activeOverrides.reduce<TemplateOverrideCoverage>(
    (coverage, template) => {
      if (runtimeTemplateKeys.has(template.key)) {
        coverage.covered.push(template.key);
      } else {
        coverage.unmatched.push(template.key);
      }
      return coverage;
    },
    { active: activeOverrides.length, covered: [], unmatched: [] },
  );
}

function digestCadenceLabel(value: SecurityWorkAssignmentDigestCadence) {
  if (value === "off") {
    return "Digest off";
  }
  return `${value[0].toUpperCase()}${value.slice(1)} digest`;
}

function latestDigestReceipt(member: SecurityMemberRecord) {
  return (
    member.notification_preferences.work_assignment_digest_history?.[0] ?? null
  );
}

function nextNotificationPreferences(
  member: SecurityMemberRecord,
  patch: Partial<SecurityNotificationPreferences>,
) {
  return {
    ...member.notification_preferences,
    ...patch,
  };
}

function DigestReceiptSummary({ member }: { member: SecurityMemberRecord }) {
  const receipt = latestDigestReceipt(member);
  if (!receipt) {
    return (
      <div className="text-xs leading-5 text-muted-foreground">
        No digest generated yet.
      </div>
    );
  }
  return (
    <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span className="font-semibold text-foreground">Last digest</span>
      <StatusBadge tone={receipt.message_sent ? "success" : "neutral"}>
        {receipt.message_sent ? "Email queued" : "No messages sent"}
      </StatusBadge>
    </div>
  );
}

function nextRolesForEntity(
  member: SecurityMemberRecord,
  entityId: string,
  role: SecurityRole | "",
): SecurityRoleAssignment[] {
  const otherRoles = member.roles
    .filter((assignment) => assignment.entity_id !== entityId)
    .map((assignment) => ({
      entity_id: assignment.entity_id,
      role: assignment.role,
    }));
  if (!role) {
    return otherRoles;
  }
  return [...otherRoles, { entity_id: entityId, role }];
}

function IntegrationsHealthCard({
  apiHealth,
  integrations,
  isApiHealthLoading,
  isLoading,
}: {
  apiHealth: ApiHealthRecord | undefined;
  integrations: IntegrationStatusRecord | undefined;
  isApiHealthLoading: boolean;
  isLoading: boolean;
}) {
  const rows: Array<{
    key: keyof IntegrationStatusRecord;
    data: ProviderStatusRecord;
  }> = integrations
    ? [
        { key: "serpapi", data: integrations.serpapi },
        { key: "openai", data: integrations.openai },
        { key: "sendgrid", data: integrations.sendgrid },
        { key: "twilio", data: integrations.twilio },
        { key: "xero", data: integrations.xero },
        { key: "docusign", data: integrations.docusign },
      ]
    : [];
  const release = apiHealth?.release;
  const [docusignPacketReceipt, setDocusignPacketReceipt] = useState<
    string | null
  >(null);
  const releaseIsLocal =
    Boolean(release) &&
    (release?.commit === "unknown" || release?.source === "local");
  const releaseBadge: { label: string; tone: StatusTone } = release
    ? {
        label: releaseIsLocal
          ? "Local release"
          : release.source === "render"
            ? "Render commit"
            : `${release.source} commit`,
        tone: releaseIsLocal ? "warning" : "success",
      }
    : {
        label: isApiHealthLoading ? "Checking release" : "Release unavailable",
        tone: isApiHealthLoading ? "neutral" : "danger",
      };
  const copyDocusignSetupPacket = async (data: ProviderStatusRecord) => {
    const copied = await copyTextToClipboard(docusignProviderSetupPacket(data));
    setDocusignPacketReceipt(
      copied
        ? "DocuSign setup packet copied."
        : "Copy unavailable in this browser.",
    );
  };
  const downloadDocusignSetupPacket = (data: ProviderStatusRecord) => {
    saveBlob(
      new Blob([docusignProviderSetupPacket(data)], {
        type: "text/plain;charset=utf-8",
      }),
      "docusign-provider-setup-packet.txt",
    );
    setDocusignPacketReceipt("DocuSign setup packet downloaded.");
  };
  return (
    <SectionPanel
      title="Integrations"
      description="Whether each external provider has credentials set on this API service. No secrets are returned — only configured/not status."
      icon={<PlugZap size={17} className="text-primary" />}
    >
      <div className="grid gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/20 p-3 text-sm">
          <div className="grid gap-1">
            <span className="font-semibold">API release</span>
            <span className="text-xs text-muted-foreground">
              {isApiHealthLoading && !apiHealth
                ? "Checking the API revision."
                : apiHealth?.release
                  ? `${apiHealth.app} is serving the current health contract.`
                  : "API release status is unavailable."}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={releaseBadge.tone}>
              {releaseBadge.label}
            </StatusBadge>
            {release ? (
              <code
                className="rounded-sm border border-border bg-white px-2 py-1 font-mono text-xs text-muted-foreground"
                title={release.commit}
              >
                {release.commit.slice(0, 7)}
              </code>
            ) : null}
          </div>
        </div>
        {isLoading && !integrations ? (
          <div className="rounded-md border border-border bg-muted/25 p-3 text-sm text-muted-foreground">
            Checking integration status.
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-border bg-muted/25 p-3 text-sm text-muted-foreground">
            Integration status is unavailable.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map(({ key, data }) => (
              <div
                key={key}
                className="grid gap-2 rounded-md border border-border bg-white p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{data.label}</span>
                  <StatusBadge
                    tone={
                      data.live_ready
                        ? "success"
                        : data.configured
                          ? "warning"
                          : "danger"
                    }
                  >
                    {data.live_ready
                      ? "Live ready"
                      : data.configured
                        ? "Setup needed"
                        : "Not configured"}
                  </StatusBadge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {data.purpose}
                </div>
                <div className="text-xs text-muted-foreground">
                  {data.detail}
                </div>
                {data.missing_config.length > 0 ? (
                  <div className="grid gap-1 rounded-md border border-warning/30 bg-warning/10 p-2 text-xs">
                    <span className="font-medium text-foreground">
                      Missing production setup
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {data.missing_config.map((item) => (
                        <code
                          key={item}
                          className="rounded-sm border border-warning/30 bg-white px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                        >
                          {item}
                        </code>
                      ))}
                    </div>
                  </div>
                ) : null}
                {data.webhook_url ? (
                  <div className="grid gap-1 rounded-md border border-border bg-muted/20 p-2 text-xs">
                    <span className="font-medium text-foreground">
                      DocuSign Connect webhook
                    </span>
                    <code className="break-all font-mono text-[11px] text-muted-foreground">
                      {data.webhook_url}
                    </code>
                  </div>
                ) : null}
                {key === "docusign" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <SecondaryButton
                      type="button"
                      className="min-h-11 rounded-md px-2.5 text-xs"
                      onClick={() => void copyDocusignSetupPacket(data)}
                    >
                      <Copy size={14} />
                      Copy DocuSign setup packet
                    </SecondaryButton>
                    <SecondaryButton
                      type="button"
                      className="min-h-11 rounded-md px-2.5 text-xs"
                      onClick={() => downloadDocusignSetupPacket(data)}
                    >
                      <Download size={14} />
                      Download DocuSign setup packet
                    </SecondaryButton>
                    {docusignPacketReceipt ? (
                      <span className="text-xs text-muted-foreground">
                        {docusignPacketReceipt}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </SectionPanel>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
  icon,
  statusValue = false,
}: {
  label: string;
  value: string | number;
  detail: string;
  tone?: StatusTone;
  icon?: ReactNode;
  statusValue?: boolean;
}) {
  const toneClass = {
    neutral: "bg-muted text-leasium-slate-500",
    success: "bg-success-soft text-success-strong",
    warning: "bg-warning-soft text-warning-strong",
    danger: "bg-danger-soft text-danger-strong",
    primary: "bg-primary-soft text-primary-hover",
  }[tone];
  return (
    <div className="rounded-md border border-border bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          {statusValue ? (
            <div className="flex min-h-8 items-center">
              <StatusBadge tone={tone}>{value}</StatusBadge>
            </div>
          ) : (
            <div className="text-2xl font-semibold">{value}</div>
          )}
          <div className="mt-1 text-sm font-medium">{label}</div>
        </div>
        <div className={`rounded-xl p-2 ${toneClass}`}>
          {icon ??
            (tone === "success" ? (
              <CheckCircle2 size={18} />
            ) : tone === "danger" || tone === "warning" ? (
              <AlertTriangle size={18} />
            ) : (
              <CircleDollarSign size={18} />
            ))}
        </div>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

type PaymentFormState = {
  account_name: string;
  bsb: string;
  account_number: string;
  payid: string;
  payid_name: string;
  bpay_biller_code: string;
  instructions: string;
};

function paymentFormFromRecord(
  record: PaymentInstructionRecord | undefined,
): PaymentFormState {
  return {
    account_name: record?.account_name ?? "",
    bsb: record?.bsb ?? "",
    account_number: record?.account_number ?? "",
    payid: record?.payid ?? "",
    payid_name: record?.payid_name ?? "",
    bpay_biller_code: record?.bpay_biller_code ?? "",
    instructions: record?.instructions ?? "",
  };
}

function PaymentInstructionsPanel({ entityId }: { entityId: string }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PaymentFormState>(
    paymentFormFromRecord(undefined),
  );
  const [notice, setNotice] = useState<string | null>(null);

  const instructionsQuery = useQuery({
    queryKey: ["payment-instructions", entityId],
    queryFn: () => getPaymentInstructions(entityId),
    enabled: Boolean(entityId),
  });

  useEffect(() => {
    if (instructionsQuery.data) {
      setForm(paymentFormFromRecord(instructionsQuery.data));
    }
  }, [instructionsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload: PaymentInstructionPayload = { ...form };
      return updatePaymentInstructions(entityId, payload);
    },
    onSuccess: (result) => {
      setForm(paymentFormFromRecord(result));
      setNotice("Payment instructions saved.");
      void queryClient.invalidateQueries({
        queryKey: ["payment-instructions", entityId],
      });
    },
  });

  const data = instructionsQuery.data;
  const update = (key: keyof PaymentFormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setNotice(null);
  };

  return (
    <SectionPanel
      title="Tenant payment instructions"
      description="Shown to tenants in their portal as 'How to pay'. Display-only - Leasium does not process payments or move money."
      icon={<CircleDollarSign size={17} className="text-primary" />}
      actions={
        data ? (
          <StatusBadge tone={data.configured ? "success" : "neutral"}>
            {data.configured
              ? data.methods.join(" · ").toUpperCase()
              : "Not set"}
          </StatusBadge>
        ) : null
      }
    >
      <div className="grid gap-4 p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Account name">
            <Input
              value={form.account_name}
              onChange={(event) => update("account_name", event.target.value)}
              placeholder="SKJ Property Pty Ltd"
            />
          </Field>
          <Field label="BSB">
            <Input
              value={form.bsb}
              onChange={(event) => update("bsb", event.target.value)}
              placeholder="062-000"
            />
          </Field>
          <Field label="Account number">
            <Input
              value={form.account_number}
              onChange={(event) => update("account_number", event.target.value)}
              placeholder="12345678"
            />
          </Field>
          <Field label="PayID">
            <Input
              value={form.payid}
              onChange={(event) => update("payid", event.target.value)}
              placeholder="rent@yourbusiness.com.au"
            />
          </Field>
          <Field label="PayID name">
            <Input
              value={form.payid_name}
              onChange={(event) => update("payid_name", event.target.value)}
              placeholder="Name registered to the PayID"
            />
          </Field>
          <Field label="BPAY biller code (optional)">
            <Input
              value={form.bpay_biller_code}
              onChange={(event) =>
                update("bpay_biller_code", event.target.value)
              }
              placeholder="123456"
            />
          </Field>
        </div>
        <Field label="Notes for tenants (optional)">
          <textarea
            className="min-h-[72px] w-full rounded-md border border-border bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-primary"
            value={form.instructions}
            onChange={(event) => update("instructions", event.target.value)}
            placeholder="e.g. Quote your invoice number as the payment reference."
            rows={3}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            disabled={saveMutation.isPending || instructionsQuery.isLoading}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? "Saving..." : "Save payment instructions"}
          </Button>
          {notice ? (
            <span className="text-sm text-success">{notice}</span>
          ) : null}
          {saveMutation.error ? (
            <span className="text-sm text-danger">
              Could not save. Check the fields and try again.
            </span>
          ) : null}
        </div>
        {data?.guardrails.length ? (
          <p className="text-xs text-muted-foreground">{data.guardrails[0]}</p>
        ) : null}
      </div>
    </SectionPanel>
  );
}

function SettingsWorkspace() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<SettingsTab>("security");
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [xeroTenantId, setXeroTenantId] = useState("");
  const [xeroContactPreview, setXeroContactPreview] =
    useState<XeroContactSyncPreviewRecord | null>(null);
  const [xeroContactApplyResult, setXeroContactApplyResult] =
    useState<XeroContactApplyPreviewRecord | null>(null);
  const [xeroChartTaxPreview, setXeroChartTaxPreview] =
    useState<XeroChartTaxValidationPreviewRecord | null>(null);
  const [xeroInvoicePostingPreview, setXeroInvoicePostingPreview] =
    useState<XeroInvoicePostingPreviewRecord | null>(null);
  const [xeroInvoiceApprovalResults, setXeroInvoiceApprovalResults] = useState<
    Record<string, XeroInvoicePostingApprovalRecord>
  >({});
  const [xeroDraftCreateResult, setXeroDraftCreateResult] =
    useState<XeroInvoiceDraftCreateRecord | null>(null);
  const [xeroPaymentPreview, setXeroPaymentPreview] =
    useState<XeroPaymentReconciliationRecord | null>(null);
  const [xeroPaymentApplyResult, setXeroPaymentApplyResult] =
    useState<XeroPaymentReconciliationRecord | null>(null);
  const [basiqTransactions, setBasiqTransactions] = useState<
    BasiqImportedTransaction[]
  >([]);
  const [basiqDraftAmount, setBasiqDraftAmount] = useState("");
  const [basiqDraftDate, setBasiqDraftDate] = useState("");
  const [basiqDraftReference, setBasiqDraftReference] = useState("");
  const [basiqDraftInvoiceNumber, setBasiqDraftInvoiceNumber] = useState("");
  const [basiqPreview, setBasiqPreview] =
    useState<BasiqReconciliationResponse | null>(null);
  const [basiqApplyResult, setBasiqApplyResult] =
    useState<BasiqReconciliationResponse | null>(null);
  const [basiqConnectStart, setBasiqConnectStart] =
    useState<BasiqConnectStart | null>(null);
  const [approvedBasiqKeys, setApprovedBasiqKeys] = useState<
    Record<string, boolean>
  >({});
  const [selectedXeroContactMatches, setSelectedXeroContactMatches] = useState<
    Record<string, boolean>
  >({});
  const [xeroCallbackFeedback, setXeroCallbackFeedback] =
    useState<XeroCallbackFeedback | null>(null);
  const [xeroSetupCopyReceipt, setXeroSetupCopyReceipt] = useState<
    string | null
  >(null);
  const [xeroDiagnosticsCopyReceipt, setXeroDiagnosticsCopyReceipt] = useState<
    string | null
  >(null);
  const [xeroExceptionExportReceipt, setXeroExceptionExportReceipt] = useState<
    string | null
  >(null);
  const [xeroFreshnessPacketReceipt, setXeroFreshnessPacketReceipt] = useState<
    string | null
  >(null);
  const [templateOverrideExportReceipt, setTemplateOverrideExportReceipt] =
    useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteDisplayName, setInviteDisplayName] = useState("");
  const [inviteRole, setInviteRole] = useState<SecurityRole>("viewer");
  const [latestInviteLink, setLatestInviteLink] = useState<{
    email: string;
    url: string;
    copied: boolean;
  } | null>(null);
  const [roleDrafts, setRoleDrafts] = useState<
    Record<string, SecurityRole | "">
  >({});
  const [notificationTemplateDrafts, setNotificationTemplateDrafts] = useState<
    Record<string, NotificationTemplateDraft>
  >({});
  const [smsPhoneDrafts, setSmsPhoneDrafts] = useState<Record<string, string>>(
    {},
  );
  const xeroConnectionPanelRef = useRef<HTMLDivElement>(null);
  const xeroContactPreviewPanelRef = useRef<HTMLDivElement>(null);
  const xeroInvoicePostingPanelRef = useRef<HTMLDivElement>(null);
  const xeroPaymentPanelRef = useRef<HTMLDivElement>(null);
  const basiqReconciliationPanelRef = useRef<HTMLDivElement>(null);
  const xeroChartMappingPanelRef = useRef<HTMLDivElement>(null);
  const xeroExceptionQueuePanelRef = useRef<HTMLDivElement>(null);

  const entitiesQuery = useQuery({
    queryKey: ["entities"],
    queryFn: listEntities,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hasXeroCallback =
      params.get("xero_connected") === "1" || params.has("xero_error");
    const requestedTab = params.get("tab");
    if (requestedTab === "organisation") {
      setActiveTab("organisation");
    } else if (
      requestedTab === "connect" ||
      requestedTab === "xero" ||
      hasXeroCallback
    ) {
      setActiveTab("connect");
    }
    const entityId = params.get("entity_id");
    if (entityId) {
      setSelectedEntityId(entityId);
    }
    if (params.get("xero_connected") === "1") {
      const tenantId = params.get("xero_tenant_id");
      setXeroCallbackFeedback({
        tone: "success",
        title: "Xero connected",
        detail: `This entity is connected${
          tenantId ? ` to Xero organisation ${tenantId}` : ""
        }. Next, review suggested contacts before preparing invoices.`,
      });
    } else if (params.has("xero_error")) {
      setXeroCallbackFeedback({
        tone: "danger",
        title: "Xero connection needs attention",
        detail: `${cleanXeroCallbackError(
          params.get("xero_error"),
        )}. Try connecting again, or open Advanced support details if this keeps happening.`,
      });
    }
  }, []);

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
    setXeroContactPreview(null);
    setXeroContactApplyResult(null);
    setXeroChartTaxPreview(null);
    setXeroInvoicePostingPreview(null);
    setXeroInvoiceApprovalResults({});
    setXeroDraftCreateResult(null);
    setXeroPaymentPreview(null);
    setXeroPaymentApplyResult(null);
    setBasiqTransactions([]);
    setBasiqDraftAmount("");
    setBasiqDraftDate("");
    setBasiqDraftReference("");
    setBasiqDraftInvoiceNumber("");
    setBasiqPreview(null);
    setBasiqApplyResult(null);
    setApprovedBasiqKeys({});
    setSelectedXeroContactMatches({});
    setLatestInviteLink(null);
  }, [selectedEntityId]);

  const selectedEntity = entitiesQuery.data?.find(
    (entity) => entity.id === selectedEntityId,
  );

  const propertiesQuery = useQuery({
    queryKey: ["properties", selectedEntityId],
    queryFn: () => listProperties(selectedEntityId),
    enabled: Boolean(selectedEntityId) && activeTab === "organisation",
  });

  const ownershipTags = useMemo(
    () =>
      propertyOwnershipTagDirectory(
        propertiesQuery.data ?? [],
        selectedEntity?.name,
      ),
    [propertiesQuery.data, selectedEntity?.name],
  );
  const xeroStatusQuery = useQuery({
    queryKey: ["xero-status", selectedEntityId],
    queryFn: () => getXeroStatus(selectedEntityId),
    enabled: Boolean(selectedEntityId) && activeTab === "connect",
  });
  const entitiesXeroOverviewQuery = useQuery({
    queryKey: ["entities-xero-overview"],
    queryFn: getEntitiesXeroOverview,
    enabled: activeTab === "connect",
  });
  const ownershipSplitPlanQuery = useQuery({
    queryKey: ["ownership-split-plan"],
    queryFn: getOwnershipSplitPlan,
    enabled: activeTab === "organisation",
  });
  const entitiesOverviewForOrg = useQuery({
    queryKey: ["entities-xero-overview"],
    queryFn: getEntitiesXeroOverview,
    enabled: activeTab === "organisation",
  });
  const [expandedEntityRows, setExpandedEntityRows] = useState<Set<string>>(
    () => new Set(),
  );

  const xeroDiagnosticsQuery = useQuery({
    queryKey: ["xero-connection-diagnostics", selectedEntityId],
    queryFn: () => getXeroConnectionDiagnostics(selectedEntityId),
    enabled: Boolean(selectedEntityId) && activeTab === "connect",
    retry: false,
  });

  const integrationStatusQuery = useQuery({
    queryKey: ["integration-status"],
    queryFn: getIntegrationStatus,
  });

  const apiHealthQuery = useQuery({
    queryKey: ["api-health"],
    queryFn: getApiHealth,
    retry: false,
  });

  const xeroExceptionQueueQuery = useQuery({
    queryKey: ["xero-exception-queue", selectedEntityId],
    queryFn: () => getXeroExceptionQueue(selectedEntityId),
    enabled: Boolean(selectedEntityId) && activeTab === "connect",
  });

  const basiqConnectionStatusQuery = useQuery({
    queryKey: ["basiq-connection-status", selectedEntityId],
    queryFn: () => getBasiqConnectionStatus(selectedEntityId),
    enabled: Boolean(selectedEntityId) && activeTab === "connect",
  });

  const securityQuery = useQuery({
    queryKey: ["security-workspace"],
    queryFn: getSecurityWorkspace,
  });

  const operatingModeMutation = useMutation({
    mutationFn: (mode: OperatingMode) => setOperatingMode(mode),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["security-workspace"] });
    },
  });

  const notificationTemplateCatalogQuery = useQuery({
    queryKey: ["work-assignment-notification-templates"],
    queryFn: getWorkAssignmentNotificationTemplates,
    enabled: activeTab === "security" || activeTab === "organisation",
  });
  const brandedTemplatesQuery = useQuery({
    queryKey: ["branded-communication-templates", selectedEntityId],
    queryFn: () =>
      listBrandedCommunicationTemplates({ entityId: selectedEntityId }),
    enabled: Boolean(selectedEntityId) && activeTab === "organisation",
  });

  const communicationTemplates = useMemo(
    () =>
      communicationTemplateCatalog({
        catalog: notificationTemplateCatalogQuery.data,
        brandName:
          selectedEntity?.name ??
          securityQuery.data?.organisation.name ??
          "Leasium",
      }),
    [
      notificationTemplateCatalogQuery.data,
      securityQuery.data?.organisation.name,
      selectedEntity?.name,
    ],
  );
  const brandedTemplates =
    brandedTemplatesQuery.data ?? EMPTY_BRANDED_TEMPLATES;
  const brandedTemplateCoverage = useMemo(
    () =>
      templateOverrideCoverage({
        runtimeTemplates: communicationTemplates,
        brandedTemplates,
      }),
    [brandedTemplates, communicationTemplates],
  );

  const communicationTemplateOverridesCsv = () =>
    communicationTemplateOverrideCsv({
      runtimeTemplates: communicationTemplates,
      brandedTemplates,
    });

  const copyCommunicationTemplateOverridesCsv = async () => {
    const copied = await copyTextToClipboard(
      communicationTemplateOverridesCsv(),
    );
    setTemplateOverrideExportReceipt(
      copied
        ? "Template override CSV copied."
        : "Copy unavailable in this browser.",
    );
  };

  const downloadCommunicationTemplateOverridesCsv = () => {
    saveBlob(
      new Blob([communicationTemplateOverridesCsv()], {
        type: "text/csv;charset=utf-8",
      }),
      "communication-template-overrides.csv",
    );
    setTemplateOverrideExportReceipt("Template override CSV downloaded.");
  };

  const refreshXeroViews = () => {
    queryClient.invalidateQueries({ queryKey: ["entities"] });
    queryClient.invalidateQueries({
      queryKey: ["xero-status", selectedEntityId],
    });
    queryClient.invalidateQueries({
      queryKey: ["xero-connection-diagnostics", selectedEntityId],
    });
    queryClient.invalidateQueries({
      queryKey: ["xero-exception-queue", selectedEntityId],
    });
  };

  useEffect(() => {
    setXeroTenantId(xeroStatusQuery.data?.connection.xero_tenant_id ?? "");
  }, [xeroStatusQuery.data?.connection.xero_tenant_id]);

  const connectionMutation = useMutation({
    mutationFn: (payload: {
      connected: boolean;
      xero_tenant_id?: string | null;
    }) => updateXeroConnection(selectedEntityId, payload),
    onSuccess: () => {
      setXeroContactPreview(null);
      setXeroChartTaxPreview(null);
      setXeroInvoicePostingPreview(null);
      setXeroInvoiceApprovalResults({});
      setXeroDraftCreateResult(null);
      setXeroPaymentPreview(null);
      setXeroPaymentApplyResult(null);
      refreshXeroViews();
    },
  });

  const xeroOAuthMutation = useMutation({
    mutationFn: () => startXeroOAuth(selectedEntityId),
    onSuccess: (result) => {
      if (result.authorization_url) {
        window.location.href = result.authorization_url;
        return;
      }
      refreshXeroViews();
    },
  });

  // Per-row connect from the Entities & Xero hub: connects a specific entity
  // (not the selected one) so operators can walk through them one at a time.
  const xeroEntityConnectMutation = useMutation({
    mutationFn: (entityId: string) => startXeroOAuth(entityId),
    onSuccess: (result, entityId) => {
      setSelectedEntityId(entityId);
      if (result.authorization_url) {
        window.location.href = result.authorization_url;
        return;
      }
      refreshXeroViews();
    },
  });

  const xeroContactSyncMutation = useMutation({
    mutationFn: () => previewXeroContactSync(selectedEntityId),
    onSuccess: (result) => {
      setXeroContactPreview(result);
      setXeroContactApplyResult(null);
      setSelectedXeroContactMatches(
        Object.fromEntries(
          result.suggested_matches.map((match) => [
            xeroContactMatchKey(match),
            true,
          ]),
        ),
      );
      refreshXeroViews();
    },
  });

  const xeroContactApplyMutation = useMutation({
    mutationFn: () =>
      applyXeroContactPreview(
        selectedEntityId,
        (xeroContactPreview?.suggested_matches ?? [])
          .filter(
            (match) => selectedXeroContactMatches[xeroContactMatchKey(match)],
          )
          .map((match) => ({
            target_type: match.target_type,
            target_id: match.target_id,
            xero_contact_id: match.xero_contact_id,
            xero_contact_name: match.xero_contact_name,
            xero_email: match.xero_email,
            confidence: match.confidence,
            match_reason: match.match_reason,
          })),
      ),
    onSuccess: (result) => {
      setXeroContactApplyResult(result);
      refreshXeroViews();
    },
  });

  const xeroChartTaxMutation = useMutation({
    mutationFn: () => previewXeroChartTaxValidation(selectedEntityId),
    onSuccess: (result) => {
      setXeroChartTaxPreview(result);
      refreshXeroViews();
    },
  });

  const xeroInvoicePostingMutation = useMutation({
    mutationFn: () => previewXeroInvoicePosting(selectedEntityId),
    onSuccess: (result) => {
      setXeroInvoicePostingPreview(result);
      setXeroInvoiceApprovalResults({});
      setXeroDraftCreateResult(null);
      setXeroPaymentPreview(null);
      setXeroPaymentApplyResult(null);
      refreshXeroViews();
    },
  });

  const xeroInvoiceApprovalMutation = useMutation({
    mutationFn: ({
      invoiceDraftId,
      approved,
    }: {
      invoiceDraftId: string;
      approved: boolean;
    }) =>
      approveXeroInvoicePosting(invoiceDraftId, {
        approved,
        notes: approved
          ? "Approved from the Settings Xero review queue."
          : "Revoked from the Settings Xero review queue.",
      }),
    onSuccess: (result) => {
      setXeroInvoiceApprovalResults((current) => ({
        ...current,
        [result.invoice_draft_id]: result,
      }));
      setXeroDraftCreateResult(null);
      refreshXeroViews();
    },
  });

  const xeroDraftCreateMutation = useMutation({
    mutationFn: () =>
      createXeroInvoiceDrafts(selectedEntityId, {
        invoice_draft_ids:
          xeroInvoicePostingPreview?.results
            .filter((result) => result.status === "ready")
            .map((result) => result.invoice_draft_id) ?? null,
      }),
    onSuccess: (result) => {
      setXeroDraftCreateResult(result);
      setXeroPaymentPreview(null);
      setXeroPaymentApplyResult(null);
      refreshXeroViews();
    },
  });

  const xeroPaymentPreviewMutation = useMutation({
    mutationFn: () =>
      previewXeroPaymentReconciliation(selectedEntityId, {
        source: "provider",
        payments: [],
      }),
    onSuccess: (result) => {
      setXeroPaymentPreview(result);
      setXeroPaymentApplyResult(null);
      refreshXeroViews();
    },
  });

  const xeroPaymentApplyMutation = useMutation({
    mutationFn: () =>
      applyXeroPaymentReconciliation(selectedEntityId, {
        source: "provider",
        payments: [],
      }),
    onSuccess: (result) => {
      setXeroPaymentApplyResult(result);
      refreshXeroViews();
    },
  });

  const basiqPreviewMutation = useMutation({
    mutationFn: () =>
      previewBasiqReconciliation({
        entityId: selectedEntityId,
        transactions: basiqTransactions,
      }),
    onSuccess: (result) => {
      setBasiqPreview(result);
      setBasiqApplyResult(null);
      setApprovedBasiqKeys({});
    },
  });

  const basiqApplyMutation = useMutation({
    mutationFn: (approvedKeys: string[]) =>
      applyBasiqReconciliation({
        entityId: selectedEntityId,
        transactions: basiqTransactions,
        approvedKeys,
      }),
    onSuccess: (result) => {
      setBasiqApplyResult(result);
    },
  });

  const basiqProviderPreviewMutation = useMutation({
    mutationFn: () =>
      previewBasiqReconciliation({
        entityId: selectedEntityId,
        transactions: [],
        source: "provider",
      }),
    onSuccess: (result) => {
      setBasiqPreview(result);
      setBasiqApplyResult(null);
      setApprovedBasiqKeys({});
    },
  });

  const basiqConnectMutation = useMutation({
    mutationFn: () => startBasiqConnect(selectedEntityId),
    onSuccess: (result) => {
      setBasiqConnectStart(result);
      basiqConnectionStatusQuery.refetch();
    },
  });

  const basiqRevokeMutation = useMutation({
    mutationFn: () => revokeBasiqConnection(selectedEntityId),
    onSuccess: () => {
      setBasiqConnectStart(null);
      setBasiqPreview(null);
      setBasiqApplyResult(null);
      setApprovedBasiqKeys({});
      basiqConnectionStatusQuery.refetch();
    },
  });

  const mappingMutation = useMutation({
    mutationFn: (issue: XeroChargeRuleMappingInput) => {
      if (!issue.charge_rule_id) {
        throw new Error("This issue is not a charge-rule mapping.");
      }
      return updateChargeRule(issue.charge_rule_id, {
        xero_account_code:
          issue.current_account_code ||
          issue.suggested_account_code ||
          undefined,
        xero_tax_type:
          issue.current_tax_type || issue.suggested_tax_type || undefined,
      });
    },
    onSuccess: () => {
      refreshXeroViews();
    },
  });

  const inviteMutation = useMutation({
    mutationFn: () =>
      createSecurityMember({
        email: inviteEmail,
        display_name: inviteDisplayName,
        roles: [{ entity_id: selectedEntityId, role: inviteRole }],
      }),
    onSuccess: (member) => {
      if (member.invite_accept_url) {
        setLatestInviteLink({
          email: member.email,
          url: member.invite_accept_url,
          copied: false,
        });
      }
      setInviteEmail("");
      setInviteDisplayName("");
      setInviteRole("viewer");
      queryClient.invalidateQueries({ queryKey: ["security-workspace"] });
      queryClient.invalidateQueries({ queryKey: ["entities"] });
    },
  });

  const resendInviteMutation = useMutation({
    mutationFn: (memberId: string) => resendSecurityMemberInvite(memberId),
    onSuccess: (result) => {
      if (result.invite_accept_url) {
        setLatestInviteLink({
          email: result.member.email,
          url: result.invite_accept_url,
          copied: false,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["security-workspace"] });
    },
  });

  const copyLatestInviteLink = async () => {
    if (!latestInviteLink) {
      return;
    }
    await navigator.clipboard.writeText(latestInviteLink.url);
    setLatestInviteLink({ ...latestInviteLink, copied: true });
  };

  const copyXeroSetupPacket = async () => {
    if (!xeroDiagnostics) {
      return;
    }
    const copied = await copyTextToClipboard(
      xeroProviderSetupPacket(xeroDiagnostics),
    );
    setXeroSetupCopyReceipt(
      copied
        ? "Provider setup packet copied."
        : "Copy unavailable in this browser.",
    );
  };
  const downloadXeroSetupPacket = () => {
    if (!xeroDiagnostics) {
      return;
    }
    saveBlob(
      new Blob([xeroProviderSetupPacket(xeroDiagnostics)], {
        type: "text/plain;charset=utf-8",
      }),
      "xero-provider-setup-packet.txt",
    );
    setXeroSetupCopyReceipt("Provider setup packet downloaded.");
  };
  const downloadXeroDiagnosticsCsv = () => {
    if (!xeroDiagnostics) {
      return;
    }
    saveBlob(
      new Blob([xeroConnectionDiagnosticsCsv(xeroDiagnostics)], {
        type: "text/csv;charset=utf-8",
      }),
      "xero-connection-diagnostics.csv",
    );
  };
  const copyXeroDiagnosticsPacket = async () => {
    if (!xeroDiagnostics) {
      return;
    }
    const copied = await copyTextToClipboard(
      xeroConnectionDiagnosticsPacket(xeroDiagnostics),
    );
    setXeroDiagnosticsCopyReceipt(
      copied
        ? "Xero diagnostics packet copied."
        : "Copy unavailable in this browser.",
    );
  };
  const downloadXeroDiagnosticsPacket = () => {
    if (!xeroDiagnostics) {
      return;
    }
    saveBlob(
      new Blob([xeroConnectionDiagnosticsPacket(xeroDiagnostics)], {
        type: "text/plain;charset=utf-8",
      }),
      "xero-connection-diagnostics.txt",
    );
    setXeroDiagnosticsCopyReceipt("Xero diagnostics packet downloaded.");
  };

  const unlinkLoginMutation = useMutation({
    mutationFn: (memberId: string) => unlinkSecurityMemberLogin(memberId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["security-workspace"] });
    },
  });

  const memberMutation = useMutation({
    mutationFn: ({
      memberId,
      payload,
    }: {
      memberId: string;
      payload: SecurityMemberUpdatePayload;
    }) => updateSecurityMember(memberId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["security-workspace"] });
      queryClient.invalidateQueries({ queryKey: ["entities"] });
    },
  });

  const status = xeroStatusQuery.data;
  const issues = status?.issues ?? EMPTY_XERO_ISSUES;
  const mappingIssues = useMemo(
    () =>
      issues.filter((issue) => issue.kind === "chart" || issue.kind === "tax"),
    [issues],
  );
  const selectedEntityRoleMembers = securityQuery.data?.members ?? [];
  const selectedEntityName = selectedEntity?.name ?? "selected entity";
  const selectedEntityTypeLabel = entityTypeLabel(selectedEntity?.entity_type);
  const ownershipSplitPlan = ownershipSplitPlanQuery.data;
  const [splitConfirming, setSplitConfirming] = useState(false);
  const [splitResult, setSplitResult] = useState<OwnershipSplitApplyResult | null>(
    null,
  );
  const applySplitMutation = useMutation({
    mutationFn: () =>
      applyOwnershipSplit(
        (ownershipSplitPlan?.groups ?? []).map((group) => ({
          proposed_name: group.proposed_name,
          property_ids: group.properties.map((property) => property.id),
        })),
      ),
    onSuccess: (result) => {
      setSplitResult(result);
      setSplitConfirming(false);
      queryClient.invalidateQueries({ queryKey: ["entities"] });
      queryClient.invalidateQueries({ queryKey: ["entities-xero-overview"] });
      queryClient.invalidateQueries({ queryKey: ["ownership-split-plan"] });
    },
  });
  const orgEntities = entitiesOverviewForOrg.data?.entities ?? [];
  const toggleEntityRow = (id: string) =>
    setExpandedEntityRows((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  const workEmailEnabledCount = selectedEntityRoleMembers.filter(
    workAssignmentEmailEnabled,
  ).length;
  const workSmsReadyCount = selectedEntityRoleMembers.filter(
    (member) =>
      workAssignmentSmsEnabled(member) && workAssignmentSmsPhone(member),
  ).length;
  const workDigestEnabledCount = selectedEntityRoleMembers.filter(
    (member) => workAssignmentDigestCadence(member) !== "off",
  ).length;
  const workNotificationTemplateCount =
    (notificationTemplateCatalogQuery.data?.notice_templates.length ?? 0) +
    (notificationTemplateCatalogQuery.data?.digest_templates.length ?? 0);
  const workNotificationTemplateLabel =
    notificationTemplateCatalogQuery.isLoading &&
    !notificationTemplateCatalogQuery.data
      ? "Checking templates"
      : `${workNotificationTemplateCount} templates`;
  const selectedXeroContactMatchCount =
    xeroContactPreview?.suggested_matches.filter(
      (match) => selectedXeroContactMatches[xeroContactMatchKey(match)],
    ).length ?? 0;
  const chartTaxCounts = useMemo(() => {
    const results = xeroChartTaxPreview?.results ?? [];
    return {
      ready: results.filter((result) => result.status === "ready").length,
      needsMapping: results.filter(
        (result) => result.status === "needs_mapping",
      ).length,
      notFound: results.filter((result) => result.status === "not_found")
        .length,
    };
  }, [xeroChartTaxPreview]);
  const readyXeroInvoiceDraftIds = useMemo(
    () =>
      (xeroInvoicePostingPreview?.results ?? [])
        .filter((result) => result.status === "ready")
        .map((result) => result.invoice_draft_id),
    [xeroInvoicePostingPreview],
  );
  const locallyApprovedXeroDraftCount = readyXeroInvoiceDraftIds.filter(
    (invoiceDraftId) =>
      xeroInvoiceApprovalResults[invoiceDraftId]?.approval_state === "approved",
  ).length;
  const readyPaymentReconciliationCount =
    xeroPaymentPreview?.results.filter((result) => result.status === "ready")
      .length ?? 0;
  const displayedPaymentReconciliation =
    xeroPaymentApplyResult ?? xeroPaymentPreview;
  const basiqConnection = basiqConnectionStatusQuery.data;
  const handleRevokeBasiqConnection = () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Disconnect the Basiq bank feed for this entity? This revokes the stored consent; no bank data is changed.",
      )
    ) {
      return;
    }
    basiqRevokeMutation.mutate();
  };
  const displayedBasiqReconciliation = basiqApplyResult ?? basiqPreview;
  const approvedBasiqKeyList = (basiqPreview?.results ?? [])
    .filter(
      (result) =>
        result.status === "ready" &&
        result.idempotency_key !== null &&
        approvedBasiqKeys[result.idempotency_key],
    )
    .map((result) => result.idempotency_key as string);
  const addBasiqTransaction = () => {
    const dollars = Number.parseFloat(basiqDraftAmount);
    if (!Number.isFinite(dollars) || !basiqDraftDate.trim()) {
      return;
    }
    const transaction: BasiqImportedTransaction = {
      transaction_id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `basiq-txn-${Date.now()}`,
      amount_cents: Math.round(dollars * 100),
      posted_date: basiqDraftDate.trim(),
    };
    // BasiqImportedTransaction has no invoice_number field; the optional
    // invoice number is carried in `reference` (the field the backend
    // reads when matching) so nothing the operator types is dropped.
    const reference = [
      basiqDraftReference.trim(),
      basiqDraftInvoiceNumber.trim(),
    ]
      .filter(Boolean)
      .join(" ");
    if (reference) {
      transaction.reference = reference;
    }
    setBasiqTransactions((current) => [...current, transaction]);
    setBasiqDraftAmount("");
    setBasiqDraftDate("");
    setBasiqDraftReference("");
    setBasiqDraftInvoiceNumber("");
    setBasiqPreview(null);
    setBasiqApplyResult(null);
    setApprovedBasiqKeys({});
  };
  const removeBasiqTransaction = (transactionId: string) => {
    setBasiqTransactions((current) =>
      current.filter((item) => item.transaction_id !== transactionId),
    );
    setBasiqPreview(null);
    setBasiqApplyResult(null);
    setApprovedBasiqKeys({});
  };
  const exceptionQueue = xeroExceptionQueueQuery.data;
  const exceptionItems = exceptionQueue?.items ?? [];
  const copyXeroExceptionPacket = async () => {
    if (!exceptionQueue) {
      return;
    }
    const copied = await copyTextToClipboard(
      xeroExceptionReviewPacket(exceptionQueue),
    );
    setXeroExceptionExportReceipt(
      copied
        ? "Xero exception packet copied."
        : "Copy unavailable in this browser.",
    );
  };
  const downloadXeroExceptionCsv = () => {
    if (!exceptionQueue) {
      return;
    }
    saveBlob(
      new Blob([xeroExceptionCsv(exceptionQueue)], {
        type: "text/csv;charset=utf-8",
      }),
      "xero-exception-review.csv",
    );
    setXeroExceptionExportReceipt("Xero exception CSV downloaded.");
  };
  const xeroDiagnostics = xeroDiagnosticsQuery.data;
  const securityWorkspace = securityQuery.data;
  const isSecurityWorkspaceLoading =
    securityQuery.isLoading && !securityWorkspace;
  const operatorLoginResolved = Boolean(securityWorkspace);
  const operatorLoginEnforced =
    securityWorkspace?.auth.operator_login_enforced ?? false;
  const clerkConfigResolved = Boolean(securityWorkspace);
  const clerkConfigReady =
    Boolean(securityWorkspace?.auth.clerk_secret_configured) &&
    Boolean(securityWorkspace?.auth.clerk_jwks_configured);
  const securityControlStatus = isSecurityWorkspaceLoading
    ? "Checking"
    : securityWorkspace?.can_manage_security
      ? "Owner/admin controls"
      : "Read-only";
  const organisationNameLabel = securityWorkspace
    ? securityWorkspace.organisation.name
    : securityQuery.isLoading
      ? "Checking organisation"
      : "Organisation unavailable";
  const organisationTimezoneLabel = securityWorkspace
    ? securityWorkspace.organisation.timezone
    : securityQuery.isLoading
      ? "Checking timezone"
      : "Timezone unavailable";
  const organisationEntityCountLabel =
    entitiesQuery.isLoading && !entitiesQuery.data
      ? "Checking"
      : (entitiesQuery.data?.length ?? 0);
  const ownershipTagLabel =
    propertiesQuery.isLoading && !propertiesQuery.data
      ? "Checking ownership tags"
      : `${ownershipTags.length} ${
          ownershipTags.length === 1 ? "tag" : "tags"
        }`;
  const storedTemplateOverrideLabel =
    brandedTemplatesQuery.isLoading && !brandedTemplatesQuery.data
      ? "Checking overrides"
      : `${brandedTemplates.length} stored`;
  const xeroExceptionOpenLabel =
    xeroExceptionQueueQuery.isLoading && !exceptionQueue
      ? "Checking"
      : `${exceptionQueue?.summary.total ?? 0} open`;
  const xeroExceptionOpenTone =
    xeroExceptionQueueQuery.isLoading && !exceptionQueue
      ? "neutral"
      : exceptionQueue?.summary.blockers
        ? "danger"
        : exceptionItems.length
          ? "warning"
          : "success";
  const xeroDiagnosticsReady = Boolean(xeroDiagnostics);
  const xeroCanStartOauth = xeroDiagnostics?.can_start_oauth ?? false;
  const xeroCanPreviewContacts = xeroDiagnostics?.can_preview_contacts ?? false;
  const xeroCanValidateChartTax =
    xeroDiagnostics?.can_validate_chart_tax ?? false;
  const xeroCanPreviewInvoicePosting =
    xeroDiagnostics?.can_preview_invoice_posting ?? false;
  const xeroCanPreviewPayments =
    xeroDiagnostics?.can_preview_payment_reconciliation ?? false;
  const xeroCanCreateDrafts = xeroDiagnostics?.can_create_xero_drafts ?? false;
  const xeroConnectedOrgName =
    status?.connection.tenant_name ?? status?.connection.xero_tenant_id ?? null;
  const xeroHasProviderConnection =
    status?.connection.connection_source === "provider";
  const xeroPrimaryConnectLabel = status?.connection.connected
    ? "Reconnect Xero"
    : "Connect this entity";
  const xeroConnectionSummary = xeroHasProviderConnection
    ? `Connected to ${xeroConnectedOrgName ?? "Xero"}`
    : status?.connection.connection_source === "manual"
      ? "Manual connection recorded"
      : "Not connected yet";
  const entityXeroStatusMeta: Record<
    EntityXeroStatusValue,
    { label: string; tone: "success" | "warning" | "danger" | "neutral" }
  > = {
    connected: { label: "Connected", tone: "success" },
    token_expired: { label: "Token expired", tone: "danger" },
    manual: { label: "Manual", tone: "neutral" },
    not_connected: { label: "Not connected", tone: "warning" },
  };
  const xeroOverview = entitiesXeroOverviewQuery.data;
  const xeroNextUnconnectedEntity = xeroOverview?.entities.find(
    (row) =>
      row.xero_status === "not_connected" ||
      row.xero_status === "token_expired",
  );
  const accountingStep = status
    ? accountingNextStep({
        freshness: status.accounting_freshness,
        exceptionBlockers: exceptionQueue?.summary.blockers ?? 0,
        exceptionWarnings: exceptionQueue?.summary.warnings ?? 0,
      })
    : null;
  const downloadXeroFreshnessCsv = () => {
    if (!status) {
      return;
    }
    saveBlob(
      new Blob(
        [
          xeroAccountingFreshnessCsv({
            freshness: status.accounting_freshness,
            nextStep: accountingStep,
          }),
        ],
        {
          type: "text/csv;charset=utf-8",
        },
      ),
      "xero-accounting-freshness.csv",
    );
  };
  const copyXeroFreshnessPacket = async () => {
    if (!status) {
      return;
    }
    const copied = await copyTextToClipboard(
      xeroAccountingFreshnessPacket({
        freshness: status.accounting_freshness,
        nextStep: accountingStep,
      }),
    );
    setXeroFreshnessPacketReceipt(
      copied
        ? "Xero freshness packet copied."
        : "Copy unavailable in this browser.",
    );
  };
  const scrollToPanel = (target: PanelRef) => {
    window.setTimeout(() => {
      target.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  };
  const exceptionActionLabel = (issue: XeroExceptionQueueItemRecord) => {
    if (!issue.next_action) {
      return null;
    }
    if (issue.next_action === "connect_xero") {
      return xeroCanStartOauth ? "Connect Xero" : "Review connection";
    }
    if (issue.next_action === "review_contact_mapping") {
      return xeroCanPreviewContacts ? "Review contacts" : "Connect Xero";
    }
    if (issue.next_action === "review_chart_tax_mapping") {
      return issue.charge_rule_id ? "Apply suggestion" : "Review mapping";
    }
    if (issue.next_action === "review_invoice_posting") {
      return "Review posting";
    }
    if (issue.next_action === "preview_payment_reconciliation") {
      return "Review payments";
    }
    if (issue.next_action.includes("email")) {
      return "Open delivery";
    }
    if (
      issue.next_action.includes("dispatch") ||
      issue.next_action.includes("provider") ||
      issue.next_action.includes("blockers")
    ) {
      return "Open delivery";
    }
    return "Review next step";
  };
  const exceptionActionPending = (issue: XeroExceptionQueueItemRecord) => {
    if (issue.next_action === "connect_xero") {
      return xeroOAuthMutation.isPending;
    }
    if (issue.next_action === "review_contact_mapping") {
      return xeroContactSyncMutation.isPending || xeroOAuthMutation.isPending;
    }
    if (issue.next_action === "review_chart_tax_mapping") {
      return (
        mappingMutation.isPending && mappingMutation.variables?.id === issue.id
      );
    }
    if (issue.next_action === "review_invoice_posting") {
      return xeroInvoicePostingMutation.isPending;
    }
    if (issue.next_action === "preview_payment_reconciliation") {
      return xeroPaymentPreviewMutation.isPending;
    }
    return false;
  };
  const exceptionActionDisabled = (issue: XeroExceptionQueueItemRecord) => {
    if (!selectedEntityId || !issue.next_action) {
      return true;
    }
    if (!status) {
      return true;
    }
    if (exceptionActionPending(issue)) {
      return true;
    }
    if (issue.next_action === "connect_xero") {
      return !xeroCanStartOauth;
    }
    if (issue.next_action === "review_contact_mapping") {
      return !xeroCanPreviewContacts && !xeroCanStartOauth;
    }
    if (issue.next_action === "review_invoice_posting") {
      return !xeroCanPreviewInvoicePosting;
    }
    if (issue.next_action === "preview_payment_reconciliation") {
      return !xeroCanPreviewPayments;
    }
    return false;
  };
  const handleExceptionAction = (issue: XeroExceptionQueueItemRecord) => {
    if (!status) {
      return;
    }
    if (issue.next_action === "connect_xero") {
      if (xeroCanStartOauth) {
        xeroOAuthMutation.mutate(undefined, {
          onSuccess: () => scrollToPanel(xeroConnectionPanelRef),
        });
        return;
      }
      scrollToPanel(xeroConnectionPanelRef);
      return;
    }
    if (issue.next_action === "review_contact_mapping") {
      if (xeroCanPreviewContacts) {
        xeroContactSyncMutation.mutate(undefined, {
          onSuccess: () => scrollToPanel(xeroContactPreviewPanelRef),
        });
        return;
      }
      if (xeroCanStartOauth) {
        xeroOAuthMutation.mutate(undefined, {
          onSuccess: () => scrollToPanel(xeroConnectionPanelRef),
        });
        return;
      }
      scrollToPanel(xeroConnectionPanelRef);
      return;
    }
    if (issue.next_action === "review_chart_tax_mapping") {
      if (issue.charge_rule_id) {
        mappingMutation.mutate(issue, {
          onSuccess: () => scrollToPanel(xeroChartMappingPanelRef),
        });
        return;
      }
      scrollToPanel(xeroChartMappingPanelRef);
      return;
    }
    if (issue.next_action === "review_invoice_posting") {
      xeroInvoicePostingMutation.mutate(undefined, {
        onSuccess: () => scrollToPanel(xeroInvoicePostingPanelRef),
      });
      return;
    }
    if (issue.next_action === "preview_payment_reconciliation") {
      xeroPaymentPreviewMutation.mutate(undefined, {
        onSuccess: () => scrollToPanel(xeroPaymentPanelRef),
      });
      return;
    }
    if (
      issue.next_action?.includes("email") ||
      issue.next_action?.includes("dispatch") ||
      issue.next_action?.includes("provider") ||
      issue.next_action?.includes("blockers")
    ) {
      window.location.href = billingReadinessHandoffHref({
        entityId: selectedEntityId,
        invoiceDraftId: issue.invoice_draft_id,
      });
      return;
    }
    scrollToPanel(xeroConnectionPanelRef);
  };

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
              ? `${selectedEntity.name} access, organisation, and integration controls.`
              : "Choose an entity to review access, organisation, and integration controls."
          }
          actions={
            <SecondaryButton
              type="button"
              onClick={() => xeroStatusQuery.refetch()}
              disabled={
                activeTab !== "connect" ||
                !selectedEntityId ||
                xeroStatusQuery.isFetching
              }
            >
              <RefreshCw size={15} />
              Refresh
            </SecondaryButton>
          }
        />

        <SettingsAppearancePanel />

        <div
          aria-label="Settings sections"
          className="flex w-full flex-wrap gap-2 rounded-2xl border border-border bg-white p-1 shadow-leasiumXs md:w-fit"
          role="tablist"
        >
          {settingsTabs.map((tab) => (
            <button
              key={tab.id}
              aria-selected={activeTab === tab.id}
              className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-shadow duration-200 ease-leasium ${
                activeTab === tab.id
                  ? "bg-primary text-white shadow-leasiumXs"
                  : "text-leasium-slate-600 hover:bg-muted hover:text-foreground"
              }`}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              type="button"
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {entitiesQuery.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {entitiesQuery.error instanceof Error
              ? entitiesQuery.error.message
              : "Could not load entities."}
          </div>
        ) : null}
        {activeTab === "connect" && xeroStatusQuery.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {xeroStatusQuery.error instanceof Error
              ? xeroStatusQuery.error.message
              : "Could not load Xero readiness."}
          </div>
        ) : null}
        {activeTab === "connect" && xeroDiagnosticsQuery.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            <div>
              {xeroDiagnosticsQuery.error instanceof Error
                ? xeroDiagnosticsQuery.error.message
                : "Could not load Xero connection diagnostics."}
            </div>
            <div className="mt-1">
              Xero actions stay disabled until the setup check reloads.
            </div>
          </div>
        ) : null}
        {activeTab === "connect" && xeroExceptionQueueQuery.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {xeroExceptionQueueQuery.error instanceof Error
              ? xeroExceptionQueueQuery.error.message
              : "Could not load Xero sync exceptions."}
          </div>
        ) : null}
        {activeTab === "connect" && connectionMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {connectionMutation.error instanceof Error
              ? connectionMutation.error.message
              : "Could not update Xero connection status."}
          </div>
        ) : null}
        {activeTab === "connect" && xeroOAuthMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {xeroOAuthMutation.error instanceof Error
              ? xeroOAuthMutation.error.message
              : "Could not start the Xero connection."}
          </div>
        ) : null}
        {activeTab === "connect" && xeroContactSyncMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {xeroContactSyncMutation.error instanceof Error
              ? xeroContactSyncMutation.error.message
              : "Could not preview Xero contacts."}
          </div>
        ) : null}
        {activeTab === "connect" && xeroContactApplyMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {xeroContactApplyMutation.error instanceof Error
              ? xeroContactApplyMutation.error.message
              : "Could not apply the selected Xero contact mappings."}
          </div>
        ) : null}
        {activeTab === "connect" && xeroChartTaxMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {xeroChartTaxMutation.error instanceof Error
              ? xeroChartTaxMutation.error.message
              : "Could not preview Xero chart and tax validation."}
          </div>
        ) : null}
        {activeTab === "connect" && xeroInvoicePostingMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {xeroInvoicePostingMutation.error instanceof Error
              ? xeroInvoicePostingMutation.error.message
              : "Could not preview Xero invoice posting."}
          </div>
        ) : null}
        {activeTab === "connect" && xeroInvoiceApprovalMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {xeroInvoiceApprovalMutation.error instanceof Error
              ? xeroInvoiceApprovalMutation.error.message
              : "Could not record Xero posting approval."}
          </div>
        ) : null}
        {activeTab === "connect" && xeroDraftCreateMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {xeroDraftCreateMutation.error instanceof Error
              ? xeroDraftCreateMutation.error.message
              : "Could not create Xero draft invoices."}
          </div>
        ) : null}
        {activeTab === "connect" && mappingMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {mappingMutation.error instanceof Error
              ? mappingMutation.error.message
              : "Could not update the Xero mapping."}
          </div>
        ) : null}
        {securityQuery.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {securityQuery.error instanceof Error
              ? securityQuery.error.message
              : "Could not load security settings."}
          </div>
        ) : null}
        {inviteMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {inviteMutation.error instanceof Error
              ? inviteMutation.error.message
              : "Could not add the operator."}
          </div>
        ) : null}
        {memberMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {memberMutation.error instanceof Error
              ? memberMutation.error.message
              : "Could not update the operator."}
          </div>
        ) : null}
        {resendInviteMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {resendInviteMutation.error instanceof Error
              ? resendInviteMutation.error.message
              : "Could not send the operator invite."}
          </div>
        ) : null}
        {unlinkLoginMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {unlinkLoginMutation.error instanceof Error
              ? unlinkLoginMutation.error.message
              : "Could not unlink the operator login."}
          </div>
        ) : null}

        {activeTab === "security" ? (
          <>
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Auth mode"
                value={
                  securityWorkspace
                    ? authModeLabel(securityWorkspace.auth.auth_mode)
                    : "Checking"
                }
                detail={
                  securityWorkspace?.auth.login_boundary ??
                  "Checking current login boundary."
                }
                tone={operatorLoginEnforced ? "success" : "neutral"}
                icon={<ShieldCheck size={18} />}
                statusValue
              />
              <MetricCard
                label="Operator login"
                value={
                  !operatorLoginResolved
                    ? "Checking"
                    : operatorLoginEnforced
                      ? "Enforced"
                      : "Pre-prod"
                }
                detail={
                  !operatorLoginResolved
                    ? "Checking the configured operator login boundary."
                    : operatorLoginEnforced
                      ? "Production requests resolve through the configured provider."
                      : "Private beta access is still protected by the temporary gate."
                }
                tone={
                  !operatorLoginResolved
                    ? "neutral"
                    : operatorLoginEnforced
                      ? "success"
                      : "warning"
                }
                icon={<KeyRound size={18} />}
                statusValue
              />
              <MetricCard
                label="Clerk config"
                value={
                  !clerkConfigResolved
                    ? "Checking"
                    : clerkConfigReady
                      ? "Ready"
                      : "Pending"
                }
                detail="Secret and JWKS settings are tracked without exposing values."
                tone={clerkConfigReady ? "success" : "neutral"}
                icon={<PlugZap size={18} />}
                statusValue
              />
              <MetricCard
                label="Operators"
                value={
                  securityWorkspace
                    ? securityWorkspace.members.length
                    : "Checking"
                }
                detail={`${selectedEntityName} role access can be reviewed below.`}
                tone="primary"
                icon={<UsersRound size={18} />}
              />
            </section>

            <SectionPanel
              title="Operator access"
              description="Send provider-backed invite emails and choose access for the selected entity."
              icon={<UserPlus size={17} className="text-primary" />}
              actions={
                <StatusBadge
                  tone={
                    isSecurityWorkspaceLoading
                      ? "neutral"
                      : securityWorkspace?.can_manage_security
                        ? "success"
                        : "warning"
                  }
                >
                  {securityControlStatus}
                </StatusBadge>
              }
            >
              <div className="grid gap-4 p-4 lg:grid-cols-[1fr_360px]">
                <div className="grid gap-3">
                  <div className="rounded-md border border-border bg-muted/25 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge
                        tone={
                          isSecurityWorkspaceLoading
                            ? "neutral"
                            : securityWorkspace?.auth.dev_auth_active
                              ? "warning"
                              : "success"
                        }
                      >
                        {isSecurityWorkspaceLoading
                          ? "Checking login"
                          : securityWorkspace?.auth.dev_auth_active
                            ? "Dev auth active"
                            : "Provider login active"}
                      </StatusBadge>
                      <span className="font-medium">
                        {securityWorkspace?.current_user.display_name ??
                          "Checking operator"}
                      </span>
                    </div>
                    <p className="mt-2 text-muted-foreground">
                      {securityWorkspace?.current_user.email ??
                        "Current operator details will appear here."}
                    </p>
                  </div>
                  {securityQuery.data?.auth.next_steps.length ? (
                    <div className="rounded-md border border-border bg-white p-3">
                      <div className="text-sm font-semibold">
                        Login rollout checklist
                      </div>
                      <ul className="mt-2 grid gap-2 text-sm text-muted-foreground">
                        {securityQuery.data.auth.next_steps.map((step) => (
                          <li key={step} className="flex gap-2">
                            <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary" />
                            <span>{step}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>

                <form
                  className="grid gap-3 rounded-md border border-border bg-muted/25 p-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    inviteMutation.mutate();
                  }}
                >
                  <Field label="Name">
                    <Input
                      value={inviteDisplayName}
                      onChange={(event) =>
                        setInviteDisplayName(event.target.value)
                      }
                      placeholder="Alex Morgan"
                    />
                  </Field>
                  <Field label="Email">
                    <Input
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="alex@example.com"
                      type="email"
                    />
                  </Field>
                  <Field label="Role for selected entity">
                    <Select
                      value={inviteRole}
                      onChange={(event) =>
                        setInviteRole(event.target.value as SecurityRole)
                      }
                    >
                      {roleOptions.map((role) => (
                        <option key={role.value} value={role.value}>
                          {role.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Button
                    type="submit"
                    disabled={
                      inviteMutation.isPending ||
                      !securityQuery.data?.can_manage_security ||
                      !selectedEntityId ||
                      !inviteEmail.trim()
                    }
                  >
                    {inviteMutation.isPending ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Send size={15} />
                    )}
                    Send invite
                  </Button>
                  {latestInviteLink ? (
                    <div className="grid gap-2 rounded-md border border-success/30 bg-success-soft/60 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-success-strong">
                            Invite link ready
                          </div>
                          <div className="truncate text-xs text-success-strong/80">
                            {latestInviteLink.email}
                          </div>
                        </div>
                        <SecondaryButton
                          type="button"
                          className="shrink-0"
                          onClick={copyLatestInviteLink}
                        >
                          {latestInviteLink.copied ? (
                            <CheckCircle2 size={14} />
                          ) : (
                            <Copy size={14} />
                          )}
                          {latestInviteLink.copied ? "Copied" : "Copy"}
                        </SecondaryButton>
                      </div>
                      <Input
                        value={latestInviteLink.url}
                        readOnly
                        aria-label="Latest invite link"
                        className="text-xs"
                      />
                    </div>
                  ) : null}
                </form>
              </div>
            </SectionPanel>

            <SectionPanel
              title="Users and roles"
              description={`Review who can access ${selectedEntityName}.`}
              icon={<UsersRound size={17} className="text-primary" />}
            >
              <div className="grid gap-3 p-4 lg:hidden">
                {selectedEntityRoleMembers.map((member) => {
                  const roleKey = `${member.id}:${selectedEntityId}`;
                  const currentRole = roleForEntity(member, selectedEntityId);
                  const draftRole =
                    roleDrafts[roleKey] ?? currentRole?.role ?? "";
                  const isSelf =
                    member.id === securityQuery.data?.current_user.id;
                  const isUpdating =
                    memberMutation.isPending &&
                    memberMutation.variables?.memberId === member.id;
                  const isSendingInvite =
                    resendInviteMutation.isPending &&
                    resendInviteMutation.variables === member.id;
                  const isUnlinking =
                    unlinkLoginMutation.isPending &&
                    unlinkLoginMutation.variables === member.id;

                  return (
                    <article
                      key={member.id}
                      className="grid gap-3 rounded-md border border-border bg-white p-3 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="break-words font-medium">
                          {member.display_name}
                        </div>
                        {member.display_name !== member.email ? (
                          <div className="mt-1 break-all text-xs text-muted-foreground">
                            {member.email}
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <StatusBadge tone={accessStatusTone(member)}>
                          {accessStatusLabel(member)}
                        </StatusBadge>
                        {member.access_status !== "login_linked" &&
                        member.access_status !== "disabled" ? (
                          <StatusBadge tone={inviteTone(member)}>
                            {inviteLabel(member)}
                          </StatusBadge>
                        ) : null}
                      </div>

                      <p className="text-xs text-muted-foreground">
                        {member.invite_email_detail}
                      </p>
                      {member.invite_sent_at ? (
                        <p className="text-xs text-muted-foreground">
                          Sent {formatDateTime(member.invite_sent_at)}
                        </p>
                      ) : null}

                      <div className="grid gap-2 rounded-md border border-border bg-muted/20 p-3">
                        <div className="text-xs font-semibold uppercase text-muted-foreground">
                          Selected entity role
                        </div>
                        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                          <Select
                            aria-label={`${member.display_name} role`}
                            value={draftRole}
                            onChange={(event) =>
                              setRoleDrafts((drafts) => ({
                                ...drafts,
                                [roleKey]: event.target.value as
                                  | SecurityRole
                                  | "",
                              }))
                            }
                          >
                            <option value="">No access</option>
                            {roleOptions.map((role) => (
                              <option key={role.value} value={role.value}>
                                {role.label}
                              </option>
                            ))}
                          </Select>
                          <SecondaryButton
                            type="button"
                            className="min-h-10 justify-center"
                            disabled={
                              isUpdating ||
                              !securityQuery.data?.can_manage_security ||
                              !selectedEntityId
                            }
                            onClick={() =>
                              memberMutation.mutate({
                                memberId: member.id,
                                payload: {
                                  roles: nextRolesForEntity(
                                    member,
                                    selectedEntityId,
                                    draftRole,
                                  ),
                                },
                              })
                            }
                          >
                            {isUpdating ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <CheckCircle2 size={14} />
                            )}
                            Save
                          </SecondaryButton>
                        </div>
                      </div>

                      <div className="grid gap-2 rounded-md border border-border bg-muted/20 p-3">
                        <div className="text-xs font-semibold uppercase text-muted-foreground">
                          All access
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {member.roles.map((role) => (
                            <StatusBadge
                              key={`${member.id}-${role.entity_id}`}
                              tone="neutral"
                            >
                              {role.entity_name}: {roleLabel(role.role)}
                            </StatusBadge>
                          ))}
                          {member.roles.length === 0 ? (
                            <span className="text-xs text-muted-foreground">
                              No entity access
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        {!member.login_linked ? (
                          <SecondaryButton
                            type="button"
                            className="min-h-10 justify-center"
                            disabled={
                              isSendingInvite ||
                              !member.is_active ||
                              !securityQuery.data?.can_manage_security
                            }
                            onClick={() =>
                              resendInviteMutation.mutate(member.id)
                            }
                          >
                            {isSendingInvite ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Send size={14} />
                            )}
                            Send invite
                          </SecondaryButton>
                        ) : null}
                        {member.login_linked && !isSelf ? (
                          <SecondaryButton
                            type="button"
                            className="min-h-10 justify-center"
                            disabled={
                              isUnlinking ||
                              !securityQuery.data?.can_manage_security
                            }
                            onClick={() =>
                              unlinkLoginMutation.mutate(member.id)
                            }
                          >
                            {isUnlinking ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <KeyRound size={14} />
                            )}
                            Unlink login
                          </SecondaryButton>
                        ) : null}
                        {member.is_active ? (
                          <button
                            type="button"
                            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-2 text-xs font-medium text-muted-foreground transition hover:text-danger-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/30 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={
                              isSelf ||
                              isUpdating ||
                              !securityQuery.data?.can_manage_security
                            }
                            onClick={() => {
                              if (
                                typeof window !== "undefined" &&
                                !window.confirm(
                                  `Deactivate ${member.display_name}? They lose access until reactivated.`,
                                )
                              ) {
                                return;
                              }
                              memberMutation.mutate({
                                memberId: member.id,
                                payload: { is_active: false },
                              });
                            }}
                          >
                            <Ban size={14} />
                            Deactivate
                          </button>
                        ) : (
                          <SecondaryButton
                            type="button"
                            className="min-h-10 justify-center"
                            disabled={
                              isSelf ||
                              isUpdating ||
                              !securityQuery.data?.can_manage_security
                            }
                            onClick={() =>
                              memberMutation.mutate({
                                memberId: member.id,
                                payload: { is_active: true },
                              })
                            }
                          >
                            <CheckCircle2 size={14} />
                            Activate
                          </SecondaryButton>
                        )}
                      </div>
                    </article>
                  );
                })}
                {!securityQuery.isLoading &&
                selectedEntityRoleMembers.length === 0 ? (
                  <EmptyState
                    icon={<UsersRound size={18} />}
                    title="No operators yet"
                    description="Owner and admin users will appear here once the security workspace loads."
                  />
                ) : null}
              </div>

              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full border-collapse text-left text-sm tabular-nums">
                  <thead className="bg-muted text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Operator</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="px-3 py-2 font-semibold">
                        Selected entity role
                      </th>
                      <th className="px-3 py-2 font-semibold">All access</th>
                      <th className="px-3 py-2 font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedEntityRoleMembers.map((member) => {
                      const roleKey = `${member.id}:${selectedEntityId}`;
                      const currentRole = roleForEntity(
                        member,
                        selectedEntityId,
                      );
                      const draftRole =
                        roleDrafts[roleKey] ?? currentRole?.role ?? "";
                      const isSelf =
                        member.id === securityQuery.data?.current_user.id;
                      const isUpdating =
                        memberMutation.isPending &&
                        memberMutation.variables?.memberId === member.id;
                      const isSendingInvite =
                        resendInviteMutation.isPending &&
                        resendInviteMutation.variables === member.id;
                      const isUnlinking =
                        unlinkLoginMutation.isPending &&
                        unlinkLoginMutation.variables === member.id;
                      return (
                        <tr
                          key={member.id}
                          className="border-t border-border align-top"
                        >
                          <td className="min-w-64 px-3 py-3">
                            <div className="font-medium">
                              {member.display_name}
                            </div>
                            {member.display_name !== member.email ? (
                              <div className="mt-1 text-xs text-muted-foreground">
                                {member.email}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap gap-2">
                              <StatusBadge tone={accessStatusTone(member)}>
                                {accessStatusLabel(member)}
                              </StatusBadge>
                              {member.access_status !== "login_linked" &&
                              member.access_status !== "disabled" ? (
                                <StatusBadge tone={inviteTone(member)}>
                                  {inviteLabel(member)}
                                </StatusBadge>
                              ) : null}
                            </div>
                            <div className="mt-2 max-w-48 text-xs text-muted-foreground">
                              {member.invite_email_detail}
                            </div>
                            {member.invite_sent_at ? (
                              <div className="mt-1 text-xs text-muted-foreground">
                                Sent {formatDateTime(member.invite_sent_at)}
                              </div>
                            ) : null}
                          </td>
                          <td className="min-w-52 px-3 py-3">
                            <div className="flex gap-2">
                              <Select
                                aria-label={`${member.display_name} role`}
                                value={draftRole}
                                onChange={(event) =>
                                  setRoleDrafts((drafts) => ({
                                    ...drafts,
                                    [roleKey]: event.target.value as
                                      | SecurityRole
                                      | "",
                                  }))
                                }
                              >
                                <option value="">No access</option>
                                {roleOptions.map((role) => (
                                  <option key={role.value} value={role.value}>
                                    {role.label}
                                  </option>
                                ))}
                              </Select>
                              <SecondaryButton
                                type="button"
                                disabled={
                                  isUpdating ||
                                  !securityQuery.data?.can_manage_security ||
                                  !selectedEntityId
                                }
                                onClick={() =>
                                  memberMutation.mutate({
                                    memberId: member.id,
                                    payload: {
                                      roles: nextRolesForEntity(
                                        member,
                                        selectedEntityId,
                                        draftRole,
                                      ),
                                    },
                                  })
                                }
                              >
                                {isUpdating ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <CheckCircle2 size={14} />
                                )}
                                Save
                              </SecondaryButton>
                            </div>
                          </td>
                          <td className="min-w-64 px-3 py-3">
                            <div className="flex flex-wrap gap-2">
                              {member.roles.map((role) => (
                                <StatusBadge
                                  key={`${member.id}-${role.entity_id}`}
                                  tone="neutral"
                                >
                                  {role.entity_name}: {roleLabel(role.role)}
                                </StatusBadge>
                              ))}
                              {member.roles.length === 0 ? (
                                <span className="text-xs text-muted-foreground">
                                  No entity access
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap gap-2">
                              {!member.login_linked ? (
                                <SecondaryButton
                                  type="button"
                                  disabled={
                                    isSendingInvite ||
                                    !member.is_active ||
                                    !securityQuery.data?.can_manage_security
                                  }
                                  onClick={() =>
                                    resendInviteMutation.mutate(member.id)
                                  }
                                >
                                  {isSendingInvite ? (
                                    <Loader2
                                      size={14}
                                      className="animate-spin"
                                    />
                                  ) : (
                                    <Send size={14} />
                                  )}
                                  Send invite
                                </SecondaryButton>
                              ) : null}
                              {member.login_linked && !isSelf ? (
                                <SecondaryButton
                                  type="button"
                                  disabled={
                                    isUnlinking ||
                                    !securityQuery.data?.can_manage_security
                                  }
                                  onClick={() =>
                                    unlinkLoginMutation.mutate(member.id)
                                  }
                                >
                                  {isUnlinking ? (
                                    <Loader2
                                      size={14}
                                      className="animate-spin"
                                    />
                                  ) : (
                                    <KeyRound size={14} />
                                  )}
                                  Unlink login
                                </SecondaryButton>
                              ) : null}
                              {member.is_active ? (
                                <button
                                  type="button"
                                  className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition hover:text-danger-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/30 disabled:cursor-not-allowed disabled:opacity-50"
                                  disabled={
                                    isSelf ||
                                    isUpdating ||
                                    !securityQuery.data?.can_manage_security
                                  }
                                  onClick={() => {
                                    if (
                                      typeof window !== "undefined" &&
                                      !window.confirm(
                                        `Deactivate ${member.display_name}? They lose access until reactivated.`,
                                      )
                                    ) {
                                      return;
                                    }
                                    memberMutation.mutate({
                                      memberId: member.id,
                                      payload: { is_active: false },
                                    });
                                  }}
                                >
                                  <Ban size={14} />
                                  Deactivate
                                </button>
                              ) : (
                                <SecondaryButton
                                  type="button"
                                  disabled={
                                    isSelf ||
                                    isUpdating ||
                                    !securityQuery.data?.can_manage_security
                                  }
                                  onClick={() =>
                                    memberMutation.mutate({
                                      memberId: member.id,
                                      payload: { is_active: true },
                                    })
                                  }
                                >
                                  <CheckCircle2 size={14} />
                                  Activate
                                </SecondaryButton>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {!securityQuery.isLoading &&
                    selectedEntityRoleMembers.length === 0 ? (
                      <tr>
                        <td className="px-3 py-10" colSpan={5}>
                          <EmptyState
                            icon={<UsersRound size={18} />}
                            title="No operators yet"
                            description="Owner and admin users will appear here once the security workspace loads."
                          />
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </SectionPanel>

            <SectionPanel
              title="Work notifications"
              description="Choose Work notice channels, SMS recovery, digest cadence, and template defaults per operator."
              icon={<Bell size={17} className="text-primary" />}
              actions={
                <div className="flex flex-wrap gap-2">
                  <StatusBadge tone="success">
                    {workEmailEnabledCount} email on
                  </StatusBadge>
                  <StatusBadge tone={workSmsReadyCount ? "primary" : "neutral"}>
                    {workSmsReadyCount} SMS ready
                  </StatusBadge>
                  <StatusBadge tone="primary">
                    {workDigestEnabledCount} digest on
                  </StatusBadge>
                  <StatusBadge tone="neutral">
                    {workNotificationTemplateLabel}
                  </StatusBadge>
                </div>
              }
            >
              <div className="divide-y divide-border">
                {selectedEntityRoleMembers.map((member) => {
                  const currentRole = roleForEntity(member, selectedEntityId);
                  const isUpdating =
                    memberMutation.isPending &&
                    memberMutation.variables?.memberId === member.id;
                  const workEmailEnabled = workAssignmentEmailEnabled(member);
                  const digestCadence = workAssignmentDigestCadence(member);
                  const templateDraft =
                    notificationTemplateDrafts[member.id] ??
                    workNotificationTemplateDraft(member);
                  const cleanTemplateDraft =
                    normalisedTemplateDraft(templateDraft);
                  const templatesChanged = templateDraftChanged(
                    member,
                    templateDraft,
                  );
                  const noticeTemplateChoices = notificationTemplateOptions({
                    templates:
                      notificationTemplateCatalogQuery.data?.notice_templates,
                    currentKey: cleanTemplateDraft.noticeKey,
                    currentVersion: cleanTemplateDraft.noticeVersion,
                    kind: "assignment_notice",
                  });
                  const digestTemplateChoices = notificationTemplateOptions({
                    templates:
                      notificationTemplateCatalogQuery.data?.digest_templates,
                    currentKey: cleanTemplateDraft.digestKey,
                    currentVersion: cleanTemplateDraft.digestVersion,
                    kind: "digest",
                  });
                  const templatePreview = notificationTemplatePreview(
                    member,
                    templateDraft,
                    notificationTemplateCatalogQuery.data,
                  );
                  const canManageSecurity =
                    Boolean(securityQuery.data?.can_manage_security) &&
                    !isUpdating;
                  const workSmsEnabled = workAssignmentSmsEnabled(member);
                  const smsPhone = workAssignmentSmsPhone(member);
                  const smsPhoneDraft = smsPhoneDrafts[member.id] ?? smsPhone;
                  const smsPhoneChanged = smsPhoneDraft.trim() !== smsPhone;
                  const showSmsPhoneControls =
                    workSmsEnabled || smsPhoneDraft.trim().length > 0;
                  const updateTemplateDraft = (
                    patch: Partial<NotificationTemplateDraft>,
                  ) =>
                    setNotificationTemplateDrafts((drafts) => ({
                      ...drafts,
                      [member.id]: {
                        ...workNotificationTemplateDraft(member),
                        ...drafts[member.id],
                        ...patch,
                      },
                    }));

                  return (
                    <div
                      key={`${member.id}-notifications`}
                      className="grid gap-2 px-4 py-2 lg:grid-cols-[minmax(170px,.75fr)_minmax(260px,1.25fr)_minmax(190px,.75fr)] lg:items-start"
                    >
                      {/* Name + role */}
                      <div className="min-w-0 lg:pt-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate font-medium">
                            {member.display_name}
                          </div>
                          <StatusBadge tone="neutral">
                            {currentRole
                              ? roleLabel(currentRole.role)
                              : "No access"}
                          </StatusBadge>
                        </div>
                        {member.display_name !== member.email ? (
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">
                            {member.email}
                          </div>
                        ) : null}
                      </div>

                      {/* Email + SMS — flat, no inner boxes */}
                      <div className="grid gap-1.5">
                        <label className="flex min-h-11 items-center gap-3 rounded-md border border-border px-3 text-sm">
                          <input
                            aria-label={`${member.display_name} assignment email notifications`}
                            checked={workEmailEnabled}
                            className="h-4 w-4 accent-primary"
                            disabled={!canManageSecurity}
                            onChange={(event) =>
                              memberMutation.mutate({
                                memberId: member.id,
                                payload: {
                                  notification_preferences:
                                    nextNotificationPreferences(member, {
                                      work_assignment_email_enabled:
                                        event.target.checked,
                                    }),
                                },
                              })
                            }
                            type="checkbox"
                          />
                          <span className="flex items-center gap-1.5 font-medium">
                            {workEmailEnabled ? (
                              <Bell size={13} className="text-primary" />
                            ) : (
                              <BellOff
                                size={13}
                                className="text-muted-foreground"
                              />
                            )}
                            Assignment email
                          </span>
                        </label>
                        <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-md border border-border px-3">
                          <label className="flex min-h-11 items-center gap-3 text-sm">
                            <input
                              aria-label={`${member.display_name} assignment SMS notifications`}
                              checked={workSmsEnabled}
                              className="h-4 w-4 accent-primary"
                              disabled={!canManageSecurity}
                              onChange={(event) =>
                                memberMutation.mutate({
                                  memberId: member.id,
                                  payload: {
                                    notification_preferences:
                                      nextNotificationPreferences(member, {
                                        work_assignment_sms_enabled:
                                          event.target.checked,
                                      }),
                                  },
                                })
                              }
                              type="checkbox"
                            />
                            <span className="flex items-center gap-1.5 font-medium">
                              <Smartphone
                                size={13}
                                className={
                                  workSmsEnabled
                                    ? "text-primary"
                                    : "text-muted-foreground"
                                }
                              />
                              SMS
                            </span>
                          </label>
                          {showSmsPhoneControls ? (
                            <>
                              <Input
                                aria-label={`${member.display_name} assignment SMS phone`}
                                placeholder="+61400111222"
                                value={smsPhoneDraft}
                                disabled={!canManageSecurity}
                                className="min-h-11 flex-1 rounded-lg text-xs"
                                onChange={(event) =>
                                  setSmsPhoneDrafts((drafts) => ({
                                    ...drafts,
                                    [member.id]: event.target.value,
                                  }))
                                }
                              />
                              <SecondaryButton
                                type="button"
                                className="min-h-11 rounded-lg px-2 text-xs"
                                disabled={
                                  !canManageSecurity || !smsPhoneChanged
                                }
                                onClick={() =>
                                  memberMutation.mutate({
                                    memberId: member.id,
                                    payload: {
                                      notification_preferences:
                                        nextNotificationPreferences(member, {
                                          work_assignment_sms_phone:
                                            smsPhoneDraft.trim() || null,
                                        }),
                                    },
                                  })
                                }
                              >
                                {isUpdating ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : (
                                  <CheckCircle2 size={12} />
                                )}
                                Save
                              </SecondaryButton>
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              Enable to add phone
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="grid gap-2">
                        <Select
                          aria-label={`${member.display_name} work digest cadence`}
                          value={digestCadence}
                          disabled={!canManageSecurity}
                          onChange={(event) =>
                            memberMutation.mutate({
                              memberId: member.id,
                              payload: {
                                notification_preferences:
                                  nextNotificationPreferences(member, {
                                    work_assignment_digest_cadence: event.target
                                      .value as SecurityWorkAssignmentDigestCadence,
                                  }),
                              },
                            })
                          }
                        >
                          <option value="daily">Daily digest</option>
                          <option value="weekly">Weekly digest</option>
                          <option value="off">Digest off</option>
                        </Select>
                        <DigestReceiptSummary member={member} />
                      </div>

                      <details className="overflow-hidden rounded-md border border-border lg:col-span-3">
                        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
                          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                            <Tags size={13} />
                            <span className="font-medium text-foreground">
                              Templates
                            </span>
                          </span>
                          <StatusBadge
                            tone={templatesChanged ? "warning" : "neutral"}
                          >
                            {templatesChanged ? "Unsaved" : "Current"}
                          </StatusBadge>
                        </summary>
                        <div className="grid gap-3 border-t border-border p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                          <div className="grid gap-2">
                            <div className="grid gap-2 sm:grid-cols-[1fr_88px]">
                              <Field label="Assignment notice">
                                <Select
                                  aria-label={`${member.display_name} assignment notice template key`}
                                  value={templateDraft.noticeKey}
                                  disabled={!canManageSecurity}
                                  onChange={(event) =>
                                    updateTemplateDraft(
                                      noticeTemplateChoices.find(
                                        (template) =>
                                          template.key === event.target.value,
                                      )?.default_version
                                        ? {
                                            noticeKey: event.target.value,
                                            noticeVersion:
                                              noticeTemplateChoices.find(
                                                (template) =>
                                                  template.key ===
                                                  event.target.value,
                                              )?.default_version ?? "v1",
                                          }
                                        : { noticeKey: event.target.value },
                                    )
                                  }
                                >
                                  {noticeTemplateChoices.map((template) => (
                                    <option
                                      key={template.key}
                                      value={template.key}
                                    >
                                      {template.name}
                                    </option>
                                  ))}
                                </Select>
                              </Field>
                              <Field label="Version">
                                <Input
                                  aria-label={`${member.display_name} assignment notice template version`}
                                  value={templateDraft.noticeVersion}
                                  disabled={!canManageSecurity}
                                  onChange={(event) =>
                                    updateTemplateDraft({
                                      noticeVersion: event.target.value,
                                    })
                                  }
                                />
                              </Field>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-[1fr_88px]">
                              <Field label="Digest">
                                <Select
                                  aria-label={`${member.display_name} digest template key`}
                                  value={templateDraft.digestKey}
                                  disabled={!canManageSecurity}
                                  onChange={(event) =>
                                    updateTemplateDraft(
                                      digestTemplateChoices.find(
                                        (template) =>
                                          template.key === event.target.value,
                                      )?.default_version
                                        ? {
                                            digestKey: event.target.value,
                                            digestVersion:
                                              digestTemplateChoices.find(
                                                (template) =>
                                                  template.key ===
                                                  event.target.value,
                                              )?.default_version ?? "v1",
                                          }
                                        : { digestKey: event.target.value },
                                    )
                                  }
                                >
                                  {digestTemplateChoices.map((template) => (
                                    <option
                                      key={template.key}
                                      value={template.key}
                                    >
                                      {template.name}
                                    </option>
                                  ))}
                                </Select>
                              </Field>
                              <Field label="Version">
                                <Input
                                  aria-label={`${member.display_name} digest template version`}
                                  value={templateDraft.digestVersion}
                                  disabled={!canManageSecurity}
                                  onChange={(event) =>
                                    updateTemplateDraft({
                                      digestVersion: event.target.value,
                                    })
                                  }
                                />
                              </Field>
                            </div>
                          </div>
                          <div className="grid gap-2 rounded-lg border border-border bg-white p-3 text-xs">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-semibold text-foreground">
                                Template preview
                              </span>
                              <StatusBadge tone="primary">
                                SendGrid email
                              </StatusBadge>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium text-foreground">
                                    Notice
                                  </span>
                                  <StatusBadge tone="neutral">
                                    {templatePreview.noticeVersion}
                                  </StatusBadge>
                                  <StatusBadge
                                    tone={
                                      templatePreview.noticeManaged
                                        ? "primary"
                                        : "neutral"
                                    }
                                  >
                                    {templatePreview.noticeManaged
                                      ? "Named"
                                      : "Custom"}
                                  </StatusBadge>
                                </div>
                                <div className="mt-1 text-muted-foreground">
                                  {templatePreview.noticeTitle}
                                </div>
                                <div className="mt-2 font-medium text-foreground">
                                  {templatePreview.noticeSubject}
                                </div>
                                <div className="mt-1 leading-5 text-muted-foreground">
                                  {templatePreview.noticeDetail}
                                </div>
                              </div>
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium text-foreground">
                                    Digest
                                  </span>
                                  <StatusBadge tone="neutral">
                                    {templatePreview.digestVersion}
                                  </StatusBadge>
                                  <StatusBadge
                                    tone={
                                      templatePreview.digestManaged
                                        ? "primary"
                                        : "neutral"
                                    }
                                  >
                                    {templatePreview.digestManaged
                                      ? "Named"
                                      : "Custom"}
                                  </StatusBadge>
                                </div>
                                <div className="mt-1 text-muted-foreground">
                                  {templatePreview.digestTitle}
                                </div>
                                <div className="mt-2 font-medium text-foreground">
                                  {templatePreview.digestSubject}
                                </div>
                                <div className="mt-1 leading-5 text-muted-foreground">
                                  {templatePreview.digestDetail}
                                </div>
                              </div>
                            </div>
                          </div>
                          <SecondaryButton
                            type="button"
                            className="justify-self-start lg:col-start-1"
                            disabled={!canManageSecurity || !templatesChanged}
                            onClick={() =>
                              memberMutation.mutate({
                                memberId: member.id,
                                payload: {
                                  notification_preferences:
                                    nextNotificationPreferences(member, {
                                      work_assignment_notice_template_key:
                                        cleanTemplateDraft.noticeKey,
                                      work_assignment_notice_template_version:
                                        cleanTemplateDraft.noticeVersion,
                                      work_assignment_digest_template_key:
                                        cleanTemplateDraft.digestKey,
                                      work_assignment_digest_template_version:
                                        cleanTemplateDraft.digestVersion,
                                    }),
                                },
                              })
                            }
                          >
                            {isUpdating ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <CheckCircle2 size={14} />
                            )}
                            Save templates
                          </SecondaryButton>
                        </div>
                      </details>
                    </div>
                  );
                })}

                {!securityQuery.isLoading &&
                selectedEntityRoleMembers.length === 0 ? (
                  <EmptyState
                    icon={<UsersRound size={18} />}
                    title="No operators yet"
                    description="Invite an operator before setting Work notification preferences."
                  />
                ) : null}
              </div>
            </SectionPanel>
          </>
        ) : null}

        {activeTab === "organisation" ? (
          <>
            <IntegrationsHealthCard
              apiHealth={apiHealthQuery.data}
              integrations={integrationStatusQuery.data}
              isApiHealthLoading={apiHealthQuery.isLoading}
              isLoading={integrationStatusQuery.isLoading}
            />
            <SectionPanel
              title="Organisation profile"
              description="The operator account, entities, and integration settings all sit under this organisation."
              icon={<Building2 size={17} className="text-primary" />}
              actions={
                securityQuery.data ? (
                  <StatusBadge tone="primary">
                    {securityQuery.data.organisation.country_code}
                  </StatusBadge>
                ) : null
              }
            >
              <div className="grid gap-3 p-4 md:grid-cols-3">
                <div className="rounded-md border border-border bg-muted/25 p-3">
                  <div className="text-xs uppercase text-muted-foreground">
                    Name
                  </div>
                  <div className="mt-1 font-semibold">
                    {organisationNameLabel}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-muted/25 p-3">
                  <div className="text-xs uppercase text-muted-foreground">
                    Timezone
                  </div>
                  <div className="mt-1 font-semibold">
                    {organisationTimezoneLabel}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-muted/25 p-3">
                  <div className="text-xs uppercase text-muted-foreground">
                    Entities
                  </div>
                  <div className="mt-1 font-semibold">
                    {organisationEntityCountLabel}
                  </div>
                </div>
              </div>
            </SectionPanel>

            {selectedEntityId ? (
              <PaymentInstructionsPanel entityId={selectedEntityId} />
            ) : null}

            <SectionPanel
              title="Operating mode"
              description="Self-managed owners run their own portfolio. Managing-agent and hybrid accounts show owner-client, disbursement, and owner-portal surfaces."
              icon={<Building2 size={17} className="text-primary" />}
            >
              <div className="grid gap-3 p-4 md:max-w-md">
                <Field label="Account operating mode">
                  <Select
                    value={
                      securityQuery.data?.organisation.operating_mode ??
                      "self_managed_owner"
                    }
                    onChange={(event) =>
                      operatingModeMutation.mutate(
                        event.target.value as OperatingMode,
                      )
                    }
                    disabled={
                      !securityQuery.data?.can_manage_security ||
                      operatingModeMutation.isPending
                    }
                  >
                    <option value="self_managed_owner">
                      Self-managed owner
                    </option>
                    <option value="managing_agent">Managing agent</option>
                    <option value="hybrid">Hybrid</option>
                  </Select>
                </Field>
                {!securityQuery.data?.can_manage_security ? (
                  <p className="text-sm text-muted-foreground">
                    Only an owner or admin can change the operating mode.
                  </p>
                ) : null}
                {operatingModeMutation.error ? (
                  <p className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
                    <AlertTriangle size={16} />
                    {friendlyError(operatingModeMutation.error)}
                  </p>
                ) : null}
              </div>
            </SectionPanel>

            {(securityQuery.data?.organisation.operating_mode ??
              "self_managed_owner") === "self_managed_owner" ? (
              <section
                className="grid gap-3"
                aria-labelledby="entity-owners-title"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2
                      id="entity-owners-title"
                      className="text-lg font-semibold leading-7 text-foreground"
                    >
                      Your entities & properties
                    </h2>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                      Each entity owns its properties and connects to its own
                      Xero. Expand an entity to see its properties.
                    </p>
                  </div>
                  <StatusBadge tone="neutral">Self-managed</StatusBadge>
                </div>

                <div className="overflow-hidden rounded-2xl border border-border bg-white">
                  {orgEntities.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">
                      {entitiesOverviewForOrg.isLoading
                        ? "Loading entities…"
                        : "No entities yet."}
                    </p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {orgEntities.map((entity) => {
                        const expanded = expandedEntityRows.has(entity.id);
                        return (
                          <li key={entity.id}>
                            <button
                              type="button"
                              onClick={() => toggleEntityRow(entity.id)}
                              className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
                            >
                              <span className="flex min-w-0 flex-wrap items-center gap-2">
                                <ChevronRight
                                  size={15}
                                  className={`shrink-0 text-muted-foreground transition-transform ${
                                    expanded ? "rotate-90" : ""
                                  }`}
                                />
                                <span className="font-semibold text-foreground">
                                  {entity.name}
                                </span>
                                <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                  {entityTypeLabel(entity.entity_type)}
                                </span>
                                {entity.is_managing_entity ? (
                                  <StatusBadge tone="primary">
                                    Managing entity
                                  </StatusBadge>
                                ) : null}
                              </span>
                              <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                                <span>
                                  {entity.property_count}{" "}
                                  {entity.property_count === 1
                                    ? "property"
                                    : "properties"}
                                </span>
                                <StatusBadge
                                  tone={
                                    entity.xero_status === "connected"
                                      ? "success"
                                      : entity.xero_status === "token_expired"
                                        ? "danger"
                                        : "neutral"
                                  }
                                >
                                  {entity.xero_status === "connected"
                                    ? "Xero connected"
                                    : entity.xero_status === "token_expired"
                                      ? "Xero token expired"
                                      : entity.xero_status === "manual"
                                        ? "Xero manual"
                                        : "Xero not connected"}
                                </StatusBadge>
                              </span>
                            </button>
                            {expanded ? (
                              <div className="border-t border-border bg-muted/15">
                                <EntityPropertiesList entityId={entity.id} />
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <details className="rounded-2xl border border-border bg-white">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-foreground">
                    Owner &amp; trust records
                  </summary>
                  <div className="border-t border-border p-2">
                    {selectedEntityId ? (
                      <OwnersDirectory entityId={selectedEntityId} />
                    ) : (
                      <p className="rounded-md border border-border bg-muted/25 p-4 text-sm text-muted-foreground">
                        Select an entity to manage its owning entities.
                      </p>
                    )}
                  </div>
                </details>
              </section>
            ) : null}

            {ownershipSplitPlan &&
            ownershipSplitPlan.proposed_entity_count >
              ownershipSplitPlan.source_entity_count ? (
              <SectionPanel
                title="Split into trust entities (preview)"
                description="Your properties name more owning trusts than you have entities. Each trust needs its own entity to hold its own Xero. This is a read-only preview derived from property ownership labels — nothing is created or moved yet."
                icon={<Building2 size={17} className="text-primary" />}
                actions={
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge tone="primary">
                      {ownershipSplitPlan.proposed_entity_count} trusts found
                    </StatusBadge>
                    {ownershipSplitPlan.unresolved_property_count > 0 ? (
                      <StatusBadge tone="warning">
                        {ownershipSplitPlan.unresolved_property_count} without an
                        owner label
                      </StatusBadge>
                    ) : null}
                  </div>
                }
              >
                <div className="overflow-x-auto p-4">
                  <table className="w-full min-w-[560px] border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-xs font-semibold uppercase text-muted-foreground">
                        <th className="px-3 py-2">Proposed entity (trust)</th>
                        <th className="px-3 py-2">Properties</th>
                        <th className="px-3 py-2">Units</th>
                        <th className="px-3 py-2">Leases</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ownershipSplitPlan.groups.map((group) => (
                        <tr
                          key={group.normalized_key}
                          className="border-t border-border"
                        >
                          <td className="px-3 py-2 font-medium text-foreground">
                            {group.proposed_name}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {group.property_count}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {group.unit_count}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {group.lease_count}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-col gap-3 border-t border-border p-4">
                  {splitResult ? (
                    <p className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success">
                      Created {splitResult.created_entities.length} entit
                      {splitResult.created_entities.length === 1 ? "y" : "ies"},
                      moved {splitResult.moved_property_count} properties,{" "}
                      {splitResult.moved_tenant_count} tenants and{" "}
                      {splitResult.moved_obligation_count} obligations.
                      {splitResult.flagged_tenant_count > 0
                        ? ` ${splitResult.flagged_tenant_count} tenant(s) left in place (leases span entities).`
                        : ""}
                    </p>
                  ) : null}
                  {applySplitMutation.error ? (
                    <p className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
                      {friendlyError(applySplitMutation.error)}
                    </p>
                  ) : null}
                  {!splitResult ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {splitConfirming ? (
                        <>
                          <Button
                            type="button"
                            disabled={applySplitMutation.isPending}
                            onClick={() => applySplitMutation.mutate()}
                          >
                            {applySplitMutation.isPending ? (
                              <Loader2 size={15} className="animate-spin" />
                            ) : null}
                            Confirm — create{" "}
                            {ownershipSplitPlan?.proposed_entity_count} entities &
                            move properties
                          </Button>
                          <SecondaryButton
                            type="button"
                            disabled={applySplitMutation.isPending}
                            onClick={() => setSplitConfirming(false)}
                          >
                            Cancel
                          </SecondaryButton>
                        </>
                      ) : (
                        <>
                          <Button
                            type="button"
                            onClick={() => setSplitConfirming(true)}
                          >
                            Apply split…
                          </Button>
                          <span className="text-xs text-muted-foreground">
                            Creates the entities and moves each property (with its
                            obligations and clean tenants). No Xero is touched.
                          </span>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
              </SectionPanel>
            ) : null}

            <SectionPanel
              title="Communication templates"
              description="Shared template keys, previews, versions, and receipt endpoints for tenant, operator, invoice, and contractor messages."
              icon={<FileText size={17} className="text-primary" />}
              actions={
                <div className="flex flex-wrap gap-2">
                  <StatusBadge tone="primary">
                    {communicationTemplates.length} templates
                  </StatusBadge>
                  <StatusBadge tone="neutral">Review-first sends</StatusBadge>
                </div>
              }
            >
              <div className="grid gap-3 p-4 xl:grid-cols-2">
                {communicationTemplates.map((template) => (
                  <div
                    key={template.id}
                    className="grid gap-3 rounded-md border border-border bg-muted/20 p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">
                            {template.title}
                          </span>
                          <StatusBadge tone={template.tone}>
                            {template.channel === "sms"
                              ? "SMS"
                              : template.channel === "portal"
                                ? "Portal"
                                : "Email"}
                          </StatusBadge>
                          <StatusBadge tone="neutral">
                            {template.templateVersion}
                          </StatusBadge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {template.audience} / {template.provider} /{" "}
                          {template.brand}
                        </div>
                      </div>
                      <div className="rounded-xl bg-white p-2 text-primary shadow-leasiumXs">
                        {template.channel === "sms" ? (
                          <Smartphone size={16} />
                        ) : template.channel === "portal" ? (
                          <Bell size={16} />
                        ) : (
                          <MailCheck size={16} />
                        )}
                      </div>
                    </div>

                    <div className="grid gap-2 rounded-md border border-border bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-semibold uppercase text-muted-foreground">
                          {template.templateKey}
                        </span>
                        <span className="text-xs font-medium text-muted-foreground">
                          {template.sourceLabel}
                        </span>
                      </div>
                      <div className="font-medium">
                        {template.subjectPreview}
                      </div>
                      <div className="text-xs leading-5 text-muted-foreground">
                        {template.bodyPreview}
                      </div>
                    </div>

                    <div className="grid gap-2 md:grid-cols-2">
                      <div className="rounded-md border border-border bg-white p-3">
                        <div className="text-xs font-semibold uppercase text-muted-foreground">
                          Delivery rule
                        </div>
                        <div className="mt-1 text-xs leading-5 text-muted-foreground">
                          {template.actionLabel}
                        </div>
                      </div>
                      <div className="rounded-md border border-border bg-white p-3">
                        <div className="text-xs font-semibold uppercase text-muted-foreground">
                          {template.receiptLabel}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-muted-foreground">
                          {template.receiptDetail}
                        </div>
                        {template.receiptEndpoint ? (
                          <code className="mt-2 block break-all rounded bg-muted px-2 py-1 text-leasium-micro text-muted-foreground">
                            {template.receiptEndpoint}
                          </code>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      Stored template overrides
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Database-backed branded templates are visible here for
                      audit. Edit templates from the Comms hub; send-time
                      wiring remains paused for internal-first use.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <SecondaryButton
                      type="button"
                      onClick={copyCommunicationTemplateOverridesCsv}
                      className="min-h-11 rounded-lg px-3"
                    >
                      <Copy size={14} />
                      Copy overrides CSV
                    </SecondaryButton>
                    <SecondaryButton
                      type="button"
                      onClick={downloadCommunicationTemplateOverridesCsv}
                      className="min-h-11 rounded-lg px-3"
                    >
                      <Download size={14} />
                      Download overrides CSV
                    </SecondaryButton>
                    <StatusBadge
                      tone={brandedTemplates.length ? "primary" : "neutral"}
                    >
                      {storedTemplateOverrideLabel}
                    </StatusBadge>
                    <StatusBadge tone="neutral">Read-only</StatusBadge>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 rounded-md border border-border bg-muted/20 p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">Override coverage</div>
                      <div className="mt-1 text-xs leading-5 text-muted-foreground">
                        {brandedTemplateCoverage.active
                          ? brandedTemplateCoverage.unmatched.length
                            ? `${brandedTemplateCoverage.covered.length}/${brandedTemplateCoverage.active} active overrides match runtime keys; ${brandedTemplateCoverage.unmatched.length} need send-time wiring review.`
                            : `${brandedTemplateCoverage.covered.length}/${brandedTemplateCoverage.active} active overrides match runtime keys.`
                          : "No active stored overrides yet."}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-muted-foreground">
                        Coverage only; sends still use runtime templates until
                        editing and wiring land.
                      </div>
                    </div>
                    <StatusBadge
                      tone={
                        brandedTemplateCoverage.unmatched.length
                          ? "warning"
                          : brandedTemplateCoverage.active
                            ? "success"
                            : "neutral"
                      }
                    >
                      {brandedTemplateCoverage.unmatched.length
                        ? "Review wiring"
                        : brandedTemplateCoverage.active
                          ? "Runtime-aligned"
                          : "No active"}
                    </StatusBadge>
                  </div>
                  {brandedTemplateCoverage.active ? (
                    <div className="flex flex-wrap gap-2">
                      {brandedTemplateCoverage.covered.map((key) => (
                        <StatusBadge key={key} tone="success">
                          {key} covered
                        </StatusBadge>
                      ))}
                      {brandedTemplateCoverage.unmatched.map((key) => (
                        <StatusBadge key={key} tone="warning">
                          {key} needs wiring
                        </StatusBadge>
                      ))}
                    </div>
                  ) : null}
                </div>
                {templateOverrideExportReceipt ? (
                  <p className="mt-3 text-sm font-medium text-success">
                    {templateOverrideExportReceipt}
                  </p>
                ) : null}
                {brandedTemplatesQuery.isLoading ? (
                  <div className="mt-3 rounded-md border border-border bg-muted/25 p-3 text-sm text-muted-foreground">
                    Checking stored template overrides.
                  </div>
                ) : brandedTemplatesQuery.error ? (
                  <div className="mt-3 rounded-md border border-danger/20 bg-danger-soft p-3 text-sm text-danger">
                    {brandedTemplatesQuery.error instanceof Error
                      ? brandedTemplatesQuery.error.message
                      : "Stored template overrides could not load."}
                  </div>
                ) : brandedTemplates.length ? (
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    {brandedTemplates.map((template) => (
                      <div
                        key={template.id}
                        className="grid gap-3 rounded-md border border-border bg-white p-3 text-sm shadow-leasiumXs"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold">
                                {template.name}
                              </span>
                              <StatusBadge tone="primary">
                                {brandedTemplateChannelLabel(template.channel)}
                              </StatusBadge>
                              <StatusBadge
                                tone={
                                  template.is_active ? "success" : "neutral"
                                }
                              >
                                {template.is_active ? "Active" : "Inactive"}
                              </StatusBadge>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {template.key} / {template.version} /{" "}
                              {template.provider}
                            </div>
                          </div>
                          <StatusBadge
                            tone={template.is_system ? "neutral" : "warning"}
                          >
                            {template.is_system ? "System" : "Override"}
                          </StatusBadge>
                        </div>
                        <div className="grid gap-2 rounded-md border border-border bg-muted/20 p-3">
                          {template.subject_template ? (
                            <div className="font-medium">
                              {template.subject_template}
                            </div>
                          ) : null}
                          <div className="line-clamp-3 text-xs leading-5 text-muted-foreground">
                            {template.body_template}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                          {template.action_label ? (
                            <span>Action: {template.action_label}</span>
                          ) : null}
                          {template.notes ? (
                            <span>{template.notes}</span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon={<FileText size={18} />}
                    title="No stored template overrides"
                    description="Runtime templates are still the source of truth until editable branded templates are enabled."
                  />
                )}
              </div>
            </SectionPanel>

            <SectionPanel
              title="Ownership tags"
              description="Property owner and billing identity labels shown beneath property rows."
              icon={<Tags size={17} className="text-primary" />}
              actions={
                selectedEntityId ? (
                  <StatusBadge
                    tone={ownershipTags.length ? "primary" : "neutral"}
                  >
                    {ownershipTagLabel}
                  </StatusBadge>
                ) : null
              }
            >
              <div className="divide-y divide-border">
                {propertiesQuery.isLoading ? (
                  <div className="px-4 py-4 text-sm text-muted-foreground">
                    Checking ownership tags.
                  </div>
                ) : null}
                {propertiesQuery.error ? (
                  <div className="px-4 py-4 text-sm text-danger">
                    {propertiesQuery.error instanceof Error
                      ? propertiesQuery.error.message
                      : "Could not load ownership tags."}
                  </div>
                ) : null}
                {!propertiesQuery.isLoading && ownershipTags.length
                  ? ownershipTags.map((tag) => (
                      <div
                        key={tag.key}
                        className="grid gap-3 px-4 py-3 text-sm md:grid-cols-[minmax(0,1fr)_140px_minmax(260px,1.5fr)]"
                      >
                        <div className="min-w-0">
                          <span
                            className={`inline-flex max-w-full items-center truncate rounded-full border px-2.5 py-1 text-xs font-semibold leading-4 ${ownershipChipClassName(tag.palette)}`}
                            title={tag.label}
                          >
                            {tag.label}
                          </span>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {tag.sources.map((source) => (
                              <span
                                key={`${tag.key}-${source}`}
                                className="rounded-md bg-muted px-2 py-0.5 text-leasium-micro font-medium text-muted-foreground"
                              >
                                {source}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 md:block">
                          <StatusBadge tone="neutral">
                            {tag.propertyCount}{" "}
                            {tag.propertyCount === 1
                              ? "property"
                              : "properties"}
                          </StatusBadge>
                          <Link
                            href={`/properties?entity_id=${selectedEntityId}&owner_tag=${encodeURIComponent(tag.key)}`}
                            className="inline-flex min-h-11 items-center gap-1 rounded-md py-1 text-xs font-semibold text-primary hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 md:mt-2"
                          >
                            <ExternalLink size={13} />
                            Open tagged properties
                          </Link>
                        </div>
                        <div className="grid gap-1">
                          {tag.properties.slice(0, 3).map((property) => (
                            <Link
                              key={property.id}
                              href={`/properties?entity_id=${selectedEntityId}&property_id=${property.id}`}
                              className="flex min-h-11 min-w-0 flex-col justify-center rounded-md py-1 text-sm font-medium text-primary hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2"
                            >
                              <span className="block truncate">
                                {property.name}
                              </span>
                              <span className="block truncate text-xs font-normal text-muted-foreground">
                                {property.streetAddress}
                                {property.suburb ? `, ${property.suburb}` : ""}
                                {property.state ? ` ${property.state}` : ""}
                              </span>
                            </Link>
                          ))}
                          {tag.properties.length > 3 ? (
                            <div className="text-xs text-muted-foreground">
                              +{tag.properties.length - 3} more properties
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))
                  : null}
                {!propertiesQuery.isLoading &&
                !propertiesQuery.error &&
                selectedEntityId &&
                !ownershipTags.length ? (
                  <EmptyState
                    icon={<Tags size={18} />}
                    title="No ownership tags yet"
                    description="Import or edit property ownership and billing identity data to build this directory."
                  />
                ) : null}
                {!selectedEntityId ? (
                  <EmptyState
                    icon={<Building2 size={18} />}
                    title="No entity selected"
                    description="Choose an entity from the header to list property owner tags."
                  />
                ) : null}
              </div>
            </SectionPanel>

            <SectionPanel
              title="Entity access map"
              description="Each entity carries its own roles so operators only see the portfolio slices they should."
              icon={<KeyRound size={17} className="text-primary" />}
            >
              <div className="divide-y divide-border">
                {(entitiesQuery.data ?? []).map((entity) => {
                  const currentUserRole =
                    securityQuery.data?.current_user_roles.find(
                      (role) => role.entity_id === entity.id,
                    );
                  return (
                    <div
                      key={entity.id}
                      className="grid gap-3 px-4 py-3 text-sm md:grid-cols-[1fr_180px_220px]"
                    >
                      <div>
                        <div className="font-medium">{entity.name}</div>
                        <p className="mt-1 text-muted-foreground">
                          {entity.abn
                            ? `ABN ${entity.abn}`
                            : "ABN not recorded"}
                        </p>
                      </div>
                      <StatusBadge
                        tone={entity.gst_registered ? "success" : "warning"}
                      >
                        {entity.gst_registered
                          ? "GST registered"
                          : "GST not recorded"}
                      </StatusBadge>
                      <div className="text-sm text-muted-foreground">
                        Your role:{" "}
                        {currentUserRole
                          ? roleLabel(currentUserRole.role)
                          : "No access"}
                      </div>
                    </div>
                  );
                })}
                {!entitiesQuery.isLoading && !entitiesQuery.data?.length ? (
                  <EmptyState
                    icon={<Building2 size={18} />}
                    title="No entities available"
                    description="Create an entity before inviting operators into scoped roles."
                  />
                ) : null}
              </div>
            </SectionPanel>
          </>
        ) : null}

        {activeTab === "connect" && !selectedEntityId ? (
          <SectionPanel>
            <EmptyState
              icon={<Building2 size={18} />}
              title="No entity selected"
              description="Choose an entity from the header to load Xero status, mappings, invoice sync readiness, and payment reconciliation."
            />
          </SectionPanel>
        ) : null}

        {activeTab === "connect" &&
        selectedEntityId &&
        status &&
        !xeroDiagnosticsReady ? (
          <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
            Xero actions stay disabled until the setup check finishes loading.
          </div>
        ) : null}

        {activeTab === "connect" && selectedEntityId && status ? (
          <>
            {xeroCallbackFeedback ? (
              <div
                className={`rounded-xl border p-4 text-sm ${
                  xeroCallbackFeedback.tone === "success"
                    ? "border-success/30 bg-success/5 text-success"
                    : "border-danger/30 bg-danger/5 text-danger"
                }`}
                role="status"
              >
                <div className="flex items-start gap-3">
                  {xeroCallbackFeedback.tone === "success" ? (
                    <CheckCircle2 className="mt-0.5 shrink-0" size={18} />
                  ) : (
                    <AlertTriangle className="mt-0.5 shrink-0" size={18} />
                  )}
                  <div>
                    <div className="font-semibold">
                      {xeroCallbackFeedback.title}
                    </div>
                    <p className="mt-1">{xeroCallbackFeedback.detail}</p>
                    {xeroCallbackFeedback.tone === "success" &&
                    xeroNextUnconnectedEntity ? (
                      <Button
                        type="button"
                        className="mt-3"
                        disabled={xeroEntityConnectMutation.isPending}
                        onClick={() =>
                          xeroEntityConnectMutation.mutate(
                            xeroNextUnconnectedEntity.id,
                          )
                        }
                      >
                        {xeroEntityConnectMutation.isPending ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <ExternalLink size={15} />
                        )}
                        Connect next: {xeroNextUnconnectedEntity.name}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
            {xeroOverview && xeroOverview.summary.total > 1 ? (
              <SectionPanel
                title="Entities & Xero"
                description="Each entity connects to its own Xero organisation. Select a row to manage its connection below."
                icon={<PlugZap size={17} className="text-primary" />}
                actions={
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge tone="success">
                      {xeroOverview.summary.connected} of{" "}
                      {xeroOverview.summary.total} connected
                    </StatusBadge>
                    {xeroOverview.summary.token_expired > 0 ? (
                      <StatusBadge tone="danger">
                        {xeroOverview.summary.token_expired} token expired
                      </StatusBadge>
                    ) : null}
                    {xeroOverview.summary.not_connected > 0 ? (
                      <StatusBadge tone="warning">
                        {xeroOverview.summary.not_connected} not connected
                      </StatusBadge>
                    ) : null}
                  </div>
                }
              >
                <div className="overflow-x-auto p-4">
                  <table className="w-full min-w-[640px] border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-xs font-semibold uppercase text-muted-foreground">
                        <th className="px-3 py-2">Entity</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Properties</th>
                        <th className="px-3 py-2">Xero</th>
                        <th className="px-3 py-2">Last sync</th>
                        <th className="px-3 py-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {xeroOverview.entities.map((row) => {
                        const meta = entityXeroStatusMeta[row.xero_status];
                        const isSelected = row.id === selectedEntityId;
                        return (
                          <tr
                            key={row.id}
                            onClick={() => setSelectedEntityId(row.id)}
                            className={`cursor-pointer border-t border-border transition-colors hover:bg-muted/30 ${
                              isSelected ? "bg-muted/40" : ""
                            }`}
                          >
                            <td className="px-3 py-2 font-medium text-foreground">
                              <span className="flex flex-wrap items-center gap-2">
                                {row.name}
                                {row.is_managing_entity ? (
                                  <StatusBadge tone="primary">
                                    Managing entity
                                  </StatusBadge>
                                ) : null}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {entityTypeLabel(row.entity_type)}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {row.property_count}
                            </td>
                            <td className="px-3 py-2">
                              <StatusBadge tone={meta.tone}>
                                {meta.label}
                                {row.tenant_name ? ` · ${row.tenant_name}` : ""}
                              </StatusBadge>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {row.last_sync_at
                                ? new Date(row.last_sync_at).toLocaleDateString()
                                : "—"}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <SecondaryButton
                                type="button"
                                disabled={xeroEntityConnectMutation.isPending}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  xeroEntityConnectMutation.mutate(row.id);
                                }}
                              >
                                {row.xero_status === "connected"
                                  ? "Reconnect"
                                  : row.xero_status === "token_expired"
                                    ? "Reconnect"
                                    : "Connect"}
                              </SecondaryButton>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </SectionPanel>
            ) : null}

            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
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
              <MetricCard
                label="Freshness"
                value={statusLabel(status.accounting_freshness.status)}
                detail={status.accounting_freshness.summary}
                tone={accountingFreshnessTone(
                  status.accounting_freshness.status,
                )}
              />
            </section>

            <div ref={xeroConnectionPanelRef}>
              <SectionPanel
                title="Connect Xero"
                description={`Connect ${selectedEntityName} to its matching Xero organisation. Nothing is posted during connection.`}
                icon={<PlugZap size={17} className="text-primary" />}
                actions={
                  <StatusBadge
                    tone={status.connection.connected ? "success" : "warning"}
                  >
                    {xeroConnectionSummary}
                  </StatusBadge>
                }
              >
                <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_340px]">
                  <div className="grid gap-4">
                    <div className="rounded-xl border border-border bg-muted/20 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold uppercase text-muted-foreground">
                            Selected entity
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <span className="text-lg font-semibold text-foreground">
                              {selectedEntityName}
                            </span>
                            <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                              {selectedEntityTypeLabel}
                            </span>
                          </div>
                          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                            {xeroHasProviderConnection
                              ? `Leasium is connected to ${xeroConnectedOrgName ?? "Xero"} for this entity. Next, review contacts and accounting mappings before any invoice draft is created.`
                              : "Each entity has its own Xero organisation, so connect them one at a time. Nothing is posted during connection."}
                          </p>
                        </div>
                        <StatusBadge
                          tone={
                            xeroHasProviderConnection ? "success" : "neutral"
                          }
                        >
                          {xeroHasProviderConnection ? "Connected" : "Setup"}
                        </StatusBadge>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          disabled={
                            xeroOAuthMutation.isPending ||
                            !xeroCanStartOauth ||
                            !selectedEntityId
                          }
                          onClick={() => xeroOAuthMutation.mutate()}
                        >
                          {xeroOAuthMutation.isPending ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : (
                            <ExternalLink size={15} />
                          )}
                          {xeroPrimaryConnectLabel}
                        </Button>
                        <SecondaryButton
                          type="button"
                          disabled={
                            xeroContactSyncMutation.isPending ||
                            !xeroCanPreviewContacts
                          }
                          onClick={() => xeroContactSyncMutation.mutate()}
                        >
                          {xeroContactSyncMutation.isPending ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : (
                            <SearchCheck size={15} />
                          )}
                          Review contacts
                        </SecondaryButton>
                      </div>
                      {!xeroCanStartOauth && !xeroHasProviderConnection ? (
                        <p className="mt-3 text-sm text-warning">
                          Xero setup needs a support check before this entity can
                          connect.
                        </p>
                      ) : null}
                    </div>

                    <div className="grid gap-2 sm:grid-cols-3">
                      {[
                        {
                          label: "1. Connect",
                          detail: xeroHasProviderConnection
                            ? (xeroConnectedOrgName ?? "Xero connected")
                            : "Choose the matching Xero organisation.",
                          done: xeroHasProviderConnection,
                        },
                        {
                          label: "2. Review",
                          detail: xeroCanPreviewContacts
                            ? "Match Xero contacts to tenants and owners."
                            : "Available after connection.",
                          done:
                            status.contact_mapping.total > 0 &&
                            status.contact_mapping.missing === 0,
                        },
                        {
                          label: "3. Prepare",
                          detail: xeroCanPreviewInvoicePosting
                            ? "Preview draft invoices before approval."
                            : "No invoices are created here.",
                          done: status.invoice_sync.synced > 0,
                        },
                      ].map((step) => (
                        <div
                          key={step.label}
                          className="rounded-lg border border-border bg-white p-3 text-sm"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold">{step.label}</span>
                            <StatusBadge
                              tone={step.done ? "success" : "neutral"}
                            >
                              {step.done ? "Done" : "Next"}
                            </StatusBadge>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-muted-foreground">
                            {step.detail}
                          </p>
                        </div>
                      ))}
                    </div>

                    <details className="rounded-xl border border-border bg-white">
                      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-foreground">
                        Advanced support details
                      </summary>
                      <div className="grid gap-4 border-t border-border p-4">
                        {xeroDiagnostics ? (
                          <>
                            <div>
                              <div className="text-sm font-semibold text-foreground">
                                Connection diagnostics
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Local setup and permission checks for support.
                              </p>
                            </div>
                            <div className="grid gap-3 md:grid-cols-2">
                              <div className="rounded-md border border-border bg-muted/25 p-3">
                                <div className="text-xs uppercase text-muted-foreground">
                                  Provider setup
                                </div>
                                <div className="mt-1 font-medium">
                                  {xeroDiagnostics.provider_configured
                                    ? "Configured"
                                    : "Needs support"}
                                </div>
                                {xeroDiagnostics.missing_config.length ? (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Missing{" "}
                                    {xeroDiagnostics.missing_config.join(", ")}
                                  </p>
                                ) : null}
                              </div>
                              <div className="rounded-md border border-border bg-muted/25 p-3">
                                <div className="text-xs uppercase text-muted-foreground">
                                  Connection source
                                </div>
                                <div className="mt-1 font-medium">
                                  {status.connection.connection_source ===
                                  "provider"
                                    ? "Xero OAuth"
                                    : status.connection.connection_source ===
                                        "manual"
                                      ? "Manual tenant ID"
                                      : "Not connected"}
                                </div>
                                {status.connection.tenant_name ? (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {status.connection.tenant_name}
                                  </p>
                                ) : null}
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <SecondaryButton
                                type="button"
                                onClick={downloadXeroDiagnosticsCsv}
                              >
                                <Download size={14} />
                                Download diagnostics CSV
                              </SecondaryButton>
                              <SecondaryButton
                                type="button"
                                onClick={copyXeroDiagnosticsPacket}
                              >
                                <Copy size={14} />
                                Copy diagnostics packet
                              </SecondaryButton>
                              <SecondaryButton
                                type="button"
                                onClick={downloadXeroDiagnosticsPacket}
                              >
                                <Download size={14} />
                                Download diagnostics packet
                              </SecondaryButton>
                            </div>
                            {xeroDiagnosticsCopyReceipt ? (
                              <p className="text-xs font-medium text-success">
                                {xeroDiagnosticsCopyReceipt}
                              </p>
                            ) : null}

                            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                              {diagnosticsReadinessDetailRows(
                                xeroDiagnostics,
                              ).map(({ label, ready, detail }) => (
                                <div
                                  key={label}
                                  aria-label={`${label} readiness`}
                                  className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium">{label}</span>
                                    <StatusBadge
                                      tone={ready ? "success" : "warning"}
                                    >
                                      {ready ? "Ready" : "Blocked"}
                                    </StatusBadge>
                                  </div>
                                  <p className="mt-2 leading-relaxed text-muted">
                                    {detail}
                                  </p>
                                </div>
                              ))}
                            </div>

                            {xeroDiagnostics.next_steps.length ||
                            xeroDiagnostics.guardrails.length ? (
                              <div className="grid gap-2 rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                                {xeroDiagnostics.next_steps.length ? (
                                  <div>
                                    <div className="font-semibold uppercase text-foreground">
                                      Support notes
                                    </div>
                                    <ul className="mt-1 grid gap-1">
                                      {xeroDiagnostics.next_steps.map(
                                        (step) => (
                                          <li key={step}>{step}</li>
                                        ),
                                      )}
                                    </ul>
                                  </div>
                                ) : null}
                                {xeroDiagnostics.guardrails.length ? (
                                  <p>{xeroDiagnostics.guardrails.join(" ")}</p>
                                ) : null}
                              </div>
                            ) : null}

                            <div
                              aria-label="Provider setup preflight"
                              className="grid gap-3 rounded-md border border-border bg-muted/20 p-3"
                              role="region"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <div className="text-xs uppercase text-muted-foreground">
                                    Provider setup preflight
                                  </div>
                                  <div className="mt-1 font-medium">
                                    Xero app configuration
                                  </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <StatusBadge
                                    tone={
                                      xeroDiagnostics.provider_setup_preflight
                                        .missing_env_vars.length
                                        ? "warning"
                                        : "success"
                                    }
                                  >
                                    {xeroDiagnostics.provider_setup_preflight
                                      .missing_env_vars.length
                                      ? "Needs support"
                                      : "Ready"}
                                  </StatusBadge>
                                  <SecondaryButton
                                    type="button"
                                    onClick={copyXeroSetupPacket}
                                  >
                                    <Copy size={14} />
                                    Copy setup packet
                                  </SecondaryButton>
                                  <SecondaryButton
                                    type="button"
                                    onClick={downloadXeroSetupPacket}
                                  >
                                    <Download size={14} />
                                    Download setup packet
                                  </SecondaryButton>
                                </div>
                              </div>
                              {xeroSetupCopyReceipt ? (
                                <p className="text-xs font-medium text-success">
                                  {xeroSetupCopyReceipt}
                                </p>
                              ) : null}
                              <div className="grid gap-3 md:grid-cols-2">
                                <div>
                                  <div className="text-xs font-medium uppercase text-muted-foreground">
                                    Required setup
                                  </div>
                                  <div className="mt-1 flex flex-wrap gap-1.5">
                                    {xeroDiagnostics.provider_setup_preflight.required_env_vars.map(
                                      (envVar) => (
                                        <StatusBadge
                                          key={envVar}
                                          tone="neutral"
                                        >
                                          {envVar}
                                        </StatusBadge>
                                      ),
                                    )}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-xs font-medium uppercase text-muted-foreground">
                                    Missing setup
                                  </div>
                                  <div className="mt-1 flex flex-wrap gap-1.5">
                                    {xeroDiagnostics.provider_setup_preflight
                                      .missing_env_vars.length ? (
                                      xeroDiagnostics.provider_setup_preflight.missing_env_vars.map(
                                        (envVar) => (
                                          <StatusBadge
                                            key={envVar}
                                            tone="warning"
                                          >
                                            {envVar}
                                          </StatusBadge>
                                        ),
                                      )
                                    ) : (
                                      <StatusBadge tone="success">
                                        None
                                      </StatusBadge>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="grid gap-1">
                                <div className="text-xs font-medium uppercase text-muted-foreground">
                                  Expected redirect URI
                                </div>
                                <div className="break-all rounded-md border border-border bg-white px-3 py-2 text-xs">
                                  {
                                    xeroDiagnostics.provider_setup_preflight
                                      .expected_redirect_uri
                                  }
                                </div>
                              </div>
                              <div className="grid gap-1">
                                <div className="text-xs font-medium uppercase text-muted-foreground">
                                  Required scopes
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {xeroDiagnostics.provider_setup_preflight.required_scopes.map(
                                    (scope) => (
                                      <StatusBadge key={scope} tone="neutral">
                                        {scope}
                                      </StatusBadge>
                                    ),
                                  )}
                                </div>
                              </div>
                              <ul className="grid gap-1 text-xs text-muted-foreground">
                                {xeroDiagnostics.provider_setup_preflight.setup_checklist.map(
                                  (step) => (
                                    <li key={step} className="flex gap-2">
                                      <CheckCircle2
                                        size={14}
                                        className="mt-0.5 shrink-0 text-primary"
                                      />
                                      <span>{step}</span>
                                    </li>
                                  ),
                                )}
                              </ul>
                            </div>
                          </>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            Support diagnostics are still loading or
                            unavailable.
                          </p>
                        )}

                        <form
                          className="grid gap-3 rounded-md border border-border bg-muted/20 p-3"
                          onSubmit={(event) => {
                            event.preventDefault();
                            connectionMutation.mutate({
                              connected: true,
                              xero_tenant_id: xeroTenantId.trim(),
                            });
                          }}
                        >
                          <div>
                            <div className="text-sm font-semibold">
                              Manual tenant ID override
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Use only when support asks for it. OAuth is the
                              normal connection path.
                            </p>
                          </div>
                          <Field label="Xero tenant ID">
                            <Input
                              value={xeroTenantId}
                              onChange={(event) =>
                                setXeroTenantId(event.target.value)
                              }
                              placeholder="Tenant or organisation ID"
                            />
                          </Field>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="submit"
                              disabled={
                                connectionMutation.isPending ||
                                !xeroTenantId.trim()
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
                              connectionMutation.variables?.connected ===
                                false ? (
                                <Loader2 size={15} className="animate-spin" />
                              ) : (
                                <Ban size={15} />
                              )}
                              Clear
                            </SecondaryButton>
                          </div>
                        </form>
                      </div>
                    </details>
                  </div>

                  <div className="grid content-start gap-3 rounded-xl border border-border bg-white p-4">
                    <div>
                      <div className="text-sm font-semibold text-foreground">
                        What happens next
                      </div>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        These checks read from Xero and prepare local review
                        screens. Invoice drafts still need explicit approval.
                      </p>
                    </div>
                    <SecondaryButton
                      type="button"
                      className="justify-start"
                      disabled={
                        xeroContactSyncMutation.isPending ||
                        !xeroCanPreviewContacts
                      }
                      onClick={() => xeroContactSyncMutation.mutate()}
                    >
                      {xeroContactSyncMutation.isPending ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <UsersRound size={15} />
                      )}
                      Review contact matches
                    </SecondaryButton>
                    <SecondaryButton
                      type="button"
                      className="justify-start"
                      disabled={
                        xeroChartTaxMutation.isPending ||
                        !xeroCanValidateChartTax
                      }
                      onClick={() => xeroChartTaxMutation.mutate()}
                    >
                      {xeroChartTaxMutation.isPending ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <CircleDollarSign size={15} />
                      )}
                      Check accounts and tax
                    </SecondaryButton>
                    <SecondaryButton
                      type="button"
                      className="justify-start"
                      disabled={
                        xeroInvoicePostingMutation.isPending ||
                        !xeroCanPreviewInvoicePosting
                      }
                      onClick={() => xeroInvoicePostingMutation.mutate()}
                    >
                      {xeroInvoicePostingMutation.isPending ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <FileText size={15} />
                      )}
                      Preview invoices
                    </SecondaryButton>
                    <SecondaryButton
                      type="button"
                      className="justify-start"
                      disabled={
                        xeroPaymentPreviewMutation.isPending ||
                        !xeroCanPreviewPayments
                      }
                      onClick={() => xeroPaymentPreviewMutation.mutate()}
                    >
                      {xeroPaymentPreviewMutation.isPending ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <SearchCheck size={15} />
                      )}
                      Review payments
                    </SecondaryButton>
                  </div>
                </div>
              </SectionPanel>
            </div>

            <SectionPanel
              title="Accounting freshness snapshot"
              description="Local checkpoint history used to decide whether Xero-linked invoices need another payment reconciliation review."
              icon={<SearchCheck size={17} className="text-primary" />}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge
                    tone={accountingFreshnessTone(
                      status.accounting_freshness.status,
                    )}
                  >
                    {statusLabel(status.accounting_freshness.status)}
                  </StatusBadge>
                  <span title="Operator-configurable via XERO_RECONCILIATION_STALE_AFTER_DAYS">
                    <StatusBadge
                      tone={
                        status.accounting_freshness.stale_reconciliation
                          ? "warning"
                          : "neutral"
                      }
                    >
                      {status.accounting_freshness.stale_reconciliation
                        ? `Reconciliation stale after ${status.accounting_freshness.stale_after_days} days`
                        : "Reconciliation current"}
                    </StatusBadge>
                  </span>
                  <SecondaryButton
                    type="button"
                    onClick={downloadXeroFreshnessCsv}
                    disabled={!status}
                  >
                    <Download size={15} />
                    Download freshness CSV
                  </SecondaryButton>
                  <SecondaryButton
                    type="button"
                    onClick={copyXeroFreshnessPacket}
                    disabled={!status}
                  >
                    <Copy size={15} />
                    Copy freshness packet
                  </SecondaryButton>
                </div>
              }
            >
              <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                {xeroFreshnessPacketReceipt ? (
                  <p className="lg:col-span-2 text-sm font-medium text-success">
                    {xeroFreshnessPacketReceipt}
                  </p>
                ) : null}
                <div className="grid gap-3">
                  <p className="text-sm text-muted-foreground">
                    {status.accounting_freshness.summary}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {accountingCheckpointRows(status.accounting_freshness).map(
                      ([checkpoint, value]) => (
                        <div
                          key={checkpoint}
                          className="rounded-md border border-border bg-muted/25 p-3 text-sm"
                        >
                          <div className="text-xs font-semibold uppercase text-muted-foreground">
                            {checkpoint}
                          </div>
                          <div className="mt-1 font-medium">
                            {formatDateTime(value)}
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>
                      Xero-linked open invoices{" "}
                      {
                        status.accounting_freshness
                          .xero_linked_open_invoice_count
                      }
                    </span>
                    {status.accounting_freshness
                      .last_payment_reconciliation_source ? (
                      <span>
                        Payment source{" "}
                        {statusLabel(
                          status.accounting_freshness
                            .last_payment_reconciliation_source,
                        )}
                      </span>
                    ) : null}
                    {status.accounting_freshness
                      .last_payment_reconciliation_mode ? (
                      <span>
                        Payment mode{" "}
                        {statusLabel(
                          status.accounting_freshness
                            .last_payment_reconciliation_mode,
                        )}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="grid content-start gap-3">
                  {accountingStep ? (
                    <div className="rounded-md border border-border bg-muted/25 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-semibold text-foreground">
                          Next accounting step
                        </div>
                        <StatusBadge tone={accountingStep.tone}>
                          {accountingStep.title}
                        </StatusBadge>
                      </div>
                      <p className="mt-2 text-muted-foreground">
                        {accountingStep.detail}
                      </p>
                      {accountingStep.action === "billing" ? (
                        <Link
                          href={billingReadinessHandoffHref({
                            entityId: selectedEntityId,
                            invoiceDraftId: null,
                          })}
                          className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-white px-3 text-sm font-semibold text-foreground shadow-leasiumXs transition hover:bg-muted"
                        >
                          {accountingStep.actionLabel}
                        </Link>
                      ) : accountingStep.action === "payments" ? (
                        <SecondaryButton
                          type="button"
                          className="mt-3 min-h-11 px-3"
                          disabled={
                            !selectedEntityId ||
                            !xeroCanPreviewPayments ||
                            xeroPaymentPreviewMutation.isPending
                          }
                          onClick={() =>
                            xeroPaymentPreviewMutation.mutate(undefined, {
                              onSuccess: () =>
                                scrollToPanel(xeroPaymentPanelRef),
                            })
                          }
                        >
                          {xeroPaymentPreviewMutation.isPending ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : (
                            <SearchCheck size={15} />
                          )}
                          {accountingStep.actionLabel}
                        </SecondaryButton>
                      ) : accountingStep.action === "exceptions" ? (
                        <SecondaryButton
                          type="button"
                          className="mt-3 min-h-11 px-3"
                          onClick={() =>
                            scrollToPanel(xeroExceptionQueuePanelRef)
                          }
                        >
                          <AlertTriangle size={15} />
                          {accountingStep.actionLabel}
                        </SecondaryButton>
                      ) : null}
                    </div>
                  ) : null}
                  <ul className="grid gap-2 text-sm text-muted-foreground">
                    {status.accounting_freshness.guardrails.map((guardrail) => (
                      <li key={guardrail} className="flex gap-2">
                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary" />
                        <span>{guardrail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </SectionPanel>

            <div ref={xeroExceptionQueuePanelRef}>
              <SectionPanel
                title="Xero sync exception queue"
                description="Local accounting exceptions for mappings, approved drafts, provider receipts, and payment review."
                icon={<AlertTriangle size={17} className="text-primary" />}
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    <SecondaryButton
                      type="button"
                      className="min-h-11 rounded-lg px-3 text-xs"
                      disabled={!exceptionQueue}
                      onClick={copyXeroExceptionPacket}
                    >
                      <Copy size={14} />
                      Copy exception packet
                    </SecondaryButton>
                    <SecondaryButton
                      type="button"
                      className="min-h-11 rounded-lg px-3 text-xs"
                      disabled={!exceptionQueue}
                      onClick={downloadXeroExceptionCsv}
                    >
                      <Download size={14} />
                      Download exceptions CSV
                    </SecondaryButton>
                    <StatusBadge tone={xeroExceptionOpenTone}>
                      {xeroExceptionOpenLabel}
                    </StatusBadge>
                    {xeroExceptionQueueQuery.isFetching ? (
                      <StatusBadge tone="neutral">Refreshing</StatusBadge>
                    ) : null}
                  </div>
                }
              >
                {xeroExceptionQueueQuery.isLoading && !exceptionQueue ? (
                  <div className="p-4 text-sm text-muted-foreground">
                    Checking Xero sync exceptions.
                  </div>
                ) : (
                  <>
                    {xeroExceptionExportReceipt ? (
                      <p className="border-t border-border px-4 py-3 text-sm font-medium text-success">
                        {xeroExceptionExportReceipt}
                      </p>
                    ) : null}
                    <div className="grid gap-3 p-4 md:grid-cols-4">
                      <div className="rounded-md border border-border bg-muted/25 p-3">
                        <div className="text-xs uppercase text-muted-foreground">
                          Blockers
                        </div>
                        <div className="mt-1 text-lg font-semibold">
                          {exceptionQueue?.summary.blockers ?? 0}
                        </div>
                      </div>
                      <div className="rounded-md border border-border bg-muted/25 p-3">
                        <div className="text-xs uppercase text-muted-foreground">
                          Warnings
                        </div>
                        <div className="mt-1 text-lg font-semibold">
                          {exceptionQueue?.summary.warnings ?? 0}
                        </div>
                      </div>
                      <div className="rounded-md border border-border bg-muted/25 p-3">
                        <div className="text-xs uppercase text-muted-foreground">
                          Provider
                        </div>
                        <div className="mt-1 text-lg font-semibold">
                          {exceptionQueue?.summary.provider ?? 0}
                        </div>
                      </div>
                      <div className="rounded-md border border-border bg-muted/25 p-3">
                        <div className="text-xs uppercase text-muted-foreground">
                          Payments
                        </div>
                        <div className="mt-1 text-lg font-semibold">
                          {exceptionQueue?.summary.payment ?? 0}
                        </div>
                      </div>
                    </div>
                    <details className="border-t border-border">
                      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-foreground">
                        Review {exceptionItems.length} follow-up
                        {exceptionItems.length === 1 ? "" : "s"}
                      </summary>
                      {exceptionQueue?.guardrails.length ? (
                        <ul className="grid gap-1 border-t border-border px-4 py-3 text-xs text-muted-foreground">
                          {exceptionQueue.guardrails.map((guardrail) => (
                            <li key={guardrail} className="flex gap-2">
                              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
                              <span>{guardrail}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <div className="divide-y divide-border border-t border-border">
                        {exceptionItems.map((issue) => {
                          const actionLabel = exceptionActionLabel(issue);
                          const actionPending = exceptionActionPending(issue);
                          const currentMappingLabel = `Account ${
                            issue.current_account_code ?? "Not set"
                          } / tax ${issue.current_tax_type ?? "Not set"}`;
                          const suggestedMappingLabel = `Account ${
                            issue.suggested_account_code ?? "Not set"
                          } / tax ${issue.suggested_tax_type ?? "Not set"}`;
                          const providerContextLabel =
                            issue.provider || issue.provider_status
                              ? `${providerLabel(issue.provider) ?? "Provider"}${
                                  issue.provider_status
                                    ? ` / ${statusLabel(issue.provider_status)}`
                                    : ""
                                }`
                              : null;
                          return (
                            <div key={issue.id} className="px-4 py-3 text-sm">
                              <div
                                data-testid="xero-exception-mobile-card"
                                className="grid gap-3 rounded-lg border border-border bg-surface p-3 lg:hidden"
                              >
                                <div className="flex flex-wrap items-start gap-2">
                                  <StatusBadge tone={exceptionTone(issue)}>
                                    {exceptionKindLabel(issue.kind)}
                                  </StatusBadge>
                                  {issue.next_action ? (
                                    <StatusBadge tone="neutral">
                                      {issue.next_action.replaceAll("_", " ")}
                                    </StatusBadge>
                                  ) : null}
                                </div>
                                <div>
                                  <div className="font-medium">
                                    {issue.label}
                                  </div>
                                  <p className="mt-1 text-muted-foreground">
                                    {issue.detail}
                                  </p>
                                </div>
                                {issue.charge_rule_id ? (
                                  <dl className="grid gap-2 rounded-md border border-border bg-muted/20 p-3 text-xs">
                                    <div>
                                      <dt className="font-medium text-foreground">
                                        Current mapping
                                      </dt>
                                      <dd className="mt-1 text-muted-foreground">
                                        {currentMappingLabel}
                                      </dd>
                                    </div>
                                    <div>
                                      <dt className="font-medium text-foreground">
                                        Suggested mapping
                                      </dt>
                                      <dd className="mt-1 text-muted-foreground">
                                        {suggestedMappingLabel}
                                      </dd>
                                    </div>
                                  </dl>
                                ) : null}
                                <div className="grid gap-1 text-xs text-muted-foreground">
                                  {issue.invoice_number ||
                                  issue.invoice_title ? (
                                    <div>
                                      Invoice:{" "}
                                      {issue.invoice_number ??
                                        issue.invoice_title}
                                    </div>
                                  ) : null}
                                  {issue.tenant_name || issue.property_name ? (
                                    <div>
                                      Record:{" "}
                                      {issue.property_name ?? "Property"}
                                      {issue.unit_label
                                        ? ` / ${issue.unit_label}`
                                        : ""}
                                      {issue.tenant_name
                                        ? ` / ${issue.tenant_name}`
                                        : ""}
                                    </div>
                                  ) : null}
                                  {issue.total_cents !== null ? (
                                    <div>
                                      Amount:{" "}
                                      {formatCurrencyCents(
                                        issue.total_cents,
                                        issue.currency ?? "AUD",
                                      )}
                                    </div>
                                  ) : null}
                                  {issue.xero_invoice_id ? (
                                    <div>Xero ID: {issue.xero_invoice_id}</div>
                                  ) : null}
                                  {providerContextLabel ? (
                                    <div>Provider: {providerContextLabel}</div>
                                  ) : null}
                                  {issue.external_posting_status ? (
                                    <div>
                                      Posting: {issue.external_posting_status}
                                    </div>
                                  ) : null}
                                  {issue.received_at ? (
                                    <div>
                                      Receipt:{" "}
                                      {formatDateTime(issue.received_at)}
                                    </div>
                                  ) : null}
                                  {issue.retry_count ? (
                                    <div>Attempt #{issue.retry_count}</div>
                                  ) : null}
                                  {issue.property_id ? (
                                    <Link
                                      href={`/properties?entity_id=${selectedEntityId}&property_id=${issue.property_id}`}
                                      className="inline-flex min-h-11 items-center justify-self-start rounded-lg px-3 font-medium text-primary transition hover:bg-primary/5 hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2"
                                    >
                                      Open property
                                    </Link>
                                  ) : null}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {issue.action}
                                </p>
                                {actionLabel ? (
                                  <SecondaryButton
                                    type="button"
                                    className="min-h-11 w-full justify-center rounded-lg px-3 text-xs"
                                    disabled={exceptionActionDisabled(issue)}
                                    onClick={() => handleExceptionAction(issue)}
                                  >
                                    {actionPending ? (
                                      <Loader2
                                        size={13}
                                        className="animate-spin"
                                      />
                                    ) : issue.next_action ===
                                      "review_chart_tax_mapping" ? (
                                      <CheckCircle2 size={13} />
                                    ) : (
                                      <SearchCheck size={13} />
                                    )}
                                    {actionLabel}
                                  </SecondaryButton>
                                ) : null}
                              </div>
                              <div
                                data-testid="xero-exception-desktop-row"
                                className="hidden gap-3 lg:grid lg:grid-cols-[170px_1fr_300px]"
                              >
                                <div className="flex flex-wrap items-start gap-2">
                                  <StatusBadge tone={exceptionTone(issue)}>
                                    {exceptionKindLabel(issue.kind)}
                                  </StatusBadge>
                                  {issue.next_action ? (
                                    <StatusBadge tone="neutral">
                                      {issue.next_action.replaceAll("_", " ")}
                                    </StatusBadge>
                                  ) : null}
                                </div>
                                <div>
                                  <div className="font-medium">
                                    {issue.label}
                                  </div>
                                  <p className="mt-1 text-muted-foreground">
                                    {issue.detail}
                                  </p>
                                  <p className="mt-2 text-xs text-muted-foreground">
                                    {issue.action}
                                  </p>
                                </div>
                                <div className="grid gap-2 text-xs text-muted-foreground">
                                  {actionLabel ? (
                                    <SecondaryButton
                                      type="button"
                                      className="min-h-11 justify-self-start rounded-lg px-3 text-xs"
                                      disabled={exceptionActionDisabled(issue)}
                                      onClick={() =>
                                        handleExceptionAction(issue)
                                      }
                                    >
                                      {actionPending ? (
                                        <Loader2
                                          size={13}
                                          className="animate-spin"
                                        />
                                      ) : issue.next_action ===
                                        "review_chart_tax_mapping" ? (
                                        <CheckCircle2 size={13} />
                                      ) : (
                                        <SearchCheck size={13} />
                                      )}
                                      {actionLabel}
                                    </SecondaryButton>
                                  ) : null}
                                  {issue.charge_rule_id ? (
                                    <div className="grid gap-1 rounded-md border border-border bg-muted/20 p-2">
                                      <div>Current: {currentMappingLabel}</div>
                                      <div>
                                        Suggested: {suggestedMappingLabel}
                                      </div>
                                    </div>
                                  ) : null}
                                  {issue.invoice_number ||
                                  issue.invoice_title ? (
                                    <div>
                                      Invoice:{" "}
                                      {issue.invoice_number ??
                                        issue.invoice_title}
                                    </div>
                                  ) : null}
                                  {issue.tenant_name || issue.property_name ? (
                                    <div>
                                      Record:{" "}
                                      {issue.property_name ?? "Property"}
                                      {issue.unit_label
                                        ? ` / ${issue.unit_label}`
                                        : ""}
                                      {issue.tenant_name
                                        ? ` / ${issue.tenant_name}`
                                        : ""}
                                    </div>
                                  ) : null}
                                  {issue.total_cents !== null ? (
                                    <div>
                                      Amount:{" "}
                                      {formatCurrencyCents(
                                        issue.total_cents,
                                        issue.currency ?? "AUD",
                                      )}
                                    </div>
                                  ) : null}
                                  {issue.external_posting_status ? (
                                    <div>
                                      Posting: {issue.external_posting_status}
                                    </div>
                                  ) : null}
                                  {issue.xero_invoice_id ? (
                                    <div>Xero ID: {issue.xero_invoice_id}</div>
                                  ) : null}
                                  {providerContextLabel ? (
                                    <div>Provider: {providerContextLabel}</div>
                                  ) : null}
                                  {issue.received_at ? (
                                    <div>
                                      Receipt:{" "}
                                      {formatDateTime(issue.received_at)}
                                    </div>
                                  ) : null}
                                  {issue.retry_count ? (
                                    <div>Attempt #{issue.retry_count}</div>
                                  ) : null}
                                  {issue.property_id ? (
                                    <Link
                                      href={`/properties?entity_id=${selectedEntityId}&property_id=${issue.property_id}`}
                                      className="inline-flex min-h-11 items-center justify-self-start rounded-lg px-3 font-medium text-primary transition hover:bg-primary/5 hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2"
                                    >
                                      Open property
                                    </Link>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {!exceptionItems.length ? (
                          <EmptyState
                            icon={<CheckCircle2 size={18} />}
                            title="No Xero sync exceptions"
                            description="Approved drafts, provider receipts, and reconciliation state are clear for this entity."
                          />
                        ) : null}
                      </div>
                    </details>
                  </>
                )}
              </SectionPanel>
            </div>

            <div aria-hidden="true" className="hidden">
              <SectionPanel
                title="Xero connection"
                description="Connect the provider, preview contacts, and keep invoice posting behind explicit future approvals."
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
                          Provider setup
                        </div>
                        <div className="mt-1 font-medium">
                          {(xeroDiagnostics?.provider_configured ??
                          status.provider.configured)
                            ? "Configured"
                            : "Needs env vars"}
                        </div>
                        {!(
                          xeroDiagnostics?.provider_configured ??
                          status.provider.configured
                        ) ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Missing{" "}
                            {(
                              xeroDiagnostics?.missing_config ??
                              status.provider.missing_config
                            ).join(", ")}
                          </p>
                        ) : null}
                      </div>
                      <div className="rounded-md border border-border bg-muted/25 p-3">
                        <div className="text-xs uppercase text-muted-foreground">
                          Connection source
                        </div>
                        <div className="mt-1 font-medium">
                          {status.connection.connection_source === "provider"
                            ? "Provider OAuth"
                            : status.connection.connection_source === "manual"
                              ? "Manual tenant ID"
                              : "Not connected"}
                        </div>
                        {status.connection.tenant_name ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {status.connection.tenant_name}
                          </p>
                        ) : null}
                      </div>
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
                          Last contact preview
                        </div>
                        <div className="mt-1 font-medium">
                          {formatDateTime(
                            status.connection.last_contact_sync_at,
                          )}
                        </div>
                      </div>
                    </div>
                    {xeroDiagnostics ? (
                      <div className="rounded-md border border-border bg-muted/25 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-xs uppercase text-muted-foreground">
                              Connection diagnostics
                            </div>
                            <div className="mt-1 font-medium">
                              Local readiness check
                            </div>
                          </div>
                          <StatusBadge
                            tone={
                              xeroDiagnostics.connected ? "success" : "warning"
                            }
                          >
                            {xeroDiagnostics.connection_source === "provider"
                              ? "OAuth ready"
                              : xeroDiagnostics.connection_source === "manual"
                                ? "Manual tenant"
                                : "Needs connection"}
                          </StatusBadge>
                          <SecondaryButton
                            type="button"
                            onClick={downloadXeroDiagnosticsCsv}
                          >
                            <Download size={14} />
                            Download diagnostics CSV
                          </SecondaryButton>
                          <SecondaryButton
                            type="button"
                            onClick={copyXeroDiagnosticsPacket}
                          >
                            <Copy size={14} />
                            Copy diagnostics packet
                          </SecondaryButton>
                          <SecondaryButton
                            type="button"
                            onClick={downloadXeroDiagnosticsPacket}
                          >
                            <Download size={14} />
                            Download diagnostics packet
                          </SecondaryButton>
                        </div>
                        {xeroDiagnosticsCopyReceipt ? (
                          <p className="mt-3 text-xs font-medium text-success">
                            {xeroDiagnosticsCopyReceipt}
                          </p>
                        ) : null}
                        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          {diagnosticsReadinessDetailRows(xeroDiagnostics).map(
                            ({ label, ready, detail }) => (
                              <div
                                key={label}
                                aria-label={`${label} readiness`}
                                className="rounded-md border border-border bg-white px-3 py-2 text-xs"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-medium">{label}</span>
                                  <StatusBadge
                                    tone={ready ? "success" : "warning"}
                                  >
                                    {ready ? "Ready" : "Blocked"}
                                  </StatusBadge>
                                </div>
                                <p className="mt-2 leading-relaxed text-muted">
                                  {detail}
                                </p>
                              </div>
                            ),
                          )}
                        </div>
                        <div
                          aria-label="Provider setup preflight"
                          className="mt-3 grid gap-3 rounded-md border border-border bg-white p-3"
                          role="region"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className="text-xs uppercase text-muted-foreground">
                                Provider setup preflight
                              </div>
                              <div className="mt-1 font-medium">
                                Xero app configuration
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusBadge
                                tone={
                                  xeroDiagnostics.provider_setup_preflight
                                    .missing_env_vars.length
                                    ? "warning"
                                    : "success"
                                }
                              >
                                {xeroDiagnostics.provider_setup_preflight
                                  .missing_env_vars.length
                                  ? "Env vars missing"
                                  : "Env vars present"}
                              </StatusBadge>
                              <SecondaryButton
                                type="button"
                                onClick={copyXeroSetupPacket}
                              >
                                <Copy size={14} />
                                Copy setup packet
                              </SecondaryButton>
                              <SecondaryButton
                                type="button"
                                onClick={downloadXeroSetupPacket}
                              >
                                <Download size={14} />
                                Download setup packet
                              </SecondaryButton>
                            </div>
                          </div>
                          {xeroSetupCopyReceipt ? (
                            <p className="text-xs font-medium text-success">
                              {xeroSetupCopyReceipt}
                            </p>
                          ) : null}
                          <div className="grid gap-3 md:grid-cols-2">
                            <div>
                              <div className="text-xs font-medium uppercase text-muted-foreground">
                                Required env vars
                              </div>
                              <div className="mt-1 flex flex-wrap gap-1.5">
                                {xeroDiagnostics.provider_setup_preflight.required_env_vars.map(
                                  (envVar) => (
                                    <StatusBadge key={envVar} tone="neutral">
                                      {envVar}
                                    </StatusBadge>
                                  ),
                                )}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs font-medium uppercase text-muted-foreground">
                                Missing env vars
                              </div>
                              <div className="mt-1 flex flex-wrap gap-1.5">
                                {xeroDiagnostics.provider_setup_preflight
                                  .missing_env_vars.length ? (
                                  xeroDiagnostics.provider_setup_preflight.missing_env_vars.map(
                                    (envVar) => (
                                      <StatusBadge key={envVar} tone="warning">
                                        {envVar}
                                      </StatusBadge>
                                    ),
                                  )
                                ) : (
                                  <StatusBadge tone="success">None</StatusBadge>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="grid gap-1">
                            <div className="text-xs font-medium uppercase text-muted-foreground">
                              Expected redirect URI
                            </div>
                            <div className="break-all rounded-md border border-border bg-muted/25 px-3 py-2 text-xs">
                              {
                                xeroDiagnostics.provider_setup_preflight
                                  .expected_redirect_uri
                              }
                            </div>
                          </div>
                          <div className="grid gap-1">
                            <div className="text-xs font-medium uppercase text-muted-foreground">
                              Required scopes
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {xeroDiagnostics.provider_setup_preflight.required_scopes.map(
                                (scope) => (
                                  <StatusBadge key={scope} tone="neutral">
                                    {scope}
                                  </StatusBadge>
                                ),
                              )}
                            </div>
                          </div>
                          <div className="grid gap-1">
                            <div className="text-xs font-medium uppercase text-muted-foreground">
                              Setup checklist
                            </div>
                            <ul className="grid gap-1 text-xs text-muted-foreground">
                              {xeroDiagnostics.provider_setup_preflight.setup_checklist.map(
                                (step) => (
                                  <li key={step} className="flex gap-2">
                                    <CheckCircle2
                                      size={14}
                                      className="mt-0.5 shrink-0 text-primary"
                                    />
                                    <span>{step}</span>
                                  </li>
                                ),
                              )}
                            </ul>
                          </div>
                        </div>
                        {xeroDiagnostics.next_steps.length ? (
                          <ul className="mt-3 grid gap-1 text-xs text-muted-foreground">
                            {xeroDiagnostics.next_steps.map((step) => (
                              <li key={step}>{step}</li>
                            ))}
                          </ul>
                        ) : null}
                        {xeroDiagnostics.guardrails.length ? (
                          <p className="mt-3 text-xs text-muted-foreground">
                            {xeroDiagnostics.guardrails.join(" ")}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
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
                    <div className="grid gap-2 rounded-md border border-border bg-white p-3">
                      <div className="text-sm font-semibold">
                        Provider connection
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Xero will return the authorised organisation; Leasium
                        stores the connection securely and only previews contact
                        matches for now.
                      </p>
                      <Button
                        type="button"
                        disabled={
                          xeroOAuthMutation.isPending ||
                          !xeroCanStartOauth ||
                          !selectedEntityId
                        }
                        onClick={() => xeroOAuthMutation.mutate()}
                      >
                        {xeroOAuthMutation.isPending ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <ExternalLink size={15} />
                        )}
                        Connect with Xero
                      </Button>
                    </div>
                    <div className="grid gap-2 rounded-md border border-border bg-white p-3">
                      <div className="text-sm font-semibold">
                        Contact sync preview
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Pull contacts from the connected Xero organisation and
                        suggest tenant/property mappings without applying them.
                      </p>
                      <SecondaryButton
                        type="button"
                        disabled={
                          xeroContactSyncMutation.isPending ||
                          !xeroCanPreviewContacts
                        }
                        onClick={() => xeroContactSyncMutation.mutate()}
                      >
                        {xeroContactSyncMutation.isPending ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <SearchCheck size={15} />
                        )}
                        Preview contacts
                      </SecondaryButton>
                    </div>
                    <div className="grid gap-2 rounded-md border border-border bg-white p-3">
                      <div className="text-sm font-semibold">
                        Chart/tax validation
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Validate charge-rule account codes and tax types against
                        the provider chart without posting invoices.
                      </p>
                      <SecondaryButton
                        type="button"
                        disabled={
                          xeroChartTaxMutation.isPending ||
                          !xeroCanValidateChartTax
                        }
                        onClick={() => xeroChartTaxMutation.mutate()}
                      >
                        {xeroChartTaxMutation.isPending ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <SearchCheck size={15} />
                        )}
                        Preview chart/tax
                      </SecondaryButton>
                    </div>
                    <div className="grid gap-2 rounded-md border border-border bg-white p-3">
                      <div className="text-sm font-semibold">
                        Invoice posting preview
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Prepare Xero invoice payloads from approved drafts
                        without posting, emailing, or reconciling payments.
                      </p>
                      <SecondaryButton
                        type="button"
                        disabled={
                          xeroInvoicePostingMutation.isPending ||
                          !xeroCanPreviewInvoicePosting
                        }
                        onClick={() => xeroInvoicePostingMutation.mutate()}
                      >
                        {xeroInvoicePostingMutation.isPending ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <SearchCheck size={15} />
                        )}
                        Preview invoice posting
                      </SecondaryButton>
                    </div>
                    <div className="grid gap-2 rounded-md border border-border bg-white p-3">
                      <div className="text-sm font-semibold">
                        Payment reconciliation
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Compare provider invoice payment status with Leasium
                        invoice metadata before applying any local payment
                        update.
                      </p>
                      <SecondaryButton
                        type="button"
                        disabled={
                          xeroPaymentPreviewMutation.isPending ||
                          !xeroCanPreviewPayments
                        }
                        onClick={() => xeroPaymentPreviewMutation.mutate()}
                      >
                        {xeroPaymentPreviewMutation.isPending ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <SearchCheck size={15} />
                        )}
                        Preview payments
                      </SecondaryButton>
                    </div>
                    <Field label="Xero tenant ID">
                      <Input
                        value={xeroTenantId}
                        onChange={(event) =>
                          setXeroTenantId(event.target.value)
                        }
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
            </div>

            {xeroContactPreview ? (
              <div ref={xeroContactPreviewPanelRef}>
                <SectionPanel
                  title="Xero contact preview"
                  description="Review suggested matches from the latest provider pull, then apply the selected local mappings."
                  icon={<SearchCheck size={17} className="text-primary" />}
                  actions={
                    <StatusBadge tone="primary">
                      {selectedXeroContactMatchCount}/
                      {xeroContactPreview.suggested_matches.length} selected
                    </StatusBadge>
                  }
                >
                  <div className="grid gap-3 p-4 md:grid-cols-3">
                    <div className="rounded-md border border-border bg-muted/25 p-3">
                      <div className="text-xs uppercase text-muted-foreground">
                        Contacts fetched
                      </div>
                      <div className="mt-1 text-lg font-semibold">
                        {xeroContactPreview.fetched_contacts}
                      </div>
                    </div>
                    <div className="rounded-md border border-border bg-muted/25 p-3">
                      <div className="text-xs uppercase text-muted-foreground">
                        Xero organisation
                      </div>
                      <div className="mt-1 font-semibold">
                        {xeroContactPreview.tenant_name ??
                          xeroContactPreview.xero_tenant_id}
                      </div>
                    </div>
                    <div className="rounded-md border border-border bg-muted/25 p-3">
                      <div className="text-xs uppercase text-muted-foreground">
                        Previewed
                      </div>
                      <div className="mt-1 font-semibold">
                        {formatDateTime(
                          xeroContactPreview.last_contact_sync_at,
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-3 border-t border-border px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
                    <div className="grid gap-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone="warning">Local only</StatusBadge>
                        <span className="font-medium">
                          Applies saved Leasium mappings only; no Xero contacts
                          are created, updated, or deleted.
                        </span>
                      </div>
                      <ul className="grid gap-1 text-xs text-muted-foreground">
                        {[
                          "No Xero mutation is performed by this review action.",
                          ...xeroContactPreview.guardrails,
                        ].map((guardrail) => (
                          <li key={guardrail} className="flex gap-2">
                            <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
                            <span>{guardrail}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <Button
                      type="button"
                      disabled={
                        xeroContactApplyMutation.isPending ||
                        selectedXeroContactMatchCount === 0
                      }
                      onClick={() => xeroContactApplyMutation.mutate()}
                    >
                      {xeroContactApplyMutation.isPending ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <CheckCircle2 size={15} />
                      )}
                      Apply selected mappings
                    </Button>
                  </div>
                  {xeroContactApplyResult ? (
                    <div className="border-t border-border bg-muted/25 px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone="success">
                          {xeroContactApplyResult.applied_mappings.length}{" "}
                          applied
                        </StatusBadge>
                        <StatusBadge
                          tone={
                            xeroContactApplyResult.skipped_mappings.length
                              ? "warning"
                              : "neutral"
                          }
                        >
                          {xeroContactApplyResult.skipped_mappings.length}{" "}
                          skipped
                        </StatusBadge>
                        <span className="text-muted-foreground">
                          {formatDateTime(xeroContactApplyResult.applied_at)}
                        </span>
                      </div>
                      {xeroContactApplyResult.guardrails.length ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {xeroContactApplyResult.guardrails.join(" ")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="divide-y divide-border border-t border-border">
                    {xeroContactPreview.suggested_matches.map((match) => {
                      const matchKey = xeroContactMatchKey(match);
                      const checked = Boolean(
                        selectedXeroContactMatches[matchKey],
                      );
                      return (
                        <div
                          key={matchKey}
                          className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[48px_180px_1fr_220px]"
                        >
                          <div className="flex items-start pt-1">
                            <input
                              aria-label={`Select ${match.target_name} mapping`}
                              checked={checked}
                              className="h-4 w-4 rounded border-border text-primary focus-visible:ring-primary"
                              onChange={(event) =>
                                setSelectedXeroContactMatches((current) => ({
                                  ...current,
                                  [matchKey]: event.target.checked,
                                }))
                              }
                              type="checkbox"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusBadge tone="primary">
                              {match.target_type}
                            </StatusBadge>
                            <span>{Math.round(match.confidence * 100)}%</span>
                          </div>
                          <div>
                            <div className="font-medium">
                              {match.target_name}
                            </div>
                            <p className="mt-1 text-muted-foreground">
                              Suggested Xero contact: {match.xero_contact_name}
                              {match.xero_email ? ` / ${match.xero_email}` : ""}
                            </p>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {match.match_reason}
                          </div>
                        </div>
                      );
                    })}
                    {xeroContactPreview.suggested_matches.length === 0 ? (
                      <EmptyState
                        icon={<SearchCheck size={18} />}
                        title="No confident contact matches"
                        description="The provider pull completed, but no tenant or property contacts matched by email or name."
                      />
                    ) : null}
                  </div>
                </SectionPanel>
              </div>
            ) : null}

            {xeroChartTaxPreview ? (
              <SectionPanel
                title="Xero chart/tax preview"
                description="Review provider-backed account and tax validation before any invoice posting path is enabled."
                icon={<CircleDollarSign size={17} className="text-primary" />}
                actions={
                  <StatusBadge
                    tone={
                      chartTaxCounts.notFound || chartTaxCounts.needsMapping
                        ? "warning"
                        : "success"
                    }
                  >
                    {chartTaxCounts.ready}/{xeroChartTaxPreview.checked_rules}{" "}
                    ready
                  </StatusBadge>
                }
              >
                <div className="grid gap-3 p-4 md:grid-cols-4">
                  <div className="rounded-md border border-border bg-muted/25 p-3">
                    <div className="text-xs uppercase text-muted-foreground">
                      Accounts fetched
                    </div>
                    <div className="mt-1 text-lg font-semibold">
                      {xeroChartTaxPreview.fetched_accounts}
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-muted/25 p-3">
                    <div className="text-xs uppercase text-muted-foreground">
                      Tax rates fetched
                    </div>
                    <div className="mt-1 text-lg font-semibold">
                      {xeroChartTaxPreview.fetched_tax_rates}
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-muted/25 p-3">
                    <div className="text-xs uppercase text-muted-foreground">
                      Needs review
                    </div>
                    <div className="mt-1 text-lg font-semibold">
                      {chartTaxCounts.needsMapping + chartTaxCounts.notFound}
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-muted/25 p-3">
                    <div className="text-xs uppercase text-muted-foreground">
                      Validated
                    </div>
                    <div className="mt-1 font-semibold">
                      {formatDateTime(xeroChartTaxPreview.validated_at)}
                    </div>
                  </div>
                </div>
                <div className="grid gap-3 border-t border-border px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone="warning">Review first</StatusBadge>
                    <span className="font-medium">
                      This preview reads Xero chart and tax data only; no
                      invoices are posted.
                    </span>
                  </div>
                  <ul className="grid gap-1 text-xs text-muted-foreground">
                    {[
                      "No Xero mutation is performed by this validation preview.",
                      ...xeroChartTaxPreview.guardrails,
                    ].map((guardrail) => (
                      <li key={guardrail} className="flex gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
                        <span>{guardrail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="overflow-x-auto border-t border-border">
                  <table className="w-full border-collapse text-left text-sm tabular-nums">
                    <thead className="bg-muted text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Status</th>
                        <th className="px-3 py-2 font-semibold">Charge rule</th>
                        <th className="px-3 py-2 font-semibold">Account</th>
                        <th className="px-3 py-2 font-semibold">Tax</th>
                        <th className="px-3 py-2 font-semibold">Suggestion</th>
                        <th className="px-3 py-2 font-semibold">Blockers</th>
                      </tr>
                    </thead>
                    <tbody>
                      {xeroChartTaxPreview.results.map((result) => (
                        <tr
                          key={result.charge_rule_id}
                          className="border-t border-border align-top"
                        >
                          <td className="px-3 py-3">
                            <StatusBadge tone={chartTaxStatusTone(result)}>
                              {chartTaxStatusLabel(result.status)}
                            </StatusBadge>
                          </td>
                          <td className="min-w-56 px-3 py-3 text-xs">
                            <div className="font-medium text-foreground">
                              {result.charge_type}
                            </div>
                            <div className="mt-1 text-muted-foreground">
                              {result.property_name ?? "Property"} /{" "}
                              {result.unit_label ?? "Unit"}
                              {result.tenant_name
                                ? ` / ${result.tenant_name}`
                                : ""}
                            </div>
                          </td>
                          <td className="min-w-48 px-3 py-3 text-xs">
                            <div>
                              {result.account_code ?? "-"}
                              {result.account_name
                                ? ` / ${result.account_name}`
                                : ""}
                            </div>
                            <div className="mt-1 text-muted-foreground">
                              {result.account_valid ? "Valid" : "Needs review"}
                              {result.account_status
                                ? ` / ${result.account_status}`
                                : ""}
                            </div>
                          </td>
                          <td className="min-w-48 px-3 py-3 text-xs">
                            <div>
                              {result.tax_type ?? "-"}
                              {result.tax_name ? ` / ${result.tax_name}` : ""}
                            </div>
                            <div className="mt-1 text-muted-foreground">
                              {result.tax_valid ? "Valid" : "Needs review"}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-xs">
                            <div>
                              Account: {result.suggested_account_code ?? "-"}
                            </div>
                            <div>Tax: {result.suggested_tax_type ?? "-"}</div>
                          </td>
                          <td className="min-w-64 px-3 py-3 text-xs text-muted-foreground">
                            {result.blockers.length
                              ? result.blockers.join("; ")
                              : "None"}
                          </td>
                        </tr>
                      ))}
                      {xeroChartTaxPreview.results.length === 0 ? (
                        <tr>
                          <td className="px-3 py-10" colSpan={6}>
                            <EmptyState
                              icon={<CheckCircle2 size={18} />}
                              title="No charge rules checked"
                              description="The provider validation completed, but no charge rules were available for chart and tax validation."
                            />
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </SectionPanel>
            ) : null}

            {xeroInvoicePostingPreview ? (
              <div ref={xeroInvoicePostingPanelRef}>
                <SectionPanel
                  title="Xero invoice posting preview"
                  description="Inspect provider-ready invoice drafts, record explicit local approval, then create Xero drafts as a separate action."
                  icon={<CircleDollarSign size={17} className="text-primary" />}
                  actions={
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone="success">
                        {xeroInvoicePostingPreview.ready_count} ready
                      </StatusBadge>
                      <StatusBadge
                        tone={
                          xeroInvoicePostingPreview.blocked_count
                            ? "danger"
                            : "neutral"
                        }
                      >
                        {xeroInvoicePostingPreview.blocked_count} blocked
                      </StatusBadge>
                      <StatusBadge
                        tone={
                          locallyApprovedXeroDraftCount ? "success" : "warning"
                        }
                      >
                        {locallyApprovedXeroDraftCount} approved
                      </StatusBadge>
                      <SecondaryButton
                        type="button"
                        className="min-h-11 rounded-lg px-3"
                        disabled={
                          readyXeroInvoiceDraftIds.length === 0 ||
                          !xeroCanCreateDrafts ||
                          xeroDraftCreateMutation.isPending
                        }
                        onClick={() => xeroDraftCreateMutation.mutate()}
                      >
                        {xeroDraftCreateMutation.isPending ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Send size={14} />
                        )}
                        Create Xero drafts
                      </SecondaryButton>
                    </div>
                  }
                >
                  <p className="mx-4 mt-4 flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-foreground">
                    <PlugZap size={15} className="shrink-0 text-primary" />
                    <span>
                      Posts to <strong>{selectedEntityName}</strong>&rsquo;s Xero
                      {xeroInvoicePostingPreview.tenant_name
                        ? ` — ${xeroInvoicePostingPreview.tenant_name}`
                        : ""}
                      . Each entity posts only to its own Xero organisation.
                    </span>
                  </p>
                  <div className="grid gap-3 p-4 md:grid-cols-4">
                    <div className="rounded-md border border-border bg-muted/25 p-3">
                      <div className="text-xs uppercase text-muted-foreground">
                        Checked drafts
                      </div>
                      <div className="mt-1 text-lg font-semibold">
                        {xeroInvoicePostingPreview.checked_invoices}
                      </div>
                    </div>
                    <div className="rounded-md border border-border bg-muted/25 p-3">
                      <div className="text-xs uppercase text-muted-foreground">
                        Ready
                      </div>
                      <div className="mt-1 text-lg font-semibold">
                        {xeroInvoicePostingPreview.ready_count}
                      </div>
                    </div>
                    <div className="rounded-md border border-border bg-muted/25 p-3">
                      <div className="text-xs uppercase text-muted-foreground">
                        Blocked
                      </div>
                      <div className="mt-1 text-lg font-semibold">
                        {xeroInvoicePostingPreview.blocked_count}
                      </div>
                    </div>
                    <div className="rounded-md border border-border bg-muted/25 p-3">
                      <div className="text-xs uppercase text-muted-foreground">
                        Prepared
                      </div>
                      <div className="mt-1 font-semibold">
                        {formatDateTime(xeroInvoicePostingPreview.prepared_at)}
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-3 border-t border-border px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone="warning">Preview only</StatusBadge>
                      <span className="font-medium">
                        This preview does not post to Xero, email tenants, or
                        reconcile payments.
                      </span>
                    </div>
                    <ul className="grid gap-1 text-xs text-muted-foreground">
                      {[
                        "Approval is local only; Xero draft creation is a separate reviewed action.",
                        ...xeroInvoicePostingPreview.guardrails,
                      ].map((guardrail) => (
                        <li key={guardrail} className="flex gap-2">
                          <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
                          <span>{guardrail}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="divide-y divide-border border-t border-border">
                    {xeroInvoicePostingPreview.results.map((result) => {
                      const approval =
                        xeroInvoiceApprovalResults[result.invoice_draft_id];
                      const isApproved =
                        approval?.approval_state === "approved";
                      const isApprovalPending =
                        xeroInvoiceApprovalMutation.isPending &&
                        xeroInvoiceApprovalMutation.variables
                          ?.invoiceDraftId === result.invoice_draft_id;
                      return (
                        <div
                          key={result.invoice_draft_id}
                          className="grid gap-3 px-4 py-3 text-sm lg:grid-cols-[170px_1fr_300px]"
                        >
                          <div className="flex flex-wrap items-start gap-2">
                            <StatusBadge
                              tone={invoicePostingStatusTone(result.status)}
                            >
                              {result.status}
                            </StatusBadge>
                            <StatusBadge
                              tone={
                                isApproved
                                  ? "success"
                                  : result.status === "ready"
                                    ? "warning"
                                    : "neutral"
                              }
                            >
                              {isApproved
                                ? "Approved for Xero"
                                : result.status === "ready"
                                  ? "Needs approval"
                                  : "Blocked"}
                            </StatusBadge>
                            <div className="text-xs text-muted-foreground">
                              {result.invoice_number ?? result.invoice_draft_id}
                            </div>
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <span className="font-medium">
                                {result.title}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {result.contact_name ?? "No contact"} /{" "}
                                {formatCurrencyCents(
                                  result.total_cents,
                                  result.currency,
                                )}
                              </span>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              Issue {result.issue_date ?? "-"} / Due{" "}
                              {result.due_date ?? "-"} / {result.line_count}{" "}
                              line
                              {result.line_count === 1 ? "" : "s"}
                            </div>
                            {approval ? (
                              <p className="mt-2 text-xs text-muted-foreground">
                                {approval.reason}
                              </p>
                            ) : null}
                            {result.blockers.length ? (
                              <p className="mt-2 text-xs text-danger">
                                {result.blockers.join("; ")}
                              </p>
                            ) : null}
                          </div>
                          <div className="grid gap-2 text-xs text-muted-foreground">
                            <div className="flex flex-wrap gap-2">
                              <SecondaryButton
                                type="button"
                                className="min-h-8 rounded-lg px-3 text-xs"
                                disabled={
                                  result.status !== "ready" || isApprovalPending
                                }
                                onClick={() =>
                                  xeroInvoiceApprovalMutation.mutate({
                                    invoiceDraftId: result.invoice_draft_id,
                                    approved: true,
                                  })
                                }
                              >
                                {isApprovalPending ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <CheckCircle2 size={13} />
                                )}
                                Approve Xero
                              </SecondaryButton>
                              <SecondaryButton
                                type="button"
                                className="min-h-8 rounded-lg px-3 text-xs"
                                disabled={!isApproved || isApprovalPending}
                                onClick={() =>
                                  xeroInvoiceApprovalMutation.mutate({
                                    invoiceDraftId: result.invoice_draft_id,
                                    approved: false,
                                  })
                                }
                              >
                                {isApprovalPending ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <Ban size={13} />
                                )}
                                Revoke
                              </SecondaryButton>
                            </div>
                            <div className="grid gap-1 rounded-md border border-border bg-muted/25 p-2">
                              <div className="font-medium text-foreground">
                                Billing handoff
                              </div>
                              <div>
                                Approve Xero here, then dispatch and reconcile
                                the invoice in Billing Readiness.
                              </div>
                              <Link
                                href={billingReadinessHandoffHref({
                                  entityId: selectedEntityId,
                                  invoiceDraftId: result.invoice_draft_id,
                                })}
                                className="inline-flex min-h-11 w-fit items-center gap-1 rounded-lg px-3 font-medium text-primary transition hover:bg-primary/5 hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2"
                              >
                                <ExternalLink size={13} />
                                Open Billing handoff
                              </Link>
                            </div>
                            {result.line_items.map((line, index) => (
                              <div
                                key={
                                  line.source_line_id ??
                                  `${result.invoice_draft_id}-${index}`
                                }
                                className="rounded-md border border-border bg-muted/25 p-2"
                              >
                                <div className="font-medium text-foreground">
                                  {line.description}
                                </div>
                                <div className="mt-1">
                                  Qty {line.quantity} x {line.unit_amount} /
                                  acct {line.account_code ?? "-"} / tax{" "}
                                  {line.tax_type ?? "-"} / {line.line_amount}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    {xeroInvoicePostingPreview.results.length === 0 ? (
                      <EmptyState
                        icon={<CheckCircle2 size={18} />}
                        title="No invoice drafts checked"
                        description="The posting preview completed, but there were no approved unsynced drafts to inspect."
                      />
                    ) : null}
                  </div>
                  {xeroDraftCreateResult ? (
                    <div className="border-t border-border">
                      <div className="grid gap-3 p-4 md:grid-cols-4">
                        <div className="rounded-md border border-border bg-muted/25 p-3">
                          <div className="text-xs uppercase text-muted-foreground">
                            Created
                          </div>
                          <div className="mt-1 text-lg font-semibold">
                            {xeroDraftCreateResult.created_count}
                          </div>
                        </div>
                        <div className="rounded-md border border-border bg-muted/25 p-3">
                          <div className="text-xs uppercase text-muted-foreground">
                            Skipped
                          </div>
                          <div className="mt-1 text-lg font-semibold">
                            {xeroDraftCreateResult.skipped_count}
                          </div>
                        </div>
                        <div className="rounded-md border border-border bg-muted/25 p-3">
                          <div className="text-xs uppercase text-muted-foreground">
                            Blocked
                          </div>
                          <div className="mt-1 text-lg font-semibold">
                            {xeroDraftCreateResult.blocked_count}
                          </div>
                        </div>
                        <div className="rounded-md border border-border bg-muted/25 p-3">
                          <div className="text-xs uppercase text-muted-foreground">
                            Failed
                          </div>
                          <div className="mt-1 text-lg font-semibold">
                            {xeroDraftCreateResult.failed_count}
                          </div>
                        </div>
                      </div>
                      <div className="grid gap-3 border-t border-border px-4 py-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone="primary">
                            Xero draft creation result
                          </StatusBadge>
                          <span className="font-medium">
                            Checked {xeroDraftCreateResult.checked_invoices}{" "}
                            invoice
                            {xeroDraftCreateResult.checked_invoices === 1
                              ? ""
                              : "s"}
                            .
                          </span>
                        </div>
                        <ul className="grid gap-1 text-xs text-muted-foreground">
                          {xeroDraftCreateResult.guardrails.map((guardrail) => (
                            <li key={guardrail} className="flex gap-2">
                              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
                              <span>{guardrail}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="divide-y divide-border border-t border-border">
                        {xeroDraftCreateResult.results.map((result) => (
                          <div
                            key={result.invoice_draft_id}
                            className="grid gap-3 px-4 py-3 text-sm md:grid-cols-[180px_1fr_220px]"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusBadge
                                tone={xeroDraftCreateTone(result.status)}
                              >
                                {result.status}
                              </StatusBadge>
                              <span className="text-xs text-muted-foreground">
                                {result.invoice_number ??
                                  result.invoice_draft_id}
                              </span>
                            </div>
                            <div>
                              <p className="font-medium">{result.reason}</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {result.external_posting_status} / approval{" "}
                                {result.approval_state}
                              </p>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              <div>
                                Xero ID: {result.xero_invoice_id ?? "-"}
                              </div>
                              <div>Status: {result.xero_status ?? "-"}</div>
                              <Link
                                href={billingReadinessHandoffHref({
                                  entityId: selectedEntityId,
                                  invoiceDraftId: result.invoice_draft_id,
                                  filter:
                                    result.status === "created"
                                      ? "ready_dispatch"
                                      : "needs_action",
                                })}
                                className="mt-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-3 font-medium text-primary transition hover:bg-primary/5 hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2"
                              >
                                <ExternalLink size={13} />
                                Open dispatch handoff
                              </Link>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </SectionPanel>
              </div>
            ) : null}

            {displayedPaymentReconciliation ? (
              <div ref={xeroPaymentPanelRef}>
                <SectionPanel
                  title="Payment reconciliation review"
                  description="Review provider payment status against Leasium invoice metadata before applying local payment updates."
                  icon={<CircleDollarSign size={17} className="text-primary" />}
                  actions={
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge
                        tone={
                          displayedPaymentReconciliation.blocked_count
                            ? "warning"
                            : "success"
                        }
                      >
                        {displayedPaymentReconciliation.ready_count +
                          displayedPaymentReconciliation.applied_count}{" "}
                        actionable
                      </StatusBadge>
                      <StatusBadge
                        tone={
                          displayedPaymentReconciliation.blocked_count
                            ? "danger"
                            : "neutral"
                        }
                      >
                        {displayedPaymentReconciliation.blocked_count} blocked
                      </StatusBadge>
                      <Button
                        type="button"
                        disabled={
                          readyPaymentReconciliationCount === 0 ||
                          xeroPaymentApplyMutation.isPending ||
                          Boolean(xeroPaymentApplyResult)
                        }
                        onClick={() => xeroPaymentApplyMutation.mutate()}
                      >
                        {xeroPaymentApplyMutation.isPending ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <CheckCircle2 size={14} />
                        )}
                        Apply provider payments
                      </Button>
                    </div>
                  }
                >
                  <div className="grid gap-3 p-4 md:grid-cols-4">
                    <div className="rounded-md border border-border bg-muted/25 p-3">
                      <div className="text-xs uppercase text-muted-foreground">
                        Checked payments
                      </div>
                      <div className="mt-1 text-lg font-semibold">
                        {displayedPaymentReconciliation.checked_payments}
                      </div>
                    </div>
                    <div className="rounded-md border border-border bg-muted/25 p-3">
                      <div className="text-xs uppercase text-muted-foreground">
                        Ready
                      </div>
                      <div className="mt-1 text-lg font-semibold">
                        {displayedPaymentReconciliation.ready_count}
                      </div>
                    </div>
                    <div className="rounded-md border border-border bg-muted/25 p-3">
                      <div className="text-xs uppercase text-muted-foreground">
                        Applied
                      </div>
                      <div className="mt-1 text-lg font-semibold">
                        {displayedPaymentReconciliation.applied_count}
                      </div>
                    </div>
                    <div className="rounded-md border border-border bg-muted/25 p-3">
                      <div className="text-xs uppercase text-muted-foreground">
                        Reviewed
                      </div>
                      <div className="mt-1 font-semibold">
                        {formatDateTime(
                          displayedPaymentReconciliation.reconciled_at,
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-3 border-t border-border px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone="warning">
                        Local metadata only
                      </StatusBadge>
                      <span className="font-medium">
                        Provider payments are compared against Leasium invoices;
                        Apply updates Leasium payment metadata only.
                      </span>
                    </div>
                    <ul className="grid gap-1 text-xs text-muted-foreground">
                      {displayedPaymentReconciliation.guardrails.map(
                        (guardrail) => (
                          <li key={guardrail} className="flex gap-2">
                            <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
                            <span>{guardrail}</span>
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                  <div className="divide-y divide-border border-t border-border">
                    {displayedPaymentReconciliation.results.map(
                      (result, index) => (
                        <div
                          key={
                            result.idempotency_key ??
                            result.invoice_draft_id ??
                            `${result.invoice_number}-${index}`
                          }
                          className="grid gap-3 px-4 py-3 text-sm lg:grid-cols-[170px_1fr_300px]"
                        >
                          <div className="flex flex-wrap items-start gap-2">
                            <StatusBadge
                              tone={paymentReconciliationTone(result.status)}
                            >
                              {result.status}
                            </StatusBadge>
                            <span className="text-xs text-muted-foreground">
                              {result.invoice_number ??
                                result.invoice_draft_id ??
                                "Unmatched payment"}
                            </span>
                          </div>
                          <div>
                            <div className="font-medium">{result.reason}</div>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                              <StatusBadge
                                tone={paymentConfidenceTone(
                                  result.match_confidence,
                                )}
                              >
                                {result.match_confidence} confidence
                              </StatusBadge>
                              <StatusBadge tone="neutral">
                                No bank write
                              </StatusBadge>
                              {result.amount_delta_cents ? (
                                <StatusBadge tone="warning">
                                  Delta{" "}
                                  {formatCurrencyCents(
                                    result.amount_delta_cents,
                                  )}
                                </StatusBadge>
                              ) : (
                                <StatusBadge tone="success">
                                  Amount aligned
                                </StatusBadge>
                              )}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              Current {result.current_status ?? "unknown"} /
                              Proposed {result.proposed_status ?? "unknown"}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {result.match_method}
                            </div>
                            {result.reference || result.bank_transaction_id ? (
                              <div className="mt-1 text-xs text-muted-foreground">
                                {[
                                  result.reference
                                    ? `Ref ${result.reference}`
                                    : null,
                                  result.bank_transaction_id
                                    ? `Bank ${result.bank_transaction_id}`
                                    : null,
                                  result.bank_account_name,
                                ]
                                  .filter(Boolean)
                                  .join(" / ")}
                              </div>
                            ) : null}
                            {result.idempotency_key ? (
                              <div className="mt-1 text-xs text-muted-foreground">
                                Key {result.idempotency_key}
                              </div>
                            ) : null}
                          </div>
                          <div className="grid gap-1 text-xs text-muted-foreground">
                            <div>
                              Current paid:{" "}
                              {result.current_paid_cents === null
                                ? "-"
                                : formatCurrencyCents(
                                    result.current_paid_cents,
                                  )}
                            </div>
                            <div>
                              Proposed paid:{" "}
                              {result.proposed_paid_cents === null
                                ? "-"
                                : formatCurrencyCents(
                                    result.proposed_paid_cents,
                                  )}
                            </div>
                            <div>
                              Outstanding:{" "}
                              {result.outstanding_cents === null
                                ? "-"
                                : formatCurrencyCents(result.outstanding_cents)}
                            </div>
                            {result.statement_amount_cents !== null ? (
                              <div>
                                Statement:{" "}
                                {formatCurrencyCents(
                                  result.statement_amount_cents,
                                )}
                              </div>
                            ) : null}
                            {result.statement_date ? (
                              <div>
                                Statement date:{" "}
                                {formatDate(result.statement_date)}
                              </div>
                            ) : null}
                            {result.guardrail_flags.length ? (
                              <div className="flex flex-wrap gap-1 pt-1">
                                {result.guardrail_flags
                                  .slice(0, 3)
                                  .map((flag) => (
                                    <span
                                      key={flag}
                                      className="rounded-full bg-muted px-2 py-0.5 text-leasium-micro font-semibold text-muted-foreground"
                                    >
                                      {flag.replaceAll("_", " ")}
                                    </span>
                                  ))}
                              </div>
                            ) : null}
                            {result.invoice_draft_id ? (
                              <Link
                                href={billingReadinessHandoffHref({
                                  entityId: selectedEntityId,
                                  invoiceDraftId: result.invoice_draft_id,
                                  filter:
                                    result.status === "applied" &&
                                    result.proposed_status === "paid"
                                      ? "complete"
                                      : "unpaid",
                                })}
                                className="mt-1 inline-flex min-h-11 w-fit items-center gap-1 rounded-lg px-3 font-medium text-primary transition hover:bg-primary/5 hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2"
                              >
                                <ExternalLink size={13} />
                                Open reconciliation handoff
                              </Link>
                            ) : null}
                          </div>
                        </div>
                      ),
                    )}
                    {displayedPaymentReconciliation.results.length === 0 ? (
                      <EmptyState
                        icon={<CheckCircle2 size={18} />}
                        title="No provider payment changes"
                        description="The provider pull completed, but no invoice payment status changes were ready to review."
                      />
                    ) : null}
                  </div>
                </SectionPanel>
              </div>
            ) : null}

            <div ref={basiqReconciliationPanelRef}>
              <SectionPanel
                title="Bank feed (Basiq)"
                description="Reconcile imported bank transactions against Leasium invoice metadata before applying any local payment update."
                icon={<CircleDollarSign size={17} className="text-primary" />}
                actions={
                  displayedBasiqReconciliation ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge
                        tone={
                          displayedBasiqReconciliation.blocked_count
                            ? "warning"
                            : "success"
                        }
                      >
                        {displayedBasiqReconciliation.ready_count +
                          displayedBasiqReconciliation.applied_count}{" "}
                        actionable
                      </StatusBadge>
                      <StatusBadge
                        tone={
                          displayedBasiqReconciliation.blocked_count
                            ? "danger"
                            : "neutral"
                        }
                      >
                        {displayedBasiqReconciliation.blocked_count} blocked
                      </StatusBadge>
                      <Button
                        type="button"
                        disabled={
                          approvedBasiqKeyList.length === 0 ||
                          basiqApplyMutation.isPending ||
                          Boolean(basiqApplyResult)
                        }
                        onClick={() =>
                          basiqApplyMutation.mutate(approvedBasiqKeyList)
                        }
                      >
                        {basiqApplyMutation.isPending ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <CheckCircle2 size={14} />
                        )}
                        Apply approved transactions
                      </Button>
                    </div>
                  ) : null
                }
              >
                <div className="grid gap-3 border-b border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold">
                      Bank feed connection
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge
                        tone={
                          basiqConnection?.connected
                            ? "success"
                            : basiqConnection?.configured
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {basiqConnection?.connected
                          ? "Connected"
                          : basiqConnection?.configured
                            ? "Not connected"
                            : "Not configured"}
                      </StatusBadge>
                      <SecondaryButton
                        type="button"
                        onClick={() => basiqConnectionStatusQuery.refetch()}
                        disabled={
                          !selectedEntityId ||
                          basiqConnectionStatusQuery.isFetching
                        }
                      >
                        {basiqConnectionStatusQuery.isFetching ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <RefreshCw size={14} />
                        )}
                        Refresh status
                      </SecondaryButton>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Connecting links a Basiq consent so the feed can be fetched
                    for review. Connecting and fetching never moves money or
                    writes to the bank — Apply only updates Leasium invoice
                    payment metadata for approved rows.
                  </p>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-md border border-border bg-muted/25 p-3">
                      <div className="text-xs uppercase text-muted-foreground">
                        Consent status
                      </div>
                      <div className="mt-1 font-medium">
                        {basiqConnection?.consent_status ?? "None"}
                      </div>
                    </div>
                    <div className="rounded-md border border-border bg-muted/25 p-3">
                      <div className="text-xs uppercase text-muted-foreground">
                        Auth link expires
                      </div>
                      <div className="mt-1 font-medium">
                        {basiqConnection?.auth_link_expires_at
                          ? formatDateTime(basiqConnection.auth_link_expires_at)
                          : "-"}
                      </div>
                    </div>
                    <div className="rounded-md border border-border bg-muted/25 p-3">
                      <div className="text-xs uppercase text-muted-foreground">
                        Last fetch
                      </div>
                      <div className="mt-1 font-medium">
                        {basiqConnection?.last_fetch_at
                          ? formatDateTime(basiqConnection.last_fetch_at)
                          : "-"}
                      </div>
                    </div>
                  </div>
                  {basiqConnection && !basiqConnection.configured ? (
                    <p className="text-xs text-muted-foreground">
                      Provider not configured. Set BASIQ_ENABLED + BASIQ_API_KEY
                      to enable the live bank feed.
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      disabled={
                        !selectedEntityId ||
                        !basiqConnection?.can_start_connect ||
                        basiqConnectMutation.isPending
                      }
                      onClick={() => basiqConnectMutation.mutate()}
                    >
                      {basiqConnectMutation.isPending ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <PlugZap size={15} />
                      )}
                      Connect bank feed (Basiq)
                    </Button>
                    {basiqConnection?.connected ? (
                      <>
                        <Button
                          type="button"
                          disabled={
                            !basiqConnection.can_fetch ||
                            basiqProviderPreviewMutation.isPending
                          }
                          onClick={() => basiqProviderPreviewMutation.mutate()}
                        >
                          {basiqProviderPreviewMutation.isPending ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : (
                            <SearchCheck size={15} />
                          )}
                          Fetch from connected bank feed
                        </Button>
                        <SecondaryButton
                          type="button"
                          className="text-danger"
                          disabled={basiqRevokeMutation.isPending}
                          onClick={handleRevokeBasiqConnection}
                        >
                          {basiqRevokeMutation.isPending ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : (
                            <Ban size={15} />
                          )}
                          Disconnect
                        </SecondaryButton>
                      </>
                    ) : null}
                  </div>
                  {basiqConnectStart ? (
                    basiqConnectStart.consent_link ? (
                      <div className="grid gap-1 rounded-md border border-border bg-white p-3 text-sm">
                        <div className="font-medium">Consent ready</div>
                        <p className="text-xs text-muted-foreground">
                          Open the Basiq consent in a new tab to authorise the
                          feed. Leasium does not redirect automatically.
                        </p>
                        <a
                          className="inline-flex min-h-11 w-fit items-center gap-1 rounded-lg px-3 font-medium text-primary transition hover:bg-primary/5 hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2"
                          href={basiqConnectStart.consent_link}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <ExternalLink size={14} />
                          Open Basiq consent
                        </a>
                        {basiqConnectStart.expires_at ? (
                          <p className="text-xs text-muted-foreground">
                            Link expires{" "}
                            {formatDateTime(basiqConnectStart.expires_at)}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {basiqConnectStart.missing_config.length
                          ? `No consent link. Missing ${basiqConnectStart.missing_config.join(", ")}.`
                          : "No consent link was returned."}
                      </p>
                    )
                  ) : null}
                  {basiqConnectMutation.error ? (
                    <p className="text-xs font-medium text-danger">
                      {basiqConnectMutation.error instanceof Error
                        ? basiqConnectMutation.error.message
                        : "Could not start the Basiq connection."}
                    </p>
                  ) : null}
                  {basiqRevokeMutation.error ? (
                    <p className="text-xs font-medium text-danger">
                      {basiqRevokeMutation.error instanceof Error
                        ? basiqRevokeMutation.error.message
                        : "Could not disconnect the Basiq feed."}
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-3 border-b border-border p-4">
                  {displayedBasiqReconciliation &&
                  !displayedBasiqReconciliation.basiq_configured ? (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <StatusBadge tone="warning">
                        Basiq not connected
                      </StatusBadge>
                      <span className="text-muted-foreground">
                        Reconcile imported transactions manually — no live Basiq
                        feed is configured yet.
                      </span>
                    </div>
                  ) : null}
                  <div className="text-sm font-semibold">Add transaction</div>
                  <p className="text-sm text-muted-foreground">
                    No live Basiq feed yet — enter imported bank transactions to
                    reconcile against Leasium invoice metadata.
                  </p>
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                    <Field label="Amount (AUD)">
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        value={basiqDraftAmount}
                        onChange={(event) =>
                          setBasiqDraftAmount(event.target.value)
                        }
                        placeholder="880.00"
                      />
                    </Field>
                    <Field label="Posted date">
                      <Input
                        type="date"
                        value={basiqDraftDate}
                        onChange={(event) =>
                          setBasiqDraftDate(event.target.value)
                        }
                      />
                    </Field>
                    <Field label="Reference">
                      <Input
                        value={basiqDraftReference}
                        onChange={(event) =>
                          setBasiqDraftReference(event.target.value)
                        }
                        placeholder="Bank reference"
                      />
                    </Field>
                    <Field label="Invoice number (optional)">
                      <Input
                        value={basiqDraftInvoiceNumber}
                        onChange={(event) =>
                          setBasiqDraftInvoiceNumber(event.target.value)
                        }
                        placeholder="INV-1001"
                      />
                    </Field>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <SecondaryButton
                      type="button"
                      disabled={
                        !Number.isFinite(Number.parseFloat(basiqDraftAmount)) ||
                        !basiqDraftDate.trim()
                      }
                      onClick={addBasiqTransaction}
                    >
                      <UserPlus size={15} />
                      Add transaction
                    </SecondaryButton>
                    <Button
                      type="button"
                      disabled={
                        basiqTransactions.length === 0 ||
                        basiqPreviewMutation.isPending
                      }
                      onClick={() => basiqPreviewMutation.mutate()}
                    >
                      {basiqPreviewMutation.isPending ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <SearchCheck size={15} />
                      )}
                      Preview
                    </Button>
                  </div>
                  {basiqTransactions.length ? (
                    <ul className="grid gap-2">
                      {basiqTransactions.map((transaction) => (
                        <li
                          key={transaction.transaction_id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/25 px-3 py-2 text-sm"
                        >
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">
                              {formatCurrencyCents(transaction.amount_cents)}
                            </span>
                            <span className="text-muted-foreground">
                              {formatDate(transaction.posted_date)}
                            </span>
                            {transaction.reference ? (
                              <span className="text-xs text-muted-foreground">
                                Ref {transaction.reference}
                              </span>
                            ) : null}
                          </span>
                          <SecondaryButton
                            type="button"
                            className="min-h-11 px-3 text-danger"
                            onClick={() =>
                              removeBasiqTransaction(transaction.transaction_id)
                            }
                          >
                            <Ban size={14} />
                            Remove
                          </SecondaryButton>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState
                      icon={<CircleDollarSign size={18} />}
                      title="No transactions added"
                      description="Add at least one imported bank transaction, then run a preview to review matches."
                    />
                  )}
                </div>
                {displayedBasiqReconciliation ? (
                  <>
                    <div className="grid gap-3 p-4 md:grid-cols-4">
                      <div className="rounded-md border border-border bg-muted/25 p-3">
                        <div className="text-xs uppercase text-muted-foreground">
                          Checked transactions
                        </div>
                        <div className="mt-1 text-lg font-semibold">
                          {displayedBasiqReconciliation.checked_transactions}
                        </div>
                      </div>
                      <div className="rounded-md border border-border bg-muted/25 p-3">
                        <div className="text-xs uppercase text-muted-foreground">
                          Ready
                        </div>
                        <div className="mt-1 text-lg font-semibold">
                          {displayedBasiqReconciliation.ready_count}
                        </div>
                      </div>
                      <div className="rounded-md border border-border bg-muted/25 p-3">
                        <div className="text-xs uppercase text-muted-foreground">
                          Applied
                        </div>
                        <div className="mt-1 text-lg font-semibold">
                          {displayedBasiqReconciliation.applied_count}
                        </div>
                      </div>
                      <div className="rounded-md border border-border bg-muted/25 p-3">
                        <div className="text-xs uppercase text-muted-foreground">
                          Reviewed
                        </div>
                        <div className="mt-1 font-semibold">
                          {formatDateTime(
                            displayedBasiqReconciliation.reconciled_at,
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-3 border-t border-border px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone="warning">
                          Local metadata only
                        </StatusBadge>
                        <span className="font-medium">
                          Imported transactions are compared against Leasium
                          invoices; Apply updates Leasium payment metadata only.
                        </span>
                      </div>
                      <ul className="grid gap-1 text-xs text-muted-foreground">
                        {displayedBasiqReconciliation.guardrails.map(
                          (guardrail) => (
                            <li key={guardrail} className="flex gap-2">
                              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
                              <span>{guardrail}</span>
                            </li>
                          ),
                        )}
                      </ul>
                    </div>
                    <div className="divide-y divide-border border-t border-border">
                      {displayedBasiqReconciliation.results.map(
                        (result, index) => {
                          const approvable =
                            result.status === "ready" &&
                            result.idempotency_key !== null &&
                            !basiqApplyResult;
                          return (
                            <div
                              key={
                                result.idempotency_key ??
                                result.bank_transaction_id ??
                                `${result.invoice_number}-${index}`
                              }
                              className="grid gap-3 px-4 py-3 text-sm lg:grid-cols-[170px_1fr_300px]"
                            >
                              <div className="flex flex-wrap items-start gap-2">
                                <StatusBadge
                                  tone={paymentReconciliationTone(
                                    result.status,
                                  )}
                                >
                                  {result.status}
                                </StatusBadge>
                                <span className="text-xs text-muted-foreground">
                                  {result.invoice_number ??
                                    result.invoice_draft_id ??
                                    "Unmatched transaction"}
                                </span>
                                {approvable ? (
                                  <label className="flex w-full items-center gap-2 text-xs font-medium text-foreground">
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 rounded border-border-strong text-primary focus-visible:ring-primary/30"
                                      checked={Boolean(
                                        approvedBasiqKeys[
                                          result.idempotency_key as string
                                        ],
                                      )}
                                      onChange={(event) =>
                                        setApprovedBasiqKeys((current) => ({
                                          ...current,
                                          [result.idempotency_key as string]:
                                            event.target.checked,
                                        }))
                                      }
                                    />
                                    Approve
                                  </label>
                                ) : null}
                              </div>
                              <div>
                                <div className="font-medium">
                                  {result.reason}
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                                  <StatusBadge
                                    tone={paymentConfidenceTone(
                                      result.match_confidence,
                                    )}
                                  >
                                    {result.match_confidence} confidence
                                  </StatusBadge>
                                  <StatusBadge tone="neutral">
                                    No bank write
                                  </StatusBadge>
                                  {result.amount_delta_cents ? (
                                    <StatusBadge tone="warning">
                                      Delta{" "}
                                      {formatCurrencyCents(
                                        result.amount_delta_cents,
                                      )}
                                    </StatusBadge>
                                  ) : (
                                    <StatusBadge tone="success">
                                      Amount aligned
                                    </StatusBadge>
                                  )}
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  Current {result.current_status ?? "unknown"} /
                                  Proposed {result.proposed_status ?? "unknown"}
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {result.match_method}
                                </div>
                                {result.reference ||
                                result.bank_transaction_id ? (
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {[
                                      result.reference
                                        ? `Ref ${result.reference}`
                                        : null,
                                      result.bank_transaction_id
                                        ? `Bank ${result.bank_transaction_id}`
                                        : null,
                                      result.counterparty,
                                      result.bank_account_name,
                                    ]
                                      .filter(Boolean)
                                      .join(" / ")}
                                  </div>
                                ) : null}
                                {result.idempotency_key ? (
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    Key {result.idempotency_key}
                                  </div>
                                ) : null}
                              </div>
                              <div className="grid gap-1 text-xs text-muted-foreground">
                                <div>
                                  Current paid:{" "}
                                  {result.current_paid_cents === null
                                    ? "-"
                                    : formatCurrencyCents(
                                        result.current_paid_cents,
                                      )}
                                </div>
                                <div>
                                  Proposed paid:{" "}
                                  {result.proposed_paid_cents === null
                                    ? "-"
                                    : formatCurrencyCents(
                                        result.proposed_paid_cents,
                                      )}
                                </div>
                                <div>
                                  Outstanding:{" "}
                                  {result.outstanding_cents === null
                                    ? "-"
                                    : formatCurrencyCents(
                                        result.outstanding_cents,
                                      )}
                                </div>
                                {result.statement_amount_cents !== null ? (
                                  <div>
                                    Statement:{" "}
                                    {formatCurrencyCents(
                                      result.statement_amount_cents,
                                    )}
                                  </div>
                                ) : null}
                                {result.statement_date ? (
                                  <div>
                                    Statement date:{" "}
                                    {formatDate(result.statement_date)}
                                  </div>
                                ) : null}
                                {result.guardrail_flags.length ? (
                                  <div className="flex flex-wrap gap-1 pt-1">
                                    {result.guardrail_flags
                                      .slice(0, 3)
                                      .map((flag) => (
                                        <span
                                          key={flag}
                                          className="rounded-full bg-muted px-2 py-0.5 text-leasium-micro font-semibold text-muted-foreground"
                                        >
                                          {flag.replaceAll("_", " ")}
                                        </span>
                                      ))}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          );
                        },
                      )}
                      {displayedBasiqReconciliation.results.length === 0 ? (
                        <EmptyState
                          icon={<CheckCircle2 size={18} />}
                          title="No transaction changes"
                          description="The preview completed, but no invoice payment status changes were ready to review."
                        />
                      ) : null}
                    </div>
                  </>
                ) : null}
              </SectionPanel>
            </div>

            <div ref={xeroChartMappingPanelRef}>
              <SectionPanel
                title="Chart and tax mapping"
                description="Review account codes and tax types on charge rules before any Xero posting approval exists."
                icon={<CircleDollarSign size={17} className="text-primary" />}
                actions={
                  <StatusBadge
                    tone={mappingIssues.length ? "warning" : "success"}
                  >
                    {mappingIssues.length} issue
                    {mappingIssues.length === 1 ? "" : "s"}
                  </StatusBadge>
                }
              >
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm tabular-nums">
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
                          <tr
                            key={issue.id}
                            className="border-t border-border align-top"
                          >
                            <td className="min-w-64 px-3 py-3">
                              <div className="flex items-center gap-2">
                                <StatusBadge tone={issueTone(issue)}>
                                  {issue.kind.replaceAll("_", " ")}
                                </StatusBadge>
                                <span className="font-medium">
                                  {issue.label}
                                </span>
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
                                {issue.tenant_name
                                  ? `/ ${issue.tenant_name}`
                                  : ""}
                              </div>
                              {issue.property_id ? (
                                <Link
                                  href={`/properties?entity_id=${selectedEntityId}&property_id=${issue.property_id}`}
                                  className="mt-2 inline-flex min-h-11 items-center rounded-lg px-3 font-medium text-primary transition hover:bg-primary/5 hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2"
                                >
                                  Open property
                                </Link>
                              ) : null}
                            </td>
                            <td className="px-3 py-3 text-xs">
                              <div>
                                Account: {issue.current_account_code ?? "-"}
                              </div>
                              <div>Tax: {issue.current_tax_type ?? "-"}</div>
                            </td>
                            <td className="px-3 py-3 text-xs">
                              <div>
                                Account: {issue.suggested_account_code ?? "-"}
                              </div>
                              <div>Tax: {issue.suggested_tax_type ?? "-"}</div>
                            </td>
                            <td className="px-3 py-3">
                              <SecondaryButton
                                type="button"
                                className="min-h-11 rounded-lg px-3"
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
                      {!xeroStatusQuery.isLoading &&
                      mappingIssues.length === 0 ? (
                        <tr>
                          <td className="px-3 py-10" colSpan={5}>
                            <EmptyState
                              icon={<CheckCircle2 size={18} />}
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
            </div>
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
