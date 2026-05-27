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
  await expect(page.getByText("invoice_delivery v1").first()).toBeVisible();
  await page.getByText("Message preview").first().click();
  await expect(
    page.getByText("Please find your invoice attached.").first(),
  ).toBeVisible();

  await page.getByRole("tab", { name: /Dispatch & reconcile/ }).click();
  await expect(
    page.getByRole("heading", { name: "Month-end checklist" }),
  ).toBeVisible();
  await expect(
    page.getByText("1 provider recovery needs attention before month end."),
  ).toBeVisible();
  await expect(
    page.getByText("2 approved invoices are still unpaid locally."),
  ).toBeVisible();
  await expect(
    page.getByText("Owner statements", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("ready for preview and dispatch review"),
  ).toBeVisible();
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

  await page.getByRole("link", { name: "Open statements" }).click();
  await expect(page).toHaveURL(/\/statements\?.*month=2026-05/);
  await expect(
    page.getByRole("heading", { name: "Owner statements" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Statement pack readiness" }),
  ).toBeVisible();
  await expect(page.getByText("Statement pack blocked")).toBeVisible();
  await expect(page.getByText("2 statement invoices")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Queen Street Property Trust" }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Statement preview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Print / save PDF" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download accountant pack" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download PDF" }),
  ).toBeVisible();
  await expect(
    page.getByText("Owner statement", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Dispatch review" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy dispatch draft" }),
  ).toBeVisible();
  await expect(page.getByText("Review only. This does not send")).toBeVisible();
});

test("dashboard Leasium AI panel answers with cited record", async ({
  page,
}) => {
  await page.goto("/");

  const askPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: /^Leasium AI/ }),
  });
  await expect(askPanel).toBeVisible();
  await expect(
    askPanel.getByText(/Read-only — Leasium AI will never act on a question/),
  ).toBeVisible();

  await askPanel
    .getByRole("button", { name: "Which properties are vacant right now?" })
    .click();

  await expect(
    askPanel.getByText(
      "1 lease expires within the next 90 days: Queen Street Retail Centre on 2026-07-15.",
    ),
  ).toBeVisible();
  await expect(askPanel.getByText("Sources")).toBeVisible();
  await expect(
    askPanel.getByRole("link", {
      name: /Property · Queen Street Retail Centre/,
    }),
  ).toBeVisible();
});

test("Properties multi-view toggles between table and board", async ({
  page,
}) => {
  await page.goto("/properties");

  // Table is the default — table headers visible.
  await expect(page.locator("table").first()).toBeVisible();

  await page.getByRole("tab", { name: "Board" }).click();
  // Switching to board hides the table headers; columns rendered by
  // occupancy bucket appear instead.
  await expect(page.locator("table")).toHaveCount(0);
  await expect(page.getByText("Queen Street Retail Centre")).toBeVisible();
  await expect(page.getByText("No units").first()).toBeVisible();
  await expect(page).toHaveURL(/[?&]view=board/);

  await page.getByRole("tab", { name: "Table" }).click();
  await expect(page.locator("table").first()).toBeVisible();
});

test("AI inbox classifies a pasted message and surfaces a deep-link", async ({
  page,
}) => {
  await page.goto("/inbox");

  await expect(page.getByRole("heading", { name: "AI inbox" })).toBeVisible();
  await page.getByRole("button", { name: "Try sample" }).click();
  await page.getByRole("button", { name: /Classify/ }).click();

  await expect(page.getByText(/Maintenance request/i).first()).toBeVisible();
  await expect(
    page.getByText("Tenant reports a slow kitchen tap leak."),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Take it from here/ }),
  ).toBeVisible();
});

test("AI inbox promotes a classified message into a maintenance draft", async ({
  page,
}) => {
  await page.goto("/inbox");

  await page.getByRole("button", { name: "Try sample" }).click();
  await page.getByRole("button", { name: /Classify/ }).click();

  const promotePanel = page.getByTestId("promote-panel");
  await expect(promotePanel).toBeVisible();
  await expect(
    promotePanel.getByText(/Create maintenance work order/i),
  ).toBeVisible();

  // The AI-suggested property + tenant should be pre-filled in the
  // dropdowns from the triage response.
  await expect(promotePanel.getByLabel("Promote property")).toHaveValue(
    "11111111-1111-1111-1111-111111111111",
  );
  await expect(promotePanel.getByLabel("Promote tenant")).toHaveValue(
    "22222222-2222-2222-2222-222222222222",
  );

  await promotePanel.getByRole("button", { name: /Promote to draft/ }).click();
  await expect(page).toHaveURL(
    /\/operations\/maintenance\/99999999-9999-9999-9999-999999999999/,
  );
});

test("AI inbox vendor classification offers a contractor picker", async ({
  page,
}) => {
  // Override triage + promote to exercise the vendor_or_contractor path.
  // The default mockLeasiumApi returns maintenance_request; per-test
  // routes registered before goto win.
  await page.route("**/api/v1/ai/triage", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        kind: "vendor_or_contractor",
        confidence: 0.7,
        summary: "New locksmith introducing themselves to the panel.",
        suggested_action: "Add Sam's Locksmiths to the directory.",
        suggested_target_kind: "smart_intake",
        suggested_target_href: "/contractors",
        suggested_property: null,
        suggested_tenant: null,
        suggested_lease: null,
        suggested_contractor: null,
        key_facts: [{ label: "Trade", value: "Locksmith" }],
        warnings: [],
        guardrails: [],
        response_id: "resp_vendor_smoke",
      }),
    });
  });

  await page.route("**/api/v1/ai/triage/promote", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        target_kind: "contractor",
        target_id: "33333333-3333-3333-3333-333333333333",
        target_href: "/contractors",
        target_label: "Sam Lock",
      }),
    });
  });

  await page.goto("/inbox");
  await page.getByRole("button", { name: "Try sample" }).click();
  await page.getByRole("button", { name: /Classify/ }).click();

  const promotePanel = page.getByTestId("promote-panel");
  await expect(promotePanel).toBeVisible();
  await expect(
    promotePanel.getByText(/Add to contractor directory/i),
  ).toBeVisible();

  // The contractor picker is shown for vendor_or_contractor (with the
  // "Create new contractor" empty option), not the property/tenant
  // dropdowns.
  await expect(promotePanel.getByLabel("Promote contractor")).toBeVisible();
  await expect(promotePanel.getByLabel("Promote contractor")).toHaveValue("");

  await promotePanel.getByRole("button", { name: /Promote to draft/ }).click();
  await expect(page).toHaveURL(/\/contractors/);
});

