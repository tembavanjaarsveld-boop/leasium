# Work Approvals URL State v1.8 Design

## Context

Work approvals v1.7 made one selected approval preview reopenable from the URL
with `approval=<candidate-id>`. The inbox still resets its local view controls
when an operator refreshes or shares the page, so a narrowed review view cannot
yet be reopened as seen.

This slice keeps the approvals inbox read-only while making the current view
state shareable.

## Goal

Persist the approvals state filter, source filter, search query, and sort mode
in the browser URL, then restore them when `/operations?tab=approvals` loads.

## Query Parameters

- `approval_state`: `ready`, `blocked`, `provider_adjacent`, or `watching`.
- `approval_source`: one approval source id such as `invoice_draft` or
  `assignment_notice`.
- `approval_search`: the local search text.
- `approval_sort`: `due_soon` or `source`.

Defaults stay omitted:

- State defaults to `all`.
- Source defaults to `all`.
- Search defaults to empty.
- Sort defaults to `grouped`.

## Interaction Design

1. Opening a URL such as
   `/operations?tab=approvals&approval_state=provider_adjacent&approval_source=invoice_draft&approval_search=INV-2001&approval_sort=source`
   restores the visible approvals list to the same narrowed view.
2. Changing state, source, search, or sort updates the URL using
   `window.history.replaceState`, matching the existing operations tab/filter
   behavior.
3. `Clear approval filters` resets state, source, search, and sort, and removes
   all four approval-view parameters.
4. Existing `approval=<candidate-id>` preview deep-links remain independent and
   continue to clear when the selected candidate is hidden by the restored
   filters.

## Out of Scope

- No backend endpoint.
- No saved-view database model.
- No new buttons, menus, or visual component redesign.
- No URL persistence for calendar filters, queue filters beyond the existing
  operations parameters, or CSV packet contents.
- No approval, completion, apply, dispatch, email/SMS, Xero/Basiq, payment,
  reconciliation, provider-history, or source-record mutation.

## Testing

- Extend the existing approvals smoke flow with a URL-restored provider-adjacent
  invoice view.
- Verify the source select, search field, sort select, visible list, CSV export,
  and URL parameters match the restored view.
- Verify `Clear approval filters` removes all approval-view parameters.
- Keep the existing forbidden provider-call trap active.

## UX Pass

Use mocked approvals data to capture desktop and mobile screenshots of a
restored narrowed approval view. The visual expectation is unchanged from the
existing approvals inbox: compact filter band, selected query state visible in
the native controls, no horizontal overflow, and no bottom-nav collision on
mobile.

## Guardrails

The feature is browser-state only. It must not add or call any provider,
communication, billing, payment, reconciliation, Smart Intake apply,
maintenance approval, compliance completion, invoice approval, invoice
delivery, or source-record mutation path.
