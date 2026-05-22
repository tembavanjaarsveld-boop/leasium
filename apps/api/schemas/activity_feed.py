"""Cross-property activity feed schemas.

Tier 2 (f) of the 2026-05-22 UX review — give operators a Vercel-style
"what changed since you looked" stream that pulls directly from the
append-only `audit_action` table so we never need to back-fill or
double-write a separate feed table.

Read-only: the feed surfaces history, it does not let the operator
mutate anything from this view.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

ActivityActorKind = Literal["operator", "system", "tenant", "external", "unknown"]

# Coarse action kinds we want to chip in the UI. The raw audit action
# verbs are highly granular ("apply", "approve", "deliver", "review",
# "reminder", ...); we group them so the UI shows a small palette and
# the rest fall back to "update".
ActivityActionKind = Literal[
    "create",
    "update",
    "apply",
    "review",
    "approve",
    "deliver",
    "remind",
    "revoke",
    "query",
    "delete",
    "other",
]


class ActivityFeedItem(BaseModel):
    id: UUID
    occurred_at: datetime
    actor: str
    actor_kind: ActivityActorKind
    action: str
    action_kind: ActivityActionKind
    action_label: str
    summary: str
    target_table: str | None = None
    target_id: UUID | None = None
    target_label: str | None = None
    target_href: str | None = None
    tool_name: str | None = None
    outcome: str
    error_message: str | None = None


class ActivityFeedRead(BaseModel):
    items: list[ActivityFeedItem] = Field(default_factory=list)
    has_more: bool = False
    next_cursor: str | None = None


__all__ = [
    "ActivityActorKind",
    "ActivityActionKind",
    "ActivityFeedItem",
    "ActivityFeedRead",
]
