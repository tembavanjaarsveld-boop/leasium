"""organisation operating_mode server default

The ``organisation.operating_mode`` column is NOT NULL but was created without a
DB-level default, while the ORM model declares
``server_default=OperatingMode.self_managed_owner.value``. Any INSERT that omits
the column (relying on that phantom default) therefore failed with a NOT NULL
violation in production — first seen seeding the reserved platform org, then on
``POST /platform/organisations``. This aligns the column with the model so every
Organisation insert path (platform provisioning, first-workspace bootstrap, future
code) is safe without each call site setting the value explicitly.

See docs/platform-admin-tier-ia.md.

Revision ID: 20260609_0042
Revises: 20260609_0041
Create Date: 2026-06-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260609_0042"
down_revision: str | None = "20260609_0041"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Backfill any stray NULLs defensively, then put the default on the column.
    op.execute(
        "UPDATE organisation SET operating_mode = 'self_managed_owner' "
        "WHERE operating_mode IS NULL"
    )
    op.alter_column(
        "organisation",
        "operating_mode",
        existing_type=sa.Text(),
        existing_nullable=False,
        server_default="self_managed_owner",
    )


def downgrade() -> None:
    op.alter_column(
        "organisation",
        "operating_mode",
        existing_type=sa.Text(),
        existing_nullable=False,
        server_default=None,
    )
