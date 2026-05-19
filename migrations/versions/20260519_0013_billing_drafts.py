"""billing drafts

Revision ID: 20260519_0013
Revises: 20260519_0012
Create Date: 2026-05-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260519_0013"
down_revision: str | None = "20260519_0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


billing_draft_status = postgresql.ENUM(
    "draft",
    "needs_review",
    "approved",
    "void",
    name="billing_draft_status",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    billing_draft_status.create(bind, checkfirst=True)

    op.create_table(
        "billing_draft",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("property_id", sa.Uuid(), nullable=True),
        sa.Column("tenancy_unit_id", sa.Uuid(), nullable=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=True),
        sa.Column("lease_id", sa.Uuid(), nullable=True),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("document_intake_id", sa.Uuid(), nullable=True),
        sa.Column("status", billing_draft_status, nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("issue_date", sa.Date(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("total_cents", sa.Integer(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["stored_document.id"],
            name=op.f("fk_billing_draft_document_id_stored_document"),
        ),
        sa.ForeignKeyConstraint(
            ["document_intake_id"],
            ["document_intake.id"],
            name=op.f("fk_billing_draft_document_intake_id_document_intake"),
        ),
        sa.ForeignKeyConstraint(
            ["entity_id"], ["entity.id"], name=op.f("fk_billing_draft_entity_id_entity")
        ),
        sa.ForeignKeyConstraint(
            ["lease_id"], ["lease.id"], name=op.f("fk_billing_draft_lease_id_lease")
        ),
        sa.ForeignKeyConstraint(
            ["property_id"],
            ["property.id"],
            name=op.f("fk_billing_draft_property_id_property"),
        ),
        sa.ForeignKeyConstraint(
            ["tenancy_unit_id"],
            ["tenancy_unit.id"],
            name=op.f("fk_billing_draft_tenancy_unit_id_tenancy_unit"),
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"], ["tenant.id"], name=op.f("fk_billing_draft_tenant_id_tenant")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_billing_draft")),
    )
    op.create_index(
        "billing_draft_entity_idx",
        "billing_draft",
        ["entity_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "billing_draft_document_intake_idx",
        "billing_draft",
        ["document_intake_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "billing_draft_status_idx",
        "billing_draft",
        ["status"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "billing_draft_due_date_idx",
        "billing_draft",
        ["due_date"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    op.create_table(
        "billing_draft_line",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("billing_draft_id", sa.Uuid(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("source_hint", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["billing_draft_id"],
            ["billing_draft.id"],
            name=op.f("fk_billing_draft_line_billing_draft_id_billing_draft"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_billing_draft_line")),
    )
    op.create_index(
        "billing_draft_line_draft_idx",
        "billing_draft_line",
        ["billing_draft_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "billing_draft_line_draft_idx",
        table_name="billing_draft_line",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_table("billing_draft_line")
    op.drop_index(
        "billing_draft_due_date_idx",
        table_name="billing_draft",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_index(
        "billing_draft_status_idx",
        table_name="billing_draft",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_index(
        "billing_draft_document_intake_idx",
        table_name="billing_draft",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_index(
        "billing_draft_entity_idx",
        table_name="billing_draft",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_table("billing_draft")

    bind = op.get_bind()
    billing_draft_status.drop(bind, checkfirst=True)
