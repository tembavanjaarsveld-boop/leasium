"use client";

import { Layers } from "lucide-react";
import { useEffect, useRef } from "react";

import { Select } from "@/components/ui";
import type { Entity } from "@/lib/api";
import { ALL_ENTITIES_VALUE, isAllEntities } from "@/lib/entity-selection";
import { cn } from "@/lib/utils";

type EntityPickerProps = {
  entities: Entity[] | undefined;
  loading?: boolean;
  value: string;
  onChange: (entityId: string) => void;
  // Whether to offer the cross-entity "All entities" option + toggle. Pages
  // where an all-entities view is not meaningful (single-entity config /
  // provider connection) can pass false to hide it.
  allowAllEntities?: boolean;
};

/**
 * The shared workspace entity picker: a native dropdown plus an always-visible
 * "All entities" toggle. The toggle is needed because the option otherwise sits
 * at the top of a long native dropdown, above the selected entity, and scrolls
 * out of view. Toggling off returns to the previously selected single entity.
 */
export function EntityPicker({
  entities,
  loading = false,
  value,
  onChange,
  allowAllEntities = true,
}: EntityPickerProps) {
  const allMode = isAllEntities(value);
  const lastRealEntityIdRef = useRef<string>("");
  useEffect(() => {
    if (value && !isAllEntities(value)) {
      lastRealEntityIdRef.current = value;
    }
  }, [value]);

  const hasMultiple = (entities?.length ?? 0) > 1;
  const showAllEntities = allowAllEntities && hasMultiple;

  function toggleAllEntities() {
    if (allMode) {
      onChange(lastRealEntityIdRef.current || entities?.[0]?.id || "");
    } else {
      onChange(ALL_ENTITIES_VALUE);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Select
        aria-label="Entity"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">
          {loading ? "Checking entities" : "Select entity"}
        </option>
        {showAllEntities ? (
          <option value={ALL_ENTITIES_VALUE}>All entities</option>
        ) : null}
        {entities?.map((entity) => (
          <option key={entity.id} value={entity.id}>
            {entity.name}
          </option>
        ))}
      </Select>
      {showAllEntities ? (
        <button
          type="button"
          aria-pressed={allMode}
          onClick={toggleAllEntities}
          title="Show records across every entity"
          className={cn(
            "inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 text-sm font-medium transition",
            allMode
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-white text-muted-foreground hover:bg-muted",
          )}
        >
          <Layers size={15} />
          All entities
        </button>
      ) : null}
    </div>
  );
}
