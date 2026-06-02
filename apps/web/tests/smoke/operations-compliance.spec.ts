import { expect, type Locator, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { mockLeasiumApi } from "./api-mocks";

function parseCsvRows(csv: string) {
  return csv
    .trim()
    .split("\n")
    .map((line) =>
      Array.from(line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g), ([, cell]) =>
        cell.replaceAll('""', '"'),
      ),
    );
}

async function expectTouchTarget(control: Locator, minSize = 44) {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.width).toBeGreaterThanOrEqual(minSize);
  expect(box.height).toBeGreaterThanOrEqual(minSize);
}

test("operations compliance tab surfaces recurring checks and exports a local review packet", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLeasiumApi(page, { operationsComplianceDemo: true });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (
            window as Window & { __copiedComplianceCsv?: string }
          ).__copiedComplianceCsv = text;
        },
      },
    });
  });

  const forbiddenLocalExportCalls: string[] = [];
  const forbiddenPathPatterns = [
    "/providers",
    "/provider-dispatch",
    "/provider-history",
    "/comms",
    "/compliance/checks",
    "/document-intakes",
    "/maintenance/work-orders",
    "/obligations",
    "/billing",
    "/invoice",
    "/xero",
    "/basiq",
    "/payment",
    "/reconciliation",
  ];
  const forbiddenSendPathPattern = /email|sms|sendgrid|twilio/i;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const apiPath = path.replace("/api/v1", "");
    if (
      (request.method() !== "GET" &&
        forbiddenPathPatterns.some((pattern) => apiPath.startsWith(pattern))) ||
      forbiddenSendPathPattern.test(apiPath)
    ) {
      forbiddenLocalExportCalls.push(`${request.method()} ${apiPath}`);
    }
    await route.fallback();
  });

  await page.goto("/operations?tab=compliance");

  const tabs = page.getByRole("tablist", { name: "Operations sections" });
  const complianceTab = tabs.getByRole("tab", { name: /Compliance/ });
  await expect(complianceTab).toHaveAttribute("aria-selected", "true");
  await expectTouchTarget(complianceTab);

  const panel = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Compliance & inspections" }),
    })
    .first();
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Annual fire safety statement");
  await expect(panel).toContainText("Bank guarantee expiry");
  await expect(panel).toContainText("Inspection report waiting review");
  await expect(panel).toContainText("Repair leaking tap");
  await expect(panel).toContainText("Queen Street Retail Centre");
  await expect(panel).toContainText("Bright Cafe");
  await expect(
    panel.locator(
      'a[href="/intake?entity_id=entity-1&review=intake-inspection-1"]',
    ).first(),
  ).toBeVisible();
  await expect(
    panel.locator('a[href="/operations/maintenance/inspection-work-order-1"]'),
  ).toBeVisible();

  const copyButton = panel.getByRole("button", {
    name: "Copy compliance CSV",
  });
  const downloadButton = panel.getByRole("button", {
    name: "Download compliance CSV",
  });
  await expectTouchTarget(copyButton);
  await expectTouchTarget(downloadButton);

  forbiddenLocalExportCalls.length = 0;
  await copyButton.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & { __copiedComplianceCsv?: string }
          ).__copiedComplianceCsv,
      ),
    )
    .toBeTruthy();
  const copiedCsv = await page.evaluate(
    () =>
      (window as Window & { __copiedComplianceCsv?: string })
        .__copiedComplianceCsv,
  );

  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("operations-compliance-review.csv");
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const csv = await readFile(downloadPath!, "utf8");
  expect(copiedCsv).toBe(csv);

  const rows = parseCsvRows(csv);
  expect(rows[0]).toEqual([
    "Kind",
    "Title",
    "Context",
    "Due",
    "Status",
    "Owner",
    "Evidence",
    "Next action",
    "Guardrail",
  ]);
  expect(csv).toContain("Compliance check");
  expect(csv).toContain("Inspection intake");
  expect(csv).toContain("Inspection work order");
  expect(csv).toContain("Annual fire safety statement");
  expect(csv).toContain("Bank guarantee expiry");
  expect(csv).toContain("Review-only compliance packet");
  expect(csv).toContain("does not complete checks");
  expect(csv).toContain("Smart Intake");
  expect(csv).toContain("Xero/Basiq");
  expect(
    rows
      .flat()
      .filter(Boolean)
      .filter((cell) => /^[=+\-@]/.test(cell)),
  ).toEqual([]);
  expect(forbiddenLocalExportCalls).toEqual([]);
});
