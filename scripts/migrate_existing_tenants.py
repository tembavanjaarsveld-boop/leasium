"""Migrate already-onboarded tenants into the tenant portal.

For each existing lease, create an *applied* tenant-onboarding row so the tenant
skips the confirm-details wizard and lands in the working portal once they claim
their login. Idempotent: a lease that already has a live onboarding row is left
as-is.

Provider-inert: this only creates onboarding rows — it never emails tenants.
Sending each tenant their portal login link is a separate, explicit operator
action (the "Send portal invite" control, or the API
``/tenant-onboarding/{id}/send-portal-invite`` endpoint), consistent with the
Leasium guardrail that no tenant email fires without operator approval.

Run with::

    .venv/bin/python -m scripts.migrate_existing_tenants --leases <id>,<id>
    .venv/bin/python -m scripts.migrate_existing_tenants --leases-file leases.txt
    .venv/bin/python -m scripts.migrate_existing_tenants --leases-file leases.txt --apply

Without ``--apply`` it is a dry run: it prints each lease's tenant + property,
flags tenants missing a contact/billing email (claiming the portal requires the
tenant's login email to match the record), and writes nothing.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from uuid import UUID

from stewart.core.db import SessionLocal, utcnow
from stewart.core.models import Lease, Property, TenancyUnit, Tenant
from stewart.domain.tenant_migration import (
    build_migrated_onboarding,
    find_active_onboarding,
    generate_onboarding_token,
)


def _lease_ids(args: argparse.Namespace) -> list[UUID]:
    raw: list[str] = []
    if args.leases:
        raw.extend(part.strip() for part in args.leases.split(",") if part.strip())
    if args.leases_file:
        text = Path(args.leases_file).read_text(encoding="utf-8")
        raw.extend(line.strip() for line in text.splitlines() if line.strip())
    seen: set[str] = set()
    ordered: list[UUID] = []
    for value in raw:
        if value not in seen:
            seen.add(value)
            ordered.append(UUID(value))
    return ordered


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Migrate existing tenants into the tenant portal."
    )
    parser.add_argument("--leases", help="Comma-separated lease IDs.")
    parser.add_argument("--leases-file", help="File of lease IDs, one per line.")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Create the onboarding rows. Without this flag the script is a dry run.",
    )
    parser.add_argument(
        "--user-id",
        help="Operator app_user UUID to attribute the migration to (optional).",
    )
    args = parser.parse_args()

    lease_ids = _lease_ids(args)
    if not lease_ids:
        parser.error("Provide --leases and/or --leases-file.")
    operator_id = UUID(args.user_id) if args.user_id else None

    created = 0
    skipped = 0
    missing_email = 0
    not_found = 0

    with SessionLocal() as session:
        for lease_id in lease_ids:
            lease = session.get(Lease, lease_id)
            if lease is None or lease.deleted_at is not None:
                not_found += 1
                print(f"  NOT FOUND  lease {lease_id}")
                continue
            unit = session.get(TenancyUnit, lease.tenancy_unit_id)
            tenant = session.get(Tenant, lease.tenant_id)
            prop = session.get(Property, unit.property_id) if unit else None
            if tenant is None or prop is None:
                not_found += 1
                print(f"  NOT FOUND  lease {lease_id} (tenant/property missing)")
                continue

            label = tenant.trading_name or tenant.legal_name
            email = tenant.contact_email or tenant.billing_email
            email_flag = "" if email else "  [NO EMAIL - claim will fail]"
            if not email:
                missing_email += 1

            existing = find_active_onboarding(session, lease.id, tenant.id)
            if existing is not None:
                skipped += 1
                print(
                    f"  SKIP   {label} (lease {lease_id}) - onboarding already exists "
                    f"({existing.status}){email_flag}"
                )
                continue

            if not args.apply:
                print(f"  DRY    {label} @ {prop.name} (lease {lease_id}){email_flag}")
                continue

            onboarding = build_migrated_onboarding(
                entity_id=prop.entity_id,
                lease_id=lease.id,
                tenant_id=tenant.id,
                token=generate_onboarding_token(session),
                now=utcnow(),
                user_id=operator_id,
            )
            session.add(onboarding)
            session.flush()
            created += 1
            print(
                f"  OK     {label} (lease {lease_id}) -> onboarding {onboarding.id} "
                f"[applied]{email_flag}"
            )

        if args.apply:
            session.commit()

    mode = "APPLY" if args.apply else "DRY RUN"
    print(
        f"\n{mode}. created={created} skipped={skipped} "
        f"missing_email={missing_email} not_found={not_found}"
    )
    if missing_email:
        print(
            "Fix tenant contact/billing emails before sending login links - "
            "the portal claim verifies the tenant's login email against the record."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
