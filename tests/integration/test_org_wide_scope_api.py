"""Org-wide (no entity_id) scope on the all-entities fan-out list endpoints."""

from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import (
    ArrearsCase,
    BillingDraft,
    ComplianceCheck,
    Contractor,
    DocumentCategory,
    DocumentIntake,
    Entity,
    InvoiceDraft,
    Lease,
    LeaseStatus,
    MaintenanceWorkOrder,
    Obligation,
    ObligationCategory,
    ObligationStatus,
    Property,
    PropertyType,
    StoredDocument,
    TenancyUnit,
    Tenant,
    TenantOnboarding,
    UserEntityRole,
    UserRole,
)
from stewart.core.settings import get_settings


def _seed_entity_records(session: Session, entity: Entity, token: str) -> None:
    """Minimal rows for every org-wide list endpoint under one entity."""

    prop = Property(
        entity_id=entity.id,
        name=f"{entity.name} HQ",
        street_address="1 Test St",
        property_type=PropertyType.commercial_office,
    )
    session.add(prop)
    session.flush()
    unit = TenancyUnit(property_id=prop.id, unit_label="U1")
    tenant = Tenant(entity_id=entity.id, legal_name=f"{entity.name} Tenant")
    session.add_all([unit, tenant])
    session.flush()
    lease = Lease(
        tenancy_unit_id=unit.id,
        tenant_id=tenant.id,
        status=LeaseStatus.active,
    )
    document = StoredDocument(
        entity_id=entity.id,
        filename="intake.pdf",
        byte_size=3,
        file_data=b"pdf",
        category=DocumentCategory.other,
    )
    session.add_all([lease, document])
    session.flush()
    document_intake = DocumentIntake(entity_id=entity.id, document_id=document.id)
    session.add(document_intake)
    session.flush()
    billing_draft = BillingDraft(
        entity_id=entity.id,
        property_id=prop.id,
        tenancy_unit_id=unit.id,
        tenant_id=tenant.id,
        lease_id=lease.id,
        document_id=document.id,
        document_intake_id=document_intake.id,
        title=f"{entity.name} billing draft",
        issue_date=date(2026, 7, 1),
        due_date=date(2026, 7, 15),
        total_cents=154000,
    )
    session.add(billing_draft)
    session.flush()
    session.add_all(
        [
            Obligation(
                entity_id=entity.id,
                title=f"{entity.name} obligation",
                category=ObligationCategory.compliance,
                status=ObligationStatus.upcoming,
                due_date=date(2026, 7, 1),
            ),
            TenantOnboarding(
                entity_id=entity.id,
                lease_id=lease.id,
                tenant_id=tenant.id,
                token=token,
            ),
            ArrearsCase(
                entity_id=entity.id,
                property_id=prop.id,
                tenancy_unit_id=unit.id,
                tenant_id=tenant.id,
                lease_id=lease.id,
                total_balance_cents=880000,
            ),
            MaintenanceWorkOrder(
                entity_id=entity.id,
                property_id=prop.id,
                tenancy_unit_id=unit.id,
                tenant_id=tenant.id,
                lease_id=lease.id,
                title=f"{entity.name} repair",
                description="Replace flickering tenancy lighting.",
            ),
            InvoiceDraft(
                entity_id=entity.id,
                billing_draft_id=billing_draft.id,
                property_id=prop.id,
                tenancy_unit_id=unit.id,
                tenant_id=tenant.id,
                lease_id=lease.id,
                document_id=document.id,
                document_intake_id=document_intake.id,
                title=f"{entity.name} invoice draft",
                issue_date=date(2026, 7, 1),
                due_date=date(2026, 7, 15),
                subtotal_cents=140000,
                gst_cents=14000,
                total_cents=154000,
            ),
            Contractor(
                entity_id=entity.id,
                name=f"{entity.name} Contractor",
                company_name=f"{entity.name} Services",
                categories=["maintenance"],
            ),
            ComplianceCheck(
                entity_id=entity.id,
                title=f"{entity.name} compliance check",
                next_due_date=date(2026, 8, 1),
            ),
        ]
    )
    session.commit()


