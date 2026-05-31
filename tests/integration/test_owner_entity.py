"""Owner entity + PropertyOwner association — DoorLoop benchmark P0, Ticket 1.1.

Owner becomes a first-class record. Previously the owner lived only as ~11 fields
on ``Property``; this ORM-level test proves the new ``Owner`` model, the
``PropertyOwner`` association, and ownership splits round-trip through the DB.

Out of scope here (later tickets): the HTTP CRUD API (Ticket 1.4), the backfill
from Property fields (Ticket 1.2), and the owner-statement read-path cutover
(Ticket 1.3).
"""

from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import Entity, Owner, Property, PropertyOwner, PropertyType


def _entity(session: Session) -> Entity:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return entity


def test_owner_links_multiple_properties_with_splits(session: Session) -> None:
    entity = _entity(session)
    owner = Owner(
        entity_id=entity.id,
        legal_name="SKJ Holdings Pty Ltd",
        abn="11222333444",
        trust_name="SKJ Family Trust",
        billing_email="owners@skjcapital.com",
        gst_registered=True,
    )
    p1 = Property(
        entity_id=entity.id,
        name="123 King St",
        street_address="123 King St",
        property_type=PropertyType.commercial_office,
    )
    p2 = Property(
        entity_id=entity.id,
        name="45 Queen St",
        street_address="45 Queen St",
        property_type=PropertyType.commercial_retail,
    )
    session.add_all([owner, p1, p2])
    session.flush()

    session.add_all(
        [
            PropertyOwner(property_id=p1.id, owner_id=owner.id, split_pct=60),
            PropertyOwner(property_id=p2.id, owner_id=owner.id, split_pct=40),
        ]
    )
    session.commit()

    reloaded = session.scalar(select(Owner).where(Owner.id == owner.id))
    assert reloaded is not None
    assert reloaded.legal_name == "SKJ Holdings Pty Ltd"
    assert reloaded.trust_name == "SKJ Family Trust"
    assert reloaded.gst_registered is True

    splits = sorted(link.split_pct for link in reloaded.property_links)
    assert splits == [40.0, 60.0]
    assert {link.property_id for link in reloaded.property_links} == {p1.id, p2.id}

    # Back-reference resolves from the property side.
    reloaded_p1 = session.scalar(select(Property).where(Property.id == p1.id))
    assert reloaded_p1 is not None
    assert [link.owner_id for link in reloaded_p1.owner_links] == [owner.id]


def test_property_owner_defaults_split_to_full(session: Session) -> None:
    entity = _entity(session)
    owner = Owner(entity_id=entity.id, legal_name="Sole Owner Pty Ltd")
    prop = Property(
        entity_id=entity.id,
        name="Sole St",
        street_address="1 Sole St",
        property_type=PropertyType.commercial_office,
    )
    session.add_all([owner, prop])
    session.flush()

    link = PropertyOwner(property_id=prop.id, owner_id=owner.id)
    session.add(link)
    session.commit()

    reloaded = session.scalar(select(PropertyOwner).where(PropertyOwner.id == link.id))
    assert reloaded is not None
    assert reloaded.split_pct == 100.0
