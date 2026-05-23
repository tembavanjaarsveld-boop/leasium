"""contractor directory

Per-entity directory of maintenance contractors with categories, contact
details, priority, and notes. Future v2 wires the maintenance-categorisation
AI classifier to suggest a contractor on each work order; v1 is the directory
operators reference manually.

Revision ID: 20260523_0024
Revises: 20260523_0023
Create Date: 2026-05-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260523_0024"
down_revision: str | None = "20260523_0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    json_type = postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON()
    list_default = sa.text("'[]'::jsonb") if is_postgres else sa.text("'[]'")
    metadata_default = sa.text("'{}'::jsonb") if is_postgres else sa.text("'{}'")

    op.create_table(
        "contractor",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("company_name", sa.Text(), nullable=True),
        sa.Column(
            "categories",
            json_type,
            nullable=False,
            server_default=list_default,
        ),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column("phone", sa.Text(), nullable=True),
        sa.Column("service_radius_km", sa.Integer(), nullable=True),
        sa.Column(
            "priority",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("2"),
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "contractor_metadata",
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
            name=op.f("fk_contractor_entity_id_entity"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_contractor")),
    )

    op.alter_column("contractor", "categories", server_default=None)
    op.alter_column("contractor", "contractor_metadata", server_default=None)
    op.alter_column("contractor", "priority", server_default=None)

    op.create_index(
        "contractor_entity_idx",
        "contractor",
        ["entity_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("contractor_entity_idx", table_name="contractor")
    op.drop_table("contractor")
