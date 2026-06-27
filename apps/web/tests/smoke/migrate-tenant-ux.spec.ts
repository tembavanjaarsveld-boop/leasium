import { expect, test } from "@playwright/test";

import { mockLeasiumApi, seedPrimaryEntitySelection } from "./api-mocks";

const MIGRATED_ONBOARDING = {
  id: "onboarding-migrated-1",
  entity_id: "entity-1",
  lease_id: "lease-1",
  tenant_id: "tenant-1",
  token: "tenant-token-migrated-1",
  status: "applied",
  due_date: null,
  expires_at: null,
  last_sent_at: null,
  resent_at: null,
  cancel_reason: null,
  onboarding_url: "http://127.0.0.1:3000/onboarding/tenant-token-migrated-1",
  portal_url: "http://127.0.0.1:3000/tenant-portal/tenant-token-migrated-1",
  submitted_data: {},
  submitted_at: "2026-05-21T00:20:00.000Z",
  review_data: { origin: "migration" },
  delivery_data: {},
  reviewed_at: "2026-05-21T00:20:00.000Z",
  reviewed_by_user_id: null,
  applied_at: "2026-05-21T00:20:00.000Z",
  applied_by_user_id: null,
  created_at: "2026-05-21T00:20:00.000Z",
  updated_at: "2026-05-21T00:20:00.000Z",
  deleted_at: null,
};

const ONBOARDING_LIST = /\/api\/v1\/tenant-onboarding(?:\?.*)?$/;

test.beforeEach(async ({ page }) => {
  await seedPrimaryEntitySelection(page);
});

test("migrated applied onboarding shows send + copy portal invite on the lease", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockLeasiumApi(page);
  await page.route(ONBOARDING_LIST, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([MIGRATED_ONBOARDING]),
    });
  });

  await page.goto("/tenants/tenant-1");
  await expect(page.getByRole("heading", { name: "Bright Cafe" })).toBeVisible();

  const leases = page.locator("#financials");
  await expect(
    leases.getByRole("button", { name: "Send portal invite" }),
  ).toBeVisible();
  await expect(
    leases.getByRole("button", { name: "Copy portal link" }),
  ).toBeVisible();
  await expect(page.getByText("Portal invite ready").first()).toBeVisible();

  await page.screenshot({
    path: "test-results/migrate-tenant-desktop-1440.png",
    fullPage: true,
  });

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("lease without onboarding offers set up portal login", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLeasiumApi(page);
  await page.route(ONBOARDING_LIST, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({ contentType: "application/json", body: "[]" });
  });

  await page.goto("/tenants/tenant-1");
  await expect(page.getByRole("heading", { name: "Bright Cafe" })).toBeVisible();

  const leases = page.locator("#financials");
  await expect(
    leases.getByRole("button", { name: "Set up portal login" }).first(),
  ).toBeVisible();

  await page.screenshot({
    path: "test-results/migrate-tenant-mobile-390.png",
    fullPage: true,
  });

  await page.unrouteAll({ behavior: "ignoreErrors" });
});
