"""Rent charge rule and rent roll routes."""

from datetime import date
from html import escape
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
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
    Entity,
    InvoiceDraft,
    InvoiceDraftLine,
    InvoiceDraftStatus,
    Lease,
    Property,
    RentChargeRule,
    StoredDocument,
    TenancyUnit,
    Tenant,
    UserRole,
)

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.register import (
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


def _property_for_access(
    property_id: UUID, user: CurrentUser, session: Session, roles: set[UserRole]
) -> Property:
    prop = session.get(Property, property_id)
    if prop is None or prop.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found.")
    assert_entity_role(session, user, prop.entity_id, roles)
    return prop


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


def _invoice_brand_metadata(draft: InvoiceDraft) -> dict[str, str | None]:
    sender_name = draft.issuer_name or "Leasium Billing"
    return {
        "template": "leasium_invoice_v1",
        "sender_name": sender_name,
        "reply_to": None,
        "footer": "Prepared in Leasium. External delivery requires approval.",
    }


def _invoice_email_preview(draft: InvoiceDraft) -> dict[str, object]:
    subject_number = draft.invoice_number or str(draft.id)[:8].upper()
    due = draft.due_date.isoformat() if draft.due_date else "the due date shown on the invoice"
    brand = _invoice_brand_metadata(draft)
    body = (
        f"Hi {draft.recipient_name or 'there'},\n\n"
        f"Please find invoice {subject_number} for "
        f"{_invoice_money(draft.total_cents, draft.currency)} attached for review. "
        f"Payment is due {due}.\n\n"
        "This email draft uses the Leasium invoice template and is ready for approval. "
        "No email has been sent."
    )
    return {
        "to": draft.recipient_email,
        "from_name": brand["sender_name"],
        "reply_to": brand["reply_to"],
        "subject": f"Invoice {subject_number} from {draft.issuer_name or 'Leasium'}",
        "body": body,
        "brand": brand,
    }


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


def _pdf_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _invoice_pdf_filename(draft: InvoiceDraft) -> str:
    safe_number = (draft.invoice_number or str(draft.id)).replace("/", "-")
    return f"{safe_number}.pdf"


def _invoice_pdf_bytes(draft: InvoiceDraft) -> bytes:
    text_lines = [
        "Leasium invoice draft",
        f"Invoice: {draft.invoice_number or str(draft.id)}",
        f"Issuer: {draft.issuer_name or 'Issuer to confirm'}",
        f"Recipient: {draft.recipient_name or 'Recipient to confirm'}",
        f"Due: {draft.due_date.isoformat() if draft.due_date else 'To confirm'}",
        f"Total: {_invoice_money(draft.total_cents, draft.currency)}",
        "This artifact is internal until approval. No Xero sync has run.",
        "",
        "Line items:",
    ]
    for line in draft.lines:
        if line.deleted_at is None:
            text_lines.append(
                f"- {line.description}: {_invoice_money(line.amount_cents, line.currency)}"
            )

    content_lines = ["BT", "/F1 11 Tf", "14 TL", "50 760 Td"]
    for index, text in enumerate(text_lines[:42]):
        if index:
            content_lines.append("T*")
        content_lines.append(f"({_pdf_text(text[:120])}) Tj")
    content_lines.append("ET")
    stream = "\n".join(content_lines).encode("latin-1", errors="replace")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"
        ),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length "
        + str(len(stream)).encode()
        + b" >>\nstream\n"
        + stream
        + b"\nendstream",
    ]
    pdf = b"%PDF-1.4\n"
    offsets: list[int] = []
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf += f"{index} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref_offset = len(pdf)
    pdf += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for offset in offsets:
        pdf += f"{offset:010d} 00000 n \n".encode()
    pdf += (
        f"trailer\n<< /Root 1 0 R /Size {len(objects) + 1} >>\n"
        f"startxref\n{xref_offset}\n%%EOF\n"
    ).encode()
    return pdf


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
    pdf_bytes = _invoice_pdf_bytes(draft)
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


