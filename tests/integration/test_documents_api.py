"""Stored document API tests."""

from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import DocumentCategory, Entity, StoredDocument


def _entity_id(session: Session) -> str:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return str(entity.id)


def _tenant_id(client: TestClient, session: Session) -> str:
    response = client.post(
        "/api/v1/tenants",
        json={"entity_id": _entity_id(session), "legal_name": "Document Tenant Pty Ltd"},
    )
    assert response.status_code == 201
    return str(response.json()["id"])


def test_tenant_document_upload_list_download_and_delete(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    tenant_id = _tenant_id(client, session)

    upload_response = client.post(
        "/api/v1/documents",
        data={
            "entity_id": entity_id,
            "tenant_id": tenant_id,
            "category": "insurance",
            "notes": "Public liability certificate.",
        },
        files={
            "file": (
                "insurance.txt",
                b"certificate bytes",
                "text/plain",
            )
        },
    )
    assert upload_response.status_code == 201
    body = upload_response.json()
    assert body["filename"] == "insurance.txt"
    assert body["byte_size"] == len(b"certificate bytes")
    assert body["category"] == "insurance"
    assert body["notes"] == "Public liability certificate."

    list_response = client.get(
        "/api/v1/documents",
        params={"entity_id": entity_id, "tenant_id": tenant_id},
    )
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()] == [body["id"]]

    download_response = client.get(f"/api/v1/documents/{body['id']}/download")
    assert download_response.status_code == 200
    assert download_response.content == b"certificate bytes"
    assert download_response.headers["content-type"].startswith("text/plain")

    delete_response = client.delete(f"/api/v1/documents/{body['id']}")
    assert delete_response.status_code == 204

    list_after_delete = client.get(
        "/api/v1/documents",
        params={"entity_id": entity_id, "tenant_id": tenant_id},
    )
    assert list_after_delete.status_code == 200
    assert list_after_delete.json() == []

    document = session.get(StoredDocument, UUID(body["id"]))
    assert document is not None
    assert document.deleted_at is not None


def test_document_upload_rejects_cross_entity_tenant(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    tenant_id = _tenant_id(client, session)
    organisation_entity = session.scalar(select(Entity))
    assert organisation_entity is not None

    other_entity_response = client.post(
        "/api/v1/entities",
        json={
            "organisation_id": str(organisation_entity.organisation_id),
            "name": "Other Entity Pty Ltd",
        },
    )
    assert other_entity_response.status_code == 201

    upload_response = client.post(
        "/api/v1/documents",
        data={
            "entity_id": other_entity_response.json()["id"],
            "tenant_id": tenant_id,
            "category": "other",
        },
        files={"file": ("note.txt", b"hello", "text/plain")},
    )
    assert upload_response.status_code == 404

    list_response = client.get("/api/v1/documents", params={"entity_id": entity_id})
    assert list_response.status_code == 200
    assert list_response.json() == []
