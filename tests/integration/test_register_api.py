"""Register API integration tests using a real app and database session."""

from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import (
    AuditAction,
    Entity,
    Lease,
    Obligation,
    Property,
    RentChargeRule,
    TenancyUnit,
    Tenant,
)


def _entity_id(session: Session) -> str:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return str(entity.id)


def test_property_crud_writes_audit_and_filters_soft_deleted(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)

    create_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Building 4 Northlakes",
            "street_address": "1 Example Drive",
            "suburb": "North Lakes",
            "state": "QLD",
            "postcode": "4509",
            "property_type": "commercial_office",
            "building_sqm": 1200,
            "parking_spaces": 24,
            "ownership_structure": "trust",
            "owner_legal_name": "Northlakes Property Trust",
            "owner_abn": "22 333 444 555",
            "trustee_name": "Northlakes Trustee Pty Ltd",
            "trust_name": "Northlakes Property Trust",
            "invoice_issuer_name": "Northlakes Trustee Pty Ltd",
            "billing_contact_name": "Morgan Finance",
            "billing_email": "accounts@northlakes.example",
            "invoice_reference": "NL-",
            "ownership_split": "100% Northlakes Property Trust",
            "owner_gst_registered": True,
            "xero_contact_id": "xero-owner-1",
            "xero_tracking_category": "Northlakes",
            "metadata": {"source": "test"},
        },
    )
    assert create_response.status_code == 201
    create_body = create_response.json()
    property_id = create_body["id"]
    assert create_body["owner_legal_name"] == "Northlakes Property Trust"
    assert create_body["owner_gst_registered"] is True
    assert create_body["xero_tracking_category"] == "Northlakes"

    update_response = client.patch(
        f"/api/v1/properties/{property_id}",
        json={"name": "B4 Northlakes", "billing_email": "billing@northlakes.example"},
    )
    assert update_response.status_code == 200
    update_body = update_response.json()
    assert update_body["name"] == "B4 Northlakes"
    assert update_body["billing_email"] == "billing@northlakes.example"
    assert update_body["owner_legal_name"] == "Northlakes Property Trust"

    list_response = client.get(f"/api/v1/properties?entity_id={entity_id}")
    assert list_response.status_code == 200
    assert len(list_response.json()) == 1
    assert list_response.json()[0]["billing_email"] == "billing@northlakes.example"
    alias_list_response = client.get(f"/api/v1/premises?entity_id={entity_id}")
    assert alias_list_response.status_code == 200
    assert alias_list_response.json() == list_response.json()
    path_alias_response = client.get(f"/api/v1/premises/by-entity/{entity_id}")
    assert path_alias_response.status_code == 200
    assert path_alias_response.json() == list_response.json()

    delete_response = client.delete(f"/api/v1/properties/{property_id}")
    assert delete_response.status_code == 204

    filtered_response = client.get(f"/api/v1/properties?entity_id={entity_id}")
    assert filtered_response.status_code == 200
    assert filtered_response.json() == []

    audit_rows = session.scalars(
        select(AuditAction).where(AuditAction.target_table == "property")
    ).all()
    assert [row.action for row in audit_rows] == ["create", "update", "delete"]


def test_tenancy_unit_crud_inherits_property_scope(client: TestClient, session: Session) -> None:
    entity_id = _entity_id(session)
    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Vine Street Commercial",
            "street_address": "138 Vine Street",
            "suburb": "Fortitude Valley",
            "state": "QLD",
            "postcode": "4006",
            "property_type": "commercial_retail",
        },
    )
    assert property_response.status_code == 201
    property_id = property_response.json()["id"]

    create_response = client.post(
        "/api/v1/tenancy-units",
        json={"property_id": property_id, "unit_label": "138 sqm tenancy", "sqm": 138},
    )
    assert create_response.status_code == 201
    unit_id = create_response.json()["id"]

    list_response = client.get(f"/api/v1/tenancy-units?property_id={property_id}")
    assert list_response.status_code == 200
    assert len(list_response.json()) == 1

    delete_response = client.delete(f"/api/v1/tenancy-units/{unit_id}")
    assert delete_response.status_code == 204

    filtered_response = client.get(f"/api/v1/tenancy-units?property_id={property_id}")
    assert filtered_response.status_code == 200
    assert filtered_response.json() == []

    assert session.scalar(select(Property).where(Property.id == UUID(property_id))) is not None
    assert session.scalar(select(TenancyUnit).where(TenancyUnit.id == UUID(unit_id))) is not None


