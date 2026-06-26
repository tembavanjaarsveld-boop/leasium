"""Org-wide (no entity_id) scope on the all-entities fan-out list endpoints."""

from datetime import date, datetime

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.models import (
    ArrearsCase,
    AuditOutcome,
    BillingDraft,
    ComplianceCheck,
    Contractor,
    DocumentCategory,
    DocumentIntake,
    Entity,
    InboundMessage,
    InvoiceDraft,
    Lease,
    LeaseStatus,
    MaintenanceWorkOrder,
    MaintenanceWorkOrderStatus,
    Obligation,
    ObligationCategory,
    ObligationStatus,
    Property,
    PropertyType,
    StoredDocument,
    TenancyUnit,
    Tenant,
    TenantOnboarding,
    UserEntityRole,
    UserRole,
)
from stewart.core.settings import get_settings


def _seed_entity_records(session: Session, entity: Entity, token: str) -> None:
    """Minimal rows for every org-wide list endpoint under one entity."""

    prop = Property(
        entity_id=entity.id,
        name=f"{entity.name} HQ",
        street_address="1 Test St",
        property_type=PropertyType.commercial_office,
    )
    session.add(prop)
    session.flush()
    unit = TenancyUnit(property_id=prop.id, unit_label="U1")
    tenant = Tenant(entity_id=entity.id, legal_name=f"{entity.name} Tenant")
    session.add_all([unit, tenant])
    session.flush()
    lease = Lease(
        tenancy_unit_id=unit.id,
        tenant_id=tenant.id,
        status=LeaseStatus.active,
    )
    document = StoredDocument(
        entity_id=entity.id,
        filename="intake.pdf",
        byte_size=3,
        file_data=b"pdf",
        category=DocumentCategory.other,
    )
    session.add_all([lease, document])
    session.flush()
    document_intake = DocumentIntake(entity_id=entity.id, document_id=document.id)
    session.add(document_intake)
    session.flush()
    billing_draft = BillingDraft(
        entity_id=entity.id,
        property_id=prop.id,
        tenancy_unit_id=unit.id,
        tenant_id=tenant.id,
        lease_id=lease.id,
        document_id=document.id,
        document_intake_id=document_intake.id,
        title=f"{entity.name} billing draft",
        issue_date=date(2026, 7, 1),
        due_date=date(2026, 7, 15),
        total_cents=154000,
    )
    session.add(billing_draft)
    session.flush()
    session.add_all(
        [
            Obligation(
                entity_id=entity.id,
                title=f"{entity.name} obligation",
                category=ObligationCategory.compliance,
                status=ObligationStatus.upcoming,
                due_date=date(2026, 7, 1),
            ),
            TenantOnboarding(
                entity_id=entity.id,
                lease_id=lease.id,
                tenant_id=tenant.id,
                token=token,
            ),
            ArrearsCase(
                entity_id=entity.id,
                property_id=prop.id,
                tenancy_unit_id=unit.id,
                tenant_id=tenant.id,
                lease_id=lease.id,
                total_balance_cents=880000,
            ),
            MaintenanceWorkOrder(
                entity_id=entity.id,
                property_id=prop.id,
                tenancy_unit_id=unit.id,
                tenant_id=tenant.id,
                lease_id=lease.id,
                title=f"{entity.name} repair",
                description="Replace flickering tenancy lighting.",
            ),
            InvoiceDraft(
                entity_id=entity.id,
                billing_draft_id=billing_draft.id,
                property_id=prop.id,
                tenancy_unit_id=unit.id,
                tenant_id=tenant.id,
                lease_id=lease.id,
                document_id=document.id,
                document_intake_id=document_intake.id,
                title=f"{entity.name} invoice draft",
                issue_date=date(2026, 7, 1),
                due_date=date(2026, 7, 15),
                subtotal_cents=140000,
                gst_cents=14000,
                total_cents=154000,
            ),
            Contractor(
                entity_id=entity.id,
                name=f"{entity.name} Contractor",
                company_name=f"{entity.name} Services",
                categories=["maintenance"],
            ),
            ComplianceCheck(
                entity_id=entity.id,
                title=f"{entity.name} compliance check",
                next_due_date=date(2026, 8, 1),
            ),
        ]
    )
    session.commit()


