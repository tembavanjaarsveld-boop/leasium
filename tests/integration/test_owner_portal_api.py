"""Read-only owner portal API tests."""

from datetime import date, datetime

from fastapi.testclient import TestClient
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


def _entity(session: Session) -> Entity:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return entity


def _seed_owner_portal_owner(session: Session) -> Owner:
    entity = _entity(session)
    doc = StoredDocument(
        entity_id=entity.id,
        filename="owner-portal-seed.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.invoice,
    )
    session.add(doc)
    session.flush()
    draft = BillingDraft(
        entity_id=entity.id,
        document_id=doc.id,
        title="Owner portal seed billing",
        currency="AUD",
        status=BillingDraftStatus.approved,
    )
    owner = Owner(
        entity_id=entity.id,
        legal_name="SKJ Holdings Pty Ltd",
        abn="11222333444",
        billing_contact_name="Mia Accounts",
        billing_email="owners@queenstreet.example",
        gst_registered=True,
    )
    session.add_all([draft, owner])
    session.flush()

    properties = [
        ("Queen Street Retail Centre", 60.0, 880_000, 0),
        ("King Street Offices", 40.0, 880_000, 0),
    ]
    for property_name, split_pct, total_cents, paid_cents in properties:
        prop = Property(
            entity_id=entity.id,
            name=property_name,
            street_address=f"{property_name} Street",
            property_type=PropertyType.commercial_retail,
        )
        session.add(prop)
        session.flush()
        session.add(
            PropertyOwner(property_id=prop.id, owner_id=owner.id, split_pct=split_pct)
        )
        session.add(
            InvoiceDraft(
                entity_id=entity.id,
                billing_draft_id=draft.id,
                property_id=prop.id,
                document_id=doc.id,
                status=InvoiceDraftStatus.approved,
                invoice_number=f"INV-{property_name[:4].upper()}",
                title=f"May invoice for {property_name}",
                currency="AUD",
                issue_date=date(2026, 5, 15),
                subtotal_cents=total_cents,
                gst_cents=0,
                total_cents=total_cents,
                invoice_metadata={
                    "paid_cents": paid_cents,
                    "xero_sync": {"xero_invoice_id": "xero-owner-portal"},
                    "xero_payment_reconciliation": {
                        "reference": "BANK REF OWNER-PORTAL",
                        "match_confidence": "high",
                        "bank_transaction_id": "bank-owner-portal",
                    },
                },
            )
        )
    session.commit()
    return owner


def test_owner_portal_preview_returns_read_only_owner_summary(
    client: TestClient,
    session: Session,
) -> None:
    owner = _seed_owner_portal_owner(session)

    response = client.get(
        f"/api/v1/owner-portal/{owner.id}",
        params={"month": "2026-05"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["auth"] == {
        "mode": "operator_preview",
        "token_source": "bearer",
        "owner_auth_configured": True,
        "boundary": "operator_session",
        "detail": (
            "Read-only operator preview scoped by entity role; no owner portal "
            "account is created."
        ),
    }
    assert body["owner"]["id"] == str(owner.id)
    assert body["owner"]["display_name"] == "SKJ Holdings Pty Ltd"
    assert body["owner"]["billing_contact_name"] == "Mia Accounts"
    assert body["owner"]["billing_email"] == "owners@queenstreet.example"
    assert body["owner"]["abn"] == "11222333444"
    assert body["owner"]["gst_registered"] is True
    assert [row["property_name"] for row in body["properties"]] == [
        "King Street Offices",
        "Queen Street Retail Centre",
    ]
    assert [row["split_pct"] for row in body["properties"]] == [40.0, 60.0]
    assert body["statement"]["month"] == "2026-05"
    assert body["statement"]["owner_identity"] == "SKJ Holdings Pty Ltd"
    assert body["statement"]["property_count"] == 2
    assert body["statement"]["invoice_count"] == 2
    assert body["statement"]["invoiced_cents"] == 1_760_000
    assert body["statement"]["paid_cents"] == 0
    assert body["statement"]["outstanding_cents"] == 1_760_000
    assert len(body["statement"]["properties"]) == 2
    assert "invoices" not in body["statement"]["properties"][0]
    assert body["guardrails"] == [
        (
            "Read-only owner portal preview: viewing this page does not send "
            "owner email, download or send PDFs, write Xero data, reconcile "
            "payments, dispatch invoices, refresh providers, or mutate "
            "provider history."
        )
    ]


def test_owner_portal_preview_hides_deleted_owners(
    client: TestClient,
    session: Session,
) -> None:
    owner = _seed_owner_portal_owner(session)
    owner.deleted_at = datetime(2026, 5, 31)
    session.commit()

    response = client.get(
        f"/api/v1/owner-portal/{owner.id}",
        params={"month": "2026-05"},
    )

    assert response.status_code == 404


def test_owner_portal_preview_requires_explicit_statement_month(
    client: TestClient,
    session: Session,
) -> None:
    owner = _seed_owner_portal_owner(session)

    response = client.get(f"/api/v1/owner-portal/{owner.id}")

    assert response.status_code == 422


def test_owner_portal_preview_does_not_expose_cross_entity_property_links(
    client: TestClient,
    session: Session,
) -> None:
    owner = _seed_owner_portal_owner(session)
    entity = _entity(session)
    other_entity = Entity(organisation_id=entity.organisation_id, name="Other Co")
    session.add(other_entity)
    session.flush()
    other_property = Property(
        entity_id=other_entity.id,
        name="Other Entity Property",
        street_address="99 Other Street",
        property_type=PropertyType.commercial_office,
    )
    session.add(other_property)
    session.flush()
    session.add(
        PropertyOwner(property_id=other_property.id, owner_id=owner.id, split_pct=100)
    )
    session.commit()

    response = client.get(
        f"/api/v1/owner-portal/{owner.id}",
        params={"month": "2026-05"},
    )

    assert response.status_code == 200
    property_names = [row["property_name"] for row in response.json()["properties"]]
    assert "Other Entity Property" not in property_names
