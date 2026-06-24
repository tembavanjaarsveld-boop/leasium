"""workflow rules

Revision ID: 20260621_0047
Revises: 20260619_0046
Create Date: 2026-06-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260621_0047"
down_revision: str | None = "20260619_0046"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


workflow_trigger_type = postgresql.ENUM(
    "lease_expiring",
    "arrears_threshold",
    "compliance_due",
    name="workflow_trigger_type",
    create_type=False,
)
workflow_action_type = postgresql.ENUM(
    "create_task",
    "notify_operator",
    "queue_comms_draft",
    name="workflow_action_type",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    if is_postgres:
        workflow_trigger_type.create(bind, checkfirst=True)
        workflow_action_type.create(bind, checkfirst=True)

    trigger_type = (
        workflow_trigger_type
        if is_postgres
        else sa.Enum(
            "lease_expiring",
            "arrears_threshold",
            "compliance_due",
            name="workflow_trigger_type",
        )
    )
    json_type = postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON()
    json_object_default = sa.text("'{}'::jsonb") if is_postgres else sa.text("'{}'")
    json_array_default = sa.text("'[]'::jsonb") if is_postgres else sa.text("'[]'")

    op.create_table(
        "workflow_rule",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("trigger_type", trigger_type, nullable=False),
        sa.Column(
            "trigger_config",
            json_type,
            nullable=False,
            server_default=json_object_default,
        ),
        sa.Column("actions", json_type, nullable=False, server_default=json_array_default),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("last_evaluated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metadata", json_type, nullable=False, server_default=json_object_default),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["entity_id"],
            ["entity.id"],
            name=op.f("fk_workflow_rule_entity_id_entity"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_workflow_rule")),
    )
    op.alter_column("workflow_rule", "trigger_config", server_default=None)
    op.alter_column("workflow_rule", "actions", server_default=None)
    op.alter_column("workflow_rule", "enabled", server_default=None)
    op.alter_column("workflow_rule", "metadata", server_default=None)
    op.create_index(
        "workflow_rule_entity_enabled_idx",
        "workflow_rule",
        ["entity_id", "enabled"],
        postgresql_where=sa.text("deleted_at IS NULL"),
        sqlite_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "workflow_rule_entity_idx",
        "workflow_rule",
        ["entity_id"],
        postgresql_where=sa.text("deleted_at IS NULL"),
        sqlite_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("workflow_rule_entity_idx", table_name="workflow_rule")
    op.drop_index("workflow_rule_entity_enabled_idx", table_name="workflow_rule")
    op.drop_table("workflow_rule")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        workflow_action_type.drop(bind, checkfirst=True)
        workflow_trigger_type.drop(bind, checkfirst=True)
