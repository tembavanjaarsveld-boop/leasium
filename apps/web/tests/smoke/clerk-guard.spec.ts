import { expect, test } from "@playwright/test";

test.describe("Clerk middleware guard", () => {
  test.skip(
    !process.env.LEASIUM_SMOKE_CLERK_GUARD ||
      !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
      !process.env.CLERK_SECRET_KEY,
    "Runs only with the dedicated Clerk guard smoke environment.",
  );

  test("redirects protected workspace routes before page data loads", async ({
    request,
  }) => {
    const response = await request.get("/settings", {
      headers: { accept: "text/html" },
      maxRedirects: 0,
    });

    expect(response.status()).toBe(307);
    const location = response.headers().location ?? "";
    expect(location).toContain("/sign-in");
    expect(decodeURIComponent(location)).toContain("/settings");
  });

  test("keeps public operator and tenant routes open", async ({ request }) => {
    for (const path of [
      "/setup",
      "/__clerk/v1/client",
      "/accept-invite?token=example",
      "/onboarding/example-token",
      "/api/access",
    ]) {
      const response = await request.get(path, {
        headers: { accept: "text/html" },
        maxRedirects: 0,
      });

      expect(response.status(), path).not.toBe(307);
      expect(response.headers().location ?? "", path).not.toContain("/sign-in");
    }
  });
});
