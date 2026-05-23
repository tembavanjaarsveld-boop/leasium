"use client";

import { Check, Loader2, Pencil, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export type InlineEditOption = {
  value: string;
  label: string;
};

type InlineEditCellProps = {
  value: string | null | undefined;
  placeholder?: string;
  type?: "text" | "email" | "tel";
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  /**
   * Optional formatter so the read-only display can render differently
   * from the input value (e.g. truncate, prepend a tel: prefix).
   */
  formatDisplay?: (value: string | null | undefined) => string;
  /**
   * If provided, the cell renders as a select dropdown instead of a
   * text input. The empty-string option (if present in `options`) acts
   * as the "clear to null" choice.
   */
  options?: InlineEditOption[];
  /**
   * Called when the operator commits a change. Receive the new value
   * (or null when the cell was cleared) and return a Promise. Reject
   * the Promise to surface an inline error and keep the cell in edit
   * state so the operator can retry.
   */
  onSave: (next: string | null) => Promise<void>;
};

/**
 * Inline-edit cell used inside table rows and detail strips.
 *
 * UX contract (mirrors Linear / Notion / Stripe inline editors):
 * - Click the value or press Enter when focused → edit mode.
 * - Type into the input.
 * - Press Enter or focus another element → commit if changed.
 * - Press Escape → cancel and revert to the previous display value.
 * - During commit a spinner overlays the field; the input is disabled
 *   so a double-Enter cannot double-save.
 * - If onSave rejects, the cell stays in edit mode and the error
 *   message renders below so the operator can retry without losing
 *   the typed value.
 *
 * Read-only mode shows a subtle pencil icon on hover/focus so the
 * affordance is discoverable without screaming for attention.
 */
export function InlineEditCell({
  value,
  placeholder = "—",
  type = "text",
  ariaLabel,
  disabled = false,
  className,
  formatDisplay,
  options,
  onSave,
}: InlineEditCellProps) {
  const isSelect = Array.isArray(options) && options.length > 0;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selectRef = useRef<HTMLSelectElement | null>(null);

  // Keep the draft in sync with prop changes while not editing — so an
  // external refresh (React Query cache update) reflects immediately.
  useEffect(() => {
    if (!editing) {
      setDraft(value ?? "");
    }
  }, [value, editing]);

  useEffect(() => {
    if (!editing) return;
    if (isSelect && selectRef.current) {
      selectRef.current.focus();
    } else if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing, isSelect]);

  const display = useMemo(() => {
    if (formatDisplay) return formatDisplay(value);
    if (isSelect && value != null) {
      const match = options?.find((opt) => opt.value === value);
      return match?.label ?? value ?? "";
    }
    return value ?? "";
  }, [formatDisplay, value, options, isSelect]);
  const displayText = display || placeholder;
  const isEmpty = !display;

  const commit = async () => {
    const trimmed = draft.trim();
    const nextValue = trimmed === "" ? null : trimmed;
    const previousValue = value ?? null;
    if (nextValue === previousValue) {
      setEditing(false);
      setError(null);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSave(nextValue);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setPending(false);
    }
  };

  const cancel = () => {
    setDraft(value ?? "");
    setEditing(false);
    setError(null);
  };

  if (disabled) {
    return (
      <span
        className={cn(
          "inline-flex min-h-7 items-center text-sm text-muted-foreground",
          className,
        )}
      >
        {displayText}
      </span>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Edit ${ariaLabel}`}
        className={cn(
          "group inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-sm transition hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
          isEmpty && "text-muted-foreground italic",
          className,
        )}
      >
        <span className="truncate">{displayText}</span>
        <Pencil
          size={11}
          className="shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-70 group-focus-visible:opacity-70"
        />
      </button>
    );
  }

  return (
    <div className={cn("grid gap-1", className)}>
      <div className="flex items-center gap-1">
        {isSelect ? (
          <select
            ref={selectRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              // Commit immediately on select change (Enter-to-confirm
              // is awkward for a dropdown).
              window.setTimeout(() => void commit(), 0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancel();
              }
            }}
            onBlur={() => {
              window.setTimeout(() => {
                if (editing && !pending) {
                  cancel();
                }
              }, 100);
            }}
            disabled={pending}
            aria-label={ariaLabel}
            className="min-h-7 flex-1 rounded-md border border-border bg-white px-2 py-1 text-sm outline-none focus-visible:border-primary"
          >
            {options!.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            ref={inputRef}
            type={type}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void commit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                cancel();
              }
            }}
            onBlur={() => {
              // Defer so a click on Save/Cancel buttons registers before
              // the blur fires and closes the cell.
              window.setTimeout(() => {
                if (editing && !pending) {
                  void commit();
                }
              }, 100);
            }}
            disabled={pending}
            aria-label={ariaLabel}
            className="min-h-7 flex-1 rounded-md border border-border bg-white px-2 py-1 text-sm outline-none focus-visible:border-primary"
          />
        )}
        {pending ? (
          <Loader2 size={13} className="animate-spin text-primary" />
        ) : (
          <>
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void commit()}
              aria-label={`Save ${ariaLabel}`}
              className="grid h-6 w-6 place-items-center rounded-md text-primary transition hover:bg-primary/10"
            >
              <Check size={13} />
            </button>
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={cancel}
              aria-label={`Cancel ${ariaLabel}`}
              className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition hover:bg-muted"
            >
              <X size={13} />
            </button>
          </>
        )}
      </div>
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
