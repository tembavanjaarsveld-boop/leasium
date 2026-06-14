# AI Mailbox Intake — virtual client aliases

Status: Backend foundation/read APIs + `/inbox` UI foundation + local
trust/discard decisions + Settings trusted-sender management + trusted-row
reviewed promote handoff + virtual client alias routing shipped · alias
Settings UI and source/trust filters pending design/UX gate · 2026-06-14
Figma: concept frame exists in "Leasium — Design Source of Truth"
(PO2jOANgmqgZHfqWZXOZGU) → 03 Screens / AI Mailbox Intake `82:2`; v1
UI implemented from this frame, with trust/discard action placement and the
Settings allowlist panel tracked in the UX Debt Register for the in-loop UX
pass; promote variants still require review before code.

## Problem

Operators and agents hold property information in their email — agent
updates, council notices, insurance renewals, contractor quotes, inspection
reports. Today that information reaches Leasium only if someone manually
uploads a document into Smart Intake. The ask: forward an email to a
client-specific Leasium mailbox such as **skj@inbox.leasium.ai** and have the
AI put the details and tasks in the right place, with the operator approving
the result.

## What already exists (build on, don't duplicate)

- `POST /api/v1/comms/webhooks/sendgrid-inbound?entity_id=<uuid>&token=<secret>`
  (comms.py) — SendGrid Inbound Parse webhook, shared-secret gated, persists
  `InboundMessage`, attributes a tenant by from-address.
- Attachment promotion: inbound attachments become `DocumentIntake` rows in
  the Smart Intake review queue, with audit rows and AI extraction when
  `OPENAI_API_KEY` is set.
- `stewart/ai/inbox.triage_inbox` — classifies inbound messages into
  `INBOX_KINDS` (maintenance_request, payment_or_arrears, lease_change,
  tenant_contact, vendor_or_contractor, general, spam_or_noise) with
  confidence, summary, suggested property/tenant/lease/contractor, key
  facts, and warnings.
- `/inbox` UI with review-first promote actions (`promoteInboxMessage`).
- Deployment doc §Inbound email parsing covers MX + Inbound Parse setup.
- 2026-06-12 foundation: `trusted_sender` storage, `InboundMessage.source`,
  `auth_result`, `trust_state`, and `original_sender` fields, trusted-sender
  list/create API, and AI mailbox trust/quarantine handling on the existing
  SendGrid inbound webhook. Quarantined rows do not run OpenAI triage or Smart
  Intake attachment promotion.
- 2026-06-12 read/provenance follow-up: every persisted AI mailbox row stores a
  linked raw-email `StoredDocument` transcript for evidence, and read-only
  `GET /api/v1/comms/inbound-messages` endpoints expose role-scoped list/detail
  projections for mailbox review without returning raw provider payloads.
- 2026-06-12 UI foundation follow-up: `/inbox` now has a read-only AI Mailbox
  panel with copy address, trusted queue, quarantine bucket, selected-message
  provenance detail, auth result, body text, and raw-email link. The first UI
  cut deliberately omitted trust/discard/promote actions until those flows were
  separately reviewed.
- 2026-06-12 trust/discard follow-up: quarantined AI mailbox rows now expose
  local review decisions in the selected-message detail panel. Trusting a
  sender only uses the authenticated `from_address`, requires the original row
  to be `sender_not_trusted` with SPF/DKIM pass, creates/updates the
  organisation `TrustedSender`, marks the current row trusted, archives it
  out of the generic Comms reply queue, and writes audit metadata. Discard
  marks the row discarded/archived while keeping the inbound body and raw-email
  evidence readable. Neither action re-runs OpenAI, promotes attachments,
  applies Smart Intake, creates a Comms reply draft, sends email/SMS, calls
  Xero/Basiq, touches payments, or reconciles anything.
- 2026-06-12 Settings trusted-sender management follow-up: Settings →
  Organisation now lists the organisation allowlist for the selected entity,
  lets operators add/refresh a sender label, and revokes entries through a
  soft-delete `DELETE /api/v1/comms/trusted-senders/{id}` action with a local
  audit row. The panel and endpoint do not process waiting mail, send
  acknowledgements, re-run OpenAI, promote/apply Smart Intake, call providers,
  touch payments, or reconcile anything.
