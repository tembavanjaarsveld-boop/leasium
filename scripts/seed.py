"""Seed local development data for Leasium."""

from datetime import date

from sqlalchemy import select
from stewart.core.db import SessionLocal
from stewart.core.models import (
    AppUser,
    Entity,
    GstTreatment,
    Lease,
    LeaseStatus,
    Obligation,
    ObligationCategory,
    ObligationStatus,
    Organisation,
    Property,
    PropertyType,
    RentChargeRule,
    RentChargeType,
    RentFrequency,
    TenancyUnit,
    Tenant,
    UserEntityRole,
    UserRole,
)
from stewart.core.settings import get_settings


def main() -> None:
    settings = get_settings()
    with SessionLocal() as session:
        org = session.get(Organisation, settings.dev_organisation_id)
        if org is None:
            org = Organisation(
                id=settings.dev_organisation_id,
                name="SKJ Capital",
                country_code="AU",
                timezone="Australia/Brisbane",
            )
            session.add(org)

        user = session.get(AppUser, settings.dev_user_id)
        if user is None:
            user = AppUser(
                id=settings.dev_user_id,
                organisation_id=org.id,
                email=settings.dev_user_email,
                display_name=settings.dev_user_name,
                auth_provider_id="dev",
            )
            session.add(user)

        entity = session.scalar(select(Entity).where(Entity.name == "SKJ Property Pty Ltd"))
        if entity is None:
            entity = Entity(
                organisation_id=org.id,
                name="SKJ Property Pty Ltd",
                abn="12 345 678 901",
                gst_registered=True,
                notes="Seed entity for local development.",
            )
            session.add(entity)
            session.flush()

        role = session.get(UserEntityRole, {"user_id": user.id, "entity_id": entity.id})
        if role is None:
            session.add(UserEntityRole(user_id=user.id, entity_id=entity.id, role=UserRole.owner))

        existing_properties = list(
            session.scalars(select(Property).where(Property.entity_id == entity.id))
        )
        if not existing_properties:
            northlakes = Property(
                entity_id=entity.id,
                name="Building 4 Northlakes",
                street_address="1 Example Drive",
                suburb="North Lakes",
                state="QLD",
                postcode="4509",
                property_type=PropertyType.commercial_office,
                building_sqm=1200,
                parking_spaces=24,
                has_solar_pv=True,
                property_metadata={"seed": True},
            )
            vine = Property(
                entity_id=entity.id,
                name="Vine Street Commercial",
                street_address="138 Vine Street",
                suburb="Fortitude Valley",
                state="QLD",
                postcode="4006",
                property_type=PropertyType.commercial_retail,
                building_sqm=175,
                property_metadata={"seed": True, "split": "138/175"},
            )
            session.add_all([northlakes, vine])
            session.flush()
            session.add_all(
                [
                    TenancyUnit(
                        property_id=northlakes.id,
                        unit_label="Whole building",
                        sqm=1200,
                        parking_spaces=24,
                    ),
                    TenancyUnit(property_id=vine.id, unit_label="138 sqm tenancy", sqm=138),
                    TenancyUnit(property_id=vine.id, unit_label="37 sqm residual", sqm=37),
                ]
            )
            session.flush()

        tenant = session.scalar(
            select(Tenant).where(
                Tenant.entity_id == entity.id,
                Tenant.legal_name == "Northlakes Allied Health Pty Ltd",
            )
        )
        if tenant is None:
            tenant = Tenant(
                entity_id=entity.id,
                legal_name="Northlakes Allied Health Pty Ltd",
                trading_name="Northlakes Allied Health",
                abn="98 765 432 109",
                contact_name="Alex Taylor",
                contact_email="alex@exampletenant.com.au",
                contact_phone="+61 7 3000 0000",
                billing_email="accounts@exampletenant.com.au",
                notes="Sample tenant for local lease and occupancy workflows.",
                tenant_metadata={"seed": True},
            )
            session.add(tenant)
            session.flush()

        whole_building = session.scalar(
            select(TenancyUnit)
            .join(Property)
            .where(
                Property.entity_id == entity.id,
                Property.name == "Building 4 Northlakes",
                TenancyUnit.unit_label == "Whole building",
            )
        )
        existing_lease = session.scalar(
            select(Lease).where(Lease.tenant_id == tenant.id, Lease.deleted_at.is_(None))
        )
        if whole_building is not None and existing_lease is None:
            existing_lease = Lease(
                tenancy_unit_id=whole_building.id,
                tenant_id=tenant.id,
                status=LeaseStatus.active,
                commencement_date=date(2026, 1, 1),
                expiry_date=date(2028, 12, 31),
                annual_rent_cents=18000000,
                rent_frequency=RentFrequency.annual,
                outgoings_recoverable=True,
                next_review_date=date(2027, 1, 1),
                option_summary="One further 3-year option, subject to notice window.",
                security_summary="Bank guarantee equal to 3 months gross rent.",
                notes="Sample AU commercial lease for development.",
                lease_metadata={"seed": True, "review_basis": "CPI"},
            )
            session.add(existing_lease)
            session.flush()

        if whole_building is not None and existing_lease is not None:
            existing_charge_rule = session.scalar(
                select(RentChargeRule).where(
                    RentChargeRule.lease_id == existing_lease.id,
                    RentChargeRule.deleted_at.is_(None),
                )
            )
            if existing_charge_rule is None:
                session.add(
                    RentChargeRule(
                        lease_id=existing_lease.id,
                        charge_type=RentChargeType.base_rent,
                        amount_cents=1500000,
                        frequency=RentFrequency.monthly,
                        gst_treatment=GstTreatment.taxable,
                        xero_account_code="200",
                        xero_tax_type="OUTPUT",
                        next_due_date=date(2026, 6, 1),
                        arrears_or_advance="advance",
                        charge_rule_metadata={"seed": True},
                    )
                )

            existing_obligation = session.scalar(
                select(Obligation).where(
                    Obligation.lease_id == existing_lease.id,
                    Obligation.deleted_at.is_(None),
                )
            )
            if existing_obligation is None:
                session.add_all(
                    [
                        Obligation(
                            entity_id=entity.id,
                            property_id=whole_building.property_id,
                            tenancy_unit_id=whole_building.id,
                            lease_id=existing_lease.id,
                            title="Annual CPI rent review",
                            category=ObligationCategory.rent_review,
                            status=ObligationStatus.upcoming,
                            due_date=date(2027, 1, 1),
                            priority=2,
                            owner_role=UserRole.finance,
                            notes="Seeded from sample lease next review date.",
                            obligation_metadata={"seed": True},
                        ),
                        Obligation(
                            entity_id=entity.id,
                            property_id=whole_building.property_id,
                            tenancy_unit_id=whole_building.id,
                            lease_id=existing_lease.id,
                            title="Option notice window check",
                            category=ObligationCategory.option_notice,
                            status=ObligationStatus.upcoming,
                            due_date=date(2028, 6, 30),
                            priority=1,
                            owner_role=UserRole.ops,
                            notes="Confirm tenant option notice requirements before expiry.",
                            obligation_metadata={"seed": True},
                        ),
                        Obligation(
                            entity_id=entity.id,
                            property_id=whole_building.property_id,
                            tenancy_unit_id=whole_building.id,
                            lease_id=existing_lease.id,
                            title="Lease expiry",
                            category=ObligationCategory.lease_expiry,
                            status=ObligationStatus.upcoming,
                            due_date=date(2028, 12, 31),
                            priority=1,
                            owner_role=UserRole.ops,
                            notes="Seeded from sample lease expiry date.",
                            obligation_metadata={"seed": True},
                        ),
                    ]
                )

        session.commit()
        print("Seed data ready.")


if __name__ == "__main__":
    main()
