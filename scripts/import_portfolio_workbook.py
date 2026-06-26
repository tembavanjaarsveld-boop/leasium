"""One-off loader for the SKJ portfolio source-of-truth workbook.

This is deliberately operational rather than a polished migration surface:
it imports the current workbook into the existing Relby registers and keeps
source metadata so a later review/apply UI can build on the same provenance.
"""

from __future__ import annotations

import argparse
import os
import re
from collections import Counter
from datetime import date, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from stewart.core.db import utcnow
from stewart.core.models import (
    Entity,
    GstTreatment,
    Lease,
    LeaseStatus,
    Obligation,
    ObligationCategory,
    ObligationStatus,
    Property,
    RentChargeRule,
    RentChargeType,
    RentFrequency,
    TenancyUnit,
    Tenant,
)
from stewart.core.settings import Settings
from stewart.domain.register_import import (
    SheetRows,
    _date_value,
    _key,
    _lease_status_bucket,
    _money_cents,
    _obligation_category,
    _property_type,
    _text,
    load_register_workbook,
)

SOURCE_KEY = "skj_portfolio_source_of_truth_2026_05_19"
EMAIL_RE = re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(r"(?:\+?61|0)[\d\s().-]{7,}")


def _metadata(value: dict[str, Any] | None) -> dict[str, Any]:
    return dict(value or {})


def _source_meta(sheet: str, row: dict[str, Any], filename: str) -> dict[str, Any]:
    return {
        "portfolio_import_source": SOURCE_KEY,
        "source_workbook": filename,
        "source_sheet": sheet,
        "source_row": row.get("_row"),
    }


def _set_metadata(current: dict[str, Any] | None, **values: Any) -> dict[str, Any]:
    metadata = _metadata(current)
    metadata.update({key: value for key, value in values.items() if value not in ("", None)})
    return metadata


def _rent_frequency(value: Any) -> RentFrequency:
    text = _key(value)
    if "week" in text:
        return RentFrequency.weekly
    if "quarter" in text:
        return RentFrequency.quarterly
    if "annual" in text or "year" in text:
        return RentFrequency.annual
    return RentFrequency.monthly


def _periodic_cents(annual_cents: int, frequency: RentFrequency) -> int:
    divisors = {
        RentFrequency.weekly: 52,
        RentFrequency.monthly: 12,
        RentFrequency.quarterly: 4,
        RentFrequency.annual: 1,
    }
    return int(round(annual_cents / divisors[frequency]))


def _lease_status(value: Any) -> LeaseStatus:
    bucket = _lease_status_bucket(value)
    text = _key(value)
    if "holding" in text:
        return LeaseStatus.holding_over
    if bucket == "archive" or "exited" in text:
        return LeaseStatus.terminated
    if bucket == "pending":
        return LeaseStatus.pending
    if "expired" in text:
        return LeaseStatus.expired
    return LeaseStatus.active


def _priority(value: Any) -> int:
    text = _key(value)
    if "high" in text or "urgent" in text:
        return 1
    if "low" in text:
        return 3
    return 2


def _status_for_due(due_date: date, today: date, source_status: Any = None) -> ObligationStatus:
    if "completed" in _key(source_status):
        return ObligationStatus.completed
    if due_date < today:
        return ObligationStatus.overdue
    if due_date <= today + timedelta(days=30):
        return ObligationStatus.due_soon
    return ObligationStatus.upcoming


def _category(value: Any) -> ObligationCategory:
    raw = _obligation_category(value)
    try:
        return ObligationCategory(raw)
    except ValueError:
        return ObligationCategory.other


def _first_email(value: Any) -> str | None:
    match = EMAIL_RE.search(_text(value))
    return match.group(0) if match else None


def _first_phone(value: Any) -> str | None:
    match = PHONE_RE.search(_text(value))
    if match is None:
        return None
    return " ".join(match.group(0).split())


def _tenant_is_vacant(value: Any) -> bool:
    text = _key(value)
    return not text or text.startswith("vacant") or text in {"-", "—"}


def _sheet(sheets: dict[str, SheetRows], name: str) -> list[dict[str, Any]]:
    return sheets.get(name, SheetRows(name, None, [], [])).rows