- 2026-06-12 reviewed promote handoff follow-up: trusted mailbox rows now
  open a provenance detail and can hand their stored classification into the
  existing `/inbox` promote panel without re-running triage. The final promote
  call carries `inbound_message_id`, so local drafts/audit metadata link back
  to the mailbox row, sender, subject, confidence, and raw-email document;
  the mailbox row is marked processed only after the local draft succeeds.
  Quarantined or non-mailbox rows are refused. This creates only local drafts
  through the existing review-first promote route; it does not send email/SMS,
  dispatch providers, apply Smart Intake, call Xero/Basiq, touch payments, or
  reconcile anything.
- 2026-06-12 compliance/insurance promote follow-up: trusted mailbox rows
  classified as `compliance_or_insurance` can now reuse existing uploaded
  Smart Intake attachment reviews when `attachment_intake_ids` are present,
  carrying mailbox provenance into the backing document metadata, intake
  review data, and audit row. If no attachment review exists, the route falls
  back to an uploaded review draft from the email body. This path requires
  `inbound_message_id`, does not re-run triage or extraction, and does not
  apply Smart Intake, create obligations/checks, send providers, touch
  payments, or reconcile anything.
- 2026-06-12 property/task/owner-admin promote follow-up: trusted mailbox
  rows classified as `property_update`, `task_or_reminder`, or
  `owner_or_entity_admin` now use the same reviewed promote path. Property
  update and owner/entity admin rows reuse existing uploaded Smart Intake
  attachment reviews first when `attachment_intake_ids` are present, fail
  closed on stale attachment metadata, and otherwise create local uploaded
  Smart Intake review packets from the email body. Task/reminder rows create
  requested Operations work orders. These paths require `inbound_message_id`,
  use the stored mailbox classification, and do not re-run triage,
  extract/apply Smart Intake, mutate property/owner records, assign
  contractors, send providers, touch payments, or reconcile anything.
- 2026-06-14 virtual client alias follow-up: `mailbox_alias` now maps
  recipient addresses such as `skj@inbox.leasium.ai` to one organisation
  before sender trust or AI classification run. Unknown aliases are accepted
  without creating rows or running AI; disabled aliases persist a quarantined
  evidence row under the owning organisation; active aliases still require
  SPF/DKIM pass and an authorised sender. Legacy `ai@leasium.ai` remains an
  internal/operator shortcut, but production multi-client routing should use
  client aliases.

This feature is therefore a **delta**: an operator/agent-facing address and
trust tier on top of the existing tenant-facing inbound pipeline.

## Proposal

### Addressing

- Production path: one SendGrid Inbound Parse domain such as
  `inbox.leasium.ai`, many virtual aliases, no separate provider mailboxes.
  Example: `skj@inbox.leasium.ai`, `harbourlane@inbox.leasium.ai`.
- Routing key is the **recipient alias first**. The alias must resolve to
  exactly one organisation before sender trust, OpenAI triage, Smart Intake
  attachment promotion, or any org-scoped context loading happens.
- Sender trust is still required, but it authorises the sender inside the
  alias-resolved organisation; it no longer has to guess which client the
  sender meant.
- Unknown aliases are inert: return 202 to the provider, create no
  `InboundMessage`, run no AI, and keep no review target because there is no
  safe organisation boundary.
- Disabled aliases preserve evidence under the owning organisation as a
  quarantined row, but still do not run AI or promote attachments.
- Legacy `ai@leasium.ai` stays as an internal/operator shortcut for the
  single-client/internal phase; it should not be the default multi-client
  production address.

### Sender trust (the non-negotiable part)

`From:` is forgeable, so trust requires both:

1. **Authentication** — SendGrid Inbound Parse exposes SPF/DKIM results;
   require pass (or soft-pass + warning chip) before normal processing.
2. **Authorisation** — sender must match an allowlisted address: operator
   `app_user` emails by default, plus an org-managed "trusted senders"
   list in Settings for external agents.

Anything failing either check lands in a **quarantine** state: visible to
operators in the intake queue under a separate filter, never triaged or
extracted automatically, with one-click "trust this sender" / discard.
Unknown senders never trigger AI processing (cost + injection surface).

