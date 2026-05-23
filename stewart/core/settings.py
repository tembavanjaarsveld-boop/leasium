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
    clerk_allow_legacy_token_mapping: bool = False
    operator_invite_ttl_hours: int = 72
    operator_invite_email_enabled: bool = True
    operator_invite_template_key: str = "operator_invite"
    operator_invite_template_version: str = "v1"
    work_assignment_email_enabled: bool = True
    work_assignment_email_template_key: str = "work_assignment_notification"
    work_assignment_email_template_version: str = "v1"

    anthropic_api_key: str = ""
    openai_api_key: str = ""
    openai_model: str = "gpt-5.4-mini"
    serpapi_api_key: str = ""
    # Payment reconciliation is considered "stale" after this many days without a
    # preview or apply. Surfaces in /xero/status and accounting readiness snapshots.
    xero_reconciliation_stale_after_days: int = 7
    lease_intake_max_bytes: int = 15_000_000
    document_max_bytes: int = 15_000_000
    xero_client_id: str = ""
    xero_client_secret: str = ""
    xero_redirect_uri: str = ""
    xero_state_secret: str = ""
    xero_token_encryption_key: str = ""
    xero_authorize_url: str = "https://login.xero.com/identity/connect/authorize"
    xero_token_url: str = "https://identity.xero.com/connect/token"
    xero_connections_url: str = "https://api.xero.com/connections"
    xero_api_base_url: str = "https://api.xero.com/api.xro/2.0"
    xero_default_scopes: str = (
        "offline_access accounting.contacts.read accounting.settings.read accounting.transactions"
    )
    xero_http_timeout_seconds: float = 15.0
    sendgrid_api_key: str = ""
    sendgrid_from_email: str = ""
    sendgrid_from_name: str = "Leasium"
    sendgrid_mail_send_url: str = "https://api.sendgrid.com/v3/mail/send"
    invoice_email_enabled: bool = True
    invoice_email_template_key: str = "invoice_delivery"
    invoice_email_template_version: str = "v1"
    contractor_email_enabled: bool = True
    contractor_email_template_key: str = "maintenance_contractor_update"
    contractor_email_template_version: str = "v1"
    contractor_sms_enabled: bool = True
    contractor_sms_template_key: str = "maintenance_contractor_sms"
    contractor_sms_template_version: str = "v1"
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
    tenant_portal_invite_template_key: str = "tenant_portal_invite"
    tenant_portal_invite_template_version: str = "v1"
    # DocuSign integration. Empty by default — operators populate when the
    # DocuSign developer account is provisioned. send_lease_for_signature in
    # stewart.integrations.docusign soft-fails with a clear "DocuSign is not
    # configured" message until all four are present.
    docusign_account_id: str = ""
    docusign_integration_key: str = ""
    docusign_user_id: str = ""
    docusign_rsa_private_key: str = ""
    docusign_base_url: str = "https://demo.docusign.net/restapi"
    docusign_auth_base_url: str = "https://account-d.docusign.net"
    docusign_webhook_secret: str = ""
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
