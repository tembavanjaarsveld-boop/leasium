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
        "label": "DocuSign",
        "purpose": "Lease signature envelopes and signed lease retention",
        "detail": (
            "Set DOCUSIGN_ACCOUNT_ID, DOCUSIGN_INTEGRATION_KEY, "
            "DOCUSIGN_USER_ID, and DOCUSIGN_RSA_PRIVATE_KEY on the API service "
            "before sending lease envelopes."
        ),
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
            "public_api_url": "https://api.leasium.test",
        }
    )

    response = client.get("/api/v1/system/integration-status")

    assert response.status_code == 200
    docusign = response.json()["docusign"]
    assert docusign["configured"] is True
    assert docusign["detail"] == (
        "Credentials are set; add DOCUSIGN_WEBHOOK_SECRET before live Connect "
        "testing so completed envelopes can be verified."
    )
    assert (
        docusign["webhook_url"]
        == "https://api.leasium.test/api/v1/tenant-onboarding/webhooks/docusign"
    )
