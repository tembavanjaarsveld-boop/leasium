"""Tenant portal API tests."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from apps.api.main import app
from apps.api.routers import tenant_onboarding as tenant_onboarding_router
from apps.api.routers import tenant_portal as tenant_portal_router
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.auth import ClerkIdentity
from stewart.core.models import (
    BillingDraft,
    BillingDraftStatus,
    DocumentCategory,
    Entity,
    InvoiceDraft,
    InvoiceDraftStatus,
    Lease,
    LeaseStatus,
    MaintenancePriority,
    MaintenanceWorkOrder,
    MaintenanceWorkOrderStatus,
    Property,
    PropertyType,
    StoredDocument,
    TenancyUnit,
    Tenant,
    TenantOnboarding,
    TenantOnboardingStatus,
    TenantPortalAccount,
    TenantPortalAccountStatus,
)
from stewart.core.settings import Settings, get_settings
from stewart.integrations.communications import DeliveryResult


def _entity(session: Session) -> Entity:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return entity


def _tenant_account_settings() -> Settings:
    return get_settings().model_copy(update={"clerk_allow_legacy_token_mapping": True})


def _account_by_provider(session: Session, provider_id: str) -> TenantPortalAccount:
    account = session.scalar(
        select(TenantPortalAccount).where(
            TenantPortalAccount.auth_provider == "clerk",
            TenantPortalAccount.auth_provider_id == provider_id,
            TenantPortalAccount.deleted_at.is_(None),
        )
    )
    assert account is not None
    return account


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
        "entity_id": str(entity.id),
        "property_id": str(prop.id),
        "unit_id": str(unit_one.id),
        "other_unit_id": str(unit_two.id),
        "tenant_id": str(tenant_one.id),
        "other_tenant_id": str(tenant_two.id),
        "lease_id": str(lease_one.id),
        "other_lease_id": str(lease_two.id),
        "onboarding_id": str(onboarding_one.id),
        "other_onboarding_id": str(onboarding_two.id),
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
    assert body["maintenance_requests"] == []


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


def test_tenant_portal_invite_preview_prefills_sign_in_email(
    client: TestClient,
    session: Session,
) -> None:
    scope = _seed_portal_scope(session)

    response = client.get(f"/api/v1/tenant-portal/invites/{scope['token']}/preview")

    assert response.status_code == 200
    body = response.json()
    assert body["tenant_display_name"] == "Portal One"
    assert body["tenant_email"] == "avery@portal-one.example"
    assert body["property_name"] == "Portal Plaza — Shop 1"
    assert body["claimable"] is True


def test_tenant_portal_account_claim_requires_matching_clerk_email(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    app.dependency_overrides[get_settings] = _tenant_account_settings
    scope = _seed_portal_scope(session)

    def fake_identity(authorization, settings):  # noqa: ANN001, ARG001
        return ClerkIdentity(
            provider_id="tenant-subject-one",
            verified_email="wrong-tenant@example.test",
        )

    monkeypatch.setattr(tenant_portal_router, "_tenant_portal_identity", fake_identity)

    response = client.post(
        "/api/v1/tenant-portal/account/claim",
        headers={"Authorization": "Bearer tenant-subject-one"},
        json={"portal_token": scope["token"]},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == (
        "Tenant portal login email must match this invite."
    )
    onboarding = session.get(TenantOnboarding, UUID(scope["onboarding_id"]))
    assert onboarding is not None
    assert onboarding.token_consumed_at is None
    account = session.scalar(
        select(TenantPortalAccount).where(
            TenantPortalAccount.auth_provider_id == "tenant-subject-one"
        )
    )
    assert account is None


def test_tenant_portal_account_claim_accepts_matching_clerk_email(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    app.dependency_overrides[get_settings] = _tenant_account_settings
    scope = _seed_portal_scope(session)

    def fake_identity(authorization, settings):  # noqa: ANN001, ARG001
        return ClerkIdentity(
            provider_id="tenant-subject-one",
            verified_email="AVERY@PORTAL-ONE.EXAMPLE",
        )

    monkeypatch.setattr(tenant_portal_router, "_tenant_portal_identity", fake_identity)

    response = client.post(
        "/api/v1/tenant-portal/account/claim",
        headers={"Authorization": "Bearer tenant-subject-one"},
        json={"portal_token": scope["token"]},
    )

    assert response.status_code == 200
    assert response.json()["tenant"]["id"] == scope["tenant_id"]
    account = _account_by_provider(session, "tenant-subject-one")
    assert account.tenant_id == UUID(scope["tenant_id"])


def test_tenant_portal_account_claim_and_bearer_session_are_scoped(
    client: TestClient,
    session: Session,
) -> None:
    app.dependency_overrides[get_settings] = _tenant_account_settings
    scope = _seed_portal_scope(session)

    unlinked_status = client.get(
        "/api/v1/tenant-portal/account/status",
        headers={"Authorization": "Bearer tenant-subject-one"},
    )
    assert unlinked_status.status_code == 200
    assert unlinked_status.json()["status"] == "unlinked"
    assert "fresh tenant portal link" in unlinked_status.json()["recovery_hint"]

    claim_response = client.post(
        "/api/v1/tenant-portal/account/claim",
        headers={"Authorization": "Bearer tenant-subject-one"},
        json={"portal_token": scope["token"]},
    )

    assert claim_response.status_code == 200
    body = claim_response.json()
    assert body["auth"] == {
        "mode": "tenant_portal_account",
        "token_source": "bearer",
        "tenant_auth_configured": True,
        "dev_fallback": False,
        "boundary": "tenant_portal_account",
        "detail": "Access is scoped to the tenant linked to this tenant portal account.",
    }
    assert body["tenant"]["id"] == scope["tenant_id"]
    assert body["invoices"][0]["id"] == scope["invoice_id"]

    account = session.scalar(
        select(TenantPortalAccount).where(
            TenantPortalAccount.auth_provider == "clerk",
            TenantPortalAccount.auth_provider_id == "tenant-subject-one",
        )
    )
    assert account is not None
    assert account.entity_id == UUID(scope["entity_id"])
    assert account.tenant_id == UUID(scope["tenant_id"])
    assert account.tenant_onboarding_id == UUID(scope["onboarding_id"])
    assert account.status == TenantPortalAccountStatus.active
    assert account.email == "accounts@portal-one.example"
    assert account.linked_at is not None
    assert account.last_seen_at is not None
    assert account.account_metadata["source"] == "tenant_portal_claim"

    active_status = client.get(
        "/api/v1/tenant-portal/account/status",
        headers={"Authorization": "Bearer tenant-subject-one"},
    )
    assert active_status.status_code == 200
    assert active_status.json()["status"] == "active"
    assert active_status.json()["tenant_id"] == scope["tenant_id"]
    assert active_status.json()["tenant_name"] == "Portal One"

    bearer_response = client.get(
        "/api/v1/tenant-portal/account/session",
        headers={"Authorization": "Bearer tenant-subject-one"},
    )
    assert bearer_response.status_code == 200
    assert bearer_response.json()["auth"]["mode"] == "tenant_portal_account"
    assert bearer_response.json()["tenant"]["id"] == scope["tenant_id"]

    # Soft-switch: after the token is claimed, the bare token URL is
    # dead. The old test asserted 200; the security model now requires
    # 410 Gone so a leaked link cannot bypass the Clerk gate.
    onboarding = session.get(TenantOnboarding, UUID(scope["onboarding_id"]))
    assert onboarding is not None
    assert onboarding.token_consumed_at is not None, (
        "claim should consume the invite token"
    )
    token_response = client.get(
        "/api/v1/tenant-portal/session",
        headers={"x-tenant-portal-token": scope["token"]},
    )
    assert token_response.status_code == 410

    preferences_response = client.patch(
        "/api/v1/tenant-portal/notification-preferences",
        headers={"Authorization": "Bearer tenant-subject-one"},
        json={"sms_enabled": False, "compliance_reminders_enabled": False},
    )
    assert preferences_response.status_code == 200
    tenant = session.get(Tenant, UUID(scope["tenant_id"]))
    assert tenant is not None
    assert (
        tenant.tenant_metadata["portal_notification_preferences"]["source"]
        == "tenant_portal_account"
    )

    upload_response = client.post(
        "/api/v1/tenant-portal/documents",
        headers={"Authorization": "Bearer tenant-subject-one"},
        data={"category": "other", "notes": "Account upload."},
        files={"file": ("account-note.txt", b"account", "text/plain")},
    )
    assert upload_response.status_code == 201
    uploaded = session.get(StoredDocument, UUID(upload_response.json()["id"]))
    assert uploaded is not None
    assert uploaded.tenant_id == UUID(scope["tenant_id"])
    assert uploaded.document_metadata["auth_boundary"] == "tenant_portal_account"
    assert uploaded.document_metadata["auth_mode"] == "tenant_portal_account"

    download_response = client.get(
        f"/api/v1/tenant-portal/documents/{upload_response.json()['id']}/download",
        headers={"Authorization": "Bearer tenant-subject-one"},
    )
    assert download_response.status_code == 200
    assert download_response.content == b"account"

    maintenance_response = client.post(
        "/api/v1/tenant-portal/maintenance-requests",
        headers={"Authorization": "Bearer tenant-subject-one"},
        json={
            "title": "Account submitted issue",
            "description": "Raised after linking the portal account.",
            "priority": "normal",
        },
    )
    assert maintenance_response.status_code == 201
    work_order = session.get(MaintenanceWorkOrder, UUID(maintenance_response.json()["id"]))
    assert work_order is not None
    assert work_order.work_order_metadata["auth_boundary"] == "tenant_portal_account"
    assert work_order.work_order_metadata["auth_mode"] == "tenant_portal_account"


def test_tenant_portal_account_blocks_conflicting_and_revoked_logins(
    client: TestClient,
    session: Session,
) -> None:
    app.dependency_overrides[get_settings] = _tenant_account_settings
    scope = _seed_portal_scope(session)

    claim_response = client.post(
        "/api/v1/tenant-portal/account/claim",
        headers={"Authorization": "Bearer tenant-subject-one"},
        json={"portal_token": scope["token"]},
    )
    assert claim_response.status_code == 200

    conflict_response = client.post(
        "/api/v1/tenant-portal/account/claim",
        headers={"Authorization": "Bearer tenant-subject-one"},
        json={"portal_token": scope["other_token"]},
    )
    assert conflict_response.status_code == 409
    assert conflict_response.json()["detail"] == (
        "This tenant portal login is already linked to another tenant. "
        "Sign out and use the tenant login for this invite, or ask the property team "
        "to unlink the old portal access and send a fresh invite."
    )

    account = session.scalar(
        select(TenantPortalAccount).where(
            TenantPortalAccount.auth_provider_id == "tenant-subject-one"
        )
    )
    assert account is not None
    account.status = TenantPortalAccountStatus.revoked
    account.revoked_at = datetime.now(UTC)
    session.commit()

    session_response = client.get(
        "/api/v1/tenant-portal/account/session",
        headers={"Authorization": "Bearer tenant-subject-one"},
    )
    assert session_response.status_code == 401

    revoked_status = client.get(
        "/api/v1/tenant-portal/account/status",
        headers={"Authorization": "Bearer tenant-subject-one"},
    )
    assert revoked_status.status_code == 200
    assert revoked_status.json()["status"] == "revoked"
    assert revoked_status.json()["tenant_id"] == scope["tenant_id"]
    assert "revoked by the property team" in revoked_status.json()["recovery_hint"]

    reclaim_response = client.post(
        "/api/v1/tenant-portal/account/claim",
        headers={"Authorization": "Bearer tenant-subject-one"},
        json={"portal_token": scope["token"]},
    )
    assert reclaim_response.status_code == 403
    assert reclaim_response.json()["detail"] == "Tenant portal account is revoked."


def test_operator_portal_invite_reopens_claim_for_additional_tenant_login(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    app.dependency_overrides[get_settings] = _tenant_account_settings
    scope = _seed_portal_scope(session)
    sends: list[str] = []

    def fake_portal_send(invite, settings):  # noqa: ANN001, ARG001
        sends.append(invite.onboarding_url)
        return [
            DeliveryResult(
                channel="email",
                status="queued",
                provider="sendgrid",
                recipient="tenant@example.com",
                provider_message_id="portal-invite-cotenant",
            )
        ]

    monkeypatch.setattr(
        tenant_onboarding_router,
        "send_tenant_portal_invite",
        fake_portal_send,
    )

    first_claim_response = client.post(
        "/api/v1/tenant-portal/account/claim",
        headers={"Authorization": "Bearer tenant-subject-one"},
        json={"portal_token": scope["token"]},
    )
    assert first_claim_response.status_code == 200
    onboarding = session.get(TenantOnboarding, UUID(scope["onboarding_id"]))
    assert onboarding is not None
    assert onboarding.token_consumed_at is not None

    invite_response = client.post(
        f"/api/v1/tenant-onboarding/{scope['onboarding_id']}/send-portal-invite",
    )

    assert invite_response.status_code == 200
    body = invite_response.json()
    assert body["token"] != scope["token"]
    assert sends == [body["portal_url"]]
    session.refresh(onboarding)
    assert onboarding.token_consumed_at is None

    co_tenant_claim_response = client.post(
        "/api/v1/tenant-portal/account/claim",
        headers={"Authorization": "Bearer tenant-subject-two"},
        json={"portal_token": body["token"]},
    )

    assert co_tenant_claim_response.status_code == 200
    provider_ids = {
        account.auth_provider_id
        for account in session.scalars(
            select(TenantPortalAccount).where(
                TenantPortalAccount.tenant_id == UUID(scope["tenant_id"]),
                TenantPortalAccount.deleted_at.is_(None),
            )
        )
    }
    assert provider_ids == {"tenant-subject-one", "tenant-subject-two"}


def test_operator_can_preview_tenant_portal_read_only(
    client: TestClient,
    session: Session,
) -> None:
    scope = _seed_portal_scope(session)

    response = client.get(
        f"/api/v1/tenant-portal/operator-preview/{scope['onboarding_id']}",
    )

    assert response.status_code == 200
    body = response.json()
    assert body["auth"]["mode"] == "operator_preview"
    assert body["auth"]["boundary"] == "operator_session"
    assert "No tenant portal account is created" in body["auth"]["detail"]
    assert body["tenant"]["id"] == scope["tenant_id"]
    assert body["lease"]["lease_id"] == scope["lease_id"]
    assert body["onboarding"]["id"] == scope["onboarding_id"]
    assert "Operator preview is read-only" in body["guardrails"][0]


def test_deleted_tenant_portal_link_does_not_block_fresh_invite_claim(
    client: TestClient,
    session: Session,
) -> None:
    app.dependency_overrides[get_settings] = _tenant_account_settings
    scope = _seed_portal_scope(session)
    provider_id = "tenant-subject-one"

    claim_response = client.post(
        "/api/v1/tenant-portal/account/claim",
        headers={"Authorization": f"Bearer {provider_id}"},
        json={"portal_token": scope["token"]},
    )
    assert claim_response.status_code == 200
    original_account = _account_by_provider(session, provider_id)

    tenant = session.get(Tenant, UUID(scope["tenant_id"]))
    assert tenant is not None
    tenant.deleted_at = datetime.now(UTC)
    session.commit()

    fresh_claim_response = client.post(
        "/api/v1/tenant-portal/account/claim",
        headers={"Authorization": f"Bearer {provider_id}"},
        json={"portal_token": scope["other_token"]},
    )

    assert fresh_claim_response.status_code == 200
    session.refresh(original_account)
    assert original_account.deleted_at is not None
    assert original_account.account_metadata["unlinked_reason"] == (
        "Linked tenant was deleted before a fresh invite claim."
    )
    fresh_account = _account_by_provider(session, provider_id)
    assert fresh_account.id != original_account.id
    assert fresh_account.tenant_id == UUID(scope["other_tenant_id"])


def test_delete_tenant_unlinks_active_portal_accounts(
    client: TestClient,
    session: Session,
) -> None:
    app.dependency_overrides[get_settings] = _tenant_account_settings
    scope = _seed_portal_scope(session)
    provider_id = "tenant-subject-one"

    claim_response = client.post(
        "/api/v1/tenant-portal/account/claim",
        headers={"Authorization": f"Bearer {provider_id}"},
        json={"portal_token": scope["token"]},
    )
    assert claim_response.status_code == 200
    original_account = _account_by_provider(session, provider_id)

    delete_response = client.delete(f"/api/v1/tenants/{scope['tenant_id']}")

    assert delete_response.status_code == 204
    session.refresh(original_account)
    assert original_account.deleted_at is not None
    assert original_account.account_metadata["unlinked_reason"] == "Tenant profile was deleted."
    assert original_account.account_metadata["last_recovery_receipt"]["action"] == "unlinked"

    fresh_claim_response = client.post(
        "/api/v1/tenant-portal/account/claim",
        headers={"Authorization": f"Bearer {provider_id}"},
        json={"portal_token": scope["other_token"]},
    )
    assert fresh_claim_response.status_code == 200
    fresh_account = _account_by_provider(session, provider_id)
    assert fresh_account.id != original_account.id
    assert fresh_account.tenant_id == UUID(scope["other_tenant_id"])


def test_operator_can_list_tenant_portal_accounts_for_tenant(
    client: TestClient,
    session: Session,
) -> None:
    app.dependency_overrides[get_settings] = _tenant_account_settings
    scope = _seed_portal_scope(session)
    other_provider_id = "tenant-subject-two"

    claim_response = client.post(
        "/api/v1/tenant-portal/account/claim",
        headers={"Authorization": "Bearer tenant-subject-one"},
        json={"portal_token": scope["token"]},
    )
    assert claim_response.status_code == 200
    other_claim_response = client.post(
        "/api/v1/tenant-portal/account/claim",
        headers={"Authorization": f"Bearer {other_provider_id}"},
        json={"portal_token": scope["other_token"]},
    )
    assert other_claim_response.status_code == 200

    response = client.get(f"/api/v1/tenants/{scope['tenant_id']}/portal-accounts")

    assert response.status_code == 200
    body = response.json()
    assert [account["tenant_id"] for account in body] == [scope["tenant_id"]]
    assert body[0]["auth_provider"] == "clerk"
    assert body[0]["auth_provider_id"] == "tenant-subject-one"
    assert body[0]["status"] == "active"
    assert body[0]["email"] == "accounts@portal-one.example"
    assert body[0]["tenant_onboarding_id"] == scope["onboarding_id"]
    assert body[0]["linked_at"] is not None
    assert body[0]["last_seen_at"] is not None
    assert body[0]["revoked_at"] is None


def test_operator_can_revoke_tenant_portal_account(
    client: TestClient,
    session: Session,
) -> None:
    app.dependency_overrides[get_settings] = _tenant_account_settings
    scope = _seed_portal_scope(session)
    provider_id = "tenant-subject-one"

    claim_response = client.post(
        "/api/v1/tenant-portal/account/claim",
        headers={"Authorization": f"Bearer {provider_id}"},
        json={"portal_token": scope["token"]},
    )
    assert claim_response.status_code == 200
    account = _account_by_provider(session, provider_id)

    response = client.post(
        f"/api/v1/tenants/{scope['tenant_id']}/portal-accounts/{account.id}/revoke",
        json={"reason": "Tenant contact changed."},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == str(account.id)
    assert body["tenant_id"] == scope["tenant_id"]
    assert body["status"] == "revoked"
    assert body["revoked_at"] is not None
    assert body["recovery_action"] == "revoked"
    assert body["recovery_reason"] == "Tenant contact changed."
    assert body["recovery_at"] is not None
    session.refresh(account)
    assert account.status == TenantPortalAccountStatus.revoked
    assert account.revoked_at is not None
    assert account.deleted_at is None
    assert account.account_metadata["revoked_reason"] == "Tenant contact changed."
    assert account.account_metadata["last_recovery_receipt"]["action"] == "revoked"

    session_response = client.get(
        "/api/v1/tenant-portal/account/session",
        headers={"Authorization": f"Bearer {provider_id}"},
    )
    assert session_response.status_code == 401
    status_response = client.get(
        "/api/v1/tenant-portal/account/status",
        headers={"Authorization": f"Bearer {provider_id}"},
    )
    assert status_response.status_code == 200
    assert status_response.json()["status"] == "revoked"
    assert status_response.json()["tenant_id"] == scope["tenant_id"]
    assert status_response.json()["recovery_action"] == "revoked"
    assert status_response.json()["recovery_at"] is not None

    restore_response = client.post(
        f"/api/v1/tenants/{scope['tenant_id']}/portal-accounts/{account.id}/restore",
        json={"reason": "Tenant confirmed the login."},
    )
    assert restore_response.status_code == 200
    restored = restore_response.json()
    assert restored["status"] == "active"
    assert restored["revoked_at"] is None
    assert restored["recovery_action"] == "restored"
    assert restored["recovery_reason"] == "Tenant confirmed the login."
    session.refresh(account)
    assert account.status == TenantPortalAccountStatus.active
    assert account.revoked_at is None
    assert account.account_metadata["last_recovery_receipt"]["action"] == "restored"

    restored_status = client.get(
        "/api/v1/tenant-portal/account/status",
        headers={"Authorization": f"Bearer {provider_id}"},
    )
    assert restored_status.status_code == 200
    assert restored_status.json()["status"] == "active"
    assert restored_status.json()["recovery_action"] == "restored"
    assert "restored this tenant login" in restored_status.json()["recovery_hint"]

    restored_session = client.get(
        "/api/v1/tenant-portal/account/session",
        headers={"Authorization": f"Bearer {provider_id}"},
    )
    assert restored_session.status_code == 200


def test_operator_can_unlink_tenant_portal_account_without_blocking_relink(
    client: TestClient,
    session: Session,
) -> None:
    app.dependency_overrides[get_settings] = _tenant_account_settings
    scope = _seed_portal_scope(session)
    provider_id = "tenant-subject-one"

    claim_response = client.post(
        "/api/v1/tenant-portal/account/claim",
        headers={"Authorization": f"Bearer {provider_id}"},
        json={"portal_token": scope["token"]},
    )
    assert claim_response.status_code == 200
    account = _account_by_provider(session, provider_id)

    response = client.post(
        f"/api/v1/tenants/{scope['tenant_id']}/portal-accounts/{account.id}/unlink",
        json={"reason": "Tenant will relink with a new contact."},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == str(account.id)
    assert body["tenant_id"] == scope["tenant_id"]
    assert body["status"] == "unlinked"
    assert body["deleted_at"] is not None
    assert body["recovery_action"] == "unlinked"
    assert body["recovery_reason"] == "Tenant will relink with a new contact."
    assert body["recovery_at"] is not None
    session.refresh(account)
    assert account.status == TenantPortalAccountStatus.active
    assert account.revoked_at is None
    assert account.deleted_at is not None
    assert account.account_metadata["unlinked_reason"] == (
        "Tenant will relink with a new contact."
    )

    status_response = client.get(
        "/api/v1/tenant-portal/account/status",
        headers={"Authorization": f"Bearer {provider_id}"},
    )
    assert status_response.status_code == 200
    assert status_response.json()["status"] == "unlinked"
    assert status_response.json()["tenant_id"] == scope["tenant_id"]
    assert status_response.json()["recovery_action"] == "unlinked"
    assert "unlinked this tenant login" in status_response.json()["recovery_hint"]

    relink_response = client.post(
        "/api/v1/tenant-portal/account/claim",
        headers={"Authorization": f"Bearer {provider_id}"},
        json={"portal_token": scope["token"]},
    )
    assert relink_response.status_code == 200
    relinked_account = _account_by_provider(session, provider_id)
    assert relinked_account.id != account.id
    assert relinked_account.status == TenantPortalAccountStatus.active
    assert relinked_account.deleted_at is None


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


def test_tenant_portal_session_lists_scoped_maintenance_requests(
    client: TestClient,
    session: Session,
) -> None:
    scope = _seed_portal_scope(session)
    visible = MaintenanceWorkOrder(
        entity_id=UUID(scope["entity_id"]),
        property_id=UUID(scope["property_id"]),
        tenancy_unit_id=UUID(scope["unit_id"]),
        tenant_id=UUID(scope["tenant_id"]),
        lease_id=UUID(scope["lease_id"]),
        title="Leaking sink",
        description="Water is pooling under the basin.",
        status=MaintenanceWorkOrderStatus.requested,
        priority=MaintenancePriority.high,
        source_reference="TENANT-REF-1",
        attachments={
            "document_ids": [scope["document_id"]],
            "photo_document_ids": [],
        },
        work_order_metadata={
            "source": "tenant_portal",
            "tenant_onboarding_id": scope["onboarding_id"],
            "activity_history": [
                {
                    "timestamp": "2026-05-20T08:30:00+00:00",
                    "actor": "tenant-portal:header:tenant-t",
                    "source": "tenant_portal",
                    "event": "tenant_submitted",
                    "summary": "Tenant submitted maintenance request.",
                    "status": "requested",
                },
                {
                    "timestamp": "2026-05-20T09:00:00+00:00",
                    "actor": "user:ops@example.com",
                    "source": "operator_api",
                    "event": "updated",
                    "summary": "Updated status.",
                    "status": "requested",
                    "operator_work_order_id": "hidden",
                },
                {
                    "timestamp": "2026-05-20T09:30:00+00:00",
                    "actor": "user:ops@example.com",
                    "source": "operator_api",
                    "event": "comment_added",
                    "summary": "We have asked the contractor for an attendance window.",
                    "visibility": "tenant",
                    "status": "requested",
                },
                {
                    "timestamp": "2026-05-20T09:45:00+00:00",
                    "actor": "user:ops@example.com",
                    "source": "operator_api",
                    "event": "comment_added",
                    "summary": "Owner approval threshold still needs internal review.",
                    "visibility": "internal",
                    "status": "requested",
                }
            ],
        },
    )
    internal_same_tenant = MaintenanceWorkOrder(
        entity_id=UUID(scope["entity_id"]),
        property_id=UUID(scope["property_id"]),
        tenancy_unit_id=UUID(scope["unit_id"]),
        tenant_id=UUID(scope["tenant_id"]),
        lease_id=UUID(scope["lease_id"]),
        title="Internal inspection item",
        description="Created by ops, not submitted through portal.",
        status=MaintenanceWorkOrderStatus.requested,
        priority=MaintenancePriority.normal,
        work_order_metadata={"source": "internal"},
    )
    other_tenant = MaintenanceWorkOrder(
        entity_id=UUID(scope["entity_id"]),
        property_id=UUID(scope["property_id"]),
        tenancy_unit_id=UUID(scope["other_unit_id"]),
        tenant_id=UUID(scope["other_tenant_id"]),
        lease_id=UUID(scope["other_lease_id"]),
        title="Other tenant issue",
        description="Should not cross the token boundary.",
        status=MaintenanceWorkOrderStatus.requested,
        priority=MaintenancePriority.urgent,
        work_order_metadata={
            "source": "tenant_portal",
            "tenant_onboarding_id": scope["other_onboarding_id"],
        },
    )
    session.add_all([visible, internal_same_tenant, other_tenant])
    session.commit()

    response = client.get(
        "/api/v1/tenant-portal/session",
        headers={"x-tenant-portal-token": scope["token"]},
    )

    assert response.status_code == 200
    requests = response.json()["maintenance_requests"]
    assert [request["id"] for request in requests] == [str(visible.id)]
    assert requests[0] == {
        "id": str(visible.id),
        "title": "Leaking sink",
        "description": "Water is pooling under the basin.",
        "status": "requested",
        "priority": "high",
        "requested_at": visible.requested_at.isoformat().replace("+00:00", "Z"),
        "source_reference": "TENANT-REF-1",
        "due_date": None,
        "completed_at": None,
        "document_ids": [scope["document_id"]],
        "photo_document_ids": [],
        "history": [
            {
                "timestamp": "2026-05-20T08:30:00Z",
                "event": "tenant_submitted",
                "summary": "Tenant submitted maintenance request.",
                "status": "requested",
            },
            {
                "timestamp": "2026-05-20T09:30:00Z",
                "event": "comment_added",
                "summary": "We have asked the contractor for an attendance window.",
                "status": "requested",
            },
        ],
        "created_at": visible.created_at.isoformat().replace("+00:00", "Z"),
    }
    assert all(item["summary"] != "Updated status." for item in requests[0]["history"])
    assert all(
        item["summary"] != "Owner approval threshold still needs internal review."
        for item in requests[0]["history"]
    )
    assert "actor" not in requests[0]["history"][0]
    assert "source" not in requests[0]["history"][0]
    assert "operator_work_order_id" not in requests[0]["history"][0]

    list_response = client.get(
        "/api/v1/tenant-portal/maintenance-requests",
        headers={"x-tenant-portal-token": scope["token"]},
    )
    assert list_response.status_code == 200
    assert [request["id"] for request in list_response.json()] == [str(visible.id)]


def test_tenant_portal_hides_internal_maintenance_history(
    client: TestClient,
    session: Session,
) -> None:
    scope = _seed_portal_scope(session)
    work_order = MaintenanceWorkOrder(
        entity_id=UUID(scope["entity_id"]),
        property_id=UUID(scope["property_id"]),
        tenancy_unit_id=UUID(scope["unit_id"]),
        tenant_id=UUID(scope["tenant_id"]),
        lease_id=UUID(scope["lease_id"]),
        title="Door issue",
        description="Back door is hard to latch.",
        status=MaintenanceWorkOrderStatus.requested,
        priority=MaintenancePriority.normal,
        work_order_metadata={
            "source": "tenant_portal",
            "tenant_onboarding_id": scope["onboarding_id"],
            "activity_history": [
                {
                    "timestamp": "2026-05-20T09:00:00Z",
                    "event": "updated",
                    "summary": "Internal contractor negotiation.",
                    "status": "requested",
                    "visibility": "internal",
                    "source": "operator_api",
                },
                {
                    "timestamp": "2026-05-20T09:15:00Z",
                    "event": "comment_added",
                    "summary": "Contractor replied to the property team.",
                    "status": "requested",
                    "visibility": "contractor",
                    "source": "operator_api",
                },
            ],
        },
    )
    session.add(work_order)
    session.commit()

    response = client.get(
        "/api/v1/tenant-portal/session",
        headers={"x-tenant-portal-token": scope["token"]},
    )

    assert response.status_code == 200
    requests = response.json()["maintenance_requests"]
    assert [request["id"] for request in requests] == [str(work_order.id)]
    assert requests[0]["history"] == []


def test_tenant_portal_can_create_maintenance_request_with_scoped_documents(
    client: TestClient,
    session: Session,
) -> None:
    scope = _seed_portal_scope(session)

    response = client.post(
        "/api/v1/tenant-portal/maintenance-requests",
        headers={"x-tenant-portal-token": scope["token"]},
        json={
            "title": "  Aircon fault  ",
            "description": "  The unit turns off after five minutes.  ",
            "priority": "urgent",
            "source_reference": "  tenant-app-123  ",
            "document_ids": [scope["document_id"], scope["document_id"]],
            "photo_document_ids": [scope["document_id"]],
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["title"] == "Aircon fault"
    assert body["description"] == "The unit turns off after five minutes."
    assert body["status"] == "requested"
    assert body["priority"] == "urgent"
    assert body["source_reference"] == "tenant-app-123"
    assert body["document_ids"] == [scope["document_id"]]
    assert body["photo_document_ids"] == [scope["document_id"]]
    assert "entity_id" not in body
    assert "tenant_id" not in body

    work_order = session.get(MaintenanceWorkOrder, UUID(body["id"]))
    assert work_order is not None
    assert work_order.entity_id == UUID(scope["entity_id"])
    assert work_order.property_id == UUID(scope["property_id"])
    assert work_order.tenancy_unit_id == UUID(scope["unit_id"])
    assert work_order.tenant_id == UUID(scope["tenant_id"])
    assert work_order.lease_id == UUID(scope["lease_id"])
    assert work_order.work_order_metadata["source"] == "tenant_portal"
    assert work_order.work_order_metadata["tenant_onboarding_id"] == scope["onboarding_id"]
    assert work_order.work_order_metadata["auth_mode"] == "tenant_portal_token"
    assert work_order.work_order_metadata["activity_history"][0]["event"] == "tenant_submitted"
    assert work_order.work_order_metadata["activity_history"][0]["source"] == "tenant_portal"
    assert body["history"] == [
        {
            "timestamp": work_order.work_order_metadata["activity_history"][0][
                "timestamp"
            ].replace("+00:00", "Z"),
            "event": "tenant_submitted",
            "summary": "Tenant submitted maintenance request.",
            "status": "requested",
        }
    ]

    blank_response = client.post(
        "/api/v1/tenant-portal/maintenance-requests",
        headers={"x-tenant-portal-token": scope["token"]},
        json={
            "title": " ",
            "description": " ",
            "priority": "normal",
        },
    )
    assert blank_response.status_code == 422

    cross_scope_document_response = client.post(
        "/api/v1/tenant-portal/maintenance-requests",
        headers={"x-tenant-portal-token": scope["token"]},
        json={
            "title": "Blocked drain",
            "description": "Water is backing up.",
            "priority": "high",
            "document_ids": [scope["other_document_id"]],
        },
    )
    assert cross_scope_document_response.status_code == 404


def test_tenant_portal_onboarding_submit_writes_submitted_data(
    client: TestClient,
    session: Session,
) -> None:
    scope = _seed_portal_scope(session)

    response = client.post(
        "/api/v1/tenant-portal/onboarding/submit",
        headers={"x-tenant-portal-token": scope["token"]},
        json={
            "legal_name": "Portal Tenant Submitted Pty Ltd",
            "trading_name": "Portal One",
            "contact_name": "Avery Tenant",
            "contact_email": "avery@portal-one.example",
            "contact_phone": "+61 400 111 222",
            "insurance_confirmed": True,
            "accepted": True,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["onboarding"]["status"] == "submitted"
    assert body["onboarding"]["submitted_at"] is not None
    assert body["onboarding"]["submitted_data"]["legal_name"] == "Portal Tenant Submitted Pty Ltd"
    assert body["onboarding"]["submitted_data"]["insurance_confirmed"] is True

    onboarding = session.get(TenantOnboarding, UUID(scope["onboarding_id"]))
    assert onboarding is not None
    assert onboarding.status == TenantOnboardingStatus.submitted
    assert onboarding.submitted_data["legal_name"] == "Portal Tenant Submitted Pty Ltd"
    # Tenant record itself must NOT be mutated until operator clicks Apply.
    tenant = session.get(Tenant, UUID(scope["tenant_id"]))
    assert tenant is not None
    assert tenant.legal_name == "Portal Tenant One Pty Ltd"


def test_tenant_portal_contact_change_request_waits_for_operator_apply(
    client: TestClient,
    session: Session,
) -> None:
    scope = _seed_portal_scope(session)
    onboarding = session.get(TenantOnboarding, UUID(scope["onboarding_id"]))
    assert onboarding is not None
    onboarding.status = TenantOnboardingStatus.applied
    session.commit()

    response = client.post(
        "/api/v1/tenant-portal/contact-change-requests",
        headers={"x-tenant-portal-token": scope["token"]},
        json={
            "contact_name": "Avery Updated",
            "contact_email": "avery.updated@example.com",
            "contact_phone": "+61 400 111 333",
            "billing_email": "accounts.updated@example.com",
            "notes": "Please update my accounts contact.",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["contact_change_requests"][0]["status"] == "submitted"
    assert body["contact_change_requests"][0]["changes"][0]["after"] == "Avery Updated"
    tenant = session.get(Tenant, UUID(scope["tenant_id"]))
    assert tenant is not None
    assert tenant.contact_email == "avery@portal-one.example"
    requests = tenant.tenant_metadata["portal_contact_change_requests"]
    assert requests[0]["status"] == "submitted"
    assert requests[0]["changes"][0]["field"] == "contact_name"

    duplicate_response = client.post(
        "/api/v1/tenant-portal/contact-change-requests",
        headers={"x-tenant-portal-token": scope["token"]},
        json={"contact_email": "another@example.com"},
    )
    assert duplicate_response.status_code == 409

    detail_response = client.get(f"/api/v1/tenants/{scope['tenant_id']}/detail")
    assert detail_response.status_code == 200
    change_request = detail_response.json()["reviewed_changes"][0]
    assert change_request["source"] == "tenant_portal_contact_request"
    assert change_request["status"] == "submitted"

    apply_response = client.post(
        f"/api/v1/tenants/{scope['tenant_id']}/contact-change-requests/{requests[0]['id']}/apply",
        json={"notes": "Reviewed with tenant."},
    )

    assert apply_response.status_code == 200
    assert apply_response.json()["contact_email"] == "avery.updated@example.com"
    session.refresh(tenant)
    assert tenant.contact_name == "Avery Updated"
    assert tenant.billing_email == "accounts.updated@example.com"
    assert tenant.tenant_metadata["portal_contact_change_requests"][0]["status"] == "applied"


def test_operator_can_dismiss_tenant_portal_contact_change_request(
    client: TestClient,
    session: Session,
) -> None:
    scope = _seed_portal_scope(session)
    onboarding = session.get(TenantOnboarding, UUID(scope["onboarding_id"]))
    assert onboarding is not None
    onboarding.status = TenantOnboardingStatus.applied
    session.commit()

    response = client.post(
        "/api/v1/tenant-portal/contact-change-requests",
        headers={"x-tenant-portal-token": scope["token"]},
        json={"contact_email": "wrong-person@example.com"},
    )
    assert response.status_code == 200
    tenant = session.get(Tenant, UUID(scope["tenant_id"]))
    assert tenant is not None
    request_id = tenant.tenant_metadata["portal_contact_change_requests"][0]["id"]

    dismiss_response = client.post(
        f"/api/v1/tenants/{scope['tenant_id']}/contact-change-requests/{request_id}/dismiss",
        json={"notes": "Duplicate request."},
    )

    assert dismiss_response.status_code == 200
    assert dismiss_response.json()["contact_email"] == "avery@portal-one.example"
    session.refresh(tenant)
    assert tenant.contact_email == "avery@portal-one.example"
    contact_request = tenant.tenant_metadata["portal_contact_change_requests"][0]
    assert contact_request["status"] == "dismissed"
    assert contact_request["dismiss_notes"] == "Duplicate request."


def test_tenant_portal_lease_questions_gate_signing_and_apply(
    client: TestClient,
    session: Session,
) -> None:
    app.dependency_overrides[get_settings] = _tenant_account_settings
    scope = _seed_portal_scope(session)
    bearer_headers = {"Authorization": "Bearer tenant-subject-one"}

    claim_response = client.post(
        "/api/v1/tenant-portal/account/claim",
        headers=bearer_headers,
        json={"portal_token": scope["token"]},
    )
    assert claim_response.status_code == 200

    question_response = client.post(
        "/api/v1/tenant-portal/lease-questions",
        headers=bearer_headers,
        json={
            "clause_reference": "Clause 12",
            "question": "Can you confirm how the make-good obligation works?",
        },
    )
    assert question_response.status_code == 200
    agreement = question_response.json()["lease_agreement"]
    assert agreement["status"] == "questions_open"
    assert agreement["open_question_count"] == 1
    question = agreement["questions"][0]
    assert question["status"] == "open"
    assert question["clause_reference"] == "Clause 12"

    submitted_response = client.post(
        "/api/v1/tenant-portal/onboarding/submit",
        headers=bearer_headers,
        json={
            "legal_name": "Portal Tenant Submitted Pty Ltd",
            "trading_name": "Portal One",
            "contact_name": "Avery Tenant",
            "contact_email": "avery@portal-one.example",
            "contact_phone": "+61 400 111 222",
            "insurance_confirmed": True,
            "accepted": True,
        },
    )
    assert submitted_response.status_code == 200

    review_response = client.post(
        f"/api/v1/tenant-onboarding/{scope['onboarding_id']}/review",
        json={"approved": True, "notes": "Ready for lease signing."},
    )
    assert review_response.status_code == 200

    blocked_apply_response = client.post(
        f"/api/v1/tenant-onboarding/{scope['onboarding_id']}/apply"
    )
    assert blocked_apply_response.status_code == 409
    assert blocked_apply_response.json()["detail"] == (
        "Resolve lease agreement questions before applying onboarding."
    )

    answer_response = client.post(
        f"/api/v1/tenant-onboarding/{scope['onboarding_id']}"
        f"/lease-questions/{question['id']}/respond",
        json={
            "answer": "The make-good requirement is limited to tenant-installed works.",
            "status": "answered",
        },
    )
    assert answer_response.status_code == 200
    answered_questions = answer_response.json()["delivery_data"]["lease_agreement"]["questions"]
    assert answered_questions[0]["status"] == "answered"

    apply_response = client.post(
        f"/api/v1/tenant-onboarding/{scope['onboarding_id']}/apply"
    )
    assert apply_response.status_code == 200
    assert apply_response.json()["status"] == "applied"

    portal_response = client.get("/api/v1/tenant-portal/session", headers=bearer_headers)
    assert portal_response.status_code == 200
    assert portal_response.json()["lease_agreement"]["status"] == "ready_to_sign"

    sign_response = client.post(
        "/api/v1/tenant-portal/lease-agreement/sign",
        headers=bearer_headers,
        json={"accepted": True},
    )
    assert sign_response.status_code == 200
    signed_agreement = sign_response.json()["lease_agreement"]
    assert signed_agreement["status"] == "signed"
    assert signed_agreement["signed_at"] is not None


def test_tenant_portal_onboarding_submit_rejects_non_sent_status(
    client: TestClient,
    session: Session,
) -> None:
    scope = _seed_portal_scope(session)
    onboarding = session.get(TenantOnboarding, UUID(scope["onboarding_id"]))
    assert onboarding is not None
    onboarding.status = TenantOnboardingStatus.submitted
    session.commit()

    response = client.post(
        "/api/v1/tenant-portal/onboarding/submit",
        headers={"x-tenant-portal-token": scope["token"]},
        json={
            "legal_name": "Portal Tenant Pty Ltd",
            "contact_name": "Avery Tenant",
            "contact_email": "avery@portal-one.example",
            "accepted": True,
        },
    )

    assert response.status_code == 409
