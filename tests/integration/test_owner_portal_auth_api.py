"""Owner portal account/token auth tests."""

from __future__ import annotations

from datetime import date

from apps.api.main import app
from apps.api.routers import owner_portal as owner_portal_router
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
    Owner,
    OwnerPortalAccount,
    OwnerPortalAccountStatus,
    OwnerPortalInvite,
    Property,
    PropertyOwner,
    PropertyType,
    StoredDocument,
    TenancyUnit,
    Tenant,
    TenantOnboarding,
    TenantOnboardingStatus,
)
from stewart.core.settings import Settings, get_settings


def _owner_account_settings() -> Settings:
    return get_settings().model_copy(update={"clerk_allow_legacy_token_mapping": True})


def _entity(session: Session) -> Entity:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return entity


def _seed_owner(session: Session, *, email: str = "owner@example.test") -> Owner:
    entity = _entity(session)
    doc = StoredDocument(
        entity_id=entity.id,
        filename="owner-account-seed.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.invoice,
    )
    session.add(doc)
    session.flush()
    draft = BillingDraft(
        entity_id=entity.id,
        document_id=doc.id,
        title="Owner account seed billing",
        currency="AUD",
        status=BillingDraftStatus.approved,
    )
    owner = Owner(
        entity_id=entity.id,
        legal_name="Owner Portal Pty Ltd",
        billing_contact_name="Owner Accounts",
        billing_email=email,
        gst_registered=True,
    )
    session.add_all([draft, owner])
    session.flush()
    prop = Property(
        entity_id=entity.id,
        name="Owner Portal Plaza",
        street_address="1 Owner Street",
        property_type=PropertyType.commercial_retail,
    )
    session.add(prop)
    session.flush()
    session.add(PropertyOwner(property_id=prop.id, owner_id=owner.id, split_pct=100))
    session.add(
        InvoiceDraft(
            entity_id=entity.id,
            billing_draft_id=draft.id,
            property_id=prop.id,
            document_id=doc.id,
            status=InvoiceDraftStatus.approved,
            invoice_number="INV-OWNER-PORTAL",
            title="May owner portal invoice",
            currency="AUD",
            issue_date=date(2026, 5, 15),
            subtotal_cents=550_000,
            gst_cents=0,
            total_cents=550_000,
            invoice_metadata={"paid_cents": 0},
        )
    )
    session.commit()
    return owner


def _create_invite(client: TestClient, owner: Owner) -> dict[str, str]:
    response = client.post(f"/api/v1/owner-portal/{owner.id}/invite")
    assert response.status_code == 201, response.text
    return response.json()


def _account_by_provider(session: Session, provider_id: str) -> OwnerPortalAccount:
    account = session.scalar(
        select(OwnerPortalAccount).where(
            OwnerPortalAccount.auth_provider == "clerk",
            OwnerPortalAccount.auth_provider_id == provider_id,
            OwnerPortalAccount.deleted_at.is_(None),
        )
    )
    assert account is not None
    return account


def _linked_owner_property(session: Session, owner: Owner) -> Property:
    prop = session.scalar(
        select(Property)
        .join(PropertyOwner, PropertyOwner.property_id == Property.id)
        .where(PropertyOwner.owner_id == owner.id)
    )
    assert prop is not None
    return prop


def test_operator_can_create_hashed_owner_portal_invite(
    client: TestClient,
    session: Session,
) -> None:
    owner = _seed_owner(session)

    body = _create_invite(client, owner)

    assert body["owner_id"] == str(owner.id)
    assert body["owner_display_name"] == "Owner Portal Pty Ltd"
    assert body["claim_email"] == "owner@example.test"
    assert body["portal_token"]
    assert body["claim_url"] == f"/owner-portal/invite/{body['portal_token']}"
    assert body["guardrails"] == [
        (
            "Owner portal invite created locally only: no owner email is sent, "
            "no PDF is generated or dispatched, no Xero data is written, and no "
            "provider history is mutated."
        )
    ]

    invite = session.scalar(
        select(OwnerPortalInvite).where(OwnerPortalInvite.owner_id == owner.id)
    )
    assert invite is not None
    assert invite.token_hash != body["portal_token"]
    assert len(invite.token_hash) == 64
    assert invite.claim_email == "owner@example.test"
    assert invite.consumed_at is None


