# Horizon Insights V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the locked Figma Insights screen as a read-only Horizon cockpit.

**Architecture:** Replace the legacy visible tabbed first screen at `/insights` with the approved Figma hierarchy while keeping the existing detailed reporting panels, snapshot controls, and local review-packet export behavior.

**Tech Stack:** Next.js App Router, React Query, TypeScript, Tailwind token classes, Playwright smoke tests.

---

### Task 1: Lock Insights Smoke Expectations

**Files:**
- Modify: `apps/web/tests/smoke/insights.spec.ts`
- Modify: `apps/web/tests/smoke/app-flows.spec.ts`

- [x] **Step 1: Add Horizon first-screen smoke**

Assert `/insights` shows `Insights`, the Figma subtitle, `Copy review packet`, `Export CSV`, `PORTFOLIO VALUE FLOW`, `COMPLIANCE`, `EXCEPTIONS`, `WHAT CHANGED THIS WEEK`, the three change rows, and no visible legacy tablist.

- [x] **Step 2: Preserve no-provider-mutation coverage**

Watch requests on `/insights` and fail if the first screen triggers non-GET provider/write calls.

- [x] **Step 3: Remove stale tab-click assumptions**

Update Insights smoke and app-flow coverage so finance, operations, and portfolio assertions read stacked sections instead of clicking removed tabs.

- [x] **Step 4: Run the targeted smoke and watch RED**

Run the Horizon first-screen grep before implementation.

Expected: FAIL before implementation because the old tabbed page does not expose the Horizon cockpit copy.

### Task 2: Implement Insights Cockpit

**Files:**
- Modify: `apps/web/src/app/insights/page.tsx`

- [x] **Step 1: Pull Figma source**

Use Figma file `PO2jOANgmqgZHfqWZXOZGU`, node `61:1063`, via `get_design_context`, `get_screenshot`, and token lookup.

- [x] **Step 2: Derive Horizon summary data from existing overview**

Use existing overview fields for annual value flow, compliance current/open state, exception count, arrears/vacancy detail, and what-changed rows. Add no API fields.

- [x] **Step 3: Render the Figma first screen**

Render the Horizon header/actions, three cards, mini value line, compliance ring, and what-changed rail using existing token classes/CSS variables.

- [x] **Step 4: Keep detailed sections below**

Keep live exceptions, billing risk, compliance, maintenance, arrears, invoice status, finance, lease events, activity, owner/entity, shareable snapshots, and controls stacked below the first screen.

- [x] **Step 5: Preserve review-first exports**

Keep `Copy review packet` and `Export CSV` local-only over loaded overview/snapshot data; do not alter snapshot create/revoke handlers.

### Task 3: Update Slice Docs

**Files:**
- Modify: `docs/product-roadmap.md`
- Modify: `docs/design-governance.md`
- Modify: `docs/horizon-implementation-brief.md`
- Modify: `docs/next-chat-handover.md`
- Modify: `docs/superpowers/plans/2026-06-11-horizon-insights-v1.md`

- [x] **Step 1: Mark Insights v1 shipped pending Remba**

Add a `[~]` Insights v1 entry to roadmap and design governance with Figma node `61:1063`.

- [x] **Step 2: Refresh handover state**

Record the Insights scope, verification commands, and remaining closeout work.

- [x] **Step 3: Keep completion language honest**

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
