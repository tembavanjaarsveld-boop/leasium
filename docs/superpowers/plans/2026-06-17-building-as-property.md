# Building-as-property (Phase 1: B6 proving slice)

Date: 2026-06-17. Status: **Phase 1 shipped** (forward matcher + reconcile tool,
backend only). Phase 2 (portfolio migration, owner-grain, Properties UX) is
backlogged below.

## Problem

The SKJ register imported each tenancy as its own `Property` ("Leitchs B6 U4",
"Leitchs U1B3", ...). Dropping the Building 6 Unit 5 lease created a *new*
property instead of attaching U5 as a unit of the existing B6 building:
`_find_or_create_property` matched on exact lowercased name, and extraction named
the new property off the premises ("Building 6, Unit 5, 205 Leitchs Road"), which
never equals the register name. Temba chose the building-as-property model
(Properties → Units, CLAUDE.md §2.10).

## Constraints that shape the model

- `Property.entity_id` is required and single; `TenancyUnit` has no `entity_id`
  (it inherits via the property). A building can be one `Property` only if all
  its units sit under one entity/trust. A site whose units span trusts (e.g.
  `Leitchs U1B3` = SJI No 1) cannot be one `Property` without re-scoping entity
  down to the unit — which breaks Xero-per-Entity. So **building-as-property is
  entity-bounded.**
- Owner is first-class (`Owner` + `PropertyOwner`) but links at the `Property`
  level, and the legacy 11 `Property.owner_*` fields are still a backfill source.
  Per-unit owner identity is currently expressed by per-unit properties.

## Decision

A `Property` = a building **within one entity**, units underneath. A physical
site split across entities stays as separate per-entity properties (acceptable,
rare). Owner/billing stays at the building level for single-owner buildings;
moving owner/billing to the unit/lease grain is Phase 2.

## Phase 1 — shipped (backend only, no surface change)

1. `_building_key(name, street_address, unit_label, suburb)` in `lease_intakes`:
   building token (`b6`) + street core (leading number + first street word), unit
   stripped. Returns `None` when there is no building designation, so single-
   building properties keep the legacy exact-name match (**no regression**). B3 ≠
   B6 holds (different token); entity scoping at the call site blocks cross-trust
   merges.
2. `_find_or_create_property` matches an existing building by stamped
   `property_metadata.building_key` within the same entity before falling back to
   exact-name; new building properties are stored at building level and stamped.
   The explicit `property_id` link (operator override / link-existing toggle) is
   unchanged and still wins.
3. `scripts/reconcile_building_units.py` (dry-run-first, idempotent, provider-
   inert) merges per-unit properties of one building into a canonical building
   property: units, property-scoped obligations and documents are re-pointed,
   leases ride their units, duplicates are soft-deleted, `reconciled_from` is
   recorded.
4. Tests: `tests/unit/test_building_key.py`,
   `test_document_intake_apply_lease_attaches_new_unit_to_existing_building`
   (attach + B3-stays-separate guard),
   `tests/integration/test_reconcile_building_units.py` (merge + dry-run no-op).
   No frontend change — behaviour surfaces through the existing matched-property
   + link/new toggle and the Property → Units rendering.

## Run the B6 reconcile (hosted register, review-first)

    .venv/bin/python -m scripts.reconcile_building_units --match leitchs           # dry run — review
    .venv/bin/python -m scripts.reconcile_building_units --match leitchs --apply   # commit

If names/streets don't auto-group, use explicit ids (dry-run first):

    .venv/bin/python -m scripts.reconcile_building_units --into <B6_prop_id> --merge <stray_U5_prop_id>

## Phase 2 — backlog

- Portfolio-wide reconcile (per-entity building grouping) once B6 proves out.
- Owner-grain cutover: move owner/billing to the first-class `Owner` at the right
  grain so a building can hold units with different owners within one entity.
- Properties UI for building → units + intake review copy ("Add Unit N to
  existing <building>"); run the §2.2 UX gate then (Phase 1 changed no surface).
- Mirror building-aware matching to the purchase-contract path
  (`_find_matching_property` in `document_intakes.py`).
- Decide cross-trust same-site presentation (grouping view vs separate rows).
