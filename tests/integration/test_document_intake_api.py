"""Smart Intake API tests with OpenAI extraction monkeypatched."""

from typing import Any
from uuid import UUID

from apps.api.routers import charge_rules as charge_rules_router
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from stewart.core.models import (
    AuditAction,
    BillingDraft,
    DocumentCategory,
    DocumentIntake,
    DocumentIntakeStatus,
    Entity,
    InvoiceDraft,
    Lease,
    LeaseIntake,
    MaintenanceWorkOrder,
    Obligation,
    Property,
    RentChargeRule,
    StoredDocument,
    TenancyUnit,
    Tenant,
)
from stewart.core.db import utcnow
from stewart.core.settings import Settings
from stewart.integrations.communications import DeliveryResult


def _entity_id(session: Session) -> str:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return str(entity.id)


def _organisation_id(session: Session) -> str:
    organisation_id = session.scalar(
        select(Entity.organisation_id).where(Entity.name == "SKJ Property Pty Ltd")
    )
    assert organisation_id is not None
    return str(organisation_id)


def _row_count(session: Session, model: Any) -> int:
    return session.scalar(select(func.count()).select_from(model)) or 0


def _provider_mutation_audit_rows(session: Session) -> list[AuditAction]:
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
        if any(fragment in text for fragment in provider_fragments) and any(
            fragment in text for fragment in mutation_fragments
        ):
            rows.append(row)
    return rows


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


