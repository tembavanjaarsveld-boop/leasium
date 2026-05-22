"""Ask Leasium read-only Q&A router.

Tier 2 (e) of the 2026-05-22 UX review. Operators send a natural-language
question; the backend builds a bounded context summary of the operator's
portfolio (properties, leases, obligations, maintenance, arrears) and asks
OpenAI for an answer with strict citation requirement.

The endpoint is intentionally narrow:
- Authenticated, entity-scoped (assert_entity_role with read access).
- Returns 503 when OPENAI_API_KEY isn't configured (no records mutated).
- Audits the question + the citation kinds (not the answer body, which could
  contain sensitive paraphrased tenant detail).
"""

from __future__ import annotations

from datetime import timedelta
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.ai import AskCitation, AskRead, AskRequest
from stewart.ai.ask import ASK_GUARDRAILS, AskError, ask_leasium
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    ArrearsCase,
    Lease,
    LeaseStatus,
    MaintenanceWorkOrder,
    MaintenanceWorkOrderStatus,
    Obligation,
    Property,
    TenancyUnit,
    Tenant,
    UserRole,
)
from stewart.core.settings import Settings, get_settings

router = APIRouter(prefix="/ai", tags=["ai"])

READ_ROLES = {
    UserRole.owner,
    UserRole.admin,
    UserRole.finance,
    UserRole.ops,
    UserRole.viewer,
}

OPEN_MAINTENANCE_STATUSES = {
    MaintenanceWorkOrderStatus.requested,
    MaintenanceWorkOrderStatus.triaged,
    MaintenanceWorkOrderStatus.assigned,
    MaintenanceWorkOrderStatus.awaiting_approval,
    MaintenanceWorkOrderStatus.approved,
    MaintenanceWorkOrderStatus.in_progress,
}

ACTIVE_LEASE_STATUSES = {LeaseStatus.active, LeaseStatus.holding_over}


@router.post("/ask", response_model=AskRead)
def ask(
    payload: AskRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AskRead:
    assert_entity_role(user, payload.entity_id, READ_ROLES)
    context = _build_ask_context(payload.entity_id, session)

    try:
        provider_result, response_id = ask_leasium(
            question=payload.question,
            context=context,
            settings=settings,
        )
    except AskError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    answer = (
        provider_result.get("answer")
        if isinstance(provider_result.get("answer"), str)
        else ""
    )
    raw_citations = provider_result.get("citations")
    citations: list[AskCitation] = []
    if isinstance(raw_citations, list):
        for raw in raw_citations:
            citation = _validate_citation(raw, context_index=context.get("__index", {}))
            if citation is not None:
                citations.append(citation)
    warnings_raw = provider_result.get("warnings")
    warnings: list[str] = []
    if isinstance(warnings_raw, list):
        for warning in warnings_raw:
            if isinstance(warning, str) and warning.strip():
                warnings.append(warning.strip())

    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=payload.entity_id,
        action="query",
        target_table="ask_leasium",
        target_id=None,
        tool_name="ask_leasium",
        tool_input={
            "question": payload.question,
            "citation_kinds": sorted({citation.kind for citation in citations}),
            "warning_count": len(warnings),
        },
        tool_output_summary=(
            f"Answered with {len(citations)} citation(s)."
            if citations
            else "Answered with no citations — operator should treat as unverified."
        ),
        data_classification="internal",
    )
    session.commit()

    return AskRead(
        answer=answer or "I don't have an answer for that yet.",
        citations=citations,
        warnings=warnings,
        guardrails=list(ASK_GUARDRAILS),
        response_id=response_id,
    )


