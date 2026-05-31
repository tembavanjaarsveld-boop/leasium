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

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page);

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
