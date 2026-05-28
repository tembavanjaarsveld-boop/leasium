"""Owner-grouped statements router.

v1 of the owner monthly statements feature from the automation strategy
(`docs/automation-strategy-2026-05-23.md`). Backend-only — exposes a
read endpoint that groups properties by owner identity (derived from
existing `Property` columns; no `owner` table) and rolls up invoice totals
for a month. v2 wires a frontend statements page; v3 adds PDF generation;
v4 dispatches drafts through the comms queue.

Read-only — never mutates, never sends.
"""

from __future__ import annotations

import calendar
import re
import textwrap
import zipfile
from datetime import date
from io import BytesIO
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.db import utcnow
from stewart.core.models import (
    InvoiceDraft,
    InvoiceDraftStatus,
    Property,
    UserRole,
)

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.owners import (
    OwnerInvoiceEvidenceLine,
    OwnerPropertyLine,
    OwnerStatementRead,
    OwnerStatementsRead,
)

router = APIRouter(prefix="/owners", tags=["owners"])

READ_ROLES = {
    UserRole.owner,
    UserRole.admin,
    UserRole.finance,
    UserRole.ops,
    UserRole.viewer,
}


def _parse_month(value: str) -> tuple[date, date, str]:
    """Parse YYYY-MM into (first_day, last_day, canonical_string).

    Defensive — the endpoint is operator-facing and a malformed month
    should yield a 422, not crash.
    """

    try:
        year_str, month_str = value.split("-")
        year = int(year_str)
        month = int(month_str)
        first = date(year, month, 1)
        last_day = calendar.monthrange(year, month)[1]
        last = date(year, month, last_day)
        canonical = f"{year:04d}-{month:02d}"
        return first, last, canonical
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="month must be in YYYY-MM format.",
        ) from exc


