# AI Mailbox Intake — ai@leasium.ai

Status: Backend foundation started · UI/promotion flow pending Temba + Remba review · 2026-06-12
Figma: concept frame exists in "Leasium — Design Source of Truth"
(PO2jOANgmqgZHfqWZXOZGU) → 03 Screens / AI Mailbox Intake `82:2`; production UI
implementation still requires Temba sign-off in Figma first.

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
2. Future: store the raw email (.eml or rendered text) as a `StoredDocument` for
   provenance, linked from the message.
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
- `GET/POST /api/v1/comms/trusted-senders` (operator-auth, org-scoped).
- Future promote endpoints: add the new promote kinds listed above.

## UI

- `/inbox` gains: source filter (Tenant / AI mailbox), trust state chips,
  quarantine bucket, provenance disclosure (forwarder, original sender,
  auth result, raw email link), and the new promote actions.
- Settings → Organisation: Trusted senders panel.
- Figma first: add "AI Mailbox Intake" frame(s) to 03 Screens (desktop
  1440×900 + mobile 390×844) using Horizon shell/components; Temba sign-off
  in Figma before code (design-governance §Figma-First).

## Foundation v1 scope cut

In: ai@leasium.ai routing, sender trust + quarantine, sender-auth metadata,
forwarded original-sender provenance, body triage with operator kinds,
trusted-message attachment path reuse, and trusted-senders API.

Out (next slices): raw-email `StoredDocument` provenance, `/inbox` quarantine
UI, Settings trusted-sender panel, promote/apply actions, auto-ack replies,
reply-by-email threads, plus-addressing hints, agent-facing confirmations,
cross-org agent senders, auto-apply of any kind.

## Test plan

- Backend: webhook happy path (trusted sender → message + triage),
  quarantine path (unknown sender, SPF fail), forwarded-email provenance
  extraction, trusted-senders CRUD + auth, promote kinds. Mock OpenAI and
  SendGrid throughout.
- Smoke: inbox source filter, quarantine row, trust-sender action, promote
  flow fixture.

## Open decisions for Temba

1. Ack reply: closed for v1 as none; revisit only with an explicit
   transactional-email carve-out.
2. Trusted external agents in v1, or operators-only first?
3. `ai@leasium.ai` directly vs `ai@inbound.leasium.ai` (root-domain MX has
   interplay with normal mail routing for @leasium.ai — needs a check
   before pointing MX at SendGrid).
4. Does quarantine live on /inbox or stay API-only in v1?

## Risks

- Prompt injection via email body → mitigated by review-first only; never
  weaken to auto-apply.
- Spam/abuse of a public address → allowlist gate before any AI call;
  quarantine is cheap storage only.
- MX misconfiguration on the root domain could break real mail — prefer a
  subdomain unless leasium.ai has no other mail use.
