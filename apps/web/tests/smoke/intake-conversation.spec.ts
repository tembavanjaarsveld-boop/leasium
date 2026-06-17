import { expect, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

// A lease-style intake the conversation panel can read into an understanding
// card + a "create these together" plan. Mirrors the extracted_data shape used
// across the smoke fixtures (parties / properties / key_dates / money_amounts /
// suggested_links), with document_type "lease" and high confidence.
const leaseIntakeId = "intake-conversation-lease-1";
const leaseExtraction = {
  document_type: "lease",
  summary:
    "Retail lease for Bright Cafe Pty Ltd at 12 Queen Street, Shop 3.",
  confidence: 0.9,
  parties: [{ name: "Bright Cafe Pty Ltd", role: "tenant", confidence: 0.92 }],
  properties: [
    {
      name: "Queen Street Retail Centre",
      address: "12 Queen Street",
      unit_label: "Shop 3",
      confidence: 0.9,
    },
  ],
  key_dates: [
    { label: "Lease start", date: "2026-07-01", confidence: 0.9 },
    { label: "Lease expiry", date: "2029-06-30", confidence: 0.88 },
  ],
  money_amounts: [
    { label: "Annual rent", amount: 84000, currency: "$", frequency: "year", confidence: 0.9 },
  ],
  obligations: [],
  inspection_findings: [],
  suggested_links: {
    property_name: "Queen Street Retail Centre",
    tenant_name: "Bright Cafe Pty Ltd",
  },
  warnings: [],
  missing_information: [],
};

const leaseIntake = {
  id: leaseIntakeId,
  entity_id: "entity-1",
  document_id: "document-conversation-lease-1",
  status: "ready_for_review",
  document_type: "lease",
  summary: leaseExtraction.summary,
  confidence: 0.9,
  extracted_data: leaseExtraction,
  review_data: {},
  openai_response_id: "resp-conversation-lease-smoke",
  error_message: null,
  reviewed_at: null,
  reviewed_by_user_id: null,
  applied_at: null,
  applied_by_user_id: null,
  created_at: "2026-06-15T02:00:00.000Z",
  updated_at: "2026-06-15T02:00:00.000Z",
  filename: "bright-cafe-lease.pdf",
  content_type: "application/pdf",
  byte_size: 5678,
  category: "lease",
};

// The apply response the panel reads for its "Done — created" card. The panel's
// buildCreated() reads review_data.applied: property_name / created_lease_count
// / tenant_name / obligation_count.
const appliedSummary = {
  property_id: "property-1",
  property_name: "Queen Street Retail Centre",
  created_lease_count: 1,
  tenant_id: "tenant-1",
  tenant_name: "Bright Cafe Pty Ltd",
  obligation_count: 2,
};

const appliedLeaseIntake = {
  ...leaseIntake,
  status: "applied",
  applied_at: "2026-06-15T02:05:00.000Z",
  applied_by_user_id: "operator-1",
  updated_at: "2026-06-15T02:05:00.000Z",
  review_data: { applied: appliedSummary },
};

// An existing property the lease should LINK to (matches the extracted
// property name/address) rather than duplicate.
const existingProperty = {
  id: "property-1",
  entity_id: "entity-1",
  name: "Queen Street Retail Centre",
  street_address: "12 Queen Street",
  suburb: "Brisbane",
  state: "QLD",
  postcode: "4000",
};

// Reuse the forbidden-endpoint shape from smart-intake-export-parity.spec.ts:
// the conversation panel may link to Xero / finance / tenant surfaces, but it
// must never *call* a provider/mutation endpoint. The apply endpoint itself is
// the one allowed mutation (asserted separately for call-once), so it is NOT in
// this set.
function isForbiddenProviderRequest(method: string, path: string) {
  // A real provider SEND/DISPATCH is forbidden regardless of method — these
  // only exist to push to Xero / SendGrid / Twilio.
  const isProviderSend =
    path.includes("/sendgrid") ||
    path.includes("/twilio") ||
    path.includes("/send-email") ||
    path.includes("/send-sms") ||
    path.includes("/provider-dispatch") ||
    path.includes("/provider-refresh");
  // A WRITE (non-GET) to any provider / finance / comms / onboarding /
  // maintenance surface is forbidden. Read-only GET counts the app shell
  // fires for nav badges (e.g. GET /comms/queue/counts, GET /tenant-onboarding)
  // are ambient and allowed — they mutate nothing.
  const isProviderWrite =
    method !== "GET" &&
    (path.includes("/xero") ||
      path.includes("/basiq") ||
      path.includes("/billing") ||
      path.includes("/payment") ||
      path.includes("/reconciliation") ||
      path.includes("/invoice") ||
      path.startsWith("/comms") ||
      path.startsWith("/tenant-onboarding") ||
      path.startsWith("/maintenance"));

  return isProviderSend || isProviderWrite;
}

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page);
});

