"""Owner statements API tests."""

import csv
from datetime import date
from decimal import Decimal
from io import BytesIO, StringIO
from typing import Any, TypedDict
from uuid import UUID, uuid4
from zipfile import ZipFile

from apps.api.routers.owners import (
    _allocated_cents_by_split,
    _allocated_invoice_evidence_line,
)
from apps.api.schemas.owners import OwnerInvoiceEvidenceLine
from fastapi.testclient import TestClient
from pypdf import PdfReader
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import (
    BillingDraft,
    BillingDraftStatus,
    DocumentCategory,
    Entity,
    InvoiceDraft,
    InvoiceDraftStatus,
    OperatingMode,
    Organisation,
    Owner,
    OwnerDistribution,
    OwnerStatementDispatch,
    Property,
    PropertyOwner,
    PropertyType,
    StoredDocument,
)
from stewart.core.settings import get_settings
from stewart.integrations.communications import DeliveryResult
from stewart.integrations.payment_rails import configured_rail


class _OwnerSeedScope(TypedDict):
    entity_id: str
    property_ids: list[str]


def _entity(session: Session) -> Entity:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return entity


def _set_operating_mode(session: Session, mode: OperatingMode) -> None:
    organisation = session.scalar(select(Organisation))
    assert organisation is not None
    organisation.operating_mode = mode.value
    session.commit()


def _link_owner_from_property_fields(session: Session, prop: Property) -> Owner:
    owner = Owner(
        entity_id=prop.entity_id,
        legal_name=prop.owner_legal_name,
        trustee_name=prop.trustee_name,
        trust_name=prop.trust_name,
        invoice_issuer_name=prop.invoice_issuer_name,
        billing_email=prop.billing_email,
        billing_contact_name=prop.billing_contact_name,
    )
    session.add(owner)
    session.flush()
    session.add(PropertyOwner(property_id=prop.id, owner_id=owner.id))
    return owner


def _seed_owner_with_invoices(
    session: Session,
    *,
    trust_name: str,
    trustee_name: str,
    properties: list[tuple[str, list[tuple[date, int, int]]]],
    billing_email: str | None = None,
    billing_contact_name: str | None = None,
) -> _OwnerSeedScope:
    """Seed a trust + N properties each with M invoices.

    Each invoice tuple is (issue_date, total_cents, paid_cents).
    Returns the owner identity label and the property IDs.
    """

    entity = _entity(session)
    # Each invoice needs a billing_draft + a stored_document.
    doc = StoredDocument(
        entity_id=entity.id,
        filename="owner-statement-seed.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.invoice,
    )
    session.add(doc)
    session.flush()
    bd = BillingDraft(
        entity_id=entity.id,
        document_id=doc.id,
        title=f"Billing for {trust_name}",
        currency="AUD",
        status=BillingDraftStatus.approved,
    )
    session.add(bd)
    session.flush()
    owner = Owner(
        entity_id=entity.id,
        legal_name=trustee_name,
        trustee_name=trustee_name,
        trust_name=trust_name,
        invoice_issuer_name=f"{trust_name} via {trustee_name}",
        billing_email=billing_email,
        billing_contact_name=billing_contact_name,
    )
    session.add(owner)
    session.flush()

    property_ids: list[str] = []
    for property_name, invoice_specs in properties:
        prop = Property(
            entity_id=entity.id,
            name=property_name,
            street_address=f"{property_name} street",
            property_type=PropertyType.commercial_retail,
            owner_legal_name=trustee_name,
            trustee_name=trustee_name,
            trust_name=trust_name,
            invoice_issuer_name=f"{trust_name} via {trustee_name}",
            billing_email=billing_email,
            billing_contact_name=billing_contact_name,
        )
        session.add(prop)
        session.flush()
        session.add(PropertyOwner(property_id=prop.id, owner_id=owner.id))
        property_ids.append(str(prop.id))

        for issue_date, total_cents, paid_cents in invoice_specs:
            invoice = InvoiceDraft(
                entity_id=entity.id,
                billing_draft_id=bd.id,
                property_id=prop.id,
                document_id=doc.id,
                status=InvoiceDraftStatus.approved,
                title=f"Invoice {property_name} {issue_date}",
                currency="AUD",
                issue_date=issue_date,
                subtotal_cents=total_cents,
                gst_cents=0,
                total_cents=total_cents,
                invoice_metadata={"paid_cents": paid_cents},
            )
            session.add(invoice)
    session.commit()
    return {"entity_id": str(entity.id), "property_ids": property_ids}


