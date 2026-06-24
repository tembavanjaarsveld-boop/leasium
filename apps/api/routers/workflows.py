"""Review-first workflow rule routes."""

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    Entity,
    Lease,
    Obligation,
    ObligationCategory,
    ObligationStatus,
    TenancyUnit,
    UserRole,
    WorkflowActionType,
    WorkflowProposalDecision,
    WorkflowProposalDecisionStatus,
    WorkflowRule,
)

from apps.api.deps import (
    CurrentUser,
    assert_entity_role,
    get_current_user,
    get_session,
    readable_entity_ids,
)
from apps.api.schemas.workflows import (
    WorkflowActionConfig,
    WorkflowProposalDecisionCreate,
    WorkflowProposalDecisionRead,
    WorkflowProposalRead,
    WorkflowQueueRead,
    WorkflowRuleCreate,
    WorkflowRuleRead,
    WorkflowRuleUpdate,
    validate_workflow_catalog,
    workflow_catalog_http_error,
)
from apps.api.workflows_engine import find_workflow_proposal, workflow_queue_proposals

router = APIRouter(prefix="/workflows", tags=["workflows"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}
PROVIDER_INERT_SUMMARY = (
    "No provider mutation; workflow action stayed local and did not send email/SMS, "
    "call Xero/Basiq, create payments, reconcile, or mutate provider history."
)
QUEUE_GUARDRAIL = "Workflow proposals are review-only until an operator approves one."


def _not_found(name: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{name} not found.")


def _entity_for_access(
    entity_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> Entity:
    assert_entity_role(session, user, entity_id, roles)
    entity = session.get(Entity, entity_id)
    if entity is None or entity.deleted_at is not None:
        raise _not_found("Entity")
    return entity


def _rule_for_user(
    rule_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> WorkflowRule:
    rule = session.get(WorkflowRule, rule_id)
    if rule is None or rule.deleted_at is not None:
        raise _not_found("Workflow rule")
    assert_entity_role(session, user, rule.entity_id, roles)
    return rule


def _actions_for_storage(actions: list[WorkflowActionConfig]) -> list[dict[str, object]]:
    return [action.model_dump(mode="json") for action in actions]


def _actions_for_validation(actions: list[dict[str, object]]) -> list[WorkflowActionConfig]:
    return [WorkflowActionConfig.model_validate(action) for action in actions]


def _ensure_no_direct_provider_action(actions: list[dict[str, object]]) -> None:
    """Defense in depth for the v1 review-first action catalog."""

    provider_like = {"sendgrid", "twilio", "xero", "basiq", "payment", "reconcile"}
    for action in actions:
        action_type = str(action.get("type", ""))
        if action_type not in {item.value for item in WorkflowActionType}:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Workflow actions must use the fixed review-first catalog.",
            )
        lowered = action_type.lower()
        if any(token in lowered for token in provider_like):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Workflow actions cannot call providers directly.",
            )


def _existing_decision(
    session: Session,
    *,
    rule_id: UUID,
    dedupe_key: str,
) -> WorkflowProposalDecision | None:
    return session.scalar(
        select(WorkflowProposalDecision).where(
            WorkflowProposalDecision.rule_id == rule_id,
            WorkflowProposalDecision.dedupe_key == dedupe_key,
        )
    )


def _decision_from_proposal(
    *,
    payload: WorkflowProposalDecisionCreate,
    proposal,
    user: CurrentUser,
    decision: WorkflowProposalDecisionStatus,
    execution_result: dict[str, object] | None = None,
) -> WorkflowProposalDecision:
    return WorkflowProposalDecision(
        entity_id=proposal.entity_id,
        rule_id=payload.rule_id,
        dedupe_key=payload.dedupe_key,
        target_table=proposal.target_table,
        target_id=proposal.target_id,
        action_type=proposal.action_type,
        decision=decision,
        decided_by_user_id=user.id,
        decided_at=utcnow(),
        execution_result=execution_result,
    )


def _proposal_for_decision(
    *,
    payload: WorkflowProposalDecisionCreate,
    user: CurrentUser,
    session: Session,
    as_of: date,
) -> tuple[WorkflowRule, WorkflowProposalRead]:
    rule = _rule_for_user(payload.rule_id, user, session, WRITE_ROLES)
    proposal = find_workflow_proposal(
        session,
        entity_id=rule.entity_id,
        rule_id=payload.rule_id,
        dedupe_key=payload.dedupe_key,
        as_of=as_of,
    )
    if proposal is None:
        raise _not_found("Workflow proposal")
    return rule, proposal


def _approve_create_task(
    *,
    proposal: WorkflowProposalRead,
    rule: WorkflowRule,
    session: Session,
) -> dict[str, object]:
    lease = session.get(Lease, proposal.target_id)
    if lease is None or lease.deleted_at is not None:
        raise _not_found("Lease")
    unit = session.get(TenancyUnit, lease.tenancy_unit_id)
    due_date = lease.expiry_date or date.today()
    task = Obligation(
        entity_id=proposal.entity_id,
        property_id=unit.property_id if unit is not None else None,
        tenancy_unit_id=lease.tenancy_unit_id,
        lease_id=lease.id,
        title=proposal.proposed_action.config.get("title") or proposal.title,
        category=ObligationCategory.lease_expiry,
        status=ObligationStatus.upcoming,
        due_date=due_date,
        priority=2,
        notes=proposal.summary,
        obligation_metadata={
            "source": "workflow_rule",
            "workflow_rule_id": str(rule.id),
            "workflow_dedupe_key": proposal.dedupe_key,
            "workflow_action_type": WorkflowActionType.create_task.value,
            "target_table": proposal.target_table,
            "target_id": str(proposal.target_id),
        },
    )
    session.add(task)
    session.flush()
    return {"created_obligation_id": str(task.id)}


def _approve_notify_operator(*, proposal: WorkflowProposalRead) -> dict[str, object]:
    message = proposal.proposed_action.config.get("message") or proposal.summary
    return {
        "notification": {
            "status": "recorded",
            "channel": "in_app",
            "message": str(message),
        }
    }


def _approve_comms_draft(*, proposal: WorkflowProposalRead) -> dict[str, object]:
    subject = proposal.proposed_action.config.get("subject") or proposal.title
    body = proposal.proposed_action.config.get("body") or proposal.summary
    return {
        "draft": {
            "status": "needs_review",
            "review_route": "/comms",
            "subject": str(subject),
            "body": str(body),
            "source": "workflow_rule",
        }
    }


@router.get("/queue", response_model=WorkflowQueueRead)
def get_workflow_queue(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: UUID,
    as_of: date | None = None,
) -> WorkflowQueueRead:
    _entity_for_access(entity_id, user, session, READ_ROLES)
    return WorkflowQueueRead(
        entity_id=entity_id,
        proposals=workflow_queue_proposals(
            session,
            entity_id=entity_id,
            as_of=as_of or date.today(),
        ),
        guardrail=QUEUE_GUARDRAIL,
        generated_at=utcnow(),
    )


@router.post("/queue/dismiss", response_model=WorkflowProposalDecisionRead)
def dismiss_workflow_proposal(
    payload: WorkflowProposalDecisionCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    as_of: date | None = None,
) -> WorkflowProposalDecision:
    existing = _existing_decision(
        session,
        rule_id=payload.rule_id,
        dedupe_key=payload.dedupe_key,
    )
    if existing is not None:
        assert_entity_role(session, user, existing.entity_id, WRITE_ROLES)
        return existing
    _, proposal = _proposal_for_decision(
        payload=payload,
        user=user,
        session=session,
        as_of=as_of or date.today(),
    )
    decision = _decision_from_proposal(
        payload=payload,
        proposal=proposal,
        user=user,
        decision=WorkflowProposalDecisionStatus.dismissed,
    )
    session.add(decision)
    session.flush()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=decision.entity_id,
        action="dismiss",
        target_table="workflow_proposal_decision",
        target_id=decision.id,
        tool_name="workflow_proposal.dismiss",
        tool_input={"rule_id": str(payload.rule_id), "dedupe_key": payload.dedupe_key},
        tool_output_summary=PROVIDER_INERT_SUMMARY,
    )
    session.commit()
    session.refresh(decision)
    return decision


@router.post("/queue/approve", response_model=WorkflowProposalDecisionRead)
def approve_workflow_proposal(
    payload: WorkflowProposalDecisionCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    as_of: date | None = None,
) -> WorkflowProposalDecision:
    existing = _existing_decision(
        session,
        rule_id=payload.rule_id,
        dedupe_key=payload.dedupe_key,
    )
    if existing is not None:
        assert_entity_role(session, user, existing.entity_id, WRITE_ROLES)
        return existing
    rule, proposal = _proposal_for_decision(
        payload=payload,
        user=user,
        session=session,
        as_of=as_of or date.today(),
    )
    if proposal.action_type == WorkflowActionType.create_task:
        execution_result = _approve_create_task(proposal=proposal, rule=rule, session=session)
    elif proposal.action_type == WorkflowActionType.notify_operator:
        execution_result = _approve_notify_operator(proposal=proposal)
    elif proposal.action_type == WorkflowActionType.queue_comms_draft:
        execution_result = _approve_comms_draft(proposal=proposal)
    else:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Unsupported workflow action.",
        )
    decision = _decision_from_proposal(
        payload=payload,
        proposal=proposal,
        user=user,
        decision=WorkflowProposalDecisionStatus.approved,
        execution_result=execution_result,
    )
    session.add(decision)
    session.flush()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=decision.entity_id,
        action="approve",
        target_table="workflow_proposal_decision",
        target_id=decision.id,
        tool_name="workflow_proposal.approve",
        tool_input={
            "rule_id": str(payload.rule_id),
            "dedupe_key": payload.dedupe_key,
            "action_type": proposal.action_type.value,
        },
        tool_output_summary=PROVIDER_INERT_SUMMARY,
    )
    session.commit()
    session.refresh(decision)
    return decision


