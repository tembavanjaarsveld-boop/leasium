"""Authentication and entity-scoped authorization dependencies."""

from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated, Any
from uuid import UUID

import httpx
import jwt
from fastapi import Depends, Header, HTTPException, status
from jwt import PyJWKClient
from jwt.exceptions import InvalidTokenError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from stewart.core.db import get_session, utcnow
from stewart.core.models import (
    AppUser,
    OperatorInviteStatus,
    Organisation,
    UserEntityRole,
    UserRole,
)
from stewart.core.settings import Settings, get_settings


@dataclass(frozen=True)
class CurrentUser:
    id: UUID
    organisation_id: UUID
    email: str
    display_name: str
    actor: str
    is_platform_admin: bool = False


@dataclass(frozen=True)
class ClerkIdentity:
    provider_id: str
    verified_email: str | None = None


def _dev_user(settings: Settings) -> CurrentUser:
    return CurrentUser(
        id=settings.dev_user_id,
        organisation_id=settings.dev_organisation_id,
        email=settings.dev_user_email,
        display_name=settings.dev_user_name,
        actor=f"user:{settings.dev_user_email}",
        is_platform_admin=settings.dev_is_platform_admin,
    )


def _clerk_user(
    authorization: str | None,
    session: Session,
    settings: Settings,
) -> CurrentUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Clerk bearer token.",
        )
    token = authorization.removeprefix("Bearer ").strip()
    identity = _clerk_identity(token, settings)
    provider_id = identity.provider_id
    user = session.scalar(select(AppUser).where(AppUser.auth_provider_id == provider_id))
    if user is None:
        user = _link_operator_by_verified_email(identity, session, settings)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unknown Clerk user.",
        )
    organisation = session.get(Organisation, user.organisation_id)
    if organisation is not None and organisation.suspended_at is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This organisation is suspended. Contact Leasium.",
        )
    return CurrentUser(
        id=user.id,
        organisation_id=user.organisation_id,
        email=user.email,
        display_name=user.display_name,
        actor=f"user:{user.email}",
        is_platform_admin=user.is_platform_admin,
    )


def get_current_user(
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_session)],
    authorization: Annotated[str | None, Header()] = None,
) -> CurrentUser:
    """Resolve the current user through dev auth or the Clerk adapter boundary."""

    if settings.auth_mode == "dev":
        return _dev_user(settings)
    return _clerk_user(authorization, session, settings)


def _clerk_provider_id(token: str, settings: Settings) -> str:
    """Return the verified Clerk subject."""

    return _clerk_identity(token, settings).provider_id


def _clerk_identity(token: str, settings: Settings) -> ClerkIdentity:
    """Return the verified Clerk subject and any verified email claim."""

    if not settings.clerk_jwks_url:
        if settings.clerk_allow_legacy_token_mapping:
            return ClerkIdentity(provider_id=token)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Clerk JWKS is not configured.",
        )
    try:
        jwks_client = _clerk_jwks_client(settings.clerk_jwks_url)
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        options: Any = {"verify_aud": bool(settings.clerk_audience)}
        decoded = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=settings.clerk_audience or None,
            issuer=settings.clerk_issuer or None,
            options=options,
        )
    except InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Clerk session.",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not verify Clerk session.",
        ) from exc
    if not isinstance(decoded, dict):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Clerk session is not valid.",
        )
    subject = decoded.get("sub")
    if not isinstance(subject, str) or not subject:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Clerk session is missing a subject.",
        )
    return ClerkIdentity(
        provider_id=subject,
        verified_email=_verified_email_from_claims(decoded),
    )


@lru_cache(maxsize=8)
def _clerk_jwks_client(jwks_url: str) -> PyJWKClient:
    """Return a process-wide Clerk JWKS client so auth fan-out reuses key cache."""

    return PyJWKClient(jwks_url)


def _normalise_email(email: str) -> str:
    return email.strip().lower()


def _verified_email_from_claims(decoded: dict[str, Any]) -> str | None:
    email = decoded.get("email")
    email_verified = decoded.get("email_verified")
    if isinstance(email, str) and email.strip() and email_verified is True:
        return _normalise_email(email)
    return None


