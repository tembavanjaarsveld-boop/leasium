"""Tenant-contact extractor for the AI inbox v2.3 promote path.

The inbox triage classifier identifies messages where a tenant is telling
the operator about changed contact details. This extractor drafts only the
contact fields the operator can review before applying them to the Tenant
record.

Design notes:
- Read-only. The extractor never persists data or sends messages.
- It only proposes existing Tenant contact fields. Legal/trading names are
  deliberately out of scope because changing the legal party from an email
  is higher risk than updating day-to-day contact details.
- Empty fields are better than guesses. The caller only applies fields the
  operator explicitly ticks.
"""

from __future__ import annotations

import json
from typing import Any

import httpx

from stewart.ai.lease_intake import _response_output_text
from stewart.core.settings import Settings


class TenantContactError(RuntimeError):
    """Raised when tenant-contact extraction cannot produce a result."""


TENANT_CONTACT_GUARDRAILS = [
    (
        "Tenant-contact extraction is read-only. It proposes contact-detail"
        " changes for operator review; it does not email tenants or change"
        " records by itself."
    ),
    (
        "Only contact name, contact email, contact phone, and billing email"
        " are in scope. Legal tenant identity changes stay out of this flow."
    ),
]


TENANT_CONTACT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "summary",
        "confidence",
        "contact_name",
        "contact_email",
        "contact_phone",
        "billing_email",
        "warnings",
    ],
    "properties": {
        "summary": {"type": "string"},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "contact_name": {"type": ["string", "null"]},
        "contact_email": {"type": ["string", "null"]},
        "contact_phone": {"type": ["string", "null"]},
        "billing_email": {"type": ["string", "null"]},
        "warnings": {
            "type": "array",
            "maxItems": 6,
            "items": {"type": "string"},
        },
    },
}


def extract_tenant_contact(
    *,
    body: str,
    settings: Settings,
    tenant_snapshot: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], str | None]:
    """Extract proposed tenant contact updates from a pasted message body."""

    if not settings.openai_api_key:
        raise TenantContactError(
            "OpenAI API key is not configured. Set OPENAI_API_KEY to enable"
            " tenant contact extraction."
        )

    prompt = (
        "You are the Relby tenant contact-update assistant. The operator"
        " forwards a tenant message that may contain updated contact"
        " details. Extract only the contact fields the operator can review"
        " before applying to the Tenant record."
        "\n\nRules:"
        "\n1. Read-only. Do not draft replies, send messages, or mutate"
        " records."
        "\n2. Extract only these fields when explicitly present:"
        " contact_name, contact_email, contact_phone, billing_email."
        "\n3. Do not infer legal_name, trading_name, ABN, or lease terms."
        "\n4. Use null for fields not clearly present. Do not invent."
        "\n5. If the tenant says billing should use the same email as the"
        " main contact, set both contact_email and billing_email to that"
        " visible email."
        "\n6. `summary` is one short sentence describing the requested"
        " update. Paraphrase rather than copying the message."
        "\n7. Add warnings for ambiguity, unverified third-party requests,"
        " conflicting details, or requests that look like legal identity"
        " changes rather than contact updates."
        "\n8. Australian context for phone formatting, but preserve the"
        " visible number rather than normalising aggressively."
    )

    message_payload: dict[str, Any] = {"message_body": body}
    if tenant_snapshot:
        message_payload["current_tenant"] = tenant_snapshot

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
                            message_payload,
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
                "name": "tenant_contact_update",
                "strict": True,
                "schema": TENANT_CONTACT_SCHEMA,
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
        raise TenantContactError(
            "OpenAI tenant-contact request failed with status"
            f" {exc.response.status_code}."
        ) from exc
    except httpx.HTTPError as exc:
        raise TenantContactError("OpenAI tenant-contact request failed.") from exc

    body_json = response.json()
    output_text = _response_output_text(body_json)
    if not output_text:
        raise TenantContactError(
            "OpenAI response did not include a tenant contact extraction."
        )
    try:
        extracted = json.loads(output_text)
    except json.JSONDecodeError as exc:
        raise TenantContactError(
            "OpenAI tenant-contact response was not valid JSON."
        ) from exc
    if not isinstance(extracted, dict):
        raise TenantContactError(
            "OpenAI tenant-contact response had an unexpected shape."
        )

    return (
        extracted,
        body_json.get("id") if isinstance(body_json.get("id"), str) else None,
    )