@router.get("/rules", response_model=list[WorkflowRuleRead])
def list_workflow_rules(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: UUID | None = None,
    include_deleted: bool = False,
) -> list[WorkflowRule]:
    statement = select(WorkflowRule)
    if entity_id is not None:
        _entity_for_access(entity_id, user, session, READ_ROLES)
        statement = statement.where(WorkflowRule.entity_id == entity_id)
    else:
        statement = statement.where(
            WorkflowRule.entity_id.in_(readable_entity_ids(session, user, READ_ROLES))
        )
    if not include_deleted:
        statement = statement.where(WorkflowRule.deleted_at.is_(None))
    return list(session.scalars(statement.order_by(WorkflowRule.created_at, WorkflowRule.id)))


@router.post(
    "/rules",
    response_model=WorkflowRuleRead,
    status_code=status.HTTP_201_CREATED,
)
def create_workflow_rule(
    payload: WorkflowRuleCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> WorkflowRule:
    _entity_for_access(payload.entity_id, user, session, WRITE_ROLES)
    actions = _actions_for_storage(payload.actions)
    _ensure_no_direct_provider_action(actions)
    data = payload.model_dump(exclude={"actions", "metadata"})
    rule = WorkflowRule(
        **data,
        actions=actions,
        workflow_metadata=payload.metadata,
    )
    session.add(rule)
    session.flush()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=rule.entity_id,
        action="create",
        target_table="workflow_rule",
        target_id=rule.id,
        tool_name="workflow_rule.create",
        tool_output_summary=PROVIDER_INERT_SUMMARY,
    )
    session.commit()
    session.refresh(rule)
    return rule


