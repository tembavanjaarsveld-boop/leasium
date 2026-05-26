# Tenant onboarding — current vs. proposed

Date: 2026-05-25 (revised after Temba feedback)
Author: Temba (drafted with Claude)
Status: Implemented in the current working tree; pending product review,
Clerk-enabled smoke verification, and commit.

## Implementation status

Implemented on 2026-05-26:

- Tenant confirm-details form reduced to 4 required fields, with the
  remaining details behind an optional disclosure.
- Tenant-facing onboarding checklist reduced to the 3-step shape:
  confirm details + docs, property team review, sign lease.
- Tenant-facing `reviewed` state is hidden behind "In review".
- Invite claim gate now uses a prefilled Clerk email-code flow.
- Claiming now verifies the signed-in Clerk email matches the invite
  email before linking an account.
- Operator review/apply path now has a single **Approve & apply**
  action, while preserving explicit operator approval.
- Lease signing is available on focused routes at `/tenant-portal/lease`
  and `/tenant-portal/[token]/lease`.
- Lease-pack delivery is a distinct operator-triggered action after
  onboarding is applied.

Still pending outside this local implementation:

- Clerk-enabled end-to-end smoke verification against a signed-in tenant
  test account.
- Product/design review of the new copy, density, and sequencing.

## TL;DR

The operator-side invite is already lean (one form, 4 required fields,
one click chains tenant + lease + onboarding + portal invite). The
heavy parts are:

1. The **tenant-side experience**: 11-field confirm-details form and a
   5-step checklist that bundles unrelated stages (account creation,
   details, documents, review, lease signing).
2. The **operator review path**: backend exposes `draft → sent →
   submitted → reviewed → applied`, and the UI surfaces *Review* and
   *Apply* as two separate clicks for the same intent.

**Hard constraint:** Tenant onboarding stays **account-first**. Tenants
who skip account creation on day one don't come back to make one later
— that turns into property-manager support work, and account-bound
submissions are audit-stronger than token-only. So the win isn't
removing the account gate, it's making the gate *fast* and trimming
everything after it.

Three priority wins:

1. **Make the Clerk gate a single passwordless step**, not a multi-step
   sign-up flow. Pre-fill email from the invite token, switch to magic
   link / email code instead of password + verify. Effectively turns
   T1→T2→T3 into one tap from the email and one code from the inbox.
2. **Cut the confirm-details form from 11 fields to 4.** Move the
   remaining fields into an optional disclosure with the framing "you
   can add these later from the portal." Tenants who want to be done in
   60 seconds can be.
3. **Collapse Review + Apply into a single Approve action** on the
   operator side — still review-first (the click still requires explicit
   operator approval before any record mutates), just one click instead
   of two.

Smaller improvements: unbundle lease signing into its own stage, stop
surfacing the "reviewed" middle state to tenants.

---

## Current — operator side

| # | Step | Where | Required fields | Notes |
|---|---|---|---|---|
| O1 | Open Tenants workspace | `/tenants` | — | Entity picker, filters, list. |
| O2 | Click **Send invite** | `/tenants` | — | Opens inline `SectionPanel`. |
| O3 | Fill invite form | inline panel | Property, Unit (auto in most cases), Tenant name, Contact email | Optional: Contact name, Due date. |
| O4 | Submit | — | — | One mutation chains: `createTenant` → `createLease(status: pending)` → `createTenantOnboarding` → `sendTenantOnboardingPortalInvite`. |
| — | *Wait for tenant submission* | — | — | Backend state: `sent`. Optional reminders via `Run reminders`. |
| O5 | Tenant detail page | `/tenants/[id]` | — | Onboarding panel appears with submitted data + uploaded docs. |
| O6 | Click **Review** | tenant detail | Optional review notes | Backend transition: `submitted → reviewed`. |
| O7 | Click **Apply** | tenant detail | — | Backend transition: `reviewed → applied`. **This is the only step that actually mutates the tenant/lease record.** |
| O8 | Lease pack + sign request | separate flow | — | Driven from lease detail surface, not the onboarding panel. |

