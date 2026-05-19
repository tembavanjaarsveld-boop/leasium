"""Smart Intake API tests with OpenAI extraction monkeypatched."""

from typing import Any
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import DocumentCategory, DocumentIntake, Entity, Obligation, StoredDocument
from stewart.core.settings import Settings


def _entity_id(session: Session) -> str:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return str(entity.id)


def _lease_scope(client: TestClient, session: Session) -> dict[str, str]:
    entity_id = _entity_id(session)
    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Scope Plaza",
            "street_address": "8 Scope Street",
            "suburb": "Brisbane City",
            "state": "QLD",
            "postcode": "4000",
            "property_type": "commercial_office",
        },
    )
    assert property_response.status_code == 201
    unit_response = client.post(
        "/api/v1/tenancy-units",
        json={"property_id": property_response.json()["id"], "unit_label": "Suite 8"},
    )
    assert unit_response.status_code == 201
    tenant_response = client.post(
        "/api/v1/tenants",
        json={"entity_id": entity_id, "legal_name": "Scope Tenant Pty Ltd"},
    )
    assert tenant_response.status_code == 201
    lease_response = client.post(
        "/api/v1/leases",
        json={
            "tenancy_unit_id": unit_response.json()["id"],
            "tenant_id": tenant_response.json()["id"],
            "status": "active",
            "commencement_date": "2026-08-01",
            "expiry_date": "2029-07-31",
        },
    )
    assert lease_response.status_code == 201
    return {
        "property_id": property_response.json()["id"],
        "tenancy_unit_id": unit_response.json()["id"],
        "tenant_id": tenant_response.json()["id"],
        "lease_id": lease_response.json()["id"],
    }


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


