import { expect, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

test("mobile tenant rows expose invite actions without raw loading placeholders", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("leasium.demo_mode", "false");
    window.localStorage.removeItem("leasium.entity_id");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          window.localStorage.setItem("tenantCopiedLink", text);
        },
      },
    });
  });

  await mockLeasiumApi(page);

  let delayedTenantLists = true;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");
    if (
      delayedTenantLists &&
      request.method() === "GET" &&
      (path === "/tenants" || path === "/tenant-onboarding")
    ) {
      delayedTenantLists = false;
      await page.waitForTimeout(1200);
    }
    await route.fallback();
  });

  let cancelCalled = false;
  await page.route(
    "**/api/v1/tenant-onboarding/onboarding-1/cancel",
    async (route) => {
      cancelCalled = true;
      await route.fulfill({
        contentType: "application/json",
        status: 200,
        body: JSON.stringify({
          id: "onboarding-1",
          status: "cancelled",
          tenant_id: "tenant-1",
          lease_id: "lease-1",
          onboarding_url: "http://127.0.0.1:3000/onboarding/tenant-token-1",
          expires_at: "2026-06-12T00:00:00.000Z",
          due_date: "2026-05-29",
          created_at: "2026-05-18T09:30:00.000Z",
          updated_at: "2026-05-20T00:00:00.000Z",
        }),
      });
    },
  );

  await page.goto("/tenants");

  await expect(
    page.getByRole("heading", { name: "Tenant workspace" }),
  ).toBeVisible({ timeout: 15_000 });

  const tenantSurface = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Onboarding command center" }),
    })
    .first();
  const kpis = page
    .locator("section")
    .filter({ hasText: "Waiting on tenants" });

  await expect(kpis).toBeVisible();
  await expect(kpis.getByText("...", { exact: true })).toHaveCount(0);
  await expect(tenantSurface.getByText("...", { exact: true })).toHaveCount(0);

  const brightCafeRow = page
    .getByTestId("tenant-mobile-row")
    .filter({ hasText: "Bright Cafe" })
    .first();
  await expect(brightCafeRow).toBeVisible();

  await expect(
    brightCafeRow.getByRole("link", { name: "Open" }),
  ).toHaveAttribute("href", "/tenants/tenant-1");

  const copyLink = brightCafeRow.getByRole("button", { name: "Copy link" });
  await expect(copyLink).toBeVisible();
  const copyBox = await copyLink.boundingBox();
  expect(copyBox?.height).toBeGreaterThanOrEqual(44);
  await copyLink.click();
  await expect
    .poll(() =>
      page.evaluate(() => window.localStorage.getItem("tenantCopiedLink")),
    )
    .toBe("http://127.0.0.1:3000/onboarding/tenant-token-1");

  const cancel = brightCafeRow.getByRole("button", { name: "Cancel" });
  await expect(cancel).toBeVisible();
  const cancelBox = await cancel.boundingBox();
  expect(cancelBox?.height).toBeGreaterThanOrEqual(44);
  await cancel.click();
  await expect.poll(() => cancelCalled).toBe(true);

  await page.unrouteAll({ behavior: "ignoreErrors" });
});
