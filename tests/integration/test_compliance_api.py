"""Compliance check API integration tests."""

from datetime import date, timedelta
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import (
    DocumentCategory,
    Entity,
    Obligation,
    StoredDocument,
    UserRole,
)
from stewart.core.settings import get_settings


def _entity_id(session: Session) -> str:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return str(entity.id)


def _entity(session: Session) -> Entity:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return entity


def _create_leased_shop(client: TestClient, entity_id: str) -> dict[str, str]:
    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Milton Retail Centre",
            "street_address": "42 Railway Terrace",
            "suburb": "Milton",
            "state": "QLD",
            "postcode": "4064",
            "property_type": "commercial_retail",
        },
    )
    assert property_response.status_code == 201
    property_id = property_response.json()["id"]

    unit_response = client.post(
        "/api/v1/tenancy-units",
        json={"property_id": property_id, "unit_label": "Shop 2"},
    )
    assert unit_response.status_code == 201
    unit_id = unit_response.json()["id"]

    tenant_response = client.post(
        "/api/v1/tenants",
        json={"entity_id": entity_id, "legal_name": "Milton Grocer Pty Ltd"},
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
            "expiry_date": "2029-12-31",
            "annual_rent_cents": 720000,
            "rent_frequency": "monthly",
        },
    )
    assert lease_response.status_code == 201
    lease_id = lease_response.json()["id"]

    return {
        "property_id": property_id,
        "unit_id": unit_id,
        "tenant_id": tenant_id,
        "lease_id": lease_id,
    }


