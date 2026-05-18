"""lease and occupancy foundation

Revision ID: 20260518_0002
Revises: 20260518_0001
Create Date: 2026-05-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260518_0002"
down_revision: str | None = "20260518_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


lease_status = postgresql.ENUM(
    "pending",
    "active",
    "holding_over",
    "expired",
    "terminated",
    name="lease_status",
)
rent_frequency = postgresql.ENUM(
    "weekly",
    "monthly",
    "quarterly",
    "annual",
    name="rent_frequency",
)


def upgrade() -> None:
    bind = op.get_bind()
    lease_status.create(bind, checkfirst=True)
    rent_frequency.create(bind, checkfirst=True)

    op.create_index(
        "tenancy_unit_property_idx",
        "tenancy_unit",
        ["property_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    op.create_table(
        "tenant",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("legal_name", sa.Text(), nullable=False),
        sa.Column("trading_name", sa.Text(), nullable=True),
        sa.Column("abn", sa.Text(), nullable=True),
        sa.Column("contact_name", sa.Text(), nullable=True),
        sa.Column("contact_email", sa.Text(), nullable=True),
        sa.Column("contact_phone", sa.Text(), nullable=True),
        sa.Column("billing_email", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["entity_id"], ["entity.id"], name=op.f("fk_tenant_entity_id_entity")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tenant")),
    )
    op.create_index(
        "tenant_entity_idx",
        "tenant",
        ["entity_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    op.create_table(
        "lease",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenancy_unit_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("status", lease_status, nullable=False),
        sa.Column("commencement_date", sa.Date(), nullable=True),
        sa.Column("expiry_date", sa.Date(), nullable=True),
        sa.Column("annual_rent_cents", sa.Integer(), nullable=True),
        sa.Column("rent_frequency", rent_frequency, nullable=True),
        sa.Column("outgoings_recoverable", sa.Boolean(), nullable=False),
        sa.Column("next_review_date", sa.Date(), nullable=True),
        sa.Column("option_summary", sa.Text(), nullable=True),
        sa.Column("security_summary", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["tenant_id"], ["tenant.id"], name=op.f("fk_lease_tenant_id_tenant")
        ),
        sa.ForeignKeyConstraint(
            ["tenancy_unit_id"],
            ["tenancy_unit.id"],
            name=op.f("fk_lease_tenancy_unit_id_tenancy_unit"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_lease")),
    )
    op.create_index(
        "lease_tenancy_unit_idx",
        "lease",
        ["tenancy_unit_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "lease_tenant_idx",
        "lease",
        ["tenant_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "lease_tenant_idx", table_name="lease", postgresql_where=sa.text("deleted_at IS NULL")
    )
    op.drop_index(
        "lease_tenancy_unit_idx",
        table_name="lease",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_table("lease")
    op.drop_index(
        "tenant_entity_idx", table_name="tenant", postgresql_where=sa.text("deleted_at IS NULL")
    )
    op.drop_table("tenant")
    op.drop_index(
        "tenancy_unit_property_idx",
        table_name="tenancy_unit",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    bind = op.get_bind()
    rent_frequency.drop(bind, checkfirst=True)
    lease_status.drop(bind, checkfirst=True)
