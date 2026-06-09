"""entity type and managing flag

Adds ``entity_type`` (Text, nullable) and ``is_managing_entity`` (Boolean,
nullable) to ``entity``.

``entity_type`` captures the legal structure (trust/company/smsf/individual/
partnership). Nullable with no backfill: existing rows are left unset so the
operator classifies them deliberately rather than us guessing a legal type.

``is_managing_entity`` flags the entity that *manages* the portfolio (e.g. SKJ
Property Pty Ltd) versus the owning entities. Nullable; unused behaviourally in
Structure A (managing entity = account identity only). Reserved for the
managing-agent GTM phase (Structure B inter-entity fee flows). See
docs/multi-entity-xero-ia.md.

Revision ID: 20260609_0040
Revises: 20260608_0039
Create Date: 2026-06-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260609_0040"
down_revision: str | None = "20260608_0039"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("entity", sa.Column("entity_type", sa.Text(), nullable=True))
    op.add_column("entity", sa.Column("is_managing_entity", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("entity", "is_managing_entity")
    op.drop_column("entity", "entity_type")
