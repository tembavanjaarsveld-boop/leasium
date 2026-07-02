"""lease unit links

Revision ID: 20260702_0052
Revises: 20260629_0051
Create Date: 2026-07-02
"""

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from stewart.core.ids import uuid7

revision: str = "20260702_0052"
down_revision: str | None = "20260629_0051"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

unit_apportionment_strategy = postgresql.ENUM(
    "percent",
    "area",
    "manual_amount",
    name="unit_apportionment_strategy",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    json_type = postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON()
    unit_apportionment_strategy.create(bind, checkfirst=True)

    op.add_column(
        "lease",
        sa.Column(
            "unit_apportionment_strategy",
            unit_apportionment_strategy,
            nullable=False,
            server_default="percent",
        ),
    )

    op.create_table(
        "lease_unit",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("lease_id", sa.Uuid(), nullable=False),
        sa.Column("tenancy_unit_id", sa.Uuid(), nullable=False),
        sa.Column("apportionment_percent", sa.Numeric(7, 4), nullable=True),
        sa.Column("apportionment_area_sqm", sa.Numeric(12, 2), nullable=True),
        sa.Column("manual_amount_cents", sa.Integer(), nullable=True),
        sa.Column("metadata", json_type, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["lease_id"],
            ["lease.id"],
            name=op.f("fk_lease_unit_lease_id_lease"),
        ),
        sa.ForeignKeyConstraint(
            ["tenancy_unit_id"],
            ["tenancy_unit.id"],
            name=op.f("fk_lease_unit_tenancy_unit_id_tenancy_unit"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_lease_unit")),
    )
    op.create_index(
        "lease_unit_lease_idx",
        "lease_unit",
        ["lease_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
        sqlite_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "lease_unit_tenancy_unit_idx",
        "lease_unit",
        ["tenancy_unit_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
        sqlite_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "lease_unit_active_unique_idx",
        "lease_unit",
        ["lease_id", "tenancy_unit_id"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
        sqlite_where=sa.text("deleted_at IS NULL"),
    )

    lease_unit_table = sa.table(
        "lease_unit",
        sa.column("id", sa.Uuid()),
        sa.column("lease_id", sa.Uuid()),
        sa.column("tenancy_unit_id", sa.Uuid()),
        sa.column("apportionment_percent", sa.Numeric(7, 4)),
        sa.column("metadata", json_type),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    now = datetime.now(UTC)
    lease_rows = bind.execute(
        sa.text(
            """
            SELECT id, tenancy_unit_id, created_at
            FROM lease
            WHERE deleted_at IS NULL
            """
        )
    ).mappings()
    for row in lease_rows:
        bind.execute(
            lease_unit_table.insert().values(
                {
                    "id": uuid7(),
                    "lease_id": row["id"],
                    "tenancy_unit_id": row["tenancy_unit_id"],
                    "apportionment_percent": 100,
                    "metadata": {},
                    "created_at": row["created_at"] or now,
                }
            )
        )


def downgrade() -> None:
    op.drop_index("lease_unit_active_unique_idx", table_name="lease_unit")
    op.drop_index("lease_unit_tenancy_unit_idx", table_name="lease_unit")
    op.drop_index("lease_unit_lease_idx", table_name="lease_unit")
    op.drop_table("lease_unit")
    op.drop_column("lease", "unit_apportionment_strategy")

    bind = op.get_bind()
    unit_apportionment_strategy.drop(bind, checkfirst=True)
