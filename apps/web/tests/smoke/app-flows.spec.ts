import { expect, test } from "@playwright/test";

import { mockLeasiumApi } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await mockLeasiumApi(page);
});

test("setup explains Clerk configuration before first workspace setup", async ({
  page,
}) => {
  await page.goto("/setup");

  await expect(
    page.getByRole("heading", { name: "First workspace setup" }),
  ).toBeVisible();
  await expect(page.getByText("Clerk is not configured yet")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to sign in" }),
  ).toBeVisible();
});

test("workspace guard asks signed-out operators to sign in when Clerk is configured", async ({
  page,
}) => {
  test.skip(
    !process.env.LEASIUM_SMOKE_CLERK_GUARD ||
      !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    "Runs only with a real Clerk smoke environment.",
  );

  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Sign in to open the workspace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "First workspace setup" }),
  ).toBeVisible();
});

test("dashboard shows the mocked portfolio and opens billing readiness", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Acme Holdings Pty Ltd" }),
  ).toBeVisible();
  await expect(
    page.getByText("Queen Street Retail Centre").first(),
  ).toBeVisible();
  await expect(
    page.getByText("Insurance certificate renewal").first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Open search" }).click();
  const commandSearch = page.getByPlaceholder(
    "Search tenants, leases, actions...",
  );
  await commandSearch.fill("portfolio qa");
  await expect(
    page.getByRole("link", { name: /Data cleanup \/ Portfolio QA/ }),
  ).toBeVisible();
  await commandSearch.fill("billing");
  await page.getByText("Review billing blockers").click();

  await expect(page).toHaveURL(/\/billing-readiness$/);
  await expect(
    page.getByRole("heading", { name: "Billing Readiness" }),
  ).toBeVisible();
  await expect(
    page.getByText("Xero mapping needs review").first(),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: /Fix blockers/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Review drafts/ })).toBeVisible();
  await expect(
    page.getByRole("tab", { name: /Approve invoices/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: /Dispatch & reconcile/ }),
  ).toBeVisible();

  await page.getByRole("tab", { name: /Review drafts/ }).click();
  await expect(page.getByText("May rent and outgoings")).toBeVisible();

  await page.getByRole("tab", { name: /Approve invoices/ }).click();
  await expect(
    page.getByRole("heading", { name: "Invoice preparation" }),
  ).toBeVisible();
  await expect(page.getByText("INV-1001").first()).toBeVisible();

  await page.getByRole("tab", { name: /Dispatch & reconcile/ }).click();
  await expect(page.getByText("Needs Xero approval").first()).toBeVisible();
  const primaryDispatchRow = page.getByRole("row").filter({
    hasText: "INV-1001",
  });
  await expect(
    primaryDispatchRow.getByRole("button", { exact: true, name: "Dispatch" }),
  ).toBeVisible();
  await expect(
    primaryDispatchRow.getByRole("button", { name: "Email" }),
  ).toBeVisible();
});