def test_tenant_crud_writes_audit_and_filters_soft_deleted(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)

    create_response = client.post(
        "/api/v1/tenants",
        json={
            "entity_id": entity_id,
            "legal_name": "Valley Espresso Pty Ltd",
            "trading_name": "Valley Espresso",
            "abn": "11 222 333 444",
            "contact_name": "Jordan Lee",
            "contact_email": "jordan@exampletenant.com.au",
            "billing_email": "accounts@exampletenant.com.au",
            "metadata": {"source": "test"},
        },
    )
    assert create_response.status_code == 201
    tenant_id = create_response.json()["id"]

    update_response = client.patch(
        f"/api/v1/tenants/{tenant_id}", json={"contact_phone": "+61 7 3000 0000"}
    )
    assert update_response.status_code == 200
    assert update_response.json()["contact_phone"] == "+61 7 3000 0000"

    list_response = client.get(f"/api/v1/tenants?entity_id={entity_id}")
    assert list_response.status_code == 200
    assert len(list_response.json()) == 1

    delete_response = client.delete(f"/api/v1/tenants/{tenant_id}")
    assert delete_response.status_code == 204

    filtered_response = client.get(f"/api/v1/tenants?entity_id={entity_id}")
    assert filtered_response.status_code == 200
    assert filtered_response.json() == []

    audit_rows = session.scalars(
        select(AuditAction).where(AuditAction.target_table == "tenant")
    ).all()
    assert [row.action for row in audit_rows] == ["create", "update", "delete"]
    assert session.scalar(select(Tenant).where(Tenant.id == UUID(tenant_id))) is not None


def test_tenant_detail_ignores_invalid_legacy_review_source_id(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)

    create_response = client.post(
        "/api/v1/tenants",
        json={
            "entity_id": entity_id,
            "legal_name": "Legacy Review Tenant Pty Ltd",
            "metadata": {
                "reviewed_change_history": [
                    {
                        "source": "tenant_onboarding",
                        "tenant_onboarding_id": "legacy-import-row",
                        "status": "applied",
                        "applied_at": "2026-05-31T09:30:00+00:00",
                        "changes": [
                            {
                                "field": "contact_email",
                                "label": "Contact email",
                                "before": "old@example.test",
                                "after": "new@example.test",
                            }
                        ],
                    }
                ]
            },
        },
    )
    assert create_response.status_code == 201
    tenant_id = create_response.json()["id"]

    detail_response = client.get(f"/api/v1/tenants/{tenant_id}/detail")

    assert detail_response.status_code == 200
    reviewed_change = detail_response.json()["reviewed_changes"][0]
    assert reviewed_change["source_id"] is None
    assert reviewed_change["changes"][0]["after"] == "new@example.test"


