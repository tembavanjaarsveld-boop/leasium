# Work Approvals Inbox v1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the shipped Work approvals inbox with read-only filters and tighter source handoffs so the operator can narrow review work without triggering provider, comms, payment, reconciliation, or source-record mutations.

**Architecture:** Keep the approvals inbox client-derived inside `apps/web/src/app/operations/page.tsx`. Add local React state for approval group/source filters, derive a visible candidate list, and reuse the existing CSV/export guardrail with the filtered list. Tighten links only where stable routes already exist.

**Tech Stack:** Next.js App Router, React, Playwright smoke tests, Leasium operations UI primitives, local CSV export helpers.

---

### Task 1: Add Failing Smoke Coverage

**Files:**
- Modify: `apps/web/tests/smoke/operations-approvals.spec.ts`

- [x] Add a shared approvals mock setup if needed so the v1 and v1.1 tests use the same candidate data.
- [x] Add a smoke test that visits `/operations?tab=approvals`, filters by `Provider-adjacent`, filters source to `Invoice drafts`, and confirms the visible candidate list narrows.
- [x] Confirm copied/downloaded approvals CSV content is scoped to the filtered list.
- [x] Confirm tenant onboarding "Review source" points to `/tenants/tenant-1`.
- [x] Confirm the forbidden provider/comms/payment/reconciliation trap remains quiet.
- [x] Run `cd apps/web && npm run test:smoke -- tests/smoke/operations-approvals.spec.ts` and verify the new test fails before implementation.

### Task 2: Implement Filters And Handoffs

**Files:**
- Modify: `apps/web/src/app/operations/page.tsx`

- [x] Add approval filter types and labels for group state and source kind.
- [x] Add local filter state with default `all` values.
- [x] Derive `visibleApprovalCandidates` and grouped sections from the filtered candidates.
- [x] Scope copy/download approvals CSV to `visibleApprovalCandidates`.
- [x] Add filter controls above the candidate list, including clear filters when active.
- [x] Add a filtered-empty state distinct from the no-candidates state.
- [x] Change tenant onboarding approval links to `/tenants/:tenantId` when present.
- [x] Route maintenance assignment notices to `/operations/maintenance/:workOrderId`.

### Task 3: UX Gate And Docs

**Files:**
- Modify: `docs/product-roadmap.md`
- Modify: `docs/design-governance.md`
- Modify: `docs/next-chat-handover.md`

- [x] Capture and inspect desktop 1440px and mobile 390px screenshots for `/operations?tab=approvals`.
- [x] Fix any in-slice UX issues found in screenshots.
- [x] Add a dated UX pass log entry.
- [x] Update the roadmap and handover docs with the shipped v1.1 status.

### Task 4: Verify, Commit, Push

- [x] Run `cd apps/web && npm run test:smoke -- tests/smoke/operations-approvals.spec.ts`.
- [x] Run `cd apps/web && npm run test:smoke -- tests/smoke/operations-compliance.spec.ts`.
- [x] Run `cd apps/web && npm run lint -- src/app/operations/page.tsx tests/smoke/operations-approvals.spec.ts`.
- [x] Run `cd apps/web && npx tsc --noEmit`.
- [x] Run `git diff --check`.
- [x] Commit only the v1.1 files.
- [x] Push `main` and confirm production deployment is healthy.
