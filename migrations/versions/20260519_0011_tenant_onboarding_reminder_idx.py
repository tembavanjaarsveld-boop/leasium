"""tenant onboarding reminder lookup index

Revision ID: 20260519_0011
Revises: 20260519_0010
Create Date: 2026-05-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260519_0011"
down_revision: str | None = "20260519_0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    kwargs = {}
    if bind.dialect.name == "postgresql":
        kwargs["postgresql_where"] = sa.text("deleted_at IS NULL")
    op.create_index(
        "tenant_onboarding_reminder_lookup_idx",
        "tenant_onboarding",
        ["entity_id", "status", "due_date"],
        **kwargs,
    )


def downgrade() -> None:
    op.drop_index("tenant_onboarding_reminder_lookup_idx", table_name="tenant_onboarding")
