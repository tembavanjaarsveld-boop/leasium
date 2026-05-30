"""Basiq (AU) bank-feed reconciliation routes.

Review-first and inert without credentials. This router does NOT fork the
reconciliation engine: it reuses the guarded Xero payment-reconciliation
helpers (``_payment_reconciliation_result`` and friends) so there is one
audited, local-metadata-only apply path. Sharing that single guarded code
path is the whole safety story.

Guardrails:
- Preview writes nothing.
- Apply writes ONLY ``InvoiceDraft.invoice_metadata`` -- never Xero, never
  Basiq, never a bank record, never money.
- Apply additionally requires the operator to have explicitly approved each
  row's idempotency key (stricter than the Xero panel).
- Inert without credentials: default ``basiq_enabled=False`` soft-skips.
"""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import (
    BasiqConnection,
    Entity,
    InvoiceDraft,
    InvoiceDraftStatus,
    UserRole,
)
from stewart.core.settings import Settings, get_settings
from stewart.integrations.basiq import (
    BasiqIntegrationError,
    BasiqTransaction,
    basiq_server_token,
    create_basiq_auth_link,
    create_basiq_user,
    fetch_transactions,
    is_configured,
)

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.routers.xero import (
    _payment_reconciliation_result,
    _payment_status,
    _xero_invoice_id_from_metadata,
)
from apps.api.schemas.basiq import (
    BasiqConnectionStatusRead,
    BasiqConnectStartRead,
    BasiqImportedTransaction,
    BasiqReconciliationRead,
    BasiqReconciliationRequest,
    BasiqReconciliationResultRead,
)
from apps.api.schemas.xero import XeroPaymentReconciliationItem

router = APIRouter(prefix="/basiq", tags=["basiq"])

# Finance-capable roles, identical to the Xero reconciliation write gate.
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}
# Read gate mirrors Xero: everyone with entity access can read local status.
READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}


def _basiq_missing_config(settings: Settings) -> list[str]:
    """Return the env vars that must be set before a real Basiq call.

    Mirrors the Xero ``missing_config`` shape so the connect-start surface can
    stay inert with an actionable hint instead of erroring.
    """

    missing: list[str] = []
    if not settings.basiq_enabled:
        missing.append("BASIQ_ENABLED")
    if not settings.basiq_api_key:
        missing.append("BASIQ_API_KEY")
    return missing


def _active_basiq_connection(session: Session, entity_id: UUID) -> BasiqConnection | None:
    return session.scalar(
        select(BasiqConnection)
        .where(
            BasiqConnection.entity_id == entity_id,
            BasiqConnection.revoked_at.is_(None),
            BasiqConnection.deleted_at.is_(None),
        )
        .order_by(BasiqConnection.created_at.desc())
    )


# Stable, non-deliverable label domain for synthesised Basiq user emails.
# Entities carry no billing/contact email column; Basiq only uses this as a
# user label and Leasium never sends mail to it.
_BASIQ_USER_EMAIL_DOMAIN = "entities.leasium.invalid"


def _basiq_consent_email(entity: Entity) -> str:
    """Synthesise a stable, non-deliverable Basiq user email for an entity."""

    return f"entity+{entity.id}@{_BASIQ_USER_EMAIL_DOMAIN}"

# How close a statement date must sit to an invoice due date for a single
# amount-only match to count as medium (rather than low) confidence.
_DUE_DATE_WINDOW_DAYS = 7


def _imported_to_basiq_transaction(item: BasiqImportedTransaction) -> BasiqTransaction:
    return BasiqTransaction(
        transaction_id=item.transaction_id,
        amount_cents=item.amount_cents,
        posted_date=item.posted_date,
        description=item.description,
        reference=item.reference,
        counterparty=item.counterparty,
        account_name=item.account_name,
    )


def _draft_outstanding_cents(draft: InvoiceDraft) -> int:
    metadata = draft.invoice_metadata or {}
    payment = metadata.get("payment_status")
    if isinstance(payment, dict):
        paid = payment.get("paid_cents")
        if isinstance(paid, int):
            return max(draft.total_cents - paid, 0)
    return draft.total_cents


def _reference_contains_invoice_number(reference: str | None, invoice_number: str) -> bool:
    if not reference or not invoice_number:
        return False
    return invoice_number.casefold() in reference.casefold()


