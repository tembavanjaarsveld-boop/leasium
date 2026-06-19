"""Read-only live-register integrity report.

The report is dry-run only: it prints data-quality findings and never mutates
the register or calls providers.
"""

from __future__ import annotations

import argparse
import re
from collections import defaultdict
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.db import SessionLocal
from stewart.core.models import (
    Lease,
    Obligation,
    Property,
    RentChargeRule,
    StoredDocument,
    TenancyUnit,
    Tenant,
)

Report = dict[str, list[dict[str, str]]]


def _abn_key(value: str | None) -> str | None:
    digits = re.sub(r"\D+", "", value or "")
    return digits or None


def _name_key(value: str | None) -> str | None:
    normalized = re.sub(r"\s+", " ", (value or "").strip()).lower()
    return normalized or None


def _base_report() -> Report:
    return {
        "orphan_units": [],
        "leases_on_deleted_properties": [],
        "leases_on_deleted_units": [],
        "duplicate_tenants_by_abn": [],
        "duplicate_tenants_by_name": [],
        "dead_property_references": [],
        "dead_unit_references": [],
        "dead_lease_references": [],
    }


def _property_canonical_lookup(properties: list[Property]) -> dict[str, dict[str, str]]:
    lookup: dict[str, dict[str, str]] = {}
    for prop in properties:
        if prop.deleted_at is not None:
            continue
        for source in prop.property_metadata.get("reconciled_from") or []:
            if not isinstance(source, dict):
                continue
            source_id = str(source.get("property_id") or "")
            if source_id:
                lookup[source_id] = {
                    "canonical_property_id": str(prop.id),
                    "canonical_property_name": prop.name,
                }
    return lookup


def _record_row(record_type: str, record_id: Any, **extra: Any) -> dict[str, str]:
    row = {"record_type": record_type, "record_id": str(record_id)}
    for key, value in extra.items():
        if value is not None:
            row[key] = str(value)
    return row


def _append_property_reference(
    report: Report,
    *,
    record_type: str,
    record_id: Any,
    prop: Property,
    canonical_lookup: dict[str, dict[str, str]],
) -> None:
    row = _record_row(
        record_type,
        record_id,
        property_id=prop.id,
        property_name=prop.name,
    )
    row.update(canonical_lookup.get(str(prop.id), {}))
    report["dead_property_references"].append(row)


def _property_for_unit(
    session: Session,
    unit: TenancyUnit,
    properties_by_id: dict[UUID, Property],
    entity_id: UUID | None,
) -> Property | None:
    prop = properties_by_id.get(unit.property_id)
    if prop is None and entity_id is None:
        prop = session.get(Property, unit.property_id)
    if prop is None:
        return None
    if entity_id is not None and prop.entity_id != entity_id:
        return None
    return prop


def _lease_in_scope(
    session: Session,
    lease: Lease,
    properties_by_id: dict[UUID, Property],
    entity_id: UUID | None,
) -> bool:
    unit = session.get(TenancyUnit, lease.tenancy_unit_id)
    if unit is None:
        return False
    return _property_for_unit(session, unit, properties_by_id, entity_id) is not None


