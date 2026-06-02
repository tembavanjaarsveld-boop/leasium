"""Seed a fictional AU portfolio for local demos and manual QA."""

from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.db import SessionLocal
from stewart.core.models import (
    AppUser,
    ArrearsCase,
    ArrearsCaseStatus,
    BillingDraft,
    BillingDraftLine,
    BillingDraftStatus,
    Contractor,
    DocumentCategory,
    Entity,
    GstTreatment,
    InvoiceDraft,
    InvoiceDraftLine,
    InvoiceDraftStatus,
    Lease,
    LeaseStatus,
    MaintenanceApprovalStatus,
    MaintenancePriority,
    MaintenanceWorkOrder,
    MaintenanceWorkOrderStatus,
    Obligation,
    ObligationCategory,
    ObligationStatus,
    Organisation,
    Owner,
    Property,
    PropertyOwner,
    PropertyType,
    RentChargeRule,
    RentChargeType,
    RentFrequency,
    StoredDocument,
    TenancyUnit,
    Tenant,
    TenantOnboarding,
    TenantOnboardingStatus,
    UserEntityRole,
    UserRole,
)
from stewart.core.settings import get_settings

DEMO_SEED_KEY = "fictional_au_v1"
DEMO_ORGANISATION_NAME = "Harbour Lane Property Group"
DEMO_ENTITY_NAME = "Rivergum Property Holdings Pty Ltd"


@dataclass
class DemoSeedSummary:
    entity_id: UUID
    created: dict[str, int]
    updated: dict[str, int]


@dataclass
class _SeedCounters:
    created: Counter[str] = field(default_factory=Counter)
    updated: Counter[str] = field(default_factory=Counter)

    def record(self, kind: str, *, created: bool = False, updated: bool = False) -> None:
        if created:
            self.created[kind] += 1
        elif updated:
            self.updated[kind] += 1


def _demo_metadata(current: dict[str, Any] | None = None, **extra: Any) -> dict[str, Any]:
    metadata = dict(current or {})
    metadata.update({"demo": True, "demo_seed": DEMO_SEED_KEY})
    metadata.update(extra)
    return metadata


def _apply_attrs(obj: object, values: dict[str, Any]) -> bool:
    changed = False
    for attr, value in values.items():
        if getattr(obj, attr) != value:
            setattr(obj, attr, value)
            changed = True
    return changed


def _ensure_organisation(session: Session, counters: _SeedCounters) -> Organisation:
    settings = get_settings()
    organisation = session.get(Organisation, settings.dev_organisation_id)
    values = {
        "name": DEMO_ORGANISATION_NAME,
        "country_code": "AU",
        "timezone": "Australia/Brisbane",
        "operating_mode": "managing_agent",
    }
    if organisation is None:
        organisation = Organisation(id=settings.dev_organisation_id, **values)
        session.add(organisation)
        counters.record("organisation", created=True)
        session.flush()
        return organisation
    counters.record("organisation", updated=_apply_attrs(organisation, values))
    return organisation


def _ensure_user(
    session: Session,
    organisation: Organisation,
    counters: _SeedCounters,
) -> AppUser:
    settings = get_settings()
    user = session.get(AppUser, settings.dev_user_id)
    values = {
        "organisation_id": organisation.id,
        "email": settings.dev_user_email,
        "display_name": settings.dev_user_name,
        "auth_provider_id": "dev",
    }
    if user is None:
        user = AppUser(id=settings.dev_user_id, **values)
        session.add(user)
        counters.record("operator", created=True)
        session.flush()
        return user
    counters.record("operator", updated=_apply_attrs(user, values))
    return user


def _ensure_entity(
    session: Session,
    organisation: Organisation,
    counters: _SeedCounters,
) -> Entity:
    entity = session.scalar(
        select(Entity).where(Entity.name == DEMO_ENTITY_NAME, Entity.deleted_at.is_(None))
    )
    values = {
        "organisation_id": organisation.id,
        "name": DEMO_ENTITY_NAME,
        "abn": "88 642 173 905",
        "gst_registered": True,
        "notes": "Fictional AU demo entity seeded for local product demos.",
    }
    if entity is None:
        entity = Entity(**values)
        session.add(entity)
        counters.record("entity", created=True)
        session.flush()
        return entity
    counters.record("entity", updated=_apply_attrs(entity, values))
    return entity


def _ensure_role(
    session: Session,
    user: AppUser,
    entity: Entity,
    counters: _SeedCounters,
) -> None:
    role = session.get(UserEntityRole, {"user_id": user.id, "entity_id": entity.id})
    if role is None:
        session.add(UserEntityRole(user_id=user.id, entity_id=entity.id, role=UserRole.owner))
        counters.record("entity_role", created=True)
        return
    counters.record("entity_role", updated=_apply_attrs(role, {"role": UserRole.owner}))


