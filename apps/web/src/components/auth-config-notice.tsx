"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

export function useAuthLoadTimeout(isLoaded: boolean, delayMs = 8_000) {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (isLoaded) {
      setTimedOut(false);
      return;
    }

    const timeout = window.setTimeout(() => setTimedOut(true), delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs, isLoaded]);

  return timedOut;
}

function decodePublishableKeyHost(key: string | undefined) {
  if (!key) {
    return null;
  }

  const encoded = key.replace(/^pk_(?:test|live)_/, "");
  if (!encoded || encoded === key) {
    return null;
  }

  try {
    const padded = encoded.padEnd(encoded.length + ((4 - encoded.length % 4) % 4), "=");
    return globalThis.atob(padded.replace(/-/g, "+").replace(/_/g, "/")).replace(/\$$/, "");
  } catch {
    return null;
  }
}

export function ClerkSessionUnavailableNotice({
  className,
}: {
  className?: string;
}) {
  const clerkHost = useMemo(
    () => decodePublishableKeyHost(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
    [],
  );
  const pageHost =
    typeof window === "undefined" ? null : window.location.hostname;

  return (
    <div
      className={cn(
        "grid gap-3 rounded-xl border border-warning/40 bg-warning-soft p-5 text-sm text-foreground shadow-leasiumXs",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 text-warning-strong" size={18} />
        <div className="grid gap-1">
          <h2 className="text-base font-semibold">
            Leasium login is still being configured.
          </h2>
          <p className="leading-6 text-slate">
            Sign-in could not finish because the live auth domain is not aligned
            with the Leasium domain yet.
          </p>
        </div>
      </div>
      {clerkHost || pageHost ? (
        <dl className="grid gap-1 rounded-lg border border-warning/30 bg-white/70 p-3 text-xs">
          {pageHost ? (
            <div className="flex flex-wrap gap-1">
              <dt className="font-semibold">Page:</dt>
              <dd>{pageHost}</dd>
            </div>
          ) : null}
          {clerkHost ? (
            <div className="flex flex-wrap gap-1">
              <dt className="font-semibold">Clerk:</dt>
              <dd>{clerkHost}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}
