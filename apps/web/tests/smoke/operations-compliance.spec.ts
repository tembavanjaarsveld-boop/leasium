import { expect, type Locator, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { mockLeasiumApi, seedPrimaryEntitySelection } from "./api-mocks";

// The two-entity fixture defaults fresh storage to All entities; pin these
// single-entity specs to the primary entity.
test.beforeEach(async ({ page }) => {
  await seedPrimaryEntitySelection(page);
});

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

  // Read-only certificate-expiry badges driven by the backend projection.
  const dueSoonRow = page.getByTestId(
    "compliance-check-compliance-check-fire-1",
  );
  await expect(
    dueSoonRow.getByText("Certificate due in 21 days"),
  ).toBeVisible();
  const expiredRow = page.getByTestId(
    "compliance-check-compliance-check-lift-1",
  );
  await expect(
    expiredRow.getByText("Certificate expired 5 days ago"),
  ).toBeVisible();
  // The bank check carries no certificate, so no expiry badge is shown.
  await expect(
    page
      .getByTestId("compliance-check-compliance-check-bank-1")
      .getByText(/^Certificate /),
  ).toHaveCount(0);

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

test("operations compliance tab links reviewed evidence to a needs-evidence check", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLeasiumApi(page, { operationsComplianceDemo: true });

  const evidenceLinkPayloads: unknown[] = [];
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
      apiPath === "/compliance/checks/compliance-check-bank-1/evidence"
    ) {
      evidenceLinkPayloads.push(request.postDataJSON());
    } else if (
      request.method() === "POST" &&
      apiPath.startsWith("/compliance/checks/") &&
      apiPath.endsWith("/complete")
    ) {
      forbiddenMutationCalls.push(`${request.method()} ${apiPath}`);
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
    "compliance-check-compliance-check-bank-1",
  );
  await expect(checkRow).toContainText("Bank guarantee expiry");
  await expect(checkRow).toContainText("Needs evidence");
  await expect(
    checkRow.getByRole("button", { name: "Needs evidence" }),
  ).toBeDisabled();

  const addEvidenceButton = checkRow.getByRole("button", {
    name: "Add evidence",
  });
  await expectTouchTarget(addEvidenceButton);
  await addEvidenceButton.click();

  const documentSelect = checkRow.getByLabel("Evidence document");
  await expect(documentSelect).toBeVisible();
  await expect(
    documentSelect.locator("option", { hasText: "bright-cafe-insurance.pdf" }),
  ).toHaveCount(1);
  await documentSelect.selectOption("portal-document-1");
  await checkRow
    .getByLabel("Certificate expiry (optional)")
    .fill("2026-12-01");

  const linkButton = checkRow.getByRole("button", { name: "Link evidence" });
  await expectTouchTarget(linkButton);
  await linkButton.click();

  await expect(
    page.getByText(
      "Linked evidence to “Bank guarantee expiry”. Review before completing.",
    ),
  ).toBeVisible();
  await expect(
    checkRow.getByRole("button", { name: "Complete with linked evidence" }),
  ).toBeEnabled();

  expect(evidenceLinkPayloads).toHaveLength(1);
  expect(evidenceLinkPayloads[0]).toMatchObject({
    source_document_id: "portal-document-1",
    certificate_expires_on: "2026-12-01",
  });
  expect(forbiddenMutationCalls).toEqual([]);
});

