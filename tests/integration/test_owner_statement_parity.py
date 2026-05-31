"""Parity: Owner/PropertyOwner grouping == legacy statements grouping.

DoorLoop benchmark P0, Ticket 1.3 (de-risk). Proves the backfilled ``Owner``
data reproduces the exact owner -> properties clusters the statements endpoint
computes today from ``Property`` identity tuples — so the planned read-path
cutover can be a small, reviewed change with this test as the safety net.

This test deliberately does NOT change ``/owners/statements``; it only asserts
the new data model is grouping-equivalent to the legacy logic.
"""

from apps.api.routers.owners import _owner_identity_tuple
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import Entity, Property, PropertyOwner, PropertyType
from stewart.core.owner_backfill import backfill_owners


def _entity(session: Session) -> Entity:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return entity


def _prop(entity_id, name: str, **owner_fields) -> Property:
    return Property(
        entity_id=entity_id,
        name=name,
        street_address=f"{name} address",
        property_type=PropertyType.commercial_office,
        **owner_fields,
    )


def test_owner_grouping_matches_legacy_identity_tuple(session: Session) -> None:
    entity = _entity(session)
    props = [
        _prop(
            entity.id,
            "A1",
            owner_legal_name="SKJ Holdings Pty Ltd",
            trust_name="SKJ Family Trust",
        ),
        _prop(
            entity.id,
            "A2",
            owner_legal_name="SKJ Holdings Pty Ltd",
            trust_name="SKJ Family Trust",
        ),
        _prop(entity.id, "B1", owner_legal_name="Queen St Investments Pty Ltd"),
        _prop(entity.id, "C1", trustee_name="ABC Pty Ltd", trust_name="ABC Trust"),
        _prop(entity.id, "U1"),  # unattributed
        _prop(entity.id, "U2"),  # unattributed
    ]
    session.add_all(props)
    session.commit()

    backfill_owners(session)

    # Legacy partition: identity tuple -> set(property_ids), split attributed/unattributed.
    legacy_clusters: dict[tuple, set] = {}
    legacy_unattributed: set = set()
    for prop in props:
        identity = _owner_identity_tuple(prop)
        if all(part is None for part in identity):
            legacy_unattributed.add(prop.id)
        else:
            legacy_clusters.setdefault(identity, set()).add(prop.id)
    legacy_partition = {frozenset(ids) for ids in legacy_clusters.values()}

    # Owner partition: owner_id -> set(property_ids) from PropertyOwner.
    owner_clusters: dict = {}
    linked_property_ids: set = set()
    for owner_id, property_id in session.execute(
        select(PropertyOwner.owner_id, PropertyOwner.property_id)
    ).all():
        owner_clusters.setdefault(owner_id, set()).add(property_id)
        linked_property_ids.add(property_id)
    owner_partition = {frozenset(ids) for ids in owner_clusters.values()}

    # The attributed clusters must match exactly.
    assert owner_partition == legacy_partition
    # And the unlinked properties are exactly the legacy "Unattributed" bucket.
    all_ids = {prop.id for prop in props}
    assert (all_ids - linked_property_ids) == legacy_unattributed