def test_owner_portal_invite_preview_is_safe_before_claim(
    client: TestClient,
    session: Session,
) -> None:
    owner = _seed_owner(session)
    invite = _create_invite(client, owner)

    response = client.get(
        f"/api/v1/owner-portal/invites/{invite['portal_token']}/preview"
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["owner_display_name"] == "Owner Portal Pty Ltd"
    assert body["claim_email"] == "owner@example.test"
    assert body["expires_at"].startswith(invite["expires_at"].removesuffix("Z"))
    assert body["claimable"] is True


def test_owner_portal_claim_requires_matching_clerk_email(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    app.dependency_overrides[get_settings] = _owner_account_settings
    owner = _seed_owner(session)
    invite = _create_invite(client, owner)

    def fake_identity(authorization, settings):  # noqa: ANN001, ARG001
        return ClerkIdentity(
            provider_id="owner-subject-one",
            verified_email="wrong-owner@example.test",
        )

    monkeypatch.setattr(owner_portal_router, "_owner_portal_identity", fake_identity)

    response = client.post(
        "/api/v1/owner-portal/account/claim",
        headers={"Authorization": "Bearer owner-subject-one"},
        json={"portal_token": invite["portal_token"]},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == (
        "Owner portal login email must match this invite."
    )
    stored_invite = session.scalar(
        select(OwnerPortalInvite).where(OwnerPortalInvite.owner_id == owner.id)
    )
    assert stored_invite is not None
    assert stored_invite.consumed_at is None
    account = session.scalar(
        select(OwnerPortalAccount).where(
            OwnerPortalAccount.auth_provider_id == "owner-subject-one"
        )
    )
    assert account is None


def test_owner_portal_account_claim_and_bearer_session_are_scoped(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    app.dependency_overrides[get_settings] = _owner_account_settings
    owner = _seed_owner(session, email="OWNER@EXAMPLE.TEST")
    invite = _create_invite(client, owner)

    def fake_identity(authorization, settings):  # noqa: ANN001, ARG001
        provider_id = (
            "other-owner-subject"
            if authorization == "Bearer other-owner-subject"
            else "owner-subject-one"
        )
        return ClerkIdentity(
            provider_id=provider_id,
            verified_email="owner@example.test",
        )

    monkeypatch.setattr(owner_portal_router, "_owner_portal_identity", fake_identity)

    claim_response = client.post(
        "/api/v1/owner-portal/account/claim",
        headers={"Authorization": "Bearer owner-subject-one"},
        json={"portal_token": invite["portal_token"]},
    )

    assert claim_response.status_code == 200, claim_response.text
    body = claim_response.json()
    assert body["auth"] == {
        "mode": "owner_portal_account",
        "token_source": "bearer",
        "owner_auth_configured": True,
        "boundary": "owner_portal_account",
        "detail": "Access is scoped to the owner linked to this owner portal account.",
    }
    assert body["owner"]["id"] == str(owner.id)
    assert body["statement"]["month"] == "2026-05"
    assert body["statement"]["invoiced_cents"] == 550_000

    account = _account_by_provider(session, "owner-subject-one")
    assert account.entity_id == owner.entity_id
    assert account.owner_id == owner.id
    assert account.email == "OWNER@EXAMPLE.TEST"
    assert account.status == OwnerPortalAccountStatus.active
    assert account.account_metadata["source"] == "owner_portal_claim"

    stored_invite = session.scalar(
        select(OwnerPortalInvite).where(OwnerPortalInvite.owner_id == owner.id)
    )
    assert stored_invite is not None
    assert stored_invite.consumed_at is not None

    status_response = client.get(
        "/api/v1/owner-portal/account/status",
        headers={"Authorization": "Bearer owner-subject-one"},
    )
    assert status_response.status_code == 200
    assert status_response.json()["status"] == "active"
    assert status_response.json()["owner_id"] == str(owner.id)

    bearer_response = client.get(
        "/api/v1/owner-portal/account/session",
        params={"month": "2026-05"},
        headers={"Authorization": "Bearer owner-subject-one"},
    )
    assert bearer_response.status_code == 200
    assert bearer_response.json()["auth"]["mode"] == "owner_portal_account"
    assert bearer_response.json()["owner"]["id"] == str(owner.id)

    consumed_claim_response = client.post(
        "/api/v1/owner-portal/account/claim",
        headers={"Authorization": "Bearer other-owner-subject"},
        json={"portal_token": invite["portal_token"]},
    )
    assert consumed_claim_response.status_code == 410

    account.status = OwnerPortalAccountStatus.revoked
    account.revoked_at = stored_invite.consumed_at
    session.commit()

    revoked_session = client.get(
        "/api/v1/owner-portal/account/session",
        params={"month": "2026-05"},
        headers={"Authorization": "Bearer owner-subject-one"},
    )
    assert revoked_session.status_code == 401


def test_owner_portal_account_downloads_only_visible_linked_property_documents(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    app.dependency_overrides[get_settings] = _owner_account_settings
    owner = _seed_owner(session)
    invite = _create_invite(client, owner)

    def fake_identity(authorization, settings):  # noqa: ANN001, ARG001
        return ClerkIdentity(
            provider_id="owner-subject-one",
            verified_email="owner@example.test",
        )

    monkeypatch.setattr(owner_portal_router, "_owner_portal_identity", fake_identity)

    claim_response = client.post(
        "/api/v1/owner-portal/account/claim",
        headers={"Authorization": "Bearer owner-subject-one"},
        json={"portal_token": invite["portal_token"]},
    )
    assert claim_response.status_code == 200, claim_response.text

    entity = _entity(session)
    linked_property = _linked_owner_property(session, owner)
    unlinked_property = Property(
        entity_id=entity.id,
        name="Other Owner Property",
        street_address="22 Other Street",
        property_type=PropertyType.commercial_office,
    )
    session.add(unlinked_property)
    session.flush()
    tenant = Tenant(entity_id=entity.id, legal_name="Tenant Private Pty Ltd")
    unit = TenancyUnit(property_id=linked_property.id, unit_label="Suite 1")
    session.add_all([tenant, unit])
    session.flush()
    lease = Lease(
        tenancy_unit_id=unit.id,
        tenant_id=tenant.id,
        status=LeaseStatus.active,
    )
    session.add(lease)
    session.flush()
    onboarding = TenantOnboarding(
        entity_id=entity.id,
        lease_id=lease.id,
        tenant_id=tenant.id,
        token="owner-docs-tenant-token",
        status=TenantOnboardingStatus.sent,
    )
    session.add(onboarding)
    session.flush()
    visible_doc = StoredDocument(
        entity_id=entity.id,
        property_id=linked_property.id,
        filename="owner-visible-report.pdf",
        content_type="application/pdf",
        byte_size=len(b"owner visible"),
        file_data=b"owner visible",
        category=DocumentCategory.other,
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
    unit_doc = StoredDocument(
        entity_id=entity.id,
        property_id=linked_property.id,
        tenancy_unit_id=unit.id,
        filename="unit-private.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.other,
        document_metadata={"owner_portal_visible": True},
    )
    lease_doc = StoredDocument(
        entity_id=entity.id,
        property_id=linked_property.id,
        tenancy_unit_id=unit.id,
        tenant_id=tenant.id,
        lease_id=lease.id,
        filename="lease-private.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.lease,
        document_metadata={"owner_portal_visible": True},
    )
    onboarding_doc = StoredDocument(
        entity_id=entity.id,
        property_id=linked_property.id,
        tenant_id=tenant.id,
        lease_id=lease.id,
        tenant_onboarding_id=onboarding.id,
        filename="onboarding-private.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.onboarding,
        document_metadata={"owner_portal_visible": True},
    )
    invoice_doc = StoredDocument(
        entity_id=entity.id,
        property_id=linked_property.id,
        filename="invoice-private.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.invoice,
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
    session.add_all(
        [
            visible_doc,
            hidden_doc,
            tenant_doc,
            unit_doc,
            lease_doc,
            onboarding_doc,
            invoice_doc,
            cross_property_doc,
        ]
    )
    session.commit()

    download_response = client.get(
        f"/api/v1/owner-portal/account/documents/{visible_doc.id}/download",
        headers={"Authorization": "Bearer owner-subject-one"},
    )
    assert download_response.status_code == 200, download_response.text
    assert download_response.content == b"owner visible"
    assert download_response.headers["content-type"] == "application/pdf"
    assert (
        "owner-visible-report.pdf"
        in download_response.headers["content-disposition"]
    )

    hidden_response = client.get(
        f"/api/v1/owner-portal/account/documents/{hidden_doc.id}/download",
        headers={"Authorization": "Bearer owner-subject-one"},
    )
    assert hidden_response.status_code == 404

    for blocked_document in [
        tenant_doc,
        unit_doc,
        lease_doc,
        onboarding_doc,
        invoice_doc,
    ]:
        blocked_response = client.get(
            f"/api/v1/owner-portal/account/documents/{blocked_document.id}/download",
            headers={"Authorization": "Bearer owner-subject-one"},
        )
        assert blocked_response.status_code == 404

    cross_property_response = client.get(
        f"/api/v1/owner-portal/account/documents/{cross_property_doc.id}/download",
        headers={"Authorization": "Bearer owner-subject-one"},
    )
    assert cross_property_response.status_code == 404

    account = _account_by_provider(session, "owner-subject-one")
    account.status = OwnerPortalAccountStatus.revoked
    account.revoked_at = account.linked_at
    session.commit()

    revoked_response = client.get(
        f"/api/v1/owner-portal/account/documents/{visible_doc.id}/download",
        headers={"Authorization": "Bearer owner-subject-one"},
    )
    assert revoked_response.status_code == 401
