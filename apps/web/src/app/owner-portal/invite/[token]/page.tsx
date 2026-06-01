"use client";

import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, LogIn, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import {
  OwnerPortalAccountView,
  OwnerPortalLoading,
  OwnerPortalNotice,
  OwnerPortalShell,
  formatOwnerPortalDateTime,
} from "../../owner-portal-account-ui";
import {
  claimOwnerPortalAccount,
  getOwnerPortalInvitePreview,
} from "@/lib/api";
import { Button } from "@/components/ui";
import { friendlyError } from "@/lib/utils";

function accountHref(path: string, token: string) {
  const returnTo = `/owner-portal/invite/${encodeURIComponent(token)}`;
  return `${path}?redirect_url=${encodeURIComponent(returnTo)}`;
}

type OwnerPortalInviteAuthContext = {
  authLoaded: boolean;
  isSignedIn: boolean;
  requiresAuthToken: boolean;
  getAuthToken: () => Promise<string | null>;
};

function OwnerPortalInviteContent({
  auth,
}: {
  auth: OwnerPortalInviteAuthContext;
}) {
  const params = useParams<{ token?: string | string[] }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  const previewQuery = useQuery({
    queryKey: ["owner-portal-invite-preview", token],
    queryFn: () => getOwnerPortalInvitePreview(token as string),
    enabled: Boolean(token),
    retry: false,
  });
  const claimMutation = useMutation({
    mutationFn: async () => {
      if (!token) {
        throw new Error("Owner portal token is required.");
      }
      if (auth.requiresAuthToken) {
        if (!auth.authLoaded || !auth.isSignedIn) {
          throw new Error("Sign in before claiming the owner portal invite.");
        }
        const authToken = await auth.getAuthToken();
        if (!authToken) {
          throw new Error("Sign in before claiming the owner portal invite.");
        }
        return claimOwnerPortalAccount(token, authToken);
      }
      return claimOwnerPortalAccount(token);
    },
  });

  if (!token) {
    return (
      <OwnerPortalNotice title="Owner portal link unavailable" tone="danger">
        <p>Open the owner portal link sent by the property team.</p>
      </OwnerPortalNotice>
    );
  }

  if (claimMutation.data) {
    return (
      <OwnerPortalAccountView
        portal={claimMutation.data}
        getAuthToken={auth.getAuthToken}
        requiresAuthToken={auth.requiresAuthToken}
      />
    );
  }

  if (previewQuery.isLoading) {
    return <OwnerPortalLoading title="Checking owner portal link" />;
  }

  if (previewQuery.error || !previewQuery.data) {
    return (
      <OwnerPortalNotice
        title="We could not verify this owner portal link"
        tone="danger"
      >
        <p>
          For privacy, no owner statement or property data is shown until the
          property team confirms the link.
        </p>
        <p>
          Ask the property team to send a fresh owner portal link, then open the
          newest link.
        </p>
      </OwnerPortalNotice>
    );
  }

  const preview = previewQuery.data;

  if (!preview.claimable) {
    return (
      <OwnerPortalNotice title="Owner portal link already claimed" tone="warning">
        <p>
          This owner portal link has already been used. Sign in with the owner
          login it was claimed by, or ask the property team for a fresh link.
        </p>
        <Link
          className="inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-xl border border-transparent bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-primary-hover"
          href={accountHref("/sign-in", token)}
        >
          <LogIn size={16} />
          Sign in
        </Link>
      </OwnerPortalNotice>
    );
  }

  return (
    <OwnerPortalShell>
      <div className="mx-auto grid max-w-2xl gap-5 px-5 py-10">
        <section className="rounded-md border border-border bg-white p-6 shadow-leasiumCard">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary-soft p-2 text-primary">
              <ShieldCheck size={20} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-primary">
                Owner portal
              </p>
              <h1 className="text-2xl font-semibold leading-8">
                Owner Account Setup
              </h1>
            </div>
          </div>

          <dl className="mt-5 grid gap-3 text-sm">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Owner
              </dt>
              <dd className="mt-1 text-base font-semibold text-foreground">
                {preview.owner_display_name}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Invite email
              </dt>
              <dd className="mt-1">{preview.claim_email}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Invite expires
              </dt>
              <dd className="mt-1">
                {formatOwnerPortalDateTime(preview.expires_at)}
              </dd>
            </div>
          </dl>

          <div className="mt-6 grid gap-3 text-sm leading-6 text-muted-foreground">
            <p>
              Create or sign in to a Leasium owner login with the invite email.
              Statement and property data stays hidden until the account is
              claimed.
            </p>
            {claimMutation.error ? (
              <p className="text-danger">{friendlyError(claimMutation.error)}</p>
            ) : null}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-transparent bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-primary-hover"
              href={accountHref("/sign-up", token)}
            >
              Create login
            </Link>
            <Link
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
              href={accountHref("/sign-in", token)}
            >
              Sign in
            </Link>
            <Button
              type="button"
              disabled={claimMutation.isPending}
              onClick={() => claimMutation.mutate()}
            >
              <ArrowRight size={16} />
              Open portal
            </Button>
          </div>
        </section>
      </div>
    </OwnerPortalShell>
  );
}

function OwnerPortalInviteContentWithAuth() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  return (
    <OwnerPortalInviteContent
      auth={{
        authLoaded: isLoaded,
        isSignedIn: Boolean(isSignedIn),
        requiresAuthToken: true,
        getAuthToken: () => getToken({ skipCache: true }),
      }}
    />
  );
}

function OwnerPortalInviteContentWithoutAuth() {
  return (
    <OwnerPortalInviteContent
      auth={{
        authLoaded: true,
        isSignedIn: true,
        requiresAuthToken: false,
        getAuthToken: async () => null,
      }}
    />
  );
}

export default function OwnerPortalInvitePage() {
  const ownerAccountAuthEnabled = Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  );

  return ownerAccountAuthEnabled ? (
    <OwnerPortalInviteContentWithAuth />
  ) : (
    <OwnerPortalInviteContentWithoutAuth />
  );
}
