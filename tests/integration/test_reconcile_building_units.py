"""Reconcile per-unit properties into one building property with units underneath."""

from datetime import UTC, datetime

from scripts.reconcile_building_units import reconcile
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import (
    Entity,
    Lease,
    LeaseStatus,
    Property,
    PropertyType,
    TenancyUnit,
    Tenant,
)


def _entity(session: Session) -> Entity:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return entity


def _property(
    session: Session, entity: Entity, name: str, street: str, created: datetime
) -> Property:
    prop = Property(
        entity_id=entity.id,
        name=name,
        street_address=street,
        country_code="AU",
        property_type=PropertyType.other,
        property_metadata={},
        created_at=created,
    )
    session.add(prop)
    session.flush()
    return prop


def _unit(session: Session, prop: Property, label: str) -> TenancyUnit:
    unit = TenancyUnit(property_id=prop.id, unit_label=label, unit_metadata={})
    session.add(unit)
    session.flush()
    return unit


def test_reconcile_merges_building_units(session: Session) -> None:
    entity = _entity(session)
    # Established register record (earliest) becomes the canonical building.
    p_u4 = _property(
        session, entity, "Leitchs B6 U4", "205 Leitchs Road, Brendale",
        datetime(2024, 1, 1, tzinfo=UTC),
    )
    u4 = _unit(session, p_u4, "U4")
    # The duplicate the AI created later, with the unit inline in the name.
    p_u5 = _property(
        session, entity, "Building 6, Unit 5, 205 Leitchs Road", "205 Leitchs Road",
        datetime(2026, 6, 16, tzinfo=UTC),
    )
    u5 = _unit(session, p_u5, "Unit 5")
    tenant = Tenant(entity_id=entity.id, legal_name="SKJ Capital U5")
    session.add(tenant)
    session.flush()
    lease = Lease(tenancy_unit_id=u5.id, tenant_id=tenant.id, status=LeaseStatus.active)
    session.add(lease)
    session.flush()

    plans = reconcile(session, match="leitchs", entity_id=entity.id, apply=True)
    assert len(plans) == 1

    session.refresh(p_u4)
    session.refresh(p_u5)
    session.refresh(u5)
    # Canonical survives, renamed to building level and keyed.
    assert p_u4.deleted_at is None
    assert p_u4.name == "Leitchs B6"
    assert p_u4.property_metadata.get("building_key")
    # Duplicate soft-deleted; its unit (and the lease riding it) re-homed.
    assert p_u5.deleted_at is not None
    assert u5.property_id == p_u4.id
    assert session.get(Lease, lease.id).tenancy_unit_id == u5.id
    labels = {
        unit.unit_label
        for unit in session.scalars(
            select(TenancyUnit).where(
                TenancyUnit.property_id == p_u4.id,
                TenancyUnit.deleted_at.is_(None),
            )
        )
    }
    assert labels == {"U4", "Unit 5"}
    assert u4.unit_label == "U4"


def test_reconcile_matches_by_address_when_name_lacks_site(session: Session) -> None:
    """The real B6 case: names are 'Building 6, Unit N' with the site only in the
    address, so --match must search the address as well as the name."""
    entity = _entity(session)
    p_u4 = _property(
        session, entity, "Building 6, Unit 4", "205 Leitchs Road, Brendale QLD 4500",
        datetime(2024, 1, 1, tzinfo=UTC),
    )
    _unit(session, p_u4, "Unit 4")
    p_u5 = _property(
        session, entity, "Building 6, Unit 5", "205 Leitchs Road, Brendale QLD 4500",
        datetime(2026, 6, 16, tzinfo=UTC),
    )
    _unit(session, p_u5, "Unit 5")

    plans = reconcile(session, match="leitchs", entity_id=entity.id, apply=True)
    assert len(plans) == 1
    session.refresh(p_u4)
    session.refresh(p_u5)
    assert p_u4.deleted_at is None
    assert p_u4.name == "Building 6"
    assert p_u5.deleted_at is not None
    labels = {
        unit.unit_label
        for unit in session.scalars(
            select(TenancyUnit).where(
                TenancyUnit.property_id == p_u4.id,
                TenancyUnit.deleted_at.is_(None),
            )
        )
    }
    assert labels == {"Unit 4", "Unit 5"}


def test_reconcile_dry_run_mutates_nothing(session: Session) -> None:
    entity = _entity(session)
    p_u4 = _property(
        session, entity, "Leitchs B6 U4", "205 Leitchs Road, Brendale",
        datetime(2024, 1, 1, tzinfo=UTC),
    )
    _unit(session, p_u4, "U4")
    p_u5 = _property(
        session, entity, "Building 6, Unit 5, 205 Leitchs Road", "205 Leitchs Road",
        datetime(2026, 6, 16, tzinfo=UTC),
    )
    _unit(session, p_u5, "Unit 5")

    plans = reconcile(session, match="leitchs", entity_id=entity.id, apply=False)
    assert len(plans) == 1
    session.refresh(p_u4)
    session.refresh(p_u5)
    assert p_u4.deleted_at is None
    assert p_u5.deleted_at is None
    assert p_u4.name == "Leitchs B6 U4"  # unchanged by a dry run
