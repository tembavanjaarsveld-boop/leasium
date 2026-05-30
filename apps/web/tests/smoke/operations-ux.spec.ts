import { expect, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

test("mobile operations loading and queue actions stay readable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLeasiumApi(page);
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.endsWith("/entities")) {
      await page.waitForTimeout(1200);
    }
    await route.fallback();
  });

  await page.goto("/operations");

  const metrics = page
    .locator("section")
    .filter({
      has: page.getByText("Urgent maintenance", { exact: true }),
    })
    .first();

  await expect(metrics).toContainText("Checking");
  await expect(metrics.getByText("...")).toHaveCount(0);

  await expect(page.getByText("Air conditioning fault")).toBeVisible();
  const queueActions = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Operations queue" }),
    })
    .first();
  const downloadQueueCsv = queueActions.getByRole("button", {
    name: "Download queue CSV",
  });

  await expect(downloadQueueCsv).toBeVisible();
  const actionBox = await downloadQueueCsv.boundingBox();
  expect(actionBox).not.toBeNull();
  expect(actionBox?.width).toBeGreaterThanOrEqual(300);

  await page.unrouteAll({ behavior: "ignoreErrors" });
});