### Forwarded-email semantics

Operators will mostly *forward* third-party emails. The authenticated
sender is the operator; the original sender/content lives in the body.
Triage should extract `original_sender` / `original_date` from forward
headers as provenance metadata, displayed on the intake row — but trust
derives only from the authenticated forwarder.

### Processing pipeline (target)

1. Webhook receives email → auth + allowlist check → persist
   `InboundMessage` with `inbound_metadata.source = "ai_mailbox"`.
2. Store a rendered `.eml`-style raw-email `StoredDocument` for provenance once
   the message has a safe entity, linked from `inbound_metadata`.
3. Trusted messages: attachments → existing `DocumentIntake` promotion path
   unchanged. Quarantined messages do not promote attachments.
4. Body triage → existing `triage_inbox`, extended with operator-context
   kinds: `property_update`, `compliance_or_insurance`, `task_or_reminder`,
   `owner_or_entity_admin`.
5. Future: suggested actions surface as review-first promote options:
   - create work order / task (existing promote path)
   - update property/tenant detail (field-level preview, approve/edit/ignore)
   - create critical-date / compliance obligation
   - attach note + document to property
6. Operator reviews on `/inbox` (extended), applies. **No auto-apply tier,
   ever, for email-sourced changes** — the body is untrusted LLM input and
   prompt injection is mitigated structurally by the review gate (§2.1).

### Acknowledgement reply (v1 decision)

An auto-ack ("Received — 3 items queued for review") is a SendGrid send,
which §2.1 forbids without operator approval. Options:

- (a) No ack in v1 — sender checks the app. Simplest, guardrail-clean.
- (b) Org-level opt-in setting for a fixed transactional ack template,
  documented as an explicit carve-out.

Decision for foundation v1: (a) no acknowledgement reply.

## Data model deltas

- `InboundMessage`: add `source` discriminator (tenant_channel | ai_mailbox),
  `auth_result` (spf/dkim summary), `trust_state`
  (trusted | quarantined | discarded), `original_sender` metadata.
- New `trusted_sender` table (org-scoped: email, label, added_by, added_at)
  or reuse `notification_preferences`-style JSON on the org — prefer the
  table for auditability.
- No new queue model: reuse `InboundMessage` + `DocumentIntake`.

## API deltas

- Webhook: accept org-level routing when `entity_id` is absent (resolve via
  sender); keep the existing per-entity tenant path untouched.
- `GET/POST /api/v1/comms/trusted-senders` and
  `DELETE /api/v1/comms/trusted-senders/{trusted_sender_id}` (operator-auth,
  org-scoped; delete is soft-delete + audit only).
- `GET /api/v1/comms/inbound-messages` lists captured inbound rows with
  optional `entity_id`, `source`, `trust_state`, and bounded `limit` filters.
  Lists expose body previews and metadata only, never `raw_payload`, raw bytes,
  provider secrets, or attachment bytes.
- `GET /api/v1/comms/inbound-messages/{message_id}` reads a single
  role-scoped message with body text/html and raw-email document link for
  operator review.
- `POST /api/v1/comms/inbound-messages/{message_id}/trust-sender` and
  `/discard` record local mailbox trust decisions behind operator write access.
  Trust requires passing SPF/DKIM and `sender_not_trusted`; discard preserves
  evidence and does not delete the row. AI mailbox rows are excluded from the
  generic Comms reply queue/dispatch path.
- `POST /api/v1/ai/triage/promote` accepts optional `inbound_message_id` for
  trusted AI mailbox rows. The route validates source/trust/entity/kind,
  persists raw-email provenance in target metadata/audit, and marks the
  mailbox row processed after a successful local draft.
- First richer variant shipped: `compliance_or_insurance` creates a local
  Smart Intake review draft only. Future promote endpoints: add property,
  task/reminder, and owner/entity-admin variants listed above.

## UI

- Shipped on `/inbox`: AI Mailbox panel with copy-address affordance,
  trusted mailbox queue, quarantine bucket, provenance disclosure for selected
  quarantined rows (forwarder/original sender where available, SPF/DKIM result,
  body text, raw email link), local Trust sender / Discard decisions, and a
  review-first guardrail note.
