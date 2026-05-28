"""DocuSign integration tests."""

from uuid import uuid4

from stewart.core.settings import Settings
from stewart.integrations import docusign
from stewart.integrations.docusign import (
    LeaseSignatureRequest,
    download_signed_lease_document,
    send_lease_for_signature,
)


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict[str, object]) -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self) -> dict[str, object]:
        return self._payload


class _FakeClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []

    def __enter__(self) -> "_FakeClient":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def post(self, url: str, **kwargs: object) -> _FakeResponse:
        self.calls.append((url, kwargs))
        if url.endswith("/oauth/token"):
            return _FakeResponse(200, {"access_token": "access-token"})
        return _FakeResponse(201, {"envelopeId": "envelope-123", "status": "sent"})

    def get(self, url: str, **kwargs: object) -> _FakeResponse:
        self.calls.append((url, kwargs))
        response = _FakeResponse(200, {})
        response.content = b"%PDF signed lease"
        response.headers = {"content-type": "application/pdf"}
        return response


def _settings() -> Settings:
    return Settings(
        docusign_account_id="account-123",
        docusign_integration_key="integration-123",
        docusign_user_id="user-123",
        docusign_rsa_private_key="-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----",
        docusign_base_url="https://demo.docusign.net/restapi",
        docusign_auth_base_url="https://account-d.docusign.com",
    )


def _request() -> LeaseSignatureRequest:
    return LeaseSignatureRequest(
        lease_id=uuid4(),
        tenant_onboarding_id=uuid4(),
        document_id=uuid4(),
        entity_id=uuid4(),
        tenant_name="Lease Tenant Pty Ltd",
        signer_name="Lee Signer",
        signer_email="lee@example.com",
        property_name="Onboarding Plaza",
        unit_label="Suite 4",
        document_filename="lease-pack.pdf",
        document_bytes=b"lease pdf bytes",
        redirect_url="https://leasium.ai/tenant-portal/lease",
    )


def test_send_lease_for_signature_skips_when_not_configured() -> None:
    result = send_lease_for_signature(_request(), Settings())

    assert result.status == "skipped"
    assert result.error is not None
    assert "DocuSign is not configured" in result.error


def test_send_lease_for_signature_skips_without_signer_email() -> None:
    request = _request()
    request = LeaseSignatureRequest(
        **{**request.__dict__, "signer_email": None},
    )

    result = send_lease_for_signature(request, _settings())

    assert result.status == "skipped"
    assert result.error == "Tenant signer email is required before sending to DocuSign."


def test_send_lease_for_signature_creates_envelope(monkeypatch) -> None:  # noqa: ANN001
    fake_client = _FakeClient()
    request = _request()
    monkeypatch.setattr(docusign.jwt, "encode", lambda *args, **kwargs: "jwt-token")
    monkeypatch.setattr(docusign.httpx, "Client", lambda timeout: fake_client)

    result = send_lease_for_signature(request, _settings())

    assert result.status == "sent"
    assert result.envelope_id == "envelope-123"
    assert fake_client.calls[0][0] == "https://account-d.docusign.com/oauth/token"
    assert fake_client.calls[0][1]["data"] == {
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": "jwt-token",
    }
    envelope_url, envelope_kwargs = fake_client.calls[1]
    assert envelope_url == "https://demo.docusign.net/restapi/v2.1/accounts/account-123/envelopes"
    assert envelope_kwargs["headers"] == {"Authorization": "Bearer access-token"}
    payload = envelope_kwargs["json"]
    assert payload["status"] == "sent"
    assert payload["documents"][0]["name"] == "lease-pack.pdf"
    assert payload["recipients"]["signers"][0]["email"] == "lee@example.com"
    custom_fields = payload["customFields"]["textCustomFields"]
    assert {"name": "lease_id", "value": str(request.lease_id), "show": "false"} in custom_fields
    assert {
        "name": "tenant_onboarding_id",
        "value": str(request.tenant_onboarding_id),
        "show": "false",
    } in custom_fields
    assert {
        "name": "document_id",
        "value": str(request.document_id),
        "show": "false",
    } in custom_fields
    assert {field["name"] for field in custom_fields} == {
        "lease_id",
        "tenant_onboarding_id",
        "document_id",
        "entity_id",
        "property_name",
        "unit_label",
    }


def test_send_lease_for_signature_maps_provider_error(monkeypatch) -> None:  # noqa: ANN001
    class FailingClient(_FakeClient):
        def post(self, url: str, **kwargs: object) -> _FakeResponse:
            self.calls.append((url, kwargs))
            if url.endswith("/oauth/token"):
                return _FakeResponse(200, {"access_token": "access-token"})
            return _FakeResponse(400, {"message": "bad envelope"})

    monkeypatch.setattr(docusign.jwt, "encode", lambda *args, **kwargs: "jwt-token")
    monkeypatch.setattr(docusign.httpx, "Client", lambda timeout: FailingClient())

    result = send_lease_for_signature(_request(), _settings())

    assert result.status == "failed"
    assert result.error == "DocuSign envelope create failed: {'message': 'bad envelope'}"


def test_download_signed_lease_document_gets_combined_pdf(monkeypatch) -> None:  # noqa: ANN001
    fake_client = _FakeClient()
    monkeypatch.setattr(docusign.jwt, "encode", lambda *args, **kwargs: "jwt-token")
    monkeypatch.setattr(docusign.httpx, "Client", lambda timeout: fake_client)

    result = download_signed_lease_document("envelope-123", _settings())

    assert result.status == "downloaded"
    assert result.filename == "signed-lease-envelope-123.pdf"
    assert result.content_type == "application/pdf"
    assert result.file_data == b"%PDF signed lease"
    document_url, document_kwargs = fake_client.calls[1]
    assert document_url == (
        "https://demo.docusign.net/restapi/v2.1/accounts/"
        "account-123/envelopes/envelope-123/documents/combined"
    )
    assert document_kwargs["headers"] == {"Authorization": "Bearer access-token"}
    assert document_kwargs["params"] == {"certificate": "true"}


def test_download_signed_lease_document_maps_provider_error(monkeypatch) -> None:  # noqa: ANN001
    class FailingClient(_FakeClient):
        def get(self, url: str, **kwargs: object) -> _FakeResponse:
            self.calls.append((url, kwargs))
            return _FakeResponse(404, {"message": "missing envelope"})

    monkeypatch.setattr(docusign.jwt, "encode", lambda *args, **kwargs: "jwt-token")
    monkeypatch.setattr(docusign.httpx, "Client", lambda timeout: FailingClient())

    result = download_signed_lease_document("envelope-404", _settings())

    assert result.status == "failed"
    assert result.error == (
        "DocuSign signed document download failed: {'message': 'missing envelope'}"
    )
