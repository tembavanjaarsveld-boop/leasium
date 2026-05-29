"""System status API tests."""

from apps.api.main import app
from fastapi.testclient import TestClient
from stewart.core.settings import get_settings


def test_integration_status_reports_docusign_missing_credentials(
    client: TestClient,
) -> None:
    response = client.get("/api/v1/system/integration-status")

    assert response.status_code == 200
    body = response.json()
    assert body["docusign"] == {
        "configured": False,
        "live_ready": False,
        "label": "DocuSign",
        "purpose": "Lease signature envelopes and signed lease retention",
        "detail": (
            "Set DOCUSIGN_ACCOUNT_ID, DOCUSIGN_INTEGRATION_KEY, "
            "DOCUSIGN_USER_ID, and DOCUSIGN_RSA_PRIVATE_KEY on the API service "
            "before sending lease envelopes."
        ),
        "missing_config": [
            "DOCUSIGN_ACCOUNT_ID",
            "DOCUSIGN_INTEGRATION_KEY",
            "DOCUSIGN_USER_ID",
            "DOCUSIGN_RSA_PRIVATE_KEY",
            "DOCUSIGN_WEBHOOK_SECRET",
            "PUBLIC_API_URL",
        ],
    }


def test_integration_status_reports_docusign_configured_without_webhook_secret(
    client: TestClient,
) -> None:
    base_settings = get_settings()
    app.dependency_overrides[get_settings] = lambda: base_settings.model_copy(
        update={
            "docusign_account_id": "account-123",
            "docusign_integration_key": "integration-123",
            "docusign_user_id": "user-123",
            "docusign_rsa_private_key": "-----BEGIN PRIVATE KEY-----\ntest\n",
            "docusign_webhook_secret": "",
            "docusign_base_url": "https://www.docusign.net/restapi",
            "docusign_auth_base_url": "https://account.docusign.com",
            "public_api_url": "https://api.leasium.test",
        }
    )

    response = client.get("/api/v1/system/integration-status")

    assert response.status_code == 200
    docusign = response.json()["docusign"]
    assert docusign["configured"] is True
    assert docusign["live_ready"] is False
    assert docusign["detail"] == (
        "Credentials are set; add DOCUSIGN_WEBHOOK_SECRET before live Connect "
        "testing so completed envelopes can be verified."
    )
    assert docusign["missing_config"] == ["DOCUSIGN_WEBHOOK_SECRET"]
    assert (
        docusign["webhook_url"]
        == "https://api.leasium.test/api/v1/tenant-onboarding/webhooks/docusign"
    )


def test_integration_status_reports_docusign_demo_endpoints_not_live_ready(
    client: TestClient,
) -> None:
    base_settings = get_settings()
    app.dependency_overrides[get_settings] = lambda: base_settings.model_copy(
        update={
            "docusign_account_id": "account-123",
            "docusign_integration_key": "integration-123",
            "docusign_user_id": "user-123",
            "docusign_rsa_private_key": "-----BEGIN PRIVATE KEY-----\ntest\n",
            "docusign_webhook_secret": "secret-123",
            "public_api_url": "https://api.leasium.test",
        }
    )

    response = client.get("/api/v1/system/integration-status")

    assert response.status_code == 200
    docusign = response.json()["docusign"]
    assert docusign["configured"] is True
    assert docusign["live_ready"] is False
    assert docusign["missing_config"] == [
        "DOCUSIGN_BASE_URL",
        "DOCUSIGN_AUTH_BASE_URL",
    ]
    assert docusign["detail"] == (
        "Credentials and webhook are set; switch DocuSign REST and auth URLs "
        "to production before live envelope testing."
    )


def test_integration_status_reports_docusign_missing_public_api_url(
    client: TestClient,
) -> None:
    base_settings = get_settings()
    app.dependency_overrides[get_settings] = lambda: base_settings.model_copy(
        update={
            "docusign_account_id": "account-123",
            "docusign_integration_key": "integration-123",
            "docusign_user_id": "user-123",
            "docusign_rsa_private_key": "-----BEGIN PRIVATE KEY-----\ntest\n",
            "docusign_webhook_secret": "secret-123",
            "docusign_base_url": "https://www.docusign.net/restapi",
            "docusign_auth_base_url": "https://account.docusign.com",
            "public_api_url": "",
        }
    )

    response = client.get("/api/v1/system/integration-status")

    assert response.status_code == 200
    docusign = response.json()["docusign"]
    assert docusign["configured"] is True
    assert docusign["live_ready"] is False
    assert docusign["missing_config"] == ["PUBLIC_API_URL"]
    assert docusign["detail"] == (
        "Credentials, webhook secret, and production DocuSign endpoints are set; "
        "add PUBLIC_API_URL so Connect can reach the Leasium webhook."
    )
    assert "webhook_url" not in docusign


def test_integration_status_reports_docusign_live_ready(
    client: TestClient,
) -> None:
    base_settings = get_settings()
    app.dependency_overrides[get_settings] = lambda: base_settings.model_copy(
        update={
            "docusign_account_id": "account-123",
            "docusign_integration_key": "integration-123",
            "docusign_user_id": "user-123",
            "docusign_rsa_private_key": "-----BEGIN PRIVATE KEY-----\ntest\n",
            "docusign_webhook_secret": "secret-123",
            "docusign_base_url": "https://www.docusign.net/restapi",
            "docusign_auth_base_url": "https://account.docusign.com",
            "public_api_url": "https://api.leasium.test",
        }
    )

    response = client.get("/api/v1/system/integration-status")

    assert response.status_code == 200
    docusign = response.json()["docusign"]
    assert docusign["configured"] is True
    assert docusign["live_ready"] is True
    assert docusign["missing_config"] == []
    assert docusign["detail"] == (
        "Configured for envelope creation and completed signed-document retention."
    )
