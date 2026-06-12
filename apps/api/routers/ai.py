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
from stewart.ai.ask import ASK_GUARDRAILS, AskError, ask_leasium
from stewart.ai.inbox import (
    INBOX_KINDS,
    INBOX_TRIAGE_GUARDRAILS,
    InboxTriageError,
    triage_inbox,
)
from stewart.ai.lease_change import LeaseChangeError, extract_lease_change
from stewart.ai.tenant_contact import (
    TENANT_CONTACT_GUARDRAILS,
    TenantContactError,
    extract_tenant_contact,
)
from stewart.ai.vendor_intake import VendorIntakeError, extract_vendor_intake
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    ArrearsCase,
    ArrearsCaseStatus,
    Contractor,
    DocumentCategory,
    DocumentIntake,
    DocumentIntakeStatus,
    InboundMessage,
    Lease,
    LeaseStatus,
    MaintenanceWorkOrder,
    MaintenanceWorkOrderStatus,
    Obligation,
    Property,
    StoredDocument,
    TenancyUnit,
    Tenant,
    UserRole,
)
from stewart.core.settings import Settings, get_settings

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.ai import (
    AskCitation,
    AskRead,
    AskRequest,
    InboxKeyFact,
    InboxKind,
    InboxPromoteRead,
    InboxPromoteRequest,
    InboxTargetKind,
    InboxTenantContactFieldProposal,
    InboxTenantContactPreviewRead,
    InboxTenantContactPreviewRequest,
    InboxTriageMatch,
    InboxTriageRead,
    InboxTriageRequest,
)

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
    assert_entity_role(session, user, payload.entity_id, READ_ROLES)
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


_TARGET_KIND_HREF: dict[str, str] = {
    "maintenance_work_order": "/operations",
    "arrears_case": "/operations",
    "tenant": "/tenants",
    "lease": "/properties",
    "property": "/properties",
    "smart_intake": "/intake",
    "none": "",
}


@router.post("/triage", response_model=InboxTriageRead)
def triage(
    payload: InboxTriageRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> InboxTriageRead:
    """Classify a pasted inbox message and suggest a next Leasium action."""

    assert_entity_role(session, user, payload.entity_id, READ_ROLES)

    entity_index, index_lookup = _build_triage_entity_index(payload.entity_id, session)

    try:
        result, response_id = triage_inbox(
            body=payload.body,
            settings=settings,
            entity_index=entity_index,
        )
    except InboxTriageError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    raw_kind = result.get("kind")
    kind: InboxKind = (
        raw_kind if isinstance(raw_kind, str) and raw_kind in INBOX_KINDS else "general"
    )
    raw_confidence = result.get("confidence")
    try:
        confidence = float(raw_confidence)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))
    summary = result.get("summary")
    summary_text = summary.strip()[:400] if isinstance(summary, str) else ""
    action = result.get("suggested_action")
    action_text = action.strip()[:240] if isinstance(action, str) else ""
    raw_target = result.get("suggested_target_kind")
    target_kind: InboxTargetKind = (
        raw_target  # type: ignore[assignment]
        if isinstance(raw_target, str) and raw_target in _TARGET_KIND_HREF
        else "none"
    )
    href = _TARGET_KIND_HREF.get(target_kind) or None

    suggested_property = _validate_index_match(
        result.get("suggested_property_id"),
        index_lookup.get("properties", {}),
    )
    suggested_tenant = _validate_index_match(
        result.get("suggested_tenant_id"),
        index_lookup.get("tenants", {}),
    )
    suggested_lease = _validate_index_match(
        result.get("suggested_lease_id"),
        index_lookup.get("leases", {}),
    )
    suggested_contractor = _validate_index_match(
        result.get("suggested_contractor_id"),
        index_lookup.get("contractors", {}),
    )

    raw_facts = result.get("key_facts")
    key_facts: list[InboxKeyFact] = []
    if isinstance(raw_facts, list):
        for entry in raw_facts:
            if not isinstance(entry, dict):
                continue
            label = entry.get("label")
            value = entry.get("value")
            if not isinstance(label, str) or not isinstance(value, str):
                continue
            label = label.strip()[:80]
            value = value.strip()[:140]
            if not label or not value:
                continue
            key_facts.append(InboxKeyFact(label=label, value=value))

    raw_warnings = result.get("warnings")
    warnings: list[str] = []
    if isinstance(raw_warnings, list):
        for warning in raw_warnings:
            if isinstance(warning, str) and warning.strip():
                warnings.append(warning.strip()[:240])

    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=payload.entity_id,
        action="query",
        target_table="ai_inbox_triage",
        target_id=None,
        tool_name="ai_inbox_triage",
        tool_input={
            "body_length": len(payload.body),
            "kind": kind,
            "confidence": round(confidence, 2),
            "target_kind": target_kind,
            "warning_count": len(warnings),
            "matched_property": suggested_property is not None,
            "matched_tenant": suggested_tenant is not None,
            "matched_lease": suggested_lease is not None,
            "matched_contractor": suggested_contractor is not None,
        },
        tool_output_summary=(
            f"Classified as {kind} (confidence {confidence:.2f})."
        ),
        data_classification="internal",
    )
    session.commit()

    return InboxTriageRead(
        kind=kind,
        confidence=confidence,
        summary=summary_text or "Unable to summarise this message.",
        suggested_action=action_text or "Review the message manually.",
        suggested_target_kind=target_kind,
        suggested_target_href=href,
        suggested_property=suggested_property,
        suggested_tenant=suggested_tenant,
        suggested_lease=suggested_lease,
        suggested_contractor=suggested_contractor,
        key_facts=key_facts,
        warnings=warnings,
        guardrails=list(INBOX_TRIAGE_GUARDRAILS),
        response_id=response_id,
    )


