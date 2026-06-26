"""Relby AI first-class conversation thread API tests."""

from typing import Any
from uuid import UUID

from apps.api.routers import ai as ai_router
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import (
    ConversationThread,
    ConversationTurn,
    ConversationTurnKind,
    ConversationTurnRole,
    DocumentIntake,
    Entity,
    UserEntityRole,
    UserRole,
)
from stewart.core.settings import Settings, get_settings
from tests.support.provider_guardrail import (
    provider_mutation_audit_rows as _provider_mutation_audit_rows,
)


def _entity(session: Session) -> Entity:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return entity


def _thread_payload(
    entity_id: str | None,
    title: str = "Add lease for Queen Street",
) -> dict[str, Any]:
    return {
        "entity_id": entity_id,
        "source": "cmdk",
        "context_route": "/properties",
        "context_record_refs": {"property_id": "property-1"},
        "title": title,
        "initial_turn": {
            "role": "user",
            "kind": "text",
            "payload": {"text": "Add the lease for these tenants"},
        },
    }


def _fake_lease_extraction() -> dict[str, Any]:
    return {
        "document_type": "lease",
        "summary": "Lease for Suite 4 with annual rent and review dates to confirm.",
        "confidence": 0.86,
        "parties": [
            {
                "name": "Northlakes Allied Health Pty Ltd",
                "role": "tenant",
                "confidence": 0.8,
                "source_hint": "Tenant details section",
            }
        ],
        "properties": [
            {
                "name": "Building 4 Northlakes",
                "address": "4 Northlakes Drive",
                "unit_label": "Suite 4",
                "confidence": 0.82,
                "source_hint": "Premises schedule",
            }
        ],
        "key_dates": [
            {
                "label": "Lease start",
                "date": "2026-01-01",
                "confidence": 0.9,
                "source_hint": "Lease particulars",
            },
            {
                "label": "Lease expiry",
                "date": "2029-12-31",
                "confidence": 0.9,
                "source_hint": "Lease particulars",
            }
        ],
        "money_amounts": [
            {
                "label": "Annual rent",
                "amount": 180000,
                "currency": "AUD",
                "frequency": "annual",
                "confidence": 0.88,
                "source_hint": "Rent schedule",
            }
        ],
        "obligations": [],
        "suggested_links": {
            "property_name": "Building 4 Northlakes",
            "tenant_name": "Northlakes Allied Health Pty Ltd",
        },
        "warnings": [],
        "missing_information": [],
    }


def test_create_thread_and_append_turns(
    client: TestClient,
    session: Session,
) -> None:
    entity = _entity(session)

    create_response = client.post(
        "/api/v1/conversation-threads",
        json=_thread_payload(str(entity.id)),
    )
    assert create_response.status_code == 201
    body = create_response.json()
    thread_id = body["id"]
    assert body["organisation_id"] == str(entity.organisation_id)
    assert body["entity_id"] == str(entity.id)
    assert body["source"] == "cmdk"
    assert body["context_route"] == "/properties"
    assert body["context_record_refs"] == {"property_id": "property-1"}
    assert body["title"] == "Add lease for Queen Street"
    assert [(turn["role"], turn["kind"]) for turn in body["turns"]] == [("user", "text")]

    append_response = client.post(
        f"/api/v1/conversation-threads/{thread_id}/turns",
        json={
            "role": "ai",
            "kind": "understanding",
            "payload": {
                "summary": "I found a retail lease.",
                "confidence": 0.9,
            },
        },
    )
    assert append_response.status_code == 201
    turns = append_response.json()["turns"]
    assert [(turn["role"], turn["kind"]) for turn in turns] == [
        ("user", "text"),
        ("ai", "understanding"),
    ]
    assert turns[1]["payload"]["summary"] == "I found a retail lease."

    get_response = client.get(f"/api/v1/conversation-threads/{thread_id}")
    assert get_response.status_code == 200
    assert [turn["id"] for turn in get_response.json()["turns"]] == [
        turn["id"] for turn in turns
    ]


def test_thread_scope_rejects_unreadable_entity(
    client: TestClient,
    session: Session,
) -> None:
    visible = _entity(session)
    hidden = Entity(organisation_id=visible.organisation_id, name="Hidden Trust")
    session.add(hidden)
    session.flush()
    hidden_thread = ConversationThread(
        organisation_id=visible.organisation_id,
        entity_id=hidden.id,
        created_by_user_id=get_settings().dev_user_id,
        source="cmdk",
        context_route="/properties",
        title="Hidden thread",
    )
    session.add(hidden_thread)
    session.commit()

    create_response = client.post(
        "/api/v1/conversation-threads",
        json=_thread_payload(str(hidden.id), title="Should not create"),
    )
    assert create_response.status_code == 403

    get_response = client.get(f"/api/v1/conversation-threads/{hidden_thread.id}")
    assert get_response.status_code == 403


