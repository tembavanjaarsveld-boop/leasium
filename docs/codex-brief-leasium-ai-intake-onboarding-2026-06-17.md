# Codex Brief — Leasium AI intake: onboarding completion for AI-brought-in leases

**Date:** 2026-06-17. **Scope:** one focused fix. **Repo:**
`/Users/tembavanjaarsveld/Documents/Stewart`, branch `main`, commits land directly
on main (gmail author — see Conventions).

## Mission (one line)

When the conversation-first **Leasium AI** brings an already-executed lease into a
unit, it must **not** leave the tenant onboarding workflow stuck mid-flow. A
signed/executed lease should resolve onboarding to **complete**; an AI-imported
executed lease should land complete (or not create an onboarding at all when
there is no external tenant to onboard) — never sitting on an active step like
"Lease file: Now" while "Sign" already shows Done.

---

## Requirements for Leasium AI intake (do NOT regress these)

These are the standing requirements the fix must respect:

1. **Conversation-first + review-first.** Intake is one thread. The flow is
   extract → confidence → source → **approve/edit/ignore** → only then mutate.
   A dropped lease produces ONE bundled "Create all records" plan (property +
   units + tenant + lease + critical dates), confirmed once.
2. **Read once, act everywhere.** Propose records from the plain-English
   understanding; do not gate creation on a brittle structured-field pass.
3. **Provider mutation guardrail (CLAUDE.md §2.1 — non-negotiable).** NEVER run a
   Xero write, SendGrid email, Twilio SMS, tenant email, or payment/reconciliation
   without explicit operator approval. Internal records
   (property/unit/tenant/lease/tasks/critical dates) are created on confirm;
   provider next-steps are gated links only. **This fix must not send any onboarding
   invite, pack, email or SMS as a side effect of completing onboarding** — it is a
   state resolution only. Tests mock all providers.
4. **Building-as-property (shipped 2026-06-17 — do not regress).** A dropped lease
   for another unit of a *known building* attaches as a **unit**, not a new
   property. See `_building_key` + building-aware `_find_or_create_property` in
   `apps/api/routers/lease_intakes.py` (entity-scoped; falls back to exact-name
   match when there is no building token). Full context:
   `docs/superpowers/plans/2026-06-17-building-as-property.md`.

---

## The bug

**Repro:** drop an already-executed lease (e.g. Building 6 Unit 5 — an SKJ
internal/related-party lease, tenant has no email/phone). The AI creates
tenant + unit + lease (lease is active/signed). The linked tenant onboarding ends
up internally inconsistent:

- Status **Applied**; steps Invite / Tenant details / Approve = **Done**;
  **Sign = Done** (e.g. "Signed 17 Jun 12:26"); but **Lease file = "Now"**
  (current step) and **Send pack = "Waiting"**.
- Tenant shows **No email / No mobile / No contact** — it is not a real external
  onboarding.

**Why it's wrong:** onboarding is a *linear* flow ending in **Sign**. In a genuine
onboarding you cannot reach Sign without first completing Lease file and Send pack,
so "Sign Done while Lease file/Send pack are not" can only arise from an AI import
that stamps the terminal signed state without walking the intermediate steps.

---

## Desired behaviour / acceptance criteria

1. **Signed ⇒ complete.** When the lease tied to an onboarding is signed/executed
   (lease-agreement signed and/or lease status active), the onboarding resolves to
   **complete** — Lease file / Send pack must not remain Now/Waiting. This must
   **self-heal existing inconsistent rows** on read/re-evaluation, not only fix
   new ones.
2. **Imported executed leases land complete.** When the AI brings in an
   already-executed lease, any onboarding it creates/links is created
   **already-complete** — or **not created** when there is no external tenant to
   onboard (e.g. no contact details). It must never appear mid-flow.
3. **Guard (don't over-complete).** Gate the auto-complete on the lease actually
   being signed/active. A genuinely pending onboarding (tenant still needs to sign)
   must keep running the normal flow. Do not blanket-complete every AI-linked
   onboarding.
4. **No provider side effects** (see §2.1). Completing onboarding sends nothing.
5. **Not a manual "skip" button** as the primary mechanism — it's manual,
   misuse-prone on real onboardings, and doesn't self-heal. (A skip affordance is a
   separate, secondary escape hatch; out of scope unless explicitly requested.)

---

## Where to look (verify in code — don't assume symbol names)

- **Model:** `stewart/core/models.py` — `TenantOnboarding`,
  `TenantOnboardingStatus` (values include `sent`, `submitted`, `reviewed`,
  `applied`, `cancelled`).
- **Lease-agreement sub-state (the "Sign" step source):**
  `apps/api/tenant_lease_agreement.py` — `lease_agreement_section(onboarding)`,
  `mark_lease_agreement_signed(...)`.
- **Intake apply paths:**
  `apps/api/routers/document_intakes.py::_apply_lease_document_intake`
  → `apps/api/routers/lease_intakes.py::_apply_lease_records`
  (`_find_or_create_property` / `_find_or_create_unit` / `_find_or_create_tenant`
  / `_create_lease`). NOTE: `lease_intakes.py` currently has **no** onboarding
  code, so the onboarding link/advance happens elsewhere — likely the
  tenant-uploaded-lease-match path in `document_intakes.py`
  (`_mark_tenant_uploaded_lease_match_signed`) via
  `StoredDocument.tenant_onboarding_id`. Locate exactly where the onboarding is
  created/linked and where its status / lease-agreement section is set.
- **Step view composition:** find where the six steps
  (Invite / Tenant details / Approve / Lease file / Send pack / Sign) and their
  Done/Now/Waiting states are derived (backend read schema
  `apps/api/schemas/tenant_onboarding.py` + the frontend onboarding component).
  Fix the **source of truth** (onboarding/lease-agreement state), not just the
  display — though the display may also need to treat "signed lease" as complete.

---

## Tests (CLAUDE.md §2.8)

- **Backend integration:** happy path — apply/bring-in an already-signed lease →
  onboarding resolves complete with no Now/Waiting intermediate step, and the
  no-provider-call guard records zero Xero/SendGrid/Twilio/email/payment calls.
  Plus the **guard** path — a pending onboarding whose lease is unsigned still runs
  the normal flow. Mock OpenAI / Twilio / SendGrid / Xero.
- **Frontend:** if an onboarding surface changes, add/adjust a Playwright smoke and
  run the in-loop UX gate (§2.2, 1440/390 screenshots). Prefer fixing backend state
  so the existing UI simply renders "complete".

## Conventions

- Backend `ruff`/`pytest` run on Temba's Mac via Desktop Commander (the sandbox
  can't run the venv). Frontend `eslint`/`tsc`/smoke via the bundled Next WASM.
- Commit: terse imperative subject, file-by-file body, **no** Claude/Codex
  attribution, **gmail author identity** (private-repo Hobby plan blocks
  `temba@skjcapital.com`-authored deploys). Stage only this slice's files;
  `git status --short` first. Push only on Temba's go; verify Vercel goes READY.
- Update `docs/product-roadmap.md` and `docs/next-chat-handover.md` on ship.
