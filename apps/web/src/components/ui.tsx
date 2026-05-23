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
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-transparent bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-leasium-blue-hover disabled:cursor-not-allowed disabled:opacity-50",
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
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50",
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
        "min-h-11 w-full rounded-xl border border-border bg-white px-3 text-sm outline-none transition duration-200 ease-leasium focus:border-primary focus:ring-2 focus:ring-primary/15",
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
        "min-h-11 w-full rounded-xl border border-border bg-white px-3 text-sm outline-none transition duration-200 ease-leasium focus:border-primary focus:ring-2 focus:ring-primary/15",
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

export function SectionPanel({
  title,
  description,
  icon,
  actions,
  className,
  children,
}: HTMLAttributes<HTMLDivElement> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-white shadow-leasiumXs",
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

export function StatusBadge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "success" | "warning" | "danger" | "primary";
  children: React.ReactNode;
}) {
  const tones = {
    neutral: "bg-muted text-leasium-slate-500",
    success: "bg-leasium-success-soft text-[#027A48]",
    warning: "bg-leasium-warning-soft text-[#B54708]",
    danger: "bg-leasium-danger-soft text-[#B42318]",
    primary: "bg-leasium-blue-soft text-leasium-blue-hover",
  };
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold leading-none",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid place-items-center px-4 py-8 text-center">
      <div>
        <div className="text-sm font-semibold">{title}</div>
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
