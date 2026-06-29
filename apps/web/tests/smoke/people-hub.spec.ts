import { expect, type Locator, test } from "@playwright/test";

import { mockLeasiumApi, seedPrimaryEntitySelection } from "./api-mocks";

// The two-entity fixture defaults fresh storage to All entities; pin
// single-entity specs to the primary entity, leaving All-entities specs
// on the fresh-storage default.
test.beforeEach(async ({ page }, testInfo) => {
  if (!testInfo.title.includes("All entities")) {
    await seedPrimaryEntitySelection(page);
  }
});

const OWNERS = [
  {
    id: "owner-1",
    entity_id: "entity-1",
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
  {
    id: "owner-2",
    entity_id: "entity-2",
    legal_name: "Rivergum Holdings Pty Ltd",
    abn: "99888777666",
    trustee_name: null,
    trust_name: "Rivergum Trust",
    invoice_issuer_name: null,
    billing_contact_name: null,
    billing_email: "owners@rivergum.example",
    invoice_reference: null,
    gst_registered: true,
    xero_contact_id: null,
    created_at: "2026-05-31T00:00:00.000Z",
    updated_at: "2026-05-31T00:00:00.000Z",
    property_count: 1,
    properties: [
      {
        property_id: "property-secondary-1",
        property_name: "Rivergum Warehouse",
        split_pct: 100,
      },
    ],
  },
];
const MISSING_OWNER_ENTITY_ID = "__missing_entity_id__";

async function expectTouchTarget(control: Locator, minSize = 44) {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.width).toBeGreaterThanOrEqual(minSize);
  expect(box.height).toBeGreaterThanOrEqual(minSize);
}

function watchForbiddenPeopleRequests(
  page: Parameters<typeof mockLeasiumApi>[0],
) {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    const mutatesPeople =
      request.method() !== "GET" &&
      (path.startsWith("/api/v1/tenants") ||
        path.startsWith("/api/v1/tenant-onboarding") ||
        path.startsWith("/api/v1/contractors") ||
        path.startsWith("/api/v1/owners") ||
        path.startsWith("/api/v1/comms") ||
        path.includes("/provider-dispatch"));
    const providerOrPayment =
      path.includes("/sendgrid") ||
      path.includes("/twilio") ||
      path.includes("/xero") ||
      path.includes("/basiq") ||
      path.includes("/payments") ||
      path.includes("/reconciliation");
    if (mutatesPeople || providerOrPayment) {
      requests.push(`${request.method()} ${path}`);
    }
  });
  return requests;
}

test("people hub renders tabs and the owners directory", async ({ page }) => {
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });

  const ownerListEntityIds = await mockOwners(page);
  const forbiddenRequests = watchForbiddenPeopleRequests(page);

  await page.goto("/people");

  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
  await expect(
    page.getByText("Tenants and vendors across the portfolio."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Invite tenant" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add person" })).toBeVisible();

  for (const label of ["Tenants", "Owners", "Vendors", "Prospects"]) {
    await expect(page.getByRole("tab", { name: label })).toBeVisible();
  }

  // Owners is the default tab: the mocked owner + its property roll-up render.
  await expect(page.getByText("SKJ Holdings Pty Ltd")).toBeVisible();
  await expect(page.getByText("Rivergum Holdings Pty Ltd")).toBeVisible();
  await expect(page.getByText("2 properties")).toBeVisible();
  await expect(page.getByText("Queen Street Retail Centre")).toBeVisible();
  await expect(page.getByText("Rivergum Warehouse")).toBeVisible();
  expect([...new Set(ownerListEntityIds)].sort()).toEqual([
    "entity-1",
    "entity-2",
  ]);
  expect(ownerListEntityIds).not.toContain("");
  expect(ownerListEntityIds).not.toContain(MISSING_OWNER_ENTITY_ID);

  // Prospects tab shows the roadmap stub.
  await page.getByRole("tab", { name: "Prospects" }).click();
  await expect(page.getByText(/Prospects are on the roadmap/i)).toBeVisible();
  await expect(page.getByText("Add prospect")).toBeVisible();
  expect(forbiddenRequests).toEqual([]);
});

