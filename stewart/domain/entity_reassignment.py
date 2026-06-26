"""Cascade-aware reassignment of properties between entities (trusts).

Corrects mis-filed properties — e.g. an import that filed a property under the
wrong trust — by moving the property and the register records that structurally
belong to it onto a target entity, in one transaction, with no provider calls.

Review-first by design:

- ``plan_reassignment`` reports what would move, what would stay, and any
  accounting history under the current entity. It mutates nothing.
- ``apply_reassignment`` performs the move and writes a reversible audit row per
  property.

Both leave the transaction open for the caller to commit.

What moves with a property:

- the property's ``entity_id`` and its owner label (synced to the target entity
  name so the owner chip and the filing finally agree);
- obligations scoped to the property, its units, or their leases;
- tenants whose leases sit entirely under the moving property/-ies. A tenant
  whose leases span the move boundary is left in place and flagged — never
  split across entities.

What is detected and reported but NOT moved (so the operator decides):

- billing drafts, invoice drafts, maintenance work orders, arrears cases, and a
  set Xero contact already linked to the property under the current entity. For
  a freshly imported property these are all zero and the move is clean.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Literal
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    ArrearsCase,
    BillingDraft,
    Entity,
    InvoiceDraft,
    Lease,
    MaintenanceWorkOrder,
    Obligation,
    Property,
    TenancyUnit,
    Tenant,
)

# Linked-record kinds surfaced as history flags, in display order, with the
# model that carries the property_id we count against.
_HISTORY_MODELS: tuple[tuple[str, type], ...] = (
    ("billing_drafts", BillingDraft),
    ("invoice_drafts", InvoiceDraft),
    ("maintenance_work_orders", MaintenanceWorkOrder),
    ("arrears_cases", ArrearsCase),
)


@dataclass
class HistoryFlag:
    """A class of record left under the current entity when a property moves."""

    kind: str
    count: int


@dataclass
class PropertyReassignmentPlan:
    property_id: UUID
    property_name: str
    current_entity_id: UUID
    current_entity_name: str | None
    target_entity_id: UUID
    target_entity_name: str
    obligation_count: int
    history_flags: list[HistoryFlag] = field(default_factory=list)


@dataclass
class TenantReassignmentPlan:
    tenant_id: UUID
    tenant_name: str
    disposition: Literal["move", "flag"]
    reason: str | None = None


@dataclass
class SkippedProperty:
    property_id: UUID
    reason: str


@dataclass
class ReassignmentPreview:
    properties: list[PropertyReassignmentPlan]
    tenants: list[TenantReassignmentPlan]
    skipped: list[SkippedProperty]
    moved_property_count: int
    moved_obligation_count: int
    moved_tenant_count: int
    flagged_tenant_count: int
    skipped_property_count: int
    has_history: bool
    warnings: list[str]


@dataclass
class ReassignmentResult:
    moved_property_count: int
    moved_obligation_count: int
    moved_tenant_count: int
    flagged_tenant_count: int
    skipped_property_count: int
    notes: list[str]


# --- internal resolution (shared by preview and apply) ----------------------


@dataclass
class _Mover:
    prop: Property
    target: Entity
    current: Entity | None
    obligations: list[Obligation]
    history_flags: list[HistoryFlag]


@dataclass
class _TenantMove:
    tenant: Tenant
    target_entity_id: UUID


@dataclass
class _Resolution:
    movers: list[_Mover]
    tenant_moves: list[_TenantMove]
    tenant_flags: list[tuple[Tenant, str]]
    skipped: list[SkippedProperty]


def _resolve(
    session: Session,
    targets: dict[UUID, UUID],
    writable_entity_ids: set[UUID],
) -> _Resolution:
    """Work out exactly what a reassignment would touch, without mutating."""

    skipped: list[SkippedProperty] = []
    if not targets:
        return _Resolution([], [], [], skipped)

    properties = {
        prop.id: prop
        for prop in session.scalars(
            select(Property).where(
                Property.id.in_(list(targets)), Property.deleted_at.is_(None)
            )
        )
    }
    entity_ids_needed = set(targets.values()) | {
        prop.entity_id for prop in properties.values()
    }
    entities = {
        entity.id: entity
        for entity in session.scalars(
            select(Entity).where(Entity.id.in_(list(entity_ids_needed)))
        )
    }

    movers: list[_Mover] = []
    for property_id, target_id in targets.items():
        prop = properties.get(property_id)
        if prop is None:
            skipped.append(SkippedProperty(property_id, "Property not found or deleted."))
            continue
        target = entities.get(target_id)
        if target is None or target.deleted_at is not None:
            skipped.append(SkippedProperty(property_id, "Target entity not found."))
            continue
        # writable_entity_ids is already scoped to the user's organisation, so
        # these two checks also keep the move inside one org.
        if prop.entity_id not in writable_entity_ids:
            skipped.append(
                SkippedProperty(property_id, "No write access to the current entity.")
            )
            continue
        if target_id not in writable_entity_ids:
            skipped.append(
                SkippedProperty(property_id, "No write access to the target entity.")
            )
            continue
        if prop.entity_id == target_id:
            skipped.append(SkippedProperty(property_id, "Already filed under this entity."))
            continue
        movers.append(
            _Mover(
                prop=prop,
                target=target,
                current=entities.get(prop.entity_id),
                obligations=[],
                history_flags=[],
            )
        )

    if not movers:
        return _Resolution([], [], [], skipped)

    moving_ids = [mover.prop.id for mover in movers]
    moving_set = set(moving_ids)
    move_map = {mover.prop.id: mover.target.id for mover in movers}

    # Map every unit/lease back to its property so active legacy obligations on
    # soft-deleted units or leases move with the property instead of staying
    # stranded under the old entity.
    unit_to_prop: dict[UUID, UUID] = {}
    for unit_id, prop_id in session.execute(
        select(TenancyUnit.id, TenancyUnit.property_id).where(
            TenancyUnit.property_id.in_(moving_ids)
        )
    ):
        unit_to_prop[unit_id] = prop_id
    lease_to_prop: dict[UUID, UUID] = {}
    if unit_to_prop:
        for lease_id, unit_id in session.execute(
            select(Lease.id, Lease.tenancy_unit_id).where(
                Lease.tenancy_unit_id.in_(list(unit_to_prop))
            )
        ):
            lease_to_prop[lease_id] = unit_to_prop[unit_id]

    obligations_by_prop: dict[UUID, list[Obligation]] = defaultdict(list)
    conditions = [Obligation.property_id.in_(moving_ids)]
    if unit_to_prop:
        conditions.append(Obligation.tenancy_unit_id.in_(list(unit_to_prop)))
    if lease_to_prop:
        conditions.append(Obligation.lease_id.in_(list(lease_to_prop)))
    for obligation in session.scalars(
        select(Obligation).where(Obligation.deleted_at.is_(None), or_(*conditions))
    ):
        prop_id = None
        if obligation.property_id in moving_set:
            prop_id = obligation.property_id
        elif obligation.tenancy_unit_id in unit_to_prop:
            prop_id = unit_to_prop[obligation.tenancy_unit_id]
        elif obligation.lease_id in lease_to_prop:
            prop_id = lease_to_prop[obligation.lease_id]
        if prop_id is not None:
            obligations_by_prop[prop_id].append(obligation)

    history_counts: dict[str, dict[UUID, int]] = {}
    for kind, model in _HISTORY_MODELS:
        counts: dict[UUID, int] = defaultdict(int)
        for (prop_id,) in session.execute(
            select(model.property_id).where(
                model.property_id.in_(moving_ids), model.deleted_at.is_(None)
            )
        ):
            if prop_id is not None:
                counts[prop_id] += 1
        history_counts[kind] = counts

    for mover in movers:
        mover.obligations = obligations_by_prop.get(mover.prop.id, [])
        flags: list[HistoryFlag] = []
        for kind, _model in _HISTORY_MODELS:
            count = history_counts[kind].get(mover.prop.id, 0)
            if count:
                flags.append(HistoryFlag(kind, count))
        if mover.prop.xero_contact_id:
            flags.append(HistoryFlag("xero_contact", 1))
        mover.history_flags = flags

    tenant_moves, tenant_flags = _resolve_tenants(session, move_map)
    return _Resolution(movers, tenant_moves, tenant_flags, skipped)


def _resolve_tenants(
    session: Session, move_map: dict[UUID, UUID]
) -> tuple[list[_TenantMove], list[tuple[Tenant, str]]]:
    """Decide which tenants follow the move and which are flagged in place."""

    tenant_moves: list[_TenantMove] = []
    tenant_flags: list[tuple[Tenant, str]] = []
    if not move_map:
        return tenant_moves, tenant_flags

    touching_tenant_ids = set(
        session.scalars(
            select(Lease.tenant_id)
            .join(TenancyUnit, Lease.tenancy_unit_id == TenancyUnit.id)
            .where(
                TenancyUnit.property_id.in_(list(move_map)), Lease.deleted_at.is_(None)
            )
        )
    )
    if not touching_tenant_ids:
        return tenant_moves, tenant_flags

    props_by_tenant: dict[UUID, set[UUID]] = defaultdict(set)
    for tenant_id, prop_id in session.execute(
        select(Lease.tenant_id, TenancyUnit.property_id)
        .join(TenancyUnit, Lease.tenancy_unit_id == TenancyUnit.id)
        .where(Lease.tenant_id.in_(list(touching_tenant_ids)), Lease.deleted_at.is_(None))
    ):
        props_by_tenant[tenant_id].add(prop_id)

    tenants = {
        tenant.id: tenant
        for tenant in session.scalars(
            select(Tenant).where(Tenant.id.in_(list(touching_tenant_ids)))
        )
    }
    for tenant_id, prop_ids in props_by_tenant.items():
        tenant = tenants.get(tenant_id)
        if tenant is None:
            continue
        target_entities = {move_map[pid] for pid in prop_ids if pid in move_map}
        touches_unmoved = any(pid not in move_map for pid in prop_ids)
        if len(target_entities) == 1 and not touches_unmoved:
            desired = next(iter(target_entities))
            if tenant.entity_id != desired:
                tenant_moves.append(_TenantMove(tenant, desired))
        elif len(target_entities) > 1:
            tenant_flags.append(
                (tenant, "Leases span multiple target entities.")
            )
        else:
            tenant_flags.append(
                (tenant, "Also leases a property staying under the current entity.")
            )
    return tenant_moves, tenant_flags


# --- public API -------------------------------------------------------------


def plan_reassignment(
    session: Session,
    *,
    targets: dict[UUID, UUID],
    writable_entity_ids: set[UUID],
) -> ReassignmentPreview:
    """Preview a property→entity reassignment. Mutates nothing."""

    resolution = _resolve(session, targets, writable_entity_ids)

    properties = [
        PropertyReassignmentPlan(
            property_id=mover.prop.id,
            property_name=mover.prop.name,
            current_entity_id=mover.prop.entity_id,
            current_entity_name=mover.current.name if mover.current else None,
            target_entity_id=mover.target.id,
            target_entity_name=mover.target.name,
            obligation_count=len(mover.obligations),
            history_flags=mover.history_flags,
        )
        for mover in resolution.movers
    ]
    tenants = [
        TenantReassignmentPlan(
            tenant_id=move.tenant.id,
            tenant_name=move.tenant.legal_name,
            disposition="move",
        )
        for move in resolution.tenant_moves
    ] + [
        TenantReassignmentPlan(
            tenant_id=tenant.id,
            tenant_name=tenant.legal_name,
            disposition="flag",
            reason=reason,
        )
        for tenant, reason in resolution.tenant_flags
    ]

    moved_obligation_count = sum(len(mover.obligations) for mover in resolution.movers)
    has_history = any(mover.history_flags for mover in resolution.movers)

    warnings: list[str] = []
    history_props = sum(1 for mover in resolution.movers if mover.history_flags)
    if history_props:
        warnings.append(
            f"{history_props} propert{'y' if history_props == 1 else 'ies'} "
            "have accounting or operational records under the current entity that "
            "stay put. Reassign moves the property, its obligations, and tenants — "
            "not existing invoices, billing drafts, work orders, or arrears."
        )
    if resolution.tenant_flags:
        warnings.append(
            f"{len(resolution.tenant_flags)} tenant(s) lease across the move boundary "
            "and are left under the current entity rather than split."
        )

    return ReassignmentPreview(
        properties=properties,
        tenants=tenants,
        skipped=resolution.skipped,
        moved_property_count=len(resolution.movers),
        moved_obligation_count=moved_obligation_count,
        moved_tenant_count=len(resolution.tenant_moves),
        flagged_tenant_count=len(resolution.tenant_flags),
        skipped_property_count=len(resolution.skipped),
        has_history=has_history,
        warnings=warnings,
    )


def apply_reassignment(
    session: Session,
    *,
    targets: dict[UUID, UUID],
    writable_entity_ids: set[UUID],
    actor: str,
    user_id: UUID,
) -> ReassignmentResult:
    """Move properties to their target entities. Flushes; caller commits.

    No provider calls are made — this is a local re-filing. Each moved property
    gets an audit row recording the source entity and previous owner label, so
    the move is reversible.
    """

    resolution = _resolve(session, targets, writable_entity_ids)
    now = utcnow()
    notes: list[str] = []
    moved_obligation_count = 0

    for mover in resolution.movers:
        prop = mover.prop
        old_entity_id = prop.entity_id
        previous_label = prop.owner_legal_name

        prop.entity_id = mover.target.id
        # Sync the displayed owner label to the target entity so the owner chip
        # and the filing agree from here on.
        prop.owner_legal_name = mover.target.name

        metadata = dict(prop.property_metadata or {})
        history = list(metadata.get("reassignment_history") or [])
        history.append(
            {
                "from_entity_id": str(old_entity_id),
                "to_entity_id": str(mover.target.id),
                "previous_owner_legal_name": previous_label,
                "at": now.isoformat(),
            }
        )
        metadata["reassignment_history"] = history
        prop.property_metadata = metadata

        for obligation in mover.obligations:
            obligation.entity_id = mover.target.id
            moved_obligation_count += 1

        audit_log(
            session,
            actor=actor,
            user_id=user_id,
            entity_id=mover.target.id,
            action="entity_reassign",
            target_table="property",
            target_id=prop.id,
            tool_input={
                "from_entity_id": str(old_entity_id),
                "to_entity_id": str(mover.target.id),
                "previous_owner_legal_name": previous_label,
            },
            tool_output_summary=(
                f"Reassigned property to '{mover.target.name}'; "
                f"{len(mover.obligations)} obligation(s) moved. "
                "No provider call was made."
            ),
        )

    for move in resolution.tenant_moves:
        move.tenant.entity_id = move.target_entity_id

    for tenant, reason in resolution.tenant_flags:
        notes.append(f"Tenant '{tenant.legal_name}' left in place ({reason})")

    session.flush()
    return ReassignmentResult(
        moved_property_count=len(resolution.movers),
        moved_obligation_count=moved_obligation_count,
        moved_tenant_count=len(resolution.tenant_moves),
        flagged_tenant_count=len(resolution.tenant_flags),
        skipped_property_count=len(resolution.skipped),
        notes=notes,
    )