def _ensure_owner(
    session: Session,
    entity: Entity,
    counters: _SeedCounters,
    *,
    legal_name: str,
    abn: str,
    trustee_name: str,
    trust_name: str,
    billing_email: str,
    invoice_reference: str,
) -> Owner:
    owner = session.scalar(
        select(Owner).where(
            Owner.entity_id == entity.id,
            Owner.legal_name == legal_name,
            Owner.deleted_at.is_(None),
        )
    )
    values = {
        "entity_id": entity.id,
        "legal_name": legal_name,
        "abn": abn,
        "trustee_name": trustee_name,
        "trust_name": trust_name,
        "invoice_issuer_name": trustee_name,
        "billing_contact_name": "Mia Chen",
        "billing_email": billing_email,
        "invoice_reference": invoice_reference,
        "gst_registered": True,
        "xero_contact_id": None,
        "owner_metadata": _demo_metadata({"story": "fictional_demo_owner"}),
    }
    if owner is None:
        owner = Owner(**values)
        session.add(owner)
        counters.record("owner", created=True)
        session.flush()
        return owner
    counters.record("owner", updated=_apply_attrs(owner, values))
    return owner


def _ensure_property(
    session: Session,
    entity: Entity,
    counters: _SeedCounters,
    *,
    name: str,
    street_address: str,
    suburb: str,
    postcode: str,
    property_type: PropertyType,
    parcel_id: str,
    land_sqm: float,
    building_sqm: float,
    parking_spaces: int,
    owner: Owner,
    ownership_split: str,
) -> Property:
    prop = session.scalar(
        select(Property).where(
            Property.entity_id == entity.id,
            Property.name == name,
            Property.deleted_at.is_(None),
        )
    )
    values = {
        "entity_id": entity.id,
        "name": name,
        "street_address": street_address,
        "suburb": suburb,
        "state": "QLD",
        "postcode": postcode,
        "country_code": "AU",
        "property_type": property_type,
        "parcel_id": parcel_id,
        "land_sqm": land_sqm,
        "building_sqm": building_sqm,
        "parking_spaces": parking_spaces,
        "has_solar_pv": name != "Moorooka Trade Warehouse",
        "ownership_structure": "trust",
        "owner_legal_name": owner.legal_name,
        "owner_abn": owner.abn,
        "trustee_name": owner.trustee_name,
        "trust_name": owner.trust_name,
        "invoice_issuer_name": owner.invoice_issuer_name,
        "billing_contact_name": owner.billing_contact_name,
        "billing_email": owner.billing_email,
        "invoice_reference": owner.invoice_reference,
        "ownership_split": ownership_split,
        "owner_gst_registered": owner.gst_registered,
        "xero_contact_id": owner.xero_contact_id,
        "xero_tracking_category": name,
        "property_metadata": _demo_metadata(
            (prop.property_metadata if prop is not None else None),
            story="fictional_demo_property",
        ),
    }
    if prop is None:
        prop = Property(**values)
        session.add(prop)
        counters.record("property", created=True)
        session.flush()
        return prop
    counters.record("property", updated=_apply_attrs(prop, values))
    return prop


def _ensure_property_owner(
    session: Session,
    prop: Property,
    owner: Owner,
    counters: _SeedCounters,
    *,
    split_pct: float = 100.0,
) -> None:
    link = session.scalar(
        select(PropertyOwner).where(
            PropertyOwner.property_id == prop.id,
            PropertyOwner.owner_id == owner.id,
        )
    )
    if link is None:
        session.add(PropertyOwner(property_id=prop.id, owner_id=owner.id, split_pct=split_pct))
        counters.record("property_owner", created=True)
        return
    counters.record("property_owner", updated=_apply_attrs(link, {"split_pct": split_pct}))


def _ensure_unit(
    session: Session,
    prop: Property,
    counters: _SeedCounters,
    *,
    label: str,
    sqm: float,
    parking_spaces: int | None = None,
    vacant: bool = False,
) -> TenancyUnit:
    unit = session.scalar(
        select(TenancyUnit).where(
            TenancyUnit.property_id == prop.id,
            TenancyUnit.unit_label == label,
            TenancyUnit.deleted_at.is_(None),
        )
    )
    values = {
        "property_id": prop.id,
        "unit_label": label,
        "sqm": sqm,
        "parking_spaces": parking_spaces,
        "unit_metadata": _demo_metadata(
            (unit.unit_metadata if unit is not None else None),
            vacant=vacant,
        ),
    }
    if unit is None:
        unit = TenancyUnit(**values)
        session.add(unit)
        counters.record("tenancy_unit", created=True)
        session.flush()
        return unit
    counters.record("tenancy_unit", updated=_apply_attrs(unit, values))
    return unit


def _ensure_tenant(
    session: Session,
    entity: Entity,
    counters: _SeedCounters,
    *,
    legal_name: str,
    trading_name: str,
    abn: str,
    contact_name: str,
    contact_email: str,
    contact_phone: str,
    billing_email: str,
    notes: str,
    insurance_expiry: str,
) -> Tenant:
    tenant = session.scalar(
        select(Tenant).where(
            Tenant.entity_id == entity.id,
            Tenant.legal_name == legal_name,
            Tenant.deleted_at.is_(None),
        )
    )
    values = {
        "entity_id": entity.id,
        "legal_name": legal_name,
        "trading_name": trading_name,
        "abn": abn,
        "contact_name": contact_name,
        "contact_email": contact_email,
        "contact_phone": contact_phone,
        "billing_email": billing_email,
        "notes": notes,
        "tenant_metadata": _demo_metadata(
            (tenant.tenant_metadata if tenant is not None else None),
            insurance_expiry_date=insurance_expiry,
        ),
    }
    if tenant is None:
        tenant = Tenant(**values)
        session.add(tenant)
        counters.record("tenant", created=True)
        session.flush()
        return tenant
    counters.record("tenant", updated=_apply_attrs(tenant, values))
    return tenant


