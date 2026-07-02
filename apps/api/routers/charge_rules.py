"""Rent charge rule and rent roll routes."""

from datetime import date
from decimal import ROUND_FLOOR, Decimal
from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import HTMLResponse
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    BillingDraft,
    BillingDraftLine,
    BillingDraftStatus,
    DocumentCategory,
    DocumentIntake,
    Entity,
    InvoiceDraft,
    InvoiceDraftLine,
    InvoiceDraftStatus,
    Lease,
    LeaseUnit,
    Property,
    RentChargeRule,
    StoredDocument,
    TenancyUnit,
    Tenant,
    UnitApportionmentStrategy,
    UserRole,
)
from stewart.core.settings import Settings, get_settings
from stewart.integrations.communications import (
    DeliveryResult,
    InvoiceDeliveryEmail,
    render_invoice_delivery_email_preview,
    send_invoice_delivery_email,
)
from stewart.integrations.invoice_render import (
    render_invoice_html,
    render_invoice_pdf,
    resolve_invoice_brand,
)

from apps.api import webhook_auth
from apps.api.deps import (
    CurrentUser,
    assert_entity_role,
    get_current_user,
    get_session,
    readable_entity_ids,
)
from apps.api.schemas.register import (
    BillingDraftBatchRead,
    BillingDraftBatchSkippedRead,
    BillingDraftFromChargeRulesCreate,
    BillingDraftRead,
    BillingDraftUpdate,
    InvoiceDraftDeliverySendRecord,
    InvoiceDraftPaymentStatusUpdate,
    InvoiceDraftRead,
    InvoiceDraftUpdate,
    RentChargeRuleCreate,
    RentChargeRuleRead,
    RentChargeRuleUpdate,
    RentRollChargeRuleRead,
    RentRollRowRead,
)

router = APIRouter(tags=["billing"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}
PROPERTY_OWNER_BILLING_STRUCTURES = {"property_owner", "trust", "split"}
BILLING_DRAFT_CHARGE_RULE_SOURCE = "charge_rule_batch"


def _property_for_access(
    property_id: UUID, user: CurrentUser, session: Session, roles: set[UserRole]
) -> Property:
    prop = session.get(Property, property_id)
    if prop is None or prop.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found.")
    assert_entity_role(session, user, prop.entity_id, roles)
    return prop


def _document_intake_for_access(
    document_intake_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> DocumentIntake:
    intake = session.get(DocumentIntake, document_intake_id)
    if intake is None or intake.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document intake not found.",
        )
    assert_entity_role(session, user, intake.entity_id, roles)
    return intake


def _lease_for_access(
    lease_id: UUID, user: CurrentUser, session: Session, roles: set[UserRole]
) -> tuple[Lease, UUID]:
    lease = session.get(Lease, lease_id)
    if lease is None or lease.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lease not found.")
    unit = session.get(TenancyUnit, lease.tenancy_unit_id)
    if unit is None or unit.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenancy unit not found.")
    prop = _property_for_access(unit.property_id, user, session, roles)
    tenant = session.get(Tenant, lease.tenant_id)
    if tenant is None or tenant.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found.")
    if tenant.entity_id != prop.entity_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Lease links tenant and unit across different entities.",
        )
    return lease, prop.entity_id


def _charge_rule_for_access(
    charge_rule_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> tuple[RentChargeRule, UUID]:
    charge_rule = session.get(RentChargeRule, charge_rule_id)
    if charge_rule is None or charge_rule.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Charge rule not found.")
    _, entity_id = _lease_for_access(charge_rule.lease_id, user, session, roles)
    return charge_rule, entity_id


def _billing_draft_for_access(
    billing_draft_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> BillingDraft:
    draft = session.get(BillingDraft, billing_draft_id)
    if draft is None or draft.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Billing draft not found.",
        )
    assert_entity_role(session, user, draft.entity_id, roles)
    return draft


def _invoice_draft_for_access(
    invoice_draft_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> InvoiceDraft:
    draft = session.get(InvoiceDraft, invoice_draft_id)
    if draft is None or draft.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invoice draft not found.",
        )
    assert_entity_role(session, user, draft.entity_id, roles)
    return draft


def _invoice_number_for_billing_draft(
    draft: BillingDraft,
    prop: Property | None,
) -> str:
    prefix = (prop.invoice_reference if prop is not None else None) or "INV-"
    if not prefix.endswith(("-", "/")):
        prefix = f"{prefix}-"
    invoice_date = draft.issue_date or draft.due_date or date.today()
    return f"{prefix}{invoice_date:%Y%m%d}-{str(draft.id)[:8].upper()}"


def _source_hint_from_charge_rule(rule: RentChargeRule) -> str:
    metadata = rule.charge_rule_metadata or {}
    source_hint = metadata.get("source_hint")
    if isinstance(source_hint, str) and source_hint:
        return source_hint
    source_sheet = metadata.get("source_sheet")
    source_row = metadata.get("source_row")
    if isinstance(source_sheet, str) and source_sheet:
        if source_row is not None:
            return f"{source_sheet} row {source_row}"
        return source_sheet
    source = metadata.get("source")
    if isinstance(source, str) and source:
        return source.replace("_", " ")
    import_source = metadata.get("portfolio_import_source")
    if isinstance(import_source, str) and import_source:
        return import_source.replace("_", " ")
    return "Lease charge rule"


def _normalise_charge_rule_metadata(data: dict[str, Any]) -> None:
    metadata = dict(data.pop("metadata", {}) or {})
    if "split_by_unit" in data:
        if data.pop("split_by_unit") is True:
            metadata["split_by_unit"] = True
        else:
            metadata.pop("split_by_unit", None)
    if "unit_amount_overrides_cents" in data:
        raw_overrides = data.pop("unit_amount_overrides_cents") or {}
        overrides: dict[str, int] = {}
        for unit_id, value in raw_overrides.items():
            try:
                parsed_unit_id = str(unit_id if isinstance(unit_id, UUID) else UUID(str(unit_id)))
                amount = int(value)
            except (TypeError, ValueError):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="Unit amount overrides must use tenancy unit ids and cent amounts.",
                ) from None
            if amount < 0:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="Unit amount overrides cannot be negative.",
                )
            overrides[parsed_unit_id] = amount
        if overrides:
            metadata["unit_amount_overrides_cents"] = overrides
        else:
            metadata.pop("unit_amount_overrides_cents", None)
    data["charge_rule_metadata"] = metadata


def _billing_prep_filename(unit: TenancyUnit, tenant: Tenant, period_key: str) -> str:
    safe_parts = [
        "".join(char for char in tenant.legal_name if char.isalnum() or char in (" ", "-", "_"))
        .strip()
        .replace(" ", "-")
        .lower(),
        "".join(char for char in unit.unit_label if char.isalnum() or char in (" ", "-", "_"))
        .strip()
        .replace(" ", "-")
        .lower(),
    ]
    safe_name = "-".join(part for part in safe_parts if part)[:80] or "tenant"
    return f"billing-prep-{period_key}-{safe_name}.txt"


def _charge_rule_base_metadata(rule: RentChargeRule) -> dict[str, object | None]:
    return {
        "source": BILLING_DRAFT_CHARGE_RULE_SOURCE,
        "charge_rule_id": str(rule.id),
        "charge_type": rule.charge_type.value,
        "frequency": rule.frequency.value,
        "gst_treatment": rule.gst_treatment.value,
        "xero_account_code": rule.xero_account_code,
        "xero_tax_type": rule.xero_tax_type,
        "start_date": rule.start_date.isoformat() if rule.start_date else None,
        "end_date": rule.end_date.isoformat() if rule.end_date else None,
        "next_invoice_date": rule.next_invoice_date.isoformat()
        if rule.next_invoice_date
        else None,
        "next_due_date": rule.next_due_date.isoformat() if rule.next_due_date else None,
    }


def _charge_rule_line_description(rule: RentChargeRule) -> str:
    return rule.charge_type.value.replace("_", " ").title()


def _active_lease_unit_links(lease: Lease) -> list[LeaseUnit]:
    return [
        link
        for link in sorted(lease.active_unit_links, key=lambda item: item.created_at)
        if link.tenancy_unit is not None and link.tenancy_unit.deleted_at is None
    ]


def _lease_unit_weight(lease: Lease, link: LeaseUnit) -> Decimal:
    if lease.unit_apportionment_strategy == UnitApportionmentStrategy.area:
        return Decimal(link.apportionment_area_sqm or 0)
    if lease.unit_apportionment_strategy == UnitApportionmentStrategy.manual_amount:
        return Decimal(link.manual_amount_cents or 0)
    return Decimal(link.apportionment_percent or 0)


def _allocate_split_amounts(
    *,
    total_cents: int,
    lease: Lease,
    links: list[LeaseUnit],
    overrides: dict[UUID, int],
) -> dict[UUID, int]:
    amounts: dict[UUID, int] = {}
    auto_links: list[LeaseUnit] = []
    override_total = 0
    for link in links:
        override = overrides.get(link.tenancy_unit_id)
        if override is None:
            auto_links.append(link)
            continue
        amounts[link.tenancy_unit_id] = override
        override_total += override

    if override_total > total_cents:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Unit amount overrides cannot exceed the charge amount.",
        )

    remaining = total_cents - override_total
    if not auto_links:
        if remaining > 0 and links:
            last_link = links[-1]
            amounts[last_link.tenancy_unit_id] = (
                amounts.get(last_link.tenancy_unit_id, 0) + remaining
            )
        return amounts

    weights = [_lease_unit_weight(lease, link) for link in auto_links]
    if sum(weights, Decimal("0")) <= 0:
        weights = [Decimal("1") for _ in auto_links]
    total_weight = sum(weights, Decimal("0"))
    allocated = 0
    for index, link in enumerate(auto_links):
        if index == len(auto_links) - 1:
            amount = remaining - allocated
        else:
            amount = int(
                (Decimal(remaining) * weights[index] / total_weight).to_integral_value(
                    rounding=ROUND_FLOOR
                )
            )
            allocated += amount
        amounts[link.tenancy_unit_id] = amount
    return amounts


