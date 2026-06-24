import { expect, type Locator, type Page, test } from "@playwright/test";

import { mockLeasiumApi, seedPrimaryEntitySelection } from "./api-mocks";

type WorkflowRule = {
  id: string;
  entity_id: string;
  name: string;
  description: string | null;
  trigger_type: "lease_expiring" | "arrears_threshold" | "compliance_due";
  trigger_config: Record<string, unknown>;
  actions: Array<{ type: string; config: Record<string, unknown> }>;
  enabled: boolean;
  last_evaluated_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type WorkflowProposal = {
  id: string;
  entity_id: string;
  rule_id: string;
  rule_name: string;
  trigger_type: WorkflowRule["trigger_type"];
  action_type: string;
  dedupe_key: string;
  target_table: string;
  target_id: string;
  title: string;
  summary: string;
  source: { table: string; id: string; label: string };
  evidence: Array<{ label: string; value: string }>;
  proposed_action: { type: string; config: Record<string, unknown> };
  generated_at: string;
};

const initialRule: WorkflowRule = {
  id: "workflow-rule-1",
  entity_id: "entity-1",
  name: "Lease expiry follow-up",
  description: "Create an internal task before lease expiry.",
  trigger_type: "lease_expiring",
  trigger_config: { days_before: 90 },
  actions: [
    {
      type: "create_task",
      config: { title: "Prepare lease renewal pack" },
    },
  ],
  enabled: true,
  last_evaluated_at: "2026-06-21T01:20:00.000Z",
  metadata: {},
  created_at: "2026-06-21T01:00:00.000Z",
  updated_at: "2026-06-21T01:00:00.000Z",
  deleted_at: null,
};

const initialProposals: WorkflowProposal[] = [
  {
    id: "workflow-rule-1:lease-1:create_task:expiry-2026-08-30",
    entity_id: "entity-1",
    rule_id: "workflow-rule-1",
    rule_name: "Lease expiry follow-up",
    trigger_type: "lease_expiring",
    action_type: "create_task",
    dedupe_key: "lease-expiry-create-task-1",
    target_table: "lease",
    target_id: "lease-1",
    title: "Prepare lease renewal pack",
    summary: "Queen Street Retail Centre lease expires on 30 Aug 2026.",
    source: {
      table: "lease",
      id: "lease-1",
      label: "Queen Street Retail Centre",
    },
    evidence: [
      { label: "Lease expiry", value: "30 Aug 2026" },
      { label: "Rule window", value: "90 days before expiry" },
    ],
    proposed_action: {
      type: "create_task",
      config: { title: "Prepare lease renewal pack" },
    },
    generated_at: "2026-06-21T01:30:00.000Z",
  },
  {
    id: "workflow-rule-1:lease-2:notify_operator:expiry-2026-08-15",
    entity_id: "entity-1",
    rule_id: "workflow-rule-1",
    rule_name: "Lease expiry follow-up",
    trigger_type: "lease_expiring",
    action_type: "notify_operator",
    dedupe_key: "lease-expiry-notify-operator-1",
    target_table: "lease",
    target_id: "lease-2",
    title: "Notify operator about Rivergum expiry",
    summary: "Rivergum Studio lease expires on 15 Aug 2026.",
    source: {
      table: "lease",
      id: "lease-2",
      label: "Rivergum Studio",
    },
    evidence: [
      { label: "Lease expiry", value: "15 Aug 2026" },
      { label: "Rule window", value: "90 days before expiry" },
    ],
    proposed_action: {
      type: "notify_operator",
      config: { message: "Check Rivergum renewal plan." },
    },
    generated_at: "2026-06-21T01:30:00.000Z",
  },
];

async function expectTouchTarget(control: Locator, minSize = 44) {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.width).toBeGreaterThanOrEqual(minSize);
  expect(box.height).toBeGreaterThanOrEqual(minSize);
}

async function installWorkflowRoutes(page: Page) {
  const rules: WorkflowRule[] = [{ ...initialRule }];
  const openProposals = new Map(
    initialProposals.map((proposal) => [proposal.dedupe_key, proposal]),
  );
  const forbiddenApiCalls: string[] = [];

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");
    const method = request.method();
    const forbiddenMutation =
      method !== "GET" &&
      /sendgrid|twilio|email|sms|xero|basiq|payment|reconciliation|provider-dispatch|provider-history/i.test(
        path,
      );

    if (forbiddenMutation) {
      forbiddenApiCalls.push(`${method} ${path}`);
      await route.fulfill({
        status: 418,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "workflow surface must stay review-first",
        }),
      });
      return;
    }

    await route.fallback();
  });

  await page.route("**/api/v1/workflows/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, "");

    if (method === "GET" && path === "/workflows/rules") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(rules),
      });
      return;
    }

    if (method === "POST" && path === "/workflows/rules") {
      const payload = request.postDataJSON() as Partial<WorkflowRule>;
      const rule: WorkflowRule = {
        id: `workflow-rule-${rules.length + 1}`,
        entity_id: String(payload.entity_id),
        name: String(payload.name),
        description:
          typeof payload.description === "string" ? payload.description : null,
        trigger_type: payload.trigger_type ?? "lease_expiring",
        trigger_config: payload.trigger_config ?? {},
        actions: payload.actions ?? [],
        enabled: payload.enabled === true,
        last_evaluated_at: null,
        metadata: payload.metadata ?? {},
        created_at: "2026-06-21T02:00:00.000Z",
        updated_at: "2026-06-21T02:00:00.000Z",
        deleted_at: null,
      };
      rules.push(rule);
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(rule),
      });
      return;
    }

    if (method === "GET" && path === "/workflows/queue") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          entity_id: "entity-1",
          proposals: Array.from(openProposals.values()),
          guardrail:
            "Workflow proposals are review-only until an operator approves one.",
          generated_at: "2026-06-21T02:05:00.000Z",
        }),
      });
      return;
    }

    if (
      method === "POST" &&
      (path === "/workflows/queue/approve" ||
        path === "/workflows/queue/dismiss")
    ) {
      const payload = request.postDataJSON() as {
        rule_id: string;
        dedupe_key: string;
      };
      const proposal = openProposals.get(payload.dedupe_key);
      if (proposal) {
        openProposals.delete(payload.dedupe_key);
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: `${payload.dedupe_key}-decision`,
          entity_id: "entity-1",
          rule_id: payload.rule_id,
          dedupe_key: payload.dedupe_key,
          target_table: proposal?.target_table ?? "lease",
          target_id: proposal?.target_id ?? "lease-1",
          action_type: proposal?.action_type ?? "create_task",
          decision: path.endsWith("/approve") ? "approved" : "dismissed",
          decided_by_user_id: "operator-1",
          decided_at: "2026-06-21T02:10:00.000Z",
          execution_result: path.endsWith("/approve")
            ? { status: "local_recorded" }
            : null,
          created_at: "2026-06-21T02:10:00.000Z",
          updated_at: "2026-06-21T02:10:00.000Z",
        }),
      });
      return;
    }

    await route.fallback();
  });

  return forbiddenApiCalls;
}

