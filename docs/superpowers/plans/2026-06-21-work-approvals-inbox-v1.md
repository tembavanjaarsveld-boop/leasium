# Work Approvals Inbox v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Approvals tab to the Work hub so the operator can find approval-ready work without triggering provider, comms, payment, or reconciliation actions.

**Architecture:** Reuse the operations page's existing data queries and derive approval candidates client-side from Smart Intake, maintenance, invoice drafts, compliance checks, tenant onboarding, and assignment notice readiness. Render the inbox as a read-only tab with source links plus local copy/download review exports only. Keep provider mutation guardrails visible in the UI and trapped by smoke tests.

**Tech Stack:** Next.js App Router, React, TanStack Query, Playwright smoke tests, Leasium UI primitives, local CSV export helpers.

---

### Task 1: Smoke Test The Read-Only Approvals Inbox

**Files:**
- Create: `apps/web/tests/smoke/operations-approvals.spec.ts`

- [ ] **Step 1: Write the failing smoke test**

Create `apps/web/tests/smoke/operations-approvals.spec.ts` with one focused test:

```ts
import { expect, type Locator, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { mockLeasiumApi, seedPrimaryEntitySelection } from "./api-mocks";

test.beforeEach(async ({ page }) => {
  await seedPrimaryEntitySelection(page);
});

async function expectTouchTarget(control: Locator, minSize = 44) {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.width).toBeGreaterThanOrEqual(minSize);
  expect(box.height).toBeGreaterThanOrEqual(minSize);
}

function readyInvoiceDraft() {
  return {
    id: "invoice-draft-ready-approval-1",
    entity_id: "entity-1",
    billing_draft_id: "billing-draft-1",
    property_id: "property-1",
    tenancy_unit_id: "unit-1",
    tenant_id: "tenant-1",
    lease_id: "lease-1",
    document_id: "document-1",
    document_intake_id: "intake-1",
    status: "ready_for_approval",
    invoice_number: "INV-2001",
    title: "Owner recharge invoice",
    currency: "AUD",
    issue_date: "2026-06-01",
    due_date: "2026-06-15",
    subtotal_cents: 120000,
    gst_cents: 12000,
    total_cents: 132000,
    issuer_name: "Queen Street Trustee Pty Ltd",
    issuer_abn: "22123456789",
    recipient_name: "Bright Cafe Pty Ltd",
    recipient_email: "accounts@bright.example",
    notes: "Ready for operator approval.",
    metadata: {
      readiness_blockers: [],
      delivery_state: {
        pdf_preview_generated: true,
        pdf_artifact_stored: true,
        tenant_email_prepared: true,
        delivery_ready: true,
        tenant_email_sent: false,
      },
    },
    lines: [],
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    deleted_at: null,
  };
}

test("operations approvals tab collects read-only approval candidates and exports without mutations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as Window & { __copiedApprovalsCsv?: string }).__copiedApprovalsCsv = text;
        },
      },
    });
  });
  await mockLeasiumApi(page, { operationsComplianceDemo: true });
  await page.route("**/api/v1/invoice-drafts**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([readyInvoiceDraft()]),
    });
  });

  const forbiddenCalls: string[] = [];
  const forbiddenPathPatterns = [
    "/providers",
    "/provider-dispatch",
    "/provider-history",
    "/comms",
    "/document-intakes",
    "/compliance/checks",
    "/maintenance/work-orders",
    "/obligations",
    "/billing",
    "/invoice",
    "/xero",
    "/basiq",
    "/payment",
    "/reconciliation",
  ];
  const forbiddenSendPathPattern = /email|sms|sendgrid|twilio/i;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const apiPath = new URL(request.url()).pathname.replace("/api/v1", "");
    if (
      (request.method() !== "GET" &&
        forbiddenPathPatterns.some((pattern) => apiPath.startsWith(pattern))) ||
      forbiddenSendPathPattern.test(apiPath)
    ) {
      forbiddenCalls.push(`${request.method()} ${apiPath}`);
    }
    await route.fallback();
  });

  await page.goto("/operations?tab=approvals");

  const tabs = page.getByRole("tablist", { name: "Operations sections" });
  const approvalsTab = tabs.getByRole("tab", { name: /Approvals/ });
  await expect(approvalsTab).toHaveAttribute("aria-selected", "true");
  await expectTouchTarget(approvalsTab);

  const panel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Approvals inbox" }) })
    .first();
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Review-only");
  await expect(panel).toContainText("Air conditioning fault");
  await expect(panel).toContainText("Owner recharge invoice");
  await expect(panel).toContainText("Annual fire safety statement");
  await expect(panel).toContainText("Tenant onboarding ready for review");
  await expect(panel).toContainText("Document waiting for review");
  await expect(panel).toContainText("Assignment notice ready");
  await expect(panel).toContainText("No provider, comms, payment, or reconciliation action runs from this inbox.");

  await expect(
    panel.locator('a[href="/operations/maintenance/work-order-1"]'),
  ).toBeVisible();
  await expect(
    panel.locator('a[href="/billing-readiness?entity_id=entity-1&invoice_id=invoice-draft-ready-approval-1"]'),
  ).toBeVisible();
  await expect(
    panel.locator('a[href="/operations?tab=compliance#compliance-check-compliance-check-fire-1"]'),
  ).toBeVisible();
  await expect(
    panel.locator('a[href="/intake?entity_id=entity-1&review=intake-1"]'),
  ).toBeVisible();

  await expect(panel.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Send" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Post to Xero" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Complete" })).toHaveCount(0);

  const copyButton = panel.getByRole("button", { name: "Copy approvals CSV" });
  const downloadButton = panel.getByRole("button", { name: "Download approvals CSV" });
  await expectTouchTarget(copyButton);
  await expectTouchTarget(downloadButton);

  forbiddenCalls.length = 0;
  await copyButton.click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as Window & { __copiedApprovalsCsv?: string }).__copiedApprovalsCsv),
    )
    .toBeTruthy();
  const copiedCsv = await page.evaluate(
    () => (window as Window & { __copiedApprovalsCsv?: string }).__copiedApprovalsCsv,
  );

  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("operations-approvals-review.csv");
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const csv = await readFile(downloadPath!, "utf8");
  expect(copiedCsv).toBe(csv);
  expect(csv).toContain("Review-only approvals packet");
  expect(csv).toContain("does not approve");
  expect(csv).toContain("Xero/Basiq");
  expect(csv).toContain("Owner recharge invoice");
  expect(csv).toContain("Air conditioning fault");
  expect(csv).toContain("Annual fire safety statement");
  expect(forbiddenCalls).toEqual([]);
});
```