def _ensure_lease(
    session: Session,
    unit: TenancyUnit,
    tenant: Tenant,
    counters: _SeedCounters,
    *,
    commencement_date: date,
    expiry_date: date,
    annual_rent_cents: int,
    next_review_date: date | None,
    status: LeaseStatus = LeaseStatus.active,
) -> Lease:
    lease = session.scalar(
        select(Lease).where(
            Lease.tenancy_unit_id == unit.id,
            Lease.tenant_id == tenant.id,
            Lease.deleted_at.is_(None),
        )
    )
    values = {
        "tenancy_unit_id": unit.id,
        "tenant_id": tenant.id,
        "status": status,
        "commencement_date": commencement_date,
        "expiry_date": expiry_date,
        "annual_rent_cents": annual_rent_cents,
        "rent_frequency": RentFrequency.annual,
        "outgoings_recoverable": True,
        "next_review_date": next_review_date,
        "option_summary": "One further three-year option, subject to written notice.",
        "security_summary": "Bank guarantee equal to three months gross rent.",
        "notes": "Fictional AU commercial lease seeded for local demos.",
        "lease_metadata": _demo_metadata(
            (lease.lease_metadata if lease is not None else None),
            review_basis="CPI",
        ),
    }
    if lease is None:
        lease = Lease(**values)
        session.add(lease)
        counters.record("lease", created=True)
        session.flush()
        return lease
    counters.record("lease", updated=_apply_attrs(lease, values))
    return lease


def _ensure_charge_rule(
    session: Session,
    lease: Lease,
    counters: _SeedCounters,
    *,
    charge_type: RentChargeType,
    amount_cents: int,
    next_due_date: date,
    account_code: str | None,
    tax_type: str | None,
    metadata: dict[str, Any] | None = None,
) -> RentChargeRule:
    rule = session.scalar(
        select(RentChargeRule).where(
            RentChargeRule.lease_id == lease.id,
            RentChargeRule.charge_type == charge_type,
            RentChargeRule.deleted_at.is_(None),
        )
    )
    values = {
        "lease_id": lease.id,
        "charge_type": charge_type,
        "amount_cents": amount_cents,
        "frequency": RentFrequency.monthly,
        "gst_treatment": GstTreatment.taxable,
        "xero_account_code": account_code,
        "xero_tax_type": tax_type,
        "next_due_date": next_due_date,
        "arrears_or_advance": "advance",
        "charge_rule_metadata": _demo_metadata(
            (rule.charge_rule_metadata if rule is not None else None),
            **(metadata or {}),
        ),
    }
    if rule is None:
        rule = RentChargeRule(**values)
        session.add(rule)
        counters.record("charge_rule", created=True)
        session.flush()
        return rule
    counters.record("charge_rule", updated=_apply_attrs(rule, values))
    return rule


def _ensure_obligation(
    session: Session,
    entity: Entity,
    counters: _SeedCounters,
    *,
    title: str,
    category: ObligationCategory,
    status: ObligationStatus,
    due_date: date,
    priority: int,
    role: UserRole,
    prop: Property | None = None,
    unit: TenancyUnit | None = None,
    lease: Lease | None = None,
    notes: str | None = None,
) -> Obligation:
    obligation = session.scalar(
        select(Obligation).where(
            Obligation.entity_id == entity.id,
            Obligation.title == title,
            Obligation.deleted_at.is_(None),
        )
    )
    values = {
        "entity_id": entity.id,
        "property_id": prop.id if prop is not None else None,
        "tenancy_unit_id": unit.id if unit is not None else None,
        "lease_id": lease.id if lease is not None else None,
        "title": title,
        "category": category,
        "status": status,
        "due_date": due_date,
        "priority": priority,
        "owner_role": role,
        "notes": notes,
        "obligation_metadata": _demo_metadata(
            obligation.obligation_metadata if obligation is not None else None
        ),
    }
    if obligation is None:
        obligation = Obligation(**values)
        session.add(obligation)
        counters.record("obligation", created=True)
        session.flush()
        return obligation
    counters.record("obligation", updated=_apply_attrs(obligation, values))
    return obligation


def _ensure_contractor(
    session: Session,
    entity: Entity,
    counters: _SeedCounters,
    *,
    name: str,
    company_name: str,
    categories: list[str],
    email: str,
    phone: str,
    priority: int,
) -> Contractor:
    contractor = session.scalar(
        select(Contractor).where(
            Contractor.entity_id == entity.id,
            Contractor.company_name == company_name,
            Contractor.deleted_at.is_(None),
        )
    )
    values = {
        "entity_id": entity.id,
        "name": name,
        "company_name": company_name,
        "categories": categories,
        "email": email,
        "phone": phone,
        "service_radius_km": 25,
        "priority": priority,
        "notes": "Fictional contractor for local demo workflows.",
        "contractor_metadata": _demo_metadata(
            contractor.contractor_metadata if contractor is not None else None
        ),
    }
    if contractor is None:
        contractor = Contractor(**values)
        session.add(contractor)
        counters.record("contractor", created=True)
        session.flush()
        return contractor
    counters.record("contractor", updated=_apply_attrs(contractor, values))
    return contractor


