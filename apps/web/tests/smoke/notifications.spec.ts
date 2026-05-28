import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { mockLeasiumApi } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page);
});

test("notifications exports provider readiness review CSV", async ({ page }) => {
  await page.goto("/notifications");

  await expect(
    page.getByRole("heading", { name: "Notifications" }),
  ).toBeVisible();
  await expect(page.getByText("Provider setup checks")).toBeVisible();

  const downloadButton = page.getByRole("button", {
    name: "Download readiness CSV",
  });
  await expect(downloadButton).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "work-notification-provider-readiness.csv",
  );
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const csv = await readFile(downloadPath!, "utf8");

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
    "Review-only export: downloading this file does not send email, send SMS, run digests, mark notifications read, dispatch providers, refresh provider tokens, or mutate provider history.",
  );
});
