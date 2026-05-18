"""OpenAI-backed lease file extraction."""

import base64
import json
from io import BytesIO
from pathlib import Path
from typing import Any

import httpx
from docx import Document
from pypdf import PdfReader

from stewart.core.settings import Settings


class LeaseExtractionError(RuntimeError):
    """Raised when lease extraction cannot complete."""


LEASE_EXTRACTION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["property", "tenancy_unit", "tenant", "lease", "obligations", "warnings"],
    "properties": {
        "property": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "name",
                "street_address",
                "suburb",
                "state",
                "postcode",
                "country_code",
                "property_type",
                "parcel_id",
                "land_sqm",
                "building_sqm",
                "parking_spaces",
            ],
            "properties": {
                "name": {"type": ["string", "null"]},
                "street_address": {"type": ["string", "null"]},
                "suburb": {"type": ["string", "null"]},
                "state": {"type": ["string", "null"]},
                "postcode": {"type": ["string", "null"]},
                "country_code": {"type": ["string", "null"]},
                "property_type": {
                    "type": ["string", "null"],
                    "enum": [
                        "commercial_office",
                        "commercial_retail",
                        "commercial_industrial",
                        "mixed_use",
                        "vacant_land",
                        "childcare",
                        "hospitality",
                        "other",
                        None,
                    ],
                },
                "parcel_id": {"type": ["string", "null"]},
                "land_sqm": {"type": ["number", "null"]},
                "building_sqm": {"type": ["number", "null"]},
                "parking_spaces": {"type": ["integer", "null"]},
            },
        },
        "tenancy_unit": {
            "type": "object",
            "additionalProperties": False,
            "required": ["unit_label", "sqm", "parking_spaces"],
            "properties": {
                "unit_label": {"type": ["string", "null"]},
                "sqm": {"type": ["number", "null"]},
                "parking_spaces": {"type": ["integer", "null"]},
            },
        },
        "tenant": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "legal_name",
                "trading_name",
                "abn",
                "contact_name",
                "contact_email",
                "contact_phone",
                "billing_email",
            ],
            "properties": {
                "legal_name": {"type": ["string", "null"]},
                "trading_name": {"type": ["string", "null"]},
                "abn": {"type": ["string", "null"]},
                "contact_name": {"type": ["string", "null"]},
                "contact_email": {"type": ["string", "null"]},
                "contact_phone": {"type": ["string", "null"]},
                "billing_email": {"type": ["string", "null"]},
            },
        },
        "lease": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "status",
                "commencement_date",
                "expiry_date",
                "annual_rent_cents",
                "rent_frequency",
                "outgoings_recoverable",
                "next_review_date",
                "option_summary",
                "security_summary",
                "notes",
            ],
            "properties": {
                "status": {
                    "type": ["string", "null"],
                    "enum": ["pending", "active", "holding_over", "expired", "terminated", None],
                },
                "commencement_date": {"type": ["string", "null"]},
                "expiry_date": {"type": ["string", "null"]},
                "annual_rent_cents": {"type": ["integer", "null"]},
                "rent_frequency": {
                    "type": ["string", "null"],
                    "enum": ["weekly", "monthly", "quarterly", "annual", None],
                },
                "outgoings_recoverable": {"type": ["boolean", "null"]},
                "next_review_date": {"type": ["string", "null"]},
                "option_summary": {"type": ["string", "null"]},
                "security_summary": {"type": ["string", "null"]},
                "notes": {"type": ["string", "null"]},
            },
        },
        "obligations": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["title", "category", "due_date", "priority", "owner_role", "notes"],
                "properties": {
                    "title": {"type": ["string", "null"]},
                    "category": {
                        "type": ["string", "null"],
                        "enum": [
                            "lease_expiry",
                            "rent_review",
                            "option_notice",
                            "insurance",
                            "bank_guarantee",
                            "make_good",
                            "compliance",
                            "maintenance",
                            "other",
                            None,
                        ],
                    },
                    "due_date": {"type": ["string", "null"]},
                    "priority": {"type": ["integer", "null"], "minimum": 1, "maximum": 3},
                    "owner_role": {
                        "type": ["string", "null"],
                        "enum": ["owner", "admin", "finance", "ops", "viewer", "agent", None],
                    },
                    "notes": {"type": ["string", "null"]},
                },
            },
        },
        "warnings": {"type": "array", "items": {"type": "string"}},
    },
}


