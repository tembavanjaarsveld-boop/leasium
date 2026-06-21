# Work Approvals Candidate Packet v1.3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add copy/download packet actions for the single approval candidate selected in the approvals preview drawer.

**Architecture:** Reuse the existing frontend-only `ApprovalCandidate` model and CSV helpers in `apps/web/src/app/operations/page.tsx`. Add a small single-candidate CSV builder, preview-scoped copy/download handlers, and buttons rendered only when a candidate is selected. Keep the existing all-visible approvals export unchanged.

**Tech Stack:** Next.js App Router, React local state, existing Leasium UI primitives, Playwright smoke tests with mocked API/clipboard/downloads.

---

### Task 1: Add Failing Smoke Coverage

**Files:**
- Modify: `apps/web/tests/smoke/operations-approvals.spec.ts`

- [x] Extend the existing preview smoke to install clipboard, select the `Owner recharge invoice`, and click `Copy packet`.
- [x] Assert copied packet text contains `Single approval candidate packet`, `Owner recharge invoice`, `Billing`, `$1,320`, `Bright Cafe Pty Ltd`, the Billing Readiness source link, and `does not approve`.
- [x] Click `Download packet`, assert filename `approval-candidate-invoice-draft-ready-approval-1.csv`, and assert the downloaded CSV equals the copied packet text.
- [x] Assert the forbidden provider/comms/payment/reconciliation trap remains quiet.
- [x] Run `cd apps/web && npm run test:smoke -- tests/smoke/operations-approvals.spec.ts -g "previews a candidate"` and verify it fails before implementation because `Copy packet` does not exist.

### Task 2: Add Single-Candidate Packet Builder

**Files:**
- Modify: `apps/web/src/app/operations/page.tsx`

- [x] Add `approvalCandidatePacketFilename(candidate: ApprovalCandidate)` near the existing approvals CSV helper.
- [x] Add `approvalCandidatePacketCsv(candidate: ApprovalCandidate)` that writes header, candidate field rows, preview detail rows, source link row, and export guardrail row.
- [x] Use the existing `csvCell`, `formatDate`, `approvalKindLabel`, and `APPROVALS_REVIEW_PACKET_GUARDRAIL` helpers.

### Task 3: Wire Preview Packet Actions

**Files:**
- Modify: `apps/web/src/app/operations/page.tsx`

- [x] Add `selectedApprovalPacketText`, `copySelectedApprovalPacket`, and `downloadSelectedApprovalPacket` handlers near the existing approvals export handlers.
- [x] Render `Copy packet` and `Download packet` buttons inside the selected preview panel beside/below `Review source`.
- [x] Keep the buttons read-only and unavailable when no candidate is selected.
- [x] Preserve existing list CSV export/copy behavior.

### Task 4: UX Gate And Docs

**Files:**
- Modify: `docs/product-roadmap.md`
- Modify: `docs/design-governance.md`
- Modify: `docs/next-chat-handover.md`

- [x] Capture desktop 1440px and mobile 390px screenshots for `/operations?tab=approvals` with the invoice preview and packet actions visible.
- [x] Fix any in-slice UX issues found in screenshots.
- [x] Add a dated UX pass log entry.
- [x] Update the roadmap and handover docs with the shipped v1.3 status.

### Task 5: Verify, Commit, Push

- [x] Run `cd apps/web && npm run test:smoke -- tests/smoke/operations-approvals.spec.ts`.
- [x] Run `cd apps/web && npm run test:smoke -- tests/smoke/operations-compliance.spec.ts`.
- [x] Run `cd apps/web && npm run lint -- src/app/operations/page.tsx tests/smoke/operations-approvals.spec.ts`.
- [x] Run `cd apps/web && npx tsc --noEmit`.
- [x] Run `git diff --check`.
- [ ] Commit only the v1.3 implementation files.
- [ ] Push `main`, watch GitHub CI, and confirm production deployment is healthy.
