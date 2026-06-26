import { expect, test } from "@playwright/test";

import { mockLeasiumApi, seedPrimaryEntitySelection } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await seedPrimaryEntitySelection(page);
  await mockLeasiumApi(page);
});

test("map view shows saved and approximate location coverage", async ({
  page,
}) => {
  await page.goto("/properties?view=map");

  await expect(page.getByRole("tab", { name: "Map" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // All-entities view: property-1 carries an exact metadata.map_location.
  // The other properties should still appear through local AU locality
  // fallbacks so the map does not start empty for address-only portfolios.
  await expect(page.getByText("4 shown")).toBeVisible();
  await expect(page.getByText("1 pinned")).toBeVisible();
  await expect(page.getByText("3 needs pin")).toBeVisible();
});

test("map view lists properties needing exact pins with Google Maps address links", async ({
  page,
}) => {
  await page.goto("/properties?view=map");

  await expect(page.getByText("Needs exact pin")).toBeVisible();

  const mapsLink = page
    .locator('a[href*="google.com/maps/search"]')
    .first();
  await expect(mapsLink).toBeVisible();
  await expect(mapsLink).toHaveAttribute("target", "_blank");
  const href = await mapsLink.getAttribute("href");
  expect(href).toContain(encodeURIComponent("24 Queen Street"));
});

test("map view renders one Leaflet marker per property with a display location", async ({
  page,
}) => {
  await page.goto("/properties?view=map");

  const markers = page.locator(".leaflet-marker-icon");
  await expect(markers).toHaveCount(4);
  const markerPositions = await markers.evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = (node as HTMLElement).getBoundingClientRect();
      return {
        left: box.left,
        top: box.top,
      };
    }),
  );
  const lefts = markerPositions.map((position) => position.left);
  const tops = markerPositions.map((position) => position.top);
  const visibleSpread = Math.max(
    Math.max(...lefts) - Math.min(...lefts),
    Math.max(...tops) - Math.min(...tops),
  );
  expect(visibleSpread).toBeGreaterThan(32);
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
  await expect(page.locator(".leaflet-marker-icon")).toHaveCount(4);

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

  // The marker remains on the map and the row leaves the needs-pin list.
  await expect(page.locator(".leaflet-marker-icon")).toHaveCount(4);
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
  await expect(page.locator(".leaflet-marker-icon")).toHaveCount(4);

  await page
    .getByRole("button", { name: "Set location for Queen Street Warehouse" })
    .click();
  await page.getByLabel("Latitude for Queen Street Warehouse").fill("120");
  await page.getByLabel("Longitude for Queen Street Warehouse").fill("200");
  await page.getByRole("button", { name: "Save pin" }).click();

  await expect(
    page.getByText("Latitude must be -90 to 90 and longitude -180 to 180."),
  ).toBeVisible();
  await expect(page.locator(".leaflet-marker-icon")).toHaveCount(4);
  expect(patchCount).toBe(0);
});
