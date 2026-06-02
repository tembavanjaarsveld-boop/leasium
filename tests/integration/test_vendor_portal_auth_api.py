"""Vendor portal account/token auth tests."""

from __future__ import annotations

from datetime import UTC, date, datetime

from apps.api.main import app
from apps.api.routers import vendor_portal as vendor_portal_router
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.auth import ClerkIdentity
from stewart.core.models import (
    Contractor,
    Entity,
    MaintenancePriority,
    MaintenanceWorkOrder,
    MaintenanceWorkOrderStatus,
    Property,
    PropertyType,
    VendorPortalAccount,
    VendorPortalAccountStatus,
    VendorPortalInvite,
)
from stewart.core.settings import Settings, get_settings


def _vendor_account_settings() -> Settings:
    return get_settings().model_copy(update={"clerk_allow_legacy_token_mapping": True})


def _entity(session: Session) -> Entity:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return entity


def _seed_contractor(
    session: Session,
    *,
    name: str = "Rapid HVAC",
    company_name: str | None = "Rapid HVAC Pty Ltd",
    email: str | None = "contractor@example.test",
) -> Contractor:
    contractor = Contractor(
        entity_id=_entity(session).id,
        name=name,
        company_name=company_name,
        categories=["hvac", "urgent"],
        email=email,
        phone="+61 400 111 222",
        priority=1,
        notes="Operator-only contractor note.",
    )
    session.add(contractor)
    session.commit()
    return contractor


def _seed_shared_work_order(
    session: Session,
    contractor: Contractor,
    *,
    status: MaintenanceWorkOrderStatus = MaintenanceWorkOrderStatus.assigned,
    title: str = "Repair air conditioning",
) -> MaintenanceWorkOrder:
    entity = _entity(session)
    prop = Property(
        entity_id=entity.id,
        name="Queen Street Retail Centre",
        street_address="101 Queen Street",
        suburb="Brisbane",
        state="QLD",
        postcode="4000",
        property_type=PropertyType.commercial_retail,
    )
    session.add(prop)
    session.flush()
    work_order = MaintenanceWorkOrder(
        entity_id=entity.id,
        property_id=prop.id,
        title="Private Tenant Pty Ltd boardroom HVAC failure",
        description="Tenant says their directors are arriving at 10am.",
        status=status,
        priority=MaintenancePriority.urgent,
        requested_at=datetime(2026, 6, 1, 1, 30, tzinfo=UTC),
        contractor_email="contractor@example.test",
        due_date=date(2026, 6, 7),
        notes="Internal escalation: do not show this to the vendor.",
        work_order_metadata={
            "vendor_portal_visible": True,
            "vendor_portal_contractor_id": str(contractor.id),
            "vendor_portal_title": title,
        },
    )
    session.add(work_order)
    session.commit()
    return work_order


def _create_invite(client: TestClient, contractor: Contractor) -> dict[str, str]:
    response = client.post(f"/api/v1/vendor-portal/{contractor.id}/invite")
    assert response.status_code == 201, response.text
    return response.json()


def _account_by_provider(session: Session, provider_id: str) -> VendorPortalAccount:
    account = session.scalar(
        select(VendorPortalAccount).where(
            VendorPortalAccount.auth_provider == "clerk",
            VendorPortalAccount.auth_provider_id == provider_id,
            VendorPortalAccount.deleted_at.is_(None),
        )
    )
    assert account is not None
    return account


def test_operator_can_create_hashed_vendor_portal_invite(
    client: TestClient,
    session: Session,
) -> None:
    contractor = _seed_contractor(session)

    body = _create_invite(client, contractor)

    assert body["contractor_id"] == str(contractor.id)
    assert body["vendor_display_name"] == "Rapid HVAC Pty Ltd"
    assert body["claim_email"] == "contractor@example.test"
    assert body["portal_token"]
    assert body["claim_url"] == f"/vendor-portal/invite/{body['portal_token']}"
    assert "no contractor email or SMS is sent" in body["guardrails"][0]

    invite = session.scalar(
        select(VendorPortalInvite).where(VendorPortalInvite.contractor_id == contractor.id)
    )
    assert invite is not None
    assert invite.token_hash != body["portal_token"]
    assert len(invite.token_hash) == 64
    assert invite.claim_email == "contractor@example.test"
    assert invite.consumed_at is None


