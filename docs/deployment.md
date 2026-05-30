# Leasium Deployment

## Vercel Web App

The Vercel project should deploy the Next.js frontend from `apps/web`.

Recommended Vercel project settings:

- Root Directory: `apps/web`
- Framework Preset: `Next.js`
- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm build`
- Output Directory: leave blank/default

Required Vercel environment variable:

```bash
NEXT_PUBLIC_API_BASE_URL=/api/v1
LEASIUM_ACCESS_PASSWORD=choose-a-temporary-private-beta-password
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
# Only set this when Clerk's proxy URL is enabled in the Clerk Dashboard.
# Prefer Clerk's DNS/CNAME setup for clerk.leasium.ai when available.
NEXT_PUBLIC_CLERK_PROXY_URL=
```

`LEASIUM_ACCESS_PASSWORD` enables the temporary app-level password gate for the
main Leasium workspace. It is a light private-beta screen only; public tenant
onboarding links under `/onboarding/...`, tenant portal links under
`/tenant-portal/...`, operator login pages, invite acceptance, and first
workspace setup under `/setup` remain accessible without the password.

The web app is only the frontend. The FastAPI backend still needs a separate
host. Production uses the Vercel rewrites in `apps/web/vercel.json` so browser
API calls stay same-origin under `/api/v1` and `/health`; Vercel then proxies
them to `https://api.leasium.ai`.

Current production domains:

- `leasium.ai` is the primary Vercel domain.
- `www.leasium.ai` is also attached to the same Vercel project.
- `api.leasium.ai` is the primary Render API domain.
- `leasium-api.onrender.com` is a provider fallback only and should not appear
  in tenant/operator links or frontend environment variables.

VentraIP DNS for the Vercel frontend:

```text
A      leasium.ai      216.198.79.1
CNAME  www             a08403df2f706cb2.vercel-dns-017.com
```

## API Host

Set the API host environment from `.env.example`, with production values for:

- `DATABASE_URL`
- `DATABASE_POOL_SIZE`
- `DATABASE_MAX_OVERFLOW`
- `DATABASE_POOL_TIMEOUT_SECONDS`
- `DATABASE_POOL_RECYCLE_SECONDS`
- `REDIS_URL`
- `PUBLIC_API_URL`
- `FRONTEND_URL`
- `CORS_ALLOWED_ORIGINS`
- `CORS_ALLOWED_ORIGIN_REGEX`
- `OPENAI_API_KEY`
- `SERPAPI_API_KEY` (only required for the property image preview/apply endpoints; without it the route returns 503 and no records mutate)
- `XERO_RECONCILIATION_STALE_AFTER_DAYS` (optional; defaults to 7 — operator-tunable window before `/xero/status` flags open Xero-linked invoices as stale)
- `S3_ENDPOINT_URL`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_BUCKET`
- `S3_REGION`
- `SENDGRID_API_KEY`
- `SENDGRID_FROM_EMAIL`
- `SENDGRID_FROM_NAME`
- `SENDGRID_INBOUND_SECRET` (required before enabling SendGrid Inbound Parse)
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_FROM_PHONE`
- `COMMUNICATIONS_WEBHOOK_SECRET`
- `AUTH_MODE=clerk` only after the first operator invite is accepted
- `CLERK_SECRET_KEY`
- `CLERK_JWKS_URL`
- `CLERK_ISSUER`
- `CLERK_AUDIENCE` if the Clerk JWT template uses an audience
- `OPERATOR_INVITE_TTL_HOURS`
- `XERO_CLIENT_ID`
- `XERO_CLIENT_SECRET`
- `XERO_REDIRECT_URI` set to `<PUBLIC_API_URL>/api/v1/xero/oauth/callback`
- `XERO_STATE_SECRET`
- `XERO_TOKEN_ENCRYPTION_KEY`

