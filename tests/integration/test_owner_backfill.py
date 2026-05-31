"""Owner backfill from Property owner-fields — DoorLoop benchmark P0, Ticket 1.2.

Idempotent: groups non-deleted properties by the same owner-identity tuple the
statements router uses, creates one Owner per distinct identity, links each
property at a 100% split, and skips unattributed properties. Re-running the
backfill creates nothing new.
"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session
from stewart.core.models import Entity, Owner, Property, PropertyOwner, PropertyType
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


def test_backfill_groups_dedupes_and_links(session: Session) -> None:
    entity = _entity(session)
    # Two properties share owner identity A; one is identity B; one unattributed.
    session.add_all(
        [
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
            _prop(entity.id, "U1"),  # no owner fields → unattributed
        ]
    )
    session.commit()

    result = backfill_owners(session)
    assert result.owners_created == 2
    assert result.owners_reused == 0
    assert result.links_created == 3
    assert result.properties_unattributed == 1

    owners = list(
        session.scalars(select(Owner).where(Owner.entity_id == entity.id)).all()
    )
    assert len(owners) == 2
    by_name = {owner.legal_name: owner for owner in owners}
    skj = by_name["SKJ Holdings Pty Ltd"]
    assert skj.trust_name == "SKJ Family Trust"

    skj_links = list(
        session.scalars(
            select(PropertyOwner).where(PropertyOwner.owner_id == skj.id)
        ).all()
    )
    assert len(skj_links) == 2
    assert all(link.split_pct == 100.0 for link in skj_links)


def test_backfill_is_idempotent(session: Session) -> None:
    entity = _entity(session)
    session.add(_prop(entity.id, "Solo", owner_legal_name="Solo Owner Pty Ltd"))
    session.commit()

    first = backfill_owners(session)
    assert first.owners_created == 1
    assert first.links_created == 1

    second = backfill_owners(session)
    assert second.owners_created == 0
    assert second.owners_reused == 1
    assert second.links_created == 0
    assert second.links_existing == 1

    owner_count = session.scalar(
        select(func.count()).select_from(Owner).where(Owner.entity_id == entity.id)
    )
    assert owner_count == 1
