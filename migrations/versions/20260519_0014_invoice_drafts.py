"""invoice drafts

Revision ID: 20260519_0014
Revises: 20260519_0013
Create Date: 2026-05-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260519_0014"
down_revision: str | None = "20260519_0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


invoice_draft_status = postgresql.ENUM(
    "draft",
    "ready_for_approval",
    "approved",
    "void",
    name="invoice_draft_status",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    invoice_draft_status.create(bind, checkfirst=True)

    op.create_table(
        "invoice_draft",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("billing_draft_id", sa.Uuid(), nullable=False),
        sa.Column("property_id", sa.Uuid(), nullable=True),
        sa.Column("tenancy_unit_id", sa.Uuid(), nullable=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=True),
        sa.Column("lease_id", sa.Uuid(), nullable=True),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("document_intake_id", sa.Uuid(), nullable=True),
        sa.Column("status", invoice_draft_status, nullable=False),
        sa.Column("invoice_number", sa.Text(), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("issue_date", sa.Date(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("subtotal_cents", sa.Integer(), nullable=False),
        sa.Column("gst_cents", sa.Integer(), nullable=False),
        sa.Column("total_cents", sa.Integer(), nullable=False),
        sa.Column("issuer_name", sa.Text(), nullable=True),
        sa.Column("issuer_abn", sa.Text(), nullable=True),
        sa.Column("recipient_name", sa.Text(), nullable=True),
        sa.Column("recipient_email", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["billing_draft_id"],
            ["billing_draft.id"],
            name=op.f("fk_invoice_draft_billing_draft_id_billing_draft"),
        ),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["stored_document.id"],
            name=op.f("fk_invoice_draft_document_id_stored_document"),
        ),
        sa.ForeignKeyConstraint(
            ["document_intake_id"],
            ["document_intake.id"],
            name=op.f("fk_invoice_draft_document_intake_id_document_intake"),
        ),
        sa.ForeignKeyConstraint(
            ["entity_id"], ["entity.id"], name=op.f("fk_invoice_draft_entity_id_entity")
        ),
        sa.ForeignKeyConstraint(
            ["lease_id"], ["lease.id"], name=op.f("fk_invoice_draft_lease_id_lease")
        ),
        sa.ForeignKeyConstraint(
            ["property_id"],
            ["property.id"],
            name=op.f("fk_invoice_draft_property_id_property"),
        ),
        sa.ForeignKeyConstraint(
            ["tenancy_unit_id"],
            ["tenancy_unit.id"],
            name=op.f("fk_invoice_draft_tenancy_unit_id_tenancy_unit"),
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"], ["tenant.id"], name=op.f("fk_invoice_draft_tenant_id_tenant")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_invoice_draft")),
    )
    op.create_index(
        "invoice_draft_entity_idx",
        "invoice_draft",
        ["entity_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "invoice_draft_billing_draft_idx",
        "invoice_draft",
        ["billing_draft_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "invoice_draft_status_idx",
        "invoice_draft",
        ["status"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "invoice_draft_due_date_idx",
        "invoice_draft",
        ["due_date"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    op.create_table(
        "invoice_draft_line",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("invoice_draft_id", sa.Uuid(), nullable=False),
        sa.Column("billing_draft_line_id", sa.Uuid(), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("gst_cents", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("source_hint", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["billing_draft_line_id"],
            ["billing_draft_line.id"],
            name=op.f("fk_invoice_draft_line_billing_draft_line_id_billing_draft_line"),
        ),
        sa.ForeignKeyConstraint(
            ["invoice_draft_id"],
            ["invoice_draft.id"],
            name=op.f("fk_invoice_draft_line_invoice_draft_id_invoice_draft"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_invoice_draft_line")),
    )
    op.create_index(
        "invoice_draft_line_draft_idx",
        "invoice_draft_line",
        ["invoice_draft_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "invoice_draft_line_draft_idx",
        table_name="invoice_draft_line",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_table("invoice_draft_line")
    op.drop_index(
        "invoice_draft_due_date_idx",
        table_name="invoice_draft",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_index(
        "invoice_draft_status_idx",
        table_name="invoice_draft",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_index(
        "invoice_draft_billing_draft_idx",
        table_name="invoice_draft",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_index(
        "invoice_draft_entity_idx",
        table_name="invoice_draft",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_table("invoice_draft")

    bind = op.get_bind()
    invoice_draft_status.drop(bind, checkfirst=True)
