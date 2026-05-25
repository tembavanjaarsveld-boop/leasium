"use client";

import { SignIn, UserButton, useAuth, useUser } from "@clerk/nextjs";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  ClerkSessionUnavailableNotice,
  useAuthLoadTimeout,
} from "@/components/auth-config-notice";
import { LeasiumMark } from "@/components/brand";
import { getCurrentOperator, getTenantPortalAccountSession } from "@/lib/api";

type RouteState = "idle" | "checking" | "operator" | "tenant" | "unlinked" | "error";

function AccountShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-leasium-bg px-5 py-10 text-foreground">
      <section className="mx-auto grid max-w-5xl gap-6">
        <Link
          href="/welcome"
          className="inline-flex w-fit items-center gap-3 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leasium-blue"
        >
          <LeasiumMark className="h-10 w-10" />
          <span className="text-base font-semibold tracking-tight text-leasium-navy-800">
            Leasium
          </span>
        </Link>
        {children}
      </section>
    </main>
  );
}

function ClerkNotConfigured() {
  return (
    <AccountShell>
      <div className="grid max-w-xl gap-4 rounded-lg border border-border bg-white p-6 shadow-leasiumXs">
        <div className="flex items-center gap-2 text-primary">
          <ShieldCheck size={18} />
          <span className="font-semibold">Leasium account login</span>
        </div>
        <h1 className="text-2xl font-semibold">Provider login is not configured yet.</h1>
        <p className="text-sm text-muted-foreground">
          Add Clerk keys to this environment before Leasium accounts can sign in here.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-leasiumXs transition hover:bg-primary-hover"
            href="https://leasium.ai/welcome"
          >
            Open live Leasium
          </Link>
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition hover:bg-muted"
            href="/setup"
          >
            First workspace setup
          </Link>
        </div>
      </div>
    </AccountShell>
  );
}

function AccountSignIn() {
  return (
    <AccountShell>
      <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
        <div className="grid gap-4">
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-leasium-blue-soft px-3 py-1 text-xs font-semibold uppercase tracking-wider text-leasium-blue">
            One Leasium login
          </span>
          <h1 className="text-3xl font-bold tracking-tight text-leasium-navy-800 sm:text-4xl">
            Sign in once. Leasium opens the right workspace.
          </h1>
          <p className="text-base leading-relaxed text-leasium-slate-500">
            Operators go to the property team workspace. Tenants go to the tenant
            portal linked to their invite.
          </p>
          <div className="grid gap-3 text-sm text-leasium-slate-600">
            <div className="flex items-start gap-3 rounded-xl border border-border bg-white p-4">
              <Building2 className="mt-0.5 text-leasium-blue" size={18} />
              <div>
                <p className="font-semibold text-leasium-navy-800">Property teams</p>
                <p>Use the operator account invited by the Leasium admin.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-xl border border-border bg-white p-4">
              <UserRound className="mt-0.5 text-success-strong" size={18} />
              <div>
                <p className="font-semibold text-leasium-navy-800">Tenants</p>
                <p>Use the account created from the tenant invite email.</p>
              </div>
            </div>
          </div>
        </div>
        <div className="grid justify-items-center gap-4 rounded-xl border border-border bg-white p-4 shadow-leasiumMd sm:p-6">
          <SignIn
            routing="path"
            path="/account"
            signUpUrl="/sign-up?redirect_url=%2Faccount"
            fallbackRedirectUrl="/account"
          />
          <Link
            className="text-sm font-semibold text-muted-foreground transition hover:text-primary"
            href="/welcome"
          >
            Back to welcome
          </Link>
        </div>
      </div>
    </AccountShell>
  );
}

