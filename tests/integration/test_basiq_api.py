"""Basiq (AU) bank-feed reconciliation API integration tests.

These mirror the Xero payment-reconciliation tests and lean on the same
fixtures, because the Basiq router reuses the Xero reconciliation engine.
Every provider access is mocked; no real Basiq HTTP is ever performed.
"""

from uuid import UUID

from apps.api.main import app
from apps.api.routers import basiq as basiq_router
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import BasiqConnection, UserEntityRole, UserRole
from stewart.core.settings import Settings, get_settings
from stewart.integrations import basiq as basiq_integration
from stewart.integrations.basiq import (
    BasiqFetchResult,
    BasiqIntegrationError,
    BasiqTransaction,
    _to_basiq_transaction,
    fetch_transactions,
)
from tests.integration.test_xero_api import _create_approved_invoice_fixture, _entity_id


def _basiq_settings(*, enabled: bool = False, api_key: str = "") -> Settings:
    return Settings(
        public_api_url="https://api.leasium.test",
        frontend_url="https://app.leasium.test",
        xero_token_encryption_key=Fernet.generate_key().decode("utf-8"),
        basiq_enabled=enabled,
        basiq_api_key=api_key,
    )


def _override_settings(settings: Settings) -> None:
    app.dependency_overrides[get_settings] = lambda: settings


def test_basiq_imported_happy_path_preview_ready_then_apply_writes_local_metadata(
    client: TestClient,
    session: Session,
) -> None:
    """Guardrail: preview writes nothing; apply writes ONLY local metadata.

    The bank-feed evidence + no-bank-mutation flags must be present, and the
    invoice payment_status must stay ``unpaid`` after preview, flipping to
    ``paid`` only once the approved key is applied.
    """

    _override_settings(_basiq_settings())
    entity_id = _entity_id(session)
    invoice_draft = _create_approved_invoice_fixture(
        client,
        session,
        entity_id,
        invoice_number="INV-BASIQ-1",
        total_cents=275050,
    )

    payload = {
        "source": "imported",
        "transactions": [
            {
                "transaction_id": "basiq-txn-1",
                "amount_cents": 275050,
                "posted_date": "2026-05-30",
                "description": "Rent payment",
                "reference": "INV-BASIQ-1",
                "counterparty": "Bright Cafe",
                "account_name": "Operating Account",
            }
        ],
    }

    preview_response = client.post(
        f"/api/v1/basiq/reconciliation-preview/{entity_id}",
        json=payload,
    )
    assert preview_response.status_code == 200
    preview_body = preview_response.json()
    assert preview_body["basiq_configured"] is False
    assert preview_body["checked_transactions"] == 1
    assert preview_body["ready_count"] == 1
    assert preview_body["applied_count"] == 0
    row = preview_body["results"][0]
    assert row["status"] == "ready"
    assert row["match_confidence"] == "high"
    assert row["match_method"] == "Matched by exact reference and amount (Basiq)."
    assert row["bank_transaction_id"] == "basiq-txn-1"
    assert row["amount_delta_cents"] == 0
    assert "bank_evidence_stored" in row["guardrail_flags"]
    assert "no_bank_feed_mutation" in row["guardrail_flags"]
    assert "local_payment_metadata_only" in row["guardrail_flags"]
    approved_key = row["idempotency_key"]
    assert approved_key

    # Preview wrote nothing.
    session.refresh(invoice_draft)
    assert invoice_draft.invoice_metadata["payment_status"]["status"] == "unpaid"

    apply_payload = {**payload, "approved_idempotency_keys": [approved_key]}
    apply_response = client.post(
        f"/api/v1/basiq/reconciliation-apply/{entity_id}",
        json=apply_payload,
    )
    assert apply_response.status_code == 200
    apply_body = apply_response.json()
    assert apply_body["applied_count"] == 1
    applied_row = apply_body["results"][0]
    assert applied_row["status"] == "applied"
    assert applied_row["proposed_paid_cents"] == 275050
    assert "no_bank_feed_mutation" in applied_row["guardrail_flags"]

    # Apply wrote ONLY local invoice payment metadata.
    session.refresh(invoice_draft)
    metadata = invoice_draft.invoice_metadata
    assert metadata["payment_status"]["status"] == "paid"
    assert metadata["payment_status"]["paid_cents"] == 275050
    reconciliation_entry = metadata["xero_payment_reconciliation"]
    assert reconciliation_entry["bank_transaction_id"] == "basiq-txn-1"
    assert reconciliation_entry["bank_account_name"] == "Operating Account"
    assert reconciliation_entry["reference"] == "INV-BASIQ-1"
    assert "no_bank_feed_mutation" in reconciliation_entry["guardrail_flags"]


