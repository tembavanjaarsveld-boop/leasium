"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarClock, MapPin, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { LeasiumMark } from "@/components/brand";
import { QueryProvider } from "@/components/query-provider";
import { PageTitle, SectionTitle, StatusBadge } from "@/components/ui";
import { getTenantPortal, type TenantPortalRecord } from "@/lib/api";

/**
 * Public onboarding entry. The legacy `/onboarding/[token]` form has been
 * retired in favour of the authenticated tenant portal, but the page itself
 * is the first thing a tenant sees from an agent's email — so it stays a
 * real first-impression surface (welcome, who-invited-you, property
 * context, due-date reassurance, calm hand-off) rather than a redirect stub.
 *
 * The token used on `/onboarding/[token]` and `/tenant-portal/[token]` is
 * the same value, so `getTenantPortal(token)` resolves the tenant + lease
 * context here just as it does on the portal page.
 */
export default function PublicOnboardingPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? null;
  return (
    <QueryProvider>
      <OnboardingWelcome token={token} />
    </QueryProvider>
  );
}

const CTA_CLASSES =
  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-transparent bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

function OnboardingWelcome({ token }: { token: string | null }) {
  const portalHref = token ? `/tenant-portal/${token}` : "/tenant-portal";
  const portalQuery = useQuery({
    queryKey: ["public-onboarding", token],
    queryFn: () => getTenantPortal(token ?? ""),
    enabled: Boolean(token),
    retry: false,
    staleTime: 60_000,
  });

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
          {portalQuery.isLoading ? (
            <LoadingState />
          ) : portalQuery.data ? (
            <ResolvedInvitation
              portal={portalQuery.data}
              portalHref={portalHref}
            />
          ) : (
            <FallbackInvitation portalHref={portalHref} />
          )}
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Nothing is submitted until you review and approve it.
        </p>
      </section>
    </main>
  );
}

function LoadingState() {
  return (
    <div className="grid gap-3" aria-busy="true">
      <div className="h-7 w-2/3 animate-pulse rounded-md bg-muted" />
      <div className="h-4 w-full animate-pulse rounded-md bg-muted" />
      <div className="h-4 w-5/6 animate-pulse rounded-md bg-muted" />
      <div className="mt-3 h-11 w-full animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

function FallbackInvitation({ portalHref }: { portalHref: string }) {
  return (
    <div className="grid gap-4">
      <PageTitle>You’re invited to onboard.</PageTitle>
      <p className="text-sm leading-6 text-muted-foreground">
        Onboarding now happens inside your Leasium tenant account. Continue
        to the portal to sign in (or create an account with the email address
        your invitation was sent to) and complete the rest of the details.
      </p>
      <Link href={portalHref} className={CTA_CLASSES}>
        Continue to portal
        <ArrowRight size={16} />
      </Link>
      <p className="text-xs text-muted-foreground">
        If your invitation link has expired, your property manager can send
        a fresh one.
      </p>
    </div>
  );
}

function ResolvedInvitation({
  portal,
  portalHref,
}: {
  portal: TenantPortalRecord;
  portalHref: string;
}) {
  const tenantName =
    portal.tenant.trading_name?.trim() ||
    portal.tenant.legal_name?.trim() ||
    portal.tenant.contact_name?.trim() ||
    null;
  const propertyName = portal.lease.property_name?.trim() || null;
  const propertyAddress = portal.lease.property_address?.trim() || null;
  const unitLabel = portal.lease.unit_label?.trim() || null;
  const dueDate = formatDateOnly(portal.onboarding.due_date);
  const expiresAt = formatDateOnly(portal.onboarding.expires_at);
  const submitted = Boolean(portal.onboarding.submitted_at);

  // Status badge tone: submitted = success; live invite = primary;
  // anything else (cancelled, expired) renders neutral copy below.
  const statusTone = submitted
    ? ("success" as const)
    : portal.onboarding.status === "live"
      ? ("primary" as const)
      : ("neutral" as const);
  const statusLabel = submitted
    ? "Submitted"
    : portal.onboarding.status === "live"
      ? "Invitation active"
      : titleCase(portal.onboarding.status);

  const ctaLabel = submitted ? "Open your portal" : "Continue to portal";

  return (
    <div className="grid gap-5">
      <div className="grid gap-3">
        <StatusBadge tone={statusTone}>{statusLabel}</StatusBadge>
        <PageTitle>
          {submitted
            ? "You’ve already submitted your onboarding."
            : tenantName
              ? `Welcome, ${tenantName}.`
              : "You’re invited to onboard."}
        </PageTitle>
        <p className="text-sm leading-6 text-muted-foreground">
          {submitted ? (
            <>
              Thanks &mdash; your property manager will review and confirm.
              Open your portal to see the latest status and add documents.
            </>
          ) : propertyName ? (
            <>
              You{"’"}ve been invited to complete onboarding for{" "}
              <span className="font-medium text-foreground">
                {propertyName}
                {unitLabel ? `, ${unitLabel}` : ""}
              </span>
              . Onboarding now happens inside your Leasium tenant account.
            </>
          ) : (
            <>
              You{"’"}ve been invited to complete tenant onboarding.
              Onboarding now happens inside your Leasium tenant account.
            </>
          )}
        </p>
      </div>

      {(propertyName || unitLabel || propertyAddress) && !submitted ? (
        <div className="grid gap-2 rounded-xl border border-border bg-muted/30 p-4 text-sm">
          {propertyName ? (
            <div className="flex items-start gap-2.5">
              <MapPin size={16} className="mt-0.5 shrink-0 text-primary" />
              <div className="min-w-0">
                <div className="font-medium text-foreground">
                  {propertyName}
                  {unitLabel ? `, ${unitLabel}` : ""}
                </div>
                {propertyAddress ? (
                  <div className="text-muted-foreground">{propertyAddress}</div>
                ) : null}
              </div>
            </div>
          ) : null}
          {dueDate || expiresAt ? (
            <div className="flex items-start gap-2.5">
              <CalendarClock
                size={16}
                className="mt-0.5 shrink-0 text-primary"
              />
              <div className="min-w-0 text-muted-foreground">
                {dueDate ? (
                  <span className="text-foreground">
                    Onboarding due {dueDate}
                  </span>
                ) : null}
                {dueDate && expiresAt ? " · " : ""}
                {expiresAt ? <span>link expires {expiresAt}</span> : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <Link href={portalHref} className={CTA_CLASSES}>
        {ctaLabel}
        <ArrowRight size={16} />
      </Link>

      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-primary-soft/40 p-3 text-xs text-muted-foreground">
        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-primary" />
        <span>
          Your property manager only sees what you submit. Nothing is applied
          to your record until they review and confirm it.
        </span>
      </div>
    </div>
  );
}

function formatDateOnly(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return new Intl.DateTimeFormat("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(date);
  } catch {
    return null;
  }
}

function titleCase(value: string): string {
  if (!value) return value;
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