def _match_transaction_to_draft(
    transaction: BasiqTransaction,
    *,
    invoice_draft_id: UUID | None,
    drafts_by_id: dict[UUID, InvoiceDraft],
    unpaid_drafts: list[InvoiceDraft],
) -> tuple[
    InvoiceDraft | None,
    Literal["high", "medium", "low"],
    str,
]:
    """Pick a matching unpaid draft and explain the match (v1, no ML).

    Returns ``(draft, confidence, match_method)``. When no amount match
    exists, ``draft`` is None and the caller surfaces a blocked row.
    """

    # An explicit invoice_draft_id from the operator is the strongest signal,
    # but still only counts when the amount equals the outstanding balance.
    if invoice_draft_id is not None:
        candidate = drafts_by_id.get(invoice_draft_id)
        if candidate is not None and transaction.amount_cents == _draft_outstanding_cents(
            candidate
        ):
            return candidate, "high", "Matched by operator-selected invoice and amount (Basiq)."

    amount_matches = [
        draft
        for draft in unpaid_drafts
        if transaction.amount_cents == _draft_outstanding_cents(draft)
    ]

    # (a) reference == invoice_number AND amount == outstanding -> high
    # (b) reference contains invoice_number AND amount == outstanding -> high
    for draft in amount_matches:
        invoice_number = draft.invoice_number or ""
        reference = (transaction.reference or "").strip()
        if invoice_number and reference and reference.casefold() == invoice_number.casefold():
            return draft, "high", "Matched by exact reference and amount (Basiq)."
    for draft in amount_matches:
        invoice_number = draft.invoice_number or ""
        if invoice_number and _reference_contains_invoice_number(
            transaction.reference, invoice_number
        ):
            return draft, "high", "Matched by reference containing invoice number (Basiq)."

    if len(amount_matches) == 1:
        draft = amount_matches[0]
        # (c) amount == single unpaid draft outstanding AND statement_date
        #     within 7 days of due_date -> medium
        if (
            transaction.posted_date is not None
            and draft.due_date is not None
            and abs((transaction.posted_date - draft.due_date).days) <= _DUE_DATE_WINDOW_DAYS
        ):
            return draft, "medium", "Matched by amount and due-date proximity (Basiq)."
        # Amount-only single match without a date corroboration: low.
        return draft, "low", "Matched by amount only; needs review (Basiq)."

    if len(amount_matches) > 1:
        # Ambiguous: amount matches several unpaid drafts.
        return amount_matches[0], "low", "Ambiguous amount match across drafts (Basiq)."

    # No amount match at all.
    return None, "low", "No matching invoice draft found (Basiq)."


def _already_reconciled_draft(
    transaction_id: str, approved_drafts: list[InvoiceDraft]
) -> InvoiceDraft | None:
    """Find a draft this bank transaction already reconciled to.

    Matching only considers unpaid drafts, so once an invoice is settled it
    drops out and a replayed batch would otherwise surface as a misleading
    blocked row. Pointing the item back at the draft it already reconciled
    lets the shared engine's idempotency dedup report "already applied".
    """

    for draft in approved_drafts:
        metadata = draft.invoice_metadata or {}
        history = metadata.get("xero_payment_reconciliation_history") or []
        for entry in history:
            if isinstance(entry, dict) and entry.get("bank_transaction_id") == transaction_id:
                return draft
    return None


def _reconciliation_item_for_transaction(
    transaction: BasiqTransaction,
    *,
    invoice_draft_id: UUID | None,
    drafts_by_id: dict[UUID, InvoiceDraft],
    unpaid_drafts: list[InvoiceDraft],
    approved_drafts: list[InvoiceDraft],
) -> XeroPaymentReconciliationItem:
    reconciled = _already_reconciled_draft(transaction.transaction_id, approved_drafts)
    if reconciled is not None:
        draft: InvoiceDraft | None = reconciled
        confidence: Literal["high", "medium", "low"] = "high"
        match_method = "Already reconciled to this invoice (Basiq)."
    else:
        draft, confidence, match_method = _match_transaction_to_draft(
            transaction,
            invoice_draft_id=invoice_draft_id,
            drafts_by_id=drafts_by_id,
            unpaid_drafts=unpaid_drafts,
        )
    return XeroPaymentReconciliationItem(
        invoice_draft_id=draft.id if draft is not None else None,
        invoice_number=draft.invoice_number if draft is not None else None,
        status="paid",
        paid_cents=transaction.amount_cents,
        source="imported",
        bank_transaction_id=transaction.transaction_id,
        bank_account_name=transaction.account_name,
        statement_date=transaction.posted_date,
        statement_amount_cents=transaction.amount_cents,
        counterparty=transaction.counterparty,
        reference=transaction.reference,
        match_confidence=confidence,
        match_method=match_method,
        match_notes=transaction.description,
    )


