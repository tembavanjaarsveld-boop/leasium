import { ClipboardList, Download, Link2 } from "lucide-react";
import Link from "next/link";

import { SecondaryButton, StatusBadge, type StatusTone } from "@/components/ui";

export type ArrearsReviewPacketPanelEvidenceRow = {
  label: string;
  statusLabel: string;
  detail: string;
  tone: StatusTone;
};

export type ArrearsReviewPacketPanelPacket = {
  nextAction: string;
  nextActionDetail: string;
  nextActionTone: StatusTone;
  evidenceRows: ArrearsReviewPacketPanelEvidenceRow[];
};

export type ArrearsReviewPacketPanelProps = {
  packet: ArrearsReviewPacketPanelPacket;
  receipt: string | null;
  onCopy: () => void | Promise<void>;
  onDownload: () => void;
  tenantHref: string;
  queueHref: string;
  guardrail: string;
  testId: string;
};

export function ArrearsReviewPacketPanel({
  packet,
  receipt,
  onCopy,
  onDownload,
  tenantHref,
  queueHref,
  guardrail,
  testId,
}: ArrearsReviewPacketPanelProps) {
  return (
    <div
      data-testid={testId}
      className="grid gap-3 rounded-md border border-border bg-muted/30 px-3 py-3 text-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="font-semibold text-foreground">Review packet</div>
          <div className="text-muted-foreground">
            {packet.nextActionDetail}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={packet.nextActionTone}>
            {packet.nextAction}
          </StatusBadge>
          <SecondaryButton
            type="button"
            className="min-h-11 rounded-lg px-3 text-xs"
            onClick={onCopy}
          >
            <ClipboardList size={14} />
            Copy packet
          </SecondaryButton>
          <SecondaryButton
            type="button"
            className="min-h-11 rounded-lg px-3 text-xs"
            onClick={onDownload}
          >
            <Download size={14} />
            Download packet CSV
          </SecondaryButton>
        </div>
      </div>
      {receipt ? (
        <p className="text-xs font-medium text-success">{receipt}</p>
      ) : null}
      <div className="grid gap-2 md:grid-cols-3">
        {packet.evidenceRows.map((row) => (
          <div
            key={row.label}
            className="grid gap-1 rounded-md border border-border bg-white px-2 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-foreground">
                {row.label}
              </span>
              <StatusBadge tone={row.tone}>{row.statusLabel}</StatusBadge>
            </div>
            <div className="text-xs leading-5 text-muted-foreground">
              {row.detail}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          href={tenantHref}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-white px-3 text-xs font-semibold text-slate shadow-leasiumXs hover:bg-muted"
        >
          <Link2 size={13} />
          Open tenant
        </Link>
        <Link
          href={queueHref}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-white px-3 text-xs font-semibold text-slate shadow-leasiumXs hover:bg-muted"
        >
          <Link2 size={13} />
          Open queue
        </Link>
      </div>
      <p className="rounded-md bg-white px-2 py-2 text-xs text-muted-foreground">
        {guardrail}
      </p>
    </div>
  );
}
