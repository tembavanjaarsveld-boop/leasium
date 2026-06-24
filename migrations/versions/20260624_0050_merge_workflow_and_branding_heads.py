"""merge workflow and entity-branding heads

Revision ID: 20260624_0050
Revises: 20260621_0048, 20260623_0049
Create Date: 2026-06-24

Merge revision reconciling the two heads that both descend from
20260619_0046: the local workflow slice (0047 -> 0048) and the shipped
entity-branding migration (0049, which intentionally bypassed the unmerged
workflow migrations). No schema changes; this only rejoins the Alembic
history into a single head so `alembic upgrade head` is unambiguous.
"""

from collections.abc import Sequence

revision: str = "20260624_0050"
down_revision: tuple[str, str] = ("20260621_0048", "20260623_0049")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
