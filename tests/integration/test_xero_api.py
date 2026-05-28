"""Xero readiness API integration tests."""

from datetime import timedelta
from uuid import UUID

from apps.api.main import app
from apps.api.routers import xero as xero_router
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.db import utcnow
from stewart.core.models import (
    AuditAction,
    BillingDraft,
    BillingDraftLine,
    BillingDraftStatus,
    DocumentCategory,
    Entity,
    InvoiceDraft,
    InvoiceDraftLine,
    InvoiceDraftStatus,
    Property,
    PropertyType,
    RentChargeRule,
    StoredDocument,
    Tenant,
    UserEntityRole,
    UserRole,
    XeroConnection,
)
from stewart.core.settings import Settings, get_settings
from stewart.integrations.communications import DeliveryResult
from stewart.integrations.xero import decrypt_xero_token


def _entity_id(session: Session) -> str:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return str(entity.id)


def _provider_settings() -> Settings:
    return Settings(
        public_api_url="https://api.leasium.test",
        frontend_url="https://app.leasium.test",
        xero_client_id="xero-client-id",
        xero_client_secret="xero-client-secret",
        xero_state_secret="xero-state-secret",
        xero_token_encryption_key=Fernet.generate_key().decode("utf-8"),
    )


def _override_settings(settings: Settings) -> None:
    app.dependency_overrides[get_settings] = lambda: settings


def _fake_xero_provider(
    monkeypatch,
    tenant_id: str = "tenant-provider-123",
    scopes: str = "offline_access accounting.contacts.read",
) -> None:
    def fake_exchange_code_for_tokens(code: str, settings: Settings) -> dict[str, object]:
        assert code == "auth-code"
        assert settings.xero_client_id == "xero-client-id"
        return {
            "access_token": "raw-access-token",
            "refresh_token": "raw-refresh-token",
            "expires_in": 1800,
            "scope": scopes,
            "token_type": "Bearer",
        }

    def fake_fetch_xero_connections(
        access_token: str,
        settings: Settings,  # noqa: ARG001
    ) -> list[dict[str, object]]:
        assert access_token == "raw-access-token"
        return [
            {
                "id": "connection-1",
                "tenantId": tenant_id,
                "tenantName": "SKJ Xero Demo",
                "tenantType": "ORGANISATION",
            }
        ]

    monkeypatch.setattr(xero_router, "exchange_code_for_tokens", fake_exchange_code_for_tokens)
    monkeypatch.setattr(xero_router, "fetch_xero_connections", fake_fetch_xero_connections)


def _start_xero_oauth(client: TestClient, entity_id: str) -> str:
    response = client.get(f"/api/v1/xero/oauth/start?entity_id={entity_id}")
    assert response.status_code == 200
    body = response.json()
    assert body["configured"] is True
    assert body["authorization_url"]
    assert body["missing_config"] == []
    return str(body["authorization_url"]).split("state=", 1)[1].split("&", 1)[0]


def _finish_xero_oauth(client: TestClient, state: str) -> None:
    response = client.get(
        "/api/v1/xero/oauth/callback",
        params={"code": "auth-code", "state": state},
        follow_redirects=False,
    )
    assert response.status_code in {302, 307}
    assert "xero_connected=1" in response.headers["location"]


def _create_charge_rule_fixture(
    client: TestClient,
    entity_id: str,
    *,
    charge_type: str = "base_rent",
    xero_account_code: str | None = None,
    xero_tax_type: str | None = None,
) -> str:
    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": f"{charge_type.replace('_', ' ').title()} Property",
            "street_address": "100 Queen Street",
            "property_type": "commercial_retail",
        },
    )
    assert property_response.status_code == 201
    property_id = property_response.json()["id"]
    unit_response = client.post(
        "/api/v1/tenancy-units",
        json={"property_id": property_id, "unit_label": "Shop 1"},
    )
    assert unit_response.status_code == 201
    tenant_response = client.post(
        "/api/v1/tenants",
        json={"entity_id": entity_id, "legal_name": f"{charge_type.title()} Tenant Pty Ltd"},
    )
    assert tenant_response.status_code == 201
    lease_response = client.post(
        "/api/v1/leases",
        json={
            "tenancy_unit_id": unit_response.json()["id"],
            "tenant_id": tenant_response.json()["id"],
            "status": "active",
            "commencement_date": "2026-01-01",
            "expiry_date": "2028-12-31",
            "annual_rent_cents": 1200000,
            "rent_frequency": "monthly",
        },
    )
    assert lease_response.status_code == 201
    charge_response = client.post(
        "/api/v1/charge-rules",
        json={
            "lease_id": lease_response.json()["id"],
            "charge_type": charge_type,
            "amount_cents": 100000,
            "frequency": "monthly",
            "gst_treatment": "taxable",
            "next_due_date": "2026-06-01",
            "xero_account_code": xero_account_code,
            "xero_tax_type": xero_tax_type,
        },
    )
    assert charge_response.status_code == 201
    return str(charge_response.json()["id"])


def _create_approved_invoice_fixture(
    client: TestClient,
    session: Session,
    entity_id: str,
    *,
    invoice_number: str = "INV-20260601",
    total_cents: int | None = None,
    xero_invoice_id: str | None = None,
) -> InvoiceDraft:
    charge_rule_id = _create_charge_rule_fixture(
        client,
        entity_id,
        charge_type="base_rent",
        xero_account_code="200",
        xero_tax_type="OUTPUT",
    )
    charge_rule = session.get(RentChargeRule, UUID(charge_rule_id))
    assert charge_rule is not None
    tenant = charge_rule.lease.tenant
    tenant.tenant_metadata = {"xero_contact_id": "xero-contact-bright"}
    invoice_total_cents = total_cents or charge_rule.amount_cents
    document = StoredDocument(
        entity_id=UUID(entity_id),
        property_id=charge_rule.lease.tenancy_unit.property_id,
        tenancy_unit_id=charge_rule.lease.tenancy_unit_id,
        tenant_id=tenant.id,
        lease_id=charge_rule.lease_id,
        filename=f"{invoice_number}.pdf",
        content_type="application/pdf",
        byte_size=7,
        file_data=b"invoice",
        category=DocumentCategory.invoice,
    )
    session.add(document)
    session.flush()
    billing_draft = BillingDraft(
        entity_id=UUID(entity_id),
        property_id=charge_rule.lease.tenancy_unit.property_id,
        tenancy_unit_id=charge_rule.lease.tenancy_unit_id,
        tenant_id=tenant.id,
        lease_id=charge_rule.lease_id,
        document_id=document.id,
        status=BillingDraftStatus.approved,
        title="June base rent",
        currency="AUD",
        issue_date=charge_rule.next_due_date,
        due_date=charge_rule.next_due_date,
        total_cents=invoice_total_cents,
        billing_metadata={"source": "test"},
    )
    session.add(billing_draft)
    session.flush()
    billing_line = BillingDraftLine(
        billing_draft_id=billing_draft.id,
        description="Base rent",
        amount_cents=invoice_total_cents,
        currency="AUD",
        source_hint="Rent schedule",
        confidence=0.98,
        line_metadata={"source": "test", "charge_rule_id": charge_rule_id},
    )
    session.add(billing_line)
    session.flush()
    metadata = {
        "posting_preparation": {
            "approved": True,
            "xero_sync_allowed": False,
            "xero_synced": False,
            "external_posting_status": "not_started",
        },
        "payment_status": {
            "status": "unpaid",
            "paid_cents": 0,
            "outstanding_cents": invoice_total_cents,
            "source": "test",
        },
    }
    if xero_invoice_id:
        metadata["xero_sync"] = {
            "xero_synced": True,
            "external_posting_status": "draft_created",
            "xero_invoice_id": xero_invoice_id,
            "xero_status": "DRAFT",
            "idempotency_key": f"xero-draft-{invoice_number}",
        }
    invoice_draft = InvoiceDraft(
        entity_id=UUID(entity_id),
        billing_draft_id=billing_draft.id,
        property_id=billing_draft.property_id,
        tenancy_unit_id=billing_draft.tenancy_unit_id,
        tenant_id=tenant.id,
        lease_id=charge_rule.lease_id,
        document_id=document.id,
        status=InvoiceDraftStatus.approved,
        invoice_number=invoice_number,
        title="June base rent",
        currency="AUD",
        issue_date=charge_rule.next_due_date,
        due_date=charge_rule.next_due_date,
        subtotal_cents=invoice_total_cents,
        gst_cents=0,
        total_cents=invoice_total_cents,
        issuer_name="SKJ Property Pty Ltd",
        recipient_name=tenant.legal_name,
        recipient_email=tenant.billing_email or tenant.contact_email,
        invoice_metadata=metadata,
    )
    session.add(invoice_draft)
    session.flush()
    session.add(
        InvoiceDraftLine(
            invoice_draft_id=invoice_draft.id,
            billing_draft_line_id=billing_line.id,
            description="Base rent",
            amount_cents=invoice_total_cents,
            gst_cents=0,
            currency="AUD",
            source_hint="Rent schedule",
            line_metadata={"source": "test", "charge_rule_id": charge_rule_id},
        )
    )
    session.commit()
    return invoice_draft


