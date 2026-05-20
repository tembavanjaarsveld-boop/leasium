"""tenant portal accounts

Revision ID: 20260520_0019
Revises: 20260520_0018
Create Date: 2026-05-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260520_0019"
down_revision: str | None = "20260520_0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


tenant_portal_account_status = postgresql.ENUM(
    "active",
    "revoked",
    name="tenant_portal_account_status",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    tenant_portal_account_status.create(bind, checkfirst=True)

    op.create_table(
        "tenant_portal_account",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_onboarding_id", sa.Uuid(), nullable=True),
        sa.Column("auth_provider", sa.Text(), nullable=False),
        sa.Column("auth_provider_id", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column("status", tenant_portal_account_status, nullable=False),
        sa.Column("linked_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["entity_id"],
            ["entity.id"],
            name=op.f("fk_tenant_portal_account_entity_id_entity"),
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenant.id"],
            name=op.f("fk_tenant_portal_account_tenant_id_tenant"),
        ),
        sa.ForeignKeyConstraint(
            ["tenant_onboarding_id"],
            ["tenant_onboarding.id"],
            name=op.f(
                "fk_tenant_portal_account_tenant_onboarding_id_tenant_onboarding"
            ),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tenant_portal_account")),
    )
    op.create_index(
        "tenant_portal_account_auth_provider_active_idx",
        "tenant_portal_account",
        ["auth_provider", "auth_provider_id"],
        unique=True,
        postgresql_where=sa.text(
            "status = 'active' AND revoked_at IS NULL AND deleted_at IS NULL"
        ),
    )
    op.create_index(
        "tenant_portal_account_entity_idx",
        "tenant_portal_account",
        ["entity_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "tenant_portal_account_tenant_idx",
        "tenant_portal_account",
        ["tenant_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("tenant_portal_account_tenant_idx", table_name="tenant_portal_account")
    op.drop_index("tenant_portal_account_entity_idx", table_name="tenant_portal_account")
    op.drop_index(
        "tenant_portal_account_auth_provider_active_idx",
        table_name="tenant_portal_account",
    )
    op.drop_table("tenant_portal_account")
    tenant_portal_account_status.drop(op.get_bind(), checkfirst=True)
