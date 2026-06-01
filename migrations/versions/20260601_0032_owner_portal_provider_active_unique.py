"""owner portal active provider uniqueness

Revision ID: 20260601_0032
Revises: 20260531_0031
Create Date: 2026-06-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260601_0032"
down_revision: str | None = "20260531_0031"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


ACTIVE_PROVIDER_WHERE = (
    "status = 'active' AND revoked_at IS NULL AND deleted_at IS NULL"
)


def upgrade() -> None:
    duplicate = op.get_bind().execute(
        sa.text(
            """
            SELECT auth_provider, auth_provider_id
            FROM owner_portal_account
            WHERE status = 'active'
              AND revoked_at IS NULL
              AND deleted_at IS NULL
            GROUP BY auth_provider, auth_provider_id
            HAVING COUNT(*) > 1
            LIMIT 1
            """
        )
    ).first()
    if duplicate is not None:
        raise RuntimeError(
            "owner_portal_account has duplicate active provider links; revoke or "
            "soft-delete duplicates before applying revision 20260601_0032."
        )

    op.create_index(
        "owner_portal_account_auth_provider_active_idx",
        "owner_portal_account",
        ["auth_provider", "auth_provider_id"],
        unique=True,
        postgresql_where=sa.text(ACTIVE_PROVIDER_WHERE),
        sqlite_where=sa.text(ACTIVE_PROVIDER_WHERE),
    )


def downgrade() -> None:
    op.drop_index(
        "owner_portal_account_auth_provider_active_idx",
        table_name="owner_portal_account",
    )
