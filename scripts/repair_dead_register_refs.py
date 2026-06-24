"""Targeted repair for reviewed live-register dead references.

Dry-run by default. The default specs are the 2026-06-20 hosted Neon findings
reviewed in docs/mvp-readiness-punchlist-2026-06-19.md.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import SessionLocal, utcnow
from stewart.core.models import Lease, Obligation, RentChargeRule, StoredDocument, TenancyUnit


@dataclass(frozen=True)
class SoftDeleteSpec:
    table: str
    record_id: UUID
    reason: str


@dataclass(frozen=True)
class RelinkObligationSpec:
    obligation_id: UUID
    from_lease_id: UUID
    to_lease_id: UUID
    reason: str


RepairSpec = SoftDeleteSpec | RelinkObligationSpec

MODEL_BY_TABLE = {
    "lease": Lease,
    "obligation": Obligation,
    "stored_document": StoredDocument,
    "rent_charge_rule": RentChargeRule,
}

DEFAULT_SPECS: tuple[RepairSpec, ...] = (
    SoftDeleteSpec(
        "lease",
        UUID("019ec8b8-8db1-7e81-9dc2-9c75aaed69fb"),
        "Blank pending Gorilla Grind lease points at deleted Unit 3 and has no children.",
    ),
    SoftDeleteSpec(
        "obligation",
        UUID("019ecacc-8ceb-735b-9e5f-fd958d251a8b"),
        "Duplicate Gorilla Grind rent review on superseded deleted lease.",
    ),
    SoftDeleteSpec(
        "obligation",
        UUID("019ecacc-8ceb-7bdd-9824-6d81f897695c"),
        "Duplicate Gorilla Grind rent review on review date on superseded deleted lease.",
    ),
    SoftDeleteSpec(
        "obligation",
        UUID("019ecacc-8ceb-7a50-87e7-47570c6856a3"),
        "Duplicate Gorilla Grind lease expiry on superseded deleted lease.",
    ),
    RelinkObligationSpec(
        UUID("019ecacc-8ceb-73de-9918-a77b86b5a7a0"),
        UUID("019ecacc-8ce1-74b2-9aff-2aed059edb9c"),
        UUID("019ecdf6-6e76-7d5d-8c8e-3ad6af726093"),
        "Preserve unique Gorilla Grind return-premises obligation on live lease.",
    ),
    SoftDeleteSpec(
        "stored_document",
        UUID("019ecacb-9189-7a7d-abf6-05bf77586f97"),
        "Duplicate byte-identical Gorilla Grind document on superseded deleted lease.",
    ),
    SoftDeleteSpec(
        "rent_charge_rule",
        UUID("019ecd3d-7c62-72c7-ab8f-a0c407fe4b58"),
        "Duplicate Gorilla Grind monthly base-rent rule on superseded deleted lease.",
    ),
    SoftDeleteSpec(
        "obligation",
        UUID("019eceb9-a10f-7995-ba57-377cdd3234b7"),
        "Duplicate B6-U4 lease expiry from lower-confidence superseded intake.",
    ),
    SoftDeleteSpec(
        "stored_document",
        UUID("019eceb6-3f4c-71be-9822-5c4d81c868fb"),
        "Duplicate byte-identical B6-U4 document on superseded deleted lease/unit.",
    ),
)


def _entity_id_for(session: Session, row: Any) -> UUID | None:
    entity_id = getattr(row, "entity_id", None)
    if entity_id is not None:
        return entity_id
    lease_id = getattr(row, "lease_id", None)
    if lease_id is not None:
        lease = session.get(Lease, lease_id)
    else:
        lease = row if isinstance(row, Lease) else None
    if lease is None:
        return None
    unit = session.get(TenancyUnit, lease.tenancy_unit_id)
    if unit is None:
        return None
    from stewart.core.models import Property

    prop = session.get(Property, unit.property_id)
    return prop.entity_id if prop is not None else None


def _audit(
    session: Session,
    *,
    action: str,
    target_table: str,
    target_id: UUID,
    entity_id: UUID | None,
    tool_input: dict[str, Any],
) -> None:
    audit_log(
        session,
        actor="system:integrity_repair",
        action=action,
        entity_id=entity_id,
        target_table=target_table,
        target_id=target_id,
        tool_name="integrity_repair",
        tool_input=tool_input,
        tool_output_summary="Hosted register dead-reference repair.",
    )


def _soft_delete(session: Session, spec: SoftDeleteSpec, *, apply: bool) -> dict[str, str]:
    model = MODEL_BY_TABLE.get(spec.table)
    if model is None:
        raise SystemExit(f"unsupported table {spec.table}")
    row = session.get(model, spec.record_id)
    if row is None:
        raise SystemExit(f"{spec.table} {spec.record_id} not found")
    if row.deleted_at is not None:
        return {
            "operation": "soft_delete",
            "table": spec.table,
            "record_id": str(spec.record_id),
            "status": "already_deleted",
        }
    if not apply:
        return {
            "operation": "soft_delete",
            "table": spec.table,
            "record_id": str(spec.record_id),
            "status": "planned",
        }
    row.deleted_at = utcnow()
    _audit(
        session,
        action="delete",
        target_table=spec.table,
        target_id=spec.record_id,
        entity_id=_entity_id_for(session, row),
        tool_input={
            "operation": "soft_delete",
            "record_id": str(spec.record_id),
            "reason": spec.reason,
        },
    )
    return {
        "operation": "soft_delete",
        "table": spec.table,
        "record_id": str(spec.record_id),
        "status": "applied",
    }


def _relink_obligation(
    session: Session, spec: RelinkObligationSpec, *, apply: bool
) -> dict[str, str]:
    obligation = session.get(Obligation, spec.obligation_id)
    if obligation is None:
        raise SystemExit(f"obligation {spec.obligation_id} not found")
    if obligation.lease_id == spec.to_lease_id:
        return {
            "operation": "relink_obligation",
            "table": "obligation",
            "record_id": str(spec.obligation_id),
            "status": "already_relinked",
        }
    if obligation.lease_id != spec.from_lease_id:
        raise SystemExit(
            f"obligation {spec.obligation_id} expected source lease "
            f"{spec.from_lease_id}, found {obligation.lease_id}"
        )
    target = session.get(Lease, spec.to_lease_id)
    if target is None or target.deleted_at is not None:
        raise SystemExit(f"target lease {spec.to_lease_id} is not live")
    if not apply:
        return {
            "operation": "relink_obligation",
            "table": "obligation",
            "record_id": str(spec.obligation_id),
            "status": "planned",
        }
    obligation.lease_id = spec.to_lease_id
    _audit(
        session,
        action="relink",
        target_table="obligation",
        target_id=spec.obligation_id,
        entity_id=obligation.entity_id,
        tool_input={
            "operation": "relink_obligation",
            "from_lease_id": str(spec.from_lease_id),
            "to_lease_id": str(spec.to_lease_id),
            "reason": spec.reason,
        },
    )
    return {
        "operation": "relink_obligation",
        "table": "obligation",
        "record_id": str(spec.obligation_id),
        "status": "applied",
    }


def repair(
    session: Session,
    specs: list[RepairSpec] | tuple[RepairSpec, ...],
    *,
    apply: bool,
) -> list[dict[str, str]]:
    """Plan or apply reviewed dead-reference repairs."""
    actions: list[dict[str, str]] = []
    for spec in specs:
        if isinstance(spec, SoftDeleteSpec):
            actions.append(_soft_delete(session, spec, apply=apply))
        else:
            actions.append(_relink_obligation(session, spec, apply=apply))
    if apply:
        session.flush()
    return actions


def format_actions(actions: list[dict[str, str]], *, apply: bool) -> str:
    lines = [
        "Hosted register dead-reference repair",
        "Apply mode." if apply else "Dry run only. No records were changed.",
    ]
    for action in actions:
        lines.append(
            f"- {action['operation']} {action['table']} {action['record_id']} "
            f"status={action['status']}"
        )
    if apply:
        lines.append("Applied and committed.")
    else:
        lines.append("Re-run with --apply only after approval.")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Repair reviewed hosted register dead references.")
    parser.add_argument("--apply", action="store_true", help="commit changes (default: dry run)")
    args = parser.parse_args()

    with SessionLocal() as session:
        actions = repair(session, DEFAULT_SPECS, apply=args.apply)
        if args.apply:
            session.commit()
        else:
            session.rollback()
        print(format_actions(actions, apply=args.apply))


if __name__ == "__main__":
    main()
