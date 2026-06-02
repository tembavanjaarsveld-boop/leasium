"use client";

import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, LogIn, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import {
  VendorPortalAccountView,
  VendorPortalLoading,
  VendorPortalNotice,
  VendorPortalShell,
  formatVendorPortalDateTime,
} from "../../vendor-portal-account-ui";
import {
  claimVendorPortalAccount,
  getVendorPortalInvitePreview,
} from "@/lib/api";
import { Button } from "@/components/ui";
import { friendlyError } from "@/lib/utils";

function accountHref(path: string, token: string) {
  const returnTo = `/vendor-portal/invite/${encodeURIComponent(token)}`;
  return `${path}?redirect_url=${encodeURIComponent(returnTo)}`;
}

type VendorPortalInviteAuthContext = {
  authLoaded: boolean;
  isSignedIn: boolean;
  requiresAuthToken: boolean;
  getAuthToken: () => Promise<string | null>;
};

function VendorPortalInviteContent({
  auth,
}: {
  auth: VendorPortalInviteAuthContext;
}) {
  const params = useParams<{ token?: string | string[] }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  const previewQuery = useQuery({
    queryKey: ["vendor-portal-invite-preview", token],
    queryFn: () => getVendorPortalInvitePreview(token as string),
    enabled: Boolean(token),
    retry: false,
  });
  const claimMutation = useMutation({
    mutationFn: async () => {
      if (!token) {
        throw new Error("Vendor portal token is required.");
      }
      if (auth.requiresAuthToken) {
        if (!auth.authLoaded || !auth.isSignedIn) {
          throw new Error("Sign in before claiming the vendor portal invite.");
        }
        const authToken = await auth.getAuthToken();
        if (!authToken) {
          throw new Error("Sign in before claiming the vendor portal invite.");
        }
        return claimVendorPortalAccount(token, authToken);
      }
      return claimVendorPortalAccount(token);
    },
  });

  if (!token) {
    return (
      <VendorPortalNotice title="Vendor portal link unavailable" tone="danger">
        <p>Open the vendor portal link sent by the property team.</p>
      </VendorPortalNotice>
    );
  }

  if (claimMutation.data) {
    return (
      <VendorPortalAccountView
        portal={claimMutation.data}
        getAuthToken={auth.getAuthToken}
        requiresAuthToken={auth.requiresAuthToken}
      />
    );
  }

  if (previewQuery.isLoading) {
    return <VendorPortalLoading title="Checking vendor portal link" />;
  }

  if (previewQuery.error || !previewQuery.data) {
    return (
      <VendorPortalNotice
        title="We could not verify this vendor portal link"
        tone="danger"
      >
        <p>
          For privacy, no job detail is shown until the property team confirms
          the link.
        </p>
        <p>
          Ask the property team to send a fresh vendor portal link, then open the
          newest link.
        </p>
      </VendorPortalNotice>
    );
  }

  const preview = previewQuery.data;

  if (!preview.claimable) {
    return (
      <VendorPortalNotice title="Vendor portal link already claimed" tone="warning">
        <p>
          This vendor portal link has already been used. Sign in with the login
          it was claimed by, or ask the property team for a fresh link.
        </p>
        <Link
          className="inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-xl border border-transparent bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-primary-hover"
          href={accountHref("/sign-in", token)}
        >
          <LogIn size={16} />
          Sign in
        </Link>
      </VendorPortalNotice>
    );
  }

  return (
    <VendorPortalShell>
      <div className="mx-auto grid max-w-2xl gap-5 px-5 py-10">
        <section className="rounded-md border border-border bg-white p-6 shadow-leasiumCard">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary-soft p-2 text-primary">
              <ShieldCheck size={20} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-primary">Vendor portal</p>
              <h1 className="text-2xl font-semibold leading-8">
                Contractor sign-in
              </h1>
            </div>
          </div>

          <dl className="mt-5 grid gap-3 text-sm">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Vendor
              </dt>
              <dd className="mt-1 text-base font-semibold text-foreground">
                {preview.vendor_display_name}
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
                {formatVendorPortalDateTime(preview.expires_at)}
              </dd>
            </div>
          </dl>

          <div className="mt-6 grid gap-3 text-sm leading-6 text-muted-foreground">
            <p>
              Create or sign in to a Leasium login with the invite email. Your
              jobs stay hidden until the account is claimed.
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
    </VendorPortalShell>
  );
}

function VendorPortalInviteContentWithAuth() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  return (
    <VendorPortalInviteContent
      auth={{
        authLoaded: isLoaded,
        isSignedIn: Boolean(isSignedIn),
        requiresAuthToken: true,
        getAuthToken: () => getToken({ skipCache: true }),
      }}
    />
  );
}

function VendorPortalInviteContentWithoutAuth() {
  return (
    <VendorPortalInviteContent
      auth={{
        authLoaded: true,
        isSignedIn: true,
        requiresAuthToken: false,
        getAuthToken: async () => null,
      }}
    />
  );
}

export default function VendorPortalInvitePage() {
  const vendorAccountAuthEnabled = Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  );

  return vendorAccountAuthEnabled ? (
    <VendorPortalInviteContentWithAuth />
  ) : (
    <VendorPortalInviteContentWithoutAuth />
  );
}
