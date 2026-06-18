import { expect, type Locator, test } from "@playwright/test";

import type { PropertyRecord } from "../../src/lib/api";
import {
  propertyMatchesOwnershipTag,
  propertyOwnershipBadges,
} from "../../src/lib/property-ownership";
import { mockLeasiumApi, seedPrimaryEntitySelection } from "./api-mocks";

async function expectTouchTarget(locator: Locator, minSize = 44) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.width).toBeGreaterThanOrEqual(minSize);
  expect(box.height).toBeGreaterThanOrEqual(minSize);
}

test.beforeEach(async ({ page }) => {
  await seedPrimaryEntitySelection(page);
  await mockLeasiumApi(page);
});

test("properties action=new opens the new-property drawer", async ({ page }) => {
  await page.goto("/properties?action=new");

  await expect(
    page.getByRole("heading", { name: "New property", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Close property editor" }).last(),
  ).toBeVisible();

  // Pick-or-create entity: choosing "Create new entity" reveals inline fields
  // so a property and its (new) entity are set up in the same step.
  const entitySelect = page.locator("select").filter({
    has: page.getByRole("option", { name: "+ Create new entity…" }),
  });
  await entitySelect.selectOption({ label: "+ Create new entity…" });
  await expect(page.getByText("New entity name")).toBeVisible();
  await expect(
    page.getByPlaceholder("e.g. GRHQ Unit Trust"),
  ).toBeVisible();

  await expect(page).not.toHaveURL(/action=new/);
});

test("mobile properties loading copy stays contextual", async ({ page }) => {
  await page.route("**/api/v1/premises/by-entity/entity-1**", async () => {
    await new Promise(() => {});
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/properties");

  await expect(page.getByText("Checking properties").first()).toBeVisible();
  await expect(page.getByText(/Loading(?:\.\.\.|…)/)).toHaveCount(0);
});

test("mobile properties default uses cards instead of a panning table", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/properties");

  await expect(
    page.getByRole("heading", { name: "Properties" }),
  ).toBeVisible();
  await expect(page.getByRole("table").first()).toBeHidden();

  const mobileList = page.getByRole("list", { name: "Property cards" });
  await expect(mobileList).toBeVisible();
  await expect(
    page.locator('[data-testid="property-card-media"]:visible'),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-testid="properties-occupancy-stat"]:visible'),
  ).toHaveCount(0);
  await expect(page.getByText("Rent roll", { exact: true })).toBeVisible();
  await expect(page.getByText("Renewals · 90d")).toBeVisible();

  const card = mobileList
    .getByRole("listitem")
    .filter({ hasText: "Queen Street Retail Centre" });
  await expect(card).toContainText("Brisbane City QLD");
  await expect(card).toContainText("Queen Street Property Trust");
  await expect(card).toContainText("$8,000 / mo");

  const selectButton = card.getByRole("button", {
    name: /Open property Queen Street Retail Centre/,
  });
  await expectTouchTarget(selectButton);
});

test("desktop Properties opens on the Horizon cards frame", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/properties");

  await expect(
    page.getByRole("heading", { name: "Properties" }),
  ).toBeVisible();
  await expect(
    page.getByText("3 properties · 67% occupied · $14,000 monthly rent roll"),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "Cards" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tab", { name: "Table" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Map" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Calendar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New property" })).toBeVisible();

  await expect(page.getByText("Occupancy")).toBeVisible();
  await expect(page.getByText("2 of 5")).toBeVisible();
  await expect(page.getByText("Rent roll", { exact: true })).toBeVisible();
  await expect(page.getByText("$14,000 / mo")).toBeVisible();
  await expect(page.getByText("Renewals · 90d")).toBeVisible();

  const cards = page.getByRole("list", { name: "Property cards" });
  await expect(cards).toBeVisible();
  await expect(
    cards.getByRole("button", { name: "Open property Queen Street Retail Centre" }),
  ).toBeVisible();
  await expect(cards.getByText("Queen Street Property Trust").first()).toBeVisible();
  await expect(cards.getByText("$8,000 / mo")).toBeVisible();
  await expect(cards.getByRole("button", { name: /Add property/ })).toBeVisible();
  await expect(
    page.getByText("Nothing is applied until you approve it."),
  ).toHaveCount(0);
  await expect(page.getByRole("table").first()).toBeHidden();
});

test("desktop selected property opens on the Horizon detail frame", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/properties?entity_id=entity-1&property_id=property-1");

  await expect(
    page.getByRole("link", { name: "Back to Properties" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Queen Street Retail Centre" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "12 Queen Street, Brisbane City QLD 4000 · Commercial retail · 1 unit",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Work order" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tab", { name: "Lease" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Billing" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Documents" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Activity" })).toBeVisible();

  await expect(page.getByText("Rent", { exact: true })).toBeVisible();
  await expect(page.getByText("$8,000 / mo").last()).toBeVisible();
  await expect(page.getByText("Lease term")).toBeVisible();
  await expect(page.getByText("Year 1 of 3")).toBeVisible();
  await expect(page.getByText("Arrears", { exact: true })).toBeVisible();
  await expect(page.getByText("Compliance", { exact: true })).toBeVisible();
  await expect(page.getByText("Current lease")).toBeVisible();
  await expect(page.getByText("Bright Cafe Pty Ltd")).toBeVisible();
  await expect(
    page.getByText("Fixed review · 1 Jul 2026").first(),
  ).toBeVisible();
  await expect(
    page.getByText("Activity", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Lease applied from Smart Intake")).toBeVisible();
  await expect(
    page.getByText("Insurance certificate renewal").first(),
  ).toBeVisible();
  await expect(page.getByRole("table").first()).toBeHidden();
});

test("desktop Properties cards keep portfolio metrics after billing filters", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/properties");

  await expect(
    page.getByText("3 properties · 67% occupied · $14,000 monthly rent roll"),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Table" }).click();
  await page.getByRole("tab", { name: /Billing/ }).click();
  const billingPropertyFilter = page.locator("select").filter({
    has: page.getByRole("option", { name: "Queen Street Retail Centre" }),
  });
  await billingPropertyFilter.selectOption("property-1");

  await page.getByRole("tab", { name: "Cards" }).click();
  await expect(
    page.getByText("3 properties · 67% occupied · $14,000 monthly rent roll"),
  ).toBeVisible();
  await expect(page.getByText("$14,000 / mo")).toBeVisible();
  await expect(page.getByText("$8,000 / mo").last()).toBeVisible();
  await expect(page.getByText("$6,000 / mo").last()).toBeVisible();
});

test("desktop property billing confirms charge add and supports inline delete", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  const mutationCalls: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const method = request.method();
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      mutationCalls.push(`${method} ${new URL(request.url()).pathname}`);
    }
    await route.fallback();
  });

  await page.goto("/properties?entity_id=entity-1&property_id=property-1");
  await expect(
    page.getByRole("heading", { name: "Queen Street Retail Centre" }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Billing" }).click();

  const chargeForm = page
    .locator("form")
    .filter({ hasText: "Quick charge rule" });
  await expect(chargeForm).toBeVisible();

  // Frequency selector replaces the old hard-coded monthly behaviour.
  const frequencySelect = chargeForm.locator("select").filter({
    has: page.getByRole("option", { name: "Weekly" }),
  });
  await expect(frequencySelect).toBeVisible();

  // Selecting the lease reveals its existing rules and a duplicate warning.
  const leaseSelect = chargeForm.locator("select").filter({
    has: page.getByRole("option", { name: "Select lease" }),
  });
  await leaseSelect.selectOption({ index: 1 });

  await expect(chargeForm.getByText("Charges on this lease")).toBeVisible();
  await expect(chargeForm.getByText("$8,000")).toBeVisible();
  await expect(
    chargeForm.getByText(/already has a Base rent charge/),
  ).toBeVisible();

  // Adding a charge surfaces an explicit success confirmation (the bug fix).
  await chargeForm.getByRole("spinbutton").fill("8000");
  await chargeForm.getByRole("button", { name: "Add charge" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Added Base rent" }),
  ).toBeVisible();

  // The inline delete removes a rule and confirms it.
  await chargeForm
    .getByRole("button", { name: "Delete Base rent charge" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Removed Base rent" }),
  ).toBeVisible();

  // Only internal charge-rule writes fire — no provider mutations.
  expect(mutationCalls).toEqual([
    "POST /api/v1/charge-rules",
    "DELETE /api/v1/charge-rules/charge-1",
  ]);
});

test("mobile properties calendar view keeps filters and review actions touch safe", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/properties?view=calendar");

  await expect(
    page.getByRole("heading", { name: "Properties" }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Calendar" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/view=calendar/);

  await expect(page.getByText("Review queue")).toBeVisible();
  await expect(
    page.getByText(/Queen Street Retail Centre.*rent review/).first(),
  ).toBeVisible();

  await expectTouchTarget(page.getByRole("tab", { name: "Calendar" }));
  await expectTouchTarget(
    page.getByRole("button", { name: /^Rent reviews/ }).first(),
  );
  await expectTouchTarget(
    page.getByRole("button", { name: /^Next 90/ }).first(),
  );
  await expectTouchTarget(page.getByRole("button", { name: "Copy schedule" }));
  await expectTouchTarget(
    page.getByRole("button", { name: "Copy follow-ups" }),
  );
  await expectTouchTarget(page.getByRole("link", { name: "Open next" }).first());
});

test("properties calendar creates lease follow-up tasks without provider side effects", async ({
  page,
}) => {
  const followUpRequests: Array<Record<string, unknown>> = [];
  const blockedCalls: string[] = [];
  await page.route("**/api/v1/obligations/lease-event-follow-ups", async (route) => {
    followUpRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        entity_id: "entity-1",
        as_of: "2026-06-02",
        horizon_days: 90,
        property_ids: ["property-1"],
        created_count: 1,
        skipped_count: 1,
        guardrails: [
          "Lease calendar follow-up creation only creates internal obligation tasks.",
          "It does not send email or SMS, dispatch providers, post invoices, sync Xero/Basiq, reconcile payments, or mutate leases.",
        ],
        created: [],
        skipped: [],
      }),
    });
  });
  await page.route("**/api/v1/{work-assignments,comms,xero,basiq}/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "GET" && pathname === "/api/v1/comms/queue/counts") {
      await route.fallback();
      return;
    }
    blockedCalls.push(pathname);
    await route.fulfill({
      status: 418,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Provider side effect must stay unused." }),
    });
  });

  await page.goto("/properties?view=calendar&owner_tag=queen%20street%20property%20trust");

  await expect(page.getByRole("tab", { name: "Calendar" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("button", { name: "Create next 90 tasks" }).click();
  await expect(
    page.getByText("Created 1 lease follow-up task. 1 already existed."),
  ).toBeVisible();
  expect(followUpRequests).toHaveLength(1);
  expect(followUpRequests[0]).toMatchObject({
    entity_id: "entity-1",
    horizon_days: 90,
  });
  expect(followUpRequests[0].property_ids).toEqual(["property-1", "property-2"]);
  expect(blockedCalls).toEqual([]);
});

test("properties calendar leaves full portfolio follow-up runs unscoped", async ({
  page,
}) => {
  const followUpRequests: Array<Record<string, unknown>> = [];
  await page.route("**/api/v1/obligations/lease-event-follow-ups", async (route) => {
    followUpRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        entity_id: "entity-1",
        as_of: "2026-06-02",
        horizon_days: 90,
        property_ids: [],
        created_count: 0,
        skipped_count: 0,
        guardrails: [
          "Lease calendar follow-up creation only creates internal obligation tasks.",
          "It does not send email or SMS, dispatch providers, post invoices, sync Xero/Basiq, reconcile payments, or mutate leases.",
        ],
        created: [],
        skipped: [],
      }),
    });
  });

  await page.goto("/properties?view=calendar");
  await page.getByRole("button", { name: "Create next 90 tasks" }).click();

  expect(followUpRequests).toHaveLength(1);
  expect(followUpRequests[0]).toMatchObject({
    entity_id: "entity-1",
    horizon_days: 90,
    property_ids: [],
  });
});

