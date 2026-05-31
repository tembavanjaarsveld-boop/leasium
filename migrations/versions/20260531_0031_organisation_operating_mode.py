"""organisation operating_mode

Adds ``operating_mode`` to the account root (``organisation``) so the frontend
can hide the People -> Owners hub for self-managed owner-operators. Owner is a
managing-agent concept (a third-party client); self-managed accounts keep
entity-grouped statements via Entities instead.

Existing accounts (incl. SKJ) default to ``self_managed_owner`` for back-compat.
Stored as plain Text to mirror ``rent_charge_rule.arrears_or_advance``; the enum
lives at the application boundary (``OperatingMode``).

Revision ID: 20260531_0031
Revises: 20260531_0030
Create Date: 2026-05-31
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260531_0031"
down_revision: str | None = "20260531_0030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "organisation",
        sa.Column(
            "operating_mode",
            sa.Text(),
            nullable=False,
            server_default="self_managed_owner",
        ),
    )
    op.execute(
        "UPDATE organisation SET operating_mode = 'self_managed_owner' "
        "WHERE operating_mode IS NULL"
    )
    op.alter_column("organisation", "operating_mode", server_default=None)


def downgrade() -> None:
    op.drop_column("organisation", "operating_mode")
