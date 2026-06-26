"""Relby AI first-class conversation thread routes."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload
from stewart.core.db import utcnow
from stewart.core.models import (
    ConversationThread,
    ConversationTurn,
    ConversationTurnKind,
    ConversationTurnRole,
    Entity,
    UserRole,
)

from apps.api.deps import (
    CurrentUser,
    assert_entity_role,
    get_current_user,
    get_session,
    readable_entity_ids,
)
from apps.api.schemas.conversation_threads import (
    ConversationThreadCreateRequest,
    ConversationThreadRead,
    ConversationThreadSummaryRead,
    ConversationTurnCreateRequest,
    ConversationTurnRead,
)

router = APIRouter(prefix="/conversation-threads", tags=["conversation-threads"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}


def _json_object(value: dict[str, Any] | None) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _fallback_title(payload: ConversationThreadCreateRequest) -> str:
    if payload.title and payload.title.strip():
        return payload.title.strip()
    text = ""
    if payload.initial_turn is not None:
        raw_text = payload.initial_turn.payload.get("text")
        if isinstance(raw_text, str):
            text = raw_text.strip()
    return text[:80] if text else "Relby AI thread"


def _require_org_wide_role(
    session: Session,
    user: CurrentUser,
    roles: set[UserRole],
) -> None:
    if readable_entity_ids(session, user, roles):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have access to any entity in this organisation.",
    )


def _readable_ids(session: Session, user: CurrentUser) -> list[UUID]:
    return readable_entity_ids(session, user, READ_ROLES)


def _thread_read_allowed(
    thread: ConversationThread,
    session: Session,
    user: CurrentUser,
) -> bool:
    if thread.deleted_at is not None or thread.organisation_id != user.organisation_id:
        return False
    if thread.entity_id is None:
        return bool(_readable_ids(session, user))
    return thread.entity_id in set(_readable_ids(session, user))


def _get_thread_for_read(
    thread_id: UUID,
    session: Session,
    user: CurrentUser,
) -> ConversationThread:
    thread = session.scalar(
        select(ConversationThread)
        .options(selectinload(ConversationThread.turns))
        .where(ConversationThread.id == thread_id)
    )
    if thread is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation thread not found.",
        )
    if not _thread_read_allowed(thread, session, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this conversation thread.",
        )
    return thread


def get_thread_for_write(
    thread_id: UUID,
    session: Session,
    user: CurrentUser,
    entity_id: UUID | None = None,
) -> ConversationThread:
    thread = _get_thread_for_read(thread_id, session, user)
    if thread.entity_id is None:
        _require_org_wide_role(session, user, WRITE_ROLES)
    else:
        assert_entity_role(session, user, thread.entity_id, WRITE_ROLES)
    if entity_id is not None and thread.entity_id not in {None, entity_id}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Conversation thread does not match this entity.",
        )
    return thread


def append_conversation_turn(
    *,
    thread: ConversationThread,
    role: ConversationTurnRole,
    kind: ConversationTurnKind,
    payload: dict[str, Any],
    session: Session,
) -> ConversationTurn:
    turn = ConversationTurn(
        thread_id=thread.id,
        role=role,
        kind=kind,
        payload=_json_object(payload),
    )
    thread.updated_at = utcnow()
    session.add(turn)
    return turn


def read_thread(thread: ConversationThread) -> ConversationThreadRead:
    return ConversationThreadRead.model_validate(
        {
            "id": thread.id,
            "organisation_id": thread.organisation_id,
            "entity_id": thread.entity_id,
            "created_by_user_id": thread.created_by_user_id,
            "source": thread.source,
            "context_route": thread.context_route,
            "context_record_refs": _json_object(thread.context_record_refs),
            "title": thread.title,
            "thread_metadata": _json_object(thread.thread_metadata),
            "created_at": thread.created_at,
            "updated_at": thread.updated_at,
            "turns": [
                ConversationTurnRead.model_validate(turn)
                for turn in sorted(thread.turns, key=lambda row: (row.created_at, row.id))
            ],
        }
    )


def _preview_from_payload(payload: dict[str, Any]) -> str | None:
    for key in ("text", "summary", "prompt"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:160]
    return None


def _thread_summary(thread: ConversationThread) -> ConversationThreadSummaryRead:
    turns = sorted(thread.turns, key=lambda row: (row.created_at, row.id))
    last_turn = turns[-1] if turns else None
    return ConversationThreadSummaryRead.model_validate(
        {
            "id": thread.id,
            "organisation_id": thread.organisation_id,
            "entity_id": thread.entity_id,
            "created_by_user_id": thread.created_by_user_id,
            "source": thread.source,
            "context_route": thread.context_route,
            "context_record_refs": _json_object(thread.context_record_refs),
            "title": thread.title,
            "turn_count": len(turns),
            "last_turn_at": last_turn.created_at if last_turn else None,
            "last_turn_preview": _preview_from_payload(last_turn.payload)
            if last_turn
            else None,
            "created_at": thread.created_at,
            "updated_at": thread.updated_at,
        }
    )


@router.post("", response_model=ConversationThreadRead, status_code=status.HTTP_201_CREATED)
def create_thread(
    payload: ConversationThreadCreateRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> ConversationThreadRead:
    if payload.entity_id is not None:
        assert_entity_role(session, user, payload.entity_id, WRITE_ROLES)
        entity_org = session.scalar(
            select(Entity.organisation_id).where(Entity.id == payload.entity_id)
        )
        if entity_org != user.organisation_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this entity.",
            )
    else:
        _require_org_wide_role(session, user, WRITE_ROLES)

    thread = ConversationThread(
        organisation_id=user.organisation_id,
        entity_id=payload.entity_id,
        created_by_user_id=user.id,
        source=payload.source,
        context_route=payload.context_route,
        context_record_refs=payload.context_record_refs,
        title=_fallback_title(payload),
        thread_metadata={},
    )
    session.add(thread)
    session.flush()
    if payload.initial_turn is not None:
        append_conversation_turn(
            thread=thread,
            role=payload.initial_turn.role,
            kind=payload.initial_turn.kind,
            payload=payload.initial_turn.payload,
            session=session,
        )
    session.commit()
    session.refresh(thread)
    return read_thread(thread)


@router.get("", response_model=list[ConversationThreadSummaryRead])
def list_threads(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: UUID | None = None,
    limit: int = Query(default=10, ge=1, le=25),
) -> list[ConversationThreadSummaryRead]:
    readable_ids = _readable_ids(session, user)
    if entity_id is not None:
        assert_entity_role(session, user, entity_id, READ_ROLES)
        scope_clause = or_(
            ConversationThread.entity_id == entity_id,
            ConversationThread.entity_id.is_(None),
        )
    else:
        if not readable_ids:
            return []
        scope_clause = or_(
            ConversationThread.entity_id.in_(readable_ids),
            ConversationThread.entity_id.is_(None),
        )
    threads = list(
        session.scalars(
            select(ConversationThread)
            .options(selectinload(ConversationThread.turns))
            .where(
                ConversationThread.organisation_id == user.organisation_id,
                ConversationThread.deleted_at.is_(None),
                scope_clause,
            )
            .order_by(ConversationThread.updated_at.desc(), ConversationThread.id.desc())
            .limit(limit)
        ).all()
    )
    return [_thread_summary(thread) for thread in threads]


@router.get("/{thread_id}", response_model=ConversationThreadRead)
def get_thread(
    thread_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> ConversationThreadRead:
    return read_thread(_get_thread_for_read(thread_id, session, user))


@router.post(
    "/{thread_id}/turns",
    response_model=ConversationThreadRead,
    status_code=status.HTTP_201_CREATED,
)
def append_turn(
    thread_id: UUID,
    payload: ConversationTurnCreateRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> ConversationThreadRead:
    thread = get_thread_for_write(thread_id, session, user)
    append_conversation_turn(
        thread=thread,
        role=payload.role,
        kind=payload.kind,
        payload=payload.payload,
        session=session,
    )
    session.commit()
    session.refresh(thread)
    return read_thread(thread)
