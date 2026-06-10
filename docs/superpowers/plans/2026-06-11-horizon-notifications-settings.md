# Horizon Notifications + Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved Horizon Notifications (`55:307`) and Settings (`55:439`) desktop frames without changing provider mutation behaviour.

**Architecture:** Keep the existing API queries, explicit send/retry/update mutations, and review-first guardrails intact. Re-shape the default page hierarchy and styling in the route files to match the locked Figma frames: channel/status cards, split notification queues, settings tab cards, per-operator cards, ownership tags, appearance, and trust ribbons.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind tokens, TanStack Query, Playwright smoke tests.

---

### Task 1: Red Smokes

**Files:**
- Modify: `apps/web/tests/smoke/notifications.spec.ts`
- Modify: `apps/web/tests/smoke/settings.spec.ts`

- [x] **Step 1: Add Notifications Horizon smoke**

Add a test that visits `/notifications` and asserts:
- page heading `Notifications`
- summary copy `Work notices and digest receipts`
- channel health cards for `Email`, `SMS`, and `In-app`
- `NEEDS YOU` and `RECEIPTS` sections
- read-only trust ribbon copy
- no provider mutation calls during load

- [x] **Step 2: Add Settings Horizon smoke**

Add a test that visits `/settings` and asserts:
- page heading `Settings`
- section cards for `Organisation`, `Security`, `Notifications`, and `Connect`
- `WORK NOTIFICATIONS` per-operator panel
- operator cards with assignment email/SMS controls and managed templates
- `OWNERSHIP TAGS`, `APPEARANCE`, and review-first provider guardrail copy
- no provider send/accounting mutation calls during load

- [x] **Step 3: Verify red**

Run:

```bash
npm --prefix apps/web run test:smoke -- notifications.spec.ts settings.spec.ts --project=chromium
```

Expected: the new Horizon assertions fail against the old page hierarchy.

### Task 2: Notifications Frame

**Files:**
- Modify: `apps/web/src/app/notifications/page.tsx`

- [x] **Step 1: Rework top summary**

Replace the KPI strip with the Figma channel health cards and header actions while keeping `Mark reviewed`, `Refresh`, and local export actions available.

- [x] **Step 2: Split queues**

Render filtered actionable notices under a `NEEDS YOU` panel and digest/quiet receipts under a `RECEIPTS` panel. Keep `Receipt evidence`, `Message preview`, explicit send/retry buttons, and all mutation handlers unchanged.

- [x] **Step 3: Add trust ribbon**

Render `Notification center is read-only — sends need your explicit approval.` beneath the queue panels.

- [x] **Step 4: Verify green for Notifications**

Run the Notifications smoke and targeted type/lint checks.

### Task 3: Settings Frame

**Files:**
- Modify: `apps/web/src/app/settings/page.tsx`

- [x] **Step 1: Rework settings header/tab cards**

Set the default tab to `organisation`, replace the pill tablist with four Horizon cards, and preserve route-driven `?tab=security|organisation|connect` behaviour.

- [x] **Step 2: Rework default organisation view**

On the organisation/default view, surface the Figma panels first: per-operator Work notification cards, ownership tags, appearance controls, and provider review-first trust ribbon. Keep deeper organisation/security/connect sections reachable behind their tab cards without changing their provider behaviours.

- [x] **Step 3: Verify green for Settings**

Run the Settings smoke and targeted type/lint checks.

### Task 4: Docs, Browser, Commit

**Files:**
- Modify: `docs/product-roadmap.md`
- Modify: `docs/design-governance.md`
- Modify: `docs/next-chat-handover.md`

- [x] **Step 1: Update docs**

Add the slice as Remba-pending and note that provider mutation paths were unchanged.

- [x] **Step 2: Full verification**

Run targeted ESLint, `tsc --noEmit`, relevant Playwright smokes, production build, and browser checks at desktop/mobile. Commands and visual-check notes are recorded in the handover.

- [ ] **Step 3: Commit and push**

Stage only slice files, commit with the Gmail identity, push `main`, and confirm Vercel READY.
