# Slice Spec — Migrate existing tenants into the portal without re-onboarding

Date: 2026-06-24
Author: Temba (operator)
Status: Built + verified (backend), not yet committed. Decisions taken: review_data JSON marker (no DB migration), dedicated POST /tenant-onboarding/migrated, reuse existing login-centric portal-invite copy, leases imported as active. Shared logic in stewart/domain/tenant_migration.py. Verified: ruff clean (changed + full), pytest 105 passed (onboarding + portal suites). Deferred (UX gate): operator "Send portal invite" button for migrated applied rows.
Deadline driver: migrate ~25 live tenants by 2026-08-16

---

## 1. Goal & success criteria

Migrate ~25 existing tenants (live leases, already onboarded in the real
world) into Leasium and give each a working tenant-portal login **without
routing them through the confirm-your-details onboarding wizard**.

Done when:

1. An operator can create a tenant onboarding row directly in `applied`
   state, with operator attribution and a migration provenance marker,
   **provider-inert** (no email/SMS/Xero fired).
2. An operator can send that tenant a portal **login link** (an explicit,
   approved action).
3. The tenant signs in with Clerk, claims the account, and lands **directly
   in the working portal** — no confirm/submit wizard.
4. Account-only re-entry works thereafter (no token needed).
5. Backend + smoke tests cover the happy path plus an error/auth path;
   all providers mocked.

## 2. The two mechanisms (why this is small)

"Onboarding" means two separable things in the code:

- **Login bootstrap (unavoidable, not a wizard).** The only way to link a
  tenant record to a login is the token-claim flow: tenant gets a link, signs
  in with Clerk, and `TenantPortalAccount` is created against the onboarding
  row (`tenant_portal.py:claim_tenant_portal_account` @1784). You cannot
  pre-create the link — the Clerk identity only exists at sign-in. So every
  migrated tenant needs a token-bearing onboarding row as the invite vehicle.
- **The confirm-your-details wizard (what we suppress).** The tenant submit
  path is gated on `onboarding.status == "sent"`
  (`tenant_portal.py:submit_tenant_portal_onboarding` @2231). If the row is
  already `applied`, submit returns 409 and the frontend renders a benign
  read-only panel instead of the form
  (`tenant-portal-content.tsx`: `editable = status === "sent"` @2914;
  applied → "Applied. Your contact details are now confirmed" @2981-2995).

So the whole slice is: **create the onboarding already `applied`, then send a
login link.** Claim, account-link, account-only entry, and the wizard gate all
already behave correctly for `applied` — no change needed there.

## 3. Out of scope (surgical)

- The normal review-first flow (create → sent → submit → review → apply) stays
  untouched.
- Smart Intake / register import behaviour unchanged.
- Claim, account linking, account-only entry, revoke/restore/unlink: no change.
- The `status == "sent"` wizard gate: kept exactly as-is (it is what hides the
  wizard).
- No payments work (parked). No Xero write. No new owner/entity work.

## 4. Backend changes

### B1 — New migrated-onboarding create endpoint
File: `apps/api/routers/tenant_onboarding.py`
Route: `POST /tenant-onboarding/migrated`
Schema: new `TenantOnboardingMigratedCreate` in
`apps/api/schemas/tenant_onboarding.py` (`lease_id: UUID`, optional
`due_date`, `expires_at`).

Behaviour (mirrors `create_tenant_onboarding` @1586 but lands `applied`):

- `_lease_scope(lease_id)` → lease, prop, tenant; `assert_entity_role(...WRITE_ROLES)`.
- Dedupe: if a non-cancelled onboarding exists for (lease, tenant), return it
  (same guard as @1594-1603).
- Create `TenantOnboarding` with:
  - `status = applied`
  - `token = _new_token(session)`
  - `submitted_data = {}` (the tenant record is already authoritative from
    Smart Intake import — see B-note)
  - `review_data = {"origin": "migration", "migrated_by_user_id": <user>, "note": "Confirmed from existing lease at migration; tenant confirmation not required."}`
  - `submitted_at = reviewed_at = applied_at = now`
  - `reviewed_by_user_id = applied_by_user_id = user.id`
  - `delivery_data = {}`, `last_sent_at = None`
- `audit_log(action="migrate", target_table="tenant_onboarding", ...)`.
- **Do NOT call `_apply_submission`** — that copies `submitted_data` onto the
  tenant; here the tenant row already holds the imported lease data and must
  stay the source of record.
- **Provider-inert**: no invite send in this endpoint.
- Return `_read(onboarding)`.

### B2 — Allow a portal invite for migrated `applied` rows
File: `apps/api/routers/tenant_onboarding.py`,
`send_tenant_onboarding_portal_invite` @2093.

Today the guard is `if onboarding.status != sent: 409` (@2107). Change to:

```
if onboarding.status == sent:
    pass
elif onboarding.status == applied and _is_migration_onboarding(onboarding):
    pass
else:
    raise 409 "Only sent or migrated onboarding rows can receive a portal invite."
```

- Keep the expiry check (@2112) and the existing token-rotation-on-consumed
  block (@2118-2121) — it already lets a migrated link be re-sent safely.
- Reuses `_deliver_portal_invite` (@1173) unchanged → same SendGrid template,
  same `delivery_data['portal_invite']` receipts and audit.
