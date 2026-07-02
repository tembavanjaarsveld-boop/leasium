"""rental incentive charge type

Revision ID: 20260702_0053
Revises: 20260702_0052
Create Date: 2026-07-02
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260702_0053"
down_revision: str | None = "20260702_0052"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TYPE rent_charge_type ADD VALUE IF NOT EXISTS 'rental_incentive'"
        )


def downgrade() -> None:
    # Postgres cannot drop an enum value without recreating the type and
    # rewriting dependent columns. Keep this non-destructive.
    pass
