"""Owner distribution compute — pure, no I/O, no provider calls.

Owner distributions take the rent collected for an owner in a month (the
statement roll-up's ``paid_cents``) and deduct the owner's management fee to
arrive at the net amount owed to that owner. The fee is

    fee_ex_gst = rent_collected * (management_fee_pct / 100)

GST (10%) is applied to the fee **only when the managing agent's entity is
GST-registered** (the agent is the supplier of the management service, so the
agent's GST registration governs). The net distribution is

    net = max(rent_collected - fee_inc_gst, 0)

When an owner has no ``management_fee_pct`` recorded, the fee is zero and the
line is flagged ``needs_attention`` so the operator reviews it before relying
on the figures rather than silently assuming a free management arrangement.

This module is intentionally free of database, settings, or provider access:
the router resolves the inputs and persists the reviewed snapshot.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from apps.api.schemas.owners import OwnerDistributionLine, OwnerStatementsRead

from stewart.core.models import Owner

GST_RATE = Decimal("0.10")
_CENT = Decimal("1")


def _round_cents(value: Decimal) -> int:
    """Round a cents amount half-up to a whole cent."""

    return int(value.quantize(_CENT, rounding=ROUND_HALF_UP))


def compute_owner_distributions(
    statements: OwnerStatementsRead,
    owners_by_id: dict[UUID, Owner],
    entity_gst_registered: bool,
) -> list[OwnerDistributionLine]:
    """Compute per-owner distribution lines from a month's statements.

    ``owners_by_id`` supplies the ``management_fee_pct`` per first-class owner;
    statements whose ``owner_id`` is absent (e.g. the Unattributed bucket) have
    no fee configured and surface as ``needs_attention``.
    """

    lines: list[OwnerDistributionLine] = []
    for statement in statements.owners:
        rent_collected_cents = statement.paid_cents
        owner = (
            owners_by_id.get(statement.owner_id)
            if statement.owner_id is not None
            else None
        )
        fee_pct = owner.management_fee_pct if owner is not None else None

        if fee_pct is None:
            lines.append(
                OwnerDistributionLine(
                    owner_id=statement.owner_id,
                    owner_identity=statement.owner_identity,
                    rent_collected_cents=rent_collected_cents,
                    management_fee_pct=None,
                    fee_ex_gst_cents=0,
                    fee_gst_cents=0,
                    fee_inc_gst_cents=0,
                    net_distribution_cents=rent_collected_cents,
                    needs_attention=True,
                )
            )
            continue

        fee_pct_decimal = Decimal(fee_pct)
        fee_ex_gst_cents = _round_cents(
            Decimal(rent_collected_cents) * fee_pct_decimal / Decimal(100)
        )
        fee_gst_cents = (
            _round_cents(Decimal(fee_ex_gst_cents) * GST_RATE)
            if entity_gst_registered
            else 0
        )
        fee_inc_gst_cents = fee_ex_gst_cents + fee_gst_cents
        net_distribution_cents = max(rent_collected_cents - fee_inc_gst_cents, 0)

        lines.append(
            OwnerDistributionLine(
                owner_id=statement.owner_id,
                owner_identity=statement.owner_identity,
                rent_collected_cents=rent_collected_cents,
                management_fee_pct=float(fee_pct_decimal),
                fee_ex_gst_cents=fee_ex_gst_cents,
                fee_gst_cents=fee_gst_cents,
                fee_inc_gst_cents=fee_inc_gst_cents,
                net_distribution_cents=net_distribution_cents,
                needs_attention=False,
            )
        )

    return lines
