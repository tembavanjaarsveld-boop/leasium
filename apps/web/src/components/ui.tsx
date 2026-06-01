import { cn } from "@/lib/utils";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
} from "react";

export function Button({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-transparent bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-primary-hover active:bg-primary-pressed active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100",
        className,
      )}
      {...props}
    />
  );
}

export function SecondaryButton({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted active:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100",
        className,
      )}
      {...props}
    />
  );
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "min-h-11 w-full rounded-xl border border-border bg-white px-3 text-sm outline-none transition-colors duration-200 ease-leasium focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15",
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "min-h-11 w-full rounded-xl border border-border bg-white px-3 text-sm outline-none transition-colors duration-200 ease-leasium focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15",
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium text-foreground">{label}</span>
      {children}
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </label>
  );
}

// Page title — the operator-mode version of the SoT H1 scale.
// SoT spec is 36/44/700; we use 30/36/650 (text-3xl + tracking-tight)
// because internal dashboards feel marketing-heavy above ~32px.
// This is the only <h1> on a workspace page; SectionTitle is <h2>.
// Pending Remba review (2026-05-23 typography hierarchy restore).
export function PageTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h1
      className={cn(
        "text-3xl font-semibold leading-9 tracking-tight text-foreground",
        className,
      )}
    >
      {children}
    </h1>
  );
}

// Section title — sits inside a workspace page, one level below PageTitle.
// SoT spec is 24/32/650; we use 18/28/600 (text-lg semibold) as a
// calibration between the spec and the dense operator surfaces. Renders
// as <h2> so the document outline is PageTitle <h1> → SectionTitle <h2>.
// Pending Remba review (2026-05-23 typography hierarchy restore).
export function SectionTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        "text-lg font-semibold leading-7 tracking-tight text-foreground",
        className,
      )}
    >
      {children}
    </h2>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <section className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <PageTitle>{title}</PageTitle>
        {description ? (
          <p className="mt-1.5 text-sm leading-5 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </section>
  );
}

