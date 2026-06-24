# Work Mobile First-Viewport Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `/operations` mobile Work first viewport into line with the approved Horizon Figma frame `PO2jOANgmqgZHfqWZXOZGU`, node `45:461`, excluding AI Mailbox Intake.

**Architecture:** Keep this as a frontend presentation slice inside the existing Operations workspace. Reuse current queue data, lane classification, range state, team workload rows, and Horizon shell; do not change API shape or provider/mutation behavior.

**Tech Stack:** Next.js App Router, React, TypeScript, existing Tailwind-style utility classes, Playwright smoke tests.

---

### Task 1: Lock Work Mobile First Viewport

**Files:**
- Modify: `apps/web/tests/smoke/operations-ux.spec.ts`
- Modify: `apps/web/src/app/operations/page.tsx`

- [x] **Step 1: Write the failing mobile smoke**

Add or extend a Playwright test that opens `/operations` at `390x844` and asserts:
- `Work` heading is visible.
- The `Work range` group exposes mobile labels `Today`, `Week`, and `All`.
- `Act now`, `Scheduled`, and `Waiting` summary chips are visible before the lane columns.
- At least three mobile work cards are visible in the first viewport and expose compact row actions such as `Complete`, `View`, `Assign`, or `Review`.
- The mobile `TEAM WORKLOAD` panel is visible above the bottom nav.
- Desktop-only controls such as the owner selector/filter rail do not crowd the phone first viewport.
- Horizontal overflow is `0`.

- [x] **Step 2: Run the focused smoke and confirm RED**

Run:
`cd apps/web && ./node_modules/.bin/playwright test tests/smoke/operations-ux.spec.ts -g "mobile Work first viewport matches the Horizon frame" --workers=1`

Expected before implementation: failure because the current mobile first viewport still uses desktop lane layout/copy density and does not match the locked Work mobile frame.

- [x] **Step 3: Implement the smallest presentation change**

Inside `apps/web/src/app/operations/page.tsx`:
- Change mobile range labels to `Today`, `Week`, `All` while preserving desktop `This week` if needed.
- Add a mobile-only first-viewport stack that mirrors Figma: header/range row, lane summary chips, compact work cards, and team workload panel.
- Keep existing desktop Work lanes, compliance tabs, filters, owner controls, inline edits, provider actions, and mutation handlers unchanged.
- Use existing `visibleWorkItems`, `horizonWorkLaneRows`, `teamWorkloadRows`, and `renderHorizonWorkCard` data where possible instead of introducing new API calls.

- [x] **Step 4: Run focused verification**

Run:
`cd apps/web && ./node_modules/.bin/playwright test tests/smoke/operations-ux.spec.ts -g "mobile Work first viewport matches the Horizon frame|maintenance inline undo toast controls stay touch-safe on mobile" --workers=1`

Expected after implementation: both tests pass.

- [x] **Step 5: Run broader frontend checks**

Run:
`cd apps/web && ./node_modules/.bin/eslint src/app/operations/page.tsx tests/smoke/operations-ux.spec.ts`

Run:
`cd apps/web && ./node_modules/.bin/tsc --noEmit --pretty false`

Run:
`cd apps/web && npm run build`

Expected: all commands exit `0`.

### Task 2: Update Source-of-Truth Docs

**Files:**
- Modify: `docs/product-roadmap.md`
- Modify: `docs/design-governance.md`
- Modify: `docs/horizon-implementation-brief.md`
- Modify: `docs/next-chat-handover.md`

- [x] **Step 1: Record shipped scope**

Add a Remba-pending Work mobile first-viewport follow-up entry that says the slice matches Figma `45:461`, preserves existing review-first/provider guardrails, and changes only frontend presentation/smoke coverage.

- [x] **Step 2: Recheck remaining Horizon scope**

Confirm docs state that approved 03 Screens Horizon production work is current excluding AI Mailbox Intake, which remains explicitly out of scope by operator instruction.

- [x] **Step 3: Final verification**

Rerun the focused smoke and inspect the changed docs with `git diff --check`.
