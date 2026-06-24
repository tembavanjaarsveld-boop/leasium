"use client";

import { Copy, Download, PlugZap } from "lucide-react";
import { useState } from "react";

import {
  SecondaryButton,
  SectionPanel,
  StatusBadge,
  type StatusTone,
} from "@/components/ui";
import {
  type ApiHealthRecord,
  type IntegrationStatusRecord,
  type ProviderStatusRecord,
} from "@/lib/api";
import { saveBlob } from "@/lib/download";

// Relocated from client Settings to the platform-admin /admin surface
// (docs/platform-admin-tier-ia.md). Read-only provider status + DocuSign
// setup packet over the existing /system/integration-status payload. No
// secrets are returned; copying/downloading the packet does not call any
// provider (CLAUDE.md §2.1).

const DOCUSIGN_SETUP_PACKET_GUARDRAIL =
  "Review-only export: copying or downloading this packet does not call DocuSign, send envelopes, accept Connect events, download signed PDFs, activate leases, or mutate provider history.";

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
    "- Keep signer, envelope, and custom-field review in Relby before activating leases.",
    "",
    "Guardrails:",
    `- ${DOCUSIGN_SETUP_PACKET_GUARDRAIL}`,
  ].join("\n");
}

export function IntegrationsHealthCard({
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