def _ensure_document(
    session: Session,
    entity: Entity,
    counters: _SeedCounters,
    *,
    filename: str,
    category: DocumentCategory,
    notes: str,
    prop: Property | None = None,
    unit: TenancyUnit | None = None,
    tenant: Tenant | None = None,
    lease: Lease | None = None,
) -> StoredDocument:
    document = session.scalar(
        select(StoredDocument).where(
            StoredDocument.entity_id == entity.id,
            StoredDocument.filename == filename,
            StoredDocument.deleted_at.is_(None),
        )
    )
    content = f"{filename}\nFictional local demo document.\n".encode()
    values = {
        "entity_id": entity.id,
        "property_id": prop.id if prop is not None else None,
        "tenancy_unit_id": unit.id if unit is not None else None,
        "tenant_id": tenant.id if tenant is not None else None,
        "lease_id": lease.id if lease is not None else None,
        "filename": filename,
        "content_type": "text/plain",
        "byte_size": len(content),
        "file_data": content,
        "category": category,
        "notes": notes,
        "document_metadata": _demo_metadata(
            document.document_metadata if document is not None else None
        ),
    }
    if document is None:
        document = StoredDocument(**values)
        session.add(document)
        counters.record("document", created=True)
        session.flush()
        return document
    counters.record("document", updated=_apply_attrs(document, values))
    return document


def _ensure_billing_draft(
    session: Session,
    entity: Entity,
    counters: _SeedCounters,
    *,
    title: str,
    document: StoredDocument,
    prop: Property,
    unit: TenancyUnit,
    tenant: Tenant,
    lease: Lease,
) -> BillingDraft:
    draft = session.scalar(
        select(BillingDraft).where(
            BillingDraft.entity_id == entity.id,
            BillingDraft.title == title,
            BillingDraft.deleted_at.is_(None),
        )
    )
    values = {
        "entity_id": entity.id,
        "property_id": prop.id,
        "tenancy_unit_id": unit.id,
        "tenant_id": tenant.id,
        "lease_id": lease.id,
        "document_id": document.id,
        "document_intake_id": None,
        "status": BillingDraftStatus.needs_review,
        "title": title,
        "currency": "AUD",
        "issue_date": date(2026, 6, 1),
        "due_date": date(2026, 6, 15),
        "total_cents": 187000,
        "notes": "Demo outgoings recovery with missing contact mapping to review.",
        "billing_metadata": _demo_metadata(
            (draft.billing_metadata if draft is not None else None),
            blockers=["xero_contact_mapping_missing"],
        ),
    }
    if draft is None:
        draft = BillingDraft(**values)
        session.add(draft)
        counters.record("billing_draft", created=True)
        session.flush()
        return draft
    counters.record("billing_draft", updated=_apply_attrs(draft, values))
    return draft


def _ensure_billing_line(
    session: Session,
    draft: BillingDraft,
    counters: _SeedCounters,
    *,
    description: str,
    amount_cents: int,
) -> BillingDraftLine:
    line = session.scalar(
        select(BillingDraftLine).where(
            BillingDraftLine.billing_draft_id == draft.id,
            BillingDraftLine.description == description,
            BillingDraftLine.deleted_at.is_(None),
        )
    )
    values = {
        "billing_draft_id": draft.id,
        "description": description,
        "amount_cents": amount_cents,
        "currency": "AUD",
        "source_hint": "Demo outgoings schedule",
        "confidence": 0.91,
        "line_metadata": _demo_metadata(line.line_metadata if line is not None else None),
    }
    if line is None:
        line = BillingDraftLine(**values)
        session.add(line)
        counters.record("billing_draft_line", created=True)
        session.flush()
        return line
    counters.record("billing_draft_line", updated=_apply_attrs(line, values))
    return line


def _ensure_invoice_draft(
    session: Session,
    entity: Entity,
    counters: _SeedCounters,
    *,
    billing_draft: BillingDraft,
    document: StoredDocument,
    prop: Property,
    unit: TenancyUnit,
    tenant: Tenant,
    lease: Lease,
) -> InvoiceDraft:
    invoice = session.scalar(
        select(InvoiceDraft).where(
            InvoiceDraft.entity_id == entity.id,
            InvoiceDraft.invoice_number == "DEMO-INV-2026-06-001",
            InvoiceDraft.deleted_at.is_(None),
        )
    )
    values = {
        "entity_id": entity.id,
        "billing_draft_id": billing_draft.id,
        "property_id": prop.id,
        "tenancy_unit_id": unit.id,
        "tenant_id": tenant.id,
        "lease_id": lease.id,
        "document_id": document.id,
        "document_intake_id": None,
        "status": InvoiceDraftStatus.ready_for_approval,
        "invoice_number": "DEMO-INV-2026-06-001",
        "title": "Bright Coffee Co June 2026 outgoings",
        "currency": "AUD",
        "issue_date": date(2026, 6, 1),
        "due_date": date(2026, 6, 15),
        "subtotal_cents": 170000,
        "gst_cents": 17000,
        "total_cents": 187000,
        "issuer_name": prop.invoice_issuer_name,
        "issuer_abn": prop.owner_abn,
        "recipient_name": tenant.legal_name,
        "recipient_email": tenant.billing_email,
        "notes": "Demo invoice draft for local billing review.",
        "invoice_metadata": _demo_metadata(
            (invoice.invoice_metadata if invoice is not None else None),
            payment={"paid_cents": 65000, "outstanding_cents": 122000},
        ),
    }
    if invoice is None:
        invoice = InvoiceDraft(**values)
        session.add(invoice)
        counters.record("invoice_draft", created=True)
        session.flush()
        return invoice
    counters.record("invoice_draft", updated=_apply_attrs(invoice, values))
    return invoice