`FRONTEND_URL` must be `https://leasium.ai` so browser requests pass CORS and
all email/SMS links use the branded domain. `CORS_ALLOWED_ORIGINS` should include
`https://leasium.ai` and `https://www.leasium.ai`. Add Vercel preview URLs only
for deliberate preview testing, not as production fallbacks.
`PUBLIC_API_URL` must match the hosted API origin so Twilio SMS callbacks can
report delivery status back into Leasium. For production, use
`https://api.leasium.ai`.
Use `CORS_ALLOWED_ORIGINS` for extra explicit domains, separated by commas. Use
`CORS_ALLOWED_ORIGIN_REGEX` only for controlled preview URL patterns.

Render custom API domain:

```text
CNAME  api             leasium-api.onrender.com
```

Set production URL variables to the branded hosts now that the API certificate
is active:

```bash
FRONTEND_URL=https://leasium.ai
PUBLIC_API_URL=https://api.leasium.ai
NEXT_PUBLIC_API_BASE_URL=/api/v1
XERO_REDIRECT_URI=https://api.leasium.ai/api/v1/xero/oauth/callback
```

Tenant portal account claims compare the signed-in Clerk email with the invite
email before linking the account. The Clerk session JWT should include `email`
and `email_verified` claims. If those claims are absent, the API falls back to
`CLERK_SECRET_KEY` and Clerk's user API to read the verified primary email; keep
that key configured anywhere tenant portal account creation is enabled.

Provider webhook URLs should also use `https://api.leasium.ai`.

## Observability

Error/performance reporting via Sentry is optional and **disabled by default**.
Set these on the API service to enable it:

```bash
SENTRY_DSN=
SENTRY_ENVIRONMENT=
```

- `SENTRY_DSN` — the project DSN. Leave empty (the default) to keep Sentry
  fully disabled; the API never initialises the SDK and runs as a no-op.
- `SENTRY_ENVIRONMENT` — optional label (e.g. `production`); falls back to
  `APP_ENV` when unset.

Sentry init is guarded so a missing package or bad DSN can never break API
startup. Regardless of Sentry, the API already emits a `server-timing` response
header and an `x-request-id` per request for tracing slow live pages from logs.

Frontend observability (Vercel Speed Insights) is deferred; it needs an npm
dependency plus a Vercel env toggle and is not wired up yet.

## Bank Feed (Basiq)

Bank-feed reconciliation (Basiq, AU) is review-first and **off by default**.
Set these on the API service to enable it:

```bash
BASIQ_ENABLED=false
BASIQ_API_KEY=
```

- `BASIQ_ENABLED` + `BASIQ_API_KEY` are both required before the adapter does
  anything; until then it soft-skips and the Settings → Bank feed panel stays
  inert.
- v1 reconciles operator-imported transactions against unpaid invoices and
  writes only local invoice payment metadata after explicit per-row approval —
  it never moves money or mutates a bank/Xero record. Live Basiq OAuth
  (auto-fetching transactions) is a later slice. No migration is required for
  v1.

## Xero Go-Live Checklist

Use the production branded redirect URI everywhere:

```text
https://api.leasium.ai/api/v1/xero/oauth/callback
```

In the Xero developer app, configure that URI exactly. In Render, set these
Xero environment variables on the API service:

```bash
XERO_CLIENT_ID=...
XERO_CLIENT_SECRET=...
XERO_REDIRECT_URI=https://api.leasium.ai/api/v1/xero/oauth/callback
XERO_STATE_SECRET=choose-a-long-random-secret
XERO_TOKEN_ENCRYPTION_KEY=...
```

Generate the Fernet encryption key for `XERO_TOKEN_ENCRYPTION_KEY` with:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

The branded domain variables must also point at production:

```bash
PUBLIC_API_URL=https://api.leasium.ai
FRONTEND_URL=https://leasium.ai
NEXT_PUBLIC_API_BASE_URL=/api/v1
```

Current workflow scopes:

