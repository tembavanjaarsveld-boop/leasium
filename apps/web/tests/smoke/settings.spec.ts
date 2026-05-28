import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { mockLeasiumApi } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page);
});

test("settings exports communication template override review CSV", async ({
  page,
}) => {
  await page.goto("/settings");

  await page.getByRole("tab", { name: "Organisation" }).click();
  await expect(page.getByText("Communication templates")).toBeVisible();
  await expect(page.getByText("Stored template overrides")).toBeVisible();
  await expect(
    page.getByText("2/2 active overrides match runtime keys."),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download overrides CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "communication-template-overrides.csv",
  );
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const csv = await readFile(downloadPath!, "utf8");

  expect(csv).toContain("Runtime template");
  expect(csv).toContain("Stored override");
  expect(csv).toContain("invoice_delivery");
  expect(csv).toContain("tenant_onboarding_invite");
  expect(csv).toContain("work_assignment_notification");
  expect(csv).toContain("SKJ invoice delivery");
  expect(csv).toContain("Contractor update default");
  expect(csv).toContain("sendgrid");
  expect(csv).toContain("Active override");
  expect(csv).toContain("Active system");
  expect(csv).toContain("Runtime-aligned");
  expect(csv).toContain("Runtime only");
  expect(csv).toContain(
    "Review-only export: downloading this file does not wire stored templates into send paths, add edit controls, send notifications, run digests, send invoices, send tenant onboarding messages, send contractor updates, mutate preferences, or write provider history.",
  );
});
