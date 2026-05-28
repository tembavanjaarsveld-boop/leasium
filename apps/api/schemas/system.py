"""System integration status schema."""

from pydantic import BaseModel


class ProviderStatus(BaseModel):
    configured: bool
    label: str
    purpose: str
    detail: str
    webhook_url: str | None = None


class IntegrationStatusRead(BaseModel):
    serpapi: ProviderStatus
    openai: ProviderStatus
    sendgrid: ProviderStatus
    twilio: ProviderStatus
    xero: ProviderStatus
    docusign: ProviderStatus
