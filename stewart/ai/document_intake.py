"""OpenAI-backed generic document intake extraction."""

import base64
import json
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
        "obligations",
        "suggested_links",
        "warnings",
        "missing_information",
        "proposed_actions",
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
                "required": ["name", "role", "abn", "contact", "confidence", "source_hint"],
                "properties": {
                    "name": {"type": ["string", "null"]},
                    "role": {"type": ["string", "null"]},
                    "abn": {"type": ["string", "null"]},
                    "contact": {"type": ["string", "null"]},
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
                "required": ["name", "address", "unit_label", "confidence", "source_hint"],
                "properties": {
                    "name": {"type": ["string", "null"]},
                    "address": {"type": ["string", "null"]},
                    "unit_label": {"type": ["string", "null"]},
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
        "key dates, money, obligations, warnings, missing information, and proposed "
        "actions. Use ISO dates where possible and mark uncertainty with lower "
        "confidence and warnings."
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
    return _normalise_extracted_document(extracted, filename), body.get("id")


def _normalise_extracted_document(extracted: dict[str, Any], filename: str) -> dict[str, Any]:
    document_type = str(extracted.get("document_type") or "unknown")
    if document_type not in {
        "lease",
        "tenant_document",
        "invoice_admin",
        "insurance_certificate",
        "bank_guarantee",
        "purchase_contract",
        "compliance",
        "notice",
        "unknown",
    }:
        document_type = "unknown"
    summary = str(extracted.get("summary") or f"Review {Path(filename).stem}.").strip()
    extracted["document_type"] = document_type
    extracted["summary"] = summary
    return extracted