```text
offline_access accounting.contacts.read accounting.settings.read accounting.invoices
```

Post-connect verification sequence:

1. Open `GET /api/v1/xero/connection-diagnostics?entity_id=<entity_id>` and
   confirm `provider_configured=true`, `missing_config=[]`, and the redirect URI
   is `https://api.leasium.ai/api/v1/xero/oauth/callback`.
2. Start OAuth from the operator settings screen and connect the correct Xero
   organisation.
3. Re-open connection diagnostics and confirm `connection_source=provider`,
   `xero_tenant_id` is populated, and provider-backed preview capabilities are
   enabled.
4. Run contact sync preview, then apply only reviewed local contact mappings.
5. Run chart/tax validation preview and fix local charge-rule mappings.
6. Run invoice posting preview before explicit invoice posting approval.
7. Create Xero draft invoices only from the explicit approved draft-create or
   provider-dispatch endpoint.
8. Run payment reconciliation preview before applying local payment metadata.

`/api/v1/xero/connection-diagnostics` is intentionally non-mutating: it reads
local configuration and connection rows only, and must not refresh tokens, call
Xero, post invoices, write contacts, or reconcile payments.

## Clerk Domains

The frontend and API must agree on the same Clerk issuer. Do not mix a
`leasium.ai` app session with a `leasium.vercel.app` Clerk frontend API.

Preferred production setup:

- Clerk application domain: `leasium.ai`
- Clerk frontend API host: `clerk.leasium.ai`
- Vercel `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`: a live key that decodes to
  `clerk.leasium.ai`
- Render `CLERK_JWKS_URL`: `https://clerk.leasium.ai/.well-known/jwks.json`
- Render `CLERK_ISSUER`: `https://clerk.leasium.ai`

If Clerk is configured to use the Leasium proxy instead of a CNAME frontend API,
set the proxy URL in the Clerk Dashboard first, then set Vercel
`NEXT_PUBLIC_CLERK_PROXY_URL=https://leasium.ai/__clerk`. Do not set a proxy URL
as a workaround unless the Clerk Dashboard is configured for the exact same URL.

Tenant onboarding delivery uses Twilio SendGrid for email and Twilio Messaging
for SMS. If any channel is not configured, Leasium records the channel as
skipped rather than blocking onboarding link creation.
Set Twilio SMS status callbacks and SendGrid Event Webhook URLs to the hosted
`/api/v1/tenant-onboarding/webhooks/...` endpoints using the shared webhook
secret so Leasium can show sent, delivered, opened, and failed receipts. When
`TWILIO_AUTH_TOKEN` is configured, the tenant-onboarding Twilio status callback
also accepts Twilio's signed `X-Twilio-Signature` header against either the
request URL or `PUBLIC_API_URL`; unsigned callbacks are rejected before receipt
metadata changes.

**DocuSign integration.** When the DocuSign developer account is provisioned,
set on the API service:

- `DOCUSIGN_ACCOUNT_ID` — DocuSign Account GUID
- `DOCUSIGN_INTEGRATION_KEY` — Integration Key from the DocuSign console
- `DOCUSIGN_USER_ID` — User GUID for the JWT grant (operator service account)
- `DOCUSIGN_RSA_PRIVATE_KEY` — full PEM-encoded RSA private key
- `DOCUSIGN_WEBHOOK_SECRET` — shared secret for verifying Connect webhook events
- `DOCUSIGN_BASE_URL` (optional) — overrides the demo `https://demo.docusign.net/restapi`; production is `https://www.docusign.net/restapi`
- `DOCUSIGN_AUTH_BASE_URL` (optional) — overrides the demo auth host `https://account-d.docusign.com`; production is `https://account.docusign.com`

