"use client";

import { SignIn } from "@clerk/nextjs";
import { ShieldCheck } from "lucide-react";
import Link from "next/link";

function ClerkNotConfigured() {
  return (
    <main className="min-h-screen bg-background px-6 py-12 text-foreground">
      <section className="mx-auto grid max-w-md gap-4 rounded-lg border border-border bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-primary">
          <ShieldCheck size={18} />
          <span className="font-semibold">Leasium operator login</span>
        </div>
        <h1 className="text-2xl font-semibold">Provider login is not configured yet.</h1>
        <p className="text-sm text-muted-foreground">
          Clerk keys need to be added before operator sign-in can run.
        </p>
        <Link className="text-sm font-semibold text-primary" href="https://leasium.ai/welcome">
          Open live Leasium
        </Link>
      </section>
    </main>
  );
}

export default function SignInPage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <ClerkNotConfigured />;
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 py-12">
      <div className="grid justify-items-center gap-4">
        <SignIn
          routing="path"
          path="/sign-in"
          signUpUrl="/sign-up"
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