- Shipped on Settings → Organisation: AI mailbox trusted-senders panel with
  list/add/revoke actions for the local organisation allowlist.
- Shipped on `/inbox`: trusted rows now expose Review email → Review
  promotion. The panel uses the stored mailbox classification, shows source
  sender/subject/confidence/raw email inside the promote approval step, and
  calls the existing local draft promote route only after the operator clicks
  Promote to draft.
- Shipped on `/inbox`: trusted `compliance_or_insurance` rows use that same
  review step to open a local Smart Intake review at
  `/intake?entity_id=...&review=...`; existing attachment reviews are reused
  first, otherwise a new email-body draft starts uploaded and waits for
  explicit Smart Intake extraction/review/apply.
- Shipped on `/inbox`: trusted `property_update`, `task_or_reminder`, and
  `owner_or_entity_admin` rows are mailbox-only promotable kinds. They reuse
  the same provenance panel and create only local review targets after the
  operator clicks Promote to draft. Property/admin rows reuse existing
  attachment reviews first, then fall back to email-body drafts when there is
  no routed attachment review.
- Still pending: source/trust-state filters if the queue grows and the design
  review of the inline action placement.
- Figma first for actions: duplicate/update `03 Screens / AI Mailbox Intake
  82:2` for promote variants before implementation; sync the shipped Settings
  allowlist panel through the in-loop UX pass/design debt track
  (design-governance §Figma-First).

## Foundation v1 scope cut

In: virtual client aliases on `inbox.leasium.ai`, legacy `ai@leasium.ai`
operator shortcut, sender trust + quarantine, sender-auth metadata, forwarded
original-sender provenance, body triage with operator kinds, trusted-message
attachment path reuse, raw-email `StoredDocument` evidence, role-scoped read
APIs, trusted-senders API, `/inbox` queue + quarantine provenance UI, local
trust/discard decisions, and Settings trusted-sender management, plus
trusted-row reviewed promote handoff into existing local draft creation and
compliance/insurance Smart Intake review drafts, including attachment-intake
reuse when the mailbox email already routed attachments, and
property/task/owner-admin local review targets with property/admin attachment
review reuse.

Out (next slices): alias Settings UI/API management, source/trust-state filters
if volume grows, auto-ack replies, reply-by-email threads, plus-addressing
hints, agent-facing confirmations, cross-org agent senders, auto-apply of any
kind.

## Test plan

- Backend: webhook happy path (trusted sender → message + triage),
  virtual-alias route, disabled/unknown alias quarantine/inert paths,
  quarantine path (unknown sender, SPF fail), forwarded-email provenance
  extraction, raw-email evidence document linking, list/detail read APIs with
  entity scoping, trusted-senders CRUD + auth, trust/discard action guardrails,
  trusted-row promote provenance, compliance/insurance Smart Intake handoff,
  attachment-intake reuse/fail-closed stale metadata for compliance/property/
  owner-admin review kinds, and property/task/owner-admin mailbox-only promote
  kinds. Mock OpenAI and SendGrid throughout.
- Smoke: shipped inbox queue + quarantine provenance, trust-sender action,
  discard action, Settings trusted-sender management, and trusted-row reviewed
  promote handoff including compliance/insurance Smart Intake review and
  attachment-review reuse plus property/task/owner-admin local targets with
  forbidden provider/triage re-run/apply guardrails; future source filter
  fixtures when those actions land.

## Open decisions for Temba

1. Ack reply: closed for v1 as none; revisit only with an explicit
   transactional-email carve-out.
2. Trusted external agents in v1, or operators-only first? Closed 2026-06-12:
   org-managed external trusted senders are in v1.
3. Alias domain: current implementation expects virtual aliases on
   `inbox.leasium.ai`; legacy `ai@leasium.ai` remains available for internal
   use only.
4. Does quarantine live on /inbox or stay API-only in v1? Closed 2026-06-12:
   quarantine lives on `/inbox`.

## Risks

- Prompt injection via email body → mitigated by review-first only; never
  weaken to auto-apply.
- Spam/abuse of a public address → allowlist gate before any AI call;
  quarantine is cheap storage only.
- MX misconfiguration on the root domain could break real mail — prefer a
  subdomain unless leasium.ai has no other mail use.
