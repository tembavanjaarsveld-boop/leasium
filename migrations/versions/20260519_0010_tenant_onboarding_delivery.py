"""tenant onboarding delivery metadata

Revision ID: 20260519_0010
Revises: 20260519_0009
Create Date: 2026-05-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260519_0010"
down_revision: str | None = "20260519_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    op.add_column(
        "tenant_onboarding",
        sa.Column(
            "delivery_data",
            postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON(),
            server_default=sa.text("'{}'::jsonb") if is_postgres else sa.text("'{}'"),
            nullable=False,
        ),
    )
    op.alter_column("tenant_onboarding", "delivery_data", server_default=None)


def downgrade() -> None:
    op.drop_column("tenant_onboarding", "delivery_data")