def test_org_wide_lists_cover_readable_entities_only(
    client: TestClient,
    session: Session,
) -> None:
    settings = get_settings()
    seeded = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert seeded is not None

    accessible = Entity(organisation_id=seeded.organisation_id, name="Accessible Trust")
    hidden = Entity(organisation_id=seeded.organisation_id, name="Hidden Trust")
    session.add_all([accessible, hidden])
    session.flush()
    session.add(
        UserEntityRole(
            user_id=settings.dev_user_id,
            entity_id=accessible.id,
            role=UserRole.viewer,
        )
    )
    session.commit()
    _seed_entity_records(session, accessible, token="org-scope-accessible")
    _seed_entity_records(session, hidden, token="org-scope-hidden")

    accessible_id = str(accessible.id)
    hidden_id = str(hidden.id)

    for path in (
        "/api/v1/properties",
        "/api/v1/tenants",
        "/api/v1/contractors",
        "/api/v1/rent-roll",
        "/api/v1/obligations",
        "/api/v1/tenant-onboarding",
        "/api/v1/document-intakes",
        "/api/v1/compliance/checks",
        "/api/v1/arrears/cases",
        "/api/v1/maintenance/work-orders",
        "/api/v1/billing-drafts",
        "/api/v1/invoice-drafts",
    ):
        response = client.get(path)
        assert response.status_code == 200, path
        entity_ids = {row["entity_id"] for row in response.json()}
        assert accessible_id in entity_ids, path
        assert hidden_id not in entity_ids, path


def test_explicit_entity_scope_still_requires_entity_role(
    client: TestClient,
    session: Session,
) -> None:
    seeded = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert seeded is not None
    hidden = Entity(organisation_id=seeded.organisation_id, name="Hidden Trust")
    session.add(hidden)
    session.commit()

    for path in (
        "/api/v1/properties",
        "/api/v1/tenants",
        "/api/v1/contractors",
        "/api/v1/rent-roll",
        "/api/v1/obligations",
        "/api/v1/tenant-onboarding",
        "/api/v1/document-intakes",
        "/api/v1/compliance/checks",
        "/api/v1/arrears/cases",
        "/api/v1/maintenance/work-orders",
        "/api/v1/billing-drafts",
        "/api/v1/invoice-drafts",
    ):
        response = client.get(path, params={"entity_id": str(hidden.id)})
        assert response.status_code == 403, path


def test_org_wide_arrears_tenant_filter_requires_readable_tenant(
    client: TestClient,
    session: Session,
) -> None:
    settings = get_settings()
    seeded = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert seeded is not None

    accessible = Entity(organisation_id=seeded.organisation_id, name="Accessible Trust")
    hidden = Entity(organisation_id=seeded.organisation_id, name="Hidden Trust")
    session.add_all([accessible, hidden])
    session.flush()
    session.add(
        UserEntityRole(
            user_id=settings.dev_user_id,
            entity_id=accessible.id,
            role=UserRole.viewer,
        )
    )
    session.commit()
    _seed_entity_records(session, accessible, token="arrears-filter-accessible")
    _seed_entity_records(session, hidden, token="arrears-filter-hidden")

    accessible_tenant = session.scalar(
        select(Tenant).where(Tenant.entity_id == accessible.id)
    )
    hidden_tenant = session.scalar(select(Tenant).where(Tenant.entity_id == hidden.id))
    assert accessible_tenant is not None
    assert hidden_tenant is not None

    response = client.get(
        "/api/v1/arrears/cases",
        params={"tenant_id": str(accessible_tenant.id)},
    )
    assert response.status_code == 200
    entity_ids = {row["entity_id"] for row in response.json()}
    assert entity_ids == {str(accessible.id)}

    response = client.get(
        "/api/v1/arrears/cases",
        params={"tenant_id": str(hidden_tenant.id)},
    )
    assert response.status_code == 403


