"""Owner distribution compute-service tests (pure, no I/O)."""

from datetime import date
from decimal import Decimal
from uuid import uuid4

from apps.api.schemas.owners import OwnerStatementRead, OwnerStatementsRead
from stewart.core.db import utcnow
from stewart.core.models import Owner
from stewart.services.owner_distributions import compute_owner_distributions


def _statements(*owner_statements: OwnerStatementRead) -> OwnerStatementsRead:
    return OwnerStatementsRead(
        entity_id=uuid4(),
        month="2026-04",
        month_start=date(2026, 4, 1),
        month_end=date(2026, 4, 30),
        owners=list(owner_statements),
        generated_at=utcnow(),
    )


def _statement(
    *,
    owner_id,
    owner_identity: str,
    paid_cents: int,
) -> OwnerStatementRead:
    return OwnerStatementRead(
        owner_id=owner_id,
        owner_identity=owner_identity,
        property_count=1,
        properties=[],
        invoiced_cents=paid_cents,
        paid_cents=paid_cents,
        outstanding_cents=0,
        invoice_count=1,
    )


def _owner(owner_id, management_fee_pct: Decimal | None) -> Owner:
    return Owner(
        id=owner_id,
        entity_id=uuid4(),
        legal_name="Test Owner Pty Ltd",
        management_fee_pct=management_fee_pct,
    )


def test_distribution_gst_correctness() -> None:
    """Rent 1,000,000c @ 7.5% with a GST-registered agent breaks down exactly."""

    owner_id = uuid4()
    statements = _statements(
        _statement(
            owner_id=owner_id,
            owner_identity="Queen Street Trust",
            paid_cents=1_000_000,
        )
    )
    owners_by_id = {owner_id: _owner(owner_id, Decimal("7.5"))}

    lines = compute_owner_distributions(
        statements, owners_by_id, entity_gst_registered=True
    )

    assert len(lines) == 1
    line = lines[0]
    assert line.rent_collected_cents == 1_000_000
    assert line.management_fee_pct == 7.5
    assert line.fee_ex_gst_cents == 75_000
    assert line.fee_gst_cents == 7_500
    assert line.fee_inc_gst_cents == 82_500
    assert line.net_distribution_cents == 917_500
    assert line.needs_attention is False


def test_distribution_fee_rounds_half_up() -> None:
    """A fee landing on a half-cent rounds half-up to the whole cent."""

    owner_id = uuid4()
    # 1,005c * 5% = 50.25c -> 50c. Use a value with a .5 residue to prove
    # half-up: 1,010c * 5% = 50.5c -> 51c.
    statements = _statements(
        _statement(
            owner_id=owner_id,
            owner_identity="Rounding Trust",
            paid_cents=1_010,
        )
    )
    owners_by_id = {owner_id: _owner(owner_id, Decimal("5"))}

    lines = compute_owner_distributions(
        statements, owners_by_id, entity_gst_registered=False
    )

    assert lines[0].fee_ex_gst_cents == 51
    assert lines[0].fee_gst_cents == 0
    assert lines[0].fee_inc_gst_cents == 51
    assert lines[0].net_distribution_cents == 1_010 - 51


def test_distribution_zero_fee_when_pct_null_flags_needs_attention() -> None:
    """No management_fee_pct -> zero fee, full net, flagged for review."""

    owner_id = uuid4()
    statements = _statements(
        _statement(
            owner_id=owner_id,
            owner_identity="Unset Trust",
            paid_cents=500_000,
        )
    )
    owners_by_id = {owner_id: _owner(owner_id, None)}

    lines = compute_owner_distributions(
        statements, owners_by_id, entity_gst_registered=True
    )

    line = lines[0]
    assert line.management_fee_pct is None
    assert line.fee_ex_gst_cents == 0
    assert line.fee_gst_cents == 0
    assert line.fee_inc_gst_cents == 0
    assert line.net_distribution_cents == 500_000
    assert line.needs_attention is True


def test_distribution_zero_fee_for_unattributed_bucket() -> None:
    """Statements with no owner_id (Unattributed) flag needs_attention."""

    statements = _statements(
        _statement(
            owner_id=None,
            owner_identity="Unattributed",
            paid_cents=120_000,
        )
    )

    lines = compute_owner_distributions(statements, {}, entity_gst_registered=True)

    assert lines[0].needs_attention is True
    assert lines[0].net_distribution_cents == 120_000


def test_distribution_net_never_negative() -> None:
    """A fee larger than rent collected floors the net distribution at zero."""

    owner_id = uuid4()
    statements = _statements(
        _statement(
            owner_id=owner_id,
            owner_identity="High Fee Trust",
            paid_cents=1_000,
        )
    )
    # 100% fee + GST exceeds rent collected.
    owners_by_id = {owner_id: _owner(owner_id, Decimal("100"))}

    lines = compute_owner_distributions(
        statements, owners_by_id, entity_gst_registered=True
    )

    line = lines[0]
    assert line.fee_inc_gst_cents == 1_100
    assert line.net_distribution_cents == 0


def test_distribution_no_gst_when_entity_not_gst_registered() -> None:
    """A non-registered agent charges the fee with no GST component."""

    owner_id = uuid4()
    statements = _statements(
        _statement(
            owner_id=owner_id,
            owner_identity="No GST Trust",
            paid_cents=1_000_000,
        )
    )
    owners_by_id = {owner_id: _owner(owner_id, Decimal("7.5"))}

    lines = compute_owner_distributions(
        statements, owners_by_id, entity_gst_registered=False
    )

    line = lines[0]
    assert line.fee_ex_gst_cents == 75_000
    assert line.fee_gst_cents == 0
    assert line.fee_inc_gst_cents == 75_000
    assert line.net_distribution_cents == 925_000