function workflowsSurface(page: Page) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Workflows" }) })
    .first();
}

test.beforeEach(async ({ page }) => {
  await seedPrimaryEntitySelection(page);
  await mockLeasiumApi(page);
});

test("workflows rules can be created without touching provider paths", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const forbiddenApiCalls = await installWorkflowRoutes(page);

  await page.goto("/operations?tab=workflows");

  const tabs = page.getByRole("tablist", { name: "Operations sections" });
  const workflowsTab = tabs.getByRole("tab", { name: /Workflows/ });
  await expect(workflowsTab).toHaveAttribute("aria-selected", "true");
  await expectTouchTarget(workflowsTab);

  const surface = workflowsSurface(page);
  await expect(surface).toBeVisible();
  await expect(surface).toContainText("Lease expiry follow-up");

  await surface.getByRole("button", { name: "New workflow" }).click();
  const editor = surface
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: "New workflow" }) });
  await expect(editor).toBeVisible();
  await editor.getByLabel("Name").fill("Lease expiry task rule");
  await editor.getByLabel("Days before").fill("75");
  await editor.getByLabel("Action").selectOption("create_task");

  const createRequestPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/v1/workflows/rules",
  );
  await editor.getByRole("button", { name: "Save rule" }).click();
  const createRequest = await createRequestPromise;

  expect(createRequest.postDataJSON()).toMatchObject({
    entity_id: "entity-1",
    name: "Lease expiry task rule",
    trigger_type: "lease_expiring",
    trigger_config: { days_before: 75 },
    actions: [{ type: "create_task" }],
    enabled: true,
  });
  await expect(surface).toContainText("Lease expiry task rule");
  expect(forbiddenApiCalls).toEqual([]);
});

test("workflows review queue approves and dismisses proposed actions locally", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const forbiddenApiCalls = await installWorkflowRoutes(page);

  await page.goto("/operations?tab=workflows");

  const surface = workflowsSurface(page);
  const queue = surface
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Review queue" }) });
  await expect(queue).toContainText("Prepare lease renewal pack");
  await expect(queue).toContainText("Queen Street Retail Centre");
  await expect(queue).toContainText("Lease expiry");

  const approveRow = queue
    .locator("article")
    .filter({ hasText: "Prepare lease renewal pack" });
  const approveRequestPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/v1/workflows/queue/approve",
  );
  await approveRow.getByRole("button", { name: "Approve proposal" }).click();
  const approveRequest = await approveRequestPromise;
  expect(approveRequest.postDataJSON()).toEqual({
    rule_id: "workflow-rule-1",
    dedupe_key: "lease-expiry-create-task-1",
  });
  await expect(queue).not.toContainText("Prepare lease renewal pack");

  const dismissRow = queue
    .locator("article")
    .filter({ hasText: "Notify operator about Rivergum expiry" });
  const dismissRequestPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/v1/workflows/queue/dismiss",
  );
  await dismissRow.getByRole("button", { name: "Dismiss proposal" }).click();
  const dismissRequest = await dismissRequestPromise;
  expect(dismissRequest.postDataJSON()).toEqual({
    rule_id: "workflow-rule-1",
    dedupe_key: "lease-expiry-notify-operator-1",
  });
  await expect(queue).toContainText("No workflow proposals.");
  expect(forbiddenApiCalls).toEqual([]);
});

test("mobile workflows keep tab and proposal controls touch-safe", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const forbiddenApiCalls = await installWorkflowRoutes(page);

  await page.goto("/operations?tab=workflows");

  const tabs = page.getByRole("tablist", { name: "Operations sections" });
  const workflowsTab = tabs.getByRole("tab", { name: /Workflows/ });
  await expect(workflowsTab).toHaveAttribute("aria-selected", "true");
  await expectTouchTarget(workflowsTab);

  const queue = workflowsSurface(page)
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Review queue" }) });
  const approveButton = queue
    .locator("article")
    .filter({ hasText: "Prepare lease renewal pack" })
    .getByRole("button", { name: "Approve proposal" });
  await expectTouchTarget(approveButton);
  expect(forbiddenApiCalls).toEqual([]);
});
