"""Settings helpers."""

from stewart.core.settings import Settings


def test_allowed_cors_origins_deduplicates_and_splits_extra_origins() -> None:
    settings = Settings(
        frontend_url="https://relby.ai",
        cors_allowed_origins=(
            "https://preview-one.vercel.app, "
            "https://preview-two.vercel.app, "
            "https://relby.ai"
        ),
    )

    assert settings.allowed_cors_origins() == [
        "https://relby.ai",
        "http://localhost:3000",
        "https://preview-one.vercel.app",
        "https://preview-two.vercel.app",
    ]


def test_database_url_uses_psycopg_driver_for_render_postgres_url() -> None:
    settings = Settings(database_url="postgresql://user:pass@host:5432/leasium")

    assert settings.database_url == "postgresql+psycopg://user:pass@host:5432/leasium"


def test_database_url_uses_psycopg_driver_for_legacy_postgres_url() -> None:
    settings = Settings(database_url="postgres://user:pass@host:5432/leasium")

    assert settings.database_url == "postgresql+psycopg://user:pass@host:5432/leasium"
