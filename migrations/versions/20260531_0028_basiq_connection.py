"""basiq connection

Revision ID: 20260531_0028
Revises: 20260530_0027
Create Date: 2026-05-31
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260531_0028"
down_revision: str | None = "20260530_0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "basiq_connection",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("basiq_user_id", sa.Text(), nullable=False),
        sa.Column("consent_status", sa.Text(), nullable=True),
        sa.Column("auth_link_url", sa.Text(), nullable=True),
        sa.Column("auth_link_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("connection_id", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("last_fetch_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["app_user.id"],
            name=op.f("fk_basiq_connection_created_by_user_id_app_user"),
        ),
        sa.ForeignKeyConstraint(
            ["entity_id"],
            ["entity.id"],
            name=op.f("fk_basiq_connection_entity_id_entity"),
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_user_id"],
            ["app_user.id"],
            name=op.f("fk_basiq_connection_updated_by_user_id_app_user"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_basiq_connection")),
    )
    op.create_index(
        "basiq_connection_entity_active_idx",
        "basiq_connection",
        ["entity_id"],
        unique=True,
        postgresql_where=sa.text("revoked_at IS NULL AND deleted_at IS NULL"),
    )
    op.create_index(
        "basiq_connection_user_idx",
        "basiq_connection",
        ["basiq_user_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("basiq_connection_user_idx", table_name="basiq_connection")
    op.drop_index("basiq_connection_entity_active_idx", table_name="basiq_connection")
    op.drop_table("basiq_connection")
