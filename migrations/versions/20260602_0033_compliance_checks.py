"""compliance checks register

Revision ID: 20260602_0033
Revises: 20260601_0032
Create Date: 2026-06-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260602_0033"
down_revision: str | None = "20260601_0032"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

user_role = postgresql.ENUM(
    "owner",
    "admin",
    "finance",
    "ops",
    "viewer",
    "agent",
    name="user_role",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    json_type = postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON()
    metadata_default = sa.text("'{}'::jsonb") if is_postgres else sa.text("'{}'")

    op.create_table(
        "compliance_check",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("property_id", sa.Uuid(), nullable=True),
        sa.Column("tenancy_unit_id", sa.Uuid(), nullable=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=True),
        sa.Column("lease_id", sa.Uuid(), nullable=True),
        sa.Column("assigned_user_id", sa.Uuid(), nullable=True),
        sa.Column("source_document_id", sa.Uuid(), nullable=True),
        sa.Column("current_obligation_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column(
            "kind",
            sa.Enum(
                "fire_safety",
                "insurance",
                "bank_guarantee",
                "make_good",
                "certificate",
                "inspection",
                "other",
                name="compliance_check_kind",
            ),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "active",
                "paused",
                "completed",
                "archived",
                name="compliance_check_status",
            ),
            nullable=False,
        ),
        sa.Column("jurisdiction", sa.Text(), nullable=True),
        sa.Column("authority", sa.Text(), nullable=True),
        sa.Column("recurrence_interval", sa.Integer(), nullable=False),
        sa.Column(
            "recurrence_unit",
            sa.Enum("days", "months", "years", name="compliance_recurrence_unit"),
            nullable=False,
        ),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_due_date", sa.Date(), nullable=False),
        sa.Column("certificate_expires_on", sa.Date(), nullable=True),
        sa.Column("owner_role", user_role, nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("metadata", json_type, nullable=False, server_default=metadata_default),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["entity_id"],
            ["entity.id"],
            name=op.f("fk_compliance_check_entity_id_entity"),
        ),
        sa.ForeignKeyConstraint(
            ["property_id"],
            ["property.id"],
            name=op.f("fk_compliance_check_property_id_property"),
        ),
        sa.ForeignKeyConstraint(
            ["tenancy_unit_id"],
            ["tenancy_unit.id"],
            name=op.f("fk_compliance_check_tenancy_unit_id_tenancy_unit"),
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenant.id"],
            name=op.f("fk_compliance_check_tenant_id_tenant"),
        ),
        sa.ForeignKeyConstraint(
            ["lease_id"],
            ["lease.id"],
            name=op.f("fk_compliance_check_lease_id_lease"),
        ),
        sa.ForeignKeyConstraint(
            ["assigned_user_id"],
            ["app_user.id"],
            name=op.f("fk_compliance_check_assigned_user_id_app_user"),
        ),
        sa.ForeignKeyConstraint(
            ["source_document_id"],
            ["stored_document.id"],
            name=op.f("fk_compliance_check_source_document_id_stored_document"),
        ),
        sa.ForeignKeyConstraint(
            ["current_obligation_id"],
            ["obligation.id"],
            name=op.f("fk_compliance_check_current_obligation_id_obligation"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_compliance_check")),
    )
    op.alter_column("compliance_check", "metadata", server_default=None)
    op.create_index(
        "compliance_check_entity_idx",
        "compliance_check",
        ["entity_id"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "compliance_check_property_idx",
        "compliance_check",
        ["property_id"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "compliance_check_next_due_idx",
        "compliance_check",
        ["next_due_date"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "compliance_check_current_obligation_idx",
        "compliance_check",
        ["current_obligation_id"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("compliance_check_current_obligation_idx", table_name="compliance_check")
    op.drop_index("compliance_check_next_due_idx", table_name="compliance_check")
    op.drop_index("compliance_check_property_idx", table_name="compliance_check")
    op.drop_index("compliance_check_entity_idx", table_name="compliance_check")
    op.drop_table("compliance_check")
    op.execute("DROP TYPE IF EXISTS compliance_recurrence_unit")
    op.execute("DROP TYPE IF EXISTS compliance_check_status")
    op.execute("DROP TYPE IF EXISTS compliance_check_kind")
