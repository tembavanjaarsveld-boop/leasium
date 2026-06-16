"""Leasium AI conversation thread schemas."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import Field, field_validator
from stewart.core.models import ConversationTurnKind, ConversationTurnRole

from apps.api.schemas.common import ApiModel

JsonObject = dict[str, Any]


class ConversationTurnInput(ApiModel):
    role: ConversationTurnRole
    kind: ConversationTurnKind
    payload: JsonObject = Field(default_factory=dict)

    @field_validator("payload")
    @classmethod
    def payload_must_be_object(cls, value: JsonObject) -> JsonObject:
        if not isinstance(value, dict):
            raise ValueError("payload must be an object")
        return value


class ConversationTurnCreateRequest(ConversationTurnInput):
    pass


class ConversationThreadCreateRequest(ApiModel):
    entity_id: UUID | None = None
    source: str = Field(default="cmdk", min_length=1, max_length=40)
    context_route: str | None = Field(default=None, max_length=300)
    context_record_refs: JsonObject = Field(default_factory=dict)
    title: str | None = Field(default=None, max_length=120)
    initial_turn: ConversationTurnInput | None = None

    @field_validator("context_route")
    @classmethod
    def route_must_be_app_path(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith("/"):
            raise ValueError("context_route must start with /")
        return value

    @field_validator("context_record_refs")
    @classmethod
    def refs_must_be_object(cls, value: JsonObject) -> JsonObject:
        if not isinstance(value, dict):
            raise ValueError("context_record_refs must be an object")
        return value


class ConversationTurnRead(ApiModel):
    id: UUID
    thread_id: UUID
    role: ConversationTurnRole
    kind: ConversationTurnKind
    payload: JsonObject
    created_at: datetime


class ConversationThreadSummaryRead(ApiModel):
    id: UUID
    organisation_id: UUID
    entity_id: UUID | None
    created_by_user_id: UUID | None
    source: str
    context_route: str | None
    context_record_refs: JsonObject
    title: str
    turn_count: int
    last_turn_at: datetime | None
    last_turn_preview: str | None
    created_at: datetime
    updated_at: datetime


class ConversationThreadRead(ApiModel):
    id: UUID
    organisation_id: UUID
    entity_id: UUID | None
    created_by_user_id: UUID | None
    source: str
    context_route: str | None
    context_record_refs: JsonObject
    title: str
    metadata: JsonObject = Field(alias="thread_metadata")
    created_at: datetime
    updated_at: datetime
    turns: list[ConversationTurnRead] = Field(default_factory=list)
