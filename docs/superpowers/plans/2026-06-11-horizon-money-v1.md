# Horizon Money V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the locked Figma Money screen as a review-first Horizon cockpit.

**Architecture:** Replace the legacy tab hub at `/money` with one data-backed first screen using existing read-only finance APIs. Keep provider work behind existing review routes; visible actions are links, not mutations.

**Tech Stack:** Next.js App Router, React Query, TypeScript, Tailwind token classes, Playwright smoke tests.

---

### Task 1: Lock Money Smoke Expectations

**Files:**
- Modify: `apps/web/tests/smoke/nav-consolidation.spec.ts`
- Modify: `apps/web/tests/smoke/appearance.spec.ts`

- [x] **Step 1: Update the Money desktop smoke**

Assert `/money` shows `Money`, the Figma subtitle, `THIS MONTH`, `COLLECTED`, `ARREARS`, `XERO`, `INVOICE RUN`, `No blockers`, the review-first trust ribbon, and links for `Reconcile payments`, `Run invoices`, `Approve run...`, statements, Xero settings, and Basiq controls.

- [x] **Step 2: Update mobile smoke**

Assert the same first-screen hierarchy is visible at 390x844, the cockpit actions stay at least 44px tall, and the old `Money areas` tablist is gone.

- [x] **Step 3: Add no-provider-mutation coverage**

Watch requests on `/money` and fail if non-GET calls hit Xero, Basiq, payment, reconciliation, SendGrid, Twilio, provider dispatch/history, or invoice delivery endpoints.

- [x] **Step 4: Add Money to the dark-mode core route sweep**

Add `{ path: "/money", heading: "Money" }` to `appearance.spec.ts`.

- [x] **Step 5: Run the targeted smoke and watch RED**

Run: `npm run smoke -- --grep "money hub|mobile money|provider mutation"` from `apps/web`.

Expected: FAIL before implementation because the old tab hub does not expose the Horizon cockpit copy.

### Task 2: Implement Money Cockpit

**Files:**
- Modify: `apps/web/src/app/money/page.tsx`

- [x] **Step 1: Wire read-only queries**

Load entities, rent roll, invoice drafts, arrears cases, Xero status, and Basiq status for the selected single entity. Keep the existing all-entity sentinel guard.

- [x] **Step 2: Compute the metric cards**

Use invoice/rent totals for `THIS MONTH`, invoice metadata for `COLLECTED`, arrears cases for `ARREARS`, and Xero freshness for `XERO`.

- [x] **Step 3: Render the Figma first screen**

Render header actions, four 18px-radius metric cards, the invoice-run approval panel, three invoice rows, a trust ribbon, and a primary `Approve run...` link.

- [x] **Step 4: Preserve review route handoffs**

Keep `Run invoices`, `Reconcile payments`, and `Approve run...` as links to `/billing-readiness?tab=delivery`. Keep statements and provider settings links visible below the approval panel.

- [x] **Step 5: Run targeted TypeScript and smoke GREEN**

Run: `npm run typecheck -- --noEmit` if available or the repo's existing typecheck command, plus the targeted Playwright grep from Task 1.

Expected: PASS.

### Task 3: Update Slice Docs

**Files:**
- Modify: `docs/product-roadmap.md`
- Modify: `docs/design-governance.md`
- Modify: `docs/horizon-implementation-brief.md`
- Modify: `docs/next-chat-handover.md`
- Modify: `docs/superpowers/plans/2026-06-11-horizon-money-v1.md`

- [x] **Step 1: Mark Money v1 shipped pending Remba**

Add a `[~]` Money v1 entry to roadmap and design governance with Figma node `61:842`.

- [x] **Step 2: Refresh handover state**

Record the Money scope, verification commands, current commit, and next slice: Insights `61:1063`.

- [x] **Step 3: Check docs for no false completion claims**

Visible work must be described as Remba-pending, not final design-approved.

### Task 4: Verify, Commit, Push, Deploy

**Files:**
- No new source files expected beyond Tasks 1-3.

- [x] **Step 1: Run required local checks**

Run targeted eslint, `tsc --noEmit`, relevant Playwright smokes, production build, and browser checks at 1280x900 and 390x844.

- [ ] **Step 2: Stage only intended tracked files**

Do not stage unrelated untracked `.fuse_hidden*`, marketing, or external-skill files.

- [ ] **Step 3: Commit and push to main**

Commit with Gmail author identity using a terse imperative subject.

- [ ] **Step 4: Confirm Vercel READY**

Check the pushed deployment and update the handover with the deployment proof if needed.
