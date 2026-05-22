"""Branded communication template request and response schemas."""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import AliasChoices, BaseModel, Field

from apps.api.schemas.common import ApiModel

BrandedTemplateChannel = Literal["email", "sms", "in_app"]


class BrandedTemplateRead(ApiModel):
    id: UUID
    entity_id: UUID
    key: str
    version: str
    channel: BrandedTemplateChannel
    provider: str
    name: str
    subject_template: str | None
    body_template: str
    action_label: str | None
    action_url_template: str | None
    notes: str | None
    is_active: bool
    is_system: bool
    created_by_user_id: UUID | None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        validation_alias=AliasChoices("template_metadata", "metadata"),
        serialization_alias="metadata",
    )


class BrandedTemplateCreate(BaseModel):
    entity_id: UUID
    key: str = Field(min_length=1, max_length=120)
    version: str = Field(default="v1", min_length=1, max_length=40)
    channel: BrandedTemplateChannel
    provider: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=200)
    subject_template: str | None = Field(default=None, max_length=400)
    body_template: str = Field(min_length=1, max_length=20_000)
    action_label: str | None = Field(default=None, max_length=120)
    action_url_template: str | None = Field(default=None, max_length=600)
    notes: str | None = Field(default=None, max_length=2_000)
    is_active: bool = True
    metadata: dict[str, Any] = Field(default_factory=dict)


class BrandedTemplateUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    subject_template: str | None = Field(default=None, max_length=400)
    body_template: str | None = Field(default=None, min_length=1, max_length=20_000)
    action_label: str | None = Field(default=None, max_length=120)
    action_url_template: str | None = Field(default=None, max_length=600)
    notes: str | None = Field(default=None, max_length=2_000)
    is_active: bool | None = None
    metadata: dict[str, Any] | None = None
