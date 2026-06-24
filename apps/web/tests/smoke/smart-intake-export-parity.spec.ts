import { expect, type Locator, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { mockLeasiumApi } from "./api-mocks";

type ClipboardWindow = Window & {
  __copiedSmartIntakeReviewCsv?: string;
};

const reviewQueueIntakes = [
  {
    id: "intake-tenant-upload-insurance-formula-1",
    entity_id: "entity-1",
    document_id: "tenant-upload-insurance-formula-document-1",
    status: "ready_for_review",
    document_type: "insurance_certificate",
    summary: "  +SUM(1,2)",
    confidence: 0.91,
    extracted_data: {
      document_type: "insurance_certificate",
      summary: "  +SUM(1,2)",
      confidence: 0.91,
      parties: [{ name: "Bright Cafe Pty Ltd", role: "insured" }],
      properties: [],
      key_dates: [{ label: "Policy expiry", date: "2027-02-28" }],
      money_amounts: [],
      obligations: [],
      inspection_findings: [],
      suggested_links: { tenant_name: "Bright Cafe Pty Ltd" },
      warnings: [],
      missing_information: [],
    },
    review_data: {
      source: "tenant_portal",
      candidate: "tenant_uploaded_insurance_auto_update",
      tenant_id: "tenant-1",
      lease_id: "lease-1",
      guardrail:
        "Tenant-uploaded documents stay review-only until an operator applies the Smart Intake review.",
    },
    openai_response_id: "resp-tenant-upload-insurance-formula-smoke",
    error_message: null,
    reviewed_at: null,
    reviewed_by_user_id: null,
    applied_at: null,
    applied_by_user_id: null,
    created_at: "2026-05-27T02:10:00.000Z",
    updated_at: "2026-05-27T02:10:00.000Z",
    filename: "=tenant-uploaded-insurance.txt",
    content_type: "text/plain",
    byte_size: 2345,
    category: "insurance",
  },
  {
    id: "intake-inbound-email-attachment-parity-1",
    entity_id: "entity-1",
    document_id: "document-inbound-email-attachment-parity-1",
    status: "ready_for_review",
    document_type: "insurance_certificate",
    summary: "Inbound insurance certificate expires 2027-04-30.",
    confidence: 0.88,
    extracted_data: {
      document_type: "insurance_certificate",
      summary: "Inbound insurance certificate expires 2027-04-30.",
      confidence: 0.88,
      parties: [{ name: "Bright Cafe Pty Ltd", role: "insured" }],
      properties: [],
      key_dates: [{ label: "Policy expiry", date: "2027-04-30" }],
      money_amounts: [],
      obligations: [],
      inspection_findings: [],
      suggested_links: { tenant_name: "Bright Cafe Pty Ltd" },
      warnings: [],
      missing_information: [],
    },
    review_data: {
      source: "sendgrid_inbound_parse",
      candidate: "inbound_email_attachment",
      inbound_message_id: "inbound-email-attachment-parity-1",
      inbound_subject: "Insurance certificate",
      inbound_sender: "broker@inbound.example",
      inbound_received_at: "2026-05-27T02:05:00.000Z",
      tenant_id: "tenant-1",
      guardrail:
        "Inbound email attachments stay review-only until an operator applies the Smart Intake review.",
    },
    openai_response_id: "resp-inbound-attachment-parity-smoke",
    error_message: null,
    reviewed_at: null,
    reviewed_by_user_id: null,
    applied_at: null,
    applied_by_user_id: null,
    created_at: "2026-05-27T02:05:00.000Z",
    updated_at: "2026-05-27T02:05:00.000Z",
    filename: "inbound-insurance-certificate.txt",
    content_type: "text/plain",
    byte_size: 1234,
    category: "other",
  },
  {
    id: "intake-inspection-parity-1",
    entity_id: "entity-1",
    document_id: "document-inspection-parity-1",
    status: "ready_for_review",
    document_type: "inspection_report",
    summary:
      "Inspection report with two maintenance findings ready for review.",
    confidence: 0.84,
    extracted_data: {
      document_type: "inspection_report",
      summary:
        "Inspection report with two maintenance findings ready for review.",
      confidence: 0.84,
      parties: [],
      properties: [
        {
          name: "Queen Street Retail Centre",
          address: "12 Queen Street",
          unit_label: "Shop 3",
        },
      ],
      key_dates: [],
      money_amounts: [],
      obligations: [],
      inspection_findings: [
        {
          title: "Repair leaking tap",
          description: "Kitchen mixer is leaking at the base.",
          priority: "high",
          due_date: "2026-06-04",
          location: "Kitchen",
          category: "plumbing",
          confidence: 0.88,
          source_hint: "Inspection item 4",
          warnings: [],
          photo_document_ids: [],
        },
      ],
      suggested_links: {
        property_name: "Queen Street Retail Centre",
        tenant_name: "Bright Cafe Pty Ltd",
        lease_reference: "Shop 3 lease",
      },
      warnings: [],
      missing_information: [],
      proposed_actions: [
        {
          action: "prepare_maintenance_work_orders",
          target: "operations",
          summary: "Review findings before creating work orders.",
          confidence: 0.82,
        },
      ],
    },
    review_data: {},
    openai_response_id: "resp-inspection-parity-smoke",
    error_message: null,
    reviewed_at: null,
    reviewed_by_user_id: null,
    applied_at: null,
    applied_by_user_id: null,
    created_at: "2026-05-28T05:00:00.000Z",
    updated_at: "2026-05-28T05:00:00.000Z",
    filename: "queen-street-inspection.txt",
    content_type: "text/plain",
    byte_size: 3456,
    category: "other",
  },
];

async function expectTouchTarget(locator: Locator, minSize = 44) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.width).toBeGreaterThanOrEqual(minSize);
  expect(box.height).toBeGreaterThanOrEqual(minSize);
}

