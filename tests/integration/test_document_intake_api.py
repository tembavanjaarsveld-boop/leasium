"""Smart Intake API tests with OpenAI extraction monkeypatched."""

from typing import Any
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import DocumentIntake, Entity, StoredDocument
from stewart.core.settings import Settings


def _entity_id(session: Session) -> str:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return str(entity.id)


def _fake_extraction() -> dict[str, Any]:
    return {
        "document_type": "lease",
        "summary": "Lease for Suite 4 with annual rent and review dates to confirm.",
        "confidence": 0.86,
        "parties": [
            {
                "name": "Northlakes Allied Health Pty Ltd",
                "role": "tenant",
                "abn": None,
                "contact": "Alex Taylor",
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
            "lease_reference": "Suite 4 lease",
        },
        "warnings": [],
        "missing_information": [],
        "proposed_actions": [
            {
                "action": "review_lease",
                "target": "lease",
                "summary": "Review extracted lease fields before applying.",
                "confidence": 0.86,
            }
        ],
    }


def test_document_intake_upload_extract_get_and_list(
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
        assert file_data == b"plain text lease"
        assert filename == "lease.txt"
        assert content_type == "text/plain"
        return _fake_extraction(), "resp_document_123"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    entity_id = _entity_id(session)

    create_response = client.post(
        "/api/v1/document-intakes",
        data={"entity_id": entity_id},
        files={"file": ("lease.txt", b"plain text lease", "text/plain")},
    )
    assert create_response.status_code == 201
    body = create_response.json()
    intake_id = body["id"]
    assert body["status"] == "uploaded"
    assert body["filename"] == "lease.txt"

    get_response = client.get(f"/api/v1/document-intakes/{intake_id}")
    assert get_response.status_code == 200
    get_body = get_response.json()
    assert get_body["status"] == "ready_for_review"
    assert get_body["document_type"] == "lease"
    assert get_body["summary"].startswith("Lease for Suite 4")
    assert get_body["confidence"] == 0.86
    assert get_body["openai_response_id"] == "resp_document_123"
    assert get_body["extracted_data"]["parties"][0]["name"] == "Northlakes Allied Health Pty Ltd"
    assert get_body["category"] == "lease"

    list_response = client.get("/api/v1/document-intakes", params={"entity_id": entity_id})
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()] == [intake_id]

    intake = session.get(DocumentIntake, UUID(intake_id))
    assert intake is not None
    assert intake.document_type == "lease"
    document = session.get(StoredDocument, intake.document_id)
    assert document is not None
    assert document.document_metadata["source"] == "smart_intake"


def test_document_intake_can_upload_then_extract_later(
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
        return _fake_extraction(), "resp_document_later"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    entity_id = _entity_id(session)

    create_response = client.post(
        "/api/v1/document-intakes",
        data={"entity_id": entity_id, "extract": "false"},
        files={"file": ("contract.md", b"# contract", "text/markdown")},
    )
    assert create_response.status_code == 201
    intake_id = create_response.json()["id"]
    assert create_response.json()["status"] == "uploaded"

    extract_response = client.post(f"/api/v1/document-intakes/{intake_id}/extract")
    assert extract_response.status_code == 200
    assert extract_response.json()["status"] == "ready_for_review"
    assert extract_response.json()["openai_response_id"] == "resp_document_later"


def test_document_intake_rejects_unsupported_files(
    client: TestClient,
    session: Session,
) -> None:
    response = client.post(
        "/api/v1/document-intakes",
        data={"entity_id": _entity_id(session)},
        files={"file": ("photo.png", b"png bytes", "image/png")},
    )
    assert response.status_code == 415
