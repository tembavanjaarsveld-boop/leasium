"""Alembic migration smoke test for real Postgres when configured."""

import os

import pytest
from alembic import command
from alembic.config import Config


@pytest.mark.skipif(
    not os.getenv("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL is not configured"
)
def test_migrations_apply_to_configured_postgres(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", os.environ["TEST_DATABASE_URL"])
    config = Config("alembic.ini")

    command.upgrade(config, "head")
