import { NextRequest, NextResponse } from "next/server";

const ACCESS_COOKIE = "leasium_access";
const ACCESS_TOKEN_INPUT_PREFIX = "leasium-access-v1:";
const ACCESS_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

function accessPassword() {
  return process.env.LEASIUM_ACCESS_PASSWORD?.trim() ?? "";
}

async function accessToken(password: string) {
  const input = new TextEncoder().encode(`${ACCESS_TOKEN_INPUT_PREFIX}${password}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function safeNextPath(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

export async function POST(request: NextRequest) {
  const configuredPassword = accessPassword();
  if (!configuredPassword) {
    return NextResponse.json({ ok: true, next: "/" });
  }

  let payload: { password?: unknown; next?: unknown } = {};
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    payload = {};
  }

  if (payload.password !== configuredPassword) {
    return NextResponse.json(
      { ok: false, message: "That password does not look right." },
      { status: 401 },
    );
  }

  const response = NextResponse.json({
    ok: true,
    next: safeNextPath(payload.next),
  });
  response.cookies.set(ACCESS_COOKIE, await accessToken(configuredPassword), {
    httpOnly: true,
    maxAge: ACCESS_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

export function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACCESS_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