def _index_property_codes(properties: list[Property]) -> dict[str, Property]:
    indexed: dict[str, Property] = {}
    for prop in properties:
        code = _key((prop.property_metadata or {}).get("portfolio_code"))
        if code:
            indexed[code] = prop
    return indexed


def _index_property_addresses(properties: list[Property]) -> dict[str, Property]:
    return {_key(prop.street_address): prop for prop in properties if _key(prop.street_address)}


def _archive_seed_data(session: Session, entity_id: UUID, counts: Counter[str]) -> None:
    now = utcnow()
    properties = list(session.scalars(select(Property).where(Property.entity_id == entity_id)))
    seed_property_ids = {
        prop.id
        for prop in properties
        if (prop.property_metadata or {}).get("seed") is True and prop.deleted_at is None
    }
    if seed_property_ids:
        for prop in properties:
            if prop.id in seed_property_ids:
                prop.deleted_at = now
                counts["properties_archived_seed"] += 1
        units = list(
            session.scalars(select(TenancyUnit).where(TenancyUnit.property_id.in_(seed_property_ids)))
        )
        unit_ids = {unit.id for unit in units}
        for unit in units:
            if unit.deleted_at is None:
                unit.deleted_at = now
                counts["tenancy_units_archived_seed"] += 1
        leases = list(session.scalars(select(Lease).where(Lease.tenancy_unit_id.in_(unit_ids))))
        lease_ids = {lease.id for lease in leases}
        for lease in leases:
            if lease.deleted_at is None:
                lease.deleted_at = now
                counts["leases_archived_seed"] += 1
        seed_rules = session.scalars(
            select(RentChargeRule).where(RentChargeRule.lease_id.in_(lease_ids))
        )
        for rule in seed_rules:
            if rule.deleted_at is None:
                rule.deleted_at = now
                counts["charge_rules_archived_seed"] += 1
        for obligation in session.scalars(
            select(Obligation).where(
                (Obligation.property_id.in_(seed_property_ids))
                | (Obligation.tenancy_unit_id.in_(unit_ids))
                | (Obligation.lease_id.in_(lease_ids))
            )
        ):
            if obligation.deleted_at is None:
                obligation.deleted_at = now
                counts["obligations_archived_seed"] += 1

    tenants = list(session.scalars(select(Tenant).where(Tenant.entity_id == entity_id)))
    for tenant in tenants:
        if (tenant.tenant_metadata or {}).get("seed") is True and tenant.deleted_at is None:
            tenant.deleted_at = now
            counts["tenants_archived_seed"] += 1


def _upsert_property(
    session: Session,
    entity_id: UUID,
    row: dict[str, Any],
    filename: str,
    properties_by_code: dict[str, Property],
    properties_by_address: dict[str, Property],
    counts: Counter[str],
) -> Property | None:
    code = _text(row.get("Code"))
    address = _text(row.get("Address"))
    if not code or not address:
        counts["properties_skipped"] += 1
        return None

    prop = properties_by_code.get(_key(code)) or properties_by_address.get(_key(address))
    property_type, needs_review = _property_type(row.get("Property type"))
    if prop is None:
        prop = Property(
            entity_id=entity_id,
            name=f"{code} - {address}",
            street_address=address,
            suburb=_text(row.get("Suburb")) or None,
            state="QLD",
            postcode=None,
            country_code="AU",
            property_type=property_type,
            property_metadata={},
        )
        session.add(prop)
        counts["properties_created"] += 1
    else:
        counts["properties_updated"] += 1

    prop.name = f"{code} - {address}"
    prop.street_address = address
    prop.suburb = _text(row.get("Suburb")) or prop.suburb
    prop.state = prop.state or "QLD"
    prop.property_type = property_type
    prop.owner_legal_name = _text(row.get("Owning entity (legal)")) or prop.owner_legal_name
    prop.ownership_structure = _text(row.get("Role")) or prop.ownership_structure
    prop.property_metadata = _set_metadata(
        prop.property_metadata,
        **_source_meta("Properties", row, filename),
        portfolio_code=code,
        owning_entity_legal=_text(row.get("Owning entity (legal)")),
        role=_text(row.get("Role")),
        original_property_type=_text(row.get("Property type")),
        property_type_needs_review=needs_review,
        active_tenancies=row.get("Active tenancies"),
        source_status=_text(row.get("Status")),
        notes=_text(row.get("Notes")),
    )
    properties_by_code[_key(code)] = prop
    properties_by_address[_key(address)] = prop
    return prop


