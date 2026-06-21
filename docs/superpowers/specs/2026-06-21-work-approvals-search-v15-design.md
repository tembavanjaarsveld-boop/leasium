# Work Approvals Search v1.5 Design

## Goal

Let the operator quickly narrow the Work approvals inbox by typing a term before
previewing, opening a source record, or exporting the review packet.

## Scope

- Add a read-only search input to `/operations?tab=approvals`.
- Search filters the currently loaded approval candidates together with the
  existing decision-state and source filters.
- Search matches candidate title, kind, source label, status, context, reason,
  guardrail, due date text, and preview details.
- CSV copy/download exports the searched visible candidate set, matching the
  existing filtered-export behavior.
- If search hides the selected preview candidate, the preview closes through the
  existing visible-list selection guard.
- `Clear approval filters` clears decision state, source, and search.

## UX

Place the search input in the existing filter band beside the source selector.
Use the existing `Input` component, a lucide search icon, an accessible
`Search approvals` label, and the same 44px control height used by the other
Work approvals controls. Desktop keeps filters compact in one row where space
allows; mobile stacks search and source controls without horizontal overflow or
bottom-nav collision.

## Guardrails

Search is local and read-only. It must not add backend calls, provider calls,
approval/apply/complete actions, email/SMS sends, Xero/Basiq writes, payment,
reconciliation, source-record mutation, or provider-history mutation.

## Testing

- Extend the approvals filter smoke to search for the invoice number, confirm
  only the invoice candidate remains, and confirm copied/downloaded CSV packets
  include only the searched visible set.
- Open the invoice preview, change search to another candidate, and confirm the
  preview closes because the selected invoice is no longer visible.
- Keep the forbidden-call trap empty.
- Capture desktop and mobile UX screenshots.

## Non-goals

- No saved searches.
- No backend search endpoint.
- No fuzzy ranking or relevance ordering.
- No keyboard shortcut changes.
