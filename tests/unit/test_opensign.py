"""OpenSign integration tests."""

import base64
from uuid import uuid4

from stewart.core.settings import Settings
from stewart.integrations import opensign
from stewart.integrations.opensign import (
    LeaseSignatureRequest,
    download_signed_lease_document,
    send_lease_for_signature,
)


class _FakeResponse:
    def __init__(
        self,
        status_code: int,
        payload: dict[str, object] | None = None,
        *,
        content: bytes = b"",
        headers: dict[str, str] | None = None,
    ) -> None:
        self.status_code = status_code
        self._payload = payload or {}
        self.text = str(payload)
        self.content = content
        self.headers = headers or {}

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
        return _FakeResponse(200, {"objectId": "doc-abc", "message": "Document sent successfully!"})

    def get(self, url: str, **kwargs: object) -> _FakeResponse:
        self.calls.append((url, kwargs))
        return _FakeResponse(
            200,
            content=b"%PDF signed lease",
            headers={"content-type": "application/pdf"},
        )


def _settings() -> Settings:
    return Settings(
        opensign_api_token="opensign-token",
        opensign_base_url="https://app.opensignlabs.com/api/v1.2",
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
        redirect_url="https://relby.ai/tenant-portal/lease",
    )


def test_send_lease_for_signature_skips_when_not_configured() -> None:
    result = send_lease_for_signature(_request(), Settings(opensign_api_token=""))

    assert result.status == "skipped"
    assert result.error is not None
    assert "OpenSign is not configured" in result.error


def test_send_lease_for_signature_skips_without_signer_email() -> None:
    request = _request()
    request = LeaseSignatureRequest(**{**request.__dict__, "signer_email": None})

    result = send_lease_for_signature(request, _settings())

    assert result.status == "skipped"
    assert result.error == "Tenant signer email is required before sending to OpenSign."


def test_send_lease_for_signature_creates_document(monkeypatch) -> None:  # noqa: ANN001
    fake_client = _FakeClient()
    request = _request()
    monkeypatch.setattr(opensign.httpx, "Client", lambda timeout: fake_client)

    result = send_lease_for_signature(request, _settings())

    assert result.status == "sent"
    assert result.provider == "opensign"
    assert result.envelope_id == "doc-abc"
    create_url, create_kwargs = fake_client.calls[0]
    assert create_url == "https://app.opensignlabs.com/api/v1.2/createdocument"
    assert create_kwargs["headers"]["x-api-token"] == "opensign-token"
    payload = create_kwargs["json"]
    assert payload["file"] == base64.b64encode(b"lease pdf bytes").decode()
    assert payload["title"].startswith("Lease agreement")
    assert payload["merge_certificate"] is True
    assert payload["send_email"] is True
    signer = payload["signers"][0]
    assert signer["email"] == "lee@example.com"
    assert signer["signer_role"] == "signer"
    assert signer["widgets"][0]["type"] == "signature"
    assert payload["redirect_url"] == "https://relby.ai/tenant-portal/lease"


def test_send_lease_for_signature_maps_provider_error(monkeypatch) -> None:  # noqa: ANN001
    class FailingClient(_FakeClient):
        def post(self, url: str, **kwargs: object) -> _FakeResponse:
            self.calls.append((url, kwargs))
            return _FakeResponse(400, {"error": "bad document"})

    monkeypatch.setattr(opensign.httpx, "Client", lambda timeout: FailingClient())

    result = send_lease_for_signature(_request(), _settings())

    assert result.status == "failed"
    assert result.error == "OpenSign document create failed: {'error': 'bad document'}"


def test_send_lease_for_signature_requires_object_id(monkeypatch) -> None:  # noqa: ANN001
    class NoObjectClient(_FakeClient):
        def post(self, url: str, **kwargs: object) -> _FakeResponse:
            self.calls.append((url, kwargs))
            return _FakeResponse(200, {"message": "ok"})

    monkeypatch.setattr(opensign.httpx, "Client", lambda timeout: NoObjectClient())

    result = send_lease_for_signature(_request(), _settings())

    assert result.status == "failed"
    assert result.error == "OpenSign create response did not include an objectId."


def test_download_signed_lease_document_skips_without_url() -> None:
    result = download_signed_lease_document("", _settings())

    assert result.status == "skipped"
    assert result.error is not None
    assert "signed file URL is required" in result.error


def test_download_signed_lease_document_fetches_presigned_url(monkeypatch) -> None:  # noqa: ANN001
    fake_client = _FakeClient()
    monkeypatch.setattr(opensign.httpx, "Client", lambda timeout: fake_client)

    result = download_signed_lease_document(
        "https://files.example.com/signed_lease.pdf?X-Amz-Signature=abc",
        _settings(),
    )

    assert result.status == "downloaded"
    assert result.content_type == "application/pdf"
    assert result.file_data == b"%PDF signed lease"
    download_url, _ = fake_client.calls[0]
    assert download_url == "https://files.example.com/signed_lease.pdf?X-Amz-Signature=abc"


def test_download_signed_lease_document_maps_provider_error(monkeypatch) -> None:  # noqa: ANN001
    class FailingClient(_FakeClient):
        def get(self, url: str, **kwargs: object) -> _FakeResponse:
            self.calls.append((url, kwargs))
            return _FakeResponse(404, {"error": "missing"})

    monkeypatch.setattr(opensign.httpx, "Client", lambda timeout: FailingClient())

    result = download_signed_lease_document(
        "https://files.example.com/missing.pdf",
        _settings(),
    )

    assert result.status == "failed"
    assert result.error is not None
    assert "OpenSign signed document download failed" in result.error