test("operations compliance tab uploads a new file and links it as evidence", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLeasiumApi(page, { operationsComplianceDemo: true });

  const evidenceLinkPayloads: unknown[] = [];
  const documentUploadContentTypes: string[] = [];
  const uploadedDocumentIds: string[] = [];
  const forbiddenMutationCalls: string[] = [];

  page.on("response", async (response) => {
    const responsePath = new URL(response.url()).pathname;
    if (
      response.request().method() === "POST" &&
      responsePath === "/api/v1/documents"
    ) {
      const body = (await response.json()) as { id?: string };
      if (typeof body.id === "string") {
        uploadedDocumentIds.push(body.id);
      }
    }
  });

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const apiPath = path.replace("/api/v1", "");
    if (request.method() === "POST" && apiPath === "/documents") {
      documentUploadContentTypes.push(request.headers()["content-type"] ?? "");
    } else if (
      request.method() === "POST" &&
      apiPath === "/compliance/checks/compliance-check-bank-1/evidence"
    ) {
      evidenceLinkPayloads.push(request.postDataJSON());
    } else if (request.method() !== "GET") {
      forbiddenMutationCalls.push(`${request.method()} ${apiPath}`);
    }
    await route.fallback();
  });

  await page.goto("/operations?tab=compliance");

  const checkRow = page.getByTestId(
    "compliance-check-compliance-check-bank-1",
  );
  await expect(checkRow).toContainText("Bank guarantee expiry");
  await expect(checkRow).toContainText("Needs evidence");

  const addEvidenceButton = checkRow.getByRole("button", {
    name: "Add evidence",
  });
  await expectTouchTarget(addEvidenceButton);
  await addEvidenceButton.click();

  const fileInput = checkRow.getByLabel("Upload a new file (optional)");
  await expect(fileInput).toBeVisible();
  await fileInput.setInputFiles({
    name: "bank-guarantee-renewal.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 compliance evidence smoke fixture"),
  });

  const uploadButton = checkRow.getByRole("button", {
    name: "Upload & link evidence",
  });
  await expectTouchTarget(uploadButton);
  await uploadButton.click();

  await expect(
    page.getByText(
      "Linked evidence to “Bank guarantee expiry”. Review before completing.",
    ),
  ).toBeVisible();
  await expect(
    checkRow.getByRole("button", { name: "Complete with linked evidence" }),
  ).toBeEnabled();

  expect(documentUploadContentTypes).toHaveLength(1);
  expect(documentUploadContentTypes[0]).toContain("multipart/form-data");
  expect(uploadedDocumentIds).toHaveLength(1);
  expect(uploadedDocumentIds[0]).toMatch(/^operator-document-upload-/);
  expect(evidenceLinkPayloads).toHaveLength(1);
  expect(evidenceLinkPayloads[0]).toMatchObject({
    source_document_id: uploadedDocumentIds[0],
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

test("operations compliance tab surfaces operator-approved completion history and evidence state", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLeasiumApi(page, { operationsComplianceDemo: true });

  const forbiddenMutationCalls: string[] = [];
  // Per-test override: fulfill the compliance-checks GET directly with a
  // constructed fixture (mirroring the seeded fire/bank checks from
  // api-mocks) so the fire check carries the operator-approved completion
  // fields the backend now records, plus extra entries to exercise the
  // "show all" disclosure. There is no upstream API server in this mocked
  // smoke, so route.fulfill — never route.fetch. Read/display only.
  const overdueFireDueDate = "2026-05-10";
  const complianceChecksFixture = [
    {
      id: "compliance-check-fire-1",
      entity_id: "entity-1",
      property_id: "property-1",
      tenancy_unit_id: "unit-1",
      tenant_id: "tenant-1",
      lease_id: "lease-1",
      assigned_user_id: "operator-2",
      source_document_id: "document-compliance-fire-1",
      current_obligation_id: "obligation-compliance-1",
      title: "Annual fire safety statement",
      kind: "fire_safety",
      status: "active",
      jurisdiction: "QLD",
      authority: "Queensland Fire and Emergency Services",
      recurrence_interval: 1,
      recurrence_unit: "years",
      last_checked_at: "2025-05-10T00:00:00.000Z",
      next_due_date: overdueFireDueDate,
      certificate_expires_on: "2026-06-30",
      certificate_expiry_status: "due_soon",
      days_until_certificate_expiry: 21,
      owner_role: "ops",
      notes: "QFES statement needs certificate evidence before rollover.",
      metadata: {
        evidence_history: [
          {
            document_id: "document-compliance-fire-1",
            added_at: "2025-05-10T01:00:00.000Z",
            actor: "ops@example.test",
          },
        ],
        completion_history: [
          {
            completed_at: "2024-05-09T01:00:00.000Z",
            next_due_date: "2025-05-10",
            source_document_id: "document-compliance-fire-prev",
            operator_approved: true,
            approved_by: "alex.operator@example.test",
            approved_at: "2024-05-09T02:30:00.000Z",
            notes: "First annual statement filed.",
          },
          {
            completed_at: "2025-05-10T01:00:00.000Z",
            next_due_date: "2026-05-10",
            source_document_id: "document-compliance-fire-1",
            operator_approved: true,
            approved_by: "jordan.reviewer@example.test",
            approved_at: "2025-05-10T03:15:00.000Z",
            notes: "Renewal certificate reviewed and approved.",
          },
          {
            completed_at: "2025-11-01T01:00:00.000Z",
            next_due_date: "2026-05-10",
            source_document_id: "document-compliance-fire-interim",
            operator_approved: true,
            approved_by: "sam.compliance@example.test",
            approved_at: "2025-11-01T04:00:00.000Z",
          },
        ],
      },
      created_at: "2026-05-01T00:00:00.000Z",
      updated_at: "2026-05-20T00:00:00.000Z",
      deleted_at: null,
    },
    {
      id: "compliance-check-bank-1",
      entity_id: "entity-1",
      property_id: "property-1",
      tenancy_unit_id: "unit-1",
      tenant_id: "tenant-1",
      lease_id: "lease-1",
      assigned_user_id: null,
      source_document_id: null,
      current_obligation_id: "obligation-compliance-2",
      title: "Bank guarantee expiry",
      kind: "bank_guarantee",
      status: "active",
      jurisdiction: "QLD",
      authority: "Lease schedule",
      recurrence_interval: 6,
      recurrence_unit: "months",
      last_checked_at: "2025-12-01T00:00:00.000Z",
      next_due_date: "2026-06-01",
      certificate_expires_on: null,
      certificate_expiry_status: "none",
      days_until_certificate_expiry: null,
      owner_role: "property_manager",
      notes: "Review tenant guarantee before the expiry window.",
      metadata: {
        evidence_history: [],
        completion_history: [],
      },
      created_at: "2026-05-01T00:00:00.000Z",
      updated_at: "2026-05-20T00:00:00.000Z",
      deleted_at: null,
    },
  ];

  await page.route("**/api/v1/compliance/checks**", async (route) => {
    const request = route.request();
    if (
      request.method() !== "GET" ||
      new URL(request.url()).pathname.replace("/api/v1", "") !==
        "/compliance/checks"
    ) {
      await route.fallback();
      return;
    }
    await route.fulfill({ json: complianceChecksFixture });
  });

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const apiPath = new URL(request.url()).pathname.replace("/api/v1", "");
    if (
      request.method() !== "GET" &&
      (apiPath.startsWith("/compliance/checks") ||
        /email|sms|sendgrid|twilio|xero|basiq|payment|reconciliation/i.test(
          apiPath,
        ))
    ) {
      forbiddenMutationCalls.push(`${request.method()} ${apiPath}`);
    }
    await route.fallback();
  });

  await page.goto("/operations?tab=compliance");

  const checkRow = page.getByTestId("compliance-check-compliance-check-fire-1");
  await expect(checkRow).toContainText("Annual fire safety statement");

  // Evidence + completed/due state badges read from the existing record.
  await expect(checkRow.getByText("Evidence on file")).toBeVisible();
  await expect(checkRow.getByText(/\d+d overdue/)).toBeVisible();

  // Completion history disclosure: most-recent first, approver + approval date.
  await expect(checkRow.getByText("Completion history")).toBeVisible();
  await expect(checkRow).toContainText("3 recorded completions");
  await expect(checkRow.getByText("Operator approved").first()).toBeVisible();
  await expect(checkRow).toContainText("sam.compliance@example.test");
  await expect(checkRow).toContainText("jordan.reviewer@example.test");

  // The oldest entry is collapsed behind the "show all" disclosure.
  await expect(checkRow).not.toContainText("alex.operator@example.test");

  const showAllButton = checkRow.getByRole("button", {
    name: "Show all 3 completions",
  });
  await expectTouchTarget(showAllButton);
  await showAllButton.click();
  await expect(checkRow).toContainText("alex.operator@example.test");
  await expect(checkRow).toContainText("First annual statement filed.");

  await checkRow
    .getByRole("button", { name: "Show fewer completions" })
    .click();
  await expect(checkRow).not.toContainText("alex.operator@example.test");

  expect(forbiddenMutationCalls).toEqual([]);
});
