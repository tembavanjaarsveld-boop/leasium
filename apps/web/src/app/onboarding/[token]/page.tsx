"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Building2, Clock3, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";

import { LeasiumMark } from "@/components/brand";
import { QueryProvider } from "@/components/query-provider";
import { PageTitle, SectionTitle, StatusBadge } from "@/components/ui";
import {
  getTenantPortalInvitePreview,
  type TenantPortalInvitePreviewRecord,
} from "@/lib/api";

/**
 * Public onboarding entry. The legacy `/onboarding/[token]` form has been
 * retired in favour of the authenticated tenant portal. This page only fetches
 * the lightweight invite preview so the tenant can confirm who and what the
 * invite is for before continuing to the account-first portal gate.
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

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Your property manager can refresh the invite if needed.";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function OnboardingWelcome({ token }: { token: string | null }) {
  const portalHref = token ? `/tenant-portal/${token}` : "/tenant-portal";
  const previewQuery = useQuery({
    queryKey: ["tenant-portal-invite-preview", token],
    queryFn: () => getTenantPortalInvitePreview(token as string),
    enabled: Boolean(token),
    retry: false,
  });
  const preview = previewQuery.data ?? null;

  return (
    <main className="min-h-screen bg-leasium-bg px-5 py-8 sm:py-12">
      <section className="mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)] lg:items-start">
        <header className="flex items-center gap-3 lg:col-span-2">
          <LeasiumMark className="h-12 w-12" />
          <div>
            <SectionTitle>Relby</SectionTitle>
            <p className="text-sm text-muted-foreground">
              Lease operations, automated.
            </p>
          </div>
        </header>

        <div className="rounded-2xl border border-border bg-white p-6 shadow-leasiumSm sm:p-8">
          <AccountFirstInvitation
            portalHref={portalHref}
            preview={preview}
            isLoading={previewQuery.isLoading}
            hasPreviewError={previewQuery.isError}
          />
        </div>

        <aside className="rounded-2xl border border-border bg-white p-5 shadow-leasiumXs">
          <SectionTitle>What happens next</SectionTitle>
          <div className="mt-4 grid gap-4">
            <HandoffStep
              icon={<ShieldCheck size={18} />}
              title="Create or sign in"
              body="Use the tenant portal to connect this invite to your own login."
            />
            <HandoffStep
              icon={<Building2 size={18} />}
              title="Confirm the details"
              body="The portal shows the lease, business, property, and requested onboarding items."
            />
            <HandoffStep
              icon={<Clock3 size={18} />}
              title="Review before updates"
              body="Your property manager reviews anything you submit before it updates your record."
            />
          </div>
        </aside>
      </section>
    </main>
  );
}

function AccountFirstInvitation({
  portalHref,
  preview,
  isLoading,
  hasPreviewError,
}: {
  portalHref: string;
  preview: TenantPortalInvitePreviewRecord | null;
  isLoading: boolean;
  hasPreviewError: boolean;
}) {
  const tenantName = preview?.tenant_display_name ?? "your business";
  const title = preview?.tenant_display_name
    ? `${preview.tenant_display_name}, your tenant portal is ready.`
    : "Your tenant portal is ready.";
  const inviteExpiry = preview?.expires_at
    ? `This invite is available until ${formatDateTime(preview.expires_at)}.`
    : "Your property manager can refresh the invite if it has expired.";

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone="primary">Tenant portal invite</StatusBadge>
        {isLoading ? (
          <span className="text-xs font-medium text-muted-foreground">
            Checking invite context
          </span>
        ) : null}
      </div>
      <div className="grid gap-3">
        <PageTitle>{title}</PageTitle>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Start in the Relby tenant portal so your onboarding is connected to
          your account. You can complete requested details, upload documents,
          and return later without hunting for this invite.
        </p>
      </div>

      {preview ? (
        <dl className="grid gap-3 rounded-xl border border-border bg-leasium-bg p-4 text-sm sm:grid-cols-2">
          <PreviewItem label="Business" value={tenantName} />
          <PreviewItem
            label="Invite email"
            value={preview.tenant_email ?? "Confirmed in the portal"}
          />
          <PreviewItem label="Property / unit" value={preview.property_name} />
          <PreviewItem
            label="Address"
            value={preview.property_address ?? "Confirmed in the portal"}
          />
        </dl>
      ) : (
        <div className="rounded-xl border border-border bg-leasium-bg p-4 text-sm text-muted-foreground">
          {hasPreviewError
            ? "We could not check the invite details from this screen. Continue to the tenant portal to verify the invite or ask your property manager for a fresh link."
            : "Continue to the tenant portal to confirm the business, property, and onboarding details for this invite."}
        </div>
      )}

      <Link href={portalHref} className={CTA_CLASSES}>
        Continue to tenant portal
        <ArrowRight size={16} />
      </Link>
      <p className="text-xs leading-5 text-muted-foreground">
        {inviteExpiry} No lease, payment, or document data is shown until you
        sign in or create your tenant account.
      </p>
    </div>
  );
}

function PreviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 font-medium text-foreground">{value}</dd>
    </div>
  );
}

function HandoffStep({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
        {icon}
      </div>
      <div>
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
