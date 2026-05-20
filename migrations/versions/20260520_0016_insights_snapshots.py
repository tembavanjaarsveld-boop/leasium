"""insights snapshots

Revision ID: 20260520_0016
Revises: 20260520_0015
Create Date: 2026-05-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260520_0016"
down_revision: str | None = "20260520_0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "insights_snapshot",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("snapshot_type", sa.Text(), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=True),
        sa.Column("as_of", sa.Date(), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["app_user.id"],
            name=op.f("fk_insights_snapshot_created_by_user_id_app_user"),
        ),
        sa.ForeignKeyConstraint(
            ["entity_id"],
            ["entity.id"],
            name=op.f("fk_insights_snapshot_entity_id_entity"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_insights_snapshot")),
    )
    op.create_index(
        "insights_snapshot_entity_idx",
        "insights_snapshot",
        ["entity_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "insights_snapshot_token_hash_idx",
        "insights_snapshot",
        ["token_hash"],
        unique=True,
        postgresql_where=sa.text("token_hash IS NOT NULL"),
    )
    op.create_index(
        "insights_snapshot_expiry_idx",
        "insights_snapshot",
        ["expires_at"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("insights_snapshot_expiry_idx", table_name="insights_snapshot")
    op.drop_index("insights_snapshot_token_hash_idx", table_name="insights_snapshot")
    op.drop_index("insights_snapshot_entity_idx", table_name="insights_snapshot")
    op.drop_table("insights_snapshot")
