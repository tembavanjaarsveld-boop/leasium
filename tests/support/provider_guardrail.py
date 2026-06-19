"""Assertions for review-first provider mutation guardrails."""

from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import AuditAction


def provider_mutation_audit_rows(session: Session) -> list[AuditAction]:
    provider_fragments = (
        "xero",
        "sendgrid",
        "twilio",
        "tenant_email",
        "tenant email",
        "payment",
        "reconciliation",
    )
    mutation_fragments = (
        "send",
        "sent",
        "sync",
        "synced",
        "dispatch",
        "payment",
        "reconciliation",
        "reconcile",
    )
    negated_provider_mutation_phrases = (
        "no provider mutation",
        "no provider dispatch",
        "no contractor dispatch",
        "no posting or xero sync",
        "no xero sync",
        "not send email",
        "does not send email",
        "no invoice was created, posted, or synced",
    )
    rows: list[AuditAction] = []
    for row in session.scalars(select(AuditAction)).all():
        text = " ".join(
            str(value or "")
            for value in (
                row.action,
                row.target_table,
                row.tool_name,
                row.tool_output_summary,
                row.error_message,
            )
        ).lower()
        if any(phrase in text for phrase in negated_provider_mutation_phrases):
            continue
        if any(fragment in text for fragment in provider_fragments) and any(
            fragment in text for fragment in mutation_fragments
        ):
            rows.append(row)
    return rows


def assert_no_provider_mutation_audit_rows(session: Session) -> None:
    assert provider_mutation_audit_rows(session) == []