# ---------------------------------------------------------------------------
# Triage promote — v2 of the AI inbox processor.
#
# v1 stopped at "classify + deep-link". v2 takes the reviewed classification
# and the operator-confirmed match and creates the right Leasium draft. No
# provider mutation: the draft sits in its initial review state until the
# operator approves the next step from inside the target surface.
# ---------------------------------------------------------------------------


def _build_triage_entity_index(
    entity_id: UUID,
    session: Session,
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, dict[str, str]]]:
    """Build a compact entity index for the AI to match the message against.

    Returns a (prompt_index, lookup) pair. `prompt_index` is the JSON
    structure sent to OpenAI; `lookup` is the server-side validator that
    confirms any returned UUID was actually in the index (prevents the
    model from inventing record ids).
    """
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

    leases = list(
        session.scalars(
            select(Lease).where(
                Lease.tenancy_unit_id.in_(units_by_id.keys()),
                Lease.deleted_at.is_(None),
                Lease.status.in_(ACTIVE_LEASE_STATUSES),
            )
        ).all()
    ) if units_by_id else []

    contractors = list(
        session.scalars(
            select(Contractor).where(
                Contractor.entity_id == entity_id,
                Contractor.deleted_at.is_(None),
            )
        ).all()
    )

    prompt_index = {
        "properties": [
            {
                "id": str(prop.id),
                "name": prop.name,
                "address": ", ".join(
                    part
                    for part in [prop.street_address, prop.suburb, prop.state]
                    if part
                ),
            }
            for prop in properties[:120]
        ],
        "tenants": [
            {
                "id": str(tenant.id),
                "name": tenant.trading_name or tenant.legal_name,
            }
            for tenant in tenants[:120]
        ],
        "leases": [
            {
                "id": str(lease.id),
                "tenant_id": str(lease.tenant_id),
                "property_id": (
                    str(units_by_id[lease.tenancy_unit_id].property_id)
                    if lease.tenancy_unit_id in units_by_id
                    else None
                ),
            }
            for lease in leases[:200]
        ],
        "contractors": [
            {
                "id": str(contractor.id),
                "name": contractor.name,
                "company_name": contractor.company_name,
                "categories": list(contractor.categories or []),
            }
            for contractor in contractors[:200]
        ],
    }

    def _property_label(prop: Property) -> str:
        if prop.street_address:
            return f"{prop.name} — {prop.street_address}".strip(" —")
        return prop.name

    def _contractor_label(contractor: Contractor) -> str:
        if contractor.company_name:
            return f"{contractor.name} ({contractor.company_name})"
        return contractor.name

    lookup: dict[str, dict[str, str]] = {
        "properties": {
            str(prop.id): _property_label(prop) for prop in properties
        },
        "tenants": {
            str(tenant.id): tenant.trading_name or tenant.legal_name
            for tenant in tenants
        },
        "leases": {
            str(lease.id): (
                f"Lease {str(lease.id)[:8]} ({lease.status.value})"
            )
            for lease in leases
        },
        "contractors": {
            str(contractor.id): _contractor_label(contractor)
            for contractor in contractors
        },
    }
    return prompt_index, lookup


def _validate_index_match(
    raw: Any,
    label_lookup: dict[str, str],
) -> InboxTriageMatch | None:
    if not isinstance(raw, str) or not raw.strip():
        return None
    candidate = raw.strip()
    label = label_lookup.get(candidate)
    if label is None:
        return None
    try:
        target_id = UUID(candidate)
    except ValueError:
        return None
    return InboxTriageMatch(id=target_id, label=label)


PROMOTE_WRITE_ROLES = {
    UserRole.owner,
    UserRole.admin,
    UserRole.ops,
}

TENANT_CONTACT_FIELD_LABELS = {
    "contact_name": "Contact name",
    "contact_email": "Contact email",
    "contact_phone": "Phone",
    "billing_email": "Billing email",
}


def _property_in_entity(
    property_id: UUID,
    entity_id: UUID,
    session: Session,
) -> Property:
    prop = session.scalar(
        select(Property).where(
            Property.id == property_id,
            Property.entity_id == entity_id,
            Property.deleted_at.is_(None),
        )
    )
    if prop is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Property not found in this entity.",
        )
    return prop


def _tenant_in_entity(
    tenant_id: UUID,
    entity_id: UUID,
    session: Session,
) -> Tenant:
    tenant = session.scalar(
        select(Tenant).where(
            Tenant.id == tenant_id,
            Tenant.entity_id == entity_id,
            Tenant.deleted_at.is_(None),
        )
    )
    if tenant is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found in this entity.",
        )
    return tenant


def _lease_in_entity(
    lease_id: UUID,
    entity_id: UUID,
    session: Session,
) -> Lease:
    lease = session.scalar(
        select(Lease)
        .join(TenancyUnit, TenancyUnit.id == Lease.tenancy_unit_id)
        .join(Property, Property.id == TenancyUnit.property_id)
        .where(
            Lease.id == lease_id,
            Property.entity_id == entity_id,
            Lease.deleted_at.is_(None),
        )
    )
    if lease is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lease not found in this entity.",
        )
    return lease


def _contractor_in_entity(
    contractor_id: UUID,
    entity_id: UUID,
    session: Session,
) -> Contractor:
    contractor = session.scalar(
        select(Contractor).where(
            Contractor.id == contractor_id,
            Contractor.entity_id == entity_id,
            Contractor.deleted_at.is_(None),
        )
    )
    if contractor is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contractor not found in this entity.",
        )
    return contractor


