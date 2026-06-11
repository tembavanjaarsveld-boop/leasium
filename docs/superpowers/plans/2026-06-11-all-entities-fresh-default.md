# All Entities Fresh Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fresh multi-entity operator sessions should land on the cross-entity `All entities` view by default, while single-entity organisations still land directly on their only entity.

**Architecture:** Reuse the shared `defaultEntitySelection()` helper in every workspace that already supports all-entities fan-out. Keep single-entity-only routes on their existing sentinel-clearing behavior. Update smoke fixtures so tests that assert single-entity behavior seed the primary entity explicitly, and add one fresh-storage regression that proves the new default on Properties.

**Tech Stack:** Next.js App Router, React state/localStorage, shared entity-selection helper, Playwright smoke tests.

---

### Task 1: Shared Default Across All-Entities Workspaces

**Files:**
- Modify: `apps/web/src/app/billing-readiness/page.tsx`
- Modify: `apps/web/src/app/comms/page.tsx`
- Modify: `apps/web/src/app/contractors/page.tsx`
- Modify: `apps/web/src/app/inbox/page.tsx`
- Modify: `apps/web/src/app/insights/page.tsx`
- Modify: `apps/web/src/app/notifications/page.tsx`
- Modify: `apps/web/src/app/operations/page.tsx`
- Modify: `apps/web/src/app/people/page.tsx`
- Modify: `apps/web/src/app/portfolio-qa/page.tsx`
- Modify: `apps/web/src/app/tenants/page.tsx`
- Modify: `apps/web/src/components/dashboard.tsx`
- Modify: `apps/web/src/components/property-workspace.tsx`

- [x] **Step 1: Import `defaultEntitySelection`**

Add `defaultEntitySelection` alongside the existing shared entity-selection imports on each all-entities-capable workspace.

- [x] **Step 2: Replace first-entity fallback**

Replace fresh-storage fallback logic that used `entities[0]?.id` with `defaultEntitySelection(entities)`.

- [x] **Step 3: Preserve single-entity exceptions**

Keep Smart Intake, Spreadsheet Intake, Money, and Statements behavior single-entity when their workflows do not support portfolio-wide mutation-safe review.

### Task 2: Smoke Fixture Stabilisation

**Files:**
- Modify: `apps/web/tests/smoke/api-mocks.ts`
- Modify: `apps/web/tests/smoke/*.spec.ts`

- [x] **Step 1: Add primary entity seed helper**

Add `seedPrimaryEntitySelection(page)` to seed `leasium.entity_id = "entity-1"` before specs that assert single-entity behavior.

- [x] **Step 2: Pin single-entity specs**

Import and call `seedPrimaryEntitySelection(page)` in existing smoke specs that were written against the primary entity.

- [x] **Step 3: Keep all-entities specs fresh**

Skip the seed helper for specs whose title contains `All entities`, so they exercise fresh-storage portfolio defaults.

- [x] **Step 4: Add fresh default regression**

Add a Properties smoke that starts without a stored entity, expects `entity_id=__all_entities__`, and sees rows from both demo entities.

### Task 3: Docs And Verification

**Files:**
- Modify: `docs/product-roadmap.md`
- Modify: `docs/design-governance.md`
- Modify: `docs/next-chat-handover.md`
- Modify: `docs/superpowers/plans/2026-06-11-all-entities-fresh-default.md`

- [x] **Step 1: Record Remba-pending behavior change**

Log the all-entities fresh default as a user-visible IA behavior change pending Remba review.

- [x] **Step 2: Verify locally**

Run targeted ESLint, `tsc --noEmit`, the entity-selection smoke set, production build, and browser sanity for fresh `/properties` at desktop/mobile.

- [x] **Step 3: Commit, push, deploy**

Stage only the all-entities default slice files and docs, commit with the Gmail identity, push `main`, and confirm Vercel `READY`.