- [ ] **Step 2: Run the smoke test to verify RED**

Run: `cd apps/web && npm run test:smoke -- tests/smoke/operations-approvals.spec.ts`

Expected: FAIL because the `Approvals` tab and `Approvals inbox` panel do not exist yet.

### Task 2: Derive Approval Candidates And Render The Tab

**Files:**
- Modify: `apps/web/src/app/operations/page.tsx`

- [ ] **Step 1: Add tab, guardrail, candidate types, builder, and CSV helper**

In `apps/web/src/app/operations/page.tsx`, add an `approvals` tab, a review-only export guardrail, an `ApprovalCandidate` type, candidate grouping helpers, `buildApprovalCandidates`, and `operationsApprovalsReviewCsv`.

Key implementation details:
- Include candidate types for Smart Intake, maintenance approval, invoice draft, compliance evidence, tenant onboarding, and assignment notice.
- Only include invoice drafts with `status === "ready_for_approval"`.
- Only include compliance checks where `canCompleteComplianceCheck(check)` is true.
- Only include maintenance where `approval_status === "pending"` or `status === "awaiting_approval"`.
- Only include onboarding where `status === "submitted"` or due sent onboarding is overdue.
- Never call mutation hooks from the new tab.

- [ ] **Step 2: Wire candidates into `OperationsWorkspace`**

Use `useMemo` after `readyNotificationItems` is available:

```ts
const approvalCandidates = useMemo(
  () =>
    buildApprovalCandidates({
      intakes,
      maintenance,
      invoiceDrafts,
      complianceChecks,
      onboardings,
      readyNotificationItems,
      properties,
      tenants,
    }),
  [
    complianceChecks,
    intakes,
    invoiceDrafts,
    maintenance,
    onboardings,
    properties,
    readyNotificationItems,
    tenants,
  ],
);
```

Add `copyApprovalsCsv` and `downloadApprovalsCsv` beside the existing queue/compliance export handlers, using `copyTextToClipboard`, `saveBlob`, and filename `operations-approvals-review.csv`.

- [ ] **Step 3: Render the read-only approvals tab**

Add an `activeTab === "approvals"` panel after Queue and before Calendar. The panel must:
- Use heading `Approvals inbox`.
- Show summary chips for total count, ready, blocked, and provider-adjacent.
- Render grouped read-only rows with status/source/reason/context/guardrail and a `Review source` link.
- Include `Copy approvals CSV` and `Download approvals CSV` buttons.
- Show an empty state when there are no candidates.
- Include no approve/send/complete/post/apply/reconcile buttons.

- [ ] **Step 4: Run the smoke test to verify GREEN**

Run: `cd apps/web && npm run test:smoke -- tests/smoke/operations-approvals.spec.ts`

Expected: PASS.

### Task 3: UX Pass, Status Docs, And Verification

**Files:**
- Modify: `docs/product-roadmap.md`
- Modify: `docs/design-governance.md`
- Modify: `docs/next-chat-handover.md`

- [ ] **Step 1: Capture desktop and mobile screenshots**

Create a temporary Playwright screenshot spec, run it at 1440px and 390px against `/operations?tab=approvals`, save images under `output/playwright/`, inspect them, then delete the temporary spec before commit.

- [ ] **Step 2: Update docs**

Update:
- `docs/product-roadmap.md`: mark Work approvals inbox v1 as shipped and keep Next Build Order coherent.
- `docs/design-governance.md`: add a dated UX pass log line for `/operations?tab=approvals` with 1440px and 390px screenshots checked.
- `docs/next-chat-handover.md`: add the new shipped slice, verification, and next priority.

- [ ] **Step 3: Run verification**

Run:
- `cd apps/web && npm run test:smoke -- tests/smoke/operations-approvals.spec.ts`
- `cd apps/web && npm run test:smoke -- tests/smoke/operations-compliance.spec.ts`
- `cd apps/web && npm run lint -- src/app/operations/page.tsx tests/smoke/operations-approvals.spec.ts`
- `cd apps/web && npx tsc --noEmit`
- `git diff --check`

Expected: all commands exit 0.

- [ ] **Step 4: Commit and push**

Stage only the touched implementation, test, plan, and status-doc files. Commit with:

```bash
git commit -m "Ship Work approvals inbox v1"
git push origin main
```

Then check the pushed branch's CI/deployment state before reporting back.

### Self-Review

Spec coverage: the plan covers a read-only Work tab, candidate derivation from existing operations data, source links, local review exports, provider mutation traps, mobile/desktop UX screenshots, and the required status docs.

Placeholder scan: no TBD/TODO/fill-in placeholders remain.

Type consistency: candidate inputs match existing operations page records and the new smoke test uses an explicit ready invoice draft shaped like `InvoiceDraftRecord`.
