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
from sqlalchemy.orm import Session
from stewart.core.models import UserEntityRole, UserRole
from stewart.core.settings import Settings, get_settings
from stewart.integrations.basiq import BasiqFetchResult, BasiqTransaction
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
