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

test("maintenance detail loading states use structured skeleton rows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLeasiumApi(page);
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/maintenance/work-orders/work-order-1")) {
      await page.waitForTimeout(2500);
    }
    if (
      path.endsWith(
        "/comms/correspondence/maintenance-work-orders/work-order-1",
      )
    ) {
      await page.waitForTimeout(5000);
    }
    await route.fallback();
  });

  await page.goto("/operations/maintenance/work-order-1");

  await expect(page.getByLabel("Loading…").first()).toBeVisible();
  await expect(
    page.getByText("Loading work order.", { exact: true }),
  ).toHaveCount(0);

  await expect(
    page.getByRole("heading", { name: "Air conditioning fault" }),
  ).toBeVisible();
  const correspondencePanel = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Correspondence" }),
    })
    .first();

  await expect(correspondencePanel.getByLabel("Loading…")).toBeVisible();
  await expect(
    correspondencePanel.getByText("Loading correspondence.", { exact: true }),
  ).toHaveCount(0);

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("maintenance detail shows a record-level not-found state", async ({
  page,
}) => {
  await mockLeasiumApi(page);
  await page.route(
    "**/api/v1/maintenance/work-orders/missing-work-order",
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Work order not found." }),
      });
    },
  );

  await page.goto("/operations/maintenance/missing-work-order");

  await expect(
    page.getByRole("heading", { name: "Work order not found" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText("This work order may have been deleted"),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to Work" }),
  ).toHaveAttribute("href", "/operations");
  await expect(page.getByText("Work order unavailable")).toHaveCount(0);
});

test("maintenance detail keeps generic failures on unavailable state", async ({
  page,
}) => {
  await mockLeasiumApi(page);
  await page.route(
    "**/api/v1/maintenance/work-orders/broken-work-order",
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Work order service unavailable." }),
      });
    },
  );

  await page.goto("/operations/maintenance/broken-work-order");

  await expect(
    page.getByRole("heading", { name: "Work order unavailable" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Work order service unavailable.")).toBeVisible();
  await expect(page.getByText("Work order not found")).toHaveCount(0);
});

test("maintenance detail hides stale work-order data after a not-found refresh", async ({
  page,
}) => {
  await mockLeasiumApi(page);
  let failPrimaryRead = false;
  await page.route(
    "**/api/v1/maintenance/work-orders/work-order-1",
    async (route) => {
      if (route.request().method() !== "GET" || !failPrimaryRead) {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Work order not found." }),
      });
    },
  );

  await page.goto("/operations/maintenance/work-order-1");
  await expect(
    page.getByRole("heading", { name: "Air conditioning fault" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Edit work-order details")).toBeVisible();

  failPrimaryRead = true;
  await page.getByRole("button", { name: "Refresh" }).click();

  await expect(
    page.getByRole("heading", { name: "Work order not found" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("heading", { name: "Air conditioning fault" }),
  ).toHaveCount(0);
  await expect(page.getByText("Edit work-order details")).toHaveCount(0);
});
