"""Read-only owner portal API tests."""

from datetime import date, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.db import utcnow
from stewart.core.models import (
    BillingDraft,
    BillingDraftStatus,
    ComplianceCheck,
    ComplianceCheckKind,
    ComplianceCheckStatus,
    DocumentCategory,
    Entity,
    InvoiceDraft,
    InvoiceDraftStatus,
    Lease,
    LeaseStatus,
    MaintenanceApprovalStatus,
    MaintenancePriority,
    MaintenanceWorkOrder,
    MaintenanceWorkOrderStatus,
    Obligation,
    ObligationCategory,
    ObligationStatus,
    OperatingMode,
    Organisation,
    Owner,
    Property,
    PropertyOwner,
    PropertyType,
    StoredDocument,
    TenancyUnit,
    Tenant,
)


def _entity(session: Session) -> Entity:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return entity


def _set_operating_mode(
    session: Session,
    mode: OperatingMode = OperatingMode.managing_agent,
) -> None:
    entity = _entity(session)
    organisation = session.get(Organisation, entity.organisation_id)
    assert organisation is not None
    organisation.operating_mode = mode.value
    session.flush()


def _seed_owner_portal_owner(
    session: Session,
    *,
    operating_mode: OperatingMode = OperatingMode.managing_agent,
) -> Owner:
    _set_operating_mode(session, operating_mode)
    entity = _entity(session)
    doc = StoredDocument(
        entity_id=entity.id,
        filename="owner-portal-seed.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.invoice,
    )
    session.add(doc)
    session.flush()
    draft = BillingDraft(
        entity_id=entity.id,
        document_id=doc.id,
        title="Owner portal seed billing",
        currency="AUD",
        status=BillingDraftStatus.approved,
    )
    owner = Owner(
        entity_id=entity.id,
        legal_name="SKJ Holdings Pty Ltd",
        abn="11222333444",
        billing_contact_name="Mia Accounts",
        billing_email="owners@queenstreet.example",
        gst_registered=True,
    )
    session.add_all([draft, owner])
    session.flush()

    properties = [
        ("Queen Street Retail Centre", 60.0, 880_000, 0),
        ("King Street Offices", 40.0, 880_000, 0),
    ]
    for property_name, split_pct, total_cents, paid_cents in properties:
        prop = Property(
            entity_id=entity.id,
            name=property_name,
            street_address=f"{property_name} Street",
            property_type=PropertyType.commercial_retail,
        )
        session.add(prop)
        session.flush()
        session.add(
            PropertyOwner(property_id=prop.id, owner_id=owner.id, split_pct=split_pct)
        )
        session.add(
            InvoiceDraft(
                entity_id=entity.id,
                billing_draft_id=draft.id,
                property_id=prop.id,
                document_id=doc.id,
                status=InvoiceDraftStatus.approved,
                invoice_number=f"INV-{property_name[:4].upper()}",
                title=f"May invoice for {property_name}",
                currency="AUD",
                issue_date=date(2026, 5, 15),
                subtotal_cents=total_cents,
                gst_cents=0,
                total_cents=total_cents,
                invoice_metadata={
                    "paid_cents": paid_cents,
                    "xero_sync": {"xero_invoice_id": "xero-owner-portal"},
                    "xero_payment_reconciliation": {
                        "reference": "BANK REF OWNER-PORTAL",
                        "match_confidence": "high",
                        "bank_transaction_id": "bank-owner-portal",
                    },
                },
            )
        )
    session.commit()
    return owner


def _linked_owner_property(session: Session, owner: Owner) -> Property:
    prop = session.scalar(
        select(Property)
        .join(PropertyOwner, PropertyOwner.property_id == Property.id)
        .where(PropertyOwner.owner_id == owner.id)
        .order_by(Property.name.asc())
    )
    assert prop is not None
    return prop


def test_owner_portal_preview_forbidden_for_self_managed_accounts(
    client: TestClient,
    session: Session,
) -> None:
    owner = _seed_owner_portal_owner(
        session,
        operating_mode=OperatingMode.self_managed_owner,
    )

    response = client.get(
        f"/api/v1/owner-portal/{owner.id}",
        params={"month": "2026-05"},
    )

    assert response.status_code == 403
    assert "managing-agent or hybrid accounts" in response.json()["detail"]


