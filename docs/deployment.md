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
onboarding links under `/onboarding/...` remain accessible without the password.

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

Operator invite delivery also uses the SendGrid key/from settings above. Invite
links point to `/accept-invite?token=...`; the raw token is sent once by email,
while only a hash is stored in the database. Keep `AUTH_MODE=dev` until at least
one owner/admin operator has accepted an invite and is linked to a Clerk user.

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
resolve every revision, including `20260520_0015`, after the service is installed
from a wheel. Run Alembic from the repository or extracted artifact root so the
existing `script_location = migrations` setting resolves to the bundled
`migrations/` directory.

Treat Alembic migrations and the API runtime as one release. If Render applies a
new migration and the deploy then falls back to an older service image or commit,
the older code may fail on startup because the database `alembic_version` points
at a revision that does not exist in that artifact. When production has advanced
to `20260520_0015`, recover by redeploying the same or newer commit that contains
that revision. Do not intentionally start an older backend against the advanced
database unless the database is first restored, downgraded, or explicitly stamped
to a revision that the older artifact contains.
