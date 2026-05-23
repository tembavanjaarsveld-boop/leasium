"""Maintenance work-order categoriser.

Classifies a maintenance work-order description into a trade subcategory
(electrical / plumbing / hvac / locks / structural / appliance / cleaning
/ pest / urgent / other) so the operator surface can suggest a contractor
from the directory.

Different shape from `stewart/ai/inbox.py` even though both call OpenAI:
the inbox triage classifies a *topic* (is this maintenance? payment?
spam?). This classifier assumes the work order is already maintenance and
narrows it to a *trade subcategory*. The two are complementary; this one
exists because the inbox kinds are too generic to drive contractor
matching.

Guardrails (mirroring the rest of the AI stack):
- Read-only. The categoriser never writes or sends anything.
- Low-confidence classifications are flagged in the response.
- Personal data in the description is summarised, not echoed verbatim.
- Returns a dict whose keys are validated against MAINTENANCE_CATEGORIES;
  the caller is expected to soft-fail if the call errors or the API key
  is missing rather than treating this as load-bearing.
"""

from __future__ import annotations

import json
from typing import Any

import httpx

from stewart.ai.lease_intake import _response_output_text
from stewart.core.settings import Settings


class MaintenanceCategoriseError(RuntimeError):
    """Raised when the maintenance categoriser cannot produce a result."""


# Keep aligned with apps/web/src/lib/api.ts CONTRACTOR_CATEGORIES so
# the classifier output maps directly onto contractor.categories rows.
MAINTENANCE_CATEGORIES = [
    "electrical",
    "plumbing",
    "hvac",
    "locks",
    "structural",
    "appliance",
    "cleaning",
    "pest",
    "urgent",
    "other",
]


MAINTENANCE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "category",
        "confidence",
        "summary",
        "is_urgent",
        "warnings",
    ],
    "properties": {
        "category": {"type": "string", "enum": MAINTENANCE_CATEGORIES},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "summary": {"type": "string"},
        "is_urgent": {"type": "boolean"},
        "warnings": {
            "type": "array",
            "maxItems": 6,
            "items": {"type": "string"},
        },
    },
}


def categorise_maintenance(
    *,
    title: str,
    description: str | None,
    settings: Settings,
) -> tuple[dict[str, Any], str | None]:
    """Send the work-order title + description to OpenAI and parse the result.

    Returns (parsed_result, response_id). Caller is responsible for
    catching :class:`MaintenanceCategoriseError` and falling back to
    "no classification" so the work order still exists with an empty
    `ai_classification` metadata block.
    """

    if not settings.openai_api_key:
        raise MaintenanceCategoriseError(
            "OpenAI API key is not configured. Set OPENAI_API_KEY to enable"
            " maintenance categorisation."
        )

    prompt = (
        "You are the Leasium maintenance categoriser. The operator just"
        " created a maintenance work order. Your job is to classify the"
        " work into one trade category so the platform can suggest a"
        " contractor from the operator's directory."
        "\n\nRules:"
        "\n1. Read-only. Never instruct the operator to dispatch, pay, or"
        " send a message. The operator approves a contractor in the UI."
        "\n2. Pick exactly one `category` from the enum. If a job blends"
        " multiple trades (e.g. plumber + electrician for a leaking hot"
        " water service), pick the primary trade and mention the second"
        " in `summary`."
        "\n3. Use `urgent` as the category only for safety-critical or"
        " habitability-affecting issues (active leak, no power, no hot"
        " water in winter, broken lock on entry door). Routine repairs"
        " stay in their normal trade category and `is_urgent` can still"
        " be true if the operator should schedule fast."
        "\n4. `summary` is one sentence (max 200 chars) describing what"
        " needs to be done. Paraphrase tenant contact details — don't"
        " quote them verbatim."
        "\n5. `is_urgent` is a separate boolean — most jobs are not."
        " Reserve it for issues that need same-day action."
        "\n6. Add a warning if the description is ambiguous, mentions a"
        " safety risk, references a date you cannot verify, or smells"
        " like spam / wrong surface (not actually maintenance)."
        "\n7. Australian context: AUD currency, AU state abbreviations,"
        " AU electrical / plumbing standards apply."
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
                                "title": title,
                                "description": description or "",
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
                "name": "maintenance_category",
                "strict": True,
                "schema": MAINTENANCE_SCHEMA,
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
        raise MaintenanceCategoriseError(
            f"OpenAI maintenance categorise request failed with status {exc.response.status_code}."
        ) from exc
    except httpx.HTTPError as exc:
        raise MaintenanceCategoriseError(
            "OpenAI maintenance categorise request failed."
        ) from exc

    body_json = response.json()
    output_text = _response_output_text(body_json)
    if not output_text:
        raise MaintenanceCategoriseError(
            "OpenAI response did not include a maintenance categorisation."
        )
    try:
        extracted = json.loads(output_text)
    except json.JSONDecodeError as exc:
        raise MaintenanceCategoriseError(
            "OpenAI maintenance categorise response was not valid JSON."
        ) from exc
    if not isinstance(extracted, dict):
        raise MaintenanceCategoriseError(
            "OpenAI maintenance categorise response was not a JSON object."
        )

    raw_category = extracted.get("category")
    if not isinstance(raw_category, str) or raw_category not in MAINTENANCE_CATEGORIES:
        # Defensive — even with strict schema, surface the failure clearly.
        raise MaintenanceCategoriseError(
            "OpenAI maintenance categorise response had an invalid category."
        )

    response_id = body_json.get("id") if isinstance(body_json, dict) else None
    return extracted, response_id