def _assignment_metadata() -> dict[str, object]:
    settings = get_settings()
    return {
        "work_assignment": {
            "assigned_user_id": str(settings.dev_user_id),
            "assigned_user_name": settings.dev_user_name,
            "assigned_user_email": settings.dev_user_email,
            "assigned_role": "owner",
            "assigned_at": "2026-05-20T00:00:00Z",
            "assigned_by_user_id": str(settings.dev_user_id),
            "assigned_by_name": settings.dev_user_name,
            "work_title": "Org-wide assigned work",
            "work_kind": "Maintenance",
            "notification": {
                "channel": "in_app",
                "provider": "leasium",
                "status": "ready",
                "recipient_email": settings.dev_user_email,
                "template_key": "work_assignment_notification",
                "template_version": "v1",
            },
            "history": [
                {
                    "event": "assigned",
                    "at": "2026-05-20T00:00:00Z",
                    "actor_name": settings.dev_user_name,
                    "assigned_user_name": settings.dev_user_name,
                    "assigned_user_email": settings.dev_user_email,
                    "notification_status": "ready",
                    "summary": "Maintenance assigned to Temba van Jaarsveld.",
                }
            ],
        }
    }


def test_org_wide_lists_cover_readable_entities_only(
    client: TestClient,
    session: Session,
) -> None:
    settings = get_settings()
    seeded = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert seeded is not None

    accessible = Entity(organisation_id=seeded.organisation_id, name="Accessible Trust")
    hidden = Entity(organisation_id=seeded.organisation_id, name="Hidden Trust")
    session.add_all([accessible, hidden])
    session.flush()
    session.add(
        UserEntityRole(
            user_id=settings.dev_user_id,
            entity_id=accessible.id,
            role=UserRole.viewer,
        )
    )
    session.commit()
    _seed_entity_records(session, accessible, token="org-scope-accessible")
    _seed_entity_records(session, hidden, token="org-scope-hidden")

    accessible_id = str(accessible.id)
    hidden_id = str(hidden.id)

    for path in (
        "/api/v1/properties",
        "/api/v1/tenants",
        "/api/v1/contractors",
        "/api/v1/rent-roll",
        "/api/v1/obligations",
        "/api/v1/tenant-onboarding",
        "/api/v1/document-intakes",
        "/api/v1/compliance/checks",
        "/api/v1/arrears/cases",
        "/api/v1/maintenance/work-orders",
        "/api/v1/billing-drafts",
        "/api/v1/invoice-drafts",
    ):
        response = client.get(path)
        assert response.status_code == 200, path
        entity_ids = {row["entity_id"] for row in response.json()}
        assert accessible_id in entity_ids, path
        assert hidden_id not in entity_ids, path


def test_explicit_entity_scope_still_requires_entity_role(
    client: TestClient,
    session: Session,
) -> None:
    seeded = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert seeded is not None
    hidden = Entity(organisation_id=seeded.organisation_id, name="Hidden Trust")
    session.add(hidden)
    session.commit()

    for path in (
        "/api/v1/properties",
        "/api/v1/tenants",
        "/api/v1/contractors",
        "/api/v1/rent-roll",
        "/api/v1/obligations",
        "/api/v1/tenant-onboarding",
        "/api/v1/document-intakes",
        "/api/v1/compliance/checks",
        "/api/v1/arrears/cases",
        "/api/v1/maintenance/work-orders",
        "/api/v1/billing-drafts",
        "/api/v1/invoice-drafts",
    ):
        response = client.get(path, params={"entity_id": str(hidden.id)})
        assert response.status_code == 403, path


