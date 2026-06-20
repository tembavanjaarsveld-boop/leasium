import { expect, type Locator, test } from "@playwright/test";

import { mockLeasiumApi, seedPrimaryEntitySelection } from "./api-mocks";

async function expectTouchTarget(control: Locator, minSize = 44) {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.width).toBeGreaterThanOrEqual(minSize);
  expect(box.height).toBeGreaterThanOrEqual(minSize);
}

test("operations calendar renders a read-only all-entity agenda and month", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await mockLeasiumApi(page);

  const forbiddenCalls: string[] = [];
  const forbiddenPathPatterns = [
    "/providers",
    "/provider-dispatch",
    "/provider-history",
    "/comms",
    "/xero",
    "/basiq",
    "/payment",
    "/reconciliation",
  ];
  const forbiddenSendPathPattern = /email|sms|sendgrid|twilio/i;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const apiPath = new URL(request.url()).pathname.replace("/api/v1", "");
    if (
      (request.method() !== "GET" &&
        forbiddenPathPatterns.some((pattern) => apiPath.startsWith(pattern))) ||
      forbiddenSendPathPattern.test(apiPath)
    ) {
      forbiddenCalls.push(`${request.method()} ${apiPath}`);
    }
    await route.fallback();
  });

  await page.goto("/operations?tab=calendar");

  const tabs = page.getByRole("tablist", { name: "Operations sections" });
  const calendarTab = tabs.getByRole("tab", { name: /Calendar/ });
  await expect(calendarTab).toHaveAttribute("aria-selected", "true");
  await expectTouchTarget(calendarTab);

  const panel = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Operations calendar" }),
    })
    .first();
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Queen Street lease expiry");
  await expect(panel).toContainText("July rent invoice due");
  await expect(panel).toContainText("Rivergum annual review");

  const layout = panel.getByRole("group", { name: "Calendar layout" });
  await expect(layout).toBeVisible();
  await expect(
    layout.getByRole("button", { name: "Month", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(panel.locator('[data-date="2026-07-20"]')).toContainText(
    "Queen Street lease expiry",
  );

  await layout.getByRole("button", { name: "Agenda", exact: true }).click();
  await expect(
    layout.getByRole("button", { name: "Agenda", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(panel).toContainText("Air conditioning fault");
  await expect(panel).toContainText("Annual fire safety statement");
  await expect(panel).toContainText("Arrears reminder");
  await expect(panel).toContainText("Tenant onboarding");
  await expect(
    panel.locator('a[href="/operations/maintenance/work-order-1"]'),
  ).toBeVisible();
  await expect(
    panel.locator(
      'a[href="/operations?tab=compliance#compliance-check-compliance-check-fire-1"]',
    ),
  ).toBeVisible();

  await panel
    .locator('a[href="/operations/maintenance/work-order-1"]')
    .first()
    .click();
  await expect(page).toHaveURL(/\/operations\/maintenance\/work-order-1/);
  expect(forbiddenCalls).toEqual([]);
});

test("operations calendar filters events and opens a read-only preview", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await mockLeasiumApi(page);
  await page.goto("/operations?tab=calendar");

  const panel = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Operations calendar" }),
    })
    .first();
  await panel
    .getByRole("button", { name: "Agenda", exact: true })
    .click();

  await panel.getByRole("button", { name: /^Work\b/ }).click();
  await expect(panel).toContainText("Air conditioning fault");
  await expect(panel).not.toContainText("Queen Street lease expiry");

  await panel
    .getByRole("button", { name: "Preview Air conditioning fault" })
    .click();
  const preview = panel
    .locator("aside")
    .filter({ has: page.getByRole("heading", { name: "Air conditioning fault" }) })
    .first();
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("Maintenance");
  await expect(preview).toContainText("20 May 2026");
  await expect(preview).toContainText("Queen Street Retail Centre");
  await expect(
    preview.getByRole("link", { name: "Open source" }),
  ).toHaveAttribute("href", "/operations/maintenance/work-order-1");

  await panel.getByRole("button", { name: "All sources" }).click();
  await panel.getByRole("button", { name: /^Next 30\b/ }).click();
  await expect(panel).toContainText("Queen Street rent review");
  await expect(panel).toContainText("July rent invoice due");
  await expect(panel).not.toContainText("Air conditioning fault");
});

test("mobile operations calendar is agenda-first and handles an empty window", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedPrimaryEntitySelection(page);
  await mockLeasiumApi(page);
  await page.route("**/api/v1/calendar/events**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });

  await page.goto("/operations?tab=calendar");

  const tabs = page.getByRole("tablist", { name: "Operations sections" });
  const calendarTab = tabs.getByRole("tab", { name: /Calendar/ });
  await expect(calendarTab).toHaveAttribute("aria-selected", "true");
  await expectTouchTarget(calendarTab);

  const panel = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Operations calendar" }),
    })
    .first();
  const layout = panel.getByRole("group", { name: "Calendar layout" });
  await expect(
    layout.getByRole("button", { name: "Agenda", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(panel).toContainText("No calendar events in this window.");
});
