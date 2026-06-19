"""Observability guardrails for hosted error monitoring."""

from apps.api.observability import scrub_sentry_event


def test_sentry_scrubber_redacts_portfolio_pii() -> None:
    event = {
        "user": {
            "email": "tenant@example.com",
            "username": "Jane Tenant",
            "id": "auth-123",
        },
        "request": {
            "headers": {
                "authorization": "Bearer secret-token",
                "cookie": "session=secret",
                "x-request-id": "req-123",
            },
            "data": {
                "tenant_name": "Jane Tenant",
                "owner_abn": "12 345 678 901",
                "contact_email": "owner@example.com",
                "safe_counter": 2,
            },
        },
        "contexts": {
            "custom": {
                "billing_email": "billing@example.com",
                "property_name": "Leitchs Road",
            }
        },
        "extra": {
            "recipientName": "Owner Person",
            "recipientEmail": "owner@example.com",
            "abn": "98 765 432 109",
        },
    }

    scrubbed = scrub_sentry_event(event, None)

    assert scrubbed["user"] == {"id": "auth-123"}
    assert scrubbed["request"]["headers"] == {
        "authorization": "[Filtered]",
        "cookie": "[Filtered]",
        "x-request-id": "req-123",
    }
    assert scrubbed["request"]["data"] == {
        "tenant_name": "[Filtered]",
        "owner_abn": "[Filtered]",
        "contact_email": "[Filtered]",
        "safe_counter": 2,
    }
    assert scrubbed["contexts"]["custom"] == {
        "billing_email": "[Filtered]",
        "property_name": "[Filtered]",
    }
    assert scrubbed["extra"] == {
        "recipientName": "[Filtered]",
        "recipientEmail": "[Filtered]",
        "abn": "[Filtered]",
    }
