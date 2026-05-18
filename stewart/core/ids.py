"""Identifier helpers for application-generated UUIDv7 values."""

import secrets
import time
from uuid import UUID


def uuid7() -> UUID:
    """Generate a UUIDv7-compatible identifier.

    Python 3.12 does not include uuid.uuid7 yet, so Phase 0 generates the bit layout
    directly. The timestamp occupies the first 48 bits, followed by the v7 marker,
    variant bits, and random payload.
    """

    timestamp_ms = int(time.time() * 1000) & ((1 << 48) - 1)
    random_a = secrets.randbits(12)
    random_b = secrets.randbits(62)
    value = (timestamp_ms << 80) | (0x7 << 76) | (random_a << 64) | (0b10 << 62) | random_b
    return UUID(int=value)