def test_org_wide_recent_threads_only_returns_readable_entities(
    client: TestClient,
    session: Session,
) -> None:
    settings = get_settings()
    visible = _entity(session)
    readable_peer = Entity(
        organisation_id=visible.organisation_id,
        name="Readable Peer Trust",
    )
    hidden = Entity(organisation_id=visible.organisation_id, name="Hidden Trust")
    session.add_all([readable_peer, hidden])
    session.flush()
    session.add(
        UserEntityRole(
            user_id=settings.dev_user_id,
            entity_id=readable_peer.id,
            role=UserRole.viewer,
        )
    )
    org_thread = ConversationThread(
        organisation_id=visible.organisation_id,
        entity_id=None,
        created_by_user_id=settings.dev_user_id,
        source="cmdk",
        context_route="/",
        title="Org thread",
    )
    visible_thread = ConversationThread(
        organisation_id=visible.organisation_id,
        entity_id=visible.id,
        created_by_user_id=settings.dev_user_id,
        source="intake",
        context_route="/intake",
        title="Visible thread",
    )
    peer_thread = ConversationThread(
        organisation_id=visible.organisation_id,
        entity_id=readable_peer.id,
        created_by_user_id=settings.dev_user_id,
        source="cmdk",
        context_route="/properties",
        title="Peer thread",
    )
    hidden_thread = ConversationThread(
        organisation_id=visible.organisation_id,
        entity_id=hidden.id,
        created_by_user_id=settings.dev_user_id,
        source="cmdk",
        context_route="/properties",
        title="Hidden thread",
    )
    session.add_all([org_thread, visible_thread, peer_thread, hidden_thread])
    session.commit()

    response = client.get("/api/v1/conversation-threads")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(org_thread.id) in ids
    assert str(visible_thread.id) in ids
    assert str(peer_thread.id) in ids
    assert str(hidden_thread.id) not in ids


def test_ask_leasium_appends_turns_without_provider_mutation(
    client: TestClient,
    session: Session,
    monkeypatch: Any,
) -> None:
    entity = _entity(session)
    thread = client.post(
        "/api/v1/conversation-threads",
        json=_thread_payload(str(entity.id), title="Question thread"),
    ).json()

    def fake_ask_leasium(
        *, question: str, context: dict[str, Any], settings: Any
    ) -> tuple[dict[str, Any], str | None]:
        return (
            {
                "answer": "There is one property on file.",
                "citations": [],
                "warnings": [],
            },
            "resp_threaded_ask",
        )

    monkeypatch.setattr(ai_router, "ask_leasium", fake_ask_leasium)

    response = client.post(
        "/api/v1/ai/ask",
        json={
            "entity_id": str(entity.id),
            "question": "What properties are on file?",
            "thread_id": thread["id"],
        },
    )
    assert response.status_code == 200

    turns = session.scalars(
        select(ConversationTurn)
        .where(ConversationTurn.thread_id == UUID(thread["id"]))
        .order_by(ConversationTurn.created_at, ConversationTurn.id)
    ).all()
    assert [(turn.role, turn.kind) for turn in turns] == [
        (ConversationTurnRole.user, ConversationTurnKind.text),
        (ConversationTurnRole.user, ConversationTurnKind.text),
        (ConversationTurnRole.ai, ConversationTurnKind.text),
    ]
    assert turns[-2].payload["text"] == "What properties are on file?"
    assert turns[-1].payload["text"] == "There is one property on file."
    assert turns[-1].payload["response_id"] == "resp_threaded_ask"
    assert _provider_mutation_audit_rows(session) == []


def test_document_intake_apply_appends_created_turn_without_provider_mutation(
    client: TestClient,
    session: Session,
    monkeypatch: Any,
) -> None:
    def fake_extract_document_file(
        *,
        file_data: bytes,
        filename: str,
        content_type: str | None,
        settings: Settings,
    ) -> tuple[dict[str, Any], str]:
        return _fake_lease_extraction(), "resp_threaded_apply"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    entity = _entity(session)
    thread = client.post(
        "/api/v1/conversation-threads",
        json=_thread_payload(str(entity.id), title="Apply thread"),
    ).json()

    create_response = client.post(
        "/api/v1/document-intakes",
        data={"entity_id": str(entity.id)},
        files={"file": ("lease.txt", b"plain text lease", "text/plain")},
    )
    assert create_response.status_code == 201

    apply_response = client.post(
        f"/api/v1/document-intakes/{create_response.json()['id']}/apply",
        json={"review_data": _fake_lease_extraction(), "thread_id": thread["id"]},
    )
    assert apply_response.status_code == 200, apply_response.json()
    body = apply_response.json()
    assert body["status"] == "applied"
    assert body["review_data"]["applied"]["property_id"]

    intake = session.get(DocumentIntake, UUID(create_response.json()["id"]))
    assert intake is not None
    assert intake.review_data["applied"]["tenant_id"]

    created_turn = session.scalar(
        select(ConversationTurn)
        .where(
            ConversationTurn.thread_id == UUID(thread["id"]),
            ConversationTurn.kind == ConversationTurnKind.created,
        )
        .order_by(ConversationTurn.created_at.desc())
    )
    assert created_turn is not None
    assert created_turn.role == ConversationTurnRole.ai
    assert (
        created_turn.payload["applied"]["property_id"]
        == body["review_data"]["applied"]["property_id"]
    )
    assert created_turn.payload["provider_gate"] is True
    assert any(
        link["label"] == "Sync tenant to Xero"
        for link in created_turn.payload["next_steps"]
    )
    assert _provider_mutation_audit_rows(session) == []
