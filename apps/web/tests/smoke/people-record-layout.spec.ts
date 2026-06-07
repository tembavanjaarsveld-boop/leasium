import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

const OWNER = {
  id: "owner-1",
  entity_id: "11111111-1111-1111-1111-111111111111",
  legal_name: "SKJ Holdings Pty Ltd",
  abn: "11222333444",
  trustee_name: null,
  trust_name: "SKJ Family Trust",
  invoice_issuer_name: null,
  billing_contact_name: null,
  billing_email: "owners@skjcapital.example",
  invoice_reference: null,
  gst_registered: true,
  xero_contact_id: null,
  created_at: "2026-05-31T00:00:00.000Z",
  updated_at: "2026-05-31T00:00:00.000Z",
  property_count: 2,
  properties: [
    {
      property_id: "p1",
      property_name: "Queen Street Retail Centre",
      split_pct: 60,
    },
    { property_id: "p2", property_name: "King Street Offices", split_pct: 40 },
  ],
};

const CONTRACTORS = [
  {
    id: "contractor-1",
    entity_id: "entity-1",
    name: "Bright Spark Electrical",
    company_name: "Bright Spark Electrical Pty Ltd",
    categories: ["electrical"],
    email: "service@brightspark.example",
    phone: "07 3000 2222",
    service_radius_km: 20,
    priority: 1,
    notes: "Preferred electrical contractor.",
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
  },
];

const recordTabs = [
  { id: "overview", label: "Overview" },
  { id: "financials", label: "Financials" },
  { id: "tasks", label: "Tasks" },
  { id: "notes", label: "Notes" },
  { id: "files", label: "Files" },
  { id: "activity", label: "Activity" },
];

function expectTouchTarget(box: { width: number; height: number } | null) {
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });

  await page.route("**/api/v1/owners/owner-1", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(OWNER),
    });
  });

  await page.route("**/api/v1/contractors/contractor-1", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(CONTRACTORS[0]),
    });
  });
});