function isForbiddenSmartIntakeExportRequest(method: string, path: string) {
  const isDocumentIntakeApply =
    /^\/document-intakes\/[^/]+\/apply$/.test(path) ||
    /^\/document-intakes\/[^/]+\/accept-lease-match$/.test(path);
  const isProviderMutation =
    path.includes("/provider-dispatch") ||
    path.includes("/provider-history") ||
    path.includes("/provider-refresh");
  const isMessageSend =
    path.includes("/sendgrid") ||
    path.includes("/twilio") ||
    path.includes("/send-email") ||
    path.includes("/send-sms");
  const isFinancialMutation =
    method !== "GET" &&
    (path.includes("/billing") ||
      path.includes("/payment") ||
      path.includes("/reconciliation") ||
      path.includes("/invoice"));

  return (
    isDocumentIntakeApply ||
    path.startsWith("/maintenance") ||
    path.startsWith("/tenant-onboarding") ||
    path.startsWith("/comms") ||
    path.includes("/xero") ||
    path.includes("/basiq") ||
    isProviderMutation ||
    isMessageSend ||
    isFinancialMutation
  );
}

async function copyAndDownloadReviewQueueCsv({
  copyButton,
  downloadButton,
}: {
  copyButton: Locator;
  downloadButton: Locator;
}) {
  await copyButton.page().evaluate(() => {
    (window as ClipboardWindow).__copiedSmartIntakeReviewCsv = "";
  });

  await copyButton.click();
  await expect
    .poll(() =>
      copyButton
        .page()
        .evaluate(
          () => (window as ClipboardWindow).__copiedSmartIntakeReviewCsv ?? "",
        ),
    )
    .not.toBe("");
  const copiedCsv = await copyButton
    .page()
    .evaluate(
      () => (window as ClipboardWindow).__copiedSmartIntakeReviewCsv ?? "",
    );

  const downloadPromise = copyButton.page().waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();

  return {
    copiedCsv,
    downloadedCsv: await readFile(downloadPath!, "utf8"),
    filename: download.suggestedFilename(),
  };
}

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page);
});

