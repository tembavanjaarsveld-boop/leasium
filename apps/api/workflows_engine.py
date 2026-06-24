"""Request-driven workflow proposal engine.

This mirrors the comms queue pattern: proposals are derived from existing
records on each call, and listing the queue never mutates anything, never sends
a provider message, never posts to Xero/Basiq, and never reconciles payments.
"""

from __future__ import annotations

import hashlib
from datetime import date, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.db import utcnow
from stewart.core.models import (
    Lease,
    LeaseStatus,
    Obligation,
    Property,
    TenancyUnit,
    Tenant,
    WorkflowActionType,
    WorkflowProposalDecision,
    WorkflowRule,
    WorkflowTriggerType,
)

from apps.api.schemas.workflows import (
    WorkflowProposalActionRead,
    WorkflowProposalEvidenceRead,
    WorkflowProposalRead,
    WorkflowProposalSourceRead,
)


def workflow_dedupe_key(
    *,
    rule_id: UUID,
    target_table: str,
    target_id: UUID,
    action_type: WorkflowActionType,
    period_bucket: str,
) -> str:
    raw = f"{rule_id}:{target_table}:{target_id}:{action_type.value}:{period_bucket}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def workflow_queue_proposals(
    session: Session,
    *,
    entity_id: UUID,
    as_of: date,
) -> list[WorkflowProposalRead]:
    rules = session.scalars(
        select(WorkflowRule).where(
            WorkflowRule.entity_id == entity_id,
            WorkflowRule.enabled.is_(True),
            WorkflowRule.deleted_at.is_(None),
        )
    ).all()
    decisions = {
        (decision.rule_id, decision.dedupe_key)
        for decision in session.scalars(
            select(WorkflowProposalDecision).where(
                WorkflowProposalDecision.entity_id == entity_id
            )
        ).all()
    }
    proposals: list[WorkflowProposalRead] = []
    for rule in rules:
        if rule.trigger_type == WorkflowTriggerType.lease_expiring:
            proposals.extend(_lease_expiry_proposals(session, rule=rule, as_of=as_of))
    return [
        proposal
        for proposal in proposals
        if (proposal.rule_id, proposal.dedupe_key) not in decisions
        and not _effect_already_exists(session, proposal)
    ]


def find_workflow_proposal(
    session: Session,
    *,
    entity_id: UUID,
    rule_id: UUID,
    dedupe_key: str,
    as_of: date,
) -> WorkflowProposalRead | None:
    for proposal in workflow_queue_proposals(session, entity_id=entity_id, as_of=as_of):
        if proposal.rule_id == rule_id and proposal.dedupe_key == dedupe_key:
            return proposal
    return None


def _lease_expiry_proposals(
    session: Session,
    *,
    rule: WorkflowRule,
    as_of: date,
) -> list[WorkflowProposalRead]:
    days_before = _positive_int((rule.trigger_config or {}).get("days_before"), default=90)
    cutoff = as_of + timedelta(days=days_before)
    leases = session.scalars(
        select(Lease).where(
            Lease.status.in_([LeaseStatus.active, LeaseStatus.holding_over]),
            Lease.expiry_date.is_not(None),
            Lease.expiry_date >= as_of,
            Lease.expiry_date <= cutoff,
            Lease.deleted_at.is_(None),
        )
    ).all()
    proposals: list[WorkflowProposalRead] = []
    generated_at = utcnow()
    for lease in leases:
        unit = session.get(TenancyUnit, lease.tenancy_unit_id)
        if unit is None or unit.deleted_at is not None:
            continue
        prop = session.get(Property, unit.property_id)
        if prop is None or prop.deleted_at is not None or prop.entity_id != rule.entity_id:
            continue
        tenant = session.get(Tenant, lease.tenant_id)
        source_label = f"{prop.name} / {unit.unit_label}"
        tenant_label = tenant.legal_name if tenant is not None else "tenant"
        assert lease.expiry_date is not None
        for action in rule.actions:
            action_type = WorkflowActionType(str(action.get("type")))
            config = _dict(action.get("config"))
            dedupe_key = workflow_dedupe_key(
                rule_id=rule.id,
                target_table="lease",
                target_id=lease.id,
                action_type=action_type,
                period_bucket=lease.expiry_date.isoformat(),
            )
            proposals.append(
                WorkflowProposalRead(
                    id=f"{rule.id}:{dedupe_key}",
                    entity_id=rule.entity_id,
                    rule_id=rule.id,
                    rule_name=rule.name,
                    trigger_type=rule.trigger_type,
                    action_type=action_type,
                    dedupe_key=dedupe_key,
                    target_table="lease",
                    target_id=lease.id,
                    title=_proposal_title(action_type, config, tenant_label),
                    summary=(
                        f"{tenant_label} lease at {source_label} expires on "
                        f"{lease.expiry_date.isoformat()}."
                    ),
                    source=WorkflowProposalSourceRead(
                        table="lease",
                        id=lease.id,
                        label=source_label,
                    ),
                    evidence=[
                        WorkflowProposalEvidenceRead(
                            label="Expiry date",
                            value=lease.expiry_date.isoformat(),
                        ),
                        WorkflowProposalEvidenceRead(
                            label="Days before trigger",
                            value=str(days_before),
                        ),
                    ],
                    proposed_action=WorkflowProposalActionRead(
                        type=action_type,
                        config=config,
                    ),
                    generated_at=generated_at,
                )
            )
    return proposals


def _proposal_title(
    action_type: WorkflowActionType,
    config: dict[str, Any],
    tenant_label: str,
) -> str:
    title = config.get("title")
    if isinstance(title, str) and title.strip():
        return title.strip()
    if action_type == WorkflowActionType.queue_comms_draft:
        return f"Draft lease expiry comms for {tenant_label}"
    if action_type == WorkflowActionType.notify_operator:
        return f"Notify operator about {tenant_label} lease expiry"
    return f"Review {tenant_label} lease expiry"


def _effect_already_exists(session: Session, proposal: WorkflowProposalRead) -> bool:
    if proposal.action_type != WorkflowActionType.create_task:
        return False
    obligations = session.scalars(
        select(Obligation).where(
            Obligation.entity_id == proposal.entity_id,
            Obligation.lease_id == proposal.target_id,
            Obligation.deleted_at.is_(None),
        )
    ).all()
    for obligation in obligations:
        metadata = _dict(obligation.obligation_metadata)
        if (
            metadata.get("source") == "workflow_rule"
            and metadata.get("workflow_rule_id") == str(proposal.rule_id)
            and metadata.get("workflow_dedupe_key") == proposal.dedupe_key
        ):
            return True
    return False


def _dict(value: object) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _positive_int(value: object, *, default: int) -> int:
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        return value
    return default
