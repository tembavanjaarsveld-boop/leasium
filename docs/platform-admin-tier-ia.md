# Platform-Admin Tier — IA decision (2026-06-09)

## Problem

Leasium has one tenancy boundary today: the `Organisation` (the account a client
signs into — e.g. SKJ Property). Everything an operator can see and do is scoped
to their `Organisation`. But there is a level *above* the client that the product
needs and does not yet model: **Leasium itself** — the operator of the platform,
who onboards new clients (self-managed owners and, later, property managers),
sends them their first invite, and owns the deep platform configuration that all
clients depend on.

The Settings → **Integrations** panel is the immediate symptom. It shows a client
operator the configured/not-configured status of Xero, SendGrid, Twilio, OpenAI,
SerpAPI, and DocuSign, plus DocuSign setup packets and webhook endpoints. A client
(SKJ) should never be configuring platform-level provider plumbing — that is
Leasium's job, done once, inherited by every client. The panel is in the wrong
tier.

## The key realisation (changes the scope)

**The provider integrations are already global.** Every provider credential
(`XERO_CLIENT_ID`, `SENDGRID_API_KEY`, `TWILIO_*`, `OPENAI_API_KEY`,
`SERPAPI_API_KEY`, `DOCUSIGN_*`) lives as an **environment variable on the single
API service** (Render), not per-organisation. `GET /system/integration-status`
(`apps/api/routers/system.py`) only reads those env vars and returns booleans —
it deliberately returns **no secrets**. So "deep configs inherited by all clients"
is *already literally true*: there is one config, shared by every org.

What is missing is not a config-inheritance mechanism. It is:

1. A **platform-admin access tier** with its own logins, distinct from client
   operators.
2. **Client (organisation) provisioning + first-operator invites** driven from
   that tier (today only a one-shot "first workspace" bootstrap exists).
3. **Moving the Integrations surface up** into that tier and **hiding it from
   client orgs**.

This is a much smaller, lower-risk job than building a new multi-tenant
hierarchy, because the config layer it implies already exists.

## Decisions (confirmed 2026-06-09)

1. **Tenancy model — role/flag, no new table.** No `Platform` parent entity above
   `Organisation`. Platform admins are flagged `AppUser`s reachable on
   platform-scoped routes. Matches the single-deployment reality; trivial to
   extend later if Leasium ever hosts multiple independent platforms.
2. **Credentials stay env vars in Render.** The platform-admin surface *displays*
   setup status and setup packets (the existing DocuSign packet pattern) and
   *manages clients*; actual secrets remain Render env vars. Preserves the
   `CLAUDE.md` §2.1 guardrail and the "no secrets returned" contract. No
   encryption/rotation/secret-store surface to build.
3. **Login — same Clerk, elevated privilege.** One Clerk instance. Platform admins
   are flagged accounts that can reach an `/admin` surface; client operators
   cannot. No separate auth infrastructure.
4. **Design doc first.** This document, reviewed before code lands.

## What we already have (no new core model needed)

- `Organisation` (`stewart/core/models.py:313`) — the client account/login
  boundary. Carries `operating_mode`.
- `AppUser` (`:554`) — operator, FK `organisation_id` (NOT NULL), unique `email`,
  optional `auth_provider_id` (Clerk subject), invite lifecycle fields.
- `UserEntityRole` — per-entity roles (`owner|admin|finance|ops|viewer|agent`).
  Security management is gated on `owner`/`admin` within the operator's own org
  (`apps/api/routers/security.py` → `_can_manage_security`).
- `CurrentUser` (`stewart/core/auth.py:22`) — resolved per request via dev auth
  (`_dev_user`) or the Clerk adapter (`_clerk_user`); carries `id`,
  `organisation_id`, `email`, `display_name`, `actor`.
- **First-workspace bootstrap** (`security.py` → `create_first_workspace`) —
  creates the *first* org + owner, then **closes permanently** once any workspace
  data exists. There is no way to provision a *second* client today.
- `GET /system/integration-status` — global env-var status, gated only on
  `get_current_user` (any authenticated operator can read it).

## The model

### A reserved platform organisation + a flag

Add a nullable-default boolean **`AppUser.is_platform_admin`** (`server_default
false`). Platform admins are normal `AppUser` rows with this flag set.

To avoid making `organisation_id` nullable (which would ripple through dozens of
org-scoped queries), platform admins belong to a single **reserved system
organisation** — "Leasium Platform" — that holds **no entities and no
properties**. Their privilege comes from the flag, not from that org's data. The
admin surface is org-agnostic: a platform admin acts *across* all client orgs, not
inside the reserved one.

Rationale: "role/flag, no new table" with a reserved org is the least invasive
shape. It reuses every existing invite/Clerk-link/audit path for platform admins,
and keeps `organisation_id` NOT NULL.

### Threading the flag

- `CurrentUser` gains `is_platform_admin: bool`. `_clerk_user` reads it from the
  `AppUser` record; `_dev_user` reads a new settings flag
  `dev_is_platform_admin` (so the dev identity can act as platform admin locally).
