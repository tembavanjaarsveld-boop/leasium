import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { fallbackAccountUrl, shouldUseFallbackAccountHost } from "@/lib/auth-host";

import AccountPageClient from "./account-page-client";

export default async function AccountPage() {
  const requestHeaders = await headers();

  if (shouldUseFallbackAccountHost(requestHeaders.get("host"))) {
    redirect(fallbackAccountUrl("/account"));
  }

  return <AccountPageClient />;
}