def _ensure_invoice_line(
    session: Session,
    invoice: InvoiceDraft,
    counters: _SeedCounters,
    *,
    description: str,
    amount_cents: int,
    gst_cents: int,
) -> None:
    line = session.scalar(
        select(InvoiceDraftLine).where(
            InvoiceDraftLine.invoice_draft_id == invoice.id,
            InvoiceDraftLine.description == description,
            InvoiceDraftLine.deleted_at.is_(None),
        )
    )
    values = {
        "invoice_draft_id": invoice.id,
        "billing_draft_line_id": None,
        "description": description,
        "amount_cents": amount_cents,
        "gst_cents": gst_cents,
        "currency": "AUD",
        "source_hint": "Demo billing draft",
        "line_metadata": _demo_metadata(line.line_metadata if line is not None else None),
    }
    if line is None:
        session.add(InvoiceDraftLine(**values))
        counters.record("invoice_draft_line", created=True)
        return
    counters.record("invoice_draft_line", updated=_apply_attrs(line, values))


def _ensure_work_order(
    session: Session,
    entity: Entity,
    counters: _SeedCounters,
    *,
    prop: Property,
    unit: TenancyUnit,
    tenant: Tenant,
    lease: Lease,
    contractor: Contractor,
    document: StoredDocument,
) -> None:
    work_order = session.scalar(
        select(MaintenanceWorkOrder).where(
            MaintenanceWorkOrder.entity_id == entity.id,
            MaintenanceWorkOrder.title == "Arcade lighting circuit fault",
            MaintenanceWorkOrder.deleted_at.is_(None),
        )
    )
    values = {
        "entity_id": entity.id,
        "property_id": prop.id,
        "tenancy_unit_id": unit.id,
        "tenant_id": tenant.id,
        "lease_id": lease.id,
        "title": "Arcade lighting circuit fault",
        "description": "Intermittent lighting outage near the arcade entry after rain.",
        "status": MaintenanceWorkOrderStatus.triaged,
        "priority": MaintenancePriority.high,
        "requested_at": datetime(2026, 6, 2, 0, 0, 0),
        "contractor_name": contractor.company_name,
        "contractor_email": contractor.email,
        "contractor_phone": contractor.phone,
        "contractor_assigned_at": None,
        "approval_required": True,
        "approval_status": MaintenanceApprovalStatus.pending,
        "approval_limit_cents": 150000,
        "quote_amount_cents": 118000,
        "source_document_id": document.id,
        "source_reference": "DEMO-WO-ARC-001",
        "due_date": date(2026, 6, 10),
        "notes": "Demo maintenance item awaiting operator approval.",
        "attachments": {"document_ids": [str(document.id)]},
        "work_order_metadata": _demo_metadata(
            (work_order.work_order_metadata if work_order is not None else None),
            category="electrical",
        ),
    }
    if work_order is None:
        session.add(MaintenanceWorkOrder(**values))
        counters.record("maintenance_work_order", created=True)
        return
    counters.record("maintenance_work_order", updated=_apply_attrs(work_order, values))


def _ensure_arrears_case(
    session: Session,
    entity: Entity,
    counters: _SeedCounters,
    *,
    prop: Property,
    unit: TenancyUnit,
    tenant: Tenant,
    lease: Lease,
    user: AppUser,
) -> None:
    arrears = session.scalar(
        select(ArrearsCase).where(
            ArrearsCase.entity_id == entity.id,
            ArrearsCase.source_reference == "DEMO-ARREARS-BRIGHT-2026-06",
            ArrearsCase.deleted_at.is_(None),
        )
    )
    values = {
        "entity_id": entity.id,
        "property_id": prop.id,
        "tenancy_unit_id": unit.id,
        "tenant_id": tenant.id,
        "lease_id": lease.id,
        "status": ArrearsCaseStatus.active,
        "currency": "AUD",
        "as_of": date(2026, 6, 2),
        "balance_current_cents": 122000,
        "balance_1_30_cents": 0,
        "balance_31_60_cents": 0,
        "balance_61_90_cents": 0,
        "balance_90_plus_cents": 0,
        "total_balance_cents": 122000,
        "oldest_unpaid_invoice_date": date(2026, 6, 1),
        "last_invoice_date": date(2026, 6, 1),
        "source_reference": "DEMO-ARREARS-BRIGHT-2026-06",
        "reminder_stage": 1,
        "reminder_frequency_days": 7,
        "next_reminder_on": date(2026, 6, 9),
        "assigned_user_id": user.id,
        "notes": "Demo arrears item tied to the partially paid invoice draft.",
        "arrears_metadata": _demo_metadata(
            arrears.arrears_metadata if arrears is not None else None
        ),
    }
    if arrears is None:
        session.add(ArrearsCase(**values))
        counters.record("arrears_case", created=True)
        return
    counters.record("arrears_case", updated=_apply_attrs(arrears, values))


