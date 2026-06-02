import { expect, type Locator, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

async function expectTouchTarget(control: Locator, minSize = 44) {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.width).toBeGreaterThanOrEqual(minSize);
  expect(box.height).toBeGreaterThanOrEqual(minSize);
}

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page);
});

test("sidebar consolidates to seven hubs plus Settings", async ({ page }) => {
  await page.goto("/");

  const primaryNav = page.getByRole("navigation", { name: "Primary" });
  await expect(primaryNav.getByRole("link")).toHaveCount(8);

  for (const label of [
    "Dashboard",
    "Smart Intake",
    "Properties",
    "People",
    "Work",
    "Money",
    "Insights",
  ]) {
    await expect(
      primaryNav.getByRole("link", { name: new RegExp(`^${label}`) }),
    ).toBeVisible();
  }

  await expect(
    primaryNav.getByRole("link", { name: /^Settings/ }),
  ).toBeVisible();
  await expect(primaryNav.getByRole("link", { name: /^Tenants/ })).toHaveCount(
    0,
  );
  await expect(primaryNav.getByRole("link", { name: /^Billing/ })).toHaveCount(
    0,
  );

  await primaryNav.getByRole("link", { name: /^People/ }).click();
  await expect(page).toHaveURL(/\/people$/);
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();

  await page.goto("/");
  await primaryNav.getByRole("link", { name: /^Money/ }).click();
  await expect(page).toHaveURL(/\/money$/);
  await expect(page.getByRole("heading", { name: "Money" })).toBeVisible();
});

test("people hub keeps tenants and vendors inline", async ({ page }) => {
  await page.goto("/people?tab=tenants");

  await expect(page.getByRole("tab", { name: "Tenants" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("Bright Cafe Pty Ltd")).toBeVisible();
  await expect(page.getByText("mia@example.com")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Open tenant workspace/i }),
  ).toHaveCount(0);

  await page.getByRole("tab", { name: "Vendors" }).click();
  await expect(page.getByRole("tab", { name: "Vendors" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByText("Bright Spark Electrical", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("electrical", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Open vendor directory/i }),
  ).toHaveCount(0);

  await page.goto("/people/vendors");
  await expect(page).toHaveURL(/\/people\?tab=vendors$/);
  await expect(page.getByRole("tab", { name: "Vendors" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("money hub groups finance destinations and legacy links still resolve", async ({
  page,
}) => {
  await page.goto("/money");

  for (const label of ["Billing", "Statements", "Xero", "Basiq"]) {
    await expect(page.getByRole("tab", { name: label })).toBeVisible();
  }

  await expect(
    page.getByRole("link", { name: "Open Billing Readiness" }),
  ).toHaveAttribute("href", "/billing-readiness");

  await page.getByRole("tab", { name: "Statements" }).click();
  await expect(
    page.getByText("Entity statements", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("dispatch review")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open entity statements" }),
  ).toHaveAttribute("href", "/statements");

  await page.goto("/billing-readiness");
  await expect(
    page.getByRole("heading", { name: "Billing Readiness" }),
  ).toBeVisible();

  await page.goto("/statements");
  await expect(
    page.getByRole("heading", { name: "Entity statements" }),
  ).toBeVisible();

  await page.goto("/money/statements");
  await expect(page).toHaveURL(/\/statements$/);

  await page.goto("/work/comms");
  await expect(page).toHaveURL(/\/comms$/);
});

test("mobile money hub tabs and actions stay touch-safe", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/money");

  await expect(page.getByRole("heading", { name: "Money" })).toBeVisible();

  const moneyTabs = page.getByRole("tablist", { name: "Money areas" });
  await expect(moneyTabs).toBeVisible();
  for (const label of ["Billing", "Statements", "Xero", "Basiq"]) {
    await expectTouchTarget(moneyTabs.getByRole("tab", { name: label }));
  }
  await expectTouchTarget(
    page.getByRole("link", { name: "Open Billing Readiness" }),
  );
});

test("money hub keeps owner-statement dispatch framing for managing agents", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });
  await page.goto("/money?tab=statements");

  await expect(
    page.getByText("Owner statements", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("dispatch review")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open owner statements" }),
  ).toHaveAttribute("href", "/statements");
});
