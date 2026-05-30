import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

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
  await expect(
    page.getByRole("heading", { name: "Month-end signoff packet" }),
  ).toBeVisible();
  const signoffDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download signoff CSV" }).click();
  const signoffDownload = await signoffDownloadPromise;
  expect(signoffDownload.suggestedFilename()).toBe(
    "owner-statement-signoff-2026-05.csv",
  );

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
  const evidenceDownloadPath = await evidenceDownload.path();
  expect(evidenceDownloadPath).not.toBeNull();
  const evidenceCsv = await readFile(evidenceDownloadPath!, "utf8");
  expect(evidenceCsv).toContain('"Owner","Property","Invoice","Title"');
  expect(evidenceCsv).toContain("Queen Street Property Trust");
  expect(evidenceCsv).toContain("Queen Street");
  expect(evidenceCsv).toContain("INV-1001");
  expect(evidenceCsv).toContain("May rent and outgoings");
  expect(evidenceCsv).toContain("Local invoice draft");

  const invoiceRow = evidence.getByRole("row").filter({ hasText: "INV-1001" });
  await expect(invoiceRow).toContainText("May rent and outgoings");
  await expect(invoiceRow).toContainText("Due 15 May 2026");
  await expect(invoiceRow).toContainText("$8,800");
  await expect(invoiceRow).toContainText("$0 paid");
  await expect(invoiceRow).toContainText("$8,800 due");
  await expect(invoiceRow).toContainText("Unpaid");
  await expect(invoiceRow).toContainText("Local invoice draft");
});

test("owner statement dispatch approval queue exports review CSV", async ({
  page,
}) => {
  await page.goto("/statements?month=2026-05");

  await expect(
    page.getByRole("heading", { name: "Dispatch approval queue" }),
  ).toBeVisible();
  const dispatchDownloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download dispatch CSV" })
    .click();
  const dispatchDownload = await dispatchDownloadPromise;
  expect(dispatchDownload.suggestedFilename()).toBe(
    "owner-statement-dispatch-review-2026-05.csv",
  );
  const dispatchDownloadPath = await dispatchDownload.path();
  expect(dispatchDownloadPath).not.toBeNull();
  const dispatchCsv = await readFile(dispatchDownloadPath!, "utf8");
  expect(dispatchCsv).toContain("Queen Street Property Trust");
  expect(dispatchCsv).toContain("owners@queenstreet.example");
  expect(dispatchCsv).toContain("Payment review");
  expect(dispatchCsv).toContain("Owner statement for May 2026");
  expect(dispatchCsv).toContain("2");
  expect(dispatchCsv).toContain("$17,600");
  expect(dispatchCsv).toContain("Recipient gate");
  expect(dispatchCsv).toContain(
    "Review-only export: downloading this file does not download owner PDFs, download PDF packs, send owner email, dispatch comms, dispatch invoices, write Xero data, preview or apply payment reconciliation, refresh providers, or mutate provider history.",
  );
});

test("owner statement dispatch draft downloads as review-only text", async ({
  page,
}) => {
  await page.goto("/statements?month=2026-05");

  await expect(
    page.getByRole("heading", { name: "Dispatch review" }),
  ).toBeVisible();
  const draftDownloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download dispatch draft" })
    .click();
  const draftDownload = await draftDownloadPromise;
  expect(draftDownload.suggestedFilename()).toBe(
    "owner-statement-dispatch-draft-2026-05-queen-street-property-trust.txt",
  );
  const draftDownloadPath = await draftDownload.path();
  expect(draftDownloadPath).not.toBeNull();
  const draftText = await readFile(draftDownloadPath!, "utf8");
  expect(draftText).toContain("To: owners@queenstreet.example");
  expect(draftText).toContain(
    "Subject: Owner statement for May 2026 - Queen Street Property Trust",
  );
  expect(draftText).toContain("Hi Mia Accounts,");
  expect(draftText).toContain("Invoiced: $17,600");
  expect(draftText).toContain("Outstanding: $17,600");
  expect(draftText).toContain(
    "Review-only export: downloading this file does not send owner email, dispatch comms, attach or download owner PDFs, write Xero data, preview or apply payment reconciliation, dispatch invoices, refresh providers, or mutate provider history.",
  );
});
