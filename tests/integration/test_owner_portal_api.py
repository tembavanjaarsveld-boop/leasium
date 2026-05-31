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
    Tenant,
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


def _linked_owner_property(session: Session, owner: Owner) -> Property:
    prop = session.scalar(
        select(Property)
        .join(PropertyOwner, PropertyOwner.property_id == Property.id)
        .where(PropertyOwner.owner_id == owner.id)
        .order_by(Property.name.asc())
    )
    assert prop is not None
    return prop


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
    assert body["statement"]["invoiced_cents"] == 880_000
    assert body["statement"]["paid_cents"] == 0
    assert body["statement"]["outstanding_cents"] == 880_000
    assert len(body["statement"]["properties"]) == 2
    assert [
        (row["property_name"], row["invoiced_cents"], row["outstanding_cents"])
        for row in body["statement"]["properties"]
    ] == [
        ("Queen Street Retail Centre", 528_000, 528_000),
        ("King Street Offices", 352_000, 352_000),
    ]
    assert "invoices" not in body["statement"]["properties"][0]
    assert body["guardrails"] == [
        (
            "Read-only owner portal: opening this page does not send owner "
            "email, dispatch invoices, write Xero data, reconcile payments, "
            "refresh providers, or mutate provider history."
        ),
        (
            "Shared document downloads are account-scoped and limited to files "
            "explicitly shared by the property team for this owner; no owner "
            "statement PDFs are generated or sent from the portal."
        ),
    ]


def test_owner_portal_statement_matches_duplicate_shared_owner_by_owner_id(
    client: TestClient,
    session: Session,
) -> None:
    """Duplicate-label co-owners on the same property get their own split."""

    entity = _entity(session)
    doc = StoredDocument(
        entity_id=entity.id,
        filename="owner-portal-duplicate-split.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.invoice,
    )
    session.add(doc)
    session.flush()
    draft = BillingDraft(
        entity_id=entity.id,
        document_id=doc.id,
        title="Owner portal duplicate split billing",
        currency="AUD",
        status=BillingDraftStatus.approved,
    )
    owner_a = Owner(
        entity_id=entity.id,
        legal_name="Duplicate Shared Owner Pty Ltd",
        billing_email="shared-a@example.test",
    )
    owner_b = Owner(
        entity_id=entity.id,
        legal_name="Duplicate Shared Owner Pty Ltd",
        billing_email="shared-b@example.test",
    )
    prop = Property(
        entity_id=entity.id,
        name="Duplicate Shared Property",
        street_address="20 Shared Street",
        property_type=PropertyType.commercial_retail,
    )
    session.add_all([draft, owner_a, owner_b, prop])
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
            billing_draft_id=draft.id,
            property_id=prop.id,
            document_id=doc.id,
            status=InvoiceDraftStatus.approved,
            title="Duplicate shared owner invoice",
            currency="AUD",
            issue_date=date(2026, 5, 15),
            subtotal_cents=100_000,
            gst_cents=0,
            total_cents=100_000,
            invoice_metadata={"paid_cents": 0},
        )
    )
    session.commit()

    response = client.get(
        f"/api/v1/owner-portal/{owner_b.id}",
        params={"month": "2026-05"},
    )

    assert response.status_code == 200, response.text
    statement = response.json()["statement"]
    assert statement["owner_identity"].startswith("Duplicate Shared Owner Pty Ltd")
    assert statement["invoiced_cents"] == 40_000
    assert statement["properties"][0]["invoiced_cents"] == 40_000


def test_owner_portal_lists_only_explicit_owner_visible_property_documents(
    client: TestClient,
    session: Session,
) -> None:
    owner = _seed_owner_portal_owner(session)
    entity = _entity(session)
    linked_property = _linked_owner_property(session, owner)
    tenant = Tenant(entity_id=entity.id, legal_name="Tenant Private Pty Ltd")
    unlinked_property = Property(
        entity_id=entity.id,
        name="Unlinked Owner Property",
        street_address="9 Other Street",
        property_type=PropertyType.commercial_office,
    )
    session.add_all([tenant, unlinked_property])
    session.flush()
    visible_doc = StoredDocument(
        entity_id=entity.id,
        property_id=linked_property.id,
        filename="owner-visible-report.pdf",
        content_type="application/pdf",
        byte_size=len(b"owner visible"),
        file_data=b"owner visible",
        category=DocumentCategory.other,
        notes="Quarterly property report",
        document_metadata={
            "source": "operator_upload",
            "owner_portal_visible": True,
        },
    )
    hidden_doc = StoredDocument(
        entity_id=entity.id,
        property_id=linked_property.id,
        filename="internal-only.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.other,
        document_metadata={"source": "operator_upload"},
    )
    tenant_doc = StoredDocument(
        entity_id=entity.id,
        property_id=linked_property.id,
        tenant_id=tenant.id,
        filename="tenant-private.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.other,
        document_metadata={"owner_portal_visible": True},
    )
    cross_property_doc = StoredDocument(
        entity_id=entity.id,
        property_id=unlinked_property.id,
        filename="other-owner.pdf",
        byte_size=1,
        file_data=b"x",
        category=DocumentCategory.other,
        document_metadata={"owner_portal_visible": True},
    )
    session.add_all([visible_doc, hidden_doc, tenant_doc, cross_property_doc])
    session.commit()

    response = client.get(
        f"/api/v1/owner-portal/{owner.id}",
        params={"month": "2026-05"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["documents"]) == 1
    document = body["documents"][0]
    assert document["id"] == str(visible_doc.id)
    assert document["property_id"] == str(linked_property.id)
    assert document["property_name"] == linked_property.name
    assert document["filename"] == "owner-visible-report.pdf"
    assert document["content_type"] == "application/pdf"
    assert document["byte_size"] == len(b"owner visible")
    assert document["category"] == "other"
    assert document["notes"] == "Quarterly property report"
    assert document["source_label"] == "Shared by property team"
    assert "source" not in document
    assert document["created_at"]
    assert "file_data" not in document


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