def _basiq_reconciliation(
    *,
    entity_id: UUID,
    payload: BasiqReconciliationRequest,
    apply_changes: bool,
    user: CurrentUser,
    session: Session,
    settings: Settings,
) -> BasiqReconciliationRead:
    assert_entity_role(session, user, entity_id, WRITE_ROLES)
    entity = session.get(Entity, entity_id)
    if entity is None or entity.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")

    basiq_configured = is_configured(settings)
    reconciled_at = utcnow()

    # Resolve the bank-feed transactions to reconcile.
    imported_by_transaction_id: dict[str, BasiqImportedTransaction] = {}
    transactions: list[BasiqTransaction] = []
    provider_connection: BasiqConnection | None = None
    if payload.source == "imported":
        for imported in payload.transactions:
            imported_by_transaction_id[imported.transaction_id] = imported
            transactions.append(_imported_to_basiq_transaction(imported))
    else:
        # Provider source: resolve the active consent connection (if any) and
        # pass its Basiq user id in. With no connection, basiq_user_id stays
        # None and the adapter returns inert empty -- read-only either way.
        provider_connection = _active_basiq_connection(session, entity.id)
        fetch_result = fetch_transactions(
            settings,
            basiq_user_id=provider_connection.basiq_user_id if provider_connection else None,
        )
        if fetch_result.status == "failed":
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=fetch_result.error or "Basiq bank-feed fetch failed.",
            )
        # "skipped" (unconfigured) and "ok" (no live connection yet) both
        # leave the surface inert with no transactions to reconcile.
        transactions = list(fetch_result.transactions)
        if fetch_result.status == "ok" and provider_connection is not None:
            provider_connection.last_fetch_at = reconciled_at
            provider_connection.updated_by_user_id = user.id

    # Candidate matches run only against UNPAID approved invoice drafts.
    approved_drafts = list(
        session.scalars(
            select(InvoiceDraft)
            .where(
                InvoiceDraft.entity_id == entity.id,
                InvoiceDraft.status == InvoiceDraftStatus.approved,
                InvoiceDraft.deleted_at.is_(None),
            )
            .order_by(InvoiceDraft.due_date, InvoiceDraft.created_at)
        )
    )
    unpaid_drafts = [
        draft
        for draft in approved_drafts
        if _payment_status(draft.invoice_metadata or {}) != "paid"
    ]
    drafts_by_id = {draft.id: draft for draft in approved_drafts}
    drafts_by_number = {
        draft.invoice_number: draft
        for draft in approved_drafts
        if draft.invoice_number is not None
    }
    drafts_by_xero_invoice_id = {
        xero_invoice_id: draft
        for draft in approved_drafts
        if (xero_invoice_id := _xero_invoice_id_from_metadata(draft.invoice_metadata or {}))
    }

    approved_keys = set(payload.approved_idempotency_keys)
    results: list[BasiqReconciliationResultRead] = []
    for transaction in transactions:
        imported = imported_by_transaction_id.get(transaction.transaction_id)
        item = _reconciliation_item_for_transaction(
            transaction,
            invoice_draft_id=imported.invoice_draft_id if imported is not None else None,
            drafts_by_id=drafts_by_id,
            unpaid_drafts=unpaid_drafts,
            approved_drafts=approved_drafts,
        )

        # Always run a preview pass first so the engine computes the
        # idempotency key + status WITHOUT writing. This reuses the exact
        # Xero apply logic and never forks it.
        preview = _payment_reconciliation_result(
            item=item,
            drafts_by_id=drafts_by_id,
            drafts_by_number=drafts_by_number,
            drafts_by_xero_invoice_id=drafts_by_xero_invoice_id,
            apply_changes=False,
            user=user,
            reconciled_at=reconciled_at,
        )

        if not apply_changes or preview.status != "ready":
            # Preview path, or a row that cannot/should not apply (blocked,
            # already-applied skip, idempotent). Surface the preview as-is.
            results.append(preview)
            continue

        # Apply path with a ready row: enforce the explicit-approval gate.
        if preview.idempotency_key not in approved_keys:
            results.append(
                preview.model_copy(
                    update={
                        "status": "skipped",
                        "reason": "Not approved by operator.",
                    }
                )
            )
            continue

        # Approved: re-run the SAME engine with apply_changes=True so it
        # performs the guarded local-metadata-only write.
        applied = _payment_reconciliation_result(
            item=item,
            drafts_by_id=drafts_by_id,
            drafts_by_number=drafts_by_number,
            drafts_by_xero_invoice_id=drafts_by_xero_invoice_id,
            apply_changes=True,
            user=user,
            reconciled_at=reconciled_at,
        )
        results.append(applied)

    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity.id,
        action="apply" if apply_changes else "read",
        target_table="entity",
        target_id=entity.id,
        tool_name=(
            "basiq.reconciliation_apply" if apply_changes else "basiq.reconciliation_preview"
        ),
        tool_input=payload.model_dump(mode="json", exclude_unset=True),
        tool_output_summary=(
            f"{'Applied' if apply_changes else 'Previewed'} {len(results)} Basiq bank-feed "
            "reconciliation item(s); no Xero, bank, or money was mutated -- local payment "
            "metadata only."
        ),
    )
    entity.xero_last_sync_at = reconciled_at
    session.commit()

    return BasiqReconciliationRead(
        entity_id=entity.id,
        source=payload.source,
        basiq_configured=basiq_configured,
        checked_transactions=len(results),
        ready_count=sum(1 for result in results if result.status == "ready"),
        applied_count=sum(1 for result in results if result.status == "applied"),
        skipped_count=sum(1 for result in results if result.status == "skipped"),
        blocked_count=sum(1 for result in results if result.status == "blocked"),
        results=results,
        reconciled_at=reconciled_at,
        guardrails=[
            "Basiq reconciliation preview does not change local invoice payment status.",
            (
                "Apply only updates Leasium invoice payment metadata; it never mutates Xero, "
                "Basiq, bank records, or money."
            ),
            "Apply writes only for rows whose idempotency key the operator explicitly approved.",
            "Duplicate payment idempotency keys are skipped.",
            (
                "Bank-feed evidence is stored for review only; Leasium does not create, edit, "
                "or match bank transactions in Basiq or Xero."
            ),
        ],
    )


