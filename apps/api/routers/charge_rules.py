"""Rent charge rule and rent roll routes."""

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    BillingDraft,
    BillingDraftStatus,
    Entity,
    InvoiceDraft,
    InvoiceDraftLine,
    InvoiceDraftStatus,
    Lease,
    Property,
    RentChargeRule,
    TenancyUnit,
    Tenant,
    UserRole,
)

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.register import (
    BillingDraftRead,
    BillingDraftUpdate,
    InvoiceDraftRead,
    InvoiceDraftUpdate,
    RentChargeRuleCreate,
    RentChargeRuleRead,
    RentChargeRuleUpdate,
    RentRollChargeRuleRead,
    RentRollRowRead,
)

router = APIRouter(tags=["billing"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}
PROPERTY_OWNER_BILLING_STRUCTURES = {"property_owner", "trust", "split"}


def _property_for_access(
    property_id: UUID, user: CurrentUser, session: Session, roles: set[UserRole]
) -> Property:
    prop = session.get(Property, property_id)
    if prop is None or prop.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found.")
    assert_entity_role(session, user, prop.entity_id, roles)
    return prop


def _lease_for_access(
    lease_id: UUID, user: CurrentUser, session: Session, roles: set[UserRole]
) -> tuple[Lease, UUID]:
    lease = session.get(Lease, lease_id)
    if lease is None or lease.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lease not found.")
    unit = session.get(TenancyUnit, lease.tenancy_unit_id)
    if unit is None or unit.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenancy unit not found.")
    prop = _property_for_access(unit.property_id, user, session, roles)
    tenant = session.get(Tenant, lease.tenant_id)
    if tenant is None or tenant.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found.")
    if tenant.entity_id != prop.entity_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Lease links tenant and unit across different entities.",
        )
    return lease, prop.entity_id


