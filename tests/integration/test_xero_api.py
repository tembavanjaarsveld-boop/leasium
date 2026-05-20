"""Xero readiness API integration tests."""

from uuid import UUID

from apps.api.main import app
from apps.api.routers import xero as xero_router
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
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


def _fake_xero_provider(monkeypatch, tenant_id: str = "tenant-provider-123") -> None:
    def fake_exchange_code_for_tokens(code: str, settings: Settings) -> dict[str, object]:
        assert code == "auth-code"
        assert settings.xero_client_id == "xero-client-id"
        return {
            "access_token": "raw-access-token",
            "refresh_token": "raw-refresh-token",
            "expires_in": 1800,
            "scope": "offline_access accounting.contacts.read",
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


def _fake_xero_invoice_dependencies(monkeypatch, create_calls: list[dict[str, object]]) -> None:
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
        assert refresh_token == "raw-refresh-token"
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
        assert refresh_token == "raw-refresh-token"
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
    assert prepare_response.json()["metadata"]["delivery_state"]["delivery_ready"] is True

    approval_response = client.post(
        f"/api/v1/xero/invoices/{invoice_draft.id}/posting-approval",
        json={"approved": True, "idempotency_key": "provider-dispatch"},
    )
    assert approval_response.status_code == 200
    state = _start_xero_oauth(client, entity_id)
    _finish_xero_oauth(client, state)

    create_calls: list[dict[str, object]] = []
    email_calls: list[dict[str, object]] = []
    _fake_xero_invoice_dependencies(monkeypatch, create_calls)

    def fake_send_invoice_delivery_email(invite, settings: Settings) -> DeliveryResult:
        assert invite.recipient_email == "accounts@base-rent.example"
        assert invite.pdf_document_id is not None
        assert invite.pdf_content.startswith(b"%PDF")
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

    session.refresh(invoice_draft)
    assert invoice_draft.invoice_metadata["payment_status"]["status"] == "paid"
    assert invoice_draft.invoice_metadata["payment_status"]["paid_cents"] == 275050
    assert len(invoice_draft.invoice_metadata["payment_history"]) == 1

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
