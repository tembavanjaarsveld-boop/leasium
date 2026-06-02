"""entity payment instructions

Revision ID: 20260602_0036
Revises: 20260602_0035
Create Date: 2026-06-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260602_0036"
down_revision: str | None = "20260602_0035"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    json_type = postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON()
    metadata_default = sa.text("'{}'::jsonb") if is_postgres else sa.text("'{}'")

    op.create_table(
        "entity_payment_instruction",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("account_name", sa.Text(), nullable=True),
        sa.Column("bsb", sa.Text(), nullable=True),
        sa.Column("account_number", sa.Text(), nullable=True),
        sa.Column("payid", sa.Text(), nullable=True),
        sa.Column("payid_name", sa.Text(), nullable=True),
        sa.Column("bpay_biller_code", sa.Text(), nullable=True),
        sa.Column("instructions", sa.Text(), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column(
            "metadata",
            json_type,
            nullable=False,
            server_default=metadata_default,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["entity_id"],
            ["entity.id"],
            name=op.f("fk_entity_payment_instruction_entity_id_entity"),
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_user_id"],
            ["app_user.id"],
            name=op.f("fk_entity_payment_instruction_updated_by_user_id_app_user"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_entity_payment_instruction")),
    )
    op.alter_column("entity_payment_instruction", "metadata", server_default=None)
    op.create_index(
        "entity_payment_instruction_entity_active_idx",
        "entity_payment_instruction",
        ["entity_id"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "entity_payment_instruction_entity_active_idx",
        table_name="entity_payment_instruction",
    )
    op.drop_table("entity_payment_instruction")
