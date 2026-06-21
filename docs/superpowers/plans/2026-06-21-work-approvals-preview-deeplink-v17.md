# Work Approvals Preview Deep-Link v1.7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the selected Work approvals preview reopenable from the browser URL with an `approval` query parameter.

**Architecture:** Keep the slice browser-state only inside `apps/web/src/app/operations/page.tsx`. Add one query-param helper, initialize selected preview from loaded visible candidates, and route all preview selection actions through a single setter that updates state and `window.history.replaceState`.

**Tech Stack:** Next.js client component, React state/effects, Playwright smoke tests, existing Leasium UI components.

---

### Task 1: Smoke Test

**Files:**
- Modify: `apps/web/tests/smoke/operations-approvals.spec.ts`

- [ ] **Step 1: Write the failing test**

Extend `operations approvals tab previews a candidate without mutations` so it starts at:

```ts
await page.goto(
  "/operations?tab=approvals&approval=invoice-draft-invoice-draft-ready-approval-1",
);
```

Then assert the invoice preview is visible before any Preview button click:

```ts
await expect(previewPanel).toBeVisible();
await expect(previewPanel).toContainText("Owner recharge invoice");
await expect(page).toHaveURL(/approval=invoice-draft-invoice-draft-ready-approval-1/);
```

After clicking Previous, assert the URL changes to the assignment notice id:

```ts
await expect(page).toHaveURL(
  /approval=assignment-notice-obligation-obligation-ready-assignment-1/,
);
```

After clicking Next, assert the invoice id returns. After clicking Close preview,
assert the preview closes and `approval` is absent from `page.url()`.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd apps/web && npm run test:smoke -- tests/smoke/operations-approvals.spec.ts -g "previews a candidate"
```

Expected: fail because the page does not yet open or sync the preview from the
`approval` query parameter.

### Task 2: URL-Backed Preview State

**Files:**
- Modify: `apps/web/src/app/operations/page.tsx`

- [ ] **Step 1: Add the query parameter constant and helper**

Add:

```ts
const APPROVAL_PREVIEW_SEARCH_PARAM = "approval";

function replaceApprovalPreviewSearchParam(candidateId: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (candidateId) {
    url.searchParams.set(APPROVAL_PREVIEW_SEARCH_PARAM, candidateId);
  } else {
    url.searchParams.delete(APPROVAL_PREVIEW_SEARCH_PARAM);
  }
  window.history.replaceState(null, "", url);
}
```

- [ ] **Step 2: Route preview actions through one setter**

Inside `OperationsWorkspace`, add:

```ts
const selectApprovalCandidatePreview = (candidateId: string | null) => {
  setSelectedApprovalCandidateId(candidateId);
  replaceApprovalPreviewSearchParam(candidateId);
};
```

Use it for Preview, Previous, Next, Close, and selected-candidate clearing.

- [ ] **Step 3: Initialize from the URL once candidates are loaded**

Add an effect that reads `approval`, opens the candidate if it is in
`visibleApprovalCandidates`, and clears stale ids only after approval candidates
exist.

- [ ] **Step 4: Run the focused smoke test**

Run:

```bash
cd apps/web && npm run test:smoke -- tests/smoke/operations-approvals.spec.ts -g "previews a candidate"
```

Expected: pass.

### Task 3: Docs, UX Evidence, and Final Verification

**Files:**
- Modify: `docs/product-roadmap.md`
- Modify: `docs/design-governance.md`
- Modify: `docs/next-chat-handover.md`

- [ ] **Step 1: Capture desktop and mobile screenshots**

Use the existing mocked approvals data to capture:

- `output/playwright/work-approvals-preview-deeplink-v17-1440.png`
- `output/playwright/work-approvals-preview-deeplink-v17-390.png`

- [ ] **Step 2: Update docs**

Add a Built entry, a UX pass log line with screenshot paths, and a new handover
continuation with verification and guardrails.

- [ ] **Step 3: Run full verification**

Run:

```bash
cd apps/web && npm run test:smoke -- tests/smoke/operations-approvals.spec.ts
cd apps/web && npm run test:smoke -- tests/smoke/operations-compliance.spec.ts
cd apps/web && npm run lint -- src/app/operations/page.tsx tests/smoke/operations-approvals.spec.ts
cd apps/web && npx tsc --noEmit
git diff --check
```

Expected: all commands pass.

- [ ] **Step 4: Commit and push**

Stage only the touched implementation, test, plan, and doc files. Commit with:

```bash
git commit -m "Ship Work approvals preview deeplink v1.7"
```

Push `main`, confirm CI is green, and confirm production is serving the pushed
commit.
