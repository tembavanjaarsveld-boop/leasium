import { NextRequest, NextResponse } from "next/server";

const ACCESS_COOKIE = "leasium_access";
const ACCESS_TOKEN_INPUT_PREFIX = "leasium-access-v1:";

function accessPassword() {
  return process.env.LEASIUM_ACCESS_PASSWORD?.trim() ?? "";
}

function isPublicPath(pathname: string) {
  return (
    pathname === "/access" ||
    pathname.startsWith("/api/access") ||
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up") ||
    pathname.startsWith("/accept-invite") ||
    pathname.startsWith("/onboarding/") ||
    pathname === "/icon.svg"
  );
}

async function accessToken(password: string) {
  const input = new TextEncoder().encode(`${ACCESS_TOKEN_INPUT_PREFIX}${password}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function middleware(request: NextRequest) {
  const password = accessPassword();
  if (!password || isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const expected = await accessToken(password);
  const supplied = request.cookies.get(ACCESS_COOKIE)?.value;
  if (supplied === expected) {
    return NextResponse.next();
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = "/access";
  redirectUrl.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(redirectUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