def extract_lease_file(
    *,
    file_data: bytes,
    filename: str,
    content_type: str | None,
    settings: Settings,
) -> tuple[dict[str, Any], str | None]:
    """Extract lease register data from an uploaded file using OpenAI Responses."""

    if not settings.openai_api_key:
        raise LeaseExtractionError("OpenAI API key is not configured.")

    prompt = (
        "Extract commercial lease setup data from this Australian lease file. "
        "Use only facts present in the file. Return null for missing fields. "
        "Use ISO dates, integer cents for money, and concise notes."
    )
    content: list[dict[str, str]] = [{"type": "input_text", "text": prompt}]
    extracted_text = _extract_document_text(file_data, filename, content_type)
    if extracted_text:
        content.append({"type": "input_text", "text": f"Lease text:\n{extracted_text[:120000]}"})
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
        "input": [
            {
                "role": "user",
                "content": content,
            }
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "lease_intake_extraction",
                "strict": True,
                "schema": LEASE_EXTRACTION_SCHEMA,
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
        raise LeaseExtractionError(
            f"OpenAI extraction request failed with status {exc.response.status_code}."
        ) from exc
    except httpx.HTTPError as exc:
        raise LeaseExtractionError("OpenAI extraction request failed.") from exc

    body = response.json()
    output_text = _response_output_text(body)
    if not output_text:
        raise LeaseExtractionError("OpenAI response did not include extracted JSON.")
    try:
        extracted = json.loads(output_text)
    except json.JSONDecodeError as exc:
        raise LeaseExtractionError("OpenAI response was not valid JSON.") from exc
    if not isinstance(extracted, dict):
        raise LeaseExtractionError("OpenAI extraction returned an unexpected shape.")
    return extracted, body.get("id")


def _extract_document_text(file_data: bytes, filename: str, content_type: str | None) -> str | None:
    suffix = Path(filename).suffix.lower()
    if (content_type and content_type.startswith("text/")) or suffix in {".txt", ".md"}:
        return _clean_extracted_text(file_data.decode("utf-8", errors="ignore"))
    if suffix == ".pdf" or content_type == "application/pdf":
        try:
            reader = PdfReader(BytesIO(file_data))
            pages: list[str] = []
            for page in reader.pages:
                try:
                    text = page.extract_text(extraction_mode="layout") or ""
                except TypeError:
                    text = page.extract_text() or ""
                pages.append(text)
            return _clean_extracted_text("\n\n".join(pages))
        except Exception as exc:
            raise LeaseExtractionError("PDF text could not be read.") from exc
    if suffix == ".docx":
        try:
            doc = Document(BytesIO(file_data))
            return _clean_extracted_text("\n".join(paragraph.text for paragraph in doc.paragraphs))
        except Exception as exc:
            raise LeaseExtractionError("Word document text could not be read.") from exc
    return None


def _clean_extracted_text(text: str) -> str | None:
    lines = [" ".join(line.split()) for line in text.splitlines()]
    cleaned_lines: list[str] = []
    previous_blank = False
    for line in lines:
        if not line:
            if not previous_blank:
                cleaned_lines.append("")
            previous_blank = True
            continue
        cleaned_lines.append(line)
        previous_blank = False
    cleaned = "\n".join(cleaned_lines).strip()
    return cleaned or None


def _response_output_text(body: dict[str, Any]) -> str | None:
    output_text = body.get("output_text")
    if isinstance(output_text, str):
        return output_text

    for item in body.get("output", []):
        if not isinstance(item, dict):
            continue
        for content in item.get("content", []):
            if not isinstance(content, dict):
                continue
            text = content.get("text")
            if content.get("type") == "output_text" and isinstance(text, str):
                return text
    return None
