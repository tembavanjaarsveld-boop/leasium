"use client";

import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  History,
  MapPin,
  ShieldCheck,
  X,
} from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

type EvidenceTone = "neutral" | "success" | "warning" | "danger" | "primary";

export type EvidenceSourceDocument = {
  label: string;
  href?: string;
  detail?: string;
  id?: string;
};

export type EvidenceSourceLocation = {
  label: string;
  href?: string;
  detail?: string;
};

export type EvidenceFieldChange = {
  id?: string;
  field: string;
  label?: string;
  before: unknown;
  after: unknown;
  sourceLocation?: string | EvidenceSourceLocation | null;
  confidence?: number | null;
};

export type EvidenceHistoryRow = {
  id?: string;
  label: string;
  description?: string;
  actor?: string;
  occurredAt?: string | Date | null;
  tone?: EvidenceTone;
};

export type EvidenceSourceTrailProps = HTMLAttributes<HTMLElement> & {
  title?: string;
  description?: string;
  sourceDocument?: string | EvidenceSourceDocument | null;
  sourceLocation?: string | EvidenceSourceLocation | null;
  confidence?: number | null;
  appliedAt?: string | Date | null;
  appliedBy?: string | null;
  changes?: EvidenceFieldChange[];
  history?: EvidenceHistoryRow[];
  actions?: ReactNode;
  emptyMessage?: string;
  locale?: string;
  showHeader?: boolean;
};

export type EvidenceDrawerProps = EvidenceSourceTrailProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  closeLabel?: string;
};

const toneClasses: Record<EvidenceTone, string> = {
  neutral: "bg-muted text-leasium-slate-500",
  success: "bg-success-soft text-success-strong",
  warning: "bg-warning-soft text-warning-strong",
  danger: "bg-danger-soft text-danger-strong",
  primary: "bg-primary-soft text-primary-hover",
};

