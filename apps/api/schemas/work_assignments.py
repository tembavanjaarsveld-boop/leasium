"""Schemas for Work assignment notification and digest workflows."""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

WorkAssignmentDigestCadence = Literal["daily", "weekly"]
WorkAssignmentDigestDueCadence = Literal["daily", "weekly", "all"]
WorkAssignmentDigestDeliveryTrigger = Literal["manual", "scheduled", "recovery"]
WorkAssignmentNoticeGroup = Literal["ready", "in_flight", "attention", "done"]


class WorkAssignmentProviderHistoryRead(BaseModel):
    event: str | None = None
    channel: str | None = None
    status: str | None = None
    raw_event: str | None = None
    provider: str | None = None
    attempted_at: str | None = None
    received_at: str | None = None
    recipient_email: str | None = None
    provider_message_id: str | None = None
    error: str | None = None
    template_key: str | None = None
    template_version: str | None = None
    delivery_trigger: str | None = None
    recovery_of_generated_at: str | None = None
    delivery_attempt_count: int | None = None


class WorkAssignmentDigestRun(BaseModel):
    entity_id: UUID
    cadence: WorkAssignmentDigestCadence = "daily"
    send_email_approved: bool = False
    delivery_trigger: WorkAssignmentDigestDeliveryTrigger = "manual"
    recovery_of_generated_at: datetime | None = None


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
    delivery_status: str = "previewed"
    message_sent: bool = False
    delivery_detail: str | None = None
    provider_message_id: str | None = None
    delivery_trigger: str | None = None
    recovery_of_generated_at: datetime | None = None
    delivery_attempt_count: int = 0
    items: list[WorkAssignmentDigestItemRead] = Field(default_factory=list)


class WorkAssignmentDigestRunRead(BaseModel):
    entity_id: UUID
    cadence: WorkAssignmentDigestCadence
    generated_at: datetime
    operator_count: int
    work_item_count: int
    guardrails: list[str] = Field(default_factory=list)
    digests: list[WorkAssignmentDigestRead] = Field(default_factory=list)


class WorkAssignmentDigestDueRunRead(BaseModel):
    generated_at: datetime
    cadence_filter: WorkAssignmentDigestDueCadence
    entity_count: int
    run_count: int
    operator_count: int
    work_item_count: int
    guardrails: list[str] = Field(default_factory=list)
    runs: list[WorkAssignmentDigestRunRead] = Field(default_factory=list)


class WorkAssignmentNotificationCenterItemRead(BaseModel):
    target_id: UUID
    target_type: Literal["maintenance_work_order", "arrears_case", "obligation"]
    title: str
    summary: str | None = None
    assignee_user_id: UUID | None = None
    assignee_name: str | None = None
    assignee_email: str | None = None
    group: WorkAssignmentNoticeGroup
    notification_status: str
    notification_detail: str | None = None
    channel: str | None = None
    provider: str | None = None
    template_key: str | None = None
    template_version: str | None = None
    due_date: date | None = None
    event_at: datetime | None = None
    follow_up_due: bool = False
    work_url: str | None = None
    provider_history: list[WorkAssignmentProviderHistoryRead] = Field(default_factory=list)


class WorkAssignmentNotificationCenterDigestRead(BaseModel):
    assignee_user_id: UUID
    assignee_name: str
    assignee_email: str
    generated_at: datetime
    cadence: WorkAssignmentDigestCadence
    item_count: int = 0
    follow_up_due_count: int = 0
    delivery_status: str = "previewed"
    message_sent: bool = False
    delivery_detail: str | None = None
    delivery_channel: str | None = None
    provider: str | None = None
    provider_message_id: str | None = None
    template_key: str | None = None
    template_version: str | None = None
    delivery_trigger: str | None = None
    recovery_of_generated_at: datetime | None = None
    delivery_attempt_count: int = 0
    provider_history: list[WorkAssignmentProviderHistoryRead] = Field(default_factory=list)


class WorkAssignmentNotificationCenterRead(BaseModel):
    entity_id: UUID
    generated_at: datetime
    last_read_at: datetime | None = None
    unread_count: int = 0
    notice_count: int
    attention_count: int = 0
    ready_count: int = 0
    in_flight_count: int = 0
    done_count: int = 0
    digest_receipt_count: int = 0
    guardrails: list[str] = Field(default_factory=list)
    notices: list[WorkAssignmentNotificationCenterItemRead] = Field(default_factory=list)
    digest_receipts: list[WorkAssignmentNotificationCenterDigestRead] = Field(default_factory=list)


class WorkAssignmentNotificationCenterReadState(BaseModel):
    entity_id: UUID
    read_at: datetime
    unread_count: int = 0
