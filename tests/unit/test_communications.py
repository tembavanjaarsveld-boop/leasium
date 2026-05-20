"""Outbound communications payload tests."""

from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import uuid4

import pytest
from stewart.core.settings import Settings
from stewart.integrations import communications
from stewart.integrations.communications import (
    ContractorWorkOrderEmail,
    OperatorInviteEmail,
    TenantOnboardingInvite,
    send_contractor_work_order_email,
    send_operator_invite_email,
)


class _FakeSendGridResponse:
    status_code = 202
    headers = {"x-message-id": "sendgrid-message-1"}
    text = ""

    def json(self) -> dict[str, object]:
        return {}


class _CaptureClient:
    def __init__(self, payloads: list[dict[str, object]]) -> None:
        self.payloads = payloads

    def __enter__(self) -> _CaptureClient:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def post(
        self,
        *args: object,
        json: dict[str, object],
        **kwargs: object,
    ) -> _FakeSendGridResponse:
        self.payloads.append(json)
        return _FakeSendGridResponse()


def _settings() -> Settings:
    return Settings(
        _env_file=None,
        sendgrid_api_key="sendgrid-test-key",
        sendgrid_from_email="hello@leasium.test",
        tenant_onboarding_sms_enabled=False,
        operator_invite_email_enabled=True,
    )


def test_operator_invite_sendgrid_categories_are_deduplicated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payloads: list[dict[str, object]] = []
    monkeypatch.setattr(
        "stewart.integrations.communications.httpx.Client",
        lambda **kwargs: _CaptureClient(payloads),
    )

    result = send_operator_invite_email(
        OperatorInviteEmail(
            user_id=uuid4(),
            organisation_name="SKJ Capital",
            invited_by_name="Temba van Jaarsveld",
            display_name="Temba van Jaarsveld",
            email="temba@skjcapital.com",
            accept_url="https://leasium.vercel.app/accept-invite?token=test",
            expires_at=datetime(2026, 5, 23, tzinfo=UTC),
            template_key="operator_invite",
            template_version="v1",
        ),
        _settings(),
    )

    assert result.status == "queued"
    assert payloads[0]["categories"] == ["operator_invite"]


def test_tenant_onboarding_sendgrid_categories_are_deduplicated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payloads: list[dict[str, object]] = []
    monkeypatch.setattr(
        "stewart.integrations.communications.httpx.Client",
        lambda **kwargs: _CaptureClient(payloads),
    )

    result = communications._send_email(
        TenantOnboardingInvite(
            onboarding_id=uuid4(),
            entity_id=uuid4(),
            tenant_name="Bright Cafe",
            contact_name="Avery Tenant",
            contact_email="avery@example.com",
            contact_phone=None,
            property_name="100 Queen Street",
            property_address="100 Queen Street, Brisbane",
            unit_label="Shop 1",
            onboarding_url="https://leasium.vercel.app/onboarding/test",
            due_date=date(2026, 5, 24),
            expires_at=datetime(2026, 5, 27, tzinfo=UTC),
            brand_name="Leasium",
            template_key="tenant_onboarding",
            template_version="v1",
        ),
        _settings(),
    )

    assert result.status == "queued"
    assert payloads[0]["categories"] == ["tenant_onboarding"]


def test_contractor_work_order_sendgrid_categories_are_deduplicated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payloads: list[dict[str, object]] = []
    monkeypatch.setattr(
        "stewart.integrations.communications.httpx.Client",
        lambda **kwargs: _CaptureClient(payloads),
    )

    work_order_id = uuid4()
    entity_id = uuid4()
    result = send_contractor_work_order_email(
        ContractorWorkOrderEmail(
            work_order_id=work_order_id,
            entity_id=entity_id,
            title="Replace shopfront lock",
            description="Rear lock is sticking.",
            priority="normal",
            status="assigned",
            property_name="Queen Street Retail Centre",
            property_address="12 Queen Street, Brisbane City, QLD 4000",
            unit_label="Shop 1",
            tenant_name="Bright Cafe",
            contractor_name="Rapid Locksmiths",
            contractor_email="dispatch@rapidlocks.example",
            due_date=date(2026, 5, 28),
            subject="Attendance window request",
            body="Please confirm your first available attendance window.",
            template_key="maintenance_contractor",
            template_version="v1",
        ),
        _settings(),
    )

    assert result.status == "queued"
    assert payloads[0]["categories"] == ["maintenance_contractor"]
    personalizations = payloads[0]["personalizations"]
    assert isinstance(personalizations, list)
    custom_args = personalizations[0]["custom_args"]
    assert custom_args["maintenance_work_order_id"] == str(work_order_id)
