"""ai mailbox intake foundation

Revision ID: 20260612_0043
Revises: 20260609_0042
Create Date: 2026-06-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260612_0043"
down_revision: str | None = "20260609_0042"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    json_type = postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON()
    metadata_default = sa.text("'{}'::jsonb") if is_postgres else sa.text("'{}'")

    op.create_table(
        "trusted_sender",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organisation_id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("label", sa.Text(), nullable=True),
        sa.Column("added_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["organisation_id"],
            ["organisation.id"],
            name=op.f("fk_trusted_sender_organisation_id_organisation"),
        ),
        sa.ForeignKeyConstraint(
            ["added_by_user_id"],
            ["app_user.id"],
            name=op.f("fk_trusted_sender_added_by_user_id_app_user"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_trusted_sender")),
    )
    op.create_index(
        "trusted_sender_org_email_active_idx",
        "trusted_sender",
        ["organisation_id", "email"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
        sqlite_where=sa.text("deleted_at IS NULL"),
    )

    op.add_column(
        "inbound_message",
        sa.Column(
            "source",
            sa.Text(),
            nullable=False,
            server_default="tenant_channel",
        ),
    )
    op.add_column(
        "inbound_message",
        sa.Column(
            "auth_result",
            json_type,
            nullable=False,
            server_default=metadata_default,
        ),
    )
    op.add_column(
        "inbound_message",
        sa.Column("trust_state", sa.Text(), nullable=False, server_default="trusted"),
    )
    op.add_column(
        "inbound_message",
        sa.Column("original_sender", sa.Text(), nullable=True),
    )
    op.alter_column("inbound_message", "source", server_default=None)
    op.alter_column("inbound_message", "auth_result", server_default=None)
    op.alter_column("inbound_message", "trust_state", server_default=None)
    op.create_index(
        "inbound_message_entity_source_trust_idx",
        "inbound_message",
        ["entity_id", "source", "trust_state"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
        sqlite_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "inbound_message_entity_source_trust_idx",
        table_name="inbound_message",
    )
    op.drop_column("inbound_message", "original_sender")
    op.drop_column("inbound_message", "trust_state")
    op.drop_column("inbound_message", "auth_result")
    op.drop_column("inbound_message", "source")
    op.drop_index("trusted_sender_org_email_active_idx", table_name="trusted_sender")
    op.drop_table("trusted_sender")
