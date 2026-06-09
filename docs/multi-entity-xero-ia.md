# Multi-Entity + Xero — IA decision (2026-06-09)

## Problem

SKJ's real-world structure exposes a naming and modelling collision. There are
**four distinct things** that current copy partly conflates:

1. **Account / login** — SKJ. The SaaS boundary you sign into. (Software jargon
   calls this a "tenant" — never surface that word here.)
2. **Managing entity** — SKJ Property Pty Ltd, the company that *does the
   managing* and issues invoices.
3. **Owning trusts** — roughly one per property, each a separate legal entity
   with its own ABN/TFN and **its own Xero organisation**.
4. **Renting tenants** — the people in the units (`Tenant` model).

The Settings → Connect Xero panel is the symptom: it reads *"SELECTED TRUST:
SKJ Property Pty Ltd → Connect this trust to its matching Xero organisation."*
But SKJ Property Pty Ltd is the **managing entity (#2)**, not a trust (#3). The
UI hardcodes the label "trust" onto whatever `Entity` is selected, and the
selected entity is the management company rather than an owning trust. That is
the mismatch.

## The hard constraint (drives everything)

Trusts **cannot** share one Xero organisation. Each trust has its own TFN/ABN
and lodges its own trust tax return — separate books are an ATO requirement, not
a product choice ([ATO: trusts registering and
reporting](https://www.ato.gov.au/businesses-and-organisations/trusts/trusts-registering-and-reporting-for-tax)).

So the goal is **not** to reduce the number of Xero connections. It is to make
managing N separate sets of books **feel like one portfolio**. This is the model
Re-Leased (AU/NZ, Xero-native) settled on: each company connects 1:1 to its own
Xero org, repeated per entity, with **cross-entity portfolio reporting layered
on top** ([Re-Leased Xero integration](https://www.re-leased.com/product/xero)).
The aggregation layer is the product; the connection is plumbing.

## What we already have (no new core model needed)

The architecture is already correct — it is mostly mislabelled and under-surfaced:

- `Organisation` = the account (SKJ). The login boundary. Carries `operating_mode`.
- `Entity` (`stewart/core/models.py`) = a legal entity under the account.
  Already carries `abn`, `gst_registered`, `trustee_name`/`trust_name` semantics
  via `Owner`, and **its own Xero connection**.
- `XeroConnection` is **per-Entity**, with a unique-active index
  (`xero_connection_entity_active_idx`): one live Xero org per entity, with
  revoke/reconnect history.
- Frontend selects an entity (`leasium.entity_id` in localStorage / `?entity_id`
  URL param) and starts OAuth with `startXeroOAuth(selectedEntityId)`.

So **"each trust = one Entity, one Xero org per Entity"** is already supported.
Missing: (a) trusts entered as their own Entities, (b) honest labelling, (c) a
UX that scales to dozens of entities, (d) a clear `Entity.type` distinction.

This aligns with the existing operating-mode decision
(`docs/account-operating-mode-ia.md`): SKJ is `self_managed_owner`, where trusts
live as **Entities** (Settings → "Your entities & trusts"), *not* the People →
Owners hub (that hub is managing-agent framing for third-party owner clients).

## Recommendation

### Layer 1 — concept & labelling (cheap, high impact)

- Reserve "tenant" for renters only. The account is the **account/organisation**;
  #2 is the **managing entity**; #3 are **entities / trusts**.
- Add a typed `Entity.entity_type` enum: `trust | company | smsf | individual |
  partnership`. Render the entity's real name + a type chip. **Remove the
  hardcoded word "trust"** from the Xero panel copy.
- The Xero panel should read *"Connect **[entity name]** ([type]) to its Xero
  organisation,"* never "this trust" generically.

### Layer 2 — UX for many entities ↔ many Xero orgs (the real work)

- **One "Entities & Xero" hub**: a row per entity → name, type chip, # properties,
  Xero status (`Connected` / `Not connected` / `Token expired → Reconnect`),
  last sync time. Connect/reconnect inline per row.
- **Health summary** banner: *"13 of 15 entities connected · 1 token expired · 1
  not connected."* The operator's job becomes triage, not hunting through Settings.
- **Guided sequential connect**: Xero requires a separate OAuth consent per org,
  so connections can't be batch-authorised — but they can be *queued*: "Connect
  next entity" walks one at a time and returns to the list. Onboarding many
  trusts becomes a flow, not a scavenger hunt.
- **Every property shows its owning entity**, and every post preview states
  *"posts to [Entity]'s Xero"* — so there's never ambiguity about which books a
  charge lands in. (Keeps the §2.1 review-first guardrail: still no Xero write
  without explicit operator approval.)
- **Cross-entity portfolio rollup** (arrears, income, occupancy across all
  entities) is the payoff that makes Leasium better than 15 Xero logins.

## The managing-entity fork (designed for both — SKJ structure TBC)

SKJ's manager (#2) can behave two ways. The model below supports both; only the
inter-entity flow differs.

**Structure A — manager is just the account identity.**
No management fee changes hands. All rent income and property expenses live
inside each trust's own Xero. The managing entity needs **no separate Xero** in
Leasium. Simplest; pure owner-operator with many trusts. *Nothing extra to build
beyond Layers 1–2.*

**Structure B — manager bills the trusts.**
SKJ Property Pty Ltd charges each trust a management fee. Then the manager is
itself an `Entity` (flagged `is_managing_entity = true`) **with its own Xero**
(fee income), and each trust's Xero carries a matching fee expense. This needs
**inter-entity invoicing**: an AR invoice in the manager's Xero ↔ an AP bill in
the trust's Xero, both review-first. This is structurally a managing-agent-style
flow even though SKJ owns everything.

**Decision (2026-06-09): Structure A for now.** SKJ's manager is just the
account identity — no fee changes hands, all rent/expenses live inside each
trust's Xero, the managing entity needs no separate Xero. Structure B
(inter-entity fee invoicing) is **deferred to the property-manager GTM phase**,
when Leasium is sold to third-party managing agents.

**Design that still covers both cheaply:** add a nullable
`Entity.is_managing_entity` flag and treat the managing entity as just another
`Entity` (so it *can* optionally hold its own Xero later). Build Layers 1–2 now;
they serve Structure A fully. Marking the flag now is cheap; retrofitting the
manager as a first-class entity later is not. Ticket 8 (inter-entity invoicing)
stays unbuilt until the managing-agent phase.

## Generalises to future clients

`Organisation → Entities (typed, one optional managing entity) → per-entity Xero
→ cross-entity rollup` serves every archetype:

- Owner-operator, one trust → one Entity, one Xero.
- SKJ → owner-operator, many trusts → many Entities, many Xero, optional
  managing entity.
- True managing agent → typically **one** trust account (their own), disbursing
  to third-party **Owners** (People → Owners hub) — they usually do *not* connect
  each owner's Xero. Worth stating explicitly so we don't over-build per-owner
  Xero for the agent case.

## Edge cases

- A trust holding multiple properties → one Entity, many properties. Fine.
- A property co-owned across two trusts → already handled by `PropertyOwner`
  split; the *posting* entity for invoices must be explicit (pick the billing
  entity per property; don't infer from split silently).
- Manager with no own Xero (Structure A) → managing entity row simply shows
  "No Xero — account identity only" rather than a broken "Not connected" nag.

## Status

Decision recorded 2026-06-09. Prototype mode — UI surfaces (entity-type chips,
the Entities & Xero hub, copy changes) are **Remba-pending by default**; log
follow-ups in `docs/design-governance.md`. Provider guardrail unchanged: no Xero
write without explicit operator approval (`CLAUDE.md` §2.1).

**Resolved 2026-06-09:** SKJ runs **Structure A** (manager = account identity
only). Inter-entity fee invoicing (Structure B / ticket 8) deferred to the
property-manager GTM phase.

## Build plan (bite-sized, TDD-shaped — verify before claiming done)

Each ticket: write the failing test first, then make it pass; backend ruff +
pytest on Temba's Mac (sandbox can't), frontend eslint/tsc/smoke in the sandbox.

1. **Entity type enum.** Add `Entity.entity_type`
   (`trust|company|smsf|individual|partnership`, nullable, Alembic migration,
   backfill existing → best guess from `trust_name` presence else `company`).
   → verify: migration up/down; model test asserts default + enum guard.
2. **Managing-entity flag.** Add nullable `Entity.is_managing_entity`. No
   behaviour yet — just the column + schema exposure.
   → verify: model test; serializer includes the field.
3. **Kill hardcoded "trust" copy.** Settings Xero panel renders entity name +
   type chip; copy reads "Connect [name] ([type]) to its Xero organisation."
   → verify: smoke fixture with two entity types; spec asserts no literal "this
   trust" string. *(Remba-pending — design-governance follow-up.)*
4. **Entities & Xero hub — read.** New Settings surface listing entities with
   type, property count, Xero status, last sync; health-summary banner.
   → verify: backend test for the aggregate (connected/expired/none counts);
   smoke spec for the list + banner. *(Remba-pending.)*
5. **Inline connect/reconnect + guided sequential connect.** Per-row connect;
   "Connect next entity" queue returns to the list after each OAuth round-trip.
   → verify: smoke spec mocks OAuth start/callback; asserts return-to-list +
   next-entity prompt. *(Remba-pending.)*
6. **Property → posting-entity clarity.** Each property shows owning/posting
   entity; post previews state "posts to [Entity]'s Xero."
   → verify: smoke spec on a property with a known entity; backend test that
   post preview names the entity. Guardrail: still review-first, no write.
7. **Cross-entity portfolio rollup.** Read-only consolidated view across
   entities, surfaced on the Insights → Portfolio tab. Shipped scope: property
   count, occupancy (active leases / units), and obligation health (overdue /
   due-soon) per entity plus org totals, via GET /insights/portfolio-rollup
   (grouped counts, no provider calls). **Follow-up:** $income and $-arrears
   stay per-entity for now — rolling those up cleanly needs the arrears/invoice
   engines and is deferred rather than approximated, to protect data integrity.
   → verify: backend test summing across ≥2 entities; smoke for the view.
8. **(Deferred — property-manager GTM phase, Structure B)** Inter-entity
   management-fee invoicing: AR invoice in manager Xero ↔ AP bill in trust Xero,
   both review-first drafts. Not built until Leasium is sold to managing agents.
   → verify (when built): backend happy-path + 503/auth; both provider sends
   mocked; explicit approval required before either draft posts.

Tickets 1–7 are the active scope and serve SKJ (Structure A) fully. Ticket 8 is
parked until the managing-agent phase.

## Migrating SKJ's single entity into per-trust entities

SKJ's portfolio was imported under **one** Entity ("SKJ Property Pty Ltd"); the
owning trusts exist only as **ownership labels** on each property
(`owner_legal_name` / `trust_name` / `metadata.owning_entity*`), surfaced as the
owner chips on the Properties list. Xero connects per Entity, so with one Entity
there is nowhere for each trust's own Xero org to attach — which is why the hub
and rollup stay hidden (gated on >1 entity).

To realise per-trust Xero, each owning trust must become its **own Entity**, with
its properties (and their units/leases/tenants/obligations) reassigned from the
single SKJ entity. SKJ Property Pty Ltd then stays as the **managing entity**.

Rule (confirmed 2026-06-09): **one owning entity per property = the head/legal
owner**; ownership chains (`A -> B (sublet) -> C`) collapse to the head — sublets
are leases the property-entity invoices, not owners.

This is a review-first, two-step migration:

- **Step 1 — dry-run plan (SHIPPED).** GET /entities/ownership-split-plan groups
  the org's properties by derived head-owner label and returns proposed entities
  with property/unit/lease counts (read-only, no mutation). Surfaced as a
  "Split into trust entities (preview)" panel in Settings → Organisation when the
  portfolio names more trusts than it has entities.
- **Step 2 — reviewed apply (SHIPPED).** POST /entities/ownership-split/apply
  takes the reviewed groups and, in one transaction: resolves-or-creates one
  entity per group (by name, so re-runs are idempotent), moves each property and
  its property-scoped obligations, and moves tenants whose leases fall entirely
  within one group. Tenants whose leases span entities are left in place and
  flagged (not corrupted). Units/leases/charge-rules carry no entity_id and
  follow their property. Each created entity records an audit row with the
  source entity + moved property ids (`tool_input.moved_from`) for
  reversibility. No provider calls. Surfaced as a two-step "Apply split…" →
  "Confirm" control on the preview panel with a result summary. Mutating, so it
  stays behind explicit operator confirmation (CLAUDE.md §2.1 spirit).

## Onboarding — where new users start (decided 2026-06-09)

"Add a property" vs "add an entity" should never be a fork users face. The
property's entity is a **pick-or-create field inside the Add Property form**:
choose an existing entity, or type a new trust/company name (with a type) and it
is created on submit, in the same step. The first property a brand-new account
creates also creates its first entity. SHIPPED in the property workspace
(pick-or-create entity on New property; creates the entity then the property,
then follows the property to its entity). A dedicated first-run "Get started"
wizard (create entity → property → connect Xero) is a later option for net-new
accounts; the inline pick-or-create covers the common case now.

## Simpler entities view (shipped 2026-06-09)

Settings → Organisation now leads with a scannable "Your entities & properties"
list (row per entity: name, type chip, managing marker, property count, Xero
status; expand → its properties). The dense owners CRUD is demoted into an
"Owner & trust records" disclosure. Replaces the long owners dump that was the
default view.

## Status — shipped 2026-06-09 (prototype mode, UI Remba-pending)

Tickets 1–7 landed and were verified (backend ruff + pytest on SQLite; frontend
eslint + tsc + Playwright smoke). Migration 0040 was not run against Postgres in
this session — apply on next Mac/Neon run. Commits:

- Wave 1 `6940d27` — entity_type + is_managing_entity (migration 0040).
- Wave 2 `4905bb2` — relabel Xero connect panel to typed entity (the screenshot fix).
- Wave 3 `d953e8b` — Entities & Xero hub (health summary + status table).
- Wave 4 `3f3f240` — per-row connect + guided "Connect next entity".
- Wave 5 `5bc3906` — "Posts to <entity>'s Xero" on the posting preview.
- Wave 6 (this commit) — Insights → Portfolio cross-entity rollup.
