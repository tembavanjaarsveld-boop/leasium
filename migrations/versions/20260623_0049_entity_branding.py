"""entity branding

Revision ID: 20260623_0049
Revises: 20260619_0046
Create Date: 2026-06-23

Note: chains off 20260619_0046 (the last shipped migration), intentionally
bypassing the unmerged local workflow migrations (0047/0048) so production —
which is at 0046 — can apply this cleanly. When the workflow slice lands, an
Alembic merge revision will be needed to reconcile the two heads off 0046.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260623_0049"
down_revision: str | None = "20260619_0046"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "entity_branding",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("accent_color", sa.Text(), nullable=True),
        sa.Column("business_address", sa.Text(), nullable=True),
        sa.Column("contact_email", sa.Text(), nullable=True),
        sa.Column("contact_phone", sa.Text(), nullable=True),
        sa.Column("payment_payid", sa.Text(), nullable=True),
        sa.Column("payment_bpay_biller", sa.Text(), nullable=True),
        sa.Column("payment_bpay_reference", sa.Text(), nullable=True),
        sa.Column("payment_bank_bsb", sa.Text(), nullable=True),
        sa.Column("payment_bank_account", sa.Text(), nullable=True),
        sa.Column("footer_terms", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["entity_id"],
            ["entity.id"],
            name=op.f("fk_entity_branding_entity_id_entity"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_entity_branding")),
    )
    op.create_index(
        "entity_branding_entity_idx",
        "entity_branding",
        ["entity_id"],
        postgresql_where=sa.text("deleted_at IS NULL"),
        sqlite_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("entity_branding_entity_idx", table_name="entity_branding")
    op.drop_table("entity_branding")
