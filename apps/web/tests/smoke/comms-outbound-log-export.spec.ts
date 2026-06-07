import { expect, type Locator, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { mockLeasiumApi } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page);
});

async function expectTouchTarget(control: Locator, minSize = 44) {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.width).toBeGreaterThanOrEqual(minSize);
  expect(box.height).toBeGreaterThanOrEqual(minSize);
}

test("comms outbound log copies and downloads identical filtered CSV locally", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (
            window as Window & { __copiedCommsOutboundLogCsv?: string }
          ).__copiedCommsOutboundLogCsv = text;
        },
      },
    });
  });

  let outboundLogExportStarted = false;
  const forbiddenApiCalls: string[] = [];

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname
      .replace(/^\/api\/v1/, "")
      .toLowerCase();
    const method = request.method();
    const mutatesQueueOrProvider = method !== "GET";
    const unsafePath =
      path.includes("/comms/dispatch") ||
      path.includes("/comms/dismiss") ||
      path.includes("sendgrid") ||
      path.includes("twilio") ||
      path.includes("/xero") ||
      path.includes("/basiq") ||
      path.includes("payment") ||
      path.includes("reconciliation") ||
      path.includes("billing") ||
      path.includes("invoice") ||
      path.includes("provider-dispatch") ||
      path.includes("provider-history") ||
      path.includes("provider-refresh") ||
      path.includes("settle") ||
      path.includes("dismiss") ||
      ((path.includes("tenant") ||
        path.includes("owner") ||
        path.includes("provider")) &&
        path.includes("email"));

    if (outboundLogExportStarted && (mutatesQueueOrProvider || unsafePath)) {
      forbiddenApiCalls.push(`${method} ${path}`);
      await route.fulfill({
        status: 418,
        contentType: "application/json",
        body: JSON.stringify({
          error: "outbound log CSV copy/download must stay local-only",
        }),
      });
      return;
    }

    await route.fallback();
  });

  await page.goto("/comms");

  const outboundLogPanel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Outbound log" }) });
  await expect(outboundLogPanel).toBeVisible();

  const copyOutboundLogCsv = outboundLogPanel.getByRole("button", {
    name: "Copy outbound log CSV",
  });
  const downloadOutboundLogCsv = outboundLogPanel.getByRole("button", {
    name: "Download outbound log CSV",
  });
  await expect(copyOutboundLogCsv).toBeVisible();
  await expect(downloadOutboundLogCsv).toBeVisible();

  const copyBox = await copyOutboundLogCsv.boundingBox();
  const downloadBox = await downloadOutboundLogCsv.boundingBox();
  expect(copyBox).not.toBeNull();
  expect(downloadBox).not.toBeNull();
  for (const box of [copyBox!, downloadBox!]) {
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  const verticalGap = Math.max(
    0,
    Math.max(copyBox!.y, downloadBox!.y) -
      Math.min(
        copyBox!.y + copyBox!.height,
        downloadBox!.y + downloadBox!.height,
      ),
  );
  const horizontalGap = Math.max(
    0,
    Math.max(copyBox!.x, downloadBox!.x) -
      Math.min(
        copyBox!.x + copyBox!.width,
        downloadBox!.x + downloadBox!.width,
      ),
  );
  expect(Math.min(verticalGap, horizontalGap)).toBeLessThanOrEqual(12);

  for (const tab of [
    outboundLogPanel.getByRole("tab", { name: "All receipts 6" }),
    outboundLogPanel.getByRole("tab", { name: "Needs attention 1" }),
    outboundLogPanel.getByRole("tab", { name: "Email 5" }),
    outboundLogPanel.getByRole("tab", { name: "SMS 1" }),
  ]) {
    await expectTouchTarget(tab);
  }

  const openWorkQueueLinks = outboundLogPanel.getByRole("link", {
    name: "Open work queue",
  });
  const openWorkQueueCount = await openWorkQueueLinks.count();
  expect(openWorkQueueCount).toBeGreaterThan(0);
  for (let index = 0; index < openWorkQueueCount; index += 1) {
    await expectTouchTarget(openWorkQueueLinks.nth(index));
  }

  await outboundLogPanel
    .getByRole("tab", { name: "Needs attention 1" })
    .click();
  await expect(
    outboundLogPanel.getByText(
      "Showing 1 of 6 dispatch receipts in Needs attention.",
    ),
  ).toBeVisible();
  await expect(
    outboundLogPanel.getByText("comms draft sms failed"),
  ).toBeVisible();
  await expect(
    outboundLogPanel.getByText("contractor update email queued"),
  ).not.toBeVisible();

  outboundLogExportStarted = true;

  await copyOutboundLogCsv.click();
  await expect(page.getByText("Outbound log CSV copied.")).toBeVisible();
  const copiedCsv = await page.evaluate(
    () =>
      (window as Window & { __copiedCommsOutboundLogCsv?: string })
        .__copiedCommsOutboundLogCsv ?? "",
  );

  const downloadPromise = page.waitForEvent("download");
  await downloadOutboundLogCsv.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "comms-outbound-log-2026-05-27.csv",
  );
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const downloadedCsv = await readFile(downloadPath!, "utf8");

  expect(copiedCsv).toBe(downloadedCsv);
  expect(copiedCsv).toContain("Outbound log");
  expect(copiedCsv).toContain("Needs attention dispatch receipts");
  expect(copiedCsv).toContain("1 of 6 receipts");
  expect(copiedCsv).toContain("27 May 2026");
  expect(copiedCsv).toContain("comms draft sms failed");
  expect(copiedCsv).not.toContain("contractor update email queued");
  expect(copiedCsv).toContain(
    "Read-only export: downloading this file does not send SendGrid email, send Twilio SMS, dismiss candidates, upload evidence, write provider history, settle candidates, mutate the queue, or refresh provider state.",
  );
  expect(forbiddenApiCalls).toEqual([]);
});