def test_lease_crud_inherits_unit_property_and_tenant_scope(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Queen Street Retail",
            "street_address": "12 Queen Street",
            "suburb": "Brisbane City",
            "state": "QLD",
            "postcode": "4000",
            "property_type": "commercial_retail",
        },
    )
    assert property_response.status_code == 201
    property_id = property_response.json()["id"]

    unit_response = client.post(
        "/api/v1/tenancy-units",
        json={"property_id": property_id, "unit_label": "Shop 1", "sqm": 92},
    )
    assert unit_response.status_code == 201
    unit_id = unit_response.json()["id"]

    tenant_response = client.post(
        "/api/v1/tenants",
        json={
            "entity_id": entity_id,
            "legal_name": "Queen Street Books Pty Ltd",
            "trading_name": "Queen Street Books",
        },
    )
    assert tenant_response.status_code == 201
    tenant_id = tenant_response.json()["id"]

    create_response = client.post(
        "/api/v1/leases",
        json={
            "tenancy_unit_id": unit_id,
            "tenant_id": tenant_id,
            "status": "active",
            "commencement_date": "2026-01-01",
            "expiry_date": "2028-12-31",
            "annual_rent_cents": 12000000,
            "rent_frequency": "annual",
            "outgoings_recoverable": True,
            "next_review_date": "2027-01-01",
            "option_summary": "One 3-year option.",
            "security_summary": "3 months bank guarantee.",
            "metadata": {"source": "test"},
        },
    )
    assert create_response.status_code == 201
    lease_body = create_response.json()
    lease_id = lease_body["id"]
    assert lease_body["status"] == "active"
    assert lease_body["annual_rent_cents"] == 12000000

    by_entity_response = client.get(f"/api/v1/leases?entity_id={entity_id}")
    assert by_entity_response.status_code == 200
    assert len(by_entity_response.json()) == 1

    by_property_response = client.get(f"/api/v1/leases?property_id={property_id}")
    assert by_property_response.status_code == 200
    assert by_property_response.json()[0]["id"] == lease_id

    by_unit_response = client.get(f"/api/v1/leases?tenancy_unit_id={unit_id}")
    assert by_unit_response.status_code == 200
    assert by_unit_response.json()[0]["id"] == lease_id

    by_unit_alias_response = client.get(f"/api/v1/leases?unit_id={unit_id}")
    assert by_unit_alias_response.status_code == 200
    assert by_unit_alias_response.json()[0]["id"] == lease_id

    update_response = client.patch(
        f"/api/v1/leases/{lease_id}", json={"status": "holding_over", "notes": "Review needed."}
    )
    assert update_response.status_code == 200
    assert update_response.json()["status"] == "holding_over"

    delete_response = client.delete(f"/api/v1/leases/{lease_id}")
    assert delete_response.status_code == 204

    filtered_response = client.get(f"/api/v1/leases?entity_id={entity_id}")
    assert filtered_response.status_code == 200
    assert filtered_response.json() == []

    audit_rows = session.scalars(
        select(AuditAction).where(AuditAction.target_table == "lease")
    ).all()
    assert [row.action for row in audit_rows] == ["create", "update", "delete"]
    assert session.scalar(select(Lease).where(Lease.id == UUID(lease_id))) is not None