def _lease_snapshot(
    lease_id: UUID | None,
    session: Session,
) -> dict[str, Any] | None:
    """Compact snapshot of a lease for the lease-change extractor prompt.

    Sent to OpenAI so the model can phrase the proposed change as a delta
    from what's already on file rather than reproducing absolute figures.
    """
    if lease_id is None:
        return None
    lease = session.scalar(
        select(Lease).where(Lease.id == lease_id, Lease.deleted_at.is_(None))
    )
    if lease is None:
        return None
    return {
        "id": str(lease.id),
        "status": lease.status.value,
        "commencement_date": (
            lease.commencement_date.isoformat()
            if lease.commencement_date
            else None
        ),
        "expiry_date": (
            lease.expiry_date.isoformat() if lease.expiry_date else None
        ),
        "annual_rent_cents": lease.annual_rent_cents,
        "next_review_date": (
            lease.next_review_date.isoformat()
            if lease.next_review_date
            else None
        ),
    }


def _tenant_snapshot(tenant: Tenant) -> dict[str, Any]:
    """Compact tenant view for tenant-contact extraction prompts."""

    return {
        "id": str(tenant.id),
        "legal_name": tenant.legal_name,
        "trading_name": tenant.trading_name,
        "contact_name": tenant.contact_name,
        "contact_email": tenant.contact_email,
        "contact_phone": tenant.contact_phone,
        "billing_email": tenant.billing_email,
    }


def _tenant_contact_label(tenant: Tenant) -> str:
    return tenant.trading_name or tenant.legal_name


def _clean_contact_value(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned[:240] if cleaned else None


def _tenant_contact_proposals(
    *,
    tenant: Tenant,
    extracted: dict[str, Any],
) -> list[InboxTenantContactFieldProposal]:
    proposals: list[InboxTenantContactFieldProposal] = []
    for field, label in TENANT_CONTACT_FIELD_LABELS.items():
        proposed = _clean_contact_value(extracted.get(field))
        if proposed is None:
            continue
        current = getattr(tenant, field)
        current_clean = current.strip() if isinstance(current, str) else None
        if current_clean == proposed:
            continue
        proposals.append(
            InboxTenantContactFieldProposal(
                field=field,  # type: ignore[arg-type]
                label=label,
                current_value=current_clean,
                proposed_value=proposed,
                selected_by_default=True,
            )
        )
    return proposals


def _tenant_contact_warnings(extracted: dict[str, Any]) -> list[str]:
    warnings: list[str] = []
    raw_warnings = extracted.get("warnings")
    if isinstance(raw_warnings, list):
        for warning in raw_warnings:
            if isinstance(warning, str) and warning.strip():
                warnings.append(warning.strip()[:240])
    return warnings


@router.post(
    "/triage/tenant-contact-preview",
    response_model=InboxTenantContactPreviewRead,
)
def preview_tenant_contact_update(
    payload: InboxTenantContactPreviewRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> InboxTenantContactPreviewRead:
    """Extract proposed tenant contact updates for operator review.

    This endpoint is read-only. The follow-up promote call applies only
    the fields the operator has explicitly approved.
    """

    assert_entity_role(session, user, payload.entity_id, PROMOTE_WRITE_ROLES)
    tenant = _tenant_in_entity(payload.tenant_id, payload.entity_id, session)

    try:
        extracted, response_id = extract_tenant_contact(
            body=payload.body,
            settings=settings,
            tenant_snapshot=_tenant_snapshot(tenant),
        )
    except TenantContactError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    raw_confidence = extracted.get("confidence")
    try:
        confidence = (
            max(0.0, min(1.0, float(raw_confidence)))
            if raw_confidence is not None
            else None
        )
    except (TypeError, ValueError):
        confidence = None

    raw_summary = extracted.get("summary")
    summary = (
        raw_summary.strip()[:400]
        if isinstance(raw_summary, str) and raw_summary.strip()
        else "Review tenant contact updates."
    )
    proposed_updates = _tenant_contact_proposals(
        tenant=tenant,
        extracted=extracted,
    )
    warnings = _tenant_contact_warnings(extracted)
    if not proposed_updates:
        warnings.append(
            "No changed tenant contact fields were clearly extracted."
        )

    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=payload.entity_id,
        action="query",
        target_table="tenant",
        target_id=tenant.id,
        tool_name="ai_inbox_contact_preview",
        tool_input={
            "body_length": len(payload.body),
            "proposed_field_count": len(proposed_updates),
            "warning_count": len(warnings),
        },
        tool_output_summary=(
            f"Prepared {len(proposed_updates)} tenant contact update(s)."
        ),
        data_classification="internal",
    )
    session.commit()

    return InboxTenantContactPreviewRead(
        tenant=InboxTriageMatch(id=tenant.id, label=_tenant_contact_label(tenant)),
        summary=summary,
        confidence=confidence,
        proposed_updates=proposed_updates,
        warnings=warnings,
        guardrails=list(TENANT_CONTACT_GUARDRAILS),
        response_id=response_id,
    )


def _truncate_title(text: str, *, limit: int = 120) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def _mailbox_promote_context(
    payload: InboxPromoteRequest,
    session: Session,
    promoted_at,
) -> tuple[InboundMessage | None, dict[str, Any] | None]:
    if payload.inbound_message_id is None:
        return None, None

    message = session.scalar(
        select(InboundMessage)
        .where(InboundMessage.id == payload.inbound_message_id)
        .with_for_update()
    )
    if message is None or message.entity_id != payload.entity_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inbound message not found.",
        )
    if message.source != "ai_mailbox":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only AI mailbox messages can be linked to inbox promote.",
        )
    if message.trust_state != "trusted":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only trusted AI mailbox messages can be promoted.",
        )
    if message.processed_at is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="AI mailbox message has already been promoted.",
        )
    if message.classification_kind != payload.kind:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Mailbox stored classification must match the promote kind.",
        )

    message.processed_at = promoted_at
    metadata = (
        message.inbound_metadata if isinstance(message.inbound_metadata, dict) else {}
    )
    raw_email_document_id = metadata.get("raw_email_document_id")
    confidence = message.classification_confidence
    return message, {
        "inbound_message_id": str(message.id),
        "raw_email_document_id": str(raw_email_document_id)
        if raw_email_document_id
        else None,
        "sender": message.original_sender or message.from_address,
        "from_address": message.from_address,
        "original_sender": message.original_sender,
        "subject": message.subject,
        "classification_kind": message.classification_kind,
        "classification_confidence": float(confidence)
        if confidence is not None
        else None,
        "classification_summary": message.classification_summary,
        "classification_target_kind": message.classification_target_kind,
        "attachment_document_ids": _mailbox_metadata_uuid_strings(
            metadata.get("attachment_document_ids")
        ),
        "attachment_intake_ids": _mailbox_metadata_uuid_strings(
            metadata.get("attachment_intake_ids")
        ),
    }


