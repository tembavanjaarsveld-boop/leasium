"""owner statement dispatch receipts

Receipts for reviewed owner-statement email dispatch. Owner statements are
derived on the fly from Property + InvoiceDraft data (no owner table), so the
dispatch receipt + idempotency state lives in its own table. Rows are only
written by the explicit operator-approved send endpoint, never automatically.

Revision ID: 20260530_0027
Revises: 20260524_0026
Create Date: 2026-05-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260530_0027"
down_revision: str | None = "20260524_0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    json_type = postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON()
    metadata_default = sa.text("'{}'::jsonb") if is_postgres else sa.text("'{}'")

    op.create_table(
        "owner_statement_dispatch",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("owner_identity", sa.Text(), nullable=False),
        sa.Column("owner_identity_key", sa.Text(), nullable=False),
        sa.Column("month", sa.Text(), nullable=False),
        sa.Column(
            "channel",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'email'"),
        ),
        sa.Column("provider", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("recipient_email", sa.Text(), nullable=True),
        sa.Column("subject", sa.Text(), nullable=True),
        sa.Column("provider_message_id", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "invoice_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "invoiced_cents",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "outstanding_cents",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "dispatch_metadata",
            json_type,
            nullable=False,
            server_default=metadata_default,
        ),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["entity_id"],
            ["entity.id"],
            name=op.f("fk_owner_statement_dispatch_entity_id_entity"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["app_user.id"],
            name=op.f("fk_owner_statement_dispatch_created_by_user_id_app_user"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_owner_statement_dispatch")),
    )

    op.alter_column("owner_statement_dispatch", "channel", server_default=None)
    op.alter_column("owner_statement_dispatch", "invoice_count", server_default=None)
    op.alter_column("owner_statement_dispatch", "invoiced_cents", server_default=None)
    op.alter_column(
        "owner_statement_dispatch", "outstanding_cents", server_default=None
    )
    op.alter_column(
        "owner_statement_dispatch", "dispatch_metadata", server_default=None
    )

    op.create_index(
        "owner_statement_dispatch_lookup_idx",
        "owner_statement_dispatch",
        ["entity_id", "owner_identity_key", "month"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "owner_statement_dispatch_lookup_idx",
        table_name="owner_statement_dispatch",
    )
    op.drop_table("owner_statement_dispatch")
