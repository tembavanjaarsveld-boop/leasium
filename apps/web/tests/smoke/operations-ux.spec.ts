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

test("mobile operations loading and queue actions stay readable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLeasiumApi(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as Window & { __copiedQueueCsv?: string }).__copiedQueueCsv =
            text;
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
    "/maintenance",
    "/arrears",
    "/obligations",
    "/work-assignments",
    "/tenant-onboarding",
    "/billing",
    "/invoice",
    "/xero",
    "/basiq",
    "/payment",
    "/reconciliation",
    "/tenants",
    "/contractors",
  ];
  const forbiddenSendPathPattern = /email|sms|sendgrid|twilio/i;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const apiPath = path.replace("/api/v1", "");
    if (request.method() === "GET" && apiPath === "/maintenance/work-orders") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "work-order-1",
            entity_id: "entity-1",
            property_id: "property-1",
            tenancy_unit_id: "unit-1",
            tenant_id: "tenant-1",
            lease_id: "lease-1",
            title: "Air conditioning fault",
            description: "Tenant reported warm air from the shopfront unit.",
            status: "awaiting_approval",
            priority: "urgent",
            requested_at: "2026-05-19T01:00:00.000Z",
            contractor_name: "Cool Air Services",
            contractor_email: "service@coolair.example",
            contractor_phone: "07 3000 1111",
            contractor_assigned_at: "2026-05-19T02:00:00.000Z",
            approval_required: true,
            approval_status: "pending",
            approval_limit_cents: 50000,
            quote_amount_cents: 64000,
            approved_by_user_id: null,
            approved_at: null,
            approval_notes: null,
            source_document_id: null,
            invoice_draft_id: null,
            invoice_reference: null,
            invoice_amount_cents: null,
            source_reference: "Tenant email",
            due_date: "2026-05-20",
            completed_at: null,
            notes: "Needs owner approval before work proceeds.",
            document_ids: [],
            photo_document_ids: [],
            metadata: {},
            created_at: "2026-05-19T01:00:00.000Z",
            updated_at: "2026-05-19T01:00:00.000Z",
            deleted_at: null,
          },
          {
            id: "work-order-formula",
            entity_id: "entity-1",
            property_id: "property-1",
            tenancy_unit_id: "unit-1",
            tenant_id: "tenant-1",
            lease_id: "lease-1",
            title: "=HYPERLINK(\"https://example.invalid\",\"open\")",
            description: "+Tenant supplied spreadsheet-like subject",
            status: "requested",
            priority: "normal",
            requested_at: "2026-05-19T03:00:00.000Z",
            contractor_name: null,
            contractor_email: null,
            contractor_phone: null,
            contractor_assigned_at: null,
            approval_required: false,
            approval_status: null,
            approval_limit_cents: null,
            quote_amount_cents: null,
            approved_by_user_id: null,
            approved_at: null,
            approval_notes: null,
            source_document_id: null,
            invoice_draft_id: null,
            invoice_reference: null,
            invoice_amount_cents: null,
            source_reference: "@tenant upload",
            due_date: "2026-05-21",
            completed_at: null,
            notes: "-review before dispatch",
            document_ids: [],
            photo_document_ids: [],
            metadata: {},
            created_at: "2026-05-19T03:00:00.000Z",
            updated_at: "2026-05-19T03:00:00.000Z",
            deleted_at: null,
          },
        ]),
      });
      return;
    }
    if (
      (request.method() !== "GET" &&
        forbiddenPathPatterns.some((pattern) => apiPath.startsWith(pattern))) ||
      forbiddenSendPathPattern.test(apiPath)
    ) {
      forbiddenLocalExportCalls.push(`${request.method()} ${apiPath}`);
    }
    if (!path.endsWith("/entities")) {
      await page.waitForTimeout(1200);
    }
    await route.fallback();
  });

  await page.goto("/operations");

  const metrics = page
    .locator("section")
    .filter({
      has: page.getByText("Urgent maintenance", { exact: true }),
    })
    .first();

  await expect(metrics).toContainText("Checking");
  await expect(metrics.getByText("...")).toHaveCount(0);

  await expect(page.getByText("Air conditioning fault")).toBeVisible();
  const queueActions = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Operations queue" }),
    })
    .first();
  const downloadQueueCsv = queueActions.getByRole("button", {
    name: "Download queue CSV",
  });
  const copyQueueCsv = queueActions.getByRole("button", {
    name: "Copy queue CSV",
  });

  await expect(copyQueueCsv).toBeVisible();
  await expect(downloadQueueCsv).toBeVisible();
  const copyBox = await copyQueueCsv.boundingBox();
  const downloadBox = await downloadQueueCsv.boundingBox();
  expect(copyBox).not.toBeNull();
  expect(downloadBox).not.toBeNull();
  for (const box of [copyBox!, downloadBox!]) {
    expect(box.width).toBeGreaterThanOrEqual(300);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(Math.abs(copyBox!.x - downloadBox!.x)).toBeLessThanOrEqual(4);
  expect(copyBox!.y).toBeGreaterThanOrEqual(downloadBox!.y);
  expect(copyBox!.y - (downloadBox!.y + downloadBox!.height)).toBeLessThanOrEqual(
    12,
  );

  forbiddenLocalExportCalls.length = 0;
  await copyQueueCsv.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __copiedQueueCsv?: string }).__copiedQueueCsv,
      ),
    )
    .toBeTruthy();
  const copiedCsv = await page.evaluate(
    () => (window as Window & { __copiedQueueCsv?: string }).__copiedQueueCsv,
  );
  const downloadPromise = page.waitForEvent("download");
  await downloadQueueCsv.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "operations-work-queue-review.csv",
  );
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
    "Urgency",
    "Completion",
    "Assignee",
    "Notification",
    "Follow-up",
    "Guardrail",
  ]);
  expect(csv).toContain("Local-only review export");
  expect(csv).toContain("does not send SendGrid or Twilio messages");
  expect(csv).toContain("dispatch providers");
  expect(csv).toContain("Xero/Basiq writes");
  expect(csv).toContain("payment reconciliation");
  expect(csv).toContain(
    "update maintenance, arrears, onboarding, or assignment records",
  );
  expect(csv).toContain("Air conditioning fault");
  expect(csv).toContain(
    "\"'=HYPERLINK(\"\"https://example.invalid\"\",\"\"open\"\")\"",
  );
  expect(
    rows
      .flat()
      .filter(Boolean)
      .filter((cell) => /^[=+\-@]/.test(cell)),
  ).toEqual([]);
  expect(csv).not.toMatch(/(?:^|,)"[=+\-@]/m);
  expect(forbiddenLocalExportCalls).toEqual([]);

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("maintenance inline undo toast controls stay touch-safe on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLeasiumApi(page);

  await page.goto("/operations");
  await expect(
    page.getByRole("heading", { name: "Operations", exact: true }),
  ).toBeVisible();

  await page.getByRole("tab", { name: /Maintenance/ }).click();
  await expect(page.getByText("Air conditioning fault")).toBeVisible();
  await page
    .getByRole("button", { name: "Edit Status for Air conditioning fault" })
    .click();
  await page
    .getByLabel("Status for Air conditioning fault", { exact: true })
    .selectOption("triaged");

  const undoToast = page
    .getByRole("status")
    .filter({ hasText: "Status changed to triaged" });
  await expect(undoToast).toBeVisible();
  await expect(
    undoToast.getByText(
      "Air conditioning fault was previously awaiting approval.",
    ),
  ).toBeVisible();

  await expectTouchTarget(undoToast.getByRole("button", { name: "Undo" }));
  await expectTouchTarget(undoToast.getByRole("button", { name: "Dismiss" }));
});

