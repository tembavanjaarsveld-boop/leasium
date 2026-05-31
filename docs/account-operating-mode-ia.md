# Account Operating Mode — IA decision (2026-05-31)

## Decision

Leasium serves two distinct customer archetypes that need different information
architecture. Introduce a first-class **account operating mode** on the
organisation/account, set at onboarding, that gates navigation, modules, and
terminology:

- `self_managed_owner` — an owner-operator who owns and runs their own property
  (e.g. SKJ; or a self-managing owner of 2–20 properties). There is no
  third-party owner — they *are* the owner.
- `managing_agent` — a real-estate agency / property manager who manages
  property on behalf of third-party landlords and holds/disburses client money.
- `hybrid` — owns some, manages some for others → defaults to the
  `managing_agent` feature set.

## Why

"Owner" means two different things:

- To a **managing agent**, an Owner is a *client* — a relationship you report to
  and disburse to. Owner statements to third parties, owner disbursements, trust
  accounting, and an owner portal are core. This is the DoorLoop model.
- To a **self-managed owner**, there is no external owner. A People → Owners hub
  framed as "your landlord clients" is empty and confusing.

So the People → **Owners hub** only fits the agent archetype. An owner-operator
should not see it.

## What operating mode gates

| Surface | `self_managed_owner` | `managing_agent` |
|---|---|---|
| People hub | Tenants · Vendors (· Prospects later) | Tenants · **Owners** · Vendors (· Prospects) |
| Owner statements | Internal, entity-grouped reporting only | Statements issued + disbursed to third-party owners |
| Trust accounting | Off (not applicable — see `trust-account` reclass in product-roadmap) | On (statutory agent obligation) |
| Owner portal | Off | On (landlord clients log in) |
| Terminology | "your entities" | "your owners / clients" |
| Onboarding | Owner sets up their own entities + properties | Set up owner clients, then their properties |

## Key nuance — do NOT strip entity grouping from self-managed owners

The owner-*entity data* still matters to a self-managed owner: SKJ holds
property across multiple trusts/SPVs, and owner statements already group by
`owner_legal_name` / `trustee_name` / `trust_name` for per-entity accounting and
tax. For `self_managed_owner`, that grouping lives as **Entities** (the existing
organisation → entity → property model, surfaced in Settings + reporting) — NOT
as a People → Owners hub.

Rule of thumb: the **Owner entity/data is shared infrastructure** used by both
modes; the People → **Owners *hub*** is `managing_agent`-only framing. Hide the
hub for owner-operators; keep their entity-grouped reporting.

## Onboarding question (future, for non-SKJ users)

> "Are you a real-estate agency / property manager, or a self-managed property
> owner?"

Sets `operating_mode`. A hybrid answer defaults to the agent feature set.

## Build implication — acts on the current P0

The DoorLoop refocus P0 is **Owner entity → People hub → 7-hub nav
consolidation**. Build it **operating-mode-aware from the start**:

- Add `operating_mode` to the organisation/account; default all existing
  accounts (incl. SKJ) → `self_managed_owner`.
- Gate the People → Owners nav item and the agent-only modules (owner
  statements-to-third-parties, disbursements, trust accounting, owner portal) on
  `operating_mode == managing_agent`.
- Keep the Owner entity in the schema regardless of mode; only conditionally
  *surface* the hub.
- Honour the 7-item sidebar cap (design source of truth §10.5.1) in both modes —
  self-managed simply has one fewer People sub-tab.

Designing the gate in now is cheap; retrofitting it after the Owner/People hub
ships is not.

## Edge cases

- A complex self-managed multi-trust owner ≈ "managing for its own entities" —
  still `self_managed_owner`; the Entities model covers the grouping.
- An owner who also manages a little third-party property → `hybrid` → agent
  feature set.

## Status

Decision recorded 2026-05-31 (prototype mode — no Remba gate per the current
stance). Onboarding segmentation itself is future work (post-SKJ). The
operating-mode gate should be **designed into the P0 Owner/People build now**.
Not yet built. Market-validated pattern (DoorLoop / AppFolio / PropertyMe all
distinguish manager vs landlord accounts).
