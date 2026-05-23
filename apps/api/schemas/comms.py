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

from pydantic import BaseModel

CommsKind = Literal[
    "arrears_reminder",
    "insurance_expiry",
    "lease_renewal",
    "inbound_email",
    "inbound_sms",
    "compliance_obligation",
]
CommsSeverity = Literal["info", "warning", "danger"]


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


class CommsDispatchCreate(BaseModel):
    """Payload for ``POST /api/v1/comms/dispatch``.

    The operator's click on the Approve button is the explicit approval that
    satisfies the provider-mutation guardrail. The subject and body are sent
    as-is — the operator can edit them inline before approving and the
    server does not re-derive the draft on dispatch.
    """

    kind: CommsKind
    target_kind: str
    target_id: UUID
    subject: str
    body: str
    recipient_email: str | None = None
    recipient_phone: str | None = None


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
    sent_at: datetime


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
