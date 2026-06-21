# Work Approvals Sort v1.6 Design

## Purpose

The approvals inbox now has enough sources that operators need one more way to
scan it after filtering or searching. v1.6 adds a local sort control so the
same already-loaded approval candidates can be reviewed by grouped priority,
due date, or source without leaving the Work hub.

## Scope

- Add an `Approval sort` control to `/operations?tab=approvals`.
- Default to the current grouped priority order so existing behavior is
  unchanged on first load.
- Add `Due soon` and `Source` options.
- When using the default grouped sort, keep the existing Ready / Needs evidence
  / Provider-adjacent grouped lanes.
- When using `Due soon` or `Source`, render one sorted review list so the visible
  order on screen, preview previous/next, and copy/download CSV order all match.
- Keep state/source filters, search, selected-preview clearing, source handoffs,
  packet copy/download, and visible-list CSV behavior intact.
- Keep the slice frontend-only and read-only.

## Out Of Scope

- No backend sort endpoint or persisted preference.
- No approval, apply, complete, send, dispatch, provider, payment, or
  reconciliation action.
- No new approval candidate source.
- No change to the source records themselves.

## UX

The control sits in the existing filter band beside Search and Approval source.
It uses a native select for compactness and mobile reliability. The `Grouped`
option preserves the current lane layout; the sorted options replace the lane
headers with one `Sorted approvals` section so the user sees the actual sort
order without scanning across buckets.

## Testing

Extend the existing approvals smoke coverage:

- Red first on the missing `Approval sort` control.
- Verify `Due soon` puts the earliest due visible candidate first.
- Verify CSV export follows the due-sort order.
- Verify preview navigation follows the due-sort order.
- Verify `Clear approval filters` returns sort to `Grouped`.
- Continue asserting no forbidden provider/comms/payment/reconciliation or
  source-record mutation calls.

## Guardrails

Sorting is a local read-only view over `visibleApprovalCandidates`. It does not
call Xero/Basiq, SendGrid, Twilio, tenant/owner/provider email, SMS, Smart
Intake apply, maintenance approval, compliance completion, invoice approval or
delivery, payment, reconciliation, source-record mutation, or provider-history
mutation paths.
