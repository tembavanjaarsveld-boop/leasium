# Leasium

Leasium is an AI-native lease operations platform for multi-entity Australian property portfolios. It turns lease documents into structured property, tenant, lease, obligation, onboarding, and billing-readiness records with review before anything is committed.

The living product roadmap is tracked in [docs/product-roadmap.md](docs/product-roadmap.md).
Design-facing changes require Remba UX sign-off, tracked in
[docs/design-governance.md](docs/design-governance.md).
Deployment notes are tracked in [docs/deployment.md](docs/deployment.md).

## Quick Start

```bash
cp .env.example .env
make install
docker compose up -d
make migrate
make seed
make dev
```

The API runs on `http://localhost:8000` and the web app runs on `http://localhost:3000`.
Lease intake extraction reads `OPENAI_API_KEY` from `.env.local` or `.env` and uses
`OPENAI_MODEL` for the direct Responses API call.
Tenant onboarding delivery reads `SENDGRID_*` and `TWILIO_*` settings for email
and SMS. Missing communication credentials are recorded as skipped delivery
states so local development can still create onboarding links. `PUBLIC_API_URL`
and `COMMUNICATIONS_WEBHOOK_SECRET` enable delivery receipts from Twilio SMS
callbacks and SendGrid Event Webhooks.

## Deployment

Vercel should deploy the frontend from `apps/web`. Set
`NEXT_PUBLIC_API_BASE_URL` in Vercel to the hosted API base URL. The FastAPI API
is deployed separately and must set `FRONTEND_URL` to the Vercel domain.

## Make Targets

- `make install` installs backend and frontend dependencies.
- `make migrate` applies Alembic migrations.
- `make seed` creates local sample data.
- `make dev` runs the API and web app together.
- `make test` runs the Python test suite.
- `make lint` runs backend and frontend lint checks.
- `make format` formats backend and frontend files.

## Modules

- Foundation: organisation, entity, property, tenancy unit, tenant, lease, obligation, charge rule, and tenant onboarding records with entity-scoped auth and audit logging.
- Lease intake: upload a bounded PDF/text lease file, extract setup data with OpenAI,
  poll for the review result, match existing property/unit/tenant records, then
  apply the intake into lease and obligation records.
- Tenant onboarding: create a public onboarding link from a lease, let the tenant confirm contact, billing, insurance, and emergency details, then update the tenant record.
- Billing readiness: maintain recurring rent/charge rules and inspect rent roll rows for invoice, GST, and Xero blockers before invoice generation is built.
- Dashboard and registers: `/` focuses on quick actions, attention items, events, onboarding, and billing updates; `/insights` shows live portfolio health and exceptions; `/properties` holds property/lease operations; `/tenants` holds tenant search and contact/billing management.

## Auth Modes

`AUTH_MODE=dev` uses deterministic local user settings from `.env` and is the default for local development and tests.

`AUTH_MODE=clerk` keeps the adapter boundary in place for Clerk verification. Real Clerk verification is intentionally minimal in Phase 0 and should be hardened before staging access.