test.describe("people record layout", () => {
  for (const record of [
    {
      path: "/tenants/tenant-1",
      heading: "Bright Cafe Pty Ltd",
    },
    {
      path: "/owners/owner-1",
      heading: "SKJ Holdings Pty Ltd",
    },
    {
      path: "/contractors/contractor-1",
      heading: "Bright Spark Electrical",
    },
  ]) {
    test(`${record.path} exposes the shared People record tabs`, async ({
      page,
    }) => {
      await page.goto(record.path);

      await expect(
        page.getByRole("heading", { name: record.heading }),
      ).toBeVisible({ timeout: 15_000 });

      const sectionsNav = page.getByRole("navigation", {
        name: "People record sections",
      });
      await expect(sectionsNav).toBeVisible();
      await expect(sectionsNav.getByRole("link")).toHaveText(
        recordTabs.map((tab) => tab.label),
      );

      for (const tab of recordTabs) {
        await expect(
          sectionsNav.getByRole("link", { name: tab.label }),
        ).toHaveAttribute("href", `#${tab.id}`);
        await expect(page.locator(`#${tab.id}`)).toBeAttached();
      }
    });
  }

  test("vendor detail recovers from a stale selected entity", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("leasium.entity_id", "entity-2");
    });
    await page.route(
      (url) => url.pathname.endsWith("/contractors"),
      async (route) => {
        if (route.request().method() !== "GET") {
          await route.fallback();
          return;
        }
        const url = new URL(route.request().url());
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            url.searchParams.get("entity_id") === "entity-1"
              ? CONTRACTORS
              : [],
          ),
        });
      },
    );

    await page.goto("/contractors/contractor-1");

    await expect(
      page.getByRole("heading", { name: "Bright Spark Electrical" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Select entity")).toHaveValue("entity-1");
  });

  test("vendor detail links to the vendor portal preview", async ({ page }) => {
    await page.goto("/contractors/contractor-1");

    await expect(
      page.getByRole("heading", { name: "Bright Spark Electrical" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("link", { name: "Open portal preview" }),
    ).toHaveAttribute("href", "/vendor-portal/contractor-1");
  });

  test("shared record back link stays touch-safe", async ({ page }) => {
    await page.goto("/tenants/tenant-1");

    await expect(
      page.getByRole("heading", { name: "Bright Cafe Pty Ltd" }),
    ).toBeVisible({ timeout: 15_000 });

    await expectTouchTarget(
      await page
        .getByRole("link", { name: "Tenants", exact: true })
        .boundingBox(),
    );
  });

  test("vendor detail shows correspondence receipts without provider mutations", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.removeItem("vendorCopiedCorrespondenceCsv");
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            window.localStorage.setItem("vendorCopiedCorrespondenceCsv", text);
          },
        },
      });
    });
    const forbiddenRequests: string[] = [];
    await page.route("**/api/v1/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        request.method() !== "GET" &&
        (url.pathname.includes("/api/v1/comms") ||
          url.pathname.includes("/api/v1/maintenance") ||
          url.pathname.includes("/api/v1/contractors"))
      ) {
        forbiddenRequests.push(`${request.method()} ${url.pathname}`);
        await route.fulfill({
          status: 418,
          contentType: "application/json",
          body: JSON.stringify({
            detail: "Vendor correspondence must stay local-only.",
          }),
        });
        return;
      }
      await route.fallback();
    });
    await page.route(
      "**/api/v1/comms/correspondence/contractors/contractor-1",
      async (route) => {
        if (route.request().method() !== "GET") {
          await route.fallback();
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            entity_id: "entity-1",
            contractor_id: "contractor-1",
            contractor_name: "Bright Spark Electrical",
            generated_at: "2026-05-21T02:45:00.000Z",
            guardrails: [
              "This vendor correspondence is read-only and uses already stored comms audit receipts.",
              "Opening this panel does not send email, send SMS, change queue state, refresh providers, mutate vendor records, or mutate maintenance records.",
            ],
            events: [
              {
                id: "vendor-comms-1",
                source: "comms_audit",
                direction: "outbound",
                event_type: "dispatch",
                channel: "email",
                provider: "sendgrid",
                recipient: '=HYPERLINK("https://example.invalid","Vendor")',
                from_address: null,
                to_address: null,
                subject: null,
                summary: "contractor forward email queued",
                body_preview: null,
                target_kind: "maintenance_work_order",
                target_id: "work-order-1",
                status: "success",
                occurred_at: "2026-05-21T02:30:00.000Z",
                metadata: {
                  kind: "maintenance_contractor_forward",
                  candidate_id:
                    "maintenance_contractor_forward:maintenance_work_order:work-order-1",
                },
              },
              {
                id: "vendor-comms-2",
                source: "comms_audit",
                direction: "internal",
                event_type: "dismiss",
                channel: "email",
                provider: "comms",
                recipient: "service@brightspark.example",
                from_address: null,
                to_address: null,
                subject: null,
                summary: "contractor forward deferred",
                body_preview: null,
                target_kind: "maintenance_work_order",
                target_id: "work-order-1",
                status: "success",
                occurred_at: "2026-05-21T02:10:00.000Z",
                metadata: {
                  kind: "maintenance_contractor_forward",
                  candidate_id:
                    "maintenance_contractor_forward:maintenance_work_order:work-order-1",
                },
              },
            ],
          }),
        });
      },
    );

    await page.goto("/contractors/contractor-1");

    await expect(
      page.getByRole("heading", { name: "Bright Spark Electrical" }),
    ).toBeVisible({ timeout: 15_000 });
    const activityPanel = page.locator("#activity");
    await expect(activityPanel.getByText("2 correspondence events")).toBeVisible();
    await expect(
      activityPanel.getByText("contractor forward email queued"),
    ).toBeVisible();
    await expect(
      activityPanel.getByText("contractor forward deferred"),
    ).toBeVisible();
    await expect(
      activityPanel.getByRole("link", { name: "Open work order" }).first(),
    ).toHaveAttribute("href", "/operations/maintenance/work-order-1");
    const copyCorrespondenceCsv = activityPanel.getByRole("button", {
      name: "Copy correspondence CSV",
    });
    const downloadCorrespondenceCsv = activityPanel.getByRole("button", {
      name: "Download correspondence CSV",
    });
    await expect(copyCorrespondenceCsv).toBeVisible();
    await expect(copyCorrespondenceCsv).toBeEnabled();
    await expect(downloadCorrespondenceCsv).toBeVisible();
    await expect(downloadCorrespondenceCsv).toBeEnabled();

    await copyCorrespondenceCsv.click();
    await expect(
      activityPanel.getByText("Correspondence CSV copied."),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.localStorage.getItem("vendorCopiedCorrespondenceCsv"),
        ),
      )
      .not.toBeNull();
    const copiedCsv = await page.evaluate(() =>
      window.localStorage.getItem("vendorCopiedCorrespondenceCsv"),
    );
    const downloadPromise = page.waitForEvent("download");
    await downloadCorrespondenceCsv.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(
      "vendor-correspondence-bright-spark-electrical.csv",
    );
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const csv = await readFile(downloadPath!, "utf8");
    expect(copiedCsv).toBe(csv);
    expect(csv).toContain("Vendor correspondence");
    expect(csv).toContain("contractor forward email queued");
    expect(csv).toContain(
      "maintenance_contractor_forward:maintenance_work_order:work-order-1",
    );
    expect(csv).toContain(
      "Review-only export: copying or downloading this file does not send email, send SMS, change queue state, refresh providers, mutate vendor records, mutate maintenance records, or write provider history.",
    );
    expect(csv).not.toMatch(/(?:^|,)"[=+\-@]/m);
    expect(forbiddenRequests).toEqual([]);
  });

  test("owner detail shows a not-found state for missing owners", async ({
    page,
  }) => {
    await page.route("**/api/v1/owners/missing-owner", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Owner not found." }),
      });
    });

    await page.goto("/owners/missing-owner");

    await expect(
      page.getByRole("heading", { name: "Owner not found" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText("This owner record may have been deleted"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Back to owners" }),
    ).toBeVisible();
    await expect(page.getByText("Owner unavailable")).toHaveCount(0);
  });

  test("vendor detail shows a record-level not-found state", async ({
    page,
  }) => {
    await page.route("**/api/v1/contractors/missing-vendor", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Contractor not found." }),
      });
    });

    await page.goto("/contractors/missing-vendor");

    await expect(
      page.getByRole("heading", { name: "Vendor not found" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText("This vendor record may have been deleted"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Back to vendors" }),
    ).toBeVisible();
    await expect(page.getByText("Vendor unavailable")).toHaveCount(0);
  });

  test("tenant detail shows a record-level not-found state", async ({
    page,
  }) => {
    await page.route(
      (url) =>
        [
          "/api/v1/tenants/missing-tenant",
          "/api/v1/tenants/missing-tenant/detail",
        ].includes(url.pathname),
      async (route) => {
        if (route.request().method() !== "GET") {
          await route.fallback();
          return;
        }
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Tenant not found." }),
        });
      },
    );

    await page.goto("/tenants/missing-tenant");

    await expect(
      page.getByRole("heading", { name: "Tenant not found" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText("This tenant record may have been deleted"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Back to tenants" }),
    ).toBeVisible();
    await expect(page.getByText("Tenant unavailable")).toHaveCount(0);
  });

  test("tenant detail keeps generic load failures out of not-found state", async ({
    page,
  }) => {
    await page.route(
      (url) =>
        [
          "/api/v1/tenants/broken-tenant",
          "/api/v1/tenants/broken-tenant/detail",
        ].includes(url.pathname),
      async (route) => {
        if (route.request().method() !== "GET") {
          await route.fallback();
          return;
        }
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Tenant service unavailable." }),
        });
      },
    );

    await page.goto("/tenants/broken-tenant");

    await expect(
      page.getByRole("heading", { name: "Tenant unavailable" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Tenant service unavailable.")).toBeVisible();
    await expect(page.getByText("Tenant not found")).toHaveCount(0);
  });

  test("tenant detail gives non-404 primary failures priority over mixed 404s", async ({
    page,
  }) => {
    await page.route("**/api/v1/tenants/mixed-failure", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Tenant register unavailable." }),
      });
    });
    await page.route("**/api/v1/tenants/mixed-failure/detail", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Tenant not found." }),
      });
    });

    await page.goto("/tenants/mixed-failure");

    await expect(
      page.getByRole("heading", { name: "Tenant unavailable" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Tenant register unavailable.")).toBeVisible();
    await expect(page.getByText("Tenant not found")).toHaveCount(0);
  });
});