**Where the operator feels friction:**
- O6 and O7 are two clicks for what feels like one decision ("yes, this
  is good, commit it"). The intermediate `reviewed` state has no
  downstream consumer except O7.
- O8 lives in a different surface, so "tenant fully onboarded" is split
  across two pages.

---

## Current — tenant side

| # | Step | Where | Required actions | Field count |
|---|---|---|---|---|
| T1 | Land on invite link | `/onboarding/[token]` | Click "Create account or sign in" | 0 — but redirect to Clerk |
| T2 | Clerk sign-up / sign-in | Clerk modal | Email + password (or social) + verify email | 2–4 |
| T3 | Land in tenant portal | `/tenant-portal/[token]` | — | — |
| T4 | Fill **Confirm your details** | `OnboardingPanel` | Legal name, Contact name, Contact email, Insurance-confirmed checkbox, "Accepted" checkbox | **5 required + 6 optional** (Trading name, ABN, Contact phone, Billing email, Insurance expiry, Emergency name, Emergency phone, Notes) |
| T5 | Submit | — | — | Backend: `sent → submitted`. |
| T6 | Upload required documents | Documents panel | File chooser, category select | Per file |
| T7 | Wait | Checklist sidebar | — | "Property team review" — locked until they click anything. |
| T8 | Lease questions (optional Q&A) | Lease agreement panel | Type clause + question | Can loop many times. |
| T9 | Confirm "Ready to sign" check | Lease agreement panel | Tick box + click Sign | 1 checkbox + 1 click |
| T10 | Done | — | — | Portal opens to full feature set. |

**Where the tenant feels friction:**
- T1 → T2 is a hard wall. They clicked an invite link, expected to
  start typing, and instead get an account-creation modal first.
- T4 is *too long*. 11 inputs (even with most optional) reads as "do
  every field" to a non-technical tenant. ABN, insurance expiry, and
  emergency contact are nice-to-have, not blockers for getting the
  tenant into the system.
- T7 is a black box. "Property team review" with no estimate, no email
  confirmation, no preview of what they'll see next.
- T8–T9 (lease signing) is bundled into the same checklist as initial
  onboarding even though it's a separate event triggered after operator
  review.

---

## Proposed — operator side

| # | Step | Where | Change |
|---|---|---|---|
| O1' | Open Tenants workspace | `/tenants` | Unchanged. |
| O2' | Click **Send invite** | `/tenants` | Unchanged. |
| O3' | Fill invite form | inline panel | **Add inline copy** showing what the tenant will see ("They'll confirm 4 details + upload required docs. ~3 minutes."). Otherwise unchanged. |
| O4' | Submit | — | Unchanged — chain stays the same. |
| O5' | Tenant detail | `/tenants/[id]` | When submission arrives, the onboarding panel surfaces a single primary action: **Approve & apply** (with optional Notes-for-revision text). Secondary action: **Send back for revision**. |
| O6' | **Approve & apply** in one click | tenant detail | Backend transitions `submitted → reviewed → applied` in a single request. Audit log records both events with the same operator + timestamp. Provider-mutation guardrail unchanged: this still requires an explicit operator click; nothing fires automatically. |
| O7' | Lease pack + signing | tenant detail | Surface a "Send lease pack" CTA on the same page, immediately after Approve & apply lands, so it's clear that onboarding-confirm and lease-sign are sequential but distinct. |

**Wins:**
- 1 click instead of 2 for the routine approval path (the most common
  case at SKJ scale).
- The "Send back for revision" exit ramp is explicit instead of being
  the implicit alternative to clicking Apply.
- Lease pack is co-located with the rest of the onboarding journey.

**What we don't break:**
- Review-first guardrail (`CLAUDE.md §2.1`) is preserved — Approve &
  apply is still an explicit operator click. Nothing mutates without
  it.
- Audit trail still records distinct review + apply events (or one
  combined event with both signals — `audit_helpers` can encode this).
- Cancelled and `needs revision` paths remain.

---

## Proposed — tenant side

Two structural changes: (a) make the account gate *fast* (passwordless,
prefilled), (b) tighter confirm form behind it.

| # | Step | Where | Change |
|---|---|---|---|
| T1' | Land on invite link | `/onboarding/[token]` | Page shows: "Welcome [Tenant name]. Sign in with a one-time code to start." Email is **prefilled from the invite token** so the tenant doesn't type it. |
| T2' | Tap "Send code" | Clerk passwordless | One click sends a 6-digit code to the prefilled email. No password, no email-verification round trip. |
| T3' | Enter code | Clerk passwordless | Single input. Verified → account created → land in the confirm form. Total time from click to form: ~30 seconds. |
| T4' | Confirm 4 details | tenant portal | **Required: Legal name (pre-filled), Contact name, Contact email, Contact phone.** All other fields collapsed into an *Add more details (optional)* disclosure: ABN, Trading name, Billing email, Insurance expiry, Emergency contact, Notes. Insurance-confirmed and "accepted" checkboxes stay on the main form. |
| T5' | Upload required documents | same page | One-page flow — drop zone right below the form, not a separate panel. Category auto-detected where possible. |
| T6' | Submit | — | Backend: `sent → submitted`. Tenant sees confirmation: "Submitted. We'll email you when your property manager approves and the lease pack is ready to sign." |
| T7' | Approval email | email | "Your details are approved. **Sign your lease →**" — one-click link back into the portal (already signed in, account exists). |
| T8' | Sign lease | dedicated lease page | Lease agreement is its own page, with its own questions panel and signature CTA. **Not** part of the onboarding checklist. |
| T9' | Done | — | Full portal opens (payments, maintenance, documents). Account already exists from day one. |

**Wins:**
- **Account gate drops from ~3 minutes (password + email verify) to
  ~30 seconds** (one tap → code → in).
- **Confirm form drops from 11 fields to 4** required. ~60 seconds to
  submit instead of 3+ minutes of "do I need to fill this?"
- **Onboarding feels like one thing** (sign in → confirm + docs) and
  lease signing feels like a separate event triggered by operator
  approval.
- **The 5-step tenant checklist becomes 3:** Confirm details + upload
  docs ✓, Property team review (waiting), Sign lease.

**What we don't break:**
- **Account-first stays.** Every submission is bound to a Clerk
  identity from byte one. No tail of "I never made an account."
- **Operator still reviews everything before any record mutates**
  (`CLAUDE.md §2.1`).
- Existing tenant-portal sessions, account linking, and dev-fallback
  auth modes keep working — the change is just the *first-touch* sign-up
  shape.

**Note on Clerk passwordless:** Clerk supports email-code and magic-link
sign-in/sign-up out of the box. The change at T2'–T3' is configuration
+ a custom sign-in component that prefills email from the invite token,
not a new auth provider.

---

## Where complexity concentrates today (diagnostic)

| Surface | Pain type | Severity | Notes |
|---|---|---|---|
| Clerk sign-up flow (T1→T2) | Screen count + field count | **High** | Email + password + email-verify is heavy *inside* the gate. The gate stays; the friction inside it can drop a lot via passwordless + prefilled email. |
| 11-field confirm form (T4) | Field count | **High** | Too many optional fields read as required. ABN / insurance expiry / emergency contact are document-derivable or post-move-in. |
| 5-step tenant checklist (T4–T9) | Step count | **Medium** | Bundles unrelated stages (account, details, docs, review, signing). |
| Review + Apply two clicks (O6, O7) | Step count | **Medium** | The intermediate `reviewed` state has no downstream consumer. |
| "Reviewed" state surfaced to tenant | Decision count | **Low** | Tenants don't need to distinguish "waiting on operator review" from "operator finished reviewing but hasn't applied yet." |
| Lease signing fused with onboarding | Workflow ordering | **Low** | Cosmetic but contributes to the "this feels long" impression. |

---

## Implementation order

All six changes below are green-lit per the Resolved section. Listed
smallest-to-largest; each can land on its own commit. Recommended
sequence: 1 → 2 → 3 → 4 → 5 → 6 (front-load the cheap visible wins,
defer the auth + email plumbing).

1. **Tenant: trim confirm-details form to 4 required fields, collapse
   the rest under disclosure** (small). Frontend change only. The
   backend `TenantPortalOnboardingSubmitPayload` already treats most of
   those as optional — just rearrange the UI in
   `OnboardingPanel` (`tenant-portal-content.tsx`). **Biggest tenant-felt
   win for the least code.**

2. **Operator: collapse Review + Apply into Approve & apply** (small).
   Frontend change only. Audit log already records both events; the
   button just calls them sequentially. ~1 file in
   `apps/web/src/app/tenants/[tenantId]/page.tsx`, optionally a new
   combined API endpoint.

3. **Tenant: hide the `reviewed` state from the tenant-facing
   checklist** (small). Tenant just sees "Submitted, in review" until
   `applied`. Change in `OnboardingStep` rendering.

4. **Tenant: prefill invite email + switch Clerk sign-up to
   passwordless** (medium). Configure Clerk for email-code (or magic
   link) and wrap the `/onboarding/[token]` page in a custom Clerk
   sign-in component that reads the tenant email from the invite
   token. Account-first guarantee preserved. **This is the highest-value
   tenant-side change but the most config-heavy.**

5. **Tenant: unbundle lease signing from the onboarding checklist**
   (medium). Lease signing becomes its own stage triggered by operator
   approval. Tenant gets a separate "Sign your lease" email after
   approval. Touches `tenant-portal-content.tsx` and the email
   template.

6. **Operator: surface a "Send lease pack" CTA on the tenant detail
   page right after Approve & apply** (small). Cosmetic, ties (2) and
   (5) together.

---

## Guardrail check

- **§2.1 Provider mutation guardrail:** Approve & apply is still an
  explicit operator click. SendGrid email sends (T6'), Twilio SMS, and
  any Xero writes still require operator review. The single button
  doesn't bypass review — it just removes a redundant intermediate
  click.
- **§2.2 Remba review:** Every change above is design-facing (copy,
  layout, workflow ordering, density). Per the retired-Remba note from
  2026-05-23 ("just fling it"), I'm treating this as a prototype-stage
  proposal — but if Remba is back in the loop for substantive
  workflow rewrites, this whole document is Remba-pending by default.
- **§2.3 Internal-first 6 months:** All of the simplifications are
  internal-workflow speedups, not branding/external-polish work. They
  fit the internal-first posture.
- **§2.8 Test discipline:** Each change needs a backend integration
  test (happy path + auth/403 where applicable) and a smoke fixture. The
  account-first claim path needs Clerk-enabled smoke coverage for the
  email-code flow in an environment with tenant auth configured.

---

## Resolved

All major directional questions are now decided. The proposal is ready
to start implementing in the order listed above.

- **Account-first vs token-first** *(resolved 2026-05-25)*. Account-first
  stays for the reasons in
  `[[feedback-tenant-onboarding-account-first]]`. The simplification
  focuses on speeding up the gate and cutting the form behind it, not
  removing the gate.

- **Lease signing — bundled vs. separated** *(resolved 2026-05-25)*.
  **Separated.** Lease signing is its own stage triggered by operator
  approval. Tenant journey becomes a clean 3-step shape: *confirm →
  wait → sign*. Operator journey gets a distinct "Send lease pack" CTA
  after Approve & apply, replacing the current implicit "hope the
  tenant comes back and notices." Online signing (the existing
  `LeaseAgreementPanel` + `signTenantPortalLeaseAgreement` flow) is
  preserved — the change is the *entry path* into signing (email
  trigger + dedicated page), not the signing surface itself.

- **Passwordless sign-up via Clerk** *(resolved 2026-05-25)*. **Yes,
  switch to email-code.** Account-first stays; the gate just becomes a
  one-tap + one-code flow instead of password + email-verify. This
  reinforces the security/support posture rather than fighting it —
  the same "forgot my password" tail that justifies account-first also
  justifies dropping passwords from sign-up.

- **Email prefill from the invite token** *(resolved 2026-05-25)*.
  **Yes, prefill.** The property manager already entered the tenant's
  email when sending the invite; making the tenant retype it adds
  friction with no audit benefit. Prefilled, editable (in case of
  typo).