def test_basiq_unconfigured_provider_soft_skips_and_writes_nothing(
    client: TestClient,
    session: Session,
) -> None:
    """Guardrail: inert without credentials.

    With basiq_enabled=False and source="provider", the adapter soft-skips:
    200 OK, basiq_configured False, no transactions, nothing written.
    """

    _override_settings(_basiq_settings(enabled=False))
    entity_id = _entity_id(session)
    invoice_draft = _create_approved_invoice_fixture(
        client,
        session,
        entity_id,
        invoice_number="INV-BASIQ-SKIP",
        total_cents=120000,
    )

    response = client.post(
        f"/api/v1/basiq/reconciliation-preview/{entity_id}",
        json={"source": "provider", "transactions": []},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["basiq_configured"] is False
    assert body["checked_transactions"] == 0
    assert body["results"] == []

    session.refresh(invoice_draft)
    assert invoice_draft.invoice_metadata["payment_status"]["status"] == "unpaid"


def test_basiq_apply_without_approved_key_skips_and_leaves_metadata_unchanged(
    client: TestClient,
    session: Session,
) -> None:
    """Guardrail: explicit-approval gate.

    A ready row whose idempotency key is NOT in approved_idempotency_keys is
    skipped with reason "Not approved by operator." and writes nothing.
    """

    _override_settings(_basiq_settings())
    entity_id = _entity_id(session)
    invoice_draft = _create_approved_invoice_fixture(
        client,
        session,
        entity_id,
        invoice_number="INV-BASIQ-APPROVE",
        total_cents=99000,
    )

    payload = {
        "source": "imported",
        "transactions": [
            {
                "transaction_id": "basiq-txn-approve",
                "amount_cents": 99000,
                "posted_date": "2026-05-30",
                "reference": "INV-BASIQ-APPROVE",
            }
        ],
        "approved_idempotency_keys": [],
    }
    response = client.post(
        f"/api/v1/basiq/reconciliation-apply/{entity_id}",
        json=payload,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["applied_count"] == 0
    assert body["skipped_count"] == 1
    row = body["results"][0]
    assert row["status"] == "skipped"
    assert row["reason"] == "Not approved by operator."

    session.refresh(invoice_draft)
    assert invoice_draft.invoice_metadata["payment_status"]["status"] == "unpaid"
    assert "xero_payment_reconciliation" not in invoice_draft.invoice_metadata


def test_basiq_apply_is_idempotent_for_approved_key(
    client: TestClient,
    session: Session,
) -> None:
    """Guardrail: idempotency.

    Applying the same approved row twice writes once: the second apply is
    skipped and payment_history length stays 1.
    """

    _override_settings(_basiq_settings())
    entity_id = _entity_id(session)
    invoice_draft = _create_approved_invoice_fixture(
        client,
        session,
        entity_id,
        invoice_number="INV-BASIQ-IDEM",
        total_cents=180000,
    )

    payload = {
        "source": "imported",
        "transactions": [
            {
                "transaction_id": "basiq-txn-idem",
                "amount_cents": 180000,
                "posted_date": "2026-05-30",
                "reference": "INV-BASIQ-IDEM",
            }
        ],
    }
    preview_body = client.post(
        f"/api/v1/basiq/reconciliation-preview/{entity_id}",
        json=payload,
    ).json()
    approved_key = preview_body["results"][0]["idempotency_key"]
    apply_payload = {**payload, "approved_idempotency_keys": [approved_key]}

    first = client.post(
        f"/api/v1/basiq/reconciliation-apply/{entity_id}",
        json=apply_payload,
    ).json()
    assert first["applied_count"] == 1

    session.refresh(invoice_draft)
    assert len(invoice_draft.invoice_metadata["payment_history"]) == 1

    second = client.post(
        f"/api/v1/basiq/reconciliation-apply/{entity_id}",
        json=apply_payload,
    ).json()
    assert second["applied_count"] == 0
    assert second["skipped_count"] == 1
    assert second["results"][0]["reason"] == (
        "This payment reconciliation item was already applied."
    )

    session.refresh(invoice_draft)
    assert len(invoice_draft.invoice_metadata["payment_history"]) == 1


def test_basiq_reconciliation_forbidden_for_viewer_role(
    client: TestClient,
    session: Session,
) -> None:
    """Guardrail: role gate. A viewer cannot preview or apply (403)."""

    settings = _basiq_settings()
    _override_settings(settings)
    entity_id = _entity_id(session)
    role = session.get(UserEntityRole, (settings.dev_user_id, UUID(entity_id)))
    assert role is not None
    role.role = UserRole.viewer
    session.commit()

    response = client.post(
        f"/api/v1/basiq/reconciliation-preview/{entity_id}",
        json={"source": "imported", "transactions": []},
    )
    assert response.status_code == 403


def test_basiq_low_confidence_ambiguous_match_is_blocked_and_cannot_apply(
    client: TestClient,
    session: Session,
) -> None:
    """Guardrail: low-confidence guard.

    Two unpaid drafts share the transaction amount with no reference match,
    so the row is ambiguous -> low confidence -> blocked, and apply cannot
    write it even if its key were approved.
    """

    _override_settings(_basiq_settings())
    entity_id = _entity_id(session)
    draft_a = _create_approved_invoice_fixture(
        client,
        session,
        entity_id,
        invoice_number="INV-BASIQ-AMB-A",
        total_cents=150000,
    )
    draft_b = _create_approved_invoice_fixture(
        client,
        session,
        entity_id,
        invoice_number="INV-BASIQ-AMB-B",
        total_cents=150000,
    )

    payload = {
        "source": "imported",
        "transactions": [
            {
                "transaction_id": "basiq-txn-ambiguous",
                "amount_cents": 150000,
                "posted_date": "2026-05-30",
                "reference": "Unclear remittance",
            }
        ],
    }
    preview = client.post(
        f"/api/v1/basiq/reconciliation-preview/{entity_id}",
        json=payload,
    ).json()
    assert preview["blocked_count"] == 1
    row = preview["results"][0]
    assert row["status"] == "blocked"
    assert row["match_confidence"] == "low"
    assert "review_match_confidence" in row["guardrail_flags"]

    # Even an apply attempt cannot write a blocked low-confidence row.
    apply_payload = {**payload, "approved_idempotency_keys": [row["idempotency_key"] or "x"]}
    applied = client.post(
        f"/api/v1/basiq/reconciliation-apply/{entity_id}",
        json=apply_payload,
    ).json()
    assert applied["applied_count"] == 0
    assert applied["blocked_count"] == 1

    session.refresh(draft_a)
    session.refresh(draft_b)
    assert draft_a.invoice_metadata["payment_status"]["status"] == "unpaid"
    assert draft_b.invoice_metadata["payment_status"]["status"] == "unpaid"


def test_basiq_provider_source_maps_fetched_transactions_without_real_http(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """Guardrail: all provider access mocked; no real HTTP.

    With basiq_enabled=True + a dummy key and source="provider", a mocked
    fetch_transactions returns two BasiqTransactions; the router maps them to
    reconciliation items. No real Basiq network call is made.
    """

    _override_settings(_basiq_settings(enabled=True, api_key="dummy-basiq-key"))
    entity_id = _entity_id(session)
    invoice_draft = _create_approved_invoice_fixture(
        client,
        session,
        entity_id,
        invoice_number="INV-BASIQ-PROVIDER",
        total_cents=440000,
    )

    fetch_calls: list[bool] = []

    def fake_fetch_transactions(
        settings: Settings,  # noqa: ARG001
        *,
        basiq_user_id: str | None = None,  # noqa: ARG001
        account_id: str | None = None,  # noqa: ARG001
    ) -> BasiqFetchResult:
        fetch_calls.append(True)
        return BasiqFetchResult(
            status="ok",
            transactions=[
                BasiqTransaction(
                    transaction_id="basiq-feed-1",
                    amount_cents=440000,
                    reference="INV-BASIQ-PROVIDER",
                    counterparty="Tenant Pty Ltd",
                    account_name="Operating Account",
                ),
                BasiqTransaction(
                    transaction_id="basiq-feed-2",
                    amount_cents=12345,
                    reference="UNMATCHED",
                ),
            ],
        )

    monkeypatch.setattr(basiq_router, "fetch_transactions", fake_fetch_transactions)

    response = client.post(
        f"/api/v1/basiq/reconciliation-preview/{entity_id}",
        json={"source": "provider", "transactions": []},
    )
    assert response.status_code == 200
    body = response.json()
    assert fetch_calls == [True]
    assert body["source"] == "provider"
    assert body["basiq_configured"] is True
    assert body["checked_transactions"] == 2

    matched = next(
        row for row in body["results"] if row["bank_transaction_id"] == "basiq-feed-1"
    )
    assert matched["status"] == "ready"
    assert matched["match_confidence"] == "high"
    assert matched["proposed_paid_cents"] == 440000

    unmatched = next(
        row for row in body["results"] if row["bank_transaction_id"] == "basiq-feed-2"
    )
    assert unmatched["status"] == "blocked"

    # Provider preview wrote nothing.
    session.refresh(invoice_draft)
    assert invoice_draft.invoice_metadata["payment_status"]["status"] == "unpaid"


# ---------------------------------------------------------------------------
# Live Basiq connection slice: adapter + connect/status/revoke routes.
# Every Basiq HTTP call is mocked; no real network access ever happens.
# ---------------------------------------------------------------------------


class _Resp:
    """Minimal stand-in for an httpx.Response in adapter tests."""

    def __init__(self, payload: object) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> object:
        return self._payload


class _RecordingClient:
    """Records every request a piece of adapter code makes.

    Each test supplies a ``responder`` that maps ``(method, url)`` to a JSON
    payload, so we can both drive the parser and assert the EXACT set of HTTP
    calls (proving the fetch path is token POST + GET only -- no user, no
    auth_link, no DELETE).
    """

    def __init__(self, responder) -> None:
        self._responder = responder
        self.calls: list[dict[str, object]] = []

    def __enter__(self) -> "_RecordingClient":
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def _record(self, method: str, url: str, **kwargs: object) -> _Resp:
        self.calls.append({"method": method, "url": url, **kwargs})
        return _Resp(self._responder(method, url, kwargs))

    def post(self, url: str, **kwargs: object) -> _Resp:
        return self._record("POST", url, **kwargs)

    def get(self, url: str, **kwargs: object) -> _Resp:
        return self._record("GET", url, **kwargs)

    def delete(self, url: str, **kwargs: object) -> _Resp:  # pragma: no cover - guard
        return self._record("DELETE", url, **kwargs)


def _install_recording_client(monkeypatch, responder) -> _RecordingClient:
    recorder = _RecordingClient(responder)
    monkeypatch.setattr(
        basiq_integration.httpx,
        "Client",
        lambda *args, **kwargs: recorder,
    )
    return recorder


def test_basiq_server_token_request_shape_and_parse(monkeypatch) -> None:
    """(a) The server-token call uses the documented Basiq v3 contract."""

    settings = _basiq_settings(enabled=True, api_key="secret-basiq-key")

    def responder(method: str, url: str, kwargs: dict) -> object:
        assert method == "POST"
        assert url == "https://au-api.basiq.io/token"
        headers = kwargs["headers"]
        assert headers["Authorization"] == "Basic secret-basiq-key"
        assert headers["basiq-version"] == "3.0"
        assert headers["Content-Type"] == "application/x-www-form-urlencoded"
        assert kwargs["content"] == "scope=SERVER_ACCESS"
        return {"access_token": "server-token-xyz", "expires_in": 3600}

    recorder = _install_recording_client(monkeypatch, responder)
    token = basiq_integration.basiq_server_token(settings)
    assert token == "server-token-xyz"
    assert [call["method"] for call in recorder.calls] == ["POST"]


def test_basiq_server_token_failure_raises_integration_error(monkeypatch) -> None:
    settings = _basiq_settings(enabled=True, api_key="secret-basiq-key")

    def responder(method: str, url: str, kwargs: dict) -> object:
        return {"unexpected": True}

    _install_recording_client(monkeypatch, responder)
    raised = False
    try:
        basiq_integration.basiq_server_token(settings)
    except BasiqIntegrationError:
        raised = True
    assert raised


def test_to_basiq_transaction_filters_and_converts_amount() -> None:
    """(b) Mapping keeps only AUD posted credits and converts dollars->cents."""

    accounts_by_id = {"acc-1": "Operating Account"}

    credit = _to_basiq_transaction(
        {
            "id": "txn-credit",
            "amount": "123.12",
            "direction": "credit",
            "status": "posted",
            "currency": "AUD",
            "postDate": "2026-05-30T00:00:00Z",
            "description": "Rent",
            "reference": "INV-1",
            "account": "acc-1",
            "enrich": {"merchant": {"businessName": "Bright Cafe"}},
        },
        accounts_by_id,
    )
    assert credit is not None
    assert credit.amount_cents == 12312
    assert credit.account_name == "Operating Account"
    assert credit.counterparty == "Bright Cafe"
    assert credit.posted_date is not None and credit.posted_date.isoformat() == "2026-05-30"

    # Debit dropped.
    assert (
        _to_basiq_transaction(
            {
                "id": "txn-debit",
                "amount": "-50.00",
                "direction": "debit",
                "status": "posted",
                "currency": "AUD",
            },
            accounts_by_id,
        )
        is None
    )
    # Pending dropped.
    assert (
        _to_basiq_transaction(
            {
                "id": "txn-pending",
                "amount": "10.00",
                "direction": "credit",
                "status": "pending",
                "currency": "AUD",
                "postDate": None,
            },
            accounts_by_id,
        )
        is None
    )
    # Non-AUD dropped.
    assert (
        _to_basiq_transaction(
            {
                "id": "txn-usd",
                "amount": "10.00",
                "direction": "credit",
                "status": "posted",
                "currency": "USD",
            },
            accounts_by_id,
        )
        is None
    )


def test_fetch_transactions_unconfigured_skips_with_no_http(monkeypatch) -> None:
    """(c) Unconfigured fetch soft-skips and performs ZERO HTTP."""

    recorder = _install_recording_client(
        monkeypatch,
        lambda *a: (_ for _ in ()).throw(AssertionError("no HTTP when unconfigured")),
    )
    result = fetch_transactions(_basiq_settings(enabled=False), basiq_user_id="user-1")
    assert result.status == "skipped"
    assert "BASIQ_ENABLED" in (result.error or "")
    assert recorder.calls == []


def test_fetch_transactions_without_basiq_user_is_ok_empty_and_no_http(monkeypatch) -> None:
    """(d) Configured but no connection (basiq_user_id=None) -> inert ok+empty."""

    recorder = _install_recording_client(
        monkeypatch,
        lambda *a: (_ for _ in ()).throw(AssertionError("no HTTP without a connection")),
    )
    result = fetch_transactions(
        _basiq_settings(enabled=True, api_key="k"),
        basiq_user_id=None,
    )
    assert result.status == "ok"
    assert result.transactions == []
    assert recorder.calls == []


def test_fetch_transactions_is_read_only_token_post_plus_gets_only(monkeypatch) -> None:
    """(e) The fetch path issues ONLY POST /token + GETs (no user/auth_link/DELETE)."""

    settings = _basiq_settings(enabled=True, api_key="k")

    def responder(method: str, url: str, kwargs: dict) -> object:
        if url.endswith("/token"):
            return {"access_token": "tok", "expires_in": 3600}
        if url.endswith("/accounts"):
            return {"data": [{"id": "acc-1", "name": "Operating Account"}]}
        if "/transactions" in url:
            return {
                "data": [
                    {
                        "id": "txn-1",
                        "amount": "275.50",
                        "direction": "credit",
                        "status": "posted",
                        "currency": "AUD",
                        "postDate": "2026-05-30T00:00:00Z",
                        "reference": "INV-1",
                        "account": "acc-1",
                    }
                ],
                "links": {},
            }
        raise AssertionError(f"unexpected URL {url}")

    recorder = _install_recording_client(monkeypatch, responder)
    result = fetch_transactions(settings, basiq_user_id="user-1")
    assert result.status == "ok"
    assert len(result.transactions) == 1
    assert result.transactions[0].amount_cents == 27550

    methods = [call["method"] for call in recorder.calls]
    assert methods == ["POST", "GET", "GET"]
    # Exactly one POST, and it is the token mint -- nothing creates a user or link.
    posts = [call for call in recorder.calls if call["method"] == "POST"]
    assert len(posts) == 1 and str(posts[0]["url"]).endswith("/token")
    assert not any("auth_link" in str(call["url"]) for call in recorder.calls)
    assert not any(call["method"] == "DELETE" for call in recorder.calls)


def test_fetch_transactions_provider_error_returns_failed(monkeypatch) -> None:
    settings = _basiq_settings(enabled=True, api_key="k")

    def raising_accounts(token, basiq_user_id, settings):  # noqa: ANN001
        raise BasiqIntegrationError("Could not read Basiq accounts.")

    monkeypatch.setattr(basiq_integration, "basiq_server_token", lambda s: "tok")
    monkeypatch.setattr(basiq_integration, "fetch_basiq_accounts", raising_accounts)
    result = fetch_transactions(settings, basiq_user_id="user-1")
    assert result.status == "failed"
    assert "accounts" in (result.error or "")


def test_connect_start_unconfigured_is_inert_and_writes_nothing(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """(f) Unconfigured connect-start: no HTTP, nothing written, actionable hint."""

    _override_settings(_basiq_settings(enabled=False))
    entity_id = _entity_id(session)
    monkeypatch.setattr(
        basiq_integration.httpx,
        "Client",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("no HTTP when unconfigured")),
    )

    response = client.post(f"/api/v1/basiq/connect-start/{entity_id}")
    assert response.status_code == 200
    body = response.json()
    assert body["configured"] is False
    assert body["consent_link"] is None
    assert "BASIQ_ENABLED" in body["missing_config"]

    connections = session.scalars(
        select(BasiqConnection).where(BasiqConnection.entity_id == UUID(entity_id))
    ).all()
    assert connections == []


def test_connect_start_configured_persists_pending_connection_and_hides_secret(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """(g) Configured connect-start persists a pending row + returns the link.

    The Basiq API key must never appear anywhere in the response body.
    """

    secret_key = "super-secret-basiq-key"
    _override_settings(_basiq_settings(enabled=True, api_key=secret_key))
    entity_id = _entity_id(session)

    monkeypatch.setattr(basiq_router, "basiq_server_token", lambda s: "server-token")
    created_emails: list[str] = []

    def fake_create_user(settings, token, email):  # noqa: ANN001
        created_emails.append(email)
        return "basiq-user-77"

    def fake_create_auth_link(settings, token, basiq_user_id):  # noqa: ANN001
        assert basiq_user_id == "basiq-user-77"
        return "https://connect.basiq.io/abc123", None

    monkeypatch.setattr(basiq_router, "create_basiq_user", fake_create_user)
    monkeypatch.setattr(basiq_router, "create_basiq_auth_link", fake_create_auth_link)

    response = client.post(f"/api/v1/basiq/connect-start/{entity_id}")
    assert response.status_code == 200
    body = response.json()
    assert body["configured"] is True
    assert body["consent_link"] == "https://connect.basiq.io/abc123"
    assert body["consent_status"] == "pending"
    assert "connect.basiq.io" in body["consent_link"]
    # Secret never leaks into the response.
    assert secret_key not in response.text
    assert len(created_emails) == 1

    connection = session.scalar(
        select(BasiqConnection).where(BasiqConnection.entity_id == UUID(entity_id))
    )
    assert connection is not None
    assert connection.basiq_user_id == "basiq-user-77"
    assert connection.consent_status == "pending"
    assert connection.auth_link_url == "https://connect.basiq.io/abc123"
    assert connection.revoked_at is None


def test_connect_start_revokes_prior_active_connection(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """Re-connect reuses the Basiq user and revokes the previous active row."""

    _override_settings(_basiq_settings(enabled=True, api_key="k"))
    entity_id = _entity_id(session)
    prior = BasiqConnection(
        entity_id=UUID(entity_id),
        basiq_user_id="basiq-user-existing",
        consent_status="pending",
    )
    session.add(prior)
    session.commit()

    reuse_user_ids: list[str] = []

    def fake_create_auth_link(settings, token, basiq_user_id):  # noqa: ANN001
        reuse_user_ids.append(basiq_user_id)
        return "https://connect.basiq.io/reused", None

    def fail_create_user(settings, token, email):  # noqa: ANN001
        raise AssertionError("must reuse the existing Basiq user, not create one")

    monkeypatch.setattr(basiq_router, "basiq_server_token", lambda s: "server-token")
    monkeypatch.setattr(basiq_router, "create_basiq_user", fail_create_user)
    monkeypatch.setattr(basiq_router, "create_basiq_auth_link", fake_create_auth_link)

    response = client.post(f"/api/v1/basiq/connect-start/{entity_id}")
    assert response.status_code == 200
    assert reuse_user_ids == ["basiq-user-existing"]

    session.refresh(prior)
    assert prior.revoked_at is not None
    active = basiq_router._active_basiq_connection(session, UUID(entity_id))
    assert active is not None and active.id != prior.id
    assert active.basiq_user_id == "basiq-user-existing"


def test_connection_status_is_local_only(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """(h) Connection-status never calls Basiq -- provider funcs raise if hit."""

    _override_settings(_basiq_settings(enabled=True, api_key="k"))
    entity_id = _entity_id(session)
    connection = BasiqConnection(
        entity_id=UUID(entity_id),
        basiq_user_id="basiq-user-1",
        consent_status="pending",
    )
    session.add(connection)
    session.commit()

    def explode(*args, **kwargs):  # noqa: ANN002, ANN003
        raise AssertionError("connection-status must not call Basiq")

    monkeypatch.setattr(basiq_router, "basiq_server_token", explode)
    monkeypatch.setattr(basiq_integration.httpx, "Client", explode)

    response = client.get(f"/api/v1/basiq/connection-status/{entity_id}")
    assert response.status_code == 200
    body = response.json()
    assert body["configured"] is True
    assert body["connected"] is True
    assert body["consent_status"] == "pending"
    assert body["can_start_connect"] is True
    assert body["can_fetch"] is True


def test_provider_source_with_active_connection_maps_credits_via_engine(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """(i) Provider preview with an active connection maps mocked credits.

    The adapter is exercised end-to-end through mocked Basiq HTTP and the row
    is matched through the shared Xero reconciliation engine.
    """

    _override_settings(_basiq_settings(enabled=True, api_key="k"))
    entity_id = _entity_id(session)
    invoice_draft = _create_approved_invoice_fixture(
        client,
        session,
        entity_id,
        invoice_number="INV-BASIQ-LIVE",
        total_cents=275550,
    )
    connection = BasiqConnection(
        entity_id=UUID(entity_id),
        basiq_user_id="basiq-user-live",
        consent_status="pending",
    )
    session.add(connection)
    session.commit()

    def responder(method: str, url: str, kwargs: dict) -> object:
        if url.endswith("/token"):
            return {"access_token": "tok", "expires_in": 3600}
        if url.endswith("/accounts"):
            return {"data": [{"id": "acc-live", "name": "Operating Account"}]}
        if "/transactions" in url:
            return {
                "data": [
                    {
                        "id": "basiq-live-1",
                        "amount": "2755.50",
                        "direction": "credit",
                        "status": "posted",
                        "currency": "AUD",
                        "postDate": "2026-05-30T00:00:00Z",
                        "reference": "INV-BASIQ-LIVE",
                        "account": "acc-live",
                    },
                    {
                        "id": "basiq-live-debit",
                        "amount": "-99.00",
                        "direction": "debit",
                        "status": "posted",
                        "currency": "AUD",
                        "account": "acc-live",
                    },
                ],
                "links": {},
            }
        raise AssertionError(f"unexpected URL {url}")

    recorder = _install_recording_client(monkeypatch, responder)

    response = client.post(
        f"/api/v1/basiq/reconciliation-preview/{entity_id}",
        json={"source": "provider", "transactions": []},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["basiq_configured"] is True
    # Only the AUD posted credit survives the adapter filters.
    assert body["checked_transactions"] == 1
    row = body["results"][0]
    assert row["bank_transaction_id"] == "basiq-live-1"
    assert row["status"] == "ready"
    assert row["proposed_paid_cents"] == 275550
    assert row["bank_account_name"] == "Operating Account"

    # Read-only: only POST /token + GETs, and last_fetch_at stamped on preview.
    assert not any(call["method"] == "DELETE" for call in recorder.calls)
    session.refresh(connection)
    assert connection.last_fetch_at is not None

    # Preview wrote nothing to the invoice.
    session.refresh(invoice_draft)
    assert invoice_draft.invoice_metadata["payment_status"]["status"] == "unpaid"


def test_connect_start_and_revoke_forbidden_for_viewer(
    client: TestClient,
    session: Session,
) -> None:
    """(j) A viewer cannot start a connection or revoke one (403)."""

    settings = _basiq_settings(enabled=True, api_key="k")
    _override_settings(settings)
    entity_id = _entity_id(session)
    role = session.get(UserEntityRole, (settings.dev_user_id, UUID(entity_id)))
    assert role is not None
    role.role = UserRole.viewer
    session.commit()

    start = client.post(f"/api/v1/basiq/connect-start/{entity_id}")
    assert start.status_code == 403
    revoke = client.post(f"/api/v1/basiq/connection-revoke/{entity_id}")
    assert revoke.status_code == 403


def test_connection_revoke_sets_revoked_at_and_calls_no_delete(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """(k) Revoke marks the local row revoked and never calls a Basiq DELETE."""

    _override_settings(_basiq_settings(enabled=True, api_key="k"))
    entity_id = _entity_id(session)
    connection = BasiqConnection(
        entity_id=UUID(entity_id),
        basiq_user_id="basiq-user-1",
        consent_status="pending",
    )
    session.add(connection)
    session.commit()

    def explode(*args, **kwargs):  # noqa: ANN002, ANN003
        raise AssertionError("revoke must not call Basiq")

    monkeypatch.setattr(basiq_integration.httpx, "Client", explode)

    response = client.post(f"/api/v1/basiq/connection-revoke/{entity_id}")
    assert response.status_code == 200
    body = response.json()
    assert body["connected"] is False
    assert body["can_fetch"] is False

    session.refresh(connection)
    assert connection.revoked_at is not None
    assert connection.consent_status == "revoked"
    assert basiq_router._active_basiq_connection(session, UUID(entity_id)) is None