def _owner_identity_tuple(
    prop: Property,
) -> tuple[str | None, str | None, str | None, str | None]:
    """Build the identity tuple used to group properties by owner.

    The tuple keys are (owner_legal_name, trustee_name, trust_name,
    invoice_issuer_name) — case- and whitespace-normalised. Properties
    that share all four resolve to the same statement.

    Properties with no identifying owner fields fall into a single
    "Unattributed" bucket so the operator still sees their financials.
    """

    def norm(value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned.casefold() if cleaned else None

    return (
        norm(prop.owner_legal_name),
        norm(prop.trustee_name),
        norm(prop.trust_name),
        norm(prop.invoice_issuer_name),
    )


def _identity_label(prop: Property) -> str:
    """Pick the most descriptive label for the owner identity.

    Prefer trust_name + trustee_name when both are set ("XYZ Trust
    (Trustee: ABC Pty Ltd)"); otherwise trust_name alone; otherwise
    trustee_name; otherwise owner_legal_name; otherwise
    invoice_issuer_name; otherwise "Unattributed".
    """

    if prop.trust_name and prop.trustee_name:
        return f"{prop.trust_name.strip()} (Trustee: {prop.trustee_name.strip()})"
    if prop.trust_name:
        return prop.trust_name.strip()
    if prop.trustee_name:
        return prop.trustee_name.strip()
    if prop.owner_legal_name:
        return prop.owner_legal_name.strip()
    if prop.invoice_issuer_name:
        return prop.invoice_issuer_name.strip()
    return "Unattributed"


def _invoice_paid_cents(invoice: InvoiceDraft) -> int:
    """Read paid_cents from local invoice metadata.

    Current payment status lives under ``payment_status``. Older local
    metadata may have a top-level ``paid_cents`` value, so keep that as a
    read-only fallback for existing invoices.
    """

    metadata: dict[str, Any] = invoice.invoice_metadata or {}
    payment = metadata.get("payment_status")
    if isinstance(payment, dict):
        paid_cents = _metadata_int(payment.get("paid_cents"))
        if paid_cents is not None:
            return max(0, paid_cents)

    paid_cents = _metadata_int(metadata.get("paid_cents"))
    return max(0, paid_cents or 0)


def _metadata_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return None
    return None


def _metadata_text(record: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = record.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def _metadata_record(value: object) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _invoice_payment_status(invoice: InvoiceDraft, paid_cents: int) -> str:
    metadata: dict[str, Any] = invoice.invoice_metadata or {}
    payment = metadata.get("payment_status")
    if isinstance(payment, dict):
        status_value = payment.get("status")
        if isinstance(status_value, str) and status_value.strip():
            return status_value.strip()
    if paid_cents >= invoice.total_cents and invoice.total_cents > 0:
        return "paid"
    if paid_cents > 0:
        return "partially_paid"
    return "unpaid"


def _invoice_outstanding_cents(invoice: InvoiceDraft, paid_cents: int) -> int:
    metadata: dict[str, Any] = invoice.invoice_metadata or {}
    payment = metadata.get("payment_status")
    if isinstance(payment, dict):
        outstanding_cents = _metadata_int(payment.get("outstanding_cents"))
        if outstanding_cents is not None:
            return max(0, outstanding_cents)
    return max(0, invoice.total_cents - paid_cents)


def _invoice_xero_invoice_id(invoice: InvoiceDraft) -> str | None:
    metadata: dict[str, Any] = invoice.invoice_metadata or {}
    direct_id = _metadata_text(metadata, "xero_invoice_id", "InvoiceID")
    if direct_id:
        return direct_id
    sync_state = _metadata_record(metadata.get("xero_sync"))
    sync_id = _metadata_text(sync_state, "xero_invoice_id", "InvoiceID")
    if sync_id:
        return sync_id
    posting_state = _metadata_record(metadata.get("posting_preparation"))
    return _metadata_text(posting_state, "xero_invoice_id", "InvoiceID")


def _invoice_reconciliation_record(invoice: InvoiceDraft) -> dict[str, Any]:
    metadata: dict[str, Any] = invoice.invoice_metadata or {}
    current = _metadata_record(metadata.get("xero_payment_reconciliation"))
    if current:
        return current
    history = metadata.get("xero_payment_reconciliation_history")
    if isinstance(history, list) and history:
        return _metadata_record(history[-1])
    return {}


def _invoice_evidence_line(invoice: InvoiceDraft) -> OwnerInvoiceEvidenceLine:
    paid_cents = _invoice_paid_cents(invoice)
    reconciliation = _invoice_reconciliation_record(invoice)
    return OwnerInvoiceEvidenceLine(
        invoice_draft_id=invoice.id,
        invoice_number=invoice.invoice_number,
        title=invoice.title,
        issue_date=invoice.issue_date,
        due_date=invoice.due_date,
        total_cents=invoice.total_cents,
        paid_cents=paid_cents,
        outstanding_cents=_invoice_outstanding_cents(invoice, paid_cents),
        payment_status=_invoice_payment_status(invoice, paid_cents),
        xero_invoice_id=_invoice_xero_invoice_id(invoice),
        reconciliation_reference=_metadata_text(reconciliation, "reference"),
        reconciliation_match_confidence=_metadata_text(
            reconciliation,
            "match_confidence",
        ),
        reconciliation_bank_transaction_id=_metadata_text(
            reconciliation,
            "bank_transaction_id",
        ),
    )


def _build_owner_statements(
    entity_id: UUID,
    session: Session,
    month: str,
) -> OwnerStatementsRead:
    # Default to previous calendar month when month is not supplied.
    if not month:
        today = date.today()
        if today.month == 1:
            target_year, target_month = today.year - 1, 12
        else:
            target_year, target_month = today.year, today.month - 1
        month = f"{target_year:04d}-{target_month:02d}"

    month_start, month_end, canonical_month = _parse_month(month)

    properties = list(
        session.scalars(
            select(Property).where(
                Property.entity_id == entity_id,
                Property.deleted_at.is_(None),
            )
        ).all()
    )
    invoices = list(
        session.scalars(
            select(InvoiceDraft).where(
                InvoiceDraft.entity_id == entity_id,
                InvoiceDraft.deleted_at.is_(None),
                InvoiceDraft.property_id.is_not(None),
                InvoiceDraft.issue_date.is_not(None),
                InvoiceDraft.issue_date >= month_start,
                InvoiceDraft.issue_date <= month_end,
                InvoiceDraft.status == InvoiceDraftStatus.approved,
            )
        ).all()
    )

    # Bucket invoices by property.
    invoices_by_property: dict[UUID, list[InvoiceDraft]] = {}
    for invoice in invoices:
        assert invoice.property_id is not None  # filtered above
        invoices_by_property.setdefault(invoice.property_id, []).append(invoice)

    # Group properties by owner identity.
    owners_by_identity: dict[
        tuple[str | None, str | None, str | None, str | None],
        dict[str, Any],
    ] = {}
    for prop in properties:
        identity = _owner_identity_tuple(prop)
        bucket = owners_by_identity.setdefault(
            identity,
            {
                "label": _identity_label(prop),
                "sample": prop,
                "properties": [],
            },
        )
        # Prefer a richer label as more properties roll in (e.g., one
        # property has trust_name set, another doesn't — use the
        # trust-named property's label).
        if (
            bucket["label"] == "Unattributed"
            and _identity_label(prop) != "Unattributed"
        ):
            bucket["label"] = _identity_label(prop)
            bucket["sample"] = prop
        bucket["properties"].append(prop)

    statements: list[OwnerStatementRead] = []
    for bucket in owners_by_identity.values():
        sample: Property = bucket["sample"]
        props: list[Property] = bucket["properties"]

        property_lines: list[OwnerPropertyLine] = []
        owner_invoiced = 0
        owner_paid = 0
        owner_outstanding = 0
        owner_count = 0
        for prop in props:
            prop_invoices = invoices_by_property.get(prop.id, [])
            invoice_lines = [_invoice_evidence_line(inv) for inv in prop_invoices]
            invoice_lines.sort(
                key=lambda line: (
                    line.issue_date or date.min,
                    line.invoice_number or line.title,
                )
            )
            invoiced = sum(line.total_cents for line in invoice_lines)
            paid = sum(line.paid_cents for line in invoice_lines)
            outstanding = sum(line.outstanding_cents for line in invoice_lines)
            owner_invoiced += invoiced
            owner_paid += paid
            owner_outstanding += outstanding
            owner_count += len(prop_invoices)
            property_lines.append(
                OwnerPropertyLine(
                    property_id=prop.id,
                    property_name=prop.name,
                    invoiced_cents=invoiced,
                    paid_cents=paid,
                    outstanding_cents=outstanding,
                    invoice_count=len(prop_invoices),
                    invoices=invoice_lines,
                )
            )

        # Sort properties by invoiced amount descending so the largest
        # contributors land at the top of the statement.
        property_lines.sort(
            key=lambda line: (-line.invoiced_cents, line.property_name)
        )

        statements.append(
            OwnerStatementRead(
                owner_identity=bucket["label"],
                owner_legal_name=sample.owner_legal_name,
                trustee_name=sample.trustee_name,
                trust_name=sample.trust_name,
                invoice_issuer_name=sample.invoice_issuer_name,
                billing_contact_name=sample.billing_contact_name,
                billing_email=sample.billing_email,
                property_count=len(props),
                properties=property_lines,
                invoiced_cents=owner_invoiced,
                paid_cents=owner_paid,
                outstanding_cents=owner_outstanding,
                invoice_count=owner_count,
            )
        )

    # Sort owners by invoiced amount descending.
    statements.sort(key=lambda s: (-s.invoiced_cents, s.owner_identity))

    return OwnerStatementsRead(
        entity_id=entity_id,
        month=canonical_month,
        month_start=month_start,
        month_end=month_end,
        owners=statements,
        generated_at=utcnow(),
    )


def _format_money(cents: int) -> str:
    dollars = cents / 100
    return f"${dollars:,.0f}"


def _pdf_text(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace("(", "\\(")
        .replace(")", "\\)")
        .encode("latin-1", "replace")
        .decode("latin-1")
    )


PDF_LINE_WIDTH = 88
PDF_LINES_PER_PAGE = 48


def _wrap_pdf_lines(lines: list[str]) -> list[str]:
    wrapped: list[str] = []
    for line in lines:
        if not line:
            wrapped.append("")
            continue
        wrapped.extend(
            textwrap.wrap(
                line,
                width=PDF_LINE_WIDTH,
                break_long_words=True,
                break_on_hyphens=False,
                subsequent_indent="  ",
            )
            or [""]
        )
    return wrapped


def _statement_pdf_bytes(statement: OwnerStatementRead, month: str) -> bytes:
    """Render a compact text PDF without introducing a new provider dependency."""

    lines = [
        "LEASIUM OWNER STATEMENT",
        "Review-only export. Not sent to owner.",
        "",
        f"Owner: {statement.owner_identity}",
        f"Month: {month}",
        "",
        "Billing",
        f"Billing contact: {statement.billing_contact_name or 'Not recorded'}",
        f"Billing email: {statement.billing_email or 'Not recorded'}",
        "",
        "Summary",
        f"Invoiced: {_format_money(statement.invoiced_cents)}",
        f"Paid: {_format_money(statement.paid_cents)}",
        f"Outstanding: {_format_money(statement.outstanding_cents)}",
        f"Properties: {statement.property_count}",
        f"Invoices: {statement.invoice_count}",
        "",
        "Property breakdown",
        "Property | Invoiced | Paid | Outstanding | Invoices",
    ]
    for prop in statement.properties:
        lines.extend(
            [
                (
                    f"{prop.property_name} | {_format_money(prop.invoiced_cents)} | "
                    f"{_format_money(prop.paid_cents)} | "
                    f"{_format_money(prop.outstanding_cents)} | {prop.invoice_count}"
                ),
            ]
        )
    invoice_lines = [
        (prop.property_name, invoice)
        for prop in statement.properties
        for invoice in prop.invoices
    ]
    if invoice_lines:
        lines.extend(
            [
                "",
                "Invoice evidence",
                (
                    "Property | Invoice | Issue | Due | Status | Total | Paid | "
                    "Outstanding | Xero invoice | Bank reference | Match | Bank txn"
                ),
            ]
        )
        for property_name, invoice in invoice_lines:
            lines.append(
                f"{property_name} | {invoice.invoice_number or invoice.title} | "
                f"{invoice.issue_date or ''} | {invoice.due_date or ''} | "
                f"{invoice.payment_status} | {_format_money(invoice.total_cents)} | "
                f"{_format_money(invoice.paid_cents)} | "
                f"{_format_money(invoice.outstanding_cents)} | "
                f"{invoice.xero_invoice_id or ''} | "
                f"{invoice.reconciliation_reference or ''} | "
                f"{invoice.reconciliation_match_confidence or ''} | "
                f"{invoice.reconciliation_bank_transaction_id or ''}"
            )
    lines.extend(
        [
            "",
            "Review only. This PDF does not send owner email, post to Xero, "
            "or update provider history.",
        ]
    )

    wrapped_lines = _wrap_pdf_lines(lines)
    page_chunks = [
        wrapped_lines[index : index + PDF_LINES_PER_PAGE]
        for index in range(0, len(wrapped_lines), PDF_LINES_PER_PAGE)
    ] or [[]]
    objects: list[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"",  # Filled after pages are known.
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    page_refs: list[str] = []
    for chunk in page_chunks:
        content_lines = ["BT", "/F1 11 Tf", "14 TL", "50 790 Td"]
        for line in chunk:
            content_lines.append(f"({_pdf_text(line)}) Tj")
            content_lines.append("T*")
        content_lines.append("ET")
        stream = "\n".join(content_lines).encode("latin-1")
        content_obj = (
            f"<< /Length {len(stream)} >>\nstream\n".encode("latin-1")
            + stream
            + b"\nendstream"
        )
        page_number = len(objects) + 1
        content_number = len(objects) + 2
        page_refs.append(f"{page_number} 0 R")
        objects.append(
            (
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
                f"/Resources << /Font << /F1 3 0 R >> >> /Contents {content_number} 0 R >>"
            ).encode("latin-1")
        )
        objects.append(content_obj)
    objects[1] = (
        f"<< /Type /Pages /Kids [{' '.join(page_refs)}] /Count {len(page_refs)} >>"
    ).encode("latin-1")

    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{index} 0 obj\n".encode("latin-1"))
        output.extend(obj)
        output.extend(b"\nendobj\n")
    xref_offset = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode("latin-1"))
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("latin-1"))
    output.extend(
        (
            f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref_offset}\n%%EOF\n"
        ).encode("latin-1")
    )
    return bytes(output)