def _charge_rule_for_access(
    charge_rule_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> tuple[RentChargeRule, UUID]:
    charge_rule = session.get(RentChargeRule, charge_rule_id)
    if charge_rule is None or charge_rule.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Charge rule not found.")
    _, entity_id = _lease_for_access(charge_rule.lease_id, user, session, roles)
    return charge_rule, entity_id


def _billing_draft_for_access(
    billing_draft_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> BillingDraft:
    draft = session.get(BillingDraft, billing_draft_id)
    if draft is None or draft.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Billing draft not found.",
        )
    assert_entity_role(session, user, draft.entity_id, roles)
    return draft


def _invoice_draft_for_access(
    invoice_draft_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> InvoiceDraft:
    draft = session.get(InvoiceDraft, invoice_draft_id)
    if draft is None or draft.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invoice draft not found.",
        )
    assert_entity_role(session, user, draft.entity_id, roles)
    return draft


def _invoice_number_for_billing_draft(
    draft: BillingDraft,
    prop: Property | None,
) -> str:
    prefix = (prop.invoice_reference if prop is not None else None) or "INV-"
    if not prefix.endswith(("-", "/")):
        prefix = f"{prefix}-"
    invoice_date = draft.issue_date or draft.due_date or date.today()
    return f"{prefix}{invoice_date:%Y%m%d}-{str(draft.id)[:8].upper()}"


def _invoice_draft_blockers(
    draft: BillingDraft,
    prop: Property | None,
    tenant: Tenant | None,
    entity: Entity | None,
    line_count: int,
) -> list[str]:
    blockers: list[str] = []
    structure = prop.ownership_structure if prop is not None else None

    if prop is None:
        blockers.append("Property record missing.")
    elif not (
        prop.invoice_issuer_name
        or prop.owner_legal_name
        or (entity.name if entity is not None else None)
    ):
        blockers.append("Invoice issuer missing.")
    if prop is not None and structure in PROPERTY_OWNER_BILLING_STRUCTURES and not prop.owner_abn:
        blockers.append("ABN missing for property owner.")
    if tenant is None:
        blockers.append("Tenant record missing.")
    elif not (tenant.billing_email or tenant.contact_email):
        blockers.append("Tenant billing email missing.")
    if draft.due_date is None:
        blockers.append("Due date missing.")
    if line_count == 0:
        blockers.append("Invoice draft has no line items.")
    if draft.total_cents <= 0:
        blockers.append("Invoice draft amount missing.")
    if prop is not None and not prop.xero_contact_id:
        blockers.append("Xero issuer mapping missing before sync.")
    if entity is not None and not entity.xero_tenant_id:
        blockers.append("Xero connection missing before sync.")
    return blockers


def _property_billing_blockers(
    prop: Property,
    charge_rules: list[RentChargeRule],
) -> tuple[list[str], list[str], list[str]]:
    structure = prop.ownership_structure or "current_entity"
    if structure not in PROPERTY_OWNER_BILLING_STRUCTURES:
        return [], [], []

    invoice_blockers: list[str] = []
    xero_blockers: list[str] = []
    gst_blockers: list[str] = []

    if not (prop.invoice_issuer_name or prop.owner_legal_name):
        invoice_blockers.append("Invoice issuer missing.")
    if not prop.owner_abn:
        invoice_blockers.append("ABN missing for property owner.")
    if structure == "trust" and not prop.trustee_name:
        invoice_blockers.append("Trustee missing.")
    if structure == "split" and not prop.ownership_split:
        invoice_blockers.append("Ownership split incomplete.")
    if not prop.xero_contact_id:
        xero_blockers.append("Xero issuer mapping missing.")
    if (
        prop.owner_gst_registered is False
        and any(rule.gst_treatment == "taxable" for rule in charge_rules)
    ):
        gst_blockers.append("Property invoice issuer is not GST registered.")

    return gst_blockers, xero_blockers, invoice_blockers


@router.get("/billing-drafts", response_model=list[BillingDraftRead])
def list_billing_drafts(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: Annotated[UUID, Query()],
    property_id: UUID | None = None,
    lease_id: UUID | None = None,
    document_intake_id: UUID | None = None,
    draft_status: BillingDraftStatus | None = None,
    include_deleted: bool = False,
) -> list[BillingDraft]:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    statement = select(BillingDraft).where(BillingDraft.entity_id == entity_id)
    if property_id is not None:
        prop = _property_for_access(property_id, user, session, READ_ROLES)
        if prop.entity_id != entity_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Property must belong to the selected entity.",
            )
        statement = statement.where(BillingDraft.property_id == property_id)
    if lease_id is not None:
        _, lease_entity_id = _lease_for_access(lease_id, user, session, READ_ROLES)
        if lease_entity_id != entity_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Lease must belong to the selected entity.",
            )
        statement = statement.where(BillingDraft.lease_id == lease_id)
    if document_intake_id is not None:
        statement = statement.where(BillingDraft.document_intake_id == document_intake_id)
    if draft_status is not None:
        statement = statement.where(BillingDraft.status == draft_status)
    if not include_deleted:
        statement = statement.where(BillingDraft.deleted_at.is_(None))

    return list(
        session.scalars(
            statement.order_by(BillingDraft.due_date, BillingDraft.created_at.desc())
        )
    )


