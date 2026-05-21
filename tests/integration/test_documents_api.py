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


def test_property_image_document_lists_and_downloads(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Document Image Plaza",
            "street_address": "44 Image Street",
            "suburb": "Brisbane City",
            "state": "QLD",
            "postcode": "4000",
            "property_type": "commercial_retail",
        },
    )
    assert property_response.status_code == 201
    property_id = property_response.json()["id"]
    image_bytes = b"jpeg-image-bytes"
    document = StoredDocument(
        entity_id=UUID(entity_id),
        property_id=UUID(property_id),
        filename="document-image-plaza-property-image.jpg",
        content_type="image/jpeg",
        byte_size=len(image_bytes),
        file_data=image_bytes,
        category=DocumentCategory.other,
        notes="Reviewed public property image: Document Image Plaza frontage",
        document_metadata={
            "source": "public_property_image",
            "source_image_url": "https://images.example/document-image-plaza.jpg",
            "processed_width": 1600,
            "processed_height": 900,
        },
    )
    session.add(document)
    session.commit()

    list_response = client.get(
        "/api/v1/documents",
        params={"entity_id": entity_id, "property_id": property_id},
    )
    assert list_response.status_code == 200
    body = list_response.json()
    assert [item["id"] for item in body] == [str(document.id)]
    assert body[0]["filename"] == "document-image-plaza-property-image.jpg"
    assert body[0]["content_type"] == "image/jpeg"
    assert body[0]["category"] == "other"
    assert body[0]["metadata"]["source"] == "public_property_image"
    assert body[0]["metadata"]["processed_width"] == 1600

    download_response = client.get(f"/api/v1/documents/{document.id}/download")
    assert download_response.status_code == 200
    assert download_response.content == image_bytes
    assert download_response.headers["content-type"].startswith("image/jpeg")
    assert "document-image-plaza-property-image.jpg" in download_response.headers[
        "content-disposition"
    ]