@router.get("/rules/{rule_id}", response_model=WorkflowRuleRead)
def get_workflow_rule(
    rule_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> WorkflowRule:
    return _rule_for_user(rule_id, user, session, READ_ROLES)


@router.patch("/rules/{rule_id}", response_model=WorkflowRuleRead)
def update_workflow_rule(
    rule_id: UUID,
    payload: WorkflowRuleUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> WorkflowRule:
    rule = _rule_for_user(rule_id, user, session, WRITE_ROLES)
    data = payload.model_dump(mode="json", exclude_unset=True)
    next_trigger_type = data.get("trigger_type", rule.trigger_type)
    next_trigger_config = data.get("trigger_config", rule.trigger_config)
    next_actions = data.get("actions", rule.actions)
    try:
        validate_workflow_catalog(
            trigger_type=next_trigger_type,
            trigger_config=next_trigger_config,
            actions=_actions_for_validation(next_actions),
        )
    except ValueError as exc:
        raise workflow_catalog_http_error(exc) from exc
    _ensure_no_direct_provider_action(next_actions)

    if "metadata" in data:
        data["workflow_metadata"] = data.pop("metadata")
    for key, value in data.items():
        setattr(rule, key, value)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=rule.entity_id,
        action="update",
        target_table="workflow_rule",
        target_id=rule.id,
        tool_name="workflow_rule.update",
        tool_output_summary=PROVIDER_INERT_SUMMARY,
    )
    session.commit()
    session.refresh(rule)
    return rule


@router.delete("/rules/{rule_id}", response_model=WorkflowRuleRead)
def delete_workflow_rule(
    rule_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> WorkflowRule:
    rule = _rule_for_user(rule_id, user, session, WRITE_ROLES)
    rule.deleted_at = utcnow()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=rule.entity_id,
        action="delete",
        target_table="workflow_rule",
        target_id=rule.id,
        tool_name="workflow_rule.delete",
        tool_output_summary=PROVIDER_INERT_SUMMARY,
    )
    session.commit()
    session.refresh(rule)
    return rule
