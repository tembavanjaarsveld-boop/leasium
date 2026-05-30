import { expect, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

test("portfolio QA loading metrics use contextual labels", async ({ page }) => {
  await mockLeasiumApi(page);
  await page.route("**/api/v1/**", async (route) => {
    await page.waitForTimeout(1200);
    await route.fallback();
  });

  await page.goto("/portfolio-qa");

  const metrics = page
    .locator("section")
    .filter({
      has: page.getByText("Open issues", { exact: true }),
    })
    .first();

  await expect(metrics).toContainText("Checking");
  await expect(metrics).toContainText("Preparing");
  await expect(metrics).toContainText("Updating");
  await expect(metrics.getByText("...", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Preparing QA workspace.")).toBeVisible();
  await expect(page.getByText("Loading QA workspace.")).toHaveCount(0);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("portfolio QA blocker triage shows per-reason counts, plain-English copy, and a guided fix", async ({
  page,
}) => {
  await mockLeasiumApi(page);
  await page.goto("/portfolio-qa");

  // The reason-breakdown layer lives only inside the Blocker triage packet.
  const breakdown = page.getByTestId("blocker-reason-breakdown");
  await expect(breakdown).toBeVisible();

  // Scope to the rent-roll billing group card within the breakdown.
  const rentRollGroup = breakdown.getByTestId("reason-group-billing-readiness");
  await expect(rentRollGroup).toBeVisible();

  // Reason 1: appears twice (two seeded rows) with plain-English copy.
  await expect(
    rentRollGroup.getByText("Tenant is missing a billing email.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    rentRollGroup.getByText(
      "Onboarding invites and invoices can't reach the tenant.",
    ),
  ).toBeVisible();

  // Reason 2: a distinct reason at a different count, also explained.
  await expect(
    rentRollGroup.getByText("Rent is missing a Xero account code.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    rentRollGroup.getByText(
      "Blocks syncing the invoice to Xero without an account code.",
    ),
  ).toBeVisible();

  // Guided fix path routes through the existing billing-readiness surface.
  await expect(
    rentRollGroup.getByRole("link", { name: /Open billing/ }).first(),
  ).toHaveAttribute("href", "/billing-readiness");

  // The "missing a billing email" reason expands to its 2 affected rows.
  await rentRollGroup
    .getByRole("button", { name: "Show 2 affected rows" })
    .click();
  await expect(
    rentRollGroup.getByRole("button", { name: "Hide affected rows" }),
  ).toBeVisible();
});
