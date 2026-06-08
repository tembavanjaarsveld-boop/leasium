"""Maintenance work order request and response schemas."""

from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import AliasChoices, BaseModel, Field, computed_field
from stewart.core.models import (
    MaintenanceApprovalStatus,
    MaintenancePriority,
    MaintenanceWorkOrderStatus,
)

from apps.api.schemas.common import ApiModel
from apps.api.schemas.work_assignments import (
    WorkAssignmentNoticeChannelReceiptRead,
    WorkAssignmentProviderHistoryRead,
    WorkAssignmentRenderedMessagePreviewRead,
)

MaintenanceCommentVisibility = Literal["internal", "contractor", "tenant"]


_DELIVERED_EMAIL_STATUSES = {"queued", "sent", "delivered", "opened"}
_DELIVERED_SMS_STATUSES = {"queued", "sent", "delivered"}


def _text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _int(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return value
    return 0


def _record(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _provider_history_from_metadata(
    raw_history: Any,
) -> list[WorkAssignmentProviderHistoryRead]:
    if not isinstance(raw_history, list):
        return []
    records: list[WorkAssignmentProviderHistoryRead] = []
    for entry in raw_history:
        if not isinstance(entry, dict):
            continue
        records.append(
            WorkAssignmentProviderHistoryRead(
                event=_text(entry.get("event")),
                channel=_text(entry.get("channel")),
                status=_text(entry.get("status")),
                raw_event=_text(entry.get("raw_event")),
                provider=_text(entry.get("provider")),
                attempted_at=_text(entry.get("attempted_at") or entry.get("at")),
                received_at=_text(entry.get("received_at")),
                recipient_email=_text(entry.get("recipient_email")),
                recipient_phone=_text(entry.get("recipient_phone")),
                provider_message_id=_text(entry.get("provider_message_id")),
                error=_text(entry.get("error")),
                template_key=_text(entry.get("template_key")),
                template_version=_text(entry.get("template_version")),
                delivery_trigger=_text(entry.get("delivery_trigger")),
                recovery_of_generated_at=_text(entry.get("recovery_of_generated_at")),
                delivery_attempt_count=_int(entry.get("retry_count"))
                or _int(entry.get("delivery_attempt_count")),
            )
        )
    return records


def _contractor_channel_receipt(
    *,
    channel: Literal["email", "sms"],
    label: str,
    delivery_dict: dict[str, Any],
    contractor_recipient: str | None,
    delivered_statuses: set[str],
) -> WorkAssignmentNoticeChannelReceiptRead | None:
    send = _record(delivery_dict.get("send"))
    receipts = delivery_dict.get("receipts")
    latest_receipt = (
        _record(receipts[0]) if isinstance(receipts, list) and receipts else {}
    )

    status_value = _text(latest_receipt.get("status")) or _text(send.get("status"))
    provider = _text(send.get("provider")) or _text(latest_receipt.get("provider"))
    if status_value is None and provider is None and not send:
        return None

    recipient_email = (
        _text(send.get("recipient_email")) if channel == "email" else None
    )
    recipient_phone = (
        _text(send.get("recipient_phone")) if channel == "sms" else None
    )
    if channel == "email" and not recipient_email:
        recipient_email = contractor_recipient if "@" in (contractor_recipient or "") else None
    if channel == "sms" and not recipient_phone:
        recipient_phone = (
            contractor_recipient
            if (contractor_recipient or "").strip().startswith("+")
            else None
        )

    detail = _text(latest_receipt.get("error")) or _text(send.get("error"))
    provider_message_id = (
        _text(latest_receipt.get("provider_message_id"))
        or _text(send.get("provider_message_id"))
    )
    template_key = _text(send.get("template_key")) or _text(
        latest_receipt.get("template_key")
    )
    template_version = _text(send.get("template_version")) or _text(
        latest_receipt.get("template_version")
    )
    if template_key is None and channel == "email":
        template_key = "maintenance_contractor_update"
    if template_key is None and channel == "sms":
        template_key = "maintenance_contractor_sms"
    if template_version is None and template_key is not None:
        template_version = "v1"
    attempt_count = _int(send.get("retry_count"))
    if attempt_count == 0 and send:
        attempt_count = 1
    delivered = status_value in delivered_statuses

    body = _text(send.get("body"))
    subject = _text(send.get("subject"))
    provider_history = _provider_history_from_metadata(delivery_dict.get("history"))
    if not provider_history and send:
        provider_history = [
            WorkAssignmentProviderHistoryRead(
                event=f"contractor_{channel}_attempted",
                channel=channel,
                status=status_value,
                raw_event=None,
                provider=provider,
                attempted_at=_text(send.get("attempted_at")),
                received_at=None,
                recipient_email=recipient_email,
                recipient_phone=recipient_phone,
                provider_message_id=provider_message_id,
                error=detail,
                template_key=template_key,
                template_version=template_version,
                delivery_trigger=None,
                recovery_of_generated_at=None,
                delivery_attempt_count=attempt_count,
            )
        ]
    rendered_preview: WorkAssignmentRenderedMessagePreviewRead | None = None
    if body and provider:
        rendered_preview = WorkAssignmentRenderedMessagePreviewRead(
            channel=channel,
            provider=provider,
            recipient_email=recipient_email,
            recipient_phone=recipient_phone,
            subject=subject if channel == "email" else None,
            body_text=body,
            template_key=template_key,
            template_version=template_version,
            action_label=None,
            action_url=None,
        )

    return WorkAssignmentNoticeChannelReceiptRead(
        channel=channel,
        label=label,
        provider=provider,
        status=status_value,
        detail=detail,
        recipient_email=recipient_email,
        recipient_phone=recipient_phone,
        provider_message_id=provider_message_id,
        template_key=template_key,
        template_version=template_version,
        attempted_at=_text(send.get("attempted_at")),
        sent_at=_text(send.get("sent_at")),
        receipt_at=_text(latest_receipt.get("received_at")),
        last_event=_text(latest_receipt.get("status"))
        or _text(send.get("status")),
        delivery_trigger=None,
        delivery_attempt_count=attempt_count,
        message_sent=delivered,
        action_available=False,
        provider_history=provider_history,
        rendered_message_preview=rendered_preview,
    )


def _maintenance_channel_receipts_from_metadata(
    metadata: dict[str, Any] | None,
    *,
    contractor_email: str | None,
    contractor_phone: str | None,
) -> list[WorkAssignmentNoticeChannelReceiptRead]:
    """Project a normalized contractor email + SMS channel_receipts list.

    Reads the same ``contractor_delivery`` shape the maintenance router
    persists when sending contractor messages. Returns an empty list when no
    contractor delivery has been recorded for the work order yet.
    """
    contractor_delivery = _record(_record(metadata).get("contractor_delivery"))
    receipts: list[WorkAssignmentNoticeChannelReceiptRead] = []
    email_receipt = _contractor_channel_receipt(
        channel="email",
        label="Contractor email",
        delivery_dict=_record(contractor_delivery.get("email")),
        contractor_recipient=contractor_email,
        delivered_statuses=_DELIVERED_EMAIL_STATUSES,
    )
    if email_receipt is not None:
        receipts.append(email_receipt)
    sms_receipt = _contractor_channel_receipt(
        channel="sms",
        label="Contractor SMS",
        delivery_dict=_record(contractor_delivery.get("sms")),
        contractor_recipient=contractor_phone,
        delivered_statuses=_DELIVERED_SMS_STATUSES,
    )
    if sms_receipt is not None:
        receipts.append(sms_receipt)
    return receipts


class MaintenanceCompletionReviewRead(BaseModel):
    party: str | None
    outcome: str | None
    notes: str | None
    reviewed_by: str | None
    reviewed_at: str | None


def _completion_reviews_from_metadata(
    metadata: dict[str, Any] | None,
) -> list[MaintenanceCompletionReviewRead]:
    """Project the operator-recorded owner/tenant completion reviews.

    Reads the ``completion_reviews`` list the maintenance router appends to
    ``work_order_metadata``. Returns an empty list when none recorded yet.
    """
    raw = _record(metadata).get("completion_reviews")
    if not isinstance(raw, list):
        return []
    reviews: list[MaintenanceCompletionReviewRead] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        reviews.append(
            MaintenanceCompletionReviewRead(
                party=_text(entry.get("party")),
                outcome=_text(entry.get("outcome")),
                notes=_text(entry.get("notes")),
                reviewed_by=_text(entry.get("reviewed_by")),
                reviewed_at=_text(entry.get("reviewed_at")),
            )
        )
    return reviews


class MaintenanceWorkOrderCreate(BaseModel):
    entity_id: UUID
    title: str
    description: str | None = None
    property_id: UUID | None = None
    tenancy_unit_id: UUID | None = None
    tenant_id: UUID | None = None
    lease_id: UUID | None = None
    status: MaintenanceWorkOrderStatus = MaintenanceWorkOrderStatus.requested
    priority: MaintenancePriority = MaintenancePriority.normal
    requested_at: datetime | None = None
    contractor_name: str | None = None
    contractor_email: str | None = None
    contractor_phone: str | None = None
    contractor_assigned_at: datetime | None = None
    approval_required: bool = False
    approval_status: MaintenanceApprovalStatus = MaintenanceApprovalStatus.not_required
    approval_limit_cents: int | None = Field(default=None, ge=0)
    quote_amount_cents: int | None = Field(default=None, ge=0)
    approved_by_user_id: UUID | None = None
    approved_at: datetime | None = None
    approval_notes: str | None = None
    source_document_id: UUID | None = None
    invoice_draft_id: UUID | None = None
    invoice_reference: str | None = None
    invoice_amount_cents: int | None = Field(default=None, ge=0)
    source_reference: str | None = None
    due_date: date | None = None
    completed_at: datetime | None = None
    notes: str | None = None
    document_ids: list[UUID] = Field(default_factory=list)
    photo_document_ids: list[UUID] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class MaintenanceWorkOrderUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    property_id: UUID | None = None
    tenancy_unit_id: UUID | None = None
    tenant_id: UUID | None = None
    lease_id: UUID | None = None
    status: MaintenanceWorkOrderStatus | None = None
    priority: MaintenancePriority | None = None
    requested_at: datetime | None = None
    contractor_name: str | None = None
    contractor_email: str | None = None
    contractor_phone: str | None = None
    contractor_assigned_at: datetime | None = None
    approval_required: bool | None = None
    approval_status: MaintenanceApprovalStatus | None = None
    approval_limit_cents: int | None = Field(default=None, ge=0)
    quote_amount_cents: int | None = Field(default=None, ge=0)
    approved_by_user_id: UUID | None = None
    approved_at: datetime | None = None
    approval_notes: str | None = None
    source_document_id: UUID | None = None
    invoice_draft_id: UUID | None = None
    invoice_reference: str | None = None
    invoice_amount_cents: int | None = Field(default=None, ge=0)
    source_reference: str | None = None
    due_date: date | None = None
    completed_at: datetime | None = None
    notes: str | None = None
    document_ids: list[UUID] | None = None
    photo_document_ids: list[UUID] | None = None
    metadata: dict[str, Any] | None = None


class MaintenanceWorkOrderCommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
    visibility: MaintenanceCommentVisibility = "internal"


MaintenanceCompletionReviewParty = Literal["owner", "tenant"]
MaintenanceCompletionReviewOutcome = Literal["confirmed", "follow_up_requested"]


class MaintenanceCompletionReviewCreate(BaseModel):
    """Operator-recorded owner/tenant review of a completed work order.

    Records what the operator heard from the owner or tenant after a work
    order was completed. It does not contact the owner or tenant — see the
    router endpoint for the future-notify hook attachment point.
    """

    party: MaintenanceCompletionReviewParty
    outcome: MaintenanceCompletionReviewOutcome
    notes: str | None = Field(default=None, max_length=2000)


class MaintenanceWorkOrderVendorPortalShare(BaseModel):
    contractor_id: UUID
    title: str = Field(min_length=1, max_length=160)
    comment: str | None = Field(default=None, max_length=2000)


class MaintenanceWorkOrderContractorEmailSend(BaseModel):
    subject: str | None = Field(default=None, max_length=200)
    body: str = Field(min_length=1, max_length=4000)
    include_comment: bool = True


class MaintenanceWorkOrderContractorSmsSend(BaseModel):
    body: str = Field(min_length=1, max_length=800)
    include_comment: bool = True


class MaintenanceWorkOrderRead(ApiModel):
    id: UUID
    entity_id: UUID
    property_id: UUID | None
    tenancy_unit_id: UUID | None
    tenant_id: UUID | None
    lease_id: UUID | None
    title: str
    description: str | None
    status: MaintenanceWorkOrderStatus
    priority: MaintenancePriority
    requested_at: datetime
    contractor_name: str | None
    contractor_email: str | None
    contractor_phone: str | None
    contractor_assigned_at: datetime | None
    approval_required: bool
    approval_status: MaintenanceApprovalStatus
    approval_limit_cents: int | None
    quote_amount_cents: int | None
    approved_by_user_id: UUID | None
    approved_at: datetime | None
    approval_notes: str | None
    source_document_id: UUID | None
    invoice_draft_id: UUID | None
    invoice_reference: str | None
    invoice_amount_cents: int | None
    source_reference: str | None
    due_date: date | None
    completed_at: datetime | None
    notes: str | None
    document_ids: list[UUID]
    photo_document_ids: list[UUID]
    metadata: dict[str, Any] = Field(
        validation_alias=AliasChoices("work_order_metadata", "metadata"),
        serialization_alias="metadata",
    )
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def channel_receipts(self) -> list[WorkAssignmentNoticeChannelReceiptRead]:
        return _maintenance_channel_receipts_from_metadata(
            self.metadata,
            contractor_email=self.contractor_email,
            contractor_phone=self.contractor_phone,
        )

    @computed_field  # type: ignore[prop-decorator]
    @property
    def completion_reviews(self) -> list[MaintenanceCompletionReviewRead]:
        return _completion_reviews_from_metadata(self.metadata)
