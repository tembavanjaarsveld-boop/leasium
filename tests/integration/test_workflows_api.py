"""Workflow builder API tests.

Workflows are review-first automation rules. Rule CRUD stores configuration
only; it must not evaluate, send, post to providers, reconcile, or mutate source
records.
"""

from datetime import date
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from stewart.core.models import (
    AuditAction,
    Entity,
    Lease,
    LeaseStatus,
    Obligation,
    ObligationCategory,
    Property,
    PropertyType,
    RentFrequency,
    TenancyUnit,
    Tenant,
    UserEntityRole,
    UserRole,
    WorkflowProposalDecision,
    WorkflowRule,
)
from stewart.core.settings import get_settings
from tests.support.provider_guardrail import assert_no_provider_mutation_audit_rows

BASE = "/api/v1/workflows/rules"
QUEUE_BASE = "/api/v1/workflows/queue"


def _entity_id(session: Session) -> str:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return str(entity.id)


def _rule_payload(entity_id: str) -> dict[str, object]:
    return {
        "entity_id": entity_id,
        "name": "Lease expiry task",
        "description": "Create a local task before a lease expires.",
        "trigger_type": "lease_expiring",
        "trigger_config": {"days_before": 90},
        "actions": [
            {
                "type": "create_task",
                "config": {"title": "Review lease expiry", "owner_role": "ops"},
            }
        ],
        "enabled": False,
        "metadata": {"figma_node_id": "170:850"},
    }


def _seed_expiring_lease(session: Session, entity_id: str) -> Lease:
    prop = Property(
        entity_id=UUID(entity_id),
        name="Workflow Retail Centre",
        street_address="10 Workflow Street",
        property_type=PropertyType.commercial_retail,
    )
    tenant = Tenant(entity_id=UUID(entity_id), legal_name="Workflow Tenant Pty Ltd")
    session.add_all([prop, tenant])
    session.flush()
    unit = TenancyUnit(property_id=prop.id, unit_label="Shop 1")
    session.add(unit)
    session.flush()
    lease = Lease(
        tenancy_unit_id=unit.id,
        tenant_id=tenant.id,
        status=LeaseStatus.active,
        commencement_date=date(2025, 8, 1),
        expiry_date=date(2026, 8, 30),
        annual_rent_cents=1_200_000,
        rent_frequency=RentFrequency.annual,
    )
    session.add(lease)
    session.commit()
    return lease


def _count(session: Session, model: type[object]) -> int:
    return session.scalar(select(func.count()).select_from(model)) or 0


def test_workflow_rule_crud_round_trips_catalog_config(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)

    create = client.post(BASE, json=_rule_payload(entity_id))

    assert create.status_code == 201, create.text
    created = create.json()
    assert created["name"] == "Lease expiry task"
    assert created["trigger_type"] == "lease_expiring"
    assert created["trigger_config"] == {"days_before": 90}
    assert created["actions"] == [
        {
            "type": "create_task",
            "config": {"title": "Review lease expiry", "owner_role": "ops"},
        }
    ]
    assert created["enabled"] is False
    assert created["metadata"] == {"figma_node_id": "170:850"}

    rule = session.get(WorkflowRule, UUID(created["id"]))
    assert rule is not None
    assert rule.entity_id == UUID(entity_id)
    assert rule.trigger_config == {"days_before": 90}
    assert rule.workflow_metadata == {"figma_node_id": "170:850"}

    listed = client.get(BASE, params={"entity_id": entity_id})
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [created["id"]]

    patch = client.patch(
        f"{BASE}/{created['id']}",
        json={
            "name": "Lease expiry operator nudge",
            "trigger_config": {"days_before": 60},
            "actions": [{"type": "notify_operator", "config": {"message": "Lease due"}}],
            "enabled": True,
            "metadata": {"source": "approved_figma"},
        },
    )
    assert patch.status_code == 200, patch.text
    updated = patch.json()
    assert updated["name"] == "Lease expiry operator nudge"
    assert updated["trigger_config"] == {"days_before": 60}
    assert updated["actions"] == [
        {"type": "notify_operator", "config": {"message": "Lease due"}}
    ]
    assert updated["enabled"] is True
    assert updated["metadata"] == {"source": "approved_figma"}

    delete = client.delete(f"{BASE}/{created['id']}")
    assert delete.status_code == 200
    assert delete.json()["deleted_at"] is not None

    listed_after_delete = client.get(BASE, params={"entity_id": entity_id})
    assert listed_after_delete.status_code == 200
    assert listed_after_delete.json() == []

    audit_rows = session.scalars(
        select(AuditAction).where(
            AuditAction.target_table == "workflow_rule",
            AuditAction.target_id == UUID(created["id"]),
        )
    ).all()
    assert [row.action for row in audit_rows] == ["create", "update", "delete"]


