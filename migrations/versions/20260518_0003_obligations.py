"""obligations and critical dates foundation

Revision ID: 20260518_0003
Revises: 20260518_0002
Create Date: 2026-05-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260518_0003"
down_revision: str | None = "20260518_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


obligation_category = postgresql.ENUM(
    "lease_expiry",
    "rent_review",
    "option_notice",
    "insurance",
    "bank_guarantee",
    "make_good",
    "compliance",
    "maintenance",
    "other",
    name="obligation_category",
)
obligation_status = postgresql.ENUM(
    "upcoming",
    "due_soon",
    "overdue",
    "completed",
    "waived",
    "disputed",
    name="obligation_status",
)
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
    obligation_category.create(bind, checkfirst=True)
    obligation_status.create(bind, checkfirst=True)

    op.create_table(
        "obligation",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("property_id", sa.Uuid(), nullable=True),
        sa.Column("tenancy_unit_id", sa.Uuid(), nullable=True),
        sa.Column("lease_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("category", obligation_category, nullable=False),
        sa.Column("status", obligation_status, nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("owner_role", user_role, nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["entity_id"], ["entity.id"], name=op.f("fk_obligation_entity_id_entity")
        ),
        sa.ForeignKeyConstraint(
            ["lease_id"], ["lease.id"], name=op.f("fk_obligation_lease_id_lease")
        ),
        sa.ForeignKeyConstraint(
            ["property_id"], ["property.id"], name=op.f("fk_obligation_property_id_property")
        ),
        sa.ForeignKeyConstraint(
            ["tenancy_unit_id"],
            ["tenancy_unit.id"],
            name=op.f("fk_obligation_tenancy_unit_id_tenancy_unit"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_obligation")),
    )
    op.create_index(
        "obligation_entity_idx",
        "obligation",
        ["entity_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "obligation_property_idx",
        "obligation",
        ["property_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "obligation_tenancy_unit_idx",
        "obligation",
        ["tenancy_unit_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "obligation_lease_idx",
        "obligation",
        ["lease_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "obligation_due_date_idx",
        "obligation",
        ["due_date"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "obligation_due_date_idx",
        table_name="obligation",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_index(
        "obligation_lease_idx",
        table_name="obligation",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_index(
        "obligation_tenancy_unit_idx",
        table_name="obligation",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_index(
        "obligation_property_idx",
        table_name="obligation",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_index(
        "obligation_entity_idx",
        table_name="obligation",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_table("obligation")

    bind = op.get_bind()
    obligation_status.drop(bind, checkfirst=True)
    obligation_category.drop(bind, checkfirst=True)
