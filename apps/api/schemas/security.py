"""Schemas for operator security and organisation access management."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field
from stewart.core.models import OperatorInviteStatus, UserRole

from apps.api.schemas.common import ApiModel


class SecurityRoleAssignment(BaseModel):
    entity_id: UUID
    role: UserRole


class SecurityEntityRoleRead(BaseModel):
    entity_id: UUID
    entity_name: str
    role: UserRole


class SecurityCurrentUserRead(BaseModel):
    id: UUID
    organisation_id: UUID
    email: str
    display_name: str


class SecurityOrganisationRead(ApiModel):
    id: UUID
    name: str
    country_code: str
    timezone: str
    created_at: datetime


class SecurityMemberRead(ApiModel):
    id: UUID
    email: str
    display_name: str
    is_active: bool
    login_linked: bool
    invite_email_status: OperatorInviteStatus
    invite_email_detail: str
    invite_sent_at: datetime | None
    invite_expires_at: datetime | None
    invite_accepted_at: datetime | None
    created_at: datetime
    roles: list[SecurityEntityRoleRead] = Field(default_factory=list)


class SecurityAuthStatusRead(BaseModel):
    auth_mode: str
    dev_auth_active: bool
    clerk_secret_configured: bool
    clerk_jwks_configured: bool
    operator_login_enforced: bool
    login_boundary: str
    next_steps: list[str] = Field(default_factory=list)


class SecurityWorkspaceRead(BaseModel):
    auth: SecurityAuthStatusRead
    current_user: SecurityCurrentUserRead
    organisation: SecurityOrganisationRead
    members: list[SecurityMemberRead]
    current_user_roles: list[SecurityEntityRoleRead]
    can_manage_security: bool


class SecurityMeRead(BaseModel):
    auth: SecurityAuthStatusRead
    current_user: SecurityCurrentUserRead
    organisation: SecurityOrganisationRead
    roles: list[SecurityEntityRoleRead]
    can_manage_security: bool


class SecurityMemberCreate(BaseModel):
    email: str
    display_name: str
    roles: list[SecurityRoleAssignment] = Field(min_length=1)
    is_active: bool = True


class SecurityMemberUpdate(BaseModel):
    display_name: str | None = None
    is_active: bool | None = None
    roles: list[SecurityRoleAssignment] | None = None


class SecurityMemberInviteRead(BaseModel):
    member: SecurityMemberRead
    delivery_status: str
    delivery_detail: str | None = None


class SecurityInviteAccept(BaseModel):
    token: str
    auth_provider_id: str
    email: str
    display_name: str | None = None


class SecurityInviteAcceptRead(BaseModel):
    member: SecurityMemberRead
    accepted: bool
