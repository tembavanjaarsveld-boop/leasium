const fallbackAccountOrigin =
  process.env.NEXT_PUBLIC_LEASIUM_ACCOUNT_ORIGIN ?? "https://leasium.vercel.app";

const primaryCustomHosts = new Set(["leasium.ai", "www.leasium.ai"]);

export function hasCustomClerkHost() {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PROXY_URL?.trim() ||
      process.env.NEXT_PUBLIC_CLERK_DOMAIN?.trim(),
  );
}

export function shouldUseFallbackAccountHost(host: string | null | undefined) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || hasCustomClerkHost()) {
    return false;
  }

  const hostname = host?.split(":")[0]?.toLowerCase();
  return hostname ? primaryCustomHosts.has(hostname) : false;
}

export function fallbackAccountUrl(pathname: string, search = "") {
  const normalizedPathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${fallbackAccountOrigin}${normalizedPathname}${search}`;
}
