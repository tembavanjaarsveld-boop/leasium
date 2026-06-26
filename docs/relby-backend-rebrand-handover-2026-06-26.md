# Relby rebrand — backend handover (for Codex)

**Date:** 2026-06-26
**Author:** Claude (pairing with Temba)
**Scope:** finish the Leasium → **Relby** rename on the **backend / data**.
The 2026-06-24 "Layer 1" rebrand was **frontend-only**; the API, comms
templates, AI prompts, and seeded platform data still say "Leasium", and
several of those are user-facing.

This is a **brand-only** ticket. Do **not** rename the internal `stewart`
codename or the lowercase `leasium-*` CSS / `data-testid` namespace (see
"Out of scope"). Follow `CLAUDE.md` §2.1 (provider guardrail), §2.4–2.8.

---

## Already done — do NOT redo

- Domain cut over: `relby.ai` is primary and serving; `leasium.ai` /
  `www.leasium.ai` 301 → `www.relby.ai`.
- Frontend UI, logo (exact open-R mark), favicon/OG, page metadata — all Relby.
- Operator login works on `relby.ai` (Clerk origins/redirects) and the API
  serves it (CORS / `FRONTEND_URL`).
- SendGrid **sender** is `no-reply@relby.ai` (Render env set 2026-06-26).
  Note: the message **bodies** still say Leasium — that's item 1 below.
- Frontend `Leasium` matches that remain are intentional code identifiers
  (`askLeasium`, `AskLeasiumPanel`, `LeasiumMark` alias) + the lowercase
  token/testid namespace + stale `.fuse_hidden*` orphans. Leave them.

---

## Guardrails (must follow)

- **No provider mutation.** Nothing in this ticket may send a SendGrid email,
  Twilio SMS, tenant email, Xero write, or payment reconciliation. Editing
  the *template copy* is fine; firing a send is not. Tests mock all providers.
- **Brand-only.** Change user-facing **string literals**. Do **not** rename
  Python identifiers, classes, functions, package paths, DB/bucket names, or
  env keys. Docstrings/comments are optional low-priority cleanup — only do
  them in the same pass if cheap; don't let them expand scope.
- **Keep:** the `stewart` package / DB (`stewart`, `stewart_test`) / buckets
  (`stewart-local`); the lowercase `leasium-*` CSS variables and
  `data-testid="leasium-*"` namespace (frontend, intentional).
- **Prefer the brand constant.** A central `settings.app_name` already exists
  (default `"Leasium"`). Where a string is easy to parameterise, route it
  through `app_name`; for static template/prompt copy a literal `"Relby"` is
  acceptable. Don't over-engineer.

---

## Work items

### 0. Config defaults — the brand constants (`stewart/core/settings.py`)
- `app_name` L19: `"Leasium"` → `"Relby"`.
- `sendgrid_from_name` L95: `"Leasium"` → `"Relby"` (Render already overrides
  at runtime; fix the default for local/dev correctness).
- `platform_organisation_name` L54: `"Leasium Platform"` → `"Relby Platform"`.
- `platform_admin_name` L57: `"Leasium Platform Admin"` → `"Relby Platform Admin"`.
- `platform_admin_email` L56: `"platform-admin@leasium.ai"` →
  `"platform-admin@relby.ai"`. **Caution:** the reserved platform admin is
  keyed by the fixed `platform_admin_user_id` UUID, so changing the default is
  safe for new seeds, but (a) confirm this email is **not** the Clerk login
  identity anyone signs in with (Temba signs in as `temba@skjcapital.com`),
  and (b) the existing Neon row keeps the old value until the data pass (item 5).
- Also update `.env.example` if it pins any of these.

### 1. Outbound comms templates — USER-FACING (highest priority)
`stewart/integrations/communications.py` (~47 refs, template dicts ~L417–491):
Work-assignment, follow-up, **digest**, and owner-digest **subject_template /
body / signature** all read "Leasium" (e.g. `"Leasium work assigned: {{title}}"`,
`"…assigned to you in Leasium"`, signature line `"Leasium"`). Recipients
(contractors, owners) see this. Replace "Leasium" → "Relby" (or `{{brand}}`),
keep every `{{placeholder}}` intact. Update the **rendered preview helpers** in
the same file so preview == delivery stays aligned.
`apps/api/routers/work_assignment_notifications.py`: the named-template catalog
`subject_preview` strings (L151–184, L345) and `"…outside Leasium"` (L516, L564),
`"Leasium receipts"` (L658–660). Keep these consistent with the templates above.