def _mailbox_metadata_uuid_strings(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    ids: list[str] = []
    for item in value:
        try:
            ids.append(str(UUID(str(item))))
        except (TypeError, ValueError):
            continue
    return ids


def _mailbox_attachment_intakes(
    message: InboundMessage,
    payload: InboxPromoteRequest,
    session: Session,
) -> list[DocumentIntake]:
    metadata = (
        message.inbound_metadata if isinstance(message.inbound_metadata, dict) else {}
    )
    raw_intake_ids = metadata.get("attachment_intake_ids")
    if not isinstance(raw_intake_ids, list) or not raw_intake_ids:
        return []

    intake_ids: list[UUID] = []
    for raw_id in raw_intake_ids:
        try:
            intake_ids.append(UUID(str(raw_id)))
        except (TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="AI mailbox attachment intake metadata is invalid.",
            ) from exc

    intakes: list[DocumentIntake] = []
    for intake_id in intake_ids:
        intake = session.scalar(
            select(DocumentIntake)
            .where(
                DocumentIntake.id == intake_id,
                DocumentIntake.entity_id == payload.entity_id,
                DocumentIntake.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if intake is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="AI mailbox attachment intake was not found.",
            )
        document = intake.document
        if document is None or document.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="AI mailbox attachment intake has no active document.",
            )
        if document.entity_id != payload.entity_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="AI mailbox attachment intake is outside this entity.",
            )
        if (
            str((document.document_metadata or {}).get("inbound_message_id"))
            != str(message.id)
            and str((intake.review_data or {}).get("inbound_message_id"))
            != str(message.id)
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="AI mailbox attachment intake is not linked to this message.",
            )
        if intake.status == DocumentIntakeStatus.applied:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="AI mailbox attachment intake has already been applied.",
            )
        for field in ("property_id", "tenant_id", "lease_id"):
            requested = getattr(payload, field)
            current = getattr(document, field)
            if requested is not None and current is not None and current != requested:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="AI mailbox attachment intake is scoped to another record.",
                )
        intakes.append(intake)
    return intakes


def _stamp_mailbox_promote_on_intake(
    *,
    intake: DocumentIntake,
    payload: InboxPromoteRequest,
    summary: str,
    mailbox_metadata: dict[str, Any],
    promoted_at,
    user: CurrentUser,
) -> None:
    document = intake.document
    if payload.property_id is not None:
        document.property_id = payload.property_id
    if payload.tenant_id is not None:
        document.tenant_id = payload.tenant_id
    if payload.lease_id is not None:
        document.lease_id = payload.lease_id
    if not intake.summary:
        intake.summary = summary

    stamp = {
        "candidate": "compliance_or_insurance",
        "summary": summary,
        "promoted_at": promoted_at.isoformat(),
        "promoted_by_user_id": str(user.id),
        "mailbox": mailbox_metadata,
    }
    intake.review_data = {
        **(intake.review_data or {}),
        "ai_inbox_promote": stamp,
    }
    document.document_metadata = {
        **(document.document_metadata or {}),
        "ai_inbox_promote": stamp,
    }


def _require_mailbox_promote(
    *,
    kind: str,
    mailbox_metadata: dict[str, Any] | None,
) -> dict[str, Any]:
    if mailbox_metadata is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Promoting {kind.replace('_', ' ')} from inbox requires "
                "a trusted AI mailbox message."
            ),
        )
    return mailbox_metadata


