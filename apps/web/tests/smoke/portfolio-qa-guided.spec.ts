import { expect, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

// The guided fix queue is a frontend-only orchestration layer over the
// already-shipped Portfolio QA capabilities. These smokes assert the
// sequencing/progress behaviour and lock the shipped mutation paths so the
// guided flow can never silently change bulk-fix allowlists, the enrichment
// 503 path, or the account-first onboarding default.

const guidedQueue = (page: import("@playwright/test").Page) =>
  page.getByTestId("guided-fix-queue");

test("portfolio QA guided flow sequences categories with a remaining-count per step", async ({
  page,
}) => {
  await mockLeasiumApi(page);
  await page.goto("/portfolio-qa");

  const queue = guidedQueue(page);
  await expect(queue).toBeVisible();

  // The ordered category labels appear in the sequenced order.
  const stepLabels = queue.getByTestId("guided-step-label");
  await expect(stepLabels).toHaveText([
    "Tenant contacts",
    "Owner and billing",
    "Enrichment review",
    "Onboarding prep",
    "Source history",
  ]);

  // Every step carries a remaining-count badge sourced from the same derived
  // numbers the metric cards/completion panel already use.
  const counts = queue.getByTestId("guided-step-count");
  await expect(counts).toHaveCount(5);
  for (let i = 0; i < 5; i += 1) {
    await expect(counts.nth(i)).toHaveText(/\d+ (remaining|reference|done)/);
  }

  // Overall progress reads "X of N categories clear" (terminal reference step
  // is excluded from the actionable category total).
  await expect(queue.getByTestId("guided-progress")).toHaveText(
    /\d+ of \d+ categories clear/,
  );
});

test("portfolio QA guided flow advances to the next unresolved category and reveals its tab", async ({
  page,
}) => {
  await mockLeasiumApi(page);
  await page.goto("/portfolio-qa");

  const queue = guidedQueue(page);
  await expect(queue).toBeVisible();

  // Current step shows its count + a one-line "what this fixes".
  await expect(queue.getByTestId("guided-current-fixes")).toBeVisible();

  // "Go to this fix" jumps to the current step's tab.
  await queue.getByRole("button", { name: "Go to this fix" }).click();
  await expect(
    page.getByRole("heading", { name: "Tenant contact enrichment" }),
  ).toBeVisible();

  // "Next category" advances to the next non-clear step and that step's tab
  // becomes reachable via "Go to this fix".
  const advanceTo = async (heading: string) => {
    await queue.getByRole("button", { name: "Next category" }).click();
    await queue.getByRole("button", { name: "Go to this fix" }).click();
    await expect(
      page.getByRole("heading", { name: heading }),
    ).toBeVisible();
  };

  // Owner and billing routes to the issues surface (owner billing guided fixes).
  await advanceTo("Owner and billing guided fixes");
});

test("portfolio QA guided flow progress and step controls meet mobile touch targets", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLeasiumApi(page);
  await page.goto("/portfolio-qa");

  const queue = guidedQueue(page);
  await expect(queue).toBeVisible();

  const goToFix = queue.getByRole("button", { name: "Go to this fix" });
  const nextCategory = queue.getByRole("button", { name: "Next category" });
  for (const control of [goToFix, nextCategory]) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});

test("portfolio QA guided flow marks a cleared category as done", async ({
  page,
}) => {
  await mockLeasiumApi(page);
  // Return tenants with complete contact fields so the tenant-contacts
  // category is already clear and shows a success badge.
  await page.route(
    (url) => url.pathname.endsWith("/api/v1/tenants"),
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify([
          {
            id: "tenant-2",
            entity_id: "entity-1",
            legal_name: "Northwind Fitness Pty Ltd",
            trading_name: "Northwind Fitness",
            abn: "56123456789",
            contact_name: "Leo Nguyen",
            contact_email: "leo@example.com",
            contact_phone: "0400 333 444",
            billing_email: "billing@northwind.example",
            notes: null,
            metadata: {},
          },
        ]),
      });
    },
  );
  await page.goto("/portfolio-qa");

  const queue = guidedQueue(page);
  await expect(queue).toBeVisible();

  const tenantStep = queue.getByTestId("guided-step-tenant-contacts");
  await expect(tenantStep).toBeVisible();
  await expect(tenantStep.getByText("Done", { exact: true })).toBeVisible();
});

