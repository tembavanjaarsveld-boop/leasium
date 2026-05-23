"""inbound messages

Persistence for inbound channel parsing (SendGrid Inbound Parse / Twilio
inbound webhook). Each row is a single parsed inbound message classified
by the existing /api/v1/ai/triage shape and attributed to a tenant / lease
where possible. The comms queue surfaces unprocessed rows as
``inbound_email`` candidates the operator can review and reply to.

Revision ID: 20260523_0023
Revises: 20260522_0022
Create Date: 2026-05-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260523_0023"
down_revision: str | None = "20260522_0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    json_type = postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON()
    metadata_default = sa.text("'{}'::jsonb") if is_postgres else sa.text("'{}'")

    op.create_table(
        "inbound_message",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("channel", sa.Text(), nullable=False),  # email / sms / whatsapp
        sa.Column("provider", sa.Text(), nullable=True),
        sa.Column("from_address", sa.Text(), nullable=True),
        sa.Column("from_name", sa.Text(), nullable=True),
        sa.Column("to_address", sa.Text(), nullable=True),
        sa.Column("subject", sa.Text(), nullable=True),
        sa.Column("body_text", sa.Text(), nullable=True),
        sa.Column("body_html", sa.Text(), nullable=True),
        sa.Column("classification_kind", sa.Text(), nullable=True),
        sa.Column("classification_confidence", sa.Numeric(3, 2), nullable=True),
        sa.Column("classification_summary", sa.Text(), nullable=True),
        sa.Column("classification_target_kind", sa.Text(), nullable=True),
        sa.Column("classification_target_id", sa.Uuid(), nullable=True),
        sa.Column("attributed_tenant_id", sa.Uuid(), nullable=True),
        sa.Column("attributed_lease_id", sa.Uuid(), nullable=True),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "raw_payload",
            json_type,
            nullable=False,
            server_default=metadata_default,
        ),
        sa.Column(
            "inbound_metadata",
            json_type,
            nullable=False,
            server_default=metadata_default,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["entity_id"],
            ["entity.id"],
            name=op.f("fk_inbound_message_entity_id_entity"),
        ),
        sa.ForeignKeyConstraint(
            ["attributed_tenant_id"],
            ["tenant.id"],
            name=op.f("fk_inbound_message_attributed_tenant_id_tenant"),
        ),
        sa.ForeignKeyConstraint(
            ["attributed_lease_id"],
            ["lease.id"],
            name=op.f("fk_inbound_message_attributed_lease_id_lease"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_inbound_message")),
    )

    op.alter_column(
        "inbound_message",
        "raw_payload",
        server_default=None,
    )
    op.alter_column(
        "inbound_message",
        "inbound_metadata",
        server_default=None,
    )

    op.create_index(
        "inbound_message_entity_pending_idx",
        "inbound_message",
        ["entity_id"],
        unique=False,
        postgresql_where=sa.text(
            "deleted_at IS NULL AND processed_at IS NULL AND archived_at IS NULL"
        ),
    )
    op.create_index(
        "inbound_message_tenant_idx",
        "inbound_message",
        ["attributed_tenant_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("inbound_message_tenant_idx", table_name="inbound_message")
    op.drop_index(
        "inbound_message_entity_pending_idx", table_name="inbound_message"
    )
    op.drop_table("inbound_message")
