"""Unit tests for the building-identity key used by lease-intake property matching.

A ``_building_key`` groups units of one building *within a single entity* so a
dropped lease for a new unit attaches to the existing building property instead
of spawning a duplicate (the Leitchs B6 U4/U5 case). It must:

- match across naming conventions (register "Leitchs B6 U4" vs lease-extraction
  "Building 6, Unit 5, 205 Leitchs Road"),
- keep distinct buildings on one street apart (B6 != B3 — the 2026-06-16 guard),
- return ``None`` when there is no building designation, so single-building
  properties keep the legacy exact-name match (no regression).
"""

from apps.api.routers.lease_intakes import _building_key


def test_building_key_matches_across_naming_conventions() -> None:
    existing = _building_key("Leitchs B6 U4", "205 Leitchs Road, Brendale", "U4")
    incoming = _building_key(
        "Building 6, Unit 5, 205 Leitchs Road, Brendale",
        "205 Leitchs Road",
        "Unit 5",
    )
    assert existing is not None
    assert existing == incoming


def test_building_key_separates_buildings_on_same_street() -> None:
    b6 = _building_key("Building 6, 205 Leitchs Road", "205 Leitchs Road", "Unit 5")
    b3 = _building_key("Building 3, 205 Leitchs Road", "205 Leitchs Road", "Unit 1")
    assert b6 is not None
    assert b3 is not None
    assert b6 != b3


def test_building_key_is_none_without_building_designation() -> None:
    # Single-building property: no "Building N" / "BN" token -> fall back to
    # the legacy exact-name match rather than risk a wrong merge.
    assert _building_key("Smart Lease Arcade", "44 Review Road", "Shop 2") is None


def test_building_key_ignores_unit_and_street_suffix_variance() -> None:
    a = _building_key("Building 6, 205 Leitchs Road", "205 Leitchs Rd", "Unit 5")
    b = _building_key("Building 6", "205 Leitchs Road, Brendale QLD 4500", "Unit 12")
    assert a is not None
    assert a == b
