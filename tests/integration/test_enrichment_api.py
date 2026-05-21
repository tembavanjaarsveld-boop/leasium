"""Review-first public enrichment API tests."""

from io import BytesIO
from uuid import UUID

import pytest
from apps.api.routers import enrichment as enrichment_router
from fastapi import HTTPException, status
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import AuditAction, DocumentCategory, Entity, Property, StoredDocument


def _entity_id(session: Session) -> str:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return str(entity.id)


def _test_jpeg_bytes(size: tuple[int, int] = (1600, 900)) -> bytes:
    output = BytesIO()
    Image.new("RGB", size, color=(32, 96, 160)).save(output, format="JPEG")
    return output.getvalue()


def test_public_enrichment_preview_then_apply_property_fact(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    entity_id = _entity_id(session)
    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Enrichment Plaza",
            "street_address": "10 Public Street",
            "suburb": "",
            "state": "",
            "postcode": "",
            "property_type": "commercial_office",
            "ownership_structure": "property_owner",
            "owner_legal_name": "Public Owner Pty Ltd",
        },
    )
    assert property_response.status_code == 201
    property_id = property_response.json()["id"]

    def fake_suggest_public_enrichment(**kwargs):  # noqa: ANN003
        assert kwargs["target_type"] == "property"
        assert "owner_abn" in kwargs["missing_fields"]
        return (
            {
                "suggestions": [
                    {
                        "field": "owner_abn",
                        "value": "11111222333",
                        "source_hint": "ABN Lookup",
                        "source_url": "https://abr.business.gov.au/",
                        "citation": "Public Owner Pty Ltd active ABN record.",
                        "confidence": 0.92,
                        "notes": "Official register match.",
                    }
                ],
                "warnings": [],
            },
            "resp_enrichment_1",
        )

    monkeypatch.setattr(
        enrichment_router,
        "suggest_public_enrichment",
        fake_suggest_public_enrichment,
    )

    preview_response = client.post(
        "/api/v1/public-enrichment/preview",
        json={"target_type": "property", "target_id": property_id},
    )
    assert preview_response.status_code == 200
    preview_body = preview_response.json()
    assert preview_body["openai_response_id"] == "resp_enrichment_1"
    assert preview_body["suggestions"][0]["field"] == "owner_abn"
    assert preview_body["suggestions"][0]["value"] == "11 111 222 333"

    prop = session.get(Property, UUID(property_id))
    assert prop is not None
    assert prop.owner_abn is None

    apply_response = client.post(
        "/api/v1/public-enrichment/apply",
        json={
            "target_type": "property",
            "target_id": property_id,
            "suggestions": preview_body["suggestions"],
        },
    )
    assert apply_response.status_code == 200
    apply_body = apply_response.json()
    assert apply_body["applied"][0]["field"] == "owner_abn"
    assert apply_body["skipped"] == []

    session.refresh(prop)
    assert prop.owner_abn == "11 111 222 333"
    assert prop.property_metadata["source_citations"]["owner_abn"]["source_hint"] == (
        "ABN Lookup"
    )
    assert prop.property_metadata["public_enrichment"]["apply_history"][0]["field"] == (
        "owner_abn"
    )
    audit = session.scalar(
        select(AuditAction).where(
            AuditAction.tool_name == "public_enrichment",
            AuditAction.target_table == "property",
            AuditAction.target_id == UUID(property_id),
        )
    )
    assert audit is not None
    assert audit.data_classification == "public"
    assert audit.tool_input == {"fields": ["owner_abn"]}


