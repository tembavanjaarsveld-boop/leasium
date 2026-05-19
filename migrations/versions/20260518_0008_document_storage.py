"""document storage

Revision ID: 20260518_0008
Revises: 20260518_0007
Create Date: 2026-05-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260518_0008"
down_revision: str | None = "20260518_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


document_category = postgresql.ENUM(
    "lease",
    "insurance",
    "bank_guarantee",
    "onboarding",
    "invoice",
    "other",
    name="document_category",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    if is_postgres:
        document_category.create(bind, checkfirst=True)

    op.create_table(
        "stored_document",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("property_id", sa.Uuid(), nullable=True),
        sa.Column("tenancy_unit_id", sa.Uuid(), nullable=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=True),
        sa.Column("lease_id", sa.Uuid(), nullable=True),
        sa.Column("tenant_onboarding_id", sa.Uuid(), nullable=True),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("content_type", sa.Text(), nullable=True),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("file_data", sa.LargeBinary(), nullable=False),
        sa.Column(
            "category",
            document_category if is_postgres else sa.Enum(
                "lease",
                "insurance",
                "bank_guarantee",
                "onboarding",
                "invoice",
                "other",
                name="document_category",
            ),
            nullable=False,
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON(),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["entity_id"], ["entity.id"], name=op.f("fk_stored_document_entity_id_entity")
        ),
        sa.ForeignKeyConstraint(
            ["lease_id"], ["lease.id"], name=op.f("fk_stored_document_lease_id_lease")
        ),
        sa.ForeignKeyConstraint(
            ["property_id"], ["property.id"], name=op.f("fk_stored_document_property_id_property")
        ),
        sa.ForeignKeyConstraint(
            ["tenancy_unit_id"],
            ["tenancy_unit.id"],
            name=op.f("fk_stored_document_tenancy_unit_id_tenancy_unit"),
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"], ["tenant.id"], name=op.f("fk_stored_document_tenant_id_tenant")
        ),
        sa.ForeignKeyConstraint(
            ["tenant_onboarding_id"],
            ["tenant_onboarding.id"],
            name=op.f("fk_stored_document_tenant_onboarding_id_tenant_onboarding"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_stored_document")),
    )
    op.create_index(
        "stored_document_entity_idx",
        "stored_document",
        ["entity_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "stored_document_property_idx",
        "stored_document",
        ["property_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "stored_document_tenant_idx",
        "stored_document",
        ["tenant_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "stored_document_lease_idx",
        "stored_document",
        ["lease_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index("stored_document_category_idx", "stored_document", ["category"], unique=False)


def downgrade() -> None:
    op.drop_index("stored_document_category_idx", table_name="stored_document")
    op.drop_index(
        "stored_document_lease_idx",
        table_name="stored_document",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_index(
        "stored_document_tenant_idx",
        table_name="stored_document",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_index(
        "stored_document_property_idx",
        table_name="stored_document",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_index(
        "stored_document_entity_idx",
        table_name="stored_document",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_table("stored_document")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        document_category.drop(bind, checkfirst=True)
