"""vendor portal account auth

Revision ID: 20260602_0035
Revises: 20260602_0034
Create Date: 2026-06-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260602_0035"
down_revision: str | None = "20260602_0034"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


vendor_portal_account_status = postgresql.ENUM(
    "active",
    "revoked",
    name="vendor_portal_account_status",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    json_type = postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON()
    metadata_default = sa.text("'{}'::jsonb") if is_postgres else sa.text("'{}'")
    status_type = (
        vendor_portal_account_status
        if is_postgres
        else sa.Enum("active", "revoked", name="vendor_portal_account_status")
    )
    if is_postgres:
        vendor_portal_account_status.create(bind, checkfirst=True)

    op.create_table(
        "vendor_portal_invite",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("contractor_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("claim_email", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column(
            "metadata",
            json_type,
            nullable=False,
            server_default=metadata_default,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["app_user.id"],
            name=op.f("fk_vendor_portal_invite_created_by_user_id_app_user"),
        ),
        sa.ForeignKeyConstraint(
            ["contractor_id"],
            ["contractor.id"],
            name=op.f("fk_vendor_portal_invite_contractor_id_contractor"),
        ),
        sa.ForeignKeyConstraint(
            ["entity_id"],
            ["entity.id"],
            name=op.f("fk_vendor_portal_invite_entity_id_entity"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_vendor_portal_invite")),
    )
    op.alter_column("vendor_portal_invite", "metadata", server_default=None)
    op.create_index(
        "vendor_portal_invite_token_hash_idx",
        "vendor_portal_invite",
        ["token_hash"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "vendor_portal_invite_entity_idx",
        "vendor_portal_invite",
        ["entity_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "vendor_portal_invite_contractor_idx",
        "vendor_portal_invite",
        ["contractor_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    op.create_table(
        "vendor_portal_account",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("contractor_id", sa.Uuid(), nullable=False),
        sa.Column("vendor_portal_invite_id", sa.Uuid(), nullable=True),
        sa.Column("auth_provider", sa.Text(), nullable=False),
        sa.Column("auth_provider_id", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("status", status_type, nullable=False),
        sa.Column("linked_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "metadata",
            json_type,
            nullable=False,
            server_default=metadata_default,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["contractor_id"],
            ["contractor.id"],
            name=op.f("fk_vendor_portal_account_contractor_id_contractor"),
        ),
        sa.ForeignKeyConstraint(
            ["entity_id"],
            ["entity.id"],
            name=op.f("fk_vendor_portal_account_entity_id_entity"),
        ),
        sa.ForeignKeyConstraint(
            ["vendor_portal_invite_id"],
            ["vendor_portal_invite.id"],
            name=op.f(
                "fk_vendor_portal_account_vendor_portal_invite_id_vendor_portal_invite"
            ),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_vendor_portal_account")),
    )
    op.alter_column("vendor_portal_account", "metadata", server_default=None)
    op.create_index(
        "vendor_portal_account_auth_provider_contractor_active_idx",
        "vendor_portal_account",
        ["auth_provider", "auth_provider_id", "contractor_id"],
        unique=True,
        postgresql_where=sa.text(
            "status = 'active' AND revoked_at IS NULL AND deleted_at IS NULL"
        ),
    )
    op.create_index(
        "vendor_portal_account_auth_provider_active_idx",
        "vendor_portal_account",
        ["auth_provider", "auth_provider_id"],
        unique=True,
        postgresql_where=sa.text(
            "status = 'active' AND revoked_at IS NULL AND deleted_at IS NULL"
        ),
    )
    op.create_index(
        "vendor_portal_account_auth_provider_idx",
        "vendor_portal_account",
        ["auth_provider", "auth_provider_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "vendor_portal_account_entity_idx",
        "vendor_portal_account",
        ["entity_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "vendor_portal_account_contractor_idx",
        "vendor_portal_account",
        ["contractor_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "vendor_portal_account_contractor_idx", table_name="vendor_portal_account"
    )
    op.drop_index(
        "vendor_portal_account_entity_idx", table_name="vendor_portal_account"
    )
    op.drop_index(
        "vendor_portal_account_auth_provider_idx",
        table_name="vendor_portal_account",
    )
    op.drop_index(
        "vendor_portal_account_auth_provider_active_idx",
        table_name="vendor_portal_account",
    )
    op.drop_index(
        "vendor_portal_account_auth_provider_contractor_active_idx",
        table_name="vendor_portal_account",
    )
    op.drop_table("vendor_portal_account")
    op.drop_index(
        "vendor_portal_invite_contractor_idx", table_name="vendor_portal_invite"
    )
    op.drop_index(
        "vendor_portal_invite_entity_idx", table_name="vendor_portal_invite"
    )
    op.drop_index(
        "vendor_portal_invite_token_hash_idx",
        table_name="vendor_portal_invite",
    )
    op.drop_table("vendor_portal_invite")
    vendor_portal_account_status.drop(op.get_bind(), checkfirst=True)