test("AI inbox tenant contact classification applies selected fields", async ({
  page,
}) => {
  await page.route("**/api/v1/ai/triage", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        kind: "tenant_contact",
        confidence: 0.84,
        summary: "Tenant wants billing contact details updated.",
        suggested_action: "Review the proposed tenant contact changes.",
        suggested_target_kind: "tenant",
        suggested_target_href: "/tenants",
        suggested_property: null,
        suggested_tenant: {
          id: "22222222-2222-2222-2222-222222222222",
          label: "Acme Bakery",
        },
        suggested_lease: null,
        suggested_contractor: null,
        key_facts: [
          { label: "New email", value: "accounts@acmebakery.example" },
        ],
        warnings: [],
        guardrails: [],
        response_id: "resp_tenant_contact_smoke",
      }),
    });
  });

  await page.goto("/inbox");
  await page.getByRole("button", { name: "Try sample" }).click();
  await page.getByRole("button", { name: /Classify/ }).click();

  const promotePanel = page.getByTestId("promote-panel");
  await expect(promotePanel).toBeVisible();
  await expect(
    promotePanel.getByText(/Update tenant contact details/i),
  ).toBeVisible();
  await expect(promotePanel.getByLabel("Promote tenant")).toHaveValue(
    "22222222-2222-2222-2222-222222222222",
  );

  await promotePanel.getByRole("button", { name: "Prepare updates" }).click();
  await expect(
    promotePanel.getByText("Proposed: accounts@acmebakery.example"),
  ).toBeVisible();
  await expect(promotePanel.getByText("Proposed: 0411 222 333")).toBeVisible();

  await promotePanel
    .getByRole("button", { name: "Apply selected fields" })
    .click();
  await expect(page).toHaveURL(
    /\/tenants\/22222222-2222-2222-2222-222222222222/,
  );
});

test("tenants saved views capture and re-apply filter combos", async ({
  page,
}) => {
  await page.goto("/tenants");

  // Pick a non-default filter so the saved view has something to capture.
  await page.getByRole("button", { name: "Submitted" }).click();

  // Open the saved-views menu, name it, save.
  await page
    .getByRole("button", { name: /^(Saved views|Custom view|No saved views)/ })
    .click();
  const nameInput = page.getByLabel("Save current view as");
  await expect(nameInput).toBeEnabled();
  await nameInput.fill("Submitted only");
  await page.getByRole("button", { name: /Save/ }).first().click();

  // The chip should now reflect the saved view name.
  await expect(
    page.getByRole("button", { name: /^Submitted only/ }).first(),
  ).toBeVisible();

  // Switch to "All" — the chip should fall back to "Saved views" or
  // "No saved views" (no longer "Submitted only").
  await page.getByRole("button", { name: "All", exact: true }).first().click();

  // Reopen the menu and re-apply the saved view; filter pill should
  // highlight Submitted again.
  await page
    .getByRole("button", { name: /^(Saved views|Custom view)/ })
    .click();
  await page
    .getByRole("button", { name: /^Submitted only$/ })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Submitted", exact: true }),
  ).toBeVisible();
});

test("tenants table inline-edits contact email", async ({ page }) => {
  await page.goto("/tenants");

  // Find the first Add email / contact_email inline cell. The aria-label
  // is dynamic to the tenant name, so we match the "Contact email"
  // prefix.
  const editButton = page
    .getByRole("button", { name: /^Edit Contact email for / })
    .first();
  await editButton.click();

  const input = page.getByLabel(/^Contact email for /).first();
  await expect(input).toBeFocused();
  await input.fill("inline.edit@example.com");
  await input.press("Enter");

  // After save, the read-only inline-edit button reappears with the new value.
  await expect(
    page
      .getByRole("button", { name: /^Edit Contact email for / })
      .filter({ hasText: "inline.edit@example.com" })
      .first(),
  ).toBeVisible();
});

test("keyboard cheatsheet lists global and Go-to shortcuts", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Show keyboard shortcuts" }).click();

  await expect(
    page.getByRole("heading", { name: "Keyboard shortcuts" }),
  ).toBeVisible();
  await expect(page.getByText("Open command search")).toBeVisible();
  await expect(page.getByText("Show this keyboard cheatsheet")).toBeVisible();
  await expect(page.getByText("Dashboard").last()).toBeVisible();
  await expect(page.getByText("Properties").last()).toBeVisible();
  await expect(page.getByText("Tenants").last()).toBeVisible();
  // The Go-to legend itself appears in the cheatsheet.
  await expect(page.getByText("Go to (press G, then…)")).toBeVisible();
});

test("dashboard activity feed groups recent audit rows", async ({ page }) => {
  await page.goto("/");

  const activityPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Recent activity" }),
  });
  await expect(activityPanel).toBeVisible();
  await expect(
    activityPanel.getByText(
      "Approved invoice INV-1001 for May rent and outgoings.",
    ),
  ).toBeVisible();
  await expect(activityPanel.getByText("Today")).toBeVisible();
  await expect(activityPanel.getByText("Yesterday")).toBeVisible();
  await expect(
    activityPanel.getByRole("link", {
      name: /Approved INV-1001/,
    }),
  ).toBeVisible();
});

