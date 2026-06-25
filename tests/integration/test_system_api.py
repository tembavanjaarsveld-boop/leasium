"""System status API tests."""

from apps.api.main import app
from fastapi.testclient import TestClient
from stewart.core.settings import get_settings


def test_integration_status_reports_opensign_missing_credentials(
    client: TestClient,
) -> None:
    response = client.get("/api/v1/system/integration-status")

    assert response.status_code == 200
    body = response.json()
    assert body["opensign"] == {
        "configured": False,
        "live_ready": False,
        "label": "OpenSign",
        "purpose": "Lease e-signature requests and signed lease retention",
        "detail": (
            "Set OPENSIGN_API_TOKEN on the API service before sending lease "
            "e-signature requests."
        ),
        "missing_config": [
            "OPENSIGN_API_TOKEN",
            "OPENSIGN_WEBHOOK_SECRET",
            "PUBLIC_API_URL",
        ],
    }


def test_integration_status_reports_opensign_configured_without_webhook_secret(
    client: TestClient,
) -> None:
    base_settings = get_settings()
    app.dependency_overrides[get_settings] = lambda: base_settings.model_copy(
        update={
            "opensign_api_token": "token-123",
            "opensign_webhook_secret": "",
            "opensign_base_url": "https://app.opensignlabs.com/api/v1.2",
            "public_api_url": "https://api.leasium.test",
        }
    )

    response = client.get("/api/v1/system/integration-status")

    assert response.status_code == 200
    opensign = response.json()["opensign"]
    assert opensign["configured"] is True
    assert opensign["live_ready"] is False
    assert opensign["detail"] == (
        "API token is set; add OPENSIGN_WEBHOOK_SECRET before live testing so "
        "completed signing webhooks can be verified."
    )
    assert opensign["missing_config"] == ["OPENSIGN_WEBHOOK_SECRET"]
    assert (
        opensign["webhook_url"]
        == "https://api.leasium.test/api/v1/tenant-onboarding/webhooks/opensign"
    )


def test_integration_status_reports_opensign_demo_endpoints_not_live_ready(
    client: TestClient,
) -> None:
    base_settings = get_settings()
    app.dependency_overrides[get_settings] = lambda: base_settings.model_copy(
        update={
            "opensign_api_token": "token-123",
            "opensign_webhook_secret": "secret-123",
            "public_api_url": "https://api.leasium.test",
        }
    )

    response = client.get("/api/v1/system/integration-status")

    assert response.status_code == 200
    opensign = response.json()["opensign"]
    assert opensign["configured"] is True
    assert opensign["live_ready"] is False
    assert opensign["missing_config"] == ["OPENSIGN_BASE_URL"]
    assert opensign["detail"] == (
        "Token and webhook secret are set; switch OPENSIGN_BASE_URL to the "
        "production endpoint before live signing."
    )


def test_integration_status_reports_opensign_missing_public_api_url(
    client: TestClient,
) -> None:
    base_settings = get_settings()
    app.dependency_overrides[get_settings] = lambda: base_settings.model_copy(
        update={
            "opensign_api_token": "token-123",
            "opensign_webhook_secret": "secret-123",
            "opensign_base_url": "https://app.opensignlabs.com/api/v1.2",
            "public_api_url": "",
        }
    )

    response = client.get("/api/v1/system/integration-status")

    assert response.status_code == 200
    opensign = response.json()["opensign"]
    assert opensign["configured"] is True
    assert opensign["live_ready"] is False
    assert opensign["missing_config"] == ["PUBLIC_API_URL"]
    assert opensign["detail"] == (
        "Token, webhook secret, and production endpoint are set; add "
        "PUBLIC_API_URL so OpenSign can reach the Relby webhook."
    )
    assert "webhook_url" not in opensign


def test_integration_status_reports_opensign_live_ready(
    client: TestClient,
) -> None:
    base_settings = get_settings()
    app.dependency_overrides[get_settings] = lambda: base_settings.model_copy(
        update={
            "opensign_api_token": "token-123",
            "opensign_webhook_secret": "secret-123",
            "opensign_base_url": "https://app.opensignlabs.com/api/v1.2",
            "public_api_url": "https://api.leasium.test",
        }
    )

    response = client.get("/api/v1/system/integration-status")

    assert response.status_code == 200
    opensign = response.json()["opensign"]
    assert opensign["configured"] is True
    assert opensign["live_ready"] is True
    assert opensign["missing_config"] == []
    assert opensign["detail"] == (
        "Configured for signature requests and completed signed-document retention."
    )
