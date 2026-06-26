"""Review-first stored-row brand pass for the Relby rename.

Dry-run by default: prints every planned text change and mutates nothing. Pass
``--apply`` only after operator review on a Neon branch; the script never sends
email/SMS, calls Xero, reconciles payments, or touches provider APIs.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.db import SessionLocal
from stewart.core.models import (
    AppUser,
    BrandedCommunicationTemplate,
    MaintenanceWorkOrder,
    Organisation,
    OwnerStatementDispatch,
    TenantOnboarding,
)
from stewart.core.settings import get_settings

REPLACEMENTS: tuple[tuple[str, str], ...] = (
    ("LEASIUM", "RELBY"),
    ("Leasium", "Relby"),
    ("ai@leasium.ai", "ai@relby.ai"),
    ("inbox.leasium.ai", "inbox.relby.ai"),
    ("leasium.ai", "relby.ai"),
)


@dataclass(frozen=True)
class PlannedChange:
    table: str
    record_id: str
    field: str
    before: str
    after: str


def _replace_text(value: str) -> str:
    updated = value
    for old, new in REPLACEMENTS:
        updated = updated.replace(old, new)
    return updated


def _replace_json_values(value: Any) -> Any:
    if isinstance(value, str):
        return _replace_text(value)
    if isinstance(value, list):
        return [_replace_json_values(item) for item in value]
    if isinstance(value, dict):
        return {key: _replace_json_values(item) for key, item in value.items()}
    return value


def _preview(value: Any) -> str:
    text = repr(value)
    if len(text) <= 220:
        return text
    return f"{text[:217]}..."


def _record_field_change(
    row: object,
    *,
    table: str,
    field: str,
    changes: list[PlannedChange],
    apply_changes: bool,
) -> None:
    before = getattr(row, field)
    after = _replace_json_values(before)
    if after == before:
        return
    changes.append(
        PlannedChange(
            table=table,
            record_id=str(row.id),
            field=field,
            before=_preview(before),
            after=_preview(after),
        )
    )
    if apply_changes:
        setattr(row, field, after)


def _scan_rows(
    rows: list[object],
    *,
    table: str,
    fields: tuple[str, ...],
    changes: list[PlannedChange],
    apply_changes: bool,
) -> None:
    for row in rows:
        for field in fields:
            _record_field_change(
                row,
                table=table,
                field=field,
                changes=changes,
                apply_changes=apply_changes,
            )


def plan_rebrand(session: Session, *, apply_changes: bool) -> list[PlannedChange]:
    """Plan or apply reviewed Leasium-to-Relby stored-row text changes."""

    settings = get_settings()
    changes: list[PlannedChange] = []

    platform_org = session.get(Organisation, settings.platform_organisation_id)
    if platform_org is not None:
        _scan_rows(
            [platform_org],
            table="organisation",
            fields=("name",),
            changes=changes,
            apply_changes=apply_changes,
        )

    platform_admin = session.get(AppUser, settings.platform_admin_user_id)
    if platform_admin is not None:
        _scan_rows(
            [platform_admin],
            table="app_user",
            fields=("email", "display_name"),
            changes=changes,
            apply_changes=apply_changes,
        )

    _scan_rows(
        list(session.scalars(select(BrandedCommunicationTemplate)).all()),
        table="branded_communication_template",
        fields=(
            "name",
            "subject_template",
            "body_template",
            "action_label",
            "action_url_template",
            "notes",
            "template_metadata",
        ),
        changes=changes,
        apply_changes=apply_changes,
    )
    _scan_rows(
        list(session.scalars(select(TenantOnboarding)).all()),
        table="tenant_onboarding",
        fields=("cancel_reason", "submitted_data", "review_data", "delivery_data"),
        changes=changes,
        apply_changes=apply_changes,
    )
    _scan_rows(
        list(session.scalars(select(MaintenanceWorkOrder)).all()),
        table="maintenance_work_order",
        fields=("work_order_metadata",),
        changes=changes,
        apply_changes=apply_changes,
    )
    _scan_rows(
        list(session.scalars(select(OwnerStatementDispatch)).all()),
        table="owner_statement_dispatch",
        fields=("subject", "dispatch_metadata"),
        changes=changes,
        apply_changes=apply_changes,
    )

    if apply_changes:
        session.flush()
    return changes


def format_changes(changes: list[PlannedChange], *, apply_changes: bool) -> str:
    mode = "APPLY" if apply_changes else "DRY RUN"
    lines = [
        f"Relby stored-row rebrand data pass ({mode})",
        f"Planned row-field changes: {len(changes)}",
    ]
    for change in changes:
        lines.extend(
            [
                f"- {change.table}.{change.field} {change.record_id}",
                f"  before: {change.before}",
                f"  after:  {change.after}",
            ]
        )
    if apply_changes:
        lines.append("Applied and committed.")
    else:
        lines.append("No records were changed. Re-run with --apply only after approval.")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Review and optionally apply stored-row Relby brand text updates."
    )
    parser.add_argument("--apply", action="store_true", help="commit changes (default: dry run)")
    args = parser.parse_args()

    with SessionLocal() as session:
        changes = plan_rebrand(session, apply_changes=args.apply)
        if args.apply:
            session.commit()
        else:
            session.rollback()
        print(format_changes(changes, apply_changes=args.apply))


if __name__ == "__main__":
    main()
