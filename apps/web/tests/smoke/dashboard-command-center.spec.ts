import { expect, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

test("dashboard command center prepares work without raw loading counters", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("leasium.demo_mode", "false");
    window.localStorage.removeItem("leasium.entity_id");
  });
  await mockLeasiumApi(page);
  await page.route("**/api/v1/**", async (route) => {
    await page.waitForTimeout(1200);
    await route.fallback();
  });

  await page.goto("/");

  const commandCenter = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Daily command center" }),
    })
    .first();

  await expect(commandCenter).toContainText("Checking");
  await expect(commandCenter).toContainText("Preparing today's command center");
  await expect(commandCenter.getByText("...")).toHaveCount(0);
  await expect(commandCenter).not.toContainText("Loading…");
  await expect(commandCenter).not.toContainText("Refreshing…");
  await expect(commandCenter).not.toContainText(
    "Loading today's command center.",
  );
  await expect(page.locator("body")).not.toContainText(
    /Loading live portfolio|Loading recent activity\.|Loading upcoming events\./,
  );

  const metricStrip = page
    .locator("section")
    .filter({
      has: page.getByText("Operations", { exact: true }),
    })
    .first();
  await expect(metricStrip).toContainText("Checking");
  await expect(metricStrip).toContainText("Preparing");
  await expect(metricStrip.getByText("...", { exact: true })).toHaveCount(0);
  await expect(metricStrip).not.toContainText("Loading…");
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("entity bootstrap stays warm across operator navigation", async ({
  page,
}) => {
  const entityRequests: string[] = [];
  await page.addInitScript(() => {
    window.localStorage.setItem("leasium.demo_mode", "false");
    window.localStorage.setItem("leasium.entity_id", "entity-1");
  });
  await mockLeasiumApi(page);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/entities") {
      entityRequests.push(`${request.method()} ${url.pathname}`);
    }
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Acme Holdings Pty Ltd" }),
  ).toBeVisible();

  await page.locator('nav a[href="/tenants"]').first().click();
  await expect(page).toHaveURL(/\/tenants$/);
  await expect(page.getByText("Find tenants")).toBeVisible();

  await expect.poll(() => entityRequests.length).toBe(1);
});

test("stored entity lets dashboard data start before entities refresh settles", async ({
  page,
}) => {
  const requestEvents: string[] = [];
  let releaseEntities: (() => void) | null = null;
  const entitiesHeld = new Promise<void>((resolve) => {
    releaseEntities = resolve;
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("leasium.demo_mode", "false");
    window.localStorage.setItem("leasium.entity_id", "entity-1");
  });
  await mockLeasiumApi(page);
  await page.route("**/api/v1/entities", async (route) => {
    requestEvents.push("entities-start");
    await entitiesHeld;
    requestEvents.push("entities-release");
    await route.fallback();
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/premises/by-entity/entity-1") {
      requestEvents.push("portfolio-start");
    }
  });

  await page.goto("/");

  await expect
    .poll(() => requestEvents.includes("portfolio-start"))
    .toBeTruthy();
  expect(requestEvents).not.toContain("entities-release");
  releaseEntities?.();
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("dashboard overview clears first-paint loading before detailed fan-out settles", async ({
  page,
}) => {
  let releaseDetailed: (() => void) | null = null;
  const detailedHeld = new Promise<void>((resolve) => {
    releaseDetailed = resolve;
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("leasium.demo_mode", "false");
    window.localStorage.setItem("leasium.entity_id", "entity-1");
  });
  await mockLeasiumApi(page);
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const slowPaths = [
      "/premises/by-entity/entity-1",
      "/tenants",
      "/obligations",
      "/rent-roll",
      "/tenant-onboarding",
      "/document-intakes",
      "/insights/overview",
      "/activity-feed",
    ];
    if (slowPaths.includes(path)) {
      await detailedHeld;
    }
    await route.fallback();
  });

  await page.goto("/");

  const commandCenter = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Daily command center" }),
    })
    .first();
  try {
    await expect(commandCenter.getByText("Act today")).toBeVisible();
    await expect(commandCenter).not.toContainText(
      "Preparing today's command center",
    );
    const billingCard = page
      .locator("a")
      .filter({ has: page.getByText("Billing blockers", { exact: true }) })
      .first();
    await expect(billingCard).toContainText("2");
  } finally {
    releaseDetailed?.();
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});
