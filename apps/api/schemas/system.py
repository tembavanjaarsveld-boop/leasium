"""System integration status schema."""

from pydantic import BaseModel


class ProviderStatus(BaseModel):
    configured: bool
    label: str
    purpose: str
    detail: str


class IntegrationStatusRead(BaseModel):
    serpapi: ProviderStatus
    openai: ProviderStatus
    sendgrid: ProviderStatus
    twilio: ProviderStatus
    xero: ProviderStatus
