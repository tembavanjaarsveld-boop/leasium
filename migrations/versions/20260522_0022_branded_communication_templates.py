"""branded communication templates

Revision ID: 20260522_0022
Revises: 20260521_0021
Create Date: 2026-05-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260522_0022"
down_revision: str | None = "20260521_0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    json_type = postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON()
    metadata_default = sa.text("'{}'::jsonb") if is_postgres else sa.text("'{}'")

    op.create_table(
        "branded_communication_template",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("version", sa.Text(), nullable=False),
        sa.Column("channel", sa.Text(), nullable=False),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("subject_template", sa.Text(), nullable=True),
        sa.Column("body_template", sa.Text(), nullable=False),
        sa.Column("action_label", sa.Text(), nullable=True),
        sa.Column("action_url_template", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "is_system",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "template_metadata",
            json_type,
            nullable=False,
            server_default=metadata_default,
        ),
        sa.ForeignKeyConstraint(
            ["entity_id"],
            ["entity.id"],
            name=op.f("fk_branded_communication_template_entity_id_entity"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["app_user.id"],
            name=op.f(
                "fk_branded_communication_template_created_by_user_id_app_user"
            ),
        ),
        sa.PrimaryKeyConstraint(
            "id", name=op.f("pk_branded_communication_template")
        ),
    )

    op.alter_column(
        "branded_communication_template",
        "template_metadata",
        server_default=None,
    )
    op.alter_column(
        "branded_communication_template",
        "is_active",
        server_default=None,
    )
    op.alter_column(
        "branded_communication_template",
        "is_system",
        server_default=None,
    )

    op.create_index(
        "branded_communication_template_entity_active_idx",
        "branded_communication_template",
        ["entity_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "branded_communication_template_key_version_idx",
        "branded_communication_template",
        ["entity_id", "key", "version"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL AND is_active = true"),
    )


def downgrade() -> None:
    op.drop_index(
        "branded_communication_template_key_version_idx",
        table_name="branded_communication_template",
    )
    op.drop_index(
        "branded_communication_template_entity_active_idx",
        table_name="branded_communication_template",
    )
    op.drop_table("branded_communication_template")
