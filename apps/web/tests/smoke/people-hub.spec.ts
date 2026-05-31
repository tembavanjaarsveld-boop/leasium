import { expect, test } from "@playwright/test";

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
      { property_id: "p2", property_name: "King Street Offices", split_pct: 40 },
    ],
  },
];

test("people hub renders tabs and the owners directory", async ({ page }) => {
  await mockLeasiumApi(page);

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