@router.get("/billing-drafts/{billing_draft_id}", response_model=BillingDraftRead)
def get_billing_draft(
    billing_draft_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> BillingDraft:
    return _billing_draft_for_access(billing_draft_id, user, session, READ_ROLES)


@router.patch("/billing-drafts/{billing_draft_id}", response_model=BillingDraftRead)
def update_billing_draft(
    billing_draft_id: UUID,
    payload: BillingDraftUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> BillingDraft:
    draft = _billing_draft_for_access(billing_draft_id, user, session, WRITE_ROLES)
    data = payload.model_dump(exclude_unset=True)
    metadata = dict(draft.billing_metadata or {})
    if "status" in data and data["status"] is not None:
        draft.status = data["status"]
        history = list(metadata.get("status_history") or [])
        status_entry = {
            "status": draft.status.value,
            "changed_at": utcnow().isoformat(),
            "user_id": str(user.id),
        }
        history.append(status_entry)
        metadata["status_history"] = history
        if draft.status == BillingDraftStatus.approved:
            metadata["approved_at"] = status_entry["changed_at"]
            metadata["approved_by_user_id"] = str(user.id)
        if draft.status == BillingDraftStatus.void:
            metadata["voided_at"] = status_entry["changed_at"]
            metadata["voided_by_user_id"] = str(user.id)
    if "notes" in data:
        draft.notes = data["notes"]
    draft.billing_metadata = metadata
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=draft.entity_id,
        action="update",
        target_table="billing_draft",
        target_id=draft.id,
        tool_output_summary=f"Updated billing draft status to {draft.status.value}.",
    )
    session.commit()
    session.refresh(draft)
    return draft


@router.post("/billing-drafts/{billing_draft_id}/invoice-drafts", response_model=InvoiceDraftRead)
def create_invoice_draft_from_billing_draft(
    billing_draft_id: UUID,
    response: Response,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> InvoiceDraft:
    draft = _billing_draft_for_access(billing_draft_id, user, session, WRITE_ROLES)
    if draft.status != BillingDraftStatus.approved:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Approve the billing draft before creating an invoice draft.",
        )

    existing = session.scalar(
        select(InvoiceDraft).where(
            InvoiceDraft.billing_draft_id == draft.id,
            InvoiceDraft.deleted_at.is_(None),
        )
    )
    if existing is not None:
        response.status_code = status.HTTP_200_OK
        return existing

    source_lines = [line for line in draft.lines if line.deleted_at is None]
    if not source_lines:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Billing draft needs at least one line before invoice drafting.",
        )

    entity = session.get(Entity, draft.entity_id)
    prop = session.get(Property, draft.property_id) if draft.property_id else None
    tenant = session.get(Tenant, draft.tenant_id) if draft.tenant_id else None
    recipient_email = None
    if tenant is not None:
        recipient_email = tenant.billing_email or tenant.contact_email
    issuer_name = None
    if prop is not None:
        issuer_name = prop.invoice_issuer_name or prop.owner_legal_name
    issuer_name = issuer_name or (entity.name if entity is not None else None)
    subtotal_cents = sum(line.amount_cents for line in source_lines)
    blockers = _invoice_draft_blockers(draft, prop, tenant, entity, len(source_lines))
    created_at = utcnow().isoformat()
    invoice = InvoiceDraft(
        entity_id=draft.entity_id,
        billing_draft_id=draft.id,
        property_id=draft.property_id,
        tenancy_unit_id=draft.tenancy_unit_id,
        tenant_id=draft.tenant_id,
        lease_id=draft.lease_id,
        document_id=draft.document_id,
        document_intake_id=draft.document_intake_id,
        status=InvoiceDraftStatus.draft,
        invoice_number=_invoice_number_for_billing_draft(draft, prop),
        title=draft.title,
        currency=draft.currency,
        issue_date=draft.issue_date,
        due_date=draft.due_date,
        subtotal_cents=subtotal_cents,
        gst_cents=0,
        total_cents=draft.total_cents or subtotal_cents,
        issuer_name=issuer_name,
        issuer_abn=prop.owner_abn if prop is not None else None,
        recipient_name=tenant.legal_name if tenant is not None else None,
        recipient_email=recipient_email,
        notes="Internal invoice draft only. No PDF generated, tenant email sent, or Xero sync run.",
        invoice_metadata={
            "source": "billing_draft",
            "billing_draft_id": str(draft.id),
            "source_document_id": str(draft.document_id),
            "document_intake_id": str(draft.document_intake_id)
            if draft.document_intake_id
            else None,
            "created_from_billing_draft_at": created_at,
            "created_by_user_id": str(user.id),
            "readiness_blockers": blockers,
            "delivery_state": {
                "pdf_generated": False,
                "tenant_email_sent": False,
                "xero_synced": False,
            },
        },
    )
    session.add(invoice)
    session.flush()

    for line in source_lines:
        session.add(
            InvoiceDraftLine(
                invoice_draft_id=invoice.id,
                billing_draft_line_id=line.id,
                description=line.description,
                amount_cents=line.amount_cents,
                gst_cents=0,
                currency=line.currency,
                source_hint=line.source_hint,
                line_metadata={
                    **(line.line_metadata or {}),
                    "source_billing_draft_line_id": str(line.id),
                },
            )
        )

    draft_metadata = dict(draft.billing_metadata or {})
    draft_metadata["invoice_draft_id"] = str(invoice.id)
    history = list(draft_metadata.get("invoice_draft_history") or [])
    history.append(
        {
            "invoice_draft_id": str(invoice.id),
            "created_at": created_at,
            "user_id": str(user.id),
        }
    )
    draft_metadata["invoice_draft_history"] = history
    draft.billing_metadata = draft_metadata

    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=invoice.entity_id,
        action="create",
        target_table="invoice_draft",
        target_id=invoice.id,
        tool_output_summary=(
            "Created internal invoice draft from approved billing draft; "
            "no PDF, tenant email, or Xero sync was run."
        ),
    )
    session.commit()
    session.refresh(invoice)
    response.status_code = status.HTTP_201_CREATED
    return invoice


