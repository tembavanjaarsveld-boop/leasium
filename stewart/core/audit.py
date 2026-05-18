"""Append-only audit logging for state changes and tool calls."""

from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from stewart.core.ids import uuid7
from stewart.core.models import AuditAction, AuditOutcome


def audit_log(
    session: Session,
    *,
    actor: str,
    action: str,
    outcome: AuditOutcome = AuditOutcome.success,
    request_id: UUID | None = None,
    user_id: UUID | None = None,
    entity_id: UUID | None = None,
    target_table: str | None = None,
    target_id: UUID | None = None,
    tool_name: str | None = None,
    tool_input: dict[str, Any] | None = None,
    tool_output_summary: str | None = None,
    duration_ms: int | None = None,
    error_message: str | None = None,
    data_classification: str = "internal",
) -> AuditAction:
    """Insert an audit row into the current transaction."""

    row = AuditAction(
        request_id=request_id or uuid7(),
        actor=actor,
        user_id=user_id,
        entity_id=entity_id,
        target_table=target_table,
        target_id=target_id,
        action=action,
        tool_name=tool_name,
        tool_input=tool_input,
        tool_output_summary=tool_output_summary,
        duration_ms=duration_ms,
        outcome=outcome,
        error_message=error_message,
        data_classification=data_classification,
    )
    session.add(row)
    return row