def test_obligation_crud_filters_scope_and_writes_audit(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Edward Street Office",
            "street_address": "44 Edward Street",
            "suburb": "Brisbane City",
            "state": "QLD",
            "postcode": "4000",
            "property_type": "commercial_office",
        },
    )
    assert property_response.status_code == 201
    property_id = property_response.json()["id"]

    unit_response = client.post(
        "/api/v1/tenancy-units",
        json={"property_id": property_id, "unit_label": "Level 3", "sqm": 320},
    )
    assert unit_response.status_code == 201
    unit_id = unit_response.json()["id"]

    tenant_response = client.post(
        "/api/v1/tenants",
        json={"entity_id": entity_id, "legal_name": "Edward Street Legal Pty Ltd"},
    )
    assert tenant_response.status_code == 201
    tenant_id = tenant_response.json()["id"]

    lease_response = client.post(
        "/api/v1/leases",
        json={
            "tenancy_unit_id": unit_id,
            "tenant_id": tenant_id,
            "status": "active",
            "commencement_date": "2026-02-01",
            "expiry_date": "2029-01-31",
            "next_review_date": "2027-02-01",
        },
    )
    assert lease_response.status_code == 201
    lease_id = lease_response.json()["id"]

    create_response = client.post(
        "/api/v1/obligations",
        json={
            "entity_id": entity_id,
            "lease_id": lease_id,
            "title": "Rent review notice",
            "category": "rent_review",
            "status": "upcoming",
            "due_date": "2027-02-01",
            "priority": 1,
            "owner_role": "finance",
            "metadata": {"source": "test"},
        },
    )
    assert create_response.status_code == 201
    obligation_body = create_response.json()
    obligation_id = obligation_body["id"]
    assert obligation_body["property_id"] == property_id
    assert obligation_body["tenancy_unit_id"] == unit_id
    assert obligation_body["metadata"] == {"source": "test"}

    by_entity_response = client.get(
        f"/api/v1/obligations?entity_id={entity_id}&status=upcoming&category=rent_review"
    )
    assert by_entity_response.status_code == 200
    assert [row["id"] for row in by_entity_response.json()] == [obligation_id]

    by_property_response = client.get(f"/api/v1/obligations?property_id={property_id}")
    assert by_property_response.status_code == 200
    assert by_property_response.json()[0]["id"] == obligation_id

    by_lease_response = client.get(f"/api/v1/obligations?lease_id={lease_id}")
    assert by_lease_response.status_code == 200
    assert by_lease_response.json()[0]["id"] == obligation_id

    update_response = client.patch(
        f"/api/v1/obligations/{obligation_id}",
        json={"status": "completed", "completed_at": "2027-01-15T02:00:00Z"},
    )
    assert update_response.status_code == 200
    assert update_response.json()["status"] == "completed"

    delete_response = client.delete(f"/api/v1/obligations/{obligation_id}")
    assert delete_response.status_code == 204

    filtered_response = client.get(f"/api/v1/obligations?entity_id={entity_id}")
    assert filtered_response.status_code == 200
    assert filtered_response.json() == []

    audit_rows = session.scalars(
        select(AuditAction).where(AuditAction.target_table == "obligation")
    ).all()
    assert [row.action for row in audit_rows] == ["create", "update", "delete"]
    assert (
        session.scalar(select(Obligation).where(Obligation.id == UUID(obligation_id))) is not None
    )