test("operations workspace surfaces maintenance and arrears work", async ({
  page,
}) => {
  await page.goto("/operations");

  await expect(
    page.getByRole("heading", { name: "Operations", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Air conditioning fault")).toBeVisible();
  await expect(page.getByText("Bright Cafe arrears")).toBeVisible();
  await page
    .getByLabel("Assignee for Air conditioning fault")
    .selectOption({ label: "Temba van Jaarsveld" });
  await page
    .getByRole("button", { exact: true, name: "Assign" })
    .first()
    .click();
  await expect(
    page.getByText("Assigned to Temba van Jaarsveld").first(),
  ).toBeVisible();
  await expect(page.getByText("Notification ready").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Send ready notices 1/ }),
  ).toBeVisible();
  await expect(page.getByText("Notice inbox")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Air conditioning fault Ready/ }),
  ).toBeVisible();
  await expect(page.getByText("Reminder Today").first()).toBeVisible();
  await page.getByRole("button", { name: "Send notice" }).first().click();
  await expect(page.getByText("Email queued").first()).toBeVisible();
  await expect(page.getByText("Recent activity").first()).toBeVisible();
  await page.getByRole("button", { name: "Generate digest" }).click();
  await expect(page.getByText("Work digest generated")).toBeVisible();
  await expect(page.getByText("No messages sent")).toBeVisible();
  await page.getByRole("button", { name: "Log reminder" }).first().click();
  await expect(page.getByText("Reminder logged").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Show Temba van Jaarsveld work, 1/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Show assignment follow-ups, 0/ }),
  ).toBeVisible();
  await page.getByLabel("Queue assignee").selectOption("follow_up");
  await expect(page.getByText("No assignment follow-ups due")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Air conditioning fault 1d/ }),
  ).not.toBeVisible();
  await expect(page.getByText("Bright Cafe arrears")).not.toBeVisible();
  await page
    .getByLabel("Queue assignee")
    .selectOption({ label: "Temba van Jaarsveld" });
  await expect(
    page.getByRole("link", { name: /Air conditioning fault 1d/ }),
  ).toBeVisible();
  await expect(page.getByText("Bright Cafe arrears")).not.toBeVisible();
  await page.getByLabel("Queue assignee").selectOption("unassigned");
  await expect(page.getByText("Insurance certificate renewal")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Air conditioning fault 1d/ }),
  ).not.toBeVisible();
  await page.getByLabel("Queue assignee").selectOption("all");

  await page.getByRole("tab", { name: /Maintenance/ }).click();
  await expect(page.getByText("Cool Air Services")).toBeVisible();
  await expect(
    page.getByText("Assigned to Temba van Jaarsveld").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Detail" }).click();
  await expect(page.getByText("Approval", { exact: true })).toBeVisible();
  await expect(page.getByText("$640").first()).toBeVisible();
  await expect(
    page.getByText("Tenant submitted maintenance request."),
  ).toBeVisible();
  await page
    .getByLabel("Invoice draft for Air conditioning fault")
    .selectOption("invoice-draft-1");
  await page.getByRole("button", { name: "Link invoice" }).click();
  await expect(page.getByText("INV-1001").first()).toBeVisible();
  await page.getByRole("button", { exact: true, name: "Approve" }).click();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^approved$/ })
      .first(),
  ).toBeVisible();

  await page.getByRole("tab", { name: /Arrears/ }).click();
  await expect(page.getByText("$8,800").first()).toBeVisible();
  await expect(page.getByText("raised").first()).toBeVisible();
  await page.getByRole("button", { name: "Escalate" }).click();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^queued$/ })
      .first(),
  ).toBeVisible();
});

test("notification center shows work notices and digest receipts", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Open notifications" }).click();
  await expect(page).toHaveURL(/\/notifications$/);

  await expect(
    page.getByRole("heading", { name: "Notifications" }),
  ).toBeVisible();
  await expect(page.getByText("Work notice center")).toBeVisible();
  await expect(page.getByText("Air conditioning fault")).toBeVisible();
  await expect(page.getByText("Bright Cafe arrears")).toBeVisible();
  await expect(page.getByText("Digest history")).toBeVisible();
  await expect(page.getByText("Owner Operator").first()).toBeVisible();
  await expect(page.getByText("No messages sent").first()).toBeVisible();
  await expect(page.getByText("3 unread")).toBeVisible();
  await page.getByRole("button", { name: "Mark reviewed" }).click();
  await expect(page.getByText("0 unread")).toBeVisible();
  await expect(page.getByText(/Reviewed 21 May 2026/)).toBeVisible();
});

