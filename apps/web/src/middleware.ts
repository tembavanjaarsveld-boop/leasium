import { clerkMiddleware } from "@clerk/nextjs/server";
import type { NextFetchEvent } from "next/server";
import { NextRequest, NextResponse } from "next/server";

import { fallbackAccountUrl, shouldUseFallbackAccountHost } from "@/lib/auth-host";
import { isPublicOperatorPath } from "@/lib/operator-routes";

const ACCESS_COOKIE = "leasium_access";
const ACCESS_TOKEN_INPUT_PREFIX = "leasium-access-v1:";

function accessPassword() {
  return process.env.LEASIUM_ACCESS_PASSWORD?.trim() ?? "";
}

function isClerkProxyPath(pathname: string) {
  return pathname === "/__clerk" || pathname.startsWith("/__clerk/");
}

function isFallbackAccountPath(pathname: string) {
  return [
    "/account",
    "/accept-invite",
    "/setup",
    "/sign-in",
    "/sign-up",
    "/tenant-portal",
  ].some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function redirectFallbackAccountHost(request: NextRequest) {
  if (
    !isFallbackAccountPath(request.nextUrl.pathname) ||
    !shouldUseFallbackAccountHost(request.headers.get("host"))
  ) {
    return null;
  }

  return NextResponse.redirect(
    fallbackAccountUrl(request.nextUrl.pathname, request.nextUrl.search),
  );
}

function clerkServerConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() &&
      process.env.CLERK_SECRET_KEY?.trim(),
  );
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
      enabled: true,
    },
  },
);

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const fallbackAccountResponse = redirectFallbackAccountHost(request);
  if (fallbackAccountResponse) {
    return fallbackAccountResponse;
  }

  if (clerkServerConfigured()) {
    const accessResponse = await enforceAccessGate(request);
    if (accessResponse) {
      return accessResponse;
    }

    if (isClerkProxyPath(request.nextUrl.pathname)) {
      return clerkProtectedMiddleware(request, event);
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
