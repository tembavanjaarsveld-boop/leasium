"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { LeasiumMark } from "@/components/brand";
import { PageTitle, SectionTitle } from "@/components/ui";

/**
 * Public onboarding entry. The legacy `/onboarding/[token]` form has been
 * retired in favour of the authenticated tenant portal. This page does not
 * fetch token-scoped portal data; it only hands the tenant to the account-first
 * portal gate where they create or sign in to their tenant account before
 * onboarding continues.
 */
export default function PublicOnboardingPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? null;
  return <OnboardingWelcome token={token} />;
}

const CTA_CLASSES =
  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-transparent bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

function OnboardingWelcome({ token }: { token: string | null }) {
  const portalHref = token ? `/tenant-portal/${token}` : "/tenant-portal";

  return (
    <main className="grid min-h-screen place-items-center bg-leasium-bg px-5 py-10">
      <section className="w-full max-w-xl">
        <header className="mb-6 flex items-center gap-3">
          <LeasiumMark className="h-12 w-12" />
          <div>
            <SectionTitle>Leasium</SectionTitle>
            <p className="text-sm text-muted-foreground">
              Lease operations, automated.
            </p>
          </div>
        </header>

        <div className="rounded-2xl border border-border bg-white p-6 shadow-leasiumSm">
          <AccountFirstInvitation portalHref={portalHref} />
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Your property manager reviews anything you submit before it updates
          your record.
        </p>
      </section>
    </main>
  );
}

function AccountFirstInvitation({ portalHref }: { portalHref: string }) {
  return (
    <div className="grid gap-4">
      <PageTitle>Set up your tenant account.</PageTitle>
      <p className="text-sm leading-6 text-muted-foreground">
        Your onboarding now happens inside the Leasium tenant portal. Create
        your tenant account or sign in first, then you can complete onboarding,
        upload documents, and return to the portal without the invite link.
      </p>
      <Link href={portalHref} className={CTA_CLASSES}>
        Create account or sign in
        <ArrowRight size={16} />
      </Link>
      <p className="text-xs text-muted-foreground">
        If your invitation link has expired, your property manager can send
        a fresh one.
      </p>
    </div>
  );
}
