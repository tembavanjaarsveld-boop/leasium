# Comms Template Preview Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/comms` stored-template preview easier to scan by surfacing the kind-to-template mapping before preview and rendering the output in a compact draft-card rail.

**Architecture:** Keep all behavior local to the existing Comms draft card. Do not change the preview endpoint, dispatch payload, provider send path, template selection rules, or Comms candidate API. Implement the approved Figma frames `Comms · Template preview density` (`116:812`) and mobile companion (`116:933`) with focused Playwright smoke coverage.

**Tech Stack:** Next.js App Router, React Query, TypeScript, existing Horizon UI primitives, Playwright smoke tests.

---

### Task 1: Smoke Coverage

**Files:**
- Modify: `apps/web/tests/smoke/comms-template-preview.spec.ts`

- [x] **Step 1: Add a failing test for the visible mapping**

  Extend the existing template-preview smoke so it expects `Contractor forward maps to maintenance_contractor_update · v1` to be visible before clicking preview, and clicks `Preview stored template` without first opening a disclosure.

- [x] **Step 2: Add responsive fit coverage**

  Add a desktop/mobile smoke loop for `/comms` at `1440x900` and `390x844`, open the Contractor forward tab, assert the mapping and preview button are visible, assert horizontal overflow is at most one pixel, and save screenshots to `output/playwright/comms-template-preview-density-1440.png` and `output/playwright/comms-template-preview-density-390.png`.

- [x] **Step 3: Run red**

  Run `NODE_ENV=development npm --prefix apps/web run test:smoke -- comms-template-preview.spec.ts --workers=1`. Expected before implementation: the smoke fails because the preview button is hidden inside the collapsed disclosure and the mapping copy does not exist.

### Task 2: Comms Draft Card Layout

**Files:**
- Modify: `apps/web/src/app/comms/page.tsx`

- [x] **Step 1: Add template mapping copy**

  For email drafts with a matching stored template, show a compact `Template match` rail above the editable fields:
  `Contractor forward maps to maintenance_contractor_update · v1`.

- [x] **Step 2: Replace the collapsed preview disclosure**

  Replace the `<details>` block with an always-visible preview control and output area. Keep the existing `previewCommsTemplate` mutation, guardrail copy, and edited-text-wins explanation. Do not call dispatch/dismiss from preview.

- [x] **Step 3: Use responsive layout only**

  Desktop: editable subject/recipient/body on the left and stored-template output on the right. Mobile: stack the mapping, fields, preview output, and actions with no horizontal overflow.

### Task 3: Verification and Docs

**Files:**
- Modify: `docs/design-governance.md`
- Modify: `docs/product-roadmap.md`
- Modify: `docs/next-chat-handover.md`

- [x] **Step 1: Run focused verification**

  Run:
  - `npm --prefix apps/web run lint -- src/app/comms/page.tsx tests/smoke/comms-template-preview.spec.ts`
  - `npx tsc --noEmit --pretty false` from `apps/web`
  - `NODE_ENV=development npm --prefix apps/web run test:smoke -- comms-template-preview.spec.ts --workers=1`
  - `npm --prefix apps/web run build`
  - `git diff --check`

- [x] **Step 2: Update source-of-truth docs**

  Record the shipped scope, Figma frames, screenshots, guardrails, and remove the Comms template preview density entry from the UX debt register.
