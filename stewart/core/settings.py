"""Application settings loaded from environment variables."""

from functools import lru_cache
from uuid import UUID

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for local, staging, and production environments."""

    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Leasium"
    app_env: str = "local"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    public_api_url: str = ""
    frontend_url: str = "http://localhost:3000"
    cors_allowed_origins: str = ""
    cors_allowed_origin_regex: str | None = None

    database_url: str = "postgresql+psycopg://stewart:stewart@localhost:5432/stewart"
    test_database_url: str | None = None
    redis_url: str = "redis://localhost:6379/0"

    s3_endpoint_url: str = "http://localhost:9000"
    s3_access_key_id: str = "stewart"
    s3_secret_access_key: str = "stewart-password"
    s3_bucket: str = "stewart-local"
    s3_region: str = "auto"

    auth_mode: str = Field(default="dev", pattern="^(dev|clerk)$")
    dev_user_id: UUID = UUID("00000000-0000-7000-8000-000000000001")
    dev_user_email: str = "temba@example.com"
    dev_user_name: str = "Temba van Jaarsveld"
    dev_organisation_id: UUID = UUID("00000000-0000-7000-8000-000000000100")
    clerk_secret_key: str = ""
    clerk_jwks_url: str = ""
    clerk_issuer: str = ""
    clerk_audience: str = ""
    operator_invite_ttl_hours: int = 72
    operator_invite_email_enabled: bool = True
    operator_invite_template_key: str = "operator_invite"
    operator_invite_template_version: str = "v1"

    anthropic_api_key: str = ""
    openai_api_key: str = ""
    openai_model: str = "gpt-5.4-mini"
    lease_intake_max_bytes: int = 15_000_000
    document_max_bytes: int = 15_000_000
    xero_client_id: str = ""
    xero_client_secret: str = ""
    sendgrid_api_key: str = ""
    sendgrid_from_email: str = ""
    sendgrid_from_name: str = "Leasium"
    sendgrid_mail_send_url: str = "https://api.sendgrid.com/v3/mail/send"
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_messaging_service_sid: str = ""
    twilio_from_phone: str = ""
    twilio_api_base_url: str = "https://api.twilio.com"
    communications_webhook_secret: str = ""
    communications_timeout_seconds: float = 10.0
    tenant_onboarding_email_enabled: bool = True
    tenant_onboarding_sms_enabled: bool = True
    tenant_onboarding_brand_name: str = "Leasium"
    tenant_onboarding_template_key: str = "tenant_onboarding_invite"
    tenant_onboarding_template_version: str = "v1"
    slack_webhook_url: str = ""

    @field_validator("database_url", "test_database_url", mode="before")
    @classmethod
    def normalise_postgres_driver(cls, value: str | None) -> str | None:
        """Render-style Postgres URLs should use the installed psycopg driver."""

        if value is None:
            return value
        if value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql+psycopg://", 1)
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
        return value

    def allowed_cors_origins(self) -> list[str]:
        """Return explicit browser origins allowed to call the API."""

        origins = [self.frontend_url, "http://localhost:3000"]
        origins.extend(
            origin.strip() for origin in self.cors_allowed_origins.split(",") if origin.strip()
        )
        return list(dict.fromkeys(origins))


@lru_cache
def get_settings() -> Settings:
    """Return cached process settings."""

    return Settings()
