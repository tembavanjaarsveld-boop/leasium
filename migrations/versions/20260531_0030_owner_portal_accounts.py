"""owner portal account auth

Revision ID: 20260531_0030
Revises: 20260531_0029
Create Date: 2026-05-31
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260531_0030"
down_revision: str | None = "20260531_0029"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


owner_portal_account_status = postgresql.ENUM(
    "active",
    "revoked",
    name="owner_portal_account_status",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    json_type = postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON()
    metadata_default = sa.text("'{}'::jsonb") if is_postgres else sa.text("'{}'")
    status_type = (
        owner_portal_account_status
        if is_postgres
        else sa.Enum("active", "revoked", name="owner_portal_account_status")
    )
    if is_postgres:
        owner_portal_account_status.create(bind, checkfirst=True)

    op.create_table(
        "owner_portal_invite",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
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
            name=op.f("fk_owner_portal_invite_created_by_user_id_app_user"),
        ),
        sa.ForeignKeyConstraint(
            ["entity_id"],
            ["entity.id"],
            name=op.f("fk_owner_portal_invite_entity_id_entity"),
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"],
            ["owner.id"],
            name=op.f("fk_owner_portal_invite_owner_id_owner"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_owner_portal_invite")),
    )
    op.alter_column("owner_portal_invite", "metadata", server_default=None)
    op.create_index(
        "owner_portal_invite_token_hash_idx",
        "owner_portal_invite",
        ["token_hash"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "owner_portal_invite_entity_idx",
        "owner_portal_invite",
        ["entity_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "owner_portal_invite_owner_idx",
        "owner_portal_invite",
        ["owner_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    op.create_table(
        "owner_portal_account",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("owner_portal_invite_id", sa.Uuid(), nullable=True),
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
            ["entity_id"],
            ["entity.id"],
            name=op.f("fk_owner_portal_account_entity_id_entity"),
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"],
            ["owner.id"],
            name=op.f("fk_owner_portal_account_owner_id_owner"),
        ),
        sa.ForeignKeyConstraint(
            ["owner_portal_invite_id"],
            ["owner_portal_invite.id"],
            name=op.f(
                "fk_owner_portal_account_owner_portal_invite_id_owner_portal_invite"
            ),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_owner_portal_account")),
    )
    op.alter_column("owner_portal_account", "metadata", server_default=None)
    op.create_index(
        "owner_portal_account_auth_provider_owner_active_idx",
        "owner_portal_account",
        ["auth_provider", "auth_provider_id", "owner_id"],
        unique=True,
        postgresql_where=sa.text(
            "status = 'active' AND revoked_at IS NULL AND deleted_at IS NULL"
        ),
    )
    op.create_index(
        "owner_portal_account_auth_provider_idx",
        "owner_portal_account",
        ["auth_provider", "auth_provider_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "owner_portal_account_entity_idx",
        "owner_portal_account",
        ["entity_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "owner_portal_account_owner_idx",
        "owner_portal_account",
        ["owner_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("owner_portal_account_owner_idx", table_name="owner_portal_account")
    op.drop_index("owner_portal_account_entity_idx", table_name="owner_portal_account")
    op.drop_index(
        "owner_portal_account_auth_provider_idx",
        table_name="owner_portal_account",
    )
    op.drop_index(
        "owner_portal_account_auth_provider_owner_active_idx",
        table_name="owner_portal_account",
    )
    op.drop_table("owner_portal_account")
    op.drop_index("owner_portal_invite_owner_idx", table_name="owner_portal_invite")
    op.drop_index("owner_portal_invite_entity_idx", table_name="owner_portal_invite")
    op.drop_index(
        "owner_portal_invite_token_hash_idx",
        table_name="owner_portal_invite",
    )
    op.drop_table("owner_portal_invite")
    owner_portal_account_status.drop(op.get_bind(), checkfirst=True)
