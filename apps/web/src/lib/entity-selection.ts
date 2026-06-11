// Shared entity-selection plumbing.
//
// Every workspace page scopes its data to a selected entity, persisted in
// localStorage under ENTITY_STORAGE_KEY and broadcast across pages via
// ENTITY_CHANGED_EVENT. ALL_ENTITIES_VALUE is a sentinel picker value for the
// cross-entity "All entities" view: it is NOT a real entity id, so any
// entity-scoped query must use scopeEntityId() (which collapses the sentinel to
// an empty string) before calling the API.

export const ENTITY_STORAGE_KEY = "leasium.entity_id";
export const ENTITY_CHANGED_EVENT = "leasium:entity-id-change";
export const ALL_ENTITIES_VALUE = "__all_entities__";

export function isAllEntities(entityId: string | null | undefined): boolean {
  return entityId === ALL_ENTITIES_VALUE;
}

// Collapse the All-entities sentinel to "" so Boolean(scopeEntityId(id)) gates
// entity-scoped queries off in all-mode and the sentinel never reaches the API.
export function scopeEntityId(entityId: string | null | undefined): string {
  if (!entityId || entityId === ALL_ENTITIES_VALUE) return "";
  return entityId;
}

// Default selection when nothing valid is stored: multi-entity orgs land on
// the cross-entity "All entities" view. Single-entity orgs land directly on
// their one entity instead — all-mode gates single-entity write actions, so
// the sentinel would only add friction when there is nothing to merge.
export function defaultEntitySelection(
  entities: ReadonlyArray<{ id: string }>,
): string {
  if (!entities.length) return "";
  if (entities.length === 1) return entities[0].id;
  return ALL_ENTITIES_VALUE;
}
