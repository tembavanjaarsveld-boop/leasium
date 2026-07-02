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

    app_name: str = "Relby"
    app_env: str = "local"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    public_api_url: str = ""
    frontend_url: str = "http://localhost:3000"
    cors_allowed_origins: str = ""
    cors_allowed_origin_regex: str | None = None

    database_url: str = "postgresql+psycopg://stewart:stewart@localhost:5432/stewart"
    test_database_url: str | None = None
    database_pool_size: int = 5
    database_max_overflow: int = 10
    database_pool_timeout_seconds: int = 30
    database_pool_recycle_seconds: int = 1800
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
    # Dev auth acts as a platform admin locally so the /admin surface is reachable
    # without Clerk. In clerk mode the flag is read from the AppUser row instead.
    dev_is_platform_admin: bool = True
    # Reserved "Relby Platform" organisation + first platform-admin operator,
    # seeded idempotently by scripts/seed_platform_admin.py. The reserved org holds
    # no entities/properties; platform admins act across client orgs via the flag.
    platform_organisation_id: UUID = UUID("00000000-0000-7000-8000-000000000900")
    platform_organisation_name: str = "Relby Platform"
    platform_admin_user_id: UUID = UUID("00000000-0000-7000-8000-000000000901")
    platform_admin_email: str = "platform-admin@relby.ai"
    platform_admin_name: str = "Relby Platform Admin"
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
    openai_model: str = "gpt-5.4"
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
        "offline_access accounting.contacts.read accounting.settings.read accounting.invoices"
    )
    xero_http_timeout_seconds: float = 15.0
    # Multi-unit itemised invoice payloads stay local-review only until Temba
    # explicitly enables Xero draft creation for one-invoice/many-line unit splits.
    xero_itemised_unit_lines_enabled: bool = False
    sendgrid_api_key: str = ""
    sendgrid_from_email: str = ""
    sendgrid_from_name: str = "Relby"
    sendgrid_mail_send_url: str = "https://api.sendgrid.com/v3/mail/send"
    sendgrid_inbound_secret: str = ""
    invoice_email_enabled: bool = True
    invoice_email_template_key: str = "invoice_delivery"
    invoice_email_template_version: str = "v1"
    # Owner statement dispatch is review-first and off by default: a real send
    # requires this flag, configured SendGrid, a recipient, and explicit
    # per-owner operator approval on the request.
    owner_statement_email_enabled: bool = False
    owner_statement_email_template_key: str = "owner_statement"
    owner_statement_email_template_version: str = "v1"
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
    # Basiq (AU) bank-feed reconciliation is review-first and OFF by default.
    # Inert without these: the adapter soft-skips like the SendGrid / Xero /
    # OpenSign adapters until an operator enables it. No real money movement.
    basiq_enabled: bool = False
    basiq_api_key: str = ""
    basiq_api_base_url: str = "https://au-api.basiq.io"
    basiq_http_timeout_seconds: float = 15.0
    # Tenant payment rails. Empty by default: the PaymentRail boundary in
    # stewart.integrations.payment_rails soft-skips (no online payment, no money
    # movement) until an AU provider (monoova / zai / stripe_au) is wired and this
    # is set. Display-only payment instructions still work without it.
    payment_rail_provider: str = ""
    # Observability: a complete no-op unless set in the deployment env.
    sentry_dsn: str = ""
    sentry_environment: str = ""
    communications_webhook_secret: str = ""
    # SendGrid Signed Event Webhook ECDSA public verification key (base64 DER,
    # the value SendGrid shows under Mail Settings -> Event Webhooks ->
    # Signature Verification). Empty by default: when unset the event webhooks
    # fall back to the shared COMMUNICATIONS_WEBHOOK_SECRET. When set, inbound
    # SendGrid events must carry a valid signature header or are rejected 403.
    sendgrid_event_webhook_signing_key: str = ""
    communications_timeout_seconds: float = 10.0
    tenant_onboarding_email_enabled: bool = True
    tenant_onboarding_sms_enabled: bool = True
    tenant_onboarding_brand_name: str = "Relby"
    tenant_onboarding_template_key: str = "tenant_onboarding_invite"
    tenant_onboarding_template_version: str = "v1"
    tenant_portal_invite_template_key: str = "tenant_portal_invite"
    tenant_portal_invite_template_version: str = "v1"
    tenant_lease_pack_template_key: str = "tenant_lease_pack"
    tenant_lease_pack_template_version: str = "v1"
    # OpenSign e-signature (Cloud). Empty by default — operators populate the
    # API token when the paid OpenSign plan is provisioned. send_lease_for_signature
    # in stewart.integrations.opensign soft-skips with a clear "OpenSign is not
    # configured" message until the token is present. The default base URL is the
    # sandbox; set OPENSIGN_BASE_URL to https://app.opensignlabs.com/api/v1.2 for live.
    opensign_api_token: str = ""
    opensign_base_url: str = "https://sandbox.opensignlabs.com/api/v1.2"
    opensign_webhook_secret: str = ""
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