def test_org_wide_comms_queue_returns_readable_entity_candidates_only(
    client: TestClient,
    session: Session,
) -> None:
    settings = get_settings()
    seeded = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert seeded is not None

    accessible = Entity(organisation_id=seeded.organisation_id, name="Visible Comms")
    hidden = Entity(organisation_id=seeded.organisation_id, name="Hidden Comms")
    session.add_all([accessible, hidden])
    session.flush()
    session.add(
        UserEntityRole(
            user_id=settings.dev_user_id,
            entity_id=accessible.id,
            role=UserRole.viewer,
        )
    )
    session.flush()
    session.add_all(
        [
            InboundMessage(
                entity_id=accessible.id,
                channel="email",
                provider="sendgrid",
                source="tenant_channel",
                trust_state="trusted",
                from_address="visible@example.test",
                to_address="visible@inbox.relby.ai",
                subject="Visible maintenance request",
                body_text="The lights need attention.",
            ),
            InboundMessage(
                entity_id=hidden.id,
                channel="email",
                provider="sendgrid",
                source="tenant_channel",
                trust_state="trusted",
                from_address="hidden@example.test",
                to_address="hidden@inbox.relby.ai",
                subject="Hidden maintenance request",
                body_text="This should not leak.",
            ),
        ]
    )
    session.commit()

    response = client.get("/api/v1/comms/queue")

    assert response.status_code == 200
    body = response.json()
    assert body["entity_id"] is None
    candidate_entities = {candidate["entity_id"] for candidate in body["candidates"]}
    assert candidate_entities == {str(accessible.id)}
    assert body["candidates"][0]["subject"] == "Re: Visible maintenance request"

    response = client.get(
        "/api/v1/comms/queue",
        params={"entity_id": str(hidden.id)},
    )
    assert response.status_code == 403