def test_org_wide_maintenance_filters_require_readable_links(
    client: TestClient,
    session: Session,
) -> None:
    settings = get_settings()
    seeded = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert seeded is not None

    accessible = Entity(organisation_id=seeded.organisation_id, name="Visible Repairs")
    hidden = Entity(organisation_id=seeded.organisation_id, name="Hidden Repairs")
    session.add_all([accessible, hidden])
    session.flush()
    session.add(
        UserEntityRole(
            user_id=settings.dev_user_id,
            entity_id=accessible.id,
            role=UserRole.viewer,
        )
    )
    session.commit()
    _seed_entity_records(session, accessible, token="maintenance-filter-accessible")
    _seed_entity_records(session, hidden, token="maintenance-filter-hidden")

    accessible_property = session.scalar(
        select(Property).where(Property.entity_id == accessible.id)
    )
    hidden_property = session.scalar(select(Property).where(Property.entity_id == hidden.id))
    accessible_tenant = session.scalar(
        select(Tenant).where(Tenant.entity_id == accessible.id)
    )
    hidden_tenant = session.scalar(select(Tenant).where(Tenant.entity_id == hidden.id))
    assert accessible_property is not None
    assert hidden_property is not None
    assert accessible_tenant is not None
    assert hidden_tenant is not None

    response = client.get(
        "/api/v1/maintenance/work-orders",
        params={"property_id": str(accessible_property.id)},
    )
    assert response.status_code == 200
    entity_ids = {row["entity_id"] for row in response.json()}
    assert entity_ids == {str(accessible.id)}

    response = client.get(
        "/api/v1/maintenance/work-orders",
        params={"tenant_id": str(accessible_tenant.id)},
    )
    assert response.status_code == 200
    entity_ids = {row["entity_id"] for row in response.json()}
    assert entity_ids == {str(accessible.id)}

    response = client.get(
        "/api/v1/maintenance/work-orders",
        params={"property_id": str(hidden_property.id)},
    )
    assert response.status_code == 403

    response = client.get(
        "/api/v1/maintenance/work-orders",
        params={"tenant_id": str(hidden_tenant.id)},
    )
    assert response.status_code == 403


def test_org_wide_billing_draft_filters_require_readable_links(
    client: TestClient,
    session: Session,
) -> None:
    settings = get_settings()
    seeded = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert seeded is not None

    accessible = Entity(organisation_id=seeded.organisation_id, name="Visible Billing")
    readable_peer = Entity(
        organisation_id=seeded.organisation_id, name="Other Visible Billing"
    )
    hidden = Entity(organisation_id=seeded.organisation_id, name="Hidden Billing")
    session.add_all([accessible, readable_peer, hidden])
    session.flush()
    session.add_all(
        [
            UserEntityRole(
                user_id=settings.dev_user_id,
                entity_id=accessible.id,
                role=UserRole.viewer,
            ),
            UserEntityRole(
                user_id=settings.dev_user_id,
                entity_id=readable_peer.id,
                role=UserRole.viewer,
            ),
        ]
    )
    session.commit()
    _seed_entity_records(session, accessible, token="billing-filter-accessible")
    _seed_entity_records(session, readable_peer, token="billing-filter-peer")
    _seed_entity_records(session, hidden, token="billing-filter-hidden")

    accessible_property = session.scalar(
        select(Property).where(Property.entity_id == accessible.id)
    )
    hidden_property = session.scalar(select(Property).where(Property.entity_id == hidden.id))
    accessible_lease = session.scalar(
        select(Lease)
        .join(TenancyUnit, TenancyUnit.id == Lease.tenancy_unit_id)
        .join(Property, Property.id == TenancyUnit.property_id)
        .where(Property.entity_id == accessible.id)
    )
    hidden_lease = session.scalar(
        select(Lease)
        .join(TenancyUnit, TenancyUnit.id == Lease.tenancy_unit_id)
        .join(Property, Property.id == TenancyUnit.property_id)
        .where(Property.entity_id == hidden.id)
    )
    accessible_intake = session.scalar(
        select(DocumentIntake).where(DocumentIntake.entity_id == accessible.id)
    )
    readable_peer_intake = session.scalar(
        select(DocumentIntake).where(DocumentIntake.entity_id == readable_peer.id)
    )
    hidden_intake = session.scalar(
        select(DocumentIntake).where(DocumentIntake.entity_id == hidden.id)
    )
    assert accessible_property is not None
    assert hidden_property is not None
    assert accessible_lease is not None
    assert hidden_lease is not None
    assert accessible_intake is not None
    assert readable_peer_intake is not None
    assert hidden_intake is not None

    response = client.get(
        "/api/v1/billing-drafts",
        params={
            "entity_id": str(accessible.id),
            "document_intake_id": str(readable_peer_intake.id),
        },
    )
    assert response.status_code == 422

    response = client.get(
        "/api/v1/billing-drafts",
        params={
            "entity_id": str(accessible.id),
            "document_intake_id": str(hidden_intake.id),
        },
    )
    assert response.status_code == 403

    for params in (
        {"property_id": str(accessible_property.id)},
        {"lease_id": str(accessible_lease.id)},
        {"document_intake_id": str(accessible_intake.id)},
    ):
        response = client.get("/api/v1/billing-drafts", params=params)
        assert response.status_code == 200
        entity_ids = {row["entity_id"] for row in response.json()}
        assert entity_ids == {str(accessible.id)}

    for params in (
        {"property_id": str(hidden_property.id)},
        {"lease_id": str(hidden_lease.id)},
        {"document_intake_id": str(hidden_intake.id)},
    ):
        response = client.get("/api/v1/billing-drafts", params=params)
        assert response.status_code == 403