def _ensure_onboarding(
    session: Session,
    entity: Entity,
    counters: _SeedCounters,
    *,
    tenant: Tenant,
    lease: Lease,
) -> None:
    onboarding = session.scalar(
        select(TenantOnboarding).where(
            TenantOnboarding.token == "demo-urban-dental-2026",
            TenantOnboarding.deleted_at.is_(None),
        )
    )
    values = {
        "entity_id": entity.id,
        "lease_id": lease.id,
        "tenant_id": tenant.id,
        "token": "demo-urban-dental-2026",
        "status": TenantOnboardingStatus.sent,
        "due_date": date(2026, 6, 14),
        "expires_at": datetime(2026, 6, 30, tzinfo=UTC),
        "delivery_data": _demo_metadata(
            (onboarding.delivery_data if onboarding is not None else None),
            sent_via="local_demo",
        ),
        "review_data": _demo_metadata(onboarding.review_data if onboarding is not None else None),
    }
    if onboarding is None:
        session.add(TenantOnboarding(**values))
        counters.record("tenant_onboarding", created=True)
        return
    counters.record("tenant_onboarding", updated=_apply_attrs(onboarding, values))


def seed_demo(session: Session | None = None) -> DemoSeedSummary:
    """Seed the fictional AU demo portfolio and return a concise summary."""

    if session is None:
        with SessionLocal() as managed_session:
            return _seed_demo(managed_session)
    return _seed_demo(session)


