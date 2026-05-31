"""Contractor directory API tests."""

from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import Contractor, Entity


def _entity(session: Session) -> Entity:
    entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert entity is not None
    return entity


def test_contractors_create_list_update_delete_full_lifecycle(
    client: TestClient,
    session: Session,
) -> None:
    entity = _entity(session)

    # Empty list to start.
    empty = client.get(
        "/api/v1/contractors",
        params={"entity_id": str(entity.id)},
    )
    assert empty.status_code == 200
    assert empty.json() == []

    # Create.
    create_response = client.post(
        "/api/v1/contractors",
        json={
            "entity_id": str(entity.id),
            "name": "  Bright Sparks Electrical  ",  # whitespace stripped
            "company_name": "Bright Sparks Pty Ltd",
            "categories": ["electrical", "urgent"],
            "email": "ops@brightsparks.example",
            "phone": "+61 400 555 111",
            "service_radius_km": 20,
            "priority": 1,
            "notes": "After-hours emergency contact.",
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["name"] == "Bright Sparks Electrical"
    assert created["categories"] == ["electrical", "urgent"]
    assert created["priority"] == 1
    contractor_id = created["id"]

    # Detail returns the created contractor for record pages.
    detail = client.get(f"/api/v1/contractors/{contractor_id}")
    assert detail.status_code == 200
    assert detail.json()["id"] == contractor_id
    assert detail.json()["name"] == "Bright Sparks Electrical"

    # List returns the new contractor.
    listed = client.get(
        "/api/v1/contractors",
        params={"entity_id": str(entity.id)},
    )
    assert listed.status_code == 200
    assert len(listed.json()) == 1
    assert listed.json()[0]["id"] == contractor_id

    # Patch — change priority to backup + add a category.
    patch_response = client.patch(
        f"/api/v1/contractors/{contractor_id}",
        json={"priority": 3, "categories": ["electrical", "urgent", "hvac"]},
    )
    assert patch_response.status_code == 200
    patched = patch_response.json()
    assert patched["priority"] == 3
    assert patched["categories"] == ["electrical", "urgent", "hvac"]

    # Delete.
    delete_response = client.delete(f"/api/v1/contractors/{contractor_id}")
    assert delete_response.status_code == 204

    # List is empty again — soft-delete excluded.
    final = client.get(
        "/api/v1/contractors",
        params={"entity_id": str(entity.id)},
    )
    assert final.status_code == 200
    assert final.json() == []

    # Row still present in DB with deleted_at set.
    row = session.get(Contractor, UUID(contractor_id))
    assert row is not None
    assert row.deleted_at is not None


def test_contractors_list_sorts_by_priority_then_name(
    client: TestClient,
    session: Session,
) -> None:
    entity = _entity(session)
    # Create in deliberately mixed order so we can verify the sort.
    for name, priority in [
        ("Zylo Plumbing", 2),
        ("Acme Electrical", 1),
        ("Mid Plumbing", 2),
        ("Backup Locksmith", 3),
    ]:
        response = client.post(
            "/api/v1/contractors",
            json={
                "entity_id": str(entity.id),
                "name": name,
                "categories": ["other"],
                "priority": priority,
            },
        )
        assert response.status_code == 201

    listed = client.get(
        "/api/v1/contractors",
        params={"entity_id": str(entity.id)},
    )
    assert listed.status_code == 200
    names = [c["name"] for c in listed.json()]
    # Priority 1 first, then 2 by name asc, then 3.
    assert names == [
        "Acme Electrical",
        "Mid Plumbing",
        "Zylo Plumbing",
        "Backup Locksmith",
    ]


def test_contractors_rejects_blank_name_and_bad_priority(
    client: TestClient,
    session: Session,
) -> None:
    entity = _entity(session)
    # Blank name.
    blank = client.post(
        "/api/v1/contractors",
        json={
            "entity_id": str(entity.id),
            "name": "   ",
            "categories": [],
            "priority": 2,
        },
    )
    assert blank.status_code == 422

    # Bad priority on create.
    bad_priority = client.post(
        "/api/v1/contractors",
        json={
            "entity_id": str(entity.id),
            "name": "Test",
            "categories": [],
            "priority": 7,
        },
    )
    assert bad_priority.status_code == 422

    # Create a valid one first.
    valid = client.post(
        "/api/v1/contractors",
        json={
            "entity_id": str(entity.id),
            "name": "Test Co",
            "categories": [],
            "priority": 2,
        },
    )
    assert valid.status_code == 201
    contractor_id = valid.json()["id"]

    # Bad priority on patch.
    bad_patch = client.patch(
        f"/api/v1/contractors/{contractor_id}",
        json={"priority": 4},
    )
    assert bad_patch.status_code == 422

    # Blank name on patch.
    blank_patch = client.patch(
        f"/api/v1/contractors/{contractor_id}",
        json={"name": "  "},
    )
    assert blank_patch.status_code == 422


def test_contractors_404_for_deleted_or_unknown(
    client: TestClient,
    session: Session,
) -> None:
    entity = _entity(session)
    valid = client.post(
        "/api/v1/contractors",
        json={
            "entity_id": str(entity.id),
            "name": "Soft Deleted Co",
            "categories": [],
            "priority": 2,
        },
    )
    contractor_id = valid.json()["id"]
    client.delete(f"/api/v1/contractors/{contractor_id}")

    # Patch on a soft-deleted row returns 404.
    response = client.get(f"/api/v1/contractors/{contractor_id}")
    assert response.status_code == 404

    # Patch on a soft-deleted row returns 404.
    response = client.patch(
        f"/api/v1/contractors/{contractor_id}",
        json={"name": "Resurrection"},
    )
    assert response.status_code == 404

    # Unknown id returns 404.
    response = client.get(
        "/api/v1/contractors/00000000-0000-0000-0000-000000000000",
    )
    assert response.status_code == 404

    # Unknown id returns 404.
    response = client.patch(
        "/api/v1/contractors/00000000-0000-0000-0000-000000000000",
        json={"name": "Ghost"},
    )
    assert response.status_code == 404
