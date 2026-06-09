"""Entity CRUD routes."""

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    Entity,
    Lease,
    Obligation,
    Property,
    TenancyUnit,
    Tenant,
    UserEntityRole,
    UserRole,
    XeroConnection,
)

from apps.api.deps import CurrentUser, get_current_user, get_session
from apps.api.schemas.register import (
    EntityCreate,
    EntityRead,
    EntityUpdate,
    EntityXeroOverviewRead,
    EntityXeroOverviewSummary,
    EntityXeroStatusRead,
    OwnershipSplitApplyEntityResult,
    OwnershipSplitApplyRequest,
    OwnershipSplitApplyResult,
    OwnershipSplitGroupRead,
    OwnershipSplitPlanRead,
    OwnershipSplitPropertyRead,
)

router = APIRouter(prefix="/entities", tags=["entities"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}


def _as_aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _normalise_owner_label(value: str) -> str:
    return " ".join(value.lower().replace("&", "and").split())


def _chain_head(value: str) -> str:
    """The property's owning entity is the head of an ownership chain.

    Ownership chains are stored with ``->`` separators (e.g.
    "SMSF -> SJI No 1 (sublet) -> ..."). Per the SKJ rule, the property is
    owned/invoiced by the head entity; the tail segments are sublease
    arrangements, not owners.
    """
    return value.split("->")[0].strip()


def _property_owning_label(prop: Property) -> str | None:
    """Derive the single owning-entity label for a property from owner fields.

    Mirrors the priority used by the frontend owner-chip helper
    (apps/web/src/lib/property-ownership.ts) but collapses to one head owner.
    """
    metadata = prop.property_metadata or {}
    candidates: list[str | None] = [
        prop.owner_legal_name,
        metadata.get("owning_entity_legal") if isinstance(metadata, dict) else None,
        prop.trust_name,
        metadata.get("owning_entity") if isinstance(metadata, dict) else None,
        prop.invoice_issuer_name,
    ]
    for candidate in candidates:
        if isinstance(candidate, str) and candidate.strip():
            head = _chain_head(candidate)
            if head:
                return head
    return None


@router.get("", response_model=list[EntityRead])
def list_entities(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    include_deleted: bool = False,
) -> list[Entity]:
    statement = (
        select(Entity)
        .join(UserEntityRole, UserEntityRole.entity_id == Entity.id)
        .where(Entity.organisation_id == user.organisation_id, UserEntityRole.user_id == user.id)
    )
    if not include_deleted:
        statement = statement.where(Entity.deleted_at.is_(None))
    return list(session.scalars(statement.order_by(Entity.name)))


@router.post("", response_model=EntityRead, status_code=status.HTTP_201_CREATED)
def create_entity(
    payload: EntityCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Entity:
    if payload.organisation_id != user.organisation_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organisation denied.")
    entity = Entity(**payload.model_dump())
    session.add(entity)
    session.flush()
    session.add(UserEntityRole(user_id=user.id, entity_id=entity.id, role=UserRole.owner))
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity.id,
        action="create",
        target_table="entity",
        target_id=entity.id,
    )
    session.commit()
    session.refresh(entity)
    return entity


@router.get("/xero-overview", response_model=EntityXeroOverviewRead)
def entities_xero_overview(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> EntityXeroOverviewRead:
    """Cross-entity Xero connection health for the Entities & Xero hub.

    One row per accessible entity with its property count and derived Xero
    status. Read-only: this never starts an OAuth flow or touches a provider.
    """
    entities = list(
        session.scalars(
            select(Entity)
            .join(UserEntityRole, UserEntityRole.entity_id == Entity.id)
            .where(
                Entity.organisation_id == user.organisation_id,
                UserEntityRole.user_id == user.id,
                Entity.deleted_at.is_(None),
            )
            .order_by(Entity.name)
        )
    )
    entity_ids = [entity.id for entity in entities]
    property_counts: dict[UUID, int] = {}
    connections: dict[UUID, XeroConnection] = {}
    if entity_ids:
        for entity_id, count in session.execute(
            select(Property.entity_id, func.count(Property.id))
            .where(Property.entity_id.in_(entity_ids), Property.deleted_at.is_(None))
            .group_by(Property.entity_id)
        ):
            property_counts[entity_id] = count
        for connection in session.scalars(
            select(XeroConnection).where(
                XeroConnection.entity_id.in_(entity_ids),
                XeroConnection.revoked_at.is_(None),
                XeroConnection.deleted_at.is_(None),
            )
        ):
            connections[connection.entity_id] = connection

    now = datetime.now(UTC)
    counts = {"connected": 0, "token_expired": 0, "manual": 0, "not_connected": 0}
    rows: list[EntityXeroStatusRead] = []
    for entity in entities:
        connection = connections.get(entity.id)
        if connection is not None:
            expires_at = _as_aware(connection.token_expires_at)
            if expires_at is not None and expires_at < now:
                xero_status = "token_expired"
            else:
                xero_status = "connected"
            tenant_name = connection.tenant_name
            last_sync_at = connection.last_contact_sync_at
            token_expires_at = connection.token_expires_at
        elif entity.xero_tenant_id:
            xero_status = "manual"
            tenant_name = None
            last_sync_at = entity.xero_last_sync_at
            token_expires_at = None
        else:
            xero_status = "not_connected"
            tenant_name = None
            last_sync_at = None
            token_expires_at = None
        counts[xero_status] += 1
        rows.append(
            EntityXeroStatusRead(
                id=entity.id,
                name=entity.name,
                entity_type=entity.entity_type,
                is_managing_entity=entity.is_managing_entity,
                property_count=property_counts.get(entity.id, 0),
                xero_status=xero_status,
                tenant_name=tenant_name,
                last_sync_at=last_sync_at,
                token_expires_at=token_expires_at,
            )
        )
    return EntityXeroOverviewRead(
        summary=EntityXeroOverviewSummary(total=len(entities), **counts),
        entities=rows,
    )


@router.get("/ownership-split-plan", response_model=OwnershipSplitPlanRead)
def entities_ownership_split_plan(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> OwnershipSplitPlanRead:
    """Dry-run: group properties by their owning entity derived from owner labels.

    Read-only preview of how the single-entity portfolio would split into one
    entity per owning trust (so each can hold its own Xero). Creates and moves
    nothing — the reviewed apply is a separate, explicit step.
    """
    entities = list(
        session.scalars(
            select(Entity)
            .join(UserEntityRole, UserEntityRole.entity_id == Entity.id)
            .where(
                Entity.organisation_id == user.organisation_id,
                UserEntityRole.user_id == user.id,
                Entity.deleted_at.is_(None),
            )
        )
    )
    entity_ids = [entity.id for entity in entities]
    properties = (
        list(
            session.scalars(
                select(Property)
                .where(Property.entity_id.in_(entity_ids), Property.deleted_at.is_(None))
                .order_by(Property.name)
            )
        )
        if entity_ids
        else []
    )

    property_ids = [prop.id for prop in properties]
    unit_counts: dict[UUID, int] = {}
    lease_counts: dict[UUID, int] = {}
    if property_ids:
        for property_id, count in session.execute(
            select(TenancyUnit.property_id, func.count(TenancyUnit.id))
            .where(TenancyUnit.property_id.in_(property_ids), TenancyUnit.deleted_at.is_(None))
            .group_by(TenancyUnit.property_id)
        ):
            unit_counts[property_id] = count
        for property_id, count in session.execute(
            select(TenancyUnit.property_id, func.count(Lease.id))
            .join(Lease, Lease.tenancy_unit_id == TenancyUnit.id)
            .where(TenancyUnit.property_id.in_(property_ids), Lease.deleted_at.is_(None))
            .group_by(TenancyUnit.property_id)
        ):
            lease_counts[property_id] = count

    proposed_name_by_key: dict[str, str] = {}
    props_by_key: dict[str, list[OwnershipSplitPropertyRead]] = {}
    units_by_key: dict[str, int] = {}
    leases_by_key: dict[str, int] = {}
    unresolved = 0
    for prop in properties:
        label = _property_owning_label(prop)
        if label is None:
            unresolved += 1
            continue
        key = _normalise_owner_label(label)
        address = ", ".join(
            part for part in [prop.street_address, prop.suburb, prop.state] if part
        )
        proposed_name_by_key.setdefault(key, label)
        props_by_key.setdefault(key, []).append(
            OwnershipSplitPropertyRead(id=prop.id, name=prop.name, address=address)
        )
        units_by_key[key] = units_by_key.get(key, 0) + unit_counts.get(prop.id, 0)
        leases_by_key[key] = leases_by_key.get(key, 0) + lease_counts.get(prop.id, 0)

    group_reads = [
        OwnershipSplitGroupRead(
            proposed_name=proposed_name_by_key[key],
            normalized_key=key,
            property_count=len(props_by_key[key]),
            unit_count=units_by_key[key],
            lease_count=leases_by_key[key],
            properties=props_by_key[key],
        )
        for key in sorted(proposed_name_by_key, key=lambda k: proposed_name_by_key[k])
    ]
    return OwnershipSplitPlanRead(
        source_entity_count=len(entities),
        proposed_entity_count=len(group_reads),
        unresolved_property_count=unresolved,
        groups=group_reads,
    )


@router.post(
    "/ownership-split/apply",
    response_model=OwnershipSplitApplyResult,
    status_code=status.HTTP_201_CREATED,
)
def entities_ownership_split_apply(
    payload: OwnershipSplitApplyRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> OwnershipSplitApplyResult:
    """Reviewed apply: create one entity per group and reassign its properties.

    Moves the property, its property-scoped obligations, and tenants whose leases
    fall entirely within one group. Tenants whose leases span entities are left
    in place and flagged rather than corrupted. Units / leases / charge rules
    carry no entity_id and follow their property structurally. Runs in one
    transaction; no provider calls. Each created entity records an audit row with
    the source entity and moved property ids for reversibility.
    """
    write_entity_ids = {
        entity_id
        for entity_id, role in session.execute(
            select(UserEntityRole.entity_id, UserEntityRole.role)
            .join(Entity, Entity.id == UserEntityRole.entity_id)
            .where(
                Entity.organisation_id == user.organisation_id,
                UserEntityRole.user_id == user.id,
            )
        )
        if role in WRITE_ROLES
    }

    requested_ids = [pid for group in payload.groups for pid in group.property_ids]
    if not requested_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="No properties to split."
        )
    properties = {
        prop.id: prop
        for prop in session.scalars(
            select(Property).where(
                Property.id.in_(requested_ids), Property.deleted_at.is_(None)
            )
        )
    }

    org_entities = list(
        session.scalars(
            select(Entity).where(
                Entity.organisation_id == user.organisation_id,
                Entity.deleted_at.is_(None),
            )
        )
    )
    entity_by_id = {entity.id: entity for entity in org_entities}
    entity_by_norm_name = {
        _normalise_owner_label(entity.name): entity for entity in org_entities
    }

    notes: list[str] = []
    property_to_new_entity: dict[UUID, UUID] = {}
    source_entity_ids: set[UUID] = set()
    created: list[OwnershipSplitApplyEntityResult] = []
    moved_property_count = 0
    skipped_property_count = 0
    moved_obligation_count = 0

    for group in payload.groups:
        name = group.proposed_name.strip()
        if not name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Each group needs a name."
            )
        norm_name = _normalise_owner_label(name)
        # Determine movable properties: known, writable, and not already sitting
        # under an entity of this group's name (keeps re-runs idempotent).
        group_props: list[Property] = []
        for pid in group.property_ids:
            prop = properties.get(pid)
            if prop is None or prop.entity_id not in write_entity_ids:
                skipped_property_count += 1
                continue
            current_entity = entity_by_id.get(prop.entity_id)
            if current_entity is not None and (
                _normalise_owner_label(current_entity.name) == norm_name
            ):
                continue  # already under this target — idempotent no-op
            group_props.append(prop)
        if not group_props:
            continue

        target = entity_by_norm_name.get(norm_name)
        newly_created = target is None
        if target is None:
            target = Entity(
                organisation_id=user.organisation_id,
                name=name,
                entity_type=group.entity_type.value if group.entity_type else None,
            )
            session.add(target)
            session.flush()
            session.add(
                UserEntityRole(user_id=user.id, entity_id=target.id, role=UserRole.owner)
            )
            entity_by_norm_name[norm_name] = target
            entity_by_id[target.id] = target

        moved_from: dict[str, str] = {}
        for prop in group_props:
            source_entity_ids.add(prop.entity_id)
            moved_from[str(prop.id)] = str(prop.entity_id)
            prop.entity_id = target.id
            property_to_new_entity[prop.id] = target.id
            moved_property_count += 1
            for obligation in session.scalars(
                select(Obligation).where(
                    Obligation.property_id == prop.id, Obligation.deleted_at.is_(None)
                )
            ):
                obligation.entity_id = target.id
                moved_obligation_count += 1
        audit_log(
            session,
            actor=user.actor,
            user_id=user.id,
            entity_id=target.id,
            action="entity_split",
            target_table="entity",
            target_id=target.id,
            tool_input={"moved_from": moved_from},
            tool_output_summary=f"Split {len(group_props)} properties into '{name}'.",
        )
        if newly_created:
            created.append(
                OwnershipSplitApplyEntityResult(
                    id=target.id, name=name, property_count=len(group_props)
                )
            )

    moved_tenant_count = 0
    flagged_tenant_count = 0
    if source_entity_ids:
        for tenant in session.scalars(
            select(Tenant).where(
                Tenant.entity_id.in_(source_entity_ids), Tenant.deleted_at.is_(None)
            )
        ):
            target_entities: set[UUID] = set()
            touches_unmoved = False
            has_lease = False
            for (property_id,) in session.execute(
                select(TenancyUnit.property_id)
                .join(Lease, Lease.tenancy_unit_id == TenancyUnit.id)
                .where(Lease.tenant_id == tenant.id, Lease.deleted_at.is_(None))
            ):
                has_lease = True
                new_entity_id = property_to_new_entity.get(property_id)
                if new_entity_id is None:
                    touches_unmoved = True
                else:
                    target_entities.add(new_entity_id)
            if has_lease and not touches_unmoved and len(target_entities) == 1:
                tenant.entity_id = next(iter(target_entities))
                moved_tenant_count += 1
            elif len(target_entities) > 1 or (target_entities and touches_unmoved):
                flagged_tenant_count += 1
                notes.append(
                    f"Tenant '{tenant.legal_name}' left in place (leases span entities)."
                )

    session.commit()
    return OwnershipSplitApplyResult(
        created_entities=created,
        moved_property_count=moved_property_count,
        moved_obligation_count=moved_obligation_count,
        moved_tenant_count=moved_tenant_count,
        skipped_property_count=skipped_property_count,
        flagged_tenant_count=flagged_tenant_count,
        notes=notes,
    )


@router.get("/{entity_id}", response_model=EntityRead)
def get_entity(
    entity_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Entity:
    entity = session.get(Entity, entity_id)
    if entity is None or entity.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")
    if entity.organisation_id != user.organisation_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organisation denied.")
    role = session.scalar(
        select(UserEntityRole.role).where(
            UserEntityRole.user_id == user.id,
            UserEntityRole.entity_id == entity.id,
        )
    )
    if role not in READ_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Entity denied.")
    return entity


@router.patch("/{entity_id}", response_model=EntityRead)
def update_entity(
    entity_id: UUID,
    payload: EntityUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Entity:
    entity = get_entity(entity_id, user, session)
    role = session.scalar(
        select(UserEntityRole.role).where(
            UserEntityRole.user_id == user.id,
            UserEntityRole.entity_id == entity.id,
        )
    )
    if role not in WRITE_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Entity denied.")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(entity, key, value)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity.id,
        action="update",
        target_table="entity",
        target_id=entity.id,
    )
    session.commit()
    session.refresh(entity)
    return entity


@router.delete("/{entity_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entity(
    entity_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> None:
    entity = get_entity(entity_id, user, session)
    role = session.scalar(
        select(UserEntityRole.role).where(
            UserEntityRole.user_id == user.id,
            UserEntityRole.entity_id == entity.id,
        )
    )
    if role not in WRITE_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Entity denied.")
    entity.deleted_at = utcnow()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity.id,
        action="delete",
        target_table="entity",
        target_id=entity.id,
    )
    session.commit()
