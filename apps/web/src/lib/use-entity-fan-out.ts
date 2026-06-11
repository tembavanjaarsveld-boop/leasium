"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { Entity } from "@/lib/api";

// Stable empty reference so consumers keep a steady identity when not in
// all-entities mode (avoids needless downstream recompute).
const EMPTY: never[] = [];

// Global cap on in-flight fan-out requests. Without it, an all-entities page
// load fires (entities × hooks) simultaneous API calls — ~70+ at 17 entities —
// which queue server-side behind the API's DB pool and push tail latency past
// 30s (2026-06-11 slow-dashboard investigation). Capped, the same load drains
// in a few seconds. The limit spans every fan-out hook on the page.
const MAX_CONCURRENT_FAN_OUT_REQUESTS = 6;

let activeFanOutRequests = 0;
const fanOutWaiters: (() => void)[] = [];

async function withFanOutSlot<T>(run: () => Promise<T>): Promise<T> {
  if (activeFanOutRequests >= MAX_CONCURRENT_FAN_OUT_REQUESTS) {
    await new Promise<void>((resolve) => fanOutWaiters.push(resolve));
  }
  activeFanOutRequests += 1;
  try {
    return await run();
  } finally {
    activeFanOutRequests -= 1;
    fanOutWaiters.shift()?.();
  }
}

type FanOutOptions<T> = {
  entities: Entity[] | undefined;
  // Only fan out when true (i.e. the picker is on the All-entities sentinel).
  enabled: boolean;
  // Stable prefix for the per-entity query key, e.g. ["tenants"]. Each entity's
  // query is keyed [...keyPrefix, entityId] so it shares cache with the page's
  // single-entity query of the same shape.
  keyPrefix: readonly unknown[];
  queryFn: (entityId: string) => Promise<T[]>;
  // When provided, all-entities mode issues ONE org-wide request instead of
  // fanning out per entity. Only use for endpoints that scope a missing
  // entity_id to every readable entity server-side (rent-roll, obligations,
  // tenant-onboarding, document-intakes).
  orgWideQueryFn?: () => Promise<T[]>;
};

export type FanOutResult<T> = {
  data: T[];
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => void;
};

/**
 * Fan a per-entity list query across every accessible entity and merge the
 * results client-side. Used by the cross-entity "All entities" view on list
 * pages. Returns a flattened, entity-tagged-by-caller array plus aggregate
 * loading/error/refetch state.
 */
export function useEntityFanOut<T>({
  entities,
  enabled,
  keyPrefix,
  queryFn,
  orgWideQueryFn,
}: FanOutOptions<T>): FanOutResult<T> {
  const orgWide = orgWideQueryFn !== undefined;

  const orgWideQuery = useQuery({
    queryKey: [...keyPrefix, "org-wide"],
    queryFn: () => orgWideQueryFn!(),
    enabled: enabled && orgWide,
  });

  const entityIds = useMemo(
    () => (entities ?? []).map((entity) => entity.id),
    [entities],
  );

  const results = useQueries({
    queries:
      enabled && !orgWide
        ? entityIds.map((entityId) => ({
            queryKey: [...keyPrefix, entityId],
            queryFn: () => withFanOutSlot(() => queryFn(entityId)),
          }))
        : [],
  });

  const data = useMemo(() => {
    if (!enabled) {
      return EMPTY;
    }
    if (orgWide) {
      return orgWideQuery.data ?? EMPTY;
    }
    return results.flatMap((result) => result.data ?? []);
  }, [enabled, orgWide, orgWideQuery.data, results]);

  if (orgWide) {
    return {
      data,
      isLoading: enabled && orgWideQuery.isLoading,
      isFetching: enabled && orgWideQuery.isFetching,
      error: enabled ? (orgWideQuery.error ?? null) : null,
      refetch: () => {
        void orgWideQuery.refetch();
      },
    };
  }

  return {
    data,
    isLoading:
      enabled && results.length > 0 && results.some((r) => r.isLoading),
    isFetching: enabled && results.some((r) => r.isFetching),
    error: enabled ? (results.find((r) => r.error)?.error ?? null) : null,
    refetch: () => results.forEach((r) => r.refetch()),
  };
}
