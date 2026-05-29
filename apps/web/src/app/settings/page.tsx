"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  Bell,
  BellOff,
  Building2,
  CheckCircle2,
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
  applyXeroContactPreview,
  applyXeroPaymentReconciliation,
  approveXeroInvoicePosting,
  createSecurityMember,
  createXeroInvoiceDrafts,
  getApiHealth,
  getSecurityWorkspace,
  getWorkAssignmentNotificationTemplates,
  getXeroConnectionDiagnostics,
  getXeroExceptionQueue,
  getIntegrationStatus,
  type ApiHealthRecord,
  type IntegrationStatusRecord,
  type ProviderStatusRecord,
  getXeroStatus,
  listBrandedCommunicationTemplates,
  listEntities,
  listProperties,
  previewXeroChartTaxValidation,
  previewXeroContactSync,
  previewXeroInvoicePosting,
  previewXeroPaymentReconciliation,
  resendSecurityMemberInvite,
  startXeroOAuth,
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
  type WorkAssignmentNotificationTemplateCatalogRecord,
  type WorkAssignmentNotificationTemplateKind,
  type WorkAssignmentNotificationTemplateRecord,
} from "@/lib/api";
import { saveBlob } from "@/lib/download";
import {
  ownershipChipClassName,
  propertyOwnershipTagDirectory,
} from "@/lib/property-ownership";

const ENTITY_STORAGE_KEY = "leasium.entity_id";
const APPEARANCE_STORAGE_KEY = "leasium.appearance";
const EMPTY_XERO_ISSUES: XeroMappingIssueRecord[] = [];
const EMPTY_BRANDED_TEMPLATES: BrandedCommunicationTemplateRecord[] = [];

type SettingsTab = "security" | "organisation" | "xero";
type AppearanceMode = "system" | "light" | "dark";
type StatusTone = "neutral" | "success" | "warning" | "danger" | "primary";
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
  | { tone: "danger"; title: "Xero connection needs attention"; detail: string };

const settingsTabs: Array<{
  id: SettingsTab;
  label: string;
  icon: ReactNode;
}> = [
  { id: "security", label: "Security", icon: <ShieldCheck size={15} /> },
  { id: "organisation", label: "Organisation", icon: <Building2 size={15} /> },
  { id: "xero", label: "Xero", icon: <PlugZap size={15} /> },
];

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

function applyAppearancePreference(mode: AppearanceMode) {
  if (typeof window === "undefined") return;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme =
    mode === "dark" || (mode === "system" && prefersDark) ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.appearance = mode;
  document.documentElement.style.colorScheme = theme;
}