@router.get("/invoice-drafts", response_model=list[InvoiceDraftRead])
def list_invoice_drafts(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: Annotated[UUID, Query()],
    billing_draft_id: UUID | None = None,
    draft_status: InvoiceDraftStatus | None = None,
    include_deleted: bool = False,
) -> list[InvoiceDraft]:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    statement = select(InvoiceDraft).where(InvoiceDraft.entity_id == entity_id)
    if billing_draft_id is not None:
        billing_draft = _billing_draft_for_access(
            billing_draft_id,
            user,
            session,
            READ_ROLES,
        )
        if billing_draft.entity_id != entity_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Billing draft must belong to the selected entity.",
            )
        statement = statement.where(InvoiceDraft.billing_draft_id == billing_draft_id)
    if draft_status is not None:
        statement = statement.where(InvoiceDraft.status == draft_status)
    if not include_deleted:
        statement = statement.where(InvoiceDraft.deleted_at.is_(None))

    return list(
        session.scalars(
            statement.order_by(InvoiceDraft.due_date, InvoiceDraft.created_at.desc())
        )
    )


@router.get("/invoice-drafts/{invoice_draft_id}", response_model=InvoiceDraftRead)
def get_invoice_draft(
    invoice_draft_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> InvoiceDraft:
    return _invoice_draft_for_access(invoice_draft_id, user, session, READ_ROLES)


@router.patch("/invoice-drafts/{invoice_draft_id}", response_model=InvoiceDraftRead)
def update_invoice_draft(
    invoice_draft_id: UUID,
    payload: InvoiceDraftUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> InvoiceDraft:
    draft = _invoice_draft_for_access(invoice_draft_id, user, session, WRITE_ROLES)
    data = payload.model_dump(exclude_unset=True)
    metadata = dict(draft.invoice_metadata or {})
    if "status" in data and data["status"] is not None:
        draft.status = data["status"]
        history = list(metadata.get("status_history") or [])
        status_entry = {
            "status": draft.status.value,
            "changed_at": utcnow().isoformat(),
            "user_id": str(user.id),
        }
        history.append(status_entry)
        metadata["status_history"] = history
        if draft.status == InvoiceDraftStatus.approved:
            metadata["approved_at"] = status_entry["changed_at"]
            metadata["approved_by_user_id"] = str(user.id)
        if draft.status == InvoiceDraftStatus.void:
            metadata["voided_at"] = status_entry["changed_at"]
            metadata["voided_by_user_id"] = str(user.id)
    if "notes" in data:
        draft.notes = data["notes"]
    draft.invoice_metadata = metadata
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=draft.entity_id,
        action="update",
        target_table="invoice_draft",
        target_id=draft.id,
        tool_output_summary=(
            f"Updated invoice draft status to {draft.status.value}; "
            "no PDF, tenant email, or Xero sync was run."
        ),
    )
    session.commit()
    session.refresh(draft)
    return draft


@router.get("/charge-rules", response_model=list[RentChargeRuleRead])
def list_charge_rules(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: UUID | None = None,
    property_id: UUID | None = None,
    lease_id: UUID | None = None,
    include_deleted: bool = False,
) -> list[RentChargeRule]:
    if entity_id is None and property_id is None and lease_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide an entity, property, or lease scope.",
        )

    statement = (
        select(RentChargeRule)
        .join(Lease)
        .join(TenancyUnit, TenancyUnit.id == Lease.tenancy_unit_id)
        .join(Property, Property.id == TenancyUnit.property_id)
    )
    if entity_id is not None:
        assert_entity_role(session, user, entity_id, READ_ROLES)
        statement = statement.where(Property.entity_id == entity_id)
    if property_id is not None:
        _property_for_access(property_id, user, session, READ_ROLES)
        statement = statement.where(Property.id == property_id)
    if lease_id is not None:
        _lease_for_access(lease_id, user, session, READ_ROLES)
        statement = statement.where(RentChargeRule.lease_id == lease_id)
    if not include_deleted:
        statement = statement.where(RentChargeRule.deleted_at.is_(None))

    statement = statement.where(
        Lease.deleted_at.is_(None),
        TenancyUnit.deleted_at.is_(None),
        Property.deleted_at.is_(None),
    )
    return list(
        session.scalars(
            statement.order_by(RentChargeRule.next_due_date, RentChargeRule.created_at)
        )
    )


