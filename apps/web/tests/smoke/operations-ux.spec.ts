import { expect, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

test("mobile operations loading and queue actions stay readable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLeasiumApi(page);
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
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

  await expect(downloadQueueCsv).toBeVisible();
  const actionBox = await downloadQueueCsv.boundingBox();
  expect(actionBox).not.toBeNull();
  expect(actionBox?.width).toBeGreaterThanOrEqual(300);

  await page.unrouteAll({ behavior: "ignoreErrors" });
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
  await expect(portalPanel.getByText("Hidden from portal")).toBeVisible();

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

  await expect(portalPanel.getByText("Visible in vendor portal")).toBeVisible();
  await expect(
    portalPanel.getByRole("link", { name: "Open portal preview" }),
  ).toHaveAttribute("href", "/vendor-portal/contractor-2");

  await portalPanel.getByRole("link", { name: "Open portal preview" }).click();
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
  await expect(visiblePortalPanel.getByText("Hidden from portal")).toBeVisible();

  await page.goto("/vendor-portal/contractor-2");
  await expect(page.getByText("No shared work orders.")).toBeVisible();
  expect(vendorPortalGetCount).toBeGreaterThanOrEqual(3);

  expect(mutationPaths).toEqual([
    "/maintenance/work-orders/work-order-1/vendor-portal/share",
    "/maintenance/work-orders/work-order-1/vendor-portal/unshare",
  ]);
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