def _billing_line_payloads_from_charge_rule(
    *,
    rule: RentChargeRule,
    lease: Lease,
    billing_draft_id: UUID,
) -> list[dict[str, Any]]:
    base_description = _charge_rule_line_description(rule)
    base_metadata = _charge_rule_base_metadata(rule)
    if not rule.split_by_unit:
        return [
            {
                "billing_draft_id": billing_draft_id,
                "description": base_description,
                "amount_cents": rule.amount_cents,
                "currency": "AUD",
                "source_hint": _source_hint_from_charge_rule(rule),
                "confidence": 1.0,
                "line_metadata": base_metadata,
            }
        ]

    links = _active_lease_unit_links(lease)
    if not links:
        return [
            {
                "billing_draft_id": billing_draft_id,
                "description": base_description,
                "amount_cents": rule.amount_cents,
                "currency": "AUD",
                "source_hint": _source_hint_from_charge_rule(rule),
                "confidence": 1.0,
                "line_metadata": {
                    **base_metadata,
                    "split_by_unit": True,
                    "source_charge_amount_cents": rule.amount_cents,
                    "apportionment_strategy": lease.unit_apportionment_strategy.value,
                },
            }
        ]

    amounts = _allocate_split_amounts(
        total_cents=rule.amount_cents,
        lease=lease,
        links=links,
        overrides=rule.unit_amount_overrides_cents,
    )
    payloads: list[dict[str, Any]] = []
    for link in links:
        unit = link.tenancy_unit
        unit_label = unit.unit_label if unit is not None else str(link.tenancy_unit_id)
        override_amount = rule.unit_amount_overrides_cents.get(link.tenancy_unit_id)
        payloads.append(
            {
                "billing_draft_id": billing_draft_id,
                "description": f"{base_description} - {unit_label}",
                "amount_cents": amounts.get(link.tenancy_unit_id, 0),
                "currency": "AUD",
                "source_hint": _source_hint_from_charge_rule(rule),
                "confidence": 1.0,
                "line_metadata": {
                    **base_metadata,
                    "split_by_unit": True,
                    "source_charge_amount_cents": rule.amount_cents,
                    "lease_unit_id": str(link.id),
                    "tenancy_unit_id": str(link.tenancy_unit_id),
                    "unit_label": unit_label,
                    "apportionment_strategy": lease.unit_apportionment_strategy.value,
                    "apportionment_percent": (
                        float(link.apportionment_percent)
                        if link.apportionment_percent is not None
                        else None
                    ),
                    "apportionment_area_sqm": (
                        float(link.apportionment_area_sqm)
                        if link.apportionment_area_sqm is not None
                        else None
                    ),
                    "manual_amount_cents": link.manual_amount_cents,
                    "unit_amount_override": override_amount is not None,
                },
            }
        )
    return payloads


def _invoice_draft_blockers(
    draft: BillingDraft,
    prop: Property | None,
    tenant: Tenant | None,
    entity: Entity | None,
    line_count: int,
) -> list[str]:
    blockers: list[str] = []
    structure = prop.ownership_structure if prop is not None else None

    if prop is None:
        blockers.append("Property record missing.")
    elif not (
        prop.invoice_issuer_name
        or prop.owner_legal_name
        or (entity.name if entity is not None else None)
    ):
        blockers.append("Invoice issuer missing.")
    if prop is not None and structure in PROPERTY_OWNER_BILLING_STRUCTURES and not prop.owner_abn:
        blockers.append("ABN missing for property owner.")
    if tenant is None:
        blockers.append("Tenant record missing.")
    elif not (tenant.billing_email or tenant.contact_email):
        blockers.append("Tenant billing email missing.")
    if draft.due_date is None:
        blockers.append("Due date missing.")
    if line_count == 0:
        blockers.append("Invoice draft has no line items.")
    if draft.total_cents <= 0:
        blockers.append("Invoice draft amount missing.")
    if prop is not None and not prop.xero_contact_id:
        blockers.append("Xero issuer mapping missing before sync.")
    if entity is not None and not entity.xero_tenant_id:
        blockers.append("Xero connection missing before sync.")
    return blockers


def _invoice_draft_delivery_blockers(draft: InvoiceDraft) -> list[str]:
    blockers: list[str] = []
    active_lines = [line for line in draft.lines if line.deleted_at is None]
    if not draft.invoice_number:
        blockers.append("Invoice number missing.")
    if not draft.issuer_name:
        blockers.append("Invoice issuer missing.")
    if not draft.recipient_name:
        blockers.append("Recipient name missing.")
    if not draft.recipient_email:
        blockers.append("Tenant billing email missing.")
    if draft.due_date is None:
        blockers.append("Due date missing.")
    if not active_lines:
        blockers.append("Invoice draft has no line items.")
    if draft.total_cents <= 0:
        blockers.append("Invoice draft amount missing.")
    return blockers


def _invoice_money(cents: int, currency: str) -> str:
    amount = cents / 100
    return f"{currency} {amount:,.2f}"


def _invoice_brand_metadata(
    draft: InvoiceDraft,
    settings: Settings,
) -> dict[str, str | None]:
    sender_name = draft.issuer_name or "Relby Billing"
    return {
        "template_key": settings.invoice_email_template_key,
        "template_version": settings.invoice_email_template_version,
        "sender_name": sender_name,
        "reply_to": None,
        "footer": "Prepared in Relby. External delivery requires approval.",
    }


def _invoice_email_preview(
    draft: InvoiceDraft,
    settings: Settings,
) -> dict[str, object]:
    subject_number = draft.invoice_number or str(draft.id)[:8].upper()
    due = draft.due_date.isoformat() if draft.due_date else "the due date shown on the invoice"
    brand = _invoice_brand_metadata(draft, settings)
    body = (
        f"Hi {draft.recipient_name or 'there'},\n\n"
        f"Please find invoice {subject_number} for "
        f"{_invoice_money(draft.total_cents, draft.currency)} attached for review. "
        f"Payment is due {due}.\n\n"
        "This email draft uses the Relby invoice template and is ready for approval. "
        "No email has been sent."
    )
    return {
        "to": draft.recipient_email,
        "from_name": brand["sender_name"],
        "reply_to": brand["reply_to"],
        "subject": f"Invoice {subject_number} from {draft.issuer_name or 'Relby'}",
        "body": body,
        "brand": brand,
        "template_key": settings.invoice_email_template_key,
        "template_version": settings.invoice_email_template_version,
    }


def _rendered_message_preview_payload(invite: InvoiceDeliveryEmail) -> dict[str, object | None]:
    preview = render_invoice_delivery_email_preview(invite)
    return {
        "channel": preview.channel,
        "provider": preview.provider,
        "recipient": preview.recipient,
        "subject": preview.subject,
        "body_text": preview.body_text,
        "template_key": preview.template_key,
        "template_version": preview.template_version,
        "action_label": preview.action_label,
        "action_url": preview.action_url,
    }


def _invoice_delivery_preview_invite(
    draft: InvoiceDraft,
    pdf_artifact: dict[str, object],
    settings: Settings,
) -> InvoiceDeliveryEmail:
    preview_path = f"/api/v1/invoice-drafts/{draft.id}/preview"
    preview_url = (
        f"{settings.public_api_url.rstrip('/')}{preview_path}"
        if settings.public_api_url
        else preview_path
    )
    due_label = draft.due_date.isoformat() if draft.due_date else "the due date on the invoice"
    return InvoiceDeliveryEmail(
        invoice_draft_id=draft.id,
        entity_id=draft.entity_id,
        invoice_number=draft.invoice_number,
        title=draft.title,
        issuer_name=draft.issuer_name,
        recipient_name=draft.recipient_name,
        recipient_email=draft.recipient_email,
        preview_url=preview_url,
        total_label=_invoice_money(draft.total_cents, draft.currency),
        due_label=due_label,
        pdf_document_id=_uuid_from_metadata(pdf_artifact.get("document_id")),
        pdf_filename=cast(str | None, pdf_artifact.get("filename")),
        pdf_content=None,
        template_key=settings.invoice_email_template_key,
        template_version=settings.invoice_email_template_version,
    )


def _invoice_rent_period_metadata(
    draft: BillingDraft,
    source_lines: list[BillingDraftLine],
) -> dict[str, object]:
    existing = (draft.billing_metadata or {}).get("rent_period")
    if isinstance(existing, dict):
        return existing

    period_start = draft.issue_date or draft.due_date
    period_end = draft.due_date or draft.issue_date
    frequencies = []
    for line in source_lines:
        metadata = line.line_metadata or {}
        frequency = metadata.get("frequency")
        if isinstance(frequency, str) and frequency and frequency not in frequencies:
            frequencies.append(frequency)

    if period_start and period_end and period_start != period_end:
        label = f"{period_start.isoformat()} to {period_end.isoformat()}"
    elif period_end:
        label = f"Due {period_end.isoformat()}"
    else:
        label = "Period to confirm"

    return {
        "period_start": period_start.isoformat() if period_start else None,
        "period_end": period_end.isoformat() if period_end else None,
        "label": label,
        "basis": "billing_draft_issue_due_dates",
        "source": "billing_draft",
        "frequency": frequencies[0] if frequencies else None,
        "line_count": len(source_lines),
        "requires_review": True,
    }


def _initial_payment_status(total_cents: int, updated_at: str) -> dict[str, object]:
    return {
        "status": "unpaid",
        "paid_cents": 0,
        "outstanding_cents": total_cents,
        "updated_at": updated_at,
        "source": "invoice_draft_created",
    }


def _invoice_pdf_filename(draft: InvoiceDraft) -> str:
    safe_number = (draft.invoice_number or str(draft.id)).replace("/", "-")
    return f"{safe_number}.pdf"


def _uuid_from_metadata(value: object) -> UUID | None:
    if not isinstance(value, str):
        return None
    try:
        return UUID(value)
    except ValueError:
        return None


