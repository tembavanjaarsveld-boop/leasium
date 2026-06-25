# OpenSign e-signature — replace DocuSign (plan)

Date: 2026-06-25
Status: planning → implementation
Decision owner: Temba

## Goal

Replace the DocuSign lease-signing integration with OpenSign Cloud, on a
paid plan. Same product behaviour (operator sends a lease pack for
signature → tenant signs → signed PDF retained → operator lease-activation
review), new provider underneath. Review-first guardrail (§2.1) unchanged:
the operator still explicitly triggers the send; nothing auto-fires.

## Decisions locked

1. **OpenSign Cloud SaaS** (not self-hosted). No infra to run.
2. **Full replace** — OpenSign is the only signing provider. DocuSign code
   is removed, not kept behind a flag (it never went to production, so
   there is nothing live to preserve).
3. **Build + verify locally**, then hand Temba the prod cutover steps
   (API token, base URL, webhook secret go into Render — can't be entered
   from the Cowork session).

## OpenSign Cloud API (verified from docs.opensignlabs.com)

- Auth header: `x-api-token: <token>` on every request.
- Base URLs: production `https://app.opensignlabs.com/api/v1.2`,
  sandbox `https://sandbox.opensignlabs.com/api/v1.2`. Sandbox needs a
  separate token + separate webhook; live tokens don't work in sandbox.
- **Create + send**: `POST /createdocument` — base64 PDF + `signers[]`,
  each signer carrying `widgets[]` placed by explicit `page` + `x/y/w/h`
  coordinates (no DocuSign-style anchor text). Returns the document
  `objectId`. Consumes a Premium API credit per send.
- **Status**: `GET /document/:objectId` returns signing status + signed
  file URL + certificate URL. (Polling fallback; the webhook is primary.)
- **Webhook**: events `created` / `viewed` / `signed` / `completed` /
  `declined`. Signed with HMAC-SHA256 over the **raw request body** using
  the webhook security key, in header `x-webhook-signature`. The
  `completed` payload includes `objectId`, the signed `file` URL, and a
  `certificate` URL (presigned, ~15-min expiry — download promptly).
- Other useful routes: `POST /revokedocument`, `POST /resendrequestmail`,
  `GET /getsignerips` (audit).

### Key behavioural difference vs DocuSign

DocuSign placed the signature with an anchor string (`/sn1/`) found in the
document text. OpenSign requires explicit widget coordinates. See "Open
decision: signature placement" below.

### Mapping the webhook back to an onboarding

DocuSign round-tripped custom text fields (lease_id, onboarding_id).
OpenSign's webhook does **not** echo custom metadata — it returns its own
`objectId`. So we store the `objectId` returned by `/createdocument` at
send time (in the same `signing` slot that held the DocuSign `envelope_id`)
and match the webhook's `objectId` to it. Simpler and more reliable than
the custom-field match.

## Architecture: keep the provider boundary, swap the body

The existing boundary is clean, so call sites barely change.

New `stewart/integrations/opensign.py` mirrors the current
`stewart/integrations/docusign.py` interface exactly:

- Dataclasses `LeaseSignatureRequest`, `LeaseSignatureResult`,
  `SignedLeaseDocumentResult` (unchanged shapes).
- `is_configured(settings)` → `bool(opensign_api_token)`.
- `send_lease_for_signature(request, settings)` → `POST /createdocument`,
  return `LeaseSignatureResult(provider="opensign", envelope_id=objectId)`.
- `download_signed_lease_document(object_id, settings)` →
  `GET /document/:id`, follow the signed file URL, return PDF bytes.

`stewart/integrations/docusign.py` is deleted; the import sites switch to
the new module.

**Field-naming call:** keep the existing `envelope_id` field / `signing.envelope_id`
key as the generic "provider reference id" (now holding the OpenSign
`objectId`), rather than renaming it everywhere. Avoids rippling a rename
through the API response schema, frontend types, and persisted onboarding
JSON for zero behavioural gain. A one-line comment documents the meaning.

## File-by-file change list

Backend:
- `stewart/integrations/opensign.py` — NEW adapter (above).
- `stewart/integrations/docusign.py` — DELETE.
- `stewart/core/settings.py` — remove the 7 `docusign_*` vars; add
  `opensign_api_token`, `opensign_base_url`
  (default `https://sandbox.opensignlabs.com/api/v1.2`),
  `opensign_webhook_secret`.
- `apps/api/webhook_auth.py` — add `opensign_signature_valid(request,
  raw_body, secret)` (HMAC-SHA256 hex compare on raw body), mirroring the
  existing SendGrid signed-webhook helper.
- `apps/api/routers/tenant_onboarding.py` — replace the DocuSign webhook
  block: new secret check (`x-webhook-signature` HMAC), OpenSign payload
  parsers (`event`/`objectId`/`file`/`certificate`/`declinedReason`),
  match by `objectId`, on `completed` retain signed doc + open activation
  review, on `declined` push to the lifecycle queue. Must read the raw
  body before JSON parse for signature verification.