test("portfolio QA guides cleanup fixes and source trails", async ({
  page,
}) => {
  await page.goto("/portfolio-qa");

  await expect(
    page.getByRole("heading", { name: "Portfolio QA" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Cleanup readiness report" }),
  ).toBeVisible();
  await expect(page.getByText("Public enrichment candidates")).toBeVisible();
  await expect(page.getByText("Blocked follow-ups")).toBeVisible();
  await expect(page.getByText("Register cleanup still blocked")).toBeVisible();
  await expect(page.getByText("Final report")).toBeVisible();
  const readinessPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Cleanup readiness report" }),
  });
  await expect(
    readinessPanel.getByText("Eagle Street Office is missing owner ABN"),
  ).toBeVisible();

  const ownerPanel = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Owner and billing guided fixes",
    }),
  });
  await ownerPanel.getByRole("button", { name: "Stage suggestions" }).click();
  await expect(
    ownerPanel.getByText("Review staged owner billing suggestions"),
  ).toBeVisible();
  await expect(ownerPanel.getByText("Eagle Street Office")).toBeVisible();
  await ownerPanel.getByLabel("Owner ABN").fill("33123456789");
  await ownerPanel
    .getByLabel("Invoice issuer")
    .fill("Eagle Street Trustee Pty Ltd");
  await ownerPanel.getByLabel("Billing contact").fill("Noah Accounts");
  await ownerPanel
    .getByLabel("Billing email")
    .fill("owners@eaglestreet.example");
  await ownerPanel.getByRole("button", { name: "Save fix" }).click();
  await expect(
    page.getByText("Eagle Street Office billing identity saved."),
  ).toBeVisible();

  await page
    .getByRole("button", { name: /Tenant contacts Clean invite details/ })
    .click();
  const contactPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Tenant contact enrichment" }),
  });
  await contactPanel.getByRole("button", { name: "Stage suggestions" }).click();
  await expect(
    contactPanel.getByText("Review staged tenant suggestions"),
  ).toBeVisible();
  await expect(contactPanel.getByText("Northwind Fitness")).toBeVisible();
  await contactPanel
    .getByLabel("Billing email")
    .fill("accounts@northwind.example");
  await contactPanel.getByRole("button", { name: "Save fix" }).click();
  await expect(
    contactPanel.getByText("Tenant contact data is complete"),
  ).toBeVisible();

  await page
    .getByRole("button", { name: /Onboarding prep Ready or blocked/ })
    .click();
  const onboardingPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Batch tenant onboarding prep" }),
  });
  await expect(onboardingPanel.getByText("Invite blocker review")).toBeVisible();
  await expect(onboardingPanel.getByText("Ready invites")).toBeVisible();
  await expect(onboardingPanel.getByText("Existing invites")).toBeVisible();
  await expect(onboardingPanel.getByText("Northwind Fitness")).toBeVisible();
  await page.getByRole("button", { name: "Select ready" }).click();
  await page.getByRole("button", { name: "Send selected invites" }).click();
  await expect(page.getByText("1 invite links created.")).toBeVisible();

  await page
    .getByRole("button", { name: /Billing drafts Prepare internal drafts/ })
    .click();
  const billingPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Billing draft generation" }),
  });
  await expect(billingPanel.getByText("Billing cleanup blockers")).toBeVisible();
  await expect(
    billingPanel.getByText("Billing readiness blockers"),
  ).toBeVisible();
  await expect(billingPanel.getByText("Missing Xero tax type")).toBeVisible();

  await page
    .getByRole("button", { name: /Source history Spreadsheet and intake trails/ })
    .click();
  await expect(
    page.getByText("Acme portfolio register.xlsx").first(),
  ).toBeVisible();
  await expect(page.getByText("Properties row 12").first()).toBeVisible();
  await page.getByPlaceholder("Search sources").fill("public enrichment");
  const sourcePanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Source and apply history" }),
  });
  await expect(
    sourcePanel.getByText(/Bright Cafe .* public enrichment/),
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
  await page.getByText("Message preview").click();
  await expect(
    page.getByText("Leasium Daily Work digest: 4 items"),
  ).toBeVisible();
  await expect(page.getByText("- Air conditioning fault")).toBeVisible();
  await page.getByRole("button", { name: "Send digest" }).click();
  await expect(page.getByText("1 email queued")).toBeVisible();
  await expect(
    page.getByText("Digest email was queued by SendGrid."),
  ).toBeVisible();
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
  const queueMaintenanceLink = page.getByRole("link", {
    name: /Air conditioning fault.*Maintenance/,
  });
  await expect(queueMaintenanceLink).not.toBeVisible();
  await expect(page.getByText("Bright Cafe arrears")).not.toBeVisible();
  await page
    .getByLabel("Queue assignee")
    .selectOption({ label: "Temba van Jaarsveld" });
  await expect(queueMaintenanceLink).toBeVisible();
  await expect(page.getByText("Bright Cafe arrears")).not.toBeVisible();
  await page.getByLabel("Queue assignee").selectOption("unassigned");
  await expect(page.getByText("Insurance certificate renewal")).toBeVisible();
  await expect(queueMaintenanceLink).not.toBeVisible();
  await page.getByLabel("Queue assignee").selectOption("all");

  await page.getByRole("tab", { name: /Maintenance/ }).click();
  await expect(page.getByText("Cool Air Services")).toBeVisible();
  await expect(
    page.getByText("Assigned to Temba van Jaarsveld").first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Edit Status for Air conditioning fault" })
    .click();
  await page
    .getByLabel("Status for Air conditioning fault", { exact: true })
    .selectOption("triaged");
  await expect(page.getByText("Status changed to triaged")).toBeVisible();
  await expect(
    page.getByText("Air conditioning fault was previously awaiting approval."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Status changed to triaged")).not.toBeVisible();
  await expect(
    page
      .getByRole("button", { name: "Edit Status for Air conditioning fault" })
      .filter({ hasText: "Awaiting approval" }),
  ).toBeVisible();
  const completionReviewLink = page
    .getByRole("link", { name: "Review completion" })
    .first();
  await expect(completionReviewLink).toBeVisible();
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
      .locator("dd")
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
  await page.getByRole("tab", { name: /Maintenance/ }).click();
  await completionReviewLink.click();
  await expect(page).toHaveURL(/\/operations\/maintenance\/work-order-1/);
  await expect(page.getByText("Job completion handoff")).toBeVisible();
});

test("operations workspace keeps mobile rows compact", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/operations");

  await expect(
    page.getByRole("heading", { name: "Operations", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Air conditioning fault")).toBeVisible();

  const queueControls = page
    .locator("summary")
    .filter({ hasText: "Work controls" })
    .first();
  const airconAssignee = page
    .getByLabel("Work controls owner selector: Air conditioning fault")
    .first();
  await expect(queueControls).toBeVisible();
  await expect(queueControls).toContainText(
    "Unassigned - urgent / awaiting approval",
  );
  await expect(airconAssignee).not.toBeVisible();
  await queueControls.click();
  await expect(airconAssignee).toBeVisible();

  await page.getByRole("tab", { name: /Maintenance/ }).click();
  const workOrderActions = page
    .locator("summary")
    .filter({ hasText: "Work-order actions" })
    .first();
  await expect(workOrderActions).toBeVisible();
  await expect(workOrderActions).toContainText(
    "Unassigned - urgent - awaiting approval",
  );
  await expect(
    page.getByRole("link", { name: "Open completion review" }).first(),
  ).not.toBeVisible();
  await workOrderActions.click();
  await expect(
    page.getByRole("link", { name: "Open completion review" }).first(),
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
  await expect(page.getByText("Email actionable")).toBeVisible();
  await expect(page.getByText("SMS actionable")).toBeVisible();
  await expect(page.getByText("In-app read-only")).toBeVisible();
  await expect(
    page.getByText(
      "Email actions are available, but SendGrid is not fully configured.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "SMS actions are available, but Twilio is not fully configured.",
    ),
  ).toBeVisible();
  await page.getByText("Provider setup checks").click();
  await expect(page.getByText("Email / SendGrid sender")).toBeVisible();
  await expect(page.getByText("SMS / Twilio status callback")).toBeVisible();
  await expect(
    page.getByText(
      "https://api.leasium.test/api/v1/work-assignments/webhooks/sendgrid-events",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Air conditioning fault", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Bright Cafe arrears", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Attention 1/ }).click();
  await expect(
    page.getByText("Bright Cafe arrears", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Air conditioning fault", { exact: true }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: /^All 2$/ }).click();
  await expect(
    page.getByText("Air conditioning fault", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Email 2$/ }).click();
  await expect(
    page.getByText("Bright Cafe arrears", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Air conditioning fault", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Latest provider event").first()).toBeVisible();
  await expect(
    page.getByText("Provider Notification Attempted").first(),
  ).toBeVisible();
  await expect(page.getByText("Message preview").first()).toBeVisible();
  await page.getByText("Message preview").first().click();
  await expect(
    page.getByText("Leasium work assigned: Air conditioning fault"),
  ).toBeVisible();
  await expect(
    page.getByText("Maintenance has been assigned to you in Leasium.").first(),
  ).toBeVisible();
  await expect(
    page.getByText("Retry the assignment email from this page."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry notice" }).click();
  await expect(
    page.getByText("Assignment notification email was queued.").first(),
  ).toBeVisible();
  await page.getByText("Message preview").nth(1).click();
  await expect(
    page.getByText("Leasium work assigned: Bright Cafe arrears"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Send SMS" }).last().click();
  await expect(
    page.getByText("Twilio Messaging is not configured.").first(),
  ).toBeVisible();
  await page.getByText("Message preview").nth(2).click();
  await expect(
    page.getByText("Leasium: Maintenance assigned to Temba van Jaarsveld"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry SMS" })).toBeVisible();
  await expect(page.getByText("Digest history")).toBeVisible();
  await expect(page.getByText("Owner Operator").first()).toBeVisible();
  await expect(page.getByText("No messages sent").first()).toBeVisible();
  await page.getByText("Message preview").last().click();
  await expect(
    page.getByText("Leasium Daily Work digest: 4 items"),
  ).toBeVisible();
  await expect(page.getByText("Send digest from this page.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Needs send 1/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Preview only 1/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Send digest" }).click();
  await expect(
    page.getByText("Digest email was queued by SendGrid."),
  ).toBeVisible();
  await expect(page.getByText("Email queued").first()).toBeVisible();
  await expect(
    page.getByText("Digest Delivery Attempted").first(),
  ).toBeVisible();
  await page.getByText("Receipt evidence").last().click();
  await expect(page.getByText("sg-digest-smoke-retry").first()).toBeVisible();
  await expect(
    page.getByText("Wait for the SendGrid delivery receipt."),
  ).toBeVisible();
  await page.getByRole("button", { name: /Sent 1/ }).click();
  await expect(page.getByText("Owner Operator").first()).toBeVisible();
  await page.getByRole("button", { name: /^Email 1$/ }).click();
  await expect(page.getByText("Owner Operator").first()).toBeVisible();
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
  await expect(page.getByText("Latest update")).toBeVisible();
  await expect(page.getByText("External visibility")).toBeVisible();
  await expect(
    page.getByText("2 tenant-visible · 0 contractor-visible"),
  ).toBeVisible();
  await expect(page.getByText("Provider evidence").first()).toBeVisible();
  await expect(page.getByText("Closeout trail")).toBeVisible();
  await expect(page.getByText("Internal audit").first()).toBeVisible();
  // Channel evidence disclosure renders the normalized contractor channel
  // receipt (this work order's mock email_delivery is in a failed state).
  await page.getByText("Channel evidence").click();
  await expect(page.getByText("Contractor email").first()).toBeVisible();
  await expect(
    page.getByText("To service@coolair.example").first(),
  ).toBeVisible();
  await expect(
    page.getByText("Template maintenance_contractor_update v1").first(),
  ).toBeVisible();
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
    page
      .getByText(/Please confirm your first available attendance window/)
      .last(),
  ).toBeVisible();
  await expect(page.getByText("07 3000 1111")).toBeVisible();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^SMS not sent$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Contractor SMS message" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Contractor SMS message" })
    .fill("Please text back your first available attendance window.");
  await page.getByRole("button", { name: "Send SMS" }).click();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^SMS Queued #1$/ })
      .first(),
  ).toBeVisible();
  await expect(page.getByText("SMS provider history")).toBeVisible();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^SMS attempt Queued #1$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^SMS receipt Queued #1$/ })
      .first(),
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
  await expect(page.getByText("Contractor closeout review")).toBeVisible();
  await expect(page.getByText("Needs contractor review")).toBeVisible();
  await expect(page.getByText("Tenant closeout review")).toBeVisible();
  await expect(page.getByText("Needs tenant review")).toBeVisible();
  await expect(
    page.getByText("Review this copy before sending anything outside Leasium."),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Review-only; no owner, tenant, contractor, email, or portal message is sent from this panel.",
    ),
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
  await page
    .getByRole("textbox", { name: "Tenant review note" })
    .fill("Tenant update reviewed for portal-safe wording.");
  await page.getByRole("button", { name: "Mark tenant reviewed" }).click();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Tenant review recorded$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText("Tenant update reviewed for portal-safe wording."),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Contractor review note" })
    .fill("Contractor follow-up copy reviewed before sending.");
  await page.getByRole("button", { name: "Mark contractor reviewed" }).click();
  await expect(
    page
      .locator("span")
      .filter({ hasText: /^Contractor review recorded$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText("Contractor follow-up copy reviewed before sending."),
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
    page.getByText("Owner approved attendance tomorrow morning."),
  ).toBeVisible();
  await expect(page.getByText("Tenant visible").last()).toBeVisible();
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

test("spreadsheet intake review supports bulk approval controls", async ({
  page,
}) => {
  await page.goto("/intake/spreadsheet");

  await expect(
    page.getByRole("heading", { name: "Spreadsheet Intake" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review workbook" }),
  ).toBeEnabled();

  await page.locator('input[type="file"]').setInputFiles({
    name: "portfolio-import.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("mock workbook"),
  });

  await expect(
    page.getByRole("heading", { name: "portfolio-import.xlsx" }),
  ).toBeVisible();
  await expect(page.getByText("Approve recommended")).toBeVisible();
  await expect(page.getByText("Ignore all")).toBeVisible();
  await expect(page.getByText("Needs review")).toBeVisible();
  await expect(page.getByText("Street address")).toBeVisible();
  await expect(page.getByText("Owner ABN")).toBeVisible();
  await expect(
    page.getByRole("table").getByText("Unit label is missing."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Ignore all" }).click();
  await expect(
    page.getByRole("button", { name: "Apply approved" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Approve recommended" }).click();
  await expect(
    page.getByRole("button", { name: "Apply approved" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Apply approved" }).click();
  await expect(page.getByText("Apply complete")).toBeVisible();
  await expect(page.getByText("1 properties")).toBeVisible();
});

test("tenant workspace supports search and the add tenant form", async ({
  page,
}) => {
  await page.goto("/tenants");

  await expect(
    page.getByRole("heading", { name: "Tenant workspace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      exact: true,
      name: "Bright Cafe (Bright Cafe Pty Ltd)",
    }),
  ).toBeVisible();

  await page.getByPlaceholder("Search tenants").fill("northwind");
  await expect(
    page.getByRole("button", {
      exact: true,
      name: "Northwind Fitness (Northwind Fitness Pty Ltd)",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      exact: true,
      name: "Bright Cafe (Bright Cafe Pty Ltd)",
    }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Send invite" }).first().click();
  await expect(page.getByLabel("Tenant name")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Contact email" }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: /^Property/ })).toBeVisible();
  await expect(page.getByRole("combobox", { name: /^Unit/ })).toBeVisible();
});

test("property workspace shows the evidence source trail", async ({ page }) => {
  await page.goto("/properties?entity_id=entity-1&property_id=property-1");

  await expect(
    page.getByRole("heading", { name: "Acme Holdings Pty Ltd" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/property_id=property-1/);
  await expect(
    page.getByAltText("Queen Street Retail Centre primary image"),
  ).toBeVisible();
  await expect(
    page.getByAltText("Queen Street Retail Centre primary image"),
  ).toHaveAttribute("src", /.+/);
  await page.getByRole("button", { name: "Find property images" }).click();
  await expect(page.getByText("Queen Street awning frontage")).toBeVisible();
  await expect(
    page.getByTestId("property-image-candidate-preview").first(),
  ).toBeVisible();
  await expect(page.getByText("88% confidence").first()).toBeVisible();
  await page.getByRole("button", { name: "Apply image" }).first().click();
  await expect(page.getByText("Queen Street awning frontage")).toBeVisible();
  await expect(page.getByTestId("selected-property-image")).toHaveAttribute(
    "src",
    /.+/,
  );
  await expect(page.getByTestId("selected-property-image")).toHaveClass(
    /object-cover/,
  );
  await expect(page.getByText("Queen Street Warehouse")).toBeVisible();
  await expect(page.getByText("Eagle Street Office")).toBeVisible();

  await page
    .getByRole("row", { name: /Queen Street Warehouse/ })
    .getByRole("button", {
      name: "Filter by ownership tag Queen Street Property Trust",
    })
    .click();
  await expect(page).toHaveURL(
    /owner_tag=queen(?:\+|%20)street(?:\+|%20)property(?:\+|%20)trust/,
  );
  await expect(page).toHaveURL(/property_id=property-1/);
  await expect(
    page.getByText("2 properties tagged Queen Street Property Trust"),
  ).toBeVisible();
  await expect(page.getByText("Ownership tag", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Showing properties with this ownership tag."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Clear ownership tag filter" }),
  ).toBeVisible();
  await expect(
    page.getByText("Queen Street Retail Centre").first(),
  ).toBeVisible();
  await expect(page.getByText("Queen Street Warehouse").first()).toBeVisible();
  await expect(page.getByText("Eagle Street Office")).toHaveCount(0);
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
  await expect(page.getByText("Invite another portal login")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send invite" })).toBeVisible();
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText("Portal invite sent.")).toBeVisible();
  await expect(page.getByText("tenant-subject-one")).toBeVisible();
  await expect(page.getByRole("button", { name: "Revoke" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Source history" }),
  ).toBeVisible();
  await expect(page.getByText("Tenant onboarding applied")).toBeVisible();
  await expect(page.getByText("Billing email").first()).toBeVisible();
  await expect(page.getByText("accounts@bright.example").first()).toBeVisible();
  await expect(page.getByText("Applied ABN")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Preview portal" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Preview portal" }).click();
  await expect(page).toHaveURL(
    /\/tenants\/tenant-1\/portal-preview\/onboarding-1/,
  );
  await expect(
    page.getByRole("heading", { name: "Tenant portal preview" }),
  ).toBeVisible();
  await expect(
    page.getByText("Operator preview", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/No tenant portal account is created/),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
  await expect(page.getByText("INV-1001")).toBeVisible();
  await expect(page.getByText("Contact change request")).toBeVisible();
  await expect(page.getByText("new.accounts@bright.example")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit for review" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Back to tenant" }).first().click();
  await expect(page).toHaveURL(/\/tenants\/tenant-1$/);

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

test("tenant detail sends lease pack after onboarding approval", async ({
  page,
}) => {
  type SmokeOnboardingRow = Record<string, unknown> & {
    delivery_data: Record<string, unknown>;
    review_data: Record<string, unknown>;
    status: string;
  };
  const submittedAt = "2026-05-19T09:10:00.000Z";
  let onboardingRow: SmokeOnboardingRow = {
    id: "onboarding-1",
    entity_id: "entity-1",
    lease_id: "lease-1",
    tenant_id: "tenant-1",
    token: "tenant-token-1",
    status: "submitted",
    due_date: "2026-05-29",
    expires_at: "2026-06-12T00:00:00.000Z",
    last_sent_at: "2026-05-18T09:30:00.000Z",
    resent_at: null,
    cancel_reason: null,
    onboarding_url: "http://127.0.0.1:3000/onboarding/tenant-token-1",
    portal_url: "http://127.0.0.1:3000/tenant-portal/tenant-token-1",
    submitted_data: {
      legal_name: "Bright Cafe Pty Ltd",
      contact_name: "Mia Hart",
      contact_email: "mia@example.com",
      contact_phone: "0400 111 222",
      accepted: true,
    },
    submitted_at: submittedAt,
    review_data: {},
    delivery_data: {
      channels: {
        email: {
          channel: "email",
          status: "sent",
          provider: "mock",
          attempted_at: "2026-05-18T09:30:00.000Z",
          recipient: "mia@example.com",
        },
      },
      lease_agreement: {
        status: "ready_to_sign",
        open_question_count: 0,
        questions: [],
        signed_at: null,
        signed_by_actor: null,
        signing_locked_reason: null,
      },
    },
    reviewed_at: null,
    reviewed_by_user_id: null,
    applied_at: null,
    applied_by_user_id: null,
    created_at: "2026-05-18T09:30:00.000Z",
    updated_at: submittedAt,
    deleted_at: null,
  };
  let reviewed = false;
  let applied = false;

  await page.route(
    /\/api\/v1\/tenant-onboarding(\/.*)?(\?.*)?$/,
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.replace(/^\/api\/v1/, "");
      if (request.method() === "GET" && path === "/tenant-onboarding") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([onboardingRow]),
        });
        return;
      }
      if (
        request.method() === "POST" &&
        path === "/tenant-onboarding/onboarding-1/review"
      ) {
        reviewed = true;
        onboardingRow = {
          ...onboardingRow,
          status: "reviewed",
          review_data: { approved: true, notes: null },
          reviewed_at: "2026-05-19T09:25:00.000Z",
          reviewed_by_user_id: "user-temba",
          updated_at: "2026-05-19T09:25:00.000Z",
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(onboardingRow),
        });
        return;
      }
      if (
        request.method() === "POST" &&
        path === "/tenant-onboarding/onboarding-1/apply"
      ) {
        applied = true;
        onboardingRow = {
          ...onboardingRow,
          status: "applied",
          applied_at: "2026-05-19T09:30:00.000Z",
          applied_by_user_id: "user-temba",
          updated_at: "2026-05-19T09:30:00.000Z",
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(onboardingRow),
        });
        return;
      }
      if (
        request.method() === "POST" &&
        path === "/tenant-onboarding/onboarding-1/send-lease-pack"
      ) {
        onboardingRow = {
          ...onboardingRow,
          delivery_data: {
            ...onboardingRow.delivery_data,
            lease_pack: {
              sent_at: "2026-05-21T00:20:00.000Z",
              sent_by_user_id: "user-temba",
              template_key: "tenant_lease_pack",
              template_version: "v1",
              receipts: [
                {
                  channel: "email",
                  status: "queued",
                  provider: "sendgrid",
                  recipient: "mi***@example.com",
                  provider_message_id: "lease-pack-msg-1",
                  error: null,
                  metadata: { template_key: "tenant_lease_pack" },
                },
              ],
            },
          },
          updated_at: "2026-05-21T00:20:00.000Z",
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(onboardingRow),
        });
        return;
      }
      await route.fallback();
    },
  );

  await page.goto("/tenants/tenant-1");

  await page.getByRole("button", { name: "Approve & apply" }).click();
  expect(reviewed).toBe(true);
  expect(applied).toBe(true);
  await expect(page.getByText("Lease pack next")).toBeVisible();
  await expect(
    page.getByText("Upload a custom lease before sending the tenant a signing link."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Send lease pack" })).toBeDisabled();

  await page.getByLabel("Custom lease file").setInputFiles({
    name: "custom-lease.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("custom lease bytes"),
  });
  await page.getByRole("button", { name: "Attach lease" }).click();
  await expect(page.getByText("custom-lease.pdf").first()).toBeVisible();

  await page.getByRole("button", { name: "Send lease pack" }).click();
  await expect(page.getByText("Lease pack sent to tenant.")).toBeVisible();
});

test("tenant portal invite is account-first before onboarding", async ({
  page,
}) => {
  test.skip(
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    "Runs only when tenant account auth is enabled.",
  );
  await page.goto("/tenant-portal/tenant-token-1");

  await expect(
    page.getByRole("heading", { name: "Bright Cafe" }),
  ).toBeVisible();
  await expect(page.getByText("Tenant Account Setup")).toBeVisible();
  await expect(page.getByText("Invite email")).toBeVisible();
  await expect(page.getByText("mia@example.com")).toBeVisible();
  await expect(page.getByText(/Sign in with a one-time code/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Send code" })).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue("mia@example.com");
  await expect(page.getByRole("heading", { name: "Payments" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Maintenance" })).toHaveCount(
    0,
  );
});

test("tenant portal invite handles missing tenant login setup", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
    "Runs only when tenant account auth is not configured.",
  );
  await page.goto("/tenant-portal/tenant-token-1");

  await expect(
    page.getByRole("heading", { name: "Bright Cafe" }),
  ).toBeVisible();
  await expect(page.getByText("Tenant Account Setup")).toBeVisible();
  await expect(page.getByText("Invite email")).toBeVisible();
  await expect(page.getByText("mia@example.com")).toBeVisible();
  await expect(page.getByText("Tenant login not configured")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payments" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Maintenance" })).toHaveCount(
    0,
  );
});

test("tenant portal onboarding room keeps setup focused", async ({ page }) => {
  test.skip(
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    "Runs only when tenant account auth is enabled.",
  );
  await mockLeasiumApi(page, { tenantAccountLinked: true });
  await page.goto("/tenant-portal");

  await expect(
    page.getByRole("heading", { name: "Let's get your tenancy ready." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Checklist" })).toBeVisible();
  const checklist = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Checklist" }),
  });
  await expect(
    checklist.getByText("Confirm details + upload docs"),
  ).toBeVisible();
  await expect(checklist.getByText("Property team review")).toBeVisible();
  await expect(checklist.getByText("Sign lease")).toBeVisible();
  await expect(checklist.getByText("Tenant account")).toHaveCount(0);
  await expect(checklist.getByText("Required documents")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Required Documents" }),
  ).toBeVisible();
  await expect(page.getByLabel("Legal name")).toBeVisible();
  await expect(page.getByLabel("Contact name")).toBeVisible();
  await expect(page.getByLabel("Contact email")).toBeVisible();
  await expect(page.getByLabel("Contact phone")).toBeVisible();
  await expect(page.getByLabel("ABN")).toBeHidden();
  await page.getByText("Add optional details").click();
  await expect(page.getByLabel("ABN")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payments" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Maintenance" })).toHaveCount(
    0,
  );
  await page
    .getByLabel(
      "I confirm the information above is correct to the best of my knowledge. My property manager will review before any changes apply.",
    )
    .check();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByRole("heading", { name: "Onboarding" })).toBeVisible();
  await expect(page.getByText("In review")).toBeVisible();
  await expect(
    page.getByText(/property manager will review and confirm/i),
  ).toBeVisible();
});

test("tenant lease entry handles missing tenant login setup", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
    "Runs only when tenant account auth is not configured.",
  );
  await page.goto("/tenant-portal/lease");

  await expect(
    page.getByRole("heading", { name: "Open your lease pack" }),
  ).toBeVisible();
  await expect(page.getByText("Tenant login not configured")).toBeVisible();
});

test("tenant lease page focuses signing without portal dashboard", async ({
  page,
}) => {
  test.skip(
    !process.env.LEASIUM_SMOKE_TENANT_PORTAL_ACCOUNT_ENTRY_LINKED ||
      !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    "Runs only with a signed-in tenant account smoke session.",
  );
  await page.unroute("**/api/v1/**");
  await mockLeasiumApi(page, {
    tenantAccountLinked: true,
    tenantPortalLeaseReady: true,
  });

  await page.goto("/tenant-portal/lease");

  await expect(
    page.getByRole("heading", { name: "Review and sign your lease" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Lease questions and signing" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lease document" })).toBeVisible();
  await expect(page.getByText("Attached")).toBeVisible();
  await expect(page.getByText("Ready to sign")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open full portal" }),
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Payments" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Maintenance" })).toHaveCount(
    0,
  );
});

test("tenant lease page confirms signing", async ({ page }) => {
  test.skip(
    !process.env.LEASIUM_SMOKE_TENANT_PORTAL_ACCOUNT_ENTRY_LINKED ||
      !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    "Runs only with a signed-in tenant account smoke session.",
  );
  await page.unroute("**/api/v1/**");
  await mockLeasiumApi(page, {
    tenantAccountLinked: true,
    tenantPortalLeaseReady: true,
  });

  await page.goto("/tenant-portal/lease");

  await page
    .getByLabel("I have reviewed and signed the lease agreement.")
    .check();
  await page.getByRole("button", { name: "Confirm signed" }).click();

  await expect(page.getByText("Complete")).toBeVisible();
  await expect(page.getByText(/Signed 21 May 2026/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open full portal" }),
  ).toHaveAttribute("href", "/tenant-portal");
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
    .getByText("Lease operations", { exact: true })
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
  await expect(page.getByText("Work notifications")).toBeVisible();
  await expect(page.getByText("Work email on").first()).toBeVisible();
  await expect(page.getByText("SMS ready").first()).toBeVisible();
  await expect(
    page.getByLabel("Owner Operator assignment email notifications").first(),
  ).toBeVisible();
  await expect(
    page.getByLabel("Owner Operator assignment SMS notifications").first(),
  ).toBeVisible();
  await expect(
    page.getByLabel("Owner Operator assignment SMS phone").first(),
  ).toHaveValue("+61400111222");
  await expect(
    page.getByLabel("Owner Operator assignment notice template key").first(),
  ).toHaveValue("work_assignment_notification");
  await expect(
    page.getByLabel("Owner Operator digest template key").first(),
  ).toHaveValue("work_assignment_digest");
  await expect(page.getByText("Template preview").first()).toBeVisible();
  await expect(
    page.getByText("New Leasium work assigned to Owner Operator").first(),
  ).toBeVisible();
  await expect(page.getByText("Daily digest").first()).toBeVisible();
  await expect(page.getByText("Last digest").first()).toBeVisible();
  await expect(page.getByText("No messages sent").first()).toBeVisible();
  await expect(
    page.getByLabel("Owner Operator work digest").first(),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Organisation" }).click();
  await expect(page.getByText("Communication templates")).toBeVisible();
  await expect(page.getByText("Invoice delivery").first()).toBeVisible();
  await expect(page.getByText("Stored template overrides")).toBeVisible();
  await expect(page.getByText("SKJ invoice delivery")).toBeVisible();
  await expect(page.getByText("Read-only")).toBeVisible();
  await expect(
    page.getByText("tenant_onboarding_invite").first(),
  ).toBeVisible();
  await expect(
    page.getByText("/api/v1/invoice-drafts/webhooks/sendgrid-events"),
  ).toBeVisible();
  await expect(page.getByText("Ownership tags")).toBeVisible();
  await expect(page.getByText("Queen Street Property Trust")).toBeVisible();
  await expect(page.getByText("Legal owner").first()).toBeVisible();
  await expect(page.getByText("Trust", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("2 properties")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open tagged properties" }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Queen Street Retail Centre/ }),
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

  await page.getByRole("link", { name: "Open dispatch handoff" }).click();
  await expect(page).toHaveURL(/\/billing-readiness/);
  await expect(page.getByText("Accounting missing")).toBeVisible();
  await expect(page.getByText("Reconciliation stale").first()).toBeVisible();
  const staleDispatchRow = page.getByRole("row").filter({
    hasText: "INV-1001",
  });
  await expect(
    staleDispatchRow.getByText("Payment check missing"),
  ).toBeVisible();
  await expect(staleDispatchRow.getByText("Review payments")).toBeVisible();
  await expect(
    page.getByText("1 Xero-linked payment review is open."),
  ).toBeVisible();

  await page.goto("/settings?tab=xero");
  const freshnessPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Accounting freshness snapshot" }),
  });
  await expect(freshnessPanel).toBeVisible();
  await expect(
    freshnessPanel.getByText("Reconciliation stale after"),
  ).toBeVisible();
  await expect(freshnessPanel.getByText("Contact preview")).toBeVisible();
  await expect(
    freshnessPanel.getByText(
      "1 open Xero-linked invoice needs a payment reconciliation preview.",
    ),
  ).toBeVisible();
  await expect(freshnessPanel.getByText("Next accounting step")).toBeVisible();
  await expect(
    freshnessPanel.getByText("Review Xero-linked payments"),
  ).toBeVisible();
  await expect(freshnessPanel.getByText("Open payment review")).toBeVisible();

  await expect(
    page.getByRole("button", { exact: true, name: "Review payments" }),
  ).toBeVisible();
  await page
    .getByRole("button", { exact: true, name: "Review payments" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Payment reconciliation review" }),
  ).toBeVisible();
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
  await expect(
    freshnessPanel.getByText("Reconciliation current"),
  ).toBeVisible();
  await expect(freshnessPanel.getByText("Payment source manual")).toBeVisible();
  await expect(
    freshnessPanel.getByText("Payment mode local payment status apply"),
  ).toBeVisible();
  await expect(
    freshnessPanel.getByText("Ready for month-end review"),
  ).toBeVisible();

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
  const financeSnapshotPanel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Finance Snapshot" }) });
  await expect(
    financeSnapshotPanel.getByText("Accounting readiness"),
  ).toBeVisible();
  await expect(
    financeSnapshotPanel.getByText("Source local metadata"),
  ).toBeVisible();
  await expect(
    financeSnapshotPanel.getByText("Reconciliation current"),
  ).toBeVisible();
  await expect(financeSnapshotPanel.getByText("Contacts ready")).toBeVisible();
  await expect(financeSnapshotPanel.getByText("Guardrails")).toBeVisible();
  await expect(financeSnapshotPanel.getByText("Chart")).toBeVisible();
  await expect(financeSnapshotPanel.getByText("Tax")).toBeVisible();
  await expect(financeSnapshotPanel.getByText("Open in Xero")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Lease Events" }),
  ).toBeVisible();
  await expect(page.getByText("Bright Cafe Pty Ltd rent review")).toBeVisible();

  await page.getByRole("button", { name: "Generate link" }).click();
  await expect(page.getByText("Snapshot link ready")).toBeVisible();
  await page.getByRole("link", { name: "Open snapshot" }).click();

  await expect(page).toHaveURL(/\/snapshots\/snapshot-token-1$/);
  await expect(page.getByText("Frozen view")).toBeVisible();
  const ownerSnapshotSection = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Owner / Entity Snapshot" }),
  });
  await expect(ownerSnapshotSection).toBeVisible();
  await expect(
    ownerSnapshotSection.getByText("Accounting readiness"),
  ).toBeVisible();
  await expect(
    ownerSnapshotSection.getByText("Source local metadata"),
  ).toBeVisible();
  await expect(ownerSnapshotSection.getByText("Guardrails")).toBeVisible();
});
