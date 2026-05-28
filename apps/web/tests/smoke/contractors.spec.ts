import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { mockLeasiumApi } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page);
});

test("contractor directory exports readiness CSV", async ({ page }) => {
  await page.route("**/api/v1/contractors?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "contractor-cool-air",
          entity_id: "entity-1",
          name: "Cool Air Services",
          company_name: "Cool Air Pty Ltd",
          categories: ["hvac", "urgent"],
          email: "service@coolair.example",
          phone: "07 3000 1111",
          service_radius_km: 25,
          priority: 1,
          notes: "Preferred HVAC contractor for urgent cooling faults.",
          created_at: "2026-05-20T00:00:00.000Z",
          updated_at: "2026-05-20T00:00:00.000Z",
        },
        {
          id: "contractor-backup-plumbing",
          entity_id: "entity-1",
          name: "Backup Plumbing",
          company_name: null,
          categories: ["plumbing"],
          email: null,
          phone: null,
          service_radius_km: null,
          priority: 3,
          notes: "Needs contact details before dispatch.",
          created_at: "2026-05-21T00:00:00.000Z",
          updated_at: "2026-05-21T00:00:00.000Z",
        },
      ]),
    });
  });

  await page.goto("/contractors");

  await expect(
    page.getByRole("heading", { name: "Contractor directory" }),
  ).toBeVisible();
  await expect(page.getByText("Cool Air Services")).toBeVisible();
  await expect(page.getByText("Backup Plumbing")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download directory CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "contractor-directory-readiness.csv",
  );
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const csv = await readFile(downloadPath!, "utf8");

  expect(csv).toContain("Cool Air Services");
  expect(csv).toContain("Cool Air Pty Ltd");
  expect(csv).toContain("hvac; urgent");
  expect(csv).toContain("Preferred");
  expect(csv).toContain("Email ready");
  expect(csv).toContain("Phone ready");
  expect(csv).toContain("Backup Plumbing");
  expect(csv).toContain("Backup");
  expect(csv).toContain("Email missing");
  expect(csv).toContain("Phone missing");
  expect(csv).toContain("AI suggest ready");
  expect(csv).toContain("Needs contact details before dispatch.");
  expect(csv).toContain(
    "Review-only export: downloading this file does not send contractor email or SMS, run maintenance AI classification, assign work-order contractors, create/update/delete contractors, write provider history, or dispatch receipts.",
  );
});