def _fake_xero_invoice_dependencies(
    monkeypatch,
    create_calls: list[dict[str, object]],
    operation_events: list[str] | None = None,
) -> None:
    def fake_refresh_xero_tokens(
        refresh_token: str,
        settings: Settings,  # noqa: ARG001
    ) -> dict[str, object]:
        assert refresh_token in {"raw-refresh-token", "raw-refresh-token-created"}
        return {
            "access_token": "raw-access-token-create",
            "refresh_token": "raw-refresh-token-created",
            "expires_in": 1800,
            "scope": "offline_access accounting.contacts.read accounting.settings.read",
        }

    def fake_fetch_xero_contacts(
        access_token: str,
        xero_tenant_id: str,
        settings: Settings,  # noqa: ARG001
    ) -> list[dict[str, object]]:
        assert access_token == "raw-access-token-create"
        assert xero_tenant_id == "tenant-provider-123"
        return [
            {
                "ContactID": "xero-contact-bright",
                "Name": "Base Rent Tenant Pty Ltd",
                "ContactStatus": "ACTIVE",
            }
        ]

    def fake_fetch_xero_accounts(
        access_token: str,
        xero_tenant_id: str,
        settings: Settings,  # noqa: ARG001
    ) -> list[dict[str, object]]:
        assert access_token == "raw-access-token-create"
        assert xero_tenant_id == "tenant-provider-123"
        return [{"Code": "200", "Name": "Rental Income", "Status": "ACTIVE"}]

    def fake_fetch_xero_tax_rates(
        access_token: str,
        xero_tenant_id: str,
        settings: Settings,  # noqa: ARG001
    ) -> list[dict[str, object]]:
        assert access_token == "raw-access-token-create"
        assert xero_tenant_id == "tenant-provider-123"
        return [{"TaxType": "OUTPUT", "Name": "GST on Income", "Status": "ACTIVE"}]

    def fake_create_xero_invoice_draft(
        access_token: str,
        xero_tenant_id: str,
        invoice_payload: dict[str, object],
        settings: Settings,  # noqa: ARG001
        *,
        idempotency_key: str,
    ) -> dict[str, object]:
        assert access_token == "raw-access-token-create"
        assert xero_tenant_id == "tenant-provider-123"
        if operation_events is not None:
            operation_events.append("xero")
        create_calls.append(
            {"payload": invoice_payload, "idempotency_key": idempotency_key}
        )
        return {
            "InvoiceID": "xero-invoice-created-1",
            "InvoiceNumber": invoice_payload["InvoiceNumber"],
            "Status": "DRAFT",
        }

    monkeypatch.setattr(xero_router, "refresh_xero_tokens", fake_refresh_xero_tokens)
    monkeypatch.setattr(xero_router, "fetch_xero_contacts", fake_fetch_xero_contacts)
    monkeypatch.setattr(xero_router, "fetch_xero_accounts", fake_fetch_xero_accounts)
    monkeypatch.setattr(xero_router, "fetch_xero_tax_rates", fake_fetch_xero_tax_rates)
    monkeypatch.setattr(xero_router, "create_xero_invoice_draft", fake_create_xero_invoice_draft)