def _upsert_unit(
    session: Session,
    prop: Property,
    row: dict[str, Any],
    filename: str,
    units_by_key: dict[tuple[UUID, str], TenancyUnit],
    counts: Counter[str],
) -> TenancyUnit | None:
    tenancy_id = _text(row.get("Tenancy ID"))
    label = _text(row.get("Unit code")) or tenancy_id
    if not label:
        counts["tenancy_units_skipped"] += 1
        return None

    key = (prop.id, _key(label))
    unit = units_by_key.get(key)
    if unit is None:
        unit = TenancyUnit(property_id=prop.id, unit_label=label)
        session.add(unit)
        counts["tenancy_units_created"] += 1
    else:
        counts["tenancy_units_updated"] += 1

    size = row.get("Size m²")
    unit.sqm = float(size) if isinstance(size, int | float) else unit.sqm
    unit.unit_metadata = _set_metadata(
        unit.unit_metadata,
        **_source_meta("Tenancies", row, filename),
        portfolio_tenancy_id=tenancy_id,
        portfolio_property_code=_text(row.get("Property")),
        source_status=_text(row.get("Status")),
        tenant_legal_name=_text(row.get("Tenant (legal name)")),
        trading_name=_text(row.get("Trading name")),
    )
    units_by_key[key] = unit
    return unit


def _upsert_tenant(
    session: Session,
    entity_id: UUID,
    row: dict[str, Any],
    filename: str,
    tenants_by_name: dict[str, Tenant],
    counts: Counter[str],
) -> Tenant | None:
    legal_name = _text(row.get("Tenant (legal name)"))
    if _tenant_is_vacant(legal_name):
        counts["tenants_skipped"] += 1
        return None

    tenant = tenants_by_name.get(_key(legal_name))
    if tenant is None:
        tenant = Tenant(entity_id=entity_id, legal_name=legal_name)
        session.add(tenant)
        counts["tenants_created"] += 1
    else:
        counts["tenants_updated"] += 1

    trading_name = _text(row.get("Trading name"))
    primary_contact = _text(row.get("Primary contact"))
    if trading_name and trading_name != "—":
        tenant.trading_name = trading_name
    tenant.contact_email = _first_email(primary_contact) or tenant.contact_email
    tenant.billing_email = _first_email(primary_contact) or tenant.billing_email
    tenant.contact_phone = _first_phone(primary_contact) or tenant.contact_phone
    tenant.tenant_metadata = _set_metadata(
        tenant.tenant_metadata,
        **_source_meta("Tenancies", row, filename),
        portfolio_tenancy_id=_text(row.get("Tenancy ID")),
        primary_contact=primary_contact,
        insurance=_text(row.get("Insurance")),
        arrears=_text(row.get("Arrears")),
        notes=_text(row.get("Notes")),
    )
    tenants_by_name[_key(legal_name)] = tenant
    return tenant