def _upsert_invoice_pdf_artifact(
    draft: InvoiceDraft,
    metadata: dict[str, object],
    user: CurrentUser,
    session: Session,
    generated_at: str,
) -> dict[str, object]:
    pdf_bytes = render_invoice_pdf(draft, resolve_invoice_brand(draft, session))
    filename = _invoice_pdf_filename(draft)
    document: StoredDocument | None = None
    existing_artifact = metadata.get("pdf_artifact")
    if isinstance(existing_artifact, dict):
        document_id = _uuid_from_metadata(existing_artifact.get("document_id"))
        if document_id is not None:
            existing_document = session.get(StoredDocument, document_id)
            if (
                existing_document is not None
                and existing_document.deleted_at is None
                and existing_document.entity_id == draft.entity_id
            ):
                document = existing_document

    document_metadata = {
        "source": "invoice_draft_pdf_artifact",
        "invoice_draft_id": str(draft.id),
        "billing_draft_id": str(draft.billing_draft_id),
        "generated_at": generated_at,
        "generated_by_user_id": str(user.id),
        "external_posting_status": "not_posted",
        "xero_synced": False,
    }

    if document is None:
        document = StoredDocument(
            entity_id=draft.entity_id,
            property_id=draft.property_id,
            tenancy_unit_id=draft.tenancy_unit_id,
            tenant_id=draft.tenant_id,
            lease_id=draft.lease_id,
            filename=filename,
            content_type="application/pdf",
            byte_size=len(pdf_bytes),
            file_data=pdf_bytes,
            category=DocumentCategory.invoice,
            notes=(
                "Invoice PDF artifact generated from an internal draft. "
                "It has not been emailed, posted, or synced to Xero."
            ),
            document_metadata=document_metadata,
        )
        session.add(document)
        session.flush()
        audit_log(
            session,
            actor=user.actor,
            user_id=user.id,
            entity_id=draft.entity_id,
            action="create",
            target_table="stored_document",
            target_id=document.id,
            tool_output_summary=(
                "Created invoice PDF artifact record from invoice draft; no email "
                "or Xero sync was run."
            ),
        )
    else:
        document.filename = filename
        document.content_type = "application/pdf"
        document.byte_size = len(pdf_bytes)
        document.file_data = pdf_bytes
        document.category = DocumentCategory.invoice
        document.notes = (
            "Invoice PDF artifact refreshed from an internal draft. "
            "It has not been emailed, posted, or synced to Xero."
        )
        document.document_metadata = {
            **(document.document_metadata or {}),
            **document_metadata,
        }
        session.flush()

    return {
        "document_id": str(document.id),
        "filename": document.filename,
        "content_type": document.content_type,
        "byte_size": document.byte_size,
        "generated_at": generated_at,
        "generated_by_user_id": str(user.id),
        "download_path": f"/api/v1/documents/{document.id}/download",
        "preview_path": f"/api/v1/invoice-drafts/{draft.id}/preview",
        "storage_status": "stored",
        "external_posting_status": "not_posted",
    }


def _invoice_posting_preparation(
    draft: InvoiceDraft,
    blockers: list[str],
    prepared_at: str,
    user: CurrentUser,
    pdf_artifact: dict[str, object],
) -> dict[str, object]:
    ready = len(blockers) == 0
    return {
        "status": "ready_for_approval" if ready else "blocked",
        "prepared_at": prepared_at,
        "prepared_by_user_id": str(user.id),
        "approval_required": True,
        "approved": draft.status == InvoiceDraftStatus.approved,
        "approval_status": draft.status.value,
        "posting_ready": ready,
        "blockers": blockers,
        "invoice_number": draft.invoice_number,
        "total_cents": draft.total_cents,
        "currency": draft.currency,
        "pdf_document_id": pdf_artifact.get("document_id"),
        "tenant_email_required": True,
        "xero_sync_allowed": False,
        "xero_sync_requested": False,
        "xero_synced": False,
        "external_posting_status": "not_started",
        "guardrail": "No Xero sync runs unless a future explicit sync action is approved.",
    }


def _prepare_invoice_delivery_metadata(
    draft: InvoiceDraft,
    user: CurrentUser,
    session: Session,
    settings: Settings,
) -> tuple[dict[str, object], list[str]]:
    metadata = dict(draft.invoice_metadata or {})
    blockers = _invoice_draft_delivery_blockers(draft)
    prepared_at = utcnow().isoformat()
    pdf_artifact = _upsert_invoice_pdf_artifact(draft, metadata, user, session, prepared_at)
    email_preview = _invoice_email_preview(draft, settings)
    rendered_preview = _rendered_message_preview_payload(
        _invoice_delivery_preview_invite(draft, pdf_artifact, settings)
    )
    existing_delivery_state = metadata.get("delivery_state")
    delivery_state = dict(metadata.get("delivery_state") or {})
    delivery_state.update(
        {
            "pdf_generated": True,
            "pdf_artifact_stored": True,
            "pdf_preview_generated": True,
            "tenant_email_prepared": len(blockers) == 0,
            "tenant_email_sent": (
                isinstance(existing_delivery_state, dict)
                and existing_delivery_state.get("tenant_email_sent") is True
            ),
            "xero_synced": (
                isinstance(existing_delivery_state, dict)
                and existing_delivery_state.get("xero_synced") is True
            ),
            "delivery_ready": len(blockers) == 0,
            "posting_prepared": len(blockers) == 0,
        }
    )
    delivery_email = dict(metadata.get("delivery_email") or {})
    delivery_email["draft"] = {
        "status": "drafted" if not blockers else "blocked",
        "prepared_at": prepared_at,
        "prepared_by_user_id": str(user.id),
        "template_key": settings.invoice_email_template_key,
        "template_version": settings.invoice_email_template_version,
        "to": email_preview["to"],
        "from_name": email_preview["from_name"],
        "reply_to": email_preview["reply_to"],
        "subject": email_preview["subject"],
        "body": email_preview["body"],
        "brand": email_preview["brand"],
        "rendered_message_preview": rendered_preview,
        "pdf_document_id": pdf_artifact["document_id"],
    }
    delivery_email.setdefault(
        "send",
        {
            "status": "not_sent",
            "provider": None,
            "sent_at": None,
            "provider_message_id": None,
        },
    )
    metadata["pdf_artifact"] = pdf_artifact
    metadata["delivery_state"] = delivery_state
    metadata["delivery_blockers"] = blockers
    metadata["delivery_email"] = delivery_email
    metadata["delivery_preview"] = {
        "prepared_at": prepared_at,
        "prepared_by_user_id": str(user.id),
        "preview_path": f"/api/v1/invoice-drafts/{draft.id}/preview",
        "pdf_artifact": pdf_artifact,
        "email": {
            **email_preview,
            "rendered_message_preview": rendered_preview,
        },
    }
    metadata["posting_preparation"] = _invoice_posting_preparation(
        draft,
        blockers,
        prepared_at,
        user,
        pdf_artifact,
    )
    metadata.setdefault("payment_status", _initial_payment_status(draft.total_cents, prepared_at))
    history = list(metadata.get("delivery_history") or [])
    history.append(
        {
            "event": "prepared_delivery",
            "at": prepared_at,
            "user_id": str(user.id),
            "blockers": blockers,
            "pdf_document_id": pdf_artifact["document_id"],
            "email_draft_status": delivery_email["draft"]["status"],
            "sent": False,
            "xero_synced": False,
        }
    )
    metadata["delivery_history"] = history
    return metadata, blockers


def _invoice_delivery_ready(metadata: dict[str, object]) -> bool:
    delivery_state = metadata.get("delivery_state")
    return (
        isinstance(delivery_state, dict)
        and delivery_state.get("delivery_ready") is True
        and delivery_state.get("pdf_generated") is True
        and delivery_state.get("pdf_artifact_stored") is True
    )


def _record_invoice_manual_delivery(
    draft: InvoiceDraft,
    metadata: dict[str, object],
    payload: InvoiceDraftDeliverySendRecord,
    user: CurrentUser,
) -> dict[str, object]:
    sent_at = (payload.sent_at or utcnow()).isoformat()
    delivery_state_value = metadata.get("delivery_state")
    delivery_state = (
        dict(cast(dict[str, object], delivery_state_value))
        if isinstance(delivery_state_value, dict)
        else {}
    )
    delivery_state.update(
        {
            "tenant_email_sent": True,
            "tenant_email_sent_at": sent_at,
            "tenant_email_sent_by_user_id": str(user.id),
            "tenant_email_delivery_method": payload.method,
            "xero_synced": False,
        }
    )
    delivery_email_value = metadata.get("delivery_email")
    delivery_email = (
        dict(cast(dict[str, object], delivery_email_value))
        if isinstance(delivery_email_value, dict)
        else {}
    )
    delivery_email["send"] = {
        "status": "sent",
        "provider": payload.method,
        "sent_at": sent_at,
        "sent_by_user_id": str(user.id),
        "provider_message_id": None,
        "recipient_email": draft.recipient_email,
        "notes": payload.notes,
        "xero_synced": False,
    }
    receipts_value = metadata.get("delivery_receipts")
    receipts = list(cast(list[object], receipts_value)) if isinstance(receipts_value, list) else []
    receipts.insert(
        0,
        {
            "received_at": sent_at,
            "channel": "email",
            "status": "sent",
            "provider": payload.method,
            "recipient_email": draft.recipient_email,
            "notes": payload.notes,
        },
    )
    history_value = metadata.get("delivery_history")
    history = list(cast(list[object], history_value)) if isinstance(history_value, list) else []
    history.append(
        {
            "event": "recorded_manual_delivery",
            "at": sent_at,
            "user_id": str(user.id),
            "method": payload.method,
            "recipient_email": draft.recipient_email,
            "xero_synced": False,
        }
    )
    metadata["delivery_state"] = delivery_state
    metadata["delivery_email"] = delivery_email
    metadata["delivery_receipts"] = receipts[:20]
    metadata["delivery_history"] = history
    return metadata


def _invoice_pdf_document(
    draft: InvoiceDraft,
    metadata: dict[str, object],
    session: Session,
) -> StoredDocument | None:
    artifact = metadata.get("pdf_artifact")
    if not isinstance(artifact, dict):
        return None
    document_id = _uuid_from_metadata(artifact.get("document_id"))
    if document_id is None:
        return None
    document = session.get(StoredDocument, document_id)
    if (
        document is None
        or document.deleted_at is not None
        or document.entity_id != draft.entity_id
        or document.content_type != "application/pdf"
    ):
        return None
    return document


