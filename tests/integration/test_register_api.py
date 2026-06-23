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
    XeroConnection,
)


def _entity_id(session: Session) -> str:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return str(entity.id)


def test_entity_type_and_managing_flag_round_trip(
    client: TestClient,
    session: Session,
) -> None:
    seed = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert seed is not None
    organisation_id = str(seed.organisation_id)

    create_response = client.post(
        "/api/v1/entities",
        json={
            "organisation_id": organisation_id,
            "name": "Northlakes Property Trust",
            "abn": "22 333 444 555",
            "entity_type": "trust",
        },
    )
    assert create_response.status_code == 201
    body = create_response.json()
    entity_id = body["id"]
    assert body["entity_type"] == "trust"
    assert body["is_managing_entity"] is None

    update_response = client.patch(
        f"/api/v1/entities/{entity_id}",
        json={"entity_type": "smsf", "is_managing_entity": True},
    )
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["entity_type"] == "smsf"
    assert updated["is_managing_entity"] is True

    list_response = client.get("/api/v1/entities")
    assert list_response.status_code == 200
    listed = {row["id"]: row for row in list_response.json()}
    assert listed[entity_id]["entity_type"] == "smsf"

    invalid_response = client.post(
        "/api/v1/entities",
        json={
            "organisation_id": organisation_id,
            "name": "Bad Type Co",
            "entity_type": "not_a_real_type",
        },
    )
    assert invalid_response.status_code == 422


def test_entities_xero_overview_reports_status_and_counts(
    client: TestClient,
    session: Session,
) -> None:
    seed = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert seed is not None
    organisation_id = str(seed.organisation_id)

    connected = client.post(
        "/api/v1/entities",
        json={"organisation_id": organisation_id, "name": "Aurora Trust", "entity_type": "trust"},
    ).json()
    expired = client.post(
        "/api/v1/entities",
        json={"organisation_id": organisation_id, "name": "Borealis Trust", "entity_type": "trust"},
    ).json()

    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": connected["id"],
            "name": "Aurora House",
            "street_address": "1 Aurora Street",
            "property_type": "residential",
        },
    )
    assert property_response.status_code == 201

    session.add(
        XeroConnection(
            entity_id=UUID(connected["id"]),
            xero_tenant_id="tenant-aurora",
            tenant_name="Aurora Org",
            access_token_ciphertext="x",
            refresh_token_ciphertext="y",
            token_expires_at=None,
        )
    )
    session.add(
        XeroConnection(
            entity_id=UUID(expired["id"]),
            xero_tenant_id="tenant-borealis",
            tenant_name="Borealis Org",
            access_token_ciphertext="x",
            refresh_token_ciphertext="y",
            token_expires_at=datetime(2020, 1, 1, tzinfo=UTC),
        )
    )
    session.commit()

    response = client.get("/api/v1/entities/xero-overview")
    assert response.status_code == 200
    body = response.json()
    rows = {row["name"]: row for row in body["entities"]}

    assert rows["Aurora Trust"]["xero_status"] == "connected"
    assert rows["Aurora Trust"]["property_count"] == 1
    assert rows["Aurora Trust"]["tenant_name"] == "Aurora Org"
    assert rows["Borealis Trust"]["xero_status"] == "token_expired"
    assert rows["Borealis Trust"]["property_count"] == 0

    summary = body["summary"]
    assert summary["total"] == len(body["entities"])
    assert (
        summary["connected"]
        + summary["token_expired"]
        + summary["manual"]
        + summary["not_connected"]
        == summary["total"]
    )
    assert summary["connected"] >= 1
    assert summary["token_expired"] >= 1


def test_entities_ownership_split_plan_groups_by_head_owner(
    client: TestClient,
    session: Session,
) -> None:
    seed = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert seed is not None
    entity_id = str(seed.id)

    def _make_property(name: str, owner_legal_name: str | None, **extra: object) -> None:
        payload = {
            "entity_id": entity_id,
            "name": name,
            "street_address": f"{name} Road",
            "suburb": "Brendale",
            "state": "QLD",
            "property_type": "commercial_office",
        }
        if owner_legal_name is not None:
            payload["owner_legal_name"] = owner_legal_name
        payload.update(extra)
        response = client.post("/api/v1/properties", json=payload)
        assert response.status_code == 201

    # Two properties owned by the same head trust; a chain whose head is that
    # same trust; one owned by a different trust; one with no owner label.
    _make_property("Leitchs B4", "GRHQ Pty Ltd")
    _make_property("Leitchs B6 U4", "GRHQ Pty Ltd -> SJI No 1 (sublet) -> Gorilla Removals")
    _make_property("Leitchs U1B3", "SJI No 1 Pty Ltd")
    _make_property("Leitchs U3B3", None)

    response = client.get("/api/v1/entities/ownership-split-plan")
    assert response.status_code == 200
    body = response.json()

    groups = {group["proposed_name"]: group for group in body["groups"]}
    assert groups["GRHQ Pty Ltd"]["property_count"] == 2
    assert groups["SJI No 1 Pty Ltd"]["property_count"] == 1
    assert body["unresolved_property_count"] == 1
    assert body["proposed_entity_count"] == 2