test("operations queue assignment action stays touch-safe", async ({
  page,
}) => {
  await mockLeasiumApi(page);

  await page.goto("/operations");
  await expect(page.getByText("Air conditioning fault")).toBeVisible();

  const assignOwner = page.getByRole("button", {
    name: "Assign owner for Air conditioning fault",
  });
  await expectTouchTarget(assignOwner);

  await assignOwner.click();
  const assigneeSelect = page.getByLabel("Assignee for Air conditioning fault");
  const expandedControl = page
    .locator("div")
    .filter({ has: assigneeSelect })
    .first();
  await expectTouchTarget(assigneeSelect);
  await expectTouchTarget(
    expandedControl.getByRole("button", { exact: true, name: "Assign" }),
  );
  await expectTouchTarget(
    expandedControl.getByRole("button", { exact: true, name: "Cancel" }),
  );
});

test("operations assignment recent activity disclosure stays touch-safe", async ({
  page,
}) => {
  await mockLeasiumApi(page);
  await page.route("**/api/v1/maintenance/work-orders**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "work-order-history",
          entity_id: "entity-1",
          property_id: "property-1",
          tenancy_unit_id: "unit-1",
          tenant_id: "tenant-1",
          lease_id: "lease-1",
          title: "Air conditioning fault",
          description: "Tenant reported warm air from the shopfront unit.",
          status: "awaiting_approval",
          priority: "urgent",
          requested_at: "2026-05-19T01:00:00.000Z",
          contractor_name: "Cool Air Services",
          contractor_email: "service@coolair.example",
          contractor_phone: "07 3000 1111",
          contractor_assigned_at: "2026-05-19T02:00:00.000Z",
          approval_required: true,
          approval_status: "pending",
          approval_limit_cents: 50000,
          quote_amount_cents: 64000,
          approved_by_user_id: null,
          approved_at: null,
          approval_notes: null,
          source_document_id: null,
          invoice_draft_id: null,
          invoice_reference: null,
          invoice_amount_cents: null,
          source_reference: "Tenant email",
          due_date: "2026-05-20",
          completed_at: null,
          notes: "Needs owner approval before work proceeds.",
          document_ids: [],
          photo_document_ids: [],
          metadata: {
            work_assignment: {
              assigned_user_id: "operator-1",
              assigned_user_name: "Owner Operator",
              assigned_user_email: "temba@example.com",
              assigned_at: "2026-05-20T01:00:00.000Z",
              assigned_by_name: "Owner Operator",
              notification: {
                status: "queued",
                detail: "Assignment email was queued by SendGrid.",
              },
              history: [
                {
                  event: "provider_notification_attempted",
                  at: "2026-05-20T01:15:00.000Z",
                  actor_name: "Owner Operator",
                  assigned_user_name: "Owner Operator",
                  assigned_user_email: "temba@example.com",
                  notification_status: "queued",
                  summary: "Assignment notification email was queued.",
                },
                {
                  event: "assigned",
                  at: "2026-05-20T01:00:00.000Z",
                  actor_name: "Owner Operator",
                  assigned_user_name: "Owner Operator",
                  assigned_user_email: "temba@example.com",
                  notification_status: "ready",
                  summary: "Maintenance assigned to Owner Operator.",
                },
              ],
            },
          },
          created_at: "2026-05-19T01:00:00.000Z",
          updated_at: "2026-05-20T01:15:00.000Z",
          deleted_at: null,
        },
      ]),
    });
  });

  await page.goto("/operations");
  await expect(
    page.getByRole("link", { name: /Air conditioning fault/ }).first(),
  ).toBeVisible();

  await expectTouchTarget(
    page.locator("summary").filter({ hasText: "Recent activity" }).first(),
  );
});