def test_org_wide_comms_outbound_log_returns_readable_entity_events_only(
    client: TestClient,
    session: Session,
) -> None:
    settings = get_settings()
    seeded = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert seeded is not None

    accessible = Entity(organisation_id=seeded.organisation_id, name="Visible Dispatch")
    hidden = Entity(organisation_id=seeded.organisation_id, name="Hidden Dispatch")
    session.add_all([accessible, hidden])
    session.flush()
    session.add(
        UserEntityRole(
            user_id=settings.dev_user_id,
            entity_id=accessible.id,
            role=UserRole.viewer,
        )
    )
    session.flush()
    visible_message = InboundMessage(
        entity_id=accessible.id,
        channel="email",
        provider="sendgrid",
        source="tenant_channel",
        trust_state="trusted",
        from_address="visible@example.test",
        subject="Visible dispatch",
        body_text="Visible body.",
    )
    hidden_message = InboundMessage(
        entity_id=hidden.id,
        channel="email",
        provider="sendgrid",
        source="tenant_channel",
        trust_state="trusted",
        from_address="hidden@example.test",
        subject="Hidden dispatch",
        body_text="Hidden body.",
    )
    session.add_all([visible_message, hidden_message])
    session.flush()
    visible_dispatch = audit_log(
        session,
        actor="dev@test",
        entity_id=accessible.id,
        action="dispatch",
        target_table="inbound_message",
        target_id=visible_message.id,
        tool_name="sendgrid.sendgrid",
        tool_input={
            "candidate_id": f"inbound_email:inbound_message:{visible_message.id}",
            "kind": "inbound_email",
            "channel": "email",
        },
        tool_output_summary="visible comms dispatch",
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    visible_dispatch.occurred_at = datetime(2026, 5, 21, 2, 30, 0)
    hidden_dispatch = audit_log(
        session,
        actor="dev@test",
        entity_id=hidden.id,
        action="dispatch",
        target_table="inbound_message",
        target_id=hidden_message.id,
        tool_name="sendgrid.sendgrid",
        tool_input={
            "candidate_id": f"inbound_email:inbound_message:{hidden_message.id}",
            "kind": "inbound_email",
            "channel": "email",
        },
        tool_output_summary="hidden comms dispatch",
        outcome=AuditOutcome.success,
        data_classification="confidential",
    )
    hidden_dispatch.occurred_at = datetime(2026, 5, 21, 2, 35, 0)
    session.commit()

    response = client.get("/api/v1/comms/outbound-log")

    assert response.status_code == 200
    body = response.json()
    assert body["entity_id"] is None
    assert [(event["entity_id"], event["summary"]) for event in body["events"]] == [
        (str(accessible.id), "visible comms dispatch")
    ]

    response = client.get(
        "/api/v1/comms/outbound-log",
        params={"entity_id": str(hidden.id)},
    )
    assert response.status_code == 403


def test_org_wide_notification_center_returns_readable_entity_notices_only(
    client: TestClient,
    session: Session,
) -> None:
    settings = get_settings()
    seeded = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert seeded is not None

    accessible = Entity(organisation_id=seeded.organisation_id, name="Visible Work")
    hidden = Entity(organisation_id=seeded.organisation_id, name="Hidden Work")
    session.add_all([accessible, hidden])
    session.flush()
    session.add(
        UserEntityRole(
            user_id=settings.dev_user_id,
            entity_id=accessible.id,
            role=UserRole.viewer,
        )
    )
    session.flush()
    session.add_all(
        [
            MaintenanceWorkOrder(
                entity_id=accessible.id,
                title="Visible assigned work",
                description="Visible assignment.",
                status=MaintenanceWorkOrderStatus.assigned,
                work_order_metadata=_assignment_metadata(),
            ),
            MaintenanceWorkOrder(
                entity_id=hidden.id,
                title="Hidden assigned work",
                description="Hidden assignment.",
                status=MaintenanceWorkOrderStatus.assigned,
                work_order_metadata=_assignment_metadata(),
            ),
        ]
    )
    session.commit()

    response = client.get("/api/v1/work-assignments/notification-center")

    assert response.status_code == 200
    body = response.json()
    assert body["entity_id"] is None
    assert [(notice["entity_id"], notice["title"]) for notice in body["notices"]] == [
        (str(accessible.id), "Visible assigned work")
    ]

    response = client.get(
        "/api/v1/work-assignments/notification-center",
        params={"entity_id": str(hidden.id)},
    )
    assert response.status_code == 403


def test_org_wide_arrears_tenant_filter_requires_readable_tenant(
    client: TestClient,
    session: Session,
) -> None:
    settings = get_settings()
    seeded = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert seeded is not None

    accessible = Entity(organisation_id=seeded.organisation_id, name="Accessible Trust")
    hidden = Entity(organisation_id=seeded.organisation_id, name="Hidden Trust")
    session.add_all([accessible, hidden])
    session.flush()
    session.add(
        UserEntityRole(
            user_id=settings.dev_user_id,
            entity_id=accessible.id,
            role=UserRole.viewer,
        )
    )
    session.commit()
    _seed_entity_records(session, accessible, token="arrears-filter-accessible")
    _seed_entity_records(session, hidden, token="arrears-filter-hidden")

    accessible_tenant = session.scalar(
        select(Tenant).where(Tenant.entity_id == accessible.id)
    )
    hidden_tenant = session.scalar(select(Tenant).where(Tenant.entity_id == hidden.id))
    assert accessible_tenant is not None
    assert hidden_tenant is not None

    response = client.get(
        "/api/v1/arrears/cases",
        params={"tenant_id": str(accessible_tenant.id)},
    )
    assert response.status_code == 200
    entity_ids = {row["entity_id"] for row in response.json()}
    assert entity_ids == {str(accessible.id)}

    response = client.get(
        "/api/v1/arrears/cases",
        params={"tenant_id": str(hidden_tenant.id)},
    )
    assert response.status_code == 403


def test_org_wide_maintenance_filters_require_readable_links(
    client: TestClient,
    session: Session,
) -> None:
    settings = get_settings()
    seeded = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert seeded is not None

    accessible = Entity(organisation_id=seeded.organisation_id, name="Visible Repairs")
    hidden = Entity(organisation_id=seeded.organisation_id, name="Hidden Repairs")
    session.add_all([accessible, hidden])
    session.flush()
    session.add(
        UserEntityRole(
            user_id=settings.dev_user_id,
            entity_id=accessible.id,
            role=UserRole.viewer,
        )
    )
    session.commit()
    _seed_entity_records(session, accessible, token="maintenance-filter-accessible")
    _seed_entity_records(session, hidden, token="maintenance-filter-hidden")

    accessible_property = session.scalar(
        select(Property).where(Property.entity_id == accessible.id)
    )
    hidden_property = session.scalar(select(Property).where(Property.entity_id == hidden.id))
    accessible_tenant = session.scalar(
        select(Tenant).where(Tenant.entity_id == accessible.id)
    )
    hidden_tenant = session.scalar(select(Tenant).where(Tenant.entity_id == hidden.id))
    assert accessible_property is not None
    assert hidden_property is not None
    assert accessible_tenant is not None
    assert hidden_tenant is not None

    response = client.get(
        "/api/v1/maintenance/work-orders",
        params={"property_id": str(accessible_property.id)},
    )
    assert response.status_code == 200
    entity_ids = {row["entity_id"] for row in response.json()}
    assert entity_ids == {str(accessible.id)}

    response = client.get(
        "/api/v1/maintenance/work-orders",
        params={"tenant_id": str(accessible_tenant.id)},
    )
    assert response.status_code == 200
    entity_ids = {row["entity_id"] for row in response.json()}
    assert entity_ids == {str(accessible.id)}

    response = client.get(
        "/api/v1/maintenance/work-orders",
        params={"property_id": str(hidden_property.id)},
    )
    assert response.status_code == 403

    response = client.get(
        "/api/v1/maintenance/work-orders",
        params={"tenant_id": str(hidden_tenant.id)},
    )
    assert response.status_code == 403


def test_org_wide_billing_draft_filters_require_readable_links(
    client: TestClient,
    session: Session,
) -> None:
    settings = get_settings()
    seeded = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert seeded is not None

    accessible = Entity(organisation_id=seeded.organisation_id, name="Visible Billing")
    readable_peer = Entity(
        organisation_id=seeded.organisation_id, name="Other Visible Billing"
    )
    hidden = Entity(organisation_id=seeded.organisation_id, name="Hidden Billing")
    session.add_all([accessible, readable_peer, hidden])
    session.flush()
    session.add_all(
        [
            UserEntityRole(
                user_id=settings.dev_user_id,
                entity_id=accessible.id,
                role=UserRole.viewer,
            ),
            UserEntityRole(
                user_id=settings.dev_user_id,
                entity_id=readable_peer.id,
                role=UserRole.viewer,
            ),
        ]
    )
    session.commit()
    _seed_entity_records(session, accessible, token="billing-filter-accessible")
    _seed_entity_records(session, readable_peer, token="billing-filter-peer")
    _seed_entity_records(session, hidden, token="billing-filter-hidden")

    accessible_property = session.scalar(
        select(Property).where(Property.entity_id == accessible.id)
    )
    hidden_property = session.scalar(select(Property).where(Property.entity_id == hidden.id))
    accessible_lease = session.scalar(
        select(Lease)
        .join(TenancyUnit, TenancyUnit.id == Lease.tenancy_unit_id)
        .join(Property, Property.id == TenancyUnit.property_id)
        .where(Property.entity_id == accessible.id)
    )
    hidden_lease = session.scalar(
        select(Lease)
        .join(TenancyUnit, TenancyUnit.id == Lease.tenancy_unit_id)
        .join(Property, Property.id == TenancyUnit.property_id)
        .where(Property.entity_id == hidden.id)
    )
    accessible_intake = session.scalar(
        select(DocumentIntake).where(DocumentIntake.entity_id == accessible.id)
    )
    readable_peer_intake = session.scalar(
        select(DocumentIntake).where(DocumentIntake.entity_id == readable_peer.id)
    )
    hidden_intake = session.scalar(
        select(DocumentIntake).where(DocumentIntake.entity_id == hidden.id)
    )
    assert accessible_property is not None
    assert hidden_property is not None
    assert accessible_lease is not None
    assert hidden_lease is not None
    assert accessible_intake is not None
    assert readable_peer_intake is not None
    assert hidden_intake is not None

    response = client.get(
        "/api/v1/billing-drafts",
        params={
            "entity_id": str(accessible.id),
            "document_intake_id": str(readable_peer_intake.id),
        },
    )
    assert response.status_code == 422

    response = client.get(
        "/api/v1/billing-drafts",
        params={
            "entity_id": str(accessible.id),
            "document_intake_id": str(hidden_intake.id),
        },
    )
    assert response.status_code == 403

    for params in (
        {"property_id": str(accessible_property.id)},
        {"lease_id": str(accessible_lease.id)},
        {"document_intake_id": str(accessible_intake.id)},
    ):
        response = client.get("/api/v1/billing-drafts", params=params)
        assert response.status_code == 200
        entity_ids = {row["entity_id"] for row in response.json()}
        assert entity_ids == {str(accessible.id)}

    for params in (
        {"property_id": str(hidden_property.id)},
        {"lease_id": str(hidden_lease.id)},
        {"document_intake_id": str(hidden_intake.id)},
    ):
        response = client.get("/api/v1/billing-drafts", params=params)
        assert response.status_code == 403


def test_org_wide_invoice_draft_filters_require_readable_billing_draft(
    client: TestClient,
    session: Session,
) -> None:
    settings = get_settings()
    seeded = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
    assert seeded is not None

    accessible = Entity(organisation_id=seeded.organisation_id, name="Visible Invoices")
    readable_peer = Entity(
        organisation_id=seeded.organisation_id, name="Other Visible Invoices"
    )
    hidden = Entity(organisation_id=seeded.organisation_id, name="Hidden Invoices")
    session.add_all([accessible, readable_peer, hidden])
    session.flush()
    session.add_all(
        [
            UserEntityRole(
                user_id=settings.dev_user_id,
                entity_id=accessible.id,
                role=UserRole.viewer,
            ),
            UserEntityRole(
                user_id=settings.dev_user_id,
                entity_id=readable_peer.id,
                role=UserRole.viewer,
            ),
        ]
    )
    session.commit()
    _seed_entity_records(session, accessible, token="invoice-filter-accessible")
    _seed_entity_records(session, readable_peer, token="invoice-filter-peer")
    _seed_entity_records(session, hidden, token="invoice-filter-hidden")

    accessible_billing_draft = session.scalar(
        select(BillingDraft).where(BillingDraft.entity_id == accessible.id)
    )
    readable_peer_billing_draft = session.scalar(
        select(BillingDraft).where(BillingDraft.entity_id == readable_peer.id)
    )
    hidden_billing_draft = session.scalar(
        select(BillingDraft).where(BillingDraft.entity_id == hidden.id)
    )
    assert accessible_billing_draft is not None
    assert readable_peer_billing_draft is not None
    assert hidden_billing_draft is not None

    response = client.get(
        "/api/v1/invoice-drafts",
        params={"billing_draft_id": str(accessible_billing_draft.id)},
    )
    assert response.status_code == 200
    entity_ids = {row["entity_id"] for row in response.json()}
    assert entity_ids == {str(accessible.id)}

    response = client.get(
        "/api/v1/invoice-drafts",
        params={
            "entity_id": str(accessible.id),
            "billing_draft_id": str(readable_peer_billing_draft.id),
        },
    )
    assert response.status_code == 422

    response = client.get(
        "/api/v1/invoice-drafts",
        params={"billing_draft_id": str(hidden_billing_draft.id)},
    )
    assert response.status_code == 403
