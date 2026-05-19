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
```

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
