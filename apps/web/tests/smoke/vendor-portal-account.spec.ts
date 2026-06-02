import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

const appRoot = path.resolve(__dirname, "../..");

async function source(relativePath: string) {
  return readFile(path.join(appRoot, relativePath), "utf8");
}

const VENDOR_ACCOUNT_BASE = {
  auth: {
    mode: "vendor_portal_account",
    token_source: "bearer",
    vendor_auth_configured: true,
    boundary: "vendor_portal_account",
    detail:
      "Access is scoped to the contractor linked to this vendor portal account.",
  },
  vendor: {
    id: "contractor-1",
    entity_id: "entity-1",
    name: "Bright Spark Electrical",
    company_name: "Bright Spark Electrical Pty Ltd",
    categories: ["electrical", "urgent"],
    email: "service@brightspark.example",
    phone: "07 3000 2222",
    service_radius_km: 20,
    priority: 1,
  },
  guardrails: [
    "Vendor portal account: you can accept jobs, post updates, and add photos for work shared with you.",
    "Accepting or updating a job here does not send contractor or tenant email/SMS, dispatch other providers, write Xero/Basiq data, or reconcile payments.",
  ],
  generated_at: "2026-06-02T04:00:00.000Z",
};

function workOrders(item: Record<string, unknown>) {
  return {
    open_count: 1,
    urgent_count: 1,
    overdue_count: 0,
    items: [item],
  };
}

const BASE_ITEM = {
  id: "work-order-1",
  property_id: "property-1",
  property_name: "Queen Street Retail Centre",
  title: "Repair air conditioning",
  status: "assigned",
  priority: "urgent",
  requested_at: "2026-06-01T01:30:00.000Z",
  due_date: "2026-06-07",
  contractor_assigned_at: "2026-06-01T02:00:00.000Z",
  quote_amount_cents: 125000,
  photo_count: 0,
  comments: [
    { body: "Please attend before trading opens.", timestamp: "2026-06-01T03:00:00Z" },
  ],
};

const SESSION_RESPONSE = {
  ...VENDOR_ACCOUNT_BASE,
  work_orders: workOrders(BASE_ITEM),
};
const ACCEPTED_RESPONSE = {
  ...VENDOR_ACCOUNT_BASE,
  work_orders: workOrders({ ...BASE_ITEM, status: "in_progress" }),
};
const COMMENTED_RESPONSE = {
  ...VENDOR_ACCOUNT_BASE,
  work_orders: workOrders({
    ...BASE_ITEM,
    status: "in_progress",
    comments: [
      ...BASE_ITEM.comments,
      { body: "On my way, ETA 30 minutes.", timestamp: "2026-06-02T04:05:00Z" },
    ],
  }),
};
const PHOTO_RESPONSE = {
  ...VENDOR_ACCOUNT_BASE,
  work_orders: workOrders({
    ...BASE_ITEM,
    status: "in_progress",
    photo_count: 1,
    comments: [
      ...BASE_ITEM.comments,
      { body: "On my way, ETA 30 minutes.", timestamp: "2026-06-02T04:05:00Z" },
      { body: "Contractor added a job photo.", timestamp: "2026-06-02T04:06:00Z" },
    ],
  }),
};

test("vendor account pages use fresh bearer tokens for claim and actions", async () => {
  const invitePage = await source(
    "src/app/vendor-portal/invite/[token]/page.tsx",
  );
  const accountPage = await source("src/app/vendor-portal/page.tsx");
  const accountUi = await source(
    "src/app/vendor-portal/vendor-portal-account-ui.tsx",
  );
  const api = await source("src/lib/api.ts");

  expect(invitePage).toContain("getToken({ skipCache: true })");
  expect(invitePage).toContain("claimVendorPortalAccount(token, authToken)");
  expect(invitePage).toContain("requiresAuthToken={auth.requiresAuthToken}");
  expect(accountPage).toContain(
    "getAuthToken: () => getToken({ skipCache: true })",
  );
  expect(accountPage).toContain("getVendorPortalAccountStatus(authToken)");
  expect(accountPage).toContain("getVendorPortalAccountSession(authToken)");
  expect(accountUi).toContain("requiresAuthToken");
  expect(accountUi).toContain("acceptVendorPortalWorkOrder(item.id, token)");
  expect(accountUi).toContain(
    "commentVendorPortalWorkOrder(item.id, body, token)",
  );
  expect(accountUi).toContain(
    "uploadVendorPortalWorkOrderPhoto(item.id, file, token)",
  );
  expect(api).toContain("vendorPortalBearerHeaders");
  expect(api).toContain("publicRequestForm<VendorPortalRecord>");
});

test("vendor account dashboard accepts, comments, and adds a photo", async ({
  page,
}) => {
  const unsafeRequests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      path.startsWith("/api/v1/comms") ||
      path.startsWith("/api/v1/xero") ||
      path.startsWith("/api/v1/basiq") ||
      path.startsWith("/api/v1/payments") ||
      path.startsWith("/api/v1/reconciliation") ||
      path.includes("/contractor-delivery") ||
      path.includes("assignment-notification")
    ) {
      unsafeRequests.push(`${request.method()} ${path}`);
    }
  });

  await page.route("**/api/v1/vendor-portal/account/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "active",
        contractor_id: "contractor-1",
        vendor_name: "Bright Spark Electrical Pty Ltd",
        email: "service@brightspark.example",
        linked_at: "2026-06-01T00:00:00.000Z",
        last_seen_at: "2026-06-01T00:00:00.000Z",
        revoked_at: null,
        recovery_hint:
          "This contractor login can open the vendor portal without the original claim link.",
      }),
    });
  });
  await page.route("**/api/v1/vendor-portal/account/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(SESSION_RESPONSE),
    });
  });

  let acceptCalls = 0;
  let commentCalls = 0;
  let photoCalls = 0;
  await page.route(
    "**/api/v1/vendor-portal/account/work-orders/work-order-1/accept",
    async (route) => {
      acceptCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ACCEPTED_RESPONSE),
      });
    },
  );
  await page.route(
    "**/api/v1/vendor-portal/account/work-orders/work-order-1/comment",
    async (route) => {
      commentCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(COMMENTED_RESPONSE),
      });
    },
  );
  await page.route(
    "**/api/v1/vendor-portal/account/work-orders/work-order-1/photo",
    async (route) => {
      photoCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(PHOTO_RESPONSE),
      });
    },
  );

  await page.goto("/vendor-portal");

  await expect(page.getByRole("heading", { name: "Your jobs" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Repair air conditioning")).toBeVisible();
  await expect(page.getByText("Please attend before trading opens.")).toBeVisible();

  await page.getByRole("button", { name: "Accept job" }).click();
  await expect(page.getByText("Accepted — in progress")).toBeVisible();
  expect(acceptCalls).toBe(1);

  await page
    .getByPlaceholder("e.g. On my way, ETA 30 minutes.")
    .fill("On my way, ETA 30 minutes.");
  await page.getByRole("button", { name: "Post update" }).click();
  await expect(page.getByText("On my way, ETA 30 minutes.")).toBeVisible();
  expect(commentCalls).toBe(1);

  await page.locator('input[type="file"]').setInputFiles({
    name: "job.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x10, 0x20]),
  });
  await expect(page.getByText("Contractor added a job photo.")).toBeVisible();
  expect(photoCalls).toBe(1);

  expect(unsafeRequests).toEqual([]);
});
