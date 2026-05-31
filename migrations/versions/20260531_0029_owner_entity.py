"""owner entity + property_owner association

First-class ``Owner`` record (DoorLoop benchmark P0). The legacy per-``Property``
owner fields remain as a backfill source until the read paths (owner statements,
billing identity) are cut over; this migration only creates the new tables and
does not move any data. Backfill lands in a later revision (Ticket 1.2).

Revision ID: 20260531_0029
Revises: 20260531_0028
Create Date: 2026-05-31
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260531_0029"
down_revision: str | None = "20260531_0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    json_type = postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON()
    metadata_default = sa.text("'{}'::jsonb") if is_postgres else sa.text("'{}'")

    op.create_table(
        "owner",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("legal_name", sa.Text(), nullable=True),
        sa.Column("abn", sa.Text(), nullable=True),
        sa.Column("trustee_name", sa.Text(), nullable=True),
        sa.Column("trust_name", sa.Text(), nullable=True),
        sa.Column("invoice_issuer_name", sa.Text(), nullable=True),
        sa.Column("billing_contact_name", sa.Text(), nullable=True),
        sa.Column("billing_email", sa.Text(), nullable=True),
        sa.Column("invoice_reference", sa.Text(), nullable=True),
        sa.Column("gst_registered", sa.Boolean(), nullable=True),
        sa.Column("xero_contact_id", sa.Text(), nullable=True),
        sa.Column(
            "owner_metadata",
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
            name=op.f("fk_owner_entity_id_entity"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_owner")),
    )
    op.alter_column("owner", "owner_metadata", server_default=None)
    op.create_index(
        "owner_entity_idx",
        "owner",
        ["entity_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    op.create_table(
        "property_owner",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("property_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column(
            "split_pct",
            sa.Numeric(precision=6, scale=3),
            nullable=False,
            server_default=sa.text("100"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["property_id"],
            ["property.id"],
            name=op.f("fk_property_owner_property_id_property"),
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"],
            ["owner.id"],
            name=op.f("fk_property_owner_owner_id_owner"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_property_owner")),
        sa.UniqueConstraint("property_id", "owner_id", name="property_owner_unique"),
    )
    op.alter_column("property_owner", "split_pct", server_default=None)
    op.create_index(
        "property_owner_owner_idx", "property_owner", ["owner_id"], unique=False
    )
    op.create_index(
        "property_owner_property_idx", "property_owner", ["property_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("property_owner_property_idx", table_name="property_owner")
    op.drop_index("property_owner_owner_idx", table_name="property_owner")
    op.drop_table("property_owner")
    op.drop_index("owner_entity_idx", table_name="owner")
    op.drop_table("owner")
