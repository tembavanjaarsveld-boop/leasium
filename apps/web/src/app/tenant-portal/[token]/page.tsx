"use client";

import { useParams } from "next/navigation";

import { TenantPortalPage } from "../tenant-portal-content";

export default function TokenTenantPortalPage() {
  const params = useParams<{ token: string }>();
  return <TenantPortalPage token={params.token} />;
}