test("maintenance detail route shows quote evidence", async ({ page }) => {
  await page.goto("/operations/maintenance/work-order-1");

  await expect(
    page.getByRole("heading", { name: "Air conditioning fault" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Quote documents" }),
  ).toBeVisible();
  await expect(page.getByText("shopfront-ac-photo.jpg")).toBeVisible();
  await expect(page.getByText("Edit work-order details")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Operational note" })
    .fill(
      "Needs owner approval before work proceeds. Confirm tenant access after 9am.",
    );
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(
    page.getByRole("textbox", { name: "Operational note" }),
  ).toHaveValue(
    "Needs owner approval before work proceeds. Confirm tenant access after 9am.",
  );
  await expect(page.getByLabel("Quote document")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Attach quote" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Approve quote" }),
  ).toBeVisible();
  await expect(page.getByText("Job completion handoff")).toBeVisible();
  await expect(page.getByText("Approval still pending")).toBeVisible();
  await expect(page.getByText("Job completion not recorded")).toBeVisible();
  await expect(page.getByText("No invoice linked")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Complete job" }),
  ).toBeDisabled();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Email Failed #1$/ })
      .first(),
  ).toBeVisible();
  await expect(page.getByText("Last provider attempt failed")).toBeVisible();
  await expect(page.getByText("Provider history")).toBeVisible();
  await expect(
    page.getByText("Template maintenance_contractor_update v1").first(),
  ).toBeVisible();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Attempt Failed #1$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Receipt Failed #1$/ })
      .first(),
  ).toBeVisible();
  await expect(page.getByLabel("Contractor update template")).toBeVisible();
  await page
    .getByLabel("Contractor update template")
    .selectOption("attendance_window");
  await expect(page.getByLabel("Email subject")).toHaveValue(
    "Attendance window request: Air conditioning fault",
  );
  await expect(
    page.getByRole("textbox", { name: "Contractor email message" }),
  ).toHaveValue(/Please confirm your first available attendance window/);
  await page.getByRole("button", { name: "Retry update" }).click();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Email Queued #2$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Receipt Queued$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Attempt Queued #2$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Receipt Queued #2$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText(/Please confirm your first available attendance window/),
  ).toBeVisible();
  await page
    .getByLabel("Linked maintenance invoice")
    .selectOption("invoice-draft-failed");
  await page.getByRole("button", { name: "Link" }).click();
  await expect(page.getByText("Invoice linked")).toBeVisible();
  await expect(page.getByText("Invoice delivery ready")).toBeVisible();
  await expect(page.getByText("Payment Unpaid")).toBeVisible();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Delivery ready$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Billing handoff$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Recovery needed$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText("Xero provider returned validation error.").first(),
  ).toBeVisible();
  await expect(page.getByText("Billing recovery path")).toBeVisible();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Retry provider dispatch$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Recover in Billing" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Preview" })).toBeVisible();
  await expect(page.getByRole("link", { name: "PDF" })).toBeVisible();
  await page.getByRole("button", { name: "Approve quote" }).click();
  await expect(page.getByText("Operations completion ready")).toBeVisible();
  await expect(page.getByText("Approval still pending")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Closeout note" })
    .fill("Contractor completed repairs and supplied final photo.");
  await page.getByLabel("Closeout photo").setInputFiles({
    name: "closeout-ac-photo.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("closeout image bytes"),
  });
  await page.getByRole("button", { name: "Complete job" }).click();
  await expect(page.getByText("Job complete")).toBeVisible();
  await expect(page.getByText("Job completion not recorded")).toHaveCount(0);
  await expect(page.getByText("Closeout recorded")).toBeVisible();
  await expect(
    page
      .getByText("Contractor completed repairs and supplied final photo.")
      .first(),
  ).toBeVisible();
  await expect(page.getByText("closeout-ac-photo.jpg").first()).toBeVisible();
  await expect(page.getByText("Closeout history")).toBeVisible();
  await expect(page.getByText("1 closeout photo")).toBeVisible();
  await expect(page.getByText("Source evidence")).toBeVisible();
  await expect(page.getByText("Completion communications")).toBeVisible();
  await expect(page.getByText("Owner update ready")).toBeVisible();
  await expect(page.getByText("Contractor follow-up ready")).toBeVisible();
  await expect(page.getByText("Tenant update ready")).toBeVisible();
  await expect(
    page.getByText("Review this copy before sending anything outside Leasium."),
  ).toBeVisible();
  await expect(page.getByText("Owner completion review")).toBeVisible();
  await expect(page.getByText("Needs owner review")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Owner review note" })
    .fill("Owner reviewed completion copy before sending.");
  await page.getByRole("button", { name: "Mark owner reviewed" }).click();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Owner review recorded$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText("Owner reviewed completion copy before sending."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reopen job" }).click();
  await expect(page.getByText("Job reopened")).toBeVisible();
  await expect(page.getByText("Job completion not recorded")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Comment" })
    .fill("Owner approved attendance tomorrow morning.");
  await page.getByLabel("Comment visibility").selectOption("tenant");
  await page.getByRole("button", { name: "Add comment" }).click();
  await expect(
    page.getByText("Owner approved attendance tomorrow morning. (Tenant)"),
  ).toBeVisible();
  await page.getByRole("link", { name: "Recover in Billing" }).click();
  await expect(page).toHaveURL(/\/billing-readiness\?/);
  await expect(page.getByText("Operations handoff")).toBeVisible();
  await expect(
    page.getByText("Maintenance: Air conditioning fault"),
  ).toBeVisible();
  await expect(page.getByText("Maintenance-linked invoice")).toBeVisible();
  await expect(page.getByText("Contractor Cool Air Services")).toBeVisible();
  await expect(
    page.getByText(
      "Retry dispatch here, then return to the work order once the provider receipt clears.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry dispatch" }),
  ).toBeVisible();
});

test("tenant workspace supports search and the add tenant form", async ({
  page,
}) => {
  await page.goto("/tenants");

  await expect(
    page.getByRole("heading", { name: "Tenant workspace" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Bright Cafe/ })).toBeVisible();

  await page.getByPlaceholder("Search tenants").fill("northwind");
  await expect(
    page.getByRole("link", { name: /Northwind Fitness/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Bright Cafe/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Add tenant" }).click();
  await expect(page.getByLabel("Legal name")).toBeVisible();
  await expect(page.getByLabel("Contact email")).toBeVisible();
});

test("property workspace shows the evidence source trail", async ({ page }) => {
  await page.goto("/properties");

  await expect(
    page.getByRole("heading", { name: "Acme Holdings Pty Ltd" }),
  ).toBeVisible();
  await expect(
    page.getByText("Queen Street Retail Centre").first(),
  ).toBeVisible();
  await expect(
    page.getByText("Queen Street Property Trust").first(),
  ).toBeVisible();

  await page.getByRole("tab", { name: /Documents/ }).click();

  await expect(
    page.getByRole("heading", { name: "Evidence drawer" }),
  ).toBeVisible();
  await expect(page.getByText("Purchase contract").first()).toBeVisible();
  await expect(page.getByText("Street address").first()).toBeVisible();
  await expect(page.getByText("12 Queen St").first()).toBeVisible();
  await expect(page.getByText("12 Queen Street").first()).toBeVisible();
  await expect(page.getByText("Citation stored for Owner ABN")).toBeVisible();
});

test("tenant detail shows portal access recovery actions", async ({ page }) => {
  await page.goto("/tenants/tenant-1");

  await expect(
    page.getByRole("heading", { name: /Bright Cafe/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Portal access" }),
  ).toBeVisible();
  await expect(page.getByText("tenant-subject-one")).toBeVisible();
  await expect(page.getByRole("button", { name: "Revoke" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Source history" }),
  ).toBeVisible();
  await expect(page.getByText("Tenant onboarding applied")).toBeVisible();
  await expect(page.getByText("Billing email").first()).toBeVisible();
  await expect(page.getByText("accounts@bright.example").first()).toBeVisible();
  await expect(page.getByText("Applied ABN")).toBeVisible();

  await page.getByRole("button", { name: "Revoke" }).click();
  await expect(
    page.getByText("Recovery receipt: revoked by staff"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();

  await page.getByRole("button", { name: "Restore" }).click();
  await expect(
    page.getByText("Recovery receipt: restored by staff"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Unlink" })).toBeVisible();

  await page.getByRole("button", { name: "Unlink" }).click();
  await expect(page.getByRole("button", { name: "Fresh link" })).toBeVisible();

  await page.getByRole("button", { name: "Fresh link" }).click();
  await expect(page.getByText("Fresh portal link copied.")).toBeVisible();
});

test("tenant portal shows scoped self-service data", async ({ page }) => {
  await page.goto("/tenant-portal/tenant-token-1");

  await expect(
    page.getByRole("heading", { name: "Bright Cafe" }),
  ).toBeVisible();
  await expect(page.getByText("Token scoped")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
  await expect(page.getByText("INV-1001")).toBeVisible();
  await expect(page.getByText("May rent and outgoings")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Maintenance" }),
  ).toBeVisible();
  await expect(page.getByText("Air conditioning fault")).toBeVisible();
  await expect(
    page.getByText("Tenant submitted maintenance request."),
  ).toBeVisible();
  await expect(page.getByText("Team update")).toBeVisible();
  await expect(
    page.getByText("We have asked the contractor for an attendance window."),
  ).toBeVisible();
  await expect(
    page.getByText("Updated contractor and approval status."),
  ).toHaveCount(0);
  await expect(page.getByText("2 files")).toBeVisible();
  await page.getByLabel("Request title").fill("Shopfront light fault");
  await page.getByLabel("Priority").selectOption("high");
  await page
    .getByLabel("Details")
    .fill("Entry light is flickering during trading hours.");
  await page.getByLabel("Location or reference").fill("Front entry");
  await page.getByLabel("Photo", { exact: true }).setInputFiles({
    name: "shopfront-light.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("mock image bytes"),
  });
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(
    page.getByText("Shopfront light fault", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Front entry")).toBeVisible();
  await expect(page.getByText("1 file", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Compliance" })).toBeVisible();
  await expect(page.getByText("bright-cafe-insurance.pdf")).toBeVisible();
  await expect(
    page.getByText(
      /Insurance\s+-\s+45 KB\s+-\s+tenant onboarding\s+-\s+18 May 2026/,
    ),
  ).toBeVisible();
  await expect(page.getByText("Current certificate.")).toBeVisible();
  await expect(page.getByText("shopfront-light.jpg")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Notification Preferences" }),
  ).toBeVisible();
  await page.getByLabel("SMS updates").uncheck();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(
    page.getByText(/Saved .*Preferred channel: email/),
  ).toBeVisible();
});

test("tenant portal entry shows signed-out account access when Clerk is configured", async ({
  page,
}) => {
  test.skip(
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    "Runs only when tenant account auth is enabled.",
  );

  const response = await page.goto("/tenant-portal");
  test.skip(
    response?.status() === 404,
    "Tenant portal account entry route is not implemented yet.",
  );

  await expect(page.getByText("Account Access")).toBeVisible();
  await expect(
    page.getByText("Create or sign in to a tenant login"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create login" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("tenant portal entry shows linked account-scoped tenant data", async ({
  page,
}) => {
  test.skip(
    !process.env.LEASIUM_SMOKE_TENANT_PORTAL_ACCOUNT_ENTRY_LINKED ||
      !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    "Runs only with a signed-in tenant account smoke session.",
  );

  await page.unroute("**/api/v1/**");
  await mockLeasiumApi(page, { tenantAccountLinked: true });

  const response = await page.goto("/tenant-portal");
  test.skip(
    response?.status() === 404,
    "Tenant portal account entry route is not implemented yet.",
  );

  await expect(
    page.getByRole("heading", { name: "Bright Cafe" }),
  ).toBeVisible();
  await expect(page.getByText("Account linked")).toBeVisible();
  await expect(page.getByText("tenant_portal_account")).toBeVisible();
  await expect(
    page.getByText("Access is scoped to the tenant linked"),
  ).toBeVisible();
  await expect(page.getByText("INV-1001")).toBeVisible();
});

test("tenant portal entry guides signed-in tenants to recover an unlinked portal", async ({
  page,
}) => {
  test.skip(
    !process.env.LEASIUM_SMOKE_TENANT_PORTAL_ACCOUNT_ENTRY_UNLINKED ||
      !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    "Runs only with a signed-in tenant account smoke session.",
  );

  const response = await page.goto("/tenant-portal");
  test.skip(
    response?.status() === 404,
    "Tenant portal account entry route is not implemented yet.",
  );

  await expect(
    page.getByRole("heading", { name: "Open your portal" }),
  ).toBeVisible();
  await expect(page.getByText("No portal linked")).toBeVisible();
  await expect(
    page.getByText("Open your original tenant portal link once"),
  ).toBeVisible();
});

test("tenant portal token view guides relink when the signed-in account belongs to another tenant", async ({
  page,
}) => {
  test.skip(
    !process.env.LEASIUM_SMOKE_TENANT_PORTAL_ACCOUNT_RELINK_GUIDANCE ||
      !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    "Runs only with a signed-in tenant account smoke session.",
  );

  await page.unroute("**/api/v1/**");
  await mockLeasiumApi(page, {
    tenantAccountLinked: true,
    tenantAccountLinkedToDifferentTenant: true,
  });

  await page.goto("/tenant-portal/tenant-token-1");

  await expect(page.getByText("Different tenant")).toBeVisible();
  await expect(
    page.getByText("This login is already linked to another tenant portal."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Bright Cafe" }),
  ).toBeVisible();
});

test("settings shows Xero readiness and records mappings", async ({ page }) => {
  await page.setViewportSize({ width: 1432, height: 900 });
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  const brandSubtitle = page
    .getByText("Lease operations, automated", { exact: true })
    .first();
  const primaryNav = page.getByRole("navigation", { name: "Primary" });
  const settingsNavLink = page.getByRole("link", { name: "Settings" }).first();
  const searchButton = page.getByRole("button", { name: "Open search" });
  await expect(brandSubtitle).toBeVisible();
  await expect(primaryNav).toBeVisible();
  await expect(settingsNavLink).toBeVisible();
  await expect(searchButton).toBeVisible();
  const brandSubtitleFits = await brandSubtitle.evaluate(
    (node) => node.scrollWidth <= node.clientWidth + 1,
  );
  const primaryNavFits = await primaryNav.evaluate(
    (node) => node.scrollWidth <= node.clientWidth + 1,
  );
  const settingsNavFits = await settingsNavLink.evaluate(
    (node) => node.scrollWidth <= node.clientWidth + 1,
  );
  expect(brandSubtitleFits).toBe(true);
  expect(primaryNavFits).toBe(true);
  expect(settingsNavFits).toBe(true);
  await expect(page.getByText("Operator access")).toBeVisible();
  await expect(page.getByText("Owner Operator").first()).toBeVisible();
  await expect(page.getByText("Work email on").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mute work email" }).first(),
  ).toBeVisible();
  await expect(page.getByText("Daily digest").first()).toBeVisible();
  await expect(page.getByText("Last digest preview").first()).toBeVisible();
  await expect(page.getByText("No messages sent").first()).toBeVisible();
  await expect(
    page.getByLabel("Owner Operator work digest").first(),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Xero" }).click();
  await expect(page.getByText("Xero sync exception queue")).toBeVisible();
  await expect(page.getByText("Xero is not connected")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect Xero" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply suggestion" }),
  ).toBeVisible();

  await page.getByLabel("Xero tenant ID").fill("tenant-smoke");
  await page.getByRole("button", { name: "Save status" }).click();
  await expect(
    page.getByText("Connected", { exact: true }).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Connect with Xero" }).click();
  await expect(page.getByText("Provider connected").first()).toBeVisible();

  await page.getByRole("button", { name: "Preview contacts" }).click();
  await expect(
    page.getByText("Xero contact preview", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Contacts fetched")).toBeVisible();
  await expect(page.getByText("Bright Cafe").first()).toBeVisible();
  await expect(
    page.getByText("Suggested Xero contact: Bright Cafe"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Apply selected mappings" }).click();
  await expect(page.getByText("1 applied")).toBeVisible();
  await expect(page.getByText("0 skipped")).toBeVisible();
  await expect(
    page.getByText(
      "No invoice posting, tenant email, or payment reconciliation",
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Preview chart/tax" }).click();
  await expect(page.getByText("Xero chart/tax preview")).toBeVisible();
  await expect(page.getByText("0/1 ready").first()).toBeVisible();
  await expect(
    page.getByText("Taxable charge is missing a Xero tax type."),
  ).toBeVisible();
  await expect(page.getByText("No invoice posting").first()).toBeVisible();

  await expect(
    page.getByText("Base Rent tax type missing").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Apply suggestion" }).click();
  await expect(
    page.getByText("Chart and tax mappings look ready"),
  ).toBeVisible();
  await expect(page.getByText("Needs Xero approval")).toBeVisible();

  await page.getByRole("button", { name: "Preview chart/tax" }).click();
  await expect(page.getByText("1/1 ready").first()).toBeVisible();
  await expect(page.getByText("Rental Income")).toBeVisible();
  await expect(page.getByText("GST on Income")).toBeVisible();

  await page.getByRole("button", { name: "Review posting" }).click();
  await expect(page.getByText("Xero invoice posting preview")).toBeVisible();
  await expect(page.getByText("1 ready").first()).toBeVisible();
  await expect(page.getByText("0 blocked").first()).toBeVisible();
  await expect(
    page.getByText(
      "This preview does not post to Xero, email tenants, or reconcile payments.",
    ),
  ).toBeVisible();
  await expect(page.getByText("acct 401 / tax OUTPUT")).toBeVisible();

  await page.getByRole("button", { name: "Approve Xero" }).click();
  await expect(page.getByText("Approved for Xero")).toBeVisible();
  await expect(
    page.getByText("Xero draft posting was explicitly approved locally."),
  ).toBeVisible();
  await expect(
    page.getByText("Run idempotent Xero draft creation when ready."),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open Billing handoff" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Create Xero drafts" }).click();
  await expect(page.getByText("Xero draft creation result")).toBeVisible();
  await expect(
    page.getByText("Xero draft invoice was created after explicit approval."),
  ).toBeVisible();
  await expect(page.getByText("xero-invoice-smoke-1").first()).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open dispatch handoff" }),
  ).toBeVisible();
  await expect(
    page.getByText("Xero payment status needs review"),
  ).toBeVisible();

  await expect(
    page.getByRole("button", { exact: true, name: "Review payments" }),
  ).toBeVisible();
  await page
    .getByRole("button", { exact: true, name: "Review payments" })
    .click();
  await expect(page.getByText("Payment reconciliation review")).toBeVisible();
  await expect(
    page.getByText("Payment status can be reconciled locally."),
  ).toBeVisible();
  await expect(page.getByText("Current unpaid / Proposed paid")).toBeVisible();
  await expect(page.getByText("high confidence")).toBeVisible();
  await expect(page.getByText("No bank write")).toBeVisible();
  await expect(page.getByText("Ref INV-1001")).toBeVisible();
  await expect(page.getByText("Bank bank-txn-smoke-1")).toBeVisible();
  await page.getByRole("button", { name: "Apply provider payments" }).click();
  await expect(
    page.getByText("Payment status was reconciled locally."),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open reconciliation handoff" }),
  ).toBeVisible();
  await expect(page.getByText("No Xero sync exceptions")).toBeVisible();

  await page.goto("/billing-readiness");
  await page.getByRole("tab", { name: /Dispatch & reconcile/ }).click();
  await expect(page.getByText("Xero DRAFT").first()).toBeVisible();
  const primaryDispatchRow = page.getByRole("row").filter({
    hasText: "INV-1001",
  });
  await primaryDispatchRow
    .getByRole("button", { exact: true, name: "Dispatch" })
    .click();
  await expect(page.getByText("Xero receipt created #1")).toBeVisible();
  await expect(
    page.getByText("Xero draft and tenant email are recorded."),
  ).toBeVisible();
  await expect(primaryDispatchRow.getByText("Provider history")).toBeVisible();
  await expect(
    page.getByText("Payment status was reconciled locally."),
  ).toBeVisible();
  await expect(primaryDispatchRow.getByText("high confidence")).toBeVisible();
  await expect(
    primaryDispatchRow.getByText("Bank feed was not mutated."),
  ).toBeVisible();
  await page.getByRole("button", { name: /Complete/ }).click();
  await expect(page.getByText("INV-1001").first()).toBeVisible();
  await page.getByRole("button", { name: /Unpaid/ }).click();
  await expect(page.getByText("INV-1002").first()).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "INV-1001" }),
  ).toHaveCount(0);
});

test("insights shows overview, exceptions, activity, and owner snapshot", async ({
  page,
}) => {
  await page.goto("/insights");

  await expect(
    page.getByRole("heading", { exact: true, name: "Insights" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Live Exceptions" }),
  ).toBeVisible();
  await expect(page.getByText("Insurance certificate renewal")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Automation Activity" }),
  ).toBeVisible();
  await expect(page.getByText("Created reviewed lease records")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Owner / Entity Snapshot" }),
  ).toBeVisible();
  await expect(page.getByText("Trust", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Finance Snapshot" }),
  ).toBeVisible();
  await expect(page.getByText("Approved not synced").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Lease Events" }),
  ).toBeVisible();
  await expect(page.getByText("Bright Cafe Pty Ltd rent review")).toBeVisible();

  await page.getByRole("button", { name: "Generate link" }).click();
  await expect(page.getByText("Snapshot link ready")).toBeVisible();
  await page.getByRole("link", { name: "Open snapshot" }).click();

  await expect(page).toHaveURL(/\/snapshots\/snapshot-token-1$/);
  await expect(page.getByText("Frozen view")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Owner / Entity Snapshot" }),
  ).toBeVisible();
});
