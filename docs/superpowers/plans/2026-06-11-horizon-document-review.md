# Horizon Document Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved Horizon Document review frame from Figma node `58:352` while preserving Smart Intake's review-first mutation guardrails.

**Architecture:** `/intake?review=...` stays inside `Dashboard mode="intake"`. This slice reshapes `DocumentIntakeReviewPanel` into the two-pane Horizon review detail: source preview on the left, extracted field approvals on the right, and a sticky apply bar. It reuses the existing review draft, include/exclude state, apply target, save/apply/accept/clear handlers, and mocked API paths.

**Tech Stack:** Next.js App Router, React/TypeScript, Tailwind tokens, Playwright smoke tests with mocked API data.

---

## Files

- Modify: `apps/web/src/components/dashboard.tsx`
  - Restyle `DocumentIntakeReviewPanel` against Figma node `58:352`.
  - Add local source-preview state and field-row helpers.
  - Keep provider and apply mutations unchanged.
- Modify: `apps/web/tests/smoke/api-mocks.ts`
  - Extend the lease intake fixture with page/source/confidence metadata used by the Horizon review smoke.
- Modify: `apps/web/tests/smoke/app-flows.spec.ts`
  - Add a red smoke for the Horizon document review detail and no-write guardrail.
- Modify: `docs/product-roadmap.md`, `docs/design-governance.md`, `docs/next-chat-handover.md`
  - Log the design-facing slice as Remba-pending.

## Tasks

### Task 1: Red Smoke For Horizon Review Detail

- [x] Add `smart intake Horizon document review keeps source preview beside extracted fields without mutations` to `apps/web/tests/smoke/app-flows.spec.ts`.
- [x] Extend `intake-1` fixture source metadata in `apps/web/tests/smoke/api-mocks.ts`.
- [x] Run the new smoke and confirm it fails before implementation.

Expected command:

```sh
cd /Users/tembavanjaarsveld/Documents/Stewart/apps/web
PORT=3075 npm run test:smoke -- tests/smoke/app-flows.spec.ts --grep "Horizon document review" --workers=1
```

### Task 2: Implement The Two-Pane Review

- [x] In `DocumentIntakeReviewPanel`, derive review field rows from the existing groups.
- [x] Add the left source preview shell with selected field/page/highlight context.
- [x] Render the right extracted-fields list with confidence, source chips, Approve/Edit/Ignore controls, and existing inputs.
- [x] Move the review-first warning and save/apply actions into a sticky bottom bar.
- [x] Keep apply blockers, target selectors, lease match handling, and existing mutations wired exactly as before.

### Task 3: Verification

- [x] Run the new Horizon document review smoke.
- [x] Run the existing Smart Intake smoke group.
- [x] Run targeted eslint and TypeScript.
- [x] Run the production web build.
- [x] Browser-check `/intake?entity_id=entity-1&review=intake-1` at 1280x900 and 390x844 in light/dark when local data is available.

### Task 4: Docs, Commit, Push

- [x] Update product roadmap, design governance, and next-chat handover as Remba-pending.
- [ ] Commit with a terse imperative subject and push `main`.
- [ ] Confirm Vercel deployment reaches READY.

## Guardrails

- No Xero write, SendGrid email, Twilio SMS, tenant email, payment, or reconciliation paths change.
- No backend/API schema change in this slice.
- Ignore/Edit remains local draft state until the operator explicitly saves or applies.
- `Apply reviewed items` continues to call only the existing Smart Intake apply endpoint.