### 2. In-app helper / description copy — operator-facing
API `description=`/explainer strings rendered as helper text in the UI. Replace
"Leasium" → "Relby":
- `apps/api/routers/xero.py` (L568, 1717, 1972, 2381, 2798, 3125, 4026, 4029, 4138)
- `apps/api/routers/basiq.py` (L97, 430); `apps/api/schemas/basiq.py` (L92)
- `apps/api/routers/payments.py` (L42)
- `apps/api/routers/insights.py` (L1683)
- `apps/api/routers/tenant_portal.py` (L228, 1611)
- `apps/api/routers/vendor_portal.py` (L1053)
- `apps/api/routers/conversation_threads.py` (L52 `"Leasium AI thread"` fallback
  title — user-visible; and the module docstring L1)
- `apps/api/schemas/*` description/docstrings that surface (`ai.py`, `owners.py`,
  `platform.py`, `conversation_threads.py`)
- **Judgment call:** `apps/api/routers/comms.py` L4619–4631 custom email headers
  `X-Leasium-Source` / `-Trust-State` / `-Original-Sender` / `-Quarantine-Reason`
  / `-Auth-*`. Before renaming to `X-Relby-*`, grep for any **reader/parser** of
  these headers (inbound webhook, tests) and rename both sides together, or
  leave them (raw-header brand leak only). State which you chose.

### 3. AI self-reference — system prompts (`stewart/ai/*.py`)
"You are the Leasium … assistant" / "Ask Leasium" so the model can call itself
Leasium. Files: `ask.py`, `inbox.py`, `tenant_contact.py`, `maintenance.py`,
`vendor_intake.py`, `lease_change.py`. Replace the brand in prompt copy; leave
function/class names (`ask`, `AskError`, etc.) alone.

### 4. Platform org + admin references (code)
`scripts/seed_platform_admin.py` (docstring + any seeded literals),
`stewart/core/models.py` L605 (comment), `apps/api/routers/platform.py` +
`apps/api/schemas/platform.py` (docstrings). Update **tests** that assert the old
strings: `tests/integration/test_platform_admin_api.py` (L209, 218, 301, 366 use
`name="Leasium Platform"`).

### 5. Stored data — Neon (review-first, no sends)
Some brand text lives in **rows**, not code:
- The reserved org row `"Leasium Platform"` → `"Relby Platform"`.
- The seeded platform-admin row name/email (item 0 caveat).
- Any `branded_template` rows / versioned template bodies embedding "Leasium".
- Any onboarding/notification content snapshots embedding "Leasium".
Do it as a **reviewed data script** (read → diff → apply), **dry-run on a Neon
branch first**, and **without** triggering any SendGrid/Twilio/Xero send. Show
Temba the before/after diff + row counts before applying to prod.

---

## Tests (`CLAUDE.md` §2.8)

- Update existing assertions on old strings (platform-admin tests above; any
  comms / work-notification tests asserting "Leasium" subjects/bodies).
- Add at least one test that a **rendered** Work notice + digest subject/body
  reads "Relby" (providers mocked — never a real send).
- Mock OpenAI / Twilio / SendGrid / Xero everywhere.

## Verify / done criteria (run on the Mac venv)

```
.venv/bin/python -m ruff check apps stewart tests scripts
.venv/bin/python -m pytest
```

Brand-gate grep — should return only intentional leftovers:
```
grep -rn "Leasium" apps stewart scripts          # expect: none user-facing
grep -rni "leasium" apps stewart scripts          # expect: lowercase leasium-* tokens/testids + stewart only
```
Document any intentional remaining matches. Optional, **operator-gated**: with
Temba's explicit approval, one sandbox SendGrid + Twilio send to confirm "Relby"
in subject/body (Twilio trial only delivers to the verified number).

---

## Out of scope — operator console (cannot be done from code)

Leave these for Temba; note them, don't attempt:
- GitHub repo (`leasium`), Vercel project (`leasium`), Render service
  (`leasium-api`), Sentry projects (`leasium-api`/`-web`), Neon project label
  ("Leasium Oregon"), Figma file ("Leasium — Design Source of Truth").
- Xero app name + `XERO_REDIRECT_URI`; Twilio messaging-service friendly name;
  Clerk application display name + email branding; optional `api.relby.ai` host.
- The `stewart` codename and lowercase `leasium-*` namespace (deliberate).

---

## Commits / docs

- Terse imperative subjects; **per-topic** where practical, e.g.
  `Rebrand backend comms templates Leasium->Relby`,
  `Rebrand AI assistant prompts to Relby`,
  `Rebrand platform org + admin defaults to Relby`,
  `Rebrand Neon platform/template rows to Relby (reviewed data pass)`.
  No co-author / "Generated with" lines (§2.4).
- Update `docs/product-roadmap.md` (Built entry) and
  `docs/next-chat-handover.md`. The Work-notification copy is operator/recipient
  visible, so add a one-line `docs/design-governance.md` UX Pass Log entry for
  the comms-copy change.
- You are **not alone** in this repo — Temba commits on the same Mac tree.
  After any concurrent commit, `git fetch` + check `origin/main` + run the full
  suite before pushing.