def _provider_invoice_delivery_invite(
    draft: InvoiceDraft,
    metadata: dict[str, object],
    session: Session,
    settings: Settings,
) -> InvoiceDeliveryEmail:
    pdf_document = _invoice_pdf_document(draft, metadata, session)
    due_label = draft.due_date.isoformat() if draft.due_date else "the due date on the invoice"
    preview_url = None
    if settings.public_api_url:
        preview_url = (
            f"{settings.public_api_url.rstrip('/')}/api/v1/invoice-drafts/{draft.id}/preview"
        )
    return InvoiceDeliveryEmail(
        invoice_draft_id=draft.id,
        entity_id=draft.entity_id,
        invoice_number=draft.invoice_number,
        title=draft.title,
        issuer_name=draft.issuer_name,
        recipient_name=draft.recipient_name,
        recipient_email=draft.recipient_email,
        preview_url=preview_url,
        total_label=_invoice_money(draft.total_cents, draft.currency),
        due_label=due_label,
        pdf_document_id=pdf_document.id if pdf_document is not None else None,
        pdf_filename=pdf_document.filename if pdf_document is not None else None,
        pdf_content=pdf_document.file_data if pdf_document is not None else None,
        template_key=settings.invoice_email_template_key,
        template_version=settings.invoice_email_template_version,
    )


def _record_invoice_provider_delivery(
    draft: InvoiceDraft,
    metadata: dict[str, object],
    result: DeliveryResult,
    user: CurrentUser,
) -> dict[str, object]:
    result_dict = result.to_dict()
    status_value = str(result_dict.get("status") or "failed")
    delivered = status_value in {"queued", "sent", "delivered", "opened"}
    recorded_at = str(result_dict.get("attempted_at") or utcnow().isoformat())

    delivery_state_value = metadata.get("delivery_state")
    delivery_state = (
        dict(cast(dict[str, object], delivery_state_value))
        if isinstance(delivery_state_value, dict)
        else {}
    )
    xero_sync_value = metadata.get("xero_sync")
    posting_preparation_value = metadata.get("posting_preparation")
    xero_synced = (
        delivery_state.get("xero_synced") is True
        or (
            isinstance(xero_sync_value, dict)
            and cast(dict[str, object], xero_sync_value).get("xero_synced") is True
        )
        or (
            isinstance(posting_preparation_value, dict)
            and cast(dict[str, object], posting_preparation_value).get("xero_synced") is True
        )
    )
    delivery_state.update(
        {
            "tenant_email_sent": delivered,
            "tenant_email_sent_at": recorded_at if delivered else None,
            "tenant_email_sent_by_user_id": str(user.id) if delivered else None,
            "tenant_email_delivery_method": "sendgrid",
            "tenant_email_provider_status": status_value,
            "xero_synced": xero_synced,
        }
    )

    delivery_email_value = metadata.get("delivery_email")
    delivery_email = (
        dict(cast(dict[str, object], delivery_email_value))
        if isinstance(delivery_email_value, dict)
        else {}
    )
    delivery_email["send"] = {
        "status": status_value,
        "provider": result_dict.get("provider") or "sendgrid",
        "sent_at": recorded_at if delivered else None,
        "sent_by_user_id": str(user.id),
        "provider_message_id": result_dict.get("provider_message_id"),
        "recipient_email": result_dict.get("recipient") or draft.recipient_email,
        "error": result_dict.get("error"),
        "xero_synced": xero_synced,
    }

    receipts_value = metadata.get("delivery_receipts")
    receipts = list(cast(list[object], receipts_value)) if isinstance(receipts_value, list) else []
    receipts.insert(
        0,
        {
            "received_at": recorded_at,
            "channel": "email",
            "status": status_value,
            "provider": result_dict.get("provider") or "sendgrid",
            "recipient_email": result_dict.get("recipient") or draft.recipient_email,
            "provider_message_id": result_dict.get("provider_message_id"),
            "error": result_dict.get("error"),
        },
    )
    history_value = metadata.get("delivery_history")
    history = list(cast(list[object], history_value)) if isinstance(history_value, list) else []
    history.append(
        {
            "event": "provider_delivery_attempted",
            "at": recorded_at,
            "user_id": str(user.id),
            "provider": result_dict.get("provider") or "sendgrid",
            "status": status_value,
            "recipient_email": result_dict.get("recipient") or draft.recipient_email,
            "provider_message_id": result_dict.get("provider_message_id"),
            "error": result_dict.get("error"),
            "xero_synced": xero_synced,
        }
    )
    metadata["delivery_state"] = delivery_state
    metadata["delivery_email"] = delivery_email
    metadata["delivery_receipts"] = receipts[:20]
    metadata["delivery_history"] = history
    return metadata


def _assert_webhook_secret(request: Request) -> None:
    secret = get_settings().communications_webhook_secret
    if not secret:
        return
    webhook_auth.assert_webhook_secret(request, secret)


def _invoice_email_receipt_status(raw_status: str) -> str:
    value = raw_status.lower()
    if value in {"processed", "deferred"}:
        return "sent" if value == "processed" else "attention"
    if value == "delivered":
        return "delivered"
    if value in {"open", "click"}:
        return "opened"
    if value in {"bounce", "dropped", "spamreport", "unsubscribe", "group_unsubscribe"}:
        return "failed"
    return "attention"


def _find_invoice_draft_by_message_id(
    session: Session,
    provider_message_id: str,
) -> InvoiceDraft | None:
    rows = session.scalars(
        select(InvoiceDraft).where(InvoiceDraft.deleted_at.is_(None))
    ).all()
    for draft in rows:
        metadata = draft.invoice_metadata or {}
        delivery_email = metadata.get("delivery_email")
        send_state = (
            delivery_email.get("send")
            if isinstance(delivery_email, dict)
            else None
        )
        if (
            isinstance(send_state, dict)
            and send_state.get("provider_message_id") == provider_message_id
        ):
            return draft
        receipts = metadata.get("delivery_receipts")
        if not isinstance(receipts, list):
            continue
        for receipt in receipts:
            if (
                isinstance(receipt, dict)
                and receipt.get("provider_message_id") == provider_message_id
            ):
                return draft
    return None


def _apply_invoice_delivery_receipt(
    draft: InvoiceDraft,
    raw_status: str,
    provider_message_id: str | None,
    event: dict[str, object],
) -> None:
    now = utcnow().isoformat()
    status_value = _invoice_email_receipt_status(raw_status)
    metadata = dict(draft.invoice_metadata or {})
    delivery_state_value = metadata.get("delivery_state")
    delivery_state = (
        dict(cast(dict[str, object], delivery_state_value))
        if isinstance(delivery_state_value, dict)
        else {}
    )
    xero_sync_value = metadata.get("xero_sync")
    posting_preparation_value = metadata.get("posting_preparation")
    xero_synced = (
        delivery_state.get("xero_synced") is True
        or (
            isinstance(xero_sync_value, dict)
            and cast(dict[str, object], xero_sync_value).get("xero_synced") is True
        )
        or (
            isinstance(posting_preparation_value, dict)
            and cast(dict[str, object], posting_preparation_value).get("xero_synced") is True
        )
    )
    delivered = status_value in {"sent", "delivered", "opened"}
    delivery_state.update(
        {
            "tenant_email_sent": delivered,
            "tenant_email_sent_at": (
                now if delivered else delivery_state.get("tenant_email_sent_at")
            ),
            "tenant_email_delivery_method": "sendgrid",
            "tenant_email_provider_status": status_value,
            "xero_synced": xero_synced,
        }
    )

    delivery_email_value = metadata.get("delivery_email")
    delivery_email = (
        dict(cast(dict[str, object], delivery_email_value))
        if isinstance(delivery_email_value, dict)
        else {}
    )
    send_value = delivery_email.get("send")
    send_state = dict(cast(dict[str, object], send_value)) if isinstance(send_value, dict) else {}
    send_state.update(
        {
            "status": status_value,
            "provider": "sendgrid",
            "provider_message_id": provider_message_id
            or send_state.get("provider_message_id"),
            "receipt_at": now,
            "last_event": raw_status,
            "xero_synced": xero_synced,
        }
    )
    if delivered and not send_state.get("sent_at"):
        send_state["sent_at"] = now
    if status_value == "failed":
        send_state["error"] = str(
            event.get("reason")
            or event.get("response")
            or event.get("event")
            or raw_status
        )
    delivery_email["send"] = send_state

    receipts_value = metadata.get("delivery_receipts")
    receipts = list(cast(list[object], receipts_value)) if isinstance(receipts_value, list) else []
    receipts.insert(
        0,
        {
            "received_at": now,
            "channel": "email",
            "status": status_value,
            "event": raw_status,
            "provider": "sendgrid",
            "recipient_email": event.get("email") or draft.recipient_email,
            "provider_message_id": provider_message_id,
            "xero_synced": xero_synced,
        },
    )
    history_value = metadata.get("delivery_history")
    history = list(cast(list[object], history_value)) if isinstance(history_value, list) else []
    history.append(
        {
            "event": "provider_delivery_receipt",
            "at": now,
            "provider": "sendgrid",
            "status": status_value,
            "raw_event": raw_status,
            "provider_message_id": provider_message_id,
            "xero_synced": xero_synced,
        }
    )
    metadata["delivery_state"] = delivery_state
    metadata["delivery_email"] = delivery_email
    metadata["delivery_receipts"] = receipts[:20]
    metadata["delivery_history"] = history
    draft.invoice_metadata = metadata


def _normalise_payment_status(
    draft: InvoiceDraft,
    payload: InvoiceDraftPaymentStatusUpdate,
    user: CurrentUser,
) -> dict[str, object]:
    now = utcnow().isoformat()
    paid_cents = payload.paid_cents
    if payload.status == "unpaid":
        paid_cents = 0
    elif payload.status == "paid" and paid_cents is None:
        paid_cents = draft.total_cents
    elif payload.status == "partially_paid" and paid_cents is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Partial payment needs a paid amount.",
        )

    assert paid_cents is not None
    if paid_cents > draft.total_cents:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Paid amount cannot exceed the invoice total.",
        )
    if payload.status == "partially_paid" and paid_cents in {0, draft.total_cents}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Partial payment must be greater than zero and less than the invoice total.",
        )

    paid_at = payload.paid_at.isoformat() if payload.paid_at else None
    if payload.status in {"partially_paid", "paid"}:
        paid_at = paid_at or now
    return {
        "status": payload.status,
        "paid_cents": paid_cents,
        "outstanding_cents": max(draft.total_cents - paid_cents, 0),
        "paid_at": paid_at,
        "updated_at": now,
        "updated_by_user_id": str(user.id),
        "notes": payload.notes,
        "source": "manual_review",
    }


