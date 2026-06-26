import { expect, type Page, test } from "@playwright/test";

import { mockLeasiumApi, seedPrimaryEntitySelection } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await seedPrimaryEntitySelection(page);
  await mockLeasiumApi(page);
});

// Injects a single active lease whose review (insights) and expiry both fall in
// July 2026, so the month grid renders a rent-review and a lease-expiry chip in
// the same default month without depending on the far-future shared fixtures.
async function routeJulyLeaseEvents(page: Page) {
  await page.route("**/api/v1/rent-roll**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          entity_id: "entity-1",
          entity_name: "Acme Holdings Pty Ltd",
          property_id: "property-1",
          property_name: "Queen Street Retail Centre",
          tenancy_unit_id: "unit-1",
          unit_label: "Shop 3",
          lease_id: "lease-1",
          tenant_id: "tenant-1",
          tenant_name: "Bright Cafe",
          lease_status: "active",
          commencement_date: "2025-07-01",
          expiry_date: "2026-07-20",
          tenant_billing_email: null,
          annual_rent_cents: 9600000,
          rent_frequency: "monthly",
          charge_rules: [],
          charge_rules_total_cents: 0,
          next_due_date: null,
          gst_readiness_blockers: [],
          xero_readiness_blockers: [],
          invoice_readiness_blockers: [],
        },
      ]),
    });
  });
}

