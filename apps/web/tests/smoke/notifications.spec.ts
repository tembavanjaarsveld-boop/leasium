import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { mockLeasiumApi } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page);
});

test("notifications exports provider readiness review CSV", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as Window & { __copiedProviderReadinessCsv?: string })
            .__copiedProviderReadinessCsv = text;
        },
      },
    });
  });

  let readinessExportStarted = false;
  const readinessExportApiCalls: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");

    if (readinessExportStarted) {
      readinessExportApiCalls.push(`${request.method()} ${path}`);
      await route.fulfill({
        status: 418,
        contentType: "application/json",
        body: JSON.stringify({
          error: "provider readiness CSV copy/download must stay local-only",
        }),
      });
      return;
    }

    await route.fallback();
  });

  await page.goto("/notifications");

  await expect(
    page.getByRole("heading", { name: "Notifications" }),
  ).toBeVisible();
  await expect(page.getByText("Provider setup checks")).toBeVisible();

  const copyButton = page.getByRole("button", {
    name: "Copy readiness CSV",
  });
  const downloadButton = page.getByRole("button", {
    name: "Download readiness CSV",
  });
  await expect(copyButton).toBeVisible();
  await expect(downloadButton).toBeVisible();
  for (const control of [copyButton, downloadButton]) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  readinessExportStarted = true;

  await copyButton.click();
  await expect(page.getByText("Readiness CSV copied")).toBeVisible();
  const copiedCsv = await page.evaluate(
    () =>
      (window as Window & { __copiedProviderReadinessCsv?: string })
        .__copiedProviderReadinessCsv ?? "",
  );
  expect(copiedCsv).toBeTruthy();

  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "work-notification-provider-readiness.csv",
  );
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const csv = await readFile(downloadPath!, "utf8");

  expect(copiedCsv).toBe(csv);
  expect(csv).toContain("Email");
  expect(csv).toContain("Sendgrid");
  expect(csv).toContain("SMS");
  expect(csv).toContain("Twilio");
  expect(csv).toContain("In-app");
  expect(csv).toContain("Leasium");
  expect(csv).toContain("SendGrid sender");
  expect(csv).toContain("Twilio status callback");
  expect(csv).toContain("Configure SendGrid to queue provider emails");
  expect(csv).toContain("Configure Twilio to queue provider SMS");
  expect(csv).toContain(
    "Notification center is read-only; sending still requires explicit operator action.",
  );
  expect(csv).toContain(
    "Review-only export: downloading this file does not send email, send SMS, run digests, mark notifications read, dispatch providers, refresh provider tokens, or mutate provider history.",
  );
  expect(readinessExportApiCalls).toEqual([]);
});

test("notifications exports work notification review packet without provider calls", async ({
  page,
}) => {
  const mutationCalls: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const isForbiddenMutation =
      request.method() !== "GET" &&
      (path.includes("/notification") ||
        path.includes("/digests/run") ||
        path.includes("/providers") ||
        path.includes("/provider") ||
        path.includes("/tokens") ||
        path.includes("/history") ||
        path.includes("/comms") ||
        path.includes("/work-assignments") ||
        path.includes("/maintenance") ||
        path.includes("/arrears") ||
        path.includes("/xero") ||
        path.includes("/basiq"));

    if (isForbiddenMutation) {
      mutationCalls.push(`${request.method()} ${path}`);
      await route.fulfill({
        status: 418,
        contentType: "application/json",
        body: JSON.stringify({ error: "review packet must be local-only" }),
      });
      return;
    }

    await route.fallback();
  });

  await page.goto("/notifications");

  await expect(
    page.getByRole("heading", { name: "Notifications" }),
  ).toBeVisible();

  const copyButton = page.getByRole("button", {
    name: "Copy review packet",
  });
  await expect(copyButton).toBeVisible();
  const copyBox = await copyButton.boundingBox();
  expect(copyBox).not.toBeNull();
  expect(copyBox!.width).toBeGreaterThanOrEqual(44);
  expect(copyBox!.height).toBeGreaterThanOrEqual(44);
  await copyButton.click();
  await expect(page.getByText("Review packet copied")).toBeVisible();

  const downloadButton = page.getByRole("button", {
    name: "Download review packet CSV",
  });
  await expect(downloadButton).toBeVisible();
  const downloadBox = await downloadButton.boundingBox();
  expect(downloadBox).not.toBeNull();
  expect(downloadBox!.width).toBeGreaterThanOrEqual(44);
  expect(downloadBox!.height).toBeGreaterThanOrEqual(44);
  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "work-notification-review-packet.csv",
  );
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const csv = await readFile(downloadPath!, "utf8");

  expect(csv).toContain("Air conditioning fault");
  expect(csv).toContain("Bright Cafe arrears");
  expect(csv).toContain("Assignment email was queued by SendGrid.");
  expect(csv).toContain("SendGrid returned 500.");
  expect(csv).toContain("Work digest email");
  expect(csv).toContain("Leasium Daily Work digest: 4 items");
  expect(csv).toContain("Send digest from this page.");
  expect(csv).toContain("Retry the assignment email from this page.");
  expect(csv).toContain(
    "Review-only packet: copying or downloading this packet does not send email, send SMS, run digests, mark notifications read, mark notifications reviewed, dispatch providers, call Comms, call Xero, call Basiq, refresh provider tokens, or mutate provider history.",
  );
  expect(mutationCalls).toEqual([]);
});