def _create_mailbox_review_intake(
    *,
    payload: InboxPromoteRequest,
    summary: str,
    title: str,
    mailbox_metadata: dict[str, Any],
    candidate: str,
    filename: str,
    guardrail: str,
    session: Session,
    user: CurrentUser,
) -> InboxPromoteRead:
    body_bytes = payload.body.strip().encode("utf-8")
    document = StoredDocument(
        entity_id=payload.entity_id,
        property_id=payload.property_id,
        tenant_id=payload.tenant_id,
        lease_id=payload.lease_id,
        filename=filename,
        content_type="text/plain",
        byte_size=len(body_bytes),
        file_data=body_bytes,
        category=DocumentCategory.other,
        notes=f"Created from AI mailbox {candidate.replace('_', ' ')} promote.",
        document_metadata={
            "source": "ai_inbox_promote",
            "summary": summary,
            "candidate": candidate,
            "mailbox": mailbox_metadata,
        },
    )
    session.add(document)
    session.flush()

    intake = DocumentIntake(
        entity_id=payload.entity_id,
        document_id=document.id,
        status=DocumentIntakeStatus.uploaded,
        document_type=None,
        summary=summary,
        confidence=None,
        extracted_data={},
        review_data={
            "source": "ai_inbox_promote",
            "candidate": candidate,
            "guardrail": guardrail,
            "mailbox": mailbox_metadata,
        },
        openai_response_id=None,
    )
    session.add(intake)
    session.flush()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=payload.entity_id,
        action="create",
        target_table="document_intake",
        target_id=intake.id,
        tool_name="ai_inbox_promote",
        tool_input=_promote_audit_input(
            kind=payload.kind,
            summary=summary,
            mailbox_metadata=mailbox_metadata,
            extraction="not_run",
        ),
        tool_output_summary=(
            "Promoted AI mailbox message to local Smart Intake review without "
            "extraction or apply."
        ),
        data_classification="internal",
    )
    session.commit()
    return InboxPromoteRead(
        target_kind="document_intake",
        target_id=intake.id,
        target_href=f"/intake?entity_id={payload.entity_id}&review={intake.id}",
        target_label=title or summary,
    )


def _promote_audit_input(
    *,
    kind: str,
    summary: str,
    mailbox_metadata: dict[str, Any] | None,
    **extra: Any,
) -> dict[str, Any]:
    data = {"kind": kind, "summary_length": len(summary), **extra}
    if mailbox_metadata is not None:
        data["inbound_message_id"] = mailbox_metadata["inbound_message_id"]
    return data