def _invoice_preview_html(draft: InvoiceDraft) -> str:
    line_rows = "\n".join(
        "<tr>"
        f"<td>{escape(line.description)}</td>"
        f"<td>{escape(line.source_hint or '')}</td>"
        f"<td class=\"amount\">{escape(_invoice_money(line.amount_cents, line.currency))}</td>"
        "</tr>"
        for line in draft.lines
        if line.deleted_at is None
    )
    pdf_artifact = (draft.invoice_metadata or {}).get("pdf_artifact")
    pdf_notice = (
        "A PDF artifact record has been stored for approval. No tenant email has been "
        "sent, and no Xero sync has run."
        if isinstance(pdf_artifact, dict) and pdf_artifact.get("document_id")
        else "No PDF artifact record has been stored yet, no tenant email has been sent, "
        "and no Xero sync has run."
    )
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>{escape(draft.invoice_number or 'Invoice draft')}</title>
  <style>
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      margin: 40px;
      color: #172033;
    }}
    main {{ max-width: 760px; margin: 0 auto; }}
    header {{
      display: flex;
      justify-content: space-between;
      gap: 24px;
      border-bottom: 1px solid #d8dde8;
      padding-bottom: 24px;
    }}
    h1 {{ margin: 0 0 8px; font-size: 28px; }}
    h2 {{ margin: 28px 0 8px; font-size: 16px; }}
    p {{ margin: 4px 0; }}
    table {{ width: 100%; border-collapse: collapse; margin-top: 16px; }}
    th, td {{
      border-bottom: 1px solid #e7eaf0;
      padding: 10px 0;
      text-align: left;
      vertical-align: top;
    }}
    th {{ color: #5c667a; font-size: 12px; text-transform: uppercase; }}
    .amount {{ text-align: right; white-space: nowrap; }}
    .total {{ font-size: 20px; font-weight: 700; }}
    .muted {{ color: #5c667a; }}
    .notice {{
      margin-top: 28px;
      padding: 12px;
      border: 1px solid #d8dde8;
      background: #f7f9fc;
      border-radius: 8px;
    }}
  </style>
</head>
<body>
  <main>
    <header>
      <section>
        <h1>Invoice preview</h1>
        <p class="muted">{escape(draft.invoice_number or 'Number to confirm')}</p>
        <p>Issue date: {escape(draft.issue_date.isoformat() if draft.issue_date else '-')}</p>
        <p>Due date: {escape(draft.due_date.isoformat() if draft.due_date else '-')}</p>
      </section>
      <section>
        <p><strong>{escape(draft.issuer_name or 'Issuer to confirm')}</strong></p>
        <p>ABN: {escape(draft.issuer_abn or '-')}</p>
      </section>
    </header>
    <h2>Bill to</h2>
    <p><strong>{escape(draft.recipient_name or 'Recipient to confirm')}</strong></p>
    <p>{escape(draft.recipient_email or 'Billing email missing')}</p>
    <h2>Line items</h2>
    <table>
      <thead>
        <tr><th>Description</th><th>Source</th><th class="amount">Amount</th></tr>
      </thead>
      <tbody>{line_rows}</tbody>
    </table>
    <p class="amount total">Total {escape(_invoice_money(draft.total_cents, draft.currency))}</p>
    <div class="notice">
      {escape(pdf_notice)}
    </div>
  </main>
</body>
</html>"""


def _prepare_invoice_delivery_metadata(
    draft: InvoiceDraft,
    user: CurrentUser,
    session: Session,
) -> tuple[dict[str, object], list[str]]:
    metadata = dict(draft.invoice_metadata or {})
    blockers = _invoice_draft_delivery_blockers(draft)
    prepared_at = utcnow().isoformat()
    pdf_artifact = _upsert_invoice_pdf_artifact(draft, metadata, user, session, prepared_at)
    email_preview = _invoice_email_preview(draft)
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
        "template": "leasium_invoice_v1",
        "to": email_preview["to"],
        "from_name": email_preview["from_name"],
        "reply_to": email_preview["reply_to"],
        "subject": email_preview["subject"],
        "body": email_preview["body"],
        "brand": email_preview["brand"],
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
        "email": email_preview,
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
    delivery_state = dict(metadata.get("delivery_state") or {})
    delivery_state.update(
        {
            "tenant_email_sent": True,
            "tenant_email_sent_at": sent_at,
            "tenant_email_sent_by_user_id": str(user.id),
            "tenant_email_delivery_method": payload.method,
            "xero_synced": False,
        }
    )
    delivery_email = dict(metadata.get("delivery_email") or {})
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
    receipts = list(metadata.get("delivery_receipts") or [])
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
    history = list(metadata.get("delivery_history") or [])
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
    entity_id: Annotated[UUID, Query()],
    property_id: UUID | None = None,
    lease_id: UUID | None = None,
    document_intake_id: UUID | None = None,
    draft_status: BillingDraftStatus | None = None,
    include_deleted: bool = False,
) -> list[BillingDraft]:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    statement = select(BillingDraft).where(BillingDraft.entity_id == entity_id)
    if property_id is not None:
        prop = _property_for_access(property_id, user, session, READ_ROLES)
        if prop.entity_id != entity_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Property must belong to the selected entity.",
            )
        statement = statement.where(BillingDraft.property_id == property_id)
    if lease_id is not None:
        _, lease_entity_id = _lease_for_access(lease_id, user, session, READ_ROLES)
        if lease_entity_id != entity_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Lease must belong to the selected entity.",
            )
        statement = statement.where(BillingDraft.lease_id == lease_id)
    if document_intake_id is not None:
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
    entity_id: Annotated[UUID, Query()],
    billing_draft_id: UUID | None = None,
    draft_status: InvoiceDraftStatus | None = None,
    include_deleted: bool = False,
) -> list[InvoiceDraft]:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    statement = select(InvoiceDraft).where(InvoiceDraft.entity_id == entity_id)
    if billing_draft_id is not None:
        billing_draft = _billing_draft_for_access(
            billing_draft_id,
            user,
            session,
            READ_ROLES,
        )
        if billing_draft.entity_id != entity_id:
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
) -> InvoiceDraft:
    draft = _invoice_draft_for_access(invoice_draft_id, user, session, WRITE_ROLES)
    if draft.status == InvoiceDraftStatus.void:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Void invoice drafts cannot be prepared for delivery.",
        )

    metadata, blockers = _prepare_invoice_delivery_metadata(draft, user, session)
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
    return HTMLResponse(_invoice_preview_html(draft))


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
    data["charge_rule_metadata"] = data.pop("metadata")
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
    if "metadata" in data:
        data["charge_rule_metadata"] = data.pop("metadata")
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
    entity_id: Annotated[UUID, Query()],
    property_id: UUID | None = None,
    as_of: date | None = None,
) -> list[RentRollRowRead]:
    assert_entity_role(session, user, entity_id, READ_ROLES)
    if property_id is not None:
        prop = _property_for_access(property_id, user, session, READ_ROLES)
        if prop.entity_id != entity_id:
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
        .outerjoin(Tenant, Tenant.id == Lease.tenant_id)
        .where(
            Entity.id == entity_id,
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
