# Arrears Review Packet Design

## Purpose

Add a read-only arrears review packet to the Operations Arrears tab so operators
can quickly understand the next credit-control action for each arrears case
without opening a separate detail route or mutating the case.

This is a low-provider-risk UX runway slice. It mirrors the maintenance review
packet pattern: summarize already-loaded state, make the next action clear, and
allow local copy/CSV export with explicit no-mutation guardrails.

## Scope

In scope:

- Render one compact packet for each visible arrears case in the existing
  `/operations` Arrears tab.
- Derive packet content from already-loaded frontend data: arrears case, tenant,
  property, assignment metadata, reminder date, dispute status, escalation
  status, promise-to-pay fields, balance buckets, and case notes.
- Show a deterministic next action with a status tone.
- Show evidence/readiness rows for balance age, reminder, dispute, escalation,
  promise-to-pay, and assignment state.
- Provide safe handoff links to the tenant record and the Operations queue.
- Provide local `Copy packet` and `Download packet CSV` actions.
- Add Playwright smoke coverage that proves the packet renders, exports expected
  content, and does not call mutation/provider paths.
- Update roadmap, design-governance, and next-chat handover docs.

Out of scope:

- No new backend endpoint.
- No arrears detail route.
- No SendGrid/Twilio dispatch.
- No tenant, owner, provider, or contractor messaging.
- No Xero, Basiq, payment reconciliation, bank feed, or invoice mutation.
- No arrears status/reminder/escalation mutation from packet actions.

## Packet Rules

The packet uses deterministic next-action rules in this order:

1. Closed/resolved/written-off cases show `Closed - audit only`.
2. Escalation queued/in progress/referred shows `Review escalation path`.
3. Dispute raised/under review/escalated shows `Review dispute before reminder`.
4. Overdue reminder date shows `Send or log arrears follow-up`.
5. Future promise-to-pay date shows `Monitor promise to pay`.
6. Positive balance with no reminder date shows `Schedule arrears reminder`.
7. Positive balance with a future reminder date shows `Monitor next reminder`.
8. Otherwise show `Monitor arrears case`.

## UI

Each arrears case row gains a `Review packet` block near the existing case
actions. The block should stay compact and scannable:

- A status badge with the next action.
- A short next-action detail line.
- A grid of small evidence rows: balance age, reminder, dispute, escalation,
  promise-to-pay, assignment.
- Handoff links: `Open tenant` when a tenant id exists, and `Open queue` back to
  the Operations queue.
- `Copy packet` and `Download packet CSV` secondary actions.
- A visible guardrail:
  `Review-only arrears packet: downloading or copying this file does not send
  email, SMS, tenant messages, owner messages, provider dispatch, Xero/Basiq
  writes, payment reconciliation, invoice updates, arrears status changes,
  reminder updates, escalation updates, or assignment updates.`

The packet should use existing UI primitives only: `SectionPanel` context,
`StatusBadge`, `SecondaryButton`, existing typography and spacing tokens, and
lucide icons already in the file.

## Data Flow

All packet state is derived client-side inside `apps/web/src/app/operations/page.tsx`.

No new query keys, routes, or API types are required. The exporter uses the
existing `saveBlob` helper. Clipboard behavior should reuse the local browser
clipboard pattern already present in nearby review/export features.

## Tests

Extend the existing smoke test `operations workspace surfaces maintenance and
arrears work` in `apps/web/tests/smoke/app-flows.spec.ts`.

Coverage should assert:

- The Arrears tab renders `Review packet`.
- The next action for the seeded Bright Cafe case is visible.
- Balance/reminder/dispute/escalation/promise/assignment rows are visible.
- `Open tenant` points to `/tenants/tenant-1`.
- Copy action shows a local receipt.
- CSV download filename is
  `arrears-review-packet-arrears-case-1.csv`.
- CSV includes Bright Cafe, the balance, the next action, and the guardrail.
- Copy/download do not call forbidden mutation/provider paths.

Use a red-green flow: add the smoke assertions first, run the focused smoke and
confirm it fails because the packet does not exist, then implement the packet.

## Documentation

Update:

- `docs/product-roadmap.md` under Maintenance and arrears workflow depth.
- `docs/design-governance.md` near the maintenance/arrears foundations notes.
- `docs/next-chat-handover.md` with shipped scope and verification once the
  implementation is complete.

## Risks

- The Operations page is large. Keep helpers local and narrowly named, avoiding
  broad page-file refactors.
- Multiple `Copy packet`/`Download packet CSV` buttons may exist after this
  change. Tests must scope locators to the arrears packet block.
- The packet must not use packet actions to call existing arrears update
  mutations. Export/copy must remain local-only.
