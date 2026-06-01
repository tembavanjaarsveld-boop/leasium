import { readFile } from "node:fs/promises";

import { expect, type Page, test } from "@playwright/test";

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
      source_label: "=HYPERLINK(\"https://unsafe.example\")",
      created_at: "2026-05-31T00:00:00.000Z",
    },
  ],
  maintenance: {
    open_count: 1,
    urgent_count: 1,
    awaiting_approval_count: 1,
    items: [
      {
        id: "work-order-1",
        property_id: "property-1",
        property_name: "Owner Portal Plaza",
        title: "Lift service approval",
        status: "awaiting_approval",
        priority: "urgent",
        requested_at: "2026-05-31T00:00:00.000Z",
        due_date: "2026-06-08",
        completed_at: null,
        approval_required: true,
        approval_status: "pending",
        quote_amount_cents: 220000,
      },
    ],
  },
  guardrails: [
    "Read-only owner portal: opening this page does not send owner email, dispatch invoices, write Xero data, reconcile payments, refresh providers, or mutate provider history.",
    "Shared document downloads are account-scoped and limited to files explicitly shared by the property team for this owner; no owner statement PDFs are generated or sent from the portal.",
  ],
  generated_at: "2026-05-31T00:00:00.000Z",
};

const LONG_OWNER_BILLING_EMAIL =
  "owner.accounts.with.an.extremely.long.mailbox.name@very-long-owner-domain.example";

const OWNER_PORTAL_ACCOUNT_EMPTY_RESPONSE = {
  ...OWNER_PORTAL_ACCOUNT_RESPONSE,
  owner: {
    ...OWNER_PORTAL_ACCOUNT_RESPONSE.owner,
    billing_email: LONG_OWNER_BILLING_EMAIL,
  },
  properties: [],
  statement: null,
  documents: [],
  maintenance: {
    open_count: 0,
    urgent_count: 0,
    awaiting_approval_count: 0,
    items: [],
  },
};

async function navigateWithAppRouter(page: Page, href: string) {
  await page.evaluate((targetHref) => {
    const router = (
      window as typeof window & {
        next?: { router?: { push: (href: string) => void } };
      }
    ).next?.router;
    if (!router) {
      throw new Error("Next router unavailable.");
    }
    router.push(targetHref);
  }, href);
}

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
  const unsafeRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const mutatesOwnerPortal =
      path.startsWith("/api/v1/owner-portal/") &&
      ["DELETE", "PATCH", "POST"].includes(method);
    const callsExternalOrDispatchPath =
      path.startsWith("/api/v1/owners/statements/send") ||
      path.startsWith("/api/v1/owners/statements/dispatch") ||
      path.startsWith("/api/v1/owners/statements/pdf") ||
      path.startsWith("/api/v1/comms") ||
      path.startsWith("/api/v1/xero") ||
      path.startsWith("/api/v1/basiq") ||
      path.startsWith("/api/v1/payments") ||
      path.startsWith("/api/v1/reconciliation");
    if (mutatesOwnerPortal || callsExternalOrDispatchPath) {
      unsafeRequests.push(`${method} ${path}`);
    }
  });

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
  await expect(
    page.getByRole("heading", { name: "Maintenance snapshot" }),
  ).toBeVisible();
  await expect(page.getByText("Lift service approval")).toBeVisible();
  await expect(page.getByText("$2,200 quote")).toBeVisible();
  await expect(page.getByText("contractor@example.test")).toHaveCount(0);
  await expect(page.getByText("twilio-secret")).toHaveCount(0);
  await expect(page.getByText("operator_upload")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Owner-visible packet" }),
  ).toBeVisible();
  await expect(
    page.getByText("Review-only export", { exact: false }),
  ).toBeVisible();

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy packet" }).click();
  await expect(page.getByText("Owner-visible packet copied.")).toBeVisible();
  const copiedPacket = await page.evaluate(() => navigator.clipboard.readText());
  expect(copiedPacket).toContain("Owner Portal Pty Ltd");
  expect(copiedPacket).toContain("Owner Portal Plaza");
  expect(copiedPacket).toContain("100%");
  expect(copiedPacket).toContain("$5,500");
  expect(copiedPacket).toContain("owner-visible-report.pdf");
  expect(copiedPacket).toContain("Lift service approval");
  expect(copiedPacket).toContain("$2,200");
  expect(copiedPacket).toContain("Review-only export");
  expect(copiedPacket).toContain("does not send owner email");
  expect(copiedPacket).toContain("download not triggered by packet export");
  expect(copiedPacket).toContain("'=HYPERLINK");

  const packetDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download packet CSV" }).click();
  const packetDownload = await packetDownloadPromise;
  expect(packetDownload.suggestedFilename()).toBe(
    "owner-visible-review-packet-2026-05-owner-1.csv",
  );
  const packetDownloadPath = await packetDownload.path();
  const packetCsv = await readFile(packetDownloadPath!, "utf8");
  expect(packetCsv).toContain("Owner Portal Pty Ltd");
  expect(packetCsv).toContain("Owner Portal Plaza");
  expect(packetCsv).toContain("owner-visible-report.pdf");
  expect(packetCsv).toContain("Lift service approval");
  expect(packetCsv).toContain("$2,200");
  expect(packetCsv).toContain("does not send owner email");
  expect(packetCsv).toContain("'=HYPERLINK");
  expect(downloads).toHaveLength(0);
  expect(unsafeRequests).toEqual([]);

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
  expect(unsafeRequests).toEqual([]);
  await expect(page.getByText("operator_preview")).toHaveCount(0);
});