def test_workflow_rule_catalog_validation_rejects_off_catalog_config(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    payload = _rule_payload(entity_id)

    unknown_trigger = client.post(BASE, json={**payload, "trigger_type": "send_email_now"})
    assert unknown_trigger.status_code == 422

    malformed_trigger = client.post(
        BASE,
        json={**payload, "trigger_config": {"days_before": 0}},
    )
    assert malformed_trigger.status_code == 422

    unknown_action = client.post(
        BASE,
        json={**payload, "actions": [{"type": "xero_post_invoice", "config": {}}]},
    )
    assert unknown_action.status_code == 422


def test_workflow_rule_writes_require_operator_role(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    created = client.post(BASE, json=_rule_payload(entity_id))
    assert created.status_code == 201

    role = session.get(UserEntityRole, (get_settings().dev_user_id, UUID(entity_id)))
    assert role is not None
    role.role = UserRole.viewer
    session.commit()

    create = client.post(BASE, json={**_rule_payload(entity_id), "name": "Viewer create"})
    assert create.status_code == 403

    patch = client.patch(f"{BASE}/{created.json()['id']}", json={"name": "Viewer patch"})
    assert patch.status_code == 403

    delete = client.delete(f"{BASE}/{created.json()['id']}")
    assert delete.status_code == 403


def test_workflow_queue_derives_lease_expiry_proposals_and_is_read_only(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    lease = _seed_expiring_lease(session, entity_id)
    rule = client.post(
        BASE,
        json={**_rule_payload(entity_id), "enabled": True},
    ).json()
    obligation_count = _count(session, Obligation)
    decision_count = _count(session, WorkflowProposalDecision)
    audit_count = _count(session, AuditAction)

    response = client.get(
        QUEUE_BASE,
        params={"entity_id": entity_id, "as_of": "2026-06-21"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["guardrail"] == (
        "Workflow proposals are review-only until an operator approves one."
    )
    assert len(body["proposals"]) == 1
    proposal = body["proposals"][0]
    assert proposal["rule_id"] == rule["id"]
    assert proposal["rule_name"] == "Lease expiry task"
    assert proposal["action_type"] == "create_task"
    assert proposal["target_table"] == "lease"
    assert proposal["target_id"] == str(lease.id)
    assert proposal["source"] == {
        "table": "lease",
        "id": str(lease.id),
        "label": "Workflow Retail Centre / Shop 1",
    }
    assert proposal["evidence"] == [
        {"label": "Expiry date", "value": "2026-08-30"},
        {"label": "Days before trigger", "value": "90"},
    ]
    assert proposal["proposed_action"]["type"] == "create_task"
    assert proposal["dedupe_key"]

    assert _count(session, Obligation) == obligation_count
    assert _count(session, WorkflowProposalDecision) == decision_count
    assert _count(session, AuditAction) == audit_count
    assert_no_provider_mutation_audit_rows(session)


def test_workflow_queue_dismiss_persists_and_suppresses_proposal(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    _seed_expiring_lease(session, entity_id)
    client.post(BASE, json={**_rule_payload(entity_id), "enabled": True})
    proposal = client.get(
        QUEUE_BASE,
        params={"entity_id": entity_id, "as_of": "2026-06-21"},
    ).json()["proposals"][0]

    dismiss = client.post(
        f"{QUEUE_BASE}/dismiss",
        json={"rule_id": proposal["rule_id"], "dedupe_key": proposal["dedupe_key"]},
    )

    assert dismiss.status_code == 200, dismiss.text
    body = dismiss.json()
    assert body["decision"] == "dismissed"
    decision = session.get(WorkflowProposalDecision, UUID(body["id"]))
    assert decision is not None
    assert decision.decision == "dismissed"

    response = client.get(
        QUEUE_BASE,
        params={"entity_id": entity_id, "as_of": "2026-06-21"},
    )
    assert response.status_code == 200
    assert response.json()["proposals"] == []


def test_workflow_queue_approve_create_task_is_idempotent_and_provider_inert(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    lease = _seed_expiring_lease(session, entity_id)
    client.post(BASE, json={**_rule_payload(entity_id), "enabled": True})
    proposal = client.get(
        QUEUE_BASE,
        params={"entity_id": entity_id, "as_of": "2026-06-21"},
    ).json()["proposals"][0]

    approve = client.post(
        f"{QUEUE_BASE}/approve",
        json={"rule_id": proposal["rule_id"], "dedupe_key": proposal["dedupe_key"]},
    )
    second_approve = client.post(
        f"{QUEUE_BASE}/approve",
        json={"rule_id": proposal["rule_id"], "dedupe_key": proposal["dedupe_key"]},
    )

    assert approve.status_code == 200, approve.text
    assert second_approve.status_code == 200, second_approve.text
    assert approve.json()["id"] == second_approve.json()["id"]
    assert approve.json()["decision"] == "approved"
    tasks = session.scalars(
        select(Obligation).where(
            Obligation.entity_id == UUID(entity_id),
            Obligation.category == ObligationCategory.lease_expiry,
            Obligation.lease_id == lease.id,
            Obligation.deleted_at.is_(None),
        )
    ).all()
    assert len(tasks) == 1
    task = tasks[0]
    assert task.title == "Review lease expiry"
    assert task.obligation_metadata["source"] == "workflow_rule"
    assert task.obligation_metadata["workflow_dedupe_key"] == proposal["dedupe_key"]

    decision = session.get(WorkflowProposalDecision, UUID(approve.json()["id"]))
    assert decision is not None
    assert decision.execution_result["created_obligation_id"] == str(task.id)
    assert_no_provider_mutation_audit_rows(session)


def test_workflow_queue_approve_comms_draft_never_sends_provider_message(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    _seed_expiring_lease(session, entity_id)
    payload = {
        **_rule_payload(entity_id),
        "enabled": True,
        "actions": [
            {
                "type": "queue_comms_draft",
                "config": {
                    "subject": "Lease expiry review",
                    "body": "Please review this lease before expiry.",
                },
            }
        ],
    }
    client.post(BASE, json=payload)
    proposal = client.get(
        QUEUE_BASE,
        params={"entity_id": entity_id, "as_of": "2026-06-21"},
    ).json()["proposals"][0]

    approve = client.post(
        f"{QUEUE_BASE}/approve",
        json={"rule_id": proposal["rule_id"], "dedupe_key": proposal["dedupe_key"]},
    )

    assert approve.status_code == 200, approve.text
    decision = session.get(WorkflowProposalDecision, UUID(approve.json()["id"]))
    assert decision is not None
    assert decision.execution_result["draft"]["status"] == "needs_review"
    assert decision.execution_result["draft"]["review_route"] == "/comms"
    dispatch_count = session.scalar(
        select(func.count()).select_from(AuditAction).where(AuditAction.action == "dispatch")
    )
    assert dispatch_count == 0
    assert_no_provider_mutation_audit_rows(session)
