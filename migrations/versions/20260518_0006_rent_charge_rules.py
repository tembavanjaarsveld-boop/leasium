"""rent charge rules and billing readiness

Revision ID: 20260518_0006
Revises: 20260518_0005
Create Date: 2026-05-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260518_0006"
down_revision: str | None = "20260518_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


rent_charge_type = postgresql.ENUM(
    "base_rent",
    "outgoings",
    "promotion_levy",
    "utilities",
    "parking",
    "storage",
    "other",
    name="rent_charge_type",
    create_type=False,
)
gst_treatment = postgresql.ENUM(
    "taxable",
    "gst_free",
    "input_taxed",
    "out_of_scope",
    name="gst_treatment",
    create_type=False,
)
rent_frequency = postgresql.ENUM(
    "weekly",
    "monthly",
    "quarterly",
    "annual",
    name="rent_frequency",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    rent_charge_type.create(bind, checkfirst=True)
    gst_treatment.create(bind, checkfirst=True)

    op.create_table(
        "rent_charge_rule",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("lease_id", sa.Uuid(), nullable=False),
        sa.Column("charge_type", rent_charge_type, nullable=False),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("frequency", rent_frequency, nullable=False),
        sa.Column("gst_treatment", gst_treatment, nullable=False),
        sa.Column("xero_account_code", sa.Text(), nullable=True),
        sa.Column("xero_tax_type", sa.Text(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("next_due_date", sa.Date(), nullable=True),
        sa.Column("arrears_or_advance", sa.Text(), nullable=False),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["lease_id"], ["lease.id"], name=op.f("fk_rent_charge_rule_lease_id_lease")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_rent_charge_rule")),
    )
    op.create_index(
        "rent_charge_rule_lease_idx",
        "rent_charge_rule",
        ["lease_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "rent_charge_rule_next_due_idx",
        "rent_charge_rule",
        ["next_due_date"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "rent_charge_rule_next_due_idx",
        table_name="rent_charge_rule",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_index(
        "rent_charge_rule_lease_idx",
        table_name="rent_charge_rule",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_table("rent_charge_rule")

    bind = op.get_bind()
    gst_treatment.drop(bind, checkfirst=True)
    rent_charge_type.drop(bind, checkfirst=True)
