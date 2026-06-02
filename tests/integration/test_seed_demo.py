from scripts.seed_demo import DEMO_ENTITY_NAME, DEMO_ORGANISATION_NAME, DEMO_SEED_KEY, seed_demo
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from stewart.core.models import (
    ArrearsCase,
    BillingDraft,
    Contractor,
    Entity,
    Lease,
    MaintenanceWorkOrder,
    Obligation,
    Organisation,
    Owner,
    Property,
    RentChargeRule,
    Tenant,
    UserEntityRole,
)
from stewart.core.settings import get_settings


def _count(session: Session, model: type[object]) -> int:
    return session.scalar(select(func.count(model.id))) or 0


def test_demo_seed_creates_fictional_au_story_and_is_idempotent(
    session: Session,
) -> None:
    first = seed_demo(session)
    counts_after_first = {
        model.__name__: _count(session, model)
        for model in (
            Property,
            Tenant,
            Lease,
            RentChargeRule,
            Obligation,
            Owner,
            Contractor,
            BillingDraft,
            MaintenanceWorkOrder,
            ArrearsCase,
        )
    }

    second = seed_demo(session)
    counts_after_second = {
        model.__name__: _count(session, model)
        for model in (
            Property,
            Tenant,
            Lease,
            RentChargeRule,
            Obligation,
            Owner,
            Contractor,
            BillingDraft,
            MaintenanceWorkOrder,
            ArrearsCase,
        )
    }

    settings = get_settings()
    organisation = session.get(Organisation, settings.dev_organisation_id)
    entity = session.scalar(select(Entity).where(Entity.name == DEMO_ENTITY_NAME))

    assert organisation is not None
    assert organisation.name == DEMO_ORGANISATION_NAME
    assert organisation.operating_mode == "managing_agent"
    assert entity is not None
    assert entity.organisation_id == organisation.id
    assert first.entity_id == entity.id
    assert second.entity_id == entity.id
    assert counts_after_second == counts_after_first

    assert session.scalar(
        select(UserEntityRole).where(
            UserEntityRole.user_id == settings.dev_user_id,
            UserEntityRole.entity_id == entity.id,
        )
    )
    assert session.scalar(
        select(Property).where(Property.name == "Kingfisher Retail Arcade")
    )
    assert session.scalar(
        select(Property).where(Property.name == "Moorooka Trade Warehouse")
    )
    assert session.scalar(
        select(Property).where(Property.name == "Newstead Creative Offices")
    )
    assert session.scalar(
        select(Tenant).where(Tenant.legal_name == "Bright Coffee Co Pty Ltd")
    )
    assert session.scalar(
        select(Owner).where(Owner.legal_name == "Rivergum Property Trust")
    )
    assert session.scalar(
        select(Contractor).where(Contractor.company_name == "SparkRight Electrical")
    )
    assert session.scalar(
        select(BillingDraft).where(
            BillingDraft.title == "June 2026 retail outgoings recovery"
        )
    )
    assert session.scalar(
        select(MaintenanceWorkOrder).where(
            MaintenanceWorkOrder.title == "Arcade lighting circuit fault"
        )
    )
    assert session.scalar(
        select(ArrearsCase).where(
            ArrearsCase.source_reference == "DEMO-ARREARS-BRIGHT-2026-06"
        )
    )

    demo_properties = session.scalars(
        select(Property).where(Property.entity_id == entity.id, Property.deleted_at.is_(None))
    ).all()
    assert len(demo_properties) == 3
    assert all(
        prop.property_metadata.get("demo_seed") == DEMO_SEED_KEY
        for prop in demo_properties
    )
