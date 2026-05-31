import { expect, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

const OWNER_PORTAL_RESPONSE = {
  auth: {
    mode: "operator_preview",
    token_source: "bearer",
    owner_auth_configured: true,
    boundary: "operator_session",
    detail:
      "Read-only operator preview scoped by entity role; no owner portal account is created.",
  },
  owner: {
    id: "owner-1",
    entity_id: "entity-1",
    display_name: "SKJ Holdings Pty Ltd",
    legal_name: "SKJ Holdings Pty Ltd",
    abn: "11222333444",
    trustee_name: null,
    trust_name: null,
    invoice_issuer_name: null,
    billing_contact_name: "Mia Accounts",
    billing_email: "owners@queenstreet.example",
    invoice_reference: null,
    gst_registered: true,
  },
  properties: [
    {
      property_id: "property-2",
      property_name: "King Street Offices",
      split_pct: 40,
    },
    {
      property_id: "property-1",
      property_name: "Queen Street Retail Centre",
      split_pct: 60,
    },
  ],
  statement: {
    month: "2026-05",
    owner_identity: "SKJ Holdings Pty Ltd",
    property_count: 2,
    properties: [
      {
        property_id: "property-1",
        property_name: "Queen Street Retail Centre",
        invoiced_cents: 880000,
        paid_cents: 0,
        outstanding_cents: 880000,
        invoice_count: 1,
      },
      {
        property_id: "property-2",
        property_name: "King Street Offices",
        invoiced_cents: 880000,
        paid_cents: 0,
        outstanding_cents: 880000,
        invoice_count: 1,
      },
    ],
    invoiced_cents: 1760000,
    paid_cents: 0,
    outstanding_cents: 1760000,
    invoice_count: 2,
  },
  documents: [
    {
      id: "document-owner-visible-1",
      property_id: "property-1",
      property_name: "Queen Street Retail Centre",
      filename: "owner-visible-report.pdf",
      content_type: "application/pdf",
      byte_size: 13,
      category: "other",
      notes: "Quarterly property report",
      source_label: "Shared by property team",
      created_at: "2026-05-31T00:00:00.000Z",
    },
  ],
  guardrails: [
    "Read-only owner portal: opening this page does not send owner email, dispatch invoices, write Xero data, reconcile payments, refresh providers, or mutate provider history.",
    "Shared document downloads are account-scoped and limited to files explicitly shared by the property team for this owner; no owner statement PDFs are generated or sent from the portal.",
  ],
  generated_at: "2026-05-31T00:00:00.000Z",
};

test("owner portal preview renders read-only owner statement data", async ({
  page,
}) => {
  await mockLeasiumApi(page, { operatingMode: "managing_agent" });
  const attemptedSends: string[] = [];

  await page.route("**/api/v1/owners/statements/send**", async (route) => {
    attemptedSends.push(route.request().url());
    await route.fulfill({ status: 500, body: "send must stay unused" });
  });
  await page.route("**/api/v1/owner-portal/owner-1**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(OWNER_PORTAL_RESPONSE),
    });
  });

  await page.goto("/owner-portal/owner-1?month=2026-05");

  await expect(
    page.getByRole("heading", { name: "Owner portal" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("SKJ Holdings Pty Ltd").first()).toBeVisible();
  await expect(page.getByText("Mia Accounts")).toBeVisible();
  await expect(page.getByText("Queen Street Retail Centre").first()).toBeVisible();
  await expect(page.getByText("King Street Offices").first()).toBeVisible();
  await expect(page.getByText("$17,600").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Shared documents" }),
  ).toBeVisible();
  await expect(
    page.getByText("owner-visible-report.pdf", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Quarterly property report")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download owner-visible-report.pdf" }),
  ).toHaveCount(0);
  await expect(page.getByText("Operator preview")).toBeVisible();
  await expect(page.getByText("operator_preview")).toHaveCount(0);
  await expect(page.getByText("operator_upload")).toHaveCount(0);
  await expect(
    page.getByText("Read-only owner portal", { exact: false }),
  ).toBeVisible();
  expect(attemptedSends).toEqual([]);
});

test("self-managed accounts do not open operator owner portal previews", async ({
  page,
}) => {
  await mockLeasiumApi(page);
  const ownerPortalRequests: string[] = [];

  await page.route("**/api/v1/owner-portal/owner-1**", async (route) => {
    ownerPortalRequests.push(route.request().url());
    await route.fulfill({
      status: 500,
      body: "self-managed owner portal preview must stay gated",
    });
  });

  await page.goto("/owner-portal/owner-1?month=2026-05");

  await expect(
    page.getByRole("heading", { name: "Owner portal unavailable" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText("managing-agent or hybrid accounts", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open entity statements" }),
  ).toHaveAttribute("href", "/statements");
  expect(ownerPortalRequests).toEqual([]);
});
