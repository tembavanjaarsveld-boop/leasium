"""Reviewed Portfolio QA bulk-fix routes for operator-staged cleanup values."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.models import Property, Tenant, UserRole

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.portfolio_qa import (
    BulkFixApplyRead,
    BulkFixApplyRequest,
    BulkFixIssueClass,
    BulkFixRowResult,
)

router = APIRouter(prefix="/portfolio-qa", tags=["portfolio-qa"])

WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}

# Field allowlists mirror the portfolio-qa page payload helpers
# (tenantContactPayload / propertyBillingPayload) exactly.
ISSUE_CLASS_FIELDS: dict[BulkFixIssueClass, set[str]] = {
    "tenant_contact": {"contact_name", "contact_email", "billing_email", "abn"},
    "owner_billing": {
        "owner_legal_name",
        "owner_abn",
        "trustee_name",
        "trust_name",
        "invoice_issuer_name",
        "billing_contact_name",
        "billing_email",
        "ownership_split",
    },
}


@router.post("/bulk-fixes/apply", response_model=BulkFixApplyRead)
def apply_bulk_fixes(
    payload: BulkFixApplyRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> BulkFixApplyRead:
    allowed_fields = ISSUE_CLASS_FIELDS[payload.issue_class]
    target_table = "tenant" if payload.issue_class == "tenant_contact" else "property"
    applied: list[BulkFixRowResult] = []
    skipped: list[BulkFixRowResult] = []
    applied_target_ids: set[UUID] = set()

    for change in payload.changes:
        target = _get_target_for_user(payload.issue_class, change.target_id, user, session)
        applied_fields: list[str] = []
        for field, raw_value in change.fields.items():
            if field not in allowed_fields:
                skipped.append(
                    BulkFixRowResult(
                        target_id=change.target_id,
                        field=field,
                        after=raw_value,
                        reason="Field is not supported for portfolio QA bulk fixes.",
                    )
                )
                continue
            if raw_value is not None and not isinstance(raw_value, str):
                skipped.append(
                    BulkFixRowResult(
                        target_id=change.target_id,
                        field=field,
                        after=raw_value,
                        reason="Value must be text.",
                    )
                )
                continue
            value = (raw_value.strip() or None) if isinstance(raw_value, str) else None
            before = getattr(target, field)
            if (before or None) == value:
                skipped.append(
                    BulkFixRowResult(
                        target_id=change.target_id,
                        field=field,
                        before=before,
                        after=value,
                        reason="Value is unchanged.",
                    )
                )
                continue
            setattr(target, field, value)
            applied.append(
                BulkFixRowResult(
                    target_id=change.target_id,
                    field=field,
                    before=before,
                    after=value,
                )
            )
            applied_fields.append(field)

        if applied_fields:
            applied_target_ids.add(change.target_id)
            audit_log(
                session,
                actor=user.actor,
                user_id=user.id,
                entity_id=target.entity_id,
                action="apply",
                target_table=target_table,
                target_id=change.target_id,
                tool_name="portfolio_qa_bulk_fix",
                tool_input={"issue_class": payload.issue_class, "fields": applied_fields},
                tool_output_summary=(
                    f"Applied {len(applied_fields)} reviewed bulk fix field(s)."
                ),
            )

    summary = (
        f"Applied {len(applied)} field fix(es) across {len(applied_target_ids)} record(s);"
        f" skipped {len(skipped)}."
    )
    if applied:
        audit_log(
            session,
            actor=user.actor,
            user_id=user.id,
            action="apply",
            tool_name="portfolio_qa_bulk_fix",
            tool_input={
                "issue_class": payload.issue_class,
                "targets": len(payload.changes),
                "applied_fields": len(applied),
                "skipped_fields": len(skipped),
            },
            tool_output_summary=summary,
        )
        session.commit()

    return BulkFixApplyRead(applied=applied, skipped=skipped, summary=summary)


def _get_target_for_user(
    issue_class: BulkFixIssueClass,
    target_id: UUID,
    user: CurrentUser,
    session: Session,
) -> Property | Tenant:
    if issue_class == "owner_billing":
        prop = session.get(Property, target_id)
        if prop is None or prop.deleted_at is not None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found.")
        assert_entity_role(session, user, prop.entity_id, WRITE_ROLES)
        return prop

    tenant = session.get(Tenant, target_id)
    if tenant is None or tenant.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found.")
    assert_entity_role(session, user, tenant.entity_id, WRITE_ROLES)
    return tenant
