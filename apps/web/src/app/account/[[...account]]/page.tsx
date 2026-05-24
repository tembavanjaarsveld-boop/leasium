import { headers } from "next/headers";
import { redirect } from "next/navigation";

import AccountPageClient from "./account-page-client";

const fallbackAccountOrigin =
  process.env.NEXT_PUBLIC_LEASIUM_ACCOUNT_ORIGIN ?? "https://leasium.vercel.app";

const primaryCustomHosts = new Set(["leasium.ai", "www.leasium.ai"]);

function hasCustomClerkHost() {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PROXY_URL?.trim() ||
      process.env.NEXT_PUBLIC_CLERK_DOMAIN?.trim(),
  );
}

function shouldUseFallbackAccountHost(host: string | null) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || hasCustomClerkHost()) {
    return false;
  }
  const hostname = host?.split(":")[0]?.toLowerCase();
  return hostname ? primaryCustomHosts.has(hostname) : false;
}

export default async function AccountPage() {
  const requestHeaders = await headers();

  if (shouldUseFallbackAccountHost(requestHeaders.get("host"))) {
    redirect(`${fallbackAccountOrigin}/account`);
  }

  return <AccountPageClient />;
}
