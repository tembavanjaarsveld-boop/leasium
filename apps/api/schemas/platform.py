"""Schemas for the platform-admin client provisioning + management API.

These power the /admin surface: a platform admin acts *across* client
organisations, never inside the reserved "Leasium Platform" org. See
docs/platform-admin-tier-ia.md.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field
from stewart.core.models import OperatingMode

from apps.api.schemas.common import ApiModel
from apps.api.schemas.security import SecurityMemberRead


class PlatformOrganisationCreate(BaseModel):
    organisation_name: str = Field(min_length=1, max_length=160)
    operator_email: str = Field(min_length=3, max_length=320)
    operator_display_name: str | None = Field(default=None, max_length=160)
    country_code: str = Field(default="AU", min_length=2, max_length=2)
    timezone: str = Field(default="Australia/Brisbane", min_length=1, max_length=80)


class PlatformOrganisationRead(ApiModel):
    id: UUID
    name: str
    country_code: str
    timezone: str
    operating_mode: str
    is_active: bool
    suspended_at: datetime | None = None
    created_at: datetime
    operator_count: int = 0
    first_operator_email: str | None = None
    first_operator_access_status: str | None = None


class PlatformOrganisationListRead(BaseModel):
    organisations: list[PlatformOrganisationRead] = Field(default_factory=list)


class PlatformOrganisationCreateRead(BaseModel):
    organisation: PlatformOrganisationRead
    operator: SecurityMemberRead
    invite_accept_url: str | None = None
    delivery_status: str
    delivery_detail: str | None = None


class PlatformOrganisationUpdate(BaseModel):
    is_active: bool


class PlatformOperatingModeUpdate(BaseModel):
    operating_mode: OperatingMode


class PlatformMemberCreate(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    display_name: str = Field(min_length=1, max_length=160)
    is_active: bool = True


class PlatformMemberUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=160)
    is_active: bool | None = None


class PlatformMemberListRead(BaseModel):
    members: list[SecurityMemberRead] = Field(default_factory=list)


class PlatformMemberInviteRead(BaseModel):
    member: SecurityMemberRead
    delivery_status: str
    delivery_detail: str | None = None
    invite_accept_url: str | None = None
