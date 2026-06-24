"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { LogIn, RefreshCw } from "lucide-react";
import Link from "next/link";

import {
  VendorPortalAccountView,
  VendorPortalLoading,
  VendorPortalNotice,
} from "./vendor-portal-account-ui";
import {
  getVendorPortalAccountSession,
  getVendorPortalAccountStatus,
} from "@/lib/api";
import { friendlyError } from "@/lib/utils";

function accountHref(path: string) {
  return `${path}?redirect_url=${encodeURIComponent("/vendor-portal")}`;
}

const privateVendorAccountQueryOptions = {
  retry: false,
  staleTime: 0,
  gcTime: 0,
  refetchOnMount: "always" as const,
};

type VendorAccountAuthContext = {
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

function VendorPortalAccountQueries({ auth }: { auth: VendorAccountAuthContext }) {
  const statusQuery = useQuery({
    queryKey: ["vendor-portal-account-status", auth.userKey],
    queryFn: async () => {
      const authToken = await auth.getAuthToken();
      if (auth.requiresAuthToken && !authToken) {
        throw new Error("Sign in before opening the vendor portal.");
      }
      return getVendorPortalAccountStatus(authToken);
    },
    enabled: auth.queryEnabled,
    ...privateVendorAccountQueryOptions,
  });
  const accountStatus =
    statusQuery.isSuccess && !statusQuery.isError ? statusQuery.data : null;
  const accountLinked = accountStatus?.status === "active";
  const vendorAccountContextKey =
    accountStatus?.contractor_id ?? accountStatus?.vendor_name ?? "no-vendor-account";
  const sessionQuery = useQuery({
    queryKey: ["vendor-portal-account-session", auth.userKey, vendorAccountContextKey],
    queryFn: async () => {
      const authToken = await auth.getAuthToken();
      if (auth.requiresAuthToken && !authToken) {
        throw new Error("Sign in before opening the vendor portal.");
      }
      return getVendorPortalAccountSession(authToken);
    },
    enabled: auth.queryEnabled && accountLinked,
    ...privateVendorAccountQueryOptions,
  });

  if (!auth.authLoaded || (auth.queryEnabled && statusQuery.isLoading)) {
    return <VendorPortalLoading title="Checking vendor account" />;
  }

  if (!auth.queryEnabled || statusQuery.error) {
    return (
      <VendorPortalNotice title="Open your vendor portal">
        <p>
          Sign in with the login linked to your Relby vendor portal. If this is
          your first visit, open the claim link from the property team first.
        </p>
        {statusQuery.error ? <p>{friendlyError(statusQuery.error)}</p> : null}
        <AccountLinks />
      </VendorPortalNotice>
    );
  }

  if (!accountLinked) {
    const status = accountStatus?.status ?? "unlinked";
    return (
      <VendorPortalNotice
        title="Open your vendor portal"
        tone={status === "revoked" ? "warning" : "neutral"}
      >
        <div>
          <p className="font-semibold text-foreground">
            {status === "revoked"
              ? "Vendor account access revoked"
              : "No vendor account linked"}
          </p>
          <p className="mt-1">{accountStatus?.recovery_hint}</p>
        </div>
        <AccountLinks />
      </VendorPortalNotice>
    );
  }

  if (sessionQuery.isLoading) {
    return <VendorPortalLoading />;
  }

  if (sessionQuery.error) {
    return (
      <VendorPortalNotice title="Vendor portal unavailable" tone="danger">
        <p>{friendlyError(sessionQuery.error)}</p>
        <button
          className="inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
          type="button"
          onClick={() => void sessionQuery.refetch()}
        >
          <RefreshCw size={16} />
          Try again
        </button>
      </VendorPortalNotice>
    );
  }

  const accountSession =
    sessionQuery.isSuccess && !sessionQuery.isError ? sessionQuery.data : null;

  if (!accountSession) {
    return null;
  }

  return (
    <VendorPortalAccountView
      portal={accountSession}
      getAuthToken={auth.getAuthToken}
      requiresAuthToken={auth.requiresAuthToken}
    />
  );
}

function VendorPortalEntryContentWithAuth() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const { user, isLoaded: userLoaded } = useUser();
  const authLoaded = isLoaded && userLoaded;

  return (
    <VendorPortalAccountQueries
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

function VendorPortalEntryContentWithoutAuth() {
  return (
    <VendorPortalAccountQueries
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

export default function VendorPortalAccountEntryPage() {
  const vendorAccountAuthEnabled = Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  );

  return vendorAccountAuthEnabled ? (
    <VendorPortalEntryContentWithAuth />
  ) : (
    <VendorPortalEntryContentWithoutAuth />
  );
}
