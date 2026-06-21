# Work Approvals Preview Deep-Link v1.7 Design

## Context

Temba continued the Work approvals lane after sort v1.6. The approvals inbox at
`/operations?tab=approvals` already gathers read-only candidates from Smart
Intake, maintenance approvals, invoice drafts, compliance checks, tenant
onboarding, and assignment notices. It also has local filters, search, sort,
CSV exports, and a selected-candidate preview panel.

This slice makes that selected preview addressable in the browser URL so an
operator can reopen or share the exact approval candidate they were reviewing.

## Goal

Add a read-only `approval` query parameter that opens the matching approval
preview when the approvals tab loads, and keeps the URL in sync when the
operator selects, steps through, closes, or filters away a preview.

## Scope

- Add `approval=<candidate-id>` support to `/operations?tab=approvals`.
- Open the matching candidate once approval data has loaded.
- Update the URL when an operator clicks Preview, Previous, Next, or Close.
- Remove the URL parameter when the selected candidate disappears from the
  visible filtered list.
- Keep all existing filters, search, sort, CSV exports, source handoffs, and
  packet actions unchanged.

## Out of Scope

- No backend endpoint.
- No approval, completion, provider dispatch, email/SMS, Xero/Basiq, payment,
  reconciliation, or source-record mutation.
- No URL persistence for approval filters, search, or sort in this slice.
- No new visual layout or component redesign.

## Interaction Design

1. Opening `/operations?tab=approvals&approval=invoice-draft-abc` waits for the
   loaded visible candidate list, then opens the preview for
   `invoice-draft-abc` if present.
2. Clicking a row's Preview button selects the candidate and writes
   `approval=<candidate-id>` into the current URL.
3. Clicking Previous or Next updates both the selected preview and the URL.
4. Clicking Close preview clears the selected preview and removes `approval`.
5. If filters, search, or sort leave the selected candidate outside the visible
   list, the preview closes and `approval` is removed.

## Testing

- Extend the existing approvals smoke test with a deep-linked invoice preview.
- Verify Preview, Previous, Next, and Close keep the URL in sync.
- Keep the existing forbidden provider-call trap active.
- Re-run the full approvals smoke, compliance smoke, focused lint, TypeScript,
  diff check, and UX screenshots for desktop and mobile.

## Guardrails

The feature is browser-state only. It must not add or call any provider,
communication, billing, payment, reconciliation, Smart Intake apply,
maintenance approval, compliance completion, invoice approval, invoice
delivery, or source-record mutation path.
