# Work Message Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the Work detail Comms message-panel density debt by making contractor notification approvals and channel evidence easier to scan.

**Architecture:** Keep the backend comment payload and provider guardrails unchanged. Update the existing `ContractorMessagesCard` layout to match the approved Figma frames `123:812` and `124:850`: portal message first, opt-in email/SMS approval block second, nearby channel evidence third.

**Tech Stack:** Next.js App Router, React, TypeScript, existing Leasium UI primitives, Playwright smoke tests.

---

### Task 1: Smoke Coverage

**Files:**
- Modify: `apps/web/tests/smoke/vendor-portal-messaging.spec.ts`

- [x] **Step 1: Add failing density expectations**

  In the vendor portal messaging smoke, assert that the contractor message panel shows `Notify contractor`, `Default: no provider send`, `Email notification`, `SMS notification`, and `Post message`.

- [x] **Step 2: Add responsive fit coverage**

  Add a 1440/390 viewport loop for `/operations/maintenance/work-order-1` with `vendorPortalMessagingThread: true`, assert no horizontal overflow, and save screenshots to `output/playwright/work-message-density-1440.png` and `output/playwright/work-message-density-390.png`.

- [x] **Step 3: Run red**

  Run `NODE_ENV=development npm --prefix apps/web run test:smoke -- vendor-portal-messaging.spec.ts --workers=1`. Expected before implementation: the smoke fails because the old checkbox row and `Send message` button do not expose the new density copy.

### Task 2: Work Detail UI

**Files:**
- Modify: `apps/web/src/app/operations/maintenance/[workOrderId]/page.tsx`

- [x] **Step 1: Replace checkbox row**

  Replace the two-column checkbox strip in `ContractorMessagesCard` with a `Notify contractor` review block. Keep the same `notifyEmailApproved`, `notifySmsApproved`, and disabled state wiring.

- [x] **Step 2: Clarify the portal action**

  Rename the submit button copy from `Send message` to `Post message`, while preserving the same comment mutation payload and no-provider default.

- [x] **Step 3: Keep evidence close**

  Render the existing `ContractorChannelEvidence` projection adjacent to the contractor message flow without changing receipt data or provider send behavior.

### Task 3: Docs and Verification

**Files:**
- Modify: `docs/design-governance.md`
- Modify: `docs/product-roadmap.md`
- Modify: `docs/next-chat-handover.md`

- [x] **Step 1: Update source-of-truth docs**

  Record the shipped Figma frames, screenshots, guardrails, and remove the Comms message-panel density entry from the UX debt register.

- [x] **Step 2: Run verification**

  Run:
  - `npm --prefix apps/web run lint -- src/app/operations/maintenance/[workOrderId]/page.tsx tests/smoke/vendor-portal-messaging.spec.ts`
  - `npx tsc --noEmit --pretty false` from `apps/web`
  - `NODE_ENV=development npm --prefix apps/web run test:smoke -- vendor-portal-messaging.spec.ts --workers=1`
  - `npm --prefix apps/web run build`
  - `git diff --check`
