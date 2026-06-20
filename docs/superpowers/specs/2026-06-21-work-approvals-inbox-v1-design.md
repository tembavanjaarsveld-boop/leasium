# Work Approvals Inbox v1 Design

Date: 2026-06-21

## Goal

Add one review-only approvals inbox inside the Work hub so the operator can see
what needs approval today without remembering which module owns each action.

This slice is a visibility and routing layer over existing review-first flows.
It does not create a new approval engine, approval table, provider workflow, or
inline approve surface.

## Current Context

Leasium already has many review-first approval points:

- Smart Intake rows waiting for operator review or apply.
- AI Mailbox promotions that land as Smart Intake reviews or local Operations
  tasks.
- Maintenance work orders awaiting spend or work approval.
- Invoice drafts in Billing Readiness that are ready for approval.
- Recurring compliance checks that are due or overdue and have linked evidence.
- Tenant onboarding submissions waiting for operator review.
- Work assignment notices ready to send through the existing notice flow.

The problem is not missing mutations. The problem is that approvals are spread
across modules. The operator needs a single "what should I review next?" surface
that links back to the source screen where the actual approved action already
lives.

## Proposed Surface

Add an `Approvals` tab to the existing Work hub at `/operations?tab=approvals`.
It sits beside Queue, Calendar, Maintenance, Compliance, and Arrears. It does
not add a sidebar item.

The tab has:

- A compact summary strip: `Needs approval`, `Ready`, `Blocked`, and
  `Provider-adjacent`.
- A grouped approvals list with rows sorted by urgency.
- Local copy/download review packet actions if implementation can reuse the
  existing CSV helper without adding complexity.
- Empty and loading states written in plain language.

Each row answers:

- what needs approval
- why it is ready or blocked
- where it came from
- what would happen if the operator approves on the source screen
- the safest next link, labelled `Review source`

## Candidate Sources

v1 derives candidates client-side from records already loaded by the Work page.
No backend endpoint is required unless implementation discovers a field missing
from an existing response.

Candidate rules:

- **Smart Intake review:** open `DocumentIntake` rows with `ready_for_review`,
  `needs_attention`, or another non-applied review state. Link to
  `/intake?entity_id={entity_id}&review={intake_id}`.
- **AI Mailbox handoff:** mailbox-origin Smart Intake rows or local Operations
  tasks appear through the existing Smart Intake and Work queue records. Do not
  query the mailbox separately in v1.
- **Maintenance approval:** maintenance work orders with
  `approval_status=pending` or `status=awaiting_approval`. Link to
  `/operations/maintenance/{work_order_id}`.
- **Invoice approval:** invoice drafts with `status=ready_for_approval`. Link
  to `/billing-readiness?entity_id={entity_id}&invoice_id={invoice_draft_id}`.
- **Compliance completion review:** active compliance checks that are due or
  overdue and have linked evidence. Link to
  `/operations?tab=compliance#compliance-check-{check_id}`.
- **Tenant onboarding review:** submitted or review-ready tenant onboarding
  rows. Link to the tenant or onboarding source already used by the Work queue.
- **Assignment notice review:** assignment notices whose local preview is ready
  to send. Link to the Work queue row or source record, not to a direct send
  action.

Each candidate should have a small local shape:

- id
- kind
- title
- source label
- reason
- readiness state: `ready`, `blocked`, `provider_adjacent`, or `watching`
- urgency date or age
- status tone
- source href
- guardrail summary

## Grouping

Use simple deterministic groups:

1. `Ready for review`: local review can proceed on the source screen.
2. `Needs evidence or setup`: the operator needs missing evidence, a contact,
   an assignee, or a required field before approval.
3. `Provider-adjacent approval`: approval would eventually send, post, sync, or
   reconcile through another explicit source-screen action.
4. `Recently safe / no action`: optional group for rows that are useful context
   but do not need action today. Hide this group if empty.

The first version should bias toward showing fewer, clearer rows. If a record is
already complete, archived, dismissed, applied, void, or outside the relevant
approval window, keep it out of the inbox.

## Behavior

Opening the Approvals tab is read-only.

Allowed behavior:

- derive rows from already-loaded Work data
- navigate to source screens
- copy or download a local review CSV if included
- preserve current entity and all-entities behavior

Forbidden behavior:

- no inline approve, complete, apply, dispatch, send, post, sync, reconcile, or
  payment action
- no Xero, Basiq, SendGrid, Twilio, provider-history, payment, or reconciliation
  call
- no Smart Intake apply
- no compliance completion
- no invoice approval, invoice delivery, or Xero posting approval
- no maintenance approval or contractor dispatch
- no comms dispatch, dismiss, or candidate mutation

All provider-adjacent rows must name the boundary in plain language: approving
on the source screen is still a separate explicit operator action.

## UX Requirements

- Reuse the shipped Horizon Work tab pattern: compact tabs, count chips, grouped
  rows, familiar status badges, and existing button styles.
- Do not create cards inside cards. Rows can use dividers, compact grouped
  sections, and left rails.
- The first viewport should make the top approval count and first ready item
  visible on desktop and mobile.
- On mobile, the summary strip can become a horizontal rail; row actions remain
  full-width or at least 44px tall.
- The primary row action is `Review source`. Secondary actions should be local
  copy/download only.
- Do not use general trust-pill copy. Put guardrails on the row where they
  matter, especially provider-adjacent rows.
- Capture screenshots at 1440px and 390px, apply the UX gate checklist, and log
  the pass in `docs/design-governance.md`.

## Testing

Frontend smoke should cover:

- opening `/operations?tab=approvals`
- seeing candidates from at least Smart Intake, maintenance approval, invoice
  approval, compliance completion review, and tenant onboarding or assignment
  notice fixtures
- grouped counts for ready, blocked, and provider-adjacent rows
- `Review source` links point to the existing source routes
- copy/download review packet, if included, is formula-safe and local-only
- opening the tab and exporting the packet do not call forbidden provider,
  comms, Xero, Basiq, payment, reconciliation, Smart Intake apply, compliance
  completion, invoice approval, or maintenance approval routes
- mobile 390px touch targets and no horizontal overflow

Backend tests are not required for the first implementation if all rows derive
from existing Work page queries. If a minimal read-only field is added to an
existing API response, add focused backend coverage for that field.

## Definition Of Done

- Work has an `Approvals` tab at `/operations?tab=approvals`.
- The operator can see a concise list of review-needed items across the existing
  Work data sources.
- Every row links to its source screen for the actual approval.
- The tab introduces no new mutations or provider behavior.
- Focused smoke, relevant lint/type checks, `git diff --check`, and UX
  screenshots pass.
- Roadmap, UX log, and next-chat handover are updated after implementation.
