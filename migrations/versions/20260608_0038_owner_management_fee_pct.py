"""owner management fee pct

Adds ``management_fee_pct`` (Numeric(5, 3), nullable) to ``owner``. This is the
management fee charged to a third-party owner client, as a percentage of rent
collected, and backs the owner-distributions roll-up. Nullable so existing
owners flag as needing attention rather than assuming a zero fee.

Revision ID: 20260608_0038
Revises: 20260608_0037
Create Date: 2026-06-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260608_0038"
down_revision: str | None = "20260608_0037"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "owner",
        sa.Column("management_fee_pct", sa.Numeric(precision=5, scale=3), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("owner", "management_fee_pct")
