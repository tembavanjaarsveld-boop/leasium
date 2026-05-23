"""Inbox triage — classify an inbound email/message into a Leasium action.

Tier 3 of the 2026-05-22 UX review (the AI inbox processor, equivalent
to Re-Leased Credia Action). The operator pastes the body of a tenant
or contractor email; the AI returns a structured classification plus a
suggested next step inside Leasium. v1 deliberately stops at suggest —
no records are created automatically. The operator clicks through to
the right surface (Operations, Tenants, Properties) where the existing
review-first workflow takes over.

Guardrails (mirroring Ask Leasium):
- Read-only. The triage helper never writes or sends anything.
- The model must be explicit when it cannot classify confidently — a
  `low_confidence` warning surfaces in the response.
- Personal data in the body is summarised, not echoed verbatim.
"""

from __future__ import annotations

import json
from typing import Any

import httpx

from stewart.ai.lease_intake import _response_output_text
from stewart.core.settings import Settings


class InboxTriageError(RuntimeError):
    """Raised when the inbox triage helper cannot produce a classification."""


INBOX_TRIAGE_GUARDRAILS = [
    (
        "Inbox triage is read-only. It suggests where to take the message"
        " next; it never creates or sends anything on its own."
    ),
    (
        "Low-confidence classifications are flagged so the operator"
        " double-checks before acting."
    ),
]


INBOX_KINDS = [
    "maintenance_request",
    "payment_or_arrears",
    "lease_change",
    "tenant_contact",
    "vendor_or_contractor",
    "general",
    "spam_or_noise",
]


INBOX_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "kind",
        "confidence",
        "summary",
        "suggested_action",
        "suggested_target_kind",
        "suggested_property_id",
        "suggested_tenant_id",
        "suggested_lease_id",
        "key_facts",
        "warnings",
    ],
    "properties": {
        "kind": {"type": "string", "enum": INBOX_KINDS},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "summary": {"type": "string"},
        "suggested_action": {"type": "string"},
        "suggested_target_kind": {
            "type": "string",
            "enum": [
                "maintenance_work_order",
                "arrears_case",
                "tenant",
                "lease",
                "property",
                "smart_intake",
                "none",
            ],
        },
        # Optional record-id matches. The model must return JSON `null` when
        # it can't confidently match the message to one of the records in
        # the supplied entity_index; the router validates any non-null id
        # against the index and silently drops invented ids.
        "suggested_property_id": {"type": ["string", "null"]},
        "suggested_tenant_id": {"type": ["string", "null"]},
        "suggested_lease_id": {"type": ["string", "null"]},
        "key_facts": {
            "type": "array",
            "maxItems": 6,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["label", "value"],
                "properties": {
                    "label": {"type": "string"},
                    "value": {"type": "string"},
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


def triage_inbox(
    *,
    body: str,
    settings: Settings,
    entity_index: dict[str, list[dict[str, Any]]] | None = None,
) -> tuple[dict[str, Any], str | None]:
    """Send the message body to OpenAI and parse the structured response.

    `entity_index` is an optional compact lookup the model can use to match
    the message to an existing record. The router builds this from the
    operator's entity (properties, tenants, active leases) and validates
    any returned id against the same index before exposing it.
    """

    if not settings.openai_api_key:
        raise InboxTriageError(
            "OpenAI API key is not configured. Set OPENAI_API_KEY to enable"
            " inbox triage."
        )

    prompt = (
        "You are the Leasium inbox triage assistant. The operator forwards"
        " an inbound email or message from a tenant, contractor, agent, or"
        " supplier. Your job is to classify the message into one Leasium"
        " action category and suggest the next step inside the platform."
        "\n\nRules:"
        "\n1. Read-only. Never instruct the operator to send a message,"
        " post an invoice, or reconcile a payment. Always route them to a"
        " reviewed Leasium workflow instead."
        "\n2. Pick exactly one `kind` from the enum. If the message is"
        " unclear, use `general` and add a low-confidence warning."
        "\n3. The `summary` is one sentence (max 220 chars) describing"
        " what the sender wants. Do not echo personal contact details"
        " verbatim — paraphrase."
        "\n4. The `suggested_action` is one short imperative sentence"
        " starting with a verb the operator would actually do inside"
        " Leasium (Open, Create draft, Triage, Review, Ignore)."
        "\n5. `suggested_target_kind` picks the surface that maps to"
        " the action: maintenance_work_order, arrears_case, tenant,"
        " lease, property, smart_intake, or none for messages that"
        " shouldn't drive action."
        "\n6. `key_facts` extracts up to 6 short label/value pairs"
        " (sender role, property reference, amount, due date, severity,"
        " etc.) that the operator would want to see at a glance. Keep"
        " values under 80 chars; paraphrase contact details."
        "\n7. Add a warning if you spot anything that suggests fraud,"
        " urgency, legal threat, or a sentence you cannot interpret."
        "\n8. Australian context: dates dd/mm/yyyy in prose, AUD"
        " currency, AU state abbreviations."
        "\n9. If `entity_index` is provided, attempt to match the message"
        " to one of the listed records. Set `suggested_property_id`,"
        " `suggested_tenant_id`, and `suggested_lease_id` to the matching"
        " UUID from the index (copy the id verbatim — never invent one)."
        " If you cannot match with confidence, set the field to null. Do"
        " not guess; an unmatched message is better than a wrong match."
    )

    message_payload: dict[str, Any] = {"message_body": body}
    if entity_index:
        message_payload["entity_index"] = entity_index

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
                "name": "inbox_triage",
                "strict": True,
                "schema": INBOX_SCHEMA,
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
        raise InboxTriageError(
            f"OpenAI inbox triage request failed with status {exc.response.status_code}."
        ) from exc
    except httpx.HTTPError as exc:
        raise InboxTriageError("OpenAI inbox triage request failed.") from exc

    body_json = response.json()
    output_text = _response_output_text(body_json)
    if not output_text:
        raise InboxTriageError(
            "OpenAI response did not include an inbox triage classification."
        )
    try:
        extracted = json.loads(output_text)
    except json.JSONDecodeError as exc:
        raise InboxTriageError(
            "OpenAI inbox triage response was not valid JSON."
        ) from exc
    if not isinstance(extracted, dict):
        raise InboxTriageError(
            "OpenAI inbox triage response had an unexpected shape."
        )

    return (
        extracted,
        body_json.get("id") if isinstance(body_json.get("id"), str) else None,
    )
