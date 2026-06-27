"""Deterministic Smart Intake candidate scoring.

This module is intentionally provider- and AI-free. It scores already-extracted
review data against existing register records using normalised string matching.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any
from uuid import UUID

AUTO_MATCH_THRESHOLD = 0.9
DUPLICATE_THRESHOLD = 0.75


@dataclass(frozen=True)
class PropertyCandidate:
    property_id: UUID
    score: float
    reason: str


@dataclass(frozen=True)
class TenantCandidate:
    tenant_id: UUID
    score: float
    reason: str


_UNIT_TOKEN_RE = re.compile(
    r"\b(?:unit|u|suite|ste|shop|tenancy|lot|level|lvl)\s*\.?\s*\d+[a-z]?\b",
    re.IGNORECASE,
)
_LEADING_UNIT_SLASH_RE = re.compile(r"^\s*\d+[a-z]?\s*/\s*")
_BUILDING_TOKEN_RE = re.compile(
    r"\b(?:building|bldg|block|blk|b)\s*\.?\s*(\d+[a-z]?)\b",
    re.IGNORECASE,
)
_STATE_POSTCODE_RE = re.compile(
    r"\b(?:qld|nsw|vic|sa|wa|tas|act|nt)\b\s*\d{0,4}",
    re.IGNORECASE,
)
_CORPORATE_SUFFIXES = {
    "co",
    "company",
    "inc",
    "limited",
    "ltd",
    "pty",
    "proprietary",
}
_STREET_SUFFIX_ALIASES = {
    "av": "avenue",
    "ave": "avenue",
    "dr": "drive",
    "hwy": "highway",
    "rd": "road",
    "st": "street",
}


def _str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _records(value: Any) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _strip_unit_tokens(value: str) -> str:
    value = _LEADING_UNIT_SLASH_RE.sub("", value)
    return _UNIT_TOKEN_RE.sub(" ", value)


def _building_token(*candidates: str | None) -> str | None:
    """The building designator (e.g. ``b6``) found in a name/address, if any."""
    for value in candidates:
        if not value:
            continue
        match = _BUILDING_TOKEN_RE.search(value)
        if match:
            return f"b{match.group(1).lower()}"
    return None


def _street_core(street: str | None, name: str | None) -> str | None:
    """Stable street core: leading number + first street word, without unit noise."""
    source = (street or "").strip() or (name or "").strip()
    if not source:
        return None
    cleaned = _strip_unit_tokens(source)
    cleaned = _BUILDING_TOKEN_RE.sub(" ", cleaned)
    cleaned = _STATE_POSTCODE_RE.sub(" ", cleaned)
    cleaned = re.sub(r"[^a-z0-9]+", " ", cleaned.lower()).strip()
    if not cleaned:
        return None
    tokens = cleaned.split()
    number = tokens[0] if tokens[0].isdigit() else ""
    first_word = next((token for token in tokens if not token.isdigit()), "")
    core = f"{number} {first_word}".strip()
    return core or None


def _building_key(
    name: str | None,
    street_address: str | None,
    unit_label: str | None = None,
    suburb: str | None = None,
) -> str | None:
    """Stable identity for a building within one entity."""
    token = _building_token(name, street_address)
    if token is None:
        return None
    core = _street_core(street_address, name)
    if core is None:
        return None
    return f"{core}|{token}"


def _building_level_name(name: str | None, building_key: str | None) -> str | None:
    """Drop unit labels from a building-level property name."""
    if building_key is None or not name:
        return None
    stripped = _strip_unit_tokens(name)
    stripped = re.sub(r"\s*,\s*,\s*", ", ", stripped)
    stripped = re.sub(r"\s{2,}", " ", stripped).strip(" ,")
    return stripped or None


def _normalise(
    value: str | None,
    *,
    drop_suffixes: bool = True,
    expand_street_suffixes: bool = False,
) -> str:
    if not value:
        return ""
    cleaned = re.sub(r"[^a-z0-9]+", " ", value.lower())
    tokens = [token for token in cleaned.split() if token]
    if expand_street_suffixes:
        tokens = [_STREET_SUFFIX_ALIASES.get(token, token) for token in tokens]
    if drop_suffixes:
        tokens = [token for token in tokens if token not in _CORPORATE_SUFFIXES]
    return " ".join(tokens)


def _token_set_score(left: str, right: str) -> float:
    left_tokens = set(left.split())
    right_tokens = set(right.split())
    if not left_tokens or not right_tokens:
        return 0.0
    overlap = len(left_tokens & right_tokens)
    return (2 * overlap) / (len(left_tokens) + len(right_tokens))


def _similarity(
    left: str | None,
    right: str | None,
    *,
    expand_street_suffixes: bool = False,
) -> float:
    normalised_left = _normalise(left, expand_street_suffixes=expand_street_suffixes)
    normalised_right = _normalise(right, expand_street_suffixes=expand_street_suffixes)
    if not normalised_left or not normalised_right:
        return 0.0
    return max(
        SequenceMatcher(None, normalised_left, normalised_right).ratio(),
        _token_set_score(normalised_left, normalised_right),
    )


def _address_similarity(left: str | None, right: str | None) -> float:
    left = _strip_unit_tokens(left) if left else None
    right = _strip_unit_tokens(right) if right else None
    return _similarity(left, right, expand_street_suffixes=True)


def _extracted_property(data: dict[str, Any]) -> dict[str, Any]:
    direct = _dict(data.get("property"))
    if direct:
        return direct
    rows = _records(data.get("properties"))
    return rows[0] if rows else {}


def _extracted_tenant(data: dict[str, Any]) -> dict[str, Any]:
    direct = _dict(data.get("tenant"))
    if direct:
        return direct
    parties = _records(data.get("parties"))
    for party in parties:
        role = (_str(party.get("role")) or "").lower()
        if "tenant" in role or "lessee" in role:
            return party
    return parties[0] if parties else {}


def _property_identity(row: dict[str, Any]) -> tuple[str | None, str | None, str | None]:
    name = _str(row.get("name"))
    street = _str(row.get("street_address")) or _str(row.get("address"))
    unit_label = _str(row.get("unit_label")) or _str(row.get("label"))
    return name, street, unit_label


def score_property_candidates(
    extracted: dict[str, Any],
    existing: Iterable[Any],
) -> list[PropertyCandidate]:
    row = _extracted_property(extracted)
    name, street, unit_label = _property_identity(row)
    suburb = _str(row.get("suburb"))
    extracted_building_key = _building_key(name, street, unit_label, suburb)
    extracted_street_core = _street_core(street, name)
    candidates: list[PropertyCandidate] = []

    for prop in existing:
        prop_name = _str(getattr(prop, "name", None))
        prop_street = _str(getattr(prop, "street_address", None))
        prop_suburb = _str(getattr(prop, "suburb", None))
        metadata = _dict(getattr(prop, "property_metadata", None))
        prop_building_key = _str(metadata.get("building_key")) or _building_key(
            prop_name,
            prop_street,
            None,
            prop_suburb,
        )
        name_score = _similarity(name, prop_name, expand_street_suffixes=True)
        address_score = _address_similarity(street, prop_street)
        prop_street_core = _street_core(prop_street, prop_name)
        street_match = bool(
            extracted_street_core and prop_street_core and extracted_street_core == prop_street_core
        )

        score = 0.0
        reason = ""
        if (
            extracted_building_key
            and prop_building_key
            and extracted_building_key == prop_building_key
        ):
            score = 1.0
            reason = "building + street match"
        elif street_match and name_score >= 0.92:
            score = 0.96
            reason = "name + street match"
        elif street_match and not name and address_score >= 0.92:
            score = 0.95
            reason = "address match"
        elif street_match and name_score >= 0.55:
            score = min(0.89, 0.72 + (0.2 * name_score))
            reason = "street + name similarity"
        elif name_score >= 0.94:
            score = 0.9
            reason = "property name match"
        elif name_score >= 0.78:
            score = 0.78
            reason = "property name similarity"

        if score >= DUPLICATE_THRESHOLD:
            candidates.append(
                PropertyCandidate(
                    property_id=prop.id,
                    score=round(score, 3),
                    reason=reason,
                )
            )

    return sorted(candidates, key=lambda item: item.score, reverse=True)


def _normalised_abn(value: str | None) -> str:
    return "".join(char for char in (value or "") if char.isdigit())


def score_tenant_candidates(
    extracted: dict[str, Any],
    existing: Iterable[Any],
) -> list[TenantCandidate]:
    row = _extracted_tenant(extracted)
    name = _str(row.get("legal_name")) or _str(row.get("name"))
    trading_name = _str(row.get("trading_name"))
    abn = _normalised_abn(_str(row.get("abn")))
    candidates: list[TenantCandidate] = []

    for tenant in existing:
        tenant_abn = _normalised_abn(_str(getattr(tenant, "abn", None)))
        if abn and tenant_abn and abn == tenant_abn:
            candidates.append(
                TenantCandidate(
                    tenant_id=tenant.id,
                    score=1.0,
                    reason="ABN match",
                )
            )
            continue

        legal_name = _str(getattr(tenant, "legal_name", None))
        tenant_trading = _str(getattr(tenant, "trading_name", None))
        name_score = max(
            _similarity(name, legal_name),
            _similarity(name, tenant_trading),
            _similarity(trading_name, legal_name),
            _similarity(trading_name, tenant_trading),
        )
        if name_score >= 0.94:
            score = 0.94
            reason = "tenant name match"
        elif name_score >= 0.72:
            score = min(0.89, name_score)
            reason = "tenant name similarity"
        else:
            continue
        if score >= DUPLICATE_THRESHOLD:
            candidates.append(
                TenantCandidate(
                    tenant_id=tenant.id,
                    score=round(score, 3),
                    reason=reason,
                )
            )

    return sorted(candidates, key=lambda item: item.score, reverse=True)
