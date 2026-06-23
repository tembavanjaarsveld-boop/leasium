# Monthly Billing Run UX

Date: 2026-06-23

## Goal

Make monthly rent invoicing feel like one operator run after setup: generate invoices, resolve only real exceptions, and batch-dispatch approved invoices. Provider writes still require explicit approval.

## Approved Design

- Keep setup checks visible, but separate them from the monthly run.
- Promote the next monthly action above the month-end accounting checklist.
- Show true blockers and warning-only setup issues with plain language.
- Treat payment reconciliation as a follow-up state, not a blocker to sending invoices.
- Keep Xero posting/email actions review-first and provider-inert unless explicitly approved.

## Success Criteria

- Billing readiness explains the monthly flow in one screen.
- Operators see one primary action for the next step instead of multiple review buttons.
- Tests cover the new copy and navigation behavior with mocked providers.
