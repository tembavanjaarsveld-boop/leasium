import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { mockLeasiumApi } from "./api-mocks";

const previewPayload = {
  auth: {
    mode: "operator_preview",
    token_source: "bearer",
    tenant_auth_configured: true,
    dev_fallback: false,
    boundary: "operator_session",
    detail:
      "Read-only operator preview scoped by the signed-in Leasium role. No tenant portal account is created.",
  },
  tenant: {
    id: "tenant-1",
    legal_name: "Bright Cafe Pty Ltd",
    trading_name: '=HYPERLINK("https://example.invalid","Bright Cafe")',
    contact_name: "Mia Hart",
    contact_email: "mia@example.com",
    contact_phone: "0400 111 222",
    billing_email: "accounts@bright.example",
  },
  lease: {
    lease_id: "lease-1",
    status: "active",
    property_name: "Queen Street Retail Centre",
    property_address: "12 Queen Street, Brisbane City, QLD, 4000",
    unit_label: "Shop 3",
    commencement_date: "2025-07-01",
    expiry_date: "2028-06-30",
    next_review_date: "2026-07-01",
  },
  onboarding: {
    id: "onboarding-1",
    status: "sent",
    due_date: "2026-05-29",
    expires_at: "2026-06-12T00:00:00.000Z",
    submitted_at: null,
    last_sent_at: "2026-05-18T09:30:00.000Z",
    document_count: 1,
    submitted_data: null,
    portal_invite_sent_at: "2026-05-18T09:30:00.000Z",
  },
  lease_agreement: {
    status: "not_ready",
    open_question_count: 0,
    questions: [],
    signed_at: null,
    signed_by_actor: null,
    signing_locked_reason: "Property team review must be completed before signing.",
  },
  compliance: {
    uploads_enabled: true,
    accepted_categories: ["insurance", "bank_guarantee", "lease", "onboarding", "other"],
    items: [
      {
        key: "insurance",
        label: "Insurance",
        status: "received",
        document_count: 1,
        latest_document: null,
        due_date: "2027-06-30",
      },
    ],
    uploaded_documents: [
      {
        id: "document-1",
        filename: "+tenant-visible-insurance.pdf",
        category: "insurance",
        source: "tenant_portal",
        byte_size: 1234,
        created_at: "2026-05-20T10:00:00.000Z",
      },
    ],
  },
  invoices: [
    {
      id: "invoice-draft-1",
      invoice_number: "INV-1001",
      title: "May rent and outgoings",
      status: "approved",
      issue_date: "2026-05-01",
      due_date: "2026-05-15",
      currency: "AUD",
      subtotal_cents: 800000,
      gst_cents: 80000,
      total_cents: 880000,
      paid_cents: 0,
      outstanding_cents: 880000,
      payment_status: "unpaid",
      pdf_document_id: "document-1",
      lines: [
        {
          id: "invoice-draft-line-1",
          description: "Base rent",
          amount_cents: 800000,
          gst_cents: 80000,
          currency: "AUD",
        },
      ],
    },
  ],
  payment_summary: {
    invoice_count: 1,
    total_cents: 880000,
    paid_cents: 0,
    outstanding_cents: 880000,
    overdue_count: 1,
    next_due_date: "2026-05-15",
    status: "overdue",
    manual_only: true,
  },
  maintenance_requests: [
    {
      id: "work-order-1",
      title: "-urgent repair",
      description: "Please attend before trading opens.",
      status: "requested",
      priority: "medium",
      requested_at: "2026-05-19T01:00:00.000Z",
      source_reference: null,
      due_date: null,
      completed_at: null,
      document_ids: [],
      photo_document_ids: [],
      created_at: "2026-05-19T01:00:00.000Z",
      history: [],
    },
  ],
  notification_preferences: {
    email_enabled: true,
    sms_enabled: false,
    maintenance_updates: true,
    invoice_reminders: true,
    lease_updates: true,
    updated_at: "2026-05-21T03:00:00.000Z",
  },
  contact_change_requests: [
    {
      id: "contact-request-1",
      status: "submitted",
      submitted_at: "2026-05-20T10:00:00.000Z",
      applied_at: null,
      dismissed_at: null,
      notes: "@please route billing here",
      changes: [
        {
          field: "billing_email",
          label: "Billing email",
          before: "accounts@bright.example",
          after: "@new.accounts.example",
        },
      ],
    },
  ],
  guardrails: [
    "Operator preview is read-only and does not create a tenant portal session.",
    "Only tenant-visible portal data is shown.",
    "Only approved invoice drafts are visible to tenants.",
  ],
};

