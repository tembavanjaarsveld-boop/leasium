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
NEXT_PUBLIC_API_BASE_URL=https://your-api-host.example.com/api/v1
LEASIUM_ACCESS_PASSWORD=choose-a-temporary-private-beta-password
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
```

`LEASIUM_ACCESS_PASSWORD` enables the temporary app-level password gate for the
main Leasium workspace. It is a light private-beta screen only; public tenant
onboarding links under `/onboarding/...`, tenant portal links under
`/tenant-portal/...`, operator login pages, invite acceptance, and first
workspace setup under `/setup` remain accessible without the password.

The web app is only the frontend. The FastAPI backend still needs a separate host.

## API Host

Set the API host environment from `.env.example`, with production values for:

- `DATABASE_URL`
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

`FRONTEND_URL` must match the Vercel domain so browser requests pass CORS.
`PUBLIC_API_URL` must match the hosted API origin so Twilio SMS callbacks can
report delivery status back into Leasium.
Use `CORS_ALLOWED_ORIGINS` for extra explicit domains, separated by commas. Use
`CORS_ALLOWED_ORIGIN_REGEX` only for controlled preview URL patterns.

Tenant onboarding delivery uses Twilio SendGrid for email and Twilio Messaging
for SMS. If any channel is not configured, Leasium records the channel as
skipped rather than blocking onboarding link creation.
Set Twilio SMS status callbacks and SendGrid Event Webhook URLs to the hosted
`/api/v1/tenant-onboarding/webhooks/...` endpoints using the shared webhook
secret so Leasium can show sent, delivered, opened, and failed receipts.

**DocuSign integration (scaffolded, not yet wired to real sends).** When the
DocuSign developer account is provisioned, set on the API service:

- `DOCUSIGN_ACCOUNT_ID` — DocuSign Account GUID
- `DOCUSIGN_INTEGRATION_KEY` — Integration Key from the DocuSign console
- `DOCUSIGN_USER_ID` — User GUID for the JWT grant (operator service account)
- `DOCUSIGN_RSA_PRIVATE_KEY` — full PEM-encoded RSA private key
- `DOCUSIGN_BASE_URL` (optional) — overrides the demo `https://demo.docusign.net/restapi`; production is `https://www.docusign.net/restapi`
- `DOCUSIGN_AUTH_BASE_URL` (optional) — overrides the demo auth host
- `DOCUSIGN_WEBHOOK_SECRET` (optional) — shared secret for verifying Connect webhook signatures

Until all four required values are set, `stewart.integrations.docusign.send_lease_for_signature` returns `status="skipped"` with a clear `not_configured` error and never calls DocuSign. The shape of the dataclasses (`LeaseSignatureRequest`, `LeaseSignatureResult`) matches the SendGrid `DeliveryResult` pattern so the operator-facing receipt surface can render the same way once the real envelope-create + Connect-webhook plumbing lands in the next slice.

**Inbound email parsing (SendGrid Inbound Parse).** Leasium accepts inbound
emails through `POST /api/v1/comms/webhooks/sendgrid-inbound?entity_id=<uuid>`.
To wire this up: (1) add an MX record on a subdomain you control
(e.g. `inbound.leasium.example.org`) pointing to `mx.sendgrid.net`;
(2) in the SendGrid console, add an Inbound Parse setting that maps the
subdomain to `https://<API_HOST>/api/v1/comms/webhooks/sendgrid-inbound?entity_id=<UUID>`
with the SendGrid "POST the raw, full MIME message" option **off**
(Leasium parses the form fields); (3) repeat with one Inbound Parse setting
per entity so each operator portfolio gets a dedicated mailbox.
The webhook is provider-only (unauthenticated) but verifies the entity
exists before persisting; a future hardening pass should verify the
SendGrid signature header. Inbound messages land in the `inbound_message`
table and surface in the operator comms queue as `inbound_email`
candidates the operator reviews and replies to via the existing
dispatch path.

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
scheduler calls. Notification-center responses must not expose webhook secrets,
provider API tokens, or tokenized callback URLs.

Operator invite delivery also uses the SendGrid key/from settings above. Invite
links point to `/accept-invite?token=...`; the raw token is sent once by email,
while only a hash is stored in the database. On a clean production database,
use `/setup` after Clerk is configured to create the first organisation, entity,
and owner operator from a signed-in Clerk session. Keep `AUTH_MODE=dev` for an
existing seeded workspace until at least one owner/admin operator has accepted an
invite and is linked to a Clerk user.

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
