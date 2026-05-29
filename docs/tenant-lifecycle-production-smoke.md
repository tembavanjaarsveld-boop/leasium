# Tenant Lifecycle Production Smoke

Use this runbook for the tenant lifecycle go-live smoke on production. It is
intended for one controlled live tenant/lease pack and one tenant-uploaded
document pass. Do not use real secrets in notes, screenshots, issue comments,
or chat.

## Production URLs

- Frontend: `https://leasium.ai`
- API base: `https://api.leasium.ai/api/v1`
- DocuSign Connect webhook:
  `https://api.leasium.ai/api/v1/tenant-onboarding/webhooks/docusign`
- Operator tenant detail: `https://leasium.ai/tenants/<tenant_id>`
- Tenant portal claim link: `https://leasium.ai/tenant-portal/<token>`
- Tenant portal lease view after claim: `https://leasium.ai/tenant-portal/lease`
- Public onboarding legacy redirect: `https://leasium.ai/onboarding/<token>`

## 1. Preflight Readiness

Run this before sending any live envelope.

1. Confirm the latest production API deploy completed and migrations ran.
   Success: Render deploy logs show the service booted cleanly and Alembic
   reached head.
   Failure: migration errors, boot loops, or stale deploys. Stop and roll back
   or redeploy before testing.
2. Confirm production URL env vars are branded:
   `PUBLIC_API_URL=https://api.leasium.ai`,
   `FRONTEND_URL=https://leasium.ai`, and
   `NEXT_PUBLIC_API_BASE_URL=https://api.leasium.ai/api/v1`.
   Success: tenant/operator links use `leasium.ai` and API calls go to
   `api.leasium.ai`.
   Failure: links or browser calls use Vercel preview URLs,
   `leasium-api.onrender.com`, localhost, or demo hosts.
3. In Settings > Organisation > Integrations, open DocuSign readiness.
   Success: DocuSign is configured, the Connect webhook URL is exactly
   `https://api.leasium.ai/api/v1/tenant-onboarding/webhooks/docusign`, and
   the panel does not expose any secret values.
   Failure: `not_configured`, missing JWT credentials, missing webhook secret,
   or a non-production webhook URL.
4. Confirm a test tenant has exactly one pending lease, a correct tenant email,
   a tenant mobile number if SMS is enabled, and the operator can open
   `https://leasium.ai/tenants/<tenant_id>`.
   Success: the tenant detail page shows the onboarding/lease-signing workflow.
   Failure: no pending lease, wrong tenant, wrong entity, or no operator access.
5. Attach the intended lease pack PDF to the tenant/onboarding/lease scope on
   the tenant detail page before sending.
   Success: the lease-signing panel lists the attached lease document and the
   Send lease pack action is available after onboarding approval/apply.
   Failure: Send lease pack is disabled, the document is unscoped, or the
   document belongs to a different tenant, lease, or onboarding.

## 2. DocuSign Connect Setup

Configure this in DocuSign before the live send.

1. In the DocuSign production app, confirm the JWT integration key, account
   GUID, service-user GUID, RSA private key, and consent are live.
2. On the API service, set the required DocuSign variables:
   `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_USER_ID`,
   `DOCUSIGN_RSA_PRIVATE_KEY`, `DOCUSIGN_WEBHOOK_SECRET`,
   `DOCUSIGN_BASE_URL=https://www.docusign.net/restapi`, and
   `DOCUSIGN_AUTH_BASE_URL=https://account.docusign.com`.
   The webhook secret must be supplied, but never paste the value into this
   runbook or test evidence.
3. In DocuSign Connect, configure envelope events to POST to
   `https://api.leasium.ai/api/v1/tenant-onboarding/webhooks/docusign`.
   Supply the same webhook secret as `x-docusign-webhook-secret` or as a
   `token` query parameter.
4. Include completed and declined envelope events.

Success: Settings shows DocuSign ready and the Connect URL matches production.
Failure: the API returns 401/403 for Connect, completed envelopes never update
Leasium, or Settings says the webhook secret is missing.

## 3. Live Lease Pack Send

1. Open `https://leasium.ai/tenants/<tenant_id>`.
2. If the tenant details are submitted but not approved, click **Approve &
   apply**. This calls
   `POST https://api.leasium.ai/api/v1/tenant-onboarding/<onboarding_id>/review`
   and then
   `POST https://api.leasium.ai/api/v1/tenant-onboarding/<onboarding_id>/apply`.
3. Confirm the lease document is visible in the lease-signing panel.
4. Click **Send lease pack**. This calls
   `POST https://api.leasium.ai/api/v1/tenant-onboarding/<onboarding_id>/send-lease-pack`.
5. Record the tenant id, onboarding id, lease id, source document id, and
   DocuSign envelope id.

Success: the UI says `Lease pack sent. DocuSign is waiting for signature.`, the
status badge reads `DocuSign pending`, and the delivery data contains a
DocuSign `envelope_id`.

Failure:

- `Lease pack sent. DocuSign setup needs attention.` means the pack delivery
  was attempted but DocuSign configuration is incomplete.
- `Lease pack sent. DocuSign could not start.` means the DocuSign send failed.
- HTTP 409 or an active-envelope message means there is already a pending
  DocuSign envelope; do not send another until it is completed, declined, or
  otherwise resolved.

## 4. Webhook Completion Verification

1. Complete the envelope in DocuSign as the signer.
2. Wait for DocuSign Connect to POST the completion event to
   `https://api.leasium.ai/api/v1/tenant-onboarding/webhooks/docusign`.
3. Refresh `https://leasium.ai/tenants/<tenant_id>`.

Success:

