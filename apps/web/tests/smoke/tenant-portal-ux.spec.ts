import { expect, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

test("tenant portal invite loading reassures before exposing tenant details", async ({
  page,
}) => {
  await page.route("**/api/v1/tenant-portal/invites/*/preview", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        tenant_id: "tenant-1",
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

test("tenant portal operator preview shows a not-found recovery state", async ({
  page,
}) => {
  await mockLeasiumApi(page);
  await page.route(
    "**/api/v1/tenant-portal/operator-preview/missing-onboarding",
    async (route) => {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Tenant portal preview not found." }),
      });
    },
  );

  await page.goto("/tenants/tenant-1/portal-preview/missing-onboarding");

  await expect(
    page.getByRole("heading", { name: "Tenant portal preview not found" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "This tenant portal preview may have been deleted or moved. Return to the tenant record to choose another onboarding.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to tenant" }),
  ).toHaveAttribute("href", "/tenants/tenant-1");
  await expect(page.getByText("Tenant portal preview unavailable")).toHaveCount(
    0,
  );
});

test("tenant portal operator preview keeps service failures unavailable", async ({
  page,
}) => {
  await mockLeasiumApi(page);
  await page.route(
    "**/api/v1/tenant-portal/operator-preview/broken-onboarding",
    async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "Tenant portal preview service unavailable.",
        }),
      });
    },
  );

  await page.goto("/tenants/tenant-1/portal-preview/broken-onboarding");

  await expect(
    page.getByRole("heading", { name: "Tenant portal preview unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByText("Tenant portal preview service unavailable."),
  ).toBeVisible();
  await expect(
    page.getByText("Tenant portal preview not found"),
  ).toHaveCount(0);
});

test("tenant portal operator preview rechecks cached previews on return", async ({
  page,
}) => {
  await mockLeasiumApi(page);

  await page.goto("/tenants/tenant-1/portal-preview/onboarding-1");
  await expect(
    page.getByRole("heading", { name: "Tenant portal preview" }),
  ).toBeVisible();
  await expect(page.getByText("Bright Cafe", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Back to tenant" }).click();
  await expect(page).toHaveURL(/\/tenants\/tenant-1$/);
  await page.route(
    "**/api/v1/tenant-portal/operator-preview/onboarding-1",
    async (route) => {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Tenant portal preview not found." }),
      });
    },
  );

  await page.getByRole("link", { name: "Preview portal" }).click();

  await expect(
    page.getByRole("heading", { name: "Tenant portal preview not found" }),
  ).toBeVisible();
  await expect(page.getByText("Bright Cafe", { exact: true })).toHaveCount(0);
});
