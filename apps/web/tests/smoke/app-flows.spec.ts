import { expect, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page);
});

test("setup explains Clerk configuration before first workspace setup", async ({
  page,
}) => {
  await page.goto("/setup");

  await expect(
    page.getByRole("heading", { name: "First workspace setup" }),
  ).toBeVisible();
  await expect(page.getByText("Clerk is not configured yet")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to sign in" }),
  ).toBeVisible();
});

test("workspace guard asks signed-out operators to sign in when Clerk is configured", async ({
  page,
}) => {
  test.skip(
    !process.env.LEASIUM_SMOKE_CLERK_GUARD ||
      !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    "Runs only with a real Clerk smoke environment.",
  );

  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Sign in to open the workspace" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "First workspace setup" })).toBeVisible();
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
  await expect(page.getByText("No Xero").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Email" })).toBeVisible();
});

test("operations workspace surfaces maintenance and arrears work", async ({
  page,
}) => {
  await page.goto("/operations");

  await expect(
    page.getByRole("heading", { name: "Operations", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Air conditioning fault")).toBeVisible();
  await expect(page.getByText("Bright Cafe arrears")).toBeVisible();

  await page.getByRole("tab", { name: /Maintenance/ }).click();
  await expect(page.getByText("Cool Air Services")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.locator("span").filter({ hasText: /^approved$/ }).first()).toBeVisible();

  await page.getByRole("tab", { name: /Arrears/ }).click();
  await expect(page.getByText("$8,800").first()).toBeVisible();
  await expect(page.getByText("raised").first()).toBeVisible();
  await page.getByRole("button", { name: "Escalate" }).click();
  await expect(page.locator("span").filter({ hasText: /^queued$/ }).first()).toBeVisible();
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

test("tenant portal shows scoped self-service data", async ({ page }) => {
  await page.goto("/tenant-portal/tenant-token-1");

  await expect(page.getByRole("heading", { name: "Bright Cafe" })).toBeVisible();
  await expect(page.getByText("Token scoped")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
  await expect(page.getByText("INV-1001")).toBeVisible();
  await expect(page.getByText("May rent and outgoings")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Compliance" })).toBeVisible();
  await expect(page.getByText("bright-cafe-insurance.pdf")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Notification Preferences" }),
  ).toBeVisible();
});

test("settings shows Xero readiness and records mappings", async ({ page }) => {
  await page.setViewportSize({ width: 1432, height: 900 });
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  const brandSubtitle = page
    .getByText("Lease operations, automated", { exact: true })
    .first();
  const primaryNav = page.getByRole("navigation", { name: "Primary" });
  const settingsNavLink = page.getByRole("link", { name: "Settings" }).first();
  const searchButton = page.getByRole("button", { name: "Open search" });
  await expect(brandSubtitle).toBeVisible();
  await expect(primaryNav).toBeVisible();
  await expect(settingsNavLink).toBeVisible();
  await expect(searchButton).toBeVisible();
  const brandSubtitleFits = await brandSubtitle.evaluate(
    (node) => node.scrollWidth <= node.clientWidth + 1,
  );
  const primaryNavFits = await primaryNav.evaluate(
    (node) => node.scrollWidth <= node.clientWidth + 1,
  );
  const settingsNavFits = await settingsNavLink.evaluate(
    (node) => node.scrollWidth <= node.clientWidth + 1,
  );
  expect(brandSubtitleFits).toBe(true);
  expect(primaryNavFits).toBe(true);
  expect(settingsNavFits).toBe(true);
  await expect(page.getByText("Operator access")).toBeVisible();
  await expect(page.getByText("Owner Operator").first()).toBeVisible();

  await page.getByRole("tab", { name: "Xero" }).click();
  await expect(page.getByText("Xero is not connected")).toBeVisible();

  await page.getByLabel("Xero tenant ID").fill("tenant-smoke");
  await page.getByRole("button", { name: "Save status" }).click();
  await expect(page.getByText("Connected", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Connect with Xero" }).click();
  await expect(page.getByText("Provider connected").first()).toBeVisible();

  await page.getByRole("button", { name: "Preview contacts" }).click();
  await expect(
    page.getByText("Xero contact preview", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Contacts fetched")).toBeVisible();
  await expect(page.getByText("Bright Cafe").first()).toBeVisible();
  await expect(
    page.getByText("Suggested Xero contact: Bright Cafe"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Apply selected mappings" }).click();
  await expect(page.getByText("1 applied")).toBeVisible();
  await expect(page.getByText("0 skipped")).toBeVisible();
  await expect(
    page.getByText("No invoice posting, tenant email, or payment reconciliation"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Preview chart/tax" }).click();
  await expect(page.getByText("Xero chart/tax preview")).toBeVisible();
  await expect(page.getByText("0/1 ready").first()).toBeVisible();
  await expect(
    page.getByText("Taxable charge is missing a Xero tax type."),
  ).toBeVisible();
  await expect(page.getByText("No invoice posting").first()).toBeVisible();

  await expect(page.getByText("Base Rent tax type missing")).toBeVisible();
  await page.getByRole("button", { exact: true, name: "Apply" }).click();
  await expect(
    page.getByText("Chart and tax mappings look ready"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Preview chart/tax" }).click();
  await expect(page.getByText("1/1 ready").first()).toBeVisible();
  await expect(page.getByText("Rental Income")).toBeVisible();
  await expect(page.getByText("GST on Income")).toBeVisible();

  await page.getByRole("button", { name: "Preview invoice posting" }).click();
  await expect(page.getByText("Xero invoice posting preview")).toBeVisible();
  await expect(page.getByText("1 ready").first()).toBeVisible();
  await expect(page.getByText("0 blocked").first()).toBeVisible();
  await expect(
    page.getByText(
      "No Xero posting, email, or payment mutation is performed by this preview.",
    ),
  ).toBeVisible();
  await expect(page.getByText("acct 401 / tax OUTPUT")).toBeVisible();
});

test("insights shows overview, exceptions, activity, and owner snapshot", async ({
  page,
}) => {
  await page.goto("/insights");

  await expect(
    page.getByRole("heading", { exact: true, name: "Insights" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Live Exceptions" })).toBeVisible();
  await expect(page.getByText("Insurance certificate renewal")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Automation Activity" }),
  ).toBeVisible();
  await expect(page.getByText("Created reviewed lease records")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Owner / Entity Snapshot" }),
  ).toBeVisible();
  await expect(page.getByText("Trust", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Finance Snapshot" })).toBeVisible();
  await expect(page.getByText("Approved not synced").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lease Events" })).toBeVisible();
  await expect(page.getByText("Bright Cafe Pty Ltd rent review")).toBeVisible();

  await page.getByRole("button", { name: "Generate link" }).click();
  await expect(page.getByText("Snapshot link ready")).toBeVisible();
  await page.getByRole("link", { name: "Open snapshot" }).click();

  await expect(page).toHaveURL(/\/snapshots\/snapshot-token-1$/);
  await expect(page.getByText("Frozen view")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Owner / Entity Snapshot" }),
  ).toBeVisible();
});
