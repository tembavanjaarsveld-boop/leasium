"""Reconcile per-unit properties into one building property (units underneath).

The SKJ register imported each tenancy as its own ``Property`` ("Leitchs B6 U4",
"Leitchs B6 U5", ...). The building-as-property model
(docs/superpowers/plans/2026-06-17-building-as-property.md) makes a building a
single ``Property`` with its units underneath. This groups properties that share
a building identity *within one entity* (entity scoping keeps a site that spans
trusts apart) and merges each group into one canonical building property: units,
property-scoped obligations and documents are re-pointed, the canonical is
renamed to building level and stamped with its ``building_key``, and the emptied
duplicates are soft-deleted. Leases ride along with their units.

Review-first: dry-run by default (prints the plan, mutates nothing). Pass
``--apply`` to commit. Idempotent and provider-inert (no Xero/email/SMS/payment).

    .venv/bin/python -m scripts.reconcile_building_units --match leitchs
    .venv/bin/python -m scripts.reconcile_building_units --match leitchs --apply
    # explicit (when names/streets don't auto-group):
    .venv/bin/python -m scripts.reconcile_building_units --into <prop_id> --merge <id1,id2>
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from typing import Any
from uuid import UUID

from apps.api.routers.lease_intakes import _building_key, _building_level_name
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.db import SessionLocal, utcnow
from stewart.core.models import Obligation, Property, StoredDocument, TenancyUnit


def _live_units(session: Session, property_id: UUID) -> list[TenancyUnit]:
    return list(
        session.scalars(
            select(TenancyUnit).where(
                TenancyUnit.property_id == property_id,
                TenancyUnit.deleted_at.is_(None),
            )
        )
    )


def _plan(
    session: Session, canonical: Property, others: list[Property], key: str | None
) -> dict[str, Any]:
    new_name = canonical.name
    if key:
        new_name = _building_level_name(canonical.name, key) or canonical.name
    return {
        "building_key": key,
        "entity_id": str(canonical.entity_id),
        "canonical": {
            "id": str(canonical.id),
            "name": canonical.name,
            "new_name": new_name,
            "units": len(_live_units(session, canonical.id)),
        },
        "merge": [
            {"id": str(other.id), "name": other.name, "units": len(_live_units(session, other.id))}
            for other in others
        ],
    }


def _merge_into(
    session: Session, canonical: Property, others: list[Property], key: str | None
) -> None:
    metadata = dict(canonical.property_metadata or {})
    if key is not None:
        metadata["building_key"] = key
        new_name = _building_level_name(canonical.name, key)
        if new_name:
            canonical.name = new_name
    reconciled = list(metadata.get("reconciled_from") or [])
    for other in others:
        for unit in _live_units(session, other.id):
            unit.property_id = canonical.id
        obligations = session.scalars(
            select(Obligation).where(
                Obligation.property_id == other.id,
                Obligation.deleted_at.is_(None),
            )
        )
        for obligation in obligations:
            obligation.property_id = canonical.id
        for document in session.scalars(
            select(StoredDocument).where(StoredDocument.property_id == other.id)
        ):
            document.property_id = canonical.id
        reconciled.append({"property_id": str(other.id), "name": other.name})
        other.deleted_at = utcnow()
    metadata["reconciled_from"] = reconciled
    canonical.property_metadata = metadata
    session.flush()


def reconcile(
    session: Session,
    *,
    match: str | None = None,
    entity_id: UUID | None = None,
    into: UUID | None = None,
    merge: list[UUID] | None = None,
    apply: bool = False,
) -> list[dict[str, Any]]:
    """Plan (and optionally apply) building reconciliation. Returns the plans."""
    if into is not None and merge:
        canonical = session.get(Property, into)
        if canonical is None or canonical.deleted_at is not None:
            raise SystemExit(f"--into property {into} not found")
        others: list[Property] = []
        for other_id in merge:
            other = session.get(Property, other_id)
            if other is None or other.deleted_at is not None:
                raise SystemExit(f"--merge property {other_id} not found")
            others.append(other)
        key = _building_key(canonical.name, canonical.street_address, None, canonical.suburb)
        plans = [_plan(session, canonical, others, key)]
        if apply:
            _merge_into(session, canonical, others, key)
        return plans

    statement = select(Property).where(Property.deleted_at.is_(None))
    if entity_id is not None:
        statement = statement.where(Property.entity_id == entity_id)
    properties = list(session.scalars(statement))
    if match:
        needle = match.lower()
        properties = [prop for prop in properties if needle in (prop.name or "").lower()]

    groups: dict[tuple[UUID, str], list[Property]] = defaultdict(list)
    for prop in properties:
        key = _building_key(prop.name, prop.street_address, None, prop.suburb)
        if key is not None:
            groups[(prop.entity_id, key)].append(prop)

    plans: list[dict[str, Any]] = []
    for (_, key), group in groups.items():
        if len(group) < 2:
            continue
        # Keep the established record: most units first, then earliest created.
        ordered = sorted(
            group,
            key=lambda prop: (-len(_live_units(session, prop.id)), prop.created_at),
        )
        canonical, others = ordered[0], ordered[1:]
        plans.append(_plan(session, canonical, others, key))
        if apply:
            _merge_into(session, canonical, others, key)
    return plans


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Reconcile per-unit properties into building properties (units underneath)."
    )
    parser.add_argument("--match", default=None, help="substring filter on property name")
    parser.add_argument("--entity", default=None, help="restrict to one entity id")
    parser.add_argument("--into", default=None, help="explicit canonical property id")
    parser.add_argument("--merge", default=None, help="comma-separated ids to merge into --into")
    parser.add_argument("--apply", action="store_true", help="commit changes (default: dry run)")
    args = parser.parse_args()

    entity_id = UUID(args.entity) if args.entity else None
    into = UUID(args.into) if args.into else None
    merge = [UUID(value.strip()) for value in args.merge.split(",")] if args.merge else None

    with SessionLocal() as session:
        plans = reconcile(
            session,
            match=args.match,
            entity_id=entity_id,
            into=into,
            merge=merge,
            apply=args.apply,
        )
        if not plans:
            print("No building groups with multiple properties found. Nothing to reconcile.")
        for plan in plans:
            canonical = plan["canonical"]
            print(f"\nBuilding {plan['building_key']} (entity {plan['entity_id']}):")
            print(
                f"  canonical {canonical['id']}  {canonical['name']!r}"
                f" -> {canonical['new_name']!r}  ({canonical['units']} unit(s))"
            )
            for row in plan["merge"]:
                print(
                    f"  merge     {row['id']}  {row['name']!r}"
                    f"  ({row['units']} unit(s)) -> move units, soft-delete"
                )
        if args.apply:
            session.commit()
            print("\nApplied and committed.")
        else:
            print("\nDry run only. Re-run with --apply to commit.")


if __name__ == "__main__":
    main()
