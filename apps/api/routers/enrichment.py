"""Review-first public enrichment routes for missing safe fields."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from stewart.ai.enrichment import (
    PublicEnrichmentError,
    suggest_public_enrichment,
)
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import Property, Tenant, UserRole
from stewart.core.settings import get_settings

from apps.api.deps import CurrentUser, assert_entity_role, get_current_user, get_session
from apps.api.schemas.enrichment import (
    EnrichmentAppliedChange,
    EnrichmentApplyRead,
    EnrichmentApplyRequest,
    EnrichmentPreviewRead,
    EnrichmentPreviewRequest,
    EnrichmentSkippedSuggestion,
    EnrichmentSource,
    EnrichmentSuggestion,
    EnrichmentTargetRead,
    EnrichmentTargetType,
)

router = APIRouter(prefix="/public-enrichment", tags=["public-enrichment"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}


TARGET_FIELD_LABELS: dict[EnrichmentTargetType, dict[str, str]] = {
    "tenant": {
        "legal_name": "Legal name",
        "trading_name": "Trading name",
        "abn": "ABN",
        "registered_address": "Registered address",
    },
    "property": {
        "suburb": "Suburb",
        "state": "State",
        "postcode": "Postcode",
        "owner_legal_name": "Owner legal name",
        "owner_abn": "Owner ABN",
        "trustee_name": "Trustee name",
        "trust_name": "Trust name",
        "invoice_issuer_name": "Invoice issuer name",
    },
}


@router.post("/preview", response_model=EnrichmentPreviewRead)
def preview_public_enrichment(
    payload: EnrichmentPreviewRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> EnrichmentPreviewRead:
    target = _get_target_for_user(payload.target_type, payload.target_id, user, session, READ_ROLES)
    labels = TARGET_FIELD_LABELS[payload.target_type]
    missing_fields = _missing_fields(payload.target_type, target)
    requested_fields, warnings = _requested_missing_fields(
        payload.target_type,
        labels,
        missing_fields,
        payload.requested_fields,
    )
    target_read = _target_read(payload.target_type, target, missing_fields)
    if not requested_fields:
        return EnrichmentPreviewRead(target=target_read, suggestions=[], warnings=warnings)

    try:
        provider_result, response_id = suggest_public_enrichment(
            target_type=payload.target_type,
            target_context=_target_context(payload.target_type, target),
            missing_fields=requested_fields,
            settings=get_settings(),
        )
    except PublicEnrichmentError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    suggestions, provider_warnings = _normalise_provider_suggestions(
        provider_result,
        labels,
        requested_fields,
    )
    return EnrichmentPreviewRead(
        target=target_read,
        suggestions=suggestions,
        warnings=[*warnings, *provider_warnings],
        openai_response_id=response_id,
    )


@router.post("/apply", response_model=EnrichmentApplyRead)
def apply_public_enrichment(
    payload: EnrichmentApplyRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> EnrichmentApplyRead:
    target = _get_target_for_user(
        payload.target_type,
        payload.target_id,
        user,
        session,
        WRITE_ROLES,
    )
    labels = TARGET_FIELD_LABELS[payload.target_type]
    applied: list[EnrichmentAppliedChange] = []
    skipped: list[EnrichmentSkippedSuggestion] = []
    seen_fields: set[str] = set()

    for suggestion in payload.suggestions:
        field = suggestion.field.strip()
        value = _normalise_value(field, suggestion.value)
        if field not in labels:
            skipped.append(
                EnrichmentSkippedSuggestion(
                    field=field,
                    value=value,
                    reason="Field is not supported for public enrichment.",
                )
            )
            continue
        if field in seen_fields:
            skipped.append(
                EnrichmentSkippedSuggestion(
                    field=field,
                    value=value,
                    reason="Duplicate suggestion was ignored.",
                )
            )
            continue
        seen_fields.add(field)
        if value is None:
            skipped.append(
                EnrichmentSkippedSuggestion(
                    field=field,
                    value=None,
                    reason="Suggested value is blank.",
                )
            )
            continue

        before = _current_field_value(payload.target_type, target, field)
        if not _is_blank(before):
            skipped.append(
                EnrichmentSkippedSuggestion(
                    field=field,
                    value=value,
                    reason="Field already has a value.",
                )
            )
            continue

        source = _source_from_suggestion(suggestion)
        storage = _apply_field(payload.target_type, target, field, value)
        _append_enrichment_metadata(
            payload.target_type,
            target,
            field,
            labels[field],
            before,
            value,
            source,
            user.id,
        )
        applied.append(
            EnrichmentAppliedChange(
                field=field,
                label=labels[field],
                before=before,
                after=value,
                source=source,
                storage=storage,
            )
        )

    if applied:
        audit_log(
            session,
            actor=user.actor,
            user_id=user.id,
            entity_id=_target_entity_id(target),
            action="apply",
            target_table=payload.target_type,
            target_id=payload.target_id,
            tool_name="public_enrichment",
            tool_input={"fields": [change.field for change in applied]},
            tool_output_summary=f"Applied {len(applied)} public enrichment suggestion(s).",
            data_classification="public",
        )
        session.commit()
        session.refresh(target)

    return EnrichmentApplyRead(
        target=_target_read(
            payload.target_type,
            target,
            _missing_fields(payload.target_type, target),
        ),
        applied=applied,
        skipped=skipped,
    )



def _get_target_for_user(
    target_type: EnrichmentTargetType,
    target_id: UUID,
    user: CurrentUser,
    session: Session,
    roles: set[UserRole],
) -> Property | Tenant:
    if target_type == "property":
        prop = session.get(Property, target_id)
        if prop is None or prop.deleted_at is not None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found.")
        assert_entity_role(session, user, prop.entity_id, roles)
        return prop

    tenant = session.get(Tenant, target_id)
    if tenant is None or tenant.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found.")
    assert_entity_role(session, user, tenant.entity_id, roles)
    return tenant


def _target_read(
    target_type: EnrichmentTargetType,
    target: Property | Tenant,
    missing_fields: list[str],
) -> EnrichmentTargetRead:
    return EnrichmentTargetRead(
        target_type=target_type,
        target_id=target.id,
        entity_id=_target_entity_id(target),
        display_name=_target_display_name(target),
        missing_fields=missing_fields,
    )


def _target_entity_id(target: Property | Tenant) -> UUID:
    return target.entity_id


def _target_display_name(target: Property | Tenant) -> str:
    if isinstance(target, Tenant):
        if target.trading_name:
            return f"{target.trading_name} ({target.legal_name})"
        return target.legal_name
    return target.name


def _target_context(
    target_type: EnrichmentTargetType,
    target: Property | Tenant,
) -> dict[str, Any]:
    if target_type == "tenant":
        assert isinstance(target, Tenant)
        return {
            "entity_name": target.entity.name,
            "legal_name": target.legal_name,
            "trading_name": target.trading_name,
            "abn": target.abn,
            "registered_address": _tenant_registered_address(target),
        }

    assert isinstance(target, Property)
    return {
        "entity_name": target.entity.name,
        "name": target.name,
        "street_address": target.street_address,
        "suburb": target.suburb,
        "state": target.state,
        "postcode": target.postcode,
        "owner_legal_name": target.owner_legal_name,
        "owner_abn": target.owner_abn,
        "trustee_name": target.trustee_name,
        "trust_name": target.trust_name,
        "invoice_issuer_name": target.invoice_issuer_name,
    }


def _requested_missing_fields(
    target_type: EnrichmentTargetType,
    labels: dict[str, str],
    missing_fields: list[str],
    requested_fields: list[str] | None,
) -> tuple[list[str], list[str]]:
    requested = requested_fields or missing_fields
    selected: list[str] = []
    warnings: list[str] = []
    for raw_field in requested:
        field = raw_field.strip()
        if field not in labels:
            warnings.append(f"{field or 'Blank field'} is not supported for {target_type}.")
            continue
        if field not in missing_fields:
            warnings.append(f"{labels[field]} already has a value.")
            continue
        if field not in selected:
            selected.append(field)
    return selected, warnings


def _missing_fields(target_type: EnrichmentTargetType, target: Property | Tenant) -> list[str]:
    return [
        field
        for field in TARGET_FIELD_LABELS[target_type]
        if _is_blank(_current_field_value(target_type, target, field))
    ]


def _current_field_value(
    target_type: EnrichmentTargetType,
    target: Property | Tenant,
    field: str,
) -> Any:
    if target_type == "tenant" and field == "registered_address":
        assert isinstance(target, Tenant)
        return _tenant_registered_address(target)
    return getattr(target, field, None)


def _tenant_registered_address(tenant: Tenant) -> str | None:
    metadata = _dict(tenant.tenant_metadata)
    public_enrichment = _dict(metadata.get("public_enrichment"))
    return _clean_text(public_enrichment.get("registered_address")) or _clean_text(
        metadata.get("registered_address")
    )


def _apply_field(
    target_type: EnrichmentTargetType,
    target: Property | Tenant,
    field: str,
    value: str,
) -> str:
    if target_type == "tenant" and field == "registered_address":
        assert isinstance(target, Tenant)
        metadata = _dict(target.tenant_metadata)
        public_enrichment = _dict(metadata.get("public_enrichment"))
        public_enrichment["registered_address"] = value
        metadata["public_enrichment"] = public_enrichment
        target.tenant_metadata = metadata
        return "metadata"

    setattr(target, field, value)
    return "record_field"


def _append_enrichment_metadata(
    target_type: EnrichmentTargetType,
    target: Property | Tenant,
    field: str,
    label: str,
    before: Any,
    after: str,
    source: EnrichmentSource,
    user_id: UUID,
) -> None:
    applied_at = utcnow().isoformat()
    source_data = _source_metadata(source)
    history_entry = {
        "field": field,
        "label": label,
        "before": before,
        "after": after,
        "source": source_data,
        "applied_at": applied_at,
        "applied_by_user_id": str(user_id),
    }
    if target_type == "tenant":
        assert isinstance(target, Tenant)
        metadata = _dict(target.tenant_metadata)
        target.tenant_metadata = _metadata_with_enrichment(
            metadata,
            field,
            source_data,
            history_entry,
        )
        return

    assert isinstance(target, Property)
    metadata = _metadata_with_enrichment(
        _dict(target.property_metadata),
        field,
        source_data,
        history_entry,
    )
    source_citations = _dict(metadata.get("source_citations"))
    source_citations[field] = source_data
    metadata["source_citations"] = source_citations
    target.property_metadata = metadata


def _metadata_with_enrichment(
    metadata: dict[str, Any],
    field: str,
    source_data: dict[str, Any],
    history_entry: dict[str, Any],
) -> dict[str, Any]:
    public_enrichment = _dict(metadata.get("public_enrichment"))
    source_citations = _dict(public_enrichment.get("source_citations"))
    source_citations[field] = source_data
    history = list(public_enrichment.get("apply_history") or [])
    history.append(history_entry)
    public_enrichment.update(
        {
            "source_citations": source_citations,
            "apply_history": history,
            "last_applied_at": history_entry["applied_at"],
        }
    )
    metadata["public_enrichment"] = public_enrichment
    return metadata


def _normalise_provider_suggestions(
    provider_result: dict[str, Any],
    labels: dict[str, str],
    requested_fields: list[str],
) -> tuple[list[EnrichmentSuggestion], list[str]]:
    suggestions: list[EnrichmentSuggestion] = []
    warnings = [
        warning for warning in provider_result.get("warnings", []) if isinstance(warning, str)
    ]
    raw_suggestions = provider_result.get("suggestions")
    if not isinstance(raw_suggestions, list):
        warnings.append("Public enrichment provider did not return suggestions.")
        return suggestions, warnings

    for raw in raw_suggestions:
        if not isinstance(raw, dict):
            warnings.append("Ignored malformed enrichment suggestion.")
            continue
        field = _clean_text(raw.get("field"))
        if field is None or field not in labels:
            warnings.append("Ignored unsupported enrichment field.")
            continue
        if field not in requested_fields:
            warnings.append(f"Ignored {labels[field]} because it is not missing on this record.")
            continue
        value = _normalise_value(field, raw.get("value"))
        confidence = _confidence(raw.get("confidence"))
        source_data = _dict(raw.get("source"))
        source_hint = _clean_text(raw.get("source_hint")) or _clean_text(
            source_data.get("source_hint")
        )
        citation = _clean_text(raw.get("citation")) or _clean_text(source_data.get("citation"))
        url = _clean_text(raw.get("source_url")) or _clean_text(source_data.get("url"))
        notes = _clean_text(raw.get("notes"))
        if value is None or source_hint is None or citation is None or confidence is None:
            warnings.append(f"Ignored incomplete suggestion for {labels[field]}.")
            continue
        source = EnrichmentSource(
            source_hint=source_hint,
            citation=citation,
            confidence=confidence,
            url=url,
        )
        suggestions.append(
            EnrichmentSuggestion(
                field=field,
                label=labels[field],
                value=value,
                source=source,
                confidence=confidence,
                notes=notes,
            )
        )
    return suggestions, warnings


def _source_from_suggestion(suggestion: EnrichmentSuggestion) -> EnrichmentSource:
    return suggestion.source.model_copy(update={"confidence": suggestion.confidence})


def _source_metadata(source: EnrichmentSource) -> dict[str, Any]:
    return {
        key: value
        for key, value in source.model_dump(mode="json").items()
        if value is not None and value != ""
    }


def _normalise_value(field: str, raw_value: Any) -> str | None:
    value = _clean_text(raw_value)
    if value is None:
        return None
    if field.endswith("abn") or field == "abn":
        digits = "".join(character for character in value if character.isdigit())
        if len(digits) == 11:
            return f"{digits[:2]} {digits[2:5]} {digits[5:8]} {digits[8:]}"
    if field == "state":
        return value.upper()
    return value


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = " ".join(str(value).split())
    return text or None


def _confidence(value: Any) -> float | None:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(1.0, confidence))


def _is_blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    return False


def _dict(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}
