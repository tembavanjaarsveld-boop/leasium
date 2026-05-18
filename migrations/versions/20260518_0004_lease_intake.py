"""lease intake upload workflow

Revision ID: 20260518_0004
Revises: 20260518_0003
Create Date: 2026-05-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260518_0004"
down_revision: str | None = "20260518_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


lease_intake_status = postgresql.ENUM(
    "uploaded",
    "extracting",
    "extracted",
    "extraction_failed",
    "applied",
    "apply_failed",
    name="lease_intake_status",
)


def upgrade() -> None:
    bind = op.get_bind()
    lease_intake_status.create(bind, checkfirst=True)

    op.create_table(
        "lease_intake",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("content_type", sa.Text(), nullable=True),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("file_data", sa.LargeBinary(), nullable=False),
        sa.Column("status", lease_intake_status, nullable=False),
        sa.Column("extracted_data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("openai_response_id", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("applied_lease_id", sa.Uuid(), nullable=True),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["applied_lease_id"],
            ["lease.id"],
            name=op.f("fk_lease_intake_applied_lease_id_lease"),
        ),
        sa.ForeignKeyConstraint(
            ["entity_id"], ["entity.id"], name=op.f("fk_lease_intake_entity_id_entity")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_lease_intake")),
    )
    op.create_index(
        "lease_intake_entity_idx",
        "lease_intake",
        ["entity_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index("lease_intake_status_idx", "lease_intake", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index("lease_intake_status_idx", table_name="lease_intake")
    op.drop_index(
        "lease_intake_entity_idx",
        table_name="lease_intake",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_table("lease_intake")

    bind = op.get_bind()
    lease_intake_status.drop(bind, checkfirst=True)
