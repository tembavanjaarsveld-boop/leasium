import { clerkMiddleware } from "@clerk/nextjs/server";
import type { NextFetchEvent } from "next/server";
import { NextRequest, NextResponse } from "next/server";

import { isPublicOperatorPath } from "@/lib/operator-routes";

const ACCESS_COOKIE = "leasium_access";
const ACCESS_TOKEN_INPUT_PREFIX = "leasium-access-v1:";
const CANONICAL_WEB_HOST = "leasium.ai";
const VERCEL_PROVIDER_HOST = "leasium.vercel.app";

function hostWithoutPort(host: string | null) {
  return (host ?? "").split(":")[0]?.toLowerCase() ?? "";
}

function redirectProviderAlias(request: NextRequest) {
  if (hostWithoutPort(request.headers.get("host")) !== VERCEL_PROVIDER_HOST) {
    return null;
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.protocol = "https:";
  redirectUrl.hostname = CANONICAL_WEB_HOST;
  redirectUrl.port = "";
  return NextResponse.redirect(redirectUrl, 308);
}

function accessPassword() {
  return process.env.LEASIUM_ACCESS_PASSWORD?.trim() ?? "";
}

function isClerkProxyPath(pathname: string) {
  return pathname === "/__clerk" || pathname.startsWith("/__clerk/");
}

function clerkServerConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() &&
      process.env.CLERK_SECRET_KEY?.trim(),
  );
}

function clerkProxyEnabled() {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PROXY_URL?.trim());
}

async function accessToken(password: string) {
  const input = new TextEncoder().encode(`${ACCESS_TOKEN_INPUT_PREFIX}${password}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function enforceAccessGate(request: NextRequest) {
  const password = accessPassword();
  if (
    !password ||
    isClerkProxyPath(request.nextUrl.pathname) ||
    isPublicOperatorPath(request.nextUrl.pathname)
  ) {
    return null;
  }

  const expected = await accessToken(password);
  const supplied = request.cookies.get(ACCESS_COOKIE)?.value;
  if (supplied === expected) {
    return null;
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = "/access";
  redirectUrl.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(redirectUrl);
}

const clerkProtectedMiddleware = clerkMiddleware(
  async (auth, request) => {
    if (isClerkProxyPath(request.nextUrl.pathname)) {
      return NextResponse.next();
    }

    const authState = await auth();
    if (!authState.userId) {
      if (request.nextUrl.pathname === "/") {
        const welcomeUrl = request.nextUrl.clone();
        welcomeUrl.pathname = "/welcome";
        welcomeUrl.search = "";
        return NextResponse.redirect(welcomeUrl);
      }

      const signInUrl = request.nextUrl.clone();
      signInUrl.pathname = "/sign-in";
      signInUrl.searchParams.set(
        "redirect_url",
        `${request.nextUrl.pathname}${request.nextUrl.search}`,
      );
      return NextResponse.redirect(signInUrl);
    }

    return NextResponse.next();
  },
  {
    frontendApiProxy: {
      enabled: clerkProxyEnabled,
    },
  },
);

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const canonicalResponse = redirectProviderAlias(request);
  if (canonicalResponse) {
    return canonicalResponse;
  }

  if (clerkServerConfigured()) {
    const accessResponse = await enforceAccessGate(request);
    if (accessResponse) {
      return accessResponse;
    }

    if (isClerkProxyPath(request.nextUrl.pathname)) {
      return clerkProtectedMiddleware(request, event);
    }

    if (request.nextUrl.pathname === "/") {
      return NextResponse.next();
    }

    if (!isPublicOperatorPath(request.nextUrl.pathname)) {
      return clerkProtectedMiddleware(request, event);
    }

    return NextResponse.next();
  }

  const accessResponse = await enforceAccessGate(request);
  return accessResponse ?? NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