def _property_billing_blockers(
    prop: Property,
    charge_rules: list[RentChargeRule],
) -> tuple[list[str], list[str], list[str]]:
    structure = prop.ownership_structure or "current_entity"
    if structure not in PROPERTY_OWNER_BILLING_STRUCTURES:
        return [], [], []

    invoice_blockers: list[str] = []
    xero_blockers: list[str] = []
    gst_blockers: list[str] = []

    if not (prop.invoice_issuer_name or prop.owner_legal_name):
        invoice_blockers.append("Invoice issuer missing.")
    if not prop.owner_abn:
        invoice_blockers.append("ABN missing for property owner.")
    if structure == "trust" and not prop.trustee_name:
        invoice_blockers.append("Trustee missing.")
    if structure == "split" and not prop.ownership_split:
        invoice_blockers.append("Ownership split incomplete.")
    if not prop.xero_contact_id:
        xero_blockers.append("Xero issuer mapping missing.")
    if (
        prop.owner_gst_registered is False
        and any(rule.gst_treatment == "taxable" for rule in charge_rules)
    ):
        gst_blockers.append("Property invoice issuer is not GST registered.")

    return gst_blockers, xero_blockers, invoice_blockers


@router.get("/billing-drafts", response_model=list[BillingDraftRead])
def list_billing_drafts(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: Annotated[UUID | None, Query()] = None,
    property_id: UUID | None = None,
    lease_id: UUID | None = None,
    document_intake_id: UUID | None = None,
    draft_status: BillingDraftStatus | None = None,
    include_deleted: bool = False,
) -> list[BillingDraft]:
    statement = select(BillingDraft)
    if entity_id is not None:
        assert_entity_role(session, user, entity_id, READ_ROLES)
        statement = statement.where(BillingDraft.entity_id == entity_id)
    else:
        statement = statement.where(
            BillingDraft.entity_id.in_(readable_entity_ids(session, user, READ_ROLES))
        )
    if property_id is not None:
        prop = _property_for_access(property_id, user, session, READ_ROLES)
        if entity_id is not None and prop.entity_id != entity_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Property must belong to the selected entity.",
            )
        statement = statement.where(BillingDraft.property_id == property_id)
    if lease_id is not None:
        _, lease_entity_id = _lease_for_access(lease_id, user, session, READ_ROLES)
        if entity_id is not None and lease_entity_id != entity_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Lease must belong to the selected entity.",
            )
        statement = statement.where(BillingDraft.lease_id == lease_id)
    if document_intake_id is not None:
        intake = _document_intake_for_access(
            document_intake_id, user, session, READ_ROLES
        )
        if entity_id is not None and intake.entity_id != entity_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Document intake must belong to the selected entity.",
            )
        statement = statement.where(BillingDraft.document_intake_id == document_intake_id)
    if draft_status is not None:
        statement = statement.where(BillingDraft.status == draft_status)
    if not include_deleted:
        statement = statement.where(BillingDraft.deleted_at.is_(None))

    return list(
        session.scalars(
            statement.order_by(BillingDraft.due_date, BillingDraft.created_at.desc())
        )
    )