def test_org_wide_invoice_draft_filters_require_readable_billing_draft(
    client: TestClient,
    session: Session,
) -> None:
    settings = get_settings()
    seeded = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert seeded is not None

    accessible = Entity(organisation_id=seeded.organisation_id, name="Visible Invoices")
    readable_peer = Entity(
        organisation_id=seeded.organisation_id, name="Other Visible Invoices"
    )
    hidden = Entity(organisation_id=seeded.organisation_id, name="Hidden Invoices")
    session.add_all([accessible, readable_peer, hidden])
    session.flush()
    session.add_all(
        [
            UserEntityRole(
                user_id=settings.dev_user_id,
                entity_id=accessible.id,
                role=UserRole.viewer,
            ),
            UserEntityRole(
                user_id=settings.dev_user_id,
                entity_id=readable_peer.id,
                role=UserRole.viewer,
            ),
        ]
    )
    session.commit()
    _seed_entity_records(session, accessible, token="invoice-filter-accessible")
    _seed_entity_records(session, readable_peer, token="invoice-filter-peer")
    _seed_entity_records(session, hidden, token="invoice-filter-hidden")

    accessible_billing_draft = session.scalar(
        select(BillingDraft).where(BillingDraft.entity_id == accessible.id)
    )
    readable_peer_billing_draft = session.scalar(
        select(BillingDraft).where(BillingDraft.entity_id == readable_peer.id)
    )
    hidden_billing_draft = session.scalar(
        select(BillingDraft).where(BillingDraft.entity_id == hidden.id)
    )
    assert accessible_billing_draft is not None
    assert readable_peer_billing_draft is not None
    assert hidden_billing_draft is not None

    response = client.get(
        "/api/v1/invoice-drafts",
        params={"billing_draft_id": str(accessible_billing_draft.id)},
    )
    assert response.status_code == 200
    entity_ids = {row["entity_id"] for row in response.json()}
    assert entity_ids == {str(accessible.id)}

    response = client.get(
        "/api/v1/invoice-drafts",
        params={
            "entity_id": str(accessible.id),
            "billing_draft_id": str(readable_peer_billing_draft.id),
        },
    )
    assert response.status_code == 422

    response = client.get(
        "/api/v1/invoice-drafts",
        params={"billing_draft_id": str(hidden_billing_draft.id)},
    )
    assert response.status_code == 403
