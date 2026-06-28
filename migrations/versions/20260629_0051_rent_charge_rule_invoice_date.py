"""rent charge rule invoice date

Revision ID: 20260629_0051
Revises: 20260624_0050
Create Date: 2026-06-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260629_0051"
down_revision: str | None = "20260624_0050"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "rent_charge_rule",
        sa.Column("next_invoice_date", sa.Date(), nullable=True),
    )
    op.create_index(
        "rent_charge_rule_next_invoice_idx",
        "rent_charge_rule",
        ["next_invoice_date"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
        sqlite_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("rent_charge_rule_next_invoice_idx", table_name="rent_charge_rule")
    op.drop_column("rent_charge_rule", "next_invoice_date")