function normaliseConfidence(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const percent = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function confidenceTone(value: number | null | undefined): EvidenceTone {
  const percent = normaliseConfidence(value);
  if (percent === null) {
    return "neutral";
  }
  if (percent >= 80) {
    return "success";
  }
  if (percent >= 55) {
    return "warning";
  }
  return "danger";
}

function confidenceLabel(value: number | null | undefined) {
  const percent = normaliseConfidence(value);
  return percent === null ? "Confidence pending" : `${percent}% confidence`;
}

function sourceDocumentLabel(
  value: string | EvidenceSourceDocument | null | undefined,
) {
  return typeof value === "string" ? value : value?.label;
}

function sourceLocationLabel(
  value: string | EvidenceSourceLocation | null | undefined,
) {
  return typeof value === "string" ? value : value?.label;
}

function formatDateTime(
  value: string | Date | null | undefined,
  locale: string | undefined,
) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat(locale ?? "en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatEvidenceValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (value instanceof Date) {
    return formatDateTime(value, undefined) ?? "-";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (typeof value === "number") {
    return new Intl.NumberFormat("en-AU").format(value);
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.length ? value.map(formatEvidenceValue).join(", ") : "-";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function fieldLabel(field: string) {
  return field
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function Pill({
  tone = "neutral",
  children,
  className,
}: {
  tone?: EvidenceTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

function DetailLink({
  href,
  children,
  className,
}: {
  href?: string;
  children: ReactNode;
  className?: string;
}) {
  if (!href) {
    return <span className={className}>{children}</span>;
  }
  return (
    <a
      href={href}
      className={cn(
        "inline-flex min-w-0 items-center gap-1 font-medium text-primary hover:text-primary-hover",
        className,
      )}
    >
      <span className="truncate">{children}</span>
      <ExternalLink size={13} className="shrink-0" />
    </a>
  );
}

function EvidenceSummary({
  icon,
  label,
  value,
  detail,
  href,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  href?: string;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[18px_minmax(0,1fr)] gap-2">
      <div className="mt-0.5 text-primary">{icon}</div>
      <div className="min-w-0">
        <div className="text-xs font-medium uppercase text-muted-foreground">
          {label}
        </div>
        <DetailLink href={href} className="mt-0.5 text-sm">
          {value}
        </DetailLink>
        {detail ? (
          <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>
        ) : null}
      </div>
    </div>
  );
}

function ChangeRow({ change }: { change: EvidenceFieldChange }) {
  const locationLabel = sourceLocationLabel(change.sourceLocation);
  const locationHref =
    typeof change.sourceLocation === "string"
      ? undefined
      : change.sourceLocation?.href;
  const locationDetail =
    typeof change.sourceLocation === "string"
      ? undefined
      : change.sourceLocation?.detail;

  return (
    <div className="grid gap-2 py-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-sm font-semibold">
          {change.label ?? fieldLabel(change.field)}
        </div>
        {change.confidence !== undefined ? (
          <Pill tone={confidenceTone(change.confidence)}>
            <ShieldCheck size={13} />
            {confidenceLabel(change.confidence)}
          </Pill>
        ) : null}
      </div>
      <div className="grid gap-2 text-sm sm:grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)] sm:items-start">
        <div className="min-w-0 rounded-md bg-muted px-3 py-2 text-muted-foreground">
          <div className="text-xs font-medium uppercase">Before</div>
          <div className="mt-1 break-words">
            {formatEvidenceValue(change.before)}
          </div>
        </div>
        <ArrowRight
          aria-hidden="true"
          size={16}
          className="hidden justify-self-center text-muted-foreground sm:block"
        />
        <div className="min-w-0 rounded-md bg-primary-soft px-3 py-2 text-primary-hover">
          <div className="text-xs font-medium uppercase">After</div>
          <div className="mt-1 break-words font-medium">
            {formatEvidenceValue(change.after)}
          </div>
        </div>
      </div>
      {locationLabel ? (
        <div className="flex min-w-0 items-start gap-1.5 text-xs text-muted-foreground">
          <MapPin size={13} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <DetailLink href={locationHref} className="text-xs">
              {locationLabel}
            </DetailLink>
            {locationDetail ? <span> - {locationDetail}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HistoryRow({
  row,
  locale,
}: {
  row: EvidenceHistoryRow;
  locale: string | undefined;
}) {
  const occurredAt = formatDateTime(row.occurredAt, locale);
  const meta = [row.actor, occurredAt].filter(Boolean).join(" - ");

  return (
    <div className="grid grid-cols-[18px_minmax(0,1fr)] gap-2 py-2.5">
      <CheckCircle2
        size={16}
        className={cn(
          "mt-0.5",
          toneClasses[row.tone ?? "neutral"].split(" ")[1],
        )}
      />
      <div className="min-w-0">
        <div className="text-sm font-medium">{row.label}</div>
        {row.description ? (
          <div className="mt-0.5 text-sm text-muted-foreground">
            {row.description}
          </div>
        ) : null}
        {meta ? (
          <div className="mt-1 text-xs text-muted-foreground">{meta}</div>
        ) : null}
      </div>
    </div>
  );
}

export function EvidenceSourceTrail({
  title = "Evidence",
  description,
  sourceDocument,
  sourceLocation,
  confidence,
  appliedAt,
  appliedBy,
  changes = [],
  history = [],
  actions,
  emptyMessage = "No evidence has been recorded yet.",
  locale,
  showHeader = true,
  className,
  ...props
}: EvidenceSourceTrailProps) {
  const documentLabel = sourceDocumentLabel(sourceDocument);
  const documentHref =
    typeof sourceDocument === "string" ? undefined : sourceDocument?.href;
  const documentDetail =
    typeof sourceDocument === "string"
      ? undefined
      : (sourceDocument?.detail ?? sourceDocument?.id);
  const locationLabel = sourceLocationLabel(sourceLocation);
  const locationHref =
    typeof sourceLocation === "string" ? undefined : sourceLocation?.href;
  const locationDetail =
    typeof sourceLocation === "string" ? undefined : sourceLocation?.detail;
  const appliedAtLabel = formatDateTime(appliedAt, locale);
  const hasSummary =
    documentLabel ||
    locationLabel ||
    confidence !== undefined ||
    appliedAtLabel ||
    appliedBy;
  const hasEvidence = hasSummary || changes.length > 0 || history.length > 0;

  return (
    <section
      className={cn(
        "overflow-hidden rounded-md border border-border bg-white shadow-leasiumXs",
        className,
      )}
      {...props}
    >
      {showHeader ? (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FileText size={17} className="text-primary" />
              <h2 className="text-base font-semibold">{title}</h2>
            </div>
            {description ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}

      {hasEvidence ? (
        <div className="grid gap-4 p-4">
          {hasSummary ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {documentLabel ? (
                <EvidenceSummary
                  icon={<FileText size={16} />}
                  label="Source document"
                  value={documentLabel}
                  detail={documentDetail}
                  href={documentHref}
                />
              ) : null}
              {locationLabel ? (
                <EvidenceSummary
                  icon={<MapPin size={16} />}
                  label="Source location"
                  value={locationLabel}
                  detail={locationDetail}
                  href={locationHref}
                />
              ) : null}
              {confidence !== undefined ? (
                <EvidenceSummary
                  icon={<ShieldCheck size={16} />}
                  label="Confidence"
                  value={
                    <Pill tone={confidenceTone(confidence)}>
                      {confidenceLabel(confidence)}
                    </Pill>
                  }
                />
              ) : null}
              {appliedAtLabel || appliedBy ? (
                <EvidenceSummary
                  icon={<Clock3 size={16} />}
                  label="Applied"
                  value={appliedAtLabel ?? "Pending"}
                  detail={appliedBy ? `By ${appliedBy}` : undefined}
                />
              ) : null}
            </div>
          ) : null}

          <div>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Field changes</h3>
              {changes.length ? (
                <span className="text-xs font-medium text-muted-foreground">
                  {changes.length} change{changes.length === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
            {changes.length ? (
              <div className="mt-2 divide-y divide-border">
                {changes.map((change, index) => (
                  <ChangeRow
                    key={change.id ?? `${change.field}-${index}`}
                    change={change}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                No before/after changes recorded.
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <History size={15} className="text-primary" />
                <h3 className="text-sm font-semibold">Audit history</h3>
              </div>
              {history.length ? (
                <span className="text-xs font-medium text-muted-foreground">
                  {history.length} row{history.length === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
            {history.length ? (
              <div className="mt-2 divide-y divide-border">
                {history.map((row, index) => (
                  <HistoryRow
                    key={row.id ?? `${row.label}-${index}`}
                    row={row}
                    locale={locale}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                No audit rows recorded.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="p-4 text-sm text-muted-foreground">{emptyMessage}</div>
      )}
    </section>
  );
}

export function EvidenceDrawer({
  open,
  onOpenChange,
  closeLabel = "Close evidence drawer",
  className,
  ...trailProps
}: EvidenceDrawerProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label={closeLabel}
        className="absolute inset-0 cursor-default bg-leasium-navy-900/35 animate-leasium-backdrop-in"
        onClick={() => onOpenChange(false)}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-drawer-title"
        className="absolute right-0 top-0 flex h-full w-full max-w-[440px] flex-col bg-white shadow-leasiumLg animate-leasium-drawer-in-right"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <ShieldCheck size={17} className="text-primary" />
            <h2
              id="evidence-drawer-title"
              className="truncate text-base font-semibold"
            >
              {trailProps.title ?? "Evidence"}
            </h2>
          </div>
          <button
            type="button"
            aria-label={closeLabel}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-white text-muted-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted hover:text-foreground"
            onClick={() => onOpenChange(false)}
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-background p-3">
          <EvidenceSourceTrail
            {...trailProps}
            showHeader={false}
            className={cn("shadow-none", className)}
          />
        </div>
      </aside>
    </div>
  );
}