test("smart intake review queue copies and downloads identical filtered CSV locally", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as ClipboardWindow).__copiedSmartIntakeReviewCsv = text;
        },
      },
    });
  });

  let reviewExportsStarted = false;
  const forbiddenApiCalls: string[] = [];

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");

    if (request.method() === "GET" && path === "/document-intakes") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(reviewQueueIntakes),
      });
      return;
    }

    if (
      reviewExportsStarted &&
      isForbiddenSmartIntakeExportRequest(request.method(), path)
    ) {
      forbiddenApiCalls.push(`${request.method()} ${path}`);
      await route.fulfill({
        status: 418,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Smart Intake review queue export must stay local-only",
        }),
      });
      return;
    }

    await route.fallback();
  });

  await page.goto("/intake");

  await expect(
    page.getByRole("heading", { level: 1, name: "Relby AI" }),
  ).toBeVisible();

  const exportControls = page.getByLabel("Review filter").locator("xpath=..");
  const copyButton = exportControls.getByRole("button", {
    name: "Copy review queue CSV",
  });
  const downloadButton = exportControls.getByRole("button", {
    name: "Download queue CSV",
  });

  await expect(downloadButton).toBeVisible();
  await expect(copyButton).toBeVisible();
  await expectTouchTarget(copyButton);
  await expectTouchTarget(downloadButton);

  reviewExportsStarted = true;

  await page.getByLabel("Review filter").selectOption("tenant_portal");
  await expect(
    page.getByTestId("review-intake-intake-tenant-upload-insurance-formula-1"),
  ).toBeVisible();

  const tenantPortalCsv = await copyAndDownloadReviewQueueCsv({
    copyButton,
    downloadButton,
  });
  expect(tenantPortalCsv.filename).toBe(
    "smart-intake-review-queue-tenant_portal.csv",
  );
  expect(tenantPortalCsv.copiedCsv).toBe(tenantPortalCsv.downloadedCsv);
  expect(tenantPortalCsv.copiedCsv).toContain(
    '"\'=tenant-uploaded-insurance.txt"',
  );
  expect(tenantPortalCsv.copiedCsv).toContain('"\'  +SUM(1,2)"');
  expect(tenantPortalCsv.copiedCsv).toContain("Tenant portal upload");
  expect(tenantPortalCsv.copiedCsv).not.toContain(
    "inbound-insurance-certificate.txt",
  );
  expect(tenantPortalCsv.copiedCsv).not.toContain(
    "queen-street-inspection.txt",
  );

  await page
    .getByLabel("Review filter")
    .selectOption("inbound_email_attachment");
  const inboundCsv = await copyAndDownloadReviewQueueCsv({
    copyButton,
    downloadButton,
  });
  expect(inboundCsv.filename).toBe(
    "smart-intake-review-queue-inbound_email_attachment.csv",
  );
  expect(inboundCsv.copiedCsv).toBe(inboundCsv.downloadedCsv);
  expect(inboundCsv.copiedCsv).toContain("inbound-insurance-certificate.txt");
  expect(inboundCsv.copiedCsv).toContain("Inbound email attachment");
  expect(inboundCsv.copiedCsv).not.toContain("=tenant-uploaded-insurance.txt");
  expect(inboundCsv.copiedCsv).not.toContain("queen-street-inspection.txt");

  await page.getByLabel("Review filter").selectOption("inspection_report");
  const inspectionCsv = await copyAndDownloadReviewQueueCsv({
    copyButton,
    downloadButton,
  });
  expect(inspectionCsv.filename).toBe(
    "smart-intake-review-queue-inspection_report.csv",
  );
  expect(inspectionCsv.copiedCsv).toBe(inspectionCsv.downloadedCsv);
  expect(inspectionCsv.copiedCsv).toContain("queen-street-inspection.txt");
  expect(inspectionCsv.copiedCsv).toContain("inspection report");
  expect(inspectionCsv.copiedCsv).not.toContain(
    "=tenant-uploaded-insurance.txt",
  );
  expect(inspectionCsv.copiedCsv).not.toContain(
    "inbound-insurance-certificate.txt",
  );

  expect(forbiddenApiCalls).toEqual([]);
});