def _fake_compliance_extraction() -> dict[str, Any]:
    return {
        **_fake_extraction(),
        "document_type": "compliance",
        "summary": "Fire safety statement with renewal and inspection actions.",
        "key_dates": [
            {
                "label": "Annual fire safety statement expiry",
                "date": "2027-05-01",
                "confidence": 0.88,
                "source_hint": "Certificate period",
            }
        ],
        "obligations": [
            {
                "title": "Renew annual fire safety statement",
                "due_date": "2027-05-01",
                "category": "compliance",
                "notes": "Certificate expires on this date.",
                "confidence": 0.88,
                "source_hint": "Certificate period",
            },
            {
                "title": "Schedule fire equipment inspection",
                "due_date": "2027-04-01",
                "category": "maintenance",
                "notes": "Inspection is required before renewal.",
                "confidence": 0.76,
                "source_hint": "Inspection notes",
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


def test_document_intake_can_be_created_from_existing_document(
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
        assert file_data == b"existing document"
        assert filename == "existing.txt"
        return _fake_extraction(), "resp_existing_document"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    entity_id = UUID(_entity_id(session))
    document = StoredDocument(
        entity_id=entity_id,
        filename="existing.txt",
        content_type="text/plain",
        byte_size=len(b"existing document"),
        file_data=b"existing document",
        category=DocumentCategory.onboarding,
        document_metadata={"source": "tenant_onboarding"},
    )
    session.add(document)
    session.commit()

    create_response = client.post(f"/api/v1/document-intakes/from-document/{document.id}")
    assert create_response.status_code == 200
    assert create_response.json()["document_id"] == str(document.id)
    intake_id = create_response.json()["id"]

    get_response = client.get(f"/api/v1/document-intakes/{intake_id}")
    assert get_response.status_code == 200
    assert get_response.json()["status"] == "ready_for_review"
    assert get_response.json()["openai_response_id"] == "resp_existing_document"
    session.refresh(document)
    assert document.document_metadata["smart_intake_id"] == intake_id
    assert document.document_metadata["source"] == "tenant_onboarding"

    create_again_response = client.post(f"/api/v1/document-intakes/from-document/{document.id}")
    assert create_again_response.status_code == 200
    assert create_again_response.json()["id"] == intake_id
    intakes = session.scalars(select(DocumentIntake)).all()
    assert len(intakes) == 1


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
    assert body["review_data"]["applied"]["obligation_ids"] == [obligation_id]
    assert body["review_data"]["applied"]["obligation_count"] == 1

    apply_again_response = client.post(
        f"/api/v1/document-intakes/{intake_id}/apply",
        json={"review_data": reviewed},
    )
    assert apply_again_response.status_code == 200
    obligations = session.scalars(select(Obligation)).all()
    assert len(obligations) == 1


def test_document_intake_apply_insurance_uses_existing_document_scope(
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
        return _fake_insurance_extraction(), "resp_scoped_insurance"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    scope = _lease_scope(client, session)
    document = StoredDocument(
        entity_id=UUID(_entity_id(session)),
        property_id=UUID(scope["property_id"]),
        tenancy_unit_id=UUID(scope["tenancy_unit_id"]),
        tenant_id=UUID(scope["tenant_id"]),
        lease_id=UUID(scope["lease_id"]),
        filename="scoped-insurance.txt",
        content_type="text/plain",
        byte_size=len(b"insurance"),
        file_data=b"insurance",
        category=DocumentCategory.insurance,
        document_metadata={"source": "tenant_onboarding"},
    )
    session.add(document)
    session.commit()

    create_response = client.post(f"/api/v1/document-intakes/from-document/{document.id}")
    assert create_response.status_code == 200
    intake_id = create_response.json()["id"]

    apply_response = client.post(
        f"/api/v1/document-intakes/{intake_id}/apply",
        json={"review_data": _fake_insurance_extraction()},
    )
    assert apply_response.status_code == 200
    obligation_id = apply_response.json()["review_data"]["applied"]["obligation_id"]
    obligation = session.get(Obligation, UUID(obligation_id))
    assert obligation is not None
    assert str(obligation.property_id) == scope["property_id"]
    assert str(obligation.tenancy_unit_id) == scope["tenancy_unit_id"]
    assert str(obligation.lease_id) == scope["lease_id"]


def test_document_intake_apply_compliance_creates_reviewed_obligations(
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
        return _fake_compliance_extraction(), "resp_compliance_document"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    entity_id = _entity_id(session)
    scope = _lease_scope(client, session)

    create_response = client.post(
        "/api/v1/document-intakes",
        data={"entity_id": entity_id},
        files={"file": ("fire-safety.txt", b"fire safety statement", "text/plain")},
    )
    assert create_response.status_code == 201
    intake_id = create_response.json()["id"]
    document_id = create_response.json()["document_id"]

    apply_response = client.post(
        f"/api/v1/document-intakes/{intake_id}/apply",
        json={
            "review_data": _fake_compliance_extraction(),
            "property_id": scope["property_id"],
            "tenancy_unit_id": scope["tenancy_unit_id"],
            "lease_id": scope["lease_id"],
        },
    )
    assert apply_response.status_code == 200
    body = apply_response.json()
    assert body["status"] == "applied"
    assert body["category"] == "other"
    assert body["review_data"]["applied"]["action"] == "created_document_obligations"
    assert body["review_data"]["applied"]["obligation_count"] == 2

    obligation_ids = body["review_data"]["applied"]["obligation_ids"]
    obligations = [session.get(Obligation, UUID(obligation_id)) for obligation_id in obligation_ids]
    assert [obligation.title for obligation in obligations if obligation is not None] == [
        "Renew annual fire safety statement",
        "Schedule fire equipment inspection",
    ]
    assert [obligation.category for obligation in obligations if obligation is not None] == [
        "compliance",
        "maintenance",
    ]
    assert all(
        str(obligation.property_id) == scope["property_id"]
        for obligation in obligations
        if obligation is not None
    )
    assert all(
        str(obligation.tenancy_unit_id) == scope["tenancy_unit_id"]
        for obligation in obligations
        if obligation is not None
    )
    assert all(
        str(obligation.lease_id) == scope["lease_id"]
        for obligation in obligations
        if obligation is not None
    )

    document = session.get(StoredDocument, UUID(document_id))
    assert document is not None
    assert document.property_id is not None
    assert document.document_metadata["applied_obligation_ids"] == obligation_ids
    assert document.document_metadata["applied_document_type"] == "compliance"


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
