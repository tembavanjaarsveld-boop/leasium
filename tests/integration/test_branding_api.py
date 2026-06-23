"""Entity invoice-branding API tests.

Branding is local configuration: these endpoints must never trigger a provider
call (Xero/email/SMS/payment). They feed the branded invoice render.
"""

from types import SimpleNamespace
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import Entity
from stewart.integrations.invoice_render import resolve_invoice_brand


def _seed_entity_id(session: Session) -> str:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return str(entity.id)


def test_entity_branding_empty_then_saves_and_merges(
    client: TestClient,
    session: Session,
) -> None:
    entity_id = _seed_entity_id(session)

    initial = client.get(f"/api/v1/entities/{entity_id}/branding")
    assert initial.status_code == 200
    assert initial.json()["payment_payid"] is None
    assert initial.json()["accent_color"] is None

    payload = {
        "accent_color": "#15565a",
        "business_address": "Level 2, 144 Edward St, Brisbane QLD 4000",
        "contact_email": "accounts@skjcapital.example",
        "payment_payid": "accounts@skjcapital.example",
        "payment_bpay_biller": "247135",
        "payment_bank_bsb": "034-002",
        "payment_bank_account": "4471 0142",
        "footer_terms": "Payment due within 14 days.",
    }
    saved = client.put(f"/api/v1/entities/{entity_id}/branding", json=payload)
    assert saved.status_code == 200
    assert saved.json()["payment_payid"] == "accounts@skjcapital.example"
    assert saved.json()["accent_color"] == "#15565a"

    fetched = client.get(f"/api/v1/entities/{entity_id}/branding")
    assert fetched.json()["business_address"] == "Level 2, 144 Edward St, Brisbane QLD 4000"

    # Partial update keeps the other fields.
    update = client.put(
        f"/api/v1/entities/{entity_id}/branding",
        json={"accent_color": "#0b3d2e"},
    )
    assert update.status_code == 200
    assert update.json()["accent_color"] == "#0b3d2e"
    assert update.json()["payment_payid"] == "accounts@skjcapital.example"


def test_saved_branding_feeds_invoice_render(client: TestClient, session: Session) -> None:
    entity_id = _seed_entity_id(session)
    client.put(
        f"/api/v1/entities/{entity_id}/branding",
        json={"accent_color": "#123456", "payment_payid": "pay@skj.example"},
    )
    draft = SimpleNamespace(
        entity_id=UUID(entity_id),
        issuer_name="SKJ Capital",
        issuer_abn="12 345 678 901",
        invoice_number="INV-9",
    )
    brand = resolve_invoice_brand(draft, session)
    assert brand["accent"] == "#123456"
    assert any("PayID" in label for label, _ in brand["payment"])