@router.post(
    "/charge-rules",
    response_model=RentChargeRuleRead,
    status_code=status.HTTP_201_CREATED,
)
def create_charge_rule(
    payload: RentChargeRuleCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> RentChargeRule:
    _, entity_id = _lease_for_access(payload.lease_id, user, session, WRITE_ROLES)
    if payload.amount_cents < 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Charge amount cannot be negative.",
        )
    data = payload.model_dump()
    data["charge_rule_metadata"] = data.pop("metadata")
    charge_rule = RentChargeRule(**data)
    session.add(charge_rule)
    session.flush()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity_id,
        action="create",
        target_table="rent_charge_rule",
        target_id=charge_rule.id,
    )
    session.commit()
    session.refresh(charge_rule)
    return charge_rule


@router.patch("/charge-rules/{charge_rule_id}", response_model=RentChargeRuleRead)
def update_charge_rule(
    charge_rule_id: UUID,
    payload: RentChargeRuleUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> RentChargeRule:
    charge_rule, entity_id = _charge_rule_for_access(
        charge_rule_id, user, session, WRITE_ROLES
    )
    data = payload.model_dump(exclude_unset=True)
    if "amount_cents" in data and data["amount_cents"] is not None and data["amount_cents"] < 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Charge amount cannot be negative.",
        )
    if "metadata" in data:
        data["charge_rule_metadata"] = data.pop("metadata")
    for key, value in data.items():
        setattr(charge_rule, key, value)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity_id,
        action="update",
        target_table="rent_charge_rule",
        target_id=charge_rule.id,
    )
    session.commit()
    session.refresh(charge_rule)
    return charge_rule


@router.delete("/charge-rules/{charge_rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_charge_rule(
    charge_rule_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> None:
    charge_rule, entity_id = _charge_rule_for_access(
        charge_rule_id, user, session, WRITE_ROLES
    )
    charge_rule.deleted_at = utcnow()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity_id,
        action="delete",
        target_table="rent_charge_rule",
        target_id=charge_rule.id,
    )
    session.commit()