test("arrears review packet mobile controls stay touch-safe without mutations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLeasiumApi(page);

  const forbiddenMutationPaths: string[] = [];
  const forbiddenPathPatterns = [
    "/arrears/cases",
    "/comms",
    "/invoice",
    "/xero",
    "/basiq",
    "/payment",
    "/maintenance",
    "/work-assignments",
    "/tenant-onboarding",
    "/tenants",
    "/providers",
    "/contractors",
  ];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (
      request.method() !== "GET" &&
      forbiddenPathPatterns.some((pattern) => path.startsWith(pattern))
    ) {
      forbiddenMutationPaths.push(`${request.method()} ${path}`);
    }
    await route.fallback();
  });

  await page.goto("/operations?tab=arrears");

  const packet = page.getByTestId("arrears-review-packet-arrears-1");
  await expect(packet).toBeVisible({ timeout: 15_000 });

  const controls = [
    packet.getByRole("button", { name: "Copy packet" }),
    packet.getByRole("button", { name: "Download packet CSV" }),
    packet.getByRole("link", { name: "Open tenant" }),
    packet.getByRole("link", { name: "Open queue" }),
  ];

  for (const control of controls) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  await controls[0].click();
  const downloadPromise = page.waitForEvent("download");
  await controls[1].click();
  await downloadPromise;

  expect(forbiddenMutationPaths).toEqual([]);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("maintenance detail loading states use structured skeleton rows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLeasiumApi(page);
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/maintenance/work-orders/work-order-1")) {
      await page.waitForTimeout(2500);
    }
    if (
      path.endsWith(
        "/comms/correspondence/maintenance-work-orders/work-order-1",
      )
    ) {
      await page.waitForTimeout(5000);
    }
    await route.fallback();
  });

  await page.goto("/operations/maintenance/work-order-1");

  await expect(page.getByLabel("Loading…").first()).toBeVisible();
  await expect(
    page.getByText("Loading work order.", { exact: true }),
  ).toHaveCount(0);

  await expect(
    page.getByRole("heading", { name: "Air conditioning fault" }),
  ).toBeVisible();
  const correspondencePanel = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Correspondence" }),
    })
    .first();

  await expect(correspondencePanel.getByLabel("Loading…")).toBeVisible();
  await expect(
    correspondencePanel.getByText("Loading correspondence.", { exact: true }),
  ).toHaveCount(0);

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("maintenance detail invoice and closeout actions stay touch-safe without firing actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockLeasiumApi(page);
  await page.route("**/api/v1/invoice-drafts**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "invoice-draft-1",
          entity_id: "entity-1",
          billing_draft_id: "billing-draft-1",
          property_id: "property-1",
          tenancy_unit_id: "unit-1",
          tenant_id: "tenant-1",
          lease_id: "lease-1",
          document_id: "document-1",
          document_intake_id: "intake-1",
          status: "ready_for_approval",
          invoice_number: "INV-1001",
          title: "May rent and outgoings",
          currency: "AUD",
          issue_date: "2026-05-01",
          due_date: "2026-05-15",
          subtotal_cents: 800000,
          gst_cents: 80000,
          total_cents: 880000,
          issuer_name: "Queen Street Trustee Pty Ltd",
          issuer_abn: "22123456789",
          recipient_name: "Bright Cafe Pty Ltd",
          recipient_email: "accounts@bright.example",
          notes: "Ready internal invoice draft.",
          metadata: {
            readiness_blockers: [],
            delivery_state: {
              pdf_preview_generated: true,
              pdf_artifact_stored: true,
              tenant_email_prepared: true,
              delivery_ready: true,
              tenant_email_sent: false,
            },
            pdf_artifact: { document_id: "document-1" },
          },
          lines: [],
          created_at: "2026-05-01T00:00:00.000Z",
          updated_at: "2026-05-01T00:00:00.000Z",
          deleted_at: null,
        },
      ]),
    });
  });

  await page.goto("/operations/maintenance/work-order-1");
  await page.evaluate(async () => {
    await fetch("/api/v1/maintenance/work-orders/work-order-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        status: "completed",
        completed_at: "2026-05-21T01:30:00.000Z",
        invoice_draft_id: "invoice-draft-1",
        invoice_reference: "INV-1001",
        invoice_amount_cents: 880000,
        metadata: {
          closeout: {
            completed_at: "2026-05-21T01:30:00.000Z",
            note: "Closeout confirmed after contractor attendance.",
            communication: {
              owner_update:
                "The air conditioning repair has been completed and evidence is on file.",
              tenant_update:
                "The air conditioning repair has been completed. Please reply if the fault returns.",
              contractor_follow_up:
                "Thanks for completing the air conditioning repair. Evidence has been recorded.",
            },
          },
        },
      }),
    });
  });

  const forbiddenMutationPaths: string[] = [];
  const forbiddenPathPatterns = [
    "/maintenance/work-orders/work-order-1",
    "/invoice-drafts",
    "/comms",
    "/xero",
    "/basiq",
    "/providers",
    "/dispatch",
    "/payment",
    "/reconciliation",
  ];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (
      request.method() !== "GET" &&
      forbiddenPathPatterns.some((pattern) => path.startsWith(pattern))
    ) {
      forbiddenMutationPaths.push(`${request.method()} ${path}`);
    }
    await route.fallback();
  });

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Air conditioning fault" }),
  ).toBeVisible({ timeout: 15_000 });

  await expectTouchTarget(page.getByRole("button", { name: "Prepare" }));
  await expectTouchTarget(
    page.getByRole("button", { name: "Approve invoice" }),
  );
  await expectTouchTarget(page.getByRole("button", { name: "Start job" }));
  await expectTouchTarget(
    page.getByRole("button", { name: "Copy owner update" }),
  );

  expect(forbiddenMutationPaths).toEqual([]);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("maintenance detail shows a record-level not-found state", async ({
  page,
}) => {
  await mockLeasiumApi(page);
  await page.route(
    "**/api/v1/maintenance/work-orders/missing-work-order",
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Work order not found." }),
      });
    },
  );

  await page.goto("/operations/maintenance/missing-work-order");

  await expect(
    page.getByRole("heading", { name: "Work order not found" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText("This work order may have been deleted"),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to Work" }),
  ).toHaveAttribute("href", "/operations");
  await expect(page.getByText("Work order unavailable")).toHaveCount(0);
});

