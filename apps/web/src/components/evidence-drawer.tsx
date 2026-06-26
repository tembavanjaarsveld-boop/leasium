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

import { useUnmountDelay } from "@/lib/use-unmount-delay";
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
  truncate = true,
}: {
  href?: string;
  children: ReactNode;
  className?: string;
  truncate?: boolean;
}) {
  if (!href) {
    return (
      <span className={cn(className, truncate ? undefined : "break-words")}>
        {children}
      </span>
    );
  }
  return (
    <a
      href={href}
      className={cn(
        "inline-flex min-w-0 items-center gap-1 font-medium text-primary hover:text-primary-hover",
        className,
      )}
    >
      <span className={cn("min-w-0", truncate ? "truncate" : "break-words")}>
        {children}
      </span>
      <ExternalLink size={13} className="shrink-0" />
    </a>
  );
}

function CountPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex min-h-6 items-center rounded-full border border-border bg-white px-2 text-leasium-micro font-semibold text-muted-foreground">
      {children}
    </span>
  );
}

function EvidenceSummaryItem({
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
    <div className="grid min-w-0 grid-cols-[28px_minmax(0,1fr)] gap-2">
      <div className="flex size-7 items-center justify-center rounded-md bg-white text-primary shadow-leasiumXs">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-leasium-micro font-semibold uppercase text-muted-foreground">
          {label}
        </div>
        <DetailLink
          href={href}
          className="mt-0.5 max-w-full text-sm"
          truncate={false}
        >
          {value}
        </DetailLink>
        {detail ? (
          <div className="mt-0.5 break-words text-xs leading-5 text-muted-foreground">
            {detail}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SectionHeading({
  icon,
  title,
  count,
}: {
  icon: ReactNode;
  title: string;
  count?: string;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
          {icon}
        </span>
        <h3 className="min-w-0 text-sm font-semibold text-foreground">
          {title}
        </h3>
      </div>
      {count ? <CountPill>{count}</CountPill> : null}
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
    <div
      className="grid gap-3 rounded-md border border-border bg-white p-3 shadow-leasiumXs"
      data-testid="evidence-change-row"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-sm font-semibold text-foreground">
          {change.label ?? fieldLabel(change.field)}
        </div>
        {change.confidence !== undefined ? (
          <Pill tone={confidenceTone(change.confidence)}>
            <ShieldCheck size={13} />
            {confidenceLabel(change.confidence)}
          </Pill>
        ) : null}
      </div>
      <div className="grid gap-2 text-sm sm:grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)] sm:items-stretch">
        <div className="min-w-0 rounded-md border border-border bg-muted/40 px-3 py-2 text-muted-foreground">
          <div className="text-leasium-micro font-semibold uppercase">
            Before
          </div>
          <div className="mt-1 break-words leading-5">
            {formatEvidenceValue(change.before)}
          </div>
        </div>
        <div className="hidden items-center justify-center sm:flex">
          <span className="flex size-8 items-center justify-center rounded-full border border-border bg-white text-muted-foreground">
            <ArrowRight aria-hidden="true" size={15} />
          </span>
        </div>
        <div className="min-w-0 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-primary-hover">
          <div className="text-leasium-micro font-semibold uppercase">
            After
          </div>
          <div className="mt-1 break-words font-semibold leading-5">
            {formatEvidenceValue(change.after)}
          </div>
        </div>
      </div>
      {locationLabel ? (
        <div className="flex min-w-0 items-start gap-2 rounded-md bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">
          <MapPin size={13} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <DetailLink href={locationHref} className="max-w-full text-xs">
              {locationLabel}
            </DetailLink>
            {locationDetail ? (
              <span className="break-words"> - {locationDetail}</span>
            ) : null}
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
    <div
      className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 py-3"
      data-testid="evidence-audit-row"
    >
      <span className="flex size-7 items-center justify-center rounded-full border border-border bg-white">
        <CheckCircle2
          size={15}
          className={cn(toneClasses[row.tone ?? "neutral"].split(" ")[1])}
        />
      </span>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground">{row.label}</div>
        {row.description ? (
          <div className="mt-0.5 break-words text-sm leading-5 text-muted-foreground">
            {row.description}
          </div>
        ) : null}
        {meta ? (
          <div className="mt-1 text-xs leading-5 text-muted-foreground">
            {meta}
          </div>
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
        "overflow-hidden rounded-2xl border border-border bg-white shadow-leasiumCard",
        className,
      )}
      data-testid="evidence-source-trail"
      {...props}
    >
      {showHeader ? (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-muted/20 px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
                <FileText size={17} />
              </span>
              <h2 className="text-lg font-semibold leading-7 text-foreground">
                {title}
              </h2>
            </div>
            {description ? (
              <p className="mt-2 max-w-3xl text-sm leading-5 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {changes.length ? (
              <CountPill>
                {changes.length} change{changes.length === 1 ? "" : "s"}
              </CountPill>
            ) : null}
            {history.length ? (
              <CountPill>
                {history.length} audit row{history.length === 1 ? "" : "s"}
              </CountPill>
            ) : null}
            {actions}
          </div>
        </div>
      ) : null}

      {hasEvidence ? (
        <div className="grid gap-5 p-4 sm:p-5">
          {hasSummary ? (
            <div
              className="grid gap-3 rounded-md border border-border bg-muted/25 p-3 sm:grid-cols-2"
              data-testid="evidence-source-provenance"
            >
              {documentLabel ? (
                <EvidenceSummaryItem
                  icon={<FileText size={16} />}
                  label="Source document"
                  value={documentLabel}
                  detail={documentDetail}
                  href={documentHref}
                />
              ) : null}
              {locationLabel ? (
                <EvidenceSummaryItem
                  icon={<MapPin size={16} />}
                  label="Source location"
                  value={locationLabel}
                  detail={locationDetail}
                  href={locationHref}
                />
              ) : null}
              {confidence !== undefined ? (
                <EvidenceSummaryItem
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
                <EvidenceSummaryItem
                  icon={<Clock3 size={16} />}
                  label="Applied"
                  value={appliedAtLabel ?? "Pending"}
                  detail={appliedBy ? `By ${appliedBy}` : undefined}
                />
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-3">
            <SectionHeading
              icon={<FileText size={15} />}
              title="Field changes"
              count={
                changes.length
                  ? `${changes.length} change${changes.length === 1 ? "" : "s"}`
                  : undefined
              }
            />
            {changes.length ? (
              <div className="grid gap-3">
                {changes.map((change, index) => (
                  <ChangeRow
                    key={change.id ?? `${change.field}-${index}`}
                    change={change}
                  />
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
                No before/after changes recorded.
              </p>
            )}
          </div>

          <div className="grid gap-3">
            <SectionHeading
              icon={<History size={15} />}
              title="Audit history"
              count={
                history.length
                  ? `${history.length} row${history.length === 1 ? "" : "s"}`
                  : undefined
              }
            />
            {history.length ? (
              <div className="divide-y divide-border rounded-md border border-border bg-muted/20 px-3">
                {history.map((row, index) => (
                  <HistoryRow
                    key={row.id ?? `${row.label}-${index}`}
                    row={row}
                    locale={locale}
                  />
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
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
  const { shouldRender, isClosing } = useUnmountDelay(open, 300);

  if (!shouldRender) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label={closeLabel}
        className={cn(
          "absolute inset-0 cursor-default bg-leasium-navy-900/35",
          isClosing
            ? "animate-leasium-backdrop-out"
            : "animate-leasium-backdrop-in",
        )}
        onClick={() => onOpenChange(false)}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-drawer-title"
        className={cn(
          "absolute right-0 top-0 flex h-full w-full max-w-[440px] flex-col bg-white shadow-leasiumLg",
          isClosing
            ? "animate-leasium-drawer-out-right"
            : "animate-leasium-drawer-in-right",
        )}
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
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-white text-muted-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted hover:text-foreground"
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
