"""AI Mailbox alias management API.

Platform admins reserve/list/disable client aliases; operators read only their
own organisation's active aliases. No provider send fires here. Default dev auth
is a platform admin (``dev_is_platform_admin`` defaults True).
"""

from apps.api.main import app
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.models import AuditAction, MailboxAlias, Organisation
from stewart.core.settings import get_settings


def _client_org(session: Session, name: str = "Riverside Holdings") -> Organisation:
    org = Organisation(name=name)
    session.add(org)
    session.commit()
    session.refresh(org)
    return org


def _as_client_operator() -> None:
    base = get_settings()
    app.dependency_overrides[get_settings] = lambda: base.model_copy(
        update={"dev_is_platform_admin": False}
    )


def _restore_auth() -> None:
    app.dependency_overrides.pop(get_settings, None)


# --- platform-admin reserve ------------------------------------------------------


def test_platform_admin_reserves_alias_and_audits(
    client: TestClient,
    session: Session,
) -> None:
    org = _client_org(session)

    response = client.post(
        "/api/v1/mailbox-aliases",
        json={"organisation_id": str(org.id), "local_part": "  SKJ ", "label": "SKJ intake"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["local_part"] == "skj"
    assert body["domain"] == "inbox.relby.ai"
    assert body["email_address"] == "skj@inbox.relby.ai"
    assert body["status"] == "active"
    assert body["organisation_id"] == str(org.id)

    row = session.scalar(
        select(MailboxAlias).where(MailboxAlias.email_address == "skj@inbox.relby.ai")
    )
    assert row is not None and row.organisation_id == org.id
    actions = session.scalars(
        select(AuditAction.action).where(
            AuditAction.target_table == "mailbox_alias",
            AuditAction.tool_name == "platform.mailbox_alias_reserve",
        )
    ).all()
    assert actions == ["reserve"]


def test_reserve_duplicate_active_alias_conflicts(
    client: TestClient,
    session: Session,
) -> None:
    org = _client_org(session)
    payload = {"organisation_id": str(org.id), "local_part": "skj"}
    assert client.post("/api/v1/mailbox-aliases", json=payload).status_code == 201

    second = client.post("/api/v1/mailbox-aliases", json=payload)
    assert second.status_code == 409
    rows = session.scalars(
        select(MailboxAlias).where(MailboxAlias.email_address == "skj@inbox.relby.ai")
    ).all()
    assert len(rows) == 1


def test_reserve_rejects_bad_local_part_and_domain(
    client: TestClient,
    session: Session,
) -> None:
    org = _client_org(session)
    bad_local = client.post(
        "/api/v1/mailbox-aliases",
        json={"organisation_id": str(org.id), "local_part": "has spaces"},
    )
    assert bad_local.status_code == 422
    bad_domain = client.post(
        "/api/v1/mailbox-aliases",
        json={"organisation_id": str(org.id), "local_part": "skj", "domain": "evil.example"},
    )
    assert bad_domain.status_code == 422
    assert session.scalar(select(MailboxAlias)) is None


def test_reserve_unknown_org_404(client: TestClient) -> None:
    from uuid import uuid4

    response = client.post(
        "/api/v1/mailbox-aliases",
        json={"organisation_id": str(uuid4()), "local_part": "skj"},
    )
    assert response.status_code == 404


def test_reserve_requires_platform_admin(
    client: TestClient,
    session: Session,
) -> None:
    org = _client_org(session)
    _as_client_operator()
    try:
        response = client.post(
            "/api/v1/mailbox-aliases",
            json={"organisation_id": str(org.id), "local_part": "skj"},
        )
    finally:
        _restore_auth()
    assert response.status_code == 403
    assert session.scalar(select(MailboxAlias)) is None


# --- platform-admin list + update ------------------------------------------------


def test_list_aliases_filters_by_org(client: TestClient, session: Session) -> None:
    org_a = _client_org(session, "Org A")
    org_b = _client_org(session, "Org B")
    client.post(
        "/api/v1/mailbox-aliases", json={"organisation_id": str(org_a.id), "local_part": "a"}
    )
    client.post(
        "/api/v1/mailbox-aliases", json={"organisation_id": str(org_b.id), "local_part": "b"}
    )

    all_aliases = client.get("/api/v1/mailbox-aliases").json()["aliases"]
    assert {a["local_part"] for a in all_aliases} == {"a", "b"}

    only_a = client.get(f"/api/v1/mailbox-aliases?organisation_id={org_a.id}").json()["aliases"]
    assert [a["local_part"] for a in only_a] == ["a"]


def test_update_alias_disables_and_audits(client: TestClient, session: Session) -> None:
    org = _client_org(session)
    alias_id = client.post(
        "/api/v1/mailbox-aliases",
        json={"organisation_id": str(org.id), "local_part": "skj"},
    ).json()["id"]

    response = client.patch(f"/api/v1/mailbox-aliases/{alias_id}", json={"status": "disabled"})
    assert response.status_code == 200
    assert response.json()["status"] == "disabled"

    actions = session.scalars(
        select(AuditAction.action).where(
            AuditAction.tool_name == "platform.mailbox_alias_update",
        )
    ).all()
    assert actions == ["update"]


def test_update_alias_rejects_bad_status_and_missing(client: TestClient, session: Session) -> None:
    from uuid import uuid4

    org = _client_org(session)
    alias_id = client.post(
        "/api/v1/mailbox-aliases",
        json={"organisation_id": str(org.id), "local_part": "skj"},
    ).json()["id"]

    bad_status = client.patch(
        f"/api/v1/mailbox-aliases/{alias_id}", json={"status": "nonsense"}
    )
    assert bad_status.status_code == 422
    missing = client.patch(
        f"/api/v1/mailbox-aliases/{uuid4()}", json={"status": "disabled"}
    )
    assert missing.status_code == 404
