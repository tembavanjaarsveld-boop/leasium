# Work Approvals Preview Navigation v1.4 Design

## Goal

Let the operator move to the previous or next visible approval candidate from
inside the read-only approvals preview panel, without closing the panel or
opening a source record.

## Scope

- Add preview navigation controls to `/operations?tab=approvals` only.
- Navigation moves through the currently visible filtered candidate list.
- Show the selected candidate's position in that visible list.
- Disable the previous or next control at the list boundaries.
- Keep existing filter behavior: if filters hide the selected candidate, the
  preview closes.
- Keep existing source handoff and single-candidate packet actions unchanged.

## UX

The preview panel keeps its compact review shape. A small position chip and
Previous / Next controls sit near the preview header, below the close action on
narrow widths as needed. Controls use the existing secondary button styling,
lucide chevrons, and 44px minimum hit targets. Desktop keeps the right-side
review panel; mobile keeps the stacked preview above the lanes.

## Guardrails

This is read-only. It must not add any approval, apply, complete, send,
dispatch, Xero/Basiq, payment, reconciliation, provider-history, or source
record mutation path. Tests continue trapping forbidden provider/comms/payment
calls.

## Testing

- Extend the approvals preview smoke to open the invoice candidate, step to the
  previous visible candidate, step back to the invoice, and confirm the preview
  content changes without mutations.
- Capture desktop and mobile screenshots for the UX pass.

## Non-goals

- No keyboard shortcuts.
- No persisted preview selection.
- No backend/API changes.
- No bulk approve or provider action.
