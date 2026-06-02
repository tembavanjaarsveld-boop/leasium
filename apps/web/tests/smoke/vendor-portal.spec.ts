import { expect, type Page, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

const VENDOR_PORTAL_RESPONSE = {
  auth: {
    mode: "operator_preview",
    token_source: "bearer",
    vendor_auth_configured: false,
    boundary: "operator_session",
    detail:
      "Read-only operator preview scoped by entity role; no vendor portal account is created.",
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
  work_orders: {
    open_count: 1,
    urgent_count: 1,
    overdue_count: 0,
    items: [
      {
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
        comments: [
          {
            body: "Please attend before trading opens.",
            timestamp: "2026-06-01T03:00:00Z",
          },
        ],
      },
    ],
  },
  guardrails: [
    "Read-only vendor portal: opening this page does not send contractor email or SMS, dispatch work, refresh providers, write Xero data, reconcile payments, or mutate provider history.",
    "Work orders are shown only when explicitly marked vendor-visible; tenant identity, internal notes, provider evidence, and payment identifiers stay inside the operator workspace.",
  ],
  generated_at: "2026-06-01T04:00:00.000Z",
};

async function trapUnsafeCalls(page: Page, attemptedCalls: string[]) {
  const patterns = [
    "**/api/v1/contractors",
    "**/api/v1/contractors/*",
    "**/api/v1/maintenance/**/assignment-notification/**",
    "**/api/v1/maintenance/**/contractor**",
    "**/api/v1/maintenance/**/comments",
    "**/api/v1/comms/**",
    "**/api/v1/xero/**",
    "**/api/v1/basiq/**",
    "**/api/v1/owners/statements/send**",
  ];
  for (const pattern of patterns) {
    await page.route(pattern, async (route) => {
      attemptedCalls.push(
        `${route.request().method()} ${new URL(route.request().url()).pathname}`,
      );
      await route.fulfill({
        status: 500,
        body: "unsafe call must stay unused from vendor portal",
      });
    });
  }
}

async function navigateWithAppRouter(page: Page, href: string) {
  await page.evaluate((targetHref) => {
    const router = (
      window as typeof window & {
        next?: { router?: { push: (href: string) => void } };
      }
    ).next?.router;
    if (!router) {
      throw new Error("Next router unavailable.");
    }
    router.push(targetHref);
  }, href);
}

test("vendor portal preview renders safe read-only work", async ({ page }) => {
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });
  const attemptedCalls: string[] = [];
  await trapUnsafeCalls(page, attemptedCalls);

  await page.route("**/api/v1/vendor-portal/contractor-1", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(VENDOR_PORTAL_RESPONSE),
    });
  });

  await page.goto("/vendor-portal/contractor-1");

  await expect(
    page.getByRole("heading", { name: "Vendor portal" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Bright Spark Electrical").first()).toBeVisible();
  await expect(
    page.getByText("Bright Spark Electrical Pty Ltd").first(),
  ).toBeVisible();
  await expect(page.getByText("service@brightspark.example")).toBeVisible();
  await expect(page.getByText("electrical", { exact: true })).toBeVisible();
  await expect(page.getByText("urgent").first()).toBeVisible();
  await expect(page.getByText("20 km")).toBeVisible();
  await expect(page.getByText("Repair air conditioning")).toBeVisible();
  await expect(page.getByText("Queen Street Retail Centre")).toBeVisible();
  await expect(page.getByText("$1,250 quote")).toBeVisible();
  await expect(
    page.getByText("Please attend before trading opens."),
  ).toBeVisible();
  await expect(page.getByText("Operator preview", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Read-only vendor portal", { exact: false }),
  ).toBeVisible();

  for (const fragment of [
    "Private Tenant Pty Ltd",
    "private-tenant@example.test",
    "sendgrid",
    "twilio",
    "provider_message_id",
    "provider_history",
    "contractor_delivery",
    "operator_preview",
  ]) {
    await expect(page.getByText(fragment, { exact: false })).toHaveCount(0);
  }
  expect(attemptedCalls).toEqual([]);
});

test("vendor portal preview shows a calm not-found state", async ({ page }) => {
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });

  await page.route("**/api/v1/vendor-portal/contractor-1", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(VENDOR_PORTAL_RESPONSE),
    });
  });
  await page.route("**/api/v1/vendor-portal/missing-vendor", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Vendor portal not found." }),
    });
  });

  await page.goto("/vendor-portal/contractor-1");
  await expect(page.getByText("Repair air conditioning")).toBeVisible({
    timeout: 15_000,
  });

  await page.goto("/vendor-portal/missing-vendor");

  await expect(
    page.getByRole("heading", { name: "Vendor portal preview not found" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("No vendor portal preview found.")).toBeVisible();
  await expect(
    page.getByText("This vendor portal preview may have been deleted"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Back to vendors" }),
  ).toBeVisible();
  await expect(page.getByText("Bright Spark Electrical")).toHaveCount(0);
  await expect(page.getByText("Repair air conditioning")).toHaveCount(0);
  await expect(page.getByText("Vendor portal unavailable")).toHaveCount(0);
});

test("vendor portal preview refetches on return and clears stale vendor data", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });
  let contractorOneMode: "success" | "not_found" = "success";
  let contractorOneRequests = 0;

  await page.route("**/api/v1/vendor-portal/contractor-1", async (route) => {
    contractorOneRequests += 1;
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    if (contractorOneMode === "not_found") {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Vendor portal preview no longer exists." }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(VENDOR_PORTAL_RESPONSE),
    });
  });
  await page.route("**/api/v1/vendor-portal/contractor-2", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...VENDOR_PORTAL_RESPONSE,
        vendor: {
          ...VENDOR_PORTAL_RESPONSE.vendor,
          id: "contractor-2",
          name: "Other Vendor Plumbing",
          company_name: "Other Vendor Plumbing Pty Ltd",
          email: "service@othervendor.example",
        },
        work_orders: {
          ...VENDOR_PORTAL_RESPONSE.work_orders,
          items: [
            {
              ...VENDOR_PORTAL_RESPONSE.work_orders.items[0],
              id: "work-order-2",
              title: "Repair burst pipe",
              property_name: "King Street Offices",
            },
          ],
        },
      }),
    });
  });

  await page.goto("/vendor-portal/contractor-1");
  await expect(page.getByText("Bright Spark Electrical").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Repair air conditioning")).toBeVisible();

  contractorOneMode = "not_found";
  await navigateWithAppRouter(page, "/vendor-portal/contractor-2");
  await expect(page.getByText("Other Vendor Plumbing").first()).toBeVisible();
  await expect(page.getByText("Repair burst pipe")).toBeVisible();
  await navigateWithAppRouter(page, "/vendor-portal/contractor-1");

  await expect(
    page.getByRole("heading", { name: "Vendor portal preview not found" }),
  ).toBeVisible();
  await expect(
    page.getByText("Vendor portal preview no longer exists."),
  ).toBeVisible();
  await expect(page.getByText("Bright Spark Electrical")).toHaveCount(0);
  await expect(page.getByText("Repair air conditioning")).toHaveCount(0);
  await expect(page.getByText("Other Vendor Plumbing")).toHaveCount(0);
  await expect(page.getByText("Repair burst pipe")).toHaveCount(0);
  expect(contractorOneRequests).toBeGreaterThanOrEqual(2);
});

