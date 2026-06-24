import { expect, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

// A brand-new account (no entities/properties) must show a friendly onboarding
// welcome instead of firing entity-scoped queries and surfacing the red
// "Live data did not finish loading / you do not have access to this entity"
// error (which also regression-guards the stale-entity-id-across-accounts bug:
// with no accessible entity the dashboard clears the selection rather than
// querying a stale one).
test("dashboard shows an onboarding welcome when the account has no entities", async ({
  page,
}) => {
  await mockLeasiumApi(page);
  // Override /entities to an empty list, registered after mockLeasiumApi so it
  // takes precedence for this path only.
  await page.route("**/api/v1/entities", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: "[]",
    });
  });

  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Welcome to Relby" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add a property" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open Relby AI" }),
  ).toBeVisible();

  // The scary live-data error must not appear for an empty account.
  await expect(
    page.getByText("Live data did not finish loading."),
  ).toHaveCount(0);
  await expect(
    page.getByText("You do not have access to this entity."),
  ).toHaveCount(0);
});
