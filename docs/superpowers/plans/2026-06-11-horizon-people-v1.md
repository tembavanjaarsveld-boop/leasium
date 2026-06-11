# Horizon People v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved Figma People frame (`PO2jOANgmqgZHfqWZXOZGU`, node `61:580`) on `/people`.

**Architecture:** Keep the existing People hub data sources, all-entities fan-out, operating-mode owner gating, and explicit tenant/vendor handoff routes. Replace the old panel/list presentation with a Horizon first screen: compact title/actions, segmented count pills, tenant/vendor/prospect cards, and an add tile. This is presentation/routing only; no provider or mutation path changes.

**Tech Stack:** Next.js App Router, React, TanStack Query, Tailwind CSS, Playwright smoke tests, Figma MCP design context.

---

### Task 1: People Horizon Shell

**Files:**

- Modify: `apps/web/src/app/people/page.tsx`

- [x] **Step 1: Replace the old People header with the Figma header**

Use title `People`, description `Tenants and vendors across the portfolio.`, and right-side links for `Invite tenant` (`/tenants?action=invite`) and `Add person` (`/people?tab=tenants` or the current explicit tenant invite path if a single add route does not exist).

- [x] **Step 2: Render Horizon count pills**

Use existing tenant/vendor data and the operating-mode owner gate to render `Tenants`, optional `Owners`, `Vendors`, and `Prospects` pills with counts. Keep `role="tablist"` and `role="tab"` semantics.

- [x] **Step 3: Render tenant cards**

Replace the list rows in `TenantsTab` with a responsive 3-column Horizon card grid. Each card should show a circular avatar, tenant name, entity/property context, status pill, secondary state, and a touch-safe record link. In all-entities mode, keep entity labels visible on cards.

- [x] **Step 4: Render vendor cards**

Replace the list rows in `VendorsTab` with matching Horizon cards for contractors/vendors. Use existing company/category/contact data and record links. Keep all-entities entity labels visible.

- [x] **Step 5: Render prospects/add tile**

Keep the prospects roadmap state, but present it in the same Horizon dashed add/prospect tile style so the first screen matches Figma while staying honest about roadmap status.

### Task 2: Smoke Coverage

**Files:**

- Modify: `apps/web/tests/smoke/people-hub.spec.ts`

- [x] **Step 1: Update People hub expectations**

Assert the Figma header copy, Horizon count pills, tenant/vendor cards, add tile, and existing owner gating behavior.

- [x] **Step 2: Add provider/write guard**

On `/people`, trap unsafe provider or write paths and assert the Horizon first screen does not call SendGrid, Twilio, Xero, Basiq, payment, reconciliation, tenant onboarding send, contractor dispatch, or mutating tenant/contractor endpoints on load.

- [x] **Step 3: Preserve mobile touch-safety**

Keep tab/button touch targets at or above 44px on 390×844.

### Task 3: Docs

**Files:**

- Modify: `docs/product-roadmap.md`
- Modify: `docs/design-governance.md`
- Modify: `docs/horizon-implementation-brief.md`
- Modify: `docs/next-chat-handover.md`
- Modify: `docs/superpowers/plans/2026-06-11-horizon-people-v1.md`

- [x] **Step 1: Record node IDs**

Update the Horizon implementation brief so People is pinned to node `61:580`, Money to `61:842`, and Insights to `61:1063`.

- [x] **Step 2: Mark People Remba-pending**

Record the design-facing People slice as `[~]` and Remba-pending. Do not mark complete until Remba signs off.

### Task 4: Verify And Ship

**Files:**

- No additional app files beyond Tasks 1-3.

- [x] **Step 1: Run targeted checks**

Run targeted ESLint for the changed route/test, `tsc --noEmit`, the People smoke file, relevant app-flow/mobile smokes, production build, and `git diff --check`.

- [x] **Step 2: Browser QA**

Check `/people` at 1280×900 and 390×844 for visible People header/cards, no horizontal overflow, and no top-level overlap.

- [x] **Step 3: Commit, push, deploy**

Stage only People v1 files and docs, commit with the Gmail identity, push `main`, and confirm Vercel READY.

Commit `09b9bfd` deployed as Vercel `dpl_H1JD2k5pFkcu1W1Ch7tVHucRiWy4`, state
`READY`; `https://leasium.ai/` and `https://leasium.ai/people` returned HTTP
200.
