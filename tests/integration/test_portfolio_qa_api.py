"""Reviewed Portfolio QA bulk-fix API tests."""

from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import AuditAction, Entity, Tenant


def _entity_id(session: Session) -> str:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return str(entity.id)


def _create_tenant(client: TestClient, entity_id: str, legal_name: str) -> dict:
    response = client.post(
        "/api/v1/tenants",
        json={"entity_id": entity_id, "legal_name": legal_name},
    )
    assert response.status_code == 201
    return response.json()


def test_bulk_fix_apply_updates_tenant_contacts_in_one_reviewed_action(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    first = _create_tenant(client, entity_id, "Bulk Fix One Pty Ltd")
    second = _create_tenant(client, entity_id, "Bulk Fix Two Pty Ltd")

    response = client.post(
        "/api/v1/portfolio-qa/bulk-fixes/apply",
        json={
            "issue_class": "tenant_contact",
            "changes": [
                {
                    "target_id": first["id"],
                    "fields": {
                        "contact_name": "Ava Reviewer",
                        "contact_email": "ava@one.example",
                        "billing_email": "accounts@one.example",
                    },
                },
                {
                    "target_id": second["id"],
                    "fields": {
                        "contact_name": "Ben Reviewer",
                        "billing_email": "accounts@two.example",
                    },
                },
            ],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["applied"]) == 5
    assert body["skipped"] == []
    assert body["summary"] == "Applied 5 field fix(es) across 2 record(s); skipped 0."

    tenant_one = session.get(Tenant, UUID(first["id"]))
    assert tenant_one is not None
    assert tenant_one.contact_name == "Ava Reviewer"
    assert tenant_one.contact_email == "ava@one.example"
    assert tenant_one.billing_email == "accounts@one.example"
    tenant_two = session.get(Tenant, UUID(second["id"]))
    assert tenant_two is not None
    assert tenant_two.contact_name == "Ben Reviewer"
    assert tenant_two.billing_email == "accounts@two.example"

    audit_rows = list(
        session.scalars(
            select(AuditAction).where(AuditAction.tool_name == "portfolio_qa_bulk_fix")
        )
    )
    assert len(audit_rows) == 3
    record_rows = [row for row in audit_rows if row.target_table == "tenant"]
    assert {row.target_id for row in record_rows} == {
        UUID(first["id"]),
        UUID(second["id"]),
    }
    summary_rows = [row for row in audit_rows if row.target_table is None]
    assert len(summary_rows) == 1
    assert summary_rows[0].tool_input == {
        "issue_class": "tenant_contact",
        "targets": 2,
        "applied_fields": 5,
        "skipped_fields": 0,
    }


def test_bulk_fix_apply_skips_unsupported_fields_and_unchanged_values(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    tenant_response = client.post(
        "/api/v1/tenants",
        json={
            "entity_id": entity_id,
            "legal_name": "Bulk Fix Skip Pty Ltd",
            "billing_email": "accounts@skip.example",
        },
    )
    assert tenant_response.status_code == 201
    tenant_id = tenant_response.json()["id"]

    response = client.post(
        "/api/v1/portfolio-qa/bulk-fixes/apply",
        json={
            "issue_class": "tenant_contact",
            "changes": [
                {
                    "target_id": tenant_id,
                    "fields": {
                        "notes": "Not allowlisted",
                        "billing_email": "accounts@skip.example",
                        "contact_name": "Skip Reviewer",
                    },
                },
            ],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert [(row["field"], row["reason"]) for row in body["skipped"]] == [
        ("notes", "Field is not supported for portfolio QA bulk fixes."),
        ("billing_email", "Value is unchanged."),
    ]
    assert [row["field"] for row in body["applied"]] == ["contact_name"]

    tenant = session.get(Tenant, UUID(tenant_id))
    assert tenant is not None
    assert tenant.contact_name == "Skip Reviewer"
    assert tenant.notes is None
    assert tenant.billing_email == "accounts@skip.example"


def test_bulk_fix_apply_rejects_target_outside_user_entities(
    client: TestClient,
    session: Session,
) -> None:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    foreign_entity = Entity(
        organisation_id=entity.organisation_id,
        name="Outside Holdings Pty Ltd",
    )
    session.add(foreign_entity)
    session.flush()
    foreign_tenant = Tenant(
        entity_id=foreign_entity.id,
        legal_name="Outside Tenant Pty Ltd",
    )
    session.add(foreign_tenant)
    session.commit()

    response = client.post(
        "/api/v1/portfolio-qa/bulk-fixes/apply",
        json={
            "issue_class": "tenant_contact",
            "changes": [
                {
                    "target_id": str(foreign_tenant.id),
                    "fields": {"contact_name": "Should Not Apply"},
                },
            ],
        },
    )
    assert response.status_code == 403

    session.refresh(foreign_tenant)
    assert foreign_tenant.contact_name is None
    audit = session.scalar(
        select(AuditAction).where(AuditAction.tool_name == "portfolio_qa_bulk_fix")
    )
    assert audit is None