def test_entities_ownership_split_apply_moves_properties_and_clean_tenants(
    client: TestClient,
    session: Session,
) -> None:
    skj = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert skj is not None

    def make_property(name: str) -> str:
        response = client.post(
            "/api/v1/properties",
            json={
                "entity_id": str(skj.id),
                "name": name,
                "street_address": f"{name} Road",
                "property_type": "commercial_office",
            },
        )
        assert response.status_code == 201
        return response.json()["id"]

    property_a = make_property("Split Prop A")
    property_b = make_property("Split Prop B")
    property_c = make_property("Split Prop C")

    unit_a = TenancyUnit(property_id=UUID(property_a), unit_label="UA")
    unit_c = TenancyUnit(property_id=UUID(property_c), unit_label="UC")
    session.add_all([unit_a, unit_c])
    session.flush()

    tenant_a = Tenant(entity_id=skj.id, legal_name="Split Tenant A")
    tenant_c = Tenant(entity_id=skj.id, legal_name="Split Tenant C")
    tenant_x = Tenant(entity_id=skj.id, legal_name="Split Tenant X")
    session.add_all([tenant_a, tenant_c, tenant_x])
    session.flush()

    session.add_all(
        [
            Lease(tenancy_unit_id=unit_a.id, tenant_id=tenant_a.id),
            Lease(tenancy_unit_id=unit_c.id, tenant_id=tenant_c.id),
            Lease(tenancy_unit_id=unit_a.id, tenant_id=tenant_x.id),
            Lease(tenancy_unit_id=unit_c.id, tenant_id=tenant_x.id),
            Obligation(
                entity_id=skj.id,
                property_id=UUID(property_a),
                title="Insurance A",
                due_date=date(2026, 7, 1),
            ),
            Obligation(
                entity_id=skj.id,
                property_id=UUID(property_c),
                title="Insurance C",
                due_date=date(2026, 7, 1),
            ),
        ]
    )
    session.commit()

    body = {
        "groups": [
            {
                "proposed_name": "GRHQ Pty Ltd",
                "entity_type": "trust",
                "property_ids": [property_a, property_b],
            },
            {
                "proposed_name": "SJI No 1 Pty Ltd",
                "entity_type": "trust",
                "property_ids": [property_c],
            },
        ]
    }
    response = client.post("/api/v1/entities/ownership-split/apply", json=body)
    assert response.status_code == 201
    result = response.json()
    assert len(result["created_entities"]) == 2
    assert result["moved_property_count"] == 3
    assert result["moved_obligation_count"] == 2
    assert result["moved_tenant_count"] == 2
    assert result["flagged_tenant_count"] == 1

    session.expire_all()
    grhq = session.scalar(select(Entity).where(Entity.name == "GRHQ Pty Ltd"))
    sji = session.scalar(select(Entity).where(Entity.name == "SJI No 1 Pty Ltd"))
    assert grhq is not None and sji is not None
    assert session.get(Property, UUID(property_a)).entity_id == grhq.id
    assert session.get(Property, UUID(property_b)).entity_id == grhq.id
    assert session.get(Property, UUID(property_c)).entity_id == sji.id
    assert session.get(Tenant, tenant_a.id).entity_id == grhq.id
    assert session.get(Tenant, tenant_c.id).entity_id == sji.id
    # Tenant X leases span both new entities, so it is left in place, not moved.
    assert session.get(Tenant, tenant_x.id).entity_id == skj.id

    # Re-running the same apply is idempotent: nothing new is created or moved.
    repeat = client.post("/api/v1/entities/ownership-split/apply", json=body)
    assert repeat.status_code == 201
    repeat_result = repeat.json()
    assert repeat_result["created_entities"] == []
    assert repeat_result["moved_property_count"] == 0


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


def test_tenant_detail_handles_lease_activity_with_aware_timestamps(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)

    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Tenant Context Centre",
            "street_address": "90 Adelaide Street",
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
        json={"property_id": property_id, "unit_label": "Level 1"},
    )
    assert unit_response.status_code == 201
    unit_id = unit_response.json()["id"]

    tenant_response = client.post(
        "/api/v1/tenants",
        json={
            "entity_id": entity_id,
            "legal_name": "Aware Timestamp Tenant Pty Ltd",
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
            "annual_rent_cents": 7956700,
            "rent_frequency": "annual",
        },
    )
    assert lease_response.status_code == 201

    tenant = session.get(Tenant, UUID(tenant_id))
    assert tenant is not None
    tenant.created_at = datetime(2026, 1, 2, 8, 0, tzinfo=UTC)
    tenant.updated_at = tenant.created_at
    session.flush()

    detail_response = client.get(f"/api/v1/tenants/{tenant_id}/detail")

    assert detail_response.status_code == 200
    body = detail_response.json()
    assert body["leases"][0]["property_name"] == "Tenant Context Centre"
    assert "Lease active" in [item["label"] for item in body["activity"]]


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


