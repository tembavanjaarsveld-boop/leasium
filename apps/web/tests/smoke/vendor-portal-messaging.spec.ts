import { expect, type Page, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

import { mockLeasiumApi, seedPrimaryEntitySelection } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await seedPrimaryEntitySelection(page);
});

function watchUnsafeRequests(page: Page) {
  const unsafeRequests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      // Read-only comms GETs (thread hydration, app-shell queue badge) are
      // safe; the guard exists to catch dispatch/mutation calls.
      (path.startsWith("/api/v1/comms") && request.method() !== "GET") ||
      path.startsWith("/api/v1/xero") ||
      path.startsWith("/api/v1/basiq") ||
      path.startsWith("/api/v1/payments") ||
      path.startsWith("/api/v1/reconciliation") ||
      path.includes("/contractor-delivery") ||
      path.includes("assignment-notification")
    ) {
      unsafeRequests.push(`${request.method()} ${path}`);
    }
  });
  return unsafeRequests;
}

async function expectNoHorizontalOverflow(page: Page) {
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
}

test("maintenance detail shows contractor message thread with in-app-only notice", async ({
  page,
}) => {
  const unsafeRequests = watchUnsafeRequests(page);
  await mockLeasiumApi(page, { vendorPortalMessagingThread: true });

  await page.goto("/operations/maintenance/work-order-1");

  await expect(
    page.getByRole("heading", { name: "Air conditioning fault" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Contractor messages" }),
  ).toBeVisible();

  const messagesPanel = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Contractor messages" }),
    })
    .first();

  await expect(
    messagesPanel.getByText("You", { exact: true }),
  ).toBeVisible();
  await expect(
    messagesPanel.getByText("Please confirm your attendance window for Friday."),
  ).toBeVisible();
  await expect(
    messagesPanel.getByText("Cool Air Services", { exact: true }),
  ).toBeVisible();
  await expect(
    messagesPanel.getByText("Confirmed — on site Friday from 8am."),
  ).toBeVisible();
  await expect(
    messagesPanel.getByText(
      "Default is portal-only. Tick a channel only when you want a provider-backed notification.",
    ),
  ).toBeVisible();
  await expect(messagesPanel.getByText("Notify contractor")).toBeVisible();
  await expect(
    messagesPanel.getByText("Default: no provider send"),
  ).toBeVisible();
  await expect(
    messagesPanel.getByText("Email notification"),
  ).toBeVisible();
  await expect(messagesPanel.getByText("SMS notification")).toBeVisible();
  await expect(
    messagesPanel.getByRole("button", { name: "Post message" }),
  ).toBeVisible();

  expect(unsafeRequests).toEqual([]);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("operator sends a contractor-visible message from the thread", async ({
  page,
}) => {
  const unsafeRequests = watchUnsafeRequests(page);
  const commentPayloads: Array<Record<string, unknown>> = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      request.method() === "POST" &&
      path.endsWith("/maintenance/work-orders/work-order-1/comments")
    ) {
      commentPayloads.push(
        request.postDataJSON() as Record<string, unknown>,
      );
    }
  });
  await mockLeasiumApi(page, { vendorPortalMessagingThread: true });

  await page.goto("/operations/maintenance/work-order-1");

  await expect(
    page.getByRole("heading", { name: "Contractor messages" }),
  ).toBeVisible();

  const messagesPanel = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Contractor messages" }),
    })
    .first();

  await page
    .getByLabel("Message to contractor")
    .fill("Parts have arrived; attend any time Friday.");
  await page.getByRole("checkbox", { name: /Email notification/ }).check();
  await page.getByRole("button", { name: "Post message" }).click();

  await expect(
    messagesPanel.getByText("Parts have arrived; attend any time Friday.").first(),
  ).toBeVisible();
  await page.getByText("Channel evidence").click();
  const channelEvidence = page
    .locator("details")
    .filter({ has: page.getByText("Channel evidence") })
    .first();
  await expect(channelEvidence).toContainText("Contractor email");
  await expect(channelEvidence).toContainText("Sendgrid");
  await expect(channelEvidence).toContainText("Queued");
  await expect(channelEvidence).toContainText("ID sg-vendor-message-1");
  await channelEvidence.getByText("Message preview").click();
  await expect(
    channelEvidence.getByText("Parts have arrived; attend any time Friday."),
  ).toBeVisible();
  expect(commentPayloads).toHaveLength(1);
  expect(commentPayloads[0]).toMatchObject({
    body: "Parts have arrived; attend any time Friday.",
    visibility: "contractor",
    notify_contractor_email_approved: true,
    notify_contractor_sms_approved: false,
  });

  expect(unsafeRequests).toEqual([]);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("unshared work order points at the share control instead of the send box", async ({
  page,
}) => {
  await mockLeasiumApi(page);

  await page.goto("/operations/maintenance/work-order-1");

  await expect(
    page.getByRole("heading", { name: "Contractor messages" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Share this work order to the vendor portal above to message the contractor here.",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Message to contractor")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Post message" })).toHaveCount(
    0,
  );
});

test("contractor message density fits desktop and mobile", async ({ page }) => {
  await mkdir("../../output/playwright", { recursive: true });
  await mockLeasiumApi(page, { vendorPortalMessagingThread: true });

  for (const viewport of [
    { label: "1440", width: 1440, height: 900 },
    { label: "390", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.goto("/operations/maintenance/work-order-1");

    const messagesPanel = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", { name: "Contractor messages" }),
      })
      .first();

    await expect(messagesPanel.getByText("Notify contractor")).toBeVisible();
    await expect(
      messagesPanel.getByText("Default: no provider send"),
    ).toBeVisible();
    await expect(
      messagesPanel.getByRole("button", { name: "Post message" }),
    ).toBeVisible();
    await expect(page.getByText("Channel evidence").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.screenshot({
      fullPage: true,
      path: `../../output/playwright/work-message-density-${viewport.label}.png`,
    });
  }
});