Until the four DocuSign JWT values are set, `stewart.integrations.docusign.send_lease_for_signature` returns `status="skipped"` with a clear `not_configured` error and never calls DocuSign. Settings > Organisation > Integrations also reports DocuSign readiness without exposing secrets, including a reminder to add `DOCUSIGN_WEBHOOK_SECRET` before live Connect testing and the exact Connect webhook URL when `PUBLIC_API_URL` is set. When configured, the helper uses JWT Grant with `signature impersonation` scope and creates a remote-signing envelope from the attached lease document, including hidden custom fields for the lease, tenant onboarding, source document, entity, property, and unit. Configure DocuSign Connect to post envelope events to `<PUBLIC_API_URL>/api/v1/tenant-onboarding/webhooks/docusign`; the API rejects Connect events until `DOCUSIGN_WEBHOOK_SECRET` is configured and supplied as `x-docusign-webhook-secret` or a `token` query parameter. Completed envelope events are only accepted for the matching active DocuSign signing record; when Connect includes Leasium custom fields, the present tenant onboarding, lease, source document, and entity ids must also match before Leasium marks `lease_agreement.signing` signed and downloads the completed `combined` PDF back into tenant documents as a signed lease. Lease status is not activated by the webhook; an operator must explicitly use the tenant-detail Activate lease action, which calls `POST /api/v1/tenant-onboarding/{id}/activate-lease`.

Live console verification:

For the repeatable production go-live smoke, use
[`docs/tenant-lifecycle-production-smoke.md`](tenant-lifecycle-production-smoke.md).

1. In DocuSign, create or confirm the JWT app, RSA key pair, API account GUID,
   integration key, and impersonated service-user GUID. Grant consent for the
   JWT app before testing.
2. Set the four required JWT variables plus `DOCUSIGN_WEBHOOK_SECRET` on the
   API service. Use the production DocuSign base/auth hosts only after the app
   is promoted out of demo.
3. In DocuSign Connect, point envelope events at
   `https://api.leasium.ai/api/v1/tenant-onboarding/webhooks/docusign` and pass
   the same webhook secret as a header or token query parameter. Do not expose
   API keys or private keys in Connect payloads or operator-facing diagnostics.
4. With operator approval and the correct lease file attached, send one lease
   pack, complete the envelope in DocuSign, and confirm Leasium records the
   signing status and retains exactly one completed signed PDF under the tenant,
   onboarding, and lease scope.
5. Review the signed lease on the tenant detail page, then explicitly click
   **Activate lease** only after the operator accepts the completion evidence.

**Inbound SMS parsing (Twilio Messaging webhook).** Leasium accepts inbound
SMS through `POST /api/v1/comms/webhooks/twilio-inbound?entity_id=<uuid>`.
To wire this up: (1) purchase a Twilio phone number for each entity (one
number per portfolio so the `entity_id` query param can be hard-coded into
the webhook URL); (2) on the Twilio console, set the number's *Messaging
Configuration → A message comes in* webhook to
`https://<API_HOST>/api/v1/comms/webhooks/twilio-inbound?entity_id=<UUID>`
with HTTP POST; (3) keep `TWILIO_AUTH_TOKEN` configured on the API service so
Leasium can verify Twilio's `X-Twilio-Signature` header before persisting the
message. Local/dev environments without a token still accept the webhook for
setup testing. Inbound SMS lands in the same
`inbound_message` table with `channel="sms"`, attributed by digits-only
phone-number suffix match against `tenant.contact_phone`, and surfaces in
the operator comms queue as `inbound_sms` candidates.

