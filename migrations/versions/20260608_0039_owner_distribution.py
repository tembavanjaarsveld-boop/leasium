"""owner distribution reviewed records

Reviewed owner distributions: rent collected, the management fee (ex-GST, GST,
inc-GST), and the net distribution owed to a third-party owner client. Owner
distributions are derived on the fly from owner statements plus the owner's
``management_fee_pct``; this table only persists the reviewed snapshot an
operator has explicitly approved per owner + month. Rows are only written by
the explicit operator-approved review endpoint, never automatically, and
writing one moves no money.

Revision ID: 20260608_0039
Revises: 20260608_0038
Create Date: 2026-06-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260608_0039"
down_revision: str | None = "20260608_0038"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    json_type = postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON()
    metadata_default = sa.text("'{}'::jsonb") if is_postgres else sa.text("'{}'")

    op.create_table(
        "owner_distribution",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=True),
        sa.Column("owner_identity", sa.Text(), nullable=False),
        sa.Column("owner_identity_key", sa.Text(), nullable=False),
        sa.Column("month", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'reviewed'"),
        ),
        sa.Column(
            "rent_collected_cents",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "management_fee_pct", sa.Numeric(precision=5, scale=3), nullable=True
        ),
        sa.Column(
            "fee_ex_gst_cents",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "fee_gst_cents",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "fee_inc_gst_cents",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "net_distribution_cents",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "distribution_metadata",
            json_type,
            nullable=False,
            server_default=metadata_default,
        ),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("reviewed_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["entity_id"],
            ["entity.id"],
            name=op.f("fk_owner_distribution_entity_id_entity"),
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"],
            ["owner.id"],
            name=op.f("fk_owner_distribution_owner_id_owner"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["app_user.id"],
            name=op.f("fk_owner_distribution_created_by_user_id_app_user"),
        ),
        sa.ForeignKeyConstraint(
            ["reviewed_by_user_id"],
            ["app_user.id"],
            name=op.f("fk_owner_distribution_reviewed_by_user_id_app_user"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_owner_distribution")),
    )

    op.alter_column("owner_distribution", "status", server_default=None)
    op.alter_column("owner_distribution", "rent_collected_cents", server_default=None)
    op.alter_column("owner_distribution", "fee_ex_gst_cents", server_default=None)
    op.alter_column("owner_distribution", "fee_gst_cents", server_default=None)
    op.alter_column("owner_distribution", "fee_inc_gst_cents", server_default=None)
    op.alter_column(
        "owner_distribution", "net_distribution_cents", server_default=None
    )
    op.alter_column(
        "owner_distribution", "distribution_metadata", server_default=None
    )

    op.create_index(
        "owner_distribution_lookup_idx",
        "owner_distribution",
        ["entity_id", "owner_identity_key", "month"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "owner_distribution_lookup_idx",
        table_name="owner_distribution",
    )
    op.drop_table("owner_distribution")
