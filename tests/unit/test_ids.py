"""UUID helper tests."""

from stewart.core.ids import uuid7


def test_uuid7_returns_v7_uuid() -> None:
    value = uuid7()

    assert value.version == 7
    assert value.variant == "specified in RFC 4122"