def _upsert_lease(
    session: Session,
    unit: TenancyUnit,
    tenant: Tenant,
    row: dict[str, Any],
    filename: str,
    leases_by_tenancy_id: dict[str, Lease],
    counts: Counter[str],
) -> Lease | None:
    tenancy_id = _text(row.get("Tenancy ID"))
    if not tenancy_id:
        counts["leases_skipped"] += 1
        return None

    lease = leases_by_tenancy_id.get(_key(tenancy_id))
    if lease is None:
        lease = Lease(tenancy_unit_id=unit.id, tenant_id=tenant.id)
        session.add(lease)
        counts["leases_created"] += 1
    else:
        counts["leases_updated"] += 1

    annual_rent_cents = _money_cents(row.get("Annual rent"))
    frequency = _rent_frequency(row.get("Frequency"))
    lease.tenancy_unit_id = unit.id
    lease.tenant_id = tenant.id
    lease.status = _lease_status(row.get("Status"))
    lease.commencement_date = _date_value(row.get("Commencement"))
    lease.expiry_date = _date_value(row.get("Expiry"))
    lease.annual_rent_cents = annual_rent_cents
    lease.rent_frequency = frequency
    lease.outgoings_recoverable = _money_cents(row.get("Outgoings")) is not None
    lease.next_review_date = _date_value(row.get("Next review"))
    lease.option_summary = _text(row.get("Options")) or None
    lease.security_summary = _text(row.get("Security")) or None
    lease.notes = _text(row.get("Notes")) or None
    party_role = "skj_as_tenant" if _lease_status_bucket(row.get("Status")) == "headlease" else None
    lease.lease_metadata = _set_metadata(
        lease.lease_metadata,
        **_source_meta("Tenancies", row, filename),
        portfolio_tenancy_id=tenancy_id,
        portfolio_property_code=_text(row.get("Property")),
        unit_code=_text(row.get("Unit code")),
        trading_name=_text(row.get("Trading name")),
        original_status=_text(row.get("Status")),
        party_role=party_role,
        form=_text(row.get("Form")),
        insurance=_text(row.get("Insurance")),
        arrears=_text(row.get("Arrears")),
        review_type=_text(row.get("Review type")),
        rent_per_sqm=row.get("Rent per m²"),
        annual_outgoings_cents=_money_cents(row.get("Outgoings")),
        primary_contact=_text(row.get("Primary contact")),
    )
    leases_by_tenancy_id[_key(tenancy_id)] = lease
    return lease


def _upsert_charge_rule(
    session: Session,
    lease: Lease,
    row: dict[str, Any],
    filename: str,
    charge_type: RentChargeType,
    annual_amount_cents: int | None,
    counts: Counter[str],
) -> RentChargeRule | None:
    if annual_amount_cents is None:
        return None

    source_field = "Annual rent" if charge_type == RentChargeType.base_rent else "Outgoings"
    existing_rules = [
        rule
        for rule in session.scalars(
            select(RentChargeRule).where(
                RentChargeRule.lease_id == lease.id,
                RentChargeRule.charge_type == charge_type,
                RentChargeRule.deleted_at.is_(None),
            )
        )
        if (rule.charge_rule_metadata or {}).get("portfolio_import_source") == SOURCE_KEY
    ]
    rule = existing_rules[0] if existing_rules else None
    if rule is None:
        rule = RentChargeRule(lease_id=lease.id, charge_type=charge_type, amount_cents=0)
        session.add(rule)
        counts["charge_rules_created"] += 1
    else:
        counts["charge_rules_updated"] += 1

    frequency = _rent_frequency(row.get("Frequency"))
    rule.amount_cents = _periodic_cents(annual_amount_cents, frequency)
    rule.frequency = frequency
    rule.gst_treatment = GstTreatment.taxable
    rule.start_date = _date_value(row.get("Commencement"))
    rule.end_date = _date_value(row.get("Expiry"))
    rule.next_due_date = _date_value(row.get("Commencement"))
    rule.arrears_or_advance = "advance"
    rule.charge_rule_metadata = _set_metadata(
        rule.charge_rule_metadata,
        **_source_meta("Tenancies", row, filename),
        portfolio_tenancy_id=_text(row.get("Tenancy ID")),
        source_field=source_field,
        annual_amount_cents=annual_amount_cents,
        rent_per_sqm=row.get("Rent per m²"),
    )
    return rule


def _find_imported_obligation(
    session: Session, entity_id: UUID, import_key: str
) -> Obligation | None:
    obligations = session.scalars(
        select(Obligation).where(Obligation.entity_id == entity_id, Obligation.deleted_at.is_(None))
    )
    for obligation in obligations:
        if (obligation.obligation_metadata or {}).get("portfolio_import_key") == import_key:
            return obligation
    return None


