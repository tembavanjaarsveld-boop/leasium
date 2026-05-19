"""Smart Intake API tests with OpenAI extraction monkeypatched."""

from typing import Any
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import DocumentIntake, Entity, Obligation, StoredDocument
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


def _fake_insurance_extraction() -> dict[str, Any]:
    return {
        **_fake_extraction(),
        "document_type": "insurance_certificate",
        "summary": "Public liability certificate issued by AIG Australia.",
        "parties": [
            {
                "name": "AIG Australia Limited",
                "role": "insurer",
                "abn": None,
                "contact": None,
                "confidence": 0.9,
                "source_hint": "Insurer section",
            },
            {
                "name": "Australian Accident Management Commercial Pty Ltd",
                "role": "named insured",
                "abn": None,
                "contact": None,
                "confidence": 0.82,
                "source_hint": "Named insured section",
            },
        ],
        "key_dates": [
            {
                "label": "Policy start",
                "date": "2026-03-31",
                "confidence": 0.9,
                "source_hint": "Policy period",
            },
            {
                "label": "Policy end",
                "date": "2027-03-31",
                "confidence": 0.9,
                "source_hint": "Policy period",
            },
        ],
        "warnings": [],
        "missing_information": [],
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


def test_document_intake_can_be_cleared(
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
        return _fake_extraction(), "resp_document_clear"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    entity_id = _entity_id(session)

    create_response = client.post(
        "/api/v1/document-intakes",
        data={"entity_id": entity_id},
        files={"file": ("insurance.txt", b"insurance", "text/plain")},
    )
    assert create_response.status_code == 201
    intake_id = create_response.json()["id"]
    document_id = create_response.json()["document_id"]

    delete_response = client.delete(f"/api/v1/document-intakes/{intake_id}")
    assert delete_response.status_code == 204

    list_response = client.get("/api/v1/document-intakes", params={"entity_id": entity_id})
    assert list_response.status_code == 200
    assert list_response.json() == []

    intake = session.get(DocumentIntake, UUID(intake_id))
    document = session.get(StoredDocument, UUID(document_id))
    assert intake is not None
    assert document is not None
    assert intake.deleted_at is not None
    assert document.deleted_at is not None


def test_document_intake_review_and_apply_insurance_obligation(
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
        return _fake_insurance_extraction(), "resp_document_insurance"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    entity_id = _entity_id(session)

    create_response = client.post(
        "/api/v1/document-intakes",
        data={"entity_id": entity_id},
        files={"file": ("insurance.txt", b"insurance certificate", "text/plain")},
    )
    assert create_response.status_code == 201
    intake_id = create_response.json()["id"]

    reviewed = _fake_insurance_extraction()
    reviewed["key_dates"][1]["date"] = "2027-04-15"
    review_response = client.post(
        f"/api/v1/document-intakes/{intake_id}/review",
        json={"review_data": reviewed},
    )
    assert review_response.status_code == 200
    assert review_response.json()["review_data"]["key_dates"][1]["date"] == "2027-04-15"
    assert review_response.json()["reviewed_at"] is not None
    assert review_response.json()["reviewed_by_user_id"] is not None

    apply_response = client.post(
        f"/api/v1/document-intakes/{intake_id}/apply",
        json={"review_data": reviewed},
    )
    assert apply_response.status_code == 200
    body = apply_response.json()
    assert body["status"] == "applied"
    assert body["applied_at"] is not None
    assert body["review_data"]["applied"]["action"] == "created_insurance_obligation"
    obligation_id = body["review_data"]["applied"]["obligation_id"]

    obligation = session.get(Obligation, UUID(obligation_id))
    assert obligation is not None
    assert obligation.category == "insurance"
    assert obligation.due_date.isoformat() == "2027-04-15"
    assert obligation.title == "Insurance certificate renewal"
    assert obligation.obligation_metadata["source"] == "document_intake"

    apply_again_response = client.post(
        f"/api/v1/document-intakes/{intake_id}/apply",
        json={"review_data": reviewed},
    )
    assert apply_again_response.status_code == 200
    obligations = session.scalars(select(Obligation)).all()
    assert len(obligations) == 1


def test_document_intake_apply_rejects_unsupported_document_type(
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
        return _fake_extraction(), "resp_document_lease_apply"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    entity_id = _entity_id(session)

    create_response = client.post(
        "/api/v1/document-intakes",
        data={"entity_id": entity_id},
        files={"file": ("lease.txt", b"lease", "text/plain")},
    )
    assert create_response.status_code == 201

    apply_response = client.post(
        f"/api/v1/document-intakes/{create_response.json()['id']}/apply",
        json={"review_data": _fake_extraction()},
    )
    assert apply_response.status_code == 409


def test_document_intake_apply_rejects_insurance_without_expiry(
    client: TestClient,
    session: Session,
    monkeypatch: Any,
) -> None:
    extraction = _fake_insurance_extraction()
    extraction["key_dates"] = [
        {
            "label": "Policy start",
            "date": "2026-03-31",
            "confidence": 0.9,
            "source_hint": "Policy period",
        }
    ]

    def fake_extract_document_file(
        *,
        file_data: bytes,
        filename: str,
        content_type: str | None,
        settings: Settings,
    ) -> tuple[dict[str, Any], str]:
        return extraction, "resp_document_no_expiry"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    entity_id = _entity_id(session)

    create_response = client.post(
        "/api/v1/document-intakes",
        data={"entity_id": entity_id},
        files={"file": ("insurance.txt", b"insurance", "text/plain")},
    )
    assert create_response.status_code == 201

    apply_response = client.post(
        f"/api/v1/document-intakes/{create_response.json()['id']}/apply",
        json={"review_data": extraction},
    )
    assert apply_response.status_code == 422