test("mobile properties map view keeps focus controls touch safe", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/properties?view=map");

  await expect(
    page.getByRole("heading", { name: "Properties" }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "Map" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page).toHaveURL(/view=map/);

  await expect(page.getByText("Map planning")).toBeVisible();
  await expect(page.getByText("Regional focus")).toBeVisible();
  await expect(page.getByText("0/0")).toHaveCount(0);

  // Unmapped properties fall back to an address-lookup list rather than the
  // schematic pins of v1.
  await expect(page.getByText("Unmapped properties")).toBeVisible();

  await expectTouchTarget(page.getByRole("tab", { name: "Map" }));
  await expectTouchTarget(
    page.getByRole("button", { name: /^Lease risk/ }).first(),
  );
  await expectTouchTarget(
    page.getByRole("button", { name: /^Vacancy\s+\d/ }).first(),
  );
  await expectTouchTarget(page.getByRole("button", { name: "Copy map brief" }));
  await expectTouchTarget(
    page.getByRole("button", { name: /Queen Street Retail Centre/ }).first(),
  );
  await expectTouchTarget(
    page.getByRole("button", { name: /^Vacancy focus/ }).first(),
  );
  await expectTouchTarget(
    page.getByRole("link", { name: "Google Maps" }).first(),
  );
  await expectTouchTarget(
    page.getByRole("button", { name: /^Set location for/ }).first(),
  );
});

