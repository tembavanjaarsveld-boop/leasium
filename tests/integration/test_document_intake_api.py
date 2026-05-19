"""Smart Intake API tests with OpenAI extraction monkeypatched."""

from typing import Any
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from stewart.core.models import (
    AuditAction,
    BillingDraft,
    DocumentCategory,
    DocumentIntake,
    Entity,
    Lease,
    LeaseIntake,
    Obligation,
    Property,
    StoredDocument,
    TenancyUnit,
    Tenant,
)
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


def _fake_invoice_extraction() -> dict[str, Any]:
    return {
        **_fake_extraction(),
        "document_type": "invoice_admin",
        "summary": "Outgoings recovery invoice for the September billing run.",
        "parties": [
            {
                "name": "Northlakes Allied Health Pty Ltd",
                "role": "tenant",
                "abn": None,
                "contact": "Alex Taylor",
                "confidence": 0.82,
                "source_hint": "Bill to section",
            }
        ],
        "properties": [
            {
                "name": "Scope Plaza",
                "address": "8 Scope Street",
                "unit_label": "Suite 8",
                "confidence": 0.78,
                "source_hint": "Invoice description",
            }
        ],
        "key_dates": [
            {
                "label": "Payment due",
                "date": "2026-09-30",
                "confidence": 0.84,
                "source_hint": "Due date",
            }
        ],
        "money_amounts": [
            {
                "label": "Outgoings recovery",
                "amount": 2750.5,
                "currency": "AUD",
                "frequency": "one_off",
                "confidence": 0.83,
                "source_hint": "Amount due",
            }
        ],
        "obligations": [],
        "warnings": ["GST treatment needs finance review."],
        "missing_information": [],
        "proposed_actions": [
            {
                "action": "prepare_billing_review",
                "target": "billing",
                "summary": "Review the invoice amount before creating billing work.",
                "confidence": 0.82,
            }
        ],
    }


def _fake_purchase_contract_extraction() -> dict[str, Any]:
    return {
        **_fake_extraction(),
        "document_type": "purchase_contract",
        "summary": "Purchase contract for Docklands Trade Centre with settlement milestones.",
        "parties": [
            {
                "name": "Docklands Vendor Pty Ltd",
                "role": "vendor",
                "abn": None,
                "contact": "Pat Morgan",
                "confidence": 0.8,
                "source_hint": "Contract parties",
            }
        ],
        "properties": [
            {
                "name": "Docklands Trade Centre",
                "address": "18 Harbour Road",
                "unit_label": "Warehouse 1",
                "confidence": 0.88,
                "source_hint": "Property particulars",
                "sqm": 1200,
                "parking_spaces": 10,
                "ownership_structure": "trust",
                "owner_legal_name": "Docklands Property Trust",
                "owner_abn": "33 444 555 666",
                "trustee_name": "Docklands Trustee Pty Ltd",
                "trust_name": "Docklands Property Trust",
                "invoice_issuer_name": "Docklands Trustee Pty Ltd",
                "billing_contact_name": "Pat Morgan",
                "billing_email": "accounts@docklands.example",
                "invoice_reference": "DTC-",
                "ownership_split": "100% Docklands Property Trust",
                "owner_gst_registered": True,
                "xero_contact_id": "xero-docklands",
                "xero_tracking_category": "Docklands Trade Centre",
                "source_citations": {
                    "owner_abn": {
                        "source_hint": "Purchaser billing schedule",
                        "citation": "ABN 33 444 555 666",
                        "confidence": 0.91,
                    },
                    "owner_legal_name": "Purchaser details",
                },
            }
        ],
        "key_dates": [
            {
                "label": "Settlement",
                "date": "2026-10-15",
                "confidence": 0.87,
                "source_hint": "Settlement clause",
            }
        ],
        "money_amounts": [
            {
                "label": "Purchase price",
                "amount": 4200000,
                "currency": "AUD",
                "frequency": None,
                "confidence": 0.86,
                "source_hint": "Price schedule",
            }
        ],
        "obligations": [],
        "warnings": [],
        "missing_information": [],
        "proposed_actions": [
            {
                "action": "prepare_property_setup",
                "target": "property",
                "summary": "Create property shell and settlement milestone after review.",
                "confidence": 0.84,
            }
        ],
    }


