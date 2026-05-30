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
