import { expect, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page);
});

test("owner statement preview exposes invoice-level evidence", async ({
  page,
}) => {
  await page.goto("/statements?month=2026-05");

  await expect(
    page.getByRole("heading", { name: "Statement preview" }),
  ).toBeVisible();

  const evidence = page.getByRole("region", { name: "Invoice evidence" });
  await expect(evidence).toBeVisible();
  const evidenceDownloadPromise = page.waitForEvent("download");
  await evidence
    .getByRole("button", { name: "Download invoice evidence CSV" })
    .click();
  const evidenceDownload = await evidenceDownloadPromise;
  expect(evidenceDownload.suggestedFilename()).toBe(
    "owner-statement-invoice-evidence-2026-05-queen-street-property-trust.csv",
  );

  const invoiceRow = evidence.getByRole("row").filter({ hasText: "INV-1001" });
  await expect(invoiceRow).toContainText("May rent and outgoings");
  await expect(invoiceRow).toContainText("Due 15 May 2026");
  await expect(invoiceRow).toContainText("$8,800");
  await expect(invoiceRow).toContainText("$0 paid");
  await expect(invoiceRow).toContainText("$8,800 due");
  await expect(invoiceRow).toContainText("Unpaid");
  await expect(invoiceRow).toContainText("Local invoice draft");
});