@router.get("/billing-drafts/{billing_draft_id}", response_model=BillingDraftRead)
def get_billing_draft(
    billing_draft_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> BillingDraft:
    return _billing_draft_for_access(billing_draft_id, user, session, READ_ROLES)


@router.patch("/billing-drafts/{billing_draft_id}", response_model=BillingDraftRead)
def update_billing_draft(
    billing_draft_id: UUID,
    payload: BillingDraftUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> BillingDraft:
    draft = _billing_draft_for_access(billing_draft_id, user, session, WRITE_ROLES)
    data = payload.model_dump(exclude_unset=True)
    metadata = dict(draft.billing_metadata or {})
    if "status" in data and data["status"] is not None:
        draft.status = data["status"]
        history = list(metadata.get("status_history") or [])
        status_entry = {
            "status": draft.status.value,
            "changed_at": utcnow().isoformat(),
            "user_id": str(user.id),
        }
        history.append(status_entry)
        metadata["status_history"] = history
        if draft.status == BillingDraftStatus.approved:
            metadata["approved_at"] = status_entry["changed_at"]
            metadata["approved_by_user_id"] = str(user.id)
        if draft.status == BillingDraftStatus.void:
            metadata["voided_at"] = status_entry["changed_at"]
            metadata["voided_by_user_id"] = str(user.id)
    if "notes" in data:
        draft.notes = data["notes"]
    draft.billing_metadata = metadata
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=draft.entity_id,
        action="update",
        target_table="billing_draft",
        target_id=draft.id,
        tool_output_summary=f"Updated billing draft status to {draft.status.value}.",
    )
    session.commit()
    session.refresh(draft)
    return draft


@router.post("/billing-drafts/from-charge-rules", response_model=BillingDraftBatchRead)
def create_billing_drafts_from_charge_rules(
    payload: BillingDraftFromChargeRulesCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> BillingDraftBatchRead:
    assert_entity_role(session, user, payload.entity_id, WRITE_ROLES)
    requested_lease_ids = set(payload.lease_ids or [])
    period_key = (payload.as_of or date.today()).isoformat()

    lease_statement = (
        select(Property, TenancyUnit, Lease, Tenant)
        .join(TenancyUnit, TenancyUnit.property_id == Property.id)
        .join(Lease, Lease.tenancy_unit_id == TenancyUnit.id)
        .join(Tenant, Tenant.id == Lease.tenant_id)
        .where(
            Property.entity_id == payload.entity_id,
            Tenant.entity_id == payload.entity_id,
            Property.deleted_at.is_(None),
            TenancyUnit.deleted_at.is_(None),
            Lease.deleted_at.is_(None),
            Tenant.deleted_at.is_(None),
        )
        .order_by(Property.name, TenancyUnit.unit_label, Tenant.legal_name)
    )
    if requested_lease_ids:
        lease_statement = lease_statement.where(Lease.id.in_(requested_lease_ids))
    if payload.as_of is not None:
        lease_statement = lease_statement.where(
            or_(Lease.commencement_date.is_(None), Lease.commencement_date <= payload.as_of),
            or_(Lease.expiry_date.is_(None), Lease.expiry_date >= payload.as_of),
        )

    lease_rows = session.execute(lease_statement).all()
    found_lease_ids = {lease.id for _, _, lease, _ in lease_rows}
    skipped_rows: list[BillingDraftBatchSkippedRead] = [
        BillingDraftBatchSkippedRead(
            lease_id=lease_id,
            reason="Lease was not found in this entity.",
        )
        for lease_id in sorted(requested_lease_ids - found_lease_ids, key=str)
    ]

    if not lease_rows:
        return BillingDraftBatchRead(
            created=0,
            existing=0,
            skipped=len(skipped_rows),
            drafts=[],
            skipped_rows=skipped_rows,
        )

    lease_ids = [lease.id for _, _, lease, _ in lease_rows]
    rules_by_lease: dict[UUID, list[RentChargeRule]] = {lease_id: [] for lease_id in lease_ids}
    rules = session.scalars(
        select(RentChargeRule)
        .where(RentChargeRule.lease_id.in_(lease_ids), RentChargeRule.deleted_at.is_(None))
        .order_by(RentChargeRule.charge_type, RentChargeRule.created_at)
    )
    for rule in rules:
        rules_by_lease.setdefault(rule.lease_id, []).append(rule)

    existing_by_lease: dict[UUID, BillingDraft] = {}
    existing_drafts = session.scalars(
        select(BillingDraft).where(
            BillingDraft.entity_id == payload.entity_id,
            BillingDraft.lease_id.in_(lease_ids),
            BillingDraft.deleted_at.is_(None),
        )
    ).all()
    for draft in existing_drafts:
        metadata = draft.billing_metadata or {}
        if (
            metadata.get("source") == BILLING_DRAFT_CHARGE_RULE_SOURCE
            and metadata.get("period_key") == period_key
            and draft.status != BillingDraftStatus.void
            and draft.lease_id is not None
        ):
            existing_by_lease[draft.lease_id] = draft

    now = utcnow()
    created_count = 0
    existing_count = 0
    drafts: list[BillingDraft] = []
    for prop, unit, lease, tenant in lease_rows:
        charge_rules = [rule for rule in rules_by_lease.get(lease.id, []) if rule.amount_cents > 0]
        if not charge_rules:
            skipped_rows.append(
                BillingDraftBatchSkippedRead(
                    lease_id=lease.id,
                    tenant_name=tenant.trading_name or tenant.legal_name,
                    property_name=prop.name,
                    unit_label=unit.unit_label,
                    reason="Lease has no positive charge rules.",
                )
            )
            continue

        existing = existing_by_lease.get(lease.id)
        if existing is not None:
            existing_count += 1
            drafts.append(existing)
            continue

        total_cents = sum(rule.amount_cents for rule in charge_rules)
        invoice_dates = [
            rule.next_invoice_date for rule in charge_rules if rule.next_invoice_date is not None
        ]
        due_dates = [rule.next_due_date for rule in charge_rules if rule.next_due_date is not None]
        issue_date = min(invoice_dates) if invoice_dates else payload.as_of or date.today()
        due_date = min(due_dates) if due_dates else None
        line_labels = ", ".join(
            f"{rule.charge_type.value.replace('_', ' ')} {rule.frequency.value}"
            for rule in charge_rules
        )
        document_text = (
            "Relby internal billing preparation source.\n"
            f"Prepared from reviewed charge rules on {now.isoformat()}.\n"
            f"Entity: {payload.entity_id}\n"
            f"Property: {prop.name}\n"
            f"Unit: {unit.unit_label}\n"
            f"Tenant: {tenant.legal_name}\n"
            f"Lease: {lease.id}\n"
            f"Period key: {period_key}\n"
            f"Lines: {line_labels}\n"
            "No tenant email, PDF generation, or Xero sync was run.\n"
        ).encode()
        document = StoredDocument(
            entity_id=payload.entity_id,
            property_id=prop.id,
            tenancy_unit_id=unit.id,
            tenant_id=tenant.id,
            lease_id=lease.id,
            filename=_billing_prep_filename(unit, tenant, period_key),
            content_type="text/plain",
            byte_size=len(document_text),
            file_data=document_text,
            category=DocumentCategory.invoice,
            notes="Internal billing prep source generated from reviewed charge rules.",
            document_metadata={
                "source": BILLING_DRAFT_CHARGE_RULE_SOURCE,
                "period_key": period_key,
                "created_by_user_id": str(user.id),
                "created_at": now.isoformat(),
            },
        )
        session.add(document)
        session.flush()

        title = f"Billing draft - {tenant.trading_name or tenant.legal_name} - {unit.unit_label}"
        draft = BillingDraft(
            entity_id=payload.entity_id,
            property_id=prop.id,
            tenancy_unit_id=unit.id,
            tenant_id=tenant.id,
            lease_id=lease.id,
            document_id=document.id,
            document_intake_id=None,
            status=BillingDraftStatus.needs_review,
            title=title,
            currency="AUD",
            issue_date=issue_date,
            due_date=due_date,
            total_cents=total_cents,
            notes=(
                "Prepared from existing Relby charge rules. Review and approve before "
                "invoice draft creation. No PDF, tenant email, or Xero sync has run."
            ),
            billing_metadata={
                "source": BILLING_DRAFT_CHARGE_RULE_SOURCE,
                "period_key": period_key,
                "lease_id": str(lease.id),
                "charge_rule_ids": [str(rule.id) for rule in charge_rules],
                "created_from_charge_rules_at": now.isoformat(),
                "created_by_user_id": str(user.id),
                "guardrail": (
                    "No invoice PDF, tenant email, or Xero sync runs from this batch step."
                ),
            },
        )
        session.add(draft)
        session.flush()

        line_payloads: list[dict[str, Any]] = []
        for rule in charge_rules:
            line_payloads.extend(
                _billing_line_payloads_from_charge_rule(
                    rule=rule,
                    lease=lease,
                    billing_draft_id=draft.id,
                )
            )
        for line_payload in line_payloads:
            session.add(BillingDraftLine(**line_payload))

        if any(
            (line["line_metadata"] or {}).get("split_by_unit") is True
            for line in line_payloads
        ):
            draft_metadata = dict(draft.billing_metadata or {})
            draft_metadata["itemised_by_unit"] = True
            draft_metadata["itemised_unit_line_count"] = sum(
                1
                for line in line_payloads
                if (line["line_metadata"] or {}).get("split_by_unit") is True
            )
            draft.billing_metadata = draft_metadata

        audit_log(
            session,
            actor=user.actor,
            user_id=user.id,
            entity_id=payload.entity_id,
            action="create",
            target_table="billing_draft",
            target_id=draft.id,
            tool_output_summary=(
                "Created internal billing draft from reviewed charge rules; "
                "no PDF, tenant email, or Xero sync was run."
            ),
        )
        created_count += 1
        drafts.append(draft)

    session.commit()
    for draft in drafts:
        session.refresh(draft)

    return BillingDraftBatchRead(
        created=created_count,
        existing=existing_count,
        skipped=len(skipped_rows),
        drafts=[BillingDraftRead.model_validate(draft) for draft in drafts],
        skipped_rows=skipped_rows,
    )


@router.post("/billing-drafts/{billing_draft_id}/invoice-drafts", response_model=InvoiceDraftRead)
def create_invoice_draft_from_billing_draft(
    billing_draft_id: UUID,
    response: Response,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> InvoiceDraft:
    draft = _billing_draft_for_access(billing_draft_id, user, session, WRITE_ROLES)
    if draft.status != BillingDraftStatus.approved:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Approve the billing draft before creating an invoice draft.",
        )

    existing = session.scalar(
        select(InvoiceDraft).where(
            InvoiceDraft.billing_draft_id == draft.id,
            InvoiceDraft.deleted_at.is_(None),
        )
    )
    if existing is not None:
        response.status_code = status.HTTP_200_OK
        return existing

    source_lines = [line for line in draft.lines if line.deleted_at is None]
    if not source_lines:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Billing draft needs at least one line before invoice drafting.",
        )

    entity = session.get(Entity, draft.entity_id)
    prop = session.get(Property, draft.property_id) if draft.property_id else None
    tenant = session.get(Tenant, draft.tenant_id) if draft.tenant_id else None
    recipient_email = None
    if tenant is not None:
        recipient_email = tenant.billing_email or tenant.contact_email
    issuer_name = None
    if prop is not None:
        issuer_name = prop.invoice_issuer_name or prop.owner_legal_name
    issuer_name = issuer_name or (entity.name if entity is not None else None)
    subtotal_cents = sum(line.amount_cents for line in source_lines)
    blockers = _invoice_draft_blockers(draft, prop, tenant, entity, len(source_lines))
    created_at = utcnow().isoformat()
    rent_period = _invoice_rent_period_metadata(draft, source_lines)
    total_cents = draft.total_cents or subtotal_cents
    invoice = InvoiceDraft(
        entity_id=draft.entity_id,
        billing_draft_id=draft.id,
        property_id=draft.property_id,
        tenancy_unit_id=draft.tenancy_unit_id,
        tenant_id=draft.tenant_id,
        lease_id=draft.lease_id,
        document_id=draft.document_id,
        document_intake_id=draft.document_intake_id,
        status=InvoiceDraftStatus.draft,
        invoice_number=_invoice_number_for_billing_draft(draft, prop),
        title=draft.title,
        currency=draft.currency,
        issue_date=draft.issue_date,
        due_date=draft.due_date,
        subtotal_cents=subtotal_cents,
        gst_cents=0,
        total_cents=total_cents,
        issuer_name=issuer_name,
        issuer_abn=prop.owner_abn if prop is not None else None,
        recipient_name=tenant.legal_name if tenant is not None else None,
        recipient_email=recipient_email,
        notes="Internal invoice draft only. No PDF generated, tenant email sent, or Xero sync run.",
        invoice_metadata={
            "source": "billing_draft",
            "billing_draft_id": str(draft.id),
            "source_document_id": str(draft.document_id),
            "document_intake_id": str(draft.document_intake_id)
            if draft.document_intake_id
            else None,
            "created_from_billing_draft_at": created_at,
            "created_by_user_id": str(user.id),
            "readiness_blockers": blockers,
            "rent_period": rent_period,
            "payment_status": _initial_payment_status(total_cents, created_at),
            "delivery_state": {
                "pdf_generated": False,
                "pdf_artifact_stored": False,
                "pdf_preview_generated": False,
                "tenant_email_prepared": False,
                "tenant_email_sent": False,
                "delivery_ready": False,
                "xero_synced": False,
            },
            "delivery_email": {
                "draft": {"status": "not_prepared", "template": "leasium_invoice_v1"},
                "send": {
                    "status": "not_sent",
                    "provider": None,
                    "sent_at": None,
                    "provider_message_id": None,
                },
            },
            "posting_preparation": {
                "status": "not_prepared",
                "approval_required": True,
                "approved": False,
                "posting_ready": False,
                "xero_sync_allowed": False,
                "xero_sync_requested": False,
                "xero_synced": False,
                "external_posting_status": "not_started",
                "guardrail": "No Xero sync runs unless a future explicit sync action is approved.",
            },
        },
    )
    session.add(invoice)
    session.flush()

    for line in source_lines:
        session.add(
            InvoiceDraftLine(
                invoice_draft_id=invoice.id,
                billing_draft_line_id=line.id,
                description=line.description,
                amount_cents=line.amount_cents,
                gst_cents=0,
                currency=line.currency,
                source_hint=line.source_hint,
                line_metadata={
                    **(line.line_metadata or {}),
                    "source_billing_draft_line_id": str(line.id),
                },
            )
        )

    draft_metadata = dict(draft.billing_metadata or {})
    draft_metadata["invoice_draft_id"] = str(invoice.id)
    history = list(draft_metadata.get("invoice_draft_history") or [])
    history.append(
        {
            "invoice_draft_id": str(invoice.id),
            "created_at": created_at,
            "user_id": str(user.id),
        }
    )
    draft_metadata["invoice_draft_history"] = history
    draft.billing_metadata = draft_metadata

    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=invoice.entity_id,
        action="create",
        target_table="invoice_draft",
        target_id=invoice.id,
        tool_output_summary=(
            "Created internal invoice draft from approved billing draft; "
            "no PDF, tenant email, or Xero sync was run."
        ),
    )
    session.commit()
    session.refresh(invoice)
    response.status_code = status.HTTP_201_CREATED
    return invoice


@router.get("/invoice-drafts", response_model=list[InvoiceDraftRead])
def list_invoice_drafts(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: Annotated[UUID | None, Query()] = None,
    billing_draft_id: UUID | None = None,
    draft_status: InvoiceDraftStatus | None = None,
    include_deleted: bool = False,
) -> list[InvoiceDraft]:
    statement = select(InvoiceDraft)
    if entity_id is not None:
        assert_entity_role(session, user, entity_id, READ_ROLES)
        statement = statement.where(InvoiceDraft.entity_id == entity_id)
    else:
        statement = statement.where(
            InvoiceDraft.entity_id.in_(readable_entity_ids(session, user, READ_ROLES))
        )
    if billing_draft_id is not None:
        billing_draft = _billing_draft_for_access(
            billing_draft_id,
            user,
            session,
            READ_ROLES,
        )
        if entity_id is not None and billing_draft.entity_id != entity_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Billing draft must belong to the selected entity.",
            )
        statement = statement.where(InvoiceDraft.billing_draft_id == billing_draft_id)
    if draft_status is not None:
        statement = statement.where(InvoiceDraft.status == draft_status)
    if not include_deleted:
        statement = statement.where(InvoiceDraft.deleted_at.is_(None))

    return list(
        session.scalars(
            statement.order_by(InvoiceDraft.due_date, InvoiceDraft.created_at.desc())
        )
    )


