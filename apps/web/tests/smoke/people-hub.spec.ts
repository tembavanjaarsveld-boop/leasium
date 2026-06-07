import { expect, type Locator, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

const OWNERS = [
  {
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
      {
        property_id: "p2",
        property_name: "King Street Offices",
        split_pct: 40,
      },
    ],
  },
];

async function expectTouchTarget(control: Locator, minSize = 44) {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.width).toBeGreaterThanOrEqual(minSize);
  expect(box.height).toBeGreaterThanOrEqual(minSize);
}

test("people hub renders tabs and the owners directory", async ({ page }) => {
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });

  await mockOwners(page);

  await page.goto("/people");

  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();

  for (const label of ["Tenants", "Owners", "Vendors", "Prospects"]) {
    await expect(page.getByRole("tab", { name: label })).toBeVisible();
  }

  // Owners is the default tab: the mocked owner + its property roll-up render.
  await expect(page.getByText("SKJ Holdings Pty Ltd")).toBeVisible();
  await expect(page.getByText("2 properties")).toBeVisible();
  await expect(page.getByText("Queen Street Retail Centre")).toBeVisible();

  // Prospects tab shows the roadmap stub.
  await page.getByRole("tab", { name: "Prospects" }).click();
  await expect(page.getByText(/Prospects are on the roadmap/i)).toBeVisible();
});

test("mobile people hub tabs stay touch-safe", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });
  await mockOwners(page);

  await page.goto("/people");

  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();

  const peopleTabs = page.getByRole("tablist", { name: "People types" });
  await expect(peopleTabs).toBeVisible();
  for (const label of ["Tenants", "Owners", "Vendors", "Prospects"]) {
    await expectTouchTarget(peopleTabs.getByRole("tab", { name: label }));
  }
});

test("people tenants add action stays touch-safe", async ({ page }) => {
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });
  await mockOwners(page);

  await page.goto("/people");

  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
  await page.getByRole("tab", { name: "Tenants" }).click();
  await expectTouchTarget(page.getByRole("link", { name: "Add tenant" }));
});

test("self-managed people hub hides owner-client tab and falls back from owner URLs", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "self_managed_owner" });

  let ownerRequests = 0;
  await page.route(
    (url) => url.pathname.endsWith("/owners"),
    async (route) => {
      if (route.request().method() === "GET") ownerRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(OWNERS),
      });
    },
  );

  await page.goto("/people?tab=owners");

  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Owners" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Tenants" })).toBeVisible();
  await expect(page.getByText("Bright Cafe Pty Ltd")).toBeVisible();
  await expect(page.getByText("SKJ Holdings Pty Ltd")).toHaveCount(0);
  expect(ownerRequests).toBe(0);
});

test("hybrid people hub uses managing-agent owner-client framing", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "hybrid" });
  await mockOwners(page);

  await page.goto("/people");

  await expect(page.getByRole("tab", { name: "Owners" })).toBeVisible();
  await expect(page.getByText("SKJ Holdings Pty Ltd")).toBeVisible();
});

test("self-managed direct owner record uses entity framing", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "self_managed_owner" });
  await mockOwnerRecord(page);

  await page.goto("/owners/owner-1");

  await expect(
    page.getByRole("heading", { name: "SKJ Holdings Pty Ltd" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Entities" })).toHaveAttribute(
    "href",
    /\/settings\?tab=organisation/,
  );
  await expect(
    page.getByText("Entity follow-ups will appear here"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Email owner" })).toHaveCount(
    0,
  );
  await expect(page.getByText("Owner follow-ups")).toHaveCount(0);
  await expect(page.getByText("Owner statements")).toHaveCount(0);
  await expect(page.getByText("owner-specific tasks")).toHaveCount(0);
  await expect(page.getByText("owner events")).toHaveCount(0);
});

async function mockOwners(page: Parameters<typeof mockLeasiumApi>[0]) {
  // Layer a /owners mock over the catch-all (most-recent route wins first).
  await page.route(
    (url) => url.pathname.endsWith("/owners"),
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(OWNERS),
      });
    },
  );
}

async function mockOwnerRecord(page: Parameters<typeof mockLeasiumApi>[0]) {
  await page.route(
    (url) => url.pathname.endsWith("/api/v1/owners/owner-1"),
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(OWNERS[0]),
      });
    },
  );
}
