"""Schemas for the operator comms queue.

The comms queue surfaces draft communications that the operator can review and
approve. It is the foundation of the scheduled comms loop documented in
``docs/automation-strategy-2026-05-23.md`` (priority 1).

This v1 endpoint is read-only — no provider sends. Approve/dispatch lives in a
later slice that wires the queue into the existing SendGrid + Twilio pipes
under the provider-mutation guardrail.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

CommsKind = Literal[
    "arrears_reminder",
    "insurance_expiry",
    "lease_renewal",
    "inbound_email",
    "inbound_sms",
    "compliance_obligation",
    "rent_review",
    "tenant_lifecycle_stall",
    "maintenance_contractor_forward",
    "maintenance_tenant_forward",
]
CommsSeverity = Literal["info", "warning", "danger"]
CommsCorrespondenceSource = Literal["inbound_message", "comms_audit"]
CommsCorrespondenceDirection = Literal["inbound", "outbound", "internal"]


class CommsCandidate(BaseModel):
    """A single draft communication suggested to the operator.

    The ``id`` is a stable composite (kind:target_kind:target_id) so the
    frontend can keep selection / dismiss state across refetches without
    relying on database identity for the queue row itself — the queue is
    derived from underlying records and not stored.
    """

    id: str
    kind: CommsKind
    target_kind: str
    target_id: UUID
    tenant_id: UUID | None = None
    tenant_name: str | None = None
    property_name: str | None = None
    unit_label: str | None = None
    related_target_ids: list[UUID] = Field(default_factory=list)
    recipient_email: str | None = None
    recipient_phone: str | None = None
    subject: str
    body: str
    severity: CommsSeverity = "info"
    due_at: date | None = None
    detail: str | None = None
    generated_at: datetime


class CommsQueueRead(BaseModel):
    """Read response for ``GET /api/v1/comms/queue``."""

    entity_id: UUID
    candidates: list[CommsCandidate]
    generated_at: datetime


class CommsQueueCountsRead(BaseModel):
    """Lightweight count summary for the sidebar nav badge.

    Built on the same scanners as ``CommsQueueRead`` but returns only totals
    by severity so the AppHeader can render an in-app notification badge on
    the Comms nav entry without paying the full candidate-construction cost
    on every page load.
    """

    entity_id: UUID
    total: int
    urgent: int
    by_kind: dict[CommsKind, int]
    generated_at: datetime


class CommsCorrespondenceEvent(BaseModel):
    """Read-only event in a tenant-linked correspondence timeline."""

    id: str
    source: CommsCorrespondenceSource
    direction: CommsCorrespondenceDirection
    event_type: str
    channel: str | None = None
    provider: str | None = None
    recipient: str | None = None
    from_address: str | None = None
    to_address: str | None = None
    subject: str | None = None
    summary: str | None = None
    body_preview: str | None = None
    target_kind: str | None = None
    target_id: UUID | None = None
    status: str | None = None
    occurred_at: datetime
    metadata: dict[str, str | int | float | bool | None] = Field(default_factory=dict)


class CommsTenantCorrespondenceRead(BaseModel):
    """Read-only tenant correspondence timeline response."""

    entity_id: UUID
    tenant_id: UUID
    tenant_name: str
    events: list[CommsCorrespondenceEvent]
    guardrails: list[str]
    generated_at: datetime


class CommsMaintenanceWorkOrderCorrespondenceRead(BaseModel):
    """Read-only maintenance work-order correspondence timeline response."""

    entity_id: UUID
    work_order_id: UUID
    work_order_title: str
    events: list[CommsCorrespondenceEvent]
    guardrails: list[str]
    generated_at: datetime


class CommsContractorCorrespondenceRead(BaseModel):
    """Read-only contractor correspondence timeline response."""

    entity_id: UUID
    contractor_id: UUID
    contractor_name: str
    events: list[CommsCorrespondenceEvent]
    guardrails: list[str]
    generated_at: datetime


class CommsOutboundLogRead(BaseModel):
    """Read-only entity-scoped comms dispatch receipt log."""

    entity_id: UUID
    events: list[CommsCorrespondenceEvent]
    guardrails: list[str]
    generated_at: datetime


class CommsDispatchCreate(BaseModel):
    """Payload for ``POST /api/v1/comms/dispatch``.

    The operator's click on the Approve button is the explicit approval that
    satisfies the provider-mutation guardrail. When a template key is present,
    an unedited draft is rendered from that stored template at send-time; if the
    operator edited the subject or body, the reviewed text is sent as-is.
    """

    kind: CommsKind
    target_kind: str
    target_id: UUID
    related_target_ids: list[UUID] = Field(default_factory=list, max_length=25)
    subject: str
    body: str
    recipient_email: str | None = None
    recipient_phone: str | None = None
    template_key: str | None = Field(default=None, max_length=120)
    template_version: str | None = Field(default=None, max_length=40)
    original_subject: str | None = None
    original_body: str | None = None


class CommsDispatchRead(BaseModel):
    """Read response for a dispatched draft."""

    candidate_id: str
    kind: CommsKind
    target_kind: str
    target_id: UUID
    channel: str
    status: str
    provider: str | None
    recipient: str | None
    provider_message_id: str | None = None
    error: str | None = None
    template_id: UUID | None = None
    template_key: str | None = None
    template_version: str | None = None
    template_status: str | None = None
    sent_at: datetime


class CommsTemplatePreviewCreate(BaseModel):
    """Preview a stored branded template against a current comms draft."""

    kind: CommsKind
    target_kind: str
    target_id: UUID
    related_target_ids: list[UUID] = Field(default_factory=list, max_length=25)
    template_key: str = Field(min_length=1, max_length=120)
    template_version: str | None = Field(default=None, max_length=40)
    channel: Literal["email", "sms"] = "email"


class CommsTemplatePreviewRead(BaseModel):
    """Rendered comms template preview. Review-only; no provider send."""

    entity_id: UUID
    candidate_id: str
    template_id: UUID
    template_key: str
    template_version: str
    channel: Literal["email", "sms"]
    subject: str | None
    body: str
    variables: dict[str, str] = Field(default_factory=dict)
    guardrails: list[str] = Field(default_factory=list)


class CommsDismissCreate(BaseModel):
    """Payload for ``POST /api/v1/comms/dismiss``.

    Records the operator's choice to defer a candidate. For arrears that
    moves ``reminder_paused_until``; for tenant/lease-scoped candidates the
    backend stores a metadata snooze keyed by candidate id. Defaults to 7
    days when ``until`` is not supplied.
    """

    kind: CommsKind
    target_kind: str
    target_id: UUID
    related_target_ids: list[UUID] = Field(default_factory=list, max_length=25)
    until: date | None = None
    reason: str | None = None


class CommsDismissRead(BaseModel):
    """Read response for a dismissed candidate."""

    candidate_id: str
    kind: CommsKind
    target_kind: str
    target_id: UUID
    deferred_until: date
    reason: str | None = None
    dismissed_at: datetime
