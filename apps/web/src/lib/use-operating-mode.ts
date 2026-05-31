"use client";

import { useQuery } from "@tanstack/react-query";

import { getSecurityWorkspace, type OperatingMode } from "@/lib/api";

/**
 * useOperatingMode — resolve the organisation's account operating mode so
 * surfaces can gate themselves (see docs/account-operating-mode-ia.md).
 *
 * Reuses the shared ["security-workspace"] query key, so Settings/Operations
 * already warm this cache and the operating-mode toggle's invalidate (also on
 * that key) refreshes any nav reading from here.
 *
 * Defaults to `self_managed_owner` until resolved — the safe default, because
 * it hides the managing-agent-only surfaces (People → Owners hub, owner-client
 * statements, owner portal) rather than flashing them.
 */
export function useOperatingMode(): {
  operatingMode: OperatingMode;
  isResolved: boolean;
} {
  const { data } = useQuery({
    queryKey: ["security-workspace"],
    queryFn: getSecurityWorkspace,
    staleTime: 300_000,
  });

  return {
    operatingMode: data?.organisation.operating_mode ?? "self_managed_owner",
    isResolved: Boolean(data),
  };
}