def build_report(session: Session, *, entity_id: UUID | None = None) -> Report:
    """Return grouped data-integrity findings without mutating the database."""

    report = _base_report()

    property_statement = select(Property)
    tenant_statement = select(Tenant).where(Tenant.deleted_at.is_(None))
    obligation_statement = select(Obligation).where(Obligation.deleted_at.is_(None))
    document_statement = select(StoredDocument).where(StoredDocument.deleted_at.is_(None))
    if entity_id is not None:
        property_statement = property_statement.where(Property.entity_id == entity_id)
        tenant_statement = tenant_statement.where(Tenant.entity_id == entity_id)
        obligation_statement = obligation_statement.where(Obligation.entity_id == entity_id)
        document_statement = document_statement.where(StoredDocument.entity_id == entity_id)

    properties = list(session.scalars(property_statement))
    properties_by_id = {prop.id: prop for prop in properties}
    canonical_lookup = _property_canonical_lookup(properties)

    units = list(session.scalars(select(TenancyUnit).where(TenancyUnit.deleted_at.is_(None))))
    for unit in units:
        prop = properties_by_id.get(unit.property_id)
        if prop is not None and prop.deleted_at is not None:
            row = {
                "unit_id": str(unit.id),
                "unit_label": unit.unit_label,
                "property_id": str(prop.id),
                "property_name": prop.name,
            }
            row.update(canonical_lookup.get(str(prop.id), {}))
            report["orphan_units"].append(row)

    leases = list(session.scalars(select(Lease).where(Lease.deleted_at.is_(None))))
    for lease in leases:
        unit = session.get(TenancyUnit, lease.tenancy_unit_id)
        if unit is None:
            continue
        prop = _property_for_unit(session, unit, properties_by_id, entity_id)
        if prop is None:
            continue
        if unit.deleted_at is not None:
            report["leases_on_deleted_units"].append(
                _record_row(
                    "lease",
                    lease.id,
                    lease_id=lease.id,
                    tenancy_unit_id=unit.id,
                    unit_label=unit.unit_label,
                )
            )
            report["dead_unit_references"].append(
                _record_row("lease", lease.id, tenancy_unit_id=unit.id, unit_label=unit.unit_label)
            )
        if prop.deleted_at is not None:
            row = _record_row(
                "lease",
                lease.id,
                property_id=prop.id,
                property_name=prop.name,
                tenancy_unit_id=unit.id,
            )
            row.update(canonical_lookup.get(str(prop.id), {}))
            report["leases_on_deleted_properties"].append(row)

    tenants = list(session.scalars(tenant_statement))
    tenants_by_abn: dict[str, list[Tenant]] = defaultdict(list)
    tenants_by_name: dict[str, list[Tenant]] = defaultdict(list)
    for tenant in tenants:
        if abn := _abn_key(tenant.abn):
            tenants_by_abn[abn].append(tenant)
        if name := _name_key(tenant.legal_name):
            tenants_by_name[name].append(tenant)
    for abn, group in tenants_by_abn.items():
        if len(group) > 1:
            report["duplicate_tenants_by_abn"].append(
                {
                    "abn": abn,
                    "tenant_ids": ",".join(str(tenant.id) for tenant in group),
                    "tenant_names": " | ".join(tenant.legal_name for tenant in group),
                }
            )
    for name_key, group in tenants_by_name.items():
        if len(group) > 1:
            report["duplicate_tenants_by_name"].append(
                {
                    "name_key": name_key,
                    "tenant_ids": ",".join(str(tenant.id) for tenant in group),
                    "tenant_names": " | ".join(tenant.legal_name for tenant in group),
                }
            )

    for obligation in session.scalars(obligation_statement):
        if obligation.property_id is not None:
            prop = properties_by_id.get(obligation.property_id) or session.get(
                Property, obligation.property_id
            )
            if prop is not None and prop.deleted_at is not None:
                _append_property_reference(
                    report,
                    record_type="obligation",
                    record_id=obligation.id,
                    prop=prop,
                    canonical_lookup=canonical_lookup,
                )
        if obligation.tenancy_unit_id is not None:
            unit = session.get(TenancyUnit, obligation.tenancy_unit_id)
            if unit is not None and unit.deleted_at is not None:
                report["dead_unit_references"].append(
                    _record_row(
                        "obligation",
                        obligation.id,
                        tenancy_unit_id=unit.id,
                        unit_label=unit.unit_label,
                    )
                )
        if obligation.lease_id is not None:
            lease = session.get(Lease, obligation.lease_id)
            if lease is not None and lease.deleted_at is not None:
                report["dead_lease_references"].append(
                    _record_row("obligation", obligation.id, lease_id=lease.id)
                )

    for document in session.scalars(document_statement):
        if document.property_id is not None:
            prop = properties_by_id.get(document.property_id) or session.get(
                Property, document.property_id
            )
            if prop is not None and prop.deleted_at is not None:
                _append_property_reference(
                    report,
                    record_type="stored_document",
                    record_id=document.id,
                    prop=prop,
                    canonical_lookup=canonical_lookup,
                )
        if document.tenancy_unit_id is not None:
            unit = session.get(TenancyUnit, document.tenancy_unit_id)
            if unit is not None and unit.deleted_at is not None:
                report["dead_unit_references"].append(
                    _record_row(
                        "stored_document",
                        document.id,
                        tenancy_unit_id=unit.id,
                        unit_label=unit.unit_label,
                    )
                )
        if document.lease_id is not None:
            lease = session.get(Lease, document.lease_id)
            if lease is not None and lease.deleted_at is not None:
                report["dead_lease_references"].append(
                    _record_row("stored_document", document.id, lease_id=lease.id)
                )

    for rule in session.scalars(select(RentChargeRule).where(RentChargeRule.deleted_at.is_(None))):
        lease = session.get(Lease, rule.lease_id)
        if lease is None:
            continue
        if not _lease_in_scope(session, lease, properties_by_id, entity_id):
            continue
        if lease.deleted_at is not None:
            report["dead_lease_references"].append(
                _record_row("rent_charge_rule", rule.id, lease_id=lease.id)
            )

    return report


def format_report(report: Report) -> str:
    """Render a concise operator-review report."""

    lines = ["Live register integrity report", "Dry run only. No records were changed."]
    for group, rows in report.items():
        lines.append("")
        lines.append(f"{group}: {len(rows)}")
        for row in rows:
            details = ", ".join(f"{key}={value}" for key, value in row.items())
            lines.append(f"  - {details}")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Print a read-only register integrity report.")
    parser.add_argument("--entity", default=None, help="restrict to one entity id")
    args = parser.parse_args()

    entity_id = UUID(args.entity) if args.entity else None
    with SessionLocal() as session:
        print(format_report(build_report(session, entity_id=entity_id)))


if __name__ == "__main__":
    main()