def test_owner_portal_preview_returns_read_only_owner_summary(
    client: TestClient,
    session: Session,
) -> None:
    owner = _seed_owner_portal_owner(session)

    response = client.get(
        f"/api/v1/owner-portal/{owner.id}",
        params={"month": "2026-05"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["auth"] == {
        "mode": "operator_preview",
        "token_source": "bearer",
        "owner_auth_configured": True,
        "boundary": "operator_session",
        "detail": (
            "Read-only operator preview scoped by entity role; no owner portal "
            "account is created."
        ),
    }
    assert body["owner"]["id"] == str(owner.id)
    assert body["owner"]["display_name"] == "SKJ Holdings Pty Ltd"
    assert body["owner"]["billing_contact_name"] == "Mia Accounts"
    assert body["owner"]["billing_email"] == "owners@queenstreet.example"
    assert body["owner"]["abn"] == "11222333444"
    assert body["owner"]["gst_registered"] is True
    assert [row["property_name"] for row in body["properties"]] == [
        "King Street Offices",
        "Queen Street Retail Centre",
    ]
    assert [row["split_pct"] for row in body["properties"]] == [40.0, 60.0]
    assert body["statement"]["month"] == "2026-05"
    assert body["statement"]["owner_identity"] == "SKJ Holdings Pty Ltd"
    assert body["statement"]["property_count"] == 2
    assert body["statement"]["invoice_count"] == 2
    assert body["statement"]["invoiced_cents"] == 880_000
    assert body["statement"]["paid_cents"] == 0
    assert body["statement"]["outstanding_cents"] == 880_000
    assert len(body["statement"]["properties"]) == 2
    assert [
        (row["property_name"], row["invoiced_cents"], row["outstanding_cents"])
        for row in body["statement"]["properties"]
    ] == [
        ("Queen Street Retail Centre", 528_000, 528_000),
        ("King Street Offices", 352_000, 352_000),
    ]
    assert "invoices" not in body["statement"]["properties"][0]
    assert body["guardrails"] == [
        (
            "Read-only owner portal: opening this page does not send owner "
            "email, dispatch invoices, write Xero data, reconcile payments, "
            "refresh providers, or mutate provider history."
        ),
        (
            "Shared document downloads are account-scoped and limited to files "
            "explicitly shared by the property team for this owner; no owner "
            "statement PDFs are generated or sent from the portal."
        ),
    ]


def test_owner_portal_statement_matches_duplicate_shared_owner_by_owner_id(
    client: TestClient,
    session: Session,
) -> None:
    """Duplicate-label co-owners on the same property get their own split."""

    _set_operating_mode(session)
    entity = _entity(session)
    doc = StoredDocument(
        entity_id=entity.id,
        filename="owner-portal-duplicate-split.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.invoice,
    )
    session.add(doc)
    session.flush()
    draft = BillingDraft(
        entity_id=entity.id,
        document_id=doc.id,
        title="Owner portal duplicate split billing",
        currency="AUD",
        status=BillingDraftStatus.approved,
    )
    owner_a = Owner(
        entity_id=entity.id,
        legal_name="Duplicate Shared Owner Pty Ltd",
        billing_email="shared-a@example.test",
    )
    owner_b = Owner(
        entity_id=entity.id,
        legal_name="Duplicate Shared Owner Pty Ltd",
        billing_email="shared-b@example.test",
    )
    prop = Property(
        entity_id=entity.id,
        name="Duplicate Shared Property",
        street_address="20 Shared Street",
        property_type=PropertyType.commercial_retail,
    )
    session.add_all([draft, owner_a, owner_b, prop])
    session.flush()
    session.add_all(
        [
            PropertyOwner(property_id=prop.id, owner_id=owner_a.id, split_pct=60),
            PropertyOwner(property_id=prop.id, owner_id=owner_b.id, split_pct=40),
        ]
    )
    session.add(
        InvoiceDraft(
            entity_id=entity.id,
            billing_draft_id=draft.id,
            property_id=prop.id,
            document_id=doc.id,
            status=InvoiceDraftStatus.approved,
            title="Duplicate shared owner invoice",
            currency="AUD",
            issue_date=date(2026, 5, 15),
            subtotal_cents=100_000,
            gst_cents=0,
            total_cents=100_000,
            invoice_metadata={"paid_cents": 0},
        )
    )
    session.commit()

    response = client.get(
        f"/api/v1/owner-portal/{owner_b.id}",
        params={"month": "2026-05"},
    )

    assert response.status_code == 200, response.text
    statement = response.json()["statement"]
    assert statement["owner_identity"].startswith("Duplicate Shared Owner Pty Ltd")
    assert statement["invoiced_cents"] == 40_000
    assert statement["properties"][0]["invoiced_cents"] == 40_000


def test_owner_portal_lists_only_explicit_owner_visible_property_documents(
    client: TestClient,
    session: Session,
) -> None:
    owner = _seed_owner_portal_owner(session)
    entity = _entity(session)
    linked_property = _linked_owner_property(session, owner)
    tenant = Tenant(entity_id=entity.id, legal_name="Tenant Private Pty Ltd")
    unlinked_property = Property(
        entity_id=entity.id,
        name="Unlinked Owner Property",
        street_address="9 Other Street",
        property_type=PropertyType.commercial_office,
    )
    session.add_all([tenant, unlinked_property])
    session.flush()
    visible_doc = StoredDocument(
        entity_id=entity.id,
        property_id=linked_property.id,
        filename="owner-visible-report.pdf",
        content_type="application/pdf",
        byte_size=len(b"owner visible"),
        file_data=b"owner visible",
        category=DocumentCategory.other,
        notes="Quarterly property report",
        document_metadata={
            "source": "operator_upload",
            "owner_portal_visible": True,
        },
    )
    hidden_doc = StoredDocument(
        entity_id=entity.id,
        property_id=linked_property.id,
        filename="internal-only.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.other,
        document_metadata={"source": "operator_upload"},
    )
    tenant_doc = StoredDocument(
        entity_id=entity.id,
        property_id=linked_property.id,
        tenant_id=tenant.id,
        filename="tenant-private.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.other,
        document_metadata={"owner_portal_visible": True},
    )
    cross_property_doc = StoredDocument(
        entity_id=entity.id,
        property_id=unlinked_property.id,
        filename="other-owner.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.other,
        document_metadata={"owner_portal_visible": True},
    )
    session.add_all([visible_doc, hidden_doc, tenant_doc, cross_property_doc])
    session.commit()

    response = client.get(
        f"/api/v1/owner-portal/{owner.id}",
        params={"month": "2026-05"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["documents"]) == 1
    document = body["documents"][0]
    assert document["id"] == str(visible_doc.id)
    assert document["property_id"] == str(linked_property.id)
    assert document["property_name"] == linked_property.name
    assert document["filename"] == "owner-visible-report.pdf"
    assert document["content_type"] == "application/pdf"
    assert document["byte_size"] == len(b"owner visible")
    assert document["category"] == "other"
    assert document["notes"] == "Quarterly property report"
    assert document["source_label"] == "Shared by property team"
    assert "source" not in document
    assert document["created_at"]
    assert "file_data" not in document


def test_owner_portal_lists_safe_maintenance_snapshot_for_linked_properties(
    client: TestClient,
    session: Session,
) -> None:
    owner = _seed_owner_portal_owner(session)
    entity = _entity(session)
    linked_property = _linked_owner_property(session, owner)
    tenant = Tenant(entity_id=entity.id, legal_name="Private Tenant Pty Ltd")
    unlinked_property = Property(
        entity_id=entity.id,
        name="Unlinked Maintenance Property",
        street_address="10 Other Street",
        property_type=PropertyType.commercial_office,
    )
    session.add_all([tenant, unlinked_property])
    session.flush()
    owner_visible_work = MaintenanceWorkOrder(
        entity_id=entity.id,
        property_id=linked_property.id,
        tenant_id=tenant.id,
        title="Tenant Mary Smith says the tenancy is too warm",
        description="Tenant reported the tenancy is too warm.",
        status=MaintenanceWorkOrderStatus.awaiting_approval,
        priority=MaintenancePriority.urgent,
        approval_required=True,
        approval_status=MaintenanceApprovalStatus.pending,
        quote_amount_cents=125_000,
        contractor_name="Private Contractor",
        contractor_email="dispatch@private.example",
        contractor_phone="+61400111222",
        due_date=date(2026, 6, 7),
        notes="Internal owner-facing note should stay private.",
        work_order_metadata={
            "comments": [
                {
                    "visibility": "internal",
                    "body": "Internal-only comment must not leave Leasium.",
                }
            ],
            "contractor_delivery": {
                "email": {"send": {"provider_message_id": "sendgrid-secret"}}
            },
            "owner_portal_visible": True,
            "owner_portal_title": "Air conditioning quote review",
        },
    )
    hidden_sensitive_work = MaintenanceWorkOrder(
        entity_id=entity.id,
        property_id=linked_property.id,
        tenant_id=tenant.id,
        title="Tenant Jane Smith reported a private medical issue",
        status=MaintenanceWorkOrderStatus.requested,
        priority=MaintenancePriority.high,
    )
    completed_work = MaintenanceWorkOrder(
        entity_id=entity.id,
        property_id=linked_property.id,
        title="Completed gutter clean",
        status=MaintenanceWorkOrderStatus.completed,
        priority=MaintenancePriority.normal,
        completed_at=datetime(2026, 5, 20),
    )
    cross_property_work = MaintenanceWorkOrder(
        entity_id=entity.id,
        property_id=unlinked_property.id,
        title="Other owner repair",
        status=MaintenanceWorkOrderStatus.requested,
        priority=MaintenancePriority.urgent,
    )
    session.add_all(
        [owner_visible_work, hidden_sensitive_work, completed_work, cross_property_work]
    )
    session.commit()

    response = client.get(
        f"/api/v1/owner-portal/{owner.id}",
        params={"month": "2026-05"},
    )

    assert response.status_code == 200, response.text
    maintenance = response.json()["maintenance"]
    assert maintenance["open_count"] == 1
    assert maintenance["urgent_count"] == 1
    assert maintenance["awaiting_approval_count"] == 1
    assert len(maintenance["items"]) == 1
    item = maintenance["items"][0]
    requested_at = item.pop("requested_at")
    assert item == {
        "id": str(owner_visible_work.id),
        "property_id": str(linked_property.id),
        "property_name": linked_property.name,
        "title": "Air conditioning quote review",
        "status": "awaiting_approval",
        "priority": "urgent",
        "due_date": "2026-06-07",
        "completed_at": None,
        "approval_required": True,
        "approval_status": "pending",
        "quote_amount_cents": 125_000,
    }
    assert requested_at.startswith(
        owner_visible_work.requested_at.replace(tzinfo=None).isoformat()
    )
    serialized = response.text
    assert "Private Tenant Pty Ltd" not in serialized
    assert "Tenant Mary Smith" not in serialized
    assert "Tenant Jane Smith" not in serialized
    assert "tenant_id" not in serialized
    assert "Private Contractor" not in serialized
    assert "dispatch@private.example" not in serialized
    assert "+61400111222" not in serialized
    assert "Internal-only comment" not in serialized
    assert "sendgrid-secret" not in serialized
    assert "Other owner repair" not in serialized
    assert "Completed gutter clean" not in serialized


def test_owner_portal_lists_safe_lease_events_for_linked_properties(
    client: TestClient,
    session: Session,
) -> None:
    owner = _seed_owner_portal_owner(session)
    entity = _entity(session)
    linked_property = _linked_owner_property(session, owner)
    tenant = Tenant(entity_id=entity.id, legal_name="Private Lease Tenant Pty Ltd")
    linked_unit = TenancyUnit(property_id=linked_property.id, unit_label="Suite 8")
    hidden_unit = TenancyUnit(property_id=linked_property.id, unit_label="Suite Hidden")
    unlinked_property = Property(
        entity_id=entity.id,
        name="Unlinked Lease Property",
        street_address="11 Other Street",
        property_type=PropertyType.commercial_office,
    )
    session.add_all([tenant, linked_unit, hidden_unit, unlinked_property])
    session.flush()
    unlinked_unit = TenancyUnit(
        property_id=unlinked_property.id,
        unit_label="Suite 99",
    )
    session.add(unlinked_unit)
    session.flush()
    visible_lease = Lease(
        tenancy_unit_id=linked_unit.id,
        tenant_id=tenant.id,
        status=LeaseStatus.active,
        commencement_date=date(2025, 7, 1),
        expiry_date=date(2026, 7, 31),
        next_review_date=date(2026, 6, 15),
        annual_rent_cents=3_600_000,
        notes="Private lease note should stay hidden.",
    )
    expired_lease = Lease(
        tenancy_unit_id=hidden_unit.id,
        tenant_id=tenant.id,
        status=LeaseStatus.expired,
        expiry_date=date(2026, 6, 30),
        next_review_date=date(2026, 6, 1),
    )
    cross_property_lease = Lease(
        tenancy_unit_id=unlinked_unit.id,
        tenant_id=tenant.id,
        status=LeaseStatus.active,
        expiry_date=date(2026, 6, 20),
        next_review_date=date(2026, 6, 5),
    )
    session.add_all([visible_lease, expired_lease, cross_property_lease])
    session.commit()

    response = client.get(
        f"/api/v1/owner-portal/{owner.id}",
        params={"month": "2026-05"},
    )

    assert response.status_code == 200, response.text
    lease_events = response.json()["lease_events"]
    assert lease_events["upcoming_count"] == 2
    assert lease_events["rent_review_count"] == 1
    assert lease_events["expiry_count"] == 1
    assert [
        (row["event_kind"], row["event_date"], row["unit_label"])
        for row in lease_events["events"]
    ] == [
        ("rent_review", "2026-06-15", "Suite 8"),
        ("lease_expiry", "2026-07-31", "Suite 8"),
    ]
    assert lease_events["events"][0]["lease_id"] == str(visible_lease.id)
    assert lease_events["events"][0]["property_id"] == str(linked_property.id)
    assert lease_events["events"][0]["property_name"] == linked_property.name
    assert lease_events["events"][0]["lease_status"] == "active"
    assert lease_events["events"][0]["annual_rent_cents"] == 3_600_000
    serialized = response.text
    assert "Private Lease Tenant Pty Ltd" not in serialized
    assert "tenant_id" not in serialized
    assert "Private lease note" not in serialized
    assert "Suite Hidden" not in serialized
    assert "Unlinked Lease Property" not in serialized
    assert "Suite 99" not in serialized


def test_owner_portal_lists_safe_compliance_snapshot_for_linked_properties(
    client: TestClient,
    session: Session,
) -> None:
    owner = _seed_owner_portal_owner(session)
    entity = _entity(session)
    linked_property = _linked_owner_property(session, owner)
    today = utcnow().date()
    tenant = Tenant(entity_id=entity.id, legal_name="Private Compliance Tenant Pty Ltd")
    unlinked_property = Property(
        entity_id=entity.id,
        name="Unlinked Compliance Property",
        street_address="12 Other Street",
        property_type=PropertyType.commercial_office,
    )
    evidence_doc = StoredDocument(
        entity_id=entity.id,
        property_id=linked_property.id,
        filename="private-evidence.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.other,
        document_metadata={"source": "operator_upload"},
    )
    session.add_all([tenant, unlinked_property, evidence_doc])
    session.flush()
    evidence_obligation = Obligation(
        entity_id=entity.id,
        property_id=linked_property.id,
        title="Private evidence obligation",
        category=ObligationCategory.compliance,
        status=ObligationStatus.due_soon,
        due_date=today + timedelta(days=18),
        obligation_metadata={"evidence_document_ids": [str(evidence_doc.id)]},
    )
    session.add(evidence_obligation)
    session.flush()
    overdue_check = ComplianceCheck(
        entity_id=entity.id,
        property_id=linked_property.id,
        title="Fire safety annual statement",
        kind=ComplianceCheckKind.fire_safety,
        status=ComplianceCheckStatus.active,
        last_checked_at=datetime(2026, 4, 1, 9, 0),
        next_due_date=today - timedelta(days=13),
        notes="Internal compliance note should stay private.",
        check_metadata={
            "owner_portal_visible": True,
            "owner_portal_title": "Fire safety annual statement",
        },
    )
    due_soon_check = ComplianceCheck(
        entity_id=entity.id,
        property_id=linked_property.id,
        tenant_id=tenant.id,
        source_document_id=evidence_doc.id,
        current_obligation_id=evidence_obligation.id,
        title="Private Compliance Tenant Pty Ltd insurance certificate",
        kind=ComplianceCheckKind.insurance,
        status=ComplianceCheckStatus.active,
        last_checked_at=datetime(2026, 5, 15, 10, 30),
        next_due_date=today + timedelta(days=18),
        certificate_expires_on=today + timedelta(days=28),
        notes="Provider evidence id must stay private.",
        check_metadata={
            "owner_portal_visible": True,
            "owner_portal_title": "Insurance certificate renewal",
            "operator_history": [{"actor": "ops@example.test"}],
        },
    )
    hidden_sensitive_check = ComplianceCheck(
        entity_id=entity.id,
        property_id=linked_property.id,
        tenant_id=tenant.id,
        title="Private Compliance Tenant Pty Ltd internal inspection",
        kind=ComplianceCheckKind.inspection,
        status=ComplianceCheckStatus.active,
        next_due_date=today + timedelta(days=8),
    )
    paused_visible_check = ComplianceCheck(
        entity_id=entity.id,
        property_id=linked_property.id,
        title="Paused compliance check",
        kind=ComplianceCheckKind.certificate,
        status=ComplianceCheckStatus.paused,
        next_due_date=today + timedelta(days=10),
        check_metadata={"owner_portal_visible": True},
    )
    cross_property_check = ComplianceCheck(
        entity_id=entity.id,
        property_id=unlinked_property.id,
        title="Other owner compliance",
        kind=ComplianceCheckKind.fire_safety,
        status=ComplianceCheckStatus.active,
        next_due_date=today + timedelta(days=3),
        check_metadata={"owner_portal_visible": True},
    )
    session.add_all(
        [
            overdue_check,
            due_soon_check,
            hidden_sensitive_check,
            paused_visible_check,
            cross_property_check,
        ]
    )
    session.commit()

    response = client.get(
        f"/api/v1/owner-portal/{owner.id}",
        params={"month": "2026-05"},
    )

    assert response.status_code == 200, response.text
    compliance = response.json()["compliance"]
    assert compliance["open_count"] == 2
    assert compliance["overdue_count"] == 1
    assert compliance["due_soon_count"] == 1
    assert compliance["missing_evidence_count"] == 1
    assert len(compliance["items"]) == 2
    first, second = compliance["items"]
    first_checked_at = first.pop("last_checked_at")
    assert first == {
        "id": str(overdue_check.id),
        "property_id": str(linked_property.id),
        "property_name": linked_property.name,
        "title": "Fire safety annual statement",
        "kind": "fire_safety",
        "status": "active",
        "due_status": "overdue",
        "next_due_date": (today - timedelta(days=13)).isoformat(),
        "certificate_expires_on": None,
        "evidence_status": "missing",
    }
    assert first_checked_at.startswith("2026-04-01T09:00:00")
    second_checked_at = second.pop("last_checked_at")
    assert second == {
        "id": str(due_soon_check.id),
        "property_id": str(linked_property.id),
        "property_name": linked_property.name,
        "title": "Insurance certificate renewal",
        "kind": "insurance",
        "status": "active",
        "due_status": "due_soon",
        "next_due_date": (today + timedelta(days=18)).isoformat(),
        "certificate_expires_on": (today + timedelta(days=28)).isoformat(),
        "evidence_status": "linked",
    }
    assert second_checked_at.startswith("2026-05-15T10:30:00")
    serialized = response.text
    assert "Private Compliance Tenant Pty Ltd" not in serialized
    assert "tenant_id" not in serialized
    assert "source_document_id" not in serialized
    assert "current_obligation_id" not in serialized
    assert str(evidence_doc.id) not in serialized
    assert "private-evidence.pdf" not in serialized
    assert "Internal compliance note" not in serialized
    assert "Provider evidence id" not in serialized
    assert "operator_history" not in serialized
    assert "ops@example.test" not in serialized
    assert "Paused compliance check" not in serialized
    assert "Other owner compliance" not in serialized


def test_owner_portal_preview_hides_deleted_owners(
    client: TestClient,
    session: Session,
) -> None:
    owner = _seed_owner_portal_owner(session)
    owner.deleted_at = datetime(2026, 5, 31)
    session.commit()

    response = client.get(
        f"/api/v1/owner-portal/{owner.id}",
        params={"month": "2026-05"},
    )

    assert response.status_code == 404


def test_owner_portal_preview_requires_explicit_statement_month(
    client: TestClient,
    session: Session,
) -> None:
    owner = _seed_owner_portal_owner(session)

    response = client.get(f"/api/v1/owner-portal/{owner.id}")

    assert response.status_code == 422


def test_owner_portal_preview_does_not_expose_cross_entity_property_links(
    client: TestClient,
    session: Session,
) -> None:
    owner = _seed_owner_portal_owner(session)
    entity = _entity(session)
    other_entity = Entity(organisation_id=entity.organisation_id, name="Other Co")
    session.add(other_entity)
    session.flush()
    other_property = Property(
        entity_id=other_entity.id,
        name="Other Entity Property",
        street_address="99 Other Street",
        property_type=PropertyType.commercial_office,
    )
    session.add(other_property)
    session.flush()
    session.add(
        PropertyOwner(property_id=other_property.id, owner_id=owner.id, split_pct=100)
    )
    session.commit()

    response = client.get(
        f"/api/v1/owner-portal/{owner.id}",
        params={"month": "2026-05"},
    )

    assert response.status_code == 200
    property_names = [row["property_name"] for row in response.json()["properties"]]
    assert "Other Entity Property" not in property_names
