# Smart Intake AI Opportunity Panel Design

## Purpose

Upgrade the existing Smart Intake document review panel into an AI-assisted
workspace that helps operators use imperfect documents to set up the right next
local workflow. A dropped file should not only be classified; Leasium should
infer useful opportunities, ask the minimum missing questions, and then create a
review-first local draft or proposal from existing workflow types.

The motivating case is an old invoice or notice uploaded after connecting Xero.
Even when the document is not enough to create an invoice safely, it can still
help identify contacts, billing patterns, evidence, follow-up tasks, and missing
setup questions.

## Goals

- Keep Smart Intake as the home for this experience; do not introduce a new
  top-level AI setup page.
- Infer likely opportunities immediately after extraction, before asking the
  operator what they want to do.
- Use chat as the default question interface, with structured controls only
  when precision is required.
- Convert confirmed answers into concrete existing draft/proposal outputs:
  billing draft, charge-rule proposal, Xero contact-mapping proposal, evidence
  link proposal, or work/task draft.
- Preserve source-backed provenance for extracted facts, inferred assumptions,
  and operator answers.
- Keep all provider and accounting side effects review-first and approval-gated.

## Non-Goals

- No autonomous Xero writes, invoice posting, tenant email, SendGrid/Twilio
  message, payment update, or reconciliation action.
- No generic all-purpose `setup draft` object as the primary output.
- No pure chat-only experience where decisions disappear into conversation.
- No full wizard for v1; structured fields appear only inside the chat when the
  answer needs controlled values.
- No broad redesign of the Smart Intake landing page or navigation.

## Experience

Smart Intake keeps the existing upload, review queue, source preview, extracted
fields, and review-first apply controls. The selected review panel gains an AI
opportunity layer beside the extracted facts.

The panel has four zones:

1. Source and extracted facts: the current evidence-first document preview and
   editable extracted-field review.
2. Opportunity cards: inferred next steps such as `Set up billing`,
   `Match Xero contact`, `Store as evidence`, or `Create follow-up task`.
3. Question thread: a chat-style interaction for the selected opportunity.
4. Proposed output card: a structured preview of the local draft/proposal that
   can be created after enough answers are confirmed.

The operator sees useful options first. If a file is incomplete, Leasium says
what it can still help with and asks only the missing questions that block a
safe local draft.

## Opportunity Inference

The inference layer reads the existing Smart Intake extraction and produces a
small list of opportunities. Each opportunity has:

- title and kind
- confidence
- source evidence references
- missing questions
- proposed output type
- guardrail text

Example opportunities for an old invoice or notice:

- `Set up billing pattern`: medium confidence from amount, due date, issuer, and
  payment reference; missing property, unit, lease, recurrence, GST, and account
  treatment.
- `Match Xero contact`: high confidence from creditor, supplier, tenant, ABN, or
  reference; missing confirmation of whether the contact is tenant, owner,
  vendor, or issuer.
- `Store as historical evidence`: high confidence from document date, amount,
  issuer, and source file; missing property/person/lease link.
- `Create follow-up task`: medium confidence from overdue/final-notice wording;
  missing assignee, target record, and due date confirmation.

The ranked recommendation should be deterministic enough to test. The top
opportunity is the one with the highest confidence after excluding outputs that
are blocked by missing essential context.

## Question Thread

Questions are chat-led by default:

- Leasium asks one short question at a time.
- The operator may answer naturally.
- Leasium extracts structured facts from the answer and shows them in the
  proposed output card.
- If a question needs controlled precision, the chat message embeds a compact
  field, select, or segmented choice.

Structured controls are used for:

- property, unit, tenant, owner, vendor, or lease selection
- recurrence cadence
- GST/tax treatment
- Xero account code or tax type
- one-off versus recurring choice
- proposed output type when more than one is plausible

The chat should avoid asking questions whose answer can be inferred from a
high-confidence local record match. In those cases it asks for confirmation,
not re-entry.

## Output Rules

The AI opportunity layer creates existing local draft/proposal outputs only.

Billing-related outputs:

- A one-off historical or recovery document creates a local billing draft in
  review state when property/tenant/lease and amount context are confirmed.
- A recurring setup pattern creates a charge-rule proposal or staged charge-rule
  draft, not an approved invoice.
- Invoice draft creation remains behind the existing Billing Readiness review
  path.