def _fake_purchase_contract_with_tenancy_schedule() -> dict[str, Any]:
    extraction = _fake_purchase_contract_extraction()
    extraction["properties"] = [
        {
            **extraction["properties"][0],
            "unit_label": None,
            "sqm": None,
            "parking_spaces": None,
        }
    ]
    extraction["tenancy_schedule"] = [
        {
            "unit_label": "Warehouse 1",
            "sqm": 1200,
            "parking_spaces": 10,
            "tenant_name": "Harbour Logistics Pty Ltd",
            "tenant_abn": "11 222 333 444",
            "lease_start": "2026-07-01",
            "lease_expiry": "2029-06-30",
            "annual_rent": 240000,
            "rent_frequency": "monthly",
            "outgoings": "Recoverable",
            "option_summary": "One 3 year option",
            "security_summary": "Bank guarantee equal to 3 months rent",
            "confidence": 0.81,
            "source_hint": "Tenancy schedule row 1",
        },
        {
            "unit_label": "Warehouse 2",
            "sqm": 800,
            "parking_spaces": 6,
            "tenant_name": "Cold Chain Storage Pty Ltd",
            "tenant_abn": None,
            "lease_start": "2026-08-01",
            "lease_expiry": "2028-07-31",
            "annual_rent": 180000,
            "rent_frequency": "monthly",
            "outgoings": "Recoverable subject to annual budget",
            "option_summary": None,
            "security_summary": "Bond noted, amount to confirm",
            "confidence": 0.74,
            "source_hint": "Tenancy schedule row 2",
        },
    ]
    return extraction


