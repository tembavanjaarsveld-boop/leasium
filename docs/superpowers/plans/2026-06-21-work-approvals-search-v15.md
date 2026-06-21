# Work Approvals Search v1.5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local read-only search field to the Work approvals inbox so operators can narrow visible candidates before previewing, opening source records, or exporting packets.

**Architecture:** Keep search entirely inside the existing `/operations` page state. Add a `approvalSearchQuery` state value, a small pure matching helper over each `ApprovalCandidate`, and include that helper in the existing visible-candidate filter so grouping, preview navigation, empty state, and CSV export continue to derive from one visible list.

**Tech Stack:** Next.js App Router, React state, existing Leasium `Input`/`SecondaryButton` components, lucide search icon, Playwright smoke tests.

---

### Task 1: Lock Search Behavior With A Failing Smoke

**Files:**
- Modify: `apps/web/tests/smoke/operations-approvals.spec.ts`

- [x] **Step 1: Extend the existing filter/export smoke**

Add these assertions near the start of `operations approvals tab filters candidates and scopes review exports`, after the initial candidate visibility checks:

```ts
  const searchInput = panel.getByLabel("Search approvals");
  await expectTouchTarget(searchInput);
  await searchInput.fill("INV-2001");
  await expect(panel).toContainText("Owner recharge invoice");
  await expect(panel).not.toContainText("Air conditioning fault");
  await expect(panel).not.toContainText("Annual fire safety statement");

  forbiddenCalls.length = 0;
  await panel.getByRole("button", { name: "Copy approvals CSV" }).click();
  const searchedCsv = await copiedApprovalsCsv(page);
  expect(searchedCsv).toContain("Owner recharge invoice");
  expect(searchedCsv).not.toContain("Air conditioning fault");
  expect(searchedCsv).not.toContain("Annual fire safety statement");

  const searchedDownloadPromise = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Download approvals CSV" }).click();
  const searchedDownload = await searchedDownloadPromise;
  const searchedDownloadPath = await searchedDownload.path();
  expect(searchedDownloadPath).not.toBeNull();
  const searchedDownloadedCsv = await readFile(searchedDownloadPath!, "utf8");
  expect(searchedDownloadedCsv).toBe(searchedCsv);

  const searchedInvoiceRow = panel
    .locator("article")
    .filter({ hasText: "Owner recharge invoice" })
    .first();
  await searchedInvoiceRow.getByRole("button", { name: "Preview" }).click();
  await expect(
    panel.getByRole("heading", { name: "Approval preview" }),
  ).toBeVisible();

  await searchInput.fill("Insurance certificate renewal");
  await expect(
    panel.getByRole("heading", { name: "Approval preview" }),
  ).toHaveCount(0);
  await expect(panel).toContainText("Insurance certificate renewal");
  await expect(panel).not.toContainText("Owner recharge invoice");

  await panel.getByRole("button", { name: "Clear approval filters" }).click();
  await expect(searchInput).toHaveValue("");
```

- [x] **Step 2: Run the focused smoke and confirm RED**

Run:

```bash
cd apps/web && npm run test:smoke -- tests/smoke/operations-approvals.spec.ts -g "filters candidates"
```

Expected: FAIL waiting for `Search approvals`.

### Task 2: Add Local Search State And Matching

**Files:**
- Modify: `apps/web/src/app/operations/page.tsx`

- [x] **Step 1: Add the search icon import**

Update the lucide import:

```ts
  Search,
```

- [x] **Step 2: Add the pure matching helper**

Add near the approval CSV helpers:

```ts
function approvalCandidateMatchesSearch(
  candidate: ApprovalCandidate,
  searchQuery: string,
) {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  return [
    approvalKindLabel(candidate.kind),
    candidate.title,
    candidate.sourceLabel,
    candidate.statusLabel,
    candidate.context,
    candidate.reason,
    candidate.guardrail,
    formatDate(candidate.dueDate),
    ...candidate.previewDetails,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}
```

- [x] **Step 3: Add state and include search in the visible list**

Add after `approvalKindFilter` state:

```ts
  const [approvalSearchQuery, setApprovalSearchQuery] = useState("");
```

Change `visibleApprovalCandidates` so it also checks:

```ts
      approvalCandidateMatchesSearch(candidate, approvalSearchQuery)
```

Update `approvalFilterActive` so search counts as an active filter:

```ts
    approvalGroupFilter !== "all" ||
    approvalKindFilter !== "all" ||
    approvalSearchQuery.trim().length > 0;
```

### Task 3: Render Search In The Existing Filter Band

**Files:**
- Modify: `apps/web/src/app/operations/page.tsx`

- [x] **Step 1: Add the search field beside source filter**

Inside the filter band controls before `Approval source`, add:

```tsx
                    <label className="relative min-w-0 flex-1 sm:min-w-[240px] xl:max-w-[320px]">
                      <span className="sr-only">Search approvals</span>
                      <Search
                        size={15}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                      />
                      <Input
                        aria-label="Search approvals"
                        value={approvalSearchQuery}
                        onChange={(event) =>
                          setApprovalSearchQuery(event.target.value)
                        }
                        placeholder="Search approvals"
                        className="min-h-11 pl-9"
                      />
                    </label>
```

- [x] **Step 2: Clear search with the existing clear control**

Update the clear handler:

```ts
                          setApprovalGroupFilter("all");
                          setApprovalKindFilter("all");
                          setApprovalSearchQuery("");
```

- [x] **Step 3: Tighten the empty-state copy**

Change the filtered empty-state description to:

```tsx
description="Clear filters or search, or choose another state or source to return to the full approvals inbox."
```

### Task 4: Verify Green And UX Evidence

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

Expected: PASS.

- [x] **Step 2: Capture UX screenshots**

Use a temporary Playwright smoke harness to open the approvals tab, search
`INV-2001`, and save:

```text
output/playwright/work-approvals-search-v15-1440.png
output/playwright/work-approvals-search-v15-390.png
```

Remove the temporary harness after screenshots are captured.

- [x] **Step 3: Update docs**

Add the v1.5 shipped line to `docs/product-roadmap.md`, add a dated UX pass log
line to `docs/design-governance.md`, and prepend a continuation block to
`docs/next-chat-handover.md` with verification and guardrails.

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

- [ ] **Step 2: Commit and push**

Run:

```bash
git add apps/web/src/app/operations/page.tsx apps/web/tests/smoke/operations-approvals.spec.ts docs/design-governance.md docs/product-roadmap.md docs/next-chat-handover.md docs/superpowers/plans/2026-06-21-work-approvals-search-v15.md
git commit -m "Ship Work approvals search v1.5"
git push origin main
```

- [ ] **Step 3: Verify hosted production**

Watch the `main` GitHub run for the pushed commit, confirm the production
deployment is ready, check `https://leasium.ai/operations?tab=approvals`, and
scan recent production error logs.
