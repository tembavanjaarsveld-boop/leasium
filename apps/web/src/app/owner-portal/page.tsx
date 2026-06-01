"use client";

import { useAuth, useUser } from "@clerk/nextjs";
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

const privateOwnerAccountQueryOptions = {
  retry: false,
  staleTime: 0,
  gcTime: 0,
  refetchOnMount: "always" as const,
};

type OwnerAccountAuthContext = {
  authLoaded: boolean;
  queryEnabled: boolean;
  requiresAuthToken: boolean;
  userKey: string;
  getAuthToken: () => Promise<string | null>;
};

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

function OwnerPortalAccountQueries({ auth }: { auth: OwnerAccountAuthContext }) {
  const searchParams = useSearchParams();
  const month = searchParams.get("month") ?? ownerPortalStatementMonth();
  const statusQuery = useQuery({
    queryKey: ["owner-portal-account-status", auth.userKey],
    queryFn: async () => {
      const authToken = await auth.getAuthToken();
      if (auth.requiresAuthToken && !authToken) {
        throw new Error("Sign in before opening the owner portal.");
      }
      return getOwnerPortalAccountStatus(authToken);
    },
    enabled: auth.queryEnabled,
    ...privateOwnerAccountQueryOptions,
  });
  const accountStatus =
    statusQuery.isSuccess && !statusQuery.isError ? statusQuery.data : null;
  const accountLinked = accountStatus?.status === "active";
  const ownerAccountContextKey =
    accountStatus?.owner_id ?? accountStatus?.owner_name ?? "no-owner-account";
  const sessionQuery = useQuery({
    queryKey: [
      "owner-portal-account-session",
      auth.userKey,
      ownerAccountContextKey,
      month,
    ],
    queryFn: async () => {
      const authToken = await auth.getAuthToken();
      if (auth.requiresAuthToken && !authToken) {
        throw new Error("Sign in before opening the owner portal.");
      }
      return getOwnerPortalAccountSession(month, authToken);
    },
    enabled: auth.queryEnabled && accountLinked,
    ...privateOwnerAccountQueryOptions,
  });

  if (!auth.authLoaded || (auth.queryEnabled && statusQuery.isLoading)) {
    return <OwnerPortalLoading title="Checking owner account" />;
  }

  if (!auth.queryEnabled) {
    return (
      <OwnerPortalNotice title="Open your owner portal">
        <p>
          Sign in with the owner login linked to your Leasium owner portal. If
          this is your first visit, open the claim link from the property team
          first.
        </p>
        <AccountLinks />
      </OwnerPortalNotice>
    );
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
    const status = accountStatus?.status ?? "unlinked";
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
          <p className="mt-1">{accountStatus?.recovery_hint}</p>
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

  const accountSession =
    sessionQuery.isSuccess && !sessionQuery.isError ? sessionQuery.data : null;

  if (!accountSession) {
    return null;
  }

  return <OwnerPortalAccountView portal={accountSession} selectedMonth={month} />;
}

function OwnerPortalEntryContentWithAuth() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const { user, isLoaded: userLoaded } = useUser();
  const authLoaded = isLoaded && userLoaded;

  return (
    <OwnerPortalAccountQueries
      auth={{
        authLoaded,
        queryEnabled: authLoaded && isSignedIn && Boolean(user?.id),
        requiresAuthToken: true,
        userKey: user?.id ?? "signed-out",
        getAuthToken: () => getToken({ skipCache: true }),
      }}
    />
  );
}

function OwnerPortalEntryContentWithoutAuth() {
  return (
    <OwnerPortalAccountQueries
      auth={{
        authLoaded: true,
        queryEnabled: true,
        requiresAuthToken: false,
        userKey: "auth-provider-disabled",
        getAuthToken: async () => null,
      }}
    />
  );
}

function OwnerPortalEntryContent() {
  const ownerAccountAuthEnabled = Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  );

  return ownerAccountAuthEnabled ? (
    <OwnerPortalEntryContentWithAuth />
  ) : (
    <OwnerPortalEntryContentWithoutAuth />
  );
}

export default function OwnerPortalAccountEntryPage() {
  return (
    <Suspense fallback={<OwnerPortalLoading title="Owner portal" />}>
      <OwnerPortalEntryContent />
    </Suspense>
  );
}
