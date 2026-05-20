"""Review-first spreadsheet import planning for portfolio registers."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime
from io import BytesIO
from typing import Any
from uuid import UUID

from openpyxl import load_workbook
from openpyxl.workbook.workbook import Workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

from stewart.core.models import (
    Lease,
    Property,
    PropertyType,
    TenancyUnit,
    Tenant,
)


class RegisterImportError(ValueError):
    """Raised when a workbook cannot be read as a register import source."""


@dataclass(frozen=True)
class SheetRows:
    name: str
    header_row: int | None
    columns: list[str]
    rows: list[dict[str, Any]]


def _text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text in {"", "-", "—", "N/A", "n/a", "NA"}:
        return ""
    return text


def _key(value: Any) -> str:
    return " ".join(_text(value).lower().split())


def _money_cents(value: Any) -> int | None:
    if value in (None, "", "-", "—"):
        return None
    if isinstance(value, int | float):
        return int(round(float(value) * 100))
    cleaned = "".join(char for char in str(value) if char.isdigit() or char in ".-")
    if not cleaned:
        return None
    try:
        return int(round(float(cleaned) * 100))
    except ValueError:
        return None


def _date_value(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = _text(value)
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _blank_to_none(value: Any) -> Any:
    return None if _text(value) == "" else value


def _sheet_rows(workbook: Workbook, sheet_name: str) -> SheetRows:
    sheet = workbook[sheet_name]
    header_row: int | None = None
    for row_number in range(1, min(sheet.max_row, 20) + 1):
        values = [
            _text(sheet.cell(row_number, column).value) for column in range(1, sheet.max_column + 1)
        ]
        if sum(1 for value in values if value) >= 2:
            header_row = row_number
            break

    if header_row is None:
        return SheetRows(name=sheet_name, header_row=None, columns=[], rows=[])

    column_positions = [
        (column, _text(sheet.cell(header_row, column).value))
        for column in range(1, sheet.max_column + 1)
        if _text(sheet.cell(header_row, column).value)
    ]
    rows: list[dict[str, Any]] = []
    for row_number in range(header_row + 1, sheet.max_row + 1):
        row = {
            header: _blank_to_none(sheet.cell(row_number, column).value)
            for column, header in column_positions
        }
        if any(_text(value) for value in row.values()):
            row["_row"] = row_number
            rows.append(row)
    return SheetRows(
        name=sheet_name,
        header_row=header_row,
        columns=[header for _, header in column_positions],
        rows=rows,
    )


def load_register_workbook(content: bytes) -> dict[str, SheetRows]:
    """Load an XLSX workbook into normalized sheet rows."""

    try:
        workbook = load_workbook(BytesIO(content), data_only=True, read_only=False)
    except Exception as exc:  # pragma: no cover - library message varies by file corruption
        raise RegisterImportError("Could not read workbook. Upload a valid .xlsx file.") from exc
    return {sheet_name: _sheet_rows(workbook, sheet_name) for sheet_name in workbook.sheetnames}


def _property_type(value: Any) -> tuple[PropertyType, bool]:
    text = _key(value)
    if not text or text == "tbc":
        return PropertyType.other, True
    if "childcare" in text:
        return PropertyType.childcare, False
    if "hospitality" in text or "bottle shop" in text:
        return PropertyType.hospitality, False
    if "industrial" in text or "logistics" in text or "brewery" in text:
        return PropertyType.commercial_industrial, False
    if "office" in text or "hq" in text:
        return PropertyType.commercial_office, False
    if "retail" in text:
        return PropertyType.commercial_retail, False
    if "mixed" in text:
        return PropertyType.mixed_use, False
    if "land" in text:
        return PropertyType.vacant_land, False
    if "residential" in text:
        return PropertyType.other, True
    if "commercial" in text:
        return PropertyType.commercial_retail, True
    return PropertyType.other, True


def _lease_status_bucket(value: Any) -> str:
    status = _key(value)
    if not status:
        return "review"
    if "vacant" in status:
        return "vacant"
    if status.startswith("exited"):
        return "archive"
    if "skj-as-tenant" in status:
        return "headlease"
    if status.startswith("pending"):
        return "pending"
    if status.startswith("active"):
        return "active"
    return "review"


def _has_arrears_signal(status: Any, arrears: Any) -> bool:
    if "arrears" in _key(status):
        return True
    text = _key(arrears)
    return text not in {"", "not specified", "none", "nil", "no", "current"}


def _obligation_category(event_type: Any) -> str:
    text = _key(event_type)
    if "review" in text or "cpi" in text:
        return "rent_review"
    if "expiry" in text or "renewal" in text:
        return "lease_expiry"
    if "insurance" in text:
        return "insurance"
    if "guarantee" in text or "bond" in text:
        return "bank_guarantee"
    if "compliance" in text or "regulatory" in text:
        return "compliance"
    if "maintenance" in text or "leak" in text or "vendor" in text:
        return "maintenance"
    return "other"


def _finding(
    severity: str,
    message: str,
    *,
    sheet: str | None = None,
    row: int | None = None,
    field: str | None = None,
    source_value: Any = None,
) -> dict[str, Any]:
    return {
        "severity": severity,
        "message": message,
        "sheet": sheet,
        "row": row,
        "field": field,
        "source_value": source_value,
    }


def _feature(
    key: str,
    label: str,
    reason: str,
    source_sheet: str,
    source_count: int,
    priority: str = "next",
) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "reason": reason,
        "source_sheet": source_sheet,
        "source_count": source_count,
        "priority": priority,
    }


def _action(target: str, **counts: int) -> dict[str, int | str]:
    return {
        "target": target,
        "create": counts.get("create", 0),
        "match": counts.get("match", 0),
        "update": counts.get("update", 0),
        "skip": counts.get("skip", 0),
        "review": counts.get("review", 0),
    }


def _existing_indexes(session: Session, entity_id: UUID) -> dict[str, set[str]]:
    properties = list(
        session.scalars(
            select(Property).where(Property.entity_id == entity_id, Property.deleted_at.is_(None))
        )
    )
    property_codes = {
        _key((prop.property_metadata or {}).get("portfolio_code"))
        for prop in properties
        if _key((prop.property_metadata or {}).get("portfolio_code"))
    }
    property_addresses = {
        _key(prop.street_address) for prop in properties if _key(prop.street_address)
    }
    tenants = list(
        session.scalars(
            select(Tenant).where(Tenant.entity_id == entity_id, Tenant.deleted_at.is_(None))
        )
    )
    tenant_names = {_key(tenant.legal_name) for tenant in tenants}
    tenant_abns = {_key(tenant.abn) for tenant in tenants if _key(tenant.abn)}

    units = list(
        session.scalars(
            select(TenancyUnit)
            .join(Property)
            .where(
                Property.entity_id == entity_id,
                Property.deleted_at.is_(None),
                TenancyUnit.deleted_at.is_(None),
            )
        )
    )
    unit_labels = {_key(unit.unit_label) for unit in units}
    leases = list(
        session.scalars(
            select(Lease)
            .join(TenancyUnit)
            .join(Property)
            .where(
                Property.entity_id == entity_id,
                Property.deleted_at.is_(None),
                TenancyUnit.deleted_at.is_(None),
                Lease.deleted_at.is_(None),
            )
        )
    )
    lease_refs = {
        _key((lease.lease_metadata or {}).get("portfolio_tenancy_id"))
        for lease in leases
        if _key((lease.lease_metadata or {}).get("portfolio_tenancy_id"))
    }
    return {
        "property_codes": property_codes,
        "property_addresses": property_addresses,
        "tenant_names": tenant_names,
        "tenant_abns": tenant_abns,
        "unit_labels": unit_labels,
        "lease_refs": lease_refs,
    }


def build_register_import_dry_run(
    *,
    session: Session,
    entity_id: UUID,
    filename: str,
    content: bytes,
) -> dict[str, Any]:
    """Return a no-mutation import plan for a portfolio workbook."""

    sheets = load_register_workbook(content)
    indexes = _existing_indexes(session, entity_id)
    findings: list[dict[str, Any]] = []
    feature_candidates: list[dict[str, Any]] = []

    properties = sheets.get("Properties", SheetRows("Properties", None, [], [])).rows
    tenancies = sheets.get("Tenancies", SheetRows("Tenancies", None, [], [])).rows
    bonds = sheets.get("Bonds", SheetRows("Bonds", None, [], [])).rows
    dates = sheets.get("Dates", SheetRows("Dates", None, [], [])).rows
    entities = sheets.get("Entities", SheetRows("Entities", None, [], [])).rows
    vendors = sheets.get("Vendors", SheetRows("Vendors", None, [], [])).rows
    issues = sheets.get("Active Issues", SheetRows("Active Issues", None, [], [])).rows
    actions_rows = sheets.get("Actions", SheetRows("Actions", None, [], [])).rows

    property_codes = {_text(row.get("Code")) for row in properties if _text(row.get("Code"))}
    tenancy_ids = [
        _text(row.get("Tenancy ID")) for row in tenancies if _text(row.get("Tenancy ID"))
    ]
    tenancy_id_counts = Counter(tenancy_ids)

    property_create = 0
    property_match = 0
    property_review = 0
    inactive_properties = 0
    for row in properties:
        code = _text(row.get("Code"))
        address = _text(row.get("Address"))
        status = _key(row.get("Status"))
        if not code:
            property_review += 1
            findings.append(
                _finding(
                    "blocker",
                    "Property row is missing a portfolio code.",
                    sheet="Properties",
                    row=row.get("_row"),
                    field="Code",
                )
            )
        if not address:
            property_review += 1
            findings.append(
                _finding(
                    "blocker",
                    "Property row is missing a street address.",
                    sheet="Properties",
                    row=row.get("_row"),
                    field="Address",
                )
            )
        _, needs_type_review = _property_type(row.get("Property type"))
        if needs_type_review:
            property_review += 1
            findings.append(
                _finding(
                    "warning",
                    "Property type needs human mapping before apply.",
                    sheet="Properties",
                    row=row.get("_row"),
                    field="Property type",
                    source_value=row.get("Property type"),
                )
            )
        if "inactive" in status or "sold" in _key(row.get("Property type")):
            inactive_properties += 1
            property_review += 1
            continue
        if (
            _key(code) in indexes["property_codes"]
            or _key(address) in indexes["property_addresses"]
        ):
            property_match += 1
        elif code and address:
            property_create += 1

    unit_create = 0
    unit_match = 0
    unit_review = 0
    tenant_names: set[str] = set()
    lease_create = 0
    lease_review = 0
    lease_skip = 0
    rent_rules = 0
    outgoings_rules = 0
    headlease_rows = 0
    vacant_rows = 0
    archive_rows = 0
    arrears_rows = 0

    for row in tenancies:
        tenancy_id = _text(row.get("Tenancy ID"))
        prop_code = _text(row.get("Property"))
        unit_code = _text(row.get("Unit code"))
        tenant_name = _text(row.get("Tenant (legal name)"))
        bucket = _lease_status_bucket(row.get("Status"))

        if tenancy_id and tenancy_id_counts[tenancy_id] > 1:
            findings.append(
                _finding(
                    "blocker",
                    "Tenancy ID appears more than once.",
                    sheet="Tenancies",
                    row=row.get("_row"),
                    field="Tenancy ID",
                    source_value=tenancy_id,
                )
            )
            lease_review += 1
            continue
        if not tenancy_id:
            findings.append(
                _finding(
                    "blocker",
                    "Tenancy row is missing a Tenancy ID.",
                    sheet="Tenancies",
                    row=row.get("_row"),
                    field="Tenancy ID",
                )
            )
            lease_review += 1
            continue
        if prop_code not in property_codes:
            findings.append(
                _finding(
                    "blocker",
                    "Tenancy references a property code not present in the Properties sheet.",
                    sheet="Tenancies",
                    row=row.get("_row"),
                    field="Property",
                    source_value=prop_code,
                )
            )
            lease_review += 1
            continue
        if not unit_code:
            findings.append(
                _finding(
                    "warning",
                    "Tenancy has no unit code; the importer can fall back "
                    "to Tenancy ID for the unit label.",
                    sheet="Tenancies",
                    row=row.get("_row"),
                    field="Unit code",
                    source_value=tenancy_id,
                )
            )
            unit_review += 1
            unit_code = tenancy_id

        if _key(unit_code) in indexes["unit_labels"]:
            unit_match += 1
        else:
            unit_create += 1

        if bucket == "vacant":
            vacant_rows += 1
            lease_skip += 1
            continue
        if bucket == "archive":
            archive_rows += 1
            lease_review += 1
            continue
        if bucket == "headlease":
            headlease_rows += 1
            lease_review += 1
            continue
        if bucket == "review":
            lease_review += 1
            findings.append(
                _finding(
                    "warning",
                    "Tenancy status needs human mapping.",
                    sheet="Tenancies",
                    row=row.get("_row"),
                    field="Status",
                    source_value=row.get("Status"),
                )
            )
            continue

        if not tenant_name or tenant_name.upper() == "VACANT":
            lease_review += 1
            findings.append(
                _finding(
                    "blocker",
                    "Importable lease row needs a tenant legal name.",
                    sheet="Tenancies",
                    row=row.get("_row"),
                    field="Tenant (legal name)",
                )
            )
            continue
        if not _date_value(row.get("Commencement")) or not _date_value(row.get("Expiry")):
            lease_review += 1
            findings.append(
                _finding(
                    "blocker",
                    "Importable lease row needs commencement and expiry dates.",
                    sheet="Tenancies",
                    row=row.get("_row"),
                    field="Commencement/Expiry",
                )
            )
            continue
        if _money_cents(row.get("Annual rent")) is None:
            lease_review += 1
            findings.append(
                _finding(
                    "blocker",
                    "Importable lease row needs annual rent.",
                    sheet="Tenancies",
                    row=row.get("_row"),
                    field="Annual rent",
                )
            )
            continue

        if _has_arrears_signal(row.get("Status"), row.get("Arrears")):
            arrears_rows += 1
        tenant_names.add(_key(tenant_name))
        if _key(tenancy_id) in indexes["lease_refs"]:
            lease_review += 1
        else:
            lease_create += 1
        rent_rules += 1
        if _money_cents(row.get("Outgoings")) is not None:
            outgoings_rules += 1

    tenant_match = sum(1 for name in tenant_names if name in indexes["tenant_names"])
    tenant_create = len(tenant_names) - tenant_match

    bond_security_obligations = 0
    bond_insurance_obligations = 0
    for row in bonds:
        tenancy_ref = _text(row.get("Tenancy"))
        prop_ref = _text(row.get("Property"))
        if tenancy_ref and tenancy_ref not in tenancy_id_counts:
            findings.append(
                _finding(
                    "blocker",
                    "Bond row references a tenancy not present in the Tenancies sheet.",
                    sheet="Bonds",
                    row=row.get("_row"),
                    field="Tenancy",
                    source_value=tenancy_ref,
                )
            )
        if prop_ref and prop_ref not in property_codes:
            findings.append(
                _finding(
                    "blocker",
                    "Bond row references a property not present in the Properties sheet.",
                    sheet="Bonds",
                    row=row.get("_row"),
                    field="Property",
                    source_value=prop_ref,
                )
            )
        if _date_value(row.get("Security expiry")) or _text(row.get("Security expiry")):
            bond_security_obligations += 1
        if _date_value(row.get("Insurance expiry")):
            bond_insurance_obligations += 1

    date_obligations = 0
    for row in dates:
        prop_ref = _text(row.get("Property"))
        if prop_ref and prop_ref not in property_codes:
            findings.append(
                _finding(
                    "blocker",
                    "Critical date references a property not present in the Properties sheet.",
                    sheet="Dates",
                    row=row.get("_row"),
                    field="Property",
                    source_value=prop_ref,
                )
            )
            continue
        if _date_value(row.get("Date")) is None:
            findings.append(
                _finding(
                    "blocker",
                    "Critical date row needs a date before it can become an obligation.",
                    sheet="Dates",
                    row=row.get("_row"),
                    field="Date",
                )
            )
            continue
        _obligation_category(row.get("Event type"))
        date_obligations += 1

    if entities:
        feature_candidates.append(
            _feature(
                "legal_entity_directory",
                "Legal entity and trust directory",
                "The workbook tracks owning/trading entities separately from "
                "properties; this should become a richer entity profile import.",
                "Entities",
                len(entities),
                "now",
            )
        )
    if vendors:
        feature_candidates.append(
            _feature(
                "vendor_directory",
                "Vendor and contractor directory",
                "Vendor scope, property coverage, and status appear as "
                "source-of-truth data but Leasium does not yet have a vendor register.",
                "Vendors",
                len(vendors),
            )
        )
    if issues or actions_rows:
        feature_candidates.append(
            _feature(
                "issue_action_queue",
                "Active issue and action queue",
                "The workbook has operational issues and deadlines that "
                "should feed tasks, owners, severity, and follow-up views.",
                "Active Issues / Actions",
                len(issues) + len(actions_rows),
                "now",
            )
        )
    if bonds:
        feature_candidates.append(
            _feature(
                "security_originals_register",
                "Security originals and insurance chase register",
                "Bank guarantees, cash bonds, original-document locations, "
                "insurance expiry, and chase states need structured tracking.",
                "Bonds",
                len(bonds),
                "now",
            )
        )
    if headlease_rows:
        feature_candidates.append(
            _feature(
                "headlease_role_model",
                "SKJ-as-tenant and headlease modelling",
                "Some rows describe SKJ as tenant rather than landlord; "
                "current lease records need a party-role/headlease layer before clean import.",
                "Tenancies",
                headlease_rows,
                "next",
            )
        )
    if arrears_rows:
        feature_candidates.append(
            _feature(
                "arrears_credit_control",
                "Arrears and credit-control queue",
                "Tenancy status and arrears notes can seed an arrears workflow "
                "beyond basic lease status.",
                "Tenancies",
                arrears_rows,
                "next",
            )
        )

    blockers = sum(1 for finding in findings if finding["severity"] == "blocker")
    warnings = sum(1 for finding in findings if finding["severity"] == "warning")
    actions = [
        _action(
            "properties",
            create=property_create,
            match=property_match,
            review=property_review,
        ),
        _action("tenancy_units", create=unit_create, match=unit_match, review=unit_review),
        _action("tenants", create=tenant_create, match=tenant_match),
        _action("leases", create=lease_create, skip=lease_skip, review=lease_review),
        _action("rent_charge_rules", create=rent_rules + outgoings_rules),
        _action(
            "obligations",
            create=date_obligations + bond_security_obligations + bond_insurance_obligations,
        ),
        _action("operational_tasks", create=len(issues) + len(actions_rows)),
    ]
    totals = {
        "sheets": len(sheets),
        "properties": len(properties),
        "tenancies": len(tenancies),
        "bonds": len(bonds),
        "critical_dates": len(dates),
        "vendors": len(vendors),
        "entities": len(entities),
        "active_issues": len(issues),
        "actions": len(actions_rows),
        "blockers": blockers,
        "warnings": warnings,
        "inactive_properties": inactive_properties,
        "vacant_units": vacant_rows,
        "archived_tenancies": archive_rows,
        "headlease_rows": headlease_rows,
    }
    summary = (
        f"Dry run found {property_create} new properties, {unit_create} units, "
        f"{tenant_create} tenants, {lease_create} leases, and "
        f"{date_obligations + bond_security_obligations + bond_insurance_obligations} "
        "obligations to stage."
    )
    return {
        "entity_id": entity_id,
        "filename": filename,
        "sheets": [
            {"name": sheet.name, "rows": len(sheet.rows), "columns": sheet.columns}
            for sheet in sheets.values()
        ],
        "actions": actions,
        "findings": findings,
        "feature_candidates": feature_candidates,
        "totals": totals,
        "importable": blockers == 0,
        "summary": summary,
    }
