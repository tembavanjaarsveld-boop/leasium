"""OpenAI-backed public enrichment suggestions for missing register fields."""

import json
from typing import Any

import httpx

from stewart.ai.lease_intake import _response_output_text
from stewart.core.settings import Settings


class PublicEnrichmentError(RuntimeError):
    """Raised when public enrichment suggestions cannot be generated."""


PUBLIC_ENRICHMENT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["suggestions", "warnings"],
    "properties": {
        "suggestions": {
            "type": "array",
            "maxItems": 8,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "field",
                    "value",
                    "source_hint",
                    "source_url",
                    "citation",
                    "confidence",
                    "notes",
                ],
                "properties": {
                    "field": {"type": "string"},
                    "value": {"type": "string"},
                    "source_hint": {"type": "string"},
                    "source_url": {"type": ["string", "null"]},
                    "citation": {"type": "string"},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "notes": {"type": ["string", "null"]},
                },
            },
        },
        "warnings": {"type": "array", "items": {"type": "string"}, "maxItems": 8},
    },
}


def suggest_public_enrichment(
    *,
    target_type: str,
    target_context: dict[str, Any],
    missing_fields: list[str],
    settings: Settings,
) -> tuple[dict[str, Any], str | None]:
    """Search public sources and suggest values for missing safe fields."""

    if not settings.openai_api_key:
        raise PublicEnrichmentError("OpenAI API key is not configured.")
    if not missing_fields:
        return {"suggestions": [], "warnings": []}, None

    prompt = (
        "Find safe public facts for an Australian property operations register. "
        "Use trusted public sources only, preferring ABN Lookup or official registers for "
        "ABNs, registered business names, and registered addresses, and Australia Post or "
        "government/official address sources for suburb, state, and postcode. "
        "Suggest only fields listed in missing_fields. Do not suggest private contact, "
        "banking, billing, tax advice, or inferred values. Omit any field that cannot be "
        "supported by a citation. Return concise citations and confidence."
    )
    content = [
        {"type": "input_text", "text": prompt},
        {
            "type": "input_text",
            "text": json.dumps(
                {
                    "target_type": target_type,
                    "target_context": target_context,
                    "missing_fields": missing_fields,
                },
                sort_keys=True,
            ),
        },
    ]
    payload: dict[str, Any] = {
        "model": settings.openai_model,
        "input": [{"role": "user", "content": content}],
        "tools": [{"type": "web_search_preview"}],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "public_enrichment_suggestions",
                "strict": True,
                "schema": PUBLIC_ENRICHMENT_SCHEMA,
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
        raise PublicEnrichmentError(
            f"OpenAI enrichment request failed with status {exc.response.status_code}."
        ) from exc
    except httpx.HTTPError as exc:
        raise PublicEnrichmentError("OpenAI enrichment request failed.") from exc

    body = response.json()
    output_text = _response_output_text(body)
    if not output_text:
        raise PublicEnrichmentError("OpenAI response did not include enrichment JSON.")
    try:
        extracted = json.loads(output_text)
    except json.JSONDecodeError as exc:
        raise PublicEnrichmentError("OpenAI enrichment response was not valid JSON.") from exc
    if not isinstance(extracted, dict):
        raise PublicEnrichmentError("OpenAI enrichment returned an unexpected shape.")
    return extracted, body.get("id")
