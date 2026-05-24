"""tenant_onboarding.token_consumed_at — soft-switch portal claim gate

Adds the timestamp the tenant-portal claim flow stamps when a Clerk
account successfully links via a token. After this is set, every token-
scoped portal endpoint refuses the token (the only thing the token can
still do is let the SAME Clerk user refresh their existing account
link — the claim endpoint allows that path explicitly). Closes the
soft-switch loop on the tenant portal: once claimed, the magic-link is
dead and only Clerk-authed access works.

Revision ID: 20260524_0026
Revises: 20260524_0025
Create Date: 2026-05-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260524_0026"
down_revision: str | None = "20260524_0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "tenant_onboarding",
        sa.Column(
            "token_consumed_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("tenant_onboarding", "token_consumed_at")