test("properties table density controls stay touch safe", async ({ page }) => {
  await page.goto("/properties");

  await expect(
    page.getByRole("heading", { name: "Properties" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Table" }).click();

  const densityGroup = page.getByRole("group", { name: "Table row density" });
  await expect(densityGroup).toBeVisible();

  await expectTouchTarget(
    densityGroup.getByRole("button", { name: "Comfortable" }),
  );
  await expectTouchTarget(
    densityGroup.getByRole("button", { name: "Compact" }),
  );
});

test("properties table row edit actions stay touch safe", async ({ page }) => {
  await page.goto("/properties");

  await expect(
    page.getByRole("heading", { name: "Properties" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Table" }).click();

  await expectTouchTarget(
    page.getByRole("button", { name: "Edit Queen Street Retail Centre" }),
  );
});

test("properties inline table editors and owner chips stay touch safe", async ({
  page,
}) => {
  await page.goto("/properties");

  await expect(
    page.getByRole("heading", { name: "Properties" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Table" }).click();

  const queenStreetRow = page.getByRole("row", {
    name: /Queen Street Retail Centre/,
  });
  await expectTouchTarget(
    queenStreetRow.getByRole("button", {
      name: "Edit Street address for Queen Street Retail Centre",
    }),
  );
  const ownerChip = queenStreetRow.getByRole("button", {
    name: "Filter by ownership tag Queen Street Property Trust",
  });
  await expectTouchTarget(ownerChip);
  await ownerChip.click();
  await expectTouchTarget(
    page.getByRole("button", { name: "Clear ownership tag filter" }),
  );
});

test("properties image panel toggle stays touch safe", async ({ page }) => {
  await page.goto("/properties");

  await expect(
    page.getByRole("heading", { name: "Properties" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Table" }).click();

  await expectTouchTarget(
    page.getByRole("button", { name: /Property images/ }).first(),
  );
});

test("properties table density toggle trims row padding in compact mode", async ({
  page,
}) => {
  await page.goto("/properties");

  await expect(
    page.getByRole("heading", { name: "Properties" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Table" }).click();

  const densityGroup = page.getByRole("group", { name: "Table row density" });
  await expect(densityGroup).toBeVisible();
  const comfortable = densityGroup.getByRole("button", {
    name: "Comfortable",
  });
  const compact = densityGroup.getByRole("button", { name: "Compact" });

  // Comfortable is the unchanged default; its cells keep the py-3 padding.
  await expect(comfortable).toHaveAttribute("aria-pressed", "true");
  const firstCell = page
    .getByRole("table")
    .first()
    .locator("tbody tr")
    .first()
    .locator("td")
    .first();
  await expect(firstCell).toHaveClass(/py-3/);

  // Compact mode swaps the row cells to the tighter py-1.5 padding and
  // persists the choice in localStorage.
  await compact.click();
  await expect(compact).toHaveAttribute("aria-pressed", "true");
  await expect(firstCell).toHaveClass(/py-1\.5/);
  await expect(firstCell).not.toHaveClass(/py-3/);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem("leasium.properties.density"),
      ),
    )
    .toBe("compact");
});

test("property deep link shows a record-level not-found state", async ({
  page,
}) => {
  await page.route("**/api/v1/premises/missing-property", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Property not found." }),
    });
  });

  await page.goto("/properties?entity_id=entity-1&property_id=missing-property");

  await expect(
    page.getByRole("heading", { name: "Property not found" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText("This property may have been deleted or moved"),
  ).toBeVisible();
  await expect(page).toHaveURL(/property_id=missing-property/);
  await expect(
    page.getByAltText("Queen Street Retail Centre primary image"),
  ).toHaveCount(0);
  await expect(page.getByText("Property unavailable")).toHaveCount(0);
});

test("property deep link keeps non-404 failures on unavailable state", async ({
  page,
}) => {
  await page.route("**/api/v1/premises/broken-property", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Property service unavailable." }),
    });
  });

  await page.goto("/properties?entity_id=entity-1&property_id=broken-property");

  await expect(
    page.getByRole("heading", { name: "Property unavailable" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Property service unavailable.")).toBeVisible();
  await expect(page).toHaveURL(/property_id=broken-property/);
  await expect(page.getByText("Property not found")).toHaveCount(0);
});

test("property missing deep link does not widen selected-property child queries", async ({
  page,
}) => {
  const childRequests: string[] = [];
  await page.route("**/api/v1/{obligations,charge-rules}**", async (route) => {
    const url = new URL(route.request().url());
    childRequests.push(`${url.pathname}${url.search}`);
    await route.fallback();
  });

  await page.goto("/properties?entity_id=entity-1&property_id=missing-property");

  await expect(
    page.getByRole("heading", { name: "Property not found" }),
  ).toBeVisible({ timeout: 15_000 });
  expect(
    childRequests.filter((url) => !url.includes("property_id=")),
  ).toEqual([]);
});

test("property filtered deep link keeps selection inside the filtered list", async ({
  page,
}) => {
  await page.goto(
    "/properties?entity_id=entity-1&owner_tag=queen%20street%20property%20trust&property_id=property-3",
  );

  await expect(
    page.getByText("2 properties tagged Queen Street Property Trust").last(),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page).not.toHaveURL(/property_id=property-3/);
  await expect(
    page.getByAltText("Eagle Street Office primary image"),
  ).toHaveCount(0);
});

test("property owner chips display ownership chains with cleaner arrows", async () => {
  const property = {
    ownership_structure: "split",
    ownership_split: "50% Queen Street Property Trust -> Trustee Pty Ltd",
    owner_legal_name: null,
    trust_name: null,
    invoice_issuer_name: null,
    metadata: {},
  } as PropertyRecord;

  const [badge] = propertyOwnershipBadges(property, "Acme Holdings Pty Ltd");

  expect(badge).toMatchObject({
    label: "Queen Street Property Trust › Trustee Pty Ltd",
    tagKey: "queen street property trust -> trustee pty ltd",
    title: "Queen Street Property Trust -> Trustee Pty Ltd",
  });
  expect(
    propertyMatchesOwnershipTag(
      property,
      "Acme Holdings Pty Ltd",
      "queen street property trust -> trustee pty ltd",
    ),
  ).toBe(true);
});
