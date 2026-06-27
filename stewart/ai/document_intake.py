"""OpenAI-backed generic document intake extraction."""

import base64
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

from stewart.ai.lease_intake import (
    LeaseExtractionError,
    _extract_document_text,
    _response_output_text,
)
from stewart.core.settings import Settings


class DocumentExtractionError(RuntimeError):
    """Raised when document extraction cannot complete."""


DOCUMENT_INTAKE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "document_type",
        "summary",
        "confidence",
        "parties",
        "properties",
        "key_dates",
        "money_amounts",
        "tenancy_schedule",
        "obligations",
        "suggested_links",
        "warnings",
        "missing_information",
        "proposed_actions",
        "inspection_findings",
    ],
    "properties": {
        "document_type": {
            "type": "string",
            "enum": [
                "lease",
                "tenant_document",
                "invoice_admin",
                "insurance_certificate",
                "bank_guarantee",
                "purchase_contract",
                "inspection_report",
                "compliance",
                "notice",
                "unknown",
            ],
        },
        "summary": {"type": "string"},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "parties": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "name",
                    "role",
                    "abn",
                    "contact",
                    "contact_email",
                    "contact_phone",
                    "billing_email",
                    "confidence",
                    "source_hint",
                ],
                "properties": {
                    "name": {"type": ["string", "null"]},
                    "role": {"type": ["string", "null"]},
                    "abn": {"type": ["string", "null"]},
                    "contact": {"type": ["string", "null"]},
                    "contact_email": {"type": ["string", "null"]},
                    "contact_phone": {"type": ["string", "null"]},
                    "billing_email": {"type": ["string", "null"]},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "source_hint": {"type": ["string", "null"]},
                },
            },
        },
        "properties": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "name",
                    "address",
                    "unit_label",
                    "ownership_structure",
                    "owner_legal_name",
                    "owner_abn",
                    "trustee_name",
                    "trust_name",
                    "invoice_issuer_name",
                    "billing_contact_name",
                    "billing_email",
                    "invoice_reference",
                    "ownership_split",
                    "owner_gst_registered",
                    "xero_contact_id",
                    "xero_tracking_category",
                    "confidence",
                    "source_hint",
                ],
                "properties": {
                    "name": {"type": ["string", "null"]},
                    "address": {"type": ["string", "null"]},
                    "unit_label": {"type": ["string", "null"]},
                    "ownership_structure": {
                        "type": ["string", "null"],
                        "enum": ["current_entity", "property_owner", "trust", "split", None],
                    },
                    "owner_legal_name": {"type": ["string", "null"]},
                    "owner_abn": {"type": ["string", "null"]},
                    "trustee_name": {"type": ["string", "null"]},
                    "trust_name": {"type": ["string", "null"]},
                    "invoice_issuer_name": {"type": ["string", "null"]},
                    "billing_contact_name": {"type": ["string", "null"]},
                    "billing_email": {"type": ["string", "null"]},
                    "invoice_reference": {"type": ["string", "null"]},
                    "ownership_split": {"type": ["string", "null"]},
                    "owner_gst_registered": {"type": ["boolean", "null"]},
                    "xero_contact_id": {"type": ["string", "null"]},
                    "xero_tracking_category": {"type": ["string", "null"]},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "source_hint": {"type": ["string", "null"]},
                },
            },
        },
        "key_dates": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["label", "date", "confidence", "source_hint"],
                "properties": {
                    "label": {"type": "string"},
                    "date": {"type": ["string", "null"]},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "source_hint": {"type": ["string", "null"]},
                },
            },
        },
        "money_amounts": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "label",
                    "amount",
                    "currency",
                    "frequency",
                    "confidence",
                    "source_hint",
                ],
                "properties": {
                    "label": {"type": "string"},
                    "amount": {"type": ["number", "null"]},
                    "currency": {"type": ["string", "null"]},
                    "frequency": {"type": ["string", "null"]},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "source_hint": {"type": ["string", "null"]},
                },
            },
        },
        "tenancy_schedule": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "unit_label",
                    "sqm",
                    "parking_spaces",
                    "tenant_name",
                    "tenant_abn",
                    "lease_start",
                    "lease_expiry",
                    "next_review_date",
                    "annual_rent",
                    "rent_frequency",
                    "outgoings",
                    "outgoings_amount",
                    "outgoings_frequency",
                    "parking_amount",
                    "parking_frequency",
                    "storage_amount",
                    "storage_frequency",
                    "utilities_amount",
                    "utilities_frequency",
                    "promotion_levy_amount",
                    "promotion_levy_frequency",
                    "other_charge_label",
                    "other_charge_amount",
                    "other_charge_frequency",
                    "option_summary",
                    "option_notice_date",
                    "security_summary",
                    "security_due_date",
                    "confidence",
                    "source_hint",
                ],
                "properties": {
                    "unit_label": {"type": ["string", "null"]},
                    "sqm": {"type": ["number", "null"]},
                    "parking_spaces": {"type": ["integer", "null"]},
                    "tenant_name": {"type": ["string", "null"]},
                    "tenant_abn": {"type": ["string", "null"]},
                    "lease_start": {"type": ["string", "null"]},
                    "lease_expiry": {"type": ["string", "null"]},
                    "next_review_date": {"type": ["string", "null"]},
                    "annual_rent": {"type": ["number", "null"]},
                    "rent_frequency": {"type": ["string", "null"]},
                    "outgoings": {"type": ["string", "null"]},
                    "outgoings_amount": {"type": ["number", "null"]},
                    "outgoings_frequency": {"type": ["string", "null"]},
                    "parking_amount": {"type": ["number", "null"]},
                    "parking_frequency": {"type": ["string", "null"]},
                    "storage_amount": {"type": ["number", "null"]},
                    "storage_frequency": {"type": ["string", "null"]},
                    "utilities_amount": {"type": ["number", "null"]},
                    "utilities_frequency": {"type": ["string", "null"]},
                    "promotion_levy_amount": {"type": ["number", "null"]},
                    "promotion_levy_frequency": {"type": ["string", "null"]},
                    "other_charge_label": {"type": ["string", "null"]},
                    "other_charge_amount": {"type": ["number", "null"]},
                    "other_charge_frequency": {"type": ["string", "null"]},
                    "option_summary": {"type": ["string", "null"]},
                    "option_notice_date": {"type": ["string", "null"]},
                    "security_summary": {"type": ["string", "null"]},
                    "security_due_date": {"type": ["string", "null"]},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "source_hint": {"type": ["string", "null"]},
                },
            },
        },
        "obligations": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["title", "due_date", "category", "notes", "confidence", "source_hint"],
                "properties": {
                    "title": {"type": "string"},
                    "due_date": {"type": ["string", "null"]},
                    "category": {"type": ["string", "null"]},
                    "notes": {"type": ["string", "null"]},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "source_hint": {"type": ["string", "null"]},
                },
            },
        },
        "suggested_links": {
            "type": "object",
            "additionalProperties": False,
            "required": ["property_name", "tenant_name", "lease_reference"],
            "properties": {
                "property_name": {"type": ["string", "null"]},
                "tenant_name": {"type": ["string", "null"]},
                "lease_reference": {"type": ["string", "null"]},
            },
        },
        "warnings": {"type": "array", "items": {"type": "string"}},
        "missing_information": {"type": "array", "items": {"type": "string"}},
        "proposed_actions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["action", "target", "summary", "confidence"],
                "properties": {
                    "action": {"type": "string"},
                    "target": {"type": ["string", "null"]},
                    "summary": {"type": "string"},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                },
            },
        },
        "inspection_findings": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "title",
                    "description",
                    "priority",
                    "due_date",
                    "location",
                    "category",
                    "confidence",
                    "source_hint",
                    "warnings",
                ],
                "properties": {
                    "title": {"type": "string"},
                    "description": {"type": ["string", "null"]},
                    "priority": {
                        "type": ["string", "null"],
                        "enum": ["low", "normal", "high", "urgent", None],
                    },
                    "due_date": {"type": ["string", "null"]},
                    "location": {"type": ["string", "null"]},
                    "category": {"type": ["string", "null"]},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "source_hint": {"type": ["string", "null"]},
                    "warnings": {"type": "array", "items": {"type": "string"}},
                },
            },
        },
    },
}


