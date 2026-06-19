"""document intake applying status

Revision ID: 20260619_0046
Revises: 20260616_0045
Create Date: 2026-06-19
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260619_0046"
down_revision: str | None = "20260616_0045"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE document_intake_status ADD VALUE IF NOT EXISTS 'applying'")


def downgrade() -> None:
    pass
