import { expect, test } from "@playwright/test";

test("tenant portal invite loading reassures before exposing tenant details", async ({
  page,
}) => {
  await page.route("**/api/v1/tenant-portal/invites/*/preview", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        property_name: "Queen Street Retail Centre — Shop 3",
        property_address: "12 Queen Street, Brisbane City QLD 4000",
        tenant_display_name: "Bright Cafe",
        tenant_email: "mia@example.com",
        expires_at: "2026-06-30T00:00:00.000Z",
        claimable: true,
      }),
    });
  });

  await page.goto("/tenant-portal/tenant-token-1");

  await expect(
    page.getByRole("heading", { name: "Checking your tenant portal invite" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "We are confirming this secure link before showing any tenant details.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Bright Cafe",
    }),
  ).toBeVisible();
});

test("tenant portal invite error gives a calm recovery path", async ({
  page,
}) => {
  await page.route("**/api/v1/tenant-portal/invites/*/preview", async (route) => {
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Invite not found." }),
    });
  });

  await page.goto("/tenant-portal/tenant-token-1");

  await expect(
    page.getByRole("heading", {
      name: "We could not verify this tenant portal link",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "For your privacy, no tenant details are shown until the property team confirms the link.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Ask the property team to resend your tenant portal invite, then open the newest link.",
    ),
  ).toBeVisible();
});
