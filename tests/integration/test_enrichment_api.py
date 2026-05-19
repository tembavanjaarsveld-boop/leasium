"""Review-first public enrichment API tests."""

from uuid import UUID

from apps.api.routers import enrichment as enrichment_router
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import Entity, Property


def _entity_id(session: Session) -> str:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return str(entity.id)


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