function AccountRouter() {
  const router = useRouter();
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const [routeState, setRouteState] = useState<RouteState>("idle");
  const [routeError, setRouteError] = useState<string | null>(null);
  const authTimedOut = useAuthLoadTimeout(isLoaded);

  useEffect(() => {
    let cancelled = false;

    async function routeSignedInAccount() {
      if (!isLoaded) {
        return;
      }
      if (!isSignedIn) {
        setRouteState("idle");
        setRouteError(null);
        return;
      }

      setRouteState("checking");
      setRouteError(null);

      try {
        const authToken = await getToken();
        if (!authToken) {
          throw new Error("Your signed-in session could not be verified.");
        }

        try {
          await getCurrentOperator(authToken);
          if (!cancelled) {
            setRouteState("operator");
            router.replace("/");
          }
          return;
        } catch {
          // This Clerk login is not an operator; tenants are checked next.
        }

        try {
          await getTenantPortalAccountSession(authToken);
          if (!cancelled) {
            setRouteState("tenant");
            router.replace("/tenant-portal");
          }
          return;
        } catch {
          if (!cancelled) {
            setRouteState("unlinked");
          }
        }
      } catch (error) {
        if (!cancelled) {
          setRouteState("error");
          setRouteError(
            error instanceof Error
              ? error.message
              : "Leasium could not verify this account.",
          );
        }
      }
    }

    routeSignedInAccount();
    return () => {
      cancelled = true;
    };
  }, [getToken, isLoaded, isSignedIn, router]);

  if (!isLoaded) {
    return (
      <AccountShell>
        {authTimedOut ? (
          <ClerkSessionUnavailableNotice className="max-w-xl" />
        ) : (
          <div className="flex max-w-xl items-center gap-3 rounded-xl border border-border bg-white p-5 text-sm text-muted-foreground shadow-leasiumXs">
            <Loader2 className="animate-spin text-primary" size={18} />
            Checking your Leasium session.
          </div>
        )}
      </AccountShell>
    );
  }

  if (!isSignedIn) {
    return <AccountSignIn />;
  }

  if (routeState === "checking" || routeState === "operator" || routeState === "tenant") {
    return (
      <AccountShell>
        <div className="grid max-w-xl gap-4 rounded-xl border border-border bg-white p-6 shadow-leasiumXs">
          <div className="flex items-center gap-3">
            <Loader2 className="animate-spin text-primary" size={20} />
            <div>
              <h1 className="text-xl font-semibold text-leasium-navy-800">
                Opening your Leasium account
              </h1>
              <p className="text-sm text-muted-foreground">
                {user?.primaryEmailAddress?.emailAddress ??
                  "Checking where this login belongs."}
              </p>
            </div>
          </div>
        </div>
      </AccountShell>
    );
  }

  return (
    <AccountShell>
      <div className="grid max-w-2xl gap-5 rounded-xl border border-border bg-white p-6 shadow-leasiumXs">
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-2">
            <div className="flex items-center gap-2 text-warning-strong">
              <ShieldCheck size={18} />
              <span className="font-semibold">Account not linked yet</span>
            </div>
            <h1 className="text-2xl font-semibold text-leasium-navy-800">
              This login is not attached to a Leasium workspace.
            </h1>
          </div>
          <UserButton />
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {routeState === "error"
            ? routeError
            : "Operators need an operator invite. Tenants need to open their tenant invite email once so Leasium can connect the login to the right portal."}
        </p>
        <div className="grid gap-3 rounded-xl border border-border bg-leasium-slate-50 p-4 text-sm">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 text-success-strong" size={16} />
            <span>Already a tenant? Ask the property team for a fresh portal link.</span>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 text-success-strong" size={16} />
            <span>Already an operator? Ask an owner/admin to resend your invite.</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-leasiumXs transition hover:bg-primary-hover"
            href="/welcome"
          >
            Back to welcome
            <ArrowRight size={16} />
          </Link>
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition hover:bg-muted"
            href="/tenant-portal"
          >
            Tenant portal
          </Link>
        </div>
      </div>
    </AccountShell>
  );
}

export default function AccountPageClient() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <ClerkNotConfigured />;
  }

  return <AccountRouter />;
}
