import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { mockLeasiumApi } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page);
});

test("contractor directory copies and downloads the same guarded readiness CSV", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as Window & { __copiedContractorDirectoryCsv?: string })
            .__copiedContractorDirectoryCsv = text;
        },
      },
    });
  });

  const forbiddenApiPaths: string[] = [];
  const forbiddenPathStarts = [
    "/maintenance/ai",
    "/maintenance/classification",
    "/maintenance/work-orders",
    "/provider-history",
    "/providers",
    "/dispatch",
    "/comms",
    "/billing",
    "/billing-drafts",
    "/invoice",
    "/invoice-drafts",
    "/receipts",
    "/sendgrid",
    "/twilio",
    "/xero",
    "/basiq",
    "/payment",
    "/payments",
    "/reconciliation",
  ];
  const forbiddenPathFragments = [
    "ai-classification",
    "classification",
    "contractor-assignment",
    "assign-contractor",
    "contractor-delivery",
    "provider-history",
    "billing",
    "invoice",
    "receipt",
    "dispatch",
    "send-email",
    "send-sms",
    "sendgrid",
    "twilio",
    "xero",
    "basiq",
    "payment",
    "reconciliation",
  ];

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const apiPath = new URL(request.url()).pathname.replace("/api/v1", "");
    const isContractorMutation =
      apiPath === "/contractors" || apiPath.startsWith("/contractors/");
    const isForbiddenPath =
      forbiddenPathStarts.some((path) => apiPath.startsWith(path)) ||
      forbiddenPathFragments.some((fragment) =>
        apiPath.toLowerCase().includes(fragment),
      );

    if (
      isForbiddenPath ||
      (request.method() !== "GET" && isContractorMutation)
    ) {
      forbiddenApiPaths.push(`${request.method()} ${apiPath}`);
    }

    await route.fallback();
  });

  await page.route("**/api/v1/contractors?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "contractor-cool-air",
          entity_id: "entity-1",
          name: "Cool Air Services",
          company_name: "=Cool Air Pty Ltd",
          categories: ["hvac", "urgent"],
          email: "service@coolair.example",
          phone: "07 3000 1111",
          service_radius_km: 25,
          priority: 1,
          notes: "+Preferred HVAC contractor for urgent cooling faults.",
          created_at: "2026-05-20T00:00:00.000Z",
          updated_at: "2026-05-20T00:00:00.000Z",
        },
        {
          id: "contractor-backup-plumbing",
          entity_id: "entity-1",
          name: "@Backup Plumbing",
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
  await expect(page.getByText("@Backup Plumbing")).toBeVisible();

  const copyButton = page.getByRole("button", {
    name: "Copy directory CSV",
  });
  const downloadButton = page.getByRole("button", {
    name: "Download directory CSV",
  });
  await expect(copyButton).toBeVisible();
  await expect(downloadButton).toBeVisible();
  for (const control of [copyButton, downloadButton]) {
    const box = await control.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }

  await copyButton.click();
  await expect(
    page.getByText("Contractor directory CSV copied."),
  ).toBeVisible();
  const copiedCsv = await page.evaluate(
    () =>
      (window as Window & { __copiedContractorDirectoryCsv?: string })
        .__copiedContractorDirectoryCsv,
  );
  expect(copiedCsv).toBeTruthy();

  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "contractor-directory-readiness.csv",
  );
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const downloadedCsv = await readFile(downloadPath!, "utf8");
  expect(copiedCsv).toBe(downloadedCsv);

  const csv = downloadedCsv;

  expect(csv).toContain("Cool Air Services");
  expect(csv).toContain("'=Cool Air Pty Ltd");
  expect(csv).toContain("hvac; urgent");
  expect(csv).toContain("Preferred");
  expect(csv).toContain("Email ready");
  expect(csv).toContain("Phone ready");
  expect(csv).toContain("'@Backup Plumbing");
  expect(csv).toContain("Backup");
  expect(csv).toContain("Email missing");
  expect(csv).toContain("Phone missing");
  expect(csv).toContain("AI suggest ready");
  expect(csv).toContain("AI suggest needs contact details");
  expect(csv).toContain("Needs contact details before dispatch.");
  expect(csv).toContain(
    "'+Preferred HVAC contractor for urgent cooling faults.",
  );
  expect(csv).toContain(
    "Review-only export: copying or downloading this file does not send contractor email or SMS, run maintenance AI classification, assign work-order contractors, create/update/delete contractors, write provider history, dispatch receipts, call SendGrid or Twilio, call Xero or Basiq, apply payments, or reconcile payments.",
  );
  expect(forbiddenApiPaths).toEqual([]);
});