def test_create_compliance_check_creates_current_obligation(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    scope = _create_leased_shop(client, entity_id)

    response = client.post(
        "/api/v1/compliance/checks",
        json={
            "entity_id": entity_id,
            "property_id": scope["property_id"],
            "tenancy_unit_id": scope["unit_id"],
            "tenant_id": scope["tenant_id"],
            "lease_id": scope["lease_id"],
            "title": "Annual fire safety statement",
            "kind": "fire_safety",
            "jurisdiction": "QLD",
            "authority": "Queensland Fire and Emergency Services",
            "recurrence_interval": 1,
            "recurrence_unit": "years",
            "next_due_date": "2026-07-01",
            "certificate_expires_on": "2026-07-01",
            "owner_role": "ops",
            "notes": "Annual arcade fire safety certificate.",
            "metadata": {"source_filename": "fire-safety.pdf"},
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["title"] == "Annual fire safety statement"
    assert body["kind"] == "fire_safety"
    assert body["status"] == "active"
    assert body["next_due_date"] == "2026-07-01"
    assert body["current_obligation_id"] is not None
    assert body["metadata"]["source_filename"] == "fire-safety.pdf"

    obligation = session.get(Obligation, UUID(body["current_obligation_id"]))
    assert obligation is not None
    assert obligation.entity_id == UUID(entity_id)
    assert obligation.property_id == UUID(scope["property_id"])
    assert obligation.tenancy_unit_id == UUID(scope["unit_id"])
    assert obligation.lease_id == UUID(scope["lease_id"])
    assert obligation.title == "Annual fire safety statement"
    assert obligation.category == "compliance"
    assert obligation.due_date == date(2026, 7, 1)
    assert obligation.owner_role == UserRole.ops
    assert obligation.obligation_metadata["source"] == "compliance_check"
    assert obligation.obligation_metadata["compliance_check_id"] == body["id"]
    assert obligation.obligation_metadata["kind"] == "fire_safety"
    assert obligation.obligation_metadata["recurrence_interval"] == 1
    assert obligation.obligation_metadata["recurrence_unit"] == "years"
    assert obligation.obligation_metadata["certificate_expires_on"] == "2026-07-01"


def test_list_update_and_delete_compliance_check(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    scope = _create_leased_shop(client, entity_id)
    create_response = client.post(
        "/api/v1/compliance/checks",
        json={
            "entity_id": entity_id,
            "property_id": scope["property_id"],
            "title": "Certificate of classification renewal",
            "kind": "certificate",
            "recurrence_interval": 2,
            "recurrence_unit": "years",
            "next_due_date": "2026-08-15",
            "owner_role": "ops",
        },
    )
    assert create_response.status_code == 201
    check_id = create_response.json()["id"]

    list_response = client.get(f"/api/v1/compliance/checks?entity_id={entity_id}")
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()] == [check_id]

    read_response = client.get(f"/api/v1/compliance/checks/{check_id}")
    assert read_response.status_code == 200
    assert read_response.json()["title"] == "Certificate of classification renewal"

    update_response = client.patch(
        f"/api/v1/compliance/checks/{check_id}",
        json={
            "title": "Certificate renewal",
            "next_due_date": "2026-09-01",
            "metadata": {"register_note": "owner supplied update"},
        },
    )
    assert update_response.status_code == 200
    assert update_response.json()["title"] == "Certificate renewal"
    assert update_response.json()["next_due_date"] == "2026-09-01"
    assert update_response.json()["metadata"]["register_note"] == "owner supplied update"

    delete_response = client.delete(f"/api/v1/compliance/checks/{check_id}")
    assert delete_response.status_code == 204
    assert client.get(f"/api/v1/compliance/checks?entity_id={entity_id}").json() == []

    deleted_response = client.get(
        f"/api/v1/compliance/checks?entity_id={entity_id}&include_deleted=true"
    )
    assert deleted_response.status_code == 200
    assert deleted_response.json()[0]["id"] == check_id
    assert deleted_response.json()[0]["deleted_at"] is not None


def test_complete_compliance_check_links_evidence_and_rolls_forward(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    scope = _create_leased_shop(client, entity_id)
    create_response = client.post(
        "/api/v1/compliance/checks",
        json={
            "entity_id": entity_id,
            "property_id": scope["property_id"],
            "tenancy_unit_id": scope["unit_id"],
            "tenant_id": scope["tenant_id"],
            "lease_id": scope["lease_id"],
            "title": "Annual fire safety statement",
            "kind": "fire_safety",
            "recurrence_interval": 1,
            "recurrence_unit": "years",
            "next_due_date": "2026-07-01",
            "certificate_expires_on": "2026-07-01",
            "owner_role": "ops",
        },
    )
    assert create_response.status_code == 201
    check = create_response.json()
    completed_obligation_id = check["current_obligation_id"]
    evidence = StoredDocument(
        entity_id=UUID(entity_id),
        property_id=UUID(scope["property_id"]),
        tenancy_unit_id=UUID(scope["unit_id"]),
        tenant_id=UUID(scope["tenant_id"]),
        lease_id=UUID(scope["lease_id"]),
        filename="fire-safety-certificate.pdf",
        content_type="application/pdf",
        byte_size=24,
        file_data=b"certificate",
        category=DocumentCategory.other,
    )
    session.add(evidence)
    session.commit()

    complete_payload = {
        "operator_approved": True,
        "source_document_id": str(evidence.id),
        "completed_at": "2026-07-02T00:00:00Z",
        "certificate_expires_on": "2027-07-01",
        "metadata": {"reviewed_by": "ops@example.test"},
    }
    response = client.post(
        f"/api/v1/compliance/checks/{check['id']}/complete",
        json=complete_payload,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["last_checked_at"].startswith("2026-07-02T00:00:00")
    assert body["next_due_date"] == "2027-07-01"
    assert body["certificate_expires_on"] == "2027-07-01"
    assert body["source_document_id"] == str(evidence.id)
    assert body["current_obligation_id"] != completed_obligation_id
    assert body["metadata"]["completion_history"][-1]["source_document_id"] == str(evidence.id)
    assert body["metadata"]["completion_history"][-1]["reviewed_by"] == "ops@example.test"
    last_completion = body["metadata"]["completion_history"][-1]
    assert last_completion["operator_approved"] is True
    assert last_completion["approved_by"] == f"user:{get_settings().dev_user_email}"
    assert last_completion["approved_at"].startswith("2026-07-02T00:00:00")

    completed_obligation = session.get(Obligation, UUID(completed_obligation_id))
    assert completed_obligation is not None
    assert completed_obligation.status == "completed"
    assert completed_obligation.completed_at is not None
    assert completed_obligation.obligation_metadata["evidence_document_ids"] == [
        str(evidence.id)
    ]
    assert completed_obligation.obligation_metadata["evidence_history"][-1][
        "actor"
    ] == f"user:{get_settings().dev_user_email}"

    next_obligation = session.get(Obligation, UUID(body["current_obligation_id"]))
    assert next_obligation is not None
    assert next_obligation.due_date == date(2027, 7, 1)
    assert next_obligation.category == "compliance"
    assert next_obligation.obligation_metadata["source"] == "compliance_check"

    before_retry_ids = {
        row.id
        for row in session.scalars(
            select(Obligation).where(Obligation.entity_id == UUID(entity_id))
        )
    }
    retry_response = client.post(
        f"/api/v1/compliance/checks/{check['id']}/complete",
        json=complete_payload,
    )
    assert retry_response.status_code == 200
    assert retry_response.json()["current_obligation_id"] == body["current_obligation_id"]
    after_retry_ids = {
        row.id
        for row in session.scalars(
            select(Obligation).where(Obligation.entity_id == UUID(entity_id))
        )
    }
    assert after_retry_ids == before_retry_ids


def test_complete_compliance_check_rejects_cross_entity_evidence_without_mutation(
    client: TestClient,
    session: Session,
) -> None:
    entity = _entity(session)
    scope = _create_leased_shop(client, str(entity.id))
    create_response = client.post(
        "/api/v1/compliance/checks",
        json={
            "entity_id": str(entity.id),
            "property_id": scope["property_id"],
            "title": "Fire safety statement",
            "kind": "fire_safety",
            "recurrence_interval": 1,
            "recurrence_unit": "years",
            "next_due_date": "2026-07-01",
            "owner_role": "ops",
        },
    )
    assert create_response.status_code == 201
    check = create_response.json()
    other_entity = Entity(organisation_id=entity.organisation_id, name="Other Entity")
    session.add(other_entity)
    session.flush()
    other_document = StoredDocument(
        entity_id=other_entity.id,
        filename="other.pdf",
        content_type="application/pdf",
        byte_size=12,
        file_data=b"other",
        category=DocumentCategory.other,
    )
    session.add(other_document)
    session.commit()

    response = client.post(
        f"/api/v1/compliance/checks/{check['id']}/complete",
        json={
            "operator_approved": True,
            "source_document_id": str(other_document.id),
            "completed_at": "2026-07-02T00:00:00Z",
        },
    )

    assert response.status_code == 422
    obligation = session.get(Obligation, UUID(check["current_obligation_id"]))
    assert obligation is not None
    assert obligation.status != "completed"
    refreshed = client.get(f"/api/v1/compliance/checks/{check['id']}").json()
    assert refreshed["source_document_id"] is None
    assert "completion_history" not in refreshed["metadata"]


def test_link_compliance_check_evidence_without_completing(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    scope = _create_leased_shop(client, entity_id)
    create_response = client.post(
        "/api/v1/compliance/checks",
        json={
            "entity_id": entity_id,
            "property_id": scope["property_id"],
            "title": "Annual fire safety statement",
            "kind": "fire_safety",
            "recurrence_interval": 1,
            "recurrence_unit": "years",
            "next_due_date": "2026-07-01",
            "owner_role": "ops",
        },
    )
    assert create_response.status_code == 201
    check = create_response.json()
    assert check["source_document_id"] is None
    current_obligation_id = check["current_obligation_id"]
    evidence = StoredDocument(
        entity_id=UUID(entity_id),
        property_id=UUID(scope["property_id"]),
        filename="fire-safety-certificate.pdf",
        content_type="application/pdf",
        byte_size=24,
        file_data=b"certificate",
        category=DocumentCategory.other,
    )
    session.add(evidence)
    session.commit()

    response = client.post(
        f"/api/v1/compliance/checks/{check['id']}/evidence",
        json={
            "source_document_id": str(evidence.id),
            "certificate_expires_on": "2027-07-01",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["source_document_id"] == str(evidence.id)
    assert body["certificate_expires_on"] == "2027-07-01"
    # Linking evidence is review-only: nothing completes or rolls forward.
    assert body["current_obligation_id"] == current_obligation_id
    assert body["next_due_date"] == "2026-07-01"
    assert body["last_checked_at"] is None
    assert "completion_history" not in body["metadata"]
    history = body["metadata"]["evidence_link_history"]
    assert history[-1]["document_id"] == str(evidence.id)
    assert history[-1]["actor"] == f"user:{get_settings().dev_user_email}"
    obligation = session.get(Obligation, UUID(current_obligation_id))
    assert obligation is not None
    assert obligation.status != "completed"

    # Re-linking the same document is idempotent: no duplicate history entry.
    retry_response = client.post(
        f"/api/v1/compliance/checks/{check['id']}/evidence",
        json={
            "source_document_id": str(evidence.id),
            "certificate_expires_on": "2027-07-01",
        },
    )
    assert retry_response.status_code == 200
    retry_history = retry_response.json()["metadata"]["evidence_link_history"]
    assert len(retry_history) == len(history)


def test_link_compliance_check_evidence_rejects_cross_entity_document(
    client: TestClient,
    session: Session,
) -> None:
    entity = _entity(session)
    scope = _create_leased_shop(client, str(entity.id))
    create_response = client.post(
        "/api/v1/compliance/checks",
        json={
            "entity_id": str(entity.id),
            "property_id": scope["property_id"],
            "title": "Fire safety statement",
            "kind": "fire_safety",
            "recurrence_interval": 1,
            "recurrence_unit": "years",
            "next_due_date": "2026-07-01",
            "owner_role": "ops",
        },
    )
    assert create_response.status_code == 201
    check = create_response.json()
    other_entity = Entity(organisation_id=entity.organisation_id, name="Other Entity")
    session.add(other_entity)
    session.flush()
    other_document = StoredDocument(
        entity_id=other_entity.id,
        filename="other.pdf",
        content_type="application/pdf",
        byte_size=12,
        file_data=b"other",
        category=DocumentCategory.other,
    )
    session.add(other_document)
    session.commit()

    response = client.post(
        f"/api/v1/compliance/checks/{check['id']}/evidence",
        json={"source_document_id": str(other_document.id)},
    )

    assert response.status_code == 422
    refreshed = client.get(f"/api/v1/compliance/checks/{check['id']}").json()
    assert refreshed["source_document_id"] is None
    assert "evidence_link_history" not in refreshed["metadata"]


def test_complete_compliance_check_requires_operator_approval(
    client: TestClient,
    session: Session,
) -> None:
    """Review-first guardrail: completion only fires on explicit approval."""
    entity_id = _entity_id(session)
    scope = _create_leased_shop(client, entity_id)
    create_response = client.post(
        "/api/v1/compliance/checks",
        json={
            "entity_id": entity_id,
            "property_id": scope["property_id"],
            "title": "Annual fire safety statement",
            "kind": "fire_safety",
            "recurrence_interval": 1,
            "recurrence_unit": "years",
            "next_due_date": "2026-07-01",
            "owner_role": "ops",
        },
    )
    assert create_response.status_code == 201
    check = create_response.json()
    current_obligation_id = check["current_obligation_id"]

    # No operator_approved flag (defaults False) is rejected with no mutation.
    response = client.post(
        f"/api/v1/compliance/checks/{check['id']}/complete",
        json={"completed_at": "2026-07-02T00:00:00Z"},
    )
    assert response.status_code == 422
    assert "operator approval" in response.json()["detail"].lower()

    refreshed = client.get(f"/api/v1/compliance/checks/{check['id']}").json()
    assert refreshed["current_obligation_id"] == current_obligation_id
    assert refreshed["next_due_date"] == "2026-07-01"
    assert refreshed["last_checked_at"] is None
    assert "completion_history" not in refreshed["metadata"]
    obligation = session.get(Obligation, UUID(current_obligation_id))
    assert obligation is not None
    assert obligation.status != "completed"

    # An explicit approval then completes and rolls the check forward.
    approved = client.post(
        f"/api/v1/compliance/checks/{check['id']}/complete",
        json={"operator_approved": True, "completed_at": "2026-07-02T00:00:00Z"},
    )
    assert approved.status_code == 200
    assert approved.json()["current_obligation_id"] != current_obligation_id


def test_complete_compliance_check_fires_no_provider_call(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """Operator-approved completion must never open an outbound provider call.

    We assert at the httpx boundary: completion may read/write the DB and link
    a stored document, but it must not reach SendGrid/Twilio/Xero. Any outbound
    HTTP call to an external host fails the test loudly. The Starlette
    TestClient is itself built on httpx.Client, so we allow testserver traffic
    and guard only absolute external URLs.
    """
    import httpx

    entity_id = _entity_id(session)
    scope = _create_leased_shop(client, entity_id)
    create_response = client.post(
        "/api/v1/compliance/checks",
        json={
            "entity_id": entity_id,
            "property_id": scope["property_id"],
            "title": "Annual fire safety statement",
            "kind": "fire_safety",
            "recurrence_interval": 1,
            "recurrence_unit": "years",
            "next_due_date": "2026-07-01",
            "owner_role": "ops",
        },
    )
    assert create_response.status_code == 201
    check = create_response.json()
    evidence = StoredDocument(
        entity_id=UUID(entity_id),
        property_id=UUID(scope["property_id"]),
        filename="fire-safety-certificate.pdf",
        content_type="application/pdf",
        byte_size=24,
        file_data=b"certificate",
        category=DocumentCategory.other,
    )
    session.add(evidence)
    session.commit()

    original_request = httpx.Client.request

    def _guarded_request(self, method, url, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003, ANN202
        target = str(url)
        if target.startswith(("http://", "https://")) and "testserver" not in target:
            raise AssertionError(
                f"Compliance completion attempted an outbound HTTP call to {target}."
            )
        return original_request(self, method, url, *args, **kwargs)

    monkeypatch.setattr(httpx.Client, "request", _guarded_request)

    response = client.post(
        f"/api/v1/compliance/checks/{check['id']}/complete",
        json={
            "operator_approved": True,
            "source_document_id": str(evidence.id),
            "completed_at": "2026-07-02T00:00:00Z",
            "certificate_expires_on": "2027-07-01",
        },
    )
    assert response.status_code == 200
    assert response.json()["source_document_id"] == str(evidence.id)
    assert response.json()["next_due_date"] == "2027-07-01"


def _create_compliance_check(
    client: TestClient,
    entity_id: str,
    scope: dict[str, str],
    *,
    certificate_expires_on: str | None,
) -> dict:
    payload = {
        "entity_id": entity_id,
        "property_id": scope["property_id"],
        "title": "Certificate of classification renewal",
        "kind": "certificate",
        "recurrence_interval": 1,
        "recurrence_unit": "years",
        "next_due_date": "2030-01-01",
        "owner_role": "ops",
    }
    if certificate_expires_on is not None:
        payload["certificate_expires_on"] = certificate_expires_on
    response = client.post("/api/v1/compliance/checks", json=payload)
    assert response.status_code == 201
    return response.json()


def test_certificate_expiry_projection_due_soon(
    client: TestClient,
    session: Session,
) -> None:
    """A certificate expiring inside the 30-day window projects due_soon."""
    entity_id = _entity_id(session)
    scope = _create_leased_shop(client, entity_id)
    expires = date.today() + timedelta(days=10)
    body = _create_compliance_check(
        client, entity_id, scope, certificate_expires_on=expires.isoformat()
    )

    assert body["certificate_expiry_status"] == "due_soon"
    assert body["days_until_certificate_expiry"] == 10

    # Projection is present on the list endpoint too.
    listed = client.get(f"/api/v1/compliance/checks?entity_id={entity_id}").json()
    assert listed[0]["certificate_expiry_status"] == "due_soon"
    assert listed[0]["days_until_certificate_expiry"] == 10


def test_certificate_expiry_projection_expired(
    client: TestClient,
    session: Session,
) -> None:
    """A past certificate expiry projects expired with negative days remaining."""
    entity_id = _entity_id(session)
    scope = _create_leased_shop(client, entity_id)
    expires = date.today() - timedelta(days=5)
    body = _create_compliance_check(
        client, entity_id, scope, certificate_expires_on=expires.isoformat()
    )

    assert body["certificate_expiry_status"] == "expired"
    assert body["days_until_certificate_expiry"] == -5


def test_certificate_expiry_projection_ok_and_none(
    client: TestClient,
    session: Session,
) -> None:
    """Far-future certificates project ok; absent certificates project none."""
    entity_id = _entity_id(session)
    scope = _create_leased_shop(client, entity_id)

    far = date.today() + timedelta(days=200)
    ok_body = _create_compliance_check(
        client, entity_id, scope, certificate_expires_on=far.isoformat()
    )
    assert ok_body["certificate_expiry_status"] == "ok"
    assert ok_body["days_until_certificate_expiry"] == 200

    none_body = _create_compliance_check(
        client, entity_id, scope, certificate_expires_on=None
    )
    assert none_body["certificate_expiry_status"] == "none"
    assert none_body["days_until_certificate_expiry"] is None


def test_certificate_expiry_projection_is_read_only(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """Reading the list/check projects expiry without mutating or calling a provider.

    Asserts at the httpx boundary (same guard pattern as the completion test):
    a read must not reach SendGrid/Twilio/Xero, and must not change the stored
    certificate_expires_on / next_due_date.
    """
    import httpx

    entity_id = _entity_id(session)
    scope = _create_leased_shop(client, entity_id)
    expires = date.today() + timedelta(days=10)
    body = _create_compliance_check(
        client, entity_id, scope, certificate_expires_on=expires.isoformat()
    )
    check_id = body["id"]

    original_request = httpx.Client.request

    def _guarded_request(self, method, url, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003, ANN202
        target = str(url)
        if target.startswith(("http://", "https://")) and "testserver" not in target:
            raise AssertionError(
                f"Compliance read attempted an outbound HTTP call to {target}."
            )
        return original_request(self, method, url, *args, **kwargs)

    monkeypatch.setattr(httpx.Client, "request", _guarded_request)

    read = client.get(f"/api/v1/compliance/checks/{check_id}")
    assert read.status_code == 200
    assert read.json()["certificate_expiry_status"] == "due_soon"
    listed = client.get(f"/api/v1/compliance/checks?entity_id={entity_id}")
    assert listed.status_code == 200

    # No mutation: the stored row is unchanged after the read-only projection.
    from stewart.core.models import ComplianceCheck

    stored = session.get(ComplianceCheck, UUID(check_id))
    assert stored is not None
    assert stored.certificate_expires_on == expires
    assert stored.next_due_date == date(2030, 1, 1)
    assert stored.last_checked_at is None


def test_compliance_check_requires_entity_access(
    client: TestClient,
    session: Session,
) -> None:
    entity = _entity(session)
    other_entity = Entity(organisation_id=entity.organisation_id, name="No Role Entity")
    session.add(other_entity)
    session.commit()

    response = client.post(
        "/api/v1/compliance/checks",
        json={
            "entity_id": str(other_entity.id),
            "title": "No role check",
            "kind": "other",
            "recurrence_interval": 1,
            "recurrence_unit": "years",
            "next_due_date": "2026-07-01",
        },
    )

    assert response.status_code == 403