- A new dependency **`require_platform_admin`** (alongside the existing
  `require_entity_role`) returns 403 for any non-platform operator.

### Keep platform-admin and client logins separate

Per the "its logins" intent: a platform admin should be a **distinct login** from
a client operator, even though they share the Clerk instance. Recommended:
provision a dedicated platform-admin operator (separate email) under the reserved
org. Temba can hold both a SKJ client login and a Leasium platform-admin login.
(One Clerk account *could* carry the flag, but two logins keeps the audit trail
and the mental model clean — and is what "no properties managed there" implies.)

## What moves, and how

### 1. Integration surface moves up

- `GET /system/integration-status` (and any DocuSign setup-packet endpoints) get
  re-gated from `get_current_user` → **`require_platform_admin`**. Client
  operators receive 403.
- Frontend: the `IntegrationsHealthCard` is **removed from client Settings** and
  **rendered only under `/admin`**. Client orgs lose the panel entirely.

### 2. Client provisioning from the admin tier

- New **`POST /platform/organisations`** (platform-admin only): create a client
  `Organisation` + invite its first operator (owner), reusing the existing
  `_send_operator_invite` machinery. This generalises the one-shot bootstrap into
  a repeatable, access-gated flow.
- New **`GET /platform/organisations`**: list client orgs with operator counts /
  invite status for the admin console.
- **Client lifecycle (suspend/restore).** `PATCH /platform/organisations/{id}`
  toggles a client `Organisation` between active and suspended. Suspended is a
  reversible, audited state — it does not delete data; it blocks the org's
  operators from authenticating (the auth resolver rejects a login whose org is
  suspended) and is clearly surfaced in the admin list. Restore re-enables it.
- **Cross-org operator management.** A platform admin can manage operators inside
  *any* client org, not just provision the first one: list a client's operators,
  invite/add additional operators, **resend** a pending invite, and disable an
  operator. These reuse the existing per-org security machinery
  (`_send_operator_invite`, member create/update, `_replace_roles`) but with the
  org taken from the route (`/platform/organisations/{id}/members…`) and gated on
  `require_platform_admin` instead of in-org owner/admin. Self-deactivation guards
  do not apply (a platform admin is acting *on* the client org, not within it).
- The legacy single-shot `create_first_workspace` stays only for **the very first
  platform-admin's own setup** (or is superseded by a seeded reserved org +
  platform admin). Decide during Wave 1 — see open questions.

### 3. `/admin` surface (frontend)

A new route group, visible only when `is_platform_admin`. Two jobs, no property
management:

- **Clients** — list/provision client orgs, send first-operator invites, see
  invite/login status, **suspend/restore a client**, and drill into a client to
  **manage its operators** (add/invite, resend invite, disable).
- **Platform integrations** — the relocated Integrations health card + DocuSign
  setup packet, read-only status over Render env vars.

Nav gating: client operators never see `/admin`; platform admins see `/admin` and
(if they also hold a client login) keep that separate.

## Guardrails preserved

- **§2.1 provider mutation rule is untouched.** Moving the *status display* up a
  tier changes nothing about sends; no Xero write, SendGrid email, Twilio SMS,
  tenant email, or payment reconciliation fires without explicit operator
  approval. The admin tier still only *shows* configured/not-configured.
- **No secrets in responses.** The relocated endpoint keeps returning booleans +
  missing-var names + bare webhook URLs only.
- **Audit.** Org provisioning and invites from the platform tier write
  `audit_log` rows (`actor = user:<platform-admin-email>`), same as today's
  member invites.

## Edge cases

- **A platform admin who is also a client operator.** Two `AppUser` rows / two
  logins (recommended), or one row with both the flag and a real client org.
  Keep them separate for SKJ.
- **The reserved platform org must never grow properties/entities.** Guard:
  provisioning UI and the property/entity creation paths refuse the reserved org;
  it is config-and-clients only.
- **Bootstrap collision.** Once the reserved org + first platform admin exist, the
  legacy "first workspace" bootstrap must stay closed; platform provisioning takes
  over. Wave 1 reconciles the two.
- **403 vs 404 for client operators hitting `/admin` APIs.** Return 403 (authn
  ok, authz denied), consistent with `_assert_can_manage_security`.

## Build plan (bite-sized, TDD-shaped — verify before claiming done)

Each ticket: failing test first, then make it pass. Backend `ruff` + `pytest` on
Temba's Mac (sandbox can't run them); frontend `eslint`/`tsc`/Playwright smoke in
the sandbox. Mock all providers.

1. **Platform-admin flag + gate.** Add `AppUser.is_platform_admin` (Alembic
   migration, `server_default false`); seed a reserved "Leasium Platform" org +
   one platform-admin operator. Thread `is_platform_admin` through `CurrentUser`
   (`_clerk_user` from the row, `_dev_user` from new `dev_is_platform_admin`
   setting). Add `require_platform_admin`. Reconcile with the legacy bootstrap.
   → verify: model/migration up-down; dependency returns 403 for a non-admin and
   passes for an admin; dev-flag test.
