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

CommsKind = Literal["arrears_reminder"]
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
