"""obligation lease event uniqueness

Revision ID: 20260602_0034
Revises: 20260602_0033
Create Date: 2026-06-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260602_0034"
down_revision: str | None = "20260602_0033"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


LEASE_EVENT_OBLIGATION_POSTGRES_WHERE = (
    "lease_id IS NOT NULL "
    "AND deleted_at IS NULL "
    "AND metadata ->> 'source' = 'lease_calendar_follow_up'"
)
LEASE_EVENT_OBLIGATION_SQLITE_WHERE = (
    "lease_id IS NOT NULL "
    "AND deleted_at IS NULL "
    "AND json_extract(metadata, '$.source') = 'lease_calendar_follow_up'"
)


def upgrade() -> None:
    bind = op.get_bind()
    where_clause = (
        LEASE_EVENT_OBLIGATION_SQLITE_WHERE
        if bind.dialect.name == "sqlite"
        else LEASE_EVENT_OBLIGATION_POSTGRES_WHERE
    )
    duplicate = op.get_bind().execute(
        sa.text(
            f"""
            SELECT lease_id, category, due_date
            FROM obligation
            WHERE {where_clause}
            GROUP BY lease_id, category, due_date
            HAVING COUNT(*) > 1
            LIMIT 1
            """
        )
    ).first()
    if duplicate is not None:
        raise RuntimeError(
            "obligation has duplicate active lease-event obligations; soft-delete or "
            "merge duplicates before applying revision 20260602_0034."
        )

    op.create_index(
        "obligation_lease_event_unique_idx",
        "obligation",
        ["lease_id", "category", "due_date"],
        unique=True,
        postgresql_where=sa.text(LEASE_EVENT_OBLIGATION_POSTGRES_WHERE),
        sqlite_where=sa.text(LEASE_EVENT_OBLIGATION_SQLITE_WHERE),
    )


def downgrade() -> None:
    op.drop_index("obligation_lease_event_unique_idx", table_name="obligation")