test("conversation-first intake panel reads the lease and creates records without provider calls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  let applyCallCount = 0;
  const forbiddenApiCalls: string[] = [];
  const threadId = "thread-intake-conversation-1";
  let createdThread = false;
  let applyThreadId: string | null = null;

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");

    if (request.method() === "POST" && path === "/conversation-threads") {
      const payload = request.postDataJSON() as Record<string, unknown>;
      createdThread = true;
      expect(payload.entity_id).toBe(leaseIntake.entity_id);
      expect(payload.source).toBe("intake");
      expect(payload.context_route).toBe("/intake");
      expect(payload.context_record_refs).toMatchObject({
        document_intake_id: leaseIntake.id,
      });
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: threadId,
          organisation_id: "org-1",
          entity_id: leaseIntake.entity_id,
          created_by_user_id: "operator-1",
          source: "intake",
          context_route: "/intake",
          context_record_refs: { document_intake_id: leaseIntake.id },
          title: "bright-cafe-lease.pdf",
          metadata: {},
          created_at: "2026-06-16T00:00:00.000Z",
          updated_at: "2026-06-16T00:00:00.000Z",
          turns: [],
        }),
      });
      return;
    }

    if (
      request.method() === "POST" &&
      path === `/conversation-threads/${threadId}/turns`
    ) {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: threadId,
          organisation_id: "org-1",
          entity_id: leaseIntake.entity_id,
          created_by_user_id: "operator-1",
          source: "intake",
          context_route: "/intake",
          context_record_refs: { document_intake_id: leaseIntake.id },
          title: "bright-cafe-lease.pdf",
          metadata: {},
          created_at: "2026-06-16T00:00:00.000Z",
          updated_at: "2026-06-16T00:01:00.000Z",
          turns: [],
        }),
      });
      return;
    }

    // Surface the lease intake in the review queue.
    if (request.method() === "GET" && path === "/document-intakes") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([leaseIntake]),
      });
      return;
    }

    // Allowed mutation: applying the reviewed intake. Returns the applied
    // intake with a review_data.applied summary.
    if (
      request.method() === "POST" &&
      path === `/document-intakes/${leaseIntakeId}/apply`
    ) {
      applyCallCount += 1;
      applyThreadId = (request.postDataJSON() as { thread_id?: string }).thread_id ?? null;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(appliedLeaseIntake),
      });
      return;
    }

    // Guardrail: any provider / mutation endpoint during the whole flow fails
    // the test. "Suggested next steps" (Sync to Xero, etc.) are links only.
    if (isForbiddenProviderRequest(request.method(), path)) {
      forbiddenApiCalls.push(`${request.method()} ${path}`);
      await route.fulfill({
        status: 418,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Conversation-first intake must not call providers",
        }),
      });
      return;
    }

    await route.fallback();
  });

  await page.goto("/intake");

  await expect(
    page.getByRole("heading", { level: 1, name: "Leasium AI" }),
  ).toBeVisible();

  // 2. Select the lease intake from the review queue.
  await expect(
    page.getByTestId(`review-intake-${leaseIntakeId}`),
  ).toBeVisible();
  await page
    .getByTestId(`review-intake-${leaseIntakeId}`)
    .getByRole("button", { name: "Review" })
    .click();

  // 3. Conversation + understanding + plan render with the read values.
  const conversation = page.getByTestId("intake-conversation");
  await expect(conversation).toBeVisible();

  const understanding = page.getByTestId("intake-understanding");
  await expect(understanding).toBeVisible();
  await expect(understanding).toContainText("Bright Cafe Pty Ltd");
  await expect(understanding).toContainText("Queen Street Retail Centre");
  await expect(understanding).toContainText("Shop 3");
  await expect(understanding).toContainText("$84,000");

  const plan = page.getByTestId("intake-plan");
  await expect(plan).toBeVisible();
  await expect(plan).toContainText("Property");
  await expect(plan).toContainText("Tenant");
  await expect(plan).toContainText("Lease");

  // 4. Create all records → apply called exactly once → created + next steps.
  await page.getByTestId("intake-create-all").click();

  const created = page.getByTestId("intake-created");
  await expect(created).toBeVisible();
  await expect(created).toContainText("Queen Street Retail Centre");
  await expect(created).toContainText("Bright Cafe Pty Ltd");
  await expect(created.getByRole("link", { name: "View" }).first()).toHaveAttribute(
    "href",
    `/properties?entity_id=${leaseIntake.entity_id}&property_id=${appliedSummary.property_id}`,
  );
  await expect(created.getByText("1 lease").locator("..").getByRole("link")).toHaveAttribute(
    "href",
    `/properties?entity_id=${leaseIntake.entity_id}&property_id=${appliedSummary.property_id}`,
  );
  await expect(
    created.getByText("Tenant — Bright Cafe Pty Ltd").locator("..").getByRole("link"),
  ).toHaveAttribute("href", `/tenants/${appliedSummary.tenant_id}`);

  const nextSteps = page.getByTestId("intake-next-steps");
  await expect(nextSteps).toBeVisible();
  await expect(
    nextSteps.getByText("Sync tenant to Xero").locator("..").getByRole("link", {
      name: "Review",
    }),
  ).toHaveAttribute(
    "href",
    `/settings?tab=xero&entity_id=${leaseIntake.entity_id}`,
  );
  await expect(
    nextSteps
      .getByText("Set up monthly rent invoicing")
      .locator("..")
      .getByRole("link", { name: "Review" }),
  ).toHaveAttribute(
    "href",
    `/billing-readiness?entity_id=${leaseIntake.entity_id}&tab=readiness`,
  );
  const emailReview = nextSteps
    .getByText("Email the tenant")
    .locator("..")
    .getByRole("link", { name: "Review" });
  await expect(emailReview).toHaveAttribute(
    "href",
    `/comms?entity_id=${leaseIntake.entity_id}&target_kind=tenant&target_id=${appliedSummary.tenant_id}`,
  );
  await emailReview.click();

  expect(applyCallCount).toBe(1);
  expect(createdThread).toBe(true);
  expect(applyThreadId).toBe(threadId);

  // 5. Guardrail: no provider / mutation endpoint was hit during the flow.
  expect(forbiddenApiCalls).toEqual([]);
});

