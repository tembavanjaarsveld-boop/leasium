# AI Mailbox Intake — ai@leasium.ai

Status: Backend foundation/read APIs + `/inbox` UI foundation + local
trust/discard decisions + Settings trusted-sender management shipped · promote
flows pending design/UX gate · 2026-06-12
Figma: concept frame exists in "Leasium — Design Source of Truth"
(PO2jOANgmqgZHfqWZXOZGU) → 03 Screens / AI Mailbox Intake `82:2`; v1
UI implemented from this frame, with trust/discard action placement and the
Settings allowlist panel tracked in the UX Debt Register for the in-loop UX
pass; promote variants still require review before code.

## Problem

Operators and agents hold property information in their email — agent
updates, council notices, insurance renewals, contractor quotes, inspection
reports. Today that information reaches Leasium only if someone manually
uploads a document into Smart Intake. The ask: forward an email to
**ai@leasium.ai** and have the AI put the details and tasks in the right
place, with the operator approving the result.

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

This feature is therefore a **delta**: an operator/agent-facing address and
trust tier on top of the existing tenant-facing inbound pipeline.

## Proposal

### Addressing

- One public address: `ai@leasium.ai` on the existing Inbound Parse
  subdomain MX. No per-entity URLs for senders to remember.
- Routing key is the **sender**, not the address: sender email →
  `app_user` / known agent contact → organisation. Entity/property
  resolution happens in triage, not in the URL.
- Plus-addressing (`ai+harbour-lane@leasium.ai`) is a v2 hint, not v1.

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
- Future promote endpoints: add the new promote kinds listed above.

## UI

- Shipped on `/inbox`: AI Mailbox panel with copy-address affordance,
  trusted mailbox queue, quarantine bucket, provenance disclosure for selected
  quarantined rows (forwarder/original sender where available, SPF/DKIM result,
  body text, raw email link), local Trust sender / Discard decisions, and a
  review-first guardrail note.
- Shipped on Settings → Organisation: AI mailbox trusted-senders panel with
  list/add/revoke actions for the local organisation allowlist.
- Still pending: source/trust-state filters if the queue grows, and reviewed
  promote actions.
- Figma first for actions: duplicate/update `03 Screens / AI Mailbox Intake
  82:2` for promote variants before implementation; sync the shipped Settings
  allowlist panel through the in-loop UX pass/design debt track
  (design-governance §Figma-First).

## Foundation v1 scope cut

In: ai@leasium.ai routing, sender trust + quarantine, sender-auth metadata,
forwarded original-sender provenance, body triage with operator kinds,
trusted-message attachment path reuse, raw-email `StoredDocument` evidence,
role-scoped read APIs, trusted-senders API, `/inbox` queue + quarantine
provenance UI, local trust/discard decisions, and Settings trusted-sender
management.

Out (next slices): promote/apply actions, auto-ack replies, reply-by-email
threads, plus-addressing hints, agent-facing confirmations, cross-org agent
senders, auto-apply of any kind.

## Test plan

- Backend: webhook happy path (trusted sender → message + triage),
  quarantine path (unknown sender, SPF fail), forwarded-email provenance
  extraction, raw-email evidence document linking, list/detail read APIs with
  entity scoping, trusted-senders CRUD + auth, trust/discard action guardrails,
  promote kinds. Mock OpenAI and SendGrid throughout.
- Smoke: shipped inbox queue + quarantine provenance, trust-sender action,
  discard action, Settings trusted-sender management; future source filter and
  promote flow fixtures when those actions land.

## Open decisions for Temba

1. Ack reply: closed for v1 as none; revisit only with an explicit
   transactional-email carve-out.
2. Trusted external agents in v1, or operators-only first? Closed 2026-06-12:
   org-managed external trusted senders are in v1.
3. `ai@leasium.ai` directly vs `ai@inbound.leasium.ai` (root-domain MX has
   interplay with normal mail routing for @leasium.ai — needs a check
   before pointing MX at SendGrid).
4. Does quarantine live on /inbox or stay API-only in v1? Closed 2026-06-12:
   quarantine lives on `/inbox`.

## Risks

- Prompt injection via email body → mitigated by review-first only; never
  weaken to auto-apply.
- Spam/abuse of a public address → allowlist gate before any AI call;
  quarantine is cheap storage only.
- MX misconfiguration on the root domain could break real mail — prefer a
  subdomain unless leasium.ai has no other mail use.