@router.get("/rent-roll", response_model=list[RentRollRowRead])
def rent_roll(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: Annotated[UUID, Query()],
    property_id: UUID | None = None,
    as_of: date | None = None,
) -> list[RentRollRowRead]:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    if property_id is not None:
        prop = _property_for_access(property_id, user, session, READ_ROLES)
        if prop.entity_id != entity_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Property must belong to the selected entity.",
            )

    active_lease_join = [
        Lease.tenancy_unit_id == TenancyUnit.id,
        Lease.deleted_at.is_(None),
    ]
    if as_of is not None:
        active_lease_join.extend(
            [
                or_(Lease.commencement_date.is_(None), Lease.commencement_date <= as_of),
                or_(Lease.expiry_date.is_(None), Lease.expiry_date >= as_of),
            ]
        )

    statement = (
        select(Entity, Property, TenancyUnit, Lease, Tenant)
        .join(Property, Property.entity_id == Entity.id)
        .join(TenancyUnit, TenancyUnit.property_id == Property.id)
        .outerjoin(Lease, and_(*active_lease_join))
        .outerjoin(Tenant, Tenant.id == Lease.tenant_id)
        .where(
            Entity.id == entity_id,
            Entity.deleted_at.is_(None),
            Property.deleted_at.is_(None),
            TenancyUnit.deleted_at.is_(None),
        )
    )
    if property_id is not None:
        statement = statement.where(Property.id == property_id)

    rows = session.execute(statement.order_by(Property.name, TenancyUnit.unit_label)).all()
    lease_ids = [lease.id for _, _, _, lease, _ in rows if lease is not None]
    rules_by_lease: dict[UUID, list[RentChargeRule]] = {lease_id: [] for lease_id in lease_ids}
    if lease_ids:
        rules = session.scalars(
            select(RentChargeRule)
            .where(
                RentChargeRule.lease_id.in_(lease_ids),
                RentChargeRule.deleted_at.is_(None),
            )
            .order_by(RentChargeRule.next_due_date, RentChargeRule.created_at)
        )
        for rule in rules:
            rules_by_lease.setdefault(rule.lease_id, []).append(rule)

    response: list[RentRollRowRead] = []
    for entity, prop, unit, lease, tenant in rows:
        charge_rules = rules_by_lease.get(lease.id, []) if lease is not None else []
        total_charge_cents = sum(rule.amount_cents for rule in charge_rules)
        due_dates = [rule.next_due_date for rule in charge_rules if rule.next_due_date is not None]
        next_due_date = min(due_dates) if due_dates else None

        gst_blockers = [
            f"{rule.charge_type.replace('_', ' ')} is taxable but entity is not GST registered."
            for rule in charge_rules
            if rule.gst_treatment == "taxable" and not entity.gst_registered
        ]
        xero_blockers = []
        if entity.xero_tenant_id is None:
            xero_blockers.append("Entity is not connected to Xero.")
        for rule in charge_rules:
            if not rule.xero_account_code:
                xero_blockers.append(
                    f"{rule.charge_type.replace('_', ' ')} is missing a Xero account code."
                )
            if rule.gst_treatment == "taxable" and not rule.xero_tax_type:
                xero_blockers.append(
                    f"{rule.charge_type.replace('_', ' ')} is missing a Xero tax type."
                )

        invoice_blockers = []
        if lease is None:
            invoice_blockers.append("Unit has no current lease.")
        if lease is not None and not charge_rules:
            invoice_blockers.append("Lease has no charge rules.")
        if tenant is not None and not tenant.billing_email and not tenant.contact_email:
            invoice_blockers.append("Tenant is missing a billing email.")
        for rule in charge_rules:
            if rule.amount_cents <= 0:
                invoice_blockers.append(f"{rule.charge_type.replace('_', ' ')} has no amount.")
            if rule.next_due_date is None:
                invoice_blockers.append(
                    f"{rule.charge_type.replace('_', ' ')} is missing the next due date."
                )
        (
            property_gst_blockers,
            property_xero_blockers,
            property_invoice_blockers,
        ) = _property_billing_blockers(prop, charge_rules)
        gst_blockers.extend(property_gst_blockers)
        xero_blockers.extend(property_xero_blockers)
        invoice_blockers.extend(property_invoice_blockers)

        response.append(
            RentRollRowRead(
                entity_id=entity.id,
                entity_name=entity.name,
                property_id=prop.id,
                property_name=prop.name,
                tenancy_unit_id=unit.id,
                unit_label=unit.unit_label,
                lease_id=lease.id if lease is not None else None,
                tenant_id=tenant.id if tenant is not None else None,
                tenant_name=(
                    tenant.trading_name or tenant.legal_name if tenant is not None else None
                ),
                lease_status=lease.status if lease is not None else None,
                commencement_date=lease.commencement_date if lease is not None else None,
                expiry_date=lease.expiry_date if lease is not None else None,
                tenant_billing_email=(
                    tenant.billing_email or tenant.contact_email if tenant is not None else None
                ),
                annual_rent_cents=lease.annual_rent_cents if lease is not None else None,
                rent_frequency=lease.rent_frequency if lease is not None else None,
                charge_rules=[
                    RentRollChargeRuleRead.model_validate(rule) for rule in charge_rules
                ],
                charge_rules_total_cents=total_charge_cents,
                next_due_date=next_due_date,
                gst_readiness_blockers=gst_blockers,
                xero_readiness_blockers=xero_blockers,
                invoice_readiness_blockers=invoice_blockers,
                readiness_blockers=gst_blockers + xero_blockers + invoice_blockers,
            )
        )
    return response