test("owner account entry clears owner data after account session failure", async ({
  page,
}) => {
  let failSessionReads = false;

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
    if (failSessionReads) {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Owner account session expired." }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(OWNER_PORTAL_ACCOUNT_RESPONSE),
    });
  });

  await page.goto("/owner-portal?month=2026-05");

  await expect(
    page.getByRole("heading", { name: "Owner portal" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Owner Portal Pty Ltd").first()).toBeVisible();
  await expect(page.getByText("Owner Portal Plaza").first()).toBeVisible();
  await expect(page.getByText("$5,500").first()).toBeVisible();
  await expect(
    page.getByText("owner-visible-report.pdf", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Lift service approval")).toBeVisible();
  await expect(page.getByText("$2,200 quote")).toBeVisible();

  failSessionReads = true;

  await navigateWithAppRouter(page, "/owner-portal?month=2026-06");
  await expect(page).toHaveURL(/month=2026-06/);
  await expect(
    page.getByRole("heading", { name: "Owner portal unavailable" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Owner Portal Pty Ltd")).toHaveCount(0);
  await expect(page.getByText("Owner Portal Plaza")).toHaveCount(0);
  await expect(page.getByText("$5,500")).toHaveCount(0);
  await expect(
    page.getByText("owner-visible-report.pdf", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Lift service approval")).toHaveCount(0);
  await expect(page.getByText("$2,200 quote")).toHaveCount(0);

  await navigateWithAppRouter(page, "/owner-portal?month=2026-05");
  await expect(page).toHaveURL(/month=2026-05/);

  await expect(
    page.getByRole("heading", { name: "Owner portal unavailable" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Owner Portal Pty Ltd")).toHaveCount(0);
  await expect(page.getByText("Owner Portal Plaza")).toHaveCount(0);
  await expect(page.getByText("$5,500")).toHaveCount(0);
  await expect(
    page.getByText("owner-visible-report.pdf", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Lift service approval")).toHaveCount(0);
  await expect(page.getByText("$2,200 quote")).toHaveCount(0);
});

test("owner account entry renders mobile empty states without overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const unsafeRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (
      (path.startsWith("/api/v1/owner-portal/") &&
        ["DELETE", "PATCH", "POST"].includes(method)) ||
      path.startsWith("/api/v1/owners/statements/send") ||
      path.startsWith("/api/v1/owners/statements/dispatch") ||
      path.startsWith("/api/v1/owners/statements/pdf") ||
      path.startsWith("/api/v1/comms") ||
      path.startsWith("/api/v1/xero") ||
      path.startsWith("/api/v1/basiq") ||
      path.startsWith("/api/v1/payments") ||
      path.startsWith("/api/v1/reconciliation") ||
      (path.startsWith("/api/v1/owner-portal/account/documents/") &&
        path.endsWith("/download"))
    ) {
      unsafeRequests.push(`${method} ${path}`);
    }
  });

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
      body: JSON.stringify(OWNER_PORTAL_ACCOUNT_EMPTY_RESPONSE),
    });
  });

  await page.goto("/owner-portal?month=2026-05");

  await expect(
    page.getByRole("heading", { name: "Owner portal" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Owner account", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Owner-visible packet" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy packet" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download packet CSV" }),
  ).toBeVisible();
  await expect(page.getByText("0 linked")).toBeVisible();
  await expect(page.getByText("$0 outstanding")).toBeVisible();
  await expect(page.getByText("0 open").first()).toBeVisible();
  await expect(page.getByText("No statement available.")).toBeVisible();
  await expect(page.getByText("No open maintenance.")).toBeVisible();
  await expect(page.getByText("No shared documents.")).toBeVisible();
  await expect(page.getByText("No linked properties.")).toBeVisible();
  await expect(page.getByText("May 2026").first()).toBeVisible();
  await expect(
    page.getByText("Read-only owner portal", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText(LONG_OWNER_BILLING_EMAIL, { exact: true }),
  ).toBeVisible();
  expect(
    await page
      .getByText(LONG_OWNER_BILLING_EMAIL, { exact: true })
      .evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= window.innerWidth;
      }),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(unsafeRequests).toEqual([]);
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