def test_lease_event_follow_up_run_skips_unique_race_duplicates(
    client: TestClient,
    session: Session,
    monkeypatch: Any,
) -> None:
    from apps.api.routers import obligations as obligations_router

    entity_id = _entity_id(session)

    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Race Duplicate Calendar Centre",
            "street_address": "8 Creek Street",
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
        json={"property_id": property_id, "unit_label": "Level 8"},
    )
    assert unit_response.status_code == 201
    unit_id = unit_response.json()["id"]

    tenant_response = client.post(
        "/api/v1/tenants",
        json={"entity_id": entity_id, "legal_name": "Race Tenant Pty Ltd"},
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
            "expiry_date": "2027-06-30",
            "annual_rent_cents": 1200000,
            "rent_frequency": "annual",
            "next_review_date": "2026-06-18",
        },
    )
    assert lease_response.status_code == 201
    lease_id = lease_response.json()["id"]

    existing = Obligation(
        entity_id=UUID(entity_id),
        property_id=UUID(property_id),
        tenancy_unit_id=UUID(unit_id),
        lease_id=UUID(lease_id),
        title="Existing race lease follow-up",
        category="rent_review",
        status="upcoming",
        due_date=date(2026, 6, 18),
        priority=1,
        owner_role="ops",
        obligation_metadata={"source": "lease_calendar_follow_up"},
    )
    session.add(existing)
    session.commit()

    real_existing = obligations_router._existing_lease_event_obligation
    existing_checks = 0

    def stale_existing_once(**kwargs: Any) -> Obligation | None:
        nonlocal existing_checks
        existing_checks += 1
        if existing_checks == 1:
            return None
        return real_existing(**kwargs)

    monkeypatch.setattr(
        obligations_router,
        "_existing_lease_event_obligation",
        stale_existing_once,
    )

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
    assert body["skipped_count"] == 1
    assert body["skipped"][0]["obligation_id"] == str(existing.id)

    duplicates = session.scalars(
        select(Obligation)
        .where(Obligation.lease_id == UUID(lease_id))
        .where(Obligation.category == "rent_review")
        .where(Obligation.due_date == date(2026, 6, 18))
        .where(Obligation.deleted_at.is_(None))
    ).all()
    assert [row.id for row in duplicates] == [existing.id]


def test_deleting_tenant_cascades_lease_and_clears_rent_roll(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    property_id = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Reload Arcade",
            "street_address": "1 Reload Way",
            "suburb": "Brisbane City",
            "state": "QLD",
            "postcode": "4000",
            "property_type": "commercial_retail",
        },
    ).json()["id"]
    unit_id = client.post(
        "/api/v1/tenancy-units",
        json={"property_id": property_id, "unit_label": "Shop 9", "sqm": 80},
    ).json()["id"]
    tenant_id = client.post(
        "/api/v1/tenants",
        json={"entity_id": entity_id, "legal_name": "Ghost Pty Ltd"},
    ).json()["id"]
    lease_id = client.post(
        "/api/v1/leases",
        json={
            "tenancy_unit_id": unit_id,
            "tenant_id": tenant_id,
            "status": "active",
            "commencement_date": "2026-01-01",
            "expiry_date": "2028-12-31",
            "annual_rent_cents": 1140000_00,
            "rent_frequency": "monthly",
        },
    ).json()["id"]

    before = client.get(
        f"/api/v1/rent-roll?entity_id={entity_id}&property_id={property_id}"
    ).json()
    assert len(before) == 1
    assert before[0]["tenant_id"] == tenant_id
    assert before[0]["lease_id"] == lease_id

    # Deleting the tenant cascades to its lease so nothing is orphaned.
    assert client.delete(f"/api/v1/tenants/{tenant_id}").status_code == 204
    lease = session.get(Lease, UUID(lease_id))
    assert lease is not None and lease.deleted_at is not None

    # The unit now reads as vacant — no ghost tenant, no orphaned lease/rent.
    after = client.get(
        f"/api/v1/rent-roll?entity_id={entity_id}&property_id={property_id}"
    ).json()
    assert len(after) == 1
    assert after[0]["tenant_id"] is None
    assert after[0]["tenant_name"] is None
    assert after[0]["lease_id"] is None
    assert after[0]["annual_rent_cents"] is None


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

    void_billing_draft_response = client.patch(
        f"/api/v1/billing-drafts/{billing_draft['id']}",
        json={"status": "void"},
    )
    assert void_billing_draft_response.status_code == 200
    assert void_billing_draft_response.json()["status"] == "void"

    recreate_billing_batch_response = client.post(
        "/api/v1/billing-drafts/from-charge-rules",
        json={"entity_id": entity_id, "lease_ids": [lease_id], "as_of": "2026-06-01"},
    )
    assert recreate_billing_batch_response.status_code == 200
    recreate_billing_batch = recreate_billing_batch_response.json()
    assert recreate_billing_batch["created"] == 1
    assert recreate_billing_batch["existing"] == 0
    recreated_billing_draft = recreate_billing_batch["drafts"][0]
    assert recreated_billing_draft["id"] != billing_draft["id"]
    assert recreated_billing_draft["status"] == "needs_review"
    assert recreated_billing_draft["total_cents"] == 1100000

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
