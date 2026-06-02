"""Alembic migration smoke test for real Postgres when configured."""

import importlib.util
import json
import os
from pathlib import Path
from types import ModuleType

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text

OWNER_PORTAL_PROVIDER_UNIQUE_MIGRATION = (
    Path(__file__).resolve().parents[2]
    / "migrations"
    / "versions"
    / "20260601_0032_owner_portal_provider_active_unique.py"
)
OBLIGATION_LEASE_EVENT_UNIQUE_MIGRATION = (
    Path(__file__).resolve().parents[2]
    / "migrations"
    / "versions"
    / "20260602_0034_obligation_lease_event_unique.py"
)
OwnerPortalAccountRow = tuple[str, str, str, str, str | None, str | None]
ObligationRow = tuple[str, str | None, str, str, dict[str, str], str | None]


@pytest.mark.skipif(
    not os.getenv("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL is not configured"
)
def test_migrations_apply_to_configured_postgres(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", os.environ["TEST_DATABASE_URL"])
    config = Config("alembic.ini")

    command.upgrade(config, "head")


def _load_owner_portal_provider_unique_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "owner_portal_provider_active_unique_migration",
        OWNER_PORTAL_PROVIDER_UNIQUE_MIGRATION,
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_obligation_lease_event_unique_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "obligation_lease_event_unique_migration",
        OBLIGATION_LEASE_EVENT_UNIQUE_MIGRATION,
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _sqlite_owner_portal_account_connection(
    rows: list[OwnerPortalAccountRow],
) -> sa.Connection:
    engine = sa.create_engine("sqlite+pysqlite:///:memory:")
    connection = engine.connect()
    connection.execute(
        text(
            """
            CREATE TABLE owner_portal_account (
              id TEXT PRIMARY KEY,
              auth_provider TEXT NOT NULL,
              auth_provider_id TEXT NOT NULL,
              status TEXT NOT NULL,
              revoked_at TEXT,
              deleted_at TEXT
            )
            """
        )
    )
    _insert_owner_portal_account_rows(connection, rows)
    return connection


def _insert_owner_portal_account_rows(
    connection: sa.Connection,
    rows: list[OwnerPortalAccountRow],
) -> None:
    connection.execute(
        text(
            """
            INSERT INTO owner_portal_account (
              id,
              auth_provider,
              auth_provider_id,
              status,
              revoked_at,
              deleted_at
            )
            VALUES (
              :id,
              :auth_provider,
              :auth_provider_id,
              :status,
              :revoked_at,
              :deleted_at
            )
            """
        ),
        [
            {
                "id": row[0],
                "auth_provider": row[1],
                "auth_provider_id": row[2],
                "status": row[3],
                "revoked_at": row[4],
                "deleted_at": row[5],
            }
            for row in rows
        ],
    )


def _sqlite_obligation_connection(rows: list[ObligationRow]) -> sa.Connection:
    engine = sa.create_engine("sqlite+pysqlite:///:memory:")
    connection = engine.connect()
    connection.execute(
        text(
            """
            CREATE TABLE obligation (
              id TEXT PRIMARY KEY,
              lease_id TEXT,
              category TEXT NOT NULL,
              due_date TEXT NOT NULL,
              metadata TEXT NOT NULL,
              deleted_at TEXT
            )
            """
        )
    )
    _insert_obligation_rows(connection, rows)
    return connection


def _insert_obligation_rows(
    connection: sa.Connection,
    rows: list[ObligationRow],
) -> None:
    connection.execute(
        text(
            """
            INSERT INTO obligation (
              id,
              lease_id,
              category,
              due_date,
              metadata,
              deleted_at
            )
            VALUES (
              :id,
              :lease_id,
              :category,
              :due_date,
              :metadata,
              :deleted_at
            )
            """
        ),
        [
            {
                "id": row[0],
                "lease_id": row[1],
                "category": row[2],
                "due_date": row[3],
                "metadata": json.dumps(row[4]),
                "deleted_at": row[5],
            }
            for row in rows
        ],
    )


def _run_owner_portal_provider_unique_migration(
    connection: sa.Connection,
) -> ModuleType:
    migration = _load_owner_portal_provider_unique_migration()
    context = MigrationContext.configure(connection)
    migration.op = Operations(context)
    migration.upgrade()
    return migration


def _run_obligation_lease_event_unique_migration(
    connection: sa.Connection,
) -> ModuleType:
    migration = _load_obligation_lease_event_unique_migration()
    context = MigrationContext.configure(connection)
    migration.op = Operations(context)
    migration.upgrade()
    return migration


def test_owner_portal_provider_unique_migration_blocks_duplicate_active_accounts() -> None:
    connection = _sqlite_owner_portal_account_connection(
        [
            ("account-1", "clerk", "owner-subject-1", "active", None, None),
            ("account-2", "clerk", "owner-subject-1", "active", None, None),
        ]
    )
    try:
        with pytest.raises(RuntimeError, match="duplicate active provider links"):
            _run_owner_portal_provider_unique_migration(connection)
        indexes = connection.execute(
            text("PRAGMA index_list('owner_portal_account')")
        ).mappings()
        assert "owner_portal_account_auth_provider_active_idx" not in {
            row["name"] for row in indexes
        }
    finally:
        connection.close()


def test_obligation_lease_event_unique_migration_blocks_duplicate_active_events() -> None:
    connection = _sqlite_obligation_connection(
        [
            (
                "obligation-1",
                "lease-1",
                "rent_review",
                "2026-06-18",
                {"source": "lease_calendar_follow_up"},
                None,
            ),
            (
                "obligation-2",
                "lease-1",
                "rent_review",
                "2026-06-18",
                {"source": "lease_calendar_follow_up"},
                None,
            ),
        ]
    )
    try:
        with pytest.raises(RuntimeError, match="duplicate active lease-event obligations"):
            _run_obligation_lease_event_unique_migration(connection)
        indexes = connection.execute(text("PRAGMA index_list('obligation')")).mappings()
        assert "obligation_lease_event_unique_idx" not in {row["name"] for row in indexes}
    finally:
        connection.close()


def test_obligation_lease_event_unique_migration_enforces_active_event_uniqueness() -> None:
    connection = _sqlite_obligation_connection(
        [
            (
                "obligation-1",
                "lease-1",
                "rent_review",
                "2026-06-18",
                {"source": "lease_calendar_follow_up"},
                None,
            ),
            (
                "obligation-2",
                "lease-1",
                "rent_review",
                "2026-06-18",
                {"source": "lease_calendar_follow_up"},
                "2026-06-20",
            ),
            (
                "obligation-3",
                "lease-1",
                "rent_review",
                "2026-06-18",
                {"source": "manual"},
                None,
            ),
            (
                "obligation-4",
                None,
                "rent_review",
                "2026-06-18",
                {"source": "lease_calendar_follow_up"},
                None,
            ),
        ]
    )
    try:
        migration = _run_obligation_lease_event_unique_migration(connection)
        connection.commit()
        indexes = list(connection.execute(text("PRAGMA index_list('obligation')")).mappings())
        created_index = next(
            row for row in indexes if row["name"] == "obligation_lease_event_unique_idx"
        )
        index_columns = list(
            connection.execute(
                text("PRAGMA index_info('obligation_lease_event_unique_idx')")
            ).mappings()
        )
        index_sql = connection.execute(
            text(
                """
                SELECT sql
                FROM sqlite_master
                WHERE type = 'index'
                  AND name = 'obligation_lease_event_unique_idx'
                """
            )
        ).scalar_one()

        assert created_index["unique"] == 1
        assert created_index["partial"] == 1
        assert [row["name"] for row in index_columns] == ["lease_id", "category", "due_date"]
        assert migration.LEASE_EVENT_OBLIGATION_SQLITE_WHERE in index_sql

        with pytest.raises(sa.exc.IntegrityError):
            _insert_obligation_rows(
                connection,
                [
                    (
                        "obligation-active-duplicate",
                        "lease-1",
                        "rent_review",
                        "2026-06-18",
                        {"source": "lease_calendar_follow_up"},
                        None,
                    )
                ],
            )
        connection.rollback()

        _insert_obligation_rows(
            connection,
            [
                (
                    "obligation-deleted-duplicate",
                    "lease-1",
                    "rent_review",
                    "2026-06-18",
                    {"source": "lease_calendar_follow_up"},
                    "x",
                ),
                (
                    "obligation-manual-duplicate",
                    "lease-1",
                    "rent_review",
                    "2026-06-18",
                    {"source": "manual"},
                    None,
                ),
                (
                    "obligation-no-lease-duplicate",
                    None,
                    "rent_review",
                    "2026-06-18",
                    {"source": "lease_calendar_follow_up"},
                    None,
                ),
            ],
        )
    finally:
        connection.close()


def test_owner_portal_provider_unique_migration_enforces_active_only_uniqueness() -> None:
    connection = _sqlite_owner_portal_account_connection(
        [
            ("account-1", "clerk", "owner-subject-1", "active", None, None),
            ("account-2", "clerk", "owner-subject-1", "revoked", None, None),
            (
                "account-3",
                "clerk",
                "owner-subject-1",
                "active",
                "2026-06-01T00:00:00Z",
                None,
            ),
            (
                "account-4",
                "clerk",
                "owner-subject-1",
                "active",
                None,
                "2026-06-01T00:00:00Z",
            ),
        ]
    )
    try:
        migration = _run_owner_portal_provider_unique_migration(connection)
        connection.commit()
        indexes = list(
            connection.execute(
                text("PRAGMA index_list('owner_portal_account')")
            ).mappings()
        )
        created_index = next(
            row
            for row in indexes
            if row["name"] == "owner_portal_account_auth_provider_active_idx"
        )
        index_columns = list(
            connection.execute(
                text("PRAGMA index_info('owner_portal_account_auth_provider_active_idx')")
            ).mappings()
        )
        index_sql = connection.execute(
            text(
                """
                SELECT sql
                FROM sqlite_master
                WHERE type = 'index'
                  AND name = 'owner_portal_account_auth_provider_active_idx'
                """
            )
        ).scalar_one()

        assert created_index["unique"] == 1
        assert created_index["partial"] == 1
        assert [row["name"] for row in index_columns] == [
            "auth_provider",
            "auth_provider_id",
        ]
        assert migration.ACTIVE_PROVIDER_WHERE in index_sql

        with pytest.raises(sa.exc.IntegrityError):
            _insert_owner_portal_account_rows(
                connection,
                [
                    (
                        "account-active-duplicate",
                        "clerk",
                        "owner-subject-1",
                        "active",
                        None,
                        None,
                    )
                ],
            )
        connection.rollback()

        _insert_owner_portal_account_rows(
            connection,
            [
                (
                    "account-revoked-post-migration",
                    "clerk",
                    "owner-subject-1",
                    "revoked",
                    None,
                    None,
                ),
                (
                    "account-revoked-at-post-migration",
                    "clerk",
                    "owner-subject-1",
                    "active",
                    "2026-06-01T01:00:00Z",
                    None,
                ),
                (
                    "account-deleted-at-post-migration",
                    "clerk",
                    "owner-subject-1",
                    "active",
                    None,
                    "2026-06-01T01:00:00Z",
                ),
            ],
        )
    finally:
        connection.close()
