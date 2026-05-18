"""tenant onboarding workflow fields

Revision ID: 20260518_0007
Revises: 20260518_0006
Create Date: 2026-05-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260518_0007"
down_revision: str | None = "20260518_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    if is_postgres:
        op.execute("ALTER TYPE tenant_onboarding_status ADD VALUE IF NOT EXISTS 'reviewed'")
        op.execute("ALTER TYPE tenant_onboarding_status ADD VALUE IF NOT EXISTS 'applied'")

    op.add_column(
        "tenant_onboarding", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "tenant_onboarding", sa.Column("last_sent_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "tenant_onboarding", sa.Column("resent_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("tenant_onboarding", sa.Column("cancel_reason", sa.Text(), nullable=True))
    op.add_column(
        "tenant_onboarding",
        sa.Column(
            "review_data",
            postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON(),
            server_default=sa.text("'{}'::jsonb") if is_postgres else sa.text("'{}'"),
            nullable=False,
        ),
    )
    op.add_column(
        "tenant_onboarding", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("tenant_onboarding", sa.Column("reviewed_by_user_id", sa.Uuid(), nullable=True))
    op.add_column(
        "tenant_onboarding", sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("tenant_onboarding", sa.Column("applied_by_user_id", sa.Uuid(), nullable=True))
    if is_postgres:
        op.create_foreign_key(
            op.f("fk_tenant_onboarding_reviewed_by_user_id_app_user"),
            "tenant_onboarding",
            "app_user",
            ["reviewed_by_user_id"],
            ["id"],
        )
        op.create_foreign_key(
            op.f("fk_tenant_onboarding_applied_by_user_id_app_user"),
            "tenant_onboarding",
            "app_user",
            ["applied_by_user_id"],
            ["id"],
        )
    op.alter_column("tenant_onboarding", "review_data", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    if is_postgres:
        op.drop_constraint(
            op.f("fk_tenant_onboarding_applied_by_user_id_app_user"),
            "tenant_onboarding",
            type_="foreignkey",
        )
        op.drop_constraint(
            op.f("fk_tenant_onboarding_reviewed_by_user_id_app_user"),
            "tenant_onboarding",
            type_="foreignkey",
        )
    op.drop_column("tenant_onboarding", "applied_by_user_id")
    op.drop_column("tenant_onboarding", "applied_at")
    op.drop_column("tenant_onboarding", "reviewed_by_user_id")
    op.drop_column("tenant_onboarding", "reviewed_at")
    op.drop_column("tenant_onboarding", "review_data")
    op.drop_column("tenant_onboarding", "cancel_reason")
    op.drop_column("tenant_onboarding", "resent_at")
    op.drop_column("tenant_onboarding", "last_sent_at")
    op.drop_column("tenant_onboarding", "expires_at")