def _statement_filename(owner_identity: str, month: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", owner_identity).strip("-").lower()
    return f"owner-statement-{month}-{slug or 'owner'}.pdf"


def _statement_pack_filename(month: str) -> str:
    return f"owner-statement-pack-{month}.zip"


def _csv_cell(value: object) -> str:
    text = "" if value is None else str(value)
    return '"' + text.replace('"', '""') + '"'


def _statement_pack_manifest_csv(statements: OwnerStatementsRead) -> str:
    rows: list[list[object]] = [
        [
            "owner_identity",
            "billing_email",
            "recipient_ready",
            "property_count",
            "invoice_count",
            "invoiced_cents",
            "paid_cents",
            "outstanding_cents",
            "review_status",
        ]
    ]
    for statement in statements.owners:
        if statement.invoice_count <= 0:
            continue
        rows.append(
            [
                statement.owner_identity,
                statement.billing_email or "",
                "yes" if statement.billing_email else "no",
                statement.property_count,
                statement.invoice_count,
                statement.invoiced_cents,
                statement.paid_cents,
                statement.outstanding_cents,
                "payment_review" if statement.outstanding_cents > 0 else "ready",
            ]
        )
    return "\n".join(",".join(_csv_cell(cell) for cell in row) for row in rows) + "\n"


def _statement_pack_invoice_evidence_csv(statements: OwnerStatementsRead) -> str:
    rows: list[list[object]] = [
        [
            "owner_identity",
            "property_name",
            "invoice_draft_id",
            "invoice_number",
            "title",
            "issue_date",
            "due_date",
            "total_cents",
            "paid_cents",
            "outstanding_cents",
            "payment_status",
            "xero_invoice_id",
            "reconciliation_reference",
            "reconciliation_match_confidence",
            "reconciliation_bank_transaction_id",
        ]
    ]
    for statement in statements.owners:
        for prop in statement.properties:
            for invoice in prop.invoices:
                rows.append(
                    [
                        statement.owner_identity,
                        prop.property_name,
                        invoice.invoice_draft_id,
                        invoice.invoice_number or "",
                        invoice.title,
                        invoice.issue_date or "",
                        invoice.due_date or "",
                        invoice.total_cents,
                        invoice.paid_cents,
                        invoice.outstanding_cents,
                        invoice.payment_status,
                        invoice.xero_invoice_id or "",
                        invoice.reconciliation_reference or "",
                        invoice.reconciliation_match_confidence or "",
                        invoice.reconciliation_bank_transaction_id or "",
                    ]
                )
    return "\n".join(",".join(_csv_cell(cell) for cell in row) for row in rows) + "\n"


def _statement_pack_zip_bytes(statements: OwnerStatementsRead) -> bytes:
    included = [statement for statement in statements.owners if statement.invoice_count > 0]
    total_invoiced = sum(statement.invoiced_cents for statement in included)
    total_paid = sum(statement.paid_cents for statement in included)
    total_outstanding = sum(statement.outstanding_cents for statement in included)
    missing_recipients = sum(1 for statement in included if not statement.billing_email)
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        for statement in included:
            archive.writestr(
                _statement_filename(statement.owner_identity, statements.month),
                _statement_pdf_bytes(statement, statements.month),
            )
        archive.writestr(
            f"MANIFEST-{statements.month}.csv",
            _statement_pack_manifest_csv(statements),
        )
        archive.writestr(
            f"INVOICE-EVIDENCE-{statements.month}.csv",
            _statement_pack_invoice_evidence_csv(statements),
        )
        archive.writestr(
            f"README-{statements.month}.txt",
            (
                "Review-only owner statement pack generated by Leasium.\n"
                f"Month: {statements.month}\n"
                f"Owners included: {len(included)}\n"
                f"Invoiced cents: {total_invoiced}\n"
                f"Paid cents: {total_paid}\n"
                f"Outstanding cents: {total_outstanding}\n"
                f"Missing owner billing emails: {missing_recipients}\n"
                "Use MANIFEST CSV for accountant review and recipient readiness.\n"
                "Use INVOICE-EVIDENCE CSV to review the invoice-level source "
                "data behind owner totals.\n"
                "No owner email, Xero posting, payment reconciliation, or provider "
                "delivery history mutation was performed.\n"
            ),
        )
    return buffer.getvalue()


@router.get("/statements", response_model=OwnerStatementsRead)
def get_owner_statements(
    entity_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    month: Annotated[
        str,
        Query(
            description="Month in YYYY-MM format. Defaults to the previous calendar month.",
        ),
    ] = "",
) -> OwnerStatementsRead:
    """Return per-owner monthly statements for `entity_id`.

    Groups properties by owner identity tuple, then for each owner sums
    the InvoiceDraft totals whose `issue_date` falls in the target month.
    Paid totals come from `invoice_metadata.paid_cents` (written by Xero
    reconciliation). Outstanding = invoiced - paid, floored at zero so a
    payment overshoot doesn't show negative.
    """

    assert_entity_role(session, user, entity_id, READ_ROLES)
    return _build_owner_statements(entity_id, session, month)


@router.get("/statements/pdf")
def get_owner_statement_pdf(
    entity_id: UUID,
    owner_identity: str,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    month: Annotated[
        str,
        Query(
            description="Month in YYYY-MM format. Defaults to the previous calendar month.",
        ),
    ] = "",
) -> Response:
    """Return a review-only PDF for one owner statement."""

    assert_entity_role(session, user, entity_id, READ_ROLES)
    statements = _build_owner_statements(entity_id, session, month)
    statement = next(
        (
            item
            for item in statements.owners
            if item.owner_identity.casefold() == owner_identity.casefold()
        ),
        None,
    )
    if statement is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Owner statement not found for this month.",
        )
    filename = _statement_filename(statement.owner_identity, statements.month)
    return Response(
        content=_statement_pdf_bytes(statement, statements.month),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/statements/pdf-pack")
def get_owner_statement_pdf_pack(
    entity_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    month: Annotated[
        str,
        Query(
            description="Month in YYYY-MM format. Defaults to the previous calendar month.",
        ),
    ] = "",
) -> Response:
    """Return a review-only ZIP of every owner statement PDF for a month."""

    assert_entity_role(session, user, entity_id, READ_ROLES)
    statements = _build_owner_statements(entity_id, session, month)
    if not any(statement.invoice_count > 0 for statement in statements.owners):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No owner statements found for this month.",
        )
    filename = _statement_pack_filename(statements.month)
    return Response(
        content=_statement_pack_zip_bytes(statements),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