def _seed_demo(session: Session) -> DemoSeedSummary:
    counters = _SeedCounters()

    organisation = _ensure_organisation(session, counters)
    user = _ensure_user(session, organisation, counters)
    entity = _ensure_entity(session, organisation, counters)
    _ensure_role(session, user, entity, counters)

    rivergum_owner = _ensure_owner(
        session,
        entity,
        counters,
        legal_name="Rivergum Property Trust",
        abn="61 384 920 117",
        trustee_name="Rivergum Trustee Pty Ltd",
        trust_name="Rivergum Property Trust",
        billing_email="accounts@rivergum.example",
        invoice_reference="RIV-",
    )
    meridian_owner = _ensure_owner(
        session,
        entity,
        counters,
        legal_name="Meridian Lane Super Fund Pty Ltd",
        abn="70 412 884 650",
        trustee_name="Meridian Lane Super Fund Pty Ltd",
        trust_name="Meridian Lane Super Fund",
        billing_email="finance@meridianlane.example",
        invoice_reference="MER-",
    )

    kingfisher = _ensure_property(
        session,
        entity,
        counters,
        name="Kingfisher Retail Arcade",
        street_address="18 Kingfisher Lane",
        suburb="Brisbane City",
        postcode="4000",
        property_type=PropertyType.commercial_retail,
        parcel_id="L12-SP98765",
        land_sqm=920,
        building_sqm=760,
        parking_spaces=16,
        owner=rivergum_owner,
        ownership_split="100% Rivergum Property Trust",
    )
    moorooka = _ensure_property(
        session,
        entity,
        counters,
        name="Moorooka Trade Warehouse",
        street_address="44 Ipswich Road",
        suburb="Moorooka",
        postcode="4105",
        property_type=PropertyType.commercial_industrial,
        parcel_id="L4-RP224190",
        land_sqm=1800,
        building_sqm=1280,
        parking_spaces=10,
        owner=rivergum_owner,
        ownership_split="100% Rivergum Property Trust",
    )
    newstead = _ensure_property(
        session,
        entity,
        counters,
        name="Newstead Creative Offices",
        street_address="9 Doggett Street",
        suburb="Newstead",
        postcode="4006",
        property_type=PropertyType.commercial_office,
        parcel_id="L22-SP88102",
        land_sqm=740,
        building_sqm=610,
        parking_spaces=8,
        owner=meridian_owner,
        ownership_split="100% Meridian Lane Super Fund",
    )
    for prop, owner in (
        (kingfisher, rivergum_owner),
        (moorooka, rivergum_owner),
        (newstead, meridian_owner),
    ):
        _ensure_property_owner(session, prop, owner, counters)

    king_shop_1 = _ensure_unit(session, kingfisher, counters, label="Shop 1", sqm=86)
    king_shop_2 = _ensure_unit(session, kingfisher, counters, label="Shop 2", sqm=112)
    moorooka_whole = _ensure_unit(
        session,
        moorooka,
        counters,
        label="Whole warehouse",
        sqm=1280,
        parking_spaces=10,
    )
    newstead_suite_201 = _ensure_unit(
        session,
        newstead,
        counters,
        label="Suite 2.01",
        sqm=210,
        parking_spaces=3,
    )
    _ensure_unit(
        session,
        newstead,
        counters,
        label="Suite 2.02",
        sqm=140,
        parking_spaces=2,
        vacant=True,
    )

    bright = _ensure_tenant(
        session,
        entity,
        counters,
        legal_name="Bright Coffee Co Pty Ltd",
        trading_name="Bright Coffee Co",
        abn="34 823 511 902",
        contact_name="Mia Hart",
        contact_email="mia@brightcoffee.example",
        contact_phone="0400 111 222",
        billing_email="accounts@brightcoffee.example",
        notes="Prefers email reminders and monthly statement copies.",
        insurance_expiry="2026-05-31",
    )
    urban_dental = _ensure_tenant(
        session,
        entity,
        counters,
        legal_name="Urban Dental Brisbane Pty Ltd",
        trading_name="Urban Dental",
        abn="11 481 730 295",
        contact_name="Dr Hana Lee",
        contact_email="hana@urbandental.example",
        contact_phone="0400 222 333",
        billing_email="accounts@urbandental.example",
        notes="Awaiting onboarding document refresh.",
        insurance_expiry="2027-01-31",
    )
    logistics = _ensure_tenant(
        session,
        entity,
        counters,
        legal_name="River Logistics Pty Ltd",
        trading_name="River Logistics",
        abn="92 348 720 110",
        contact_name="Noah Patel",
        contact_email="noah@riverlogistics.example",
        contact_phone="0400 333 444",
        billing_email="finance@riverlogistics.example",
        notes="Recoverable outgoings under warehouse lease.",
        insurance_expiry="2026-11-30",
    )
    studio = _ensure_tenant(
        session,
        entity,
        counters,
        legal_name="Studio North Creative Pty Ltd",
        trading_name="Studio North",
        abn="53 891 204 665",
        contact_name="Elena Ruiz",
        contact_email="elena@studionorth.example",
        contact_phone="0400 444 555",
        billing_email="accounts@studionorth.example",
        notes="Lease expiry review due before December.",
        insurance_expiry="2027-03-31",
    )

    bright_lease = _ensure_lease(
        session,
        king_shop_1,
        bright,
        counters,
        commencement_date=date(2025, 7, 1),
        expiry_date=date(2028, 6, 30),
        annual_rent_cents=13200000,
        next_review_date=date(2026, 6, 16),
    )
    dental_lease = _ensure_lease(
        session,
        king_shop_2,
        urban_dental,
        counters,
        commencement_date=date(2026, 2, 1),
        expiry_date=date(2029, 1, 31),
        annual_rent_cents=16800000,
        next_review_date=date(2027, 2, 1),
    )
    logistics_lease = _ensure_lease(
        session,
        moorooka_whole,
        logistics,
        counters,
        commencement_date=date(2024, 10, 1),
        expiry_date=date(2027, 9, 30),
        annual_rent_cents=24000000,
        next_review_date=date(2026, 10, 1),
    )
    studio_lease = _ensure_lease(
        session,
        newstead_suite_201,
        studio,
        counters,
        commencement_date=date(2023, 12, 1),
        expiry_date=date(2026, 12, 31),
        annual_rent_cents=15600000,
        next_review_date=None,
    )

    _ensure_charge_rule(
        session,
        bright_lease,
        counters,
        charge_type=RentChargeType.base_rent,
        amount_cents=1100000,
        next_due_date=date(2026, 6, 1),
        account_code="200",
        tax_type="OUTPUT",
    )
    _ensure_charge_rule(
        session,
        bright_lease,
        counters,
        charge_type=RentChargeType.outgoings,
        amount_cents=170000,
        next_due_date=date(2026, 6, 1),
        account_code=None,
        tax_type=None,
        metadata={"readiness_blockers": ["xero_contact_mapping_missing"]},
    )
    _ensure_charge_rule(
        session,
        dental_lease,
        counters,
        charge_type=RentChargeType.base_rent,
        amount_cents=1400000,
        next_due_date=date(2026, 6, 1),
        account_code="200",
        tax_type="OUTPUT",
    )
    _ensure_charge_rule(
        session,
        logistics_lease,
        counters,
        charge_type=RentChargeType.base_rent,
        amount_cents=2000000,
        next_due_date=date(2026, 6, 1),
        account_code="200",
        tax_type="OUTPUT",
    )
    _ensure_charge_rule(
        session,
        studio_lease,
        counters,
        charge_type=RentChargeType.base_rent,
        amount_cents=1300000,
        next_due_date=date(2026, 6, 1),
        account_code="200",
        tax_type="OUTPUT",
    )

    _ensure_obligation(
        session,
        entity,
        counters,
        title="Bright Coffee Co rent review",
        category=ObligationCategory.rent_review,
        status=ObligationStatus.due_soon,
        due_date=date(2026, 6, 16),
        priority=1,
        role=UserRole.finance,
        prop=kingfisher,
        unit=king_shop_1,
        lease=bright_lease,
        notes="CPI review due in the current demo window.",
    )
    _ensure_obligation(
        session,
        entity,
        counters,
        title="Bright Coffee Co insurance certificate overdue",
        category=ObligationCategory.insurance,
        status=ObligationStatus.overdue,
        due_date=date(2026, 5, 31),
        priority=1,
        role=UserRole.ops,
        prop=kingfisher,
        unit=king_shop_1,
        lease=bright_lease,
        notes="Demo overdue insurance certificate.",
    )
    _ensure_obligation(
        session,
        entity,
        counters,
        title="Studio North lease expiry review",
        category=ObligationCategory.lease_expiry,
        status=ObligationStatus.upcoming,
        due_date=date(2026, 12, 31),
        priority=2,
        role=UserRole.ops,
        prop=newstead,
        unit=newstead_suite_201,
        lease=studio_lease,
        notes="Expiry review keeps the calendar and insights populated.",
    )

    electrical = _ensure_contractor(
        session,
        entity,
        counters,
        name="Ava Nguyen",
        company_name="SparkRight Electrical",
        categories=["electrical", "lighting"],
        email="dispatch@sparkright.example",
        phone="07 3000 0101",
        priority=1,
    )
    _ensure_contractor(
        session,
        entity,
        counters,
        name="Lucas Warren",
        company_name="Pipewise Plumbing",
        categories=["plumbing", "roofing"],
        email="jobs@pipewise.example",
        phone="07 3000 0202",
        priority=2,
    )
    _ensure_contractor(
        session,
        entity,
        counters,
        name="Priya Singh",
        company_name="CoolAir Commercial HVAC",
        categories=["hvac", "air_conditioning"],
        email="service@coolaircommercial.example",
        phone="07 3000 0303",
        priority=2,
    )

    lease_doc = _ensure_document(
        session,
        entity,
        counters,
        filename="demo-bright-coffee-lease.txt",
        category=DocumentCategory.lease,
        notes="Fictional lease document for Bright Coffee Co.",
        prop=kingfisher,
        unit=king_shop_1,
        tenant=bright,
        lease=bright_lease,
    )
    billing_doc = _ensure_document(
        session,
        entity,
        counters,
        filename="demo-june-2026-outgoings.txt",
        category=DocumentCategory.invoice,
        notes="Fictional outgoings schedule for local billing review.",
        prop=kingfisher,
        unit=king_shop_1,
        tenant=bright,
        lease=bright_lease,
    )
    maintenance_doc = _ensure_document(
        session,
        entity,
        counters,
        filename="demo-arcade-lighting-fault.txt",
        category=DocumentCategory.other,
        notes="Fictional maintenance evidence note.",
        prop=kingfisher,
        unit=king_shop_1,
        tenant=bright,
        lease=bright_lease,
    )

    billing_draft = _ensure_billing_draft(
        session,
        entity,
        counters,
        title="June 2026 retail outgoings recovery",
        document=billing_doc,
        prop=kingfisher,
        unit=king_shop_1,
        tenant=bright,
        lease=bright_lease,
    )
    _ensure_billing_line(
        session,
        billing_draft,
        counters,
        description="Retail arcade electricity recovery",
        amount_cents=104500,
    )
    _ensure_billing_line(
        session,
        billing_draft,
        counters,
        description="Common-area cleaning recovery",
        amount_cents=65500,
    )
    invoice_draft = _ensure_invoice_draft(
        session,
        entity,
        counters,
        billing_draft=billing_draft,
        document=billing_doc,
        prop=kingfisher,
        unit=king_shop_1,
        tenant=bright,
        lease=bright_lease,
    )
    _ensure_invoice_line(
        session,
        invoice_draft,
        counters,
        description="Retail arcade electricity recovery",
        amount_cents=104500,
        gst_cents=10450,
    )
    _ensure_invoice_line(
        session,
        invoice_draft,
        counters,
        description="Common-area cleaning recovery",
        amount_cents=65500,
        gst_cents=6550,
    )

    _ensure_work_order(
        session,
        entity,
        counters,
        prop=kingfisher,
        unit=king_shop_1,
        tenant=bright,
        lease=bright_lease,
        contractor=electrical,
        document=maintenance_doc,
    )
    _ensure_arrears_case(
        session,
        entity,
        counters,
        prop=kingfisher,
        unit=king_shop_1,
        tenant=bright,
        lease=bright_lease,
        user=user,
    )
    _ensure_onboarding(session, entity, counters, tenant=urban_dental, lease=dental_lease)

    # Touch the lease document after onboarding-adjacent data exists so the
    # stored document panel has a local provenance example.
    lease_doc.document_metadata = _demo_metadata(
        lease_doc.document_metadata,
        provenance="local_demo_seed",
    )

    session.commit()
    return DemoSeedSummary(
        entity_id=entity.id,
        created=dict(counters.created),
        updated=dict(counters.updated),
    )


def main() -> None:
    summary = seed_demo()
    created = ", ".join(f"{key}={value}" for key, value in sorted(summary.created.items()))
    updated = ", ".join(f"{key}={value}" for key, value in sorted(summary.updated.items()))
    print(f"Demo seed ready for {DEMO_ENTITY_NAME} ({summary.entity_id}).")
    print(f"Created: {created or 'none'}")
    print(f"Updated: {updated or 'none'}")


if __name__ == "__main__":
    main()
