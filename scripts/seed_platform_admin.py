"""Seed the reserved 'Relby Platform' organisation and its first platform admin.

Idempotent: re-running does not create duplicates. The reserved organisation
holds NO entities or properties — platform admins act *across* client orgs via
the ``is_platform_admin`` flag, not from this org's data. See
docs/platform-admin-tier-ia.md.
"""

from sqlalchemy import func, select
from stewart.core.db import SessionLocal
from stewart.core.models import AppUser, OperatingMode, OperatorInviteStatus, Organisation
from stewart.core.settings import get_settings


def ensure_platform_admin(session) -> tuple[Organisation, AppUser]:  # noqa: ANN001
    """Create-or-fetch the reserved platform org + admin within an open session."""

    settings = get_settings()
    email = settings.platform_admin_email.strip().lower()

    org = session.get(Organisation, settings.platform_organisation_id)
    if org is None:
        org = Organisation(
            id=settings.platform_organisation_id,
            name=settings.platform_organisation_name,
            country_code="AU",
            timezone="Australia/Brisbane",
            operating_mode=OperatingMode.self_managed_owner.value,
        )
        session.add(org)
        session.flush()

    admin = session.scalar(select(AppUser).where(func.lower(AppUser.email) == email))
    if admin is None:
        admin = session.get(AppUser, settings.platform_admin_user_id)
    if admin is None:
        admin = AppUser(
            id=settings.platform_admin_user_id,
            organisation_id=org.id,
            email=email,
            display_name=settings.platform_admin_name,
            is_active=True,
            is_platform_admin=True,
            invite_status=OperatorInviteStatus.not_sent,
        )
        session.add(admin)
        session.flush()
    else:
        # Idempotent reconcile: keep the flag and reserved-org membership true.
        admin.is_platform_admin = True
        admin.organisation_id = org.id

    return org, admin


def main() -> None:
    with SessionLocal() as session:
        org, admin = ensure_platform_admin(session)
        session.commit()
        print(f"Platform org ready: {org.name} ({org.id})")
        print(f"Platform admin ready: {admin.email} ({admin.id})")


if __name__ == "__main__":
    main()
