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
