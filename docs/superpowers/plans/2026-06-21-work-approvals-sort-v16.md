# Work Approvals Sort v1.6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local read-only sort control to the Work approvals inbox so operators can scan the visible candidate list by grouped priority, due date, or source.

**Architecture:** Keep the existing candidate aggregation untouched. Add an `approvalSortMode` state value, a pure `sortApprovalCandidates` helper, and derive the visible list by filtering then sorting. Grouped remains the default lane layout; Due soon and Source render one sorted list so screen order, preview previous/next, and CSV export order match.

**Tech Stack:** Next.js App Router, React state, existing Leasium `Select`/`SecondaryButton` components, Playwright smoke tests.

---

### Task 1: Lock Sort Behavior With A Failing Smoke

**Files:**
- Modify: `apps/web/tests/smoke/operations-approvals.spec.ts`

- [x] **Step 1: Extend the existing filter/export smoke**

Added `Approval sort` assertions to the existing `operations approvals tab filters candidates and scopes review exports` smoke. The smoke selects `due_soon`, verifies relative due-date ordering across known approval rows, verifies CSV order, verifies preview navigation follows the sorted list, and verifies `Clear approval filters` resets sort to `grouped`.

- [x] **Step 2: Run the focused smoke and confirm RED**

Run:

```bash
cd apps/web && npm run test:smoke -- tests/smoke/operations-approvals.spec.ts -g "filters candidates"
```

Expected: FAIL waiting for `Approval sort`.

Actual: FAIL waiting for `Approval sort`.

### Task 2: Add Local Sort Types And Helper

**Files:**
- Modify: `apps/web/src/app/operations/page.tsx`

- [x] **Step 1: Add sort types and options near approval filters**

Added `ApprovalSortMode = "grouped" | "due_soon" | "source"` and options for the select.

- [x] **Step 2: Extract approval candidate comparators**

Added:
- `compareApprovalCandidatesByGroupedPriority`
- `compareApprovalCandidatesByDueSoon`
- `compareApprovalCandidatesBySource`
- `sortApprovalCandidates`

Due-sort ties fall back to title so rows with the same due date stay predictable.

- [x] **Step 3: Reuse grouped sort in `buildApprovalCandidates`**

Replaced the inline group-rank sort with `sortApprovalCandidates(candidates, "grouped")`.

### Task 3: Wire State, Rendering, And Clear Behavior

**Files:**
- Modify: `apps/web/src/app/operations/page.tsx`

- [x] **Step 1: Add sort state**

Added `approvalSortMode` state, defaulting to `grouped`.

- [x] **Step 2: Derive the sorted visible list**

Changed `visibleApprovalCandidates` to filter first and then sort with `sortApprovalCandidates(..., approvalSortMode)`.

- [x] **Step 3: Preserve grouped lanes only for grouped mode**

Added `approvalSortedFlatGroup` and `renderedApprovalCandidateGroups`; non-default sort modes render one `Sorted approvals` list.

- [x] **Step 4: Render and reset the sort select**

Added the `Approval sort` select beside `Approval source`. `approvalFilterActive` includes non-default sort, and `Clear approval filters` resets sort to `grouped`.

### Task 4: Green Verification And UX Evidence

**Files:**
- Modify: `apps/web/src/app/operations/page.tsx`
- Modify: `apps/web/tests/smoke/operations-approvals.spec.ts`
- Modify: `docs/design-governance.md`
- Modify: `docs/product-roadmap.md`
- Modify: `docs/next-chat-handover.md`

- [x] **Step 1: Run the focused smoke and confirm GREEN**

Run:

```bash
cd apps/web && npm run test:smoke -- tests/smoke/operations-approvals.spec.ts -g "filters candidates"
```

Actual: PASS.

- [x] **Step 2: Capture UX screenshots**

Temporary mocked screenshot harness passed 1/1 and was removed after producing:

```text
output/playwright/work-approvals-sort-v16-1440.png
output/playwright/work-approvals-sort-v16-390.png
```

- [x] **Step 3: Update docs**

Updated `docs/product-roadmap.md`, `docs/design-governance.md`, and `docs/next-chat-handover.md` with v1.6 behavior, screenshots, verification so far, and guardrails.

### Task 5: Final Verification, Commit, Push

**Files:**
- Stage only the files touched by this slice and leave unrelated local files alone.

- [x] **Step 1: Run full focused verification**

Run:

```bash
cd apps/web && npm run test:smoke -- tests/smoke/operations-approvals.spec.ts
cd apps/web && npm run test:smoke -- tests/smoke/operations-compliance.spec.ts
cd apps/web && npm run lint -- src/app/operations/page.tsx tests/smoke/operations-approvals.spec.ts
cd apps/web && npx tsc --noEmit
git diff --check
```

Expected: all pass.

Actual: all passed.

- [ ] **Step 2: Commit and push**

Run:

```bash
git add apps/web/src/app/operations/page.tsx apps/web/tests/smoke/operations-approvals.spec.ts docs/design-governance.md docs/product-roadmap.md docs/next-chat-handover.md docs/superpowers/plans/2026-06-21-work-approvals-sort-v16.md
git commit -m "Ship Work approvals sort v1.6"
git push origin main
```

- [ ] **Step 3: Verify hosted production**

Watch the `main` GitHub run for the pushed commit, confirm the production deployment is ready, check `https://leasium.ai/operations?tab=approvals`, scan recent production error logs, and confirm the API health release commit.
