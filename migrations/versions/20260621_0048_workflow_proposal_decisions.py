"""workflow proposal decisions

Revision ID: 20260621_0048
Revises: 20260621_0047
Create Date: 2026-06-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260621_0048"
down_revision: str | None = "20260621_0047"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


workflow_action_type = postgresql.ENUM(
    "create_task",
    "notify_operator",
    "queue_comms_draft",
    name="workflow_action_type",
    create_type=False,
)
workflow_proposal_decision_status = postgresql.ENUM(
    "approved",
    "dismissed",
    name="workflow_proposal_decision_status",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    if is_postgres:
        workflow_action_type.create(bind, checkfirst=True)
        workflow_proposal_decision_status.create(bind, checkfirst=True)

    action_type = (
        workflow_action_type
        if is_postgres
        else sa.Enum(
            "create_task",
            "notify_operator",
            "queue_comms_draft",
            name="workflow_action_type",
        )
    )
    decision_status = (
        workflow_proposal_decision_status
        if is_postgres
        else sa.Enum("approved", "dismissed", name="workflow_proposal_decision_status")
    )
    json_type = postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON()

    op.create_table(
        "workflow_proposal_decision",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("rule_id", sa.Uuid(), nullable=False),
        sa.Column("dedupe_key", sa.Text(), nullable=False),
        sa.Column("target_table", sa.Text(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("action_type", action_type, nullable=False),
        sa.Column("decision", decision_status, nullable=False),
        sa.Column("decided_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("execution_result", json_type, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["decided_by_user_id"],
            ["app_user.id"],
            name=op.f("fk_workflow_proposal_decision_decided_by_user_id_app_user"),
        ),
        sa.ForeignKeyConstraint(
            ["entity_id"],
            ["entity.id"],
            name=op.f("fk_workflow_proposal_decision_entity_id_entity"),
        ),
        sa.ForeignKeyConstraint(
            ["rule_id"],
            ["workflow_rule.id"],
            name=op.f("fk_workflow_proposal_decision_rule_id_workflow_rule"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_workflow_proposal_decision")),
        sa.UniqueConstraint(
            "rule_id",
            "dedupe_key",
            name="uq_workflow_proposal_decision",
        ),
    )
    op.create_index(
        "workflow_proposal_decision_entity_idx",
        "workflow_proposal_decision",
        ["entity_id"],
    )
    op.create_index(
        "workflow_proposal_decision_rule_idx",
        "workflow_proposal_decision",
        ["rule_id"],
    )
    op.create_index(
        "workflow_proposal_decision_target_idx",
        "workflow_proposal_decision",
        ["target_table", "target_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "workflow_proposal_decision_target_idx",
        table_name="workflow_proposal_decision",
    )
    op.drop_index(
        "workflow_proposal_decision_rule_idx",
        table_name="workflow_proposal_decision",
    )
    op.drop_index(
        "workflow_proposal_decision_entity_idx",
        table_name="workflow_proposal_decision",
    )
    op.drop_table("workflow_proposal_decision")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        workflow_proposal_decision_status.drop(bind, checkfirst=True)
