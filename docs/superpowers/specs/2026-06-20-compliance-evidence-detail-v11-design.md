# Compliance Evidence Detail v1.1 Design

Date: 2026-06-20

## Goal

Make the existing Work compliance tab easier to use as an evidence review
surface. Each recurring compliance check should show a compact on-screen detail
area with the linked evidence, current obligation context, latest approved
completion, and next due state without creating any new provider, comms,
payment, or reconciliation behavior.

This is a refinement of the shipped compliance completion and evidence actions,
not a new compliance workflow engine.

## Current Context

The compliance Work tab already supports:

- recurring compliance checks loaded from the backend register
- linked source evidence through `Add evidence`
- explicit operator-approved completion through `Complete with linked evidence`
- local copy/download compliance CSV actions
- per-check evidence packet export
- completion history and certificate expiry state

The remaining gap is legibility. Important review facts are present, but spread
across row labels, button state, completion history, and exported packets. The
operator needs a faster way to answer: what evidence is linked, what obligation
does it satisfy, who approved the last completion, what expires, and what is due
next?

## Proposed Surface

Add a per-check evidence detail disclosure inside each recurring compliance
check row on `/operations?tab=compliance`.

The detail area should be available from the existing check row, near the
completion history and packet actions. It should reuse the current Work tab
visual language: restrained row groups, existing badges, existing buttons, and
the approved Operations/Work Horizon patterns. No new top-level navigation,
route, or modal is needed.

The detail area contains:

- **Evidence:** linked source document status, source document id, certificate
  expiry, evidence status, and notes if present.
- **Document handoff:** use the existing document review or download handoff if
  the current API already exposes one. If the available data is only the source
  document id, show a clear "source document on file" row and keep the existing
  packet export as the local handoff.
- **Current obligation:** current obligation id, due date, overdue/due-soon
  status, linked scope, and next required action.
- **Latest completion:** completion date, operator approval state, approver or
  actor label when available, completion notes, and next due date created by the
  roll-forward.
- **Ownership and cadence:** owner role or assignee, recurrence label, property
  or portfolio context, and whether evidence is current.
- **Safe local exports:** keep the existing copy/download evidence packet
  behavior and make it discoverable from the detail area.

## Behavior

Opening the detail area is read-only. It does not load providers, write provider
history, upload files, send messages, create payments, reconcile payments, or
change compliance state.

The existing actions remain the only mutations:

- `Add evidence` links a reviewed document or uploaded local file to the
  compliance check.
- `Complete with linked evidence` remains disabled until local evidence is
  linked and still sends `operator_approved: true`.
- Copy/download packet actions remain local exports from rendered check data.

If an implementation discovers that a document name or download URL is missing
from the existing response, prefer a minimal read-only field on the existing
compliance or document API. Do not add a new compliance table, migration, or
provider-backed document sync for v1.1.

## Non-Goals

- No create/edit UI for recurring compliance checks.
- No direct mutation of Smart Intake rows or compliance obligations outside the
  shipped evidence link and approved completion actions.
- No Xero, Basiq, SendGrid, Twilio, tenant email, SMS, payment, or payment
  reconciliation call.
- No provider refresh, provider history write, or external document sync.
- No new top-level navigation item or separate compliance record page.
- No broad redesign of the Work tab.

## UX Requirements

- Use the existing Work compliance row/disclosure pattern rather than a new
  page shell.
- Keep first-scan density high: the row still shows status, scope, owner,
  recurrence, next action, and primary actions before the detail is opened.
- Detail content should read as a review block, not a debug dump of ids.
- On mobile, the detail stacks in a single column, action buttons remain at
  least 44px high, and no row should require horizontal scrolling.
- The detail block must not create nested cards. Use grouped rows, dividers, or
  compact subsections inside the existing row.
- Preserve the existing review-first language around local-only exports and
  operator-approved completion.
- Before marking the slice done, capture desktop 1440px and mobile 390px
  screenshots, apply the UX gate checklist, and log the pass in
  `docs/design-governance.md`.

## Testing

Frontend smoke should extend `apps/web/tests/smoke/operations-compliance.spec.ts`
to cover:

- opening the per-check evidence detail disclosure
- seeing the linked document handoff or source document-on-file state
- seeing current obligation, latest completion, approver or actor, notes,
  certificate expiry, next due date, recurrence, and owner context
- copy/download packet actions still working from the detail area
- no calls to forbidden provider, email, SMS, payment, reconciliation, or Xero
  endpoints while opening details or exporting local packets

Backend tests are not required if v1.1 uses existing read data. If a minimal
read-only field is added to an API response, add focused backend coverage for
that field and keep provider clients mocked.

Verification should include:

- focused compliance smoke test
- relevant frontend lint/type checks for files touched
- `git diff --check`
- desktop and mobile screenshot review for the UX gate

## Definition Of Done

- Each recurring compliance check can reveal a compact evidence detail area.
- The operator can identify evidence, obligation, latest completion, expiry,
  owner, cadence, and next due state without exporting a CSV first.
- Existing Add evidence, Complete with linked evidence, and packet export flows
  keep their current behavior.
- No forbidden provider or comms mutations are introduced.
- Roadmap, UX log, and next-chat handover are updated after implementation.