2. **Re-gate the integration surface.** `GET /system/integration-status` (+
   DocuSign packet endpoints) → `require_platform_admin`. Client operator gets
   403; platform admin gets the status payload.
   → verify: backend test for both the 403 and the 200 path.
3. **Client provisioning + management API.** Platform-admin gated, audited,
   provider-mocked invites throughout:
   - `POST /platform/organisations` (create org + invite first operator) and
     `GET /platform/organisations` (list with operator/invite status).
   - `PATCH /platform/organisations/{id}` — **suspend/restore** a client; the auth
     resolver rejects logins for a suspended org.
   - `GET/POST/PATCH /platform/organisations/{id}/members…` — **cross-org operator
     management**: list, add/invite, **resend invite**, disable an operator in any
     client org (route-supplied org; reuses `_send_operator_invite` + member
     create/update; no in-org self-guards).
   → verify per endpoint: happy-path + 403 (non-admin); suspend test asserts a
   suspended org's operator can no longer authenticate and restore reverses it;
   resend asserts a new invite token/delivery (mocked); audit rows asserted for
   create, suspend/restore, invite, and disable.
4. **`/admin` frontend surface.** New route group gated on `is_platform_admin`:
   Clients (list/provision/invite) + relocated Integrations health card + DocuSign
   packet. **Remove** the Integrations panel from client Settings. Nav gating.
   → verify: smoke fixture for a platform-admin session (admin visible, clients
   list, integrations present) and a client session (no `/admin`, no integrations
   panel in Settings). *(Design-facing — prototype mode; log a
   `docs/design-governance.md` follow-up.)*
5. **Docs.** Update `docs/product-roadmap.md` (built + next), `docs/deployment.md`
   (reserved-org seed + platform-admin setup), `docs/next-chat-handover.md`, and a
   `docs/design-governance.md` follow-up for the moved surface.

Waves 1–3 are pure backend/access and carry the real risk; Wave 4 is the visible
move; Wave 5 is documentation.

## Open questions for Wave 1

- **First platform admin: seed or bootstrap?** Seed the reserved org + Temba's
  platform-admin login via migration/script, or repurpose the existing
  `create_first_workspace` to mint the platform admin first? (Recommend: seed via
  script, retire the public bootstrap.)
- **Does Temba want one Clerk account flagged, or a separate platform-admin
  email?** (Recommend: separate email — cleanest audit + matches "its logins".)
- **`/admin` URL shape now vs later.** Same app under `/admin` now (decided:
  same Clerk). A future `admin.leasium.ai` split stays possible without data-model
  change.

## Status

Decision recorded 2026-06-09. Prototype mode — the `/admin` UI surface and the
removal of the client Settings Integrations panel are design-facing and
**Remba-pending by default** per the current `docs/design-governance.md` stance
(logged there). Provider guardrail unchanged (`CLAUDE.md` §2.1).

**Shipped to production 2026-06-09 (Waves 1–4, prototype mode).** Commits
`c2e11ea` (tier) + `edaa3df` (seed `operating_mode` fix) + `082bfdd` (`/me`
`is_platform_admin` fix) on `main`; Render API + Vercel frontend deployed;
migration `20260609_0041` applied to Neon; seed run once. Suspension modelled as
`Organisation.suspended_at` (NULL = active), with `is_active` derived in the API; a
suspended org's operators are rejected at the Clerk auth resolver. Provisioning
intentionally does **not** set `operating_mode` (new clients default to
`self_managed_owner`, changeable in their own Settings) — a provision-time picker
is an easy follow-up.

**Admin-login decision (resolved live).** The separate `platform-admin@leasium.ai`
identity had no Clerk account/mailbox, so the existing **`temba@skjcapital.com`**
operator account was granted `is_platform_admin=true` directly in prod. The seeded
`platform-admin@leasium.ai` row is inert (no Clerk login). Confirmed `/admin`
renders for the flagged login end-to-end.

**Two integration gaps caught post-deploy (both fixed):** (1) the seed relied on a
model-only `operating_mode` server_default the prod column lacked → NOT NULL
violation; (2) `/me` never emitted `is_platform_admin` (the frontend gate reads it)
because the schema/builders didn't carry it — smoke passed only because the mock
supplied it. Lesson: when a frontend consumes a new response field, assert the
*real* endpoint emits it, not just the smoke mock.

Verification:

- Backend: `ruff` clean on all changed files; `pytest` **607 passed, 1 skipped**
  (the skip is the Postgres-only migration test — `TEST_DATABASE_URL` unset in
  this session; run the up/down on the next Neon/Mac pass). Single clean Alembic
  head `20260609_0041`.
- Frontend: `eslint` + `tsc` clean; Playwright smoke green — `platform-admin.spec`
  (3) + `settings.spec` (7) all pass after reconciling the API contract drift and
  moving the integration-status assertion out of the client Settings spec.

Migration `20260609_0041` (adds `app_user.is_platform_admin` + `organisation.
suspended_at`) must run on Neon/Render before this deploys.
