# Work Approvals URL State v1.8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore and persist Work approvals state/source/search/sort controls from the browser URL.

**Architecture:** Keep the behavior inside the existing `/operations` client component. Extend the current operations URL read/write effects with approval-specific query parameters, using validation against the existing approval filter and sort option lists. Keep `approval=<candidate-id>` preview state independent.

**Tech Stack:** Next.js client component, React state/effects, Playwright smoke tests, existing Leasium UI components.

---

### Task 1: Smoke Test

**Files:**
- Modify: `apps/web/tests/smoke/operations-approvals.spec.ts`

- [x] **Step 1: Write the failing test**

In `operations approvals tab filters candidates and scopes review exports`,
change the first navigation to:

```ts
await page.goto(
  "/operations?tab=approvals&approval_state=provider_adjacent&approval_source=invoice_draft&approval_search=INV-2001&approval_sort=source",
);
```

Then assert the URL-restored controls and filtered list before the existing sort
flow resets the sort:

```ts
const searchInput = panel.getByLabel("Search approvals");
const sourceSelect = panel.getByLabel("Approval source");
const sortSelect = panel.getByLabel("Approval sort");
const providerFilter = panel.getByRole("button", {
  name: /Provider-adjacent/,
});

await expect(providerFilter).toHaveAttribute("aria-pressed", "true");
await expect(sourceSelect).toHaveValue("invoice_draft");
await expect(searchInput).toHaveValue("INV-2001");
await expect(sortSelect).toHaveValue("source");
await expect(panel).toContainText("Owner recharge invoice");
await expect(panel).not.toContainText("Air conditioning fault");
await expect(panel).not.toContainText("Annual fire safety statement");
await expect(page).toHaveURL(/approval_state=provider_adjacent/);
await expect(page).toHaveURL(/approval_source=invoice_draft/);
await expect(page).toHaveURL(/approval_search=INV-2001/);
await expect(page).toHaveURL(/approval_sort=source/);

await panel.getByRole("button", { name: "Clear approval filters" }).click();
await expect(searchInput).toHaveValue("");
await expect(sourceSelect).toHaveValue("all");
await expect(sortSelect).toHaveValue("grouped");
expect(new URL(page.url()).searchParams.has("approval_state")).toBe(false);
expect(new URL(page.url()).searchParams.has("approval_source")).toBe(false);
expect(new URL(page.url()).searchParams.has("approval_search")).toBe(false);
expect(new URL(page.url()).searchParams.has("approval_sort")).toBe(false);
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
cd apps/web && npm run test:smoke -- tests/smoke/operations-approvals.spec.ts -g "filters candidates"
```

Expected: fail because the page does not yet restore approval controls from the
URL.

### Task 2: URL-Backed Approval View State

**Files:**
- Modify: `apps/web/src/app/operations/page.tsx`

- [x] **Step 1: Add approval URL parameter constants**

Add constants next to `APPROVAL_PREVIEW_SEARCH_PARAM`:

```ts
const APPROVAL_STATE_SEARCH_PARAM = "approval_state";
const APPROVAL_SOURCE_SEARCH_PARAM = "approval_source";
const APPROVAL_SEARCH_SEARCH_PARAM = "approval_search";
const APPROVAL_SORT_SEARCH_PARAM = "approval_sort";
```

- [x] **Step 2: Restore approval control state on load**

Inside the existing mount-only URL parsing effect, read and validate:

```ts
const approvalState = params.get(APPROVAL_STATE_SEARCH_PARAM);
if (
  approvalState === "all" ||
  approvalGroups.some((entry) => entry.id === approvalState)
) {
  setApprovalGroupFilter(approvalState as ApprovalGroupFilter);
}
const approvalSource = params.get(APPROVAL_SOURCE_SEARCH_PARAM);
if (
  approvalSource === "all" ||
  approvalKindFilters.some((entry) => entry.id === approvalSource)
) {
  setApprovalKindFilter(approvalSource as ApprovalKindFilter);
}
const approvalSearch = params.get(APPROVAL_SEARCH_SEARCH_PARAM);
if (approvalSearch) {
  setApprovalSearchQuery(approvalSearch);
}
const approvalSort = params.get(APPROVAL_SORT_SEARCH_PARAM);
if (
  approvalSort === "grouped" ||
  approvalSortOptions.some((entry) => entry.id === approvalSort)
) {
  setApprovalSortMode(approvalSort as ApprovalSortMode);
}
```

- [x] **Step 3: Persist approval control state to the URL**

Inside the existing URL-writing effect:

```ts
setOrDelete(APPROVAL_STATE_SEARCH_PARAM, approvalGroupFilter);
setOrDelete(APPROVAL_SOURCE_SEARCH_PARAM, approvalKindFilter);
if (approvalSearchQuery.trim().length > 0) {
  url.searchParams.set(
    APPROVAL_SEARCH_SEARCH_PARAM,
    approvalSearchQuery.trim(),
  );
} else {
  url.searchParams.delete(APPROVAL_SEARCH_SEARCH_PARAM);
}
if (approvalSortMode === "grouped") {
  url.searchParams.delete(APPROVAL_SORT_SEARCH_PARAM);
} else {
  url.searchParams.set(APPROVAL_SORT_SEARCH_PARAM, approvalSortMode);
}
```

Add the approval state variables to the effect dependency list.

- [x] **Step 4: Run the focused smoke test**

Run:

```bash
cd apps/web && npm run test:smoke -- tests/smoke/operations-approvals.spec.ts -g "filters candidates"
```

Expected: pass.

### Task 3: Docs, UX Evidence, and Final Verification

**Files:**
- Modify: `docs/product-roadmap.md`
- Modify: `docs/design-governance.md`
- Modify: `docs/next-chat-handover.md`

- [x] **Step 1: Capture desktop and mobile screenshots**

Use mocked approvals data to capture:

- `output/playwright/work-approvals-url-state-v18-1440.png`
- `output/playwright/work-approvals-url-state-v18-390.png`

- [x] **Step 2: Update docs**

Add a Built entry, a UX pass log line with screenshot paths, and a new handover
continuation with verification and guardrails.

- [x] **Step 3: Run full verification**

Run:

```bash
cd apps/web && npm run test:smoke -- tests/smoke/operations-approvals.spec.ts
cd apps/web && npm run test:smoke -- tests/smoke/operations-compliance.spec.ts
cd apps/web && npm run lint -- src/app/operations/page.tsx tests/smoke/operations-approvals.spec.ts
cd apps/web && npx tsc --noEmit
git diff --check
```

Expected: all commands pass.

- [x] **Step 4: Commit and push**

Stage only the touched implementation, test, plan, and doc files. Commit with:

```bash
git commit -m "Ship Work approvals URL state v1.8"
```

Push `main`, confirm CI is green, and confirm production is serving the pushed
commit.