def _build_ask_context(entity_id: UUID, session: Session) -> dict[str, Any]:
    """Build a compact JSON summary of the operator's entity context.

    Kept under a few KB so prompt cost stays predictable. Larger portfolios
    use truncation with an explicit `truncated: true` flag rather than
    dropping records silently.
    """
    as_of = utcnow().date()
    far_future = as_of + timedelta(days=180)

    properties = list(
        session.scalars(
            select(Property).where(
                Property.entity_id == entity_id,
                Property.deleted_at.is_(None),
            )
        ).all()
    )
    properties_by_id = {prop.id: prop for prop in properties}

    units = list(
        session.scalars(
            select(TenancyUnit).where(
                TenancyUnit.property_id.in_(properties_by_id.keys()),
                TenancyUnit.deleted_at.is_(None),
            )
        ).all()
    ) if properties_by_id else []
    units_by_id = {unit.id: unit for unit in units}

    tenants = list(
        session.scalars(
            select(Tenant).where(
                Tenant.entity_id == entity_id,
                Tenant.deleted_at.is_(None),
            )
        ).all()
    )
    tenants_by_id = {tenant.id: tenant for tenant in tenants}

    leases = list(
        session.scalars(
            select(Lease).where(
                Lease.tenancy_unit_id.in_(units_by_id.keys()),
                Lease.deleted_at.is_(None),
            )
        ).all()
    ) if units_by_id else []

    obligations = list(
        session.scalars(
            select(Obligation).where(
                Obligation.entity_id == entity_id,
                Obligation.deleted_at.is_(None),
                Obligation.due_date <= far_future,
            )
        ).all()
    )

    work_orders = list(
        session.scalars(
            select(MaintenanceWorkOrder).where(
                MaintenanceWorkOrder.entity_id == entity_id,
                MaintenanceWorkOrder.deleted_at.is_(None),
            )
        ).all()
    )

    arrears = list(
        session.scalars(
            select(ArrearsCase).where(
                ArrearsCase.entity_id == entity_id,
                ArrearsCase.deleted_at.is_(None),
            )
        ).all()
    )

    # Build a lookup index the citation validator uses to confirm the model
    # didn't make up a record id.
    index: dict[str, set[str]] = {
        "property": {str(prop.id) for prop in properties},
        "lease": {str(lease.id) for lease in leases},
        "tenant": {str(tenant.id) for tenant in tenants},
        "obligation": {str(obligation.id) for obligation in obligations},
        "maintenance_work_order": {str(wo.id) for wo in work_orders},
        "arrears_case": {str(case.id) for case in arrears},
    }

    return {
        "as_of": as_of.isoformat(),
        "properties": [
            {
                "id": str(prop.id),
                "name": prop.name,
                "address": ", ".join(
                    part
                    for part in [
                        prop.street_address,
                        prop.suburb,
                        prop.state,
                        prop.postcode,
                    ]
                    if part
                ),
                "property_type": prop.property_type.value,
                "owner_legal_name": prop.owner_legal_name,
                "trust_name": prop.trust_name,
            }
            for prop in properties[:200]
        ],
        "tenants": [
            {
                "id": str(tenant.id),
                "legal_name": tenant.legal_name,
                "trading_name": tenant.trading_name,
                "abn": tenant.abn,
                "billing_email": tenant.billing_email,
            }
            for tenant in tenants[:200]
        ],
        "leases": [
            {
                "id": str(lease.id),
                "status": lease.status.value,
                "tenant_id": str(lease.tenant_id),
                "tenancy_unit_id": str(lease.tenancy_unit_id),
                "property_id": str(units_by_id[lease.tenancy_unit_id].property_id)
                if lease.tenancy_unit_id in units_by_id
                else None,
                "commencement_date": (
                    lease.commencement_date.isoformat()
                    if lease.commencement_date
                    else None
                ),
                "expiry_date": (
                    lease.expiry_date.isoformat() if lease.expiry_date else None
                ),
                "next_review_date": (
                    lease.next_review_date.isoformat()
                    if lease.next_review_date
                    else None
                ),
                "annual_rent_cents": lease.annual_rent_cents,
                "is_active": lease.status in ACTIVE_LEASE_STATUSES,
            }
            for lease in leases[:400]
        ],
        "obligations": [
            {
                "id": str(obligation.id),
                "title": obligation.title,
                "category": obligation.category.value,
                "status": obligation.status.value,
                "due_date": obligation.due_date.isoformat(),
                "property_id": str(obligation.property_id) if obligation.property_id else None,
                "lease_id": str(obligation.lease_id) if obligation.lease_id else None,
            }
            for obligation in obligations[:200]
        ],
        "maintenance_work_orders": [
            {
                "id": str(wo.id),
                "title": wo.title,
                "status": wo.status.value,
                "priority": wo.priority.value,
                "property_id": str(wo.property_id) if wo.property_id else None,
                "tenant_id": str(wo.tenant_id) if wo.tenant_id else None,
                "due_date": wo.due_date.isoformat() if wo.due_date else None,
                "contractor_name": wo.contractor_name,
                "is_open": wo.status in OPEN_MAINTENANCE_STATUSES,
            }
            for wo in work_orders[:200]
        ],
        "arrears_cases": [
            {
                "id": str(case.id),
                "status": case.status.value,
                "tenant_id": str(case.tenant_id) if case.tenant_id else None,
                "property_id": str(case.property_id) if case.property_id else None,
                "total_balance_cents": case.total_balance_cents,
                "next_reminder_on": (
                    case.next_reminder_on.isoformat()
                    if case.next_reminder_on
                    else None
                ),
            }
            for case in arrears[:100]
        ],
        "truncated": {
            "properties": len(properties) > 200,
            "tenants": len(tenants) > 200,
            "leases": len(leases) > 400,
            "obligations": len(obligations) > 200,
            "maintenance_work_orders": len(work_orders) > 200,
            "arrears_cases": len(arrears) > 100,
        },
        "__index": index,
    }


def _validate_citation(
    raw: Any,
    *,
    context_index: dict[str, set[str]],
) -> AskCitation | None:
    if not isinstance(raw, dict):
        return None
    kind = raw.get("kind")
    target = raw.get("target_id")
    label = raw.get("label")
    if not isinstance(kind, str) or not isinstance(target, str) or not isinstance(label, str):
        return None
    valid_ids = context_index.get(kind)
    if valid_ids is None or target not in valid_ids:
        return None
    try:
        target_id = UUID(target)
    except ValueError:
        return None
    href = _citation_href(kind, target_id)
    return AskCitation(
        kind=kind,  # type: ignore[arg-type]
        target_id=target_id,
        label=label.strip()[:200] or "Source record",
        href=href,
    )


def _citation_href(kind: str, target_id: UUID) -> str | None:
    if kind == "property":
        return f"/properties?property_id={target_id}"
    if kind == "tenant":
        return f"/tenants/{target_id}"
    if kind == "maintenance_work_order":
        return f"/operations/maintenance/{target_id}"
    if kind == "lease":
        return "/properties"
    if kind == "obligation":
        return "/operations"
    if kind == "arrears_case":
        return "/operations"
    return None


__all__ = ["router"]
