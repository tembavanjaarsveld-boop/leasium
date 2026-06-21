# Work Approvals Preview Navigation v1.4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Previous / Next controls to the read-only Work approvals preview so operators can step through the visible filtered candidate list.

**Architecture:** Keep the behavior in the existing `/operations` page state. Derive the selected candidate's visible index from `visibleApprovalCandidates`, expose two local handlers that update only `selectedApprovalCandidateId`, and render compact header controls in the existing preview panel.

**Tech Stack:** Next.js App Router, React state, existing Leasium UI buttons/badges, lucide chevron icons, Playwright smoke tests.

---

### Task 1: Lock Preview Stepping With A Failing Smoke

**Files:**
- Modify: `apps/web/tests/smoke/operations-approvals.spec.ts`

- [x] **Step 1: Extend the existing preview smoke**

Add these assertions after the packet button touch-target checks:

```ts
  const previousCandidateButton = previewPanel.getByRole("button", {
    name: "Previous approval candidate",
  });
  const nextCandidateButton = previewPanel.getByRole("button", {
    name: "Next approval candidate",
  });
  await expectTouchTarget(previousCandidateButton);
  await expectTouchTarget(nextCandidateButton);
  await expect(previewPanel).toContainText("Candidate");
  await expect(previewPanel).toContainText("of");

  await previousCandidateButton.click();
  await expect(previewPanel).toContainText("Insurance certificate renewal");
  await expect(previewPanel).toContainText("Assignment notice ready");
  await expect(previewPanel).toContainText("Property manager");
  await expect(previewPanel).not.toContainText("Owner recharge invoice");

  await nextCandidateButton.click();
  await expect(previewPanel).toContainText("Owner recharge invoice");
  await expect(previewPanel).toContainText("Billing");
```

- [x] **Step 2: Run the focused smoke and confirm RED**

Run:

```bash
cd apps/web && npm run test:smoke -- tests/smoke/operations-approvals.spec.ts -g "previews a candidate"
```

Expected: FAIL waiting for `Previous approval candidate`.

### Task 2: Add The Minimal Preview Navigation State

**Files:**
- Modify: `apps/web/src/app/operations/page.tsx`

- [x] **Step 1: Add chevron icons**

Update the lucide import:

```ts
  ChevronLeft,
  ChevronRight,
```

- [x] **Step 2: Derive navigation state next to selected preview state**

Add after `selectedApprovalGroup`:

```ts
  const selectedApprovalCandidateIndex = selectedApprovalCandidate
    ? visibleApprovalCandidates.findIndex(
        (candidate) => candidate.id === selectedApprovalCandidate.id,
      )
    : -1;
  const selectedApprovalPosition =
    selectedApprovalCandidateIndex >= 0 ? selectedApprovalCandidateIndex + 1 : 0;
  const canPreviewPreviousApproval = selectedApprovalCandidateIndex > 0;
  const canPreviewNextApproval =
    selectedApprovalCandidateIndex >= 0 &&
    selectedApprovalCandidateIndex < visibleApprovalCandidates.length - 1;
  const previewPreviousApprovalCandidate = () => {
    if (!canPreviewPreviousApproval) return;
    setSelectedApprovalCandidateId(
      visibleApprovalCandidates[selectedApprovalCandidateIndex - 1].id,
    );
  };
  const previewNextApprovalCandidate = () => {
    if (!canPreviewNextApproval) return;
    setSelectedApprovalCandidateId(
      visibleApprovalCandidates[selectedApprovalCandidateIndex + 1].id,
    );
  };
```

- [x] **Step 3: Render the controls in the preview header**

Add below the preview header and before the candidate card:

```tsx
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex min-h-11 items-center rounded-full border border-primary/20 bg-white px-3 text-xs font-semibold text-muted-foreground shadow-leasiumXs">
                          Candidate {selectedApprovalPosition} of{" "}
                          {visibleApprovalCandidates.length} visible
                        </span>
                        <SecondaryButton
                          type="button"
                          aria-label="Previous approval candidate"
                          title="Previous candidate"
                          className="h-11 w-11 shrink-0 p-0"
                          disabled={!canPreviewPreviousApproval}
                          onClick={previewPreviousApprovalCandidate}
                        >
                          <ChevronLeft size={15} />
                        </SecondaryButton>
                        <SecondaryButton
                          type="button"
                          aria-label="Next approval candidate"
                          title="Next candidate"
                          className="h-11 w-11 shrink-0 p-0"
                          disabled={!canPreviewNextApproval}
                          onClick={previewNextApprovalCandidate}
                        >
                          <ChevronRight size={15} />
                        </SecondaryButton>
                      </div>
```

### Task 3: Verify Green And UX Evidence

**Files:**
- Modify: `apps/web/src/app/operations/page.tsx`
- Modify: `apps/web/tests/smoke/operations-approvals.spec.ts`
- Modify: `docs/design-governance.md`
- Modify: `docs/product-roadmap.md`
- Modify: `docs/next-chat-handover.md`

- [x] **Step 1: Run the focused smoke and confirm GREEN**

Run:

```bash
cd apps/web && npm run test:smoke -- tests/smoke/operations-approvals.spec.ts -g "previews a candidate"
```

Expected: PASS.

- [x] **Step 2: Capture UX screenshots**

Use a temporary Playwright smoke harness to open the approvals tab, preview the
invoice candidate, and save:

```text
output/playwright/work-approvals-preview-nav-v14-1440.png
output/playwright/work-approvals-preview-nav-v14-390.png
```

Remove the temporary harness after screenshots are captured.

- [x] **Step 3: Update docs**

Add the v1.4 shipped line to `docs/product-roadmap.md`, add a dated UX pass log
line to `docs/design-governance.md`, and prepend a continuation block to
`docs/next-chat-handover.md` with verification and guardrails.

### Task 4: Final Verification, Commit, Push

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
git add apps/web/src/app/operations/page.tsx apps/web/tests/smoke/operations-approvals.spec.ts docs/design-governance.md docs/product-roadmap.md docs/next-chat-handover.md docs/superpowers/plans/2026-06-21-work-approvals-preview-navigation-v14.md
git commit -m "Ship Work approvals preview navigation v1.4"
git push origin main
```

- [ ] **Step 3: Verify hosted production**

Watch the `main` GitHub run for the pushed commit, confirm the production
deployment is ready, check `https://leasium.ai/operations?tab=approvals`, and
scan recent production error logs.
