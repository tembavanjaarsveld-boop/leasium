"""Backfill first-class Owner records from legacy Property owner-fields.

DoorLoop benchmark P0, Ticket 1.2. Groups non-deleted properties by the same
owner-identity tuple the statements router uses (``owner_legal_name``,
``trustee_name``, ``trust_name``, ``invoice_issuer_name``; case/space
normalised), creates one ``Owner`` per distinct identity, and links each
property to its owner at a 100% split.

Idempotent and additive: re-running reuses existing owners and skips existing
links. The legacy ``Property.owner_*`` fields are left untouched as the source
of truth until the read paths are cut over (Ticket 1.3). Properties with no
owner identity are skipped — they stay in the statements "Unattributed" bucket.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from stewart.core.models import Owner, Property, PropertyOwner

IdentityKey = tuple[str | None, str | None, str | None, str | None]


def _norm(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned.casefold() if cleaned else None


def _property_identity(prop: Property) -> IdentityKey:
    return (
        _norm(prop.owner_legal_name),
        _norm(prop.trustee_name),
        _norm(prop.trust_name),
        _norm(prop.invoice_issuer_name),
    )


def _owner_identity(owner: Owner) -> IdentityKey:
    return (
        _norm(owner.legal_name),
        _norm(owner.trustee_name),
        _norm(owner.trust_name),
        _norm(owner.invoice_issuer_name),
    )


@dataclass
class BackfillResult:
    """Counts from a backfill run.

    ``owners_reused`` counts distinct *pre-existing* owners (from an earlier
    run) that were matched this run — not within-run links to a freshly
    created owner.
    """

    owners_created: int = 0
    owners_reused: int = 0
    links_created: int = 0
    links_existing: int = 0
    properties_unattributed: int = 0


def backfill_owners(session: Session, *, entity_id: UUID | None = None) -> BackfillResult:
    """Create/link ``Owner`` records from ``Property`` owner-fields.

    Pass ``entity_id`` to scope to one entity; otherwise every entity is swept.
    Flushes but does not commit — the caller controls the transaction.
    """

    result = BackfillResult()

    property_query = select(Property).where(Property.deleted_at.is_(None))
    if entity_id is not None:
        property_query = property_query.where(Property.entity_id == entity_id)
    properties = list(
        session.scalars(property_query.order_by(Property.created_at.asc())).all()
    )

    # Seed the cache with owners that already exist (from a prior run).
    owner_cache: dict[tuple[UUID, IdentityKey], Owner] = {}
    owner_query = select(Owner).where(Owner.deleted_at.is_(None))
    if entity_id is not None:
        owner_query = owner_query.where(Owner.entity_id == entity_id)
    for owner in session.scalars(owner_query).all():
        owner_cache[(owner.entity_id, _owner_identity(owner))] = owner

    created_keys: set[tuple[UUID, IdentityKey]] = set()
    reused_owner_ids: set[UUID] = set()

    for prop in properties:
        identity = _property_identity(prop)
        if all(part is None for part in identity):
            result.properties_unattributed += 1
            continue

        cache_key = (prop.entity_id, identity)
        owner = owner_cache.get(cache_key)
        if owner is None:
            owner = Owner(
                entity_id=prop.entity_id,
                legal_name=prop.owner_legal_name,
                abn=prop.owner_abn,
                trustee_name=prop.trustee_name,
                trust_name=prop.trust_name,
                invoice_issuer_name=prop.invoice_issuer_name,
                billing_contact_name=prop.billing_contact_name,
                billing_email=prop.billing_email,
                invoice_reference=prop.invoice_reference,
                gst_registered=prop.owner_gst_registered,
                xero_contact_id=prop.xero_contact_id,
                owner_metadata={"backfill": {"source": "property_owner_fields"}},
            )
            session.add(owner)
            session.flush()
            owner_cache[cache_key] = owner
            created_keys.add(cache_key)
            result.owners_created += 1
        elif cache_key not in created_keys:
            reused_owner_ids.add(owner.id)

        existing_link = session.scalar(
            select(PropertyOwner).where(
                PropertyOwner.property_id == prop.id,
                PropertyOwner.owner_id == owner.id,
            )
        )
        if existing_link is None:
            session.add(
                PropertyOwner(property_id=prop.id, owner_id=owner.id, split_pct=100)
            )
            result.links_created += 1
        else:
            result.links_existing += 1

    result.owners_reused = len(reused_owner_ids)
    session.flush()
    return result
