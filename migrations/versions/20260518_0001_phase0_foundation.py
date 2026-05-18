"""phase 0 foundation

Revision ID: 20260518_0001
Revises:
Create Date: 2026-05-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260518_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


user_role = postgresql.ENUM(
    "owner", "admin", "finance", "ops", "viewer", "agent", name="user_role", create_type=False
)
property_type = postgresql.ENUM(
    "commercial_office",
    "commercial_retail",
    "commercial_industrial",
    "mixed_use",
    "vacant_land",
    "childcare",
    "hospitality",
    "other",
    name="property_type",
    create_type=False,
)
audit_outcome = postgresql.ENUM(
    "success", "error", "blocked", "rejected", name="audit_outcome", create_type=False
)


def upgrade() -> None:
    bind = op.get_bind()
    user_role.create(bind, checkfirst=True)
    property_type.create(bind, checkfirst=True)
    audit_outcome.create(bind, checkfirst=True)

    op.create_table(
        "organisation",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("country_code", sa.String(length=2), nullable=False),
        sa.Column("timezone", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_organisation")),
    )

    op.create_table(
        "entity",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organisation_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("abn", sa.Text(), nullable=True),
        sa.Column("gst_registered", sa.Boolean(), nullable=False),
        sa.Column("xero_tenant_id", sa.Text(), nullable=True),
        sa.Column("xero_connected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("xero_last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["organisation_id"],
            ["organisation.id"],
            name=op.f("fk_entity_organisation_id_organisation"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_entity")),
    )
    op.create_index(
        "entity_org_idx",
        "entity",
        ["organisation_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    op.create_table(
        "app_user",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organisation_id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column("auth_provider_id", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["organisation_id"],
            ["organisation.id"],
            name=op.f("fk_app_user_organisation_id_organisation"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_app_user")),
        sa.UniqueConstraint("email", name=op.f("uq_app_user_email")),
    )

    op.create_table(
        "property",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("street_address", sa.Text(), nullable=False),
        sa.Column("suburb", sa.Text(), nullable=True),
        sa.Column("state", sa.Text(), nullable=True),
        sa.Column("postcode", sa.Text(), nullable=True),
        sa.Column("country_code", sa.String(length=2), nullable=False),
        sa.Column("property_type", property_type, nullable=False),
        sa.Column("parcel_id", sa.Text(), nullable=True),
        sa.Column("land_sqm", sa.Float(), nullable=True),
        sa.Column("building_sqm", sa.Float(), nullable=True),
        sa.Column("parking_spaces", sa.Integer(), nullable=True),
        sa.Column("has_solar_pv", sa.Boolean(), nullable=False),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["entity_id"], ["entity.id"], name=op.f("fk_property_entity_id_entity")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_property")),
    )
    op.create_index(
        "property_entity_idx",
        "property",
        ["entity_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    op.create_table(
        "user_entity_role",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("role", user_role, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["entity_id"], ["entity.id"], name=op.f("fk_user_entity_role_entity_id_entity")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["app_user.id"], name=op.f("fk_user_entity_role_user_id_app_user")
        ),
        sa.PrimaryKeyConstraint("user_id", "entity_id", name=op.f("pk_user_entity_role")),
    )

    op.create_table(
        "audit_action",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("actor", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("entity_id", sa.Uuid(), nullable=True),
        sa.Column("target_table", sa.Text(), nullable=True),
        sa.Column("target_id", sa.Uuid(), nullable=True),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("tool_name", sa.Text(), nullable=True),
        sa.Column("tool_input", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("tool_output_summary", sa.Text(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("outcome", audit_outcome, nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("data_classification", sa.Text(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["entity_id"], ["entity.id"], name=op.f("fk_audit_action_entity_id_entity")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["app_user.id"], name=op.f("fk_audit_action_user_id_app_user")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_audit_action")),
    )
    op.create_index(
        "audit_action_actor_time_idx", "audit_action", ["actor", "occurred_at"], unique=False
    )
    op.create_index(
        "audit_action_target_idx",
        "audit_action",
        ["target_table", "target_id"],
        unique=False,
        postgresql_where=sa.text("target_id IS NOT NULL"),
    )

    op.create_table(
        "tenancy_unit",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("property_id", sa.Uuid(), nullable=False),
        sa.Column("unit_label", sa.Text(), nullable=False),
        sa.Column("sqm", sa.Float(), nullable=True),
        sa.Column("parking_spaces", sa.Integer(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["property_id"], ["property.id"], name=op.f("fk_tenancy_unit_property_id_property")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tenancy_unit")),
    )


def downgrade() -> None:
    op.drop_table("tenancy_unit")
    op.drop_index(
        "audit_action_target_idx",
        table_name="audit_action",
        postgresql_where=sa.text("target_id IS NOT NULL"),
    )
    op.drop_index("audit_action_actor_time_idx", table_name="audit_action")
    op.drop_table("audit_action")
    op.drop_table("user_entity_role")
    op.drop_index(
        "property_entity_idx", table_name="property", postgresql_where=sa.text("deleted_at IS NULL")
    )
    op.drop_table("property")
    op.drop_table("app_user")
    op.drop_index(
        "entity_org_idx", table_name="entity", postgresql_where=sa.text("deleted_at IS NULL")
    )
    op.drop_table("entity")
    op.drop_table("organisation")

    bind = op.get_bind()
    audit_outcome.drop(bind, checkfirst=True)
    property_type.drop(bind, checkfirst=True)
    user_role.drop(bind, checkfirst=True)
