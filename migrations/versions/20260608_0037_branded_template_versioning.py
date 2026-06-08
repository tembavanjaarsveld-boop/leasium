"""branded template versioning

Adds ``updated_by_user_id`` to ``branded_communication_template`` so version
snapshots and in-place edits record the acting operator, and seeds the four
tokenized system default EMAIL templates (v1) per existing entity:
work_assignment_notification, work_assignment_follow_up,
work_assignment_digest, and work_assignment_digest_owner_review.

The seed is insert-if-missing (idempotent) and shares its template content with
the runtime renderers via ``SYSTEM_BRANDED_TEMPLATE_SEEDS`` in
``stewart.integrations.communications``. Seeding templates is review-only data
setup; it never sends a message.

Revision ID: 20260608_0037
Revises: 20260602_0036
Create Date: 2026-06-08
"""

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from stewart.core.ids import uuid7
from stewart.integrations.communications import SYSTEM_BRANDED_TEMPLATE_SEEDS

revision: str = "20260608_0037"
down_revision: str | None = "20260602_0036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    json_type = postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON()

    op.add_column(
        "branded_communication_template",
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
    )
    if is_postgres:
        op.create_foreign_key(
            op.f("fk_branded_communication_template_updated_by_user_id_app_user"),
            "branded_communication_template",
            "app_user",
            ["updated_by_user_id"],
            ["id"],
        )

    template_table = sa.table(
        "branded_communication_template",
        sa.column("id", sa.Uuid()),
        sa.column("entity_id", sa.Uuid()),
        sa.column("key", sa.Text()),
        sa.column("version", sa.Text()),
        sa.column("channel", sa.Text()),
        sa.column("provider", sa.Text()),
        sa.column("name", sa.Text()),
        sa.column("subject_template", sa.Text()),
        sa.column("body_template", sa.Text()),
        sa.column("notes", sa.Text()),
        sa.column("is_active", sa.Boolean()),
        sa.column("is_system", sa.Boolean()),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
        sa.column("template_metadata", json_type),
    )
    now = datetime.now(UTC)
    entity_ids = [
        row[0]
        for row in bind.execute(
            sa.text("SELECT id FROM entity WHERE deleted_at IS NULL")
        )
    ]
    for entity_id in entity_ids:
        for seed in SYSTEM_BRANDED_TEMPLATE_SEEDS:
            existing = bind.execute(
                sa.text(
                    "SELECT id FROM branded_communication_template "
                    "WHERE entity_id = :entity_id AND key = :key "
                    "AND version = 'v1' AND deleted_at IS NULL"
                ),
                {"entity_id": entity_id, "key": seed["key"]},
            ).first()
            if existing is not None:
                continue
            bind.execute(
                template_table.insert().values(
                    id=uuid7(),
                    entity_id=entity_id,
                    key=seed["key"],
                    version="v1",
                    channel=seed["channel"],
                    provider=seed["provider"],
                    name=seed["name"],
                    subject_template=seed["subject_template"],
                    body_template=seed["body_template"],
                    notes=seed["notes"],
                    is_active=True,
                    is_system=True,
                    created_at=now,
                    updated_at=now,
                    template_metadata={},
                )
            )


def downgrade() -> None:
    # Seeded system rows are left in place: operators may have edited or
    # versioned them, so removal is not safely reversible.
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.drop_constraint(
            op.f("fk_branded_communication_template_updated_by_user_id_app_user"),
            "branded_communication_template",
            type_="foreignkey",
        )
    op.drop_column("branded_communication_template", "updated_by_user_id")