def test_property_image_preview_then_apply_metadata(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    entity_id = _entity_id(session)
    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Image Plaza",
            "street_address": "20 Image Street",
            "suburb": "Brisbane City",
            "state": "QLD",
            "postcode": "4000",
            "property_type": "commercial_retail",
        },
    )
    assert property_response.status_code == 201
    property_id = property_response.json()["id"]

    def fake_suggest_property_image_candidates(**kwargs):  # noqa: ANN003
        assert kwargs["target_context"]["name"] == "Image Plaza"
        assert kwargs["requested_count"] == 4
        return (
            {
                "candidates": [
                    {
                        "title": "Broken candidate",
                        "image_url": "https://",
                        "page_url": "https://example.com/broken-image-plaza",
                        "source_hint": "Agency listing",
                        "citation": "Broken candidate.",
                        "confidence": 0.72,
                        "notes": None,
                    },
                    {
                        "title": "Image Plaza frontage",
                        "image_url": "https://images.example/image-plaza.jpg",
                        "page_url": "https://example.com/image-plaza",
                        "source_hint": "Agency listing",
                        "citation": "Image Plaza listing hero image.",
                        "confidence": 0.86,
                        "notes": "Exterior frontage match.",
                    }
                ],
                "warnings": [],
            },
            "resp_property_images_1",
        )

    monkeypatch.setattr(
        enrichment_router,
        "suggest_property_image_candidates",
        fake_suggest_property_image_candidates,
    )

    def fake_download_and_process_property_image(image_url: str) -> tuple[bytes, tuple[int, int]]:
        assert image_url == "https://images.example/image-plaza.jpg"
        return _test_jpeg_bytes(), (1280, 720)

    monkeypatch.setattr(
        enrichment_router,
        "_download_and_process_property_image",
        fake_download_and_process_property_image,
    )

    preview_response = client.post(
        "/api/v1/public-enrichment/property-images/preview",
        json={"property_id": property_id, "requested_count": 4},
    )
    assert preview_response.status_code == 200
    preview_body = preview_response.json()
    assert preview_body["openai_response_id"] == "resp_property_images_1"
    assert len(preview_body["candidates"]) == 1
    assert preview_body["candidates"][0]["title"] == "Image Plaza frontage"
    assert "Ignored incomplete or unsupported image candidate." in preview_body["warnings"]

    apply_response = client.post(
        "/api/v1/public-enrichment/property-images/apply",
        json={
            "property_id": property_id,
            "candidate": preview_body["candidates"][0],
        },
    )
    assert apply_response.status_code == 200
    apply_body = apply_response.json()
    assert apply_body["selected_image"]["image_url"] == "https://images.example/image-plaza.jpg"
    document_id = UUID(apply_body["document_id"])

    document = session.get(StoredDocument, document_id)
    assert document is not None
    assert document.property_id == UUID(property_id)
    assert document.content_type == "image/jpeg"
    assert document.category == DocumentCategory.other
    assert document.document_metadata["source"] == "public_property_image"
    assert document.document_metadata["source_image_url"] == (
        "https://images.example/image-plaza.jpg"
    )
    assert document.document_metadata["source_page_url"] == "https://example.com/image-plaza"
    assert document.document_metadata["source_detail"]["source_hint"] == "Agency listing"
    assert document.document_metadata["confidence"] == 0.86
    assert document.document_metadata["notes"] == "Exterior frontage match."
    assert document.document_metadata["original_width"] == 1280
    assert document.document_metadata["original_height"] == 720
    assert document.document_metadata["processed_width"] == 1600
    assert document.document_metadata["processed_height"] == 900
    with Image.open(BytesIO(document.file_data)) as stored_image:
        assert stored_image.size == (1600, 900)

    prop = session.get(Property, UUID(property_id))
    assert prop is not None
    primary_image = prop.property_metadata["property_media"]["primary_image"]
    assert primary_image["title"] == "Image Plaza frontage"
    assert primary_image["image_url"] == "https://images.example/image-plaza.jpg"
    assert primary_image["document_id"] == str(document_id)
    assert primary_image["image_document_id"] == str(document_id)
    assert primary_image["source"]["source_hint"] == "Agency listing"
    media = prop.property_metadata["property_media"]
    assert media["hero_image_document_id"] == str(document_id)
    assert media["image_document_ids"] == [str(document_id)]
    assert media["image_history"][0]["title"] == "Image Plaza frontage"
    assert media["image_history"][0]["document_id"] == str(document_id)

    audit_rows = list(
        session.scalars(
            select(AuditAction)
            .where(AuditAction.tool_name == "property_image_enrichment")
            .order_by(AuditAction.occurred_at)
        )
    )
    assert [row.target_table for row in audit_rows] == ["stored_document", "property"]
    assert [row.data_classification for row in audit_rows] == ["public", "public"]
    assert audit_rows[0].target_id == document_id
    assert audit_rows[0].tool_input == {
        "property_id": property_id,
        "source_image_url": "https://images.example/image-plaza.jpg",
    }
    assert audit_rows[1].target_id == UUID(property_id)
    assert audit_rows[1].tool_input == {
        "image_url": "https://images.example/image-plaza.jpg",
        "page_url": "https://example.com/image-plaza",
    }


def test_property_image_apply_rejects_failed_download_without_document(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    entity_id = _entity_id(session)
    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "No Image Plaza",
            "street_address": "22 Image Street",
            "suburb": "Brisbane City",
            "state": "QLD",
            "postcode": "4000",
            "property_type": "commercial_retail",
        },
    )
    assert property_response.status_code == 201
    property_id = property_response.json()["id"]

    def fake_download_and_process_property_image(image_url: str) -> tuple[bytes, tuple[int, int]]:
        assert image_url == "https://images.example/not-image.txt"
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Downloaded URL did not return an image.",
        )

    monkeypatch.setattr(
        enrichment_router,
        "_download_and_process_property_image",
        fake_download_and_process_property_image,
    )

    apply_response = client.post(
        "/api/v1/public-enrichment/property-images/apply",
        json={
            "property_id": property_id,
            "candidate": {
                "title": "Broken candidate",
                "image_url": "https://images.example/not-image.txt",
                "page_url": "https://example.com/not-image",
                "source": {
                    "source_hint": "Agency listing",
                    "citation": "Broken image candidate.",
                    "confidence": 0.7,
                    "url": "https://example.com/not-image",
                },
                "confidence": 0.7,
                "notes": None,
            },
        },
    )
    assert apply_response.status_code == 422

    document = session.scalar(
        select(StoredDocument).where(StoredDocument.property_id == UUID(property_id))
    )
    assert document is None
    prop = session.get(Property, UUID(property_id))
    assert prop is not None
    assert "property_media" not in prop.property_metadata


def test_property_image_url_guard_rejects_private_dns(monkeypatch) -> None:
    def fake_getaddrinfo(*_args, **_kwargs):  # noqa: ANN002, ANN003
        return [(None, None, None, "", ("10.0.0.8", 443))]

    monkeypatch.setattr(enrichment_router.socket, "getaddrinfo", fake_getaddrinfo)

    with pytest.raises(HTTPException) as exc:
        enrichment_router._assert_property_image_url_allowed(
            "https://images.example/private.jpg"
        )

    assert exc.value.status_code == 422
    assert exc.value.detail == "Image URL host is not allowed."
