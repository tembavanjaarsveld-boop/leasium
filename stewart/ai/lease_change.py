"""Lease-change extractor for the AI inbox v2 promote path.

The inbox-triage classifier (`stewart/ai/inbox.py`) identifies a message as
a `lease_change` and the operator approves promoting it. v2.0 just created
an empty `DocumentIntake` row backed by a synthetic text/plain document so
the operator could open `/intake` and start from scratch. v2.1 runs this
extractor at promote time and pre-fills the intake's `extracted_data` with
the proposed change (new expiry, new rent, party, etc.) so the operator
reviews a populated draft instead of typing it in.

Design notes:
- Output shape mirrors the existing `DocumentIntakeExtraction` keys that
  the Smart Intake review UI already renders (parties / properties /
  key_dates / money_amounts / proposed_actions / summary / warnings). No
  new groups; no frontend change.
- Strict-JSON schema; the model can return `null` for any field it
  cannot extract — better to leave blank than to invent.
- Read-only. The extractor never sends or persists anything; the caller
  decides what to do with the JSON.
- Soft-fail in the caller: if `OPENAI_API_KEY` is unset or the call
  errors, the caller falls back to v2.0 behaviour (empty intake) with a
  warning rather than 5xx-ing the whole promote action.
"""

from __future__ import annotations

import json
from typing import Any

import httpx

from stewart.ai.lease_intake import _response_output_text
from stewart.core.settings import Settings


class LeaseChangeError(RuntimeError):
    """Raised when the lease-change extractor cannot produce a result."""


LEASE_CHANGE_GUARDRAILS = [
    (
        "Lease-change extraction is read-only. It drafts the proposed"
        " change for operator review; it does not modify lease records."
    ),
    (
        "Empty fields are better than guesses — anything the model cannot"
        " confidently extract is left null for the operator to fill in."
    ),
]


LEASE_CHANGE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "summary",
        "confidence",
        "parties",
        "properties",
        "key_dates",
        "money_amounts",
        "proposed_actions",
        "warnings",
    ],
    "properties": {
        "summary": {"type": "string"},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "parties": {
            "type": "array",
            "maxItems": 4,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "role", "contact"],
                "properties": {
                    "name": {"type": ["string", "null"]},
                    "role": {"type": ["string", "null"]},
                    "contact": {"type": ["string", "null"]},
                },
            },
        },
        "properties": {
            "type": "array",
            "maxItems": 4,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "address", "unit_label"],
                "properties": {
                    "name": {"type": ["string", "null"]},
                    "address": {"type": ["string", "null"]},
                    "unit_label": {"type": ["string", "null"]},
                },
            },
        },
        "key_dates": {
            "type": "array",
            "maxItems": 6,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["label", "date", "source_hint"],
                "properties": {
                    "label": {"type": "string"},
                    "date": {"type": ["string", "null"]},
                    "source_hint": {"type": ["string", "null"]},
                },
            },
        },
        "money_amounts": {
            "type": "array",
            "maxItems": 6,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["label", "amount", "currency", "frequency"],
                "properties": {
                    "label": {"type": "string"},
                    "amount": {"type": ["number", "null"]},
                    "currency": {"type": ["string", "null"]},
                    "frequency": {"type": ["string", "null"]},
                },
            },
        },
        "proposed_actions": {
            "type": "array",
            "maxItems": 4,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["title", "detail"],
                "properties": {
                    "title": {"type": "string"},
                    "detail": {"type": ["string", "null"]},
                },
            },
        },
        "warnings": {
            "type": "array",
            "maxItems": 6,
            "items": {"type": "string"},
        },
    },
}


def extract_lease_change(
    *,
    body: str,
    settings: Settings,
    lease_snapshot: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], str | None]:
    """Extract proposed lease-change facts from a pasted message body.

    `lease_snapshot` is an optional compact view of the lease the operator
    matched against in promote (current rent, current expiry, etc.). When
    provided, the model can phrase the proposed change as a delta from
    what's already on file rather than reproducing absolute values.
    """

    if not settings.openai_api_key:
        raise LeaseChangeError(
            "OpenAI API key is not configured. Set OPENAI_API_KEY to enable"
            " lease-change extraction."
        )

    prompt = (
        "You are the Leasium lease-change extraction assistant. The operator"
        " forwards an inbound message describing a proposed change to an"
        " existing lease (extension, renewal, rent variation, early"
        " termination, surrender, hold-over, option exercise, etc.). Your"
        " job is to extract the proposed change as structured JSON so the"
        " operator can review it inside Smart Intake."
        "\n\nRules:"
        "\n1. Read-only. Do not draft any reply, dispatch any notice, or"
        " suggest provider actions. The operator approves every step from"
        " inside Smart Intake."
        "\n2. Use the existing Smart Intake field groups: parties,"
        " properties, key_dates, money_amounts, proposed_actions. Leave"
        " fields null rather than guessing when the message is ambiguous."
        "\n3. `key_dates` should include the proposed effective date and"
        " (if mentioned) the current expiry the change references. Use"
        " ISO yyyy-mm-dd."
        "\n4. `money_amounts` should include the proposed new rent and"
        " (if mentioned) the current rent. `amount` is the numeric figure"
        " in major units (dollars, not cents); `currency` is the ISO code"
        " (\"AUD\" by default for Australian context)."
        "\n5. `proposed_actions` is a short list (typically 1-2) of"
        " imperative-voice proposals like \"Extend lease by 12 months\""
        " or \"Reduce rent by 5%\". The operator approves these inside"
        " Smart Intake."
        "\n6. `summary` is one sentence (max 220 chars) describing what"
        " the sender is asking for. Paraphrase — do not echo personal"
        " contact details verbatim."
        "\n7. Add a warning if the message is ambiguous, references"
        " specific clauses the operator should re-read, or implies a"
        " legal/compliance issue."
        "\n8. Australian context: dates dd/mm/yyyy in prose, AUD currency,"
        " AU state abbreviations."
    )

    message_payload: dict[str, Any] = {"message_body": body}
    if lease_snapshot:
        message_payload["lease_snapshot"] = lease_snapshot

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
                "name": "lease_change_extraction",
                "strict": True,
                "schema": LEASE_CHANGE_SCHEMA,
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
        raise LeaseChangeError(
            f"OpenAI lease-change request failed with status {exc.response.status_code}."
        ) from exc
    except httpx.HTTPError as exc:
        raise LeaseChangeError("OpenAI lease-change request failed.") from exc

    body_json = response.json()
    output_text = _response_output_text(body_json)
    if not output_text:
        raise LeaseChangeError(
            "OpenAI response did not include a lease-change extraction."
        )
    try:
        extracted = json.loads(output_text)
    except json.JSONDecodeError as exc:
        raise LeaseChangeError(
            "OpenAI lease-change response was not valid JSON."
        ) from exc
    if not isinstance(extracted, dict):
        raise LeaseChangeError(
            "OpenAI lease-change response had an unexpected shape."
        )

    return (
        extracted,
        body_json.get("id") if isinstance(body_json.get("id"), str) else None,
    )
