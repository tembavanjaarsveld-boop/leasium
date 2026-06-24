"use client";

import { X } from "lucide-react";
import { type ReactNode, useEffect } from "react";

import { SecondaryButton } from "@/components/ui";
import { useUnmountDelay } from "@/lib/use-unmount-delay";
import { cn } from "@/lib/utils";

/**
 * Generic right-side detail drawer for in-flow editing/preview without
 * navigating off the current list. Backdrop click and Escape close it.
 *
 * Matches the "Right-side detail panels" pattern in the Relby design
 * source of truth — Tier 1 (b) of the 2026-05-22 UX review.
 */
export function DetailDrawer({
  open,
  title,
  description,
  onClose,
  primaryAction,
  footerNote,
  children,
  testId,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  primaryAction?: {
    label: string;
    href?: string;
    onClick?: () => void;
    disabled?: boolean;
  };
  footerNote?: string;
  children: ReactNode;
  testId?: string;
}) {
  // Drawer enter animation runs at Slow=300ms; matching exit keeps the
  // panel mounted long enough for the slide-out keyframe to finish.
  const { shouldRender, isClosing } = useUnmountDelay(open, 300);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!shouldRender) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [shouldRender]);

  if (!shouldRender) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={testId}
    >
      <button
        type="button"
        aria-label="Close drawer"
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-slate-900/50 transition-opacity duration-200 ease-leasium",
          isClosing
            ? "animate-leasium-backdrop-out"
            : "animate-leasium-backdrop-in",
        )}
      />
      <div
        className={cn(
          "relative flex h-full w-full max-w-[560px] flex-col bg-white shadow-leasiumLg transition duration-200 ease-leasium",
          isClosing
            ? "animate-leasium-drawer-out-right"
            : "animate-leasium-drawer-in-right",
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold leading-6 text-foreground">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border-strong bg-white text-muted-foreground shadow-leasiumXs transition hover:bg-muted hover:text-foreground"
          >
            <X size={15} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm">
          {children}
        </div>
        {primaryAction || footerNote ? (
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/30 px-5 py-3 text-xs text-muted-foreground">
            {footerNote ? <span>{footerNote}</span> : <span />}
            {primaryAction ? (
              primaryAction.href ? (
                <SecondaryButton
                  type="button"
                  disabled={primaryAction.disabled}
                  onClick={() => {
                    onClose();
                  }}
                >
                  <a
                    href={primaryAction.href}
                    aria-label={primaryAction.label}
                  >
                    {primaryAction.label}
                  </a>
                </SecondaryButton>
              ) : (
                <SecondaryButton
                  type="button"
                  disabled={primaryAction.disabled}
                  onClick={primaryAction.onClick}
                >
                  {primaryAction.label}
                </SecondaryButton>
              )
            ) : null}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