@router.get("/invoice-drafts/{invoice_draft_id}", response_model=InvoiceDraftRead)
def get_invoice_draft(
    invoice_draft_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> InvoiceDraft:
    return _invoice_draft_for_access(invoice_draft_id, user, session, READ_ROLES)


@router.patch("/invoice-drafts/{invoice_draft_id}", response_model=InvoiceDraftRead)
def update_invoice_draft(
    invoice_draft_id: UUID,
    payload: InvoiceDraftUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> InvoiceDraft:
    draft = _invoice_draft_for_access(invoice_draft_id, user, session, WRITE_ROLES)
    data = payload.model_dump(exclude_unset=True)
    metadata = dict(draft.invoice_metadata or {})
    if "status" in data and data["status"] is not None:
        next_status = data["status"]
        if next_status == InvoiceDraftStatus.approved:
            blockers = _invoice_draft_delivery_blockers(draft)
            if blockers:
                detail = "Invoice draft has delivery blockers: " + " ".join(blockers)
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)
            if not _invoice_delivery_ready(metadata):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Prepare invoice delivery before approval.",
                )
        draft.status = next_status
        history = list(metadata.get("status_history") or [])
        status_entry = {
            "status": draft.status.value,
            "changed_at": utcnow().isoformat(),
            "user_id": str(user.id),
        }
        history.append(status_entry)
        metadata["status_history"] = history
        if draft.status == InvoiceDraftStatus.approved:
            metadata["approved_at"] = status_entry["changed_at"]
            metadata["approved_by_user_id"] = str(user.id)
            posting_preparation = dict(metadata.get("posting_preparation") or {})
            posting_preparation.update(
                {
                    "status": "approved_for_posting_preparation",
                    "approved": True,
                    "approval_status": "approved",
                    "approved_at": status_entry["changed_at"],
                    "approved_by_user_id": str(user.id),
                    "external_posting_status": "not_started",
                    "xero_sync_allowed": False,
                    "xero_sync_requested": False,
                    "xero_synced": False,
                    "guardrail": (
                        "No Xero sync runs unless a future explicit sync action is "
                        "approved."
                    ),
                }
            )
            metadata["posting_preparation"] = posting_preparation
            metadata.setdefault(
                "payment_status",
                _initial_payment_status(draft.total_cents, status_entry["changed_at"]),
            )
        if draft.status == InvoiceDraftStatus.void:
            metadata["voided_at"] = status_entry["changed_at"]
            metadata["voided_by_user_id"] = str(user.id)
    if "notes" in data:
        draft.notes = data["notes"]
    draft.invoice_metadata = metadata
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=draft.entity_id,
        action="update",
        target_table="invoice_draft",
        target_id=draft.id,
        tool_output_summary=(
            f"Updated invoice draft status to {draft.status.value}; "
            "no PDF, tenant email, or Xero sync was run."
        ),
    )
    session.commit()
    session.refresh(draft)
    return draft


@router.post(
    "/invoice-drafts/{invoice_draft_id}/prepare-delivery",
    response_model=InvoiceDraftRead,
)
def prepare_invoice_draft_delivery(
    invoice_draft_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> InvoiceDraft:
    draft = _invoice_draft_for_access(invoice_draft_id, user, session, WRITE_ROLES)
    if draft.status == InvoiceDraftStatus.void:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Void invoice drafts cannot be prepared for delivery.",
        )

    metadata, blockers = _prepare_invoice_delivery_metadata(draft, user, session, settings)
    draft.invoice_metadata = metadata
    if not blockers and draft.status == InvoiceDraftStatus.draft:
        draft.status = InvoiceDraftStatus.ready_for_approval
    if not draft.notes:
        draft.notes = (
            "Delivery metadata prepared with a PDF artifact record and branded "
            "email draft. No tenant email or Xero sync run."
        )
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=draft.entity_id,
        action="update",
        target_table="invoice_draft",
        target_id=draft.id,
        tool_output_summary=(
            "Prepared invoice draft PDF artifact and branded email draft metadata; "
            "no tenant email or Xero sync was run."
        ),
    )
    session.commit()
    session.refresh(draft)
    return draft


@router.get("/invoice-drafts/{invoice_draft_id}/preview", response_class=HTMLResponse)
def preview_invoice_draft(
    invoice_draft_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> HTMLResponse:
    draft = _invoice_draft_for_access(invoice_draft_id, user, session, READ_ROLES)
    return HTMLResponse(
        render_invoice_html(draft, resolve_invoice_brand(draft, session))
    )


@router.post(
    "/invoice-drafts/{invoice_draft_id}/record-delivery",
    response_model=InvoiceDraftRead,
)
def record_invoice_draft_delivery(
    invoice_draft_id: UUID,
    payload: InvoiceDraftDeliverySendRecord,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> InvoiceDraft:
    draft = _invoice_draft_for_access(invoice_draft_id, user, session, WRITE_ROLES)
    metadata = dict(draft.invoice_metadata or {})
    if draft.status != InvoiceDraftStatus.approved:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Approve the invoice draft before recording tenant delivery.",
        )
    if not _invoice_delivery_ready(metadata):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Prepare invoice delivery before recording tenant delivery.",
        )
    if not draft.recipient_email:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Tenant billing email missing.",
        )

    draft.invoice_metadata = _record_invoice_manual_delivery(draft, metadata, payload, user)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=draft.entity_id,
        action="deliver",
        target_table="invoice_draft",
        target_id=draft.id,
        tool_name="invoice.manual_delivery",
        tool_input=payload.model_dump(mode="json", exclude_unset=True),
        tool_output_summary="Recorded tenant invoice delivery manually; no Xero sync was run.",
    )
    session.commit()
    session.refresh(draft)
    return draft


@router.post(
    "/invoice-drafts/{invoice_draft_id}/send-delivery-email",
    response_model=InvoiceDraftRead,
)
def send_invoice_draft_delivery_email(
    invoice_draft_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> InvoiceDraft:
    draft = _invoice_draft_for_access(invoice_draft_id, user, session, WRITE_ROLES)
    metadata = dict(draft.invoice_metadata or {})
    if draft.status != InvoiceDraftStatus.approved:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Approve the invoice draft before sending tenant email.",
        )
    if not _invoice_delivery_ready(metadata):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Prepare invoice delivery before sending tenant email.",
        )
    if _invoice_pdf_document(draft, metadata, session) is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Invoice PDF artifact missing. Prepare invoice delivery again.",
        )
    if not draft.recipient_email:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Tenant billing email missing.",
        )

    delivery_email = metadata.get("delivery_email")
    send_state = delivery_email.get("send") if isinstance(delivery_email, dict) else None
    if (
        isinstance(send_state, dict)
        and send_state.get("provider") == "sendgrid"
        and send_state.get("status") in {"queued", "sent", "delivered", "opened"}
    ):
        return draft

    result = send_invoice_delivery_email(
        _provider_invoice_delivery_invite(draft, metadata, session, settings),
        settings,
    )
    draft.invoice_metadata = _record_invoice_provider_delivery(draft, metadata, result, user)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=draft.entity_id,
        action="deliver",
        target_table="invoice_draft",
        target_id=draft.id,
        tool_name="sendgrid.invoice_delivery",
        tool_input={
            "invoice_draft_id": str(draft.id),
            "recipient_email": draft.recipient_email,
            "provider": result.provider,
            "status": result.status,
        },
        tool_output_summary=(
            f"Attempted provider-backed invoice email delivery via {result.provider}: "
            f"{result.status}; no Xero sync was run."
        ),
    )
    session.commit()
    session.refresh(draft)
    return draft


@router.post("/invoice-drafts/webhooks/sendgrid-events", status_code=status.HTTP_204_NO_CONTENT)
async def record_invoice_sendgrid_delivery_events(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> Response:
    _assert_webhook_secret(request)
    payload = await request.json()
    events = payload if isinstance(payload, list) else [payload]
    for event in events:
        if not isinstance(event, dict):
            continue
        raw_status = str(event.get("event") or "")
        if not raw_status:
            continue
        draft = None
        invoice_draft_id = event.get("invoice_draft_id")
        if isinstance(invoice_draft_id, str):
            try:
                draft = session.get(InvoiceDraft, UUID(invoice_draft_id))
            except ValueError:
                draft = None
        message_id = event.get("sg_message_id") or event.get("sg-message-id")
        if draft is None and isinstance(message_id, str):
            draft = _find_invoice_draft_by_message_id(session, message_id)
        if draft is None or draft.deleted_at is not None:
            continue
        _apply_invoice_delivery_receipt(
            draft,
            raw_status,
            str(message_id) if message_id else None,
            event,
        )
        audit_log(
            session,
            actor="provider:sendgrid",
            entity_id=draft.entity_id,
            action="receipt",
            target_table="invoice_draft",
            target_id=draft.id,
            tool_name="sendgrid.invoice_event_webhook",
            tool_input={"channel": "email", "status": raw_status},
            tool_output_summary="Recorded SendGrid invoice delivery receipt.",
            data_classification="confidential",
        )
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch(
    "/invoice-drafts/{invoice_draft_id}/payment-status",
    response_model=InvoiceDraftRead,
)
def update_invoice_draft_payment_status(
    invoice_draft_id: UUID,
    payload: InvoiceDraftPaymentStatusUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> InvoiceDraft:
    draft = _invoice_draft_for_access(invoice_draft_id, user, session, WRITE_ROLES)
    if draft.status == InvoiceDraftStatus.void:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Void invoice drafts cannot receive payment status updates.",
        )
    metadata = dict(draft.invoice_metadata or {})
    payment_status = _normalise_payment_status(draft, payload, user)
    history = list(metadata.get("payment_history") or [])
    history.append(payment_status)
    metadata["payment_status"] = payment_status
    metadata["payment_history"] = history[-20:]
    draft.invoice_metadata = metadata
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=draft.entity_id,
        action="update",
        target_table="invoice_draft",
        target_id=draft.id,
        tool_name="invoice.payment_status",
        tool_input=payload.model_dump(mode="json", exclude_unset=True),
        tool_output_summary=f"Updated invoice payment status to {payload.status}.",
    )
    session.commit()
    session.refresh(draft)
    return draft


