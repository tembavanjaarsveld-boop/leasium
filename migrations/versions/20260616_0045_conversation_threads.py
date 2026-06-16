"""conversation threads

Revision ID: 20260616_0045
Revises: 20260614_0044
Create Date: 2026-06-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260616_0045"
down_revision: str | None = "20260614_0044"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


conversation_turn_role = postgresql.ENUM(
    "user",
    "ai",
    name="conversation_turn_role",
    create_type=False,
)
conversation_turn_kind = postgresql.ENUM(
    "text",
    "understanding",
    "plan",
    "created",
    "question",
    name="conversation_turn_kind",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    if is_postgres:
        conversation_turn_role.create(bind, checkfirst=True)
        conversation_turn_kind.create(bind, checkfirst=True)

    role_type = (
        conversation_turn_role
        if is_postgres
        else sa.Enum("user", "ai", name="conversation_turn_role")
    )
    kind_type = (
        conversation_turn_kind
        if is_postgres
        else sa.Enum(
            "text",
            "understanding",
            "plan",
            "created",
            "question",
            name="conversation_turn_kind",
        )
    )
    json_type = postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON()
    json_default = sa.text("'{}'::jsonb") if is_postgres else sa.text("'{}'")

    op.create_table(
        "conversation_thread",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organisation_id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=True),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("source", sa.Text(), nullable=False, server_default="cmdk"),
        sa.Column("context_route", sa.Text(), nullable=True),
        sa.Column(
            "context_record_refs",
            json_type,
            nullable=False,
            server_default=json_default,
        ),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column(
            "thread_metadata",
            json_type,
            nullable=False,
            server_default=json_default,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["app_user.id"],
            name=op.f("fk_conversation_thread_created_by_user_id_app_user"),
        ),
        sa.ForeignKeyConstraint(
            ["entity_id"],
            ["entity.id"],
            name=op.f("fk_conversation_thread_entity_id_entity"),
        ),
        sa.ForeignKeyConstraint(
            ["organisation_id"],
            ["organisation.id"],
            name=op.f("fk_conversation_thread_organisation_id_organisation"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_conversation_thread")),
    )
    op.alter_column("conversation_thread", "source", server_default=None)
    op.alter_column("conversation_thread", "context_record_refs", server_default=None)
    op.alter_column("conversation_thread", "thread_metadata", server_default=None)
    op.create_index(
        "conversation_thread_org_recent_idx",
        "conversation_thread",
        ["organisation_id", "updated_at"],
        postgresql_where=sa.text("deleted_at IS NULL"),
        sqlite_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "conversation_thread_entity_recent_idx",
        "conversation_thread",
        ["entity_id", "updated_at"],
        postgresql_where=sa.text("deleted_at IS NULL"),
        sqlite_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "conversation_thread_created_by_idx",
        "conversation_thread",
        ["created_by_user_id"],
    )

    op.create_table(
        "conversation_turn",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("thread_id", sa.Uuid(), nullable=False),
        sa.Column("role", role_type, nullable=False),
        sa.Column("kind", kind_type, nullable=False),
        sa.Column("payload", json_type, nullable=False, server_default=json_default),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["thread_id"],
            ["conversation_thread.id"],
            name=op.f("fk_conversation_turn_thread_id_conversation_thread"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_conversation_turn")),
    )
    op.alter_column("conversation_turn", "payload", server_default=None)
    op.create_index(
        "conversation_turn_thread_created_idx",
        "conversation_turn",
        ["thread_id", "created_at", "id"],
    )


def downgrade() -> None:
    op.drop_index("conversation_turn_thread_created_idx", table_name="conversation_turn")
    op.drop_table("conversation_turn")
    op.drop_index(
        "conversation_thread_created_by_idx",
        table_name="conversation_thread",
    )
    op.drop_index(
        "conversation_thread_entity_recent_idx",
        table_name="conversation_thread",
    )
    op.drop_index(
        "conversation_thread_org_recent_idx",
        table_name="conversation_thread",
    )
    op.drop_table("conversation_thread")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        conversation_turn_kind.drop(bind, checkfirst=True)
        conversation_turn_role.drop(bind, checkfirst=True)