@router.post(
    "/reconciliation-preview/{entity_id}",
    response_model=BasiqReconciliationRead,
)
def preview_basiq_reconciliation(
    entity_id: UUID,
    payload: BasiqReconciliationRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> BasiqReconciliationRead:
    return _basiq_reconciliation(
        entity_id=entity_id,
        payload=payload,
        apply_changes=False,
        user=user,
        session=session,
        settings=settings,
    )


@router.post(
    "/reconciliation-apply/{entity_id}",
    response_model=BasiqReconciliationRead,
)
def apply_basiq_reconciliation(
    entity_id: UUID,
    payload: BasiqReconciliationRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> BasiqReconciliationRead:
    return _basiq_reconciliation(
        entity_id=entity_id,
        payload=payload,
        apply_changes=True,
        user=user,
        session=session,
        settings=settings,
    )


@router.post("/connect-start/{entity_id}", response_model=BasiqConnectStartRead)
def start_basiq_connect(
    entity_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> BasiqConnectStartRead:
    """Begin a Basiq consent connection and return the consent link.

    This is the ONLY route that creates a Basiq user or auth link. It never
    moves money, never writes to a bank, and never touches Xero. When Basiq is
    not configured it is inert: returns ``configured=False`` with the missing
    env vars and performs no HTTP and writes nothing.
    """

    assert_entity_role(session, user, entity_id, WRITE_ROLES)
    entity = session.get(Entity, entity_id)
    if entity is None or entity.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")

    missing_config = _basiq_missing_config(settings)
    if missing_config:
        # Inert: no HTTP, nothing written, just an actionable setup hint.
        return BasiqConnectStartRead(
            configured=False,
            consent_link=None,
            expires_at=None,
            missing_config=missing_config,
            consent_status=None,
        )

    existing = _active_basiq_connection(session, entity.id)
    try:
        token = basiq_server_token(settings)
        # Reuse the existing Basiq user on re-connect so we never spawn
        # duplicate users; otherwise create one for this entity.
        basiq_user_id = (
            existing.basiq_user_id
            if existing is not None
            else create_basiq_user(settings, token, _basiq_consent_email(entity))
        )
        consent_link, expires_at = create_basiq_auth_link(settings, token, basiq_user_id)
    except BasiqIntegrationError as exc:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc

    now = utcnow()
    # Revoke any prior active connection so the partial-unique index holds.
    for prior in session.scalars(
        select(BasiqConnection).where(
            BasiqConnection.entity_id == entity.id,
            BasiqConnection.revoked_at.is_(None),
            BasiqConnection.deleted_at.is_(None),
        )
    ):
        prior.revoked_at = now
        prior.updated_by_user_id = user.id

    provider_connection = BasiqConnection(
        entity_id=entity.id,
        created_by_user_id=user.id,
        updated_by_user_id=user.id,
        basiq_user_id=basiq_user_id,
        consent_status="pending",
        auth_link_url=consent_link,
        auth_link_expires_at=expires_at,
        connection_metadata={"connected_via": "basiq_auth_link", "mode": "consent_pending"},
    )
    session.add(provider_connection)
    session.flush()

    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity.id,
        action="create",
        target_table="basiq_connection",
        target_id=provider_connection.id,
        tool_name="basiq.connect_start",
        tool_input={"entity_id": str(entity.id)},
        tool_output_summary=(
            "Created a Basiq consent link for review; no money, bank record, or Xero "
            "data was mutated. Bank-feed reads remain read-only and consent is pending."
        ),
    )
    session.commit()
    return BasiqConnectStartRead(
        configured=True,
        consent_link=consent_link,
        expires_at=expires_at,
        missing_config=[],
        consent_status="pending",
    )


@router.get("/connection-status/{entity_id}", response_model=BasiqConnectionStatusRead)
def basiq_connection_status(
    entity_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> BasiqConnectionStatusRead:
    """Local-only Basiq connection status.

    Reads Leasium configuration and database rows only -- it never calls Basiq,
    mints a token, or mutates anything.
    """

    assert_entity_role(session, user, entity_id, READ_ROLES)
    entity = session.get(Entity, entity_id)
    if entity is None or entity.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")

    configured = is_configured(settings)
    provider_connection = _active_basiq_connection(session, entity.id)
    connected = provider_connection is not None
    return BasiqConnectionStatusRead(
        configured=configured,
        connected=connected,
        consent_status=(provider_connection.consent_status if connected else None),
        auth_link_expires_at=(provider_connection.auth_link_expires_at if connected else None),
        last_fetch_at=(provider_connection.last_fetch_at if connected else None),
        can_start_connect=configured,
        can_fetch=configured and connected,
        guardrails=[
            "Connection status reads local Leasium configuration and database state only.",
            "Loading status does not mint a Basiq token, call Basiq, or mutate provider state.",
            (
                "Basiq bank-feed access is read-only: Leasium never moves money, writes to a "
                "bank, or mutates Xero from this connection."
            ),
        ],
    )


@router.post("/connection-revoke/{entity_id}", response_model=BasiqConnectionStatusRead)
def revoke_basiq_connection(
    entity_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> BasiqConnectionStatusRead:
    """Locally revoke the active Basiq consent connection.

    Sets ``revoked_at`` on the local row only. It does NOT call any Basiq
    DELETE and does not touch money, banks, or Xero.
    """

    assert_entity_role(session, user, entity_id, WRITE_ROLES)
    entity = session.get(Entity, entity_id)
    if entity is None or entity.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")

    now = utcnow()
    revoked = 0
    for provider_connection in session.scalars(
        select(BasiqConnection).where(
            BasiqConnection.entity_id == entity.id,
            BasiqConnection.revoked_at.is_(None),
            BasiqConnection.deleted_at.is_(None),
        )
    ):
        provider_connection.revoked_at = now
        provider_connection.updated_by_user_id = user.id
        provider_connection.consent_status = "revoked"
        revoked += 1

    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=entity.id,
        action="update",
        target_table="basiq_connection",
        target_id=entity.id,
        tool_name="basiq.connection_revoke",
        tool_input={"entity_id": str(entity.id)},
        tool_output_summary=(
            f"Locally revoked {revoked} Basiq consent connection(s); no Basiq API call, "
            "money movement, bank write, or Xero mutation was performed."
        ),
    )
    session.commit()

    configured = is_configured(settings)
    return BasiqConnectionStatusRead(
        configured=configured,
        connected=False,
        consent_status=None,
        auth_link_expires_at=None,
        last_fetch_at=None,
        can_start_connect=configured,
        can_fetch=False,
        guardrails=[
            "Revoke clears the local Basiq connection only; no Basiq DELETE was called.",
            "No money, bank record, or Xero data was mutated.",
        ],
    )