test("portfolio QA guided flow drives the shipped bulk-fix apply unchanged", async ({
  page,
}) => {
  const bulkFixCalls: Array<Record<string, unknown>> = [];
  const tenantPatchCalls: string[] = [];
  await mockLeasiumApi(page);
  await page.route(
    (url) => url.pathname.endsWith("/api/v1/tenants"),
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify([
          {
            id: "tenant-2",
            entity_id: "entity-1",
            legal_name: "Northwind Fitness Pty Ltd",
            trading_name: "Northwind Fitness",
            abn: "56123456789",
            contact_name: "Leo Nguyen",
            contact_email: "leo@example.com",
            contact_phone: "0400 333 444",
            billing_email: null,
            notes: null,
            metadata: {},
          },
          {
            id: "tenant-3",
            entity_id: "entity-2",
            legal_name: "Harbour Yoga Pty Ltd",
            trading_name: "Harbour Yoga",
            abn: null,
            contact_name: null,
            contact_email: "hello@harbouryoga.example",
            contact_phone: null,
            billing_email: null,
            notes: null,
            metadata: {},
          },
        ]),
      });
    },
  );
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (
      request.method() === "POST" &&
      pathname.endsWith("/portfolio-qa/bulk-fixes/apply")
    ) {
      bulkFixCalls.push(request.postDataJSON() as Record<string, unknown>);
    }
    if (
      request.method() === "PATCH" &&
      /\/api\/v1\/tenants\/[^/]+$/.test(pathname)
    ) {
      tenantPatchCalls.push(pathname);
    }
    await route.fallback();
  });

  await page.goto("/portfolio-qa");

  // Drive the bulk-fix path via the guided queue's "Go to this fix" jump.
  const queue = guidedQueue(page);
  await queue.getByRole("button", { name: "Go to this fix" }).click();

  const contactPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Tenant contact enrichment" }),
  });
  await contactPanel.getByRole("button", { name: "Stage suggestions" }).click();
  await contactPanel
    .getByRole("button", { name: "Save staged fixes" })
    .click();

  await expect(
    contactPanel.getByText(
      "2 tenant contact fixes saved; 4 fields applied, 4 skipped.",
    ),
  ).toBeVisible();
  expect(bulkFixCalls).toHaveLength(1);
  expect(bulkFixCalls[0]).not.toHaveProperty("entity_id");
  expect(bulkFixCalls[0].issue_class).toBe("tenant_contact");
  const changes = bulkFixCalls[0].changes as Array<Record<string, unknown>>;
  expect(changes).toHaveLength(2);
  expect(changes.map((change) => change.target_id)).toEqual([
    "tenant-2",
    "tenant-3",
  ]);
  expect(tenantPatchCalls).toEqual([]);
});

test("portfolio QA guided flow enrichment step stays review-first and 503-safe", async ({
  page,
}) => {
  const applyCalls: string[] = [];
  await mockLeasiumApi(page);
  await page.route("**/api/v1/public-enrichment/apply", async (route) => {
    if (route.request().method() === "POST") {
      applyCalls.push(new URL(route.request().url()).pathname);
    }
    await route.fallback();
  });
  await page.route("**/api/v1/public-enrichment/preview", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ detail: "OpenAI API key is not configured." }),
    });
  });

  await page.goto("/portfolio-qa");

  // The enrichment cards live in the always-visible completion panel; the
  // guided enrichment step points operators at them without auto-firing.
  const card = page.getByTestId(
    "enrichment-candidate-property-enrichment-property-3",
  );
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Suggest fixes" }).click();

  await expect(
    card.getByText("OpenAI API key is not configured."),
  ).toBeVisible();
  await expect(card.getByRole("button", { name: /Apply/ })).toHaveCount(0);
  expect(applyCalls).toEqual([]);
});