def _upsert_obligation(
    session: Session,
    *,
    entity_id: UUID,
    import_key: str,
    title: str,
    due_date: date,
    category: ObligationCategory,
    priority: int,
    notes: str | None,
    source_sheet: str,
    source_row: dict[str, Any],
    filename: str,
    today: date,
    counts: Counter[str],
    property_id: UUID | None = None,
    tenancy_unit_id: UUID | None = None,
    lease_id: UUID | None = None,
    source_status: Any = None,
    extra_metadata: dict[str, Any] | None = None,
) -> Obligation:
    obligation = _find_imported_obligation(session, entity_id, import_key)
    if obligation is None:
        obligation = Obligation(
            entity_id=entity_id,
            title=title,
            due_date=due_date,
            category=category,
            priority=priority,
        )
        session.add(obligation)
        counts["obligations_created"] += 1
    else:
        counts["obligations_updated"] += 1

    obligation.property_id = property_id
    obligation.tenancy_unit_id = tenancy_unit_id
    obligation.lease_id = lease_id
    obligation.title = title[:500]
    obligation.category = category
    obligation.status = _status_for_due(due_date, today, source_status)
    obligation.due_date = due_date
    obligation.priority = priority
    obligation.notes = notes
    obligation.obligation_metadata = _set_metadata(
        obligation.obligation_metadata,
        **_source_meta(source_sheet, source_row, filename),
        portfolio_import_key=import_key,
        **(extra_metadata or {}),
    )
    return obligation


def _property_from_code(properties_by_code: dict[str, Property], value: Any) -> Property | None:
    return properties_by_code.get(_key(value))


def _lease_from_tenancy(
    leases_by_tenancy_id: dict[str, Lease],
    units_by_key: dict[tuple[UUID, str], TenancyUnit],
    prop: Property | None,
    value: Any,
) -> Lease | None:
    text = _text(value)
    if not text:
        return None
    lease = leases_by_tenancy_id.get(_key(text))
    if lease is not None:
        return lease
    if prop is None:
        return None
    first_token = text.split()[0].replace("(", "").replace(")", "")
    unit = units_by_key.get((prop.id, _key(first_token)))
    if unit is None:
        return None
    for candidate in leases_by_tenancy_id.values():
        if candidate.tenancy_unit_id == unit.id:
            return candidate
    return None