test("map view shows mapped and unmapped counts from property metadata", async ({
  page,
}) => {
  await page.goto("/properties?view=map");

  await expect(page.getByRole("tab", { name: "Map" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // All-entities view: property-1 carries metadata.map_location; property-2,
  // property-3, and the entity-2 property (property-secondary-1) do not.
  await expect(page.getByText("1 mapped")).toBeVisible();
  await expect(page.getByText("3 unmapped")).toBeVisible();
});

test("map view lists unmapped properties with Google Maps address links", async ({
  page,
}) => {
  await page.goto("/properties?view=map");

  await expect(page.getByText("Unmapped properties")).toBeVisible();

  const mapsLink = page
    .locator('a[href*="google.com/maps/search"]')
    .first();
  await expect(mapsLink).toBeVisible();
  await expect(mapsLink).toHaveAttribute("target", "_blank");
  const href = await mapsLink.getAttribute("href");
  expect(href).toContain(encodeURIComponent("24 Queen Street"));
});

test("map view renders one Leaflet marker per property with coordinates", async ({
  page,
}) => {
  await page.goto("/properties?view=map");

  // Only the mapped property (property-1) becomes a Leaflet marker.
  await expect(page.locator(".leaflet-marker-icon")).toHaveCount(1);
});

test("map marker click selects the property", async ({ page }) => {
  await page.goto("/properties?view=map");

  const marker = page.locator(".leaflet-marker-icon").first();
  await expect(marker).toBeVisible();
  await marker.click();

  await expect(page).toHaveURL(/property_id=property-1/);
});

test("setting manual coordinates patches property metadata and adds a pin", async ({
  page,
}) => {
  const patchBodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/v1/premises/property-2", async (route) => {
    if (route.request().method() === "PATCH") {
      patchBodies.push(
        route.request().postDataJSON() as Record<string, unknown>,
      );
    }
    // Fall through to the shared mock so it mutates fixture state and responds.
    await route.fallback();
  });

  await page.goto("/properties?view=map");
  await expect(page.locator(".leaflet-marker-icon")).toHaveCount(1);

  await page
    .getByRole("button", { name: "Set location for Queen Street Warehouse" })
    .click();
  await page
    .getByLabel("Latitude for Queen Street Warehouse")
    .fill("-27.47");
  await page
    .getByLabel("Longitude for Queen Street Warehouse")
    .fill("153.02");
  await page.getByRole("button", { name: "Save pin" }).click();

  // The new pin joins the map and the row leaves the unmapped list.
  await expect(page.locator(".leaflet-marker-icon")).toHaveCount(2);
  await expect(
    page.getByRole("button", {
      name: "Set location for Queen Street Warehouse",
    }),
  ).toHaveCount(0);

  // The PATCH spreads pre-existing metadata before adding the manual pin.
  expect(patchBodies).toHaveLength(1);
  expect(patchBodies[0].metadata).toMatchObject({
    external_ref: "QSW-2019",
    map_location: { lat: -27.47, lng: 153.02, source: "manual" },
  });
});

test("coordinate inputs reject out-of-range values", async ({ page }) => {
  let patchCount = 0;
  await page.route("**/api/v1/premises/property-2", async (route) => {
    if (route.request().method() === "PATCH") {
      patchCount += 1;
    }
    await route.fallback();
  });

  await page.goto("/properties?view=map");
  await expect(page.locator(".leaflet-marker-icon")).toHaveCount(1);

  await page
    .getByRole("button", { name: "Set location for Queen Street Warehouse" })
    .click();
  await page.getByLabel("Latitude for Queen Street Warehouse").fill("120");
  await page.getByLabel("Longitude for Queen Street Warehouse").fill("200");
  await page.getByRole("button", { name: "Save pin" }).click();

  await expect(
    page.getByText("Latitude must be -90 to 90 and longitude -180 to 180."),
  ).toBeVisible();
  await expect(page.locator(".leaflet-marker-icon")).toHaveCount(1);
  expect(patchCount).toBe(0);
});

test("calendar month grid places rent review and lease expiry chips on their dates", async ({
  page,
}) => {
  await routeJulyLeaseEvents(page);
  await page.goto("/properties?view=calendar");

  await expect(
    page.getByRole("group", { name: "Calendar layout" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Month", exact: true }).click();

  await expect(
    page.getByRole("heading", { name: "July 2026" }),
  ).toBeVisible();
  await expect(page.locator('[data-date="2026-07-01"]')).toContainText(
    "rent review",
  );
  await expect(page.locator('[data-date="2026-07-20"]')).toContainText(
    "lease expiry",
  );
});

test("calendar chips deep-link to the property record", async ({ page }) => {
  await routeJulyLeaseEvents(page);
  await page.goto("/properties?view=calendar");

  await expect(
    page.getByRole("group", { name: "Calendar layout" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Month", exact: true }).click();

  const expiryChip = page.locator('[data-date="2026-07-20"] a').first();
  await expect(expiryChip).toHaveAttribute("href", /property_id=property-1/);
});

test("calendar month navigation works by keyboard", async ({ page }) => {
  await page.goto("/properties?view=calendar");

  await expect(
    page.getByRole("group", { name: "Calendar layout" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Month", exact: true }).click();

  // The earliest event (the rent review) anchors the default month.
  await expect(
    page.getByRole("heading", { name: "July 2026" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Next month" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "August 2026" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Previous month" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "July 2026" }),
  ).toBeVisible();
});

test("calendar month grid respects owner_tag filter", async ({ page }) => {
  // The Eagle Street trust owns no lease-event property, so its calendar feed
  // is empty under the owner_tag filter.
  await page.goto(
    "/properties?view=calendar&owner_tag=eagle%20street%20property%20trust",
  );
  await expect(page.getByRole("tab", { name: "Calendar" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByText(
      "No rent reviews or lease expiries match the current filters.",
    ),
  ).toBeVisible();

  // The Queen Street trust owns the rent-review property; its event flows into
  // the month grid.
  await page.goto(
    "/properties?view=calendar&owner_tag=queen%20street%20property%20trust",
  );
  await expect(
    page.getByRole("group", { name: "Calendar layout" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Month", exact: true }).click();

  await expect(
    page.getByRole("heading", { name: "July 2026" }),
  ).toBeVisible();
  await expect(page.locator('[data-date="2026-07-01"]')).toContainText(
    "rent review",
  );
});
