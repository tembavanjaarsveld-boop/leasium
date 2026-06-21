# Work Approvals Preview Drawer v1.2 Design

Date: 2026-06-21
Owner: Temba
Surface: `/operations?tab=approvals`

## Goal

Make the Work approvals inbox useful for review without forcing the operator to leave the page for every candidate. Add a read-only inline preview drawer/panel that shows the key source details, guardrail, and exact handoff for the selected approval candidate.

## Approved Scope

- Add a `Preview` action beside each existing `Review source` link.
- Keep `Review source` unchanged as the navigation handoff to the source record.
- Show one selected candidate at a time in an inline detail panel on the approvals tab.
- Keep all preview content derived from already-loaded Work page data.
- Add no provider/comms/payment/reconciliation/source-record mutation.

## Preview Content

Every preview shows:
- Candidate title, source, status, decision state, due date, and context.
- Why it is in the approvals inbox.
- The existing source-specific guardrail.
- A `Review source` link to the same destination as the row.

Source-specific detail should stay compact:
- Smart Intake: document type/file context, review reason, created/due date, Smart Intake handoff.
- Maintenance: property/tenant context, quote/limit notes, due date, maintenance handoff.
- Invoice draft: recipient, amount, due date, Billing Readiness handoff.
- Compliance: evidence/current obligation context, next action, compliance-tab handoff.
- Tenant onboarding: tenant name, due date, submission/follow-up reason, tenant detail handoff.
- Assignment notice: underlying queue item, assignee name/email when available, notice reason, source handoff.

## UX Shape

- Desktop: render the preview as a right-side inline panel below the filters when space allows, so the candidate list and preview can be scanned together.
- Mobile: render the same preview panel above the candidate groups after the filters, with a close button and full-width actions.
- The selected row should show a calm active border/tint.
- Closing the panel returns to the filtered list without changing filters.
- If the selected candidate is filtered out, clear the preview selection.

## Non-goals

- No approval, complete, apply, send, dispatch, post-to-Xero, payment, reconciliation, or provider-history action.
- No new backend endpoint.
- No new Figma tokens or global component redesign.
- No source-record editing inside the drawer.

## Success Criteria

- Smoke coverage proves clicking `Preview` opens details for a provider-adjacent invoice candidate.
- Smoke coverage proves changing filters clears or updates the selected preview safely.
- Smoke coverage proves the preview keeps the same source handoff and does not introduce forbidden mutation calls.
- UX screenshots at 1440px and 390px show no overlapping controls, cramped buttons, or bottom-nav collisions.
