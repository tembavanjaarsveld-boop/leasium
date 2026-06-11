"""API dependency re-exports."""

from stewart.core.auth import (
    CurrentUser,
    assert_entity_role,
    get_current_user,
    readable_entity_ids,
    require_entity_role,
    require_platform_admin,
)
from stewart.core.db import get_session

__all__ = [
    "CurrentUser",
    "assert_entity_role",
    "get_current_user",
    "get_session",
    "readable_entity_ids",
    "require_entity_role",
    "require_platform_admin",
]
