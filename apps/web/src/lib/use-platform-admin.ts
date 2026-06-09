"use client";

import { useQuery } from "@tanstack/react-query";

import { getCurrentOperator } from "@/lib/api";

/**
 * usePlatformAdmin — resolve whether the current operator holds the
 * platform-admin tier (docs/platform-admin-tier-ia.md), so surfaces can gate
 * the /admin route group and its nav entry.
 *
 * Reads the shared ["current-operator"] /me query. Defaults to `false` until
 * resolved — the safe default, because it hides the platform-admin surface
 * rather than flashing it to a client operator.
 */
export function usePlatformAdmin(): {
  isPlatformAdmin: boolean;
  isResolved: boolean;
} {
  const { data } = useQuery({
    queryKey: ["current-operator"],
    queryFn: () => getCurrentOperator(),
    staleTime: 300_000,
  });

  return {
    isPlatformAdmin: data?.current_user.is_platform_admin ?? false,
    isResolved: Boolean(data),
  };
}
