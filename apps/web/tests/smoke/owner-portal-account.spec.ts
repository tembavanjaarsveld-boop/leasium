import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

const appRoot = path.resolve(__dirname, "../..");

async function source(relativePath: string) {
  return readFile(path.join(appRoot, relativePath), "utf8");
}

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
  lease_events: {
    upcoming_count: 2,
    rent_review_count: 1,
    expiry_count: 1,
    events: [
      {
        lease_id: "lease-owner-visible-1",
        property_id: "property-1",
        property_name: "Owner Portal Plaza",
        unit_label: "Suite 8",
        event_kind: "rent_review",
        event_date: "2026-06-15",
        lease_status: "active",
        annual_rent_cents: 3600000,
      },
      {
        lease_id: "lease-owner-visible-1",
        property_id: "property-1",
        property_name: "Owner Portal Plaza",
        unit_label: "Suite 8",
        event_kind: "lease_expiry",
        event_date: "2026-07-31",
        lease_status: "active",
        annual_rent_cents: 3600000,
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
const OWNER_AUTH_SMOKE_TOKEN =
  process.env.NEXT_PUBLIC_LEASIUM_OWNER_PORTAL_AUTH_SMOKE_TOKEN;
const OWNER_AUTH_SMOKE_ENABLED = Boolean(
  OWNER_AUTH_SMOKE_TOKEN && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);
const OWNER_PORTAL_LIVE_ENABLED =
  process.env.LEASIUM_SMOKE_OWNER_PORTAL_ACCOUNT_LIVE === "1" ||
  process.env.LEASIUM_SMOKE_OWNER_PORTAL_LIVE === "1";
const OWNER_PORTAL_LIVE_OWNER_STORAGE =
  process.env.LEASIUM_SMOKE_OWNER_PORTAL_STORAGE ??
  process.env.LEASIUM_SMOKE_OWNER_PORTAL_OWNER_STORAGE;
const OWNER_PORTAL_LIVE_OWNER_STORAGE_EXISTS =
  Boolean(OWNER_PORTAL_LIVE_OWNER_STORAGE) &&
  existsSync(OWNER_PORTAL_LIVE_OWNER_STORAGE!);
const OWNER_PORTAL_LIVE_BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "";
const OWNER_PORTAL_LIVE_BASE_URL_IS_HTTPS =
  OWNER_PORTAL_LIVE_BASE_URL.startsWith("https://");
const OWNER_PORTAL_LIVE_MONTH =
  process.env.LEASIUM_SMOKE_OWNER_PORTAL_MONTH ?? "2026-05";
const OWNER_PORTAL_LIVE_EXPECT_OWNER =
  process.env.LEASIUM_SMOKE_OWNER_PORTAL_EXPECT_OWNER_NAME ??
  process.env.LEASIUM_SMOKE_OWNER_PORTAL_EXPECT_OWNER;
const OWNER_PORTAL_LIVE_EXPECT_DOCUMENT =
  process.env.LEASIUM_SMOKE_OWNER_PORTAL_EXPECT_DOCUMENT;
const OWNER_PORTAL_CLAIM_LIVE_ENABLED =
  process.env.LEASIUM_SMOKE_OWNER_PORTAL_CLAIM_LIVE === "1";
const OWNER_PORTAL_CLAIM_TOKEN =
  process.env.LEASIUM_SMOKE_OWNER_PORTAL_CLAIM_TOKEN;
const EMPTY_STORAGE_STATE = { cookies: [], origins: [] };

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
  lease_events: {
    upcoming_count: 0,
    rent_review_count: 0,
    expiry_count: 0,
    events: [],
  },
};

test("owner account claim and document actions use fresh bearer tokens", async () => {
  const invitePage = await source("src/app/owner-portal/invite/[token]/page.tsx");
  const accountPage = await source("src/app/owner-portal/page.tsx");
  const accountUi = await source(
    "src/app/owner-portal/owner-portal-account-ui.tsx",
  );
  const dashboardSections = await source(
    "src/app/owner-portal/owner-portal-dashboard-sections.tsx",
  );

  expect(invitePage).toContain("getToken({ skipCache: true })");
  expect(invitePage).toContain("claimOwnerPortalAccount(token, authToken)");
  expect(invitePage).toContain("OwnerPortalInviteContentWithAuth");
  expect(invitePage).toContain("requiresAuthToken={auth.requiresAuthToken}");
  expect(accountPage).toContain(
    "getAuthToken: () => getToken({ skipCache: true })",
  );
  expect(accountPage).toContain("requiresAuthToken={auth.requiresAuthToken}");
  expect(accountUi).toContain("getAuthToken={getAuthToken}");
  expect(accountUi).toContain("requiresAuthToken={requiresAuthToken}");
  expect(dashboardSections).toContain(
    "getAuthToken?: () => Promise<string | null>",
  );
  expect(dashboardSections).toContain("requiresAuthToken?: boolean");
  expect(dashboardSections).toContain(
    'throw new Error("Sign in before downloading owner documents.")',
  );
  expect(dashboardSections).toContain(
    "const authToken = getAuthToken ? await getAuthToken() : null",
  );
  expect(dashboardSections).toContain("downloadOwnerPortalAccountDocument(");
  expect(dashboardSections).toContain("document.id,");
  expect(dashboardSections).toContain("authToken,");
});

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

async function installOwnerClerkSmoke(page: Page) {
  if (!OWNER_AUTH_SMOKE_TOKEN) {
    throw new Error("Owner auth smoke token is required.");
  }
  const clerkScript =
    "window.Clerk = window.Clerk || window.__LEASIUM_OWNER_CLERK_SMOKE__;";
  await page.route(
    "**/npm/@clerk/clerk-js@*/dist/clerk.browser.js",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: clerkScript,
      });
    },
  );
  await page.route("**/npm/@clerk/ui@*/dist/ui.browser.js", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "window.__internal_ClerkUICtor = function ClerkUI() {};",
    });
  });
  await page.addInitScript((token) => {
    type ClerkSmokeWindow = typeof window & {
      Clerk?: unknown;
      __internal_ClerkUICtor?: unknown;
      __LEASIUM_OWNER_CLERK_SMOKE__?: unknown;
      __LEASIUM_OWNER_CLERK_TOKEN_OPTIONS?: unknown[];
    };
    const smokeWindow = window as ClerkSmokeWindow;
    const tokenOptions: unknown[] = [];
    const session = {
      id: "owner-smoke-session",
      status: "active",
      factorVerificationAge: null,
      lastActiveToken: {
        jwt: {
          claims: {
            sid: "owner-smoke-session",
            sub: "owner-smoke-user",
          },
        },
      },
      getToken: async (options?: unknown) => {
        tokenOptions.push(options ?? null);
        return token;
      },
    };
    const user = {
      id: "owner-smoke-user",
      organizationMemberships: [],
    };
    const client = {
      id: "owner-smoke-client",
      sessions: [session],
      signIn: null,
      signUp: null,
    };
    const resources = {
      client,
      organization: null,
      session,
      user,
    };
    const statusListeners = new Set<(status: string) => void>();
    const resourceListeners = new Set<(state: typeof resources) => void>();
    const clerk = {
      loaded: true,
      status: "ready",
      isSignedIn: true,
      client,
      organization: null,
      session,
      user,
      __internal_lastEmittedResources: resources,
      __internal_updateProps: async () => undefined,
      addListener: (
        listener: (state: typeof resources) => void,
        options?: { skipInitialEmit?: boolean },
      ) => {
        resourceListeners.add(listener);
        if (!options?.skipInitialEmit) {
          listener(resources);
        }
        return () => resourceListeners.delete(listener);
      },
      buildSignInUrl: () => "/sign-in",
      buildSignUpUrl: () => "/sign-up",
      load: async () => clerk,
      off: (event: string, listener: (status: string) => void) => {
        if (event === "status") {
          statusListeners.delete(listener);
        }
      },
      on: (
        event: string,
        listener: (status: string) => void,
        options?: { notify?: boolean },
      ) => {
        if (event === "status") {
          statusListeners.add(listener);
          if (options?.notify) {
            listener("ready");
          }
        }
      },
      signOut: async () => undefined,
      telemetry: {
        record: () => undefined,
      },
    };
    smokeWindow.__LEASIUM_OWNER_CLERK_TOKEN_OPTIONS = tokenOptions;
    smokeWindow.__LEASIUM_OWNER_CLERK_SMOKE__ = clerk;
    smokeWindow.__internal_ClerkUICtor = function ClerkUI() {};
    smokeWindow.Clerk = clerk;
  }, OWNER_AUTH_SMOKE_TOKEN);
}

