# Horizon Tenant Portal Mobile v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match the approved Figma Tenant portal mobile frame (`PO2jOANgmqgZHfqWZXOZGU`, node `61:1251`) for the full tenant portal first viewport.

**Architecture:** Add a mobile-only Horizon cockpit to the existing tenant portal full-portal branch, above the current detailed panels. Keep desktop layout and account/claim gates intact; mobile actions are in-page anchors to existing reviewed sections rather than new provider or payment mutations.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind utility classes, Playwright smoke/source tests.

---

### Task 1: Mobile Cockpit Guard

**Files:**
- Modify: `apps/web/tests/smoke/tenants-ux.spec.ts`

- [x] **Step 1: Add failing source smoke**

Assert the tenant portal source includes the mobile-only Horizon cockpit labels and safe anchors.

- [x] **Step 2: Run focused red test**

Run: `cd apps/web && ./node_modules/.bin/playwright test tests/smoke/tenants-ux.spec.ts --grep "tenant portal mobile Horizon cockpit"`

Observed: FAIL before the cockpit was implemented.

### Task 2: Mobile Cockpit Implementation

**Files:**
- Modify: `apps/web/src/app/tenant-portal/tenant-portal-content.tsx`

- [x] **Step 1: Add derived mobile summary helpers**

Use existing `TenantPortalRecord`, invoices, payment summary, maintenance requests, and uploaded documents.

- [x] **Step 2: Add mobile-only Horizon cockpit**

Render identity, balance/pay card, quick actions, requests, and recent documents with Figma tokens and `md:hidden`.

- [x] **Step 3: Preserve existing full portal panels**

Keep desktop status hero at `hidden md:grid`, add section IDs for `tenant-payments`, `tenant-how-to-pay`, `tenant-maintenance`, `tenant-documents`, and `tenant-contact`.

### Task 3: Verification And Docs

**Files:**
- Modify: `docs/product-roadmap.md`
- Modify: `docs/design-governance.md`
- Modify: `docs/horizon-implementation-brief.md`
- Modify: `docs/next-chat-handover.md`

- [x] **Step 1: Run targeted checks**

Run focused eslint, TypeScript, smoke/source tests, production build, and browser checks where the auth environment allows.

Observed: focused GREEN passed; focused ESLint passed; `tsc --noEmit` passed; tenant UX smokes passed **4/4**; tenant portal invite/preview smokes passed **5/5**; account-helper guardrail smokes passed **2/2**; `npm run build` passed; in-app browser QA passed for public tenant portal recovery/entry states at 390x844 and 1280x900 in light/dark where locally reachable. The signed-in full-account cockpit is Clerk-gated locally and remains covered by mocked Playwright guardrails.

- [x] **Step 2: Update docs as Remba-pending**

Record the slice as shipped pending Remba; do not mark design complete.

- [x] **Step 3: Push and verify deployment**

Commit `aa2bfc9` was pushed to `main`, Vercel deployment `dpl_97VosShXoVN8TiWrPmQWgMvFEG8e` reached `READY`, aliases attached to `leasium.ai`, and canonical HTTP checks returned 200 for `/tenant-portal` and `/tenant-portal/tenant-token-1`.