def import_workbook(
    *,
    session: Session,
    entity_name: str,
    workbook_path: Path,
    archive_seed_data: bool,
    today: date | None = None,
) -> dict[str, int | str]:
    content = workbook_path.read_bytes()
    filename = workbook_path.name
    sheets = load_register_workbook(content)
    today = today or date.today()
    counts: Counter[str] = Counter()

    entity = session.scalar(
        select(Entity).where(Entity.name == entity_name, Entity.deleted_at.is_(None))
    )
    if entity is None:
        raise RuntimeError(f"Could not find active entity named {entity_name!r}.")

    if archive_seed_data:
        _archive_seed_data(session, entity.id, counts)
        session.flush()

    existing_properties = list(
        session.scalars(select(Property).where(Property.entity_id == entity.id))
    )
    properties_by_code = _index_property_codes(existing_properties)
    properties_by_address = _index_property_addresses(
        [prop for prop in existing_properties if prop.deleted_at is None]
    )
    property_rows = _sheet(sheets, "Properties")
    for row in property_rows:
        _upsert_property(
            session,
            entity.id,
            row,
            filename,
            properties_by_code,
            properties_by_address,
            counts,
        )
    session.flush()

    units = list(
        session.scalars(
            select(TenancyUnit)
            .join(Property)
            .where(Property.entity_id == entity.id, TenancyUnit.deleted_at.is_(None))
        )
    )
    units_by_key = {(unit.property_id, _key(unit.unit_label)): unit for unit in units}
    tenants = list(
        session.scalars(
            select(Tenant).where(Tenant.entity_id == entity.id, Tenant.deleted_at.is_(None))
        )
    )
    tenants_by_name = {_key(tenant.legal_name): tenant for tenant in tenants}
    leases = list(
        session.scalars(
            select(Lease)
            .join(TenancyUnit)
            .join(Property)
            .where(Property.entity_id == entity.id, Lease.deleted_at.is_(None))
        )
    )
    leases_by_tenancy_id = {
        _key((lease.lease_metadata or {}).get("portfolio_tenancy_id")): lease
        for lease in leases
        if _key((lease.lease_metadata or {}).get("portfolio_tenancy_id"))
    }

    for row in _sheet(sheets, "Tenancies"):
        tenancy_id = _text(row.get("Tenancy ID"))
        if not tenancy_id:
            counts["tenancy_rows_skipped"] += 1
            continue
        prop = _property_from_code(properties_by_code, row.get("Property"))
        if prop is None:
            counts["tenancy_rows_skipped"] += 1
            continue
        unit = _upsert_unit(session, prop, row, filename, units_by_key, counts)
        if unit is None:
            continue
        tenant = _upsert_tenant(session, entity.id, row, filename, tenants_by_name, counts)
        if tenant is None:
            continue
        session.flush()
        lease = _upsert_lease(session, unit, tenant, row, filename, leases_by_tenancy_id, counts)
        if lease is None:
            continue
        session.flush()
        _upsert_charge_rule(
            session,
            lease,
            row,
            filename,
            RentChargeType.base_rent,
            _money_cents(row.get("Annual rent")),
            counts,
        )
        _upsert_charge_rule(
            session,
            lease,
            row,
            filename,
            RentChargeType.outgoings,
            _money_cents(row.get("Outgoings")),
            counts,
        )

    session.flush()

    for row in _sheet(sheets, "Dates"):
        due_date = _date_value(row.get("Date"))
        if due_date is None:
            counts["date_obligations_skipped"] += 1
            continue
        prop = _property_from_code(properties_by_code, row.get("Property"))
        lease = _lease_from_tenancy(leases_by_tenancy_id, units_by_key, prop, row.get("Tenancy"))
        title_parts = [_text(row.get("Event type")), _text(row.get("Description"))]
        title = " - ".join(part for part in title_parts if part) or "Portfolio date"
        _upsert_obligation(
            session,
            entity_id=entity.id,
            import_key=f"dates:{row.get('_row')}",
            title=title,
            due_date=due_date,
            category=_category(row.get("Event type")),
            priority=_priority(row.get("Severity")),
            notes=_text(row.get("Description")) or None,
            source_sheet="Dates",
            source_row=row,
            filename=filename,
            today=today,
            counts=counts,
            property_id=prop.id if prop else None,
            tenancy_unit_id=lease.tenancy_unit_id if lease else None,
            lease_id=lease.id if lease else None,
            source_status=row.get("Event type"),
            extra_metadata={
                "source_property": _text(row.get("Property")),
                "source_tenancy": _text(row.get("Tenancy")),
                "source_owner": _text(row.get("Owner")),
                "source_severity": _text(row.get("Severity")),
            },
        )

    for row in _sheet(sheets, "Bonds"):
        prop = _property_from_code(properties_by_code, row.get("Property"))
        lease = _lease_from_tenancy(leases_by_tenancy_id, units_by_key, prop, row.get("Tenancy"))
        security_due = _date_value(row.get("Security expiry"))
        if (
            security_due is None
            and _key(row.get("Security expiry")) == "termination date"
            and lease
        ):
            security_due = lease.expiry_date
        if security_due is not None:
            _upsert_obligation(
                session,
                entity_id=entity.id,
                import_key=f"bonds:{row.get('_row')}:security",
                title=f"Security expiry - {_text(row.get('Tenant')) or _text(row.get('Tenancy'))}",
                due_date=security_due,
                category=ObligationCategory.bank_guarantee,
                priority=1,
                notes=_text(row.get("Notes")) or None,
                source_sheet="Bonds",
                source_row=row,
                filename=filename,
                today=today,
                counts=counts,
                property_id=prop.id if prop else None,
                tenancy_unit_id=lease.tenancy_unit_id if lease else None,
                lease_id=lease.id if lease else None,
                extra_metadata={
                    "source_tenancy": _text(row.get("Tenancy")),
                    "security_type": _text(row.get("Security type")),
                    "security_amount_cents": _money_cents(row.get("Amount $AUD")),
                    "security_expiry_source": _text(row.get("Security expiry")),
                },
            )
        insurance_due = _date_value(row.get("Insurance expiry"))
        if insurance_due is not None:
            _upsert_obligation(
                session,
                entity_id=entity.id,
                import_key=f"bonds:{row.get('_row')}:insurance",
                title=f"Insurance expiry - {_text(row.get('Tenant')) or _text(row.get('Tenancy'))}",
                due_date=insurance_due,
                category=ObligationCategory.insurance,
                priority=1 if insurance_due <= today + timedelta(days=45) else 2,
                notes=_text(row.get("Insurance status")) or _text(row.get("Notes")) or None,
                source_sheet="Bonds",
                source_row=row,
                filename=filename,
                today=today,
                counts=counts,
                property_id=prop.id if prop else None,
                tenancy_unit_id=lease.tenancy_unit_id if lease else None,
                lease_id=lease.id if lease else None,
                extra_metadata={
                    "source_tenancy": _text(row.get("Tenancy")),
                    "insurance_status": _text(row.get("Insurance status")),
                    "security_type": _text(row.get("Security type")),
                    "security_amount_cents": _money_cents(row.get("Amount $AUD")),
                },
            )

    for row in _sheet(sheets, "Active Issues"):
        title = _text(row.get("Issue"))
        if not title:
            counts["issue_obligations_skipped"] += 1
            continue
        _upsert_obligation(
            session,
            entity_id=entity.id,
            import_key=f"issues:{row.get('_row')}",
            title=title,
            due_date=today,
            category=_category(f"{row.get('Issue')} {row.get('Notes / next step')}"),
            priority=_priority(row.get("Severity")),
            notes=_text(row.get("Notes / next step")) or None,
            source_sheet="Active Issues",
            source_row=row,
            filename=filename,
            today=today,
            counts=counts,
            source_status=row.get("Status"),
            extra_metadata={
                "source_owner": _text(row.get("Owner")),
                "source_severity": _text(row.get("Severity")),
                "source_status": _text(row.get("Status")),
            },
        )

    for row in _sheet(sheets, "Actions"):
        due_date = _date_value(row.get("Deadline"))
        title = _text(row.get("Action"))
        if due_date is None or not title:
            counts["action_obligations_skipped"] += 1
            continue
        _upsert_obligation(
            session,
            entity_id=entity.id,
            import_key=f"actions:{row.get('_row')}",
            title=title,
            due_date=due_date,
            category=_category(f"{row.get('Action')} {row.get('Detail')}"),
            priority=1 if due_date <= today + timedelta(days=7) else 2,
            notes=_text(row.get("Detail")) or None,
            source_sheet="Actions",
            source_row=row,
            filename=filename,
            today=today,
            counts=counts,
            extra_metadata={"source_owner": _text(row.get("Owner"))},
        )

    summary: dict[str, int | str] = dict(counts)
    summary["properties_total_source"] = len(property_rows)
    summary["tenancies_total_source"] = len(_sheet(sheets, "Tenancies"))
    summary["entity_id"] = str(entity.id)
    summary["entity_name"] = entity.name
    return summary


