"""Schemas for operator security and organisation access management."""

from datetime import datetime
from typing import Literal
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


class SecurityWorkAssignmentDigestReceipt(BaseModel):
    event: str = "digest_generated"
    generated_at: datetime
    entity_id: UUID
    cadence: Literal["daily", "weekly"]
    item_count: int = 0
    ready_count: int = 0
    attention_count: int = 0
    in_flight_count: int = 0
    done_count: int = 0
    follow_up_due_count: int = 0
    delivery_status: str = "previewed"
    message_sent: bool = False
    delivery_detail: str | None = None
    delivery_channel: str | None = None
    provider: str | None = None
    provider_message_id: str | None = None
    template_key: str | None = None
    template_version: str | None = None
    delivery_trigger: str | None = None
    recovery_of_generated_at: datetime | None = None
    delivery_attempt_count: int = 0


class SecurityNotificationPreferences(BaseModel):
    work_assignment_email_enabled: bool = True
    work_assignment_sms_enabled: bool = False
    work_assignment_sms_phone: str | None = Field(default=None, max_length=40)
    work_assignment_notice_template_key: str = "work_assignment_notification"
    work_assignment_notice_template_version: str = "v1"
    work_assignment_digest_cadence: Literal["off", "daily", "weekly"] = "daily"
    work_assignment_digest_template_key: str = "work_assignment_digest"
    work_assignment_digest_template_version: str = "v1"
    work_assignment_digest_last_generated_at: datetime | None = None
    work_assignment_digest_last_item_count: int | None = None
    work_assignment_digest_history: list[SecurityWorkAssignmentDigestReceipt] = Field(
        default_factory=list
    )


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
    notification_preferences: SecurityNotificationPreferences = Field(
        default_factory=SecurityNotificationPreferences
    )
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


class SecurityBootstrapStatusRead(BaseModel):
    available: bool
    reason: str
    auth: SecurityAuthStatusRead
    organisation_count: int
    entity_count: int
    operator_count: int


class SecurityBootstrapCreate(BaseModel):
    organisation_name: str = Field(min_length=1, max_length=160)
    entity_name: str = Field(min_length=1, max_length=160)
    email: str = Field(min_length=3, max_length=320)
    display_name: str | None = Field(default=None, max_length=160)
    country_code: str = Field(default="AU", min_length=2, max_length=2)
    timezone: str = Field(default="Australia/Brisbane", min_length=1, max_length=80)
    entity_abn: str | None = Field(default=None, max_length=32)
    gst_registered: bool = True


class SecurityBootstrapEntityRead(BaseModel):
    id: UUID
    organisation_id: UUID
    name: str
    abn: str | None
    gst_registered: bool


class SecurityBootstrapRead(BaseModel):
    accepted: bool
    organisation: SecurityOrganisationRead
    entity: SecurityBootstrapEntityRead
    member: SecurityMemberRead


class SecurityMemberCreate(BaseModel):
    email: str
    display_name: str
    roles: list[SecurityRoleAssignment] = Field(min_length=1)
    is_active: bool = True
    notification_preferences: SecurityNotificationPreferences = Field(
        default_factory=SecurityNotificationPreferences
    )


class SecurityMemberUpdate(BaseModel):
    display_name: str | None = None
    is_active: bool | None = None
    roles: list[SecurityRoleAssignment] | None = None
    notification_preferences: SecurityNotificationPreferences | None = None


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
