# Horizon Work Mobile Toast Clearance Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Work mobile status toasts clear of the fixed Horizon bottom navigation from the approved Work mobile frame (`PO2jOANgmqgZHfqWZXOZGU`, node `45:461`).

**Architecture:** Reuse the existing Work toast UI and move its mobile fixed bottom offset above the 84px bottom-nav zone plus safe-area inset. Keep desktop positioning unchanged.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind utility classes, Playwright smoke tests.

---

### Task 1: Source And Scope

**Files:**
- Read: Figma Work mobile frame `45:461`
- Modify: `apps/web/src/app/operations/page.tsx`

- [x] **Step 1: Pull Figma context**

Use the locked Work mobile frame, not 04 Concept. The bottom nav occupies the lower 84px band.

- [x] **Step 2: Apply a shared toast clearance class**

Move the three Work `role="status"` toasts to `bottom-[calc(6rem+env(safe-area-inset-bottom))]` on mobile and preserve `md:bottom-5` for desktop.

### Task 2: Verification

**Files:**
- Modify: `apps/web/tests/smoke/operations-ux.spec.ts`

- [x] **Step 1: Strengthen mobile smoke**

Extend the existing maintenance inline undo toast smoke to assert the toast bottom clears the Mobile primary nav by at least 8px at 390x844.

- [x] **Step 2: Run focused smoke**

Run: `cd apps/web && ./node_modules/.bin/playwright test tests/smoke/operations-ux.spec.ts --grep "maintenance inline undo toast controls stay touch-safe on mobile" --workers=1`

Observed: passed **1/1**.

### Task 3: Docs

**Files:**
- Modify: `docs/product-roadmap.md`
- Modify: `docs/design-governance.md`
- Modify: `docs/horizon-implementation-brief.md`
- Modify: `docs/next-chat-handover.md`

- [x] **Step 1: Record as Remba-pending**

Update the Horizon Mobile Polish notes to include Work mobile toast bottom-nav clearance.

- [x] **Step 2: Complete final verification**

Run targeted lint, TypeScript, production build, browser QA, then commit/push
and record deployment proof before marking this follow-up shipped.

Observed before commit: targeted ESLint passed; `tsc --noEmit` passed;
`npm run build` passed; in-app browser QA at 390x844 and 1280x900 confirmed
the Work heading, correct mobile-nav visibility, and no horizontal overflow.
Commit `61b5fbf` was pushed to `main`; Vercel deployment
`dpl_6PNHbr8GAzEcgnsgNJtzYSBPZcQt` reached `READY`, aliases attached to
`leasium.ai`, `www.leasium.ai`, and `leasium.vercel.app`, and canonical HTTP
checks returned 200 for `/operations` and `/`.