@router.get("/charge-rules", response_model=list[RentChargeRuleRead])
def list_charge_rules(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: UUID | None = None,
    property_id: UUID | None = None,
    lease_id: UUID | None = None,
    include_deleted: bool = False,
) -> list[RentChargeRule]:
    if entity_id is None and property_id is None and lease_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide an entity, property, or lease scope.",
        )

    statement = (
        select(RentChargeRule)
        .join(Lease)
        .join(TenancyUnit, TenancyUnit.id == Lease.tenancy_unit_id)
        .join(Property, Property.id == TenancyUnit.property_id)
    )
    if entity_id is not None:
        assert_entity_role(session, user, entity_id, READ_ROLES)
        statement = statement.where(Property.entity_id == entity_id)
    if property_id is not None:
        _property_for_access(property_id, user, session, READ_ROLES)
        statement = statement.where(Property.id == property_id)
    if lease_id is not None:
        _lease_for_access(lease_id, user, session, READ_ROLES)
        statement = statement.where(RentChargeRule.lease_id == lease_id)
    if not include_deleted:
        statement = statement.where(RentChargeRule.deleted_at.is_(None))

    statement = statement.where(
        Lease.deleted_at.is_(None),
        TenancyUnit.deleted_at.is_(None),
        Property.deleted_at.is_(None),
    )
    return list(
        session.scalars(
            statement.order_by(RentChargeRule.next_due_date, RentChargeRule.created_at)
        )
    )


@router.post(
    "/charge-rules",
    response_model=RentChargeRuleRead,
    status_code=status.HTTP_201_CREATED,
)
def create_charge_rule(
    payload: RentChargeRuleCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> RentChargeRule:
    _, entity_id = _lease_for_access(payload.lease_id, user, session, WRITE_ROLES)
    if payload.amount_cents < 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Charge amount cannot be negative.",
        )
    data = payload.model_dump()
    _normalise_charge_rule_metadata(data)
    charge_rule = RentChargeRule(**data)
    session.add(charge_rule)
    session.flush()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity_id,
        action="create",
        target_table="rent_charge_rule",
        target_id=charge_rule.id,
    )
    session.commit()
    session.refresh(charge_rule)
    return charge_rule


@router.patch("/charge-rules/{charge_rule_id}", response_model=RentChargeRuleRead)
def update_charge_rule(
    charge_rule_id: UUID,
    payload: RentChargeRuleUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> RentChargeRule:
    charge_rule, entity_id = _charge_rule_for_access(
        charge_rule_id, user, session, WRITE_ROLES
    )
    data = payload.model_dump(exclude_unset=True)
    if "amount_cents" in data and data["amount_cents"] is not None and data["amount_cents"] < 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Charge amount cannot be negative.",
        )
    metadata_patch: dict[str, Any] = {}
    if "metadata" in data or "split_by_unit" in data or "unit_amount_overrides_cents" in data:
        metadata_patch["metadata"] = data.pop("metadata", charge_rule.charge_rule_metadata or {})
        if "split_by_unit" in data:
            metadata_patch["split_by_unit"] = data.pop("split_by_unit")
        if "unit_amount_overrides_cents" in data:
            metadata_patch["unit_amount_overrides_cents"] = data.pop(
                "unit_amount_overrides_cents"
            )
        _normalise_charge_rule_metadata(metadata_patch)
        data["charge_rule_metadata"] = metadata_patch["charge_rule_metadata"]
    for key, value in data.items():
        setattr(charge_rule, key, value)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity_id,
        action="update",
        target_table="rent_charge_rule",
        target_id=charge_rule.id,
    )
    session.commit()
    session.refresh(charge_rule)
    return charge_rule


@router.delete("/charge-rules/{charge_rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_charge_rule(
    charge_rule_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> None:
    charge_rule, entity_id = _charge_rule_for_access(
        charge_rule_id, user, session, WRITE_ROLES
    )
    charge_rule.deleted_at = utcnow()
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity_id,
        action="delete",
        target_table="rent_charge_rule",
        target_id=charge_rule.id,
    )
    session.commit()


@router.get("/rent-roll", response_model=list[RentRollRowRead])
def rent_roll(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    entity_id: Annotated[UUID | None, Query()] = None,
    property_id: UUID | None = None,
    as_of: date | None = None,
) -> list[RentRollRowRead]:
    if entity_id is not None:
        assert_entity_role(session, user, entity_id, READ_ROLES)
    if property_id is not None:
        prop = _property_for_access(property_id, user, session, READ_ROLES)
        if entity_id is not None and prop.entity_id != entity_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Property must belong to the selected entity.",
            )

    active_lease_join = [
        Lease.tenancy_unit_id == TenancyUnit.id,
        Lease.deleted_at.is_(None),
    ]
    if as_of is not None:
        active_lease_join.extend(
            [
                or_(Lease.commencement_date.is_(None), Lease.commencement_date <= as_of),
                or_(Lease.expiry_date.is_(None), Lease.expiry_date >= as_of),
            ]
        )

    statement = (
        select(Entity, Property, TenancyUnit, Lease, Tenant)
        .join(Property, Property.entity_id == Entity.id)
        .join(TenancyUnit, TenancyUnit.property_id == Property.id)
        .outerjoin(Lease, and_(*active_lease_join))
        .outerjoin(
            Tenant,
            and_(Tenant.id == Lease.tenant_id, Tenant.deleted_at.is_(None)),
        )
        .where(
            (
                Entity.id == entity_id
                if entity_id is not None
                # Org-wide scope: every entity the user can read.
                else Entity.id.in_(readable_entity_ids(session, user, READ_ROLES))
            ),
            Entity.deleted_at.is_(None),
            Property.deleted_at.is_(None),
            TenancyUnit.deleted_at.is_(None),
        )
    )
    if property_id is not None:
        statement = statement.where(Property.id == property_id)

    rows = session.execute(statement.order_by(Property.name, TenancyUnit.unit_label)).all()
    lease_ids = [lease.id for _, _, _, lease, _ in rows if lease is not None]
    rules_by_lease: dict[UUID, list[RentChargeRule]] = {lease_id: [] for lease_id in lease_ids}
    if lease_ids:
        rules = session.scalars(
            select(RentChargeRule)
            .where(
                RentChargeRule.lease_id.in_(lease_ids),
                RentChargeRule.deleted_at.is_(None),
            )
            .order_by(RentChargeRule.next_due_date, RentChargeRule.created_at)
        )
        for rule in rules:
            rules_by_lease.setdefault(rule.lease_id, []).append(rule)

    response: list[RentRollRowRead] = []
    for entity, prop, unit, lease, tenant in rows:
        # A lease whose tenant was deleted is orphaned — show the unit as vacant
        # rather than surfacing the removed tenant or its rent/charges.
        if lease is not None and tenant is None:
            lease = None
        charge_rules = rules_by_lease.get(lease.id, []) if lease is not None else []
        total_charge_cents = sum(rule.amount_cents for rule in charge_rules)
        due_dates = [rule.next_due_date for rule in charge_rules if rule.next_due_date is not None]
        next_due_date = min(due_dates) if due_dates else None

        gst_blockers = [
            f"{rule.charge_type.replace('_', ' ')} is taxable but entity is not GST registered."
            for rule in charge_rules
            if rule.gst_treatment == "taxable" and not entity.gst_registered
        ]
        xero_blockers = []
        if entity.xero_tenant_id is None:
            xero_blockers.append("Entity is not connected to Xero.")
        for rule in charge_rules:
            if not rule.xero_account_code:
                xero_blockers.append(
                    f"{rule.charge_type.replace('_', ' ')} is missing a Xero account code."
                )
            if rule.gst_treatment == "taxable" and not rule.xero_tax_type:
                xero_blockers.append(
                    f"{rule.charge_type.replace('_', ' ')} is missing a Xero tax type."
                )

        invoice_blockers = []
        if lease is None:
            invoice_blockers.append("Unit has no current lease.")
        if lease is not None and not charge_rules:
            invoice_blockers.append("Lease has no charge rules.")
        if tenant is not None and not tenant.billing_email and not tenant.contact_email:
            invoice_blockers.append("Tenant is missing a billing email.")
        for rule in charge_rules:
            if rule.amount_cents <= 0:
                invoice_blockers.append(f"{rule.charge_type.replace('_', ' ')} has no amount.")
            if rule.next_due_date is None:
                invoice_blockers.append(
                    f"{rule.charge_type.replace('_', ' ')} is missing the next due date."
                )
        (
            property_gst_blockers,
            property_xero_blockers,
            property_invoice_blockers,
        ) = _property_billing_blockers(prop, charge_rules)
        gst_blockers.extend(property_gst_blockers)
        xero_blockers.extend(property_xero_blockers)
        invoice_blockers.extend(property_invoice_blockers)

        response.append(
            RentRollRowRead(
                entity_id=entity.id,
                entity_name=entity.name,
                property_id=prop.id,
                property_name=prop.name,
                tenancy_unit_id=unit.id,
                unit_label=unit.unit_label,
                lease_id=lease.id if lease is not None else None,
                tenant_id=tenant.id if tenant is not None else None,
                tenant_name=(
                    tenant.trading_name or tenant.legal_name if tenant is not None else None
                ),
                lease_status=lease.status if lease is not None else None,
                commencement_date=lease.commencement_date if lease is not None else None,
                expiry_date=lease.expiry_date if lease is not None else None,
                next_review_date=lease.next_review_date if lease is not None else None,
                tenant_billing_email=(
                    tenant.billing_email or tenant.contact_email if tenant is not None else None
                ),
                annual_rent_cents=lease.annual_rent_cents if lease is not None else None,
                rent_frequency=lease.rent_frequency if lease is not None else None,
                charge_rules=[
                    RentRollChargeRuleRead.model_validate(rule) for rule in charge_rules
                ],
                charge_rules_total_cents=total_charge_cents,
                next_due_date=next_due_date,
                gst_readiness_blockers=gst_blockers,
                xero_readiness_blockers=xero_blockers,
                invoice_readiness_blockers=invoice_blockers,
                readiness_blockers=gst_blockers + xero_blockers + invoice_blockers,
            )
        )
    return response
