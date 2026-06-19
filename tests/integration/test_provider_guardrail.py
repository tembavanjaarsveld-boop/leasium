"""Standing provider mutation guardrails for Smart Intake apply paths."""

from typing import Any
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from stewart.core.models import AuditAction, AuditOutcome
from stewart.core.settings import Settings
from tests.integration.test_document_intake_api import (
    _entity_id,
    _fake_compliance_extraction,
    _fake_inspection_extraction,
    _fake_invoice_extraction,
    _fake_purchase_contract_extraction,
    _fake_smart_lease_extraction,
    _lease_scope,
)
from tests.support.provider_guardrail import (
    assert_no_provider_mutation_audit_rows,
    provider_mutation_audit_rows,
)


def _apply_reviewed_intake(
    client: TestClient,
    monkeypatch: Any,
    *,
    entity_id: str,
    review_data: dict[str, Any],
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    def fake_extract_document_file(
        *,
        file_data: bytes,
        filename: str,
        content_type: str | None,
        settings: Settings,
    ) -> tuple[dict[str, Any], str]:
        return review_data, "resp_provider_guardrail"

    monkeypatch.setattr(
        "apps.api.routers.document_intakes.extract_document_file",
        fake_extract_document_file,
    )
    create_response = client.post(
        "/api/v1/document-intakes",
        data={"entity_id": entity_id},
        files={"file": ("provider-guardrail.txt", b"document", "text/plain")},
    )
    assert create_response.status_code == 201

    apply_payload = {"review_data": review_data, **(payload or {})}
    apply_response = client.post(
        f"/api/v1/document-intakes/{create_response.json()['id']}/apply",
        json=apply_payload,
    )
    assert apply_response.status_code == 200
    assert apply_response.json()["status"] == "applied"
    return apply_response.json()


def test_provider_guardrail_helper_catches_provider_mutation_audit(
    session: Session,
) -> None:
    row = AuditAction(
        request_id=uuid4(),
        actor="test",
        user_id=None,
        entity_id=UUID(_entity_id(session)),
        action="sync",
        target_table="xero_invoice",
        target_id=None,
        tool_name="xero.sync",
        tool_input={},
        tool_output_summary="Synced invoice to Xero.",
        outcome=AuditOutcome.success,
        data_classification="internal",
    )
    session.add(row)
    session.commit()

    assert provider_mutation_audit_rows(session) == [row]


def test_document_intake_apply_branches_do_not_emit_provider_mutation_audits(
    client: TestClient,
    session: Session,
    monkeypatch: Any,
) -> None:
    entity_id = _entity_id(session)
    scope = _lease_scope(client, session)
    scoped_payload = {
        "property_id": scope["property_id"],
        "tenancy_unit_id": scope["tenancy_unit_id"],
        "lease_id": scope["lease_id"],
    }

    cases = [
        (_fake_smart_lease_extraction(), {}),
        (_fake_purchase_contract_extraction(), {}),
        (_fake_invoice_extraction(), scoped_payload),
        (_fake_inspection_extraction(), {}),
        (_fake_compliance_extraction(), scoped_payload),
    ]
    for review_data, payload in cases:
        _apply_reviewed_intake(
            client,
            monkeypatch,
            entity_id=entity_id,
            review_data=review_data,
            payload=payload,
        )

    assert_no_provider_mutation_audit_rows(session)
