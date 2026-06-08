"""Schemas for reviewed Portfolio QA bulk fixes."""

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

BulkFixIssueClass = Literal["tenant_contact", "owner_billing"]


class BulkFixChange(BaseModel):
    target_id: UUID
    fields: dict[str, Any]


class BulkFixApplyRequest(BaseModel):
    issue_class: BulkFixIssueClass
    changes: list[BulkFixChange] = Field(min_length=1, max_length=200)


class BulkFixRowResult(BaseModel):
    target_id: UUID
    field: str
    before: Any = None
    after: Any = None
    reason: str | None = None


class BulkFixApplyRead(BaseModel):
    applied: list[BulkFixRowResult]
    skipped: list[BulkFixRowResult]
    summary: str
