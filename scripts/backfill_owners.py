"""Backfill Owner records from Property owner-fields (DoorLoop benchmark P0).

Idempotent and additive — safe to re-run. Run with:

    .venv/bin/python -m scripts.backfill_owners
"""

from stewart.core.db import SessionLocal
from stewart.core.owner_backfill import backfill_owners


def main() -> None:
    with SessionLocal() as session:
        result = backfill_owners(session)
        session.commit()
        print(
            "Owner backfill complete: "
            f"{result.owners_created} owners created, "
            f"{result.owners_reused} existing owners reused, "
            f"{result.links_created} property links created, "
            f"{result.links_existing} property links already present, "
            f"{result.properties_unattributed} unattributed properties skipped."
        )


if __name__ == "__main__":
    main()
