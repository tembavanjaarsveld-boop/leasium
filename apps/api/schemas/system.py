"""System integration status schema."""

from pydantic import BaseModel, Field


class ApiReleaseRead(BaseModel):
    commit: str
    source: str


class ApiHealthRead(BaseModel):
    status: str
    app: str
    release: ApiReleaseRead


class ProviderStatus(BaseModel):
    configured: bool
    live_ready: bool = False
    label: str
    purpose: str
    detail: str
    missing_config: list[str] = Field(default_factory=list)
    webhook_url: str | None = None


class IntegrationStatusRead(BaseModel):
    serpapi: ProviderStatus
    openai: ProviderStatus
    sendgrid: ProviderStatus
    twilio: ProviderStatus
    xero: ProviderStatus
    docusign: ProviderStatus
