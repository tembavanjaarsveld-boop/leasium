# Maintenance Review Packet Design

Date: 2026-06-01

## Goal

Give the operator one read-only maintenance handoff packet on each work order.
The packet should answer: what is the job, what is blocking it, what evidence
exists, who has seen it, what is ready for Billing or portals, and what should
happen next.

This continues the low-provider-risk Work/Maintenance runway after the mobile
nav/PWA shell validation. It is a review surface, not a new workflow engine.

## Current Context

The maintenance detail page already has the raw ingredients:

- Status, priority, due date, approval state, quote amount, and contractor
  contact fields.
- Quote/supporting document upload and download rows.
- Linked invoice handoff, Billing Readiness recovery path, and invoice preview
  links.
- Contractor email/SMS send forms and normalized channel receipt evidence.
- Vendor portal share/hide controls using explicit vendor-safe metadata.
- Completion communication drafts and review-only copy actions.
- Activity and linked correspondence panels with CSV export.

The problem is that these signals are spread across the page. The operator can
inspect them, but cannot quickly hand off or review a single compact "where are
we?" packet.

## Proposed Surface

Add a new `Review packet` panel near the top of
`/operations/maintenance/[workOrderId]`, after the live review strip and before
the detailed cards. It should be compact enough to scan in the first viewport on
desktop, and readable as stacked rows on mobile.

The panel contains:

- **Readiness summary:** status, priority, due label, approval state, quote
  state, invoice handoff state, vendor portal state, and correspondence count.
- **Next-action cue:** one plain-English recommendation derived from existing
  fields, for example `Approval waiting`, `Attach quote evidence`, `Prepare
  invoice in Billing`, `Ready for closeout review`, or `Monitoring`.
- **Evidence checklist:** quote documents count, linked invoice, correspondence
  receipts, completion reviews, contractor channel receipts, and vendor portal
  visibility.
- **Safe handoff links:** Open Billing, Open Comms, Open vendor preview, and
  Open tenant when the underlying data already supports those links.
- **Local export actions:** copy a text summary and download a CSV packet from
  already-loaded page data.

The packet should use existing `SectionPanel`, `StatusBadge`, `SecondaryButton`,
and link styling. No new design system primitives are needed.

## Data And Behavior

No new backend route is required for v1. The page already loads the work order,
documents, invoice drafts, contractors, tenants, and correspondence. The packet
should derive its rows client-side from those existing queries.

The packet must not:

- Send contractor email or SMS.
- Create, approve, or void invoice drafts.
- Prepare invoice delivery.
- Share or hide vendor portal visibility.
- Upload or download document bytes automatically.
- Refresh providers, write provider history, write Xero/Basiq data, reconcile
  payments, or send owner/tenant/contractor messages.

Download and copy actions operate only on data already rendered in the page.

## Next-Action Rules

Use deterministic rules in priority order:

1. Closed work orders: `Closed - audit only`.
2. Pending approval without quote evidence: `Attach quote evidence before
   approval`.
3. Pending approval with quote evidence: `Review and approve quote`.
4. Approved or in progress with no linked invoice: `Link or prepare billing
   handoff`.
5. Linked invoice with recovery blockers: `Recover in Billing Readiness`.
6. Completed with unreviewed completion copy: `Review completion
   communications`.
7. Vendor portal visible: `Monitor vendor portal visibility`.
8. Otherwise: `Monitor work order`.

These rules are intentionally simple and explainable. They can be refined later
with real SKJ usage.

## Error And Loading States

The panel should render once the primary work order exists. Subsections whose
supporting queries are still loading can show `Checking` or omit counts until
loaded. If correspondence or document queries fail, the packet should show the
work-order summary and mark that evidence row as unavailable rather than hiding
the whole packet.

Primary work-order 404 and non-404 states remain handled by the existing
status-aware route error polish.

## Tests

Build test-first.

Frontend smoke:

- Add a failing test to the existing maintenance detail smoke path proving the
  `Review packet` panel renders the next-action cue, evidence rows, safe links,
  copy action, CSV download, and no-mutation guardrail.
- Intercept provider/mutation endpoints and assert the packet copy/download
  actions do not call send, invoice, vendor portal share, document upload, Xero,
  Basiq, payment, or provider-history endpoints.

Type/lint verification:

- Run targeted frontend eslint on the maintenance detail route, API types if
  touched, and the smoke file.
- Run `tsc --noEmit`.

No backend test is needed unless implementation discovers a missing field in
the current API response. If a backend field is added, write the failing
integration test first.

## Documentation

After implementation, record the shipped review packet in:

- `docs/product-roadmap.md` under the maintenance/work depth backlog, marked
  `[~]` because the surface is design-facing.
- `docs/design-governance.md` as a prototype-mode Work/Maintenance follow-up.
- `docs/next-chat-handover.md` with verification evidence and the guardrail
  summary.

## Definition Of Done

- The maintenance detail page has a single read-only review packet summarising
  current state, evidence, and next action.
- Copy and CSV export work from loaded page data and include a no-send /
  no-mutation guardrail.
- Existing maintenance detail workflows still work.
- Focused smoke, eslint, `tsc`, `git diff --check`, and any necessary backend
  tests pass.