def _verified_email_from_clerk_user(provider_id: str, settings: Settings) -> str | None:
    payload = _clerk_user_payload(provider_id, settings)
    if not isinstance(payload, dict):
        return None

    primary_email_id = payload.get("primary_email_address_id")
    email_addresses = payload.get("email_addresses")
    if not isinstance(primary_email_id, str) or not isinstance(email_addresses, list):
        return None

    for email_address in email_addresses:
        if not isinstance(email_address, dict) or email_address.get("id") != primary_email_id:
            continue
        verification = email_address.get("verification")
        if not isinstance(verification, dict) or verification.get("status") != "verified":
            return None
        email = email_address.get("email_address")
        if isinstance(email, str) and email.strip():
            return _normalise_email(email)
    return None


def _verified_emails_from_clerk_payload(payload: dict[str, Any]) -> set[str]:
    email_addresses = payload.get("email_addresses")
    if not isinstance(email_addresses, list):
        return set()

    verified_emails: set[str] = set()
    for email_address in email_addresses:
        if not isinstance(email_address, dict):
            continue
        verification = email_address.get("verification")
        if not isinstance(verification, dict) or verification.get("status") != "verified":
            continue
        email = email_address.get("email_address")
        if isinstance(email, str) and email.strip():
            verified_emails.add(_normalise_email(email))
    return verified_emails


def _verified_emails_from_clerk_user(provider_id: str, settings: Settings) -> set[str]:
    payload = _clerk_user_payload(provider_id, settings)
    if not isinstance(payload, dict):
        return set()
    return _verified_emails_from_clerk_payload(payload)


def _clerk_user_payload(provider_id: str, settings: Settings) -> dict[str, Any] | None:
    secret = settings.clerk_secret_key.strip()
    if not secret:
        return None

    try:
        response = httpx.get(
            f"https://api.clerk.com/v1/users/{provider_id}",
            headers={
                "Authorization": f"Bearer {secret}",
                "Accept": "application/json",
                "User-Agent": "Leasium/1.0 (+https://leasium.ai)",
            },
            timeout=5.0,
        )
        response.raise_for_status()
    except httpx.HTTPError:
        return None

    try:
        payload = response.json()
    except ValueError:
        return None
    return payload if isinstance(payload, dict) else None


def _link_operator_by_verified_email(
    identity: ClerkIdentity,
    session: Session,
    settings: Settings,
) -> AppUser | None:
    email = identity.verified_email or _verified_email_from_clerk_user(
        identity.provider_id,
        settings,
    )
    if email is None:
        return None
    email = _normalise_email(email)

    existing_provider_user = session.scalar(
        select(AppUser).where(AppUser.auth_provider_id == identity.provider_id)
    )
    if existing_provider_user is not None:
        return existing_provider_user if existing_provider_user.is_active else None

    user = session.scalar(
        select(AppUser).where(
            func.lower(AppUser.email) == email,
            AppUser.is_active.is_(True),
        )
    )
    if user is None:
        return None

    user.auth_provider_id = identity.provider_id
    user.invite_status = OperatorInviteStatus.accepted
    user.invite_accepted_at = user.invite_accepted_at or utcnow()
    user.invite_last_error = None
    user.invite_token_hash = None
    session.commit()
    session.refresh(user)
    return user


def assert_entity_role(
    session: Session,
    user: CurrentUser,
    entity_id: UUID,
    allowed_roles: set[UserRole],
) -> None:
    """Raise 403 unless the user has one of the allowed roles for the entity."""

    role = session.scalar(
        select(UserEntityRole.role).where(
            UserEntityRole.user_id == user.id,
            UserEntityRole.entity_id == entity_id,
        )
    )
    if role not in allowed_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this entity.",
        )


def require_platform_admin(
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> CurrentUser:
    """Raise 403 unless the current user is a platform admin."""

    if not user.is_platform_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Platform-admin access is required.",
        )
    return user


def require_entity_role(
    entity_id: UUID, allowed_roles: set[UserRole]
) -> Callable[..., CurrentUser]:
    """Dependency-style helper for routes that already have an entity id."""

    def dependency(
        user: Annotated[CurrentUser, Depends(get_current_user)],
        session: Annotated[Session, Depends(get_session)],
    ) -> CurrentUser:
        assert_entity_role(session, user, entity_id, allowed_roles)
        return user

    return dependency
