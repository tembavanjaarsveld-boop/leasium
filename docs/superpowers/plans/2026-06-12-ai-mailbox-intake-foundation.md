# AI Mailbox Intake Foundation — 2026-06-12

## Goal

Start AI Mailbox Intake with provider-safe backend foundations: trusted sender
storage, org-routed `ai@leasium.ai` inbound handling, authentication/trust
metadata, quarantine behavior, and operator mailbox triage kinds. Do not add
design-facing UI in this slice.

## Success criteria

- Existing tenant-specific SendGrid inbound webhook behavior remains intact.
- `ai@leasium.ai` mail from a trusted operator can resolve to the organisation's
  entity without `entity_id`, persist as `source=ai_mailbox`, and run triage.
- Untrusted AI mailbox mail persists only as quarantine, without OpenAI triage or
  Smart Intake attachment promotion.
- Trusted sender list/create API is role-gated and organisation-scoped.
- No SendGrid send, Twilio SMS, Xero write, tenant email, or payment action runs.

## Tasks

1. Red tests in `tests/integration/test_comms_api.py`
   - Trusted operator global mailbox route.
   - Untrusted mailbox quarantine before AI/attachments.
   - Trusted sender create/list.
   - Trusted sender write-role rejection.

2. Data model + migration
   - Add `TrustedSender`.
   - Add `InboundMessage.source`, `auth_result`, `trust_state`, and
     `original_sender`.
   - Backfill existing inbound messages as trusted `tenant_channel` records.

3. Router + schemas
   - Add trusted-sender read/create schemas.
   - Add `GET/POST /api/v1/comms/trusted-senders`.
   - Make SendGrid `entity_id` optional for AI mailbox routing.
   - Parse SPF/DKIM form fields into `auth_result`.
   - Resolve trusted operator/trusted sender to an organisation entity.
   - Quarantine failed trust/auth before triage or attachment promotion.

4. Triage kinds
   - Extend inbox triage enum/schema prompt with operator mailbox kinds:
     `property_update`, `compliance_or_insurance`, `task_or_reminder`,
     `owner_or_entity_admin`.

5. Docs and verification
   - Commit `docs/ai-mailbox-intake-design.md` as the product spec.
   - Update roadmap and next-chat handover.
   - Run targeted tests, ruff, and broader verification as time allows.
