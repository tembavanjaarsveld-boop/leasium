# Work Approvals Preview Drawer v1.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only inline preview panel to the Work approvals inbox so operators can inspect approval candidates before opening source records.

**Architecture:** Extend the existing client-derived approvals candidate model in `apps/web/src/app/operations/page.tsx` with preview metadata and local selected-candidate state. Render a selected preview panel from already-loaded candidate data, keep row source links intact, and clear the selection when filters hide the selected candidate.

**Tech Stack:** Next.js App Router, React state/effects, Leasium UI primitives, Playwright smoke tests, local CSV/export helpers.

---

### Task 1: Add Failing Smoke Coverage

**Files:**
- Modify: `apps/web/tests/smoke/operations-approvals.spec.ts`

- [x] Add a focused smoke test that uses the existing approvals mock helpers.
- [x] Visit `/operations?tab=approvals`.
- [x] Click `Preview` on the `Owner recharge invoice` row.
- [x] Assert a panel titled `Approval preview` is visible and includes `Owner recharge invoice`, `Billing`, `Ready for approval`, `$1,320`, `Bright Cafe Pty Ltd`, the review-only guardrail text, and a `Review source` link to `/billing-readiness?entity_id=entity-1&invoice_id=invoice-draft-ready-approval-1`.
- [x] Assert the panel has no `Approve`, `Send`, `Post to Xero`, or `Complete` buttons.
- [x] Filter to `Ready` while the invoice preview is open and assert the preview closes because the invoice is no longer visible.
- [x] Assert the forbidden provider/comms/payment/reconciliation trap remains quiet.
- [x] Run `cd apps/web && npm run test:smoke -- tests/smoke/operations-approvals.spec.ts` and verify the new test fails before implementation because `Preview` does not exist.

### Task 2: Implement Preview Model And Selection State

**Files:**
- Modify: `apps/web/src/app/operations/page.tsx`

- [x] Add optional `previewDetails: string[]` to `ApprovalCandidate`.
- [x] Populate `previewDetails` in `buildApprovalCandidates` for each candidate source using already-loaded row data.
- [x] Add `selectedApprovalCandidateId` state.
- [x] Derive `selectedApprovalCandidate` from `visibleApprovalCandidates`.
- [x] Add an effect that clears `selectedApprovalCandidateId` when the selected candidate is no longer visible after filters/data changes.

### Task 3: Render Read-Only Preview Panel

**Files:**
- Modify: `apps/web/src/app/operations/page.tsx`

- [x] Add a `Preview` button to each candidate row beside `Review source`.
- [x] Add selected-row styling with `aria-pressed` on the `Preview` button.
- [x] Render an `Approval preview` panel above the grouped list on mobile and as a right-side panel on desktop when a visible candidate is selected.
- [x] Include title, source, status, due date, context, reason, details, guardrail, `Review source`, and `Close preview`.
- [x] Preserve export/copy behaviour and source handoff links.

### Task 4: UX Gate And Docs

**Files:**
- Modify: `docs/product-roadmap.md`
- Modify: `docs/design-governance.md`
- Modify: `docs/next-chat-handover.md`

- [x] Capture and inspect desktop 1440px and mobile 390px screenshots for `/operations?tab=approvals` with a selected preview.
- [x] Fix any in-slice UX issues found in screenshots.
- [x] Add a dated UX pass log entry.
- [x] Update the roadmap and handover docs with the shipped v1.2 status.

### Task 5: Verify, Commit, Push

- [x] Run `cd apps/web && npm run test:smoke -- tests/smoke/operations-approvals.spec.ts`.
- [x] Run `cd apps/web && npm run test:smoke -- tests/smoke/operations-compliance.spec.ts`.
- [x] Run `cd apps/web && npm run lint -- src/app/operations/page.tsx tests/smoke/operations-approvals.spec.ts`.
- [x] Run `cd apps/web && npx tsc --noEmit`.
- [x] Run `git diff --check`.
- [x] Commit only the v1.2 files.
- [x] Push `main` and confirm production deployment is healthy.
