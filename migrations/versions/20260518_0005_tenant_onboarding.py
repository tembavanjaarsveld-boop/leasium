"""tenant onboarding links

Revision ID: 20260518_0005
Revises: 20260518_0004
Create Date: 2026-05-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260518_0005"
down_revision: str | None = "20260518_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


tenant_onboarding_status = postgresql.ENUM(
    "draft",
    "sent",
    "submitted",
    "cancelled",
    name="tenant_onboarding_status",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    tenant_onboarding_status.create(bind, checkfirst=True)

    op.create_table(
        "tenant_onboarding",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("lease_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("token", sa.Text(), nullable=False),
        sa.Column("status", tenant_onboarding_status, nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("submitted_data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["entity_id"], ["entity.id"], name=op.f("fk_tenant_onboarding_entity_id_entity")
        ),
        sa.ForeignKeyConstraint(
            ["lease_id"], ["lease.id"], name=op.f("fk_tenant_onboarding_lease_id_lease")
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"], ["tenant.id"], name=op.f("fk_tenant_onboarding_tenant_id_tenant")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tenant_onboarding")),
        sa.UniqueConstraint("token", name="uq_tenant_onboarding_token"),
    )
    op.create_index(
        "tenant_onboarding_entity_idx",
        "tenant_onboarding",
        ["entity_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "tenant_onboarding_lease_idx",
        "tenant_onboarding",
        ["lease_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "tenant_onboarding_tenant_idx",
        "tenant_onboarding",
        ["tenant_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index("tenant_onboarding_token_idx", "tenant_onboarding", ["token"], unique=True)


def downgrade() -> None:
    op.drop_index("tenant_onboarding_token_idx", table_name="tenant_onboarding")
    op.drop_index(
        "tenant_onboarding_tenant_idx",
        table_name="tenant_onboarding",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_index(
        "tenant_onboarding_lease_idx",
        table_name="tenant_onboarding",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_index(
        "tenant_onboarding_entity_idx",
        table_name="tenant_onboarding",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_table("tenant_onboarding")

    bind = op.get_bind()
    tenant_onboarding_status.drop(bind, checkfirst=True)
