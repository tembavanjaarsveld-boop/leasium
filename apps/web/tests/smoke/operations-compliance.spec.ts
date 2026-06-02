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

test("operations compliance tab completes a recurring check with linked evidence after review", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLeasiumApi(page, { operationsComplianceDemo: true });

  const completionPayloads: unknown[] = [];
  const forbiddenMutationCalls: string[] = [];
  const forbiddenPathPatterns = [
    "/providers",
    "/provider-dispatch",
    "/provider-history",
    "/comms",
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
      request.method() === "POST" &&
      apiPath === "/compliance/checks/compliance-check-fire-1/complete"
    ) {
      completionPayloads.push(request.postDataJSON());
    } else if (
      request.method() !== "GET" &&
      (forbiddenPathPatterns.some((pattern) => apiPath.startsWith(pattern)) ||
        forbiddenSendPathPattern.test(apiPath))
    ) {
      forbiddenMutationCalls.push(`${request.method()} ${apiPath}`);
    }
    await route.fallback();
  });

  await page.goto("/operations?tab=compliance");

  const checkRow = page.getByTestId(
    "compliance-check-compliance-check-fire-1",
  );
  await expect(checkRow).toContainText("Annual fire safety statement");
  await expect(checkRow).toContainText("Evidence linked");
  await expect(checkRow).toContainText(/\d+d overdue/);

  const completeButton = checkRow.getByRole("button", {
    name: "Complete with linked evidence",
  });
  await completeButton.click();

  await expect(
    page.getByText(
      "Completed “Annual fire safety statement” with linked evidence.",
    ),
  ).toBeVisible();
  await expect(checkRow).toContainText("10 May 2027");
  expect(completionPayloads).toHaveLength(1);
  expect(completionPayloads[0]).toMatchObject({
    source_document_id: "document-compliance-fire-1",
    metadata: {
      source: "operations_compliance_tab",
      action: "complete_with_linked_evidence",
    },
  });
  expect(forbiddenMutationCalls).toEqual([]);
});

test("operations compliance tab exports a per-check evidence packet without mutations", async ({
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
            window as Window & { __copiedComplianceEvidenceCsv?: string }
          ).__copiedComplianceEvidenceCsv = text;
        },
      },
    });
  });

  const forbiddenPacketCalls: string[] = [];
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
      forbiddenPacketCalls.push(`${request.method()} ${apiPath}`);
    }
    await route.fallback();
  });

  await page.goto("/operations?tab=compliance");

  const checkRow = page.getByTestId(
    "compliance-check-compliance-check-fire-1",
  );
  await expect(checkRow).toContainText("Completion evidence packet");
  await expect(checkRow).toContainText("document-compliance-fire-1");
  await expect(checkRow).toContainText("Last completed");
  await expect(checkRow).toContainText("10 May 2025");
  await expect(checkRow).toContainText("Review-only compliance packet");

  const copyButton = checkRow.getByRole("button", {
    name: "Copy evidence packet",
  });
  const downloadButton = checkRow.getByRole("button", {
    name: "Download evidence packet",
  });
  await expectTouchTarget(copyButton);
  await expectTouchTarget(downloadButton);

  await copyButton.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & { __copiedComplianceEvidenceCsv?: string }
          ).__copiedComplianceEvidenceCsv,
      ),
    )
    .toBeTruthy();
  const copiedCsv = await page.evaluate(
    () =>
      (window as Window & { __copiedComplianceEvidenceCsv?: string })
        .__copiedComplianceEvidenceCsv,
  );

  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "compliance-evidence-packet-compliance-check-fire-1.csv",
  );
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const csv = await readFile(downloadPath!, "utf8");
  expect(copiedCsv).toBe(csv);

  const rows = parseCsvRows(csv);
  expect(rows[0]).toEqual(["Field", "Value", "Guardrail"]);
  expect(csv).toContain("Annual fire safety statement");
  expect(csv).toContain("document-compliance-fire-1");
  expect(csv).toContain("Last completed");
  expect(csv).toContain("Next due");
  expect(csv).toContain("Review-only compliance packet");
  expect(csv).toContain("does not complete checks");
  expect(
    rows
      .flat()
      .filter(Boolean)
      .filter((cell) => /^[=+\-@]/.test(cell)),
  ).toEqual([]);
  expect(forbiddenPacketCalls).toEqual([]);
});
