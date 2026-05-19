"""document smart intake

Revision ID: 20260519_0009
Revises: 20260518_0008
Create Date: 2026-05-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260519_0009"
down_revision: str | None = "20260518_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


document_intake_status = postgresql.ENUM(
    "uploaded",
    "reading",
    "ready_for_review",
    "needs_attention",
    "applied",
    "failed",
    name="document_intake_status",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    if is_postgres:
        document_intake_status.create(bind, checkfirst=True)

    status_type = (
        document_intake_status
        if is_postgres
        else sa.Enum(
            "uploaded",
            "reading",
            "ready_for_review",
            "needs_attention",
            "applied",
            "failed",
            name="document_intake_status",
        )
    )
    json_type = postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON()

    op.create_table(
        "document_intake",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("status", status_type, nullable=False),
        sa.Column("document_type", sa.Text(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("extracted_data", json_type, nullable=False),
        sa.Column("review_data", json_type, nullable=False),
        sa.Column("openai_response_id", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("applied_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["applied_by_user_id"],
            ["app_user.id"],
            name=op.f("fk_document_intake_applied_by_user_id_app_user"),
        ),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["stored_document.id"],
            name=op.f("fk_document_intake_document_id_stored_document"),
        ),
        sa.ForeignKeyConstraint(
            ["entity_id"], ["entity.id"], name=op.f("fk_document_intake_entity_id_entity")
        ),
        sa.ForeignKeyConstraint(
            ["reviewed_by_user_id"],
            ["app_user.id"],
            name=op.f("fk_document_intake_reviewed_by_user_id_app_user"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_document_intake")),
        sa.UniqueConstraint("document_id", name=op.f("uq_document_intake_document_id")),
    )
    op.create_index(
        "document_intake_entity_idx",
        "document_intake",
        ["entity_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "document_intake_document_idx",
        "document_intake",
        ["document_id"],
        unique=False,
    )
    op.create_index("document_intake_status_idx", "document_intake", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index("document_intake_status_idx", table_name="document_intake")
    op.drop_index("document_intake_document_idx", table_name="document_intake")
    op.drop_index(
        "document_intake_entity_idx",
        table_name="document_intake",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_table("document_intake")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        document_intake_status.drop(bind, checkfirst=True)
