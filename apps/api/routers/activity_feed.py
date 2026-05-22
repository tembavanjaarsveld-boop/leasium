"""Cross-property activity feed router.

Tier 2 (f) of the 2026-05-22 UX review. The dashboard now opens with a
running stream of "what changed in the portfolio" pulled directly from
the append-only `audit_action` table. No double-write, no eventual
consistency, no separate feed model — every action operators or system
jobs perform is already audited, we just project it into a friendlier
shape for display.

Read-only by design — this endpoint never mutates anything; it only
reads the audit history the rest of the codebase already writes.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import (
    AppUser,
    ArrearsCase,
    AuditAction,
    DocumentIntake,
    InvoiceDraft,
    Lease,
    MaintenanceWorkOrder,
    Obligation,
    Property,
    Tenant,
    TenantOnboarding,
    UserRole,
)

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.activity_feed import (
    ActivityActionKind,
    ActivityActorKind,
    ActivityFeedItem,
    ActivityFeedRead,
)

router = APIRouter(prefix="/activity-feed", tags=["activity-feed"])

READ_ROLES = {
    UserRole.owner,
    UserRole.admin,
    UserRole.finance,
    UserRole.ops,
    UserRole.viewer,
}

DEFAULT_LIMIT = 30
MAX_LIMIT = 100

# Coarse grouping for action verbs → UI chip kind. Anything not listed
# falls through to "other"; keep this list short rather than exhaustive
# so the chip palette stays legible.
_ACTION_KIND_MAP: dict[str, ActivityActionKind] = {
    "create": "create",
    "bootstrap": "create",
    "generate": "create",
    "upload": "create",
    "submit": "create",
    "invite": "create",
    "promote": "create",
    "create_share_link": "create",
    "update": "update",
    "restore": "update",
    "restored": "update",
    "unlink": "update",
    "unlinked": "update",
    "refresh_link": "update",
    "apply": "apply",
    "extract": "apply",
    "review": "review",
    "accept": "review",
    "preview_payment_reconciliation": "review",
    "approve": "approve",
    "deliver": "deliver",
    "resend": "deliver",
    "dispatch": "deliver",
    "reminder": "remind",
    "receipt": "remind",
    "revoke": "revoke",
    "revoked": "revoke",
    "revoke_share_link": "revoke",
    "cancel": "revoke",
    "query": "query",
    "read": "query",
    "delete": "delete",
}

_ACTION_LABEL_MAP: dict[ActivityActionKind, str] = {
    "create": "Created",
    "update": "Updated",
    "apply": "Applied",
    "review": "Reviewed",
    "approve": "Approved",
    "deliver": "Sent",
    "remind": "Reminded",
    "revoke": "Revoked",
    "query": "Asked",
    "delete": "Removed",
    "other": "Changed",
}

_TARGET_TABLE_LABEL: dict[str, str] = {
    "app_user": "Operator",
    "arrears_case": "Arrears case",
    "ask_leasium": "Ask Leasium",
    "billing_draft": "Billing draft",
    "document_intake": "Smart Intake document",
    "entity": "Entity",
    "insights_snapshot": "Insights snapshot",
    "invoice_draft": "Invoice",
    "lease": "Lease",
    "lease_intake": "Lease intake",
    "maintenance_work_order": "Work order",
    "obligation": "Obligation",
    "organisation": "Organisation",
    "property": "Property",
    "rent_charge_rule": "Charge rule",
    "stored_document": "Stored document",
    "tenancy_unit": "Tenancy unit",
    "tenant": "Tenant",
    "tenant_onboarding": "Tenant onboarding",
    "tenant_portal_account": "Tenant portal account",
    "work_assignment_digest": "Work digest",
    "xero_connection": "Xero connection",
}


def _action_kind(action: str) -> ActivityActionKind:
    return _ACTION_KIND_MAP.get(action, "other")


def _actor_kind(actor: str, user_id: UUID | None) -> ActivityActorKind:
    if user_id is not None:
        return "operator"
    lowered = actor.lower()
    if lowered.startswith("system") or lowered.startswith("job"):
        return "system"
    if lowered.startswith("tenant"):
        return "tenant"
    if lowered.startswith("external") or lowered.startswith("provider"):
        return "external"
    return "unknown"


def _target_href(table: str | None, target_id: UUID | None) -> str | None:
    if not table or target_id is None:
        return None
    if table == "property":
        return f"/properties?property_id={target_id}"
    if table == "tenant":
        return f"/tenants/{target_id}"
    if table == "maintenance_work_order":
        return f"/operations/maintenance/{target_id}"
    if table in {"invoice_draft", "billing_draft"}:
        return "/billing-readiness"
    if table == "lease":
        return "/properties"
    if table == "obligation":
        return "/operations"
    if table == "arrears_case":
        return "/operations"
    if table == "document_intake":
        return "/intake"
    if table == "tenant_onboarding":
        return "/tenants"
    if table == "xero_connection":
        return "/settings"
    return None


def _summary_from_audit(row: AuditAction, target_label: str | None) -> str:
    """Build a one-line plain-English summary for this audit row.

    Prefers `tool_output_summary` because that's what the writer of the
    audit row decided was operator-readable. Falls back to a synthesised
    "<Action verb> <target>" when no summary is recorded.
    """
    summary = (row.tool_output_summary or "").strip()
    if summary:
        return summary[:200]
    kind = _action_kind(row.action)
    action_label = _ACTION_LABEL_MAP.get(kind, "Changed")
    table_label = _TARGET_TABLE_LABEL.get(row.target_table or "", row.target_table or "record")
    if target_label:
        return f"{action_label} {table_label.lower()} {target_label}".strip()
    return f"{action_label} {table_label.lower()}".strip()


@router.get("", response_model=ActivityFeedRead)
def list_activity(
    entity_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
) -> ActivityFeedRead:
    """Return the most recent audit rows for `entity_id`, newest first."""

    assert_entity_role(user, entity_id, READ_ROLES)

    fetch_limit = limit + 1
    rows = list(
        session.scalars(
            select(AuditAction)
            .where(AuditAction.entity_id == entity_id)
            .order_by(AuditAction.occurred_at.desc())
            .limit(fetch_limit)
        ).all()
    )

    has_more = len(rows) > limit
    rows = rows[:limit]

    label_lookup = _resolve_target_labels(session, rows)
    actor_lookup = _resolve_actor_names(session, rows)

    items: list[ActivityFeedItem] = []
    for row in rows:
        target_key = (row.target_table or "", row.target_id) if row.target_id else None
        target_label = label_lookup.get(target_key) if target_key else None
        actor_display = actor_lookup.get(row.user_id) if row.user_id else None
        actor = actor_display or row.actor
        action_kind = _action_kind(row.action)
        items.append(
            ActivityFeedItem(
                id=row.id,
                occurred_at=row.occurred_at,
                actor=actor,
                actor_kind=_actor_kind(row.actor, row.user_id),
                action=row.action,
                action_kind=action_kind,
                action_label=_ACTION_LABEL_MAP.get(action_kind, "Changed"),
                summary=_summary_from_audit(row, target_label),
                target_table=row.target_table,
                target_id=row.target_id,
                target_label=target_label,
                target_href=_target_href(row.target_table, row.target_id),
                tool_name=row.tool_name,
                outcome=row.outcome.value,
                error_message=row.error_message,
            )
        )

    next_cursor = items[-1].id.hex if has_more and items else None

    return ActivityFeedRead(items=items, has_more=has_more, next_cursor=next_cursor)


def _resolve_target_labels(
    session: Session, rows: list[AuditAction]
) -> dict[tuple[str, UUID], str]:
    """Batch-fetch presentation labels for the most common record kinds.

    We resolve labels for Property / Tenant / Lease / Invoice / Work
    order / Arrears / Document intake / Tenant onboarding / Obligation
    so the feed reads like "Approved invoice INV-1023" rather than
    "Approved invoice 0193a…". Less common tables fall back to the
    target_table label only.
    """
    by_table: dict[str, set[UUID]] = {}
    for row in rows:
        if row.target_table and row.target_id is not None:
            by_table.setdefault(row.target_table, set()).add(row.target_id)

    out: dict[tuple[str, UUID], str] = {}
    table_to_model = {
        "property": (Property, lambda p: p.name),
        "tenant": (Tenant, lambda t: t.legal_name),
        "lease": (Lease, lambda lease: f"Lease {str(lease.id)[:8]}"),
        "invoice_draft": (
            InvoiceDraft,
            lambda inv: inv.invoice_number or f"Invoice {str(inv.id)[:8]}",
        ),
        "maintenance_work_order": (MaintenanceWorkOrder, lambda wo: wo.title),
        "arrears_case": (
            ArrearsCase,
            lambda case: f"Arrears {str(case.id)[:8]}",
        ),
        "document_intake": (
            DocumentIntake,
            lambda d: d.summary or d.document_type or f"Document {str(d.id)[:8]}",
        ),
        "tenant_onboarding": (
            TenantOnboarding,
            lambda o: f"Onboarding {str(o.id)[:8]}",
        ),
        "obligation": (Obligation, lambda o: o.title),
    }
    for table, ids in by_table.items():
        if table not in table_to_model or not ids:
            continue
        model, accessor = table_to_model[table]
        records = session.scalars(
            select(model).where(model.id.in_(ids))
        ).all()
        for record in records:
            try:
                label = accessor(record)
            except Exception:
                continue
            if label:
                out[(table, record.id)] = str(label)[:120]

    return out


def _resolve_actor_names(
    session: Session, rows: list[AuditAction]
) -> dict[UUID, str]:
    user_ids = {row.user_id for row in rows if row.user_id is not None}
    if not user_ids:
        return {}
    users = session.scalars(
        select(AppUser).where(AppUser.id.in_(user_ids))
    ).all()
    return {user.id: user.display_name or user.email for user in users}


__all__ = ["router"]