- The signing status changes from `DocuSign pending` to `DocuSign completed`.
- The signing metadata shows provider `docusign`, status `signed`, the same
  `envelope_id`, and source `docusign_webhook`.
- The lease is still not active yet.
- The activation review state is ready for review.

Failure:

- No change after several minutes: check DocuSign Connect delivery logs,
  webhook URL, and secret delivery.
- API rejects the event: check for missing/invalid webhook secret or mismatched
  hidden custom fields.
- A completed event after a declined envelope is ignored by design; use the
  retry path below.

## 5. Signed PDF Retention Verification

After webhook completion, confirm Leasium retained exactly one signed PDF.

1. On `https://leasium.ai/tenants/<tenant_id>`, check the tenant documents and
   lease-signing panel.
2. Use the signed lease download action, which serves from
   `GET https://api.leasium.ai/api/v1/documents/<document_id>/download`.
3. Verify the PDF opens and contains the completed DocuSign signatures.

Success: there is exactly one completed signed lease document for the tenant,
onboarding, and lease scope. The document metadata source is
`docusign_signed_lease`, and its envelope id matches the live envelope.

Failure: no signed PDF, duplicate signed PDFs for the same envelope, a corrupted
download, or a document scoped to the wrong tenant/onboarding/lease.

## 6. Explicit Activate Lease Verification

The webhook must not activate the lease automatically.

1. While still on `https://leasium.ai/tenants/<tenant_id>`, review the signed
   PDF and completion evidence.
2. Click **Activate lease** only after the operator accepts the evidence. This
   calls
   `POST https://api.leasium.ai/api/v1/tenant-onboarding/<onboarding_id>/activate-lease`.
3. Refresh the tenant detail page.

Success: the lease status becomes `active`, the activation review state becomes
`activated`, and the UI records that the lease was activated after signed lease
review.

Failure:

- 400/409 or a disabled button means the signing evidence is not ready, the
  onboarding is wrong, or the lease is already active.
- If the webhook completion exists but activation fails, do not manually edit
  the database; capture the onboarding id, lease id, envelope id, API response,
  and Render logs.

## 7. Tenant-Uploaded Lease Accept-Match

Use this to verify tenant-uploaded lease QA does not bypass DocuSign guardrails.

1. Sign in as the tenant and open `https://leasium.ai/tenant-portal`.
2. Upload a lease document through the tenant portal document upload flow. The
   tenant-side API is
   `POST https://api.leasium.ai/api/v1/tenant-portal/documents`.
3. As the operator, open Smart Intake or the tenant document review surface and
   review the uploaded lease match.
4. Accept the match only when there is no active DocuSign conflict for the same
   onboarding/lease.

Success: accepting the matched tenant-uploaded lease creates or updates the
reviewed lease document/intake evidence without activating the lease and without
overwriting an active DocuSign envelope.

Failure: the review surface warns
`Resolve the active DocuSign envelope before accepting a tenant-uploaded lease.`
If this appears, leave the tenant-uploaded lease in review until the active
envelope is completed, declined, or triaged.

## 8. Tenant-Uploaded Insurance Apply

1. Sign in as the tenant and open `https://leasium.ai/tenant-portal`.
2. Upload the insurance certificate through the compliance/document upload
   panel. The tenant-side API is
   `POST https://api.leasium.ai/api/v1/tenant-portal/documents`.
3. As the operator, review the uploaded insurance intake.
4. Apply the reviewed extraction only after confirming the tenant, property,
   policy dates, and source document are correct.
5. Open `https://leasium.ai/tenants/<tenant_id>`.

Success: the tenant insurance card shows `Confirmed` or the expected review
state, the expiry date matches the certificate, and the source document download
works. Tenant metadata should reference the insurance document/intake and an
applied timestamp.

Failure: wrong expiry date, no source document, no tenant insurance update after
apply, or the certificate appears under the wrong tenant/property.

## 9. Retry After Declined or Failed Envelope

1. If the envelope is declined, refresh `https://leasium.ai/tenants/<tenant_id>`.
2. Confirm the UI shows `DocuSign needs attention` and the declined envelope id.
3. Fix the lease pack or signer details.
4. Click **Send lease pack** again. This again calls
   `POST https://api.leasium.ai/api/v1/tenant-onboarding/<onboarding_id>/send-lease-pack`.
5. Record the new envelope id and keep the declined id in the history.

Success: the new send returns `DocuSign pending`, the new envelope id is
different, and lease pack history keeps both the declined envelope and retry
envelope.

Failure: retry is blocked while an envelope is still pending, the same envelope
id is reused unexpectedly, or the declined completion event later changes the
signing state. Capture the IDs and logs before retrying again.

## 10. Rollback and Triage Notes

- Stop sending new packs if DocuSign Connect is rejecting events, signed PDFs
  are not retained, activation happens without operator action, or tenant
  uploads can overwrite active DocuSign evidence.
- To reduce blast radius, disable operator sends by withholding DocuSign
  readiness or removing the live Connect secret from the API service. Keep the
  secret value out of incident notes.
- Do not delete production tenant, onboarding, document, or signing rows during
  triage. Preserve tenant id, onboarding id, lease id, source document id,
  signed document id, envelope id, timestamps, operator user, and API responses.
- Check Render API logs for requests to
  `/api/v1/tenant-onboarding/<onboarding_id>/send-lease-pack`,
  `/api/v1/tenant-onboarding/webhooks/docusign`, and
  `/api/v1/tenant-onboarding/<onboarding_id>/activate-lease`.
- Check DocuSign Connect delivery logs for status code, delivery timestamp, and
  envelope id. Do not copy the webhook secret.
- A successful smoke ends only when the signed PDF is retained and the operator
  explicitly activates the lease.
