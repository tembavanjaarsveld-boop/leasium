# Horizon Smart Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the locked Horizon Smart Intake desktop landing frame from Figma node `55:166` while preserving the existing review-first document workflow.

**Architecture:** `/intake` remains a thin route that renders `Dashboard mode="intake"`. This slice reshapes only the Smart Intake landing layout in `dashboard.tsx`: header, hero upload band, review queue, recently applied provenance, and review-first ribbon. The detailed review editor (`DocumentIntakeReviewPanel`) and all provider/mutation paths stay unchanged for the separate Document review frame.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind tokens, Playwright smoke tests with mocked API data.

---

### Task 1: Horizon Smart Intake Smoke

**Files:**
- Modify: `apps/web/tests/smoke/app-flows.spec.ts`

- [x] **Step 1: Write the failing test**

Add a focused desktop smoke near the existing `/intake` touch-target tests:

```ts
test("smart intake shows Horizon review-first landing", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/intake");

  await expect(
    page.getByRole("heading", { level: 1, name: "Smart Intake" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Drop a document. Review what Leasium found. Apply only what you approve.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Drop anything — lease, invoice, contract, rent roll",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Leasium reads it, shows you every extracted field with confidence and source, and waits for your approval.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("or email documents to intake@leasium.ai"),
  ).toBeVisible();
  await expect(page.getByText(/Review queue/i)).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Recently applied — full provenance",
    }),
  ).toBeVisible();
  await expect(page.getByText("bright-cafe-lease.pdf")).toBeVisible();
  await expect(page.getByText("bright-cafe-insurance.pdf")).toBeVisible();
  await expect(
    page.getByText("Extraction is review-first — fields wait for your approval."),
  ).toBeVisible();
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
cd apps/web
PORT=3071 npm run test:smoke -- tests/smoke/app-flows.spec.ts --grep "smart intake shows Horizon review-first landing" --workers=1
```

Expected: FAIL because the current landing does not expose the Horizon hero/provenance copy.

### Task 2: Smart Intake Landing Layout

**Files:**
- Modify: `apps/web/src/components/dashboard.tsx`

- [x] **Step 1: Implement minimal layout changes**

Replace only the `isIntakeWorkspace` Smart Intake panel branch with a Horizon landing:
- custom header row with existing Refresh/demo actions
- hero upload band using the existing file input, drag/drop state, and `uploadSmartIntake`
- two-column desktop area with the existing review queue and a recently applied provenance list derived from `documentIntakes.filter((item) => item.status === "applied")`
- keep `Review filter`, CSV copy/download, Add property, Add tenant, Review, and Clear controls available
- keep `DocumentIntakeReviewPanel`, `RegisterImportPanel`, and all mutations unchanged

- [x] **Step 2: Run the new smoke**

Run:

```bash
cd apps/web
PORT=3071 npm run test:smoke -- tests/smoke/app-flows.spec.ts --grep "smart intake shows Horizon review-first landing" --workers=1
```

Expected: PASS.

### Task 3: Regression Coverage

**Files:**
- Test: `apps/web/tests/smoke/app-flows.spec.ts`
- Test: `apps/web/tests/smoke/smart-intake-export-parity.spec.ts`
- Test: `apps/web/tests/smoke/appearance.spec.ts`

- [x] **Step 1: Run existing Smart Intake flows**

Run:

```bash
cd apps/web
PORT=3072 npm run test:smoke -- tests/smoke/app-flows.spec.ts --grep "smart intake" --workers=1
```

Expected: PASS.

- [x] **Step 2: Run export parity guardrails**

Run:

```bash
cd apps/web
PORT=3073 npm run test:smoke -- tests/smoke/smart-intake-export-parity.spec.ts --workers=1
```

Expected: PASS and no provider mutation requests.

- [x] **Step 3: Run appearance smoke**

Run:

```bash
cd apps/web
PORT=3074 npm run test:smoke -- tests/smoke/appearance.spec.ts --workers=1
```

Expected: PASS for desktop/mobile and light/dark rendering.

### Task 4: Docs, Build, Commit, Push

**Files:**
- Modify: `docs/product-roadmap.md`
- Modify: `docs/design-governance.md`
- Modify: `docs/next-chat-handover.md`
- Modify: `docs/superpowers/plans/2026-06-10-horizon-smart-intake.md`

- [x] **Step 1: Mark the slice Remba-pending**

Update product/design docs with a dated `2026-06-10` Smart Intake desktop v1 entry, `[~]` status, Figma node `55:166`, and note that document review remains a separate `58:352` slice.

- [x] **Step 2: Run static verification**

Run:

```bash
cd apps/web
npm exec -- eslint src/components/dashboard.tsx tests/smoke/app-flows.spec.ts tests/smoke/smart-intake-export-parity.spec.ts tests/smoke/appearance.spec.ts
npm exec -- tsc --noEmit
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Commit and push**

Run:

```bash
git diff --check
git status --short
git add apps/web/src/components/dashboard.tsx apps/web/tests/smoke/app-flows.spec.ts docs/product-roadmap.md docs/design-governance.md docs/next-chat-handover.md docs/superpowers/plans/2026-06-10-horizon-smart-intake.md
git commit -m "Implement Horizon Smart Intake desktop"
git push origin main
```

Expected: commit lands on `main`; Vercel deployment becomes READY.