def test_lease_event_follow_up_run_creates_missing_obligations_without_duplicates(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    as_of = date(2026, 6, 2)

    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Calendar Follow Up Centre",
            "street_address": "20 Eagle Street",
            "suburb": "Brisbane City",
            "state": "QLD",
            "postcode": "4000",
            "property_type": "commercial_retail",
        },
    )
    assert property_response.status_code == 201
    property_id = property_response.json()["id"]

    other_property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Outside Calendar Centre",
            "street_address": "44 Creek Street",
            "suburb": "Brisbane City",
            "state": "QLD",
            "postcode": "4000",
            "property_type": "commercial_office",
        },
    )
    assert other_property_response.status_code == 201
    other_property_id = other_property_response.json()["id"]

    unit_response = client.post(
        "/api/v1/tenancy-units",
        json={"property_id": property_id, "unit_label": "Shop 4"},
    )
    assert unit_response.status_code == 201
    unit_id = unit_response.json()["id"]

    other_unit_response = client.post(
        "/api/v1/tenancy-units",
        json={"property_id": other_property_id, "unit_label": "Suite 9"},
    )
    assert other_unit_response.status_code == 201
    other_unit_id = other_unit_response.json()["id"]

    tenant_response = client.post(
        "/api/v1/tenants",
        json={"entity_id": entity_id, "legal_name": "Calendar Tenant Pty Ltd"},
    )
    assert tenant_response.status_code == 201
    tenant_id = tenant_response.json()["id"]

    other_tenant_response = client.post(
        "/api/v1/tenants",
        json={"entity_id": entity_id, "legal_name": "Outside Tenant Pty Ltd"},
    )
    assert other_tenant_response.status_code == 201
    other_tenant_id = other_tenant_response.json()["id"]

    lease_response = client.post(
        "/api/v1/leases",
        json={
            "tenancy_unit_id": unit_id,
            "tenant_id": tenant_id,
            "status": "active",
            "commencement_date": "2024-07-01",
            "expiry_date": "2026-08-15",
            "annual_rent_cents": 1200000,
            "rent_frequency": "annual",
            "next_review_date": "2026-06-18",
        },
    )
    assert lease_response.status_code == 201
    lease_id = lease_response.json()["id"]

    other_lease_response = client.post(
        "/api/v1/leases",
        json={
            "tenancy_unit_id": other_unit_id,
            "tenant_id": other_tenant_id,
            "status": "active",
            "commencement_date": "2024-07-01",
            "expiry_date": "2026-07-30",
            "annual_rent_cents": 900000,
            "rent_frequency": "annual",
            "next_review_date": "2026-06-12",
        },
    )
    assert other_lease_response.status_code == 201

    existing_response = client.post(
        "/api/v1/obligations",
        json={
            "entity_id": entity_id,
            "lease_id": lease_id,
            "title": "Existing lease expiry follow-up",
            "category": "lease_expiry",
            "status": "upcoming",
            "due_date": "2026-08-15",
            "priority": 1,
            "owner_role": "ops",
            "metadata": {"source": "manual"},
        },
    )
    assert existing_response.status_code == 201
    existing_obligation_id = existing_response.json()["id"]

    response = client.post(
        "/api/v1/obligations/lease-event-follow-ups",
        json={
            "entity_id": entity_id,
            "property_ids": [property_id],
            "as_of": as_of.isoformat(),
            "horizon_days": 90,
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["created_count"] == 1
    assert body["skipped_count"] == 1
    assert body["guardrails"] == [
        "Lease calendar follow-up creation only creates internal obligation tasks.",
        (
            "It does not send email or SMS, dispatch providers, post invoices, sync Xero/Basiq, "
            "reconcile payments, or mutate leases."
        ),
    ]
    created = body["created"][0]
    assert created["lease_id"] == lease_id
    assert created["property_id"] == property_id
    assert created["tenancy_unit_id"] == unit_id
    assert created["category"] == "rent_review"
    assert created["due_date"] == "2026-06-18"
    assert created["status"] == "due_soon"
    assert created["priority"] == 1
    assert created["owner_role"] == "ops"
    assert created["metadata"]["source"] == "lease_calendar_follow_up"
    assert created["metadata"]["source_event"] == "rent_review"
    assert created["metadata"]["source_lease_id"] == lease_id
    assert body["skipped"][0]["reason"] == "existing_obligation"
    assert body["skipped"][0]["obligation_id"] == existing_obligation_id

    repeat_response = client.post(
        "/api/v1/obligations/lease-event-follow-ups",
        json={
            "entity_id": entity_id,
            "property_ids": [property_id],
            "as_of": as_of.isoformat(),
            "horizon_days": 90,
        },
    )
    assert repeat_response.status_code == 201
    repeat_body = repeat_response.json()
    assert repeat_body["created_count"] == 0
    assert repeat_body["skipped_count"] == 2

    obligations = session.scalars(
        select(Obligation)
        .where(Obligation.entity_id == UUID(entity_id))
        .where(Obligation.deleted_at.is_(None))
        .order_by(Obligation.due_date)
    ).all()
    assert [(row.category.value, row.due_date.isoformat()) for row in obligations] == [
        ("rent_review", "2026-06-18"),
        ("lease_expiry", "2026-08-15"),
    ]


def test_lease_event_follow_up_run_skips_deleted_tenants(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)

    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Deleted Tenant Calendar Centre",
            "street_address": "5 Queen Street",
            "suburb": "Brisbane City",
            "state": "QLD",
            "postcode": "4000",
            "property_type": "commercial_office",
        },
    )
    assert property_response.status_code == 201
    property_id = property_response.json()["id"]

    unit_response = client.post(
        "/api/v1/tenancy-units",
        json={"property_id": property_id, "unit_label": "Level 3"},
    )
    assert unit_response.status_code == 201
    unit_id = unit_response.json()["id"]

    tenant_response = client.post(
        "/api/v1/tenants",
        json={"entity_id": entity_id, "legal_name": "Deleted Calendar Tenant Pty Ltd"},
    )
    assert tenant_response.status_code == 201
    tenant_id = tenant_response.json()["id"]

    lease_response = client.post(
        "/api/v1/leases",
        json={
            "tenancy_unit_id": unit_id,
            "tenant_id": tenant_id,
            "status": "active",
            "commencement_date": "2024-07-01",
            "expiry_date": "2026-08-15",
            "annual_rent_cents": 1200000,
            "rent_frequency": "annual",
            "next_review_date": "2026-06-18",
        },
    )
    assert lease_response.status_code == 201

    tenant = session.get(Tenant, UUID(tenant_id))
    assert tenant is not None
    tenant.deleted_at = datetime.now(UTC)
    session.commit()

    response = client.post(
        "/api/v1/obligations/lease-event-follow-ups",
        json={
            "entity_id": entity_id,
            "property_ids": [property_id],
            "as_of": "2026-06-02",
            "horizon_days": 90,
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["created_count"] == 0
    assert body["skipped_count"] == 0
    assert (
        session.scalar(
            select(Obligation)
            .where(Obligation.property_id == UUID(property_id))
            .where(Obligation.deleted_at.is_(None))
        )
        is None
    )


def test_charge_rules_and_rent_roll_surface_billing_readiness(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Billing Arcade",
            "street_address": "9 Billing Lane",
            "suburb": "Brisbane City",
            "state": "QLD",
            "postcode": "4000",
            "property_type": "commercial_retail",
        },
    )
    assert property_response.status_code == 201
    property_id = property_response.json()["id"]

    unit_response = client.post(
        "/api/v1/tenancy-units",
        json={"property_id": property_id, "unit_label": "Shop 5", "sqm": 95},
    )
    assert unit_response.status_code == 201
    unit_id = unit_response.json()["id"]

    tenant_response = client.post(
        "/api/v1/tenants",
        json={
            "entity_id": entity_id,
            "legal_name": "Billing Coffee Pty Ltd",
            "trading_name": "Billing Coffee",
            "billing_email": "accounts@billing.example",
        },
    )
    assert tenant_response.status_code == 201
    tenant_id = tenant_response.json()["id"]

    lease_response = client.post(
        "/api/v1/leases",
        json={
            "tenancy_unit_id": unit_id,
            "tenant_id": tenant_id,
            "status": "active",
            "commencement_date": "2026-01-01",
            "expiry_date": "2028-12-31",
            "next_review_date": "2027-01-01",
            "annual_rent_cents": 13200000,
            "rent_frequency": "annual",
        },
    )
    assert lease_response.status_code == 201
    lease_id = lease_response.json()["id"]

    create_response = client.post(
        "/api/v1/charge-rules",
        json={
            "lease_id": lease_id,
            "charge_type": "base_rent",
            "amount_cents": 1100000,
            "frequency": "monthly",
            "gst_treatment": "taxable",
            "xero_account_code": "200",
            "xero_tax_type": "OUTPUT",
            "next_due_date": "2026-06-01",
            "metadata": {"source": "test"},
        },
    )
    assert create_response.status_code == 201
    charge_rule_body = create_response.json()
    charge_rule_id = charge_rule_body["id"]
    assert charge_rule_body["metadata"] == {"source": "test"}

    list_response = client.get(f"/api/v1/charge-rules?property_id={property_id}")
    assert list_response.status_code == 200
    assert [row["id"] for row in list_response.json()] == [charge_rule_id]

    rent_roll_response = client.get(
        f"/api/v1/rent-roll?entity_id={entity_id}&property_id={property_id}&as_of=2026-05-18"
    )
    assert rent_roll_response.status_code == 200
    rent_roll_body = rent_roll_response.json()
    assert len(rent_roll_body) == 1
    assert rent_roll_body[0]["tenant_name"] == "Billing Coffee"
    assert rent_roll_body[0]["expiry_date"] == "2028-12-31"
    assert rent_roll_body[0]["next_review_date"] == "2027-01-01"
    assert rent_roll_body[0]["charge_rules_total_cents"] == 1100000
    assert rent_roll_body[0]["next_due_date"] == "2026-06-01"
    assert rent_roll_body[0]["invoice_readiness_blockers"] == []
    assert rent_roll_body[0]["xero_readiness_blockers"] == [
        "Entity is not connected to Xero."
    ]

    billing_batch_response = client.post(
        "/api/v1/billing-drafts/from-charge-rules",
        json={"entity_id": entity_id, "lease_ids": [lease_id], "as_of": "2026-06-01"},
    )
    assert billing_batch_response.status_code == 200
    billing_batch = billing_batch_response.json()
    assert billing_batch["created"] == 1
    assert billing_batch["existing"] == 0
    assert billing_batch["skipped"] == 0
    billing_draft = billing_batch["drafts"][0]
    assert billing_draft["status"] == "needs_review"
    assert billing_draft["total_cents"] == 1100000
    assert billing_draft["document_id"]
    assert billing_draft["metadata"]["source"] == "charge_rule_batch"
    assert billing_draft["metadata"]["guardrail"].startswith("No invoice PDF")
    assert billing_draft["lines"][0]["source_hint"] == "test"

    repeat_billing_batch_response = client.post(
        "/api/v1/billing-drafts/from-charge-rules",
        json={"entity_id": entity_id, "lease_ids": [lease_id], "as_of": "2026-06-01"},
    )
    assert repeat_billing_batch_response.status_code == 200
    repeat_billing_batch = repeat_billing_batch_response.json()
    assert repeat_billing_batch["created"] == 0
    assert repeat_billing_batch["existing"] == 1
    assert repeat_billing_batch["drafts"][0]["id"] == billing_draft["id"]

    update_response = client.patch(
        f"/api/v1/charge-rules/{charge_rule_id}",
        json={"amount_cents": 1200000, "xero_tax_type": None},
    )
    assert update_response.status_code == 200
    assert update_response.json()["amount_cents"] == 1200000

    delete_response = client.delete(f"/api/v1/charge-rules/{charge_rule_id}")
    assert delete_response.status_code == 204

    filtered_response = client.get(f"/api/v1/charge-rules?lease_id={lease_id}")
    assert filtered_response.status_code == 200
    assert filtered_response.json() == []

    audit_rows = session.scalars(
        select(AuditAction).where(AuditAction.target_table == "rent_charge_rule")
    ).all()
    assert [row.action for row in audit_rows] == ["create", "update", "delete"]
    assert (
        session.scalar(select(RentChargeRule).where(RentChargeRule.id == UUID(charge_rule_id)))
        is not None
    )


def test_lease_intake_upload_and_apply_creates_register_records(
    client: TestClient,
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    entity_id = _entity_id(session)

    extracted = {
        "property": {
            "name": "Lease Intake Arcade",
            "street_address": "77 Intake Street",
            "suburb": "Brisbane City",
            "state": "QLD",
            "postcode": "4000",
            "country_code": "AU",
            "property_type": "commercial_retail",
            "parcel_id": None,
            "land_sqm": None,
            "building_sqm": 250,
            "parking_spaces": None,
        },
        "tenancy_unit": {"unit_label": "Shop 4", "sqm": 84, "parking_spaces": 1},
        "tenant": {
            "legal_name": "Intake Retail Pty Ltd",
            "trading_name": "Intake Retail",
            "abn": "12 345 678 901",
            "contact_name": "Alex Lease",
            "contact_email": "alex@exampletenant.com.au",
            "contact_phone": None,
            "billing_email": "accounts@exampletenant.com.au",
        },
        "lease": {
            "status": "active",
            "commencement_date": "2026-07-01",
            "expiry_date": "2029-06-30",
            "annual_rent_cents": 9600000,
            "rent_frequency": "monthly",
            "outgoings_recoverable": True,
            "next_review_date": "2027-07-01",
            "option_summary": "One 3-year option.",
            "security_summary": "Bank guarantee equal to 3 months rent.",
            "notes": "Imported from lease intake.",
        },
        "obligations": [
            {
                "title": "Insurance certificate",
                "category": "insurance",
                "due_date": "2026-07-01",
                "priority": 2,
                "owner_role": "ops",
                "notes": "Tenant to provide before possession.",
            }
        ],
        "warnings": [],
    }

    def fake_extract_lease_file(**_: object) -> tuple[dict[str, Any], str]:
        return extracted, "resp_test"

    monkeypatch.setattr(
        "apps.api.routers.lease_intakes.extract_lease_file",
        fake_extract_lease_file,
    )

    upload_response = client.post(
        "/api/v1/lease-intakes",
        data={"entity_id": entity_id},
        files={"file": ("lease.txt", b"Lease text", "text/plain")},
    )
    assert upload_response.status_code == 201
    intake_body = upload_response.json()
    intake_id = intake_body["id"]
    assert intake_body["status"] == "uploaded"
    assert intake_body["file_name"] == "lease.txt"

    get_response = client.get(f"/api/v1/lease-intakes/{intake_id}")
    assert get_response.status_code == 200
    assert get_response.json()["status"] == "extracted"
    assert get_response.json()["extracted_data"]["tenant"]["legal_name"] == "Intake Retail Pty Ltd"

    apply_response = client.post(f"/api/v1/lease-intakes/{intake_id}/apply", json={})
    assert apply_response.status_code == 200
    apply_body = apply_response.json()
    assert apply_body["status"] == "applied"
    assert apply_body["applied_lease_id"] is not None

    lease = session.get(Lease, UUID(apply_body["applied_lease_id"]))
    assert lease is not None
    assert lease.annual_rent_cents == 9600000
    assert lease.rent_frequency == "monthly"

    tenant = session.get(Tenant, lease.tenant_id)
    assert tenant is not None
    assert tenant.legal_name == "Intake Retail Pty Ltd"

    obligations = session.scalars(
        select(Obligation).where(Obligation.lease_id == lease.id)
    ).all()
    assert {row.title for row in obligations} == {
        "Insurance certificate",
        "Rent review",
        "Lease expiry",
    }


def test_lease_create_rejects_tenant_from_different_entity(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Mismatch Test Property",
            "street_address": "1 Boundary Road",
            "property_type": "commercial_office",
        },
    )
    assert property_response.status_code == 201
    unit_response = client.post(
        "/api/v1/tenancy-units",
        json={"property_id": property_response.json()["id"], "unit_label": "Suite 2"},
    )
    assert unit_response.status_code == 201

    entity_response = client.post(
        "/api/v1/entities",
        json={
            "organisation_id": str(session.scalar(select(Entity.organisation_id))),
            "name": "Second Property Entity Pty Ltd",
        },
    )
    assert entity_response.status_code == 201
    other_entity_id = entity_response.json()["id"]
    tenant_response = client.post(
        "/api/v1/tenants",
        json={"entity_id": other_entity_id, "legal_name": "Other Entity Tenant Pty Ltd"},
    )
    assert tenant_response.status_code == 201

    create_response = client.post(
        "/api/v1/leases",
        json={
            "tenancy_unit_id": unit_response.json()["id"],
            "tenant_id": tenant_response.json()["id"],
        },
    )
    assert create_response.status_code == 422
