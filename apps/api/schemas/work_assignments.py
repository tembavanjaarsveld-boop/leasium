"""Schemas for Work assignment notification and digest workflows."""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

WorkAssignmentDigestCadence = Literal["daily", "weekly"]
WorkAssignmentNoticeGroup = Literal["ready", "in_flight", "attention", "done"]


class WorkAssignmentDigestRun(BaseModel):
    entity_id: UUID
    cadence: WorkAssignmentDigestCadence = "daily"


class WorkAssignmentDigestItemRead(BaseModel):
    target_id: UUID
    target_type: Literal["maintenance_work_order", "arrears_case", "obligation"]
    title: str
    description: str | None = None
    due_date: date | None = None
    status: str
    priority: str | None = None
    notification_status: str | None = None
    notification_group: WorkAssignmentNoticeGroup | None = None
    notification_detail: str | None = None
    reminder_due_on: date | None = None
    escalation_due_on: date | None = None
    follow_up_due: bool = False
    work_url: str | None = None


class WorkAssignmentDigestRead(BaseModel):
    assignee_user_id: UUID
    assignee_name: str
    assignee_email: str
    cadence: WorkAssignmentDigestCadence
    item_count: int
    ready_count: int = 0
    attention_count: int = 0
    in_flight_count: int = 0
    done_count: int = 0
    follow_up_due_count: int = 0
    items: list[WorkAssignmentDigestItemRead] = Field(default_factory=list)


class WorkAssignmentDigestRunRead(BaseModel):
    entity_id: UUID
    cadence: WorkAssignmentDigestCadence
    generated_at: datetime
    operator_count: int
    work_item_count: int
    guardrails: list[str] = Field(default_factory=list)
    digests: list[WorkAssignmentDigestRead] = Field(default_factory=list)