def test_vendor_portal_invite_requires_contractor_email(
    client: TestClient,
    session: Session,
) -> None:
    contractor = _seed_contractor(session, email=None)

    response = client.post(f"/api/v1/vendor-portal/{contractor.id}/invite")

    assert response.status_code == 409
    assert "Contractor email is required" in response.json()["detail"]
    invite = session.scalar(
        select(VendorPortalInvite).where(VendorPortalInvite.contractor_id == contractor.id)
    )
    assert invite is None


def test_vendor_portal_invite_preview_is_safe_before_claim(
    client: TestClient,
    session: Session,
) -> None:
    contractor = _seed_contractor(session)
    invite = _create_invite(client, contractor)

    response = client.get(
        f"/api/v1/vendor-portal/invites/{invite['portal_token']}/preview"
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["vendor_display_name"] == "Rapid HVAC Pty Ltd"
    assert body["claim_email"] == "contractor@example.test"
    assert body["claimable"] is True


def test_vendor_portal_claim_requires_matching_clerk_email(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    app.dependency_overrides[get_settings] = _vendor_account_settings
    contractor = _seed_contractor(session)
    invite = _create_invite(client, contractor)

    def fake_identity(authorization, settings):  # noqa: ANN001, ARG001
        return ClerkIdentity(
            provider_id="vendor-subject-one",
            verified_email="wrong-vendor@example.test",
        )

    monkeypatch.setattr(vendor_portal_router, "_vendor_portal_identity", fake_identity)

    response = client.post(
        "/api/v1/vendor-portal/account/claim",
        headers={"Authorization": "Bearer vendor-subject-one"},
        json={"portal_token": invite["portal_token"]},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Vendor portal login email must match this invite."
    stored_invite = session.scalar(
        select(VendorPortalInvite).where(VendorPortalInvite.contractor_id == contractor.id)
    )
    assert stored_invite is not None
    assert stored_invite.consumed_at is None
    account = session.scalar(
        select(VendorPortalAccount).where(
            VendorPortalAccount.auth_provider_id == "vendor-subject-one"
        )
    )
    assert account is None


def test_vendor_portal_account_claim_and_bearer_session_are_scoped(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    app.dependency_overrides[get_settings] = _vendor_account_settings
    contractor = _seed_contractor(session)
    work_order = _seed_shared_work_order(session, contractor)
    invite = _create_invite(client, contractor)

    def fake_identity(authorization, settings):  # noqa: ANN001, ARG001
        provider_id = (
            "other-vendor-subject"
            if authorization == "Bearer other-vendor-subject"
            else "vendor-subject-one"
        )
        return ClerkIdentity(provider_id=provider_id, verified_email="contractor@example.test")

    monkeypatch.setattr(vendor_portal_router, "_vendor_portal_identity", fake_identity)

    claim_response = client.post(
        "/api/v1/vendor-portal/account/claim",
        headers={"Authorization": "Bearer vendor-subject-one"},
        json={"portal_token": invite["portal_token"]},
    )

    assert claim_response.status_code == 200, claim_response.text
    body = claim_response.json()
    assert body["auth"] == {
        "mode": "vendor_portal_account",
        "token_source": "bearer",
        "vendor_auth_configured": True,
        "boundary": "vendor_portal_account",
        "detail": (
            "Access is scoped to the contractor linked to this vendor portal account."
        ),
    }
    assert body["vendor"]["id"] == str(contractor.id)
    assert body["work_orders"]["items"][0]["id"] == str(work_order.id)
    assert body["work_orders"]["items"][0]["title"] == "Repair air conditioning"

    account = _account_by_provider(session, "vendor-subject-one")
    assert account.contractor_id == contractor.id
    assert account.entity_id == contractor.entity_id
    assert account.status == VendorPortalAccountStatus.active
    assert account.account_metadata["source"] == "vendor_portal_claim"

    stored_invite = session.scalar(
        select(VendorPortalInvite).where(VendorPortalInvite.contractor_id == contractor.id)
    )
    assert stored_invite is not None
    assert stored_invite.consumed_at is not None

    status_response = client.get(
        "/api/v1/vendor-portal/account/status",
        headers={"Authorization": "Bearer vendor-subject-one"},
    )
    assert status_response.status_code == 200
    assert status_response.json()["status"] == "active"
    assert status_response.json()["contractor_id"] == str(contractor.id)

    session_response = client.get(
        "/api/v1/vendor-portal/account/session",
        headers={"Authorization": "Bearer vendor-subject-one"},
    )
    assert session_response.status_code == 200
    assert session_response.json()["auth"]["mode"] == "vendor_portal_account"
    assert session_response.json()["work_orders"]["items"][0]["id"] == str(work_order.id)

    consumed_claim_response = client.post(
        "/api/v1/vendor-portal/account/claim",
        headers={"Authorization": "Bearer other-vendor-subject"},
        json={"portal_token": invite["portal_token"]},
    )
    assert consumed_claim_response.status_code == 410

    account.status = VendorPortalAccountStatus.revoked
    account.revoked_at = stored_invite.consumed_at
    session.commit()

    revoked_session = client.get(
        "/api/v1/vendor-portal/account/session",
        headers={"Authorization": "Bearer vendor-subject-one"},
    )
    assert revoked_session.status_code == 401


def test_vendor_portal_login_blocks_ambiguous_shared_login(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    app.dependency_overrides[get_settings] = _vendor_account_settings
    first_contractor = _seed_contractor(
        session, name="Rapid HVAC", company_name="Rapid HVAC Pty Ltd"
    )
    second_contractor = _seed_contractor(
        session, name="Second Trades", company_name="Second Trades Pty Ltd"
    )
    first_invite = _create_invite(client, first_contractor)
    second_invite = _create_invite(client, second_contractor)

    def fake_identity(authorization, settings):  # noqa: ANN001, ARG001
        return ClerkIdentity(
            provider_id="shared-vendor-subject",
            verified_email="contractor@example.test",
        )

    monkeypatch.setattr(vendor_portal_router, "_vendor_portal_identity", fake_identity)

    first_claim = client.post(
        "/api/v1/vendor-portal/account/claim",
        headers={"Authorization": "Bearer shared-vendor-subject"},
        json={"portal_token": first_invite["portal_token"]},
    )
    assert first_claim.status_code == 200, first_claim.text
    assert first_claim.json()["vendor"]["id"] == str(first_contractor.id)

    second_claim = client.post(
        "/api/v1/vendor-portal/account/claim",
        headers={"Authorization": "Bearer shared-vendor-subject"},
        json={"portal_token": second_invite["portal_token"]},
    )

    assert second_claim.status_code == 409
    assert "already linked to another contractor" in second_claim.json()["detail"]
    session.expire_all()
    second_stored_invite = session.scalar(
        select(VendorPortalInvite).where(
            VendorPortalInvite.contractor_id == second_contractor.id
        )
    )
    assert second_stored_invite is not None
    assert second_stored_invite.consumed_at is None
    accounts = list(
        session.scalars(
            select(VendorPortalAccount).where(
                VendorPortalAccount.auth_provider == "clerk",
                VendorPortalAccount.auth_provider_id == "shared-vendor-subject",
                VendorPortalAccount.status == VendorPortalAccountStatus.active,
                VendorPortalAccount.revoked_at.is_(None),
                VendorPortalAccount.deleted_at.is_(None),
            )
        )
    )
    assert [account.contractor_id for account in accounts] == [first_contractor.id]

    status_response = client.get(
        "/api/v1/vendor-portal/account/status",
        headers={"Authorization": "Bearer shared-vendor-subject"},
    )
    assert status_response.status_code == 200
    assert status_response.json()["contractor_id"] == str(first_contractor.id)
