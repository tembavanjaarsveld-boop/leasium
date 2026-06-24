"""Targeted repair helper for known live-register dead references."""

from datetime import UTC, date, datetime

import pytest
from scripts.integrity_report import build_report
from scripts.repair_dead_register_refs import RelinkObligationSpec, SoftDeleteSpec, repair
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import (
    AuditAction,
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


def _property(session: Session, entity: Entity) -> Property:
    prop = Property(
        entity_id=entity.id,
        name="B3 205 Leitchs",
        street_address="205 Leitchs Road",
        country_code="AU",
        property_type=PropertyType.other,
        property_metadata={},
    )
    session.add(prop)
    session.flush()
    return prop


def _unit(session: Session, prop: Property, label: str, *, deleted: bool = False) -> TenancyUnit:
    unit = TenancyUnit(
        property_id=prop.id,
        unit_label=label,
        unit_metadata={},
        deleted_at=datetime(2026, 6, 1, tzinfo=UTC) if deleted else None,
    )
    session.add(unit)
    session.flush()
    return unit


def _tenant(session: Session, entity: Entity) -> Tenant:
    tenant = Tenant(entity_id=entity.id, legal_name="Gorilla Grind Pty Ltd")
    session.add(tenant)
    session.flush()
    return tenant


def _stored_document(
    session: Session,
    entity: Entity,
    prop: Property,
    unit: TenancyUnit,
    tenant: Tenant,
    lease: Lease,
) -> StoredDocument:
    document = StoredDocument(
        entity_id=entity.id,
        property_id=prop.id,
        tenancy_unit_id=unit.id,
        tenant_id=tenant.id,
        lease_id=lease.id,
        filename="lease.pdf",
        content_type="application/pdf",
        byte_size=7,
        file_data=b"content",
        category=DocumentCategory.lease,
    )
    session.add(document)
    session.flush()
    return document


def _dead_reference_fixture(session: Session) -> dict[str, object]:
    entity = _entity(session)
    prop = _property(session, entity)
    live_unit = _unit(session, prop, "Unit 1 & Unit 3")
    dead_unit = _unit(session, prop, "Unit 3", deleted=True)
    tenant = _tenant(session, entity)
    blank_pending_lease = Lease(
        tenancy_unit_id=dead_unit.id,
        tenant_id=tenant.id,
        status=LeaseStatus.pending,
    )
    live_lease = Lease(
        tenancy_unit_id=live_unit.id,
        tenant_id=tenant.id,
        status=LeaseStatus.active,
        commencement_date=date(2024, 1, 29),
        expiry_date=date(2027, 12, 10),
    )
    old_deleted_lease = Lease(
        tenancy_unit_id=live_unit.id,
        tenant_id=tenant.id,
        status=LeaseStatus.active,
        deleted_at=datetime(2026, 6, 1, tzinfo=UTC),
    )
    session.add_all([blank_pending_lease, live_lease, old_deleted_lease])
    session.flush()
    duplicate_obligation = Obligation(
        entity_id=entity.id,
        property_id=prop.id,
        tenancy_unit_id=live_unit.id,
        lease_id=old_deleted_lease.id,
        title="Lease expiry",
        category=ObligationCategory.lease_expiry,
        status=ObligationStatus.upcoming,
        due_date=date(2027, 12, 10),
    )
    unique_obligation = Obligation(
        entity_id=entity.id,
        property_id=prop.id,
        tenancy_unit_id=live_unit.id,
        lease_id=old_deleted_lease.id,
        title="Return premises at end of term",
        category=ObligationCategory.other,
        status=ObligationStatus.upcoming,
        due_date=date(2027, 12, 10),
    )
    duplicate_rule = RentChargeRule(
        lease_id=old_deleted_lease.id,
        charge_type=RentChargeType.base_rent,
        amount_cents=7_916_00,
        frequency=RentFrequency.monthly,
        gst_treatment=GstTreatment.taxable,
    )
    session.add_all([duplicate_obligation, unique_obligation, duplicate_rule])
    session.flush()
    duplicate_document = _stored_document(
        session, entity, prop, live_unit, tenant, old_deleted_lease
    )
    session.flush()
    return {
        "entity": entity,
        "blank_pending_lease": blank_pending_lease,
        "live_lease": live_lease,
        "duplicate_obligation": duplicate_obligation,
        "unique_obligation": unique_obligation,
        "duplicate_rule": duplicate_rule,
        "duplicate_document": duplicate_document,
    }


def test_repair_dead_refs_dry_run_mutates_nothing(session: Session) -> None:
    rows = _dead_reference_fixture(session)
    specs = [
        SoftDeleteSpec("lease", rows["blank_pending_lease"].id, "blank pending duplicate"),
        SoftDeleteSpec("obligation", rows["duplicate_obligation"].id, "duplicate obligation"),
        SoftDeleteSpec("stored_document", rows["duplicate_document"].id, "duplicate document"),
        SoftDeleteSpec("rent_charge_rule", rows["duplicate_rule"].id, "duplicate rent rule"),
        RelinkObligationSpec(
            rows["unique_obligation"].id,
            rows["duplicate_obligation"].lease_id,
            rows["live_lease"].id,
            "preserve unique obligation",
        ),
    ]

    actions = repair(session, specs, apply=False)

    assert [action["status"] for action in actions] == ["planned"] * 5
    session.expire_all()
    assert session.get(Lease, rows["blank_pending_lease"].id).deleted_at is None
    assert session.get(Obligation, rows["duplicate_obligation"].id).deleted_at is None
    assert session.get(StoredDocument, rows["duplicate_document"].id).deleted_at is None
    assert session.get(RentChargeRule, rows["duplicate_rule"].id).deleted_at is None
    assert session.get(Obligation, rows["unique_obligation"].id).lease_id == rows[
        "duplicate_obligation"
    ].lease_id
    audit_row = session.scalar(
        select(AuditAction).where(AuditAction.tool_name == "integrity_repair")
    )
    assert audit_row is None


def test_repair_dead_refs_apply_cleans_report_and_audits(session: Session) -> None:
    rows = _dead_reference_fixture(session)
    specs = [
        SoftDeleteSpec("lease", rows["blank_pending_lease"].id, "blank pending duplicate"),
        SoftDeleteSpec("obligation", rows["duplicate_obligation"].id, "duplicate obligation"),
        SoftDeleteSpec("stored_document", rows["duplicate_document"].id, "duplicate document"),
        SoftDeleteSpec("rent_charge_rule", rows["duplicate_rule"].id, "duplicate rent rule"),
        RelinkObligationSpec(
            rows["unique_obligation"].id,
            rows["duplicate_obligation"].lease_id,
            rows["live_lease"].id,
            "preserve unique obligation",
        ),
    ]

    actions = repair(session, specs, apply=True)

    assert [action["status"] for action in actions] == ["applied"] * 5
    session.expire_all()
    assert session.get(Lease, rows["blank_pending_lease"].id).deleted_at is not None
    assert session.get(Obligation, rows["duplicate_obligation"].id).deleted_at is not None
    assert session.get(StoredDocument, rows["duplicate_document"].id).deleted_at is not None
    assert session.get(RentChargeRule, rows["duplicate_rule"].id).deleted_at is not None
    assert session.get(Obligation, rows["unique_obligation"].id).lease_id == rows["live_lease"].id
    report = build_report(session, entity_id=rows["entity"].id)
    assert report["leases_on_deleted_units"] == []
    assert report["dead_unit_references"] == []
    assert report["dead_lease_references"] == []
    audit_rows = list(
        session.scalars(
            select(AuditAction)
            .where(AuditAction.tool_name == "integrity_repair")
            .order_by(AuditAction.occurred_at.asc())
        )
    )
    assert [row.target_table for row in audit_rows] == [
        "lease",
        "obligation",
        "stored_document",
        "rent_charge_rule",
        "obligation",
    ]


def test_repair_dead_refs_aborts_when_relink_source_does_not_match(session: Session) -> None:
    rows = _dead_reference_fixture(session)

    with pytest.raises(SystemExit, match="expected source lease"):
        repair(
            session,
            [
                RelinkObligationSpec(
                    rows["unique_obligation"].id,
                    rows["live_lease"].id,
                    rows["live_lease"].id,
                    "wrong source",
                )
            ],
            apply=True,
        )
