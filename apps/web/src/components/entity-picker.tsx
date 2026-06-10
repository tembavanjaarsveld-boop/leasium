"use client";

import { Select } from "@/components/ui";
import type { Entity } from "@/lib/api";
import { ALL_ENTITIES_VALUE } from "@/lib/entity-selection";

type EntityPickerProps = {
  entities: Entity[] | undefined;
  loading?: boolean;
  value: string;
  onChange: (entityId: string) => void;
  // Whether to offer the cross-entity "All entities" dropdown option. Pages
  // where an all-entities view is not meaningful (single-entity config /
  // provider connection) can pass false to hide it.
  allowAllEntities?: boolean;
};

/**
 * The shared workspace entity picker. Cross-entity mode is selected from the
 * same native dropdown so the Horizon sidebar stays compact.
 */
export function EntityPicker({
  entities,
  loading = false,
  value,
  onChange,
  allowAllEntities = true,
}: EntityPickerProps) {
  const hasMultiple = (entities?.length ?? 0) > 1;
  const showAllEntities = allowAllEntities && hasMultiple;
  const isEmpty = !loading && (entities?.length ?? 0) === 0;
  const placeholder = loading
    ? "Checking entities"
    : isEmpty
      ? "No entities yet"
      : "Select entity";

  return (
    <div className="flex items-center gap-2">
      <Select
        aria-label="Entity"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{placeholder}</option>
        {showAllEntities ? (
          <option value={ALL_ENTITIES_VALUE}>All entities</option>
        ) : null}
        {entities?.map((entity) => (
          <option key={entity.id} value={entity.id}>
            {entity.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
