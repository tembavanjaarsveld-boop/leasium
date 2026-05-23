"""Owner statements API tests.

Backend-only v1 of the owner monthly statements feature.
"""

from datetime import date
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import (
    BillingDraft,
    BillingDraftStatus,
    Entity,
    InvoiceDraft,
    InvoiceDraftStatus,
    Property,
    PropertyType,
    StoredDocument,
    DocumentCategory,
)


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
) -> dict[str, str]:
    """Seed a trust + N properties each with M invoices.

    Each invoice tuple is (issue_date, total_cents, paid_cents).
    Returns the owner identity label and the property IDs.
    """

    entity = _entity(session)
    # Each invoice needs a billing_draft + a stored_document.
    bd = BillingDraft(
        entity_id=entity.id,
        title=f"Billing for {trust_name}",
        currency="AUD",
        status=BillingDraftStatus.approved,
        billed_total_cents=0,
        paid_total_cents=0,
    )
    session.add(bd)
    session.flush()
    doc = StoredDocument(
        entity_id=entity.id,
        filename="owner-statement-seed.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.invoice,
    )
    session.add(doc)
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
    bd = BillingDraft(
        entity_id=entity.id,
        title="Unattributed Billing",
        currency="AUD",
        status=BillingDraftStatus.approved,
        billed_total_cents=0,
        paid_total_cents=0,
    )
    doc = StoredDocument(
        entity_id=entity.id,
        filename="unattr.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.invoice,
    )
    session.add_all([bd, doc])
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