test("people hub type tabs use the brand active state and zero prospect count", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });
  await mockOwners(page);

  await page.goto("/people");

  const peopleTabs = page.getByRole("tablist", { name: "People types" });
  await expect(peopleTabs).toBeVisible();

  const prospectsTab = peopleTabs.getByRole("tab", { name: /Prospects/ });
  await expect(prospectsTab).toContainText("0");

  await prospectsTab.click();

  await expect(prospectsTab).toHaveAttribute("aria-selected", "true");
  await expect(prospectsTab).toHaveClass(/bg-primary/);
  await expect(
    prospectsTab.locator('[data-ui="people-tab-brand-dot"]'),
  ).toHaveClass(/bg-accent/);
});

test("people hub All entities merges tenants and vendors across entities", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "self_managed_owner" });

  await page.goto("/people");

  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
  await expect(
    page.getByText("Tenants and vendors across the portfolio."),
  ).toBeVisible();
  // Tenants is the default tab for a self-managed owner.
  // The app is always all-entities now (the global switcher was removed), so
  // both entities' rows render by default; no entity selection step needed.

  // Tenant from the primary entity and the secondary entity both render. The
  // secondary card is labelled with its entity (scoped to the card to avoid the
  // hidden picker <option> of the same text).
  await expect(page.getByText("Bright Cafe Pty Ltd")).toBeVisible();
  const rivergumCard = page
    .locator("li")
    .filter({ hasText: "Rivergum Logistics Pty Ltd" });
  await expect(rivergumCard).toBeVisible();
  await expect(
    rivergumCard.getByText("Secondary Holdings Pty Ltd"),
  ).toBeVisible();

  // Clicking a trust tag filters the merged list to that entity; Clear restores.
  await rivergumCard
    .getByRole("button", { name: "Secondary Holdings Pty Ltd" })
    .click();
  await expect(
    page.getByText("Showing Secondary Holdings Pty Ltd only"),
  ).toBeVisible();
  await expect(
    page.locator("li").filter({ hasText: "Bright Cafe Pty Ltd" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByText("Bright Cafe Pty Ltd")).toBeVisible();

  // Vendors merge across entities too.
  await page.getByRole("tab", { name: "Vendors" }).click();
  await expect(
    page.getByText("Bright Spark Electrical", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Rivergum Plumbing", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Add vendor" })).toBeVisible();
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
  await expectTouchTarget(page.getByRole("link", { name: "Invite tenant" }));
  await expectTouchTarget(
    page.getByRole("link", { name: "Add person" }).first(),
  );
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
  await expect(page).toHaveURL(/\/people\?tab=tenants$/);
  await expect(page.getByText("Bright Cafe Pty Ltd")).toBeVisible();
  await expect(page.getByText("SKJ Holdings Pty Ltd")).toHaveCount(0);
  expect(ownerRequests).toBe(0);
});

test("hybrid people hub uses managing-agent owner-client framing", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "hybrid" });
  const ownerListEntityIds = await mockOwners(page);

  await page.goto("/people");

  await expect(page.getByRole("tab", { name: "Owners" })).toBeVisible();
  await expect(page.getByText("SKJ Holdings Pty Ltd")).toBeVisible();
  await expect(page.getByText("Rivergum Holdings Pty Ltd")).toBeVisible();
  expect([...new Set(ownerListEntityIds)].sort()).toEqual([
    "entity-1",
    "entity-2",
  ]);
  expect(ownerListEntityIds).not.toContain("");
  expect(ownerListEntityIds).not.toContain(MISSING_OWNER_ENTITY_ID);
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
  const requestedEntityIds: string[] = [];
  await page.route(
    (url) => url.pathname.endsWith("/owners"),
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      const requestedEntityId = new URL(route.request().url()).searchParams.get(
        "entity_id",
      );
      requestedEntityIds.push(requestedEntityId ?? MISSING_OWNER_ENTITY_ID);
      const owners = requestedEntityId
        ? OWNERS.filter((owner) => owner.entity_id === requestedEntityId)
        : OWNERS;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(owners),
      });
    },
  );
  return requestedEntityIds;
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
