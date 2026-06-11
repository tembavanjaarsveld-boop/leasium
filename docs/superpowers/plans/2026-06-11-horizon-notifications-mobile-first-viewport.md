# Horizon Notifications Mobile First Viewport Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring mobile `/notifications` in line with the approved 03 Screens
Notifications mobile frame (`PO2jOANgmqgZHfqWZXOZGU`, node `59:594`) while
preserving the desktop notification-center console.

**Architecture:** Keep the existing data, mutations, export handlers, evidence
disclosures, and desktop filters. Add a mobile-only first-viewport layer with
readiness chips, compact Needs You cards, and digest receipt cards; hide
desktop-only filters, export/header actions, provider setup checks, trust
ribbon, and Open Work handoff below the desktop breakpoint.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind utility
classes, Playwright smoke tests.

---

### Task 1: Source And Scope

**Files:**
- Read: Figma Notifications mobile frame `59:594`
- Modify: `apps/web/src/app/notifications/page.tsx`

- [x] **Step 1: Pull Figma context**

Use the locked 03 Screens Notifications mobile frame, not 04 Concept. The first
viewport shows Notifications, `2 need you · rest are receipts`, readiness
chips, two Needs You cards, two Receipts cards, and the Horizon bottom nav.

- [x] **Step 2: Preserve desktop workflow**

Keep desktop provider setup checks, filters, exports, evidence disclosures,
review packet actions, trust ribbon, and Open Work handoff available at desktop
widths.

- [x] **Step 3: Add mobile compact layer**

Render mobile readiness chips and compact notice/receipt cards above the fixed
bottom nav. Keep Send SMS, Retry notice, and Send digest as explicit operator
button clicks only; do not trigger provider writes on load.

### Task 2: Smoke Coverage

**Files:**
- Modify: `apps/web/tests/smoke/notifications.spec.ts`
- Modify: `apps/web/tests/smoke/app-flows.spec.ts`

- [x] **Step 1: Add compact mobile smoke**

Assert the 390x844 first viewport has the compact mobile summary, fixture-backed
notification cards, digest card, readiness chips, hidden desktop Export/filter
rails, visible mobile nav, no horizontal overflow, and no provider mutation on
load.

- [x] **Step 2: Keep export proof desktop**

Move the provider readiness CSV export proof to desktop width because Export is
no longer a phone-header action. Keep the local-only/no-API-after-export
guardrails intact.

- [x] **Step 3: Update shared mobile touch-target smoke**

Replace mobile desktop-filter assertions with compact-card action assertions for
Retry notice, Send SMS, and Send digest.

### Task 3: Verification, Docs, Commit

**Files:**
- Modify: `docs/product-roadmap.md`
- Modify: `docs/design-governance.md`
- Modify: `docs/horizon-implementation-brief.md`
- Modify: `docs/next-chat-handover.md`

- [x] **Step 1: Run verification**

Observed before commit:
- Targeted ESLint passed for `apps/web/src/app/notifications/page.tsx`,
  `apps/web/tests/smoke/notifications.spec.ts`, and
  `apps/web/tests/smoke/app-flows.spec.ts`.
- `npm exec -- tsc --noEmit --pretty false` passed.
- Focused Notifications mobile/export smokes passed **2/2**.
- Shared mobile Notifications action smoke passed **1/1**.
- Full Notifications smoke passed **6/6**.
- Mobile production route sweep passed **1/1** after rerunning sequentially
  following an EADDRINUSE collision from parallel Playwright web servers.
- `npm run build` passed.
- In-app browser QA passed for responsive chrome/no overflow at 390x844 and
  1280x900. Live browser data was not mocked, so card content fidelity is
  covered by the mocked Playwright smokes.

- [x] **Step 2: Record as Remba-pending**

Update roadmap, design governance, Horizon brief, and next-chat handover. Do
not mark `[x]` complete until Remba signs off the visible mobile hierarchy.

- [x] **Step 3: Commit, push, and Vercel**

Stage only slice files, commit with the Gmail identity, push `main`, and confirm
the production Vercel deployment reaches READY.

Observed after commit:
- Implementation commit `6245648` pushed to `main`.
- Vercel production deployment `dpl_97giagnbWEZS9sKukKkzUqZ6iuaY` reached
  **READY** with aliases attached to `https://leasium.ai`,
  `https://www.leasium.ai`, and `https://leasium.vercel.app`.
- Live HTTP checks returned 200 for `/notifications`, `/settings`, `/intake`,
  and `/`.