- Still operator-triggered = explicit approval (guardrail satisfied).

### B3 — Provenance helper
`_is_migration_onboarding(onboarding)` → `review_data.get("origin") == "migration"`.

### No DB migration
Provenance rides in the existing `review_data` JSON column
(`models.py:1379`). Avoids a hosted Neon/Render migration for a one-off-ish
feature. (Decision 1 below: promote to a typed column later if we want it
first-class.)

## 5. Frontend changes

**Expected: none required.** Verified that `applied` already renders the
working portal with a read-only "Applied" panel and no confirm form
(`tenant-portal-content.tsx` @2914, @2981-2995).

Must-verify (not assumed):

- A migrated `applied` row shows **no "sign lease agreement" CTA**. The
  sign/lease-pack flow only arms `lease_agreement` via `send-lease-pack` /
  `activate-lease`, which migration never calls, so the section should stay
  neutral. Confirm in the smoke fixture; if a prompt leaks, suppress it for
  migration-origin rows in a follow-up.

Optional polish (design-facing → UX gate, §2.2): a migration-specific invite
template and/or an "Applied (migrated from your existing lease)" panel line.
Not required for function; the existing portal-invite copy is already
login/claim-centric, not "confirm your details".

## 6. Provider guardrail compliance (§2.1)

- B1 migrated create: provider-inert, no send.
- B2 invite send: explicit operator action, SendGrid mocked in tests. The
  25-tenant batch is an explicit operator-approved send.
- No Xero, SMS, tenant email, or reconciliation fired without approval.

## 7. Data prerequisites & gotchas

- **Emails must match.** Claim verifies the tenant's Clerk sign-in email
  against the tenant's contact/billing email. Run an email-quality pass on the
  25 before sending, or claims bounce.
- **Lease status.** Smart Intake defaults leases to `pending`; set live
  tenancies to `active` (case-by-case `holding_over`/`expired` where true).
- **Don't** run `send-lease-pack` / `activate-lease` for migrated tenants —
  keeps the lease-signing flow dormant.

## 8. Bulk migration script

`scripts/migrate_existing_tenants.py` (or a documented API sequence):

1. For each `lease_id`: `POST /tenant-onboarding/migrated`.
2. Print token + claim URL per tenant; idempotent via the dedupe guard.
3. `--send` flag (default off) triggers the invite per row — explicit approval.
4. Dry-run on one real tenant end-to-end before batching the rest.

Follow the provider-inert convention used by `make demo-seed`.

## 9. Tests (§2.8)

Backend — `tests/integration/test_tenant_onboarding_api.py` +
`tests/integration/test_tenant_portal_api.py`:

- migrated create → `applied`, `review_data.origin == "migration"`, token
  present, tenant row unchanged, no provider call.
- send invite for migrated `applied` → 200, receipt recorded (SendGrid
  mocked).
- send invite for a non-migration `applied` row → still 409 (guard stays
  tight).
- claim against migrated `applied` → `TenantPortalAccount` active,
  `token_consumed_at` set.
- tenant submit against `applied` → 409 (wizard stays closed).
- non-operator → 403; email-mismatch claim → rejected.

Frontend smoke — `apps/web/tests/smoke/app-flows.spec.ts` + `api-mocks.ts`:

- fixture: portal with a migrated `applied` onboarding → working portal
  renders, no confirm form, no sign CTA; account-only entry path works.
- Run with `NODE_ENV=development` (prod mode crash-loops the smoke webServer).

## 10. Verification plan (before "done")

- Backend (Mac/Desktop Commander): `ruff check` touched files;
  `pytest tests/integration/test_tenant_onboarding_api.py tests/integration/test_tenant_portal_api.py -q`.
- Frontend: `eslint src`, `tsc --noEmit`, smoke, `next build`
  (`NEXT_TEST_WASM_DIR=...`, `NODE_ENV=development`).
- Live `/tenant-portal` route sanity.
- **End-to-end dry run:** migrate one real tenant → send link → claim with a
  test Clerk login → confirm working portal, no wizard. Then batch the rest.

## 11. Rollout for the 25

1. Email-quality pass on tenant contact/billing emails.
2. Smart Intake import leases (set `active`), review + apply.
3. Run migrated-create for each.
4. Operator review of the batch.
5. Explicit send of login links.
6. Track claims (account active) and chase stragglers before 2026-08-16.

## 12. Docs to update on ship (§2.7)

`product-roadmap.md` (built + next), `deployment.md` (migration runbook),
`next-chat-handover.md`; `design-governance.md` only if any UX copy lands
(then add a UX pass log line).

## 13. Decisions for you

1. **Provenance:** `review_data` JSON marker (no migration — recommended) vs a
   first-class column.
2. **Create surface:** dedicated `POST /tenant-onboarding/migrated`
   (recommended, keeps normal create pristine) vs a flag on the existing
   create endpoint.
3. **Invite copy:** reuse the existing portal-invite template (recommended —
   already login-centric) vs a migration-specific variant (UX gate).
4. **Lease status on import:** blanket `active` vs case-by-case.

## 14. Effort

Small slice: B1+B2+B3 are ~1 endpoint, 1 guard change, 1 helper, 1 schema;
plus tests and the script. Roughly half a day to a day with the verification
pass and the one-tenant dry run.
