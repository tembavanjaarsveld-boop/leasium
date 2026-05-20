"""Tenant portal API tests."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import (
    BillingDraft,
    BillingDraftStatus,
    DocumentCategory,
    Entity,
    InvoiceDraft,
    InvoiceDraftStatus,
    Lease,
    LeaseStatus,
    Property,
    PropertyType,
    StoredDocument,
    TenancyUnit,
    Tenant,
    TenantOnboarding,
    TenantOnboardingStatus,
)


def _entity(session: Session) -> Entity:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return entity


def _seed_portal_scope(session: Session) -> dict[str, str]:
    entity = _entity(session)
    prop = Property(
        entity_id=entity.id,
        name="Portal Plaza",
        street_address="9 Portal Street",
        suburb="Brisbane City",
        state="QLD",
        postcode="4000",
        property_type=PropertyType.commercial_retail,
    )
    session.add(prop)
    session.flush()
    unit_one = TenancyUnit(property_id=prop.id, unit_label="Shop 1")
    unit_two = TenancyUnit(property_id=prop.id, unit_label="Shop 2")
    tenant_one = Tenant(
        entity_id=entity.id,
        legal_name="Portal Tenant One Pty Ltd",
        trading_name="Portal One",
        contact_name="Avery Tenant",
        contact_email="avery@portal-one.example",
        contact_phone="+61 400 111 222",
        billing_email="accounts@portal-one.example",
        tenant_metadata={"insurance_expiry_date": "2027-06-30"},
    )
    tenant_two = Tenant(
        entity_id=entity.id,
        legal_name="Portal Tenant Two Pty Ltd",
        contact_name="Blake Tenant",
        contact_email="blake@portal-two.example",
        billing_email="accounts@portal-two.example",
    )
    session.add_all([unit_one, unit_two, tenant_one, tenant_two])
    session.flush()
    lease_one = Lease(
        tenancy_unit_id=unit_one.id,
        tenant_id=tenant_one.id,
        status=LeaseStatus.active,
        commencement_date=datetime(2025, 7, 1, tzinfo=UTC).date(),
        expiry_date=datetime(2028, 6, 30, tzinfo=UTC).date(),
        next_review_date=datetime(2026, 7, 1, tzinfo=UTC).date(),
    )
    lease_two = Lease(
        tenancy_unit_id=unit_two.id,
        tenant_id=tenant_two.id,
        status=LeaseStatus.active,
    )
    session.add_all([lease_one, lease_two])
    session.flush()
    onboarding_one = TenantOnboarding(
        entity_id=entity.id,
        lease_id=lease_one.id,
        tenant_id=tenant_one.id,
        token="portal-token-one",
        status=TenantOnboardingStatus.sent,
        due_date=datetime(2026, 5, 29, tzinfo=UTC).date(),
        expires_at=datetime.now(UTC) + timedelta(days=14),
        last_sent_at=datetime.now(UTC),
        submitted_data={},
        review_data={},
        delivery_data={},
    )
    onboarding_two = TenantOnboarding(
        entity_id=entity.id,
        lease_id=lease_two.id,
        tenant_id=tenant_two.id,
        token="portal-token-two",
        status=TenantOnboardingStatus.sent,
        expires_at=datetime.now(UTC) + timedelta(days=14),
        submitted_data={},
        review_data={},
        delivery_data={},
    )
    session.add_all([onboarding_one, onboarding_two])
    session.flush()
    document_one = StoredDocument(
        entity_id=entity.id,
        property_id=prop.id,
        tenancy_unit_id=unit_one.id,
        tenant_id=tenant_one.id,
        lease_id=lease_one.id,
        tenant_onboarding_id=onboarding_one.id,
        filename="tenant-one-insurance.txt",
        content_type="text/plain",
        byte_size=12,
        file_data=b"insurance-1",
        category=DocumentCategory.insurance,
        notes="Current certificate.",
        document_metadata={"source": "tenant_onboarding"},
    )
    document_two = StoredDocument(
        entity_id=entity.id,
        property_id=prop.id,
        tenancy_unit_id=unit_two.id,
        tenant_id=tenant_two.id,
        lease_id=lease_two.id,
        tenant_onboarding_id=onboarding_two.id,
        filename="tenant-two-insurance.txt",
        content_type="text/plain",
        byte_size=12,
        file_data=b"insurance-2",
        category=DocumentCategory.insurance,
        document_metadata={"source": "tenant_onboarding"},
    )
    session.add_all([document_one, document_two])
    session.flush()
    billing_draft = BillingDraft(
        entity_id=entity.id,
        property_id=prop.id,
        tenancy_unit_id=unit_one.id,
        tenant_id=tenant_one.id,
        lease_id=lease_one.id,
        document_id=document_one.id,
        status=BillingDraftStatus.approved,
        title="May rent",
        issue_date=datetime(2026, 5, 1, tzinfo=UTC).date(),
        due_date=datetime(2026, 5, 15, tzinfo=UTC).date(),
        total_cents=880000,
        billing_metadata={},
    )
    other_billing_draft = BillingDraft(
        entity_id=entity.id,
        property_id=prop.id,
        tenancy_unit_id=unit_two.id,
        tenant_id=tenant_two.id,
        lease_id=lease_two.id,
        document_id=document_two.id,
        status=BillingDraftStatus.approved,
        title="Other tenant rent",
        total_cents=110000,
        billing_metadata={},
    )
    session.add_all([billing_draft, other_billing_draft])
    session.flush()
    invoice = InvoiceDraft(
        entity_id=entity.id,
        billing_draft_id=billing_draft.id,
        property_id=prop.id,
        tenancy_unit_id=unit_one.id,
        tenant_id=tenant_one.id,
        lease_id=lease_one.id,
        document_id=document_one.id,
        status=InvoiceDraftStatus.approved,
        invoice_number="INV-PORTAL-1",
        title="May rent",
        currency="AUD",
        issue_date=datetime(2026, 5, 1, tzinfo=UTC).date(),
        due_date=datetime(2026, 5, 15, tzinfo=UTC).date(),
        subtotal_cents=800000,
        gst_cents=80000,
        total_cents=880000,
        recipient_name=tenant_one.legal_name,
        recipient_email=tenant_one.billing_email,
        invoice_metadata={
            "payment_status": {
                "status": "partially_paid",
                "paid_cents": 330000,
                "outstanding_cents": 550000,
            }
        },
    )
    hidden_invoice = InvoiceDraft(
        entity_id=entity.id,
        billing_draft_id=billing_draft.id,
        property_id=prop.id,
        tenancy_unit_id=unit_one.id,
        tenant_id=tenant_one.id,
        lease_id=lease_one.id,
        document_id=document_one.id,
        status=InvoiceDraftStatus.draft,
        title="Draft rent",
        currency="AUD",
        total_cents=990000,
        invoice_metadata={},
    )
    other_invoice = InvoiceDraft(
        entity_id=entity.id,
        billing_draft_id=other_billing_draft.id,
        property_id=prop.id,
        tenancy_unit_id=unit_two.id,
        tenant_id=tenant_two.id,
        lease_id=lease_two.id,
        document_id=document_two.id,
        status=InvoiceDraftStatus.approved,
        invoice_number="INV-OTHER",
        title="Other rent",
        currency="AUD",
        total_cents=110000,
        invoice_metadata={},
    )
    session.add_all([invoice, hidden_invoice, other_invoice])
    session.flush()
    invoice_document = StoredDocument(
        entity_id=entity.id,
        property_id=prop.id,
        tenancy_unit_id=unit_one.id,
        tenant_id=tenant_one.id,
        lease_id=lease_one.id,
        filename="INV-PORTAL-1.pdf",
        content_type="application/pdf",
        byte_size=11,
        file_data=b"invoice-pdf",
        category=DocumentCategory.invoice,
        document_metadata={
            "source": "invoice_draft_pdf_artifact",
            "invoice_draft_id": str(invoice.id),
        },
    )
    session.add(invoice_document)
    session.flush()
    invoice.invoice_metadata = {
        **invoice.invoice_metadata,
        "pdf_artifact": {"document_id": str(invoice_document.id)},
    }
    session.commit()
    return {
        "token": onboarding_one.token,
        "other_token": onboarding_two.token,
        "tenant_id": str(tenant_one.id),
        "document_id": str(document_one.id),
        "other_document_id": str(document_two.id),
        "invoice_document_id": str(invoice_document.id),
        "invoice_id": str(invoice.id),
    }


def test_tenant_portal_session_is_scoped_to_token_tenant(
    client: TestClient,
    session: Session,
) -> None:
    scope = _seed_portal_scope(session)

    response = client.get(
        "/api/v1/tenant-portal/session",
        headers={"x-tenant-portal-token": scope["token"]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["auth"] == {
        "mode": "tenant_portal_token",
        "token_source": "header",
        "tenant_auth_configured": False,
        "dev_fallback": False,
        "boundary": "tenant_onboarding_token",
        "detail": (
            "Tenant identity-provider auth is not wired yet. Access is scoped to the "
            "tenant linked to this onboarding token."
        ),
    }
    assert body["tenant"]["id"] == scope["tenant_id"]
    assert "entity_id" not in body["tenant"]
    assert body["lease"]["property_name"] == "Portal Plaza"
    assert [document["id"] for document in body["compliance"]["uploaded_documents"]] == [
        scope["document_id"]
    ]
    assert body["compliance"]["items"][0]["status"] == "received"
    assert [invoice["id"] for invoice in body["invoices"]] == [scope["invoice_id"]]
    assert body["invoices"][0]["invoice_number"] == "INV-PORTAL-1"
    assert body["invoices"][0]["pdf_document_id"] == scope["invoice_document_id"]
    assert body["payment_summary"]["invoice_count"] == 1
    assert body["payment_summary"]["total_cents"] == 880000
    assert body["payment_summary"]["paid_cents"] == 330000
    assert body["payment_summary"]["outstanding_cents"] == 550000


def test_tenant_portal_query_token_is_labelled_dev_fallback(
    client: TestClient,
    session: Session,
) -> None:
    scope = _seed_portal_scope(session)

    response = client.get(
        "/api/v1/tenant-portal/session",
        params={"portal_token": scope["token"]},
    )

    assert response.status_code == 200
    assert response.json()["auth"]["mode"] == "tenant_portal_token_dev_fallback"
    assert response.json()["auth"]["token_source"] == "query"
    assert response.json()["auth"]["dev_fallback"] is True

    missing_response = client.get("/api/v1/tenant-portal/session")
    assert missing_response.status_code == 401
    invalid_response = client.get(
        "/api/v1/tenant-portal/session",
        headers={"x-tenant-portal-token": "not-a-real-token"},
    )
    assert invalid_response.status_code == 404


def test_tenant_portal_upload_download_and_preferences_stay_scoped(
    client: TestClient,
    session: Session,
) -> None:
    scope = _seed_portal_scope(session)

    upload_response = client.post(
        "/api/v1/tenant-portal/documents",
        data={
            "portal_token": scope["token"],
            "category": "bank_guarantee",
            "notes": "Updated guarantee.",
        },
        files={"file": ("guarantee.txt", b"guarantee", "text/plain")},
    )

    assert upload_response.status_code == 201
    upload_body = upload_response.json()
    assert upload_body["category"] == "bank_guarantee"
    assert upload_body["source"] == "tenant_portal"
    assert "entity_id" not in upload_body
    document = session.get(StoredDocument, UUID(upload_body["id"]))
    assert document is not None
    assert document.tenant_id == UUID(scope["tenant_id"])
    assert document.document_metadata["auth_mode"] == "tenant_portal_token_dev_fallback"

    download_response = client.get(
        f"/api/v1/tenant-portal/documents/{upload_body['id']}/download",
        params={"portal_token": scope["token"]},
    )
    assert download_response.status_code == 200
    assert download_response.content == b"guarantee"

    cross_scope_download = client.get(
        f"/api/v1/tenant-portal/documents/{scope['other_document_id']}/download",
        headers={"x-tenant-portal-token": scope["token"]},
    )
    assert cross_scope_download.status_code == 404

    invoice_download = client.get(
        f"/api/v1/tenant-portal/documents/{scope['invoice_document_id']}/download",
        headers={"x-tenant-portal-token": scope["token"]},
    )
    assert invoice_download.status_code == 200
    assert invoice_download.content == b"invoice-pdf"

    preferences_response = client.patch(
        "/api/v1/tenant-portal/notification-preferences",
        headers={"x-tenant-portal-token": scope["token"]},
        json={
            "email_enabled": True,
            "sms_enabled": False,
            "billing_email_enabled": True,
            "compliance_reminders_enabled": False,
        },
    )
    assert preferences_response.status_code == 200
    preferences = preferences_response.json()
    assert preferences["preferred_channel"] == "email"
    assert preferences["compliance_reminders_enabled"] is False

    tenant = session.get(Tenant, UUID(scope["tenant_id"]))
    assert tenant is not None
    assert tenant.tenant_metadata["portal_notification_preferences"]["sms_enabled"] is False