test("maintenance detail keeps generic failures on unavailable state", async ({
  page,
}) => {
  await mockLeasiumApi(page);
  await page.route(
    "**/api/v1/maintenance/work-orders/broken-work-order",
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Work order service unavailable." }),
      });
    },
  );

  await page.goto("/operations/maintenance/broken-work-order");

  await expect(
    page.getByRole("heading", { name: "Work order unavailable" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Work order service unavailable.")).toBeVisible();
  await expect(page.getByText("Work order not found")).toHaveCount(0);
});

test("maintenance detail shares vendor portal visibility without provider dispatch", async ({
  page,
}) => {
  await mockLeasiumApi(page);
  const mutationPaths: string[] = [];
  let sharedToPortal = false;
  let vendorPortalGetCount = 0;
  const vendorPortalBody = () => ({
    auth: {
      mode: "operator_preview",
      token_source: "bearer",
      vendor_auth_configured: false,
      boundary: "operator_session",
      detail: "Read-only operator preview scoped by entity role.",
    },
    vendor: {
      id: "contractor-2",
      entity_id: "entity-1",
      name: "Cool Air Services",
      company_name: null,
      categories: ["hvac"],
      email: "service@coolair.example",
      phone: "07 3000 1111",
      service_radius_km: 15,
      priority: 2,
    },
    work_orders: {
      open_count: sharedToPortal ? 1 : 0,
      urgent_count: sharedToPortal ? 1 : 0,
      overdue_count: 0,
      items: sharedToPortal
        ? [
            {
              id: "work-order-1",
              property_id: "property-1",
              property_name: "Queen Street Retail Centre",
              title: "Repair air conditioning",
              status: "awaiting_approval",
              priority: "urgent",
              requested_at: "2026-05-19T01:00:00.000Z",
              due_date: "2026-05-20",
              contractor_assigned_at: "2026-05-19T02:00:00.000Z",
              quote_amount_cents: 64000,
              comments: [
                {
                  body: "Please attend before trading opens.",
                  timestamp: "2026-05-20T01:18:00.000Z",
                },
              ],
            },
          ]
        : [],
    },
    guardrails: [
      "Read-only vendor portal: opening this page does not send contractor email or SMS.",
    ],
    generated_at: "2026-05-20T01:18:00.000Z",
  });
  await page.route("**/api/v1/vendor-portal/contractor-2", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    vendorPortalGetCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(vendorPortalBody()),
    });
  });
  await page.route(
    "**/api/v1/maintenance/work-orders/work-order-1/**",
    async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace("/api/v1", "");
      if (request.method() === "POST") {
        mutationPaths.push(path);
        if (path.endsWith("/vendor-portal/share")) {
          sharedToPortal = true;
        }
        if (path.endsWith("/vendor-portal/unshare")) {
          sharedToPortal = false;
        }
      }
      await route.fallback();
    },
  );

  await page.goto("/vendor-portal/contractor-2");
  await expect(page.getByText("No shared work orders.")).toBeVisible({
    timeout: 15_000,
  });

  await page.goto("/operations/maintenance/work-order-1");

  const portalPanel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Vendor portal" }) })
    .first();
  await expect(portalPanel).toBeVisible({ timeout: 15_000 });
  await expect(portalPanel.getByText("Hidden from portal").first()).toBeVisible();

  await portalPanel.locator("select").first().selectOption("contractor-2");
  await portalPanel
    .getByLabel("Vendor-safe title")
    .fill("Repair air conditioning");
  await portalPanel
    .getByLabel("Vendor-visible note")
    .fill("Please attend before trading opens.");

  const shareRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().includes("/vendor-portal/share"),
  );
  await portalPanel.getByRole("button", { name: "Share to portal" }).click();
  expect((await shareRequest).postDataJSON()).toMatchObject({
    contractor_id: "contractor-2",
    title: "Repair air conditioning",
    comment: "Please attend before trading opens.",
  });

  await expect(
    portalPanel.getByText("Visible in vendor portal").first(),
  ).toBeVisible();
  await expect(
    portalPanel.getByRole("link", { name: "Open portal preview" }).first(),
  ).toHaveAttribute("href", "/vendor-portal/contractor-2");

  await portalPanel
    .getByRole("link", { name: "Open portal preview" })
    .first()
    .click();
  await expect(page.getByText("Repair air conditioning")).toBeVisible();

  await page.goto("/operations/maintenance/work-order-1");
  const visiblePortalPanel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Vendor portal" }) })
    .first();
  const unshareRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().includes("/vendor-portal/unshare"),
  );
  await visiblePortalPanel.getByRole("button", { name: "Hide from portal" }).click();
  await unshareRequest;
  await expect(
    visiblePortalPanel.getByText("Hidden from portal").first(),
  ).toBeVisible();

  await page.goto("/vendor-portal/contractor-2");
  await expect(page.getByText("No shared work orders.")).toBeVisible();
  expect(vendorPortalGetCount).toBeGreaterThanOrEqual(2);

  expect(mutationPaths).toEqual([
    "/maintenance/work-orders/work-order-1/vendor-portal/share",
    "/maintenance/work-orders/work-order-1/vendor-portal/unshare",
  ]);
});

