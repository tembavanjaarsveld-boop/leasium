import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { mockLeasiumApi } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page);
});

test("insights exports review packet CSV from loaded overview data", async ({
  page,
}) => {
  await page.goto("/insights");

  await expect(
    page.getByRole("heading", { exact: true, name: "Insights" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Live Exceptions" }),
  ).toBeVisible();
  await expect(page.getByText("Insurance certificate renewal")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Finance Snapshot" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Owner / Entity Snapshot" }),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download review CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "insights-review-packet-2026-05-19.csv",
  );
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const csv = await readFile(downloadPath!, "utf8");

  expect(csv).toContain("Live exception");
  expect(csv).toContain("Insurance certificate renewal");
  expect(csv).toContain("Automation activity");
  expect(csv).toContain("Created reviewed lease records");
  expect(csv).toContain("Finance snapshot");
  expect(csv).toContain("Accounting readiness");
  expect(csv).toContain("Owner / entity snapshot");
  expect(csv).toContain("Lease event");
  expect(csv).toContain("Bright Cafe Pty Ltd rent review");
  expect(csv).toContain("Snapshot history");
  expect(csv).toContain("No saved snapshots");
  expect(csv).toContain(
    "Review-only export: downloading this file does not create or revoke snapshots, write Xero data, refresh providers, send SendGrid or Twilio messages, send tenant, owner, or provider email, apply payment reconciliation, generate billing drafts, dispatch providers, or mutate provider history.",
  );
});

test("insights splits the Xero-status guardrail into label and caption", async ({
  page,
}) => {
  await page.goto("/insights");

  const guardrails = page
    .locator("div")
    .filter({ has: page.getByText("Guardrails", { exact: true }) })
    .last();
  await expect(guardrails).toBeVisible();

  // C8: the leading status clause and the guardrail caption render as two
  // distinct elements rather than one run-on sentence.
  const statusLabel = guardrails.getByText("Loading Xero status", {
    exact: true,
  });
  await expect(statusLabel).toBeVisible();
  const caption = guardrails.getByText(
    "does not refresh tokens, call Xero, post invoices, or reconcile payments.",
    { exact: true },
  );
  await expect(caption).toBeVisible();
});
