"use client";

import { useQuery } from "@tanstack/react-query";
import { LogIn, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import {
  OwnerPortalAccountView,
  OwnerPortalLoading,
  OwnerPortalNotice,
  ownerPortalStatementMonth,
} from "./owner-portal-account-ui";
import {
  getOwnerPortalAccountSession,
  getOwnerPortalAccountStatus,
} from "@/lib/api";
import { friendlyError } from "@/lib/utils";

function accountHref(path: string) {
  return `${path}?redirect_url=${encodeURIComponent("/owner-portal")}`;
}

function AccountLinks() {
  return (
    <div className="flex flex-wrap gap-3">
      <Link
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-transparent bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-primary-hover"
        href={accountHref("/sign-in")}
      >
        <LogIn size={16} />
        Sign in
      </Link>
      <Link
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
        href={accountHref("/sign-up")}
      >
        Create login
      </Link>
    </div>
  );
}

function OwnerPortalEntryContent() {
  const searchParams = useSearchParams();
  const month = searchParams.get("month") ?? ownerPortalStatementMonth();
  const statusQuery = useQuery({
    queryKey: ["owner-portal-account-status"],
    queryFn: () => getOwnerPortalAccountStatus(),
    retry: false,
  });
  const accountLinked = statusQuery.data?.status === "active";
  const sessionQuery = useQuery({
    queryKey: ["owner-portal-account-session", month],
    queryFn: () => getOwnerPortalAccountSession(month),
    enabled: accountLinked,
    retry: false,
  });

  if (statusQuery.isLoading) {
    return <OwnerPortalLoading title="Checking owner account" />;
  }

  if (statusQuery.error) {
    return (
      <OwnerPortalNotice title="Open your owner portal">
        <p>
          Sign in with the owner login linked to your Leasium owner portal. If
          this is your first visit, open the claim link from the property team
          first.
        </p>
        <p>{friendlyError(statusQuery.error)}</p>
        <AccountLinks />
      </OwnerPortalNotice>
    );
  }

  if (!accountLinked) {
    const status = statusQuery.data?.status ?? "unlinked";
    return (
      <OwnerPortalNotice
        title="Open your owner portal"
        tone={status === "revoked" ? "warning" : "neutral"}
      >
        <div>
          <p className="font-semibold text-foreground">
            {status === "revoked"
              ? "Owner account access revoked"
              : "No owner account linked"}
          </p>
          <p className="mt-1">{statusQuery.data?.recovery_hint}</p>
        </div>
        <AccountLinks />
      </OwnerPortalNotice>
    );
  }

  if (sessionQuery.isLoading) {
    return <OwnerPortalLoading />;
  }

  if (sessionQuery.error) {
    return (
      <OwnerPortalNotice title="Owner portal unavailable" tone="danger">
        <p>{friendlyError(sessionQuery.error)}</p>
        <button
          className="inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
          type="button"
          onClick={() => void sessionQuery.refetch()}
        >
          <RefreshCw size={16} />
          Try again
        </button>
      </OwnerPortalNotice>
    );
  }

  if (!sessionQuery.data) {
    return null;
  }

  return <OwnerPortalAccountView portal={sessionQuery.data} />;
}

export default function OwnerPortalAccountEntryPage() {
  return (
    <Suspense fallback={<OwnerPortalLoading title="Owner portal" />}>
      <OwnerPortalEntryContent />
    </Suspense>
  );
}
