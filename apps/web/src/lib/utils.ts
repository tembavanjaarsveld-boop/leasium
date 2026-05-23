import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Render a thrown value as user-facing copy. Mirrors a small helper
 * that lives inline in many pages today; consolidated here so newly
 * extracted components can import it without reintroducing duplication.
 * Existing inline copies will be migrated opportunistically.
 */
export function friendlyError(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
