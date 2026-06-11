# Horizon Mobile Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the approved 03 Screens mobile surfaces closer to the locked Horizon mobile frames while preserving every existing provider and workflow mutation path.

**Architecture:** Keep the shipped desktop Horizon routes intact and apply mobile-only density, touch-target, and bottom-nav-safe layout adjustments in the route components. The highest-risk fix is Document review: field action buttons must be 44px touch-safe, source preview must be shorter on mobile, and the sticky apply bar must sit above the fixed bottom nav.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind tokens, TanStack Query, Playwright smoke tests.

**Status (2026-06-11):** Horizon Mobile Polish v1 is documented as shipped pending Remba review. Figma 03 Screens mobile targets: Dashboard `45:371`, Work `45:461`, Properties `59:427`, Smart Intake `59:521`, Notifications `59:594`, Settings `59:677`, Tenant portal mobile `61:1251`. Recorded scope: Work mobile segmented tabs/range target sizing, Notifications compact channel chips/Needs You visibility, Settings compact tabs/touch targets, and Document review mobile source height/touch targets/sticky actions above the bottom nav.

---

### Task 1: Mobile Regression Smokes

**Files:**
- Modify: `apps/web/tests/smoke/mobile-bottom-nav.spec.ts`
- Modify: `apps/web/tests/smoke/app-flows.spec.ts`

- [x] **Step 1: Add production-route mobile sweep**

Add a smoke that sets `390x844`, visits `/`, `/operations`, `/properties`, `/intake`, `/notifications`, and `/settings`, and asserts:
- `document.documentElement.scrollWidth === document.documentElement.clientWidth`
- the route heading is visible
- the fixed `Mobile primary` nav is visible

- [x] **Step 2: Add Document review mobile guardrail smoke**

Add a smoke for `/intake?entity_id=entity-1&review=intake-1` that asserts:
- no horizontal overflow
- field action buttons in `data-testid="document-review-fields"` are at least 44px tall
- the sticky review apply bar sits above the mobile bottom nav
- no provider/write request fires during page load

### Task 2: Document Review Mobile Safety

**Files:**
- Modify: `apps/web/src/components/dashboard.tsx`

- [x] **Step 1: Compact source preview on mobile**

Change the document source preview from a fixed `min-h-[360px]` to a shorter mobile height with the existing desktop height restored at `sm` or above.

- [x] **Step 2: Make field actions touch-safe and non-overflowing**

Change approve/edit/ignore action buttons to `min-h-11`, allow the action group to occupy its own row on mobile, and keep the current row action handlers unchanged.

- [x] **Step 3: Lift sticky apply bar above bottom nav**

Use a mobile `bottom` offset based on the existing shell bottom-nav gutter, and keep desktop/tablet sticky behaviour unchanged.

### Task 3: Mobile Density For Locked Surfaces

**Files:**
- Modify: `apps/web/src/app/operations/page.tsx`
- Modify: `apps/web/src/app/notifications/page.tsx`
- Modify: `apps/web/src/app/settings/page.tsx`

- [x] **Step 1: Work mobile tabs and range controls**

Make the Work range buttons touch-safe and convert the operations section cards into a horizontal mobile segmented strip, with the existing desktop four-card layout preserved at `md`.

- [x] **Step 2: Notifications mobile channel chips**

Render notification channel health as compact mobile chips before returning to the full desktop cards at `md`, so the Needs You queue appears earlier in the first mobile viewport.

- [x] **Step 3: Settings mobile segmented tabs**

Render Settings tabs as a compact horizontal segmented control on mobile, hiding descriptions/icons until `md`, while preserving all route-driven tab behaviour and explicit mutation handlers.

### Task 4: Docs, Verification, Commit

**Files:**
- Modify: `docs/product-roadmap.md`
- Modify: `docs/design-governance.md`
- Modify: `docs/next-chat-handover.md`
- Modify: `docs/horizon-implementation-brief.md`

- [x] **Step 1: Update docs**

Record the mobile companion node IDs (Dashboard `45:371`, Work `45:461`, Properties `59:427`, Smart Intake `59:521`, Notifications `59:594`, Settings `59:677`, Tenant portal mobile `61:1251`) and mark the mobile polish slice Remba-pending.

- [x] **Step 2: Verify**

Verified with targeted ESLint, `tsc --noEmit`, the mobile/Horizon Playwright smoke sweep, production build, and 390x844 light/dark browser QA for `/operations`, `/notifications`, `/settings`, and focused Document review.

- [ ] **Step 3: Commit, push, and Vercel**

Stage only slice files, commit with the Gmail identity, push `main`, and confirm the production Vercel deployment is READY. Do not mark this complete without command/deploy evidence from the current implementation context.
