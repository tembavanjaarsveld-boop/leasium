"""Audit logging tests."""

from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.models import AuditOutcome
from stewart.core.settings import get_settings


def test_audit_log_records_success(session: Session) -> None:
    settings = get_settings()
    row = audit_log(
        session,
        actor="user:test@example.com",
        user_id=settings.dev_user_id,
        action="create",
        target_table="property",
        outcome=AuditOutcome.success,
    )
    session.commit()

    assert row.id is not None
    assert row.outcome == AuditOutcome.success
    assert row.action == "create"


def test_audit_log_records_error(session: Session) -> None:
    row = audit_log(
        session,
        actor="cron:test",
        action="sync",
        outcome=AuditOutcome.error,
        error_message="boom",
    )
    session.commit()

    assert row.error_message == "boom"
    assert row.outcome == AuditOutcome.error