def _fake_smart_lease_extraction() -> dict[str, Any]:
    return {
        **_fake_extraction(),
        "document_type": "lease",
        "summary": "Retail lease for Shop 2 at Smart Lease Arcade.",
        "parties": [
            {
                "name": "Smart Lease Retail Pty Ltd",
                "role": "tenant",
                "abn": "98 765 432 100",
                "contact": "Mia Patel",
                "confidence": 0.88,
                "source_hint": "Tenant schedule",
            }
        ],
        "properties": [
            {
                "name": "Smart Lease Arcade",
                "address": "44 Review Road",
                "unit_label": "Shop 2",
                "confidence": 0.86,
                "source_hint": "Premises schedule",
            }
        ],
        "key_dates": [
            {
                "label": "Lease commencement",
                "date": "2026-09-01",
                "confidence": 0.9,
                "source_hint": "Term",
            },
            {
                "label": "Lease expiry",
                "date": "2029-08-31",
                "confidence": 0.9,
                "source_hint": "Term",
            },
            {
                "label": "Rent review",
                "date": "2027-09-01",
                "confidence": 0.82,
                "source_hint": "Rent review clause",
            },
        ],
        "money_amounts": [
            {
                "label": "Annual rent",
                "amount": 144000,
                "currency": "AUD",
                "frequency": "annual",
                "confidence": 0.9,
                "source_hint": "Rent schedule",
            }
        ],
        "obligations": [
            {
                "title": "Bank guarantee review",
                "due_date": "2026-09-01",
                "category": "bank_guarantee",
                "notes": "Confirm guarantee before possession.",
                "confidence": 0.84,
                "source_hint": "Security clause",
            }
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


def test_document_intake_apply_invoice_prepares_billing_work(
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
        return _fake_invoice_extraction(), "resp_invoice_document"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    entity_id = _entity_id(session)
    scope = _lease_scope(client, session)

    create_response = client.post(
        "/api/v1/document-intakes",
        data={"entity_id": entity_id},
        files={"file": ("outgoings-invoice.txt", b"invoice", "text/plain")},
    )
    assert create_response.status_code == 201
    intake_id = create_response.json()["id"]
    document_id = create_response.json()["document_id"]

    apply_response = client.post(
        f"/api/v1/document-intakes/{intake_id}/apply",
        json={
            "review_data": _fake_invoice_extraction(),
            "property_id": scope["property_id"],
            "tenancy_unit_id": scope["tenancy_unit_id"],
            "lease_id": scope["lease_id"],
        },
    )
    assert apply_response.status_code == 200
    body = apply_response.json()
    assert body["status"] == "applied"
    assert body["category"] == "invoice"
    assert body["review_data"]["applied"]["action"] == "prepared_billing_work"
    assert body["review_data"]["applied"]["obligation_count"] == 1
    assert body["review_data"]["applied"]["billing_draft_count"] == 1

    obligation_id = body["review_data"]["applied"]["obligation_id"]
    obligation = session.get(Obligation, UUID(obligation_id))
    assert obligation is not None
    assert obligation.title == "Payment due"
    assert obligation.due_date.isoformat() == "2026-09-30"
    assert obligation.category == "other"
    assert "No invoice was created, posted, or synced." in (obligation.notes or "")
    assert obligation.obligation_metadata["document_type"] == "invoice_admin"
    assert obligation.obligation_metadata["money_amounts"][0]["amount"] == 2750.5
    assert (
        obligation.obligation_metadata["billing_draft_id"]
        == body["review_data"]["applied"]["billing_draft_id"]
    )
    assert str(obligation.property_id) == scope["property_id"]
    assert str(obligation.tenancy_unit_id) == scope["tenancy_unit_id"]
    assert str(obligation.lease_id) == scope["lease_id"]

    billing_draft = session.get(
        BillingDraft,
        UUID(body["review_data"]["applied"]["billing_draft_id"]),
    )
    assert billing_draft is not None
    assert billing_draft.status == "needs_review"
    assert billing_draft.title == "Outgoings recovery invoice for the September billing run."
    assert billing_draft.total_cents == 275050
    assert billing_draft.due_date is not None
    assert billing_draft.due_date.isoformat() == "2026-09-30"
    assert str(billing_draft.property_id) == scope["property_id"]
    assert str(billing_draft.tenancy_unit_id) == scope["tenancy_unit_id"]
    assert str(billing_draft.lease_id) == scope["lease_id"]
    assert str(billing_draft.tenant_id) == scope["tenant_id"]
    assert billing_draft.billing_metadata["document_type"] == "invoice_admin"
    assert billing_draft.lines[0].description == "Outgoings recovery"
    assert billing_draft.lines[0].amount_cents == 275050
    assert billing_draft.lines[0].source_hint == "Amount due"

    list_response = client.get(
        "/api/v1/billing-drafts",
        params={"entity_id": entity_id, "document_intake_id": intake_id},
    )
    assert list_response.status_code == 200
    assert list_response.json()[0]["id"] == str(billing_draft.id)
    assert list_response.json()[0]["lines"][0]["amount_cents"] == 275050

    document = session.get(StoredDocument, UUID(document_id))
    assert document is not None
    assert document.category == "invoice"
    assert str(document.property_id) == scope["property_id"]
    assert document.document_metadata["applied_document_type"] == "invoice_admin"


def test_document_intake_apply_purchase_contract_creates_property_records(
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
        return _fake_purchase_contract_extraction(), "resp_purchase_contract"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    entity_id = _entity_id(session)

    create_response = client.post(
        "/api/v1/document-intakes",
        data={"entity_id": entity_id},
        files={"file": ("purchase-contract.txt", b"contract", "text/plain")},
    )
    assert create_response.status_code == 201
    intake_id = create_response.json()["id"]
    document_id = create_response.json()["document_id"]

    apply_response = client.post(
        f"/api/v1/document-intakes/{intake_id}/apply",
        json={"review_data": _fake_purchase_contract_extraction()},
    )
    assert apply_response.status_code == 200
    body = apply_response.json()
    assert body["status"] == "applied"
    assert body["review_data"]["applied"]["action"] == "created_property_register_records"
    assert body["review_data"]["applied"]["tenancy_unit_count"] == 1
    assert body["review_data"]["applied"]["created_tenancy_unit_count"] == 1
    assert body["review_data"]["applied"]["obligation_count"] == 1

    prop = session.get(Property, UUID(body["review_data"]["applied"]["property_id"]))
    assert prop is not None
    assert prop.name == "Docklands Trade Centre"
    assert prop.street_address == "18 Harbour Road"
    assert prop.property_type == "other"
    assert prop.ownership_structure == "trust"
    assert prop.owner_legal_name == "Docklands Property Trust"
    assert prop.trustee_name == "Docklands Trustee Pty Ltd"
    assert prop.xero_contact_id == "xero-docklands"
    assert prop.property_metadata["source"] == "document_intake"
    assert prop.property_metadata["document_intake_id"] == intake_id
    assert prop.property_metadata["source_citations"]["owner_abn"] == {
        "source_hint": "Purchaser billing schedule",
        "citation": "ABN 33 444 555 666",
        "confidence": 0.91,
    }
    assert prop.property_metadata["apply_change_history"][0]["document_intake_id"] == intake_id
    assert body["review_data"]["applied"]["property_changes"]
    owner_abn_change = next(
        change
        for change in body["review_data"]["applied"]["property_changes"]
        if change["field"] == "owner_abn"
    )
    assert owner_abn_change["before"] is None
    assert owner_abn_change["after"] == "33 444 555 666"
    assert owner_abn_change["source"]["source_hint"] == "Purchaser billing schedule"

    property_audit = session.scalar(
        select(AuditAction).where(
            AuditAction.target_table == "property",
            AuditAction.target_id == prop.id,
            AuditAction.tool_name == "smart_intake_apply",
        )
    )
    assert property_audit is not None
    assert property_audit.tool_input is not None
    assert property_audit.tool_input["document_intake_id"] == intake_id
    assert property_audit.tool_input["changes"][0]["field"]

    unit_id = body["review_data"]["applied"]["tenancy_unit_ids"][0]
    unit = session.get(TenancyUnit, UUID(unit_id))
    assert unit is not None
    assert unit.unit_label == "Warehouse 1"
    assert unit.sqm == 1200
    assert unit.parking_spaces == 10

    obligation_id = body["review_data"]["applied"]["obligation_ids"][0]
    obligation = session.get(Obligation, UUID(obligation_id))
    assert obligation is not None
    assert obligation.title == "Settlement"
    assert obligation.due_date.isoformat() == "2026-10-15"
    assert obligation.property_id == prop.id
    assert obligation.tenancy_unit_id == unit.id

    document = session.get(StoredDocument, UUID(document_id))
    assert document is not None
    assert document.property_id == prop.id
    assert document.tenancy_unit_id == unit.id
    assert document.document_metadata["applied_document_type"] == "purchase_contract"


def test_document_intake_apply_purchase_contract_captures_tenancy_schedule(
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
        return _fake_purchase_contract_with_tenancy_schedule(), "resp_purchase_schedule"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    entity_id = _entity_id(session)

    create_response = client.post(
        "/api/v1/document-intakes",
        data={"entity_id": entity_id},
        files={"file": ("purchase-contract-schedule.txt", b"contract", "text/plain")},
    )
    assert create_response.status_code == 201
    intake_id = create_response.json()["id"]

    apply_response = client.post(
        f"/api/v1/document-intakes/{intake_id}/apply",
        json={"review_data": _fake_purchase_contract_with_tenancy_schedule()},
    )
    assert apply_response.status_code == 200
    body = apply_response.json()
    applied = body["review_data"]["applied"]
    assert applied["tenancy_unit_count"] == 2
    assert applied["created_tenancy_unit_count"] == 2
    assert applied["tenancy_schedule_count"] == 2
    assert applied["created_tenant_count"] == 2
    assert applied["created_lease_count"] == 2
    assert applied["tenant_lease_records_created"] == 4
    assert applied["skipped_tenancy_schedule_rows"] == []
    assert applied["tenancy_schedule_rows"][0]["tenant_name"] == "Harbour Logistics Pty Ltd"
    assert applied["tenancy_schedule_rows"][0]["annual_rent_cents"] == 24000000

    units = [
        session.get(TenancyUnit, UUID(unit_id)) for unit_id in applied["tenancy_unit_ids"]
    ]
    assert all(unit is not None for unit in units)
    assert [unit.unit_label for unit in units if unit is not None] == [
        "Warehouse 1",
        "Warehouse 2",
    ]
    first_unit = units[0]
    assert first_unit is not None
    assert first_unit.unit_metadata["tenancy_schedule"]["tenant_name"] == (
        "Harbour Logistics Pty Ltd"
    )
    assert first_unit.unit_metadata["tenancy_schedule"]["lease_expiry"] == "2029-06-30"
    assert (
        first_unit.unit_metadata["tenancy_schedule_history"][0]["document_intake_id"]
        == intake_id
    )

    tenant_count = session.scalar(select(func.count()).select_from(Tenant))
    lease_count = session.scalar(select(func.count()).select_from(Lease))
    assert tenant_count == 2
    assert lease_count == 2

    first_tenant = session.get(Tenant, UUID(applied["tenant_ids"][0]))
    assert first_tenant is not None
    assert first_tenant.legal_name == "Harbour Logistics Pty Ltd"
    assert first_tenant.abn == "11 222 333 444"
    assert first_tenant.tenant_metadata["document_intake_id"] == intake_id

    first_lease = session.get(Lease, UUID(applied["lease_ids"][0]))
    assert first_lease is not None
    assert first_lease.tenancy_unit_id == first_unit.id
    assert first_lease.tenant_id == first_tenant.id
    assert first_lease.status == "pending"
    assert first_lease.commencement_date is not None
    assert first_lease.commencement_date.isoformat() == "2026-07-01"
    assert first_lease.expiry_date is not None
    assert first_lease.expiry_date.isoformat() == "2029-06-30"
    assert first_lease.annual_rent_cents == 24000000
    assert first_lease.rent_frequency == "monthly"
    assert first_lease.lease_metadata["document_type"] == "purchase_contract"


def test_document_intake_apply_purchase_contract_reuses_selected_property(
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
        return _fake_purchase_contract_extraction(), "resp_selected_purchase_contract"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    entity_id = _entity_id(session)
    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Existing Acquisition Asset",
            "street_address": "99 Existing Road",
            "property_type": "commercial_industrial",
        },
    )
    assert property_response.status_code == 201
    unit_response = client.post(
        "/api/v1/tenancy-units",
        json={
            "property_id": property_response.json()["id"],
            "unit_label": "Existing Warehouse",
        },
    )
    assert unit_response.status_code == 201

    create_response = client.post(
        "/api/v1/document-intakes",
        data={"entity_id": entity_id},
        files={"file": ("selected-purchase-contract.txt", b"contract", "text/plain")},
    )
    assert create_response.status_code == 201

    apply_response = client.post(
        f"/api/v1/document-intakes/{create_response.json()['id']}/apply",
        json={
            "review_data": _fake_purchase_contract_extraction(),
            "property_id": property_response.json()["id"],
            "tenancy_unit_id": unit_response.json()["id"],
        },
    )
    assert apply_response.status_code == 200
    body = apply_response.json()
    assert body["review_data"]["applied"]["action"] == "linked_property_register_records"
    assert body["review_data"]["applied"]["property_id"] == property_response.json()["id"]
    assert body["review_data"]["applied"]["tenancy_unit_ids"] == [unit_response.json()["id"]]
    assert body["review_data"]["applied"]["created_tenancy_unit_count"] == 0
    linked_prop = session.get(Property, UUID(property_response.json()["id"]))
    assert linked_prop is not None
    assert linked_prop.owner_legal_name == "Docklands Property Trust"
    assert linked_prop.xero_contact_id == "xero-docklands"
    assert body["review_data"]["applied"]["filled_blank_property_fields"]
    linked_owner_change = next(
        change
        for change in body["review_data"]["applied"]["property_changes"]
        if change["field"] == "owner_legal_name"
    )
    assert linked_owner_change["before"] is None
    assert linked_owner_change["after"] == "Docklands Property Trust"
    assert linked_owner_change["source"]["source_hint"] == "Purchaser details"
    assert (
        linked_prop.property_metadata["apply_change_history"][0]["document_intake_id"]
        == create_response.json()["id"]
    )

    created_prop = session.scalar(
        select(Property).where(Property.name == "Docklands Trade Centre")
    )
    assert created_prop is None


def test_document_intake_apply_purchase_contract_rejects_missing_property_context(
    client: TestClient,
    session: Session,
    monkeypatch: Any,
) -> None:
    extraction = _fake_purchase_contract_extraction()
    extraction["properties"] = []

    def fake_extract_document_file(
        *,
        file_data: bytes,
        filename: str,
        content_type: str | None,
        settings: Settings,
    ) -> tuple[dict[str, Any], str]:
        return extraction, "resp_purchase_contract_missing_property"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    entity_id = _entity_id(session)

    create_response = client.post(
        "/api/v1/document-intakes",
        data={"entity_id": entity_id},
        files={"file": ("missing-property-contract.txt", b"contract", "text/plain")},
    )
    assert create_response.status_code == 201

    apply_response = client.post(
        f"/api/v1/document-intakes/{create_response.json()['id']}/apply",
        json={"review_data": extraction},
    )
    assert apply_response.status_code == 422


def test_document_intake_apply_lease_creates_register_records(
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
        return _fake_smart_lease_extraction(), "resp_smart_lease"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    entity_id = _entity_id(session)

    create_response = client.post(
        "/api/v1/document-intakes",
        data={"entity_id": entity_id},
        files={"file": ("smart-lease.txt", b"retail lease", "text/plain")},
    )
    assert create_response.status_code == 201
    intake_id = create_response.json()["id"]
    document_id = create_response.json()["document_id"]

    reviewed = _fake_smart_lease_extraction()
    reviewed["money_amounts"][0]["amount"] = 150000
    apply_response = client.post(
        f"/api/v1/document-intakes/{intake_id}/apply",
        json={"review_data": reviewed},
    )
    assert apply_response.status_code == 200
    body = apply_response.json()
    assert body["status"] == "applied"
    assert body["category"] == "lease"
    assert body["review_data"]["applied"]["action"] == "created_lease_register_records"

    lease = session.get(Lease, UUID(body["review_data"]["applied"]["lease_id"]))
    assert lease is not None
    assert lease.annual_rent_cents == 15000000
    assert lease.commencement_date is not None
    assert lease.commencement_date.isoformat() == "2026-09-01"
    assert lease.expiry_date is not None
    assert lease.expiry_date.isoformat() == "2029-08-31"
    assert lease.next_review_date is not None
    assert lease.next_review_date.isoformat() == "2027-09-01"

    tenant = session.get(Tenant, lease.tenant_id)
    assert tenant is not None
    assert tenant.legal_name == "Smart Lease Retail Pty Ltd"
    assert tenant.contact_name == "Mia Patel"

    unit = session.get(TenancyUnit, lease.tenancy_unit_id)
    assert unit is not None
    assert unit.unit_label == "Shop 2"
    prop = session.get(Property, unit.property_id)
    assert prop is not None
    assert prop.name == "Smart Lease Arcade"
    assert prop.street_address == "44 Review Road"

    obligations = session.scalars(select(Obligation).where(Obligation.lease_id == lease.id)).all()
    assert {obligation.title for obligation in obligations} == {
        "Bank guarantee review",
        "Rent review",
        "Lease expiry",
    }

    lease_intake = session.get(
        LeaseIntake,
        UUID(body["review_data"]["applied"]["lease_intake_id"]),
    )
    assert lease_intake is not None
    assert lease_intake.applied_lease_id == lease.id
    assert lease_intake.extracted_data["source_document_intake_id"] == intake_id

    document = session.get(StoredDocument, UUID(document_id))
    assert document is not None
    assert document.lease_id == lease.id
    assert document.document_metadata["applied_lease_id"] == str(lease.id)


def test_document_intake_apply_lease_reuses_selected_records(
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
        return _fake_smart_lease_extraction(), "resp_selected_smart_lease"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    entity_id = _entity_id(session)
    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Selected Lease House",
            "street_address": "12 Link Only Lane",
            "suburb": "Brisbane City",
            "state": "QLD",
            "postcode": "4000",
            "property_type": "commercial_office",
        },
    )
    assert property_response.status_code == 201
    unit_response = client.post(
        "/api/v1/tenancy-units",
        json={"property_id": property_response.json()["id"], "unit_label": "Selected Suite"},
    )
    assert unit_response.status_code == 201
    tenant_response = client.post(
        "/api/v1/tenants",
        json={"entity_id": entity_id, "legal_name": "Selected Tenant Pty Ltd"},
    )
    assert tenant_response.status_code == 201

    create_response = client.post(
        "/api/v1/document-intakes",
        data={"entity_id": entity_id},
        files={"file": ("selected-smart-lease.txt", b"retail lease", "text/plain")},
    )
    assert create_response.status_code == 201

    apply_response = client.post(
        f"/api/v1/document-intakes/{create_response.json()['id']}/apply",
        json={
            "review_data": _fake_smart_lease_extraction(),
            "property_id": property_response.json()["id"],
            "tenancy_unit_id": unit_response.json()["id"],
            "tenant_id": tenant_response.json()["id"],
        },
    )
    assert apply_response.status_code == 200
    lease = session.get(Lease, UUID(apply_response.json()["review_data"]["applied"]["lease_id"]))
    assert lease is not None
    assert str(lease.tenancy_unit_id) == unit_response.json()["id"]
    assert str(lease.tenant_id) == tenant_response.json()["id"]

    unit = session.get(TenancyUnit, lease.tenancy_unit_id)
    assert unit is not None
    assert str(unit.property_id) == property_response.json()["id"]
    generated_tenant = session.scalar(
        select(Tenant).where(Tenant.legal_name == "Smart Lease Retail Pty Ltd")
    )
    assert generated_tenant is None


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
        extraction = _fake_extraction()
        extraction["document_type"] = "tenant_document"
        return extraction, "resp_document_tenant_apply"

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
        json={"review_data": {"document_type": "tenant_document"}},
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
