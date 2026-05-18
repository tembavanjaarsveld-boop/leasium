"""Settings helpers."""

from stewart.core.settings import Settings


def test_allowed_cors_origins_deduplicates_and_splits_extra_origins() -> None:
    settings = Settings(
        frontend_url="https://leasium.vercel.app",
        cors_allowed_origins=(
            "https://preview-one.vercel.app, "
            "https://preview-two.vercel.app, "
            "https://leasium.vercel.app"
        ),
    )

    assert settings.allowed_cors_origins() == [
        "https://leasium.vercel.app",
        "http://localhost:3000",
        "https://preview-one.vercel.app",
        "https://preview-two.vercel.app",
    ]
