"""Vendor/contractor intake extractor for the AI inbox v2.2 promote path.

The inbox-triage classifier identifies a message as `vendor_or_contractor`
and the operator approves promoting it. When the message is from a vendor
who is NOT already in the contractor directory, this extractor pulls the
draft directory fields (name, company, email, phone, categories, notes)
from the pasted body so the promote endpoint can create a new Contractor
row at priority=3 (backup) for the operator to review and activate.

Design notes:
- Output keys match the `Contractor` model so the caller can spread the
  result onto a `Contractor(...)` constructor with minimal munging.
- Categories drawn from `MAINTENANCE_CATEGORIES` so the contractor row
  joins cleanly with the existing maintenance-categoriser dispatch flow.
- Strict-JSON; the model can return null/empty when the message is
  ambiguous. The caller falls back to a minimal Contractor with name
  derived from the triage summary when the extractor raises.
- Read-only. The extractor itself never persists anything.
"""

from __future__ import annotations

import json
from typing import Any

import httpx

from stewart.ai.lease_intake import _response_output_text
from stewart.ai.maintenance import MAINTENANCE_CATEGORIES
from stewart.core.settings import Settings


class VendorIntakeError(RuntimeError):
    """Raised when the vendor-intake extractor cannot produce a result."""


VENDOR_INTAKE_GUARDRAILS = [
    (
        "Vendor intake is read-only. It drafts the directory entry for"
        " operator review; it does not dispatch work, send messages, or"
        " confirm engagements."
    ),
    (
        "Categories are limited to the existing maintenance category"
        " enum so the new contractor joins cleanly with downstream"
        " dispatch logic."
    ),
]


VENDOR_INTAKE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "name",
        "company_name",
        "email",
        "phone",
        "categories",
        "notes",
        "confidence",
        "warnings",
    ],
    "properties": {
        "name": {"type": ["string", "null"]},
        "company_name": {"type": ["string", "null"]},
        "email": {"type": ["string", "null"]},
        "phone": {"type": ["string", "null"]},
        "categories": {
            "type": "array",
            "maxItems": 4,
            "items": {"type": "string", "enum": MAINTENANCE_CATEGORIES},
        },
        "notes": {"type": ["string", "null"]},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "warnings": {
            "type": "array",
            "maxItems": 6,
            "items": {"type": "string"},
        },
    },
}


def extract_vendor_intake(
    *,
    body: str,
    settings: Settings,
) -> tuple[dict[str, Any], str | None]:
    """Extract draft contractor-directory fields from a vendor's message."""

    if not settings.openai_api_key:
        raise VendorIntakeError(
            "OpenAI API key is not configured. Set OPENAI_API_KEY to enable"
            " vendor intake."
        )

    prompt = (
        "You are the Relby vendor intake assistant. The operator forwards"
        " a message from a contractor or vendor who is not yet in the"
        " Relby directory. Extract the directory fields needed to"
        " register them as a draft contractor for the operator to review."
        "\n\nRules:"
        "\n1. Read-only. Do not draft a reply, confirm an engagement, or"
        " suggest dispatching work."
        "\n2. `name` is the person's name (or a sensible label if the"
        " message only signs off with a company)."
        "\n3. `company_name` is the trading entity, if mentioned."
        "\n4. `email` and `phone` are the contact details visible in the"
        " message. Use null when not present — do not invent."
        "\n5. `categories` is a short list (0-3) from the fixed enum:"
        " electrical, plumbing, hvac, locks, structural, appliance,"
        " cleaning, pest, urgent, other. Pick `other` when the vendor's"
        " trade isn't in the list."
        "\n6. `notes` is one short paraphrase (max 200 chars) of what"
        " the vendor offers or is asking about. Paraphrase — do not"
        " echo personal details verbatim."
        "\n7. `confidence` is your overall confidence the message is a"
        " genuine vendor self-introduction or follow-up. Lower when the"
        " message is ambiguous."
        "\n8. Add warnings for anything suspicious (spam-like, missing"
        " ABN, vague pricing claims, etc.)."
        "\n9. Australian context."
    )

    payload: dict[str, Any] = {
        "model": settings.openai_model,
        "input": [
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    {
                        "type": "input_text",
                        "text": json.dumps(
                            {"message_body": body},
                            default=str,
                            sort_keys=True,
                        ),
                    },
                ],
            }
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "vendor_intake",
                "strict": True,
                "schema": VENDOR_INTAKE_SCHEMA,
            }
        },
    }

    try:
        with httpx.Client(timeout=60.0) as client:
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
        raise VendorIntakeError(
            f"OpenAI vendor intake request failed with status {exc.response.status_code}."
        ) from exc
    except httpx.HTTPError as exc:
        raise VendorIntakeError("OpenAI vendor intake request failed.") from exc

    body_json = response.json()
    output_text = _response_output_text(body_json)
    if not output_text:
        raise VendorIntakeError(
            "OpenAI response did not include a vendor intake extraction."
        )
    try:
        extracted = json.loads(output_text)
    except json.JSONDecodeError as exc:
        raise VendorIntakeError(
            "OpenAI vendor intake response was not valid JSON."
        ) from exc
    if not isinstance(extracted, dict):
        raise VendorIntakeError(
            "OpenAI vendor intake response had an unexpected shape."
        )

    return (
        extracted,
        body_json.get("id") if isinstance(body_json.get("id"), str) else None,
    )
