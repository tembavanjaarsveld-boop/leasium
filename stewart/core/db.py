"""SQLAlchemy engine, session, and declarative base."""

from collections.abc import Generator
from datetime import UTC, datetime
from typing import Annotated, Any

from sqlalchemy import DateTime, MetaData, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, mapped_column, sessionmaker

from stewart.core.ids import uuid7
from stewart.core.settings import get_settings

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Base class for all ORM models."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def utcnow() -> datetime:
    """Return a timezone-aware UTC timestamp."""

    return datetime.now(UTC)


UuidPk = Annotated[
    object,
    mapped_column(primary_key=True, default=uuid7),
]

CreatedAt = Annotated[
    datetime,
    mapped_column(DateTime(timezone=True), default=utcnow, nullable=False),
]

UpdatedAt = Annotated[
    datetime,
    mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False),
]


settings = get_settings()
engine_options: dict[str, Any] = {"pool_pre_ping": True}
if not settings.database_url.startswith("sqlite"):
    engine_options.update(
        {
            "pool_size": settings.database_pool_size,
            "max_overflow": settings.database_max_overflow,
            "pool_timeout": settings.database_pool_timeout_seconds,
            "pool_recycle": settings.database_pool_recycle_seconds,
        }
    )
engine = create_engine(settings.database_url, **engine_options)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def get_session() -> Generator[Session, None, None]:
    """FastAPI dependency that provides a database session."""

    with SessionLocal() as session:
        yield session
