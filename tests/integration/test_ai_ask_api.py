"""Ask Leasium API tests."""

from typing import Any
from uuid import UUID, uuid4

from apps.api.routers import ai as ai_router
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from stewart.core.models import AuditAction, Entity


def _entity_id(session: Session) -> str:
    entity = session.scalar(
        select(Entity).where(Entity.name == "SKJ Property Pty Ltd")
    )
    assert entity is not None
    return str(entity.id)


def test_ask_leasium_returns_answer_with_validated_citations(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    entity_id = _entity_id(session)
    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Ask Plaza",
            "street_address": "1 Ask Street",
            "suburb": "Brisbane",
            "state": "QLD",
            "postcode": "4000",
            "property_type": "commercial_retail",
        },
    )
    assert property_response.status_code == 201
    property_id = property_response.json()["id"]
    bogus_id = str(uuid4())

    captured: dict[str, Any] = {}

    def fake_ask_leasium(
        *, question: str, context: dict[str, Any], settings: Any
    ) -> tuple[dict[str, Any], str | None]:
        captured["question"] = question
        captured["context"] = context
        return (
            {
                "answer": "Ask Plaza is the only property on file.",
                "citations": [
                    {
                        "kind": "property",
                        "target_id": property_id,
                        "label": "Ask Plaza",
                    },
                    # This one references a bogus id — the router must drop it.
                    {
                        "kind": "property",
                        "target_id": bogus_id,
                        "label": "Made-up Plaza",
                    },
                    # Malformed entry — router drops it.
                    {"kind": "property"},
                ],
                "warnings": ["Some properties may be missing addresses."],
            },
            "resp_ask_001",
        )

    monkeypatch.setattr(ai_router, "ask_leasium", fake_ask_leasium)

    response = client.post(
        "/api/v1/ai/ask",
        json={"entity_id": entity_id, "question": "What properties are on file?"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["answer"] == "Ask Plaza is the only property on file."
    # Only the valid property citation survived validation.
    assert len(body["citations"]) == 1
    citation = body["citations"][0]
    assert citation["kind"] == "property"
    assert citation["target_id"] == property_id
    assert citation["href"] == f"/properties?property_id={property_id}"
    assert body["warnings"] == ["Some properties may be missing addresses."]
    assert "Read-only" in body["guardrails"][0]
    assert body["response_id"] == "resp_ask_001"

    # Context shape sanity.
    context = captured["context"]
    assert isinstance(context, dict)
    assert any(p["id"] == property_id for p in context["properties"])
    assert "tenants" in context
    assert "leases" in context
    assert "obligations" in context
    assert "maintenance_work_orders" in context
    assert "arrears_cases" in context

    # Audit log captures the question and citation kinds (not the answer text).
    audit_rows = list(
        session.scalars(
            select(AuditAction)
            .where(AuditAction.tool_name == "ask_leasium")
            .order_by(AuditAction.occurred_at.desc())
        ).all()
    )
    assert audit_rows
    latest = audit_rows[0]
    assert latest.action == "query"
    assert latest.target_table == "ask_leasium"
    assert latest.tool_input["question"] == "What properties are on file?"
    assert latest.tool_input["citation_kinds"] == ["property"]
    assert latest.entity_id == UUID(entity_id)
    assert latest.data_classification == "internal"


def test_ask_leasium_503_when_helper_raises(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    entity_id = _entity_id(session)
    from stewart.ai.ask import AskError

    def fake_ask_leasium(**_: Any) -> tuple[dict[str, Any], str | None]:
        raise AskError("OpenAI API key is not configured.")

    monkeypatch.setattr(ai_router, "ask_leasium", fake_ask_leasium)

    response = client.post(
        "/api/v1/ai/ask",
        json={"entity_id": entity_id, "question": "When does anything expire?"},
    )
    assert response.status_code == 503
    assert "OpenAI API key" in response.json()["detail"]
