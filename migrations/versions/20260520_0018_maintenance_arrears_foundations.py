"""maintenance and arrears foundations

Revision ID: 20260520_0018
Revises: 20260520_0017
Create Date: 2026-05-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260520_0018"
down_revision: str | None = "20260520_0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


maintenance_priority = postgresql.ENUM(
    "low",
    "normal",
    "high",
    "urgent",
    name="maintenance_priority",
    create_type=False,
)
maintenance_work_order_status = postgresql.ENUM(
    "requested",
    "triaged",
    "assigned",
    "awaiting_approval",
    "approved",
    "in_progress",
    "completed",
    "cancelled",
    name="maintenance_work_order_status",
    create_type=False,
)
maintenance_approval_status = postgresql.ENUM(
    "not_required",
    "pending",
    "approved",
    "declined",
    name="maintenance_approval_status",
    create_type=False,
)
arrears_case_status = postgresql.ENUM(
    "monitoring",
    "active",
    "resolved",
    "written_off",
    "closed",
    name="arrears_case_status",
    create_type=False,
)
arrears_dispute_status = postgresql.ENUM(
    "none",
    "raised",
    "under_review",
    "resolved",
    "escalated",
    name="arrears_dispute_status",
    create_type=False,
)
arrears_escalation_status = postgresql.ENUM(
    "none",
    "queued",
    "in_progress",
    "referred",
    "closed",
    name="arrears_escalation_status",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    maintenance_priority.create(bind, checkfirst=True)
    maintenance_work_order_status.create(bind, checkfirst=True)
    maintenance_approval_status.create(bind, checkfirst=True)
    arrears_case_status.create(bind, checkfirst=True)
    arrears_dispute_status.create(bind, checkfirst=True)
    arrears_escalation_status.create(bind, checkfirst=True)

    op.create_table(
        "maintenance_work_order",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("property_id", sa.Uuid(), nullable=True),
        sa.Column("tenancy_unit_id", sa.Uuid(), nullable=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=True),
        sa.Column("lease_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", maintenance_work_order_status, nullable=False),
        sa.Column("priority", maintenance_priority, nullable=False),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("contractor_name", sa.Text(), nullable=True),
        sa.Column("contractor_email", sa.Text(), nullable=True),
        sa.Column("contractor_phone", sa.Text(), nullable=True),
        sa.Column("contractor_assigned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approval_required", sa.Boolean(), nullable=False),
        sa.Column("approval_status", maintenance_approval_status, nullable=False),
        sa.Column("approval_limit_cents", sa.Integer(), nullable=True),
        sa.Column("quote_amount_cents", sa.Integer(), nullable=True),
        sa.Column("approved_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approval_notes", sa.Text(), nullable=True),
        sa.Column("source_document_id", sa.Uuid(), nullable=True),
        sa.Column("invoice_draft_id", sa.Uuid(), nullable=True),
        sa.Column("invoice_reference", sa.Text(), nullable=True),
        sa.Column("invoice_amount_cents", sa.Integer(), nullable=True),
        sa.Column("source_reference", sa.Text(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("attachments", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["approved_by_user_id"],
            ["app_user.id"],
            name=op.f("fk_maintenance_work_order_approved_by_user_id_app_user"),
        ),
        sa.ForeignKeyConstraint(
            ["entity_id"],
            ["entity.id"],
            name=op.f("fk_maintenance_work_order_entity_id_entity"),
        ),
        sa.ForeignKeyConstraint(
            ["invoice_draft_id"],
            ["invoice_draft.id"],
            name=op.f("fk_maintenance_work_order_invoice_draft_id_invoice_draft"),
        ),
        sa.ForeignKeyConstraint(
            ["lease_id"],
            ["lease.id"],
            name=op.f("fk_maintenance_work_order_lease_id_lease"),
        ),
        sa.ForeignKeyConstraint(
            ["property_id"],
            ["property.id"],
            name=op.f("fk_maintenance_work_order_property_id_property"),
        ),
        sa.ForeignKeyConstraint(
            ["source_document_id"],
            ["stored_document.id"],
            name=op.f("fk_maintenance_work_order_source_document_id_stored_document"),
        ),
        sa.ForeignKeyConstraint(
            ["tenancy_unit_id"],
            ["tenancy_unit.id"],
            name=op.f("fk_maintenance_work_order_tenancy_unit_id_tenancy_unit"),
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenant.id"],
            name=op.f("fk_maintenance_work_order_tenant_id_tenant"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_maintenance_work_order")),
    )
    op.create_index(
        "maintenance_work_order_entity_idx",
        "maintenance_work_order",
        ["entity_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "maintenance_work_order_property_idx",
        "maintenance_work_order",
        ["property_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "maintenance_work_order_tenant_idx",
        "maintenance_work_order",
        ["tenant_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "maintenance_work_order_status_idx",
        "maintenance_work_order",
        ["status"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "maintenance_work_order_due_date_idx",
        "maintenance_work_order",
        ["due_date"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    op.create_table(
        "arrears_case",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("property_id", sa.Uuid(), nullable=True),
        sa.Column("tenancy_unit_id", sa.Uuid(), nullable=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("lease_id", sa.Uuid(), nullable=True),
        sa.Column("status", arrears_case_status, nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("as_of", sa.Date(), nullable=False),
        sa.Column("balance_current_cents", sa.Integer(), nullable=False),
        sa.Column("balance_1_30_cents", sa.Integer(), nullable=False),
        sa.Column("balance_31_60_cents", sa.Integer(), nullable=False),
        sa.Column("balance_61_90_cents", sa.Integer(), nullable=False),
        sa.Column("balance_90_plus_cents", sa.Integer(), nullable=False),
        sa.Column("total_balance_cents", sa.Integer(), nullable=False),
        sa.Column("oldest_unpaid_invoice_date", sa.Date(), nullable=True),
        sa.Column("last_invoice_date", sa.Date(), nullable=True),
        sa.Column("source_reference", sa.Text(), nullable=True),
        sa.Column("reminder_stage", sa.Integer(), nullable=False),
        sa.Column("reminder_frequency_days", sa.Integer(), nullable=True),
        sa.Column("next_reminder_on", sa.Date(), nullable=True),
        sa.Column("last_reminder_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reminder_paused_until", sa.Date(), nullable=True),
        sa.Column("dispute_status", arrears_dispute_status, nullable=False),
        sa.Column("dispute_notes", sa.Text(), nullable=True),
        sa.Column("promise_to_pay_date", sa.Date(), nullable=True),
        sa.Column("promise_to_pay_amount_cents", sa.Integer(), nullable=True),
        sa.Column("promise_to_pay_notes", sa.Text(), nullable=True),
        sa.Column("escalation_status", arrears_escalation_status, nullable=False),
        sa.Column("escalation_queue", sa.Text(), nullable=True),
        sa.Column("escalated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("assigned_user_id", sa.Uuid(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["assigned_user_id"],
            ["app_user.id"],
            name=op.f("fk_arrears_case_assigned_user_id_app_user"),
        ),
        sa.ForeignKeyConstraint(
            ["entity_id"],
            ["entity.id"],
            name=op.f("fk_arrears_case_entity_id_entity"),
        ),
        sa.ForeignKeyConstraint(
            ["lease_id"], ["lease.id"], name=op.f("fk_arrears_case_lease_id_lease")
        ),
        sa.ForeignKeyConstraint(
            ["property_id"],
            ["property.id"],
            name=op.f("fk_arrears_case_property_id_property"),
        ),
        sa.ForeignKeyConstraint(
            ["tenancy_unit_id"],
            ["tenancy_unit.id"],
            name=op.f("fk_arrears_case_tenancy_unit_id_tenancy_unit"),
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenant.id"],
            name=op.f("fk_arrears_case_tenant_id_tenant"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_arrears_case")),
    )
    op.create_index(
        "arrears_case_entity_idx",
        "arrears_case",
        ["entity_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "arrears_case_tenant_idx",
        "arrears_case",
        ["tenant_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "arrears_case_status_idx",
        "arrears_case",
        ["status"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "arrears_case_next_reminder_idx",
        "arrears_case",
        ["next_reminder_on"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "arrears_case_escalation_idx",
        "arrears_case",
        ["escalation_status"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("arrears_case_escalation_idx", table_name="arrears_case")
    op.drop_index("arrears_case_next_reminder_idx", table_name="arrears_case")
    op.drop_index("arrears_case_status_idx", table_name="arrears_case")
    op.drop_index("arrears_case_tenant_idx", table_name="arrears_case")
    op.drop_index("arrears_case_entity_idx", table_name="arrears_case")
    op.drop_table("arrears_case")

    op.drop_index("maintenance_work_order_due_date_idx", table_name="maintenance_work_order")
    op.drop_index("maintenance_work_order_status_idx", table_name="maintenance_work_order")
    op.drop_index("maintenance_work_order_tenant_idx", table_name="maintenance_work_order")
    op.drop_index("maintenance_work_order_property_idx", table_name="maintenance_work_order")
    op.drop_index("maintenance_work_order_entity_idx", table_name="maintenance_work_order")
    op.drop_table("maintenance_work_order")

    bind = op.get_bind()
    arrears_escalation_status.drop(bind, checkfirst=True)
    arrears_dispute_status.drop(bind, checkfirst=True)
    arrears_case_status.drop(bind, checkfirst=True)
    maintenance_approval_status.drop(bind, checkfirst=True)
    maintenance_work_order_status.drop(bind, checkfirst=True)
    maintenance_priority.drop(bind, checkfirst=True)
