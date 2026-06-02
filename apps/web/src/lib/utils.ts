import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Render a thrown value as user-facing copy. The optional fallback keeps pages
 * with more specific empty/error-state copy from reintroducing local wrappers.
 */
export function friendlyError(
  error: unknown,
  fallback = "Something went wrong.",
): string {
  return error instanceof Error ? error.message : fallback;
}