// SectionPanel — the "aside" container archetype. White card with
// border, radius, and shadow. Use for content that supports the main
// workspace task: Ask Leasium, Recent activity, evidence/source-trail
// disclosures, preview/receipt panels.
//
// For the main workspace body (tables, lists, dense data on a
// continuous canvas), use `<Surface>` below. Wrapping every section
// in `<SectionPanel>` produces the "stack of look-alike white cards"
// pattern flagged in the 2026-05-23 external review §4.
export function SectionPanel({
  title,
  description,
  icon,
  actions,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section
      {...props}
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-white shadow-leasiumCard",
        className,
      )}
    >
      {title || description || icon || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            {title ? (
              <div className="flex items-center gap-2">
                {icon}
                <SectionTitle>{title}</SectionTitle>
              </div>
            ) : null}
            {description ? (
              <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

// Surface — the "workspace body" container archetype. No card chrome
// (no border, no radius, no shadow). Just a heading, optional
// description, optional actions on the right, and a divider rule
// under the header. Children render directly on the page background.
//
// Use for: tables, lists, dense data, anything that's the main subject
// of the page rather than an aside that supports it. Multiple Surfaces
// stacked make the page feel like one continuous canvas with headings
// — the pattern the SoT §8 calls for. Pending Remba review (2026-05-23
// container hierarchy fix per external review §4).
export function Surface({
  title,
  description,
  icon,
  actions,
  className,
  children,
}: HTMLAttributes<HTMLElement> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const hasHeader = Boolean(title || description || icon || actions);
  return (
    <section className={className}>
      {hasHeader ? (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <div className="min-w-0">
            {title ? (
              <div className="flex items-center gap-2">
                {icon}
                <SectionTitle>{title}</SectionTitle>
              </div>
            ) : null}
            {description ? (
              <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </header>
      ) : null}
      <div className={hasHeader ? "pt-4" : ""}>{children}</div>
    </section>
  );
}

// StatusTone is the canonical chip-tone union, reused by per-domain
// chip primitives that compose StatusBadge. Exported here so newly
// extracted components don't need to redeclare the union inline; the
// inline copies that exist in operator pages today will migrate
// opportunistically.
export type StatusTone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "primary";

export type ChipDensity = "default" | "compact";

export type ChipClassOptions = {
  /** "default" = StatusBadge size (min-h-6, text-xs); "compact" = table/chip
   *  density (min-h-5, text-leasium-micro). */
  density?: ChipDensity;
  /** When true, adds a tone-coloured border in addition to the soft fill.
   *  Matches the "bordered chip" pattern used throughout property /
   *  occupancy / arrears surfaces. */
  bordered?: boolean;
};

/**
 * Single source of truth for chip/pill/badge class strings. Both
 * StatusBadge (JSX wrapper) and the lib/*-occupancy / lib/*-arrears
 * className helpers call into this so the visual system stays consistent.
 *
 * Codex SoT §9 documents the chip system; this helper implements it.
 */
export function chipClass(
  tone: StatusTone = "neutral",
  options: ChipClassOptions = {},
): string {
  const { density = "default", bordered = false } = options;

  const base = "inline-flex items-center rounded-full font-semibold";

  const sizing =
    density === "compact"
      ? "min-h-5 px-2 py-0.5 text-leasium-micro leading-4"
      : "min-h-6 px-2 py-1 text-xs leading-none";

  const toneStyles: Record<StatusTone, { soft: string; bordered: string }> = {
    neutral: {
      soft: "bg-muted text-leasium-slate-500",
      bordered: "border border-border bg-muted text-muted-foreground",
    },
    success: {
      soft: "bg-success-soft text-success-strong",
      bordered:
        "border border-success-strong/30 bg-success-soft text-success-strong",
    },
    warning: {
      soft: "bg-warning-soft text-warning-strong",
      bordered:
        "border border-warning-strong/30 bg-warning-soft text-warning-strong",
    },
    danger: {
      soft: "bg-danger-soft text-danger-strong",
      bordered:
        "border border-danger-strong/30 bg-danger-soft text-danger-strong",
    },
    primary: {
      soft: "bg-primary-soft text-primary-hover",
      bordered: "border border-primary/30 bg-primary-soft text-primary-hover",
    },
  };

  const toneClass = bordered
    ? toneStyles[tone].bordered
    : toneStyles[tone].soft;

  return cn(base, sizing, toneClass);
}

export function StatusBadge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: StatusTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={cn(chipClass(tone), "whitespace-nowrap", className)}>
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  /**
   * Optional icon (typically a lucide-react icon at size 18-20).
   * Rendered as a 36×36 rounded-leasiumLg square with primary-soft fill
   * and primary text colour above the title — a small visual anchor
   * that turns the empty state from a centred text block into something
   * that reads as a deliberate piece of layout. Opt-in: callers without
   * an icon get the previous text-only layout unchanged.
   */
  icon?: React.ReactNode;
}) {
  return (
    <div className="grid place-items-center px-4 py-8 text-center">
      <div className="max-w-md">
        {icon ? (
          <div className="mx-auto mb-3 grid h-9 w-9 place-items-center rounded-leasiumLg bg-primary-soft text-primary">
            {icon}
          </div>
        ) : null}
        <div className="text-leasium-body-compact font-semibold text-foreground">
          {title}
        </div>
        {description ? (
          <div className="mt-1 text-sm text-muted-foreground">
            {description}
          </div>
        ) : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    </div>
  );
}

// Single placeholder line — used inside larger skeleton compositions.
// Default height matches text-sm body copy. Width is controlled by the
// caller via className so each skeleton row can look like the row it's
// standing in for.
export function SkeletonLine({ className }: { className?: string }) {
  return (
    <div
      className={cn("h-4 animate-pulse rounded-md bg-muted", className)}
      aria-hidden="true"
    />
  );
}

// Skeleton row for list/table loading. Mimics a typical "title + meta"
// row shape: a wider title line above a narrower secondary line.
// Wrap inside a `<div className="divide-y divide-border">` parent so
// rows separate the same way real rows will once data lands.
function SkeletonRow() {
  return (
    <div className="grid gap-2 px-3 py-3">
      <SkeletonLine className="w-2/3" />
      <SkeletonLine className="h-3 w-1/3" />
    </div>
  );
}

// Canonical loading state for list/table surfaces. Replaces the
// "EmptyState title='Loading X.'" pattern which rendered as thin
// centered text in otherwise-empty cards (flagged in the 2026-05-20
// governance note and 2026-05-23 external review §1.5). Pulses 3 rows
// by default; pass `rows` to match the eventual row count more
// closely on dense surfaces.
export function SkeletonRows({
  rows = 3,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("divide-y divide-border", className)}
      aria-busy="true"
      aria-label="Loading…"
    >
      {Array.from({ length: rows }).map((_, index) => (
        <SkeletonRow key={index} />
      ))}
    </div>
  );
}
