# Compliance Evidence Detail v1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only per-check evidence detail disclosure to the Work compliance tab.

**Architecture:** Keep v1.1 frontend-led. The Operations page already loads `ComplianceCheckRecord` data, evidence state, completion history, local packet exports, and completion/evidence mutations. Add local disclosure state plus derived display helpers inside the existing row, then extend the existing compliance smoke to prove the read-only detail and guardrails.

**Tech Stack:** Next.js App Router, React, TypeScript, TanStack Query, Playwright smoke tests, existing Leasium UI primitives.

---

## File Structure

- Modify `apps/web/tests/smoke/operations-compliance.spec.ts`: add a failing smoke assertion for the evidence detail disclosure and forbidden mutation guardrail.
- Modify `apps/web/src/app/operations/page.tsx`: add read-only detail state/helpers and render the evidence detail disclosure inside each recurring compliance check row.
- Modify `docs/product-roadmap.md`: mark the compliance evidence detail refinement shipped.
- Modify `docs/design-governance.md`: add the UX gate log entry after screenshots.
- Modify `docs/next-chat-handover.md`: record implementation, verification, and remaining tree state.

## Task 1: Failing Smoke Test

**Files:**
- Modify: `apps/web/tests/smoke/operations-compliance.spec.ts`

- [ ] **Step 1: Add the failing test**

Add this smoke near the existing compliance completion-history coverage:

```typescript
test("operations compliance tab shows per-check evidence detail without mutations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLeasiumApi(page, { operationsComplianceDemo: true });

  const forbiddenDetailCalls: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const apiPath = new URL(request.url()).pathname.replace("/api/v1", "");
    if (
      request.method() !== "GET" &&
      /providers|provider-dispatch|provider-history|comms|document-intakes|maintenance|obligations|billing|invoice|xero|basiq|payment|reconciliation|email|sms|sendgrid|twilio/i.test(
        apiPath,
      )
    ) {
      forbiddenDetailCalls.push(`${request.method()} ${apiPath}`);
    }
    await route.fallback();
  });

  await page.goto("/operations?tab=compliance");

  const checkRow = page.getByTestId("compliance-check-compliance-check-fire-1");
  await expect(checkRow).toContainText("Annual fire safety statement");

  const detailButton = checkRow.getByRole("button", {
    name: "Review evidence detail",
  });
  await expectTouchTarget(detailButton);
  await detailButton.click();

  await expect(checkRow.getByText("Evidence detail")).toBeVisible();
  await expect(checkRow).toContainText("Source document on file");
  await expect(checkRow).toContainText("document-compliance-fire-1");
  await expect(checkRow).toContainText("Current obligation");
  await expect(checkRow).toContainText("obligation-compliance-1");
  await expect(checkRow).toContainText("Latest completion");
  await expect(checkRow).toContainText("10 May 2025");
  await expect(checkRow).toContainText("Operator approved");
  await expect(checkRow).toContainText("Renewal certificate reviewed.");
  await expect(checkRow).toContainText("Certificate due in 21 days");
  await expect(checkRow).toContainText("Every 1 year");
  await expect(checkRow).toContainText("Ops");
  await expect(checkRow).toContainText("Review-only compliance packet");

  expect(forbiddenDetailCalls).toEqual([]);
});
```

- [ ] **Step 2: Run the focused smoke and verify RED**

Run:

```bash
npm run test:smoke -- tests/smoke/operations-compliance.spec.ts -g "per-check evidence detail"
```

Expected: FAIL because `Review evidence detail` does not exist yet.

## Task 2: Minimal UI Implementation

**Files:**
- Modify: `apps/web/src/app/operations/page.tsx`

- [ ] **Step 1: Add local disclosure state**

Add state beside `expandedCompletionHistoryId`:

```typescript
const [expandedComplianceDetailId, setExpandedComplianceDetailId] =
  useState<string | null>(null);
```

- [ ] **Step 2: Add small read-only display helpers**

Add helpers near the existing compliance helpers:

```typescript
function complianceLatestCompletionDetail(check: ComplianceCheckRecord) {
  return complianceCompletionEntries(check)[0] ?? null;
}

function complianceEvidenceNotes(check: ComplianceCheckRecord) {
  const latest = complianceLatestCompletionDetail(check);
  return latest?.notes ?? check.notes ?? "No notes recorded";
}
```

- [ ] **Step 3: Render the disclosure button and detail block**

Inside each compliance check row, render a `SecondaryButton` labelled `Review evidence detail`. When open, show a grouped read-only block with:

```typescript
<h4>Evidence detail</h4>
<dt>Document handoff</dt>
<dd>Source document on file</dd>
<dt>Source document</dt>
<dd>{sourceDocumentId ?? "Not linked"}</dd>
<dt>Current obligation</dt>
<dd>{check.current_obligation_id ?? "No current obligation"}</dd>
<dt>Latest completion</dt>
<dd>{complianceCompletionDateLabel(check)}</dd>
<dt>Approval</dt>
<dd>{latestDetail?.operatorApproved ? "Operator approved" : "Approval not recorded"}</dd>
<dt>Notes</dt>
<dd>{complianceEvidenceNotes(check)}</dd>
<dt>Next due</dt>
<dd>{complianceCompletionNextDueLabel(check)}</dd>
<dt>Certificate</dt>
<dd>{complianceCertificateExpiryLabel(check) ?? "No certificate expiry recorded"}</dd>
<dt>Owner</dt>
<dd>{complianceOwnerLabel(check, securityMembers)}</dd>
<dt>Recurrence</dt>
<dd>{recurrenceLabel(check)}</dd>
```

Keep the block read-only and keep copy/download packet buttons as the existing export actions.

- [ ] **Step 4: Run the focused smoke and verify GREEN**

Run:

```bash
npm run test:smoke -- tests/smoke/operations-compliance.spec.ts -g "per-check evidence detail"
```

Expected: PASS.

## Task 3: Documentation And UX Gate

**Files:**
- Modify: `docs/product-roadmap.md`
- Modify: `docs/design-governance.md`
- Modify: `docs/next-chat-handover.md`

- [ ] **Step 1: Capture screenshots**

Run the app/smoke setup needed for Playwright and capture desktop 1440px and mobile 390px views of `/operations?tab=compliance` with the evidence detail open.

- [ ] **Step 2: Update docs**

Add dated notes that compliance evidence detail v1.1 shipped as a read-only Work tab disclosure, with no provider/comms/payment mutations.

- [ ] **Step 3: Run checks**

Run:

```bash
npm run lint -- apps/web/src/app/operations/page.tsx apps/web/tests/smoke/operations-compliance.spec.ts
npm run test:smoke -- tests/smoke/operations-compliance.spec.ts
git diff --check
```

Expected: exit 0 for each command.

## Self-Review

- Spec coverage: the plan covers read-only evidence detail, document handoff fallback, current obligation, latest completion, owner/cadence, local packet exports, UX gate, and no forbidden provider mutations.
- Placeholder scan: no `TBD`, `TODO`, `implement later`, or unspecified tests.
- Type consistency: all helpers use the existing `ComplianceCheckRecord`, `complianceCompletionEntries`, `complianceEvidenceDocumentId`, and existing UI primitives.
