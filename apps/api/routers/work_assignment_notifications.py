"""Provider receipt webhooks for assignment notifications."""

import secrets
from datetime import date, datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    AppUser,
    ArrearsCase,
    ArrearsCaseStatus,
    Entity,
    MaintenanceWorkOrder,
    MaintenanceWorkOrderStatus,
    Obligation,
    ObligationStatus,
    UserEntityRole,
    UserRole,
)
from stewart.core.settings import get_settings

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.work_assignments import (
    WorkAssignmentDigestItemRead,
    WorkAssignmentDigestRead,
    WorkAssignmentDigestRun,
    WorkAssignmentDigestRunRead,
    WorkAssignmentNoticeGroup,
    WorkAssignmentNotificationCenterDigestRead,
    WorkAssignmentNotificationCenterItemRead,
    WorkAssignmentNotificationCenterRead,
    WorkAssignmentNotificationCenterReadState,
)
from apps.api.work_assignments import (
    apply_work_assignment_delivery_receipt,
    assignment_notification_message_matches,
    work_assignment_record,
)

router = APIRouter(prefix="/work-assignments", tags=["work-assignments"])

ASSIGNMENT_TARGET_TYPES = {
    "maintenance": "maintenance_work_order",
    "maintenance_work_order": "maintenance_work_order",
    "work_order": "maintenance_work_order",
    "arrears": "arrears_case",
    "arrears_case": "arrears_case",
    "critical date": "obligation",
    "critical_date": "obligation",
    "obligation": "obligation",
}

WorkAssignmentTarget = MaintenanceWorkOrder | ArrearsCase | Obligation

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
DIGEST_GUARDRAILS = [
    "Digest generation is review-only; it does not send email, SMS, or push notifications.",
    "Only active operators whose Work digest cadence matches this run are included.",
    (
        "Generated items come from currently assigned open maintenance, arrears, "
        "and critical-date work."
    ),
]
NOTIFICATION_CENTER_GUARDRAILS = [
    "Notification center is read-only; sending still requires explicit operator action.",
    "Digest receipts are preview receipts unless message_sent is true.",
]
NOTIFICATION_CENTER_READ_KEY = "work_assignment_notification_center_read_at"


def _assert_webhook_secret(request: Request) -> None:
    secret = get_settings().communications_webhook_secret
    if not secret:
        return
    provided = request.headers.get("x-leasium-webhook-secret") or request.query_params.get("token")
    if not provided or not secrets.compare_digest(provided, secret):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid webhook token.",
        )


def _target_type_from_event(event: dict[str, object]) -> str | None:
    raw = (
        event.get("work_assignment_target_type")
        or event.get("target_type")
        or event.get("work_kind")
    )
    if not isinstance(raw, str):
        return None
    return ASSIGNMENT_TARGET_TYPES.get(raw.strip().lower())


def _target_metadata(target: WorkAssignmentTarget) -> dict[str, Any] | None:
    if isinstance(target, MaintenanceWorkOrder):
        return target.work_order_metadata
    if isinstance(target, ArrearsCase):
        return target.arrears_metadata
    return target.obligation_metadata


def _set_target_metadata(target: WorkAssignmentTarget, metadata: dict[str, Any]) -> None:
    if isinstance(target, MaintenanceWorkOrder):
        target.work_order_metadata = metadata
    elif isinstance(target, ArrearsCase):
        target.arrears_metadata = metadata
    else:
        target.obligation_metadata = metadata


def _target_table(target: WorkAssignmentTarget) -> str:
    if isinstance(target, MaintenanceWorkOrder):
        return "maintenance_work_order"
    if isinstance(target, ArrearsCase):
        return "arrears_case"
    return "obligation"