def extract_document_file(
    *,
    file_data: bytes,
    filename: str,
    content_type: str | None,
    settings: Settings,
) -> tuple[dict[str, Any], str | None]:
    """Extract review-first document facts from an uploaded property document."""

    if not settings.openai_api_key:
        raise DocumentExtractionError("OpenAI API key is not configured.")

    prompt = (
        "Read this Australian property operations document and prepare a review-first "
        "intake summary. Classify the document cautiously. Use only facts present in "
        "the file. Do not give legal advice. Nothing will be applied automatically, "
        "so focus on facts a property manager should review: parties, properties, "
        "ownership or trust billing identity, acquisition tenancy schedule rows, rent "
        "review dates, outgoings amounts and frequency, parking, storage, utilities, "
        "promotion levy or other schedule charges, option notice dates, security "
        "or bank guarantee due dates, key dates, money, obligations, warnings, "
        "missing information, proposed actions, and inspection findings that should "
        "become reviewed maintenance work orders. Use ISO dates where possible and "
        "mark uncertainty with lower confidence and warnings. "
        "For rent and other recurring charges, record the payment frequency EXACTLY "
        "as the document states it — e.g. the 'per: month / year' selection on REIQ "
        "commercial lease forms, or wording like 'per annum', 'p.a.', 'per calendar "
        "month', 'pcm'. Do NOT assume monthly. The stated amount is the amount for "
        "that period (e.g. '$95,000 + GST per year' is $95,000 per year, not per "
        "month). If you cannot tell whether the amount is per month or per year, set "
        "the frequency to null and add a warning asking the operator to confirm the "
        "rent frequency rather than guessing. For tenant parties, split visible "
        "email addresses into structured contact_email and billing_email fields. "
        "If exactly one tenant email is visible, use it for both contact_email and "
        "billing_email. If multiple tenant emails are visible, use a named/person "
        "email for contact_email and a role or generic mailbox such as accounts@, "
        "billing@, finance@, invoices@, ap@, or admin@ for billing_email. Keep the "
        "raw contact wording in contact when useful, but do not leave structured "
        "email fields null when the email is visible in the document."
    )
    content: list[dict[str, str]] = [{"type": "input_text", "text": prompt}]
    try:
        extracted_text = _extract_document_text(file_data, filename, content_type)
    except LeaseExtractionError as exc:
        raise DocumentExtractionError(str(exc)) from exc

    if extracted_text:
        content.append(
            {"type": "input_text", "text": f"Document text:\n{extracted_text[:120000]}"}
        )
    else:
        encoded = base64.b64encode(file_data).decode("ascii")
        media_type = content_type or "application/octet-stream"
        content.append(
            {
                "type": "input_file",
                "filename": filename,
                "file_data": f"data:{media_type};base64,{encoded}",
            }
        )

    payload: dict[str, Any] = {
        "model": settings.openai_model,
        "input": [{"role": "user", "content": content}],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "document_intake_extraction",
                "strict": True,
                "schema": DOCUMENT_INTAKE_SCHEMA,
            }
        },
    }
    try:
        with httpx.Client(timeout=90.0) as client:
            response = client.post(
                "https://api.openai.com/v1/responses",
                headers={
                    "Authorization": f"Bearer {settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise DocumentExtractionError(
            f"OpenAI extraction request failed with status {exc.response.status_code}."
        ) from exc
    except httpx.TimeoutException as exc:
        raise DocumentExtractionError("OpenAI extraction request timed out.") from exc
    except httpx.HTTPError as exc:
        raise DocumentExtractionError("OpenAI extraction request failed.") from exc

    body = response.json()
    output_text = _response_output_text(body)
    if not output_text:
        raise DocumentExtractionError("OpenAI response did not include extracted JSON.")
    try:
        extracted = json.loads(output_text)
    except json.JSONDecodeError as exc:
        raise DocumentExtractionError("OpenAI response was not valid JSON.") from exc
    if not isinstance(extracted, dict):
        raise DocumentExtractionError("OpenAI extraction returned an unexpected shape.")
    missing_fields = [
        field for field in DOCUMENT_INTAKE_SCHEMA["required"] if field not in extracted
    ]
    if missing_fields:
        raise DocumentExtractionError(
            "OpenAI extraction was missing required fields: "
            f"{', '.join(missing_fields)}."
        )
    return _normalise_extracted_document(
        extracted,
        filename,
        extracted_text=extracted_text,
    ), body.get("id")


def _normalise_extracted_document(
    extracted: dict[str, Any],
    filename: str,
    *,
    extracted_text: str | None = None,
) -> dict[str, Any]:
    document_type = str(extracted.get("document_type") or "unknown")
    if document_type not in {
        "lease",
        "tenant_document",
        "invoice_admin",
        "insurance_certificate",
        "bank_guarantee",
        "purchase_contract",
        "inspection_report",
        "compliance",
        "notice",
        "unknown",
    }:
        document_type = "unknown"
    summary = str(extracted.get("summary") or f"Review {Path(filename).stem}.").strip()
    extracted["document_type"] = document_type
    extracted["summary"] = summary
    if document_type == "invoice_admin" and extracted_text:
        _supplement_invoice_admin_from_text(extracted, extracted_text)
    return extracted


def _supplement_invoice_admin_from_text(extracted: dict[str, Any], text: str) -> None:
    if not _looks_like_invoice_text(text):
        return

    tenant_name = _invoice_customer_name(text)
    issuer_name = _invoice_issuer_name(text)
    invoice_number = _invoice_number(text)
    address, unit_label = _invoice_property_scope(text)
    invoice_date = _invoice_date_after("Invoice Date", text)
    due_date = _invoice_date_after("Due Date", text)
    total_amount = _invoice_money_after(r"\bTOTAL\s+AUD\b", text)
    frequency = (
        "monthly"
        if re.search(
            r"\b[A-Z][a-z]{2,8}\s+\d{4}\s+Rent\b|^Rent\s+-",
            text,
            re.IGNORECASE | re.MULTILINE,
        )
        else "one_off"
    )

    if not _record_list(extracted.get("parties")):
        parties: list[dict[str, Any]] = []
        if tenant_name:
            parties.append(
                {
                    "name": tenant_name,
                    "role": "tenant",
                    "abn": None,
                    "contact": None,
                    "confidence": 0.88,
                    "source_hint": f"Customer {tenant_name}",
                }
            )
        if issuer_name:
            parties.append(
                {
                    "name": issuer_name,
                    "role": "invoice_issuer",
                    "abn": _first_match(r"\bABN:?\s*([0-9 ]{11,})", text),
                    "contact": _first_match(r"\bEmail:\s*([^\s]+@[^\s]+)", text),
                    "confidence": 0.88,
                    "source_hint": f"To: {issuer_name}",
                }
            )
        if parties:
            extracted["parties"] = parties

    if address and not _record_list(extracted.get("properties")):
        extracted["properties"] = [
            {
                "name": address,
                "address": address,
                "unit_label": unit_label,
                "ownership_structure": None,
                "owner_legal_name": None,
                "owner_abn": None,
                "trustee_name": None,
                "trust_name": None,
                "invoice_issuer_name": issuer_name,
                "billing_contact_name": None,
                "billing_email": None,
                "invoice_reference": invoice_number,
                "ownership_split": None,
                "owner_gst_registered": None,
                "xero_contact_id": None,
                "xero_tracking_category": None,
                "confidence": 0.88,
                "source_hint": _first_invoice_rent_line(text) or address,
            }
        ]

    key_dates = _record_list(extracted.get("key_dates"))
    if invoice_date and not _has_review_label(key_dates, "Invoice date"):
        key_dates.append(
            {
                "label": "Invoice date",
                "date": invoice_date,
                "confidence": 0.9,
                "source_hint": f"Invoice Date {_invoice_source_date_after('Invoice Date', text)}",
            }
        )
    if due_date and not _has_review_label(key_dates, "Payment due"):
        key_dates.append(
            {
                "label": "Payment due",
                "date": due_date,
                "confidence": 0.9,
                "source_hint": f"Due Date {_invoice_source_date_after('Due Date', text)}",
            }
        )
    extracted["key_dates"] = key_dates

    if total_amount is not None and not _record_list(extracted.get("money_amounts")):
        extracted["money_amounts"] = [
            {
                "label": "Total rent invoice including GST",
                "amount": total_amount,
                "currency": "AUD",
                "frequency": frequency,
                "confidence": 0.9,
                "source_hint": f"TOTAL AUD {_format_invoice_money(total_amount)}",
            }
        ]

    links = extracted.get("suggested_links")
    if not isinstance(links, dict):
        links = {"property_name": None, "tenant_name": None, "lease_reference": None}
    links["property_name"] = links.get("property_name") or address
    links["tenant_name"] = links.get("tenant_name") or tenant_name
    links["lease_reference"] = links.get("lease_reference")
    extracted["suggested_links"] = links

    warnings = _text_list(extracted.get("warnings"))
    if re.search(r"\bAMOUNT\s+DUE\s+AUD\s+0(?:\.00)?\b|\bAmount Due\s+0(?:\.00)?\b", text):
        _append_unique(
            warnings,
            (
                "Invoice shows Amount Due AUD 0.00 / paid; use as historical "
                "billing setup context before drafting a new invoice."
            ),
        )
    extracted["warnings"] = warnings

    missing_information = _text_list(extracted.get("missing_information"))
    if total_amount is not None:
        _append_unique(
            missing_information,
            (
                "Confirm property, lease, billing recurrence, GST handling, and "
                "whether this paid invoice should become a future billing pattern."
            ),
        )
    extracted["missing_information"] = missing_information

    if total_amount is not None and not _record_list(extracted.get("proposed_actions")):
        extracted["proposed_actions"] = [
            {
                "action": "prepare_billing_review",
                "target": "billing",
                "summary": (
                    "Review the source-backed rent invoice total before creating "
                    "local billing work."
                ),
                "confidence": 0.86,
            }
        ]


def _looks_like_invoice_text(text: str) -> bool:
    return bool(
        re.search(r"\bTAX\s+INVOICE\b", text, re.IGNORECASE)
        or re.search(r"\bInvoice Number\b", text, re.IGNORECASE)
    )


def _record_list(value: Any) -> list[dict[str, Any]]:
    return value if isinstance(value, list) else []


def _text_list(value: Any) -> list[str]:
    return [str(item) for item in value] if isinstance(value, list) else []


def _append_unique(items: list[str], item: str) -> None:
    if item not in items:
        items.append(item)


def _has_review_label(items: list[dict[str, Any]], label: str) -> bool:
    return any(str(item.get("label") or "").lower() == label.lower() for item in items)


def _first_match(pattern: str, text: str) -> str | None:
    match = re.search(pattern, text, re.IGNORECASE)
    if not match:
        return None
    return " ".join(match.group(1).split())


def _invoice_customer_name(text: str) -> str | None:
    value = _first_match(r"\bCustomer\s+([^\n]+)", text)
    return _trim_invoice_name(value) if value else None


def _invoice_issuer_name(text: str) -> str | None:
    value = _first_match(r"\bTo:\s*([^\n]+)", text) or _first_match(
        r"\bAccount name:\s*([^\n]+)",
        text,
    )
    return _trim_invoice_name(value) if value else None


def _trim_invoice_name(value: str) -> str:
    return re.split(
        r"\s+(?:Amount Enclosed|Invoice Number|ABN|Email|Phone|Customer)\b",
        value,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0].strip()


def _invoice_number(text: str) -> str | None:
    match = re.search(
        r"\bInvoice Number\b[\s\S]{0,160}?\b([A-Z]{2,}-\d+)\b",
        text,
        re.IGNORECASE,
    )
    return match.group(1).upper() if match else None


def _first_invoice_rent_line(text: str) -> str | None:
    match = re.search(r"^Rent\s+-\s+.+$", text, re.IGNORECASE | re.MULTILINE)
    return " ".join(match.group(0).split()) if match else None


def _invoice_property_scope(text: str) -> tuple[str | None, str | None]:
    rent_lines = re.findall(
        r"^Rent\s+-\s+(.+?)\s+1\.00\s+[\d,]+\.\d{2}\s+\d+%\s+[\d,]+\.\d{2}",
        text,
        re.IGNORECASE | re.MULTILINE,
    )
    addresses: list[str] = []
    unit_labels: list[str] = []
    for line in rent_lines:
        match = re.match(r"(?P<unit>U\d+,\s*B\d+)\s+(?P<address>.+)", line.strip())
        if match:
            unit_label = " ".join(match.group("unit").split())
            address = " ".join(match.group("address").split())
            if unit_label not in unit_labels:
                unit_labels.append(unit_label)
            if address not in addresses:
                addresses.append(address)
    if addresses:
        return addresses[0], "; ".join(unit_labels) or None
    return None, None


def _invoice_source_date_after(label: str, text: str) -> str | None:
    match = re.search(
        rf"\b{re.escape(label)}\b[\s\S]{{0,80}}?(\d{{1,2}}\s+[A-Za-z]{{3,9}}\s+\d{{4}})",
        text,
        re.IGNORECASE,
    )
    return " ".join(match.group(1).split()) if match else None


def _invoice_date_after(label: str, text: str) -> str | None:
    raw_date = _invoice_source_date_after(label, text)
    if not raw_date:
        return None
    for date_format in ("%d %b %Y", "%d %B %Y"):
        try:
            return datetime.strptime(raw_date, date_format).date().isoformat()
        except ValueError:
            continue
    return None


def _invoice_money_after(label_pattern: str, text: str) -> float | None:
    match = re.search(
        rf"{label_pattern}\s+([\d,]+\.\d{{2}})",
        text,
        re.IGNORECASE,
    )
    if not match:
        return None
    return float(match.group(1).replace(",", ""))


def _format_invoice_money(amount: float) -> str:
    return f"{amount:,.2f}"
