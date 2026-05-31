export const APPEARANCE_STORAGE_KEY = "leasium.appearance";
export const APPEARANCE_CHANGED_EVENT = "leasium:appearance-change";
export const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

export type AppearanceMode = "system" | "light" | "dark";
export type ResolvedAppearance = "light" | "dark";

export function normalizeAppearanceMode(
  value: string | null | undefined,
): AppearanceMode {
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }
  return "system";
}

export function readAppearancePreference(): AppearanceMode {
  if (typeof window === "undefined") return "system";
  try {
    return normalizeAppearanceMode(
      window.localStorage.getItem(APPEARANCE_STORAGE_KEY),
    );
  } catch {
    return "system";
  }
}

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(SYSTEM_DARK_QUERY).matches;
}

export function resolveAppearance(
  mode: AppearanceMode,
): ResolvedAppearance {
  if (mode === "dark") return "dark";
  if (mode === "light") return "light";
  return systemPrefersDark() ? "dark" : "light";
}

export function applyAppearancePreference(
  mode: AppearanceMode,
): ResolvedAppearance {
  const resolved = resolveAppearance(mode);
  if (typeof window === "undefined") return resolved;

  const root = document.documentElement;
  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, mode);
  } catch {}
  root.dataset.theme = resolved;
  root.dataset.appearance = mode;
  root.style.colorScheme = resolved;
  root.classList.toggle("dark", resolved === "dark");
  return resolved;
}

export function nextAppearanceMode(mode: AppearanceMode): AppearanceMode {
  if (mode === "system") return "light";
  if (mode === "light") return "dark";
  return "system";
}

export function createAppearanceChangeEvent(mode: AppearanceMode) {
  return new CustomEvent(APPEARANCE_CHANGED_EVENT, {
    detail: { mode },
  });
}

export function appearanceModeFromEvent(event: Event): AppearanceMode | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail = event.detail as { mode?: unknown } | null;
  return typeof detail?.mode === "string"
    ? normalizeAppearanceMode(detail.mode)
    : null;
}

export function labelAppearanceMode(mode: AppearanceMode): string {
  if (mode === "system") return "System";
  if (mode === "dark") return "Dark";
  return "Light";
}
