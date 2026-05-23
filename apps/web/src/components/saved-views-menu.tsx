"use client";

import { Bookmark, BookmarkPlus, Check, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  deleteView,
  loadSavedViews,
  renameView,
  saveView,
  type SavedView,
  type SavedViewFilters,
  type SavedViewSurface,
  viewMatchesFilters,
} from "@/lib/saved-views";
import { cn } from "@/lib/utils";

type SavedViewsMenuProps = {
  surface: SavedViewSurface;
  /** Current filter state — used to detect "Custom" + drive Save. */
  currentFilters: SavedViewFilters;
  /** Applied when the operator selects a view. */
  onApplyView: (filters: SavedViewFilters) => void;
  /** Optional label suffix to disambiguate when used on multiple pages. */
  className?: string;
};

/**
 * Saved-views dropdown rendered above each filterable table.
 *
 * Closed state: a Bookmark pill showing the active view name (if any),
 * or "Custom view" when filters don't match any saved view, or
 * "Saved views" when no views exist yet.
 *
 * Open state: a popover listing saved views (click to apply, x to
 * delete), a "Save current as…" inline form, and a hint that the
 * filters live alongside the URL so a bookmarked URL still works.
 */
export function SavedViewsMenu({
  surface,
  currentFilters,
  onApplyView,
  className,
}: SavedViewsMenuProps) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<SavedView[]>([]);
  const [saveName, setSaveName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Hydrate from localStorage once mounted (avoids SSR mismatch).
  useEffect(() => {
    setViews(loadSavedViews(surface));
  }, [surface]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setRenamingId(null);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const activeView = useMemo(
    () => views.find((view) => viewMatchesFilters(view, currentFilters)),
    [views, currentFilters],
  );

  const hasActiveFilters = useMemo(() => {
    for (const value of Object.values(currentFilters)) {
      if (value != null && value !== "") return true;
    }
    return false;
  }, [currentFilters]);

  const triggerLabel = activeView
    ? activeView.name
    : hasActiveFilters
      ? "Custom view"
      : views.length
        ? "Saved views"
        : "No saved views";

  function applyView(view: SavedView) {
    onApplyView(view.filters);
    setOpen(false);
  }

  function handleSave(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = saveName.trim();
    if (!trimmed) return;
    const view = saveView(surface, trimmed, currentFilters);
    setViews(loadSavedViews(surface));
    setSaveName("");
    // Auto-close after save so the operator can see the active chip
    // update to the new view name.
    setOpen(false);
    return view;
  }

  function handleDelete(id: string) {
    deleteView(surface, id);
    setViews(loadSavedViews(surface));
  }

  function handleRenameCommit(id: string) {
    const trimmed = renameDraft.trim();
    if (!trimmed) {
      setRenamingId(null);
      return;
    }
    renameView(surface, id, trimmed);
    setViews(loadSavedViews(surface));
    setRenamingId(null);
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition",
          activeView
            ? "border-primary/40 bg-primary/5 text-primary"
            : "border-border bg-white text-foreground hover:bg-muted/60",
        )}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Bookmark size={12} />
        <span className="max-w-[12rem] truncate">{triggerLabel}</span>
      </button>
      {open ? (
        <div className="absolute left-0 z-30 mt-1 w-80 overflow-hidden rounded-lg border border-border bg-white shadow-leasiumSm">
          <div className="max-h-72 overflow-y-auto">
            {views.length === 0 ? (
              <div className="px-3 py-3 text-xs text-muted-foreground">
                No saved views yet. Filter the table, then save the current
                combination below.
              </div>
            ) : (
              <ul className="py-1">
                {views.map((view) => {
                  const isActive = activeView?.id === view.id;
                  const isRenaming = renamingId === view.id;
                  return (
                    <li key={view.id}>
                      <div className="flex items-center gap-1.5 px-2">
                        {isRenaming ? (
                          <input
                            value={renameDraft}
                            autoFocus
                            onChange={(event) =>
                              setRenameDraft(event.target.value)
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                handleRenameCommit(view.id);
                              } else if (event.key === "Escape") {
                                setRenamingId(null);
                              }
                            }}
                            onBlur={() => handleRenameCommit(view.id)}
                            className="my-1 flex-1 rounded-md border border-border bg-white px-2 py-1 text-sm outline-none focus:border-primary"
                            aria-label="Rename saved view"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => applyView(view)}
                            className={cn(
                              "flex flex-1 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-muted/50",
                              isActive && "bg-primary/5 text-primary",
                            )}
                          >
                            <span className="truncate">{view.name}</span>
                            {isActive ? <Check size={12} /> : null}
                          </button>
                        )}
                        {!isRenaming ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setRenamingId(view.id);
                                setRenameDraft(view.name);
                              }}
                              className="rounded-md px-1.5 py-1 text-leasium-micro text-muted-foreground transition hover:bg-muted hover:text-foreground"
                              aria-label={`Rename ${view.name}`}
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(view.id)}
                              className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition hover:bg-danger/10 hover:text-danger"
                              aria-label={`Delete ${view.name}`}
                            >
                              <Trash2 size={12} />
                            </button>
                          </>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <form
            onSubmit={handleSave}
            className="grid gap-1.5 border-t border-border bg-muted/30 px-3 py-2"
          >
            <div className="text-leasium-micro font-medium uppercase tracking-wide text-muted-foreground">
              Save current view
            </div>
            <div className="flex items-center gap-1.5">
              <input
                value={saveName}
                onChange={(event) => setSaveName(event.target.value)}
                placeholder={
                  activeView ? activeView.name : "Name this filter combo"
                }
                disabled={!hasActiveFilters}
                aria-label="Save current view as"
                className="min-h-7 flex-1 rounded-md border border-border bg-white px-2 py-1 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!saveName.trim() || !hasActiveFilters}
                className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                <BookmarkPlus size={12} /> Save
              </button>
            </div>
            {!hasActiveFilters ? (
              <p className="text-leasium-micro text-muted-foreground">
                Pick at least one filter before saving.
              </p>
            ) : null}
          </form>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close saved views menu"
            className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X size={12} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