test("vendor portal preview keeps service failures out of not-found state", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });

  await page.route("**/api/v1/vendor-portal/broken-vendor", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Vendor portal service unavailable." }),
    });
  });

  await page.goto("/vendor-portal/broken-vendor");

  await expect(
    page.getByRole("heading", { name: "Vendor portal unavailable" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Vendor portal service unavailable.")).toBeVisible();
  await expect(page.getByText("Vendor portal preview not found")).toHaveCount(0);
  await expect(page.getByText("Bright Spark Electrical")).toHaveCount(0);
});

test("vendor portal preview generates a contractor login link", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });

  await page.route("**/api/v1/vendor-portal/contractor-1", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(VENDOR_PORTAL_RESPONSE),
    });
  });
  let inviteCalls = 0;
  await page.route(
    "**/api/v1/vendor-portal/contractor-1/invite",
    async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      inviteCalls += 1;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          contractor_id: "contractor-1",
          vendor_display_name: "Bright Spark Electrical Pty Ltd",
          claim_email: "service@brightspark.example",
          portal_token: "tok-vendor-123",
          claim_url: "/vendor-portal/invite/tok-vendor-123",
          expires_at: "2026-07-01T00:00:00.000Z",
          guardrails: [
            "Vendor portal invite created locally only: no contractor email or SMS is sent, no work is dispatched, and no provider history is mutated.",
          ],
        }),
      });
    },
  );

  await page.goto("/vendor-portal/contractor-1");
  const generate = page.getByRole("button", { name: "Generate login link" });
  await expect(generate).toBeVisible({ timeout: 15_000 });
  await generate.click();

  await expect(
    page.getByText("/vendor-portal/invite/tok-vendor-123"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  expect(inviteCalls).toBe(1);
});