@router.post("/triage/promote", response_model=InboxPromoteRead)
def promote_triage(
    payload: InboxPromoteRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> InboxPromoteRead:
    """Promote a reviewed AI classification into a Leasium draft.

    No provider mutation. The draft sits in its initial review state — the
    operator still has to approve the next step (contractor dispatch,
    tenant reminder, intake apply) from inside the target surface.
    """

    assert_entity_role(session, user, payload.entity_id, PROMOTE_WRITE_ROLES)

    # Validate scope eagerly so the response is a clean 404 instead of an
    # IntegrityError at flush time.
    if payload.property_id is not None:
        _property_in_entity(payload.property_id, payload.entity_id, session)
    if payload.tenant_id is not None:
        _tenant_in_entity(payload.tenant_id, payload.entity_id, session)
    if payload.lease_id is not None:
        _lease_in_entity(payload.lease_id, payload.entity_id, session)
    if payload.contractor_id is not None:
        _contractor_in_entity(
            payload.contractor_id, payload.entity_id, session
        )

    summary = payload.summary.strip()
    title = _truncate_title(summary)
    promoted_at = utcnow()
    mailbox_message, mailbox_metadata = _mailbox_promote_context(
        payload,
        session,
        promoted_at,
    )

    promote_metadata = {
        "ai_inbox": {
            "kind": payload.kind,
            "summary": summary,
            "promoted_at": promoted_at.isoformat(),
            "promoted_by_user_id": str(user.id),
        }
    }
    if mailbox_metadata is not None:
        promote_metadata["ai_inbox"]["mailbox"] = mailbox_metadata

    if payload.kind == "maintenance_request":
        work_order = MaintenanceWorkOrder(
            entity_id=payload.entity_id,
            property_id=payload.property_id,
            tenant_id=payload.tenant_id,
            lease_id=payload.lease_id,
            title=title or "Maintenance request from inbox",
            description=payload.body.strip(),
            status=MaintenanceWorkOrderStatus.requested,
            source_reference="ai_inbox_promote",
            work_order_metadata=promote_metadata,
        )
        session.add(work_order)
        session.flush()
        audit_log(
            session,
            actor=user.actor,
            user_id=user.id,
            entity_id=payload.entity_id,
            action="create",
            target_table="maintenance_work_order",
            target_id=work_order.id,
            tool_name="ai_inbox_promote",
            tool_input=_promote_audit_input(
                kind=payload.kind,
                summary=summary,
                mailbox_metadata=mailbox_metadata,
            ),
            tool_output_summary="Promoted inbox message to maintenance work order.",
            data_classification="internal",
        )
        session.commit()
        return InboxPromoteRead(
            target_kind="maintenance_work_order",
            target_id=work_order.id,
            target_href=f"/operations/maintenance/{work_order.id}",
            target_label=work_order.title,
        )

    if payload.kind == "task_or_reminder":
        mailbox_metadata = _require_mailbox_promote(
            kind=payload.kind,
            mailbox_metadata=mailbox_metadata,
        )
        work_order = MaintenanceWorkOrder(
            entity_id=payload.entity_id,
            property_id=payload.property_id,
            tenant_id=payload.tenant_id,
            lease_id=payload.lease_id,
            title=title or "Task/reminder from AI mailbox",
            description=payload.body.strip(),
            status=MaintenanceWorkOrderStatus.requested,
            source_reference="ai_inbox_promote",
            work_order_metadata=promote_metadata,
        )
        session.add(work_order)
        session.flush()
        audit_log(
            session,
            actor=user.actor,
            user_id=user.id,
            entity_id=payload.entity_id,
            action="create",
            target_table="maintenance_work_order",
            target_id=work_order.id,
            tool_name="ai_inbox_promote",
            tool_input=_promote_audit_input(
                kind=payload.kind,
                summary=summary,
                mailbox_metadata=mailbox_metadata,
            ),
            tool_output_summary=(
                "Promoted AI mailbox task/reminder to local Operations work order."
            ),
            data_classification="internal",
        )
        session.commit()
        return InboxPromoteRead(
            target_kind="maintenance_work_order",
            target_id=work_order.id,
            target_href=f"/operations/maintenance/{work_order.id}",
            target_label=work_order.title,
        )

    if payload.kind == "payment_or_arrears":
        if payload.tenant_id is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Promoting an arrears case requires a matched tenant.",
            )
        case = ArrearsCase(
            entity_id=payload.entity_id,
            property_id=payload.property_id,
            tenant_id=payload.tenant_id,
            lease_id=payload.lease_id,
            status=ArrearsCaseStatus.active,
            source_reference="ai_inbox_promote",
            notes=summary,
            arrears_metadata=promote_metadata,
        )
        session.add(case)
        session.flush()
        audit_log(
            session,
            actor=user.actor,
            user_id=user.id,
            entity_id=payload.entity_id,
            action="create",
            target_table="arrears_case",
            target_id=case.id,
            tool_name="ai_inbox_promote",
            tool_input=_promote_audit_input(
                kind=payload.kind,
                summary=summary,
                mailbox_metadata=mailbox_metadata,
            ),
            tool_output_summary="Promoted inbox message to arrears case.",
            data_classification="internal",
        )
        session.commit()
        return InboxPromoteRead(
            target_kind="arrears_case",
            target_id=case.id,
            target_href=f"/operations?tab=arrears&case_id={case.id}",
            target_label=title or "Arrears case from inbox",
        )

    if payload.kind == "tenant_contact":
        if payload.tenant_id is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Promoting tenant contact updates requires a matched tenant.",
            )
        tenant = _tenant_in_entity(payload.tenant_id, payload.entity_id, session)
        approved_updates: dict[str, str] = {}
        previous_values: dict[str, str | None] = {}
        for field in TENANT_CONTACT_FIELD_LABELS:
            if field not in payload.tenant_contact_updates:
                continue
            proposed = _clean_contact_value(payload.tenant_contact_updates[field])
            if proposed is None:
                continue
            current = getattr(tenant, field)
            current_clean = current.strip() if isinstance(current, str) else None
            if current_clean == proposed:
                continue
            approved_updates[field] = proposed
            previous_values[field] = current_clean

        if not approved_updates:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Choose at least one changed tenant contact field to apply.",
            )

        for field, proposed in approved_updates.items():
            setattr(tenant, field, proposed)

        metadata = dict(tenant.tenant_metadata or {})
        history_raw = metadata.get("ai_inbox_contact_promotions")
        history = history_raw if isinstance(history_raw, list) else []
        history = [
            *history[-9:],
            {
                "promoted_at": utcnow().isoformat(),
                "promoted_by_user_id": str(user.id),
                "summary": summary,
                "fields": sorted(approved_updates.keys()),
            },
        ]
        if mailbox_metadata is not None:
            history[-1]["mailbox"] = mailbox_metadata
        metadata["ai_inbox_contact_promotions"] = history
        tenant.tenant_metadata = metadata

        audit_log(
            session,
            actor=user.actor,
            user_id=user.id,
            entity_id=payload.entity_id,
            action="update",
            target_table="tenant",
            target_id=tenant.id,
            tool_name="ai_inbox_promote",
            tool_input=_promote_audit_input(
                kind=payload.kind,
                summary=summary,
                mailbox_metadata=mailbox_metadata,
                fields=sorted(approved_updates.keys()),
                previous_values_present=sorted(previous_values.keys()),
            ),
            tool_output_summary=(
                "Promoted inbox message to tenant contact update"
                f" ({len(approved_updates)} field(s))."
            ),
            data_classification="internal",
        )
        session.commit()
        session.refresh(tenant)
        return InboxPromoteRead(
            target_kind="tenant",
            target_id=tenant.id,
            target_href=f"/tenants/{tenant.id}",
            target_label=_tenant_contact_label(tenant),
        )

    if payload.kind == "lease_change":
        # DocumentIntake needs a backing StoredDocument; synthesise a
        # text/plain document from the pasted message so the existing
        # intake review flow can pick it up.
        body_bytes = payload.body.strip().encode("utf-8")
        document = StoredDocument(
            entity_id=payload.entity_id,
            property_id=payload.property_id,
            tenant_id=payload.tenant_id,
            lease_id=payload.lease_id,
            filename="inbox-lease-change.txt",
            content_type="text/plain",
            byte_size=len(body_bytes),
            file_data=body_bytes,
            category=DocumentCategory.lease,
            notes="Created from AI inbox triage promote.",
            document_metadata={
                "source": "ai_inbox_promote",
                "summary": summary,
                **({"mailbox": mailbox_metadata} if mailbox_metadata else {}),
            },
        )
        session.add(document)
        session.flush()

        # v2.1: try to pre-extract the proposed change so the intake lands
        # ready_for_review instead of empty. Soft-fail when the API key is
        # unset or the extractor errors — the intake still gets created in
        # uploaded status with the warning so the operator can fill in the
        # fields manually inside Smart Intake.
        extracted_data: dict[str, Any] = {}
        review_data: dict[str, Any] = {
            "source": "ai_inbox_promote",
            **({"mailbox": mailbox_metadata} if mailbox_metadata else {}),
        }
        intake_status = DocumentIntakeStatus.uploaded
        intake_summary = summary
        intake_confidence: float | None = None
        openai_response_id: str | None = None
        extraction_outcome = "skipped"

        lease_snapshot = _lease_snapshot(payload.lease_id, session)
        try:
            extracted, response_id = extract_lease_change(
                body=payload.body,
                settings=settings,
                lease_snapshot=lease_snapshot,
            )
        except LeaseChangeError as exc:
            review_data["extraction_error"] = str(exc)
            extraction_outcome = "soft_failed"
        else:
            extracted_data = {
                "document_type": "lease_change",
                **{k: v for k, v in extracted.items() if k != "summary"},
            }
            model_summary = extracted.get("summary")
            if isinstance(model_summary, str) and model_summary.strip():
                intake_summary = model_summary.strip()[:400]
            raw_conf = extracted.get("confidence")
            try:
                intake_confidence = float(raw_conf) if raw_conf is not None else None
            except (TypeError, ValueError):
                intake_confidence = None
            openai_response_id = response_id
            intake_status = (
                DocumentIntakeStatus.needs_attention
                if intake_confidence is not None and intake_confidence < 0.5
                else DocumentIntakeStatus.ready_for_review
            )
            extraction_outcome = "extracted"

        intake = DocumentIntake(
            entity_id=payload.entity_id,
            document_id=document.id,
            status=intake_status,
            document_type="lease_change",
            summary=intake_summary,
            confidence=intake_confidence,
            extracted_data=extracted_data,
            review_data=review_data,
            openai_response_id=openai_response_id,
        )
        session.add(intake)
        session.flush()
        audit_log(
            session,
            actor=user.actor,
            user_id=user.id,
            entity_id=payload.entity_id,
            action="create",
            target_table="document_intake",
            target_id=intake.id,
            tool_name="ai_inbox_promote",
            tool_input=_promote_audit_input(
                kind=payload.kind,
                summary=summary,
                mailbox_metadata=mailbox_metadata,
                extraction=extraction_outcome,
            ),
            tool_output_summary=(
                "Promoted inbox message to Smart Intake draft"
                f" ({extraction_outcome})."
            ),
            data_classification="internal",
        )
        session.commit()
        return InboxPromoteRead(
            target_kind="document_intake",
            target_id=intake.id,
            target_href=f"/intake?entity_id={payload.entity_id}&review={intake.id}",
            target_label=title or "Lease change from inbox",
        )

    if payload.kind == "property_update":
        mailbox_metadata = _require_mailbox_promote(
            kind=payload.kind,
            mailbox_metadata=mailbox_metadata,
        )
        return _create_mailbox_review_intake(
            payload=payload,
            summary=summary,
            title=title or "Property update from AI mailbox",
            mailbox_metadata=mailbox_metadata,
            candidate="property_update",
            filename="inbox-property-update.txt",
            guardrail=(
                "Review in Smart Intake before changing any property record, "
                "owner record, provider setup, billing, payment, or "
                "reconciliation data."
            ),
            session=session,
            user=user,
        )

    if payload.kind == "compliance_or_insurance":
        if mailbox_metadata is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    "Promoting compliance or insurance from inbox requires "
                    "a trusted AI mailbox message."
                ),
            )

        if mailbox_message is not None:
            attachment_intakes = _mailbox_attachment_intakes(
                mailbox_message, payload, session
            )
            if attachment_intakes:
                for attachment_intake in attachment_intakes:
                    _stamp_mailbox_promote_on_intake(
                        intake=attachment_intake,
                        payload=payload,
                        summary=summary,
                        mailbox_metadata=mailbox_metadata,
                        promoted_at=promoted_at,
                        user=user,
                    )
                attachment_intake = attachment_intakes[0]
                session.flush()
                audit_log(
                    session,
                    actor=user.actor,
                    user_id=user.id,
                    entity_id=payload.entity_id,
                    action="update",
                    target_table="document_intake",
                    target_id=attachment_intake.id,
                    tool_name="ai_inbox_promote",
                    tool_input=_promote_audit_input(
                        kind=payload.kind,
                        summary=summary,
                        mailbox_metadata=mailbox_metadata,
                        source="attachment_intake",
                        attachment_intake_id=str(attachment_intake.id),
                        attachment_intake_ids=[
                            str(intake.id) for intake in attachment_intakes
                        ],
                    ),
                    tool_output_summary=(
                        "Linked AI mailbox compliance/insurance message to "
                        "existing Smart Intake attachment review."
                    ),
                    data_classification="internal",
                )
                session.commit()
                return InboxPromoteRead(
                    target_kind="document_intake",
                    target_id=attachment_intake.id,
                    target_href=(
                        f"/intake?entity_id={payload.entity_id}"
                        f"&review={attachment_intake.id}"
                    ),
                    target_label=(
                        attachment_intake.summary
                        or attachment_intake.document.filename
                    ),
                )

        body_bytes = payload.body.strip().encode("utf-8")
        document = StoredDocument(
            entity_id=payload.entity_id,
            property_id=payload.property_id,
            tenant_id=payload.tenant_id,
            lease_id=payload.lease_id,
            filename="inbox-compliance-insurance.txt",
            content_type="text/plain",
            byte_size=len(body_bytes),
            file_data=body_bytes,
            category=DocumentCategory.other,
            notes="Created from AI mailbox compliance/insurance promote.",
            document_metadata={
                "source": "ai_inbox_promote",
                "summary": summary,
                "candidate": "compliance_or_insurance",
                "mailbox": mailbox_metadata,
            },
        )
        session.add(document)
        session.flush()

        intake = DocumentIntake(
            entity_id=payload.entity_id,
            document_id=document.id,
            status=DocumentIntakeStatus.uploaded,
            document_type=None,
            summary=summary,
            confidence=None,
            extracted_data={},
            review_data={
                "source": "ai_inbox_promote",
                "candidate": "compliance_or_insurance",
                "guardrail": (
                    "Review in Smart Intake before applying any compliance "
                    "or insurance obligation changes."
                ),
                "mailbox": mailbox_metadata,
            },
            openai_response_id=None,
        )
        session.add(intake)
        session.flush()
        audit_log(
            session,
            actor=user.actor,
            user_id=user.id,
            entity_id=payload.entity_id,
            action="create",
            target_table="document_intake",
            target_id=intake.id,
            tool_name="ai_inbox_promote",
            tool_input=_promote_audit_input(
                kind=payload.kind,
                summary=summary,
                mailbox_metadata=mailbox_metadata,
                extraction="not_run",
            ),
            tool_output_summary=(
                "Promoted AI mailbox compliance/insurance message to Smart "
                "Intake review without extraction or apply."
            ),
            data_classification="internal",
        )
        session.commit()
        return InboxPromoteRead(
            target_kind="document_intake",
            target_id=intake.id,
            target_href=f"/intake?entity_id={payload.entity_id}&review={intake.id}",
            target_label=title or "Compliance / insurance from inbox",
        )

    if payload.kind == "owner_or_entity_admin":
        mailbox_metadata = _require_mailbox_promote(
            kind=payload.kind,
            mailbox_metadata=mailbox_metadata,
        )
        return _create_mailbox_review_intake(
            payload=payload,
            summary=summary,
            title=title or "Owner / entity admin from AI mailbox",
            mailbox_metadata=mailbox_metadata,
            candidate="owner_or_entity_admin",
            filename="inbox-owner-admin.txt",
            guardrail=(
                "Review in Smart Intake before changing owner, entity, "
                "operator, billing, provider, payment, or reconciliation data."
            ),
            session=session,
            user=user,
        )

    if payload.kind == "vendor_or_contractor":
        # Matched contractor → no draft, just deep-link the operator into
        # the existing directory entry.
        if payload.contractor_id is not None:
            existing = _contractor_in_entity(
                payload.contractor_id, payload.entity_id, session
            )
            audit_log(
                session,
                actor=user.actor,
                user_id=user.id,
                entity_id=payload.entity_id,
                action="query",
                target_table="contractor",
                target_id=existing.id,
                tool_name="ai_inbox_promote",
                tool_input=_promote_audit_input(
                    kind=payload.kind,
                    summary=summary,
                    mailbox_metadata=mailbox_metadata,
                    match="existing",
                ),
                tool_output_summary=(
                    "Routed inbox message to existing contractor profile."
                ),
                data_classification="internal",
            )
            session.commit()
            return InboxPromoteRead(
                target_kind="contractor",
                target_id=existing.id,
                target_href="/contractors",
                target_label=existing.name,
            )

        # No match → extract draft directory fields and create a new
        # Contractor row at priority=3 (backup) for the operator to
        # review and activate from /contractors.
        extraction_outcome = "skipped"
        contractor_kwargs: dict[str, Any] = {
            "entity_id": payload.entity_id,
            "name": title or summary[:120] or "Vendor from inbox",
            "priority": 3,
            "categories": [],
            "contractor_metadata": {
                "source": "ai_inbox_promote",
                "summary": summary,
                **({"mailbox": mailbox_metadata} if mailbox_metadata else {}),
            },
        }

        try:
            extracted, response_id = extract_vendor_intake(
                body=payload.body,
                settings=settings,
            )
        except VendorIntakeError as exc:
            contractor_kwargs["contractor_metadata"][
                "extraction_error"
            ] = str(exc)
            extraction_outcome = "soft_failed"
        else:
            extraction_outcome = "extracted"
            extracted_name = extracted.get("name")
            if isinstance(extracted_name, str) and extracted_name.strip():
                contractor_kwargs["name"] = extracted_name.strip()[:200]
            for field in ("company_name", "email", "phone", "notes"):
                value = extracted.get(field)
                if isinstance(value, str) and value.strip():
                    contractor_kwargs[field] = value.strip()[:240]
            categories = extracted.get("categories")
            if isinstance(categories, list):
                contractor_kwargs["categories"] = [
                    c
                    for c in categories
                    if isinstance(c, str) and c.strip()
                ][:4]
            raw_conf = extracted.get("confidence")
            try:
                conf_value = float(raw_conf) if raw_conf is not None else None
            except (TypeError, ValueError):
                conf_value = None
            contractor_kwargs["contractor_metadata"].update(
                {
                    "ai_confidence": conf_value,
                    "openai_response_id": response_id,
                }
            )

        contractor = Contractor(**contractor_kwargs)
        session.add(contractor)
        session.flush()
        audit_log(
            session,
            actor=user.actor,
            user_id=user.id,
            entity_id=payload.entity_id,
            action="create",
            target_table="contractor",
            target_id=contractor.id,
            tool_name="ai_inbox_promote",
            tool_input=_promote_audit_input(
                kind=payload.kind,
                summary=summary,
                mailbox_metadata=mailbox_metadata,
                extraction=extraction_outcome,
                match="new",
            ),
            tool_output_summary=(
                "Promoted inbox message to new contractor directory entry"
                f" ({extraction_outcome})."
            ),
            data_classification="internal",
        )
        session.commit()
        return InboxPromoteRead(
            target_kind="contractor",
            target_id=contractor.id,
            target_href="/contractors",
            target_label=contractor.name,
        )

    # Pydantic enforces InboxPromoteKind, so this is unreachable in practice.
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=f"Cannot promote inbox kind {payload.kind!r}.",
    )


__all__ = ["router"]
