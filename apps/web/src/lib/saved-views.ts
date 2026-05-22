/**
 * Saved views — operator-named filter combinations stored locally.
 *
 * Tier 3 of the 2026-05-22 UX review. The URL-persistent filters
 * shipped in Tier 1 (d) already let operators bookmark a filtered
 * URL; this layer adds names on top so common filter combinations
 * can be selected from a dropdown ("All vacant retail", "Overdue
 * urgent work", "Tenants with outstanding onboarding") without
 * having to remember the URL.
 *
 * v1 storage is window.localStorage. SKJ is the only operator
 * during the internal-first-6-months window, so cross-device sync
 * is not yet a hard requirement; when a second operator comes
 * online we'll promote to a backend-backed `saved_view` table.
 *
 * Filter values are stored as `string | null` pairs to mirror what
 * the URL search params encode. The component using this helper is
 * responsible for re-applying the filter map to its own state.
 */

const STORAGE_KEY_PREFIX = "leasium.saved_views.";

/** Surfaces that can hold saved views. Add as new tables gain filters. */
export type SavedViewSurface = "tenants" | "properties" | "operations";

export type SavedViewFilters = Record<string, string | null>;

export type SavedView = {
  id: string;
  name: string;
  surface: SavedViewSurface;
  filters: SavedViewFilters;
  createdAt: string;
};

function storageKey(surface: SavedViewSurface): string {
  return `${STORAGE_KEY_PREFIX}${surface}`;
}

function readRaw(surface: SavedViewSurface): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(surface));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is SavedView =>
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof entry.id === "string" &&
        typeof entry.name === "string" &&
        entry.surface === surface &&
        entry.filters &&
        typeof entry.filters === "object",
    );
  } catch {
    return [];
  }
}

function writeRaw(surface: SavedViewSurface, views: SavedView[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(surface), JSON.stringify(views));
  } catch {
    // localStorage may be full or denied (private browsing). Failing
    // silently keeps the surface usable even when persistence isn't.
  }
}

export function loadSavedViews(surface: SavedViewSurface): SavedView[] {
  return readRaw(surface);
}

export function saveView(
  surface: SavedViewSurface,
  name: string,
  filters: SavedViewFilters,
): SavedView {
  const views = readRaw(surface);
  // Replace by name if the operator re-saves an existing view.
  const trimmedName = name.trim();
  const existing = views.findIndex(
    (view) => view.name.toLowerCase() === trimmedName.toLowerCase(),
  );
  const view: SavedView = {
    id:
      existing >= 0
        ? views[existing].id
        : `${surface}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: trimmedName,
    surface,
    filters: cleanFilters(filters),
    createdAt:
      existing >= 0 ? views[existing].createdAt : new Date().toISOString(),
  };
  const next = [...views];
  if (existing >= 0) {
    next.splice(existing, 1, view);
  } else {
    next.push(view);
  }
  writeRaw(surface, next);
  return view;
}

export function renameView(
  surface: SavedViewSurface,
  id: string,
  name: string,
): SavedView | null {
  const views = readRaw(surface);
  const idx = views.findIndex((view) => view.id === id);
  if (idx < 0) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const next = [...views];
  next.splice(idx, 1, { ...views[idx], name: trimmed });
  writeRaw(surface, next);
  return next[idx];
}

export function deleteView(surface: SavedViewSurface, id: string): void {
  const views = readRaw(surface);
  writeRaw(
    surface,
    views.filter((view) => view.id !== id),
  );
}

export function viewMatchesFilters(
  view: SavedView,
  current: SavedViewFilters,
): boolean {
  const cleanedView = cleanFilters(view.filters);
  const cleanedCurrent = cleanFilters(current);
  const keys = new Set([
    ...Object.keys(cleanedView),
    ...Object.keys(cleanedCurrent),
  ]);
  for (const key of keys) {
    const a = cleanedView[key] ?? null;
    const b = cleanedCurrent[key] ?? null;
    if (a !== b) return false;
  }
  return true;
}

/**
 * Drop null/empty/undefined filter entries so {status: null} compares
 * equal to {status: ""} and to an absent key. This is what URLSearchParams
 * does effectively, so matching needs to treat them the same way.
 */
function cleanFilters(filters: SavedViewFilters): SavedViewFilters {
  const cleaned: SavedViewFilters = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value == null) continue;
    if (typeof value === "string" && value === "") continue;
    cleaned[key] = value;
  }
  return cleaned;
}
