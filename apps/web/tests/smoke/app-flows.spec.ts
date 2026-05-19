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
  await expect(page.getByText("Queen Street Retail Centre")).toBeVisible();
  await expect(page.getByText("Insurance certificate renewal")).toBeVisible();

  await page.getByRole("button", { name: "Open search" }).click();
  await page
    .getByPlaceholder("Search tenants, leases, actions...")
    .fill("billing");
  await page.getByText("Review billing blockers").click();

  await expect(page).toHaveURL(/\/billing-readiness$/);
  await expect(
    page.getByRole("heading", { name: "Billing Readiness" }),
  ).toBeVisible();
  await expect(page.getByText("Missing Xero tax type")).toBeVisible();
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
  await expect(page.getByText("Xero is not connected")).toBeVisible();

  await page.getByLabel("Xero tenant ID").fill("tenant-smoke");
  await page.getByRole("button", { name: "Save status" }).click();
  await expect(page.getByText("Connected")).toBeVisible();

  await expect(page.getByText("Base Rent tax type missing")).toBeVisible();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("Chart and tax mappings look ready")).toBeVisible();
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