def test_xero_status_surfaces_mapping_gaps_and_manual_connection(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    property_response = client.post(
        "/api/v1/properties",
        json={
            "entity_id": entity_id,
            "name": "Queen Street Retail",
            "street_address": "100 Queen Street",
            "suburb": "Brisbane City",
            "state": "QLD",
            "postcode": "4000",
            "property_type": "commercial_retail",
            "ownership_structure": "trust",
            "owner_legal_name": "Queen Street Property Trust",
            "owner_abn": "11 222 333 444",
            "trustee_name": "Queen Street Trustee Pty Ltd",
        },
    )
    assert property_response.status_code == 201
    property_id = property_response.json()["id"]

    unit_response = client.post(
        "/api/v1/tenancy-units",
        json={"property_id": property_id, "unit_label": "Shop 1"},
    )
    assert unit_response.status_code == 201
    unit_id = unit_response.json()["id"]

    tenant_response = client.post(
        "/api/v1/tenants",
        json={"entity_id": entity_id, "legal_name": "No Email Retail Pty Ltd"},
    )
    assert tenant_response.status_code == 201
    tenant_id = tenant_response.json()["id"]

    lease_response = client.post(
        "/api/v1/leases",
        json={
            "tenancy_unit_id": unit_id,
            "tenant_id": tenant_id,
            "status": "active",
            "commencement_date": "2026-01-01",
            "expiry_date": "2028-12-31",
            "annual_rent_cents": 1200000,
            "rent_frequency": "monthly",
        },
    )
    assert lease_response.status_code == 201
    lease_id = lease_response.json()["id"]

    charge_response = client.post(
        "/api/v1/charge-rules",
        json={
            "lease_id": lease_id,
            "charge_type": "base_rent",
            "amount_cents": 100000,
            "frequency": "monthly",
            "gst_treatment": "taxable",
            "next_due_date": "2026-06-01",
        },
    )
    assert charge_response.status_code == 201
    charge_rule_id = charge_response.json()["id"]

    status_response = client.get(f"/api/v1/xero/status?entity_id={entity_id}")
    assert status_response.status_code == 200
    body = status_response.json()
    assert body["connection"]["connected"] is False
    assert body["contact_mapping"] == {"total": 2, "ready": 0, "missing": 2}
    assert body["chart_mapping"] == {"total": 1, "ready": 0, "missing": 1}
    assert body["tax_mapping"] == {"total": 1, "ready": 0, "missing": 1}
    assert body["accounting_freshness"]["source"] == "local_metadata"
    assert body["accounting_freshness"]["status"] == "attention"
    assert body["accounting_freshness"]["stale_reconciliation"] is False
    assert body["accounting_freshness"]["readiness_issue_count"] == len(body["issues"])
    assert body["accounting_freshness"]["readiness_warning_count"] >= 0
    assert (
        body["accounting_freshness"]["readiness_blocker_count"]
        <= body["accounting_freshness"]["readiness_issue_count"]
    )
    assert (
        body["accounting_freshness"]["readiness_warning_count"]
        <= body["accounting_freshness"]["readiness_issue_count"]
    )
    assert body["accounting_freshness"]["approved_unsynced_invoice_count"] == 0
    issue_ids = {issue["id"] for issue in body["issues"]}
    assert f"connection-{entity_id}" in issue_ids
    assert f"chart-{charge_rule_id}" in issue_ids
    assert f"tax-{charge_rule_id}" in issue_ids
    chart_issue = next(
        issue for issue in body["issues"] if issue["id"] == f"chart-{charge_rule_id}"
    )
    assert chart_issue["suggested_account_code"] == "200"
    assert chart_issue["suggested_tax_type"] == "OUTPUT"

    blocked_connection = client.patch(
        f"/api/v1/xero/connection/{entity_id}",
        json={"connected": True},
    )
    assert blocked_connection.status_code == 422

    blocked_sync_stamp = client.patch(
        f"/api/v1/xero/connection/{entity_id}",
        json={
            "connected": True,
            "xero_tenant_id": "tenant-demo-123",
            "last_sync_at": "2026-05-19T10:00:00Z",
        },
    )
    assert blocked_sync_stamp.status_code == 422

    connection_response = client.patch(
        f"/api/v1/xero/connection/{entity_id}",
        json={"connected": True, "xero_tenant_id": "tenant-demo-123"},
    )
    assert connection_response.status_code == 200
    assert connection_response.json()["connected"] is True
    assert connection_response.json()["xero_tenant_id"] == "tenant-demo-123"

    update_rule_response = client.patch(
        f"/api/v1/charge-rules/{charge_rule_id}",
        json={"xero_account_code": "200", "xero_tax_type": "OUTPUT"},
    )
    assert update_rule_response.status_code == 200

    ready_status_response = client.get(f"/api/v1/xero/status?entity_id={entity_id}")
    assert ready_status_response.status_code == 200
    ready_body = ready_status_response.json()
    assert ready_body["connection"]["connected"] is True
    assert ready_body["chart_mapping"] == {"total": 1, "ready": 1, "missing": 0}
    assert ready_body["tax_mapping"] == {"total": 1, "ready": 1, "missing": 0}
    assert ready_body["accounting_freshness"]["status"] == "attention"
    assert ready_body["accounting_freshness"]["readiness_issue_count"] == len(
        ready_body["issues"]
    )
    assert ready_body["accounting_freshness"]["readiness_blocker_count"] >= 0
    assert ready_body["accounting_freshness"]["readiness_warning_count"] >= 0
    assert ready_body["accounting_freshness"]["approved_unsynced_invoice_count"] == 0
    assert f"connection-{entity_id}" not in {issue["id"] for issue in ready_body["issues"]}

    audit = session.scalar(
        select(AuditAction).where(
            AuditAction.target_table == "entity",
            AuditAction.target_id == UUID(entity_id),
            AuditAction.tool_name == "xero.connection_status",
        )
    )
    assert audit is not None
    assert audit.tool_output_summary == "Recorded Xero connection status; no sync was run."


def test_xero_connection_diagnostics_configured_without_connection_is_read_only(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    settings = _provider_settings()
    _override_settings(settings)
    entity_id = _entity_id(session)

    def fail_provider_call(*args, **kwargs):
        raise AssertionError("connection diagnostics must not call Xero or refresh tokens")

    monkeypatch.setattr(xero_router, "refresh_xero_tokens", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_connections", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_contacts", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_accounts", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_tax_rates", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_invoices", fail_provider_call)
    monkeypatch.setattr(xero_router, "create_xero_invoice_draft", fail_provider_call)

    audit_count_before = len(
        session.scalars(select(AuditAction).where(AuditAction.tool_name.like("xero.%"))).all()
    )

    response = client.get(f"/api/v1/xero/connection-diagnostics?entity_id={entity_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["provider_configured"] is True
    assert body["missing_config"] == []
    assert body["redirect_uri"] == "https://api.leasium.test/api/v1/xero/oauth/callback"
    assert "offline_access" in body["scopes"]
    assert body["connected"] is False
    assert body["connection_source"] == "none"
    assert body["xero_tenant_id"] is None
    assert body["tenant_name"] is None
    assert body["token_expires_at"] is None
    assert body["can_start_oauth"] is True
    assert body["can_preview_contacts"] is False
    assert body["can_validate_chart_tax"] is False
    assert body["can_preview_invoice_posting"] is False
    assert body["can_create_xero_drafts"] is False
    assert body["can_preview_payment_reconciliation"] is False
    assert any("Connect Xero through OAuth" in step for step in body["next_steps"])
    assert any("does not refresh tokens" in guardrail for guardrail in body["guardrails"])

    audit_count_after = len(
        session.scalars(select(AuditAction).where(AuditAction.tool_name.like("xero.%"))).all()
    )
    assert audit_count_after == audit_count_before


def test_xero_connection_diagnostics_partial_scopes_unlock_contacts_only(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    settings = _provider_settings()
    _override_settings(settings)
    _fake_xero_provider(monkeypatch)
    entity_id = _entity_id(session)
    state = _start_xero_oauth(client, entity_id)
    _finish_xero_oauth(client, state)

    connection = session.scalar(
        select(XeroConnection).where(XeroConnection.entity_id == UUID(entity_id))
    )
    assert connection is not None
    original_access_token = connection.access_token_ciphertext
    original_refresh_token = connection.refresh_token_ciphertext
    original_metadata = dict(connection.connection_metadata or {})

    def fail_provider_call(*args, **kwargs):
        raise AssertionError("connection diagnostics must not call Xero or refresh tokens")

    monkeypatch.setattr(xero_router, "refresh_xero_tokens", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_connections", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_contacts", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_accounts", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_tax_rates", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_invoices", fail_provider_call)
    monkeypatch.setattr(xero_router, "create_xero_invoice_draft", fail_provider_call)

    response = client.get(f"/api/v1/xero/connection-diagnostics?entity_id={entity_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["provider_configured"] is True
    assert body["connected"] is True
    assert body["connection_source"] == "provider"
    assert body["xero_tenant_id"] == "tenant-provider-123"
    assert body["tenant_name"] == "SKJ Xero Demo"
    assert body["token_expires_at"] is not None
    assert body["can_start_oauth"] is True
    assert body["can_preview_contacts"] is True
    assert body["can_validate_chart_tax"] is False
    assert body["can_preview_invoice_posting"] is False
    assert body["can_create_xero_drafts"] is False
    assert body["can_preview_payment_reconciliation"] is False
    assert any("Preview Xero contacts" in step for step in body["next_steps"])
    assert any("No Xero API calls" in guardrail for guardrail in body["guardrails"])

    session.refresh(connection)
    assert connection.access_token_ciphertext == original_access_token
    assert connection.refresh_token_ciphertext == original_refresh_token
    assert connection.connection_metadata == original_metadata


def test_xero_connection_diagnostics_transactions_scope_does_not_unlock_invoice_actions(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    settings = _provider_settings()
    _override_settings(settings)
    _fake_xero_provider(
        monkeypatch,
        scopes="offline_access accounting.transactions",
    )
    entity_id = _entity_id(session)
    state = _start_xero_oauth(client, entity_id)
    _finish_xero_oauth(client, state)

    def fail_provider_call(*args, **kwargs):
        raise AssertionError("connection diagnostics must not call Xero or refresh tokens")

    monkeypatch.setattr(xero_router, "refresh_xero_tokens", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_connections", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_contacts", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_accounts", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_tax_rates", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_invoices", fail_provider_call)
    monkeypatch.setattr(xero_router, "create_xero_invoice_draft", fail_provider_call)

    response = client.get(f"/api/v1/xero/connection-diagnostics?entity_id={entity_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["can_preview_contacts"] is False
    assert body["can_validate_chart_tax"] is False
    assert body["can_preview_invoice_posting"] is False
    assert body["can_create_xero_drafts"] is False
    assert body["can_preview_payment_reconciliation"] is True


def test_xero_connection_diagnostics_read_only_transaction_scope_unlocks_payment_preview(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    settings = _provider_settings()
    _override_settings(settings)
    _fake_xero_provider(
        monkeypatch,
        scopes="offline_access accounting.transactions.read",
    )
    entity_id = _entity_id(session)
    state = _start_xero_oauth(client, entity_id)
    _finish_xero_oauth(client, state)

    def fail_provider_call(*args, **kwargs):
        raise AssertionError("connection diagnostics must not call Xero or refresh tokens")

    monkeypatch.setattr(xero_router, "refresh_xero_tokens", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_connections", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_contacts", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_accounts", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_tax_rates", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_invoices", fail_provider_call)
    monkeypatch.setattr(xero_router, "create_xero_invoice_draft", fail_provider_call)

    response = client.get(f"/api/v1/xero/connection-diagnostics?entity_id={entity_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["can_preview_contacts"] is False
    assert body["can_validate_chart_tax"] is False
    assert body["can_preview_invoice_posting"] is False
    assert body["can_create_xero_drafts"] is False
    assert body["can_preview_payment_reconciliation"] is True


def test_xero_connection_diagnostics_preview_scopes_do_not_unlock_draft_creation(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    settings = _provider_settings()
    _override_settings(settings)
    _fake_xero_provider(
        monkeypatch,
        scopes="offline_access accounting.contacts.read accounting.settings.read",
    )
    entity_id = _entity_id(session)
    state = _start_xero_oauth(client, entity_id)
    _finish_xero_oauth(client, state)

    def fail_provider_call(*args, **kwargs):
        raise AssertionError("connection diagnostics must not call Xero or refresh tokens")

    monkeypatch.setattr(xero_router, "refresh_xero_tokens", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_connections", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_contacts", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_accounts", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_tax_rates", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_invoices", fail_provider_call)
    monkeypatch.setattr(xero_router, "create_xero_invoice_draft", fail_provider_call)

    response = client.get(f"/api/v1/xero/connection-diagnostics?entity_id={entity_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["can_preview_contacts"] is True
    assert body["can_validate_chart_tax"] is True
    assert body["can_preview_invoice_posting"] is True
    assert body["can_create_xero_drafts"] is False
    assert body["can_preview_payment_reconciliation"] is False


def test_xero_connection_diagnostics_full_scopes_unlock_provider_actions(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    settings = _provider_settings()
    _override_settings(settings)
    _fake_xero_provider(
        monkeypatch,
        scopes=(
            "offline_access accounting.contacts.read "
            "accounting.settings.read accounting.transactions"
        ),
    )
    entity_id = _entity_id(session)
    state = _start_xero_oauth(client, entity_id)
    _finish_xero_oauth(client, state)

    def fail_provider_call(*args, **kwargs):
        raise AssertionError("connection diagnostics must not call Xero or refresh tokens")

    monkeypatch.setattr(xero_router, "refresh_xero_tokens", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_connections", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_contacts", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_accounts", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_tax_rates", fail_provider_call)
    monkeypatch.setattr(xero_router, "fetch_xero_invoices", fail_provider_call)
    monkeypatch.setattr(xero_router, "create_xero_invoice_draft", fail_provider_call)

    response = client.get(f"/api/v1/xero/connection-diagnostics?entity_id={entity_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["can_start_oauth"] is True
    assert body["can_preview_contacts"] is True
    assert body["can_validate_chart_tax"] is True
    assert body["can_preview_invoice_posting"] is True
    assert body["can_create_xero_drafts"] is True
    assert body["can_preview_payment_reconciliation"] is True


def test_xero_connection_diagnostics_viewer_cannot_use_provider_actions(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    settings = _provider_settings()
    _override_settings(settings)
    _fake_xero_provider(
        monkeypatch,
        scopes=(
            "offline_access accounting.contacts.read "
            "accounting.settings.read accounting.transactions"
        ),
    )
    entity_id = _entity_id(session)
    state = _start_xero_oauth(client, entity_id)
    _finish_xero_oauth(client, state)
    role = session.get(UserEntityRole, (settings.dev_user_id, UUID(entity_id)))
    assert role is not None
    role.role = UserRole.viewer
    session.commit()

    response = client.get(f"/api/v1/xero/connection-diagnostics?entity_id={entity_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["connected"] is True
    assert body["connection_source"] == "provider"
    assert body["can_start_oauth"] is False
    assert body["can_preview_contacts"] is False
    assert body["can_validate_chart_tax"] is False
    assert body["can_preview_invoice_posting"] is False
    assert body["can_create_xero_drafts"] is False
    assert body["can_preview_payment_reconciliation"] is False


def test_xero_oauth_callback_records_provider_connection(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    settings = _provider_settings()
    _override_settings(settings)
    _fake_xero_provider(monkeypatch)
    entity_id = _entity_id(session)

    state = _start_xero_oauth(client, entity_id)
    _finish_xero_oauth(client, state)

    entity = session.get(Entity, UUID(entity_id))
    assert entity is not None
    assert entity.xero_tenant_id == "tenant-provider-123"
    assert entity.xero_connected_at is not None
    connection = session.scalar(
        select(XeroConnection).where(XeroConnection.entity_id == UUID(entity_id))
    )
    assert connection is not None
    assert connection.tenant_name == "SKJ Xero Demo"
    assert connection.access_token_ciphertext != "raw-access-token"
    assert connection.refresh_token_ciphertext != "raw-refresh-token"
    assert decrypt_xero_token(connection.refresh_token_ciphertext, settings) == "raw-refresh-token"

    status_response = client.get(f"/api/v1/xero/status?entity_id={entity_id}")
    assert status_response.status_code == 200
    status_body = status_response.json()
    assert status_body["provider"]["configured"] is True
    assert status_body["connection"]["connection_source"] == "provider"
    assert status_body["connection"]["tenant_name"] == "SKJ Xero Demo"

    audit = session.scalar(
        select(AuditAction).where(
            AuditAction.target_table == "xero_connection",
            AuditAction.tool_name == "xero.oauth_callback",
        )
    )
    assert audit is not None
    assert "no contacts, invoices, or payments were mutated" in audit.tool_output_summary


def test_xero_status_flags_stale_payment_reconciliation_from_local_metadata(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    settings = _provider_settings()
    _override_settings(settings)
    _fake_xero_provider(monkeypatch)
    entity_id = _entity_id(session)
    state = _start_xero_oauth(client, entity_id)
    _finish_xero_oauth(client, state)
    _create_approved_invoice_fixture(
        client,
        session,
        entity_id,
        invoice_number="INV-XERO-OPEN",
        xero_invoice_id="xero-invoice-open",
    )
    connection = session.scalar(
        select(XeroConnection).where(XeroConnection.entity_id == UUID(entity_id))
    )
    assert connection is not None
    connection.connection_metadata = {
        **dict(connection.connection_metadata or {}),
        "last_contact_sync": {
            "synced_at": "2026-05-10T00:00:00+00:00",
            "mode": "preview_only",
        },
        "last_chart_tax_validation": {
            "validated_at": "2026-05-10T00:10:00+00:00",
            "mode": "preview_only",
        },
        "last_payment_reconciliation_preview": {
            "reconciled_at": "2000-01-01T00:00:00+00:00",
            "source": "provider",
            "mode": "preview_only",
        },
    }
    session.commit()

    response = client.get(f"/api/v1/xero/status?entity_id={entity_id}")
    assert response.status_code == 200
    freshness = response.json()["accounting_freshness"]
    assert freshness["status"] == "stale"
    assert freshness["stale_reconciliation"] is True
    assert freshness["xero_linked_open_invoice_count"] == 1
    assert freshness["last_contact_sync_at"] == "2026-05-10T00:00:00Z"
    assert freshness["last_chart_tax_validation_at"] == "2026-05-10T00:10:00Z"
    assert freshness["last_payment_reconciliation_source"] == "provider"
    assert freshness["last_payment_reconciliation_mode"] == "preview_only"
    assert freshness["readiness_issue_count"] >= 0
    assert freshness["readiness_blocker_count"] >= 0
    assert freshness["readiness_warning_count"] >= 0
    assert (
        freshness["readiness_issue_count"]
        >= freshness["readiness_blocker_count"] + freshness["readiness_warning_count"]
    )
    assert freshness["approved_unsynced_invoice_count"] == 0
    assert "local Leasium metadata only" in freshness["guardrails"][0]
    # Default stale window is 7 days. With a recent reconciliation it should
    # be reflected, and the field is operator-configurable through settings.
    assert freshness["stale_after_days"] == 7


def test_xero_reconciliation_stale_window_is_configurable_via_settings(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """A custom xero_reconciliation_stale_after_days setting flows into status.

    The same metadata that is "stale" with the default 7-day window should not
    be flagged stale when the operator widens the window to 365 days. The API
    surfaces the configured value as ``stale_after_days``.
    """
    settings = _provider_settings()
    settings.xero_reconciliation_stale_after_days = 365
    _override_settings(settings)
    _fake_xero_provider(monkeypatch)
    entity_id = _entity_id(session)
    state = _start_xero_oauth(client, entity_id)
    _finish_xero_oauth(client, state)
    _create_approved_invoice_fixture(
        client,
        session,
        entity_id,
        invoice_number="INV-XERO-FRESH",
        xero_invoice_id="xero-invoice-fresh",
    )
    connection = session.scalar(
        select(XeroConnection).where(XeroConnection.entity_id == UUID(entity_id))
    )
    assert connection is not None
    # 180 days ago: stale under the 7-day default, fresh under a 365-day window.
    cutoff = utcnow() - timedelta(days=180)
    connection.connection_metadata = {
        **dict(connection.connection_metadata or {}),
        "last_payment_reconciliation_preview": {
            "reconciled_at": cutoff.isoformat(),
            "source": "provider",
            "mode": "preview_only",
        },
    }
    session.commit()

    response = client.get(f"/api/v1/xero/status?entity_id={entity_id}")
    assert response.status_code == 200
    freshness = response.json()["accounting_freshness"]
    assert freshness["stale_after_days"] == 365
    # Under the wider window the same reconciliation is no longer stale.
    assert freshness["stale_reconciliation"] is False
    assert freshness["status"] in {"ready", "attention"}


def test_xero_contact_sync_preview_suggests_matches_without_applying(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    settings = _provider_settings()
    _override_settings(settings)
    _fake_xero_provider(monkeypatch)
    entity_id = _entity_id(session)
    tenant = Tenant(
        entity_id=UUID(entity_id),
        legal_name="Bright Cafe Pty Ltd",
        billing_email="accounts@bright.example",
    )
    session.add(tenant)
    session.commit()

    state = _start_xero_oauth(client, entity_id)
    _finish_xero_oauth(client, state)

    def fake_refresh_xero_tokens(
        refresh_token: str,
        settings: Settings,  # noqa: ARG001
    ) -> dict[str, object]:
        assert refresh_token in {"raw-refresh-token", "raw-refresh-token-created"}
        return {
            "access_token": "raw-access-token-2",
            "refresh_token": "raw-refresh-token-2",
            "expires_in": 1800,
            "scope": "offline_access accounting.contacts.read",
        }

    def fake_fetch_xero_contacts(
        access_token: str,
        xero_tenant_id: str,
        settings: Settings,  # noqa: ARG001
    ) -> list[dict[str, object]]:
        assert access_token == "raw-access-token-2"
        assert xero_tenant_id == "tenant-provider-123"
        return [
            {
                "ContactID": "xero-contact-bright",
                "Name": "Bright Cafe Pty Ltd",
                "EmailAddress": "accounts@bright.example",
            }
        ]

    monkeypatch.setattr(xero_router, "refresh_xero_tokens", fake_refresh_xero_tokens)
    monkeypatch.setattr(xero_router, "fetch_xero_contacts", fake_fetch_xero_contacts)

    response = client.post(f"/api/v1/xero/contacts/sync-preview/{entity_id}")
    assert response.status_code == 200
    body = response.json()
    assert body["fetched_contacts"] == 1
    assert body["suggested_matches"][0]["target_type"] == "tenant"
    assert body["suggested_matches"][0]["target_id"] == str(tenant.id)
    assert body["suggested_matches"][0]["xero_contact_id"] == "xero-contact-bright"
    assert body["suggested_matches"][0]["confidence"] == 0.94

    session.refresh(tenant)
    assert "xero_contact_id" not in tenant.tenant_metadata
    connection = session.scalar(
        select(XeroConnection).where(XeroConnection.entity_id == UUID(entity_id))
    )
    assert connection is not None
    assert connection.last_contact_sync_at is not None
    assert connection.connection_metadata["last_contact_sync"]["mode"] == "preview_only"
    assert decrypt_xero_token(connection.refresh_token_ciphertext, settings) == (
        "raw-refresh-token-2"
    )


def test_xero_contact_mapping_apply_updates_reviewed_local_records(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    settings = _provider_settings()
    _override_settings(settings)
    _fake_xero_provider(monkeypatch)
    entity_id = _entity_id(session)
    tenant = Tenant(entity_id=UUID(entity_id), legal_name="Bright Cafe Pty Ltd")
    prop = Property(
        entity_id=UUID(entity_id),
        name="Queen Street Retail",
        street_address="100 Queen Street",
        property_type=PropertyType.commercial_retail,
        ownership_structure="trust",
        billing_email="owner@queen.example",
    )
    session.add_all([tenant, prop])
    session.commit()

    state = _start_xero_oauth(client, entity_id)
    _finish_xero_oauth(client, state)

    response = client.post(
        f"/api/v1/xero/contacts/apply-preview/{entity_id}",
        json={
            "mappings": [
                {
                    "target_type": "tenant",
                    "target_id": str(tenant.id),
                    "xero_contact_id": "xero-contact-bright",
                    "xero_contact_name": "Bright Cafe Pty Ltd",
                    "xero_email": "accounts@bright.example",
                    "match_reason": "billing/contact email matched",
                    "confidence": 0.94,
                },
                {
                    "target_type": "property",
                    "target_id": str(prop.id),
                    "xero_contact_id": "xero-owner-queen",
                    "xero_contact_name": "Queen Street Property Trust",
                    "xero_email": "owner@queen.example",
                    "match_reason": "billing email matched",
                    "confidence": 0.94,
                },
            ],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["applied_mappings"]) == 2
    assert body["skipped_mappings"] == []
    assert "No Xero contacts" in body["guardrails"][1]

    session.refresh(tenant)
    session.refresh(prop)
    assert tenant.tenant_metadata["xero_contact_id"] == "xero-contact-bright"
    assert tenant.tenant_metadata["xero_contact_mapping"]["source"] == "xero_contact_preview"
    assert prop.xero_contact_id == "xero-owner-queen"
    assert prop.property_metadata["xero_contact_mapping"]["xero_contact_id"] == "xero-owner-queen"

    connection = session.scalar(
        select(XeroConnection).where(XeroConnection.entity_id == UUID(entity_id))
    )
    assert connection is not None
    assert connection.connection_metadata["last_contact_apply"]["applied_mappings"] == 2
    assert connection.connection_metadata["last_contact_apply"]["mode"] == "local_mapping_apply"
    entity = session.get(Entity, UUID(entity_id))
    assert entity is not None
    assert entity.xero_last_sync_at is not None

    status_response = client.get(f"/api/v1/xero/status?entity_id={entity_id}")
    assert status_response.status_code == 200
    issue_ids = {issue["id"] for issue in status_response.json()["issues"]}
    assert f"tenant-contact-{tenant.id}" not in issue_ids
    assert f"property-contact-{prop.id}" not in issue_ids

    audit = session.scalar(
        select(AuditAction).where(
            AuditAction.target_table == "xero_connection",
            AuditAction.tool_name == "xero.contact_mapping_apply",
        )
    )
    assert audit is not None
    assert "no Xero contacts, invoices, or payments were mutated" in audit.tool_output_summary


def test_xero_contact_mapping_apply_skips_conflicting_existing_mapping(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    settings = _provider_settings()
    _override_settings(settings)
    _fake_xero_provider(monkeypatch)
    entity_id = _entity_id(session)
    tenant = Tenant(
        entity_id=UUID(entity_id),
        legal_name="Bright Cafe Pty Ltd",
        tenant_metadata={"xero_contact_id": "existing-contact"},
    )
    session.add(tenant)
    session.commit()

    state = _start_xero_oauth(client, entity_id)
    _finish_xero_oauth(client, state)

    response = client.post(
        f"/api/v1/xero/contacts/apply-preview/{entity_id}",
        json={
            "mappings": [
                {
                    "target_type": "tenant",
                    "target_id": str(tenant.id),
                    "xero_contact_id": "different-contact",
                    "xero_contact_name": "Different Contact",
                }
            ],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["applied_mappings"] == []
    assert body["skipped_mappings"][0]["previous_xero_contact_id"] == "existing-contact"
    assert "different Xero contact" in body["skipped_mappings"][0]["reason"]

    session.refresh(tenant)
    assert tenant.tenant_metadata["xero_contact_id"] == "existing-contact"


def test_xero_contact_mapping_apply_requires_provider_connection(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)

    response = client.post(
        f"/api/v1/xero/contacts/apply-preview/{entity_id}",
        json={
            "mappings": [
                {
                    "target_type": "tenant",
                    "target_id": entity_id,
                    "xero_contact_id": "xero-contact-bright",
                    "xero_contact_name": "Bright Cafe Pty Ltd",
                }
            ],
        },
    )
    assert response.status_code == 422
    assert response.json()["detail"] == (
        "Connect Xero through OAuth before applying reviewed contact mappings."
    )


def test_xero_chart_tax_validation_preview_checks_provider_accounts_and_tax_rates(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    settings = _provider_settings()
    _override_settings(settings)
    _fake_xero_provider(monkeypatch)
    entity_id = _entity_id(session)
    ready_rule_id = _create_charge_rule_fixture(
        client,
        entity_id,
        charge_type="base_rent",
        xero_account_code="200",
        xero_tax_type="OUTPUT",
    )
    blocked_rule_id = _create_charge_rule_fixture(
        client,
        entity_id,
        charge_type="outgoings",
        xero_account_code="999",
        xero_tax_type="BADTAX",
    )

    state = _start_xero_oauth(client, entity_id)
    _finish_xero_oauth(client, state)

    def fake_refresh_xero_tokens(
        refresh_token: str,
        settings: Settings,  # noqa: ARG001
    ) -> dict[str, object]:
        assert refresh_token in {"raw-refresh-token", "raw-refresh-token-created"}
        return {
            "access_token": "raw-access-token-validation",
            "refresh_token": "raw-refresh-token-validation",
            "expires_in": 1800,
            "scope": "offline_access accounting.settings.read",
        }

    def fake_fetch_xero_accounts(
        access_token: str,
        xero_tenant_id: str,
        settings: Settings,  # noqa: ARG001
    ) -> list[dict[str, object]]:
        assert access_token == "raw-access-token-validation"
        assert xero_tenant_id == "tenant-provider-123"
        return [
            {"Code": "200", "Name": "Rental Income", "Status": "ACTIVE"},
            {"Code": "999", "Name": "Archived Income", "Status": "ARCHIVED"},
        ]

    def fake_fetch_xero_tax_rates(
        access_token: str,
        xero_tenant_id: str,
        settings: Settings,  # noqa: ARG001
    ) -> list[dict[str, object]]:
        assert access_token == "raw-access-token-validation"
        assert xero_tenant_id == "tenant-provider-123"
        return [{"TaxType": "OUTPUT", "Name": "GST on Income", "Status": "ACTIVE"}]

    monkeypatch.setattr(xero_router, "refresh_xero_tokens", fake_refresh_xero_tokens)
    monkeypatch.setattr(xero_router, "fetch_xero_accounts", fake_fetch_xero_accounts)
    monkeypatch.setattr(xero_router, "fetch_xero_tax_rates", fake_fetch_xero_tax_rates)

    response = client.post(f"/api/v1/xero/chart-tax/validate-preview/{entity_id}")
    assert response.status_code == 200
    body = response.json()
    assert body["fetched_accounts"] == 2
    assert body["fetched_tax_rates"] == 1
    assert body["checked_rules"] == 2
    assert "No invoice posting" in body["guardrails"][2]

    results_by_id = {result["charge_rule_id"]: result for result in body["results"]}
    ready_result = results_by_id[ready_rule_id]
    assert ready_result["status"] == "ready"
    assert ready_result["account_valid"] is True
    assert ready_result["tax_valid"] is True
    assert ready_result["account_name"] == "Rental Income"
    assert ready_result["tax_name"] == "GST on Income"

    blocked_result = results_by_id[blocked_rule_id]
    assert blocked_result["status"] == "not_found"
    assert blocked_result["account_valid"] is False
    assert blocked_result["tax_valid"] is False
    assert "not active" in blocked_result["blockers"][0]
    assert "BADTAX" in blocked_result["blockers"][1]
    assert blocked_result["suggested_account_code"] == "201"
    assert blocked_result["suggested_tax_type"] == "OUTPUT"

    connection = session.scalar(
        select(XeroConnection).where(XeroConnection.entity_id == UUID(entity_id))
    )
    assert connection is not None
    assert connection.connection_metadata["last_chart_tax_validation"]["checked_rules"] == 2
    assert connection.connection_metadata["last_chart_tax_validation"]["not_found"] == 1
    assert connection.connection_metadata["last_chart_tax_validation"]["mode"] == "preview_only"
    assert decrypt_xero_token(connection.refresh_token_ciphertext, settings) == (
        "raw-refresh-token-validation"
    )

    audit = session.scalar(
        select(AuditAction).where(
            AuditAction.target_table == "xero_connection",
            AuditAction.tool_name == "xero.chart_tax_validation_preview",
        )
    )
    assert audit is not None
    assert "no invoice posting" in audit.tool_output_summary


def test_xero_chart_tax_validation_preview_requires_provider_connection(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)

    response = client.post(f"/api/v1/xero/chart-tax/validate-preview/{entity_id}")
    assert response.status_code == 422
    assert response.json()["detail"] == (
        "Connect Xero through OAuth before validating chart and tax mappings."
    )


def test_xero_invoice_posting_preview_builds_payload_without_posting(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    settings = _provider_settings()
    _override_settings(settings)
    _fake_xero_provider(monkeypatch)
    entity_id = _entity_id(session)
    charge_rule_id = _create_charge_rule_fixture(
        client,
        entity_id,
        charge_type="base_rent",
        xero_account_code="200",
        xero_tax_type="OUTPUT",
    )
    charge_rule = session.get(RentChargeRule, UUID(charge_rule_id))
    assert charge_rule is not None
    tenant = charge_rule.lease.tenant
    tenant.tenant_metadata = {"xero_contact_id": "xero-contact-bright"}
    document = StoredDocument(
        entity_id=UUID(entity_id),
        property_id=charge_rule.lease.tenancy_unit.property_id,
        tenancy_unit_id=charge_rule.lease.tenancy_unit_id,
        tenant_id=tenant.id,
        lease_id=charge_rule.lease_id,
        filename="invoice.pdf",
        content_type="application/pdf",
        byte_size=7,
        file_data=b"invoice",
        category=DocumentCategory.invoice,
    )
    session.add(document)
    session.flush()
    billing_draft = BillingDraft(
        entity_id=UUID(entity_id),
        property_id=charge_rule.lease.tenancy_unit.property_id,
        tenancy_unit_id=charge_rule.lease.tenancy_unit_id,
        tenant_id=tenant.id,
        lease_id=charge_rule.lease_id,
        document_id=document.id,
        status=BillingDraftStatus.approved,
        title="June base rent",
        currency="AUD",
        issue_date=charge_rule.next_due_date,
        due_date=charge_rule.next_due_date,
        total_cents=charge_rule.amount_cents,
        billing_metadata={"source": "test"},
    )
    session.add(billing_draft)
    session.flush()
    billing_line = BillingDraftLine(
        billing_draft_id=billing_draft.id,
        description="Base rent",
        amount_cents=charge_rule.amount_cents,
        currency="AUD",
        source_hint="Rent schedule",
        confidence=0.98,
        line_metadata={"source": "test", "charge_rule_id": charge_rule_id},
    )
    session.add(billing_line)
    session.flush()
    invoice_draft = InvoiceDraft(
        entity_id=UUID(entity_id),
        billing_draft_id=billing_draft.id,
        property_id=billing_draft.property_id,
        tenancy_unit_id=billing_draft.tenancy_unit_id,
        tenant_id=tenant.id,
        lease_id=charge_rule.lease_id,
        document_id=document.id,
        status=InvoiceDraftStatus.approved,
        invoice_number="INV-20260601",
        title="June base rent",
        currency="AUD",
        issue_date=charge_rule.next_due_date,
        due_date=charge_rule.next_due_date,
        subtotal_cents=charge_rule.amount_cents,
        gst_cents=0,
        total_cents=charge_rule.amount_cents,
        issuer_name="SKJ Property Pty Ltd",
        recipient_name=tenant.legal_name,
        recipient_email=tenant.billing_email or tenant.contact_email,
        invoice_metadata={
            "posting_preparation": {
                "approved": True,
                "xero_sync_allowed": False,
                "xero_synced": False,
            }
        },
    )
    session.add(invoice_draft)
    session.flush()
    session.add(
        InvoiceDraftLine(
            invoice_draft_id=invoice_draft.id,
            billing_draft_line_id=billing_line.id,
            description="Base rent",
            amount_cents=charge_rule.amount_cents,
            gst_cents=0,
            currency="AUD",
            source_hint="Rent schedule",
            line_metadata={"source": "test", "charge_rule_id": charge_rule_id},
        )
    )
    session.commit()

    state = _start_xero_oauth(client, entity_id)
    _finish_xero_oauth(client, state)

    def fake_refresh_xero_tokens(
        refresh_token: str,
        settings: Settings,  # noqa: ARG001
    ) -> dict[str, object]:
        assert refresh_token == "raw-refresh-token"
        return {
            "access_token": "raw-access-token-invoice",
            "refresh_token": "raw-refresh-token-invoice",
            "expires_in": 1800,
            "scope": "offline_access accounting.contacts.read accounting.settings.read",
        }

    def fake_fetch_xero_contacts(
        access_token: str,
        xero_tenant_id: str,
        settings: Settings,  # noqa: ARG001
    ) -> list[dict[str, object]]:
        assert access_token == "raw-access-token-invoice"
        assert xero_tenant_id == "tenant-provider-123"
        return [
            {
                "ContactID": "xero-contact-bright",
                "Name": "Base Rent Tenant Pty Ltd",
                "ContactStatus": "ACTIVE",
            }
        ]

    def fake_fetch_xero_accounts(
        access_token: str,
        xero_tenant_id: str,
        settings: Settings,  # noqa: ARG001
    ) -> list[dict[str, object]]:
        assert access_token == "raw-access-token-invoice"
        assert xero_tenant_id == "tenant-provider-123"
        return [{"Code": "200", "Name": "Rental Income", "Status": "ACTIVE"}]

    def fake_fetch_xero_tax_rates(
        access_token: str,
        xero_tenant_id: str,
        settings: Settings,  # noqa: ARG001
    ) -> list[dict[str, object]]:
        assert access_token == "raw-access-token-invoice"
        assert xero_tenant_id == "tenant-provider-123"
        return [{"TaxType": "OUTPUT", "Name": "GST on Income", "Status": "ACTIVE"}]

    monkeypatch.setattr(xero_router, "refresh_xero_tokens", fake_refresh_xero_tokens)
    monkeypatch.setattr(xero_router, "fetch_xero_contacts", fake_fetch_xero_contacts)
    monkeypatch.setattr(xero_router, "fetch_xero_accounts", fake_fetch_xero_accounts)
    monkeypatch.setattr(xero_router, "fetch_xero_tax_rates", fake_fetch_xero_tax_rates)

    response = client.post(f"/api/v1/xero/invoices/posting-preview/{entity_id}")
    assert response.status_code == 200
    body = response.json()
    assert body["checked_invoices"] == 1
    assert body["ready_count"] == 1
    assert body["blocked_count"] == 0
    assert "No invoices are posted" in body["guardrails"][2]

    result = body["results"][0]
    assert result["status"] == "ready"
    assert result["invoice_number"] == "INV-20260601"
    assert result["xero_contact_id"] == "xero-contact-bright"
    assert result["line_items"][0]["account_code"] == "200"
    assert result["line_items"][0]["tax_type"] == "OUTPUT"
    assert result["payload_preview"]["Type"] == "ACCREC"
    assert result["payload_preview"]["Status"] == "DRAFT"
    assert result["payload_preview"]["Contact"]["ContactID"] == "xero-contact-bright"
    assert result["payload_preview"]["LineItems"][0]["AccountCode"] == "200"
    assert result["payload_preview"]["LineItems"][0]["TaxType"] == "OUTPUT"

    session.refresh(invoice_draft)
    assert invoice_draft.invoice_metadata["posting_preparation"]["xero_sync_allowed"] is False
    assert "xero_sync" not in invoice_draft.invoice_metadata
    connection = session.scalar(
        select(XeroConnection).where(XeroConnection.entity_id == UUID(entity_id))
    )
    assert connection is not None
    assert connection.connection_metadata["last_invoice_posting_preview"]["ready"] == 1
    assert connection.connection_metadata["last_invoice_posting_preview"]["mode"] == (
        "preview_only"
    )
    assert decrypt_xero_token(connection.refresh_token_ciphertext, settings) == (
        "raw-refresh-token-invoice"
    )

    audit = session.scalar(
        select(AuditAction).where(
            AuditAction.target_table == "xero_connection",
            AuditAction.tool_name == "xero.invoice_posting_preview",
        )
    )
    assert audit is not None
    assert "no invoice posting" in audit.tool_output_summary


def test_xero_invoice_posting_preview_requires_provider_connection(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)

    response = client.post(f"/api/v1/xero/invoices/posting-preview/{entity_id}")
    assert response.status_code == 422
    assert response.json()["detail"] == (
        "Connect Xero through OAuth before previewing invoice posting."
    )


def test_xero_invoice_posting_preview_blocks_connected_invoice_with_missing_mapping(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    settings = _provider_settings()
    _override_settings(settings)
    _fake_xero_provider(monkeypatch)
    entity_id = _entity_id(session)
    invoice_draft = _create_approved_invoice_fixture(client, session, entity_id)
    tenant = invoice_draft.tenant
    assert tenant is not None
    tenant.tenant_metadata = {}
    session.commit()

    state = _start_xero_oauth(client, entity_id)
    _finish_xero_oauth(client, state)

    create_calls: list[dict[str, object]] = []
    _fake_xero_invoice_dependencies(monkeypatch, create_calls)

    response = client.post(f"/api/v1/xero/invoices/posting-preview/{entity_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["checked_invoices"] == 1
    assert body["ready_count"] == 0
    assert body["blocked_count"] == 1
    assert body["results"][0]["status"] == "blocked"
    assert any("Xero contact" in blocker for blocker in body["results"][0]["blockers"])
    assert create_calls == []

    session.refresh(invoice_draft)
    assert "xero_sync" not in invoice_draft.invoice_metadata


def test_xero_invoice_draft_create_requires_explicit_posting_approval_before_write(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    settings = _provider_settings()
    _override_settings(settings)
    _fake_xero_provider(monkeypatch)
    entity_id = _entity_id(session)
    invoice_draft = _create_approved_invoice_fixture(client, session, entity_id)

    state = _start_xero_oauth(client, entity_id)
    _finish_xero_oauth(client, state)

    create_calls: list[dict[str, object]] = []
    _fake_xero_invoice_dependencies(monkeypatch, create_calls)

    response = client.post(
        f"/api/v1/xero/invoices/draft-create/{entity_id}",
        json={"invoice_draft_ids": [str(invoice_draft.id)]},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["created_count"] == 0
    assert body["blocked_count"] == 1
    assert "Explicit Xero posting approval" in body["results"][0]["reason"]
    assert create_calls == []

    session.refresh(invoice_draft)
    assert "xero_sync" not in invoice_draft.invoice_metadata


def test_xero_posting_approval_then_draft_create_is_idempotent(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    settings = _provider_settings()
    _override_settings(settings)
    _fake_xero_provider(monkeypatch)
    entity_id = _entity_id(session)
    invoice_draft = _create_approved_invoice_fixture(client, session, entity_id)

    approval_response = client.post(
        f"/api/v1/xero/invoices/{invoice_draft.id}/posting-approval",
        json={"approved": True, "idempotency_key": "overnight-build"},
    )
    assert approval_response.status_code == 200
    approval_body = approval_response.json()
    assert approval_body["status"] == "approved"
    assert approval_body["approval_state"] == "approved"
    assert approval_body["xero_sync_allowed"] is True
    assert "No Xero invoice is created" in approval_body["guardrails"][1]

    session.refresh(invoice_draft)
    assert invoice_draft.invoice_metadata["xero_posting_approval"]["state"] == "approved"
    assert invoice_draft.invoice_metadata["posting_preparation"]["xero_sync_allowed"] is True
    assert "xero_sync" not in invoice_draft.invoice_metadata

    state = _start_xero_oauth(client, entity_id)
    _finish_xero_oauth(client, state)

    create_calls: list[dict[str, object]] = []
    _fake_xero_invoice_dependencies(monkeypatch, create_calls)

    create_response = client.post(
        f"/api/v1/xero/invoices/draft-create/{entity_id}",
        json={"invoice_draft_ids": [str(invoice_draft.id)]},
    )
    assert create_response.status_code == 200
    create_body = create_response.json()
    assert create_body["created_count"] == 1
    assert create_body["results"][0]["status"] == "created"
    assert create_body["results"][0]["xero_invoice_id"] == "xero-invoice-created-1"
    assert len(create_calls) == 1
    assert create_calls[0]["idempotency_key"] == approval_body["idempotency_key"]
    assert create_calls[0]["payload"]["Status"] == "DRAFT"

    session.refresh(invoice_draft)
    assert invoice_draft.invoice_metadata["xero_sync"]["xero_synced"] is True
    assert invoice_draft.invoice_metadata["xero_sync"]["xero_invoice_id"] == (
        "xero-invoice-created-1"
    )
    assert invoice_draft.invoice_metadata["posting_preparation"]["xero_sync_allowed"] is False

    second_response = client.post(
        f"/api/v1/xero/invoices/draft-create/{entity_id}",
        json={"invoice_draft_ids": [str(invoice_draft.id)]},
    )
    assert second_response.status_code == 200
    second_body = second_response.json()
    assert second_body["created_count"] == 0
    assert second_body["skipped_count"] == 1
    assert second_body["results"][0]["reason"] == (
        "Invoice draft already has a Xero draft reference."
    )
    assert len(create_calls) == 1

    audit = session.scalar(
        select(AuditAction).where(
            AuditAction.target_table == "invoice_draft",
            AuditAction.tool_name == "xero.invoice_posting_approval",
        )
    )
    assert audit is not None
    assert "no Xero mutation" in audit.tool_output_summary


def test_xero_provider_dispatch_creates_xero_then_sends_email_idempotently(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    settings = _provider_settings()
    settings.invoice_email_template_key = "invoice_delivery_custom"
    settings.invoice_email_template_version = "v2"
    _override_settings(settings)
    _fake_xero_provider(monkeypatch)
    entity_id = _entity_id(session)
    invoice_draft = _create_approved_invoice_fixture(client, session, entity_id)
    invoice_draft.recipient_email = "accounts@base-rent.example"
    session.commit()

    prepare_response = client.post(
        f"/api/v1/invoice-drafts/{invoice_draft.id}/prepare-delivery"
    )
    assert prepare_response.status_code == 200
    prepare_metadata = prepare_response.json()["metadata"]
    assert prepare_metadata["delivery_state"]["delivery_ready"] is True
    delivery_draft = prepare_metadata["delivery_email"]["draft"]
    assert delivery_draft["template_key"] == "invoice_delivery_custom"
    assert delivery_draft["template_version"] == "v2"
    email_preview = prepare_metadata["delivery_preview"]["email"]
    assert email_preview["template_key"] == "invoice_delivery_custom"
    assert email_preview["template_version"] == "v2"
    rendered_preview = email_preview["rendered_message_preview"]
    assert rendered_preview["recipient"] == "accounts@base-rent.example"
    assert rendered_preview["template_key"] == "invoice_delivery_custom"
    assert rendered_preview["template_version"] == "v2"
    assert "Invoice" in rendered_preview["subject"]
    assert "Reference:" in rendered_preview["body_text"]
    assert str(invoice_draft.id) in rendered_preview["action_url"]

    approval_response = client.post(
        f"/api/v1/xero/invoices/{invoice_draft.id}/posting-approval",
        json={"approved": True, "idempotency_key": "provider-dispatch"},
    )
    assert approval_response.status_code == 200
    state = _start_xero_oauth(client, entity_id)
    _finish_xero_oauth(client, state)

    create_calls: list[dict[str, object]] = []
    email_calls: list[dict[str, object]] = []
    operation_events: list[str] = []
    _fake_xero_invoice_dependencies(monkeypatch, create_calls, operation_events)

    def fake_send_invoice_delivery_email(invite, settings: Settings) -> DeliveryResult:
        assert invite.recipient_email == "accounts@base-rent.example"
        assert invite.pdf_document_id is not None
        assert invite.pdf_content.startswith(b"%PDF")
        assert invite.template_key == "invoice_delivery_custom"
        assert invite.template_version == "v2"
        operation_events.append("email")
        email_calls.append(
            {
                "recipient": invite.recipient_email,
                "pdf_document_id": str(invite.pdf_document_id),
            }
        )
        return DeliveryResult(
            channel="email",
            status="queued",
            provider="sendgrid",
            recipient=invite.recipient_email,
            provider_message_id="sg-dispatch-1",
        )

    monkeypatch.setattr(
        xero_router,
        "send_invoice_delivery_email",
        fake_send_invoice_delivery_email,
    )

    dispatch_response = client.post(
        f"/api/v1/xero/invoices/provider-dispatch/{entity_id}",
        json={"invoice_draft_ids": [str(invoice_draft.id)]},
    )
    assert dispatch_response.status_code == 200
    dispatch_body = dispatch_response.json()
    assert dispatch_body["xero_created_count"] == 1
    assert dispatch_body["email_sent_count"] == 1
    assert dispatch_body["results"][0]["xero_status"] == "created"
    assert dispatch_body["results"][0]["email_status"] == "sent"
    assert dispatch_body["results"][0]["email_provider_message_id"] == "sg-dispatch-1"
    assert dispatch_body["results"][0]["provider_receipts"][0]["provider"] == "xero"
    assert dispatch_body["results"][0]["provider_receipts"][0]["status"] == "created"
    assert dispatch_body["results"][0]["next_action"] is None
    assert len(create_calls) == 1
    assert len(email_calls) == 1
    assert operation_events == ["xero", "email"]

    session.refresh(invoice_draft)
    metadata = invoice_draft.invoice_metadata
    assert metadata["xero_sync"]["xero_synced"] is True
    assert metadata["provider_dispatch"]["xero"]["status"] == "created"
    assert metadata["provider_status_receipts"][0]["provider"] == "xero"
    assert metadata["provider_status_receipts"][0]["status"] == "created"
    assert metadata["delivery_state"]["xero_synced"] is True
    assert metadata["delivery_state"]["tenant_email_sent"] is True
    assert metadata["delivery_email"]["send"]["xero_synced"] is True

    second_response = client.post(
        f"/api/v1/xero/invoices/provider-dispatch/{entity_id}",
        json={"invoice_draft_ids": [str(invoice_draft.id)]},
    )
    assert second_response.status_code == 200
    second_body = second_response.json()
    assert second_body["xero_created_count"] == 0
    assert second_body["xero_reused_count"] == 1
    assert second_body["email_sent_count"] == 0
    assert second_body["email_reused_count"] == 1
    assert second_body["results"][0]["xero_status"] == "reused"
    assert second_body["results"][0]["email_status"] == "reused"
    assert len(create_calls) == 1
    assert len(email_calls) == 1


def test_xero_provider_dispatch_persists_failed_attempt_and_retries(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    settings = _provider_settings()
    _override_settings(settings)
    _fake_xero_provider(monkeypatch)
    entity_id = _entity_id(session)
    invoice_draft = _create_approved_invoice_fixture(client, session, entity_id)
    invoice_draft.recipient_email = "accounts@retry-rent.example"
    session.commit()

    prepare_response = client.post(
        f"/api/v1/invoice-drafts/{invoice_draft.id}/prepare-delivery"
    )
    assert prepare_response.status_code == 200
    approval_response = client.post(
        f"/api/v1/xero/invoices/{invoice_draft.id}/posting-approval",
        json={"approved": True, "idempotency_key": "retry-provider-dispatch"},
    )
    assert approval_response.status_code == 200
    state = _start_xero_oauth(client, entity_id)
    _finish_xero_oauth(client, state)

    create_calls: list[dict[str, object]] = []
    _fake_xero_invoice_dependencies(monkeypatch, create_calls)

    def flaky_create_xero_invoice_draft(
        access_token: str,
        xero_tenant_id: str,
        invoice_payload: dict[str, object],
        settings: Settings,  # noqa: ARG001
        *,
        idempotency_key: str,
    ) -> dict[str, object]:
        create_calls.append(
            {"payload": invoice_payload, "idempotency_key": idempotency_key}
        )
        if len(create_calls) == 1:
            raise xero_router.XeroIntegrationError("Xero rate limit, retry shortly.")
        return {
            "InvoiceID": "xero-invoice-retried-1",
            "InvoiceNumber": invoice_payload["InvoiceNumber"],
            "Status": "DRAFT",
        }

    email_calls: list[str] = []

    def fake_send_invoice_delivery_email(invite, settings: Settings) -> DeliveryResult:  # noqa: ARG001
        email_calls.append(invite.recipient_email)
        return DeliveryResult(
            channel="email",
            status="queued",
            provider="sendgrid",
            recipient=invite.recipient_email,
            provider_message_id="sg-retry-1",
        )

    monkeypatch.setattr(
        xero_router,
        "create_xero_invoice_draft",
        flaky_create_xero_invoice_draft,
    )
    monkeypatch.setattr(
        xero_router,
        "send_invoice_delivery_email",
        fake_send_invoice_delivery_email,
    )

    first_response = client.post(
        f"/api/v1/xero/invoices/provider-dispatch/{entity_id}",
        json={"invoice_draft_ids": [str(invoice_draft.id)]},
    )
    assert first_response.status_code == 200
    first_body = first_response.json()
    assert first_body["failed_count"] == 1
    assert first_body["results"][0]["xero_status"] == "failed"
    assert first_body["results"][0]["email_status"] == "skipped"
    assert first_body["results"][0]["next_action"] == "retry_xero_dispatch"

    session.refresh(invoice_draft)
    metadata = invoice_draft.invoice_metadata
    assert metadata["posting_preparation"]["external_posting_status"] == (
        "provider_failed"
    )
    assert metadata["posting_preparation"]["xero_sync_allowed"] is True
    assert metadata["provider_status_receipts"][0]["status"] == "failed"
    assert "xero_sync" not in metadata
    assert email_calls == []

    second_response = client.post(
        f"/api/v1/xero/invoices/provider-dispatch/{entity_id}",
        json={"invoice_draft_ids": [str(invoice_draft.id)]},
    )
    assert second_response.status_code == 200
    second_body = second_response.json()
    assert second_body["xero_created_count"] == 1
    assert second_body["email_sent_count"] == 1
    assert second_body["results"][0]["xero_status"] == "created"
    assert second_body["results"][0]["provider_receipts"][0]["status"] == "created"

    session.refresh(invoice_draft)
    metadata = invoice_draft.invoice_metadata
    assert metadata["xero_sync"]["xero_invoice_id"] == "xero-invoice-retried-1"
    assert metadata["provider_status_receipts"][0]["status"] == "created"
    assert metadata["provider_status_receipts"][1]["status"] == "failed"
    assert metadata["delivery_email"]["send"]["provider_message_id"] == "sg-retry-1"


def test_xero_exception_queue_surfaces_local_provider_and_payment_gaps(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    entity_id = _entity_id(session)
    failed_invoice = _create_approved_invoice_fixture(
        client,
        session,
        entity_id,
        invoice_number="INV-XERO-FAILED",
    )
    payment_invoice = _create_approved_invoice_fixture(
        client,
        session,
        entity_id,
        invoice_number="INV-XERO-PAYMENT",
        xero_invoice_id="xero-invoice-payment-gap",
    )
    provider_receipt = {
        "provider": "xero",
        "status": "failed",
        "reason": "Xero rate limit, retry shortly.",
        "external_posting_status": "provider_failed",
        "idempotency_key": "xero-draft-failed",
        "xero_invoice_id": None,
        "xero_status": None,
        "received_at": "2026-05-20T10:00:00+00:00",
        "retry_count": 1,
    }
    failed_metadata = dict(failed_invoice.invoice_metadata or {})
    failed_metadata["provider_status_receipts"] = [provider_receipt]
    failed_metadata["provider_dispatch"] = {"xero": provider_receipt}
    failed_metadata["posting_preparation"] = {
        **dict(failed_metadata.get("posting_preparation") or {}),
        "external_posting_status": "provider_failed",
        "xero_sync_allowed": True,
        "xero_sync_requested": True,
    }
    failed_invoice.invoice_metadata = failed_metadata
    payment_metadata = dict(payment_invoice.invoice_metadata or {})
    payment_metadata["payment_status"] = {
        "status": "unpaid",
        "paid_cents": 0,
        "outstanding_cents": payment_invoice.total_cents,
        "source": "test",
    }
    payment_invoice.invoice_metadata = payment_metadata
    session.commit()

    def fail_refresh(*args, **kwargs):  # noqa: ANN002, ANN003
        raise AssertionError("exception queue must not call the Xero provider")

    monkeypatch.setattr(xero_router, "refresh_xero_tokens", fail_refresh)
    entity = session.get(Entity, UUID(entity_id))
    assert entity is not None
    last_sync_before = entity.xero_last_sync_at

    response = client.get(f"/api/v1/xero/exception-queue?entity_id={entity_id}")
    assert response.status_code == 200
    body = response.json()
    item_by_id = {item["id"]: item for item in body["items"]}

    provider_item = item_by_id[f"xero-provider-{failed_invoice.id}"]
    assert provider_item["kind"] == "provider"
    assert provider_item["severity"] == "blocker"
    assert provider_item["next_action"] == "retry_xero_dispatch"
    assert provider_item["provider_status"] == "failed"
    assert provider_item["external_posting_status"] == "provider_failed"
    assert provider_item["retry_count"] == 1

    payment_item = item_by_id[f"xero-payment-{payment_invoice.id}"]
    assert payment_item["kind"] == "payment"
    assert payment_item["next_action"] == "preview_payment_reconciliation"
    assert payment_item["xero_invoice_id"] == "xero-invoice-payment-gap"
    assert payment_item["provider_status"] == "unpaid"

    freshness_exception = item_by_id["xero-payment-reconciliation-freshness"]
    assert freshness_exception["severity"] == "warning"
    assert freshness_exception["next_action"] == "preview_payment_reconciliation"
    assert freshness_exception["provider"] == "xero"
    assert "preview payments" in freshness_exception["action"]

    assert body["summary"]["provider"] >= 1
    assert body["summary"]["payment"] >= 1
    assert "local Leasium records only" in body["guardrails"][0]

    session.refresh(entity)
    assert entity.xero_last_sync_at == last_sync_before
    audit = session.scalar(
        select(AuditAction).where(AuditAction.tool_name == "xero.exception_queue")
    )
    assert audit is None


def test_xero_invoice_draft_create_skips_when_provider_unconfigured(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    invoice_draft = _create_approved_invoice_fixture(client, session, entity_id)

    approval_response = client.post(
        f"/api/v1/xero/invoices/{invoice_draft.id}/posting-approval",
        json={"approved": True},
    )
    assert approval_response.status_code == 200

    response = client.post(
        f"/api/v1/xero/invoices/draft-create/{entity_id}",
        json={"invoice_draft_ids": [str(invoice_draft.id)]},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["provider_configured"] is False
    assert body["created_count"] == 0
    assert body["skipped_count"] == 1
    assert "provider credentials are not configured" in body["results"][0]["reason"]

    session.refresh(invoice_draft)
    assert "xero_sync" not in invoice_draft.invoice_metadata


def test_xero_payment_reconciliation_preview_and_apply_are_idempotent(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _entity_id(session)
    invoice_draft = _create_approved_invoice_fixture(
        client,
        session,
        entity_id,
        invoice_number="INV-PAID-1",
        total_cents=275050,
        xero_invoice_id="xero-invoice-paid-1",
    )

    payload = {
        "source": "imported",
        "payments": [
            {
                "invoice_draft_id": str(invoice_draft.id),
                "xero_invoice_id": "xero-invoice-paid-1",
                "status": "paid",
                "provider_payment_id": "xero-payment-1",
                "idempotency_key": "payment-feed-row-1",
                "bank_transaction_id": "bank-txn-1",
                "bank_account_name": "Operating Account",
                "statement_date": "2026-05-20",
                "statement_amount_cents": 275050,
                "counterparty": "Bright Cafe",
                "reference": "INV-PAID-1",
                "match_confidence": "high",
                "match_method": "Matched by bank statement reference.",
            }
        ],
    }
    preview_response = client.post(
        f"/api/v1/xero/payments/reconciliation-preview/{entity_id}",
        json=payload,
    )
    assert preview_response.status_code == 200
    preview_body = preview_response.json()
    assert preview_body["ready_count"] == 1
    assert preview_body["applied_count"] == 0
    assert preview_body["results"][0]["status"] == "ready"
    assert preview_body["results"][0]["match_confidence"] == "high"
    assert preview_body["results"][0]["match_method"] == (
        "Matched by bank statement reference."
    )
    assert preview_body["results"][0]["bank_transaction_id"] == "bank-txn-1"
    assert preview_body["results"][0]["amount_delta_cents"] == 0
    assert "bank_evidence_stored" in preview_body["results"][0]["guardrail_flags"]
    assert "no_bank_feed_mutation" in preview_body["results"][0]["guardrail_flags"]

    session.refresh(invoice_draft)
    assert invoice_draft.invoice_metadata["payment_status"]["status"] == "unpaid"

    apply_response = client.post(
        f"/api/v1/xero/payments/reconciliation-apply/{entity_id}",
        json=payload,
    )
    assert apply_response.status_code == 200
    apply_body = apply_response.json()
    assert apply_body["applied_count"] == 1
    assert apply_body["results"][0]["status"] == "applied"
    assert apply_body["results"][0]["proposed_paid_cents"] == 275050
    assert apply_body["results"][0]["reference"] == "INV-PAID-1"

    session.refresh(invoice_draft)
    assert invoice_draft.invoice_metadata["payment_status"]["status"] == "paid"
    assert invoice_draft.invoice_metadata["payment_status"]["paid_cents"] == 275050
    assert len(invoice_draft.invoice_metadata["payment_history"]) == 1
    reconciliation_entry = invoice_draft.invoice_metadata["xero_payment_reconciliation"]
    assert reconciliation_entry["bank_transaction_id"] == "bank-txn-1"
    assert reconciliation_entry["bank_account_name"] == "Operating Account"
    assert reconciliation_entry["reference"] == "INV-PAID-1"
    assert reconciliation_entry["match_confidence"] == "high"
    assert "no_bank_feed_mutation" in reconciliation_entry["guardrail_flags"]

    second_response = client.post(
        f"/api/v1/xero/payments/reconciliation-apply/{entity_id}",
        json=payload,
    )
    assert second_response.status_code == 200
    second_body = second_response.json()
    assert second_body["applied_count"] == 0
    assert second_body["skipped_count"] == 1
    assert second_body["results"][0]["reason"] == (
        "This payment reconciliation item was already applied."
    )

    session.refresh(invoice_draft)
    assert len(invoice_draft.invoice_metadata["payment_history"]) == 1

    low_confidence_response = client.post(
        f"/api/v1/xero/payments/reconciliation-preview/{entity_id}",
        json={
            "source": "imported",
            "payments": [
                {
                    "invoice_number": "INV-PAID-1",
                    "status": "paid",
                    "provider_payment_id": "bank-row-low-confidence",
                    "match_confidence": "low",
                    "reference": "Unclear remittance",
                }
            ],
        },
    )
    assert low_confidence_response.status_code == 200
    low_confidence_body = low_confidence_response.json()
    assert low_confidence_body["blocked_count"] == 1
    assert low_confidence_body["results"][0]["status"] == "blocked"
    assert low_confidence_body["results"][0]["match_confidence"] == "low"
    assert "review_match_confidence" in low_confidence_body["results"][0]["guardrail_flags"]


def test_xero_provider_payment_reconciliation_fetches_xero_invoices(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    settings = _provider_settings()
    _override_settings(settings)
    _fake_xero_provider(monkeypatch)
    entity_id = _entity_id(session)
    invoice_draft = _create_approved_invoice_fixture(
        client,
        session,
        entity_id,
        invoice_number="INV-PROVIDER-PAID-1",
        total_cents=550000,
        xero_invoice_id="xero-invoice-provider-paid-1",
    )

    state = _start_xero_oauth(client, entity_id)
    _finish_xero_oauth(client, state)

    fetch_calls: list[str] = []

    def fake_refresh_xero_tokens(
        refresh_token: str,
        settings: Settings,  # noqa: ARG001
    ) -> dict[str, object]:
        assert refresh_token in {"raw-refresh-token", "raw-refresh-token-created"}
        return {
            "access_token": "raw-access-token-payments",
            "refresh_token": "raw-refresh-token-created",
            "expires_in": 1800,
            "scope": "offline_access accounting.transactions.read",
        }

    def fake_fetch_xero_invoices(
        access_token: str,
        xero_tenant_id: str,
        settings: Settings,  # noqa: ARG001
    ) -> list[dict[str, object]]:
        assert access_token == "raw-access-token-payments"
        assert xero_tenant_id == "tenant-provider-123"
        fetch_calls.append(xero_tenant_id)
        return [
            {
                "InvoiceID": "xero-invoice-provider-paid-1",
                "InvoiceNumber": "INV-PROVIDER-PAID-1",
                "Status": "PAID",
                "Total": 5500,
                "AmountPaid": 5500,
                "AmountDue": 0,
                "UpdatedDateUTC": "2026-05-20T00:00:00Z",
            }
        ]

    monkeypatch.setattr(xero_router, "refresh_xero_tokens", fake_refresh_xero_tokens)
    monkeypatch.setattr(xero_router, "fetch_xero_invoices", fake_fetch_xero_invoices)

    preview_response = client.post(
        f"/api/v1/xero/payments/reconciliation-preview/{entity_id}",
        json={"source": "provider", "payments": []},
    )
    assert preview_response.status_code == 200
    preview_body = preview_response.json()
    assert preview_body["source"] == "provider"
    assert preview_body["checked_payments"] == 1
    assert preview_body["ready_count"] == 1
    assert preview_body["results"][0]["invoice_number"] == "INV-PROVIDER-PAID-1"
    assert preview_body["results"][0]["proposed_status"] == "paid"
    assert preview_body["results"][0]["proposed_paid_cents"] == 550000

    session.refresh(invoice_draft)
    assert invoice_draft.invoice_metadata["payment_status"]["status"] == "unpaid"

    apply_response = client.post(
        f"/api/v1/xero/payments/reconciliation-apply/{entity_id}",
        json={"source": "provider", "payments": []},
    )
    assert apply_response.status_code == 200
    apply_body = apply_response.json()
    assert apply_body["applied_count"] == 1
    assert apply_body["results"][0]["status"] == "applied"
    assert fetch_calls == ["tenant-provider-123", "tenant-provider-123"]

    session.refresh(invoice_draft)
    metadata = invoice_draft.invoice_metadata
    assert metadata["payment_status"]["status"] == "paid"
    assert metadata["payment_status"]["paid_cents"] == 550000
    assert metadata["xero_payment_reconciliation"]["source"] == "provider"
    assert metadata["xero_payment_reconciliation"]["xero_invoice_id"] == (
        "xero-invoice-provider-paid-1"
    )
