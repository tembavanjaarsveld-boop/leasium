"""One-off, review-first cleanup of orphaned references in property 019ec8a3
left behind by the mid-June building-as-property unit consolidation.

Surfaced by `scripts.integrity_report`; plan approved by Temba 2026-06-19.

Dry-run by default: prints the plan, writes a JSON backup of every affected
row to ~, and mutates nothing. Pass --apply to commit inside one transaction
with an audit row per change. Aborts if any record is not in the expected
state. Provider-inert (no Xero/email/SMS/payment).

Plan:
- RE-POINT 6 live children of soft-deleted lease 019ecacc-8ce1 -> the single
  live replacement lease on the same live unit 019ecacc-8cd4:
    obligation x4, stored_document x1, rent_charge_rule x1
- SOFT-DELETE 3 orphans that have no live successor:
    lease 019ec8b8 (pending draft on deleted unit "Unit 3")
    obligation 019eceb9-a10f, stored_document 019eceb6-3f4c
    (both on deleted "Building 6, Unit 4" + its deleted lease)

Run:
    DATABASE_URL=<neon> .venv/bin/python -m scripts.fix_orphaned_references
    DATABASE_URL=<neon> .venv/bin/python -m scripts.fix_orphaned_references --apply
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

from sqlalchemy import select
from stewart.core.audit import audit_log
from stewart.core.db import SessionLocal, utcnow
from stewart.core.models import (
    Lease,
    Obligation,
    RentChargeRule,
    StoredDocument,
)

LIVE_UNIT = UUID("019ecacc-8cd4-7344-878a-45656e4631da")
DEAD_LEASE = UUID("019ecacc-8ce1-74b2-9aff-2aed059edb9c")

REPOINT: list[tuple[type, str]] = [
    (Obligation, "019ecacc-8ceb-73de-9918-a77b86b5a7a0"),
    (Obligation, "019ecacc-8ceb-7a50-87e7-47570c6856a3"),
    (Obligation, "019ecacc-8ceb-735b-9e5f-fd958d251a8b"),
    (Obligation, "019ecacc-8ceb-7bdd-9824-6d81f897695c"),
    (StoredDocument, "019ecacb-9189-7a7d-abf6-05bf77586f97"),
    (RentChargeRule, "019ecd3d-7c62-72c7-ab8f-a0c407fe4b58"),
]
SOFT_DELETE: list[tuple[type, str]] = [
    (Lease, "019ec8b8-8db1-7e81-9dc2-9c75aaed69fb"),
    (Obligation, "019eceb9-a10f-7995-ba57-377cdd3234b7"),
    (StoredDocument, "019eceb6-3f4c-71be-9822-5c4d81c868fb"),
]


def _dump(obj) -> dict:
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Review-first orphan-reference cleanup (property 019ec8a3)."
    )
    ap.add_argument("--apply", action="store_true", help="commit (default: dry run)")
    args = ap.parse_args()

    session = SessionLocal()
    try:
        live_leases = session.scalars(
            select(Lease).where(
                Lease.tenancy_unit_id == LIVE_UNIT, Lease.deleted_at.is_(None)
            )
        ).all()
        if len(live_leases) != 1:
            raise SystemExit(
                f"ABORT: expected exactly 1 live lease on unit {LIVE_UNIT}, "
                f"found {len(live_leases)}"
            )
        target = live_leases[0]
        print(f"Replacement lease (live, on unit {LIVE_UNIT}): {target.id}")

        backup: dict = {
            "generated_at": datetime.now(UTC).isoformat(),
            "replacement_lease_id": str(target.id),
            "rows": [],
        }
        plan: list[tuple] = []

        for model, sid in REPOINT:
            obj = session.get(model, UUID(sid))
            if obj is None:
                plan.append(("REPOINT", model.__tablename__, sid, "MISSING"))
                continue
            backup["rows"].append({"table": model.__tablename__, **_dump(obj)})
            cur = getattr(obj, "lease_id", None)
            state = "OK" if (cur == DEAD_LEASE and obj.deleted_at is None) else "UNEXPECTED"
            plan.append(
                ("REPOINT", model.__tablename__, sid, f"lease_id {cur} -> {target.id}", state)
            )

        for model, sid in SOFT_DELETE:
            obj = session.get(model, UUID(sid))
            if obj is None:
                plan.append(("SOFT_DELETE", model.__tablename__, sid, "MISSING"))
                continue
            backup["rows"].append({"table": model.__tablename__, **_dump(obj)})
            state = "OK" if obj.deleted_at is None else "ALREADY-DELETED"
            plan.append(("SOFT_DELETE", model.__tablename__, sid, "set deleted_at=now", state))

        bpath = Path.home() / f"relby-orphan-backup-{datetime.now():%Y%m%d-%H%M%S}.json"
        bpath.write_text(json.dumps(backup, indent=2, default=str))
        print(f"Backup of {len(backup['rows'])} rows written: {bpath}\n")

        print("PLAN:")
        for row in plan:
            print("  ", *row)

        states = [p[-1] for p in plan]
        if not args.apply:
            print("\nDRY RUN — no changes made. Re-run with --apply to commit.")
            return

        if any(s not in ("OK",) for s in states):
            raise SystemExit("ABORT: some records not in expected state; not applying.")

        now = utcnow()
        for model, sid in REPOINT:
            obj = session.get(model, UUID(sid))
            obj.lease_id = target.id
            audit_log(
                session,
                actor="script:fix_orphaned_references",
                action="update",
                target_table=model.__tablename__,
                target_id=obj.id,
                entity_id=getattr(obj, "entity_id", None),
                tool_name="fix_orphaned_references",
                tool_output_summary=f"repoint lease_id -> {target.id}",
            )
        for model, sid in SOFT_DELETE:
            obj = session.get(model, UUID(sid))
            obj.deleted_at = now
            audit_log(
                session,
                actor="script:fix_orphaned_references",
                action="soft_delete",
                target_table=model.__tablename__,
                target_id=obj.id,
                entity_id=getattr(obj, "entity_id", None),
                tool_name="fix_orphaned_references",
                tool_output_summary="soft-deleted orphan (no live successor)",
            )
        session.commit()
        print("\nAPPLIED — re-points + soft-deletes committed with audit rows.")
    finally:
        session.close()


if __name__ == "__main__":
    main()