**Inbound email parsing (SendGrid Inbound Parse).** Leasium accepts inbound
emails through `POST /api/v1/comms/webhooks/sendgrid-inbound?entity_id=<uuid>`.
To wire this up: (1) add an MX record on a subdomain you control
(e.g. `inbound.leasium.example.org`) pointing to `mx.sendgrid.net`;
(2) in the SendGrid console, add an Inbound Parse setting that maps the
subdomain to `https://<API_HOST>/api/v1/comms/webhooks/sendgrid-inbound?entity_id=<UUID>&token=<SENDGRID_INBOUND_SECRET>`
with the SendGrid "POST the raw, full MIME message" option **off**
(Leasium parses the form fields); (3) repeat with one Inbound Parse setting
per entity so each operator portfolio gets a dedicated mailbox.
Set `SENDGRID_INBOUND_SECRET` on the API before enabling live MX. If the secret
is configured, the webhook rejects requests unless the same value is supplied
as `token`, `secret`, `X-Leasium-SendGrid-Inbound-Secret`, or
`X-SendGrid-Inbound-Secret`. Inbound messages land in the `inbound_message`
table, attachments route to Smart Intake review rows, and both surface in the
operator comms queue as `inbound_email` candidates the operator reviews and
replies to via the existing dispatch path.

Two distinct SendGrid templates are now used. The original tenant onboarding
invite (template key `tenant_onboarding_invite`, version `v1`) is sent when the
operator creates the onboarding row and on resends / reminders; it now only
fires on the legacy public-form path and remains in place for backward
compatibility. The tenant portal claim invite (template key
`tenant_portal_invite`, version `v1`) is sent by the new operator-triggered
`POST /api/v1/tenant-onboarding/{id}/send-portal-invite` action and points the
tenant at `/tenant-portal/{token}` instead of the public form. Both template
keys + versions can be overridden through `TENANT_ONBOARDING_TEMPLATE_KEY` /
`_VERSION` and `TENANT_PORTAL_INVITE_TEMPLATE_KEY` / `_VERSION` if the
SendGrid template IDs need to change. Until the portal invite template exists
under the SendGrid account, sends are recorded as `queued` against an unknown
template — in practice SendGrid skips them and the receipt path logs a soft
failure. Create the template with copy explaining: "Your Leasium tenant portal
is ready," brand name placeholder, property + unit label, due date, expiry,
and a single primary call-to-action linking to the onboarding URL.

Work assignment digest previews can be generated by scheduler calls using the
same `COMMUNICATIONS_WEBHOOK_SECRET`. These runs are review-only: they create
operator digest preview receipts and notification-center activity, but do not
send email, SMS, or push notifications. Configure cron jobs to call:

```bash
POST <PUBLIC_API_URL>/api/v1/work-assignments/digests/run-due?cadence=daily
POST <PUBLIC_API_URL>/api/v1/work-assignments/digests/run-due?cadence=weekly
```

Include either `x-leasium-webhook-secret: <COMMUNICATIONS_WEBHOOK_SECRET>` or a
`token=<COMMUNICATIONS_WEBHOOK_SECRET>` query parameter. The due runner scans
active entities and only generates previews where assigned open work matches an
active operator's digest cadence. For a single known entity, cron can still call
`/api/v1/work-assignments/digests/run-scheduled` with an explicit
`{"entity_id":"...","cadence":"daily"}` or weekly payload.

Digest email delivery stays explicit. To send provider-backed SendGrid digest
emails, call the same endpoints with `send_email_approved=true` in the JSON
payload for `/run-scheduled`, or the `send_email_approved=true` query parameter
for `/run-due`. Leasium records queued/skipped/failed digest receipts in
operator notification history and accepts SendGrid digest events through
`/api/v1/work-assignments/webhooks/sendgrid-events`.

The Work notification center also shows provider setup checks for SendGrid and
Twilio using only bare endpoint URLs. Configure the SendGrid Event Webhook at
`<PUBLIC_API_URL>/api/v1/work-assignments/webhooks/sendgrid-events` and Twilio
Work SMS status callbacks at
`<PUBLIC_API_URL>/api/v1/work-assignments/webhooks/twilio-status`, then pass the
shared `COMMUNICATIONS_WEBHOOK_SECRET` through the provider console or protected
scheduler calls. Maintenance contractor SMS callbacks should point at
`<PUBLIC_API_URL>/api/v1/maintenance/work-orders/webhooks/twilio-status`.
When `TWILIO_AUTH_TOKEN` is configured, both Twilio status callback endpoints
also accept signed `X-Twilio-Signature` requests against `PUBLIC_API_URL` and
reject unsigned callbacks before receipt metadata changes. Notification-center
responses must not expose webhook secrets, provider API tokens, or tokenized
callback URLs.

