# Work Approvals Candidate Packet v1.3 Design

Date: 2026-06-21
Owner: Temba
Surface: `/operations?tab=approvals`

## Goal

Let the operator copy or download a review packet for the single approval
candidate currently open in the preview drawer, instead of exporting the whole
filtered approvals inbox.

## Approved Scope

- Add `Copy packet` and `Download packet` actions to the selected approval
  preview panel.
- Keep the existing all-visible approvals CSV copy/download unchanged.
- Generate the single-candidate packet from already-loaded
  `ApprovalCandidate` data.
- Include the candidate title, kind, source, status, decision state, context,
  due date, reason, preview details, source link, and the no-mutation guardrail.
- Add no provider/comms/payment/reconciliation/source-record mutation path.

## UX Shape

- Desktop: keep the packet actions inside the right-side preview panel, below
  the source handoff, using the existing compact button style.
- Mobile: the same actions wrap cleanly inside the stacked preview panel with
  44px minimum touch targets.
- Copy and download labels can be short visually, but accessible names should
  identify them as approval-packet actions.
- The packet actions only render when a candidate is selected.

## Packet Content

The packet is CSV and local-only. It should include:

- A short header row naming it as a single approval candidate packet.
- Candidate fields: kind, title, source, status, decision state, context, due
  date, reason, source link.
- One row per preview detail so invoice amounts, recipients, evidence ids,
  assignees, or document metadata are included.
- A final export guardrail row using the existing approvals guardrail language.

## Non-goals

- No approval, complete, apply, send, dispatch, post-to-Xero, payment,
  reconciliation, provider-history, or source-record action.
- No bulk selection.
- No new backend endpoint.
- No new route, modal, Figma token, or global component.

## Success Criteria

- Smoke coverage proves a selected invoice candidate can copy and download a
  single-candidate packet.
- Smoke coverage proves the packet contains the invoice title, Billing source,
  amount, recipient, source link, and no-mutation guardrail.
- Smoke coverage proves copy/download does not trigger forbidden provider,
  comms, payment, reconciliation, or source-record calls.
- UX screenshots at 1440px and 390px show the preview actions wrap without
  overlapping controls or bottom-nav collisions.