test("maintenance detail exports vendor exposure packet without portal or provider mutations", async ({
  page,
}) => {
  await mockLeasiumApi(page, { vendorPortalPriorExposure: true });
  await page.goto("/operations/maintenance/work-order-1");

  const portalPanel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Vendor portal" }) })
    .first();
  await expect(portalPanel).toBeVisible({ timeout: 15_000 });
  await expect(portalPanel.getByText("Hidden from portal").first()).toBeVisible();
  await expect(portalPanel.getByLabel("Vendor-safe title")).toHaveValue(
    "Previously saved portal title",
  );

  const packet = portalPanel.getByTestId(
    "vendor-exposure-packet-work-order-1",
  );
  await expect(packet).toBeVisible();
  await expect(packet).toContainText("Previously saved portal title");
  await expect(packet).toContainText("Previously saved vendor note");

  await portalPanel
    .getByLabel("Vendor-safe title")
    .fill("Repair air conditioning");
  await portalPanel
    .getByLabel("Vendor-visible note")
    .fill("Please attend before trading opens.");

  const forbiddenMutationPaths: string[] = [];
  const forbiddenPathPatterns = [
    "/maintenance/work-orders/work-order-1/vendor-portal/share",
    "/maintenance/work-orders/work-order-1/vendor-portal/unshare",
    "/maintenance/work-orders/work-order-1/contractor-delivery/send-email",
    "/maintenance/work-orders/work-order-1/contractor-delivery/send-sms",
    "/maintenance/work-orders/work-order-1/assignment-notification/send-email",
    "/maintenance/work-orders/work-order-1/comments",
    "/documents",
    "/invoice",
    "/comms",
    "/xero",
    "/basiq",
    "/providers",
    "/dispatch",
    "/payment",
    "/reconciliation",
  ];
  const forbiddenPathFragments = [
    "provider-history",
    "provider-dispatch",
    "payment",
    "reconciliation",
  ];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (
      request.method() !== "GET" &&
      (forbiddenPathPatterns.some((pattern) => path.startsWith(pattern)) ||
        forbiddenPathFragments.some((fragment) => path.includes(fragment)))
    ) {
      forbiddenMutationPaths.push(`${request.method()} ${path}`);
    }
    await route.fallback();
  });

  await expect(
    packet.getByRole("heading", { name: "Vendor exposure packet" }),
  ).toBeVisible();
  await expect(packet).toContainText("Hidden from portal");
  await expect(packet).toContainText("Selected vendor");
  await expect(packet).toContainText("Cool Air Services");
  await expect(packet).toContainText("Saved vendor");
  await expect(packet).toContainText("Vendor-safe title");
  await expect(packet).toContainText("Repair air conditioning");
  await expect(packet).toContainText("Draft only");
  await expect(packet).toContainText("Please attend before trading opens.");
  await expect(packet).toContainText("Draft + saved");
  await expect(packet).toContainText("1 saved vendor-visible note");
  await expect(packet).toContainText("not exposed until Share to portal");
  await expect(packet).toContainText("/vendor-portal/contractor-2");
  await expect(packet).toContainText("Tenant identity");
  await expect(packet).toContainText("Internal notes");
  await expect(packet).toContainText("Provider history");
  await expect(packet).toContainText("Invoice ids");
  await expect(packet).toContainText("Raw metadata");

  const copyPacket = packet.getByRole("button", { name: "Copy packet" });
  const downloadPacket = packet.getByRole("button", {
    name: "Download packet CSV",
  });
  for (const control of [copyPacket, downloadPacket]) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  await copyPacket.click();
  const downloadPromise = page.waitForEvent("download");
  await downloadPacket.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "vendor-exposure-packet-work-order-1.csv",
  );
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const csv = await readFile(downloadPath!, "utf8");
  expect(csv).toContain("Repair air conditioning");
  expect(csv).toContain("Please attend before trading opens.");
  expect(csv).toContain("Draft + saved");
  expect(csv).toContain("1 saved vendor-visible note");
  expect(csv).toContain("Tenant identity");
  expect(csv).toContain(
    "Local-only exposure review: copying or downloading this packet does not share or hide portal access",
  );

  expect(forbiddenMutationPaths).toEqual([]);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("maintenance review packet copy and CSV include handoff links without mutations", async ({
  page,
}) => {
  await mockLeasiumApi(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (
            window as Window & { __copiedMaintenancePacket?: string }
          ).__copiedMaintenancePacket = text;
        },
      },
    });
  });

  const forbiddenMutationPaths: string[] = [];
  const forbiddenPathPatterns = [
    "/maintenance/work-orders/work-order-1",
    "/maintenance/work-orders/work-order-1/contractor-delivery/send-email",
    "/maintenance/work-orders/work-order-1/contractor-delivery/send-sms",
    "/maintenance/work-orders/work-order-1/vendor-portal",
    "/maintenance/work-orders/work-order-1/comments",
    "/invoice",
    "/comms",
    "/xero",
    "/basiq",
    "/providers",
    "/dispatch",
    "/payment",
    "/reconciliation",
  ];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (
      request.method() !== "GET" &&
      forbiddenPathPatterns.some((pattern) => path.startsWith(pattern))
    ) {
      forbiddenMutationPaths.push(`${request.method()} ${path}`);
    }
    await route.fallback();
  });

  await page.goto("/operations/maintenance/work-order-1");

  const packet = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Review packet" }) });
  await expect(packet).toBeVisible({ timeout: 15_000 });

  await packet.getByRole("button", { name: "Copy packet" }).click();
  await expect(
    packet.getByText("Maintenance review packet copied."),
  ).toBeVisible();

  const copied = await page.evaluate(
    () =>
      (window as Window & { __copiedMaintenancePacket?: string })
        .__copiedMaintenancePacket,
  );
  expect(copied).toContain("Handoff links:");
  expect(copied).toContain("Open Comms: /comms");
  expect(copied).toContain("Open tenant: /tenants/tenant-1");

  const downloadPromise = page.waitForEvent("download");
  await packet.getByRole("button", { name: "Download packet CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "maintenance-review-packet-work-order-1.csv",
  );
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const csv = await readFile(downloadPath!, "utf8");
  expect(csv).toContain("Handoff link");
  expect(csv).toContain("Open Comms");
  expect(csv).toContain("/tenants/tenant-1");

  expect(forbiddenMutationPaths).toEqual([]);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("maintenance review packet mobile actions export locally without mutations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLeasiumApi(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (
            window as Window & { __copiedMaintenancePacket?: string }
          ).__copiedMaintenancePacket = text;
        },
      },
    });
  });

  await page.goto("/operations/maintenance/work-order-1");
  await page.evaluate(async () => {
    await fetch("/api/v1/maintenance/work-orders/work-order-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        status: "completed",
        completed_at: "2026-05-21T01:30:00.000Z",
        metadata: {
          closeout: {
            completed_at: "2026-05-21T01:30:00.000Z",
            note: "Closeout confirmed after contractor attendance.",
            history: [
              {
                at: "2026-05-21T01:30:00.000Z",
                actor: "operator-1",
                note: "Closeout confirmed after contractor attendance.",
                photo_document_id: "portal-photo-1",
                photo_document_ids: ["portal-photo-1"],
              },
            ],
            communication: {
              owner_update:
                "The air conditioning repair has been completed and evidence is on file.",
              tenant_update:
                "The air conditioning repair has been completed. Please reply if the fault returns.",
              contractor_follow_up:
                "Thanks for completing the air conditioning repair. Evidence has been recorded.",
            },
          },
        },
      }),
    });
  });

  const forbiddenMutationPaths: string[] = [];
  const forbiddenPathPatterns = [
    "/maintenance/work-orders/work-order-1",
    "/maintenance/work-orders/work-order-1/contractor-delivery/send-email",
    "/maintenance/work-orders/work-order-1/contractor-delivery/send-sms",
    "/maintenance/work-orders/work-order-1/vendor-portal",
    "/maintenance/work-orders/work-order-1/comments",
    "/invoice",
    "/comms",
    "/xero",
    "/basiq",
    "/providers",
    "/dispatch",
    "/payment",
    "/reconciliation",
  ];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (
      request.method() !== "GET" &&
      forbiddenPathPatterns.some((pattern) => path.startsWith(pattern))
    ) {
      forbiddenMutationPaths.push(`${request.method()} ${path}`);
    }
    await route.fallback();
  });

  await page.reload();

  const packet = page
    .getByText("Completion review packet", { exact: true })
    .locator("xpath=ancestor::div[contains(@class, 'border-border')][1]");
  await expect(packet).toBeVisible({ timeout: 15_000 });

  const copyPacket = packet.getByRole("button", { name: "Copy packet" });
  const downloadPacket = packet.getByRole("button", {
    name: "Download packet CSV",
  });

  for (const control of [copyPacket, downloadPacket]) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  await copyPacket.click();
  await expect(
    packet.getByText("Completion review packet copied."),
  ).toBeVisible();

  const copied = await page.evaluate(
    () =>
      (window as Window & { __copiedMaintenancePacket?: string })
        .__copiedMaintenancePacket,
  );
  expect(copied).toContain("Operations completion review packet");
  expect(copied).toContain("Owner completion review");
  expect(copied).toContain(
    "Review-only: no owner, tenant, contractor, email, SMS",
  );

  const downloadPromise = page.waitForEvent("download");
  await downloadPacket.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "maintenance-completion-review-work-order-1.csv",
  );
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const csv = await readFile(downloadPath!, "utf8");
  expect(csv).toContain("Owner completion review");
  expect(csv).toContain("Review-only: no owner, tenant, contractor, email, SMS");

  expect(forbiddenMutationPaths).toEqual([]);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("maintenance detail hides stale work-order data after a not-found refresh", async ({
  page,
}) => {
  await mockLeasiumApi(page);
  let failPrimaryRead = false;
  await page.route(
    "**/api/v1/maintenance/work-orders/work-order-1",
    async (route) => {
      if (route.request().method() !== "GET" || !failPrimaryRead) {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Work order not found." }),
      });
    },
  );

  await page.goto("/operations/maintenance/work-order-1");
  await expect(
    page.getByRole("heading", { name: "Air conditioning fault" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Edit work-order details")).toBeVisible();

  failPrimaryRead = true;
  await page.getByRole("button", { name: "Refresh" }).click();

  await expect(
    page.getByRole("heading", { name: "Work order not found" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("heading", { name: "Air conditioning fault" }),
  ).toHaveCount(0);
  await expect(page.getByText("Edit work-order details")).toHaveCount(0);
});
