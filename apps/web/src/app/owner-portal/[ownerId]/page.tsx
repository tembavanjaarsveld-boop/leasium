"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { QueryProvider } from "@/components/query-provider";
import { getOwnerPortal } from "@/lib/api";
import {
  isManagingAgentOperatingMode,
  useOperatingMode,
} from "@/lib/use-operating-mode";
import { friendlyError } from "@/lib/utils";

import {
  OwnerPortalAccountView,
  OwnerPortalLoading,
  OwnerPortalNotice,
} from "../owner-portal-account-ui";

function OwnerPortalContent() {
  const params = useParams<{ ownerId?: string | string[] }>();
  const searchParams = useSearchParams();
  const { operatingMode, isResolved } = useOperatingMode();
  const showOwnerPortalPreview = isManagingAgentOperatingMode(operatingMode);
  const ownerId = Array.isArray(params.ownerId)
    ? params.ownerId[0]
    : params.ownerId;
  const month = searchParams.get("month") ?? undefined;

  const portalQuery = useQuery({
    queryKey: ["owner-portal", ownerId, month],
    queryFn: () => getOwnerPortal(ownerId ?? "", month ?? ""),
    enabled: Boolean(ownerId && month && showOwnerPortalPreview),
  });

  if (!month) {
    return (
      <OwnerPortalNotice title="Owner portal unavailable" tone="warning">
        <p>
          Statement month is required. Open an owner portal link with a month in
          YYYY-MM format.
        </p>
      </OwnerPortalNotice>
    );
  }

  if (!isResolved) {
    return <OwnerPortalLoading title="Owner portal" />;
  }

  if (!showOwnerPortalPreview) {
    return (
      <OwnerPortalNotice title="Owner portal unavailable">
        <p>
          Owner portal previews are available only for managing-agent or hybrid
          accounts. Self-managed accounts use local entity statements instead of
          landlord-client portals.
        </p>
        <Link
          className="inline-flex min-h-11 w-fit items-center justify-center rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
          href="/statements"
        >
          Open entity statements
        </Link>
      </OwnerPortalNotice>
    );
  }

  if (portalQuery.isLoading) {
    return <OwnerPortalLoading title="Owner portal" />;
  }

  if (portalQuery.error) {
    return (
      <OwnerPortalNotice title="Owner portal unavailable" tone="danger">
        <p>{friendlyError(portalQuery.error)}</p>
      </OwnerPortalNotice>
    );
  }

  if (!portalQuery.data) {
    return null;
  }

  return <OwnerPortalAccountView portal={portalQuery.data} />;
}

function OwnerPortalPageShell() {
  return (
    <Suspense fallback={<OwnerPortalLoading title="Owner portal" />}>
      <OwnerPortalContent />
    </Suspense>
  );
}

export default function OwnerPortalPage() {
  return (
    <QueryProvider>
      <OwnerPortalPageShell />
    </QueryProvider>
  );
}
