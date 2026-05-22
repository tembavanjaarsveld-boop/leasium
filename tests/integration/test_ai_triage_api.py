"""Inbox triage API tests."""

from __future__ import annotations

from typing import Any

from apps.api.routers import ai as ai_router
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.ai.inbox import InboxTriageError
from stewart.core.models import AuditAction, Entity


def _entity_id(session: Session) -> str:
    entity = session.scalar(
        select(Entity).where(Entity.name == "SKJ Property Pty Ltd")
    )
    assert entity is not None
    return str(entity.id)


def test_inbox_triage_returns_classification_and_audits(
    client: TestClient, session: Session, monkeypatch
) -> None:
    entity_id = _entity_id(session)

    def fake_triage(
        *, body: str, settings: Any
    ) -> tuple[dict[str, Any], str | None]:
        assert "leaking" in body
        return (
            {
                "kind": "maintenance_request",
                "confidence": 0.88,
                "summary": "Tenant reports a slow kitchen tap leak.",
                "suggested_action": "Open the maintenance queue and triage.",
                "suggested_target_kind": "maintenance_work_order",
                "key_facts": [
                    {"label": "Property", "value": "28 Queen Street"},
                    {"label": "Unit", "value": "Unit 3"},
                    {"label": "Severity", "value": "Non-urgent"},
                    # Malformed entries are dropped.
                    {"label": "", "value": "Should not survive"},
                    {"label": "Bad", "value": ""},
                ],
                "warnings": [
                    "Cabinet starting to swell — escalate if not addressed."
                ],
            },
            "resp_triage_001",
        )

    monkeypatch.setattr(ai_router, "triage_inbox", fake_triage)

    response = client.post(
        "/api/v1/ai/triage",
        json={
            "entity_id": entity_id,
            "body": (
                "Hi team, the kitchen tap at Unit 3, 28 Queen Street has been"
                " leaking for two days and is now dripping into the cabinet"
                " underneath. Can someone take a look this week?"
            ),
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["kind"] == "maintenance_request"
    assert body["confidence"] == 0.88
    assert body["suggested_target_kind"] == "maintenance_work_order"
    assert body["suggested_target_href"] == "/operations"
    # Malformed key_facts entries dropped.
    assert len(body["key_facts"]) == 3
    assert body["warnings"] == [
        "Cabinet starting to swell — escalate if not addressed.",
    ]
    assert body["guardrails"], "guardrails should be surfaced to the operator"

    audit_row = session.scalar(
        select(AuditAction)
        .where(AuditAction.target_table == "ai_inbox_triage")
        .order_by(AuditAction.occurred_at.desc())
    )
    assert audit_row is not None
    assert audit_row.tool_name == "ai_inbox_triage"
    assert audit_row.tool_input == {
        "body_length": len(
            "Hi team, the kitchen tap at Unit 3, 28 Queen Street has been"
            " leaking for two days and is now dripping into the cabinet"
            " underneath. Can someone take a look this week?"
        ),
        "kind": "maintenance_request",
        "confidence": 0.88,
        "target_kind": "maintenance_work_order",
        "warning_count": 1,
    }


def test_inbox_triage_503_when_helper_unavailable(
    client: TestClient, session: Session, monkeypatch
) -> None:
    entity_id = _entity_id(session)

    def fake_triage(*, body: str, settings: Any) -> tuple[dict[str, Any], str]:
        raise InboxTriageError("OpenAI API key is not configured.")

    monkeypatch.setattr(ai_router, "triage_inbox", fake_triage)

    response = client.post(
        "/api/v1/ai/triage",
        json={
            "entity_id": entity_id,
            "body": "Body must be at least ten characters to pass validation.",
        },
    )
    assert response.status_code == 503
    assert "OpenAI" in response.json()["detail"]
