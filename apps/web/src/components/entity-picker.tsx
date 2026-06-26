"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import type { Entity } from "@/lib/api";
import { ALL_ENTITIES_VALUE, isAllEntities } from "@/lib/entity-selection";
import { cn } from "@/lib/utils";

type EntityPickerProps = {
  entities: Entity[] | undefined;
  loading?: boolean;
  value: string;
  onChange: (entityId: string) => void;
  // Whether to offer the cross-entity "All entities" option. Pages where an
  // all-entities view is not meaningful (single-entity config / provider
  // connection) can pass false to hide it.
  allowAllEntities?: boolean;
  // Where the trigger renders. "sidebar" (default) is the dark navy
  // workspace-switcher card; "inline" is a light, bordered field for
  // entity-scoped pages that own their picker in the page header (Settings,
  // Statements, Money, etc.) now that the global switcher is gone.
  tone?: "sidebar" | "inline";
};

// Portfolios past this size get a type-ahead filter at the top of the list.
const FILTER_THRESHOLD = 8;

/**
 * The shared workspace entity picker, housed in the Horizon sidebar's
 * workspace-switcher card (its only rendering context). Replaces the previous
 * native <select>: the open menu is now a Horizon-styled popover listbox —
 * dark panel, truncated rows, pinned "All entities", check on the selected
 * row, and a type-ahead filter for larger portfolios — instead of the
 * unstylable OS dropdown.
 */
export function EntityPicker({
  entities,
  loading = false,
  value,
  onChange,
  allowAllEntities = true,
  tone = "sidebar",
}: EntityPickerProps) {
  const inline = tone === "inline";
  const hasMultiple = (entities?.length ?? 0) > 1;
  const showAllEntities = allowAllEntities && hasMultiple;
  const isEmpty = !loading && (entities?.length ?? 0) === 0;
  const placeholder = loading
    ? "Checking entities"
    : isEmpty
      ? "No entities yet"
      : "Select entity";

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const filterRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const baseId = useId();

  const selectedEntity = isAllEntities(value)
    ? null
    : entities?.find((entity) => entity.id === value);
  const triggerLabel = isAllEntities(value)
    ? "All entities"
    : (selectedEntity?.name ?? placeholder);

  const showFilter = (entities?.length ?? 0) >= FILTER_THRESHOLD;

  // "All entities" stays pinned above the filterable entity rows.
  const filteredEntities = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return entities ?? [];
    return (entities ?? []).filter((entity) =>
      entity.name.toLowerCase().includes(needle),
    );
  }, [entities, filter]);

  const options = useMemo(() => {
    const rows: Array<{ id: string; name: string }> = [];
    if (showAllEntities) {
      rows.push({ id: ALL_ENTITIES_VALUE, name: "All entities" });
    }
    rows.push(...filteredEntities.map(({ id, name }) => ({ id, name })));
    return rows;
  }, [filteredEntities, showAllEntities]);

  // (Re)open: clear the filter, highlight the current selection, and move
  // focus into the popover (filter input when present, the listbox otherwise).
  useEffect(() => {
    if (!open) return;
    setFilter("");
    if (showFilter) {
      filterRef.current?.focus();
    } else {
      listRef.current?.focus();
    }
  }, [open, showFilter]);

  useEffect(() => {
    if (!open) return;
    const index = options.findIndex((option) => option.id === value);
    setHighlight(index >= 0 ? index : 0);
    // Reset only when the popover opens or the option set changes size via
    // filtering; keeping the dependency on options.length avoids fighting
    // arrow-key navigation on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filter, options.length]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // Keep the highlighted row in view while arrowing through long lists.
  useEffect(() => {
    if (!open) return;
    const option = options[highlight];
    if (!option) return;
    document
      .getElementById(`${baseId}-option-${option.id}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, highlight, options, baseId]);

  function commit(entityId: string) {
    onChange(entityId);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onPopoverKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((index) => Math.min(index + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = options[highlight];
      if (option) commit(option.id);
    }
  }

  const highlightedOption = options[highlight];
  const activeDescendant =
    open && highlightedOption
      ? `${baseId}-option-${highlightedOption.id}`
      : undefined;

  return (
    <div ref={containerRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Entity"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-value={value}
        disabled={loading || isEmpty}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "group flex w-full min-w-0 items-center text-left font-medium transition duration-200 ease-leasium focus-visible:outline-none",
          inline
            ? "min-h-11 gap-2 rounded-xl border border-border-strong bg-white px-3 text-sm text-foreground shadow-leasiumXs hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 disabled:cursor-default disabled:opacity-60 disabled:hover:bg-white"
            : "min-h-6 gap-1 rounded-sm text-[11px] leading-4 text-leasium-slate-300 hover:text-white focus-visible:ring-2 focus-visible:ring-white/40 disabled:cursor-default disabled:hover:text-leasium-slate-300",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{triggerLabel}</span>
        <ChevronDown
          size={inline ? 14 : 12}
          className={cn(
            "shrink-0 transition duration-200 ease-leasium",
            inline && "text-muted-foreground",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div
          onKeyDown={onPopoverKeyDown}
          className="absolute left-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-leasiumMd border border-white/15 bg-leasium-slate-700 shadow-[0_16px_40px_rgba(0,0,0,0.55),0_2px_8px_rgba(0,0,0,0.4)]"
        >
          {showFilter ? (
            <div className="border-b border-white/10 p-1.5">
              <div className="flex items-center gap-1.5 rounded-md bg-white/[0.08] px-2">
                <Search size={12} className="shrink-0 text-leasium-slate-400" />
                <input
                  ref={filterRef}
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Filter entities"
                  aria-label="Filter entities"
                  aria-activedescendant={activeDescendant}
                  className="min-h-7 w-full bg-transparent text-[12px] leading-4 text-white outline-none placeholder:text-leasium-slate-400"
                />
              </div>
            </div>
          ) : null}
          <ul
            ref={listRef}
            role="listbox"
            aria-label="Entities"
            aria-activedescendant={activeDescendant}
            tabIndex={-1}
            className="max-h-72 overflow-y-auto py-1 focus-visible:outline-none"
          >
            {options.map((option, index) => {
              const isSelected = option.id === value;
              const isAllRow = option.id === ALL_ENTITIES_VALUE;
              return (
                <li
                  key={option.id}
                  id={`${baseId}-option-${option.id}`}
                  role="option"
                  aria-selected={isSelected}
                  data-value={option.id}
                  onClick={() => commit(option.id)}
                  onMouseEnter={() => setHighlight(index)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12px] leading-4 text-leasium-slate-300",
                    isAllRow && options.length > 1 && "border-b border-white/10",
                    index === highlight && "bg-white/[0.08] text-white",
                    isSelected && "font-medium text-white",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{option.name}</span>
                  {isSelected ? (
                    <Check size={12} className="shrink-0 text-leasium-teal" />
                  ) : null}
                </li>
              );
            })}
            {options.length === 0 ? (
              <li className="px-3 py-2 text-[12px] text-leasium-slate-400">
                No matching entities
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
