"""operator notification preferences

Revision ID: 20260521_0021
Revises: 20260521_0020
Create Date: 2026-05-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260521_0021"
down_revision: str | None = "20260521_0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    json_type = postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON()
    server_default = sa.text("'{}'::jsonb") if is_postgres else sa.text("'{}'")

    op.add_column(
        "app_user",
        sa.Column(
            "notification_preferences",
            json_type,
            nullable=False,
            server_default=server_default,
        ),
    )
    op.alter_column("app_user", "notification_preferences", server_default=None)


def downgrade() -> None:
    op.drop_column("app_user", "notification_preferences")
