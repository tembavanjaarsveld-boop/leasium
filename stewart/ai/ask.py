"""Ask Leasium — read-only Q&A over an operator's entity context.

This is the v1 of the Tier 2 (e) "Ask Leasium" surface from the 2026-05-22
UX review. The goal is for an operator to type a natural-language question
about their portfolio ("When does the Acme lease expire?", "Which
properties are vacant?", "What maintenance is open with no contractor?")
and get an answer with citations back to the source records.

Guardrails:
- Read-only. No provider mutations (no Xero write, no SendGrid send,
  no Twilio SMS, no payment reconciliation).
- Citations are required for every factual claim.
- The LLM is told to say "I don't have that information" rather than
  guess when context is missing.
- Context is bounded so prompt size stays predictable. Large portfolios
  use summary aggregates rather than per-record dumps.
"""

from __future__ import annotations

import json
from typing import Any

import httpx

from stewart.ai.lease_intake import _response_output_text
from stewart.core.settings import Settings


class AskError(RuntimeError):
    """Raised when the Ask Leasium helper cannot produce an answer."""


ASK_GUARDRAILS = [
    "Ask Leasium is read-only. It does not change records or send provider messages.",
    "Every factual claim must include a citation. The model is instructed to refuse to guess when context is missing.",
]


ASK_RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["answer", "citations", "warnings"],
    "properties": {
        "answer": {"type": "string"},
        "citations": {
            "type": "array",
            "maxItems": 12,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["kind", "target_id", "label"],
                "properties": {
                    "kind": {
                        "type": "string",
                        "enum": [
                            "property",
                            "lease",
                            "tenant",
                            "obligation",
                            "maintenance_work_order",
                            "arrears_case",
                        ],
                    },
                    "target_id": {"type": "string"},
                    "label": {"type": "string"},
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


def ask_leasium(
    *,
    question: str,
    context: dict[str, Any],
    settings: Settings,
) -> tuple[dict[str, Any], str | None]:
    """Call OpenAI with the operator's entity context + their question.

    Returns the parsed response dict (answer + citations + warnings) and
    the OpenAI response id (handy for debugging when an answer feels off).
    """

    if not settings.openai_api_key:
        raise AskError(
            "OpenAI API key is not configured. Set OPENAI_API_KEY to enable"
            " Ask Leasium."
        )

    prompt = (
        "You are Ask Leasium — an operator-only assistant for an Australian"
        " commercial lease management platform. You answer questions about the"
        " operator's own portfolio strictly from the provided context."
        "\n\nRules:"
        "\n1. Read-only. Never instruct the operator to send a message, post"
        " an invoice, reconcile a payment, or mutate any external provider."
        " If the operator asks for an action, explain that they need to use"
        " the reviewed workflow inside Leasium."
        "\n2. Every factual claim must reference a citation: a property,"
        " lease, tenant, obligation, maintenance work order, or arrears case"
        " from the supplied context. Use the record's id as target_id."
        "\n3. If the answer is not in the context, say so plainly and add a"
        " warning. Do not guess dates, amounts, or names."
        "\n4. Australian context: dates are dd/mm/yyyy when formatting prose"
        " (but iso dates in citations); currency is AUD; states are AU"
        " abbreviations (QLD, NSW, etc.)."
        "\n5. Be brief. One short paragraph plus a list when listing items."
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
                            {
                                "question": question,
                                "context": context,
                            },
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
                "name": "ask_leasium_answer",
                "strict": True,
                "schema": ASK_RESPONSE_SCHEMA,
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
        raise AskError(
            f"OpenAI Ask Leasium request failed with status {exc.response.status_code}."
        ) from exc
    except httpx.HTTPError as exc:
        raise AskError("OpenAI Ask Leasium request failed.") from exc

    body = response.json()
    output_text = _response_output_text(body)
    if not output_text:
        raise AskError("OpenAI response did not include an Ask Leasium answer.")
    try:
        extracted = json.loads(output_text)
    except json.JSONDecodeError as exc:
        raise AskError("OpenAI Ask Leasium response was not valid JSON.") from exc
    if not isinstance(extracted, dict):
        raise AskError("OpenAI Ask Leasium response had an unexpected shape.")

    return extracted, body.get("id") if isinstance(body.get("id"), str) else None
