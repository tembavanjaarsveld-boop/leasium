"""Owner <-> property link management API — DoorLoop benchmark P0 (Owner usability).

Attach / update-split / detach a property on an owner so the People hub can
curate ownership beyond the legacy-field backfill (Ticket 1.2). Cross-entity
links and out-of-range splits are rejected.
"""

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from stewart.core.models import Entity, Owner, Property, PropertyOwner, PropertyType
from stewart.core.settings import get_settings


def _entity(session: Session) -> Entity:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return entity


def _make_owner(session: Session, entity_id, name: str = "Link Owner Pty Ltd") -> Owner:
    owner = Owner(entity_id=entity_id, legal_name=name)
    session.add(owner)
    session.commit()
    return owner


def _make_property(session: Session, entity_id, name: str) -> Property:
    prop = Property(
        entity_id=entity_id,
        name=name,
        street_address=f"{name} address",
        property_type=PropertyType.commercial_office,
    )
    session.add(prop)
    session.commit()
    return prop


def test_attach_update_and_detach_property(client: TestClient, session: Session) -> None:
    entity = _entity(session)
    owner = _make_owner(session, entity.id)
    prop = _make_property(session, entity.id, "Link St")

    attached = client.post(
        f"/api/v1/owners/{owner.id}/properties",
        json={"property_id": str(prop.id), "split_pct": 60},
    )
    assert attached.status_code == 200, attached.text
    body = attached.json()
    assert body["property_count"] == 1
    assert body["properties"][0]["property_id"] == str(prop.id)
    assert body["properties"][0]["split_pct"] == 60.0

    # Re-attaching the same property updates the split (upsert), no duplicate link.
    updated = client.post(
        f"/api/v1/owners/{owner.id}/properties",
        json={"property_id": str(prop.id), "split_pct": 100},
    )
    assert updated.status_code == 200
    assert updated.json()["properties"][0]["split_pct"] == 100.0
    link_count = session.scalar(
        select(func.count())
        .select_from(PropertyOwner)
        .where(PropertyOwner.owner_id == owner.id)
    )
    assert link_count == 1

    detached = client.delete(f"/api/v1/owners/{owner.id}/properties/{prop.id}")
    assert detached.status_code == 204
    detail = client.get(f"/api/v1/owners/{owner.id}")
    assert detail.json()["property_count"] == 0


def test_detach_missing_link_returns_404(client: TestClient, session: Session) -> None:
    entity = _entity(session)
    owner = _make_owner(session, entity.id)
    prop = _make_property(session, entity.id, "Unlinked St")
    resp = client.delete(f"/api/v1/owners/{owner.id}/properties/{prop.id}")
    assert resp.status_code == 404


def test_attach_rejects_cross_entity_property(client: TestClient, session: Session) -> None:
    entity = _entity(session)
    owner = _make_owner(session, entity.id)
    settings = get_settings()
    other = Entity(organisation_id=settings.dev_organisation_id, name="Other Entity Pty Ltd")
    session.add(other)
    session.commit()
    foreign = _make_property(session, other.id, "Foreign St")

    resp = client.post(
        f"/api/v1/owners/{owner.id}/properties",
        json={"property_id": str(foreign.id)},
    )
    assert resp.status_code == 422


def test_attach_rejects_out_of_range_split(client: TestClient, session: Session) -> None:
    entity = _entity(session)
    owner = _make_owner(session, entity.id)
    prop = _make_property(session, entity.id, "Range St")
    resp = client.post(
        f"/api/v1/owners/{owner.id}/properties",
        json={"property_id": str(prop.id), "split_pct": 150},
    )
    assert resp.status_code == 422
