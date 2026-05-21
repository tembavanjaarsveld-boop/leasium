"""Outbound communications payload tests."""

from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import uuid4

import pytest
from stewart.core.settings import Settings
from stewart.integrations import communications
from stewart.integrations.communications import (
    ContractorWorkOrderEmail,
    ContractorWorkOrderSms,
    OperatorInviteEmail,
    TenantOnboardingInvite,
    WorkAssignmentDigestEmail,
    WorkAssignmentDigestEmailItem,
    WorkAssignmentEmail,
    send_contractor_work_order_email,
    send_contractor_work_order_sms,
    send_operator_invite_email,
    send_work_assignment_digest_email,
    send_work_assignment_email,
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


class _FakeTwilioResponse:
    status_code = 201

    def json(self) -> dict[str, object]:
        return {"sid": "SM-test-message"}


class _CaptureTwilioClient:
    def __init__(self, payloads: list[dict[str, object]]) -> None:
        self.payloads = payloads

    def __enter__(self) -> _CaptureTwilioClient:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def post(
        self,
        *args: object,
        data: dict[str, object],
        **kwargs: object,
    ) -> _FakeTwilioResponse:
        self.payloads.append(data)
        return _FakeTwilioResponse()


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


def test_contractor_work_order_sms_includes_status_callback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payloads: list[dict[str, object]] = []
    monkeypatch.setattr(
        "stewart.integrations.communications.httpx.Client",
        lambda **kwargs: _CaptureTwilioClient(payloads),
    )

    work_order_id = uuid4()
    entity_id = uuid4()
    result = send_contractor_work_order_sms(
        ContractorWorkOrderSms(
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
            contractor_phone="+61400111222",
            due_date=date(2026, 5, 28),
            body="Please confirm your first available attendance window.",
            template_key="maintenance_contractor_sms",
            template_version="v1",
        ),
        Settings(
            _env_file=None,
            twilio_account_sid="AC-test",
            twilio_auth_token="twilio-secret",
            twilio_messaging_service_sid="MG-test",
            public_api_url="https://api.leasium.test",
            communications_webhook_secret="secret",
        ),
    )

    assert result.status == "queued"
    assert result.provider_message_id == "SM-test-message"
    assert payloads[0]["To"] == "+61400111222"
    assert payloads[0]["MessagingServiceSid"] == "MG-test"
    assert payloads[0]["StatusCallback"] == (
        "https://api.leasium.test/api/v1/maintenance/work-orders/webhooks/twilio-status"
        "?token=secret"
    )
    assert "Leasium contractor update" in str(payloads[0]["Body"])


def test_work_assignment_sendgrid_categories_are_deduplicated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payloads: list[dict[str, object]] = []
    monkeypatch.setattr(
        "stewart.integrations.communications.httpx.Client",
        lambda **kwargs: _CaptureClient(payloads),
    )

    target_id = uuid4()
    entity_id = uuid4()
    result = send_work_assignment_email(
        WorkAssignmentEmail(
            target_id=target_id,
            target_type="maintenance_work_order",
            entity_id=entity_id,
            work_kind="Maintenance",
            title="Replace shopfront lock",
            description="Rear lock is sticking.",
            due_date=date(2026, 5, 28),
            assignee_name="Temba van Jaarsveld",
            assignee_email="temba@example.com",
            assigned_by_name="Owner Operator",
            work_url="https://leasium.vercel.app/operations/maintenance/test",
            template_key="work_assignment",
            template_version="v1",
        ),
        _settings(),
    )

    assert result.status == "queued"
    assert payloads[0]["categories"] == ["work_assignment"]
    personalizations = payloads[0]["personalizations"]
    assert isinstance(personalizations, list)
    custom_args = personalizations[0]["custom_args"]
    assert custom_args["work_assignment_target_id"] == str(target_id)
    assert custom_args["work_assignment_target_type"] == "maintenance_work_order"
    assert custom_args["entity_id"] == str(entity_id)


def test_work_assignment_digest_sendgrid_categories_and_args(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payloads: list[dict[str, object]] = []
    monkeypatch.setattr(
        "stewart.integrations.communications.httpx.Client",
        lambda **kwargs: _CaptureClient(payloads),
    )

    entity_id = uuid4()
    assignee_id = uuid4()
    generated_at = datetime(2026, 5, 21, 8, 0, tzinfo=UTC)
    result = send_work_assignment_digest_email(
        WorkAssignmentDigestEmail(
            entity_id=entity_id,
            assignee_user_id=assignee_id,
            assignee_name="Temba van Jaarsveld",
            assignee_email="temba@example.com",
            cadence="daily",
            generated_at=generated_at,
            item_count=1,
            follow_up_due_count=1,
            ready_count=1,
            attention_count=0,
            in_flight_count=0,
            done_count=0,
            items=[
                WorkAssignmentDigestEmailItem(
                    title="Replace shopfront lock",
                    work_kind="Maintenance",
                    due_date=date(2026, 5, 28),
                    status="requested",
                    priority="urgent",
                    follow_up_due=True,
                    work_url="https://leasium.vercel.app/operations/maintenance/test",
                )
            ],
            template_key="work_assignment_digest",
            template_version="v1",
        ),
        _settings(),
    )

    assert result.status == "queued"
    assert payloads[0]["categories"] == ["work_assignment_digest"]
    personalizations = payloads[0]["personalizations"]
    assert isinstance(personalizations, list)
    custom_args = personalizations[0]["custom_args"]
    assert custom_args["work_assignment_digest_entity_id"] == str(entity_id)
    assert custom_args["work_assignment_digest_assignee_user_id"] == str(assignee_id)
    assert custom_args["work_assignment_digest_cadence"] == "daily"
    assert custom_args["work_assignment_digest_generated_at"] == generated_at.isoformat()