def _fake_inspection_extraction(photo_document_id: str | None = None) -> dict[str, Any]:
    return {
        **_fake_extraction(),
        "document_type": "inspection_report",
        "summary": "Inspection report with two reviewed maintenance findings.",
        "inspection_findings": [
            {
                "title": "Repair leaking tap",
                "description": "Kitchen tap is leaking at the mixer.",
                "priority": "high",
                "due_date": "2026-10-02",
                "location": "Kitchen",
                "category": "plumbing",
                "confidence": 0.88,
                "source_hint": "Inspection item 4",
                "warnings": [],
                "photo_document_ids": [photo_document_id] if photo_document_id else [],
            },
            {
                "title": "Replace cracked tile",
                "description": "Cracked tile near the entry should be made safe.",
                "priority": "normal",
                "due_date": None,
                "location": "Entry",
                "category": "structural",
                "confidence": 0.72,
                "source_hint": "Inspection item 7",
                "warnings": ["Confirm whether this is tenant damage."],
                "photo_document_ids": [],
            },
        ],
        "obligations": [],
        "warnings": [],
        "missing_information": [],
        "proposed_actions": [
            {
                "action": "prepare_maintenance_work_orders",
                "target": "operations",
                "summary": "Review findings before creating work orders.",
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
            "next_review_date": "2027-07-01",
            "annual_rent": 240000,
            "rent_frequency": "monthly",
            "outgoings": "Recoverable",
            "outgoings_amount": 5500,
            "outgoings_frequency": "monthly",
            "parking_amount": 400,
            "parking_frequency": "monthly",
            "storage_amount": None,
            "storage_frequency": None,
            "utilities_amount": None,
            "utilities_frequency": None,
            "promotion_levy_amount": 250,
            "promotion_levy_frequency": "monthly",
            "other_charge_label": None,
            "other_charge_amount": None,
            "other_charge_frequency": None,
            "option_summary": "One 3 year option",
            "option_notice_date": "2029-01-31",
            "security_summary": "Bank guarantee equal to 3 months rent",
            "security_due_date": "2026-06-15",
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
            "next_review_date": None,
            "annual_rent": 180000,
            "rent_frequency": "monthly",
            "outgoings": "Recoverable subject to annual budget",
            "outgoings_amount": 4200,
            "outgoings_frequency": "monthly",
            "parking_amount": None,
            "parking_frequency": None,
            "storage_amount": None,
            "storage_frequency": None,
            "utilities_amount": 900,
            "utilities_frequency": "quarterly",
            "promotion_levy_amount": None,
            "promotion_levy_frequency": None,
            "other_charge_label": None,
            "other_charge_amount": None,
            "other_charge_frequency": None,
            "option_summary": None,
            "option_notice_date": None,
            "security_summary": "Bond noted, amount to confirm",
            "security_due_date": "2026-07-15",
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


def test_apply_clears_orphaned_lease_so_lease_can_be_reimported(
    client: TestClient,
    session: Session,
    monkeypatch: Any,
) -> None:
    extraction = {
        **_fake_extraction(),
        "key_dates": [
            {"label": "Lease start", "date": "2026-01-01", "confidence": 0.9},
            {"label": "Lease expiry", "date": "2028-12-31", "confidence": 0.9},
        ],
    }

    def fake_extract_document_file(
        *,
        file_data: bytes,
        filename: str,
        content_type: str | None,
        settings: Settings,
    ) -> tuple[dict[str, Any], str]:
        return extraction, "resp_orphan_reimport"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    entity_id = _entity_id(session)

    def import_lease() -> int:
        created = client.post(
            "/api/v1/document-intakes",
            data={"entity_id": entity_id},
            files={"file": ("lease.txt", b"lease", "text/plain")},
        )
        assert created.status_code == 201
        applied = client.post(
            f"/api/v1/document-intakes/{created.json()['id']}/apply",
            json={"review_data": extraction},
        )
        return applied.status_code

    assert import_lease() == 200

    tenant = session.scalar(
        select(Tenant).where(
            Tenant.legal_name == "Northlakes Allied Health Pty Ltd",
            Tenant.deleted_at.is_(None),
        )
    )
    assert tenant is not None
    orphan_lease = session.scalar(
        select(Lease).where(Lease.tenant_id == tenant.id, Lease.deleted_at.is_(None))
    )
    assert orphan_lease is not None

    # Simulate a tenant deleted before the cascade fix: the lease stays active
    # and orphaned.
    tenant.deleted_at = utcnow()
    session.commit()

    # Re-importing the lease must not be blocked by the orphaned lease.
    assert import_lease() == 200

    session.refresh(orphan_lease)
    assert orphan_lease.deleted_at is not None

    active_leases = session.scalars(
        select(Lease).where(Lease.deleted_at.is_(None))
    ).all()
    assert len(active_leases) == 1
    new_tenant = session.get(Tenant, active_leases[0].tenant_id)
    assert new_tenant is not None and new_tenant.deleted_at is None


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


def test_document_intake_apply_insurance_updates_scoped_tenant_metadata(
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
        return _fake_insurance_extraction(), "resp_scoped_insurance_metadata"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    scope = _lease_scope(client, session)
    tenant = session.get(Tenant, UUID(scope["tenant_id"]))
    assert tenant is not None
    tenant.tenant_metadata = {"insurance_expiry_date": "2026-12-31"}
    document = StoredDocument(
        entity_id=UUID(_entity_id(session)),
        property_id=UUID(scope["property_id"]),
        tenancy_unit_id=UUID(scope["tenancy_unit_id"]),
        tenant_id=UUID(scope["tenant_id"]),
        lease_id=UUID(scope["lease_id"]),
        filename="scoped-insurance-metadata.txt",
        content_type="text/plain",
        byte_size=len(b"insurance"),
        file_data=b"insurance",
        category=DocumentCategory.insurance,
        document_metadata={"source": "tenant_portal"},
    )
    session.add(document)
    session.commit()

    create_response = client.post(f"/api/v1/document-intakes/from-document/{document.id}")
    assert create_response.status_code == 200
    reviewed = _fake_insurance_extraction()
    reviewed["key_dates"][1]["date"] = "2027-04-15"

    apply_response = client.post(
        f"/api/v1/document-intakes/{create_response.json()['id']}/apply",
        json={"review_data": reviewed},
    )

    assert apply_response.status_code == 200
    session.refresh(tenant)
    assert tenant.tenant_metadata["insurance_confirmed"] is True
    assert tenant.tenant_metadata["insurance_expiry_date"] == "2027-04-15"
    assert tenant.tenant_metadata["insurance_document_id"] == str(document.id)
    history = tenant.tenant_metadata["insurance_auto_update_history"]
    assert history[-1]["document_intake_id"] == create_response.json()["id"]
    assert history[-1]["expiry_date"] == "2027-04-15"
    assert history[-1]["source"] == "document_intake"
    tenant_audit = session.scalar(
        select(AuditAction).where(
            AuditAction.target_table == "tenant",
            AuditAction.target_id == tenant.id,
            AuditAction.tool_name == "smart_intake_insurance_auto_update",
        )
    )
    assert tenant_audit is not None
    assert tenant_audit.action == "update"
    assert tenant_audit.tool_input["document_intake_id"] == create_response.json()["id"]
    assert tenant_audit.tool_input["document_id"] == str(document.id)
    assert tenant_audit.tool_input["expiry_date"] == "2027-04-15"
    assert tenant_audit.tool_output_summary == (
        "Updated tenant insurance metadata from reviewed Smart Intake certificate."
    )


def test_document_intake_apply_insurance_requires_reviewed_expiry_for_tenant_update(
    client: TestClient,
    session: Session,
    monkeypatch: Any,
) -> None:
    reviewed = _fake_insurance_extraction()
    reviewed["key_dates"] = [
        {
            "label": "Policy start",
            "date": "2026-03-31",
            "confidence": 0.9,
            "source_hint": "Policy period",
        }
    ]
    reviewed["obligations"] = [
        {
            "title": "Review insurance certificate",
            "due_date": "2027-04-15",
            "category": "insurance",
            "notes": "Follow up the reviewed certificate.",
        }
    ]

    def fake_extract_document_file(
        *,
        file_data: bytes,
        filename: str,
        content_type: str | None,
        settings: Settings,
    ) -> tuple[dict[str, Any], str]:
        return reviewed, "resp_scoped_insurance_missing_expiry"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    scope = _lease_scope(client, session)
    tenant = session.get(Tenant, UUID(scope["tenant_id"]))
    assert tenant is not None
    tenant.tenant_metadata = {"insurance_expiry_date": "2026-12-31"}
    document = StoredDocument(
        entity_id=UUID(_entity_id(session)),
        property_id=UUID(scope["property_id"]),
        tenancy_unit_id=UUID(scope["tenancy_unit_id"]),
        tenant_id=UUID(scope["tenant_id"]),
        lease_id=UUID(scope["lease_id"]),
        filename="scoped-insurance-no-expiry.txt",
        content_type="text/plain",
        byte_size=len(b"insurance"),
        file_data=b"insurance",
        category=DocumentCategory.insurance,
        document_metadata={"source": "tenant_portal"},
    )
    session.add(document)
    session.commit()

    create_response = client.post(f"/api/v1/document-intakes/from-document/{document.id}")
    assert create_response.status_code == 200

    apply_response = client.post(
        f"/api/v1/document-intakes/{create_response.json()['id']}/apply",
        json={"review_data": reviewed},
    )

    assert apply_response.status_code == 422
    assert apply_response.json()["detail"] == (
        "Confirm the insurance expiry date before applying."
    )
    intake = session.get(DocumentIntake, UUID(create_response.json()["id"]))
    assert intake is not None
    assert intake.status != DocumentIntakeStatus.applied
    assert session.scalars(select(Obligation)).all() == []
    session.refresh(tenant)
    assert tenant.tenant_metadata == {"insurance_expiry_date": "2026-12-31"}


def test_generic_lease_review_prefers_explicit_lease_dates() -> None:
    """An unusual expiry key-date label must not leave the lease term unset when
    the reviewer (e.g. the Leasium AI plan) hands in an explicit lease block."""
    from apps.api.routers.document_intakes import (
        _generic_lease_review_to_lease_intake_data,
    )

    data: dict[str, Any] = {
        "document_type": "lease",
        "properties": [{"name": "Building 3", "street_address": "205 Leitchs Rd"}],
        "parties": [{"name": "Gorilla Grind Pty Ltd", "role": "tenant"}],
        "key_dates": [
            {"label": "Commencement", "date": "2024-01-29"},
            # Not in the keyword set, so keyword derivation misses it.
            {"label": "Ending date", "date": "2027-12-10"},
        ],
        "money_amounts": [
            {"label": "Annual rent", "amount": 95000, "frequency": "month"},
        ],
    }

    derived = _generic_lease_review_to_lease_intake_data(data)
    assert derived["lease"]["expiry_date"] is None

    data["lease"] = {
        "commencement_date": "2024-01-29",
        "expiry_date": "2027-12-10",
    }
    resolved = _generic_lease_review_to_lease_intake_data(data)
    assert resolved["lease"]["commencement_date"] == "2024-01-29"
    assert resolved["lease"]["expiry_date"] == "2027-12-10"


def test_document_intake_apply_insurance_uses_lease_tenant_for_metadata(
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
        return _fake_insurance_extraction(), "resp_insurance_lease_tenant"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    scope = _lease_scope(client, session)
    other_scope = _lease_scope(client, session)
    lease_tenant = session.get(Tenant, UUID(scope["tenant_id"]))
    other_tenant = session.get(Tenant, UUID(other_scope["tenant_id"]))
    assert lease_tenant is not None
    assert other_tenant is not None
    document = StoredDocument(
        entity_id=UUID(_entity_id(session)),
        property_id=UUID(scope["property_id"]),
        tenancy_unit_id=UUID(scope["tenancy_unit_id"]),
        tenant_id=UUID(other_scope["tenant_id"]),
        lease_id=UUID(scope["lease_id"]),
        filename="mismatched-tenant-insurance.txt",
        content_type="text/plain",
        byte_size=len(b"insurance"),
        file_data=b"insurance",
        category=DocumentCategory.insurance,
        document_metadata={"source": "tenant_portal"},
    )
    session.add(document)
    session.commit()

    create_response = client.post(f"/api/v1/document-intakes/from-document/{document.id}")
    assert create_response.status_code == 200
    reviewed = _fake_insurance_extraction()
    reviewed["key_dates"][1]["date"] = "2027-05-20"

    apply_response = client.post(
        f"/api/v1/document-intakes/{create_response.json()['id']}/apply",
        json={"review_data": reviewed},
    )

    assert apply_response.status_code == 200
    session.refresh(document)
    session.refresh(lease_tenant)
    session.refresh(other_tenant)
    assert document.tenant_id == lease_tenant.id
    assert lease_tenant.tenant_metadata["insurance_expiry_date"] == "2027-05-20"
    assert "insurance_expiry_date" not in (other_tenant.tenant_metadata or {})


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


def test_document_intake_ai_opportunity_session_stores_review_only_metadata(
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
        return _fake_invoice_extraction(), "resp_invoice_opportunity"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    entity_id = _entity_id(session)
    create_response = client.post(
        "/api/v1/document-intakes",
        data={"entity_id": entity_id},
        files={"file": ("outgoings-invoice.txt", b"invoice", "text/plain")},
    )
    assert create_response.status_code == 201
    intake_id = create_response.json()["id"]
    before_counts = {
        Obligation: _row_count(session, Obligation),
        BillingDraft: _row_count(session, BillingDraft),
        MaintenanceWorkOrder: _row_count(session, MaintenanceWorkOrder),
    }

    response = client.post(
        f"/api/v1/document-intakes/{intake_id}/ai-opportunity-session",
        json={
            "review_data": _fake_invoice_extraction(),
            "selected_opportunity_id": "action-1",
            "answers": [
                {
                    "question_id": "billing-scope",
                    "question": "Which property or lease should this billing setup use?",
                    "answer": "Use Scope Plaza, Suite 8 lease.",
                    "structured_facts": {
                        "property_name": "Scope Plaza",
                        "unit_label": "Suite 8",
                    },
                }
            ],
            "proposed_output": {
                "kind": "billing_review",
                "title": "Review billing setup",
                "summary": "Prepare a local billing review from the uploaded invoice.",
                "rows": [
                    {
                        "label": "Amount",
                        "value": "AUD 2,750.50",
                        "source": "Amount due",
                    }
                ],
                "guardrail": "No invoice is approved, posted, emailed, or synced to Xero.",
            },
            "status": "open",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] in {"ready_for_review", "needs_attention"}
    session_data = body["review_data"]["ai_opportunity_session"]
    assert session_data["selected_opportunity_id"] == "action-1"
    assert body["applied_at"] is None
    assert body["reviewed_at"] is None
    assert body["reviewed_by_user_id"] is None
    assert {
        Obligation: _row_count(session, Obligation),
        BillingDraft: _row_count(session, BillingDraft),
        MaintenanceWorkOrder: _row_count(session, MaintenanceWorkOrder),
    } == before_counts
    assert _provider_mutation_audit_rows(session) == []


def test_document_intake_ai_opportunity_session_notice_fallback_prioritises_follow_up(
    client: TestClient,
    session: Session,
    monkeypatch: Any,
) -> None:
    reviewed = {
        **_fake_extraction(),
        "document_type": "notice",
        "summary": "Tenant notice with an amount and response deadline.",
        "key_dates": [
            {
                "label": "Response deadline",
                "date": "2026-10-15",
                "confidence": 0.87,
                "source_hint": "Notice deadline",
            }
        ],
        "money_amounts": [
            {
                "label": "Claimed adjustment",
                "amount": 1250,
                "currency": "AUD",
                "frequency": "one_off",
                "confidence": 0.8,
                "source_hint": "Notice amount",
            }
        ],
        "proposed_actions": [],
    }

    def fake_extract_document_file(
        *,
        file_data: bytes,
        filename: str,
        content_type: str | None,
        settings: Settings,
    ) -> tuple[dict[str, Any], str]:
        return reviewed, "resp_notice_opportunity"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    entity_id = _entity_id(session)
    create_response = client.post(
        "/api/v1/document-intakes",
        data={"entity_id": entity_id},
        files={"file": ("tenant-notice.txt", b"notice", "text/plain")},
    )
    assert create_response.status_code == 201
    intake_id = create_response.json()["id"]
    before_counts = {
        Obligation: _row_count(session, Obligation),
        BillingDraft: _row_count(session, BillingDraft),
        MaintenanceWorkOrder: _row_count(session, MaintenanceWorkOrder),
    }

    response = client.post(
        f"/api/v1/document-intakes/{intake_id}/ai-opportunity-session",
        json={"review_data": reviewed, "status": "open"},
    )

    assert response.status_code == 200
    opportunities = response.json()["review_data"]["ai_opportunity_session"][
        "opportunities"
    ]
    assert opportunities[0]["id"] == "action-1"
    assert opportunities[0]["kind"] == "create_follow_up_task"
    assert all(row["kind"] != "set_up_billing_pattern" for row in opportunities)
    assert {
        Obligation: _row_count(session, Obligation),
        BillingDraft: _row_count(session, BillingDraft),
        MaintenanceWorkOrder: _row_count(session, MaintenanceWorkOrder),
    } == before_counts
    assert _provider_mutation_audit_rows(session) == []


def test_document_intake_ai_opportunity_session_preserves_existing_review_data(
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
        return _fake_invoice_extraction(), "resp_invoice_reviewed_opportunity"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    entity_id = _entity_id(session)
    create_response = client.post(
        "/api/v1/document-intakes",
        data={"entity_id": entity_id},
        files={"file": ("reviewed-invoice.txt", b"invoice", "text/plain")},
    )
    assert create_response.status_code == 201
    intake_id = create_response.json()["id"]
    reviewed = _fake_invoice_extraction()
    review_response = client.post(
        f"/api/v1/document-intakes/{intake_id}/review",
        json={"review_data": reviewed},
    )
    assert review_response.status_code == 200
    reviewed_at = review_response.json()["reviewed_at"]
    reviewed_by_user_id = review_response.json()["reviewed_by_user_id"]

    response = client.post(
        f"/api/v1/document-intakes/{intake_id}/ai-opportunity-session",
        json={
            "answers": [
                {
                    "question_id": "billing-scope",
                    "question": "Which property or lease should this billing setup use?",
                    "answer": "Use Scope Plaza, Suite 8 lease.",
                    "structured_facts": {
                        "property_name": "Scope Plaza",
                        "unit_label": "Suite 8",
                    },
                }
            ],
            "status": "open",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["reviewed_at"] == reviewed_at
    assert body["reviewed_by_user_id"] == reviewed_by_user_id
    review_data = body["review_data"]
    assert review_data["document_type"] == reviewed["document_type"]
    assert review_data["summary"] == reviewed["summary"]
    assert review_data["money_amounts"] == reviewed["money_amounts"]
    assert review_data["ai_opportunity_session"]["answers"][0]["answer"] == (
        "Use Scope Plaza, Suite 8 lease."
    )


def test_document_intake_ai_opportunity_session_rejects_unready_or_applied_intake(
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
        return _fake_invoice_extraction(), "resp_invoice_reject_opportunity"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    entity_id = _entity_id(session)
    unready_response = client.post(
        "/api/v1/document-intakes",
        data={"entity_id": entity_id, "extract": "false"},
        files={"file": ("unready-invoice.txt", b"invoice", "text/plain")},
    )
    assert unready_response.status_code == 201
    reject_unready_response = client.post(
        f"/api/v1/document-intakes/{unready_response.json()['id']}/ai-opportunity-session",
        json={"answers": []},
    )
    assert reject_unready_response.status_code == 409

    scope = _lease_scope(client, session)
    ready_response = client.post(
        "/api/v1/document-intakes",
        data={"entity_id": entity_id},
        files={"file": ("applied-invoice.txt", b"invoice", "text/plain")},
    )
    assert ready_response.status_code == 201
    intake_id = ready_response.json()["id"]
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
    assert apply_response.json()["status"] == "applied"

    reject_applied_response = client.post(
        f"/api/v1/document-intakes/{intake_id}/ai-opportunity-session",
        json={"answers": []},
    )
    assert reject_applied_response.status_code == 409


def test_document_intake_ai_opportunity_session_flags_provider_candidates_without_writes(
    client: TestClient,
    session: Session,
    monkeypatch: Any,
) -> None:
    reviewed = _fake_invoice_extraction()
    reviewed["proposed_actions"] = [
        {
            "action": "match_xero_contact",
            "target": "xero_contact",
            "summary": "Map the extracted creditor to a Xero contact.",
            "confidence": 0.91,
        },
        {
            "action": "send_tenant_email",
            "target": "tenant_email",
            "summary": "Prepare a tenant notice email from this document.",
            "confidence": 0.64,
        },
    ]

    def fake_extract_document_file(
        *,
        file_data: bytes,
        filename: str,
        content_type: str | None,
        settings: Settings,
    ) -> tuple[dict[str, Any], str]:
        return reviewed, "resp_invoice_provider_opportunity"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    entity_id = _entity_id(session)
    create_response = client.post(
        "/api/v1/document-intakes",
        data={"entity_id": entity_id},
        files={"file": ("provider-candidate-invoice.txt", b"invoice", "text/plain")},
    )
    assert create_response.status_code == 201
    intake_id = create_response.json()["id"]
    before_counts = {
        Obligation: _row_count(session, Obligation),
        BillingDraft: _row_count(session, BillingDraft),
        MaintenanceWorkOrder: _row_count(session, MaintenanceWorkOrder),
    }

    response = client.post(
        f"/api/v1/document-intakes/{intake_id}/ai-opportunity-session",
        json={"review_data": reviewed, "status": "open"},
    )

    assert response.status_code == 200
    opportunities = response.json()["review_data"]["ai_opportunity_session"]["opportunities"]
    by_id = {row["id"]: row for row in opportunities}
    assert by_id["action-1"]["provider_mutations"] == ["xero"]
    assert by_id["action-1"]["requires_explicit_operator_approval"] is True
    assert by_id["action-2"]["provider_mutations"] == ["tenant_email"]
    assert by_id["action-2"]["requires_explicit_operator_approval"] is True
    assert {
        Obligation: _row_count(session, Obligation),
        BillingDraft: _row_count(session, BillingDraft),
        MaintenanceWorkOrder: _row_count(session, MaintenanceWorkOrder),
    } == before_counts
    assert _provider_mutation_audit_rows(session) == []


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

    blocked_invoice_response = client.post(
        f"/api/v1/billing-drafts/{billing_draft.id}/invoice-drafts"
    )
    assert blocked_invoice_response.status_code == 409

    list_response = client.get(
        "/api/v1/billing-drafts",
        params={"entity_id": entity_id, "document_intake_id": intake_id},
    )
    assert list_response.status_code == 200
    assert list_response.json()[0]["id"] == str(billing_draft.id)
    assert list_response.json()[0]["lines"][0]["amount_cents"] == 275050

    approve_response = client.patch(
        f"/api/v1/billing-drafts/{billing_draft.id}",
        json={
            "status": "approved",
            "notes": "Approved for invoice drafting; no Xero sync yet.",
        },
    )
    assert approve_response.status_code == 200
    approved_body = approve_response.json()
    assert approved_body["status"] == "approved"
    assert approved_body["notes"] == "Approved for invoice drafting; no Xero sync yet."
    assert approved_body["metadata"]["approved_by_user_id"]
    assert approved_body["metadata"]["status_history"][0]["status"] == "approved"

    invoice_response = client.post(
        f"/api/v1/billing-drafts/{billing_draft.id}/invoice-drafts"
    )
    assert invoice_response.status_code == 201
    invoice_body = invoice_response.json()
    assert invoice_body["billing_draft_id"] == str(billing_draft.id)
    assert invoice_body["status"] == "draft"
    assert invoice_body["title"] == billing_draft.title
    assert invoice_body["total_cents"] == 275050
    assert invoice_body["subtotal_cents"] == 275050
    assert invoice_body["gst_cents"] == 0
    assert invoice_body["due_date"] == "2026-09-30"
    assert invoice_body["recipient_name"] == "Scope Tenant Pty Ltd"
    assert invoice_body["metadata"]["delivery_state"] == {
        "pdf_generated": False,
        "pdf_artifact_stored": False,
        "pdf_preview_generated": False,
        "tenant_email_prepared": False,
        "tenant_email_sent": False,
        "delivery_ready": False,
        "xero_synced": False,
    }
    assert invoice_body["metadata"]["payment_status"]["status"] == "unpaid"
    assert invoice_body["metadata"]["rent_period"]["label"] == "Due 2026-09-30"
    assert "Tenant billing email missing." in invoice_body["metadata"]["readiness_blockers"]
    assert invoice_body["lines"][0]["billing_draft_line_id"] == str(billing_draft.lines[0].id)
    assert invoice_body["lines"][0]["description"] == "Outgoings recovery"
    assert invoice_body["lines"][0]["amount_cents"] == 275050

    invoice_draft = session.get(InvoiceDraft, UUID(invoice_body["id"]))
    assert invoice_draft is not None
    assert invoice_draft.billing_draft_id == billing_draft.id
    assert invoice_draft.invoice_number is not None
    assert invoice_draft.notes is not None
    assert "No PDF generated" in invoice_draft.notes

    blocked_delivery_response = client.post(
        f"/api/v1/invoice-drafts/{invoice_body['id']}/prepare-delivery"
    )
    assert blocked_delivery_response.status_code == 200
    blocked_delivery_body = blocked_delivery_response.json()
    assert blocked_delivery_body["status"] == "draft"
    assert "Tenant billing email missing." in blocked_delivery_body["metadata"][
        "delivery_blockers"
    ]
    assert blocked_delivery_body["metadata"]["delivery_state"]["pdf_generated"] is True
    assert blocked_delivery_body["metadata"]["delivery_state"]["pdf_artifact_stored"] is True
    assert blocked_delivery_body["metadata"]["delivery_state"]["pdf_preview_generated"] is True
    assert blocked_delivery_body["metadata"]["delivery_state"]["tenant_email_prepared"] is False
    assert blocked_delivery_body["metadata"]["delivery_state"]["tenant_email_sent"] is False
    assert blocked_delivery_body["metadata"]["delivery_state"]["xero_synced"] is False
    pdf_document_id = blocked_delivery_body["metadata"]["pdf_artifact"]["document_id"]
    pdf_document = session.get(StoredDocument, UUID(pdf_document_id))
    assert pdf_document is not None
    assert pdf_document.category == DocumentCategory.invoice
    assert pdf_document.content_type == "application/pdf"
    assert pdf_document.file_data.startswith(b"%PDF")

    blocked_approval_response = client.patch(
        f"/api/v1/invoice-drafts/{invoice_body['id']}",
        json={"status": "approved"},
    )
    assert blocked_approval_response.status_code == 409
    assert "delivery blockers" in blocked_approval_response.json()["detail"]

    preview_response = client.get(f"/api/v1/invoice-drafts/{invoice_body['id']}/preview")
    assert preview_response.status_code == 200
    assert "text/html" in preview_response.headers["content-type"]
    assert invoice_body["invoice_number"] in preview_response.text
    assert "Outgoings recovery" in preview_response.text
    assert "A PDF artifact record has been stored" in preview_response.text

    invoice_draft.recipient_email = "accounts@scope-tenant.example"
    session.commit()
    ready_delivery_response = client.post(
        f"/api/v1/invoice-drafts/{invoice_body['id']}/prepare-delivery"
    )
    assert ready_delivery_response.status_code == 200
    ready_delivery_body = ready_delivery_response.json()
    assert ready_delivery_body["status"] == "ready_for_approval"
    assert ready_delivery_body["metadata"]["delivery_blockers"] == []
    assert ready_delivery_body["metadata"]["delivery_state"]["pdf_artifact_stored"] is True
    assert ready_delivery_body["metadata"]["delivery_state"]["tenant_email_prepared"] is True
    assert ready_delivery_body["metadata"]["delivery_state"]["tenant_email_sent"] is False
    assert ready_delivery_body["metadata"]["delivery_state"]["xero_synced"] is False
    assert ready_delivery_body["metadata"]["delivery_preview"]["email"]["to"] == (
        "accounts@scope-tenant.example"
    )
    assert "No email has been sent" in ready_delivery_body["metadata"][
        "delivery_preview"
    ]["email"]["body"]

    approved_invoice_response = client.patch(
        f"/api/v1/invoice-drafts/{invoice_body['id']}",
        json={"status": "approved"},
    )
    assert approved_invoice_response.status_code == 200
    approved_invoice_body = approved_invoice_response.json()
    assert approved_invoice_body["status"] == "approved"
    assert approved_invoice_body["metadata"]["approved_by_user_id"]
    assert approved_invoice_body["metadata"]["delivery_state"]["tenant_email_sent"] is False
    assert approved_invoice_body["metadata"]["delivery_state"]["xero_synced"] is False
    assert (
        approved_invoice_body["metadata"]["posting_preparation"]["status"]
        == "approved_for_posting_preparation"
    )

    def fake_send_invoice_delivery_email(invite: Any, settings: Settings) -> DeliveryResult:
        assert invite.recipient_email == "accounts@scope-tenant.example"
        assert invite.pdf_document_id is not None
        assert invite.pdf_filename is not None
        assert invite.pdf_content.startswith(b"%PDF")
        assert settings.invoice_email_template_key == "invoice_delivery"
        return DeliveryResult(
            channel="email",
            status="queued",
            provider="sendgrid",
            recipient=invite.recipient_email,
            provider_message_id="sg-invoice-123",
        )

    monkeypatch.setattr(
        "apps.api.routers.charge_rules.send_invoice_delivery_email",
        fake_send_invoice_delivery_email,
    )
    provider_delivery_response = client.post(
        f"/api/v1/invoice-drafts/{invoice_body['id']}/send-delivery-email"
    )
    assert provider_delivery_response.status_code == 200
    provider_delivery_body = provider_delivery_response.json()
    assert provider_delivery_body["metadata"]["delivery_state"]["tenant_email_sent"] is True
    assert (
        provider_delivery_body["metadata"]["delivery_state"]["tenant_email_provider_status"]
        == "queued"
    )
    assert provider_delivery_body["metadata"]["delivery_email"]["send"]["provider"] == "sendgrid"
    assert provider_delivery_body["metadata"]["delivery_email"]["send"]["status"] == "queued"
    assert provider_delivery_body["metadata"]["delivery_email"]["send"][
        "provider_message_id"
    ] == "sg-invoice-123"
    assert provider_delivery_body["metadata"]["delivery_receipts"][0]["provider"] == "sendgrid"
    assert provider_delivery_body["metadata"]["delivery_state"]["xero_synced"] is False

    provider_receipt_response = client.post(
        "/api/v1/invoice-drafts/webhooks/sendgrid-events",
        json=[
            {
                "invoice_draft_id": invoice_body["id"],
                "sg_message_id": "sg-invoice-123",
                "event": "delivered",
                "email": "accounts@scope-tenant.example",
            }
        ],
    )
    assert provider_receipt_response.status_code == 204
    session.refresh(invoice_draft)
    assert (
        invoice_draft.invoice_metadata["delivery_state"]["tenant_email_provider_status"]
        == "delivered"
    )
    assert invoice_draft.invoice_metadata["delivery_receipts"][0]["event"] == "delivered"
    assert invoice_draft.invoice_metadata["delivery_email"]["send"]["xero_synced"] is False

    delivered_invoice_response = client.post(
        f"/api/v1/invoice-drafts/{invoice_body['id']}/record-delivery",
        json={"method": "manual", "notes": "Sent from finance inbox."},
    )
    assert delivered_invoice_response.status_code == 200
    delivered_invoice_body = delivered_invoice_response.json()
    assert delivered_invoice_body["metadata"]["delivery_state"]["tenant_email_sent"] is True
    assert delivered_invoice_body["metadata"]["delivery_email"]["send"]["status"] == "sent"
    assert delivered_invoice_body["metadata"]["delivery_receipts"][0]["status"] == "sent"
    assert delivered_invoice_body["metadata"]["delivery_state"]["xero_synced"] is False

    payment_response = client.patch(
        f"/api/v1/invoice-drafts/{invoice_body['id']}/payment-status",
        json={"status": "paid"},
    )
    assert payment_response.status_code == 200
    payment_body = payment_response.json()
    assert payment_body["metadata"]["payment_status"]["status"] == "paid"
    assert payment_body["metadata"]["payment_status"]["paid_cents"] == 275050
    assert payment_body["metadata"]["payment_status"]["outstanding_cents"] == 0

    duplicate_invoice_response = client.post(
        f"/api/v1/billing-drafts/{billing_draft.id}/invoice-drafts"
    )
    assert duplicate_invoice_response.status_code == 200
    assert duplicate_invoice_response.json()["id"] == invoice_body["id"]

    invoice_list_response = client.get(
        "/api/v1/invoice-drafts",
        params={"entity_id": entity_id, "billing_draft_id": str(billing_draft.id)},
    )
    assert invoice_list_response.status_code == 200
    assert invoice_list_response.json()[0]["id"] == invoice_body["id"]

    audit = session.scalar(
        select(AuditAction).where(
            AuditAction.target_table == "billing_draft",
            AuditAction.target_id == billing_draft.id,
            AuditAction.action == "update",
        )
    )
    assert audit is not None
    invoice_audit = session.scalar(
        select(AuditAction).where(
            AuditAction.target_table == "invoice_draft",
            AuditAction.target_id == UUID(invoice_body["id"]),
            AuditAction.action == "create",
        )
    )
    assert invoice_audit is not None
    assert "no PDF, tenant email, or Xero sync" in (invoice_audit.tool_output_summary or "")

    document = session.get(StoredDocument, UUID(document_id))
    assert document is not None
    assert document.category == "invoice"
    assert str(document.property_id) == scope["property_id"]
    assert document.document_metadata["applied_document_type"] == "invoice_admin"


def test_document_intake_apply_inspection_report_creates_work_orders(
    client: TestClient,
    session: Session,
    monkeypatch: Any,
) -> None:
    scope = _lease_scope(client, session)
    entity_id = _entity_id(session)
    photo = StoredDocument(
        entity_id=UUID(entity_id),
        property_id=UUID(scope["property_id"]),
        tenancy_unit_id=UUID(scope["tenancy_unit_id"]),
        tenant_id=UUID(scope["tenant_id"]),
        lease_id=UUID(scope["lease_id"]),
        filename="inspection-photo.jpg",
        content_type="image/jpeg",
        byte_size=12,
        file_data=b"photo-bytes",
        category=DocumentCategory.other,
        notes="Inspection photo",
        document_metadata={"source": "inspection_report"},
    )
    session.add(photo)
    session.commit()

    def fake_extract_document_file(
        *,
        file_data: bytes,
        filename: str,
        content_type: str | None,
        settings: Settings,
    ) -> tuple[dict[str, Any], str]:
        assert filename == "inspection.txt"
        return _fake_inspection_extraction(str(photo.id)), "resp_inspection_document"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )

    create_response = client.post(
        "/api/v1/document-intakes",
        data={"entity_id": entity_id},
        files={"file": ("inspection.txt", b"inspection notes", "text/plain")},
    )
    assert create_response.status_code == 201
    intake_id = create_response.json()["id"]

    get_response = client.get(f"/api/v1/document-intakes/{intake_id}")
    assert get_response.status_code == 200
    assert get_response.json()["document_type"] == "inspection_report"
    assert get_response.json()["extracted_data"]["inspection_findings"][0]["title"] == (
        "Repair leaking tap"
    )

    apply_response = client.post(
        f"/api/v1/document-intakes/{intake_id}/apply",
        json={
            "review_data": _fake_inspection_extraction(str(photo.id)),
            "property_id": scope["property_id"],
            "tenancy_unit_id": scope["tenancy_unit_id"],
            "tenant_id": scope["tenant_id"],
            "lease_id": scope["lease_id"],
        },
    )
    assert apply_response.status_code == 200
    body = apply_response.json()
    applied = body["review_data"]["applied"]
    assert applied["action"] == "created_inspection_work_orders"
    assert applied["work_order_count"] == 2
    assert applied["obligation_count"] == 0

    work_orders = session.scalars(
        select(MaintenanceWorkOrder).order_by(MaintenanceWorkOrder.created_at)
    ).all()
    assert [work_order.title for work_order in work_orders] == [
        "Repair leaking tap",
        "Replace cracked tile",
    ]
    first = work_orders[0]
    assert first.priority == "high"
    assert first.status == "requested"
    assert str(first.property_id) == scope["property_id"]
    assert str(first.tenancy_unit_id) == scope["tenancy_unit_id"]
    assert str(first.tenant_id) == scope["tenant_id"]
    assert str(first.lease_id) == scope["lease_id"]
    assert first.source_document_id == UUID(body["document_id"])
    assert first.document_ids == [UUID(body["document_id"])]
    assert first.photo_document_ids == [photo.id]
    assert first.work_order_metadata["document_intake_id"] == intake_id
    assert first.work_order_metadata["document_type"] == "inspection_report"
    assert "no contractor dispatch" in first.work_order_metadata["guardrail"]

    intake = session.get(DocumentIntake, UUID(intake_id))
    assert intake is not None
    assert intake.status == DocumentIntakeStatus.applied
    assert intake.document.document_metadata["applied_work_order_ids"] == applied["work_order_ids"]

    work_order_audit = session.scalar(
        select(AuditAction).where(
            AuditAction.target_table == "maintenance_work_order",
            AuditAction.target_id == first.id,
        )
    )
    assert work_order_audit is not None
    assert work_order_audit.tool_name == "smart_intake_apply"
    assert "no contractor dispatch" in (work_order_audit.tool_output_summary or "")


def test_document_intake_apply_inspection_rejects_cross_entity_photo(
    client: TestClient,
    session: Session,
) -> None:
    scope = _lease_scope(client, session)
    entity_id = _entity_id(session)
    other_entity_response = client.post(
        "/api/v1/entities",
        json={"organisation_id": _organisation_id(session), "name": "Other Entity"},
    )
    assert other_entity_response.status_code == 201
    photo = StoredDocument(
        entity_id=UUID(other_entity_response.json()["id"]),
        filename="other-photo.jpg",
        content_type="image/jpeg",
        byte_size=10,
        file_data=b"other-photo",
        category=DocumentCategory.other,
        notes="Other entity photo",
        document_metadata={},
    )
    document = StoredDocument(
        entity_id=UUID(entity_id),
        filename="inspection.txt",
        content_type="text/plain",
        byte_size=10,
        file_data=b"inspection",
        category=DocumentCategory.other,
        notes="Inspection report",
        document_metadata={"source": "smart_intake"},
    )
    session.add_all([photo, document])
    session.flush()
    intake = DocumentIntake(
        entity_id=UUID(entity_id),
        document_id=document.id,
        status=DocumentIntakeStatus.ready_for_review,
        document_type="inspection_report",
        summary="Inspection report",
        confidence=0.8,
        extracted_data=_fake_inspection_extraction(str(photo.id)),
        review_data={},
    )
    session.add(intake)
    session.commit()

    response = client.post(
        f"/api/v1/document-intakes/{intake.id}/apply",
        json={
            "review_data": _fake_inspection_extraction(str(photo.id)),
            "property_id": scope["property_id"],
        },
    )
    assert response.status_code == 422
    assert response.json()["detail"] == (
        "Inspection photo documents must belong to the intake entity."
    )
    assert session.scalars(select(MaintenanceWorkOrder)).all() == []


def test_invoice_sendgrid_receipt_requires_configured_secret(
    client: TestClient,
    monkeypatch,
) -> None:
    settings = charge_rules_router.get_settings()
    monkeypatch.setattr(
        charge_rules_router,
        "get_settings",
        lambda: settings.model_copy(update={"communications_webhook_secret": "sg-secret"}),
    )

    missing_response = client.post(
        "/api/v1/invoice-drafts/webhooks/sendgrid-events",
        json=[],
    )
    assert missing_response.status_code == 401
    assert missing_response.json()["detail"] == "Invalid webhook token."

    accepted_response = client.post(
        "/api/v1/invoice-drafts/webhooks/sendgrid-events",
        headers={"x-leasium-webhook-secret": "sg-secret"},
        json=[],
    )
    assert accepted_response.status_code == 204


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
    assert applied["created_charge_rule_count"] == 7
    assert applied["lease_obligation_count"] == 6
    assert applied["obligation_count"] == 7
    assert applied["skipped_tenancy_schedule_rows"] == []
    assert applied["tenancy_schedule_rows"][0]["tenant_name"] == "Harbour Logistics Pty Ltd"
    assert applied["tenancy_schedule_rows"][0]["annual_rent_cents"] == 24000000
    assert applied["tenancy_schedule_rows"][0]["parking_amount_cents"] == 40000
    assert applied["tenancy_schedule_rows"][0]["promotion_levy_amount_cents"] == 25000

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
    assert first_unit.unit_metadata["tenancy_schedule"]["option_notice_date"] == "2029-01-31"
    assert first_unit.unit_metadata["tenancy_schedule"]["security_due_date"] == "2026-06-15"
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
    assert first_lease.next_review_date is not None
    assert first_lease.next_review_date.isoformat() == "2027-07-01"
    assert first_lease.annual_rent_cents == 24000000
    assert first_lease.rent_frequency == "monthly"
    assert first_lease.lease_metadata["document_type"] == "purchase_contract"

    charge_rules = list(
        session.scalars(
            select(RentChargeRule).where(
                RentChargeRule.id.in_([UUID(item) for item in applied["charge_rule_ids"]])
            )
        )
    )
    assert len(charge_rules) == 7
    first_charge_rules = [rule for rule in charge_rules if rule.lease_id == first_lease.id]
    assert {rule.charge_type for rule in first_charge_rules} == {
        "base_rent",
        "outgoings",
        "parking",
        "promotion_levy",
    }
    first_base_rule = next(rule for rule in first_charge_rules if rule.charge_type == "base_rent")
    assert first_base_rule.amount_cents == 2000000
    assert first_base_rule.frequency == "monthly"
    assert first_base_rule.next_due_date is not None
    assert first_base_rule.next_due_date.isoformat() == "2026-07-01"
    assert first_base_rule.charge_rule_metadata["draft"] is True
    assert first_base_rule.charge_rule_metadata["annual_rent_cents"] == 24000000
    assert first_base_rule.charge_rule_metadata["document_intake_id"] == intake_id
    first_outgoings_rule = next(
        rule for rule in first_charge_rules if rule.charge_type == "outgoings"
    )
    assert first_outgoings_rule.amount_cents == 550000
    assert first_outgoings_rule.frequency == "monthly"
    assert first_outgoings_rule.charge_rule_metadata["draft"] is True
    assert first_outgoings_rule.charge_rule_metadata["outgoings"] == "Recoverable"
    first_parking_rule = next(rule for rule in first_charge_rules if rule.charge_type == "parking")
    assert first_parking_rule.amount_cents == 40000
    assert first_parking_rule.frequency == "monthly"
    assert first_parking_rule.charge_rule_metadata["schedule_charge_label"] == "Parking"
    first_promotion_rule = next(
        rule for rule in first_charge_rules if rule.charge_type == "promotion_levy"
    )
    assert first_promotion_rule.amount_cents == 25000
    assert first_promotion_rule.frequency == "monthly"
    assert first_promotion_rule.charge_rule_metadata["source_field"] == "promotion_levy_amount"
    assert applied["charge_rule_summaries"][0]["charge_type"] == "base_rent"
    assert {
        summary["charge_type"] for summary in applied["charge_rule_summaries"]
    } == {"base_rent", "outgoings", "parking", "promotion_levy", "utilities"}

    lease_obligations = list(
        session.scalars(
            select(Obligation).where(
                Obligation.id.in_([UUID(item) for item in applied["lease_obligation_ids"]])
            )
        )
    )
    assert len(lease_obligations) == 6
    assert {obligation.category for obligation in lease_obligations} == {
        "bank_guarantee",
        "lease_expiry",
        "option_notice",
        "rent_review",
    }
    assert any(
        obligation.title == "Rent review - Warehouse 1"
        and obligation.due_date.isoformat() == "2027-07-01"
        for obligation in lease_obligations
    )
    assert any(
        obligation.title == "Option notice - Warehouse 1"
        and obligation.due_date.isoformat() == "2029-01-31"
        for obligation in lease_obligations
    )
    assert any(
        obligation.title == "Security review - Warehouse 2"
        and obligation.due_date.isoformat() == "2026-07-15"
        for obligation in lease_obligations
    )


def test_document_intake_apply_purchase_contract_skips_invalid_schedule_rows(
    client: TestClient,
    session: Session,
    monkeypatch: Any,
) -> None:
    extraction = _fake_purchase_contract_with_tenancy_schedule()
    extraction["tenancy_schedule"] = [
        {
            **extraction["tenancy_schedule"][0],
            "tenant_name": None,
            "tenant_abn": None,
            "lease_start": "2027-07-01",
            "lease_expiry": "2026-06-30",
            "annual_rent": 0,
        }
    ]

    def fake_extract_document_file(
        *,
        file_data: bytes,
        filename: str,
        content_type: str | None,
        settings: Settings,
    ) -> tuple[dict[str, Any], str]:
        return extraction, "resp_purchase_schedule_invalid"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    entity_id = _entity_id(session)

    create_response = client.post(
        "/api/v1/document-intakes",
        data={"entity_id": entity_id},
        files={"file": ("purchase-contract-invalid-schedule.txt", b"contract", "text/plain")},
    )
    assert create_response.status_code == 201
    intake_id = create_response.json()["id"]

    apply_response = client.post(
        f"/api/v1/document-intakes/{intake_id}/apply",
        json={"review_data": extraction},
    )
    assert apply_response.status_code == 200
    applied = apply_response.json()["review_data"]["applied"]
    assert applied["tenancy_unit_count"] == 1
    assert applied["created_tenant_count"] == 0
    assert applied["created_lease_count"] == 0
    assert applied["created_charge_rule_count"] == 0
    assert applied["lease_obligation_count"] == 0
    assert len(applied["skipped_tenancy_schedule_rows"]) == 1
    skipped = applied["skipped_tenancy_schedule_rows"][0]
    assert skipped["unit_label"] == "Warehouse 1"
    assert "Lease expiry is before lease start." in skipped["blockers"]
    assert "Annual rent must be greater than zero." in skipped["blockers"]
    assert "Tenant name missing." in skipped["blockers"]

    tenant_count = session.scalar(select(func.count()).select_from(Tenant))
    lease_count = session.scalar(select(func.count()).select_from(Lease))
    charge_rule_count = session.scalar(select(func.count()).select_from(RentChargeRule))
    assert tenant_count == 0
    assert lease_count == 0
    assert charge_rule_count == 0


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


def test_document_intake_apply_lease_attaches_new_unit_to_existing_building(
    client: TestClient,
    session: Session,
    monkeypatch: Any,
) -> None:
    """A second lease for another unit of the same building attaches as a new
    unit under the existing building property instead of spawning a duplicate
    (the Leitchs B6 U4/U5 case), while a different building on the same street
    stays separate (the 2026-06-16 B3 != B6 guard)."""

    def make_extraction(unit_label: str, name: str, tenant: str) -> dict[str, Any]:
        data = _fake_smart_lease_extraction()
        data["properties"] = [
            {
                "name": name,
                "address": "205 Leitchs Road, Brendale",
                "unit_label": unit_label,
                "confidence": 0.9,
                "source_hint": "Premises",
            }
        ]
        data["parties"] = [
            {
                "name": tenant,
                "role": "tenant",
                "abn": None,
                "contact": None,
                "confidence": 0.9,
                "source_hint": "Tenant",
            }
        ]
        return data

    holder: dict[str, Any] = {}

    def fake_extract_document_file(
        *,
        file_data: bytes,
        filename: str,
        content_type: str | None,
        settings: Settings,
    ) -> tuple[dict[str, Any], str]:
        return holder["data"], "resp_building"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    entity_id = _entity_id(session)

    def apply_lease(unit_label: str, name: str, tenant: str) -> dict[str, Any]:
        holder["data"] = make_extraction(unit_label, name, tenant)
        create = client.post(
            "/api/v1/document-intakes",
            data={"entity_id": entity_id},
            files={"file": ("lease.txt", b"lease", "text/plain")},
        )
        assert create.status_code == 201
        applied = client.post(
            f"/api/v1/document-intakes/{create.json()['id']}/apply",
            json={"review_data": make_extraction(unit_label, name, tenant)},
        )
        assert applied.status_code == 200
        return applied.json()

    # First lease: register-style name carrying the unit.
    body1 = apply_lease("U4", "Leitchs B6 U4", "SKJ Capital U4 Pty Ltd")
    lease1 = session.get(Lease, UUID(body1["review_data"]["applied"]["lease_id"]))
    assert lease1 is not None
    unit1 = session.get(TenancyUnit, lease1.tenancy_unit_id)
    assert unit1 is not None
    building_id = unit1.property_id
    building = session.get(Property, building_id)
    assert building is not None
    # Stored at building level, not the unit-qualified premises, and keyed.
    assert building.name == "Leitchs B6"
    building_key = building.property_metadata.get("building_key")
    assert building_key

    # Second lease: extraction-style name with the unit inline -> same building.
    body2 = apply_lease(
        "Unit 5",
        "Building 6, Unit 5, 205 Leitchs Road, Brendale",
        "SKJ Capital U5 Pty Ltd",
    )
    lease2 = session.get(Lease, UUID(body2["review_data"]["applied"]["lease_id"]))
    assert lease2 is not None
    unit2 = session.get(TenancyUnit, lease2.tenancy_unit_id)
    assert unit2 is not None
    assert unit2.property_id == building_id
    assert unit1.id != unit2.id

    # A different building on the same street must NOT merge into B6.
    body3 = apply_lease(
        "Unit 1",
        "Building 3, 205 Leitchs Road, Brendale",
        "Other Tenant Pty Ltd",
    )
    lease3 = session.get(Lease, UUID(body3["review_data"]["applied"]["lease_id"]))
    assert lease3 is not None
    unit3 = session.get(TenancyUnit, lease3.tenancy_unit_id)
    assert unit3 is not None
    assert unit3.property_id != building_id

    building_props = [
        prop
        for prop in session.scalars(select(Property)).all()
        if prop.property_metadata.get("building_key") == building_key
    ]
    assert len(building_props) == 1


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
