"use client";

import { ClerkProvider, SignInButton, useAuth } from "@clerk/nextjs";
import { Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import {
  ClerkSessionUnavailableNotice,
  useAuthLoadTimeout,
} from "@/components/auth-config-notice";
import { LeasiumMark } from "@/components/brand";
import { Button } from "@/components/ui";
import { primeApiAuthToken, setApiAuthTokenProvider } from "@/lib/api";
import { isPublicOperatorPath } from "@/lib/operator-routes";

function clerkProxyUrl() {
  const configuredProxyUrl = process.env.NEXT_PUBLIC_CLERK_PROXY_URL?.trim();
  return configuredProxyUrl || undefined;
}

function OperatorAuthLoading() {
  return (
    <main className="min-h-screen bg-leasium-bg px-5 py-10 text-foreground">
      <section className="mx-auto grid max-w-xl gap-5">
        <div className="flex items-center gap-3">
          <LeasiumMark className="h-12 w-12" />
          <div>
            <div className="text-sm font-semibold text-primary">
              Leasium operator login
            </div>
            <h1 className="text-2xl font-semibold">Checking your session</h1>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-white p-4 text-sm text-muted-foreground shadow-leasiumXs">
          <Loader2 className="animate-spin text-primary" size={16} />
          Confirming operator access.
        </div>
      </section>
    </main>
  );
}

function OperatorSignInRequired({ returnTo }: { returnTo: string }) {
  return (
    <main className="min-h-screen bg-leasium-bg px-5 py-10 text-foreground">
      <section className="mx-auto grid max-w-xl gap-5">
        <div className="flex items-center gap-3">
          <LeasiumMark className="h-12 w-12" />
          <div>
            <div className="text-sm font-semibold text-primary">
              Leasium operator login
            </div>
            <h1 className="text-2xl font-semibold">
              Sign in to open the workspace
            </h1>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-xl border border-border bg-white p-4 shadow-leasiumXs">
          <div className="rounded-xl bg-primary-soft p-2 text-primary">
            <ShieldCheck size={18} />
          </div>
          <div>
            <h2 className="text-base font-semibold">
              Operator access is required
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Use the email address your property team invited. If this login is
              not recognised, ask an owner or admin to resend your operator
              invite.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <SignInButton mode="redirect" fallbackRedirectUrl={returnTo}>
            <Button type="button">Sign in</Button>
          </SignInButton>
          <Link
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
            href="/welcome"
          >
            Back to welcome
          </Link>
        </div>
      </section>
    </main>
  );
}

function OperatorAuthBridge({ children }: { children: React.ReactNode }) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const authTimedOut = useAuthLoadTimeout(isLoaded);

  useEffect(() => {
    setApiAuthTokenProvider(() => getToken());
    return () => setApiAuthTokenProvider(null);
  }, [getToken]);

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      void primeApiAuthToken();
    }
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (isLoaded && !isSignedIn && pathname === "/") {
      router.replace("/welcome");
    }
  }, [isLoaded, isSignedIn, pathname, router]);

  if (isPublicOperatorPath(pathname)) {
    return <>{children}</>;
  }

  if (!isLoaded) {
    return authTimedOut ? (
      <main className="min-h-screen bg-leasium-bg px-5 py-10 text-foreground">
        <section className="mx-auto grid max-w-xl gap-5">
          <div className="flex items-center gap-3">
            <LeasiumMark className="h-12 w-12" />
            <div>
              <div className="text-sm font-semibold text-primary">
                Leasium operator login
              </div>
              <h1 className="text-2xl font-semibold">Checking your session</h1>
            </div>
          </div>
          <ClerkSessionUnavailableNotice />
        </section>
      </main>
    ) : (
      <OperatorAuthLoading />
    );
  }

  if (!isSignedIn) {
    if (pathname === "/") {
      return <OperatorAuthLoading />;
    }

    return <OperatorSignInRequired returnTo={pathname} />;
  }

  return <>{children}</>;
}

export function OperatorAuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const proxyUrl = clerkProxyUrl();

  if (!publishableKey) {
    return <>{children}</>;
  }

  const proxyProps = proxyUrl ? { proxyUrl } : {};

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      {...proxyProps}
    >
      <OperatorAuthBridge>{children}</OperatorAuthBridge>
    </ClerkProvider>
  );
}
