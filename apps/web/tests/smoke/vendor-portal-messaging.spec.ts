import { expect, type Page, test } from "@playwright/test";

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
      "Posts to the portal. Email/SMS notifications need explicit approval.",
    ),
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
  await page.getByLabel("Send approved email notification").check();
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(
    messagesPanel.getByText("Parts have arrived; attend any time Friday."),
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
  await expect(page.getByRole("button", { name: "Send message" })).toHaveCount(
    0,
  );
});
