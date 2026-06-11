"""Org-wide (no entity_id) scope on the all-entities fan-out list endpoints."""

from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import (
    DocumentCategory,
    DocumentIntake,
    Entity,
    Lease,
    LeaseStatus,
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
            DocumentIntake(entity_id=entity.id, document_id=document.id),
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
        "/api/v1/rent-roll",
        "/api/v1/obligations",
        "/api/v1/tenant-onboarding",
        "/api/v1/document-intakes",
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
        "/api/v1/rent-roll",
        "/api/v1/obligations",
        "/api/v1/tenant-onboarding",
        "/api/v1/document-intakes",
    ):
        response = client.get(path, params={"entity_id": str(hidden.id)})
        assert response.status_code == 403, path
