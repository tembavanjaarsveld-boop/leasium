# Vendor portal authenticated login

Date: 2026-06-02
Roadmap: DoorLoop refocus P2 — "Vendor portal (contractors log in, accept jobs,
post updates/photos)". Builds on the shipped read-only operator preview
(`GET /api/v1/vendor-portal/{contractor_id}`) and the operator share/unshare
controls. Mirrors the owner portal account auth flow (`apps/api/routers/owner_portal.py`).

## Goal

Let a contractor sign in (Clerk) and self-serve on the maintenance jobs an
operator has explicitly shared to them: see the job, **accept** it, **post an
update**, and **attach a photo** — without exposing tenant identity, internal
notes, provider receipts, or payment data, and without firing any provider call.

## Non-goals (this slice)

- No contractor email/SMS invite send (invite link is created locally, no-send —
  same as owner portal). The operator copies/sends it out of band for now.
- No contractor-initiated status change to `completed`/`cancelled` (operator keeps
  closeout authority). "Accept" may only advance `assigned`/`approved` → `in_progress`.
- No quoting/pricing edits, no invoice creation, no Xero/Basiq/SendGrid/Twilio.
- No operating-mode gate. Unlike owners (a third-party client, managing-agent only),
  contractors are relevant to self-managed and managing-agent operators alike.

## Data model (mirror OwnerPortalInvite / OwnerPortalAccount)

New enum `VendorPortalAccountStatus(active, revoked)`.

`VendorPortalInvite`: id, entity_id→entity, contractor_id→contractor, token_hash
(sha256, unique partial idx where not deleted), claim_email, expires_at, consumed_at,
revoked_at, created_by_user_id→app_user, invite_metadata (jsonb "metadata"),
timestamps, deleted_at. Entity/contractor indexes where not deleted.

`VendorPortalAccount`: id, entity_id, contractor_id, vendor_portal_invite_id,
auth_provider ("clerk"), auth_provider_id, email, status, linked_at, last_seen_at,
revoked_at, account_metadata (jsonb "metadata"), timestamps, deleted_at.
Unique partial indexes (shared-login guard):
- `(auth_provider, auth_provider_id, contractor_id)` where active & not revoked/deleted
- `(auth_provider, auth_provider_id)` where active & not revoked/deleted

Relationships are one-sided (`contractor`/`entity` via `relationship()` with no
back_populates) to avoid editing the broadly-used Contractor/Entity classes.

Migration `20260602_0035_vendor_portal_accounts.py` (down_revision `20260602_0034`),
cloned from `20260531_0030_owner_portal_accounts.py` with contractor FK.
Test DB builds from `Base.metadata.create_all`, so backend tests don't need the
migration; deploy/hosted (Neon/Render) does.

## Endpoints (added to `apps/api/routers/vendor_portal.py`)

Auth (mirror owner portal exactly):
- `POST /vendor-portal/{contractor_id}/invite` — operator (owner/admin/ops),
  requires contractor.email, creates hashed local invite, returns plaintext token +
  `/vendor-portal/invite/{token}` claim_url. No send.
- `GET /vendor-portal/invites/{token}/preview` — public safe context
  (vendor display name, claim_email, expires_at, claimable).
- `POST /vendor-portal/account/claim` — Clerk bearer + portal_token; email-match,
  consumed/410, shared-login/409 (+ IntegrityError rollback retry), revoked/403.
  Returns the bearer session payload.
- `GET /vendor-portal/account/status` — bearer lifecycle (active/revoked/unlinked).
- `GET /vendor-portal/account/session` — bearer; returns `VendorPortalRead` with
  `auth.mode="vendor_portal_account"` and the same vendor-safe work-order list.

Actions (bearer; all validate the work order is vendor-visible AND shared to this
account's contractor, open status, same entity):
- `POST /vendor-portal/account/work-orders/{id}/accept` — record acceptance in
  metadata + activity + contractor-visible system comment; advance assigned/approved →
  in_progress; closed (completed/cancelled) → 409.
- `POST /vendor-portal/account/work-orders/{id}/comment` — append a comment with
  `visibility="contractor"` (shape: timestamp, actor, visibility, body) + activity.
- `POST /vendor-portal/account/work-orders/{id}/photo` — multipart image only
  (content_type startswith `image/`, ≤ 10 MB); StoredDocument(category=other,
  property_id from WO, metadata source=`vendor_portal_photo`), append id to
  `attachments.photo_document_ids`, activity + contractor-visible "Photo added" comment.

`_vendor_portal_identity(authorization, settings)` extracts Bearer → `_clerk_identity`
(monkeypatch point for tests). Actor string `vendor:{contractor_id}`. Reuse
`audit_log` (data_classification="confidential", tool_name `vendor_portal.account.*`,
tool_input ids only — never titles/notes). Comment/activity dict shapes match
`apps/api/routers/maintenance.py` so the preview reader returns them unchanged.

Move the catch-all `GET /vendor-portal/{contractor_id}` to the END of the router so
`/account/*` and `/invites/*` resolve first.

## TDD plan

Commit 1 (auth) — `tests/integration/test_vendor_portal_auth_api.py`:
1. operator creates hashed invite (token_hash≠token, len 64, claim_email, not consumed)
2. invite requires contractor email (409 when missing)
3. public preview is safe + claimable before claim
4. claim requires matching Clerk email (403, invite unconsumed)
5. claim + status + session are scoped (account active, invite consumed, session lists
   the shared WO); consumed-token reclaim by a different subject → 410; revoked → 401
6. shared-login: a subject already linked to contractor A claiming contractor B → 409,
   B invite unconsumed, A account intact

Commit 2 (actions) — `tests/integration/test_vendor_portal_actions_api.py`:
7. accept advances assigned→in_progress, writes acceptance metadata + contractor comment
8. accept on awaiting_approval records acceptance but does NOT change status
9. accept on completed → 409
10. comment appends visibility=contractor and shows back in session
11. photo upload stores image, links photo_document_ids, rejects non-image (415) and
    oversize (413)
12. all actions on a WO not shared to this contractor → 404; cross-entity → 404;
    no tenant/provider strings leak into responses

## Frontend (commit 3)

Mirror owner portal: `/vendor-portal/page.tsx` (account entry),
`/vendor-portal/invite/[token]` (claim gate: preview + Clerk sign-in → auto-claim),
and a signed-in dashboard with Accept / Post update / Upload photo per job. Keep the
operator preview at `/vendor-portal/[contractorId]` intact. Add `api.ts` client fns +
types and a `vendor-portal-account` Playwright smoke with a Clerk stub proving bearer
headers on claim/session/accept and that operator preview still renders.

## Verification

Backend (Mac via Desktop Commander): `.venv/bin/python -m pytest
tests/integration/test_vendor_portal_auth_api.py
tests/integration/test_vendor_portal_actions_api.py
tests/integration/test_vendor_portal_api.py
tests/integration/test_vendor_portal_share_api.py -q`; `.venv/bin/python -m ruff check`
on touched files; migration test if `TEST_DATABASE_URL` set.
Frontend: `eslint`, `tsc --noEmit`, targeted Playwright smoke, production `next build`.

## Guardrails (non-negotiable)

No provider send, Xero/Basiq write, payment reconciliation, tenant email/SMS, or
provider-history mutation. Vendor reads/writes are scoped to work orders explicitly
shared to that contractor; tenant identity, internal notes, provider receipts, and
payment identifiers never cross the boundary.
