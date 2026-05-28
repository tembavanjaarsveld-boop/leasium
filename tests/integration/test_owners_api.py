"""Owner statements API tests."""

from datetime import date
from io import BytesIO
from typing import TypedDict
from zipfile import ZipFile

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
    Property,
    PropertyType,
    StoredDocument,
)


class _OwnerSeedScope(TypedDict):
    entity_id: str
    property_ids: list[str]


def _entity(session: Session) -> Entity:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return entity


def _seed_owner_with_invoices(
    session: Session,
    *,
    trust_name: str,
    trustee_name: str,
    properties: list[tuple[str, list[tuple[date, int, int]]]],
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
        )
        session.add(prop)
        session.flush()
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
    """A property with no owner identification falls into 'Unattributed'."""

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