def _metadata_record(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _metadata_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _metadata_date(value: Any) -> date | None:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    text = _metadata_text(value)
    if text is None:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _metadata_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    text = _metadata_text(value)
    if text is None:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _metadata_uuid(value: Any) -> UUID | None:
    text = _metadata_text(value)
    if text is None:
        return None
    try:
        return UUID(text)
    except ValueError:
        return None


def _digest_preference(member: AppUser) -> str:
    preferences = _metadata_record(member.notification_preferences)
    cadence = preferences.get("work_assignment_digest_cadence")
    return cadence if cadence in {"off", "daily", "weekly"} else "daily"


def _metadata_list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def _notice_group(
    notification_status: str | None,
    assigned_email: str | None,
) -> WorkAssignmentNoticeGroup | None:
    if notification_status == "ready" and assigned_email:
        return "ready"
    if notification_status in {"failed", "skipped"}:
        return "attention"
    if notification_status in {"queued", "sent"}:
        return "in_flight"
    if notification_status in {"delivered", "opened"}:
        return "done"
    return None


def _follow_up_due(assignment: dict[str, Any], today: date) -> bool:
    reminder = _metadata_record(assignment.get("reminder"))
    escalation = _metadata_record(assignment.get("escalation"))
    reminder_status = _metadata_text(reminder.get("status"))
    escalation_status = _metadata_text(escalation.get("status"))
    reminder_due = _metadata_date(reminder.get("due_on"))
    escalation_due = _metadata_date(escalation.get("due_on"))
    if reminder_status == "due":
        return True
    if reminder_due and reminder_due <= today and reminder_status not in {"logged", "skipped"}:
        return True
    return bool(
        escalation_due
        and escalation_due <= today
        and escalation_status not in {"queued", "skipped", "resolved"}
    )


def _target_title(target: WorkAssignmentTarget) -> str:
    if isinstance(target, MaintenanceWorkOrder):
        return target.title
    if isinstance(target, ArrearsCase):
        return _metadata_text((target.arrears_metadata or {}).get("tenant_name")) or "Arrears case"
    return target.title


def _target_description(target: WorkAssignmentTarget) -> str | None:
    if isinstance(target, MaintenanceWorkOrder):
        return target.description
    if isinstance(target, ArrearsCase):
        return target.source_reference or target.notes
    return target.notes


def _target_due_date(target: WorkAssignmentTarget) -> date | None:
    if isinstance(target, MaintenanceWorkOrder):
        return target.due_date
    if isinstance(target, ArrearsCase):
        return target.next_reminder_on
    return target.due_date


def _target_status(target: WorkAssignmentTarget) -> str:
    return str(target.status.value if hasattr(target.status, "value") else target.status)


def _target_priority(target: WorkAssignmentTarget) -> str | None:
    if isinstance(target, MaintenanceWorkOrder):
        return target.priority.value
    if isinstance(target, ArrearsCase):
        return "arrears"
    return str(target.priority)


def _target_url(target: WorkAssignmentTarget) -> str:
    if isinstance(target, MaintenanceWorkOrder):
        return f"/operations/maintenance/{target.id}"
    return "/operations"


def _digest_item(
    target: WorkAssignmentTarget,
    settings_base: str | None,
    today: date,
) -> WorkAssignmentDigestItemRead | None:
    assignment = work_assignment_record(_target_metadata(target))
    assigned_user_id = _metadata_uuid(assignment.get("assigned_user_id"))
    if assigned_user_id is None:
        return None
    notification = _metadata_record(assignment.get("notification"))
    reminder = _metadata_record(assignment.get("reminder"))
    escalation = _metadata_record(assignment.get("escalation"))
    status_value = _metadata_text(notification.get("status"))
    assigned_email = _metadata_text(assignment.get("assigned_user_email"))
    group = _notice_group(status_value, assigned_email)
    path = _target_url(target)
    return WorkAssignmentDigestItemRead(
        target_id=target.id,
        target_type=_target_table(target),  # type: ignore[arg-type]
        title=_target_title(target),
        description=_target_description(target),
        due_date=_target_due_date(target),
        status=_target_status(target),
        priority=_target_priority(target),
        notification_status=status_value,
        notification_group=group,
        notification_detail=_metadata_text(notification.get("detail"))
        or _metadata_text(notification.get("error")),
        reminder_due_on=_metadata_date(reminder.get("due_on")),
        escalation_due_on=_metadata_date(escalation.get("due_on")),
        follow_up_due=_follow_up_due(assignment, today),
        work_url=f"{settings_base}{path}" if settings_base else path,
    )


def _latest_assignment_event_at(assignment: dict[str, Any]) -> datetime | None:
    for entry in _metadata_list(assignment.get("history")):
        record = _metadata_record(entry)
        event_at = _metadata_datetime(record.get("at"))
        if event_at is not None:
            return event_at
    notification = _metadata_record(assignment.get("notification"))
    return (
        _metadata_datetime(notification.get("receipt_at"))
        or _metadata_datetime(notification.get("attempted_at"))
        or _metadata_datetime(notification.get("sent_at"))
        or _metadata_datetime(assignment.get("assigned_at"))
    )


def _notification_center_item(
    target: WorkAssignmentTarget,
    settings_base: str | None,
    today: date,
) -> WorkAssignmentNotificationCenterItemRead | None:
    assignment = work_assignment_record(_target_metadata(target))
    assigned_user_id = _metadata_uuid(assignment.get("assigned_user_id"))
    assigned_name = _metadata_text(assignment.get("assigned_user_name"))
    if assigned_user_id is None and assigned_name is None:
        return None
    notification = _metadata_record(assignment.get("notification"))
    status_value = _metadata_text(notification.get("status"))
    assigned_email = _metadata_text(assignment.get("assigned_user_email"))
    group = _notice_group(status_value, assigned_email)
    if group is None or status_value is None:
        return None
    latest_history = _metadata_record(
        _metadata_list(assignment.get("history"))[0]
        if _metadata_list(assignment.get("history"))
        else {}
    )
    path = _target_url(target)
    return WorkAssignmentNotificationCenterItemRead(
        target_id=target.id,
        target_type=_target_table(target),  # type: ignore[arg-type]
        title=_target_title(target),
        summary=_metadata_text(latest_history.get("summary"))
        or _metadata_text(notification.get("detail"))
        or _metadata_text(notification.get("error")),
        assignee_user_id=assigned_user_id,
        assignee_name=assigned_name,
        assignee_email=assigned_email,
        group=group,
        notification_status=status_value,
        notification_detail=_metadata_text(notification.get("detail"))
        or _metadata_text(notification.get("error")),
        channel=_metadata_text(notification.get("channel")),
        provider=_metadata_text(notification.get("provider")),
        due_date=_target_due_date(target),
        event_at=_latest_assignment_event_at(assignment),
        follow_up_due=_follow_up_due(assignment, today),
        work_url=f"{settings_base}{path}" if settings_base else path,
    )


def _assigned_user_id(metadata: dict[str, Any] | None) -> UUID | None:
    return _metadata_uuid(work_assignment_record(metadata).get("assigned_user_id"))


def _open_assignment_targets(session: Session, entity_id: UUID) -> list[WorkAssignmentTarget]:
    targets: list[WorkAssignmentTarget] = []
    targets.extend(
        session.scalars(
            select(MaintenanceWorkOrder).where(
                MaintenanceWorkOrder.entity_id == entity_id,
                MaintenanceWorkOrder.deleted_at.is_(None),
                MaintenanceWorkOrder.status.not_in(
                    [MaintenanceWorkOrderStatus.completed, MaintenanceWorkOrderStatus.cancelled]
                ),
            )
        ).all()
    )
    targets.extend(
        session.scalars(
            select(ArrearsCase).where(
                ArrearsCase.entity_id == entity_id,
                ArrearsCase.deleted_at.is_(None),
                ArrearsCase.status.not_in(
                    [
                        ArrearsCaseStatus.resolved,
                        ArrearsCaseStatus.written_off,
                        ArrearsCaseStatus.closed,
                    ]
                ),
            )
        ).all()
    )
    targets.extend(
        session.scalars(
            select(Obligation).where(
                Obligation.entity_id == entity_id,
                Obligation.deleted_at.is_(None),
                Obligation.completed_at.is_(None),
                Obligation.status.not_in([ObligationStatus.completed, ObligationStatus.waived]),
            )
        ).all()
    )
    return [target for target in targets if _assigned_user_id(_target_metadata(target)) is not None]


def _group_count(
    items: list[WorkAssignmentDigestItemRead],
    group: WorkAssignmentNoticeGroup,
) -> int:
    return sum(1 for item in items if item.notification_group == group)


def _record_digest_receipt(
    member: AppUser,
    *,
    digest: WorkAssignmentDigestRead,
    entity_id: UUID,
    generated_at: datetime,
) -> None:
    preferences = _metadata_record(member.notification_preferences)
    raw_history = preferences.get("work_assignment_digest_history")
    history = list(raw_history) if isinstance(raw_history, list) else []
    receipt = {
        "event": "digest_generated",
        "generated_at": generated_at.isoformat(),
        "entity_id": str(entity_id),
        "cadence": digest.cadence,
        "item_count": digest.item_count,
        "ready_count": digest.ready_count,
        "attention_count": digest.attention_count,
        "in_flight_count": digest.in_flight_count,
        "done_count": digest.done_count,
        "follow_up_due_count": digest.follow_up_due_count,
        "delivery_status": "previewed",
        "message_sent": False,
    }
    preferences["work_assignment_digest_last_generated_at"] = receipt["generated_at"]
    preferences["work_assignment_digest_last_item_count"] = digest.item_count
    preferences["work_assignment_digest_history"] = [receipt, *history][:10]
    member.notification_preferences = preferences


def _notification_center_digest_receipts(
    members: list[AppUser],
    entity_id: UUID,
) -> list[WorkAssignmentNotificationCenterDigestRead]:
    receipts: list[WorkAssignmentNotificationCenterDigestRead] = []
    for member in members:
        preferences = _metadata_record(member.notification_preferences)
        for receipt in _metadata_list(preferences.get("work_assignment_digest_history")):
            record = _metadata_record(receipt)
            if _metadata_uuid(record.get("entity_id")) != entity_id:
                continue
            generated_at = _metadata_datetime(record.get("generated_at"))
            cadence = _metadata_text(record.get("cadence"))
            if generated_at is None or cadence not in {"daily", "weekly"}:
                continue
            item_count = record.get("item_count")
            follow_up_due_count = record.get("follow_up_due_count")
            message_sent = record.get("message_sent")
            receipts.append(
                WorkAssignmentNotificationCenterDigestRead(
                    assignee_user_id=member.id,
                    assignee_name=member.display_name,
                    assignee_email=member.email,
                    generated_at=generated_at,
                    cadence=cadence,  # type: ignore[arg-type]
                    item_count=item_count
                    if isinstance(item_count, int) and not isinstance(item_count, bool)
                    else 0,
                    follow_up_due_count=follow_up_due_count
                    if isinstance(follow_up_due_count, int)
                    and not isinstance(follow_up_due_count, bool)
                    else 0,
                    delivery_status=_metadata_text(record.get("delivery_status"))
                    or "previewed",
                    message_sent=message_sent if isinstance(message_sent, bool) else False,
                )
            )
    receipts.sort(key=lambda receipt: receipt.generated_at, reverse=True)
    return receipts[:20]


def _entity_assignment_members(
    session: Session,
    *,
    organisation_id: UUID,
    entity_id: UUID,
) -> list[AppUser]:
    return session.scalars(
        select(AppUser)
        .join(UserEntityRole, UserEntityRole.user_id == AppUser.id)
        .where(
            AppUser.organisation_id == organisation_id,
            AppUser.is_active.is_(True),
            UserEntityRole.entity_id == entity_id,
        )
    ).all()


def _notification_center_read_at(member: AppUser | None, entity_id: UUID) -> datetime | None:
    if member is None:
        return None
    preferences = _metadata_record(member.notification_preferences)
    read_map = _metadata_record(preferences.get(NOTIFICATION_CENTER_READ_KEY))
    return _metadata_datetime(read_map.get(str(entity_id)))


def _notification_center_unread_count(
    notices: list[WorkAssignmentNotificationCenterItemRead],
    digest_receipts: list[WorkAssignmentNotificationCenterDigestRead],
    last_read_at: datetime | None,
) -> int:
    if last_read_at is None:
        return len(notices) + len(digest_receipts)
    return sum(
        1
        for item in notices
        if item.event_at is not None and item.event_at > last_read_at
    ) + sum(1 for receipt in digest_receipts if receipt.generated_at > last_read_at)


def _latest_notification_center_activity_at(
    notices: list[WorkAssignmentNotificationCenterItemRead],
    digest_receipts: list[WorkAssignmentNotificationCenterDigestRead],
) -> datetime | None:
    activity = [
        timestamp
        for timestamp in [
            *(item.event_at for item in notices),
            *(receipt.generated_at for receipt in digest_receipts),
        ]
        if timestamp is not None
    ]
    return max(activity) if activity else None


@router.get("/notification-center", response_model=WorkAssignmentNotificationCenterRead)
def get_work_assignment_notification_center(
    entity_id: Annotated[UUID, Query()],
    session: Annotated[Session, Depends(get_session)],
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> WorkAssignmentNotificationCenterRead:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    settings = get_settings()
    frontend_base = settings.frontend_url.strip().rstrip("/") or None
    today = utcnow().date()
    notices = [
        item
        for target in _open_assignment_targets(session, entity_id)
        if (item := _notification_center_item(target, frontend_base, today)) is not None
    ]
    group_rank = {"attention": 0, "ready": 1, "in_flight": 2, "done": 3}
    notices.sort(
        key=lambda item: (
            group_rank[item.group],
            0 if item.follow_up_due else 1,
            -(item.event_at.timestamp() if item.event_at is not None else 0),
            item.due_date or date.max,
            item.title,
        )
    )
    members = _entity_assignment_members(
        session,
        organisation_id=user.organisation_id,
        entity_id=entity_id,
    )
    digest_receipts = _notification_center_digest_receipts(members, entity_id)
    current_member = session.get(AppUser, user.id)
    last_read_at = _notification_center_read_at(current_member, entity_id)
    return WorkAssignmentNotificationCenterRead(
        entity_id=entity_id,
        generated_at=utcnow(),
        last_read_at=last_read_at,
        unread_count=_notification_center_unread_count(
            notices,
            digest_receipts,
            last_read_at,
        ),
        notice_count=len(notices),
        attention_count=sum(1 for item in notices if item.group == "attention"),
        ready_count=sum(1 for item in notices if item.group == "ready"),
        in_flight_count=sum(1 for item in notices if item.group == "in_flight"),
        done_count=sum(1 for item in notices if item.group == "done"),
        digest_receipt_count=len(digest_receipts),
        guardrails=NOTIFICATION_CENTER_GUARDRAILS,
        notices=notices[:50],
        digest_receipts=digest_receipts,
    )


@router.post(
    "/notification-center/mark-read",
    response_model=WorkAssignmentNotificationCenterReadState,
)
def mark_work_assignment_notification_center_read(
    entity_id: Annotated[UUID, Query()],
    session: Annotated[Session, Depends(get_session)],
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> WorkAssignmentNotificationCenterReadState:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    member = session.get(AppUser, user.id)
    if member is None or member.organisation_id != user.organisation_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operator not found.")
    settings = get_settings()
    frontend_base = settings.frontend_url.strip().rstrip("/") or None
    today = utcnow().date()
    notices = [
        item
        for target in _open_assignment_targets(session, entity_id)
        if (item := _notification_center_item(target, frontend_base, today)) is not None
    ]
    members = _entity_assignment_members(
        session,
        organisation_id=user.organisation_id,
        entity_id=entity_id,
    )
    digest_receipts = _notification_center_digest_receipts(members, entity_id)
    now = utcnow()
    latest_activity_at = _latest_notification_center_activity_at(notices, digest_receipts)
    read_at = max(now, latest_activity_at) if latest_activity_at is not None else now
    preferences = _metadata_record(member.notification_preferences)
    read_map = _metadata_record(preferences.get(NOTIFICATION_CENTER_READ_KEY))
    read_map[str(entity_id)] = read_at.isoformat()
    preferences[NOTIFICATION_CENTER_READ_KEY] = read_map
    member.notification_preferences = preferences
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity_id,
        action="update",
        target_table="app_user",
        target_id=member.id,
        tool_name="work_assignment.notification_center_mark_read",
        tool_input={"entity_id": str(entity_id)},
        tool_output_summary="Marked Work notification center reviewed for this entity.",
        data_classification="internal",
    )
    session.commit()
    return WorkAssignmentNotificationCenterReadState(
        entity_id=entity_id,
        read_at=read_at,
        unread_count=0,
    )


def _generate_work_assignment_digest(
    payload: WorkAssignmentDigestRun,
    *,
    session: Session,
    organisation_id: UUID,
    actor: str,
    user_id: UUID | None,
    tool_name: str,
) -> WorkAssignmentDigestRunRead:
    members = _entity_assignment_members(
        session,
        organisation_id=organisation_id,
        entity_id=payload.entity_id,
    )
    members_by_id = {
        member.id: member
        for member in members
        if _digest_preference(member) == payload.cadence
    }
    settings = get_settings()
    frontend_base = settings.frontend_url.strip().rstrip("/") or None
    today = utcnow().date()
    items_by_user: dict[UUID, list[WorkAssignmentDigestItemRead]] = {
        member_id: [] for member_id in members_by_id
    }
    for target in _open_assignment_targets(session, payload.entity_id):
        assignee_id = _assigned_user_id(_target_metadata(target))
        if assignee_id is None or assignee_id not in members_by_id:
            continue
        item = _digest_item(target, frontend_base, today)
        if item is not None:
            items_by_user[assignee_id].append(item)

    group_rank = {"attention": 0, "ready": 1, "in_flight": 2, "done": 3, None: 4}
    digests: list[WorkAssignmentDigestRead] = []
    for member_id, items in items_by_user.items():
        if not items:
            continue
        items.sort(
            key=lambda item: (
                0 if item.follow_up_due else 1,
                group_rank[item.notification_group],
                item.due_date or date.max,
                item.title,
            )
        )
        member = members_by_id[member_id]
        digests.append(
            WorkAssignmentDigestRead(
                assignee_user_id=member.id,
                assignee_name=member.display_name,
                assignee_email=member.email,
                cadence=payload.cadence,
                item_count=len(items),
                ready_count=_group_count(items, "ready"),
                attention_count=_group_count(items, "attention"),
                in_flight_count=_group_count(items, "in_flight"),
                done_count=_group_count(items, "done"),
                follow_up_due_count=sum(1 for item in items if item.follow_up_due),
                items=items[:20],
            )
        )
    digests.sort(
        key=lambda digest: (
            -digest.follow_up_due_count,
            -digest.item_count,
            digest.assignee_name,
        )
    )
    generated_at = utcnow()
    for digest in digests:
        _record_digest_receipt(
            members_by_id[digest.assignee_user_id],
            digest=digest,
            entity_id=payload.entity_id,
            generated_at=generated_at,
        )
    work_item_count = sum(digest.item_count for digest in digests)
    audit_log(
        session,
        actor=actor,
        user_id=user_id,
        entity_id=payload.entity_id,
        action="generate",
        target_table="work_assignment_digest",
        tool_name=tool_name,
        tool_input=payload.model_dump(mode="json"),
        tool_output_summary=(
            f"Generated {payload.cadence} Work assignment digest preview for "
            f"{len(digests)} operators and {work_item_count} items; no messages sent."
        ),
        data_classification="confidential",
    )
    session.commit()
    return WorkAssignmentDigestRunRead(
        entity_id=payload.entity_id,
        cadence=payload.cadence,
        generated_at=generated_at,
        operator_count=len(digests),
        work_item_count=work_item_count,
        guardrails=DIGEST_GUARDRAILS,
        digests=digests,
    )


@router.post("/digests/run", response_model=WorkAssignmentDigestRunRead)
def run_work_assignment_digest(
    payload: WorkAssignmentDigestRun,
    session: Annotated[Session, Depends(get_session)],
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> WorkAssignmentDigestRunRead:
    assert_entity_role(session, user, payload.entity_id, READ_ROLES)
    return _generate_work_assignment_digest(
        payload,
        session=session,
        organisation_id=user.organisation_id,
        actor=user.actor,
        user_id=user.id,
        tool_name="work_assignment.digest_generate",
    )


@router.post("/digests/run-scheduled", response_model=WorkAssignmentDigestRunRead)
def run_scheduled_work_assignment_digest(
    payload: WorkAssignmentDigestRun,
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> WorkAssignmentDigestRunRead:
    _assert_webhook_secret(request)
    entity = session.get(Entity, payload.entity_id)
    if entity is None or entity.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")
    return _generate_work_assignment_digest(
        payload,
        session=session,
        organisation_id=entity.organisation_id,
        actor="cron:work_assignment_digest",
        user_id=None,
        tool_name="work_assignment.digest_generate_scheduled",
    )


def _get_target_by_id(
    session: Session,
    target_id: UUID,
    target_type: str | None,
) -> WorkAssignmentTarget | None:
    if target_type == "maintenance_work_order":
        return session.get(MaintenanceWorkOrder, target_id)
    if target_type == "arrears_case":
        return session.get(ArrearsCase, target_id)
    if target_type == "obligation":
        return session.get(Obligation, target_id)
    return (
        session.get(MaintenanceWorkOrder, target_id)
        or session.get(ArrearsCase, target_id)
        or session.get(Obligation, target_id)
    )


def _find_target_by_message_id(
    session: Session,
    provider_message_id: str,
) -> WorkAssignmentTarget | None:
    target_sets = (
        session.scalars(
            select(MaintenanceWorkOrder).where(MaintenanceWorkOrder.deleted_at.is_(None))
        ).all(),
        session.scalars(select(ArrearsCase).where(ArrearsCase.deleted_at.is_(None))).all(),
        session.scalars(select(Obligation).where(Obligation.deleted_at.is_(None))).all(),
    )
    for targets in target_sets:
        for target in targets:
            if assignment_notification_message_matches(
                _target_metadata(target),
                provider_message_id,
            ):
                return target
    return None


def _target_from_event(
    session: Session,
    event: dict[str, object],
    provider_message_id: str | None,
) -> WorkAssignmentTarget | None:
    target = None
    target_id = event.get("work_assignment_target_id") or event.get("target_id")
    if isinstance(target_id, str):
        try:
            target = _get_target_by_id(
                session,
                UUID(target_id),
                _target_type_from_event(event),
            )
        except ValueError:
            target = None
    if target is None and provider_message_id:
        target = _find_target_by_message_id(session, provider_message_id)
    if target is None or target.deleted_at is not None:
        return None
    return target


@router.post("/webhooks/sendgrid-events", status_code=status.HTTP_204_NO_CONTENT)
async def record_work_assignment_sendgrid_delivery_events(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> Response:
    _assert_webhook_secret(request)
    payload = await request.json()
    events = payload if isinstance(payload, list) else [payload]
    for event in events:
        if not isinstance(event, dict):
            continue
        raw_status = str(event.get("event") or "")
        if not raw_status:
            continue
        message_id = event.get("sg_message_id") or event.get("sg-message-id")
        provider_message_id = str(message_id) if message_id else None
        target = _target_from_event(session, event, provider_message_id)
        if target is None:
            continue
        metadata = apply_work_assignment_delivery_receipt(
            _target_metadata(target),
            raw_status=raw_status,
            provider_message_id=provider_message_id,
            event=event,
        )
        if metadata is None:
            continue
        _set_target_metadata(target, metadata)
        audit_log(
            session,
            actor="provider:sendgrid",
            entity_id=target.entity_id,
            action="receipt",
            target_table=_target_table(target),
            target_id=target.id,
            tool_name="sendgrid.work_assignment_event_webhook",
            tool_input={"channel": "email", "status": raw_status},
            tool_output_summary="Recorded SendGrid assignment notification receipt.",
            data_classification="confidential",
        )
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
