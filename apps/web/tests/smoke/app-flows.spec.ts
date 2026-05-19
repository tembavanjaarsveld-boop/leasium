import { expect, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page);
});

test("dashboard shows the mocked portfolio and opens billing readiness", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Acme Holdings Pty Ltd" }),
  ).toBeVisible();
  await expect(
    page.getByText("Queen Street Retail Centre").first(),
  ).toBeVisible();
  await expect(
    page.getByText("Insurance certificate renewal").first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Open search" }).click();
  await page
    .getByPlaceholder("Search tenants, leases, actions...")
    .fill("billing");
  await page.getByText("Review billing blockers").click();

  await expect(page).toHaveURL(/\/billing-readiness$/);
  await expect(
    page.getByRole("heading", { name: "Billing Readiness" }),
  ).toBeVisible();
  await expect(
    page.getByText("Xero mapping needs review").first(),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: /Readiness/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Billing drafts/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Invoice prep/ })).toBeVisible();
  await expect(
    page.getByRole("tab", { name: /Delivery & payments/ }),
  ).toBeVisible();

  await page.getByRole("tab", { name: /Billing drafts/ }).click();
  await expect(page.getByText("May rent and outgoings")).toBeVisible();

  await page.getByRole("tab", { name: /Invoice prep/ }).click();
  await expect(
    page.getByRole("heading", { name: "Invoice preparation" }),
  ).toBeVisible();
  await expect(page.getByText("INV-1001").first()).toBeVisible();

  await page.getByRole("tab", { name: /Delivery & payments/ }).click();
  await expect(page.getByText("Manual receipt only")).toBeVisible();
});

test("tenant workspace supports search and the add tenant form", async ({
  page,
}) => {
  await page.goto("/tenants");

  await expect(
    page.getByRole("heading", { name: "Tenant workspace" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Bright Cafe/ })).toBeVisible();

  await page.getByPlaceholder("Search tenants").fill("northwind");
  await expect(
    page.getByRole("link", { name: /Northwind Fitness/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Bright Cafe/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Add tenant" }).click();
  await expect(page.getByLabel("Legal name")).toBeVisible();
  await expect(page.getByLabel("Contact email")).toBeVisible();
});

test("settings shows Xero readiness and records mappings", async ({ page }) => {
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("Operator access")).toBeVisible();
  await expect(page.getByText("Owner Operator")).toBeVisible();

  await page.getByRole("tab", { name: "Xero" }).click();
  await expect(page.getByText("Xero is not connected")).toBeVisible();

  await page.getByLabel("Xero tenant ID").fill("tenant-smoke");
  await page.getByRole("button", { name: "Save status" }).click();
  await expect(page.getByText("Connected")).toBeVisible();

  await expect(page.getByText("Base Rent tax type missing")).toBeVisible();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(
    page.getByText("Chart and tax mappings look ready"),
  ).toBeVisible();
});

test("insights shows overview, exceptions, activity, and owner snapshot", async ({
  page,
}) => {
  await page.goto("/insights");

  await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible();
  await expect(page.getByText("Live Exceptions")).toBeVisible();
  await expect(page.getByText("Insurance certificate renewal")).toBeVisible();
  await expect(page.getByText("Automation Activity")).toBeVisible();
  await expect(page.getByText("Created reviewed lease records")).toBeVisible();
  await expect(page.getByText("Owner / Entity Snapshot")).toBeVisible();
  await expect(page.getByText("Trust")).toBeVisible();
});
