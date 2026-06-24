# Spec — Full "Migrate existing tenant" flow (client-facing)

Date: 2026-06-24
Status: Proposed (design-next). v1 thin button already shipped (commit bb9110d).
Relates to: docs/tenant-migration-portal-access-spec-2026-06-24.md (the engine).

## 1. Why

When a client onboards onto Leasium they arrive with a book of existing,
already-renting tenants. They should be able to bring each one in fast:
**drop the lease → confirm the info → match to (or create) the tenant → send a
portal login**, with no tenant-facing onboarding wizard. v1 (a button on the
tenant record) unblocks SKJ's own 25; this spec is the repeatable, client-facing
version. Internal-first still applies (§2.3) — design now, build when the
managing-agent GTM phase is live, but the SKJ migration is the proving ground.

## 2. The flow (and how much already exists)

1. **Drop lease** — Smart Intake lease upload. *Exists* (`lease_intakes` /
   `document_intakes`).
2. **Get info** — AI extraction with confidence + source. *Exists* (review-first
   pattern; `stewart/ai/lease_intake.py`).
3. **Match to existing** — confirm the extracted tenant / property / unit against
   existing records, or create new. *Partly exists* (`_find_or_create_*` in
   `lease_intakes.py`) — the genuinely-new piece is an **explicit operator
   "use this existing tenant" pick** in the review UI, instead of silent
   find-or-create.
4. **Skip onboarding toggle** — "Already renting — skip the onboarding form"
   (default on). Routes the apply to the migrated path (`applied`) instead of a
   `sent` onboarding. *Engine exists* (`POST /tenant-onboarding/migrated`).
5. **Send portal login link** — one action, with copyable link + status
   (not sent / sent / signed in). *Engine exists* (relaxed send-portal-invite);
   v1 button already surfaces it on the tenant record.

So the only genuinely new build is **UI + the explicit match step** — not new
plumbing.

## 3. Scope of the new work

In-scope:
- An entry point: "Migrate existing tenant" in Smart Intake and/or People →
  Tenants.
- The **match-to-existing** control in the lease-intake review (tenant /
  property / unit: "use existing [picker]" vs "create new"), with dedupe hints
  (name / ABN / address match candidates).
- The **skip-onboarding toggle** on apply, wired to the migrated path.
- The **send-link + status** step reusing the shipped engine and the v1 button
  patterns.
- A status chip lifecycle: not sent → sent → signed in (needs `token_consumed_at`
  or an active `TenantPortalAccount` surfaced on the read; see §6).

Out of scope (kept as-is): Smart Intake's existing create-new behaviour, the
review-first guardrails, the normal new-tenant onboarding wizard.

## 4. Design / UX gate (§2.2, §2.12)

- The approved low-fi reference is the in-chat mock signed off 2026-06-24.
- Next: build the target frame in the Figma SoT file (`PO2jOANgmqgZHfqWZXOZGU`,
  `03 Screens`), get sign-off there, then implement against it. (Remote Figma
  MCP can't persist new pages — add the frame on an existing page per the
  prior convention.)
- Reuse the existing Smart Intake review surface and record-page patterns; no new
  tokens/components. Run the in-slice UX pass (1440/390 + slop test) and log it.

## 5. Build phases

- **P1 (shipped):** thin tenant-record button — `Set up portal login` +
  send/copy link on a lease.
- **P2:** explicit match-to-existing step in lease-intake review (the key new
  UI), + the skip-onboarding toggle on apply that calls the migrated path when on.
- **P3:** unified "Migrate existing tenant" entry point that strings drop →
  review+match → apply(migrated) → send into one flow.
- **P4:** status lifecycle chip (signed-in detection) and a small batch view
  ("12 of 25 migrated, 8 signed in").

## 6. Backend touch-ups likely needed

- Surface claim status on the onboarding/tenant read so the UI can show
  "signed in" (expose `token_consumed_at`, or join the active
  `TenantPortalAccount`). Additive read-only field.
- Optional: a lease-intake "apply as migration" flag so step 4's toggle flows
  through the existing intake apply rather than a separate call. Keep apply
  review-first; still no provider send on apply.

## 7. Guardrails (unchanged, §2.1)

Creation/apply stays provider-inert. Sending the login link stays an explicit
operator action. Match-to-existing must never silently overwrite an existing
tenant's data — show what will link/change, operator confirms.

## 8. Tests

- Backend: lease-intake apply in migration mode creates the `applied` row and
  links (not creates) when an existing tenant is chosen; no provider call.
- Frontend smoke: drop → review shows match pickers → choosing existing links →
  apply → send-link step renders; at 1440/390.

## 9. Open decisions

1. Entry point home: Smart Intake vs People → Tenants vs both.
2. Match step: auto-suggest the best existing match (name/ABN/address) and let
   the operator confirm, vs operator searches manually.
3. Whether step 4's toggle reuses the lease-intake apply or calls
   `/tenant-onboarding/migrated` as a discrete step after apply.
