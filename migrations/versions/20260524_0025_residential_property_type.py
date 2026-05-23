"""residential property_type value

Adds `residential` to the property_type Postgres enum so the platform can
represent residential rentals alongside the existing commercial/retail/
industrial/mixed-use/etc. types. SQLite stores enums as plain text so no
schema change is needed there.

ALTER TYPE ... ADD VALUE must run in an autocommit block on older Postgres
versions; we use one here for safety even on 12+.

Revision ID: 20260524_0025
Revises: 20260523_0024
Create Date: 2026-05-24
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260524_0025"
down_revision: str | None = "20260523_0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        # SQLite stores enums as plain TEXT — no DDL needed.
        return
    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TYPE property_type ADD VALUE IF NOT EXISTS 'residential'"
        )


def downgrade() -> None:
    # Postgres does not support removing enum values without recreating
    # the type and rewriting every dependent column. Downgrading is a
    # no-op; if a property has been classified `residential` it stays
    # that way, and the application code on the prior revision would
    # treat it as an unknown value at the SQLAlchemy boundary. Cleaner
    # than a destructive rewrite migration.
    pass
