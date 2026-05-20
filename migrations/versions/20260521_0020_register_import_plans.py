"""register import plans

Revision ID: 20260521_0020
Revises: 20260520_0019
Create Date: 2026-05-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260521_0020"
down_revision: str | None = "20260520_0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    json_type = postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON()

    op.create_table(
        "register_import_plan",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("plan_data", json_type, nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("applied_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["applied_by_user_id"],
            ["app_user.id"],
            name=op.f("fk_register_import_plan_applied_by_user_id_app_user"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["app_user.id"],
            name=op.f("fk_register_import_plan_created_by_user_id_app_user"),
        ),
        sa.ForeignKeyConstraint(
            ["entity_id"],
            ["entity.id"],
            name=op.f("fk_register_import_plan_entity_id_entity"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_register_import_plan")),
    )
    op.create_index(
        "register_import_plan_entity_idx",
        "register_import_plan",
        ["entity_id"],
        postgresql_where=sa.text("deleted_at IS NULL") if is_postgres else None,
    )


def downgrade() -> None:
    op.drop_index("register_import_plan_entity_idx", table_name="register_import_plan")
    op.drop_table("register_import_plan")
