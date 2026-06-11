# Horizon Dashboard Hero/Bento Polish v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the shipped Dashboard against the approved Figma Dashboard frame (`PO2jOANgmqgZHfqWZXOZGU`, node `45:2`) by making the first screen match the Horizon hero/bento hierarchy.

**Architecture:** Keep the existing Dashboard data sources and review-first mutation paths. Change only normal Dashboard mode (`/`), not Smart Intake mode (`/intake`). Use existing rent-roll, Insights, obligations, onboarding, and document-intake data to render the bento cards; keep scoped-only panels guarded in all-entities mode.

**Tech Stack:** Next.js App Router, React, Tailwind CSS, Playwright smoke tests, Figma MCP design context.

---

### Task 1: Figma-Aligned Dashboard First Screen

**Files:**
- Modify: `apps/web/src/components/dashboard/DashboardCommandCenter.tsx`
- Modify: `apps/web/src/components/dashboard.tsx`

- [x] **Step 1: Pull Figma source of truth**

Pulled Dashboard `45:2` via Figma MCP `get_design_context` and `get_screenshot`.

- [x] **Step 2: Move trust ribbon to the first-screen footer**

Remove the trust ribbon from inside the hero and render it after the bento rows, matching the approved frame hierarchy.

- [x] **Step 3: Replace old metric strip with Horizon bento cards**

Render live Occupancy, Arrears, Work queue, and Billing cards using existing Dashboard data. Keep all cards navigational only.

- [x] **Step 4: Add lower Horizon row**

Render Lease horizon, Onboarding, and Smart Intake cards while keeping `Open Smart Intake` and `Manage links` handoffs touch-safe.

- [x] **Step 5: Remove duplicate Dashboard-only first-screen stack**

Remove the old Smart Intake / Onboarding / Needs attention / Events / Billing updates first-screen stack from normal Dashboard mode. Leave `/intake` and the dedicated lower Dashboard panels intact.

### Task 2: Smoke Coverage

**Files:**
- Modify: `apps/web/tests/smoke/dashboard-command-center.spec.ts`

- [x] **Step 1: Update loading smoke**

Assert the new bento strip renders contextual loading text without raw ellipses.

- [x] **Step 2: Add Horizon bento regression**

Assert the first screen includes the bento cards, lease horizon row, trust ribbon, touch-safe handoffs, and no provider/write requests on load.

- [x] **Step 3: Preserve dashboard flow expectations**

Keep the dashboard app-flow happy path passing with the renamed Billing card and existing route handoffs.

### Task 3: Docs

**Files:**
- Modify: `docs/product-roadmap.md`
- Modify: `docs/design-governance.md`
- Modify: `docs/horizon-implementation-brief.md`
- Modify: `docs/next-chat-handover.md`
- Add: `docs/superpowers/plans/2026-06-11-horizon-dashboard-hero-bento-polish-v2.md`

- [x] **Step 1: Mark the slice Remba-pending**

Record the design-facing Dashboard change as `[~]` and Remba-pending, not complete.

- [x] **Step 2: Record local verification**

Add final local build, browser, and smoke evidence. Commit, push, and deployment evidence will be recorded after Vercel reaches READY.

### Task 4: Verify, Commit, Push, Deploy

**Files:**
- No additional app files beyond Tasks 1-3.

- [x] **Step 1: Verify locally**

Run targeted ESLint, `tsc --noEmit`, Dashboard/app-flow/mobile/appearance smokes, production build, `git diff --check`, and browser QA at 1280x900 and 390x844.

- [x] **Step 2: Commit and push**

Stage only the Dashboard v2 slice files and docs, commit with the Gmail identity, push `main`, and confirm Vercel deployment is READY.

Committed as `55bdb06b26944b79b2cba28d64f4ebcb4e66de66`, pushed to `main`, and confirmed Vercel production deployment `dpl_JCsAezFVoKc17PVEzkQQcsiqVkGx` reached READY. `https://leasium.ai/` returned `HTTP/2 200`.
