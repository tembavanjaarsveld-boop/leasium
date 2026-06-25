"""Schemas for Work assignment notification and digest workflows."""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

WorkAssignmentDigestCadence = Literal["daily", "weekly"]
WorkAssignmentDigestDueCadence = Literal["daily", "weekly", "all"]
WorkAssignmentDigestDeliveryTrigger = Literal["manual", "scheduled", "recovery"]
WorkAssignmentNoticeGroup = Literal["ready", "in_flight", "attention", "done"]
WorkAssignmentNoticeDeliveryTrigger = Literal["manual", "retry"]
WorkAssignmentNoticeChannel = Literal["email", "sms", "in_app"]
WorkAssignmentRenderedMessageChannel = Literal["email", "sms"]
WorkAssignmentNotificationChannelReadiness = Literal["actionable", "blocked", "read_only"]
WorkAssignmentNotificationSetupStatus = Literal["ready", "missing", "review"]
WorkAssignmentTemplateKind = Literal["assignment_notice", "digest"]
WorkAssignmentTargetType = Literal["maintenance_work_order", "arrears_case", "obligation"]


class WorkAssignmentProviderHistoryRead(BaseModel):
    event: str | None = None
    channel: str | None = None
    status: str | None = None
    raw_event: str | None = None
    provider: str | None = None
    attempted_at: str | None = None
    received_at: str | None = None
    recipient_email: str | None = None
    recipient_phone: str | None = None
    provider_message_id: str | None = None
    error: str | None = None
    template_key: str | None = None
    template_version: str | None = None
    delivery_trigger: str | None = None
    recovery_of_generated_at: str | None = None
    delivery_attempt_count: int | None = None


class WorkAssignmentNotificationTemplateRead(BaseModel):
    kind: WorkAssignmentTemplateKind
    key: str
    name: str
    default_version: str = "v1"
    channel: Literal["email"] = "email"
    provider: Literal["sendgrid"] = "sendgrid"
    subject_preview: str
    content_summary: str
    recovery_summary: str | None = None
    is_system: bool = True


class WorkAssignmentNotificationTemplateCatalogRead(BaseModel):
    guardrails: list[str] = Field(default_factory=list)
    notice_templates: list[WorkAssignmentNotificationTemplateRead] = Field(default_factory=list)
    digest_templates: list[WorkAssignmentNotificationTemplateRead] = Field(default_factory=list)


class WorkAssignmentNoticeEmailSend(BaseModel):
    entity_id: UUID
    target_id: UUID
    target_type: WorkAssignmentTargetType
    delivery_trigger: WorkAssignmentNoticeDeliveryTrigger = "manual"


class WorkAssignmentNoticeSmsSend(BaseModel):
    entity_id: UUID
    target_id: UUID
    target_type: WorkAssignmentTargetType
    delivery_trigger: WorkAssignmentNoticeDeliveryTrigger = "manual"


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


class WorkAssignmentRenderedMessagePreviewRead(BaseModel):
    channel: WorkAssignmentRenderedMessageChannel
    provider: str
    recipient_email: str | None = None
    recipient_phone: str | None = None
    subject: str | None = None
    body_text: str
    template_key: str | None = None
    template_version: str | None = None
    action_label: str | None = None
    action_url: str | None = None


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
    rendered_message_preview: WorkAssignmentRenderedMessagePreviewRead | None = None
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
    entity_id: UUID | None = None
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
    sms_action_available: bool = False
    sms_status: str | None = None
    sms_detail: str | None = None
    sms_provider: str | None = None
    sms_recipient_phone: str | None = None
    sms_provider_message_id: str | None = None
    sms_attempt_count: int = 0
    sms_provider_history: list[WorkAssignmentProviderHistoryRead] = Field(default_factory=list)
    channel_receipts: list["WorkAssignmentNoticeChannelReceiptRead"] = Field(
        default_factory=list
    )


class WorkAssignmentNotificationSetupCheckRead(BaseModel):
    key: str
    label: str
    status: WorkAssignmentNotificationSetupStatus
    detail: str
    value: str | None = None


class WorkAssignmentNotificationChannelRead(BaseModel):
    channel: Literal["email", "sms", "in_app"]
    provider: str
    label: str
    readiness: WorkAssignmentNotificationChannelReadiness
    reason_code: str | None = None
    configured: bool = False
    action_available: bool = False
    detail: str
    next_action: str | None = None
    setup_checks: list[WorkAssignmentNotificationSetupCheckRead] = Field(
        default_factory=list
    )


class WorkAssignmentNoticeChannelReceiptRead(BaseModel):
    channel: WorkAssignmentNoticeChannel
    label: str
    provider: str | None = None
    status: str | None = None
    detail: str | None = None
    recipient_email: str | None = None
    recipient_phone: str | None = None
    provider_message_id: str | None = None
    template_key: str | None = None
    template_version: str | None = None
    attempted_at: str | None = None
    sent_at: str | None = None
    receipt_at: str | None = None
    last_event: str | None = None
    delivery_trigger: str | None = None
    delivery_attempt_count: int = 0
    message_sent: bool = False
    action_available: bool = False
    provider_history: list[WorkAssignmentProviderHistoryRead] = Field(default_factory=list)
    rendered_message_preview: WorkAssignmentRenderedMessagePreviewRead | None = None


class WorkAssignmentNoticeEmailSendRead(BaseModel):
    entity_id: UUID
    target_type: WorkAssignmentTargetType
    target_id: UUID
    status: str
    message_sent: bool = False
    recipient_email: str | None = None
    provider: str | None = None
    provider_message_id: str | None = None
    detail: str | None = None
    template_key: str | None = None
    template_version: str | None = None
    attempted_at: str | None = None
    delivery_trigger: WorkAssignmentNoticeDeliveryTrigger | Literal["already_sent"] = "manual"
    notice: WorkAssignmentNotificationCenterItemRead


class WorkAssignmentNoticeSmsSendRead(BaseModel):
    entity_id: UUID
    target_type: WorkAssignmentTargetType
    target_id: UUID
    status: str
    message_sent: bool = False
    recipient_phone: str | None = None
    provider: str | None = None
    provider_message_id: str | None = None
    detail: str | None = None
    template_key: str | None = None
    template_version: str | None = None
    attempted_at: str | None = None
    delivery_trigger: WorkAssignmentNoticeDeliveryTrigger | Literal["already_sent"] = "manual"
    notice: WorkAssignmentNotificationCenterItemRead


class WorkAssignmentNotificationCenterDigestRead(BaseModel):
    entity_id: UUID | None = None
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
    rendered_message_preview: WorkAssignmentRenderedMessagePreviewRead | None = None
    channel_receipts: list[WorkAssignmentNoticeChannelReceiptRead] = Field(default_factory=list)


class WorkAssignmentNotificationCenterRead(BaseModel):
    entity_id: UUID | None = None
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
    channels: list[WorkAssignmentNotificationChannelRead] = Field(default_factory=list)
    notices: list[WorkAssignmentNotificationCenterItemRead] = Field(default_factory=list)
    digest_receipts: list[WorkAssignmentNotificationCenterDigestRead] = Field(default_factory=list)


class WorkAssignmentNotificationCenterReadState(BaseModel):
    entity_id: UUID
    read_at: datetime
    unread_count: int = 0
