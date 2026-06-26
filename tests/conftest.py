"""Shared test fixtures for the Relby foundation."""

from collections.abc import Generator

import pytest
from apps.api.deps import get_session
from apps.api.main import app
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from stewart.core.db import Base
from stewart.core.models import AppUser, Entity, Organisation, UserEntityRole, UserRole
from stewart.core.settings import get_settings


@pytest.fixture()
def session() -> Generator[Session, None, None]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(
        bind=engine, autoflush=False, autocommit=False, expire_on_commit=False
    )
    with TestingSession() as db:
        settings = get_settings()
        org = Organisation(id=settings.dev_organisation_id, name="SKJ Capital")
        user = AppUser(
            id=settings.dev_user_id,
            organisation_id=org.id,
            email=settings.dev_user_email,
            display_name=settings.dev_user_name,
            auth_provider_id="dev",
        )
        entity = Entity(organisation_id=org.id, name="SKJ Property Pty Ltd")
        db.add_all([org, user, entity])
        db.flush()
        db.add(UserEntityRole(user_id=user.id, entity_id=entity.id, role=UserRole.owner))
        db.commit()
        yield db


@pytest.fixture()
def client(session: Session) -> Generator[TestClient, None, None]:
    def override_session() -> Generator[Session, None, None]:
        yield session

    app.dependency_overrides[get_session] = override_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
