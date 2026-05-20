"use client";

import { SignInButton, SignUpButton, useUser } from "@clerk/nextjs";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { acceptSecurityInvitation, type SecurityInviteAcceptRecord } from "@/lib/api";

function InviteShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background px-6 py-12 text-foreground">
      <section className="mx-auto grid max-w-lg gap-5 rounded-lg border border-border bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-primary">
          <ShieldCheck size={18} />
          <span className="font-semibold">Leasium operator invite</span>
        </div>
        {children}
      </section>
    </main>
  );
}

function AcceptInviteContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  if (!token) {
    return (
      <>
        <h1 className="text-2xl font-semibold">Invite link missing</h1>
        <p className="text-sm text-muted-foreground">
          Open the invite link from your email so Leasium can match the operator record.
        </p>
      </>
    );
  }

  if (!clerkConfigured) {
    return (
      <>
        <h1 className="text-2xl font-semibold">Clerk is not configured yet</h1>
        <p className="text-sm text-muted-foreground">
          This invite is valid only after Clerk publishable and secret keys are configured.
        </p>
      </>
    );
  }

  return <ClerkInviteLinker token={token} />;
}

function inviteErrorMessage(err: unknown) {
  const message = err instanceof Error ? err.message : "Could not accept this invite.";
  if (message === "Invite not found.") {
    return "This invite link is no longer active. Open the latest invite email or ask an owner/admin to resend it.";
  }
  return message;
}

function ClerkInviteLinker({ token }: { token: string }) {
  const { isLoaded, isSignedIn, user } = useUser();
  const [result, setResult] = useState<SecurityInviteAcceptRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [acceptAttempted, setAcceptAttempted] = useState(false);

  useEffect(() => {
    setResult(null);
    setError(null);
    setSubmitting(false);
    setAcceptAttempted(false);
  }, [token]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user || !token || result || submitting || acceptAttempted) {
      return;
    }
    const email = user.primaryEmailAddress?.emailAddress;
    if (!email) {
      setError("Your Clerk account needs a primary email address before this invite can be linked.");
      setAcceptAttempted(true);
      return;
    }
    setSubmitting(true);
    setAcceptAttempted(true);
    acceptSecurityInvitation({
      token,
      auth_provider_id: user.id,
      email,
      display_name: user.fullName ?? email,
    })
      .then((accepted) => {
        setResult(accepted);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(inviteErrorMessage(err));
      })
      .finally(() => setSubmitting(false));
  }, [acceptAttempted, isLoaded, isSignedIn, result, submitting, token, user]);

  if (!isLoaded || submitting) {
    return (
      <>
        <h1 className="text-2xl font-semibold">Linking your invite</h1>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" />
          Checking your signed-in operator account.
        </div>
      </>
    );
  }

  if (!isSignedIn) {
    return (
      <>
        <h1 className="text-2xl font-semibold">Sign in to accept your invite</h1>
        <p className="text-sm text-muted-foreground">
          Use the same email address the Leasium invite was sent to.
        </p>
        <div className="flex flex-wrap gap-3">
          <SignInButton mode="redirect" fallbackRedirectUrl={`/accept-invite?token=${token}`}>
            <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white">
              Sign in
            </button>
          </SignInButton>
          <SignUpButton mode="redirect" fallbackRedirectUrl={`/accept-invite?token=${token}`}>
            <button className="rounded-md border border-border px-4 py-2 text-sm font-semibold">
              Create login
            </button>
          </SignUpButton>
        </div>
      </>
    );
  }

  if (result) {
    return (
      <>
        <div className="flex items-center gap-2 text-success">
          <CheckCircle2 size={18} />
          <span className="font-semibold">Invite accepted</span>
        </div>
        <h1 className="text-2xl font-semibold">You can now open Leasium.</h1>
        <p className="text-sm text-muted-foreground">
          {result.member.display_name} is linked to provider login for {result.member.email}.
        </p>
        <Link className="rounded-md bg-primary px-4 py-2 text-center text-sm font-semibold text-white" href="/">
          Open workspace
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">Invite needs attention</h1>
      <p className="text-sm text-muted-foreground">
        {error ?? "This invite could not be accepted yet."}
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white"
          onClick={() => {
            setError(null);
            setAcceptAttempted(false);
          }}
          type="button"
        >
          Try again
        </button>
        <Link
          className="rounded-md border border-border px-4 py-2 text-center text-sm font-semibold"
          href="/"
        >
          Open workspace
        </Link>
      </div>
    </>
  );
}

export default function AcceptInvitePage() {
  return (
    <InviteShell>
      <Suspense fallback={<div className="text-sm text-muted-foreground">Loading invite...</div>}>
        <AcceptInviteContent />
      </Suspense>
    </InviteShell>
  );
}