def test_owner_statements_groups_properties_by_trust(
    client: TestClient,
    session: Session,
) -> None:
    """Properties sharing trust_name + trustee_name roll up into one owner."""

    scope = _seed_owner_with_invoices(
        session,
        trust_name="Queen Street Trust",
        trustee_name="QS Trustee Pty Ltd",
        properties=[
            (
                "Queen Street Retail Centre",
                [
                    (date(2026, 4, 1), 880_000, 880_000),   # paid in full
                    (date(2026, 4, 15), 110_000, 0),        # outstanding
                ],
            ),
            (
                "Queen Street Warehouse",
                [
                    (date(2026, 4, 5), 660_000, 330_000),   # partial
                ],
            ),
        ],
    )

    response = client.get(
        "/api/v1/owners/statements",
        params={"entity_id": scope["entity_id"], "month": "2026-04"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["month"] == "2026-04"
    assert body["month_start"] == "2026-04-01"
    assert body["month_end"] == "2026-04-30"
    assert len(body["owners"]) == 1
    owner = body["owners"][0]
    assert owner["trust_name"] == "Queen Street Trust"
    assert owner["trustee_name"] == "QS Trustee Pty Ltd"
    assert owner["property_count"] == 2
    # Invoiced total: 880,000 + 110,000 + 660,000 = 1,650,000 cents = $16,500
    assert owner["invoiced_cents"] == 1_650_000
    # Paid total: 880,000 + 0 + 330,000 = 1,210,000 cents = $12,100
    assert owner["paid_cents"] == 1_210_000
    assert owner["outstanding_cents"] == 440_000
    assert owner["invoice_count"] == 3
    # Properties sorted by invoiced descending — Retail Centre (990k) before
    # Warehouse (660k).
    assert [p["property_name"] for p in owner["properties"]] == [
        "Queen Street Retail Centre",
        "Queen Street Warehouse",
    ]


def test_owner_statements_include_invoice_evidence_without_mutating_metadata(
    client: TestClient,
    session: Session,
) -> None:
    """Property totals expose the local invoice evidence behind them."""

    entity = _entity(session)
    doc = StoredDocument(
        entity_id=entity.id,
        filename="evidence.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.invoice,
    )
    session.add(doc)
    session.flush()
    bd = BillingDraft(
        entity_id=entity.id,
        document_id=doc.id,
        title="Evidence Billing",
        currency="AUD",
        status=BillingDraftStatus.approved,
    )
    session.add(bd)
    session.flush()
    prop = Property(
        entity_id=entity.id,
        name="Evidence Property",
        street_address="1 Evidence Lane",
        property_type=PropertyType.commercial_retail,
        owner_legal_name="Evidence Trustee Pty Ltd",
        trustee_name="Evidence Trustee Pty Ltd",
        trust_name="Evidence Trust",
        invoice_issuer_name="Evidence Trust via Evidence Trustee Pty Ltd",
    )
    session.add(prop)
    session.flush()
    _link_owner_from_property_fields(session, prop)
    metadata = {
        "payment_status": {
            "status": "partially_paid",
            "paid_cents": 80_000,
            "outstanding_cents": 20_000,
        },
        "xero_sync": {"xero_invoice_id": "xero-invoice-evidence-1"},
        "xero_payment_reconciliation": {
            "reference": "BANK REF INV-EVIDENCE-1",
            "match_confidence": "high",
            "bank_transaction_id": "bank-txn-evidence-1",
        },
    }
    invoice = InvoiceDraft(
        entity_id=entity.id,
        billing_draft_id=bd.id,
        property_id=prop.id,
        document_id=doc.id,
        status=InvoiceDraftStatus.approved,
        invoice_number="INV-EVIDENCE-1",
        title="April evidence invoice",
        currency="AUD",
        issue_date=date(2026, 4, 9),
        due_date=date(2026, 4, 23),
        subtotal_cents=100_000,
        gst_cents=0,
        total_cents=100_000,
        invoice_metadata=metadata,
    )
    session.add(invoice)
    session.commit()

    response = client.get(
        "/api/v1/owners/statements",
        params={"entity_id": str(entity.id), "month": "2026-04"},
    )

    assert response.status_code == 200
    owner = response.json()["owners"][0]
    assert owner["paid_cents"] == 80_000
    evidence = owner["properties"][0]["invoices"][0]
    assert evidence == {
        "invoice_draft_id": str(invoice.id),
        "invoice_number": "INV-EVIDENCE-1",
        "title": "April evidence invoice",
        "issue_date": "2026-04-09",
        "due_date": "2026-04-23",
        "total_cents": 100_000,
        "paid_cents": 80_000,
        "outstanding_cents": 20_000,
        "payment_status": "partially_paid",
        "xero_invoice_id": "xero-invoice-evidence-1",
        "reconciliation_reference": "BANK REF INV-EVIDENCE-1",
        "reconciliation_match_confidence": "high",
        "reconciliation_bank_transaction_id": "bank-txn-evidence-1",
    }
    session.refresh(invoice)
    assert invoice.invoice_metadata == metadata


def test_owner_statements_invoice_evidence_uses_metadata_fallbacks(
    client: TestClient,
    session: Session,
) -> None:
    """Evidence rows should survive older provider metadata shapes."""

    entity = _entity(session)
    doc = StoredDocument(
        entity_id=entity.id,
        filename="fallback-evidence.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.invoice,
    )
    session.add(doc)
    session.flush()
    bd = BillingDraft(
        entity_id=entity.id,
        document_id=doc.id,
        title="Fallback Evidence Billing",
        currency="AUD",
        status=BillingDraftStatus.approved,
    )
    session.add(bd)
    session.flush()
    prop = Property(
        entity_id=entity.id,
        name="Fallback Evidence Property",
        street_address="3 Evidence Lane",
        property_type=PropertyType.commercial_retail,
        owner_legal_name="Fallback Evidence Trustee Pty Ltd",
        trustee_name="Fallback Evidence Trustee Pty Ltd",
        trust_name="Fallback Evidence Trust",
        invoice_issuer_name="Fallback Evidence Trust via Fallback Evidence Trustee Pty Ltd",
    )
    session.add(prop)
    session.flush()
    _link_owner_from_property_fields(session, prop)
    session.add_all(
        [
            InvoiceDraft(
                entity_id=entity.id,
                billing_draft_id=bd.id,
                property_id=prop.id,
                document_id=doc.id,
                status=InvoiceDraftStatus.approved,
                invoice_number="INV-FALLBACK-DIRECT",
                title="Direct fallback invoice",
                currency="AUD",
                issue_date=date(2026, 4, 4),
                due_date=date(2026, 4, 18),
                subtotal_cents=50_000,
                gst_cents=0,
                total_cents=50_000,
                invoice_metadata={
                    "xero_invoice_id": "xero-direct-fallback-1",
                    "xero_payment_reconciliation_history": [
                        {
                            "reference": "BANK REF DIRECT",
                            "match_confidence": "low",
                            "bank_transaction_id": "bank-direct-fallback-1",
                        }
                    ],
                },
            ),
            InvoiceDraft(
                entity_id=entity.id,
                billing_draft_id=bd.id,
                property_id=prop.id,
                document_id=doc.id,
                status=InvoiceDraftStatus.approved,
                invoice_number="INV-FALLBACK-POSTING",
                title="Posting fallback invoice",
                currency="AUD",
                issue_date=date(2026, 4, 5),
                due_date=date(2026, 4, 19),
                subtotal_cents=60_000,
                gst_cents=0,
                total_cents=60_000,
                invoice_metadata={
                    "posting_preparation": {"InvoiceID": "xero-posting-fallback-1"},
                    "xero_payment_reconciliation_history": [
                        {
                            "reference": "BANK REF OLD",
                            "match_confidence": "low",
                            "bank_transaction_id": "bank-old-fallback-1",
                        },
                        {
                            "reference": "BANK REF LATEST",
                            "match_confidence": "high",
                            "bank_transaction_id": "bank-latest-fallback-1",
                        },
                    ],
                },
            ),
        ]
    )
    session.commit()

    response = client.get(
        "/api/v1/owners/statements",
        params={"entity_id": str(entity.id), "month": "2026-04"},
    )

    assert response.status_code == 200
    owner = response.json()["owners"][0]
    evidence_by_number = {
        invoice["invoice_number"]: invoice
        for invoice in owner["properties"][0]["invoices"]
    }
    assert evidence_by_number["INV-FALLBACK-DIRECT"]["xero_invoice_id"] == (
        "xero-direct-fallback-1"
    )
    assert evidence_by_number["INV-FALLBACK-DIRECT"][
        "reconciliation_bank_transaction_id"
    ] == "bank-direct-fallback-1"
    assert evidence_by_number["INV-FALLBACK-POSTING"]["xero_invoice_id"] == (
        "xero-posting-fallback-1"
    )
    assert evidence_by_number["INV-FALLBACK-POSTING"][
        "reconciliation_reference"
    ] == "BANK REF LATEST"
    assert evidence_by_number["INV-FALLBACK-POSTING"][
        "reconciliation_match_confidence"
    ] == "high"


def test_owner_statements_keeps_owners_separate(
    client: TestClient,
    session: Session,
) -> None:
    """Two trusts → two owner statements."""

    _seed_owner_with_invoices(
        session,
        trust_name="Trust A",
        trustee_name="A Trustee Pty Ltd",
        properties=[("Property A", [(date(2026, 4, 10), 500_000, 500_000)])],
    )
    _seed_owner_with_invoices(
        session,
        trust_name="Trust B",
        trustee_name="B Trustee Pty Ltd",
        properties=[("Property B", [(date(2026, 4, 12), 200_000, 0)])],
    )
    entity = _entity(session)

    response = client.get(
        "/api/v1/owners/statements",
        params={"entity_id": str(entity.id), "month": "2026-04"},
    )
    assert response.status_code == 200
    owners = response.json()["owners"]
    assert len(owners) == 2
    # Sorted by invoiced desc — Trust A ($5,000) before Trust B ($2,000).
    assert owners[0]["trust_name"] == "Trust A"
    assert owners[0]["invoiced_cents"] == 500_000
    assert owners[1]["trust_name"] == "Trust B"
    assert owners[1]["outstanding_cents"] == 200_000


def test_owner_statements_group_by_owner_entity_not_legacy_tuple(
    client: TestClient,
    session: Session,
) -> None:
    """PropertyOwner links, not legacy Property fields, define statement owners."""

    entity = _entity(session)
    doc = StoredDocument(
        entity_id=entity.id,
        filename="owner-entity-cutover.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.invoice,
    )
    session.add(doc)
    session.flush()
    bd = BillingDraft(
        entity_id=entity.id,
        document_id=doc.id,
        title="Owner entity cutover",
        currency="AUD",
        status=BillingDraftStatus.approved,
    )
    session.add(bd)
    owner_a = Owner(
        entity_id=entity.id,
        legal_name="Alpha Owner Pty Ltd",
        trustee_name="Alpha Trustee Pty Ltd",
        trust_name="Alpha Trust",
        invoice_issuer_name="Alpha Trust via Alpha Trustee Pty Ltd",
        billing_email="alpha@example.test",
    )
    owner_b = Owner(
        entity_id=entity.id,
        legal_name="Beta Owner Pty Ltd",
        trustee_name="Beta Trustee Pty Ltd",
        trust_name="Beta Trust",
        invoice_issuer_name="Beta Trust via Beta Trustee Pty Ltd",
        billing_email="beta@example.test",
    )
    session.add_all([owner_a, owner_b])
    session.flush()

    shared_legacy_fields = {
        "owner_legal_name": "Legacy Shared Pty Ltd",
        "trustee_name": "Legacy Trustee Pty Ltd",
        "trust_name": "Legacy Trust",
        "invoice_issuer_name": "Legacy Trust via Legacy Trustee Pty Ltd",
    }
    for owner, property_name, total_cents in [
        (owner_a, "Alpha Linked Property", 500_000),
        (owner_b, "Beta Linked Property", 200_000),
    ]:
        prop = Property(
            entity_id=entity.id,
            name=property_name,
            street_address=f"{property_name} street",
            property_type=PropertyType.commercial_retail,
            **shared_legacy_fields,
        )
        session.add(prop)
        session.flush()
        session.add(PropertyOwner(property_id=prop.id, owner_id=owner.id))
        session.add(
            InvoiceDraft(
                entity_id=entity.id,
                billing_draft_id=bd.id,
                property_id=prop.id,
                document_id=doc.id,
                status=InvoiceDraftStatus.approved,
                title=f"Invoice {property_name}",
                currency="AUD",
                issue_date=date(2026, 4, 12),
                subtotal_cents=total_cents,
                gst_cents=0,
                total_cents=total_cents,
                invoice_metadata={},
            )
        )
    session.commit()

    response = client.get(
        "/api/v1/owners/statements",
        params={"entity_id": str(entity.id), "month": "2026-04"},
    )

    assert response.status_code == 200
    owners = response.json()["owners"]
    assert len(owners) == 2
    assert [owner["trust_name"] for owner in owners] == ["Alpha Trust", "Beta Trust"]
    assert [owner["invoiced_cents"] for owner in owners] == [500_000, 200_000]
    assert {owner["billing_email"] for owner in owners} == {
        "alpha@example.test",
        "beta@example.test",
    }


def test_owner_statements_allocates_shared_property_totals_by_split_pct(
    client: TestClient,
    session: Session,
) -> None:
    """Shared property invoices are allocated by PropertyOwner.split_pct."""

    entity = _entity(session)
    doc = StoredDocument(
        entity_id=entity.id,
        filename="shared-split.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.invoice,
    )
    session.add(doc)
    session.flush()
    bd = BillingDraft(
        entity_id=entity.id,
        document_id=doc.id,
        title="Shared split billing",
        currency="AUD",
        status=BillingDraftStatus.approved,
    )
    owner_a = Owner(entity_id=entity.id, legal_name="Alpha Split Pty Ltd")
    owner_b = Owner(entity_id=entity.id, legal_name="Beta Split Pty Ltd")
    prop = Property(
        entity_id=entity.id,
        name="Shared Split Property",
        street_address="10 Split Street",
        property_type=PropertyType.commercial_retail,
    )
    session.add_all([bd, owner_a, owner_b, prop])
    session.flush()
    session.add_all(
        [
            PropertyOwner(property_id=prop.id, owner_id=owner_a.id, split_pct=60),
            PropertyOwner(property_id=prop.id, owner_id=owner_b.id, split_pct=40),
        ]
    )
    session.add(
        InvoiceDraft(
            entity_id=entity.id,
            billing_draft_id=bd.id,
            property_id=prop.id,
            document_id=doc.id,
            status=InvoiceDraftStatus.approved,
            title="Shared split invoice",
            currency="AUD",
            issue_date=date(2026, 4, 15),
            subtotal_cents=100_000,
            gst_cents=0,
            total_cents=100_000,
            invoice_metadata={"paid_cents": 25_000},
        )
    )
    session.commit()

    response = client.get(
        "/api/v1/owners/statements",
        params={"entity_id": str(entity.id), "month": "2026-04"},
    )

    assert response.status_code == 200
    owners = {owner["owner_identity"]: owner for owner in response.json()["owners"]}
    assert set(owners) == {"Alpha Split Pty Ltd", "Beta Split Pty Ltd"}

    alpha = owners["Alpha Split Pty Ltd"]
    assert alpha["invoiced_cents"] == 60_000
    assert alpha["paid_cents"] == 15_000
    assert alpha["outstanding_cents"] == 45_000
    assert alpha["invoice_count"] == 1
    assert alpha["properties"][0]["invoiced_cents"] == 60_000
    assert alpha["properties"][0]["paid_cents"] == 15_000
    assert alpha["properties"][0]["outstanding_cents"] == 45_000
    alpha_invoice = alpha["properties"][0]["invoices"][0]
    assert alpha_invoice["total_cents"] == 60_000
    assert alpha_invoice["paid_cents"] == 15_000
    assert alpha_invoice["outstanding_cents"] == 45_000

    beta = owners["Beta Split Pty Ltd"]
    assert beta["invoiced_cents"] == 40_000
    assert beta["paid_cents"] == 10_000
    assert beta["outstanding_cents"] == 30_000
    assert beta["invoice_count"] == 1
    assert beta["properties"][0]["invoiced_cents"] == 40_000
    assert beta["properties"][0]["paid_cents"] == 10_000
    assert beta["properties"][0]["outstanding_cents"] == 30_000
    beta_invoice = beta["properties"][0]["invoices"][0]
    assert beta_invoice["total_cents"] == 40_000
    assert beta_invoice["paid_cents"] == 10_000
    assert beta_invoice["outstanding_cents"] == 30_000


def test_owner_statements_allocates_split_rounding_residue_once(
    client: TestClient,
    session: Session,
) -> None:
    """Rounding on sub-cent split shares does not duplicate cents."""

    entity = _entity(session)
    doc = StoredDocument(
        entity_id=entity.id,
        filename="split-rounding.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.invoice,
    )
    session.add(doc)
    session.flush()
    bd = BillingDraft(
        entity_id=entity.id,
        document_id=doc.id,
        title="Split rounding billing",
        currency="AUD",
        status=BillingDraftStatus.approved,
    )
    owner_a = Owner(entity_id=entity.id, legal_name="Rounding Owner A Pty Ltd")
    owner_b = Owner(entity_id=entity.id, legal_name="Rounding Owner B Pty Ltd")
    prop = Property(
        entity_id=entity.id,
        name="Rounding Split Property",
        street_address="11 Split Street",
        property_type=PropertyType.commercial_retail,
    )
    session.add_all([bd, owner_a, owner_b, prop])
    session.flush()
    session.add_all(
        [
            PropertyOwner(property_id=prop.id, owner_id=owner_a.id, split_pct=50),
            PropertyOwner(property_id=prop.id, owner_id=owner_b.id, split_pct=50),
        ]
    )
    session.add(
        InvoiceDraft(
            entity_id=entity.id,
            billing_draft_id=bd.id,
            property_id=prop.id,
            document_id=doc.id,
            status=InvoiceDraftStatus.approved,
            title="One cent shared invoice",
            currency="AUD",
            issue_date=date(2026, 4, 16),
            subtotal_cents=1,
            gst_cents=0,
            total_cents=1,
            invoice_metadata={"paid_cents": 1},
        )
    )
    session.commit()

    response = client.get(
        "/api/v1/owners/statements",
        params={"entity_id": str(entity.id), "month": "2026-04"},
    )

    assert response.status_code == 200
    owners = response.json()["owners"]
    assert len(owners) == 2
    assert sorted(owner["invoiced_cents"] for owner in owners) == [0, 1]
    assert sorted(owner["paid_cents"] for owner in owners) == [0, 1]
    assert sum(owner["invoiced_cents"] for owner in owners) == 1
    assert sum(owner["paid_cents"] for owner in owners) == 1
    assert sum(
        owner["properties"][0]["invoices"][0]["total_cents"] for owner in owners
    ) == 1
    assert sum(
        owner["properties"][0]["invoices"][0]["paid_cents"] for owner in owners
    ) == 1


def test_owner_statements_preserves_allocated_invoice_balance(
    client: TestClient,
    session: Session,
) -> None:
    """Allocated evidence keeps paid + outstanding equal to total when source does."""

    entity = _entity(session)
    doc = StoredDocument(
        entity_id=entity.id,
        filename="split-balance.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.invoice,
    )
    session.add(doc)
    session.flush()
    bd = BillingDraft(
        entity_id=entity.id,
        document_id=doc.id,
        title="Split balance billing",
        currency="AUD",
        status=BillingDraftStatus.approved,
    )
    owner_a = Owner(entity_id=entity.id, legal_name="Balance Owner A Pty Ltd")
    owner_b = Owner(entity_id=entity.id, legal_name="Balance Owner B Pty Ltd")
    prop = Property(
        entity_id=entity.id,
        name="Balance Split Property",
        street_address="12 Split Street",
        property_type=PropertyType.commercial_retail,
    )
    session.add_all([bd, owner_a, owner_b, prop])
    session.flush()
    session.add_all(
        [
            PropertyOwner(property_id=prop.id, owner_id=owner_a.id, split_pct=50),
            PropertyOwner(property_id=prop.id, owner_id=owner_b.id, split_pct=50),
        ]
    )
    session.add(
        InvoiceDraft(
            entity_id=entity.id,
            billing_draft_id=bd.id,
            property_id=prop.id,
            document_id=doc.id,
            status=InvoiceDraftStatus.approved,
            title="Balanced shared invoice",
            currency="AUD",
            issue_date=date(2026, 4, 17),
            subtotal_cents=100,
            gst_cents=0,
            total_cents=100,
            invoice_metadata={
                "payment_status": {
                    "status": "partially_paid",
                    "paid_cents": 33,
                    "outstanding_cents": 67,
                }
            },
        )
    )
    session.commit()

    response = client.get(
        "/api/v1/owners/statements",
        params={"entity_id": str(entity.id), "month": "2026-04"},
    )

    assert response.status_code == 200
    owners = response.json()["owners"]
    assert len(owners) == 2
    for owner in owners:
        invoice = owner["properties"][0]["invoices"][0]
        assert invoice["paid_cents"] + invoice["outstanding_cents"] == invoice[
            "total_cents"
        ]
        assert owner["paid_cents"] + owner["outstanding_cents"] == owner[
            "invoiced_cents"
        ]
    assert sum(owner["paid_cents"] for owner in owners) == 33
    assert sum(owner["outstanding_cents"] for owner in owners) == 67


def test_owner_statements_caps_allocated_paid_to_allocated_total(
    client: TestClient,
    session: Session,
) -> None:
    """Small split percentages cannot allocate more paid cents than total cents."""

    entity = _entity(session)
    doc = StoredDocument(
        entity_id=entity.id,
        filename="split-paid-cap.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.invoice,
    )
    session.add(doc)
    session.flush()
    bd = BillingDraft(
        entity_id=entity.id,
        document_id=doc.id,
        title="Split paid cap billing",
        currency="AUD",
        status=BillingDraftStatus.approved,
    )
    owners = [
        Owner(entity_id=entity.id, legal_name="Cap Owner One Pty Ltd"),
        Owner(entity_id=entity.id, legal_name="Cap Owner Three Pty Ltd"),
        Owner(entity_id=entity.id, legal_name="Cap Owner Ninety Six Pty Ltd"),
    ]
    prop = Property(
        entity_id=entity.id,
        name="Paid Cap Split Property",
        street_address="13 Split Street",
        property_type=PropertyType.commercial_retail,
    )
    session.add_all([bd, *owners, prop])
    session.flush()
    for owner, split_pct in zip(owners, [1, 3, 96], strict=True):
        session.add(
            PropertyOwner(property_id=prop.id, owner_id=owner.id, split_pct=split_pct)
        )
    session.add(
        InvoiceDraft(
            entity_id=entity.id,
            billing_draft_id=bd.id,
            property_id=prop.id,
            document_id=doc.id,
            status=InvoiceDraftStatus.approved,
            title="Paid cap shared invoice",
            currency="AUD",
            issue_date=date(2026, 4, 18),
            subtotal_cents=51,
            gst_cents=0,
            total_cents=51,
            invoice_metadata={
                "payment_status": {
                    "status": "partially_paid",
                    "paid_cents": 40,
                    "outstanding_cents": 11,
                }
            },
        )
    )
    session.commit()

    response = client.get(
        "/api/v1/owners/statements",
        params={"entity_id": str(entity.id), "month": "2026-04"},
    )

    assert response.status_code == 200
    statements = response.json()["owners"]
    assert len(statements) == 3
    for statement in statements:
        invoice = statement["properties"][0]["invoices"][0]
        assert invoice["paid_cents"] <= invoice["total_cents"]
        assert invoice["paid_cents"] + invoice["outstanding_cents"] == invoice[
            "total_cents"
        ]
    assert sum(statement["invoiced_cents"] for statement in statements) == 51
    assert sum(statement["paid_cents"] for statement in statements) == 40
    assert sum(statement["outstanding_cents"] for statement in statements) == 11


def test_owner_statement_split_allocator_caps_paid_with_fixed_residue_order() -> None:
    """Allocator keeps paid within total even when residue ordering differs."""

    line = OwnerInvoiceEvidenceLine(
        invoice_draft_id=uuid4(),
        invoice_number="INV-SPLIT-CAP",
        title="Paid cap helper invoice",
        issue_date=date(2026, 4, 18),
        due_date=date(2026, 4, 30),
        total_cents=51,
        paid_cents=40,
        outstanding_cents=11,
        payment_status="partially_paid",
    )
    entries = [
        {"bucket_key": "a-small", "split_pct": 1.0},
        {"bucket_key": "b-middle", "split_pct": 3.0},
        {"bucket_key": "c-large", "split_pct": 96.0},
    ]

    allocated = _allocated_invoice_evidence_line(line, entries[0], entries)

    assert allocated.total_cents == 0
    assert allocated.paid_cents == 0
    assert allocated.outstanding_cents == 0


def test_owner_statement_split_allocator_normalizes_over_allocated_links() -> None:
    """Invalid split totals over 100 do not duplicate the source cents."""

    entries = [
        {"bucket_key": "first", "split_pct": 100.0},
        {"bucket_key": "second", "split_pct": 100.0},
    ]

    allocations = _allocated_cents_by_split(100_000, entries)

    assert sorted(allocations.values()) == [50_000, 50_000]
    assert sum(allocations.values()) == 100_000


def test_owner_statement_identity_disambiguates_duplicate_owner_labels_for_pdf(
    client: TestClient,
    session: Session,
) -> None:
    """Distinct Owner rows with the same label remain selectable."""

    entity = _entity(session)
    doc = StoredDocument(
        entity_id=entity.id,
        filename="duplicate-owner-labels.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.invoice,
    )
    session.add(doc)
    session.flush()
    bd = BillingDraft(
        entity_id=entity.id,
        document_id=doc.id,
        title="Duplicate owner labels",
        currency="AUD",
        status=BillingDraftStatus.approved,
    )
    session.add(bd)
    owner_a = Owner(
        entity_id=entity.id,
        legal_name="Duplicate Owner A Pty Ltd",
        trust_name="Duplicate Trust",
    )
    owner_b = Owner(
        entity_id=entity.id,
        legal_name="Duplicate Owner B Pty Ltd",
        trust_name="Duplicate Trust",
    )
    session.add_all([owner_a, owner_b])
    session.flush()

    for owner, property_name, total_cents in [
        (owner_a, "First Duplicate Property", 500_000),
        (owner_b, "Second Duplicate Property", 200_000),
    ]:
        prop = Property(
            entity_id=entity.id,
            name=property_name,
            street_address=f"{property_name} street",
            property_type=PropertyType.commercial_retail,
        )
        session.add(prop)
        session.flush()
        session.add(PropertyOwner(property_id=prop.id, owner_id=owner.id))
        session.add(
            InvoiceDraft(
                entity_id=entity.id,
                billing_draft_id=bd.id,
                property_id=prop.id,
                document_id=doc.id,
                status=InvoiceDraftStatus.approved,
                title=f"Invoice {property_name}",
                currency="AUD",
                issue_date=date(2026, 4, 12),
                subtotal_cents=total_cents,
                gst_cents=0,
                total_cents=total_cents,
                invoice_metadata={},
            )
        )
    session.commit()

    statements_response = client.get(
        "/api/v1/owners/statements",
        params={"entity_id": str(entity.id), "month": "2026-04"},
    )

    assert statements_response.status_code == 200
    owners = statements_response.json()["owners"]
    assert len(owners) == 2
    identities = [owner["owner_identity"] for owner in owners]
    assert len(set(identities)) == 2

    pdf_response = client.get(
        "/api/v1/owners/statements/pdf",
        params={
            "entity_id": str(entity.id),
            "month": "2026-04",
            "owner_identity": identities[1],
        },
    )
    assert pdf_response.status_code == 200
    text = "\n".join(
        page.extract_text() or ""
        for page in PdfReader(BytesIO(pdf_response.content)).pages
    )
    assert "Second Duplicate Property" in text
    assert "First Duplicate Property" not in text


def test_owner_statements_excludes_other_months(
    client: TestClient,
    session: Session,
) -> None:
    """Invoices outside the target month aren't counted."""

    _seed_owner_with_invoices(
        session,
        trust_name="Window Trust",
        trustee_name="WT Trustee Pty Ltd",
        properties=[
            (
                "Window Property",
                [
                    (date(2026, 3, 31), 100_000, 100_000),  # March, excluded
                    (date(2026, 4, 1), 200_000, 0),         # April, included
                    (date(2026, 4, 30), 300_000, 100_000),  # April, included
                    (date(2026, 5, 1), 400_000, 0),         # May, excluded
                ],
            )
        ],
    )
    entity = _entity(session)

    response = client.get(
        "/api/v1/owners/statements",
        params={"entity_id": str(entity.id), "month": "2026-04"},
    )
    assert response.status_code == 200
    owners = response.json()["owners"]
    assert len(owners) == 1
    owner = owners[0]
    assert owner["invoiced_cents"] == 500_000  # 200k + 300k
    assert owner["paid_cents"] == 100_000
    assert owner["invoice_count"] == 2


def test_owner_statements_rejects_malformed_month(
    client: TestClient,
    session: Session,
) -> None:
    entity = _entity(session)
    response = client.get(
        "/api/v1/owners/statements",
        params={"entity_id": str(entity.id), "month": "April 2026"},
    )
    assert response.status_code == 422


def test_owner_statements_unattributed_bucket(
    client: TestClient,
    session: Session,
) -> None:
    """A property with no Owner link falls into 'Unattributed'."""

    entity = _entity(session)
    doc = StoredDocument(
        entity_id=entity.id,
        filename="unattr.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.invoice,
    )
    session.add(doc)
    session.flush()
    bd = BillingDraft(
        entity_id=entity.id,
        document_id=doc.id,
        title="Unattributed Billing",
        currency="AUD",
        status=BillingDraftStatus.approved,
    )
    session.add(bd)
    session.flush()
    prop = Property(
        entity_id=entity.id,
        name="Unowned Property",
        street_address="123 Nowhere Lane",
        property_type=PropertyType.commercial_retail,
        owner_legal_name="Legacy Owner Text Pty Ltd",
        trustee_name="Legacy Trustee Text Pty Ltd",
        trust_name="Legacy Owner Text Trust",
        invoice_issuer_name="Legacy Owner Text Trust via Trustee",
    )
    session.add(prop)
    session.flush()
    session.add(
        InvoiceDraft(
            entity_id=entity.id,
            billing_draft_id=bd.id,
            property_id=prop.id,
            document_id=doc.id,
            status=InvoiceDraftStatus.approved,
            title="Unowned",
            currency="AUD",
            issue_date=date(2026, 4, 7),
            subtotal_cents=50_000,
            gst_cents=0,
            total_cents=50_000,
            invoice_metadata={},
        )
    )
    session.commit()

    response = client.get(
        "/api/v1/owners/statements",
        params={"entity_id": str(entity.id), "month": "2026-04"},
    )
    assert response.status_code == 200
    owners = response.json()["owners"]
    assert len(owners) == 1
    assert owners[0]["owner_identity"] == "Unattributed"
    assert owners[0]["invoiced_cents"] == 50_000


def test_owner_statement_pdf_downloads_review_pack(
    client: TestClient,
    session: Session,
) -> None:
    _set_operating_mode(session, OperatingMode.managing_agent)
    scope = _seed_owner_with_invoices(
        session,
        trust_name="PDF Trust",
        trustee_name="PDF Trustee Pty Ltd",
        properties=[("PDF Property", [(date(2026, 4, 10), 500_000, 125_000)])],
    )

    response = client.get(
        "/api/v1/owners/statements/pdf",
        params={
            "entity_id": scope["entity_id"],
            "month": "2026-04",
            "owner_identity": "PDF Trust (Trustee: PDF Trustee Pty Ltd)",
        },
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["content-disposition"] == (
        'attachment; filename="owner-statement-2026-04-pdf-trust-'
        'trustee-pdf-trustee-pty-ltd.pdf"'
    )
    assert response.content.startswith(b"%PDF-1.4")
    text = "\n".join(
        page.extract_text() or ""
        for page in PdfReader(BytesIO(response.content)).pages
    )
    assert "PDF Trust" in text
    assert "PDF Property" in text
    assert "$5,000" in text


def test_owner_statement_pdf_uses_entity_wording_for_self_managed_accounts(
    client: TestClient,
    session: Session,
) -> None:
    _set_operating_mode(session, OperatingMode.self_managed_owner)
    scope = _seed_owner_with_invoices(
        session,
        trust_name="Local Entity Trust",
        trustee_name="Local Entity Trustee Pty Ltd",
        properties=[
            ("Local Entity Property", [(date(2026, 4, 10), 500_000, 125_000)])
        ],
    )

    response = client.get(
        "/api/v1/owners/statements/pdf",
        params={
            "entity_id": scope["entity_id"],
            "month": "2026-04",
            "owner_identity": (
                "Local Entity Trust "
                "(Trustee: Local Entity Trustee Pty Ltd)"
            ),
        },
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["content-disposition"] == (
        'attachment; filename="entity-statement-2026-04-local-entity-trust-'
        'trustee-local-entity-trustee-pty-ltd.pdf"'
    )
    assert response.content.startswith(b"%PDF-1.4")
    text = "\n".join(
        page.extract_text() or ""
        for page in PdfReader(BytesIO(response.content)).pages
    )
    assert "LEASIUM ENTITY STATEMENT" in text
    assert "Review-only local entity-reporting export." in text
    assert "Entity: Local Entity Trust" in text
    assert "Not sent to owner" not in text


def test_owner_statement_pdf_wraps_long_finance_evidence_rows(
    client: TestClient,
    session: Session,
) -> None:
    """Long statement evidence should stay readable inside the PDF page."""

    entity = _entity(session)
    doc = StoredDocument(
        entity_id=entity.id,
        filename="long-evidence.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.invoice,
    )
    session.add(doc)
    session.flush()
    bd = BillingDraft(
        entity_id=entity.id,
        document_id=doc.id,
        title="Long Evidence Billing",
        currency="AUD",
        status=BillingDraftStatus.approved,
    )
    session.add(bd)
    session.flush()
    prop = Property(
        entity_id=entity.id,
        name=(
            "Long Evidence Property With Riverside Retail Arcade "
            "And Level Two Storage Tenancy"
        ),
        street_address="99 Long Evidence Road",
        property_type=PropertyType.commercial_retail,
        owner_legal_name="Long Evidence Trustee Pty Ltd",
        trustee_name="Long Evidence Trustee Pty Ltd",
        trust_name="Long Evidence Trust",
        invoice_issuer_name="Long Evidence Trust via Long Evidence Trustee Pty Ltd",
    )
    session.add(prop)
    session.flush()
    _link_owner_from_property_fields(session, prop)
    for index in range(12):
        session.add(
            InvoiceDraft(
                entity_id=entity.id,
                billing_draft_id=bd.id,
                property_id=prop.id,
                document_id=doc.id,
                status=InvoiceDraftStatus.approved,
                invoice_number=(
                    "INV-LONG-EVIDENCE-"
                    f"{index:02d}-XERO-REFERENCE-WITH-EXTENDED-SUFFIX"
                ),
                title=f"Long evidence invoice {index}",
                currency="AUD",
                issue_date=date(2026, 4, 12),
                due_date=date(2026, 4, 26),
                subtotal_cents=120_000,
                gst_cents=0,
                total_cents=120_000,
                invoice_metadata={
                    "payment_status": {
                        "status": "paid",
                        "paid_cents": 120_000,
                        "outstanding_cents": 0,
                    },
                    "xero_sync": {
                        "xero_invoice_id": (
                            "xero-long-evidence-invoice-id-"
                            f"{index:02d}-with-extra-provider-characters"
                        )
                    },
                    "xero_payment_reconciliation": {
                        "reference": (
                            "BANK REF LONG EVIDENCE WITH EXTENDED "
                            f"REFERENCE {index:02d}"
                        ),
                        "match_confidence": "high",
                        "bank_transaction_id": (
                            "bank-transaction-long-evidence-"
                            f"{index:02d}-with-extra-provider-characters"
                        ),
                    },
                },
            )
        )
    session.commit()

    response = client.get(
        "/api/v1/owners/statements/pdf",
        params={
            "entity_id": str(entity.id),
            "month": "2026-04",
            "owner_identity": (
                "Long Evidence Trust "
                "(Trustee: Long Evidence Trustee Pty Ltd)"
            ),
        },
    )

    assert response.status_code == 200
    reader = PdfReader(BytesIO(response.content))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    assert "INV-LONG-EVIDENCE-00-XERO-REFERENCE-WITH-EXTENDED-SUFFIX" in text
    assert "bank-transaction-long-evidence-00-with-extra-provider-characters" in text
    assert len(reader.pages) >= 2
    assert max(len(line) for line in text.splitlines()) <= 96


def test_owner_statement_pdf_pack_downloads_all_review_pdfs(
    client: TestClient,
    session: Session,
) -> None:
    _set_operating_mode(session, OperatingMode.managing_agent)
    scope = _seed_owner_with_invoices(
        session,
        trust_name="Pack Trust A",
        trustee_name="Pack Trustee A Pty Ltd",
        properties=[("Pack Property A", [(date(2026, 4, 10), 500_000, 500_000)])],
    )
    _seed_owner_with_invoices(
        session,
        trust_name="Pack Trust B",
        trustee_name="Pack Trustee B Pty Ltd",
        properties=[("Pack Property B", [(date(2026, 4, 11), 250_000, 0)])],
    )

    response = client.get(
        "/api/v1/owners/statements/pdf-pack",
        params={"entity_id": scope["entity_id"], "month": "2026-04"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert response.headers["content-disposition"].endswith(".zip\"")
    with ZipFile(BytesIO(response.content)) as archive:
        names = archive.namelist()
        assert "README-2026-04.txt" in names
        assert "MANIFEST-2026-04.csv" in names
        pdf_names = [name for name in names if name.endswith(".pdf")]
        assert len(pdf_names) == 2
        assert any("pack-trust-a" in name for name in pdf_names)
        assert any("pack-trust-b" in name for name in pdf_names)
        manifest = archive.read("MANIFEST-2026-04.csv").decode()
        readme = archive.read("README-2026-04.txt").decode()
        first_pdf = archive.read(pdf_names[0])
    assert "owner_identity" in manifest
    assert "Pack Trust A" in manifest
    assert "Pack Trust B" in manifest
    assert "payment_review" in manifest
    assert "Owners included: 2" in readme
    assert "Missing owner billing emails: 2" in readme
    assert first_pdf.startswith(b"%PDF-1.4")


def test_owner_statement_pdf_pack_uses_entity_wording_for_self_managed_accounts(
    client: TestClient,
    session: Session,
) -> None:
    _set_operating_mode(session, OperatingMode.self_managed_owner)
    scope = _seed_owner_with_invoices(
        session,
        trust_name="Local Pack Trust A",
        trustee_name="Local Pack Trustee A Pty Ltd",
        properties=[
            ("Local Pack Property A", [(date(2026, 4, 10), 500_000, 500_000)])
        ],
    )
    _seed_owner_with_invoices(
        session,
        trust_name="Local Pack Trust B",
        trustee_name="Local Pack Trustee B Pty Ltd",
        properties=[
            ("Local Pack Property B", [(date(2026, 4, 11), 250_000, 0)])
        ],
    )

    response = client.get(
        "/api/v1/owners/statements/pdf-pack",
        params={"entity_id": scope["entity_id"], "month": "2026-04"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert response.headers["content-disposition"] == (
        'attachment; filename="entity-statement-pack-2026-04.zip"'
    )
    with ZipFile(BytesIO(response.content)) as archive:
        names = archive.namelist()
        pdf_names = [name for name in names if name.endswith(".pdf")]
        manifest = archive.read("MANIFEST-2026-04.csv").decode()
        invoice_evidence = archive.read("INVOICE-EVIDENCE-2026-04.csv").decode()
        readme = archive.read("README-2026-04.txt").decode()

    assert len(pdf_names) == 2
    assert all(name.startswith("entity-statement-2026-04-") for name in pdf_names)
    assert "entity_identity" in manifest
    assert "owner_identity" not in manifest
    assert "billing_email" not in manifest
    assert "recipient_ready" not in manifest
    assert "entity_identity" in invoice_evidence
    assert "owner_identity" not in invoice_evidence
    assert "Local Pack Trust A" in manifest
    assert "Local Pack Trust B" in manifest
    assert "Entities included: 2" in readme
    assert "Missing owner billing emails" not in readme
    assert "recipient readiness" not in readme
    assert "owner totals" not in readme
    assert "local entity-reporting totals" in readme


def test_owner_statement_pdf_pack_csvs_escape_spreadsheet_formulas(
    client: TestClient,
    session: Session,
) -> None:
    _set_operating_mode(session, OperatingMode.managing_agent)
    entity = _entity(session)
    doc = StoredDocument(
        entity_id=entity.id,
        filename="formula-evidence.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.invoice,
    )
    session.add(doc)
    session.flush()
    bd = BillingDraft(
        entity_id=entity.id,
        document_id=doc.id,
        title="Formula Evidence Billing",
        currency="AUD",
        status=BillingDraftStatus.approved,
    )
    session.add(bd)
    session.flush()
    prop = Property(
        entity_id=entity.id,
        name="  -Formula Property",
        street_address="3 Formula Lane",
        property_type=PropertyType.commercial_retail,
        owner_legal_name="@Formula Trustee Pty Ltd",
        trustee_name="@Formula Trustee Pty Ltd",
        trust_name="=Formula Trust",
        invoice_issuer_name="=Formula Trust via @Formula Trustee Pty Ltd",
        billing_email="+owner@example.test",
    )
    session.add(prop)
    session.flush()
    _link_owner_from_property_fields(session, prop)
    session.add(
        InvoiceDraft(
            entity_id=entity.id,
            billing_draft_id=bd.id,
            property_id=prop.id,
            document_id=doc.id,
            status=InvoiceDraftStatus.approved,
            invoice_number="+INV-FORMULA-1",
            title="@Formula evidence invoice",
            currency="AUD",
            issue_date=date(2026, 4, 12),
            due_date=date(2026, 4, 26),
            subtotal_cents=120_000,
            gst_cents=0,
            total_cents=120_000,
            invoice_metadata={
                "payment_status": {
                    "status": "paid",
                    "paid_cents": 120_000,
                    "outstanding_cents": 0,
                },
                "xero_sync": {"xero_invoice_id": "=xero-formula-id"},
                "xero_payment_reconciliation": {
                    "reference": "  =BANK FORMULA REF",
                    "match_confidence": "high",
                    "bank_transaction_id": "-bank-formula-id",
                },
            },
        )
    )
    session.commit()

    response = client.get(
        "/api/v1/owners/statements/pdf-pack",
        params={"entity_id": str(entity.id), "month": "2026-04"},
    )

    assert response.status_code == 200
    with ZipFile(BytesIO(response.content)) as archive:
        manifest_csv = archive.read("MANIFEST-2026-04.csv").decode()
        evidence_csv = archive.read("INVOICE-EVIDENCE-2026-04.csv").decode()
    manifest_row = next(csv.DictReader(StringIO(manifest_csv)))
    evidence_row = next(csv.DictReader(StringIO(evidence_csv)))

    assert manifest_row["owner_identity"].startswith("'=Formula Trust")
    assert manifest_row["billing_email"] == "'+owner@example.test"
    assert evidence_row["owner_identity"].startswith("'=Formula Trust")
    assert evidence_row["property_name"] == "'  -Formula Property"
    assert evidence_row["invoice_number"] == "'+INV-FORMULA-1"
    assert evidence_row["title"] == "'@Formula evidence invoice"
    assert evidence_row["xero_invoice_id"] == "'=xero-formula-id"
    assert evidence_row["reconciliation_reference"] == "'=BANK FORMULA REF"
    assert evidence_row["reconciliation_bank_transaction_id"] == "'-bank-formula-id"


def test_owner_statement_exports_include_invoice_evidence(
    client: TestClient,
    session: Session,
) -> None:
    entity = _entity(session)
    doc = StoredDocument(
        entity_id=entity.id,
        filename="export-evidence.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.invoice,
    )
    session.add(doc)
    session.flush()
    bd = BillingDraft(
        entity_id=entity.id,
        document_id=doc.id,
        title="Export Evidence Billing",
        currency="AUD",
        status=BillingDraftStatus.approved,
    )
    session.add(bd)
    session.flush()
    prop = Property(
        entity_id=entity.id,
        name="Export Evidence Property",
        street_address="2 Evidence Lane",
        property_type=PropertyType.commercial_retail,
        owner_legal_name="Export Evidence Trustee Pty Ltd",
        trustee_name="Export Evidence Trustee Pty Ltd",
        trust_name="Export Evidence Trust",
        invoice_issuer_name="Export Evidence Trust via Export Evidence Trustee Pty Ltd",
    )
    session.add(prop)
    session.flush()
    _link_owner_from_property_fields(session, prop)
    session.add(
        InvoiceDraft(
            entity_id=entity.id,
            billing_draft_id=bd.id,
            property_id=prop.id,
            document_id=doc.id,
            status=InvoiceDraftStatus.approved,
            invoice_number="INV-EXPORT-EVIDENCE-1",
            title="Export evidence invoice",
            currency="AUD",
            issue_date=date(2026, 4, 12),
            due_date=date(2026, 4, 26),
            subtotal_cents=120_000,
            gst_cents=0,
            total_cents=120_000,
            invoice_metadata={
                "payment_status": {
                    "status": "paid",
                    "paid_cents": 120_000,
                    "outstanding_cents": 0,
                },
                "xero_payment_reconciliation": {
                    "reference": "BANK REF INV-EXPORT-EVIDENCE-1",
                    "match_confidence": "medium",
                    "bank_transaction_id": "bank-txn-export-evidence-1",
                },
            },
        )
    )
    session.commit()

    pdf_response = client.get(
        "/api/v1/owners/statements/pdf",
        params={
            "entity_id": str(entity.id),
            "month": "2026-04",
            "owner_identity": (
                "Export Evidence Trust "
                "(Trustee: Export Evidence Trustee Pty Ltd)"
            ),
        },
    )
    assert pdf_response.status_code == 200
    pdf_text = "\n".join(
        page.extract_text() or ""
        for page in PdfReader(BytesIO(pdf_response.content)).pages
    )
    assert "Invoice evidence" in pdf_text
    assert "INV-EXPORT-EVIDENCE-1" in pdf_text
    assert "BANK REF INV-EXPORT-EVIDENCE-1" in pdf_text

    zip_response = client.get(
        "/api/v1/owners/statements/pdf-pack",
        params={"entity_id": str(entity.id), "month": "2026-04"},
    )
    assert zip_response.status_code == 200
    with ZipFile(BytesIO(zip_response.content)) as archive:
        evidence_csv = archive.read("INVOICE-EVIDENCE-2026-04.csv").decode()
    assert "invoice_draft_id" in evidence_csv
    assert "INV-EXPORT-EVIDENCE-1" in evidence_csv
    assert "bank-txn-export-evidence-1" in evidence_csv


def test_send_owner_statement_requires_explicit_approval(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """Provider guardrail: a statement is never sent without approve=true."""

    _set_operating_mode(session, OperatingMode.managing_agent)
    scope = _seed_owner_with_invoices(
        session,
        trust_name="Approval Trust",
        trustee_name="AP Trustee",
        billing_email="owner@example.com",
        properties=[("Approval Property", [(date(2026, 4, 10), 500_000, 0)])],
    )
    statements = client.get(
        "/api/v1/owners/statements",
        params={"entity_id": scope["entity_id"], "month": "2026-04"},
    ).json()
    owner_identity = statements["owners"][0]["owner_identity"]

    def boom(invite: Any, settings_arg: Any) -> DeliveryResult:
        raise AssertionError("send must not run without explicit approval")

    monkeypatch.setattr("apps.api.routers.owners.send_owner_statement_email", boom)

    response = client.post(
        "/api/v1/owners/statements/send",
        params={"entity_id": scope["entity_id"]},
        json={"owner_identity": owner_identity, "month": "2026-04", "approve": False},
    )
    assert response.status_code == 400
    assert "approval" in response.json()["detail"].lower()
    listed = client.get(
        "/api/v1/owners/statements/dispatch",
        params={"entity_id": scope["entity_id"], "month": "2026-04"},
    ).json()
    assert listed["receipts"] == []


def test_send_owner_statement_forbidden_for_self_managed_accounts(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """Self-managed accounts keep reports but cannot send third-party owner email."""

    scope = _seed_owner_with_invoices(
        session,
        trust_name="Self Managed Trust",
        trustee_name="SM Trustee",
        billing_email="owner@example.com",
        properties=[("Self Managed Property", [(date(2026, 4, 10), 500_000, 0)])],
    )
    statements = client.get(
        "/api/v1/owners/statements",
        params={"entity_id": scope["entity_id"], "month": "2026-04"},
    ).json()
    owner_identity = statements["owners"][0]["owner_identity"]

    def boom(invite: Any, settings_arg: Any) -> DeliveryResult:
        raise AssertionError("self-managed mode must not reach SendGrid dispatch")

    monkeypatch.setattr("apps.api.routers.owners.send_owner_statement_email", boom)
    session.add(
        OwnerStatementDispatch(
            entity_id=UUID(scope["entity_id"]),
            owner_identity=owner_identity,
            owner_identity_key=owner_identity.casefold(),
            month="2026-04",
            channel="email",
            provider="sendgrid",
            status="queued",
            recipient_email="owner@example.com",
            subject="Existing owner statement receipt",
            provider_message_id="sg-existing",
            invoice_count=1,
            invoiced_cents=500_000,
            outstanding_cents=500_000,
        )
    )
    session.commit()

    dispatch_response = client.get(
        "/api/v1/owners/statements/dispatch",
        params={"entity_id": scope["entity_id"], "month": "2026-04"},
    )
    assert dispatch_response.status_code == 403

    response = client.post(
        "/api/v1/owners/statements/send",
        params={"entity_id": scope["entity_id"]},
        json={"owner_identity": owner_identity, "month": "2026-04", "approve": True},
    )
    assert response.status_code == 403
    assert "managing-agent" in response.json()["detail"]


def test_send_owner_statement_queues_and_is_idempotent(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """Approved send queues via SendGrid; a repeat send is idempotent."""

    _set_operating_mode(session, OperatingMode.managing_agent)
    scope = _seed_owner_with_invoices(
        session,
        trust_name="Queue Trust",
        trustee_name="Q Trustee",
        billing_email="owner@example.com",
        billing_contact_name="Owner Contact",
        properties=[("Queue Property", [(date(2026, 4, 10), 500_000, 100_000)])],
    )
    statements = client.get(
        "/api/v1/owners/statements",
        params={"entity_id": scope["entity_id"], "month": "2026-04"},
    ).json()
    owner = statements["owners"][0]
    owner_identity = owner["owner_identity"]
    assert owner["billing_email"] == "owner@example.com"

    configured = get_settings().model_copy(
        update={
            "owner_statement_email_enabled": True,
            "sendgrid_api_key": "sendgrid-secret",
            "sendgrid_from_email": "ops@leasium.test",
        }
    )
    monkeypatch.setattr("apps.api.routers.owners.get_settings", lambda: configured)

    calls: list[Any] = []

    def fake_send(invite: Any, settings_arg: Any) -> DeliveryResult:
        calls.append(invite)
        return DeliveryResult(
            channel="email",
            status="queued",
            provider="sendgrid",
            recipient=invite.recipient_email,
            provider_message_id="sg-msg-1",
            metadata={"subject": f"Owner statement for {invite.month}"},
        )

    monkeypatch.setattr(
        "apps.api.routers.owners.send_owner_statement_email", fake_send
    )

    response = client.post(
        "/api/v1/owners/statements/send",
        params={"entity_id": scope["entity_id"]},
        json={"owner_identity": owner_identity, "month": "2026-04", "approve": True},
    )
    assert response.status_code == 200
    receipt = response.json()
    assert receipt["status"] == "queued"
    assert receipt["provider_message_id"] == "sg-msg-1"
    assert receipt["recipient_email"] == "owner@example.com"
    assert receipt["invoice_count"] == 1
    assert len(calls) == 1
    assert calls[0].pdf_content is not None

    again = client.post(
        "/api/v1/owners/statements/send",
        params={"entity_id": scope["entity_id"]},
        json={"owner_identity": owner_identity, "month": "2026-04", "approve": True},
    )
    assert again.status_code == 200
    assert again.json()["id"] == receipt["id"]
    assert len(calls) == 1

    listed = client.get(
        "/api/v1/owners/statements/dispatch",
        params={"entity_id": scope["entity_id"], "month": "2026-04"},
    ).json()
    assert len(listed["receipts"]) == 1
    assert listed["receipts"][0]["provider_message_id"] == "sg-msg-1"
    assert "Xero" in listed["guardrail"]


def test_send_owner_statement_skips_without_recipient(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """A configured, approved send still skips when the owner has no email."""

    _set_operating_mode(session, OperatingMode.managing_agent)
    scope = _seed_owner_with_invoices(
        session,
        trust_name="No Email Trust",
        trustee_name="NE Trustee",
        billing_email=None,
        properties=[("No Email Property", [(date(2026, 4, 10), 300_000, 0)])],
    )
    statements = client.get(
        "/api/v1/owners/statements",
        params={"entity_id": scope["entity_id"], "month": "2026-04"},
    ).json()
    owner_identity = statements["owners"][0]["owner_identity"]

    configured = get_settings().model_copy(
        update={
            "owner_statement_email_enabled": True,
            "sendgrid_api_key": "sendgrid-secret",
            "sendgrid_from_email": "ops@leasium.test",
        }
    )
    monkeypatch.setattr("apps.api.routers.owners.get_settings", lambda: configured)

    response = client.post(
        "/api/v1/owners/statements/send",
        params={"entity_id": scope["entity_id"]},
        json={"owner_identity": owner_identity, "month": "2026-04", "approve": True},
    )
    assert response.status_code == 200
    receipt = response.json()
    assert receipt["status"] == "skipped"
    assert receipt["provider_message_id"] is None
    assert receipt["error"]


def test_send_owner_statement_skips_when_provider_unconfigured(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """Enabled but unconfigured SendGrid yields a skipped receipt, not a send."""

    _set_operating_mode(session, OperatingMode.managing_agent)
    scope = _seed_owner_with_invoices(
        session,
        trust_name="Unconfigured Trust",
        trustee_name="UN Trustee",
        billing_email="owner@example.com",
        properties=[("Unconfigured Property", [(date(2026, 4, 10), 200_000, 0)])],
    )
    statements = client.get(
        "/api/v1/owners/statements",
        params={"entity_id": scope["entity_id"], "month": "2026-04"},
    ).json()
    owner_identity = statements["owners"][0]["owner_identity"]

    configured = get_settings().model_copy(
        update={
            "owner_statement_email_enabled": True,
            "sendgrid_api_key": "",
            "sendgrid_from_email": "",
        }
    )
    monkeypatch.setattr("apps.api.routers.owners.get_settings", lambda: configured)

    response = client.post(
        "/api/v1/owners/statements/send",
        params={"entity_id": scope["entity_id"]},
        json={"owner_identity": owner_identity, "month": "2026-04", "approve": True},
    )
    assert response.status_code == 200
    receipt = response.json()
    assert receipt["status"] == "skipped"
    assert "configured" in (receipt["error"] or "").lower()


# --- Owner distributions + management-fee deduction ------------------------


def _seeded_owner(session: Session, trust_name: str) -> Owner:
    owner = session.scalar(select(Owner).where(Owner.trust_name == trust_name))
    assert owner is not None
    return owner


def test_owner_management_fee_pct_persists_and_round_trips(
    session: Session,
) -> None:
    """The management_fee_pct column persists and reads back as a Decimal."""

    entity = _entity(session)
    owner = Owner(
        entity_id=entity.id,
        legal_name="Fee Owner Pty Ltd",
        management_fee_pct=Decimal("7.5"),
    )
    session.add(owner)
    session.commit()

    session.expire(owner)
    refreshed = session.get(Owner, owner.id)
    assert refreshed is not None
    assert refreshed.management_fee_pct == Decimal("7.5")


def test_create_owner_accepts_management_fee_pct(
    client: TestClient,
    session: Session,
) -> None:
    entity = _entity(session)
    response = client.post(
        "/api/v1/owners",
        json={
            "entity_id": str(entity.id),
            "legal_name": "Created Fee Owner Pty Ltd",
            "management_fee_pct": 8.25,
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["management_fee_pct"] == 8.25

    owner = session.get(Owner, UUID(body["id"]))
    assert owner is not None
    assert owner.management_fee_pct == Decimal("8.25")


def test_update_owner_rejects_management_fee_pct_out_of_range(
    client: TestClient,
    session: Session,
) -> None:
    entity = _entity(session)
    owner = Owner(
        entity_id=entity.id,
        legal_name="Range Owner Pty Ltd",
    )
    session.add(owner)
    session.commit()

    response = client.patch(
        f"/api/v1/owners/{owner.id}",
        json={"management_fee_pct": 150},
    )
    assert response.status_code == 422


def test_owner_distribution_row_persists(session: Session) -> None:
    """An OwnerDistribution reviewed row persists its frozen snapshot."""

    entity = _entity(session)
    owner = Owner(
        entity_id=entity.id,
        legal_name="Row Owner Pty Ltd",
        management_fee_pct=Decimal("7.5"),
    )
    session.add(owner)
    session.flush()
    row = OwnerDistribution(
        entity_id=entity.id,
        owner_id=owner.id,
        owner_identity="Row Owner Pty Ltd",
        owner_identity_key="row owner pty ltd",
        month="2026-04",
        status="reviewed",
        rent_collected_cents=1_000_000,
        management_fee_pct=Decimal("7.5"),
        fee_ex_gst_cents=75_000,
        fee_gst_cents=7_500,
        fee_inc_gst_cents=82_500,
        net_distribution_cents=917_500,
        distribution_metadata={"entity_gst_registered": True},
    )
    session.add(row)
    session.commit()

    stored = session.get(OwnerDistribution, row.id)
    assert stored is not None
    assert stored.status == "reviewed"
    assert stored.net_distribution_cents == 917_500
    assert stored.management_fee_pct == Decimal("7.5")
    assert stored.distribution_metadata["entity_gst_registered"] is True


def _seed_distribution_scope(session: Session) -> _OwnerSeedScope:
    scope = _seed_owner_with_invoices(
        session,
        trust_name="Distribution Trust",
        trustee_name="Dist Trustee Pty Ltd",
        billing_email="owner@example.com",
        properties=[
            ("Distribution Property", [(date(2026, 4, 10), 1_000_000, 1_000_000)])
        ],
    )
    owner = _seeded_owner(session, "Distribution Trust")
    owner.management_fee_pct = Decimal("7.5")
    session.commit()
    return scope


def test_get_distributions_happy_path(
    client: TestClient,
    session: Session,
) -> None:
    """Managing-agent account computes the GST-inclusive fee + net distribution."""

    _set_operating_mode(session, OperatingMode.managing_agent)
    scope = _seed_distribution_scope(session)

    response = client.get(
        "/api/v1/owners/distributions",
        params={"entity_id": scope["entity_id"], "month": "2026-04"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["entity_gst_registered"] is True
    assert len(body["lines"]) == 1
    line = body["lines"][0]
    assert line["rent_collected_cents"] == 1_000_000
    assert line["management_fee_pct"] == 7.5
    assert line["fee_ex_gst_cents"] == 75_000
    assert line["fee_gst_cents"] == 7_500
    assert line["fee_inc_gst_cents"] == 82_500
    assert line["net_distribution_cents"] == 917_500
    assert line["needs_attention"] is False
    assert "not available" in body["guardrail"].lower()


def test_get_distributions_denied_for_self_managed_owner(
    client: TestClient,
    session: Session,
) -> None:
    """Self-managed owner-operators do not see owner distributions."""

    _set_operating_mode(session, OperatingMode.self_managed_owner)
    scope = _seed_distribution_scope(session)

    response = client.get(
        "/api/v1/owners/distributions",
        params={"entity_id": scope["entity_id"], "month": "2026-04"},
    )
    assert response.status_code == 403
    detail = response.json()["detail"].lower()
    assert "managing-agent" in detail
    assert "hybrid" in detail


def test_get_distributions_allowed_for_hybrid(
    client: TestClient,
    session: Session,
) -> None:
    _set_operating_mode(session, OperatingMode.hybrid)
    scope = _seed_distribution_scope(session)

    response = client.get(
        "/api/v1/owners/distributions",
        params={"entity_id": scope["entity_id"], "month": "2026-04"},
    )
    assert response.status_code == 200
    assert len(response.json()["lines"]) == 1


def test_distribution_pdf_returns_document_for_managing_agent(
    client: TestClient,
    session: Session,
) -> None:
    """Managing-agent accounts get a review-only distribution summary PDF."""

    _set_operating_mode(session, OperatingMode.managing_agent)
    scope = _seed_distribution_scope(session)

    response = client.get(
        "/api/v1/owners/distributions/pdf",
        params={"entity_id": scope["entity_id"], "month": "2026-04"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["content-disposition"] == (
        'attachment; filename="owner-distributions-2026-04.pdf"'
    )
    assert response.content.startswith(b"%PDF-1.4")
    text = "\n".join(
        page.extract_text() or ""
        for page in PdfReader(BytesIO(response.content)).pages
    )
    assert "OWNER DISTRIBUTIONS" in text
    assert "Distribution Trust" in text
    # Net of rent 1,000,000c @ 7.5% inc-GST = 917,500c, formatted as dollars.
    assert "$9,175" in text  # net distribution
    assert "Net to owners" in text
    assert "no payment" in text.lower() or "no money" in text.lower()


def test_distribution_pdf_denied_for_self_managed_owner(
    client: TestClient,
    session: Session,
) -> None:
    """Self-managed owner-operators cannot export the distribution PDF."""

    _set_operating_mode(session, OperatingMode.self_managed_owner)
    scope = _seed_distribution_scope(session)

    response = client.get(
        "/api/v1/owners/distributions/pdf",
        params={"entity_id": scope["entity_id"], "month": "2026-04"},
    )

    assert response.status_code == 403
    detail = response.json()["detail"].lower()
    assert "managing-agent" in detail
    assert "hybrid" in detail


def test_distribution_pdf_sends_no_provider_call(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """Generating the distribution PDF fires no email/SMS/Xero/payment call."""

    _set_operating_mode(session, OperatingMode.managing_agent)
    scope = _seed_distribution_scope(session)

    import apps.api.routers.owners as owners_router

    def _fail(*_args: Any, **_kwargs: Any) -> None:  # pragma: no cover - guard
        raise AssertionError("No provider send may occur for a PDF export.")

    # Any owner-statement email path is review-first and must not be invoked by
    # the distribution PDF export.
    monkeypatch.setattr(owners_router, "send_owner_statement_email", _fail)
    monkeypatch.setattr(owners_router, "configured_rail", _fail, raising=False)

    response = client.get(
        "/api/v1/owners/distributions/pdf",
        params={"entity_id": scope["entity_id"], "month": "2026-04"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    # No reviewed-distribution row was written by a read-only export.
    rows = session.scalars(select(OwnerDistribution)).all()
    assert rows == []


def test_review_distribution_requires_explicit_approval(
    client: TestClient,
    session: Session,
) -> None:
    """No reviewed record is written without approve=true."""

    _set_operating_mode(session, OperatingMode.managing_agent)
    scope = _seed_distribution_scope(session)
    distributions = client.get(
        "/api/v1/owners/distributions",
        params={"entity_id": scope["entity_id"], "month": "2026-04"},
    ).json()
    owner_identity = distributions["lines"][0]["owner_identity"]

    response = client.post(
        "/api/v1/owners/distributions/review",
        params={"entity_id": scope["entity_id"], "month": "2026-04"},
        json={"owner_identity": owner_identity, "approve": False},
    )
    assert response.status_code == 400
    assert "approval" in response.json()["detail"].lower()

    rows = list(
        session.scalars(
            select(OwnerDistribution).where(
                OwnerDistribution.entity_id == UUID(scope["entity_id"])
            )
        ).all()
    )
    assert rows == []


def test_review_distribution_writes_reviewed_record_without_moving_money(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """Reviewing freezes the snapshot but never calls the payment rail."""

    _set_operating_mode(session, OperatingMode.managing_agent)
    scope = _seed_distribution_scope(session)
    distributions = client.get(
        "/api/v1/owners/distributions",
        params={"entity_id": scope["entity_id"], "month": "2026-04"},
    ).json()
    owner_identity = distributions["lines"][0]["owner_identity"]

    def boom(settings_arg: Any) -> str | None:
        raise AssertionError("review must not call the payment rail")

    monkeypatch.setattr(
        "stewart.integrations.payment_rails.configured_rail", boom
    )

    response = client.post(
        "/api/v1/owners/distributions/review",
        params={"entity_id": scope["entity_id"], "month": "2026-04"},
        json={"owner_identity": owner_identity, "approve": True},
    )
    assert response.status_code == 200
    # configured_rail still importable and untouched.
    assert callable(configured_rail)

    rows = list(
        session.scalars(
            select(OwnerDistribution).where(
                OwnerDistribution.entity_id == UUID(scope["entity_id"])
            )
        ).all()
    )
    assert len(rows) == 1
    row = rows[0]
    assert row.status == "reviewed"
    assert row.rent_collected_cents == 1_000_000
    assert row.fee_inc_gst_cents == 82_500
    assert row.net_distribution_cents == 917_500
    assert row.reviewed_by_user_id is not None
    assert row.reviewed_at is not None


def test_review_distribution_is_idempotent_for_same_owner_month(
    client: TestClient,
    session: Session,
) -> None:
    """Re-reviewing the same owner + month updates in place, not appends."""

    _set_operating_mode(session, OperatingMode.managing_agent)
    scope = _seed_distribution_scope(session)
    distributions = client.get(
        "/api/v1/owners/distributions",
        params={"entity_id": scope["entity_id"], "month": "2026-04"},
    ).json()
    owner_identity = distributions["lines"][0]["owner_identity"]

    first = client.post(
        "/api/v1/owners/distributions/review",
        params={"entity_id": scope["entity_id"], "month": "2026-04"},
        json={"owner_identity": owner_identity, "approve": True},
    )
    assert first.status_code == 200
    again = client.post(
        "/api/v1/owners/distributions/review",
        params={"entity_id": scope["entity_id"], "month": "2026-04"},
        json={"owner_identity": owner_identity, "approve": True},
    )
    assert again.status_code == 200

    rows = list(
        session.scalars(
            select(OwnerDistribution).where(
                OwnerDistribution.entity_id == UUID(scope["entity_id"]),
                OwnerDistribution.month == "2026-04",
            )
        ).all()
    )
    assert len(rows) == 1


def _review_distribution(
    client: TestClient,
    entity_id: str,
    owner_identity: str,
    month: str,
) -> None:
    response = client.post(
        "/api/v1/owners/distributions/review",
        params={"entity_id": entity_id, "month": month},
        json={"owner_identity": owner_identity, "approve": True},
    )
    assert response.status_code == 200


def test_distribution_history_returns_reviewed_records_newest_first(
    client: TestClient,
    session: Session,
) -> None:
    """The history endpoint returns persisted reviewed rows, newest first."""

    _set_operating_mode(session, OperatingMode.managing_agent)
    scope = _seed_distribution_scope(session)
    owner = _seeded_owner(session, "Distribution Trust")
    owner_identity = "Distribution Trust (Trustee: Dist Trustee Pty Ltd)"

    # Two reviewed months for the same owner; the later month must come first.
    _review_distribution(client, scope["entity_id"], owner_identity, "2026-03")
    _review_distribution(client, scope["entity_id"], owner_identity, "2026-04")

    response = client.get(
        "/api/v1/owners/distributions/history",
        params={"entity_id": scope["entity_id"]},
    )
    assert response.status_code == 200
    body = response.json()
    assert "not available" in body["guardrail"].lower()
    records = body["records"]
    assert len(records) == 2
    # Newest created_at first — 2026-04 was reviewed after 2026-03.
    assert records[0]["month"] == "2026-04"
    assert records[1]["month"] == "2026-03"
    assert records[0]["status"] == "reviewed"
    assert records[0]["owner_id"] == str(owner.id)
    assert records[0]["net_distribution_cents"] == 917_500
    assert records[0]["reviewed_at"] is not None


def test_distribution_history_filters_by_owner_and_month(
    client: TestClient,
    session: Session,
) -> None:
    """owner_id and month filters narrow the persisted history rows."""

    _set_operating_mode(session, OperatingMode.managing_agent)
    scope = _seed_distribution_scope(session)
    owner_a = _seeded_owner(session, "Distribution Trust")
    owner_a_identity = "Distribution Trust (Trustee: Dist Trustee Pty Ltd)"

    other = _seed_owner_with_invoices(
        session,
        trust_name="History Trust B",
        trustee_name="History Trustee B Pty Ltd",
        billing_email="owner-b@example.com",
        properties=[
            ("History Property B", [(date(2026, 4, 12), 400_000, 400_000)])
        ],
    )
    assert other["entity_id"] == scope["entity_id"]
    owner_b = _seeded_owner(session, "History Trust B")
    owner_b.management_fee_pct = Decimal("5")
    session.commit()
    owner_b_identity = "History Trust B (Trustee: History Trustee B Pty Ltd)"

    _review_distribution(client, scope["entity_id"], owner_a_identity, "2026-03")
    _review_distribution(client, scope["entity_id"], owner_a_identity, "2026-04")
    _review_distribution(client, scope["entity_id"], owner_b_identity, "2026-04")

    by_owner = client.get(
        "/api/v1/owners/distributions/history",
        params={"entity_id": scope["entity_id"], "owner_id": str(owner_a.id)},
    ).json()["records"]
    assert {record["month"] for record in by_owner} == {"2026-03", "2026-04"}
    assert all(record["owner_id"] == str(owner_a.id) for record in by_owner)

    by_owner_month = client.get(
        "/api/v1/owners/distributions/history",
        params={
            "entity_id": scope["entity_id"],
            "owner_id": str(owner_b.id),
            "month": "2026-04",
        },
    ).json()["records"]
    assert len(by_owner_month) == 1
    assert by_owner_month[0]["owner_id"] == str(owner_b.id)
    assert by_owner_month[0]["month"] == "2026-04"


def test_distribution_history_denied_for_self_managed_owner(
    client: TestClient,
    session: Session,
) -> None:
    """Self-managed owner-operators cannot reach the distribution history."""

    _set_operating_mode(session, OperatingMode.self_managed_owner)
    scope = _seed_distribution_scope(session)

    response = client.get(
        "/api/v1/owners/distributions/history",
        params={"entity_id": scope["entity_id"]},
    )
    assert response.status_code == 403
    detail = response.json()["detail"].lower()
    assert "managing-agent" in detail
    assert "hybrid" in detail


def _seed_distribution_scope_without_billing_email(
    session: Session,
) -> _OwnerSeedScope:
    scope = _seed_owner_with_invoices(
        session,
        trust_name="Distribution Trust",
        trustee_name="Dist Trustee Pty Ltd",
        billing_email=None,
        properties=[
            ("Distribution Property", [(date(2026, 4, 10), 1_000_000, 1_000_000)])
        ],
    )
    owner = _seeded_owner(session, "Distribution Trust")
    owner.management_fee_pct = Decimal("7.5")
    session.commit()
    return scope


def test_distribution_dispatch_review_returns_recipient_readiness_and_draft(
    client: TestClient,
    session: Session,
) -> None:
    """Ready when the owner billing email is present; draft carries net + period."""

    _set_operating_mode(session, OperatingMode.managing_agent)
    scope = _seed_distribution_scope(session)

    response = client.get(
        "/api/v1/owners/distributions/dispatch-review",
        params={"entity_id": scope["entity_id"], "month": "2026-04"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["month"] == "2026-04"
    assert len(body["drafts"]) == 1
    draft = body["drafts"][0]
    assert draft["recipient_email"] == "owner@example.com"
    assert draft["ready"] is True
    assert draft["blocked_reason"] is None
    assert draft["net_distribution_cents"] == 917_500
    # Owner-facing draft summarises the net distribution and the period.
    assert "2026-04" in draft["subject"]
    assert "2026-04" in draft["body"]
    assert "$9,175" in draft["body"]  # net distribution
    assert "not been sent" in draft["body"].lower()
    assert "not available" in body["guardrail"].lower()


def test_distribution_dispatch_review_flags_missing_billing_email(
    client: TestClient,
    session: Session,
) -> None:
    """A missing billing email blocks readiness with a reason but still 200s."""

    _set_operating_mode(session, OperatingMode.managing_agent)
    scope = _seed_distribution_scope_without_billing_email(session)

    response = client.get(
        "/api/v1/owners/distributions/dispatch-review",
        params={"entity_id": scope["entity_id"], "month": "2026-04"},
    )
    assert response.status_code == 200
    draft = response.json()["drafts"][0]
    assert draft["recipient_email"] is None
    assert draft["ready"] is False
    assert "billing email" in draft["blocked_reason"].lower()
    # The draft body is still built for operator review.
    assert "$9,175" in draft["body"]


def test_distribution_dispatch_review_denied_for_self_managed_owner(
    client: TestClient,
    session: Session,
) -> None:
    """Self-managed owner-operators cannot reach the dispatch-review draft."""

    _set_operating_mode(session, OperatingMode.self_managed_owner)
    scope = _seed_distribution_scope(session)

    response = client.get(
        "/api/v1/owners/distributions/dispatch-review",
        params={"entity_id": scope["entity_id"], "month": "2026-04"},
    )
    assert response.status_code == 403
    detail = response.json()["detail"].lower()
    assert "managing-agent" in detail
    assert "hybrid" in detail


def test_distribution_dispatch_review_sends_nothing_and_persists_nothing(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """The draft fires no email/rail call and writes no OwnerDistribution row."""

    _set_operating_mode(session, OperatingMode.managing_agent)
    scope = _seed_distribution_scope(session)

    import apps.api.routers.owners as owners_router

    def _fail(*_args: Any, **_kwargs: Any) -> None:  # pragma: no cover - guard
        raise AssertionError("Dispatch-review is review-only — no send may occur.")

    monkeypatch.setattr(owners_router, "send_owner_statement_email", _fail)
    monkeypatch.setattr(owners_router, "configured_rail", _fail, raising=False)

    response = client.get(
        "/api/v1/owners/distributions/dispatch-review",
        params={"entity_id": scope["entity_id"], "month": "2026-04"},
    )
    assert response.status_code == 200
    assert len(response.json()["drafts"]) == 1
    # No reviewed-distribution row was written by a read-only draft.
    rows = list(
        session.scalars(
            select(OwnerDistribution).where(
                OwnerDistribution.entity_id == UUID(scope["entity_id"])
            )
        ).all()
    )
    assert rows == []
