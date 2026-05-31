import { expect, test } from "@playwright/test";

const OWNER_INVITE_PREVIEW = {
  owner_display_name: "Owner Portal Pty Ltd",
  claim_email: "owner@example.test",
  expires_at: "2026-06-30T00:00:00.000Z",
  claimable: true,
};

const OWNER_PORTAL_ACCOUNT_RESPONSE = {
  auth: {
    mode: "owner_portal_account",
    token_source: "bearer",
    owner_auth_configured: true,
    boundary: "owner_portal_account",
    detail: "Access is scoped to the owner linked to this owner portal account.",
  },
  owner: {
    id: "owner-1",
    entity_id: "entity-1",
    display_name: "Owner Portal Pty Ltd",
    legal_name: "Owner Portal Pty Ltd",
    abn: "11222333444",
    trustee_name: null,
    trust_name: null,
    invoice_issuer_name: null,
    billing_contact_name: "Owner Accounts",
    billing_email: "owner@example.test",
    invoice_reference: null,
    gst_registered: true,
  },
  properties: [
    {
      property_id: "property-1",
      property_name: "Owner Portal Plaza",
      split_pct: 100,
    },
  ],
  statement: {
    month: "2026-05",
    owner_identity: "Owner Portal Pty Ltd",
    property_count: 1,
    properties: [
      {
        property_id: "property-1",
        property_name: "Owner Portal Plaza",
        invoiced_cents: 550000,
        paid_cents: 0,
        outstanding_cents: 550000,
        invoice_count: 1,
      },
    ],
    invoiced_cents: 550000,
    paid_cents: 0,
    outstanding_cents: 550000,
    invoice_count: 1,
  },
  documents: [
    {
      id: "document-owner-visible-1",
      property_id: "property-1",
      property_name: "Owner Portal Plaza",
      filename: "owner-visible-report.pdf",
      content_type: "application/pdf",
      byte_size: 13,
      category: "other",
      notes: "Quarterly property report",
      source_label: "Shared by property team",
      created_at: "2026-05-31T00:00:00.000Z",
    },
    {
      id: "document-owner-visible-2",
      property_id: "property-2",
      property_name: "Annex Offices",
      filename: "owner-visible-report.pdf",
      content_type: "application/pdf",
      byte_size: 17,
      category: "other",
      notes: null,
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

test("owner claim link shows only safe context before account claim", async ({
  page,
}) => {
  const blockedReads: string[] = [];

  await page.route(
    "**/api/v1/owner-portal/invites/owner-token-one/preview",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(OWNER_INVITE_PREVIEW),
      });
    },
  );
  await page.route("**/api/v1/owner-portal/account/session**", async (route) => {
    blockedReads.push(route.request().url());
    await route.fulfill({ status: 500, body: "account read must stay gated" });
  });
  await page.route("**/api/v1/owner-portal/owner-1**", async (route) => {
    blockedReads.push(route.request().url());
    await route.fulfill({
      status: 500,
      body: "operator preview must stay unused",
    });
  });

  await page.goto("/owner-portal/invite/owner-token-one");

  await expect(
    page.getByRole("heading", { name: "Owner Account Setup" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Owner Portal Pty Ltd").first()).toBeVisible();
  await expect(page.getByText("owner@example.test")).toBeVisible();
  await expect(page.getByText("Invite expires")).toBeVisible();
  await expect(page.getByRole("link", { name: "Create login" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(page.getByText("Owner Portal Plaza")).toHaveCount(0);
  await expect(page.getByText("$5,500")).toHaveCount(0);
  expect(blockedReads).toEqual([]);
});

test("owner account entry opens a linked owner portal without owner id", async ({
  page,
}) => {
  await page.route("**/api/v1/owner-portal/account/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "active",
        owner_id: "owner-1",
        owner_name: "Owner Portal Pty Ltd",
        email: "owner@example.test",
        linked_at: "2026-05-31T00:00:00.000Z",
        last_seen_at: "2026-05-31T00:00:00.000Z",
        revoked_at: null,
        recovery_hint:
          "This owner login can open the owner portal without the original claim link.",
      }),
    });
  });
  await page.route("**/api/v1/owner-portal/account/session**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(OWNER_PORTAL_ACCOUNT_RESPONSE),
    });
  });
  const downloads: string[] = [];
  await page.route(
    "**/api/v1/owner-portal/account/documents/*/download",
    async (route) => {
      const authHeader = route.request().headers().authorization;
      if (!authHeader && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
        throw new Error("Owner document download must send a bearer token.");
      }
      downloads.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: "application/pdf",
        headers: {
          "Content-Disposition":
            "attachment; filename*=UTF-8''owner-visible-report.pdf",
        },
        body: "owner visible",
      });
    },
  );

  await page.goto("/owner-portal?month=2026-05");

  await expect(
    page.getByRole("heading", { name: "Owner portal" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Owner account", { exact: true })).toBeVisible();
  await expect(page.getByText("owner_portal_account")).toHaveCount(0);
  await expect(page.getByText("Owner Portal Plaza").first()).toBeVisible();
  await expect(page.getByText("$5,500").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Shared documents" }),
  ).toBeVisible();
  await expect(
    page.getByText("owner-visible-report.pdf", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Quarterly property report")).toBeVisible();
  await expect(page.getByText("operator_upload")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Download owner-visible-report.pdf for Owner Portal Plaza",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Download owner-visible-report.pdf for Annex Offices",
    }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: "Download owner-visible-report.pdf for Owner Portal Plaza",
    })
    .click();
  expect((await download).suggestedFilename()).toBe(
    "owner-visible-report.pdf",
  );
  expect(downloads).toHaveLength(1);
  await expect(page.getByText("operator_preview")).toHaveCount(0);
});

test("owner account entry guides unlinked or revoked logins without data", async ({
  page,
}) => {
  await page.route("**/api/v1/owner-portal/account/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "unlinked",
        owner_id: null,
        owner_name: null,
        email: null,
        linked_at: null,
        last_seen_at: null,
        revoked_at: null,
        recovery_hint:
          "Open your owner portal claim link once to connect this login.",
      }),
    });
  });
  await page.route("**/api/v1/owner-portal/account/session**", async (route) => {
    await route.fulfill({
      status: 500,
      body: "unlinked account must not fetch financial data",
    });
  });

  await page.goto("/owner-portal");

  await expect(
    page.getByRole("heading", { name: "Open your owner portal" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("No owner account linked")).toBeVisible();
  await expect(
    page.getByText("Open your owner portal claim link once"),
  ).toBeVisible();
  await expect(page.getByText("Owner Portal Plaza")).toHaveCount(0);
  await expect(page.getByText("$5,500")).toHaveCount(0);
});
