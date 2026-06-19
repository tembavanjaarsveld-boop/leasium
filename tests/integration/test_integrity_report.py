"""Read-only integrity report for live-register cleanup planning."""

from datetime import UTC, date, datetime

from scripts.integrity_report import build_report, format_report
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import (
    DocumentCategory,
    Entity,
    GstTreatment,
    Lease,
    LeaseStatus,
    Obligation,
    ObligationCategory,
    ObligationStatus,
    Property,
    PropertyType,
    RentChargeRule,
    RentChargeType,
    RentFrequency,
    StoredDocument,
    TenancyUnit,
    Tenant,
)


def _entity(session: Session) -> Entity:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return entity


def _property(
    session: Session,
    entity: Entity,
    name: str,
    *,
    deleted: bool = False,
) -> Property:
    prop = Property(
        entity_id=entity.id,
        name=name,
        street_address="205 Leitchs Road",
        country_code="AU",
        property_type=PropertyType.other,
        property_metadata={},
        deleted_at=datetime(2026, 6, 1, tzinfo=UTC) if deleted else None,
    )
    session.add(prop)
    session.flush()
    return prop


def _unit(
    session: Session,
    prop: Property,
    label: str,
    *,
    deleted: bool = False,
) -> TenancyUnit:
    unit = TenancyUnit(
        property_id=prop.id,
        unit_label=label,
        unit_metadata={},
        deleted_at=datetime(2026, 6, 1, tzinfo=UTC) if deleted else None,
    )
    session.add(unit)
    session.flush()
    return unit


def _tenant(
    session: Session,
    entity: Entity,
    name: str,
    *,
    abn: str | None = None,
) -> Tenant:
    tenant = Tenant(entity_id=entity.id, legal_name=name, abn=abn)
    session.add(tenant)
    session.flush()
    return tenant


def test_integrity_report_finds_register_defects_without_mutating(session: Session) -> None:
    entity = _entity(session)
    live_property = _property(session, entity, "Building 6")
    dead_property = _property(session, entity, "Merged Unit 4", deleted=True)
    live_unit = _unit(session, live_property, "Unit 1")
    orphan_unit = _unit(session, dead_property, "Unit 4")
    dead_unit = _unit(session, live_property, "Unit 5", deleted=True)
    tenant = _tenant(session, entity, "Acme Pty Ltd", abn="12 345 678 901")
    _tenant(session, entity, "Acme Pty Ltd", abn=None)
    _tenant(session, entity, "ACME PTY LTD", abn=None)
    _tenant(session, entity, "Other Legal Name", abn="12345678901")
    deleted_lease = Lease(
        tenancy_unit_id=live_unit.id,
        tenant_id=tenant.id,
        status=LeaseStatus.active,
        deleted_at=datetime(2026, 6, 1, tzinfo=UTC),
    )
    broken_lease = Lease(
        tenancy_unit_id=dead_unit.id,
        tenant_id=tenant.id,
        status=LeaseStatus.active,
    )
    session.add_all([deleted_lease, broken_lease])
    session.flush()
    obligation = Obligation(
        entity_id=entity.id,
        property_id=dead_property.id,
        tenancy_unit_id=dead_unit.id,
        lease_id=deleted_lease.id,
        title="Insurance evidence",
        category=ObligationCategory.insurance,
        status=ObligationStatus.upcoming,
        due_date=date(2026, 7, 1),
    )
    document = StoredDocument(
        entity_id=entity.id,
        property_id=dead_property.id,
        tenancy_unit_id=dead_unit.id,
        tenant_id=tenant.id,
        lease_id=deleted_lease.id,
        filename="lease.pdf",
        content_type="application/pdf",
        byte_size=7,
        file_data=b"content",
        category=DocumentCategory.lease,
    )
    charge_rule = RentChargeRule(
        lease_id=deleted_lease.id,
        charge_type=RentChargeType.base_rent,
        amount_cents=100_00,
        frequency=RentFrequency.monthly,
        gst_treatment=GstTreatment.taxable,
    )
    other_entity = Entity(organisation_id=entity.organisation_id, name="Other Entity")
    session.add(other_entity)
    session.flush()
    foreign_property = _property(session, other_entity, "Foreign Deleted Building", deleted=True)
    foreign_unit = _unit(session, foreign_property, "Foreign Unit")
    foreign_tenant = _tenant(session, other_entity, "Foreign Tenant Pty Ltd")
    foreign_active_lease = Lease(
        tenancy_unit_id=foreign_unit.id,
        tenant_id=foreign_tenant.id,
        status=LeaseStatus.active,
    )
    foreign_deleted_lease = Lease(
        tenancy_unit_id=foreign_unit.id,
        tenant_id=foreign_tenant.id,
        status=LeaseStatus.active,
        deleted_at=datetime(2026, 6, 1, tzinfo=UTC),
    )
    session.add_all(
        [obligation, document, charge_rule, foreign_active_lease, foreign_deleted_lease]
    )
    session.flush()
    foreign_charge_rule = RentChargeRule(
        lease_id=foreign_deleted_lease.id,
        charge_type=RentChargeType.base_rent,
        amount_cents=200_00,
        frequency=RentFrequency.monthly,
        gst_treatment=GstTreatment.taxable,
    )
    session.add(foreign_charge_rule)
    session.flush()

    report = build_report(session, entity_id=entity.id)

    assert {row["unit_id"] for row in report["orphan_units"]} == {str(orphan_unit.id)}
    assert {row["lease_id"] for row in report["leases_on_deleted_units"]} == {
        str(broken_lease.id)
    }
    assert {row["abn"] for row in report["duplicate_tenants_by_abn"]} == {
        "12345678901"
    }
    assert {row["name_key"] for row in report["duplicate_tenants_by_name"]} == {
        "acme pty ltd"
    }
    assert {row["record_id"] for row in report["dead_property_references"]} == {
        str(obligation.id),
        str(document.id),
    }
    assert {row["record_id"] for row in report["dead_unit_references"]} == {
        str(obligation.id),
        str(document.id),
        str(broken_lease.id),
    }
    assert {row["record_id"] for row in report["dead_lease_references"]} == {
        str(obligation.id),
        str(document.id),
        str(charge_rule.id),
    }
    assert str(foreign_active_lease.id) not in str(report)
    assert str(foreign_charge_rule.id) not in str(report)
    assert "Dry run only" in format_report(report)

    session.expire_all()
    assert session.get(Property, dead_property.id).deleted_at is not None
    assert session.get(TenancyUnit, orphan_unit.id).property_id == dead_property.id
    assert session.get(Lease, broken_lease.id).tenancy_unit_id == dead_unit.id