test("tenant portal preview CSV copy and download stay local, touch-safe, and CSV-safe on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await mockLeasiumApi(page);
  await page.route(
    "**/api/v1/tenant-portal/operator-preview/onboarding-1",
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(previewPayload),
      });
    },
  );

  const forbiddenMutationCalls: string[] = [];
  const forbiddenMutationPatterns = [
    "/tenant-portal/account",
    "/tenant-portal/invites",
    "/tenant-portal/notification-preferences",
    "/tenant-portal/documents",
    "/tenant-portal/lease-questions",
    "/tenant-portal/lease-agreement",
    "/tenants/tenant-1/contact",
    "/documents",
    "/providers",
    "/xero",
    "/basiq",
    "/payment",
    "/reconciliation",
    "/email",
    "/sms",
    "/comms",
  ];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method()) &&
      forbiddenMutationPatterns.some((pattern) => path.startsWith(pattern))
    ) {
      forbiddenMutationCalls.push(`${request.method()} ${path}`);
    }
    await route.fallback();
  });

  await page.goto("/tenants/tenant-1/portal-preview/onboarding-1");
  await expect(
    page.getByRole("heading", { name: "Tenant portal preview" }),
  ).toBeVisible();

  const copyPreviewCsv = page.getByRole("button", {
    name: "Copy preview CSV",
  });
  const downloadPreviewCsv = page.getByRole("button", {
    name: "Download preview CSV",
  });
  const copyActivitySummary = page.getByRole("button", {
    name: "Copy summary",
  });
  for (const control of [
    copyPreviewCsv,
    downloadPreviewCsv,
    copyActivitySummary,
  ]) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  forbiddenMutationCalls.length = 0;
  await copyActivitySummary.click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("Tenant portal activity summary");
  const activitySummary = await page.evaluate(() =>
    navigator.clipboard.readText(),
  );
  expect(activitySummary.split("\n")[0]).toBe("Tenant portal activity summary");
  expect(activitySummary).toContain("5 recent portal updates");
  expect(activitySummary).toContain(
    "| Preferences saved | Your portal notification preferences were updated.",
  );
  expect(activitySummary).toContain(
    "| Document uploaded | +tenant-visible-insurance.pdf - insurance.",
  );
  expect(activitySummary).toContain(
    "| Maintenance request sent | -urgent repair",
  );
  expect(activitySummary).toContain(
    "| Contact request sent | Requested contact detail changes are with the property team.",
  );
  expect(activitySummary).toContain(
    "| Portal invite sent | The property team sent this tenant portal invite.",
  );
  expect(forbiddenMutationCalls).toEqual([]);

  forbiddenMutationCalls.length = 0;
  await copyPreviewCsv.click();
  const copiedCsv = await page.evaluate(() => navigator.clipboard.readText());

  const downloadPromise = page.waitForEvent("download");
  await downloadPreviewCsv.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "tenant-portal-preview-hyperlink-https-example-invalid-bright-cafe.csv",
  );
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const downloadedCsv = await readFile(downloadPath!, "utf8");

  expect(copiedCsv).toBe(downloadedCsv);
  expect(downloadedCsv).toContain(
    '"\'=HYPERLINK(""https://example.invalid"",""Bright Cafe"")"',
  );
  expect(downloadedCsv).toContain("\"'+tenant-visible-insurance.pdf\"");
  expect(downloadedCsv).toContain("\"'-urgent repair\"");
  expect(downloadedCsv).toContain("\"'@new.accounts.example\"");
  expect(downloadedCsv).toContain(
    "Review-only export: downloading this file does not create tenant portal accounts",
  );
  expect(forbiddenMutationCalls).toEqual([]);
});

test("tenant portal preview shows How to pay instructions and per-invoice reference", async ({
  page,
}) => {
  await mockLeasiumApi(page);
  const payload = {
    ...previewPayload,
    how_to_pay: {
      configured: true,
      methods: ["eft", "payid", "bpay"],
      account_name: "SKJ Property Pty Ltd",
      bsb: "062-000",
      account_number: "12345678",
      payid: "rent@skj.example",
      payid_name: "SKJ Property",
      bpay_biller_code: "123456",
      instructions: "Quote your invoice number as the payment reference.",
    },
    invoices: [{ ...previewPayload.invoices[0], payment_reference: "INV-1001" }],
  };
  await page.route(
    "**/api/v1/tenant-portal/operator-preview/onboarding-1",
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(payload),
      });
    },
  );

  await page.goto("/tenants/tenant-1/portal-preview/onboarding-1");
  await expect(
    page.getByRole("heading", { name: "Tenant portal preview" }),
  ).toBeVisible({ timeout: 15_000 });

  await expect(page.getByText("How to pay", { exact: true })).toBeVisible();
  await expect(page.getByText("Bank transfer (EFT)")).toBeVisible();
  await expect(page.getByText("BSB: 062-000")).toBeVisible();
  await expect(page.getByText("Account number: 12345678")).toBeVisible();
  await expect(page.getByText("PayID: rent@skj.example")).toBeVisible();
  await expect(page.getByText("Biller code: 123456")).toBeVisible();
  await expect(page.getByText(/Payment reference:/)).toBeVisible();
  await expect(
    page.getByText(/Leasium does not process payments/),
  ).toBeVisible();
});
