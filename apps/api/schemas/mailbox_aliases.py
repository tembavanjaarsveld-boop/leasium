"""Schemas for AI Mailbox virtual client alias management.

Platform admins reserve/disable aliases across client organisations; operators
read (display) their own organisation's active aliases. No provider sends here.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from apps.api.schemas.common import ApiModel


class MailboxAliasCreate(BaseModel):
    organisation_id: UUID
    local_part: str
    domain: str | None = None
    label: str | None = None


class MailboxAliasUpdate(BaseModel):
    status: str | None = None
    label: str | None = None


class MailboxAliasRead(ApiModel):
    id: UUID
    organisation_id: UUID
    local_part: str
    domain: str
    email_address: str
    label: str | None = None
    status: str
    created_at: datetime
    created_by_user_id: UUID | None = None


class MailboxAliasListRead(ApiModel):
    aliases: list[MailboxAliasRead]
