# Monthly Billing Run UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Billing Readiness present monthly invoicing as one run with exceptions, instead of a stack of repeated review loops.

**Architecture:** Keep provider mutation guardrails unchanged. Update the existing Billing Readiness page copy and grouping only: invoice-run next action first, setup/payment/statement checks as secondary context, then the existing invoice table/actions.

**Tech Stack:** Next.js App Router, React, TypeScript, Playwright smoke tests, existing Leasium UI helpers.

---

### Task 1: Delivery Tab Smoke Test

**Files:**
- Modify: `apps/web/tests/smoke/billing-readiness-ux.spec.ts`

- [x] **Step 1: Add a failing smoke assertion**

Add a test that opens `/billing-readiness?entity_id=entity-1&tab=delivery` and expects the Delivery tab to show a "Monthly invoice run" region with "One run: exceptions first, then batch dispatch" and separate "Setup checks" / "After sending" labels.

- [x] **Step 2: Run the focused smoke test**

Run: `NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/playwright test billing-readiness-ux.spec.ts -g "monthly invoice run"`

Expected: FAIL because the current tab still leads with Delivery & payments plus Month-end checklist.

### Task 2: Delivery Tab Reframe

**Files:**
- Modify: `apps/web/src/app/billing-readiness/page.tsx`

- [x] **Step 1: Implement minimal UI changes**

Add a compact monthly-run panel above the filters. It should show the current next action from `invoiceRunGuide`, say setup checks are one-time/exception work, and say payment reconciliation is after sending.

- [x] **Step 2: Keep provider safety intact**

Do not add new provider calls. Existing dispatch, email, manual sent, and paid buttons keep their current explicit click behaviour.

- [x] **Step 3: Run the focused smoke test**

Run the command from Task 1 again.

Expected: PASS.

### Task 3: Verification And Docs

**Files:**
- Modify: `docs/design-governance.md`

- [x] **Step 1: Add UX pass log**

Add a dated line for Billing Readiness monthly invoice-run UX, including desktop/mobile checks and no provider mutation changes.

- [x] **Step 2: Run full verification**

Run TypeScript, eslint, the billing readiness smoke spec, and the relevant app flow smoke checks. Verify production deploy after commit.
