"""Activity feed API tests.

The endpoint reads `audit_action` directly so we exercise it the way the
rest of the app does: by performing real API actions (which write audit
rows) and then asserting the feed projects them with the right action
kind, target label, and deep-link.
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import Entity


def _entity_id(session: Session) -> str:
    entity = session.scalar(
        select(Entity).where(Entity.name == "SKJ Property Pty Ltd")
    )
    assert entity is not None
    return str(entity.id)


def test_activity_feed_projects_recent_audit_rows(
    client: TestClient, session: Session
) -> None:
    entity_id = _entity_id(session)

    # Create a property — writes an audit row with target_table=property.
    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Activity Plaza",
            "street_address": "1 Activity Street",
            "suburb": "Brisbane",
            "state": "QLD",
            "postcode": "4000",
            "property_type": "commercial_retail",
        },
    )
    assert property_response.status_code == 201
    property_id = property_response.json()["id"]

    feed_response = client.get(
        "/api/v1/activity-feed",
        params={"entity_id": entity_id, "limit": 10},
    )
    assert feed_response.status_code == 200
    body = feed_response.json()
    assert isinstance(body["items"], list)
    assert body["items"], "expected at least one audit row from the property creation"

    # The most recent row should be the property create with a resolved
    # target_label and a working deep-link.
    property_rows = [
        item
        for item in body["items"]
        if item["target_table"] == "property" and item["target_id"] == property_id
    ]
    assert property_rows, "expected to find the audit row for the new property"
    row = property_rows[0]
    assert row["action_kind"] == "create"
    assert row["action_label"] == "Created"
    assert row["target_label"] == "Activity Plaza"
    assert row["target_href"] == f"/properties?property_id={property_id}"
    assert row["outcome"] == "success"


def test_activity_feed_pagination_signals_has_more(
    client: TestClient, session: Session
) -> None:
    entity_id = _entity_id(session)

    # Generate a few audit rows by creating properties.
    for i in range(3):
        response = client.post(
            "/api/v1/properties",
            json={
                "entity_id": entity_id,
                "name": f"Pagination Plaza {i}",
                "street_address": f"{i + 1} Page Street",
                "suburb": "Brisbane",
                "state": "QLD",
                "postcode": "4000",
                "property_type": "commercial_retail",
            },
        )
        assert response.status_code == 201

    response = client.get(
        "/api/v1/activity-feed",
        params={"entity_id": entity_id, "limit": 2},
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["items"]) == 2
    # With at least 3 audit rows newer than the fixture's baseline, the
    # endpoint must signal there are more.
    assert body["has_more"] is True
    assert body["next_cursor"] is not None


def test_activity_feed_requires_entity_access(client: TestClient) -> None:
    # An entity id the dev operator should not have access to.
    response = client.get(
        "/api/v1/activity-feed",
        params={"entity_id": "00000000-0000-0000-0000-000000000000"},
    )
    assert response.status_code in {403, 404}
