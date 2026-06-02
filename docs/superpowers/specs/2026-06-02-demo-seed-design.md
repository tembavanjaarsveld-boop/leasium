# Fictional AU Demo Seed Design

## Purpose

Local browser runs should prove more than layout frames. Add an on-demand,
fictional AU-realistic demo portfolio that exercises Leasium's main operator
surfaces with coherent data while keeping the existing minimal local seed intact.

## Goals

- Create a repeatable demo portfolio for `http://127.0.0.1:3000`.
- Use fictional Brisbane commercial-property names and contacts suitable for
  screenshots, demos, and manual QA.
- Cover cross-surface workflows: dashboard, properties, people, work, money,
  billing readiness, statements, onboarding/portal-adjacent reads, and insights.
- Keep provider integrations inert: no Xero, Basiq, SendGrid, Twilio, payment,
  reconciliation, or external document calls.
- Make reruns safe by matching existing records and tagging demo rows with
  metadata such as `{"demo": true, "demo_seed": "fictional_au_v1"}`.

## Non-Goals

- Do not import real SKJ portfolio data.
- Do not reset, truncate, or overwrite non-demo local data by default.
- Do not create a frontend-only fake mode. The point is realistic API-backed
  local data.
- Do not make production/staging seeding automatic.

## Demo Story

The demo organisation is `Harbour Lane Property Group`, with a primary entity
`Rivergum Property Holdings Pty Ltd`. The portfolio includes a small Brisbane
commercial mix:

- `Kingfisher Retail Arcade`, Brisbane City: mixed retail tenancies with one
  upcoming rent review and one billing readiness blocker.
- `Moorooka Trade Warehouse`, Moorooka: logistics tenant, maintenance work, and
  recoverable outgoings.
- `Newstead Creative Offices`, Newstead: one active office lease plus one vacant
  suite to keep occupancy/insights meaningful.

People records include tenants, owner/trust structures, billing contacts, and
contractors for electrical, plumbing, and HVAC work. The data should contain a
few realistic imperfections: missing Xero mapping, expiring insurance, one
arrears case, one maintenance item awaiting review, and one statement dispatch
example for the managing-agent mode.

## Architecture

Add `scripts/seed_demo.py` as a separate idempotent seeder. It reuses the same
database/session/model layer as `scripts/seed.py`, but builds a richer demo
graph. The Makefile gets a `demo-seed` target that only runs the seeder; docs
tell local operators to run migrations first.

Because development auth resolves the current organisation from
`settings.dev_organisation_id`, the demo seeder uses that local-only
organisation id and renames it to `Harbour Lane Property Group` when explicitly
run. This keeps the demo visible in the normal localhost app without adding a
multi-organisation switcher.

The seeder should expose small helpers for get-or-create by stable natural keys:
organisation name, entity name, property name within entity, unit label within
property, tenant legal name within entity, contractor name within entity, and
lease tenant/unit pair. Demo metadata marks records it creates or updates.

If existing demo rows are found, the script updates safe descriptive fields and
adds missing related records. It does not delete rows. A future `--reset-demo`
flag can archive demo rows, but that is outside this first implementation.

## Data Flow

1. Ensure demo organisation, dev user, and entity access role exist.
2. Ensure properties and tenancy units exist.
3. Ensure owner-style property billing fields and owner records/links exist
   where the current model supports them.
4. Ensure tenants and active/vacant lease scenarios exist.
5. Ensure charge rules, obligations, billing drafts/readiness blockers,
   maintenance work orders, arrears cases, contractors, and stored documents are
   present where those models already exist.
6. Commit the database transaction once and print a concise summary of
   created/updated counts.

## Error Handling

The script should fail fast on schema/model errors and never soft-hide them. It
should print a clear summary for local operators. It should not call provider
clients or require provider credentials.

## Testing

- Add a backend integration test that runs the demo seed against the test
  database and verifies representative records exist across properties, people,
  work, and money.
- Keep the seeder idempotency under test by running it twice and checking counts
  do not duplicate the core graph.
- Add or update one smoke path only if needed to prove the local demo data makes
  the browser-visible app exercise real rows instead of empty frames.

## Implementation Notes

- Prefer existing model constructors and local helpers over a new fixture
  framework.
- Keep fictional names stable so screenshots and tests are reproducible.
- Update `README.md`, `Makefile`, `docs/product-roadmap.md`, and
  `docs/next-chat-handover.md` with the new local demo flow.