function SettingsAppearancePanel() {
  const [mode, setMode] = useState<AppearanceMode>("system");
  const [effectiveTheme, setEffectiveTheme] = useState<"light" | "dark">(
    "light",
  );

  useEffect(() => {
    const stored = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    const initial: AppearanceMode =
      stored === "light" || stored === "dark" || stored === "system"
        ? stored
        : "system";
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    function sync(nextMode: AppearanceMode) {
      setMode(nextMode);
      setEffectiveTheme(
        nextMode === "dark" || (nextMode === "system" && media.matches)
          ? "dark"
          : "light",
      );
      applyAppearancePreference(nextMode);
    }

    function syncSystemPreference() {
      const current = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
      sync(
        current === "light" || current === "dark" || current === "system"
          ? current
          : "system",
      );
    }

    sync(initial);
    media.addEventListener("change", syncSystemPreference);
    window.addEventListener("storage", syncSystemPreference);
    window.addEventListener("leasium:appearance-change", syncSystemPreference);
    return () => {
      media.removeEventListener("change", syncSystemPreference);
      window.removeEventListener("storage", syncSystemPreference);
      window.removeEventListener(
        "leasium:appearance-change",
        syncSystemPreference,
      );
    };
  }, []);

  const options: Array<{
    mode: AppearanceMode;
    label: string;
    detail: string;
    icon: ReactNode;
  }> = [
    {
      mode: "system",
      label: "System",
      detail: "Follow this device.",
      icon: <Monitor size={16} />,
    },
    {
      mode: "light",
      label: "Light",
      detail: "Use the light workspace.",
      icon: <Sun size={16} />,
    },
    {
      mode: "dark",
      label: "Dark",
      detail: "Use the dark workspace.",
      icon: <Moon size={16} />,
    },
  ];

  function chooseAppearance(nextMode: AppearanceMode) {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, nextMode);
    applyAppearancePreference(nextMode);
    window.dispatchEvent(new Event("leasium:appearance-change"));
  }

  return (
    <SectionPanel
      title="Appearance"
      description="Choose how Leasium looks on this browser."
      icon={<Monitor size={17} className="text-primary" />}
      actions={
        <StatusBadge tone={effectiveTheme === "dark" ? "primary" : "neutral"}>
          {effectiveTheme === "dark" ? "Dark active" : "Light active"}
        </StatusBadge>
      }
    >
      <div className="grid gap-3 p-4 md:grid-cols-3">
        {options.map((option) => {
          const isActive = mode === option.mode;
          return (
            <button
              key={option.mode}
              type="button"
              aria-pressed={isActive}
              onClick={() => chooseAppearance(option.mode)}
              className={`grid gap-2 rounded-md border p-3 text-left transition hover:bg-muted/60 ${
                isActive
                  ? "border-primary bg-primary/5"
                  : "border-border bg-white"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary-soft text-primary">
                  {option.icon}
                </span>
                <StatusBadge tone={isActive ? "primary" : "neutral"}>
                  {isActive ? "Selected" : option.label}
                </StatusBadge>
              </span>
              <span className="font-semibold text-foreground">
                {option.label}
              </span>
              <span className="text-sm text-muted-foreground">
                {option.detail}
              </span>
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
          : connectionReasons[label] ?? providerBlocked;
    } else if (label === "Draft creation") {
      detail = "Approve invoice drafts for Xero before creating provider drafts.";
    } else if (label === "Payments") {
      detail = "Create or link a Xero draft before reviewing provider payments.";
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
  "Review-only export: downloading this file does not wire stored templates into send paths, add edit controls, send notifications, run digests, send invoices, send tenant onboarding messages, send contractor updates, mutate preferences, or write provider history.";

function csvCell(value: string | number | null | undefined) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

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
            issue.xero_invoice_id ? `Xero invoice: ${issue.xero_invoice_id}` : null,
            issue.provider_status ? `Provider status: ${issue.provider_status}` : null,
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
    <div className="grid gap-1 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-foreground">Last digest</span>
        <StatusBadge tone={receipt.message_sent ? "success" : "neutral"}>
          {receipt.message_sent ? "Email queued" : "No messages sent"}
        </StatusBadge>
      </div>
      <div className="text-muted-foreground">
        {formatDateTime(receipt.generated_at)}
      </div>
      {receipt.delivery_detail ? (
        <div className="text-muted-foreground">{receipt.delivery_detail}</div>
      ) : null}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
        <span>
          {receipt.item_count} {receipt.item_count === 1 ? "item" : "items"}
        </span>
        <span>{receipt.follow_up_due_count} follow-up</span>
        <span>{digestCadenceLabel(receipt.cadence)}</span>
      </div>
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
          {apiHealth?.release ? (
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="success">
                {apiHealth.release.source === "render"
                  ? "Render commit"
                  : `${apiHealth.release.source} commit`}
              </StatusBadge>
              <code
                className="rounded-sm border border-border bg-white px-2 py-1 font-mono text-xs text-muted-foreground"
                title={apiHealth.release.commit}
              >
                {apiHealth.release.commit.slice(0, 7)}
              </code>
            </div>
          ) : null}
        </div>
        {isLoading && !integrations ? (
          <div className="rounded-md border border-border bg-muted/25 p-3 text-sm text-muted-foreground">
            Loading integration status.
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
}: {
  label: string;
  value: string | number;
  detail: string;
  tone?: StatusTone;
  icon?: ReactNode;
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
          <div className="text-2xl font-semibold">{value}</div>
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
    if (params.get("tab") === "xero" || hasXeroCallback) {
      setActiveTab("xero");
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
        detail: `Run contact preview next${
          tenantId ? ` for tenant ${tenantId}` : ""
        }. No Xero writes, invoice posting, emails, or payment reconciliation occurred from this callback.`,
      });
    } else if (params.has("xero_error")) {
      setXeroCallbackFeedback({
        tone: "danger",
        title: "Xero connection needs attention",
        detail: `${cleanXeroCallbackError(
          params.get("xero_error"),
        )}. No Xero writes, invoice posting, emails, or payment reconciliation occurred.`,
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
    enabled: Boolean(selectedEntityId) && activeTab === "xero",
  });

  const xeroDiagnosticsQuery = useQuery({
    queryKey: ["xero-connection-diagnostics", selectedEntityId],
    queryFn: () => getXeroConnectionDiagnostics(selectedEntityId),
    enabled: Boolean(selectedEntityId) && activeTab === "xero",
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
    enabled: Boolean(selectedEntityId) && activeTab === "xero",
  });

  const securityQuery = useQuery({
    queryKey: ["security-workspace"],
    queryFn: getSecurityWorkspace,
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

  const downloadCommunicationTemplateOverridesCsv = () => {
    saveBlob(
      new Blob(
        [
          communicationTemplateOverrideCsv({
            runtimeTemplates: communicationTemplates,
            brandedTemplates,
          }),
        ],
        { type: "text/csv;charset=utf-8" },
      ),
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
  const xeroDiagnosticsReady = Boolean(xeroDiagnostics);
  const xeroCanStartOauth = xeroDiagnostics?.can_start_oauth ?? false;
  const xeroCanPreviewContacts =
    xeroDiagnostics?.can_preview_contacts ?? false;
  const xeroCanValidateChartTax =
    xeroDiagnostics?.can_validate_chart_tax ?? false;
  const xeroCanPreviewInvoicePosting =
    xeroDiagnostics?.can_preview_invoice_posting ?? false;
  const xeroCanPreviewPayments =
    xeroDiagnostics?.can_preview_payment_reconciliation ?? false;
  const xeroCanCreateDrafts = xeroDiagnostics?.can_create_xero_drafts ?? false;
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
                activeTab !== "xero" ||
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
              className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition duration-200 ease-leasium ${
                activeTab === tab.id
                  ? "bg-primary text-primary-foreground shadow-leasiumXs"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
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
        {activeTab === "xero" && xeroStatusQuery.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {xeroStatusQuery.error instanceof Error
              ? xeroStatusQuery.error.message
              : "Could not load Xero readiness."}
          </div>
        ) : null}
        {activeTab === "xero" && xeroDiagnosticsQuery.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            <div>
              {xeroDiagnosticsQuery.error instanceof Error
                ? xeroDiagnosticsQuery.error.message
                : "Could not load Xero connection diagnostics."}
            </div>
            <div className="mt-1">
              Provider actions stay disabled until Xero diagnostics reload.
            </div>
          </div>
        ) : null}
        {activeTab === "xero" && xeroExceptionQueueQuery.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {xeroExceptionQueueQuery.error instanceof Error
              ? xeroExceptionQueueQuery.error.message
              : "Could not load Xero sync exceptions."}
          </div>
        ) : null}
        {activeTab === "xero" && connectionMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {connectionMutation.error instanceof Error
              ? connectionMutation.error.message
              : "Could not update Xero connection status."}
          </div>
        ) : null}
        {activeTab === "xero" && xeroOAuthMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {xeroOAuthMutation.error instanceof Error
              ? xeroOAuthMutation.error.message
              : "Could not start the Xero connection."}
          </div>
        ) : null}
        {activeTab === "xero" && xeroContactSyncMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {xeroContactSyncMutation.error instanceof Error
              ? xeroContactSyncMutation.error.message
              : "Could not preview Xero contacts."}
          </div>
        ) : null}
        {activeTab === "xero" && xeroContactApplyMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {xeroContactApplyMutation.error instanceof Error
              ? xeroContactApplyMutation.error.message
              : "Could not apply the selected Xero contact mappings."}
          </div>
        ) : null}
        {activeTab === "xero" && xeroChartTaxMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {xeroChartTaxMutation.error instanceof Error
              ? xeroChartTaxMutation.error.message
              : "Could not preview Xero chart and tax validation."}
          </div>
        ) : null}
        {activeTab === "xero" && xeroInvoicePostingMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {xeroInvoicePostingMutation.error instanceof Error
              ? xeroInvoicePostingMutation.error.message
              : "Could not preview Xero invoice posting."}
          </div>
        ) : null}
        {activeTab === "xero" && xeroInvoiceApprovalMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {xeroInvoiceApprovalMutation.error instanceof Error
              ? xeroInvoiceApprovalMutation.error.message
              : "Could not record Xero posting approval."}
          </div>
        ) : null}
        {activeTab === "xero" && xeroDraftCreateMutation.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {xeroDraftCreateMutation.error instanceof Error
              ? xeroDraftCreateMutation.error.message
              : "Could not create Xero draft invoices."}
          </div>
        ) : null}
        {activeTab === "xero" && mappingMutation.error ? (
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
                value={securityQuery.data?.auth.auth_mode ?? "..."}
                detail={
                  securityQuery.data?.auth.login_boundary ??
                  "Loading the current login boundary."
                }
                tone={
                  securityQuery.data?.auth.operator_login_enforced
                    ? "success"
                    : "warning"
                }
                icon={<ShieldCheck size={18} />}
              />
              <MetricCard
                label="Operator login"
                value={
                  securityQuery.data?.auth.operator_login_enforced
                    ? "Enforced"
                    : "Pre-prod"
                }
                detail={
                  securityQuery.data?.auth.operator_login_enforced
                    ? "Production requests resolve through the configured provider."
                    : "Private beta access is still protected by the temporary gate."
                }
                tone={
                  securityQuery.data?.auth.operator_login_enforced
                    ? "success"
                    : "warning"
                }
                icon={<KeyRound size={18} />}
              />
              <MetricCard
                label="Clerk config"
                value={
                  securityQuery.data?.auth.clerk_secret_configured &&
                  securityQuery.data?.auth.clerk_jwks_configured
                    ? "Ready"
                    : "Pending"
                }
                detail="Secret and JWKS settings are tracked without exposing values."
                tone={
                  securityQuery.data?.auth.clerk_secret_configured &&
                  securityQuery.data?.auth.clerk_jwks_configured
                    ? "success"
                    : "neutral"
                }
                icon={<PlugZap size={18} />}
              />
              <MetricCard
                label="Operators"
                value={securityQuery.data?.members.length ?? "..."}
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
                securityQuery.data?.can_manage_security ? (
                  <StatusBadge tone="success">Owner/admin controls</StatusBadge>
                ) : (
                  <StatusBadge tone="warning">Read-only</StatusBadge>
                )
              }
            >
              <div className="grid gap-4 p-4 lg:grid-cols-[1fr_360px]">
                <div className="grid gap-3">
                  <div className="rounded-md border border-border bg-muted/25 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge
                        tone={
                          securityQuery.data?.auth.dev_auth_active
                            ? "warning"
                            : "success"
                        }
                      >
                        {securityQuery.data?.auth.dev_auth_active
                          ? "Dev auth active"
                          : "Provider login active"}
                      </StatusBadge>
                      <span className="font-medium">
                        {securityQuery.data?.current_user.display_name ??
                          "Loading operator"}
                      </span>
                    </div>
                    <p className="mt-2 text-muted-foreground">
                      {securityQuery.data?.current_user.email ??
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
              <div className="overflow-x-auto">
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
                            <div className="mt-1 text-xs text-muted-foreground">
                              {member.email}
                            </div>
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
                              <SecondaryButton
                                type="button"
                                className={
                                  member.is_active ? "text-danger" : ""
                                }
                                disabled={
                                  isSelf ||
                                  isUpdating ||
                                  !securityQuery.data?.can_manage_security
                                }
                                onClick={() =>
                                  memberMutation.mutate({
                                    memberId: member.id,
                                    payload: { is_active: !member.is_active },
                                  })
                                }
                              >
                                {member.is_active ? (
                                  <Ban size={14} />
                                ) : (
                                  <CheckCircle2 size={14} />
                                )}
                                {member.is_active ? "Deactivate" : "Activate"}
                              </SecondaryButton>
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
              description="Choose assignment email and digest cadence for each operator without changing their access."
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
                    {workNotificationTemplateCount || "Loading…"} templates
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
                      className="grid gap-4 px-4 py-4 xl:grid-cols-[minmax(0,1fr)_220px_minmax(320px,420px)] xl:items-start"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-medium">
                            {member.display_name}
                          </div>
                          <StatusBadge
                            tone={workEmailEnabled ? "success" : "neutral"}
                          >
                            {workEmailEnabled
                              ? "Work email on"
                              : "Work email off"}
                          </StatusBadge>
                          <StatusBadge
                            tone={
                              digestCadence === "off" ? "neutral" : "primary"
                            }
                          >
                            {digestCadenceLabel(digestCadence)}
                          </StatusBadge>
                          <StatusBadge
                            tone={
                              workSmsEnabled && smsPhone ? "primary" : "neutral"
                            }
                          >
                            {workSmsEnabled && smsPhone
                              ? "SMS ready"
                              : "SMS not ready"}
                          </StatusBadge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {member.email}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <StatusBadge tone="neutral">
                            {currentRole
                              ? `${roleLabel(
                                  currentRole.role,
                                )} on selected entity`
                              : "No selected entity access"}
                          </StatusBadge>
                        </div>
                      </div>

                      <div className="grid gap-3">
                        <label className="flex min-h-11 items-start gap-3 text-sm">
                          <input
                            aria-label={`${member.display_name} assignment email notifications`}
                            checked={workEmailEnabled}
                            className="mt-1 h-4 w-4 accent-primary"
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
                          <span className="min-w-0">
                            <span className="flex items-center gap-1 font-medium">
                              {workEmailEnabled ? (
                                <Bell size={14} />
                              ) : (
                                <BellOff size={14} />
                              )}
                              Assignment email
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                              Immediate notice when assigned work is ready.
                            </span>
                          </span>
                        </label>
                        <div className="grid gap-2 rounded-xl border border-border bg-muted/20 p-3">
                          <label className="flex items-start gap-3 text-sm">
                            <input
                              aria-label={`${member.display_name} assignment SMS notifications`}
                              checked={workSmsEnabled}
                              className="mt-1 h-4 w-4 accent-primary"
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
                            <span className="min-w-0">
                              <span className="flex items-center gap-1 font-medium">
                                <Smartphone size={14} />
                                Assignment SMS
                              </span>
                              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                                Stores a reviewed operator phone for future SMS
                                recovery.
                              </span>
                            </span>
                          </label>
                          <Field label="SMS phone">
                            <Input
                              aria-label={`${member.display_name} assignment SMS phone`}
                              placeholder="+61400111222"
                              value={smsPhoneDraft}
                              disabled={!canManageSecurity}
                              onChange={(event) =>
                                setSmsPhoneDrafts((drafts) => ({
                                  ...drafts,
                                  [member.id]: event.target.value,
                                }))
                              }
                            />
                          </Field>
                          <SecondaryButton
                            type="button"
                            className="h-9 justify-self-start px-2.5"
                            disabled={!canManageSecurity || !smsPhoneChanged}
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
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <CheckCircle2 size={14} />
                            )}
                            Save SMS
                          </SecondaryButton>
                        </div>
                      </div>

                      <div className="grid gap-2">
                        <Field label="Digest cadence">
                          <Select
                            aria-label={`${member.display_name} work digest`}
                            value={digestCadence}
                            disabled={!canManageSecurity}
                            onChange={(event) =>
                              memberMutation.mutate({
                                memberId: member.id,
                                payload: {
                                  notification_preferences:
                                    nextNotificationPreferences(member, {
                                      work_assignment_digest_cadence: event
                                        .target
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
                        </Field>
                        <DigestReceiptSummary member={member} />
                      </div>

                      <div className="grid gap-3 rounded-xl border border-border bg-muted/20 p-3 xl:col-start-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-medium">
                            Template defaults
                          </div>
                          <StatusBadge
                            tone={templatesChanged ? "warning" : "neutral"}
                          >
                            {templatesChanged ? "Unsaved" : "Current"}
                          </StatusBadge>
                        </div>
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
                                <option key={template.key} value={template.key}>
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
                                <option key={template.key} value={template.key}>
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
                          className="justify-self-start"
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
                    {securityQuery.data?.organisation.name ?? "Loading…"}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-muted/25 p-3">
                  <div className="text-xs uppercase text-muted-foreground">
                    Timezone
                  </div>
                  <div className="mt-1 font-semibold">
                    {securityQuery.data?.organisation.timezone ?? "Loading…"}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-muted/25 p-3">
                  <div className="text-xs uppercase text-muted-foreground">
                    Entities
                  </div>
                  <div className="mt-1 font-semibold">
                    {entitiesQuery.data?.length ?? 0}
                  </div>
                </div>
              </div>
            </SectionPanel>

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
                      review. Editing and send-time wiring remain paused for
                      internal-first use.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <SecondaryButton
                      type="button"
                      onClick={downloadCommunicationTemplateOverridesCsv}
                      className="min-h-10 rounded-lg px-3"
                    >
                      <Download size={14} />
                      Download overrides CSV
                    </SecondaryButton>
                    <StatusBadge
                      tone={brandedTemplates.length ? "primary" : "neutral"}
                    >
                      {brandedTemplates.length} stored
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
                    Loading stored template overrides.
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
                    {ownershipTags.length}{" "}
                    {ownershipTags.length === 1 ? "tag" : "tags"}
                  </StatusBadge>
                ) : null
              }
            >
              <div className="divide-y divide-border">
                {propertiesQuery.isLoading ? (
                  <div className="px-4 py-4 text-sm text-muted-foreground">
                    Loading ownership tags...
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
                            className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary-hover md:mt-2"
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
                              className="min-w-0 text-sm font-medium text-primary hover:text-primary-hover"
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

        {activeTab === "xero" && !selectedEntityId ? (
          <SectionPanel>
            <EmptyState
              icon={<Building2 size={18} />}
              title="No entity selected"
              description="Choose an entity from the header to load Xero status, mappings, invoice sync readiness, and payment reconciliation."
            />
          </SectionPanel>
        ) : null}

        {activeTab === "xero" &&
        selectedEntityId &&
        status &&
        !xeroDiagnosticsReady ? (
          <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
            Xero provider actions stay disabled until local connection
            diagnostics finish loading.
          </div>
        ) : null}

        {activeTab === "xero" && selectedEntityId && status ? (
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
                  </div>
                </div>
              </div>
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
                          className="mt-3 inline-flex min-h-10 items-center justify-center rounded-xl border border-border bg-white px-3 text-sm font-semibold text-foreground shadow-leasiumXs transition hover:bg-muted"
                        >
                          {accountingStep.actionLabel}
                        </Link>
                      ) : accountingStep.action === "payments" ? (
                        <SecondaryButton
                          type="button"
                          className="mt-3 min-h-10 px-3"
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
                          className="mt-3 min-h-10 px-3"
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
                      className="min-h-9 rounded-lg px-3 text-xs"
                      disabled={!exceptionQueue}
                      onClick={copyXeroExceptionPacket}
                    >
                      <Copy size={14} />
                      Copy exception packet
                    </SecondaryButton>
                    <SecondaryButton
                      type="button"
                      className="min-h-9 rounded-lg px-3 text-xs"
                      disabled={!exceptionQueue}
                      onClick={downloadXeroExceptionCsv}
                    >
                      <Download size={14} />
                      Download exceptions CSV
                    </SecondaryButton>
                    <StatusBadge
                      tone={
                        exceptionQueue?.summary.blockers
                          ? "danger"
                          : exceptionItems.length
                            ? "warning"
                            : "success"
                      }
                    >
                      {exceptionQueue?.summary.total ?? 0} open
                    </StatusBadge>
                    {xeroExceptionQueueQuery.isFetching ? (
                      <StatusBadge tone="neutral">Refreshing</StatusBadge>
                    ) : null}
                  </div>
                }
              >
                {xeroExceptionQueueQuery.isLoading && !exceptionQueue ? (
                  <div className="p-4 text-sm text-muted-foreground">
                    Loading Xero sync exceptions.
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
                        return (
                          <div
                            key={issue.id}
                            className="grid gap-3 px-4 py-3 text-sm lg:grid-cols-[170px_1fr_300px]"
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
                              <div className="font-medium">{issue.label}</div>
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
                                  className="min-h-8 justify-self-start rounded-lg px-3 text-xs"
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
                              {issue.charge_rule_id ? (
                                <div className="grid gap-1 rounded-md border border-border bg-muted/20 p-2">
                                  <div>
                                    Current: account{" "}
                                    {issue.current_account_code ?? "-"} / tax{" "}
                                    {issue.current_tax_type ?? "-"}
                                  </div>
                                  <div>
                                    Suggested: account{" "}
                                    {issue.suggested_account_code ?? "-"} / tax{" "}
                                    {issue.suggested_tax_type ?? "-"}
                                  </div>
                                </div>
                              ) : null}
                              {issue.invoice_number || issue.invoice_title ? (
                                <div>
                                  Invoice:{" "}
                                  {issue.invoice_number ?? issue.invoice_title}
                                </div>
                              ) : null}
                              {issue.tenant_name || issue.property_name ? (
                                <div>
                                  Record: {issue.property_name ?? "Property"}
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
                              {issue.received_at ? (
                                <div>
                                  Receipt: {formatDateTime(issue.received_at)}
                                </div>
                              ) : null}
                              {issue.retry_count ? (
                                <div>Attempt #{issue.retry_count}</div>
                              ) : null}
                              {issue.property_id ? (
                                <Link
                                  href={`/properties?entity_id=${selectedEntityId}&property_id=${issue.property_id}`}
                                  className="font-medium text-primary hover:text-primary-hover"
                                >
                                  Open property
                                </Link>
                              ) : null}
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
                  </>
                )}
              </SectionPanel>
            </div>

            <div ref={xeroConnectionPanelRef}>
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
                        {!(xeroDiagnostics?.provider_configured ??
                        status.provider.configured) ? (
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
                        className="min-h-9 rounded-lg px-3"
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
                                className="inline-flex w-fit items-center gap-1 font-medium text-primary hover:text-primary-hover"
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
                                className="mt-2 inline-flex items-center gap-1 font-medium text-primary hover:text-primary-hover"
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
                                className="mt-1 inline-flex w-fit items-center gap-1 font-medium text-primary hover:text-primary-hover"
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
                                  className="mt-1 inline-flex font-medium text-primary hover:text-primary-hover"
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