Operator invite delivery also uses the SendGrid key/from settings above. Invite
links point to `/accept-invite?token=...`; the raw token is sent once by email,
while only a hash is stored in the database. Owner/admin invite actions also
return the one-time accept link immediately so the Settings screen can copy it
for a manual fallback when a recipient's internal mail filter quarantines the
email. Operator invite emails disable SendGrid click tracking so the invite CTA
is not rewritten through a SendGrid tracking domain.

For production deliverability after the `leasium.ai` cutover, authenticate the
SendGrid sender domain in DNS before relying on internal corporate mailboxes:
publish the SendGrid-provided SPF/DKIM records for the `SENDGRID_FROM_EMAIL`
domain and add a DMARC record for the same organisational domain. Configure
SendGrid Event Webhook for operator receipts at
`https://api.leasium.ai/api/v1/security/webhooks/sendgrid-events` with the same
`COMMUNICATIONS_WEBHOOK_SECRET` used by the API so Leasium can move operator
rows from queued into delivered, opened, deferred, bounced, or dropped states.
On a clean production database, use `/setup` after Clerk is configured to create
the first organisation, entity, and owner operator from a signed-in Clerk
session. Keep `AUTH_MODE=dev` for an existing seeded workspace until at least
one owner/admin operator has accepted an invite and is linked to a Clerk user.

When both `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are set on
the web app, middleware redirects signed-out protected workspace requests to
`/sign-in` before page data loads. If only the publishable key is present, the
client still shows a friendly signed-out fallback, but middleware cannot verify
the session boundary. `/setup`, `/accept-invite`, `/sign-in`, `/sign-up`,
`/access`, `/onboarding/...`, and `/tenant-portal/...` stay public so first
setup, invite acceptance, tenant onboarding, and token-scoped tenant portal
links still work.

Xero provider connection needs the Xero OAuth redirect URI registered in the
Xero developer app exactly as configured in `XERO_REDIRECT_URI`. Generate
`XERO_TOKEN_ENCRYPTION_KEY` as a Fernet-compatible key and keep it stable; it is
used to encrypt stored Xero access and refresh tokens. Provider contact sync,
local mapping apply, invoice posting approval, draft invoice creation, and
payment reconciliation remain review-first workflows. No Xero invoice write runs
without explicit local approval and a valid provider connection.

## Render And Alembic Safety

Current Render API commands:

```bash
uv sync --frozen && uv cache prune --ci
.venv/bin/alembic upgrade head && .venv/bin/uvicorn apps.api.main:app --host 0.0.0.0 --port $PORT
```

Use the virtualenv executables in the start command because the build command
already creates `.venv`; this avoids re-resolving or recompiling dependencies
during instance startup.

The API deploy artifact must include `alembic.ini` and the full `migrations/`
tree. The Python wheel build is configured to force-include both so Alembic can
resolve every revision, including `20260520_0018`, after the service is installed
from a wheel. Run Alembic from the repository or extracted artifact root so the
existing `script_location = migrations` setting resolves to the bundled
`migrations/` directory.

Treat Alembic migrations and the API runtime as one release. If Render applies a
new migration and the deploy then falls back to an older service image or commit,
the older code may fail on startup because the database `alembic_version` points
at a revision that does not exist in that artifact. When production has advanced
to a new revision such as `20260520_0018`, recover by redeploying the same or
newer commit that contains that migration. Do not intentionally start an older
backend against the advanced database unless the database is first restored,
downgraded, or explicitly stamped to a revision that the older artifact contains.
