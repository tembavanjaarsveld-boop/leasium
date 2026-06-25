import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { mockLeasiumApi } from "./api-mocks";

test("portfolio QA loading metrics use contextual labels", async ({ page }) => {
  await mockLeasiumApi(page);
  await page.route("**/api/v1/**", async (route) => {
    await page.waitForTimeout(1200);
    await route.fallback();
  });

  await page.goto("/portfolio-qa");

  const metrics = page
    .locator("section")
    .filter({
      has: page.getByText("Open issues", { exact: true }),
    })
    .first();

  await expect(metrics).toContainText("Checking");
  await expect(metrics).toContainText("Preparing");
  await expect(metrics).toContainText("Updating");
  await expect(metrics.getByText("...", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Preparing QA workspace.")).toBeVisible();
  await expect(page.getByText("Loading QA workspace.")).toHaveCount(0);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("portfolio QA blocker triage shows per-reason counts, plain-English copy, and a guided fix", async ({
  page,
}) => {
  await mockLeasiumApi(page);
  await page.goto("/portfolio-qa");

  // The reason-breakdown layer lives only inside the Blocker triage packet.
  const breakdown = page.getByTestId("blocker-reason-breakdown");
  await expect(breakdown).toBeVisible();

  // Scope to the rent-roll billing group card within the breakdown.
  const rentRollGroup = breakdown.getByTestId("reason-group-billing-readiness");
  await expect(rentRollGroup).toBeVisible();

  // Reason 1: appears twice (two seeded rows) with plain-English copy.
  await expect(
    rentRollGroup.getByText("Tenant is missing a billing email.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    rentRollGroup.getByText(
      "Onboarding invites and invoices can't reach the tenant.",
    ),
  ).toBeVisible();

  // Reason 2: a distinct reason at a different count, also explained.
  await expect(
    rentRollGroup.getByText("Rent is missing a Xero account code.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    rentRollGroup.getByText(
      "Blocks syncing the invoice to Xero without an account code.",
    ),
  ).toBeVisible();

  // Guided fix path routes through the existing billing-readiness surface.
  await expect(
    rentRollGroup.getByRole("link", { name: /Open billing/ }).first(),
  ).toHaveAttribute("href", "/billing-readiness");

  // The "missing a billing email" reason expands to its 2 affected rows.
  await rentRollGroup
    .getByRole("button", { name: "Show 2 affected rows" })
    .click();
  await expect(
    rentRollGroup.getByRole("button", { name: "Hide affected rows" }),
  ).toBeVisible();
});

test("portfolio QA enrichment queue actions meet mobile touch targets and stay local-only", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

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

  await expect(
    page.getByText("AI-assisted enrichment candidates", { exact: true }),
  ).toBeVisible();

  const copyQueue = page.getByRole("button", {
    name: "Copy queue",
  });
  const downloadQueueCsv = page.getByRole("button", {
    name: "Download queue CSV",
  });

  for (const control of [copyQueue, downloadQueueCsv]) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  mutationCalls.length = 0;
  await copyQueue.click();
  await expect(page.getByText("Enrichment queue copied.")).toBeVisible();
  const copiedQueue = await page.evaluate(() => navigator.clipboard.readText());
  expect(copiedQueue).toContain("Portfolio QA enrichment queue");
  expect(copiedQueue).toContain("Review-only");

  const downloadPromise = page.waitForEvent("download");
  await downloadQueueCsv.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "portfolio-qa-enrichment-queue.csv",
  );
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const csv = await readFile(downloadPath!, "utf8");
  expect(csv).toContain("Eagle Street Office");
  expect(csv).toContain(
    "Review-only: accept sourced suggestions only after checking citations.",
  );
  expect(mutationCalls).toEqual([]);
});

test("portfolio QA source and onboarding row actions stay touch-safe without firing actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });

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

  await page
    .getByRole("button", { name: /Source history/ })
    .click();
  const trailAction = page.getByRole("button", { name: "Trail" }).first();
  await expect(trailAction).toBeVisible();
  const trailBox = await trailAction.boundingBox();
  expect(trailBox).not.toBeNull();
  expect(trailBox!.width).toBeGreaterThanOrEqual(44);
  expect(trailBox!.height).toBeGreaterThanOrEqual(44);

  await page
    .getByRole("button", { name: /Onboarding prep/ })
    .click();
  const createInviteAction = page
    .getByRole("button", { name: "Create invite" })
    .first();
  await expect(createInviteAction).toBeVisible();
  const createInviteBox = await createInviteAction.boundingBox();
  expect(createInviteBox).not.toBeNull();
  expect(createInviteBox!.width).toBeGreaterThanOrEqual(44);
  expect(createInviteBox!.height).toBeGreaterThanOrEqual(44);

  const source = await readFile("src/app/portfolio-qa/page.tsx", "utf8");
  expect(source).not.toMatch(/openTenantContactFix[\s\S]{0,300}min-h-9/);
  expect(source).toMatch(/openTenantContactFix[\s\S]{0,300}min-h-11/);

  expect(mutationCalls).toEqual([]);
});

test("portfolio QA enrichment candidate previews sourced suggestions and applies only after explicit review", async ({
  page,
}) => {
  const applyCalls: Array<Record<string, unknown>> = [];
  await mockLeasiumApi(page);
  await page.route("**/api/v1/public-enrichment/apply", async (route) => {
    if (route.request().method() === "POST") {
      applyCalls.push(
        route.request().postDataJSON() as Record<string, unknown>,
      );
    }
    await route.fallback();
  });

  await page.goto("/portfolio-qa");

  const card = page.getByTestId(
    "enrichment-candidate-property-enrichment-property-3",
  );
  await expect(card).toBeVisible();
  await expect(card).toContainText("Eagle Street Office");

  // Preview is explicit: nothing fires before the click.
  await card.getByRole("button", { name: "Suggest fixes" }).click();

  // Sourced suggestion detail: value, confidence %, citation, source link.
  await expect(card.getByText("12 345 678 901")).toBeVisible();
  await expect(card.getByText("92% confidence")).toBeVisible();
  await expect(
    card.getByText("Eagle Street Property Trust active ABN record."),
  ).toBeVisible();
  await expect(
    card.getByRole("link", { name: "ABN Lookup" }).first(),
  ).toHaveAttribute("href", "https://abr.business.gov.au/");
  await expect(
    card.getByText("No confident public source found for Owner Legal Name."),
  ).toBeVisible();
  expect(applyCalls).toEqual([]);

  // Edit/ignore affordance: removing a suggestion shrinks the reviewed set.
  await card
    .getByRole("button", { name: "Remove Trust Name suggestion" })
    .click();
  await expect(
    card.getByRole("button", { name: "Apply 2 reviewed suggestions" }),
  ).toBeVisible();
  expect(applyCalls).toEqual([]);

  // Dismiss clears the preview without mutating anything.
  await card.getByRole("button", { name: "Dismiss" }).click();
  await expect(
    card.getByRole("button", { name: "Suggest fixes" }),
  ).toBeVisible();
  expect(applyCalls).toEqual([]);

  // Fresh preview, then the explicit apply fires exactly one call.
  await card.getByRole("button", { name: "Suggest fixes" }).click();
  await card
    .getByRole("button", { name: "Apply 3 reviewed suggestions" })
    .click();

  await expect(
    page.getByText("Applied 3 of 3 reviewed suggestions to Eagle Street Office."),
  ).toBeVisible();
  expect(applyCalls).toHaveLength(1);
  expect(applyCalls[0].target_type).toBe("property");
  expect(applyCalls[0].target_id).toBe("property-3");
  const sentSuggestions = applyCalls[0].suggestions as Array<
    Record<string, unknown>
  >;
  expect(sentSuggestions.map((suggestion) => suggestion.field)).toEqual([
    "owner_abn",
    "trust_name",
    "invoice_issuer_name",
  ]);
  expect(sentSuggestions[0].value).toBe("12 345 678 901");

  // The applied record drops out of the queue after refetch.
  await expect(card).toHaveCount(0);
});

test("portfolio QA bulk fix review applies staged rows in one reviewed request and reports skips", async ({
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

  await page
    .getByRole("button", { name: /Tenant contacts Clean invite details/ })
    .click();
  const contactPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Tenant contact enrichment" }),
  });
  await expect(contactPanel.getByText("Northwind Fitness")).toBeVisible();
  await expect(contactPanel.getByText("Harbour Yoga")).toBeVisible();

  await contactPanel.getByRole("button", { name: "Stage suggestions" }).click();
  await expect(
    contactPanel.getByText("Review staged tenant suggestions"),
  ).toBeVisible();
  expect(bulkFixCalls).toEqual([]);

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

test("portfolio QA enrichment preview surfaces a 503 inline without firing apply", async ({
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
