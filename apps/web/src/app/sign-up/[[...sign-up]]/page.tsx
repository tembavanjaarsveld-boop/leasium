"use client";

import { SignUp } from "@clerk/nextjs";
import { UserPlus } from "lucide-react";
import Link from "next/link";

import { clerkEmailOnlyAppearance } from "@/lib/clerk-appearance";

function ClerkNotConfigured() {
  return (
    <main className="min-h-screen bg-background px-6 py-12 text-foreground">
      <section className="mx-auto grid max-w-md gap-4 rounded-lg border border-border bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-primary">
          <UserPlus size={18} />
          <span className="font-semibold">Leasium operator signup</span>
        </div>
        <h1 className="text-2xl font-semibold">Provider signup is not configured yet.</h1>
        <p className="text-sm text-muted-foreground">
          Clerk keys need to be added before invite acceptance can create a login.
        </p>
        <Link className="text-sm font-semibold text-primary" href="https://leasium.ai/welcome">
          Open live Leasium
        </Link>
      </section>
    </main>
  );
}

export default function SignUpPage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <ClerkNotConfigured />;
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 py-12">
      <div className="grid justify-items-center gap-4">
        <SignUp
          appearance={clerkEmailOnlyAppearance}
          routing="path"
          path="/sign-up"
          signInUrl="/sign-in"
          fallbackRedirectUrl="/account"
        />
        <Link
          className="text-sm font-semibold text-muted-foreground transition hover:text-primary"
          href="/welcome"
        >
          Back to welcome
        </Link>
      </div>
    </main>
  );
}
