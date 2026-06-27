"""Deterministic Smart Intake property/tenant candidate scoring."""

from types import SimpleNamespace
from uuid import uuid4

from stewart.domain.intake_match import (
    AUTO_MATCH_THRESHOLD,
    DUPLICATE_THRESHOLD,
    score_property_candidates,
    score_tenant_candidates,
)


def _property(
    *,
    name: str,
    street_address: str,
    suburb: str | None = "Brisbane City",
) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        name=name,
        street_address=street_address,
        suburb=suburb,
        state="QLD",
        postcode="4000",
        property_metadata={},
    )


def _tenant(
    *,
    legal_name: str,
    abn: str | None = None,
    trading_name: str | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        legal_name=legal_name,
        trading_name=trading_name,
        abn=abn,
    )


def test_property_candidates_auto_match_name_and_street_variants() -> None:
    existing = _property(
        name="Smart Lease Arcade",
        street_address="44 Review Road, Brisbane City QLD 4000",
    )
    candidates = score_property_candidates(
        {
            "properties": [
                {
                    "name": "Smart Lease Arcade Pty",
                    "address": "44 Review Rd",
                    "unit_label": "Shop 2",
                }
            ]
        },
        [existing],
    )

    assert len(candidates) == 1
    assert candidates[0].property_id == existing.id
    assert candidates[0].score >= AUTO_MATCH_THRESHOLD
    assert candidates[0].reason == "name + street match"


def test_property_candidates_auto_match_address_only_street_suffix_variant() -> None:
    existing = _property(
        name="1642 Anzac Avenue, North Lakes",
        street_address="1642 Anzac Avenue, North Lakes QLD",
        suburb="North Lakes",
    )
    candidates = score_property_candidates(
        {
            "properties": [
                {
                    "name": None,
                    "address": "1642 Anzac Ave, North Lakes QLD",
                    "unit_label": "Unit 5",
                }
            ]
        },
        [existing],
    )

    assert len(candidates) == 1
    assert candidates[0].property_id == existing.id
    assert candidates[0].score >= AUTO_MATCH_THRESHOLD
    assert candidates[0].reason == "address match"


def test_property_candidates_warn_on_near_duplicate_below_auto_match() -> None:
    existing = _property(
        name="Harbour Trade Centre",
        street_address="18 Harbour Road",
    )
    candidates = score_property_candidates(
        {
            "properties": [
                {
                    "name": "Harbour Logistics Centre",
                    "address": "18 Harbour Road",
                }
            ]
        },
        [existing],
    )

    assert len(candidates) == 1
    assert DUPLICATE_THRESHOLD <= candidates[0].score < AUTO_MATCH_THRESHOLD
    assert candidates[0].reason == "street + name similarity"


def test_property_candidates_ignore_unrelated_records() -> None:
    existing = _property(
        name="Northside Warehouse",
        street_address="9 Industrial Circuit",
    )

    assert (
        score_property_candidates(
            {
                "properties": [
                    {
                        "name": "Smart Lease Arcade",
                        "address": "44 Review Road",
                    }
                ]
            },
            [existing],
        )
        == []
    )


def test_tenant_candidates_auto_match_exact_abn() -> None:
    existing = _tenant(
        legal_name="Smart Lease Retail Pty Ltd",
        abn="98 765 432 100",
    )
    candidates = score_tenant_candidates(
        {
            "parties": [
                {
                    "role": "tenant",
                    "name": "Smart Lease Retail",
                    "abn": "98765432100",
                }
            ]
        },
        [existing],
    )

    assert len(candidates) == 1
    assert candidates[0].tenant_id == existing.id
    assert candidates[0].score == 1.0
    assert candidates[0].reason == "ABN match"


def test_tenant_candidates_warn_on_near_name_duplicate() -> None:
    existing = _tenant(legal_name="Harbour Logistics Pty Ltd")
    candidates = score_tenant_candidates(
        {
            "tenant": {
                "legal_name": "Harbour Logistic Services Pty Ltd",
            }
        },
        [existing],
    )

    assert len(candidates) == 1
    assert DUPLICATE_THRESHOLD <= candidates[0].score < AUTO_MATCH_THRESHOLD
    assert candidates[0].reason == "tenant name similarity"
