"""property ownership billing profile

Revision ID: 20260519_0012
Revises: 20260519_0011
Create Date: 2026-05-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260519_0012"
down_revision: str | None = "20260519_0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("property", sa.Column("ownership_structure", sa.Text(), nullable=True))
    op.add_column("property", sa.Column("owner_legal_name", sa.Text(), nullable=True))
    op.add_column("property", sa.Column("owner_abn", sa.Text(), nullable=True))
    op.add_column("property", sa.Column("trustee_name", sa.Text(), nullable=True))
    op.add_column("property", sa.Column("trust_name", sa.Text(), nullable=True))
    op.add_column("property", sa.Column("invoice_issuer_name", sa.Text(), nullable=True))
    op.add_column("property", sa.Column("billing_contact_name", sa.Text(), nullable=True))
    op.add_column("property", sa.Column("billing_email", sa.Text(), nullable=True))
    op.add_column("property", sa.Column("invoice_reference", sa.Text(), nullable=True))
    op.add_column("property", sa.Column("ownership_split", sa.Text(), nullable=True))
    op.add_column("property", sa.Column("owner_gst_registered", sa.Boolean(), nullable=True))
    op.add_column("property", sa.Column("xero_contact_id", sa.Text(), nullable=True))
    op.add_column("property", sa.Column("xero_tracking_category", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("property", "xero_tracking_category")
    op.drop_column("property", "xero_contact_id")
    op.drop_column("property", "owner_gst_registered")
    op.drop_column("property", "ownership_split")
    op.drop_column("property", "invoice_reference")
    op.drop_column("property", "billing_email")
    op.drop_column("property", "billing_contact_name")
    op.drop_column("property", "invoice_issuer_name")
    op.drop_column("property", "trust_name")
    op.drop_column("property", "trustee_name")
    op.drop_column("property", "owner_abn")
    op.drop_column("property", "owner_legal_name")
    op.drop_column("property", "ownership_structure")