- Xero draft creation remains behind explicit Xero approval and existing
  provider routes.

Contact outputs:

- A Xero contact opportunity creates a local mapping proposal against an
  existing tenant, owner, vendor, or issuer.
- Applying the proposal stores reviewed local mapping data only.
- No Xero contact is created, updated, or deleted.

Evidence outputs:

- A historical evidence opportunity proposes links to property, unit, tenant,
  owner, vendor, lease, obligation, billing draft, or work item records.
- Applying the proposal stores the local document link and provenance only.

Task outputs:

- A notice/follow-up opportunity creates a local work/task draft with source
  evidence and an explicit target.
- No email, SMS, provider dispatch, or external escalation is sent.

## Data Model Direction

Use a lightweight Smart Intake opportunity session as the conversation layer.
It is not the final business object. It stores:

- document intake id
- inferred opportunities
- selected opportunity
- question/answer transcript
- structured answer facts
- proposed output preview
- source citations and confidence
- operator decisions

The final business record remains one of the concrete existing workflow types.
If an implementation needs persistence before the final output is created, store
session state under the existing document-intake review metadata first, then
promote to a dedicated table only when concurrency/history needs justify it.

## Guardrails

Every opportunity and proposed output card must state what will and will not
happen.

Required guardrail language by category:

- Billing setup: no invoice is approved, posted, emailed, or synced to Xero.
- Xero contact mapping: no Xero contacts are created, updated, or deleted.
- Evidence linking: no provider, payment, lease, tenant, or billing state is
  changed beyond the reviewed local link.
- Follow-up task: no email, SMS, provider dispatch, payment, or reconciliation
  action is sent.

The create action uses explicit operator approval and creates only local review
state. Provider writes stay in their existing downstream approved flows.

## UI Requirements

- Reuse the existing Smart Intake page and `DocumentIntakeReviewPanel` shape.
- Use approved Horizon Smart Intake and Document Review Figma frames as the
  visual source: Smart Intake desktop `55:166`, Document review `58:352`, Smart
  Intake mobile `59:521`.
- Keep first viewport focus on the selected document, inferred opportunities,
  and the next question.
- Do not create cards inside cards. Opportunity cards are peer panels inside the
  review area.
- On mobile, the selected opportunity and current question appear before long
  extracted-field editing sections when the document opens from a queue row.
- Keep all touch targets at least 44px.
- Show confidence and source evidence without making the panel feel like a
  debug console.

## Testing

Backend tests should cover:

- old invoice/notice extraction can produce opportunity suggestions without
  creating billing drafts, invoices, Xero records, emails, payments, or tasks
  automatically
- answering required billing setup questions can create a local review draft or
  charge-rule proposal only after explicit approval
- incomplete answers keep the session in question state with missing fields
  visible
- Xero contact opportunities save only local mapping proposals
- provider clients are mocked and never called by opportunity inference

Frontend smoke should cover:

- an old invoice/notice opens in Smart Intake with inferred opportunity cards
- selecting `Set up billing` starts chat questions before any draft is created
- natural answers populate the proposed output card
- structured controls appear for property/unit/lease and recurrence when needed
- creating the proposal calls only the local reviewed-output endpoint
- Xero, SendGrid, Twilio, payment, and reconciliation endpoints are not called
- desktop 1440px and mobile 390px screenshots have no overflow or hidden
  primary action

## Documentation

Implementation should update:

- `docs/product-roadmap.md` for the shipped Smart Intake AI opportunity layer
- `docs/design-governance.md` with Figma/frame references, screenshots, fixes,
  and deferrals
- `docs/next-chat-handover.md` with scope, verification, and guardrails
- `docs/leasium-codex-design-source-of-truth.md` only if the slice changes
  tokens or durable component rules

## Risks

- Pure chat can hide decisions. Mitigation: every conversation updates a visible
  proposed output card.
- A generic setup object can become vague. Mitigation: use an opportunity
  session only as conversation state; final outputs are existing workflow
  records.
- Old documents can be misleading. Mitigation: label inferred facts clearly,
  keep source provenance visible, and require operator confirmation before
  creating local drafts.
- The current dashboard/Smart Intake component is large. Mitigation: keep v1
  helpers narrowly scoped and consider extracting opportunity UI into focused
  local components as part of the implementation plan.