test("links an existing property instead of creating a duplicate", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  let applyBody = "";

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");

    if (request.method() === "GET" && path === "/document-intakes") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([leaseIntake]),
      });
      return;
    }
    // The lease's property already exists — surface it so the panel matches.
    if (request.method() === "GET" && path === "/properties") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([existingProperty]),
      });
      return;
    }
    // No existing tenant — Gorilla/Bright Cafe stays NEW.
    if (request.method() === "GET" && path === "/tenants") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
      return;
    }
    if (
      request.method() === "POST" &&
      path === `/document-intakes/${leaseIntakeId}/apply`
    ) {
      applyBody = request.postData() ?? "";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(appliedLeaseIntake),
      });
      return;
    }
    await route.fallback();
  });

  await page.goto("/intake");
  await expect(
    page.getByRole("heading", { level: 1, name: "Leasium AI" }),
  ).toBeVisible();
  await page
    .getByTestId(`review-intake-${leaseIntakeId}`)
    .getByRole("button", { name: "Review" })
    .click();

  const plan = page.getByTestId("intake-plan");
  await expect(plan).toBeVisible();
  // The matched property is linked, not duplicated.
  await expect(plan).toContainText("Use existing");

  await page.getByTestId("intake-create-all").click();
  await expect(page.getByTestId("intake-created")).toBeVisible();
  // Apply received the existing property id so the backend links rather than
  // creating a second property.
  expect(applyBody).toContain(existingProperty.id);
});

test("edit before creating sends the corrected lease term", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  let applyBody = "";

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");

    if (request.method() === "GET" && path === "/document-intakes") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([leaseIntake]),
      });
      return;
    }
    if (
      request.method() === "POST" &&
      path === `/document-intakes/${leaseIntakeId}/apply`
    ) {
      applyBody = request.postData() ?? "";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(appliedLeaseIntake),
      });
      return;
    }
    await route.fallback();
  });

  await page.goto("/intake");
  await page
    .getByTestId(`review-intake-${leaseIntakeId}`)
    .getByRole("button", { name: "Review" })
    .click();

  await page.getByTestId("intake-edit").click();
  const editForm = page.getByTestId("intake-edit-form");
  await expect(editForm).toBeVisible();

  // Correct the flagged expiry, then create.
  await page.getByTestId("intake-edit-expiry").fill("2030-06-30");
  await page.getByTestId("intake-create-all").click();

  await expect(page.getByTestId("intake-created")).toBeVisible();
  // The corrected expiry is handed to apply (so the backend won't block on it).
  expect(applyBody).toContain("2030-06-30");
});