test("portfolio QA guided flow onboarding step creates invite links review-first without auto-sending", async ({
  page,
}) => {
  const onboardingCalls: Array<Record<string, unknown>> = [];
  await mockLeasiumApi(page);
  await page.route(
    (url) => url.pathname.endsWith("/api/v1/tenant-onboarding"),
    async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        onboardingCalls.push(request.postDataJSON() as Record<string, unknown>);
      }
      await route.fallback();
    },
  );

  await page.goto("/portfolio-qa");

  const queue = guidedQueue(page);
  await expect(queue).toBeVisible();
  await expect(queue.getByTestId("guided-step-onboarding")).toBeVisible();

  // Open the onboarding category's existing tab body via the guided flow.
  await page
    .getByRole("button", { name: /Onboarding prep Ready or blocked/ })
    .click();

  // Account-first: nothing fires until the operator selects + sends.
  expect(onboardingCalls).toEqual([]);

  await page.getByRole("button", { name: "Select ready" }).click();
  await page.getByRole("button", { name: "Send selected invites" }).click();

  await expect(page.getByText(/invite links? created/)).toBeVisible();
  expect(onboardingCalls.length).toBeGreaterThan(0);
  for (const call of onboardingCalls) {
    // No auto-send: the account-first Clerk gate is preserved.
    expect(call).not.toHaveProperty("send_initial_invite");
    expect(call.lease_id).toBeTruthy();
  }
});

test("portfolio QA guided flow ends on a source-history review reference, not a mutation", async ({
  page,
}) => {
  const mutationCalls: string[] = [];
  await mockLeasiumApi(page);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const method = request.method();
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      mutationCalls.push(`${method} ${new URL(request.url()).pathname}`);
    }
    await route.fallback();
  });

  await page.goto("/portfolio-qa");

  const queue = guidedQueue(page);
  await expect(queue).toBeVisible();

  // The terminal step is a read-only source-history reference.
  const sourceStep = queue.getByTestId("guided-step-source-history");
  await expect(sourceStep).toBeVisible();
  // Terminal step is a read-only reference, never an actionable "remaining".
  await expect(
    sourceStep.getByTestId("guided-step-count"),
  ).toHaveText(/\d+ reference/);

  // Jumping to it opens the source-history tab and fires no mutation.
  mutationCalls.length = 0;
  await page
    .getByRole("button", { name: /Source history Spreadsheet and intake/ })
    .click();
  await expect(
    page.getByRole("button", { name: /Source history/ }).first(),
  ).toBeVisible();
  expect(mutationCalls).toEqual([]);
});

test("portfolio QA guided flow reports complete when every category is clear", async ({
  page,
}) => {
  await mockLeasiumApi(page);
  // Empty register: no tenants, properties, rent roll, onboarding, or drafts,
  // so every actionable category is clear. Properties are served from
  // /premises/by-entity/{id} (not /api/v1/properties), so the empty override
  // has to match that path — otherwise the full mock's properties keep the
  // owner/billing and enrichment categories non-clear.
  const emptyList = ["tenants", "rent-roll", "billing-drafts"];
  for (const segment of emptyList) {
    await page.route(
      (url) => url.pathname.endsWith(`/api/v1/${segment}`),
      async (route) => {
        if (route.request().method() !== "GET") {
          await route.fallback();
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "access-control-allow-origin": "*" },
          body: JSON.stringify([]),
        });
      },
    );
  }
  await page.route(
    (url) => url.pathname.endsWith("/api/v1/properties"),
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify([]),
      });
    },
  );
  await page.route(
    (url) => url.pathname.includes("/api/v1/premises/by-entity/"),
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify([]),
      });
    },
  );
  for (const prefix of [
    "/api/v1/tenant-onboarding",
    "/api/v1/obligations",
    "/api/v1/document-intakes",
  ]) {
    await page.route(
      (url) => url.pathname.includes(prefix),
      async (route) => {
        if (route.request().method() !== "GET") {
          await route.fallback();
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "access-control-allow-origin": "*" },
          body: JSON.stringify([]),
        });
      },
    );
  }

  await page.goto("/portfolio-qa");

  const queue = guidedQueue(page);
  await expect(queue).toBeVisible();

  // Overall progress reports all actionable categories clear.
  await expect(queue.getByTestId("guided-progress")).toHaveText(
    "4 of 4 categories clear",
  );
  await expect(
    queue.getByText("All categories clear", { exact: true }),
  ).toBeVisible();
});
