"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { LeasiumMark } from "@/components/brand";
import { Button } from "@/components/ui";

/**
 * The standalone tenant onboarding form has been retired in favour of the
 * authenticated tenant portal. The portal hosts the same fields plus
 * documents, maintenance requests, and (eventually) DocuSign — the agent now
 * sends a portal invite instead of a public onboarding link.
 *
 * Tenants who land here from an older email are redirected to the portal
 * sign-up flow, where the same onboarding token still unlocks their record
 * via the existing portal claim path.
 */
export default function RetiredPublicOnboardingPage() {
  const params = useParams<{ token: string }>();
  const portalHref = params?.token
    ? `/tenant-portal/${params.token}`
    : "/tenant-portal";
  return (
    <main className="min-h-screen bg-muted/40 px-5 py-10">
      <div className="mx-auto grid max-w-xl gap-5">
        <header className="flex items-center gap-3">
          <LeasiumMark />
          <span className="text-sm font-medium text-primary">
            Tenant Onboarding
          </span>
        </header>
        <section className="rounded-md border border-border bg-white p-6">
          <h1 className="text-xl font-semibold">
            Your onboarding has moved into your Leasium account.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We now collect onboarding details inside the tenant portal, where
            you can also see your lease, upload documents, and log maintenance
            requests. The link your agent sent will sign you in.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            If you were following an older email, click below to continue in
            the portal. Your property manager will see your submission for
            review and confirm it from their side.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href={portalHref}>
              <Button type="button">
                Open the tenant portal
                <ArrowRight size={16} />
              </Button>
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
