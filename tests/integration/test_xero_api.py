"""Xero readiness API integration tests."""

from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import AuditAction, Entity


def _entity_id(session: Session) -> str:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return str(entity.id)


def test_xero_status_surfaces_mapping_gaps_and_manual_connection(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Queen Street Retail",
            "street_address": "100 Queen Street",
            "suburb": "Brisbane City",
            "state": "QLD",
            "postcode": "4000",
            "property_type": "commercial_retail",
            "ownership_structure": "trust",
            "owner_legal_name": "Queen Street Property Trust",
            "owner_abn": "11 222 333 444",
            "trustee_name": "Queen Street Trustee Pty Ltd",
        },
    )
    assert property_response.status_code == 201
    property_id = property_response.json()["id"]

    unit_response = client.post(
        "/api/v1/tenancy-units",
        json={"property_id": property_id, "unit_label": "Shop 1"},
    )
    assert unit_response.status_code == 201
    unit_id = unit_response.json()["id"]

    tenant_response = client.post(
        "/api/v1/tenants",
        json={"entity_id": entity_id, "legal_name": "No Email Retail Pty Ltd"},
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
            "annual_rent_cents": 1200000,
            "rent_frequency": "monthly",
        },
    )
    assert lease_response.status_code == 201
    lease_id = lease_response.json()["id"]

    charge_response = client.post(
        "/api/v1/charge-rules",
        json={
            "lease_id": lease_id,
            "charge_type": "base_rent",
            "amount_cents": 100000,
            "frequency": "monthly",
            "gst_treatment": "taxable",
            "next_due_date": "2026-06-01",
        },
    )
    assert charge_response.status_code == 201
    charge_rule_id = charge_response.json()["id"]

    status_response = client.get(f"/api/v1/xero/status?entity_id={entity_id}")
    assert status_response.status_code == 200
    body = status_response.json()
    assert body["connection"]["connected"] is False
    assert body["contact_mapping"] == {"total": 2, "ready": 0, "missing": 2}
    assert body["chart_mapping"] == {"total": 1, "ready": 0, "missing": 1}
    assert body["tax_mapping"] == {"total": 1, "ready": 0, "missing": 1}
    issue_ids = {issue["id"] for issue in body["issues"]}
    assert f"connection-{entity_id}" in issue_ids
    assert f"chart-{charge_rule_id}" in issue_ids
    assert f"tax-{charge_rule_id}" in issue_ids
    chart_issue = next(
        issue for issue in body["issues"] if issue["id"] == f"chart-{charge_rule_id}"
    )
    assert chart_issue["suggested_account_code"] == "200"
    assert chart_issue["suggested_tax_type"] == "OUTPUT"

    blocked_connection = client.patch(
        f"/api/v1/xero/connection/{entity_id}",
        json={"connected": True},
    )
    assert blocked_connection.status_code == 422

    blocked_sync_stamp = client.patch(
        f"/api/v1/xero/connection/{entity_id}",
        json={
            "connected": True,
            "xero_tenant_id": "tenant-demo-123",
            "last_sync_at": "2026-05-19T10:00:00Z",
        },
    )
    assert blocked_sync_stamp.status_code == 422

    connection_response = client.patch(
        f"/api/v1/xero/connection/{entity_id}",
        json={"connected": True, "xero_tenant_id": "tenant-demo-123"},
    )
    assert connection_response.status_code == 200
    assert connection_response.json()["connected"] is True
    assert connection_response.json()["xero_tenant_id"] == "tenant-demo-123"

    update_rule_response = client.patch(
        f"/api/v1/charge-rules/{charge_rule_id}",
        json={"xero_account_code": "200", "xero_tax_type": "OUTPUT"},
    )
    assert update_rule_response.status_code == 200

    ready_status_response = client.get(f"/api/v1/xero/status?entity_id={entity_id}")
    assert ready_status_response.status_code == 200
    ready_body = ready_status_response.json()
    assert ready_body["connection"]["connected"] is True
    assert ready_body["chart_mapping"] == {"total": 1, "ready": 1, "missing": 0}
    assert ready_body["tax_mapping"] == {"total": 1, "ready": 1, "missing": 0}
    assert f"connection-{entity_id}" not in {issue["id"] for issue in ready_body["issues"]}

    audit = session.scalar(
        select(AuditAction).where(
            AuditAction.target_table == "entity",
            AuditAction.target_id == UUID(entity_id),
            AuditAction.tool_name == "xero.connection_status",
        )
    )
    assert audit is not None
    assert audit.tool_output_summary == "Recorded Xero connection status; no sync was run."
