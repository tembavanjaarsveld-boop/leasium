"""platform admin tier

Adds the platform-admin access tier columns:

- ``app_user.is_platform_admin`` (Boolean, NOT NULL, server_default false).
  Platform admins are normal ``app_user`` rows under the reserved "Leasium
  Platform" organisation; cross-org privilege comes from this flag, not from
  that org's data. Existing rows backfill to false.
- ``organisation.suspended_at`` (timestamptz, nullable). Reversible, audited
  client suspension toggled from the platform tier. NULL = active; a timestamp
  = suspended (the auth resolver rejects logins for the org). Never deletes
  data — restore clears it.

See docs/platform-admin-tier-ia.md.

Revision ID: 20260609_0041
Revises: 20260609_0040
Create Date: 2026-06-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260609_0041"
down_revision: str | None = "20260609_0040"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "app_user",
        sa.Column(
            "is_platform_admin",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "organisation",
        sa.Column("suspended_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("organisation", "suspended_at")
    op.drop_column("app_user", "is_platform_admin")
