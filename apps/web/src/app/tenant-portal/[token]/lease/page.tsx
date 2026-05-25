"use client";

import { useParams } from "next/navigation";

import { TenantPortalPage } from "../../tenant-portal-content";

export default function TokenTenantPortalLeasePage() {
  const params = useParams<{ token: string }>();
  return <TenantPortalPage token={params.token} view="lease" />;
}
