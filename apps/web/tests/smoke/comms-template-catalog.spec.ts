import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { mockLeasiumApi, seedPrimaryEntitySelection } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await seedPrimaryEntitySelection(page);
  await mockLeasiumApi(page);
});

test("comms template catalog reviews active templates and exports locally", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as Window & { __copiedCommsTemplateCatalogCsv?: string })
            .__copiedCommsTemplateCatalogCsv = text;
        },
      },
    });
  });

  const forbiddenApiCalls: string[] = [];
  let templateExportStarted = false;

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");
    const method = request.method();
    const unsafeAfterExport =
      templateExportStarted &&
      (method !== "GET" ||
        path.includes("/comms/dispatch") ||
        path.includes("/comms/dismiss") ||
        path.includes("/provider") ||
        path.includes("/history") ||
        path.includes("/sendgrid") ||
        path.includes("/twilio") ||
        path.includes("/xero") ||
        path.includes("/basiq") ||
        path.includes("/payment") ||
        path.includes("/reconciliation") ||
        path.includes("/billing") ||
        path.includes("/invoice") ||
        path.includes("/email") ||
        path.includes("/settle") ||
        path.includes("/refresh") ||
        path.includes("/branded-communication-templates"));

    if (unsafeAfterExport) {
      forbiddenApiCalls.push(`${method} ${path}`);
      await route.fulfill({
        status: 418,
        contentType: "application/json",
        body: JSON.stringify({
          error: "comms template catalog export must stay local-only",
        }),
      });
      return;
    }

    await route.fallback();
  });

  await page.goto("/comms");

  const templateCatalog = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Template catalog" }) });
  await expect(templateCatalog).toBeVisible();
  await expect(templateCatalog.getByText("2 active templates")).toBeVisible();
  await expect(templateCatalog.getByText("SKJ invoice delivery")).toBeVisible();
  await expect(templateCatalog.getByText("invoice_delivery")).toBeVisible();
  await expect(
    templateCatalog.getByText("SendGrid email", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    templateCatalog.getByText("Override", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    templateCatalog.getByText(
      "Stored override is visible only; runtime sends still use approved templates.",
    ),
  ).toBeVisible();
  await expect(
    templateCatalog.getByText("Contractor update default"),
  ).toBeVisible();
  await expect(
    templateCatalog.getByText("System", { exact: true }).first(),
  ).toBeVisible();

  templateExportStarted = true;

  await templateCatalog
    .getByRole("button", { name: "Copy template catalog CSV" })
    .click();
  await expect(page.getByText("Template catalog CSV copied.")).toBeVisible();
  const copiedCsv = await page.evaluate(
    () =>
      (window as Window & { __copiedCommsTemplateCatalogCsv?: string })
        .__copiedCommsTemplateCatalogCsv ?? "",
  );

  const downloadPromise = page.waitForEvent("download");
  await templateCatalog
    .getByRole("button", { name: "Download template catalog CSV" })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "comms-template-catalog-2026-05-22.csv",
  );
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const downloadedCsv = await readFile(downloadPath!, "utf8");

  expect(copiedCsv).toBe(downloadedCsv);
  expect(copiedCsv).toContain("Template catalog");
  expect(copiedCsv).toContain("SKJ invoice delivery");
  expect(copiedCsv).toContain("invoice_delivery");
  expect(copiedCsv).toContain("sendgrid");
  expect(copiedCsv).toContain("Contractor update default");
  expect(copiedCsv).toContain(
    "Review-only export: copying or downloading this file does not send SendGrid email, send Twilio SMS, dispatch queued drafts, dismiss candidates, refresh providers, mutate communication templates, write provider history, or change tenant, maintenance, invoice, billing, payment, reconciliation, Xero, or Basiq records.",
  );
  expect(forbiddenApiCalls).toEqual([]);
});
