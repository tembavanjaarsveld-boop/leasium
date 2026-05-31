"""Owner entity CRUD API — DoorLoop benchmark P0, Ticket 1.4.

The HTTP surface for the first-class ``Owner`` record (list / create / detail /
patch / soft-delete) under ``/api/v1/owners``. Read projection surfaces the
linked properties + split so the People hub Owners directory can render them.
The legacy ``/owners/statements*`` routes are unaffected (route ordering keeps
the literal statement paths ahead of ``/owners/{owner_id}``).
"""

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import Entity, Owner, Property, PropertyOwner, PropertyType


def _entity(session: Session) -> Entity:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return entity


def test_owner_crud_round_trip(client: TestClient, session: Session) -> None:
    entity_id = str(_entity(session).id)

    created = client.post(
        "/api/v1/owners",
        json={
            "entity_id": entity_id,
            "legal_name": "SKJ Holdings Pty Ltd",
            "abn": "11222333444",
            "billing_email": "owners@skjcapital.com",
            "gst_registered": True,
        },
    )
    assert created.status_code == 201, created.text
    owner = created.json()
    owner_id = owner["id"]
    assert owner["legal_name"] == "SKJ Holdings Pty Ltd"
    assert owner["property_count"] == 0
    assert owner["properties"] == []

    listed = client.get(f"/api/v1/owners?entity_id={entity_id}")
    assert listed.status_code == 200
    assert any(row["id"] == owner_id for row in listed.json())

    patched = client.patch(
        f"/api/v1/owners/{owner_id}",
        json={"billing_contact_name": "Temba"},
    )
    assert patched.status_code == 200
    assert patched.json()["billing_contact_name"] == "Temba"

    deleted = client.delete(f"/api/v1/owners/{owner_id}")
    assert deleted.status_code == 204

    gone = client.get(f"/api/v1/owners/{owner_id}")
    assert gone.status_code == 404


def test_owner_detail_shows_linked_properties(client: TestClient, session: Session) -> None:
    entity = _entity(session)
    owner = Owner(entity_id=entity.id, legal_name="Linked Owner Pty Ltd")
    prop = Property(
        entity_id=entity.id,
        name="Linked St",
        street_address="9 Linked St",
        property_type=PropertyType.commercial_office,
    )
    session.add_all([owner, prop])
    session.flush()
    session.add(PropertyOwner(property_id=prop.id, owner_id=owner.id, split_pct=100))
    session.commit()

    detail = client.get(f"/api/v1/owners/{owner.id}")
    assert detail.status_code == 200
    body = detail.json()
    assert body["property_count"] == 1
    assert body["properties"][0]["property_name"] == "Linked St"
    assert body["properties"][0]["split_pct"] == 100.0


def test_statements_route_still_resolves(client: TestClient, session: Session) -> None:
    # /owners/statements must NOT be shadowed by /owners/{owner_id}.
    entity_id = str(_entity(session).id)
    resp = client.get(f"/api/v1/owners/statements?entity_id={entity_id}&month=2026-04")
    assert resp.status_code == 200


def test_create_owner_requires_an_identity_field(
    client: TestClient, session: Session
) -> None:
    entity_id = str(_entity(session).id)
    resp = client.post("/api/v1/owners", json={"entity_id": entity_id})
    assert resp.status_code == 422
