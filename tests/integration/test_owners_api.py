"""Owner statements API tests."""

from datetime import date
from io import BytesIO
from typing import Any, TypedDict
from uuid import uuid4
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
    Owner,
    Property,
    PropertyOwner,
    PropertyType,
    StoredDocument,
)
from stewart.core.settings import get_settings
from stewart.integrations.communications import DeliveryResult


class _OwnerSeedScope(TypedDict):
    entity_id: str
    property_ids: list[str]


def _entity(session: Session) -> Entity:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return entity


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
    assert response.headers["content-disposition"].endswith(".pdf\"")
    assert response.content.startswith(b"%PDF-1.4")
    text = "\n".join(
        page.extract_text() or ""
        for page in PdfReader(BytesIO(response.content)).pages
    )
    assert "PDF Trust" in text
    assert "PDF Property" in text
    assert "$5,000" in text


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


def test_send_owner_statement_queues_and_is_idempotent(
    client: TestClient,
    session: Session,
    monkeypatch,
) -> None:
    """Approved send queues via SendGrid; a repeat send is idempotent."""

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