- `apps/api/tenant_lease_agreement.py` — generalise
  `ACTIVE_DOCUSIGN_SIGNING_STATUSES` → `ACTIVE_SIGNING_STATUSES`; make the
  `provider == "docusign"` branch provider-agnostic; rewrite the locked
  reason to generic e-sign copy (and fix the stale "Leasium" → "Relby").
- `apps/api/schemas/system.py` + `apps/api/routers/system.py` — rename the
  `docusign` provider-status field to `opensign`.

Frontend:
- `apps/web/src/lib/api.ts` — provider literal/type `docusign` → `opensign`;
  any envelope-specific copy.
- `apps/web/src/components/integrations-health-card.tsx` — DocuSign →
  OpenSign label.
- Tenant onboarding / portal lease-signing copy — "DocuSign envelope is
  waiting…" → generic "e-signature request is waiting…".
- `apps/web/tests/smoke/api-mocks.ts` + `app-flows.spec.ts` — provider
  `opensign`, generic copy.

Tests (mock the provider; never hit OpenSign):
- `tests/integration/test_tenant_onboarding_api.py` — import from
  `opensign`; send returns `objectId`; webhook tests build the OpenSign
  payload + a valid `x-webhook-signature` and assert completed→signed+retained,
  declined→lifecycle; add an invalid-signature rejection test; update the
  skipped/failed setup-error copy to the new env-var names.
- NEW adapter unit test with `httpx.MockTransport`: `/createdocument`
  called with `x-api-token`, `objectId` parsed; download follows the
  signed-file URL.

Docs:
- `docs/deployment.md` — OpenSign env + console webhook setup (replaces the
  DocuSign JWT section).
- `docs/product-roadmap.md`, `docs/design-governance.md` (UX pass line),
  `docs/next-chat-handover.md` — updated.

## Test / success criteria (TDD)

1. Adapter: unconfigured → `skipped` with setup error; configured → posts
   to `/createdocument` with token, parses `objectId`. Download follows the
   document's signed-file URL. (httpx MockTransport.)
2. Webhook: valid HMAC + `completed` → signed PDF retained, signing marked
   signed, activation review opened. `declined` → lifecycle queue with
   reason. Invalid/missing signature → rejected. Unknown `objectId` → no-op.
3. Frontend: eslint + tsc clean; notifications/onboarding smoke green with
   the `opensign` provider fixture.
4. UX pass: lease-signing surfaces screenshotted at 1440px + 390px; copy
   reads cleanly (slop test); UX pass-log line added.

## UX gate (§2.2)

The only user-visible change is copy on existing surfaces (signing status,
locked-reason, integration-health label) — no new or restructured surface.
So: no new Figma frame required; run the same-session UX pass (1440/390
screenshots + slop test on the new copy) and log it. If Temba wants the
copy in Figma too, we add a frame.

## Prod cutover (Temba runs — creds can't be entered from here)

Render (API service) env:
- `OPENSIGN_API_TOKEN` = Live token (OpenSign → Settings → API Token →
  Generate Live API Token; paid plan required).
- `OPENSIGN_BASE_URL` = `https://app.opensignlabs.com/api/v1.2`.
- `OPENSIGN_WEBHOOK_SECRET` = the security key from the webhook below.

OpenSign console:
- Settings → Webhook → Add Webhook → URL = the live lease-signing webhook
  endpoint on the Render API (exact path confirmed at build) → Enable
  Authentication → Generate security key → paste the same key into
  `OPENSIGN_WEBHOOK_SECRET`.

No Vercel env change (frontend holds no signing secret). Live sends stay
operator-triggered. Validate end-to-end first in sandbox
(`https://sandbox.opensignlabs.com/api/v1.2` + sandbox token + sandbox
webhook) before flipping to live.

## Open decision: signature widget placement

OpenSign needs explicit `page` + `x/y/w/h` for the signature widget; a
"signer" must have at least one signature widget. Two viable v1 approaches:

- **A — last page, calibrated coords (recommended):** compute page count
  from the lease PDF (pypdf) and place one signature widget at a calibrated
  position on the last page. Lighter; calibrate once via OpenSign's Debug
  UI (app.opensignlabs.com/debugpdf) and confirm with a sandbox send.
  Assumes the signature block sits in a consistent spot.
- **B — append a dedicated signature page:** generate a known signature
  page, append it to the lease PDF, place the widget at fixed coords on
  that page. Fully deterministic regardless of lease layout; more code +
  a PDF-compose step.

Recommend A for v1 (internal-first, SKJ's own lease template is
consistent), with B as the upgrade if lease layouts vary.

## Risks / notes

- Premium API credits are consumed per send — monitor balance
  (Settings → API Token).
- Presigned signed-file/certificate URLs expire (~15 min); retain during
  webhook processing, don't store the URL as the document.
- Retain the **certificate** PDF too (or its metadata) for audit parity
  with DocuSign's combined+certificate download — v1 retains the signed
  PDF and records the certificate URL; storing the certificate as a second
  document is a small follow-up.
- OpenSign publishes no SOC 2 / eIDAS attestation; acceptable for internal
  SKJ use, revisit before external sale.
