"""operator invites

Revision ID: 20260520_0015
Revises: 20260519_0014
Create Date: 2026-05-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260520_0015"
down_revision: str | None = "20260519_0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


operator_invite_status = postgresql.ENUM(
    "not_sent",
    "sent",
    "accepted",
    "expired",
    "revoked",
    "failed",
    "skipped",
    name="operator_invite_status",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    operator_invite_status.create(bind, checkfirst=True)

    op.add_column(
        "app_user",
        sa.Column(
            "invite_status",
            operator_invite_status,
            nullable=False,
            server_default="not_sent",
        ),
    )
    op.add_column("app_user", sa.Column("invite_token_hash", sa.Text(), nullable=True))
    op.add_column(
        "app_user", sa.Column("invite_sent_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "app_user", sa.Column("invite_expires_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "app_user", sa.Column("invite_accepted_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("app_user", sa.Column("invite_last_error", sa.Text(), nullable=True))
    op.add_column("app_user", sa.Column("invite_provider_message_id", sa.Text(), nullable=True))
    op.add_column("app_user", sa.Column("invited_by_user_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_app_user_invited_by_user_id_app_user"),
        "app_user",
        "app_user",
        ["invited_by_user_id"],
        ["id"],
    )
    op.create_index(
        "app_user_auth_provider_id_idx",
        "app_user",
        ["auth_provider_id"],
        unique=True,
        postgresql_where=sa.text("auth_provider_id IS NOT NULL"),
    )
    op.create_index(
        "app_user_invite_token_hash_idx",
        "app_user",
        ["invite_token_hash"],
        unique=True,
        postgresql_where=sa.text("invite_token_hash IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("app_user_invite_token_hash_idx", table_name="app_user")
    op.drop_index("app_user_auth_provider_id_idx", table_name="app_user")
    op.drop_constraint(
        op.f("fk_app_user_invited_by_user_id_app_user"),
        "app_user",
        type_="foreignkey",
    )
    op.drop_column("app_user", "invited_by_user_id")
    op.drop_column("app_user", "invite_provider_message_id")
    op.drop_column("app_user", "invite_last_error")
    op.drop_column("app_user", "invite_accepted_at")
    op.drop_column("app_user", "invite_expires_at")
    op.drop_column("app_user", "invite_sent_at")
    op.drop_column("app_user", "invite_token_hash")
    op.drop_column("app_user", "invite_status")

    bind = op.get_bind()
    operator_invite_status.drop(bind, checkfirst=True)