async function ownerClerkTokenOptions(page: Page) {
  return page.evaluate(() => {
    const smokeWindow = window as typeof window & {
      __LEASIUM_OWNER_CLERK_TOKEN_OPTIONS?: unknown[];
    };
    return smokeWindow.__LEASIUM_OWNER_CLERK_TOKEN_OPTIONS ?? [];
  });
}

function skipCacheCallCount(tokenOptions: unknown[]) {
  return tokenOptions.filter(
    (option) =>
      typeof option === "object" &&
      option !== null &&
      (option as { skipCache?: unknown }).skipCache === true,
  ).length;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactLiveSmokePath(pathname: string) {
  return pathname
    .replace(
      /\/api\/v1\/owner-portal\/invites\/[^/]+/g,
      "/api/v1/owner-portal/invites/<token>",
    )
    .replace(
      /\/api\/v1\/owner-portal\/account\/documents\/[^/]+/g,
      "/api/v1/owner-portal/account/documents/<document>",
    );
}

test.describe("live Clerk owner portal account", () => {
  test.skip(
    !OWNER_PORTAL_LIVE_ENABLED ||
      !OWNER_PORTAL_LIVE_BASE_URL_IS_HTTPS ||
      !OWNER_PORTAL_LIVE_OWNER_STORAGE_EXISTS,
    "Runs only with an explicit HTTPS live owner Clerk storage state.",
  );

  test.use({
    storageState: OWNER_PORTAL_LIVE_OWNER_STORAGE_EXISTS
      ? OWNER_PORTAL_LIVE_OWNER_STORAGE
      : EMPTY_STORAGE_STATE,
  });

  test("live Clerk owner account opens read-only owner portal without mutations", async ({
    page,
  }) => {
    const unsafeRequests: string[] = [];
    const ownerAccountRequests: string[] = [];
    const ownerAccountAuthorizationSchemes: string[] = [];
    await page.route("**/api/v1/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const method = request.method();
      const isOwnerAccountReadPath =
        path === "/api/v1/owner-portal/account/status" ||
        path === "/api/v1/owner-portal/account/session";
      const isDocumentDownloadPath =
        Boolean(OWNER_PORTAL_LIVE_EXPECT_DOCUMENT) &&
        path.startsWith("/api/v1/owner-portal/account/documents/") &&
        path.endsWith("/download");
      const isOwnerAccountRead =
        method === "GET" && isOwnerAccountReadPath;
      const isAllowedDocumentDownload =
        method === "GET" && isDocumentDownloadPath;
      const isAllowedPreflight =
        method === "OPTIONS" &&
        (isOwnerAccountReadPath || isDocumentDownloadPath);
      if (isOwnerAccountRead || isAllowedDocumentDownload) {
        ownerAccountRequests.push(`${method} ${redactLiveSmokePath(path)}`);
        const authorization = request.headers().authorization;
        if (authorization) {
          ownerAccountAuthorizationSchemes.push(
            authorization.startsWith("Bearer ") ? "Bearer" : "not-bearer",
          );
        }
      }

      const isAllowedLiveReadApiRequest =
        isOwnerAccountRead || isAllowedDocumentDownload || isAllowedPreflight;
      if (!isAllowedLiveReadApiRequest) {
        unsafeRequests.push(`${method} ${redactLiveSmokePath(path)}`);
        await route.abort();
        return;
      }

      await route.continue();
    });

    await page.goto(
      `/owner-portal?month=${encodeURIComponent(OWNER_PORTAL_LIVE_MONTH)}`,
    );
    expect(page.url()).not.toContain("/sign-in");
    expect(page.url()).not.toContain("/sign-up");
    expect(page.url()).not.toContain("/welcome");
    expect(page.url()).not.toContain("/access");

    await expect(
      page.getByRole("heading", { name: "Owner portal" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Owner account", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Owner-visible packet" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy packet" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Download packet CSV" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Access boundary" }),
    ).toBeVisible();
    await expect(page.getByText("Read-only owner portal")).toBeVisible();
    await expect(page.getByText("No owner account linked")).toHaveCount(0);
    await expect(page.getByText("Owner portal unavailable")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Create login" })).toHaveCount(
      0,
    );
    await expect(page.getByText("owner_portal_account")).toHaveCount(0);
    await expect(page.getByText("operator_preview")).toHaveCount(0);
    await expect(page.getByText("operator_upload")).toHaveCount(0);
    await expect(page.getByText("twilio-secret")).toHaveCount(0);
    await expect(page.getByText("sendgrid-secret")).toHaveCount(0);
    if (OWNER_PORTAL_LIVE_EXPECT_OWNER) {
      await expect(
        page.getByText(OWNER_PORTAL_LIVE_EXPECT_OWNER).first(),
      ).toBeVisible();
    }

    expect(ownerAccountRequests).toContain(
      "GET /api/v1/owner-portal/account/status",
    );
    expect(ownerAccountRequests).toContain(
      "GET /api/v1/owner-portal/account/session",
    );
    expect(ownerAccountAuthorizationSchemes.length).toBeGreaterThanOrEqual(2);
    expect(
      ownerAccountAuthorizationSchemes.every((scheme) => scheme === "Bearer"),
    ).toBe(true);

    const packetDownloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download packet CSV" }).click();
    await packetDownloadPromise;

    if (OWNER_PORTAL_LIVE_EXPECT_DOCUMENT) {
      const documentDownloadPromise = page.waitForEvent("download");
      await page
        .getByRole("button", {
          name: new RegExp(
            `^Download ${escapeRegExp(OWNER_PORTAL_LIVE_EXPECT_DOCUMENT)} for `,
          ),
        })
        .first()
        .click();
      expect((await documentDownloadPromise).suggestedFilename()).toBe(
        OWNER_PORTAL_LIVE_EXPECT_DOCUMENT,
      );
    }

    expect(unsafeRequests).toEqual([]);
  });
});

test.describe("live Clerk owner portal claim", () => {
  test.skip(
    !OWNER_PORTAL_CLAIM_LIVE_ENABLED ||
      !OWNER_PORTAL_LIVE_BASE_URL_IS_HTTPS ||
      !OWNER_PORTAL_LIVE_OWNER_STORAGE_EXISTS ||
      !OWNER_PORTAL_CLAIM_TOKEN,
    "Runs only with explicit approval, HTTPS, owner Clerk storage state, and a disposable claim token.",
  );

  test.use({
    storageState: OWNER_PORTAL_LIVE_OWNER_STORAGE_EXISTS
      ? OWNER_PORTAL_LIVE_OWNER_STORAGE
      : EMPTY_STORAGE_STATE,
  });

  test("live Clerk owner invite claim consumes disposable claim token", async ({
    page,
  }) => {
    const unsafeRequests: string[] = [];
    let previewRequestCount = 0;
    let claimAuthorizationCount = 0;
    const claimAuthorizationSchemes: string[] = [];
    await page.route("**/api/v1/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const method = request.method();
      const isInvitePreviewPath =
        path.startsWith("/api/v1/owner-portal/invites/") &&
        path.endsWith("/preview");
      const isInvitePreview = method === "GET" && isInvitePreviewPath;
      const isClaim =
        method === "POST" && path === "/api/v1/owner-portal/account/claim";
      const isAllowedPreflight =
        method === "OPTIONS" &&
        (isInvitePreviewPath ||
          path === "/api/v1/owner-portal/account/claim");

      if (isInvitePreview) {
        previewRequestCount += 1;
      }
      if (isClaim) {
        const authorization = request.headers().authorization;
        if (authorization) {
          claimAuthorizationCount += 1;
          claimAuthorizationSchemes.push(
            authorization.startsWith("Bearer ") ? "Bearer" : "not-bearer",
          );
        }
      }

      const isAllowedClaimApiRequest =
        isInvitePreview || isClaim || isAllowedPreflight;
      if (!isAllowedClaimApiRequest) {
        unsafeRequests.push(`${method} ${redactLiveSmokePath(path)}`);
        await route.abort();
        return;
      }

      await route.continue();
    });

    await page.goto(
      `/owner-portal/invite/${encodeURIComponent(OWNER_PORTAL_CLAIM_TOKEN ?? "")}`,
    );

    await expect(
      page.getByRole("heading", { name: "Owner Account Setup" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText("Statement and property data stays hidden"),
    ).toBeVisible();
    await expect(page.getByText("Owner-visible packet")).toHaveCount(0);
    await expect(page.getByText("Read-only owner portal")).toHaveCount(0);

    await page.getByRole("button", { name: "Open portal" }).click();

    await expect(
      page.getByRole("heading", { name: "Owner portal" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Owner account", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Owner-visible packet" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Access boundary" }),
    ).toBeVisible();
    await expect(page.getByText("Read-only owner portal")).toBeVisible();
    if (OWNER_PORTAL_LIVE_EXPECT_OWNER) {
      await expect(
        page.getByText(OWNER_PORTAL_LIVE_EXPECT_OWNER).first(),
      ).toBeVisible();
    }

    expect(previewRequestCount).toBeGreaterThanOrEqual(1);
    expect(claimAuthorizationCount).toBe(1);
    expect(claimAuthorizationSchemes).toEqual(["Bearer"]);
    expect(unsafeRequests).toEqual([]);
  });
});

test("owner invite claim sends fresh owner bearer token when auth is enabled", async ({
  page,
}) => {
  test.skip(
    !OWNER_AUTH_SMOKE_ENABLED,
    "Runs only with Clerk enabled and the owner auth smoke token set.",
  );
  await installOwnerClerkSmoke(page);
  const blockedReads: string[] = [];
  const unsafeRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (
      (path.startsWith("/api/v1/owner-portal/") &&
        ["DELETE", "PATCH", "POST"].includes(method) &&
        path !== "/api/v1/owner-portal/account/claim") ||
      path.startsWith("/api/v1/owners/statements/send") ||
      path.startsWith("/api/v1/owners/statements/dispatch") ||
      path.startsWith("/api/v1/owners/statements/pdf") ||
      path.startsWith("/api/v1/comms") ||
      path.startsWith("/api/v1/xero") ||
      path.startsWith("/api/v1/basiq") ||
      path.startsWith("/api/v1/payments") ||
      path.startsWith("/api/v1/reconciliation")
    ) {
      unsafeRequests.push(`${method} ${path}`);
    }
  });

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

  let claimAuthorization: string | undefined;
  let claimBody: unknown;
  await page.route("**/api/v1/owner-portal/account/claim", async (route) => {
    claimAuthorization = route.request().headers().authorization;
    claimBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(OWNER_PORTAL_ACCOUNT_RESPONSE),
    });
  });

  await page.goto("/owner-portal/invite/owner-token-one");

  await expect(
    page.getByRole("heading", { name: "Owner Account Setup" }),
  ).toBeVisible({ timeout: 15_000 });
  expect(blockedReads).toEqual([]);
  await page.getByRole("button", { name: "Open portal" }).click();
  await expect(
    page.getByRole("heading", { name: "Owner portal" }),
  ).toBeVisible({ timeout: 15_000 });
  expect(claimAuthorization).toBe(`Bearer ${OWNER_AUTH_SMOKE_TOKEN}`);
  expect(claimBody).toEqual({ portal_token: "owner-token-one" });
  expect(skipCacheCallCount(await ownerClerkTokenOptions(page))).toBeGreaterThan(
    0,
  );
  expect(blockedReads).toEqual([]);
  expect(unsafeRequests).toEqual([]);
});

test("owner document download sends fresh owner bearer token when auth is enabled", async ({
  page,
}) => {
  test.skip(
    !OWNER_AUTH_SMOKE_ENABLED,
    "Runs only with Clerk enabled and the owner auth smoke token set.",
  );
  await installOwnerClerkSmoke(page);
  const unsafeRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const allowedOwnerAccountRead =
      method === "GET" &&
      (path === "/api/v1/owner-portal/account/status" ||
        path === "/api/v1/owner-portal/account/session" ||
        (path.startsWith("/api/v1/owner-portal/account/documents/") &&
          path.endsWith("/download")));
    if (
      (path.startsWith("/api/v1/owner-portal/") &&
        !allowedOwnerAccountRead) ||
      path.startsWith("/api/v1/owners/statements/send") ||
      path.startsWith("/api/v1/owners/statements/dispatch") ||
      path.startsWith("/api/v1/owners/statements/pdf") ||
      path.startsWith("/api/v1/comms") ||
      path.startsWith("/api/v1/xero") ||
      path.startsWith("/api/v1/basiq") ||
      path.startsWith("/api/v1/payments") ||
      path.startsWith("/api/v1/reconciliation")
    ) {
      unsafeRequests.push(`${method} ${path}`);
    }
  });

  const accountReadAuthorizations: Array<string | undefined> = [];
  await page.route("**/api/v1/owner-portal/account/status", async (route) => {
    accountReadAuthorizations.push(route.request().headers().authorization);
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
    accountReadAuthorizations.push(route.request().headers().authorization);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(OWNER_PORTAL_ACCOUNT_RESPONSE),
    });
  });

  const downloadAuthorizations: Array<string | undefined> = [];
  await page.route(
    "**/api/v1/owner-portal/account/documents/*/download",
    async (route) => {
      downloadAuthorizations.push(route.request().headers().authorization);
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
  expect(accountReadAuthorizations).toEqual([
    `Bearer ${OWNER_AUTH_SMOKE_TOKEN}`,
    `Bearer ${OWNER_AUTH_SMOKE_TOKEN}`,
  ]);

  const packetDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download packet CSV" }).click();
  await packetDownloadPromise;
  expect(downloadAuthorizations).toEqual([]);

  const documentDownloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: "Download owner-visible-report.pdf for Owner Portal Plaza",
    })
    .click();
  expect((await documentDownloadPromise).suggestedFilename()).toBe(
    "owner-visible-report.pdf",
  );
  expect(downloadAuthorizations).toEqual([
    `Bearer ${OWNER_AUTH_SMOKE_TOKEN}`,
  ]);
  expect(skipCacheCallCount(await ownerClerkTokenOptions(page))).toBeGreaterThan(
    2,
  );
  expect(unsafeRequests).toEqual([]);
});

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
  await expect(
    page.getByRole("heading", { name: "Lease events" }),
  ).toBeVisible();
  await expect(page.getByText("Rent review").first()).toBeVisible();
  await expect(page.getByText("Lease expiry").first()).toBeVisible();
  await expect(page.getByText("Suite 8").first()).toBeVisible();
  await expect(page.getByText("$36,000 annual rent").first()).toBeVisible();
  await expect(page.getByText("contractor@example.test")).toHaveCount(0);
  await expect(page.getByText("twilio-secret")).toHaveCount(0);
  await expect(page.getByText("Private Lease Tenant Pty Ltd")).toHaveCount(0);
  await expect(page.getByText("tenant_id")).toHaveCount(0);
  await expect(page.getByText("Private lease note")).toHaveCount(0);
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
  expect(copiedPacket).toContain("Lease events");
  expect(copiedPacket).toContain("Rent review");
  expect(copiedPacket).toContain("Lease expiry");
  expect(copiedPacket).toContain("Suite 8");
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
  expect(packetCsv).toContain("Lease events");
  expect(packetCsv).toContain("Rent review");
  expect(packetCsv).toContain("Lease expiry");
  expect(packetCsv).toContain("Suite 8");
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
  await expect(page.getByText("Rent review", { exact: true })).toBeVisible();
  await expect(page.getByText("Lease expiry", { exact: true })).toBeVisible();

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
  await expect(page.getByText("Rent review", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Lease expiry", { exact: true })).toHaveCount(0);

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
  await expect(page.getByText("Rent review", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Lease expiry", { exact: true })).toHaveCount(0);
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
  await expect(page.getByText("No upcoming lease events.")).toBeVisible();
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

test("owner account entry keeps populated shared documents inside mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const longFilename =
    "owner-visible-settlement-reconciliation-and-capex-approval-evidence-with-a-very-long-file-name-2026-05.pdf";
  const longPropertyName =
    "OwnerPortalPropertyWithAnUnbrokenIdentifierThatShouldWrapInsideTheSharedDocumentsMetadataColumn";
  const longSourceLabel =
    "UploadedFromSourceSystemWithAnExtremelyLongUnbrokenIdentifierThatShouldNeverForceHorizontalOverflow";
  const longNotes =
    "NotesContainAnUnbrokenOperationalReferenceThatShouldWrapSafelyInsideTheOwnerPortalSharedDocumentsPanel";

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
      body: JSON.stringify({
        ...OWNER_PORTAL_ACCOUNT_RESPONSE,
        documents: [
          {
            ...OWNER_PORTAL_ACCOUNT_RESPONSE.documents[0],
            filename: longFilename,
            property_name: longPropertyName,
            source_label: longSourceLabel,
            notes: longNotes,
          },
        ],
      }),
    });
  });

  await page.goto("/owner-portal?month=2026-05");

  const downloadButton = page.getByRole("button", {
    name: `Download ${longFilename} for ${longPropertyName}`,
  });
  await expect(downloadButton).toBeVisible({ timeout: 15_000 });
  for (const metadataText of [
    longPropertyName,
    longSourceLabel,
    longNotes,
  ]) {
    await expect(page.getByText(metadataText, { exact: false })).toBeVisible();
    expect(
      await page.getByText(metadataText, { exact: false }).evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.left >= 0 &&
          rect.right <= window.innerWidth &&
          element.scrollWidth <= element.clientWidth
        );
      }),
    ).toBe(true);
  }
  expect(
    await downloadButton.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= window.innerWidth;
    }),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
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