def _make_session(database_url: str) -> Session:
    normalised_url = Settings(database_url=database_url).database_url
    engine = create_engine(normalised_url, pool_pre_ping=True)
    SessionLocal = sessionmaker(
        bind=engine, autoflush=False, autocommit=False, expire_on_commit=False
    )
    return SessionLocal()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--entity-name", default="SKJ Property Pty Ltd")
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    parser.add_argument("--apply", action="store_true", help="Commit changes to the database.")
    parser.add_argument(
        "--keep-seed-data",
        action="store_true",
        help="Leave local/demo seed register rows visible.",
    )
    args = parser.parse_args()

    if args.database_url is None:
        raise SystemExit("DATABASE_URL or --database-url is required.")
    if not args.workbook.exists():
        raise SystemExit(f"Workbook not found: {args.workbook}")

    with _make_session(args.database_url) as session:
        counts = import_workbook(
            session=session,
            entity_name=args.entity_name,
            workbook_path=args.workbook,
            archive_seed_data=not args.keep_seed_data,
        )
        if args.apply:
            session.commit()
            mode = "applied"
        else:
            session.rollback()
            mode = "dry_run"

    print(f"portfolio_import_mode={mode}")
    for key in sorted(counts):
        print(f"{key}={counts[key]}")


if __name__ == "__main__":
    main()
