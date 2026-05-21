"""Review-first public enrichment routes for missing safe fields."""

import socket
from io import BytesIO
from ipaddress import ip_address
from typing import Annotated, Any
from urllib.parse import urljoin, urlparse
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.orm import Session
from stewart.ai.enrichment import (
    PublicEnrichmentError,
    suggest_property_image_candidates,
    suggest_public_enrichment,
)
from stewart.core.audit import audit_log
from stewart.core.db import utcnow
from stewart.core.models import DocumentCategory, Property, StoredDocument, Tenant, UserRole
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
    PropertyImageApplyRead,
    PropertyImageApplyRequest,
    PropertyImageCandidate,
    PropertyImagePreviewRead,
    PropertyImagePreviewRequest,
)

router = APIRouter(prefix="/public-enrichment", tags=["public-enrichment"])

READ_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops, UserRole.viewer}
WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.finance, UserRole.ops}
PROPERTY_IMAGE_WIDTH = 1600
PROPERTY_IMAGE_HEIGHT = 900
PROPERTY_IMAGE_MAX_BYTES = 12_000_000
PROPERTY_IMAGE_MAX_REDIRECTS = 5
BLOCKED_PROPERTY_IMAGE_HOSTS = {"localhost", "metadata.google.internal"}

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


@router.post("/property-images/preview", response_model=PropertyImagePreviewRead)
def preview_property_images(
    payload: PropertyImagePreviewRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> PropertyImagePreviewRead:
    prop = _get_target_for_user("property", payload.property_id, user, session, READ_ROLES)
    assert isinstance(prop, Property)
    target_read = _target_read("property", prop, _missing_fields("property", prop))
    try:
        provider_result, response_id = suggest_property_image_candidates(
            target_context=_property_image_context(prop),
            requested_count=payload.requested_count,
            settings=get_settings(),
        )
    except PublicEnrichmentError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    candidates, warnings = _normalise_property_image_candidates(provider_result)
    return PropertyImagePreviewRead(
        target=target_read,
        candidates=candidates,
        warnings=warnings,
        openai_response_id=response_id,
    )


@router.post("/property-images/apply", response_model=PropertyImageApplyRead)
def apply_property_image(
    payload: PropertyImageApplyRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> PropertyImageApplyRead:
    prop = _get_target_for_user("property", payload.property_id, user, session, WRITE_ROLES)
    assert isinstance(prop, Property)
    candidate = _normalise_property_image_candidate(payload.candidate)
    warnings: list[str] = []
    if candidate is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Property image candidate is incomplete or unsupported.",
        )
    if candidate.image_url != payload.candidate.image_url:
        warnings.append("Image URL was normalised before saving.")
    image_data, original_dimensions = _download_and_process_property_image(candidate.image_url)
    document = _create_property_image_document(
        prop,
        candidate,
        image_data,
        original_dimensions,
    )
    session.add(document)
    session.flush()
    _apply_property_image_metadata(prop, candidate, user.id, document)
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=prop.entity_id,
        action="create",
        target_table="stored_document",
        target_id=document.id,
        tool_name="property_image_enrichment",
        tool_input={"property_id": str(prop.id), "source_image_url": candidate.image_url},
        tool_output_summary="Created property image document from reviewed online candidate.",
        data_classification="public",
    )
    audit_log(
        session,
        actor=user.actor,
        user_id=user.id,
        entity_id=prop.entity_id,
        action="apply",
        target_table="property",
        target_id=payload.property_id,
        tool_name="property_image_enrichment",
        tool_input={"image_url": candidate.image_url, "page_url": candidate.page_url},
        tool_output_summary="Saved reviewed online property image.",
        data_classification="public",
    )
    session.commit()
    session.refresh(prop)
    return PropertyImageApplyRead(
        target=_target_read("property", prop, _missing_fields("property", prop)),
        selected_image=candidate,
        document_id=document.id,
        warnings=warnings,
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


def _property_image_context(target: Property) -> dict[str, Any]:
    return {
        **_target_context("property", target),
        "address": ", ".join(
            part
            for part in [
                target.street_address,
                target.suburb,
                target.state,
                target.postcode,
                target.country_code,
            ]
            if part
        ),
        "property_type": target.property_type.value,
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


def _normalise_property_image_candidates(
    provider_result: dict[str, Any],
) -> tuple[list[PropertyImageCandidate], list[str]]:
    candidates: list[PropertyImageCandidate] = []
    warnings = [
        warning for warning in provider_result.get("warnings", []) if isinstance(warning, str)
    ]
    raw_candidates = provider_result.get("candidates")
    if not isinstance(raw_candidates, list):
        warnings.append("Property image provider did not return candidates.")
        return candidates, warnings

    seen_urls: set[str] = set()
    for raw in raw_candidates:
        if not isinstance(raw, dict):
            warnings.append("Ignored malformed image candidate.")
            continue
        candidate = _normalise_property_image_candidate(raw)
        if candidate is None:
            warnings.append("Ignored incomplete or unsupported image candidate.")
            continue
        if candidate.image_url in seen_urls:
            warnings.append("Ignored duplicate image candidate.")
            continue
        seen_urls.add(candidate.image_url)
        candidates.append(candidate)
    if not candidates and not warnings:
        warnings.append("No confident public property image candidates were found.")
    return candidates, warnings


def _normalise_property_image_candidate(
    value: PropertyImageCandidate | dict[str, Any],
) -> PropertyImageCandidate | None:
    if isinstance(value, PropertyImageCandidate):
        raw = value.model_dump(mode="json")
    elif isinstance(value, dict):
        raw = value
    else:
        return None
    image_url = _https_url(raw.get("image_url"))
    title = _clean_text(raw.get("title"))
    confidence = _confidence(raw.get("confidence"))
    source_data = _dict(raw.get("source"))
    source_hint = _clean_text(raw.get("source_hint")) or _clean_text(
        source_data.get("source_hint")
    )
    citation = _clean_text(raw.get("citation")) or _clean_text(source_data.get("citation"))
    page_url = _https_url(raw.get("page_url")) or _https_url(source_data.get("url"))
    notes = _clean_text(raw.get("notes"))
    if (
        image_url is None
        or title is None
        or source_hint is None
        or citation is None
        or confidence is None
    ):
        return None
    source = EnrichmentSource(
        source_hint=source_hint,
        citation=citation,
        confidence=confidence,
        url=page_url,
    )
    return PropertyImageCandidate(
        title=title,
        image_url=image_url,
        page_url=page_url,
        source=source,
        confidence=confidence,
        notes=notes,
    )


def _apply_property_image_metadata(
    prop: Property,
    candidate: PropertyImageCandidate,
    user_id: UUID,
    document: StoredDocument,
) -> None:
    metadata = _dict(prop.property_metadata)
    property_media = _dict(metadata.get("property_media"))
    selected_at = utcnow().isoformat()
    document_id = str(document.id)
    document_metadata = _dict(document.document_metadata)
    primary_image = {
        "title": candidate.title,
        "image_url": candidate.image_url,
        "source_image_url": candidate.image_url,
        "document_id": document_id,
        "image_document_id": document_id,
        "page_url": candidate.page_url,
        "source_page_url": candidate.page_url,
        "source": _source_metadata(candidate.source),
        "confidence": candidate.confidence,
        "notes": candidate.notes,
        "original_width": document_metadata.get("original_width"),
        "original_height": document_metadata.get("original_height"),
        "processed_width": document_metadata.get("processed_width"),
        "processed_height": document_metadata.get("processed_height"),
        "selected_at": selected_at,
        "selected_by_user_id": str(user_id),
    }
    property_media["primary_image"] = primary_image
    property_media["hero_image_document_id"] = document_id
    history = list(property_media.get("image_history") or [])
    history.append(primary_image)
    property_media["image_history"] = history[-10:]
    property_media["last_selected_at"] = selected_at
    image_document_ids = list(property_media.get("image_document_ids") or [])
    if document_id not in image_document_ids:
        image_document_ids.append(document_id)
    property_media["image_document_ids"] = image_document_ids[-10:]
    metadata["property_media"] = property_media
    prop.property_metadata = metadata


def _create_property_image_document(
    prop: Property,
    candidate: PropertyImageCandidate,
    image_data: bytes,
    original_dimensions: tuple[int, int],
) -> StoredDocument:
    filename = f"{_filename_slug(prop.name)}-property-image.jpg"
    return StoredDocument(
        entity_id=prop.entity_id,
        property_id=prop.id,
        filename=filename,
        content_type="image/jpeg",
        byte_size=len(image_data),
        file_data=image_data,
        category=DocumentCategory.other,
        notes=f"Reviewed public property image: {candidate.title}",
        document_metadata={
            "source": "public_property_image",
            "candidate_title": candidate.title,
            "source_image_url": candidate.image_url,
            "source_page_url": candidate.page_url,
            "source_detail": _source_metadata(candidate.source),
            "confidence": candidate.confidence,
            "notes": candidate.notes,
            "original_width": original_dimensions[0],
            "original_height": original_dimensions[1],
            "processed_width": PROPERTY_IMAGE_WIDTH,
            "processed_height": PROPERTY_IMAGE_HEIGHT,
        },
    )


def _download_and_process_property_image(image_url: str) -> tuple[bytes, tuple[int, int]]:
    current_url = image_url
    try:
        with httpx.Client(timeout=30.0, follow_redirects=False) as client:
            for _ in range(PROPERTY_IMAGE_MAX_REDIRECTS + 1):
                _assert_property_image_url_allowed(current_url)
                with client.stream("GET", current_url) as response:
                    if response.is_redirect:
                        redirect_url = _redirect_url(current_url, response)
                        current_url = redirect_url
                        continue
                    response.raise_for_status()
                    content_type = (
                        response.headers.get("content-type", "").split(";")[0].strip().lower()
                    )
                    if (
                        content_type == "image/svg+xml"
                        or urlparse(current_url).path.lower().endswith(".svg")
                    ):
                        raise HTTPException(
                            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                            detail="SVG property images are not supported.",
                        )
                    if content_type and not content_type.startswith("image/"):
                        raise HTTPException(
                            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                            detail="Downloaded URL did not return an image.",
                        )
                    content_length = response.headers.get("content-length")
                    if content_length and int(content_length) > PROPERTY_IMAGE_MAX_BYTES:
                        raise HTTPException(
                            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            detail="Downloaded image is too large.",
                        )
                    image_bytes = _read_limited_response_bytes(response)
                    break
            else:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="Property image URL redirected too many times.",
                )
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Could not download property image ({exc.response.status_code}).",
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Downloaded image size could not be checked.",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Could not download property image.",
        ) from exc

    if not image_bytes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Downloaded image was empty.",
        )
    if len(image_bytes) > PROPERTY_IMAGE_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Downloaded image is too large.",
        )
    try:
        with Image.open(BytesIO(image_bytes)) as image:
            image.load()
            original_dimensions = image.size
            processed = ImageOps.fit(
                image.convert("RGB"),
                (PROPERTY_IMAGE_WIDTH, PROPERTY_IMAGE_HEIGHT),
                method=Image.Resampling.LANCZOS,
            )
            output = BytesIO()
            processed.save(output, format="JPEG", quality=86, optimize=True)
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Downloaded image could not be processed.",
        ) from exc
    return output.getvalue(), original_dimensions


def _assert_property_image_url_allowed(image_url: str) -> None:
    parsed = urlparse(image_url)
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Property image URL must be HTTPS.",
        )
    host = parsed.hostname.lower().strip("[]")
    _assert_property_image_host_allowed(host)
    try:
        address = ip_address(host)
    except ValueError:
        _assert_property_image_resolves_public(host, parsed.port)
    else:
        _assert_property_image_address_allowed(address)


def _assert_property_image_host_allowed(host: str) -> None:
    if (
        host in BLOCKED_PROPERTY_IMAGE_HOSTS
        or host.endswith(".localhost")
        or host.endswith(".local")
        or host.endswith(".internal")
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Image URL host is not allowed.",
        )


def _assert_property_image_address_allowed(address: Any) -> None:
    if not address.is_global:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Image URL host is not allowed.",
        )


def _assert_property_image_resolves_public(host: str, port: int | None) -> None:
    try:
        resolved = socket.getaddrinfo(host, port or 443, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Image URL host could not be resolved.",
        ) from exc
    addresses = {item[4][0] for item in resolved}
    if not addresses:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Image URL host could not be resolved.",
        )
    for address in addresses:
        _assert_property_image_address_allowed(ip_address(address))


def _redirect_url(current_url: str, response: httpx.Response) -> str:
    location = response.headers.get("location")
    if not location:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Property image URL redirected without a destination.",
        )
    redirect_url = urljoin(current_url, location)
    _assert_property_image_url_allowed(redirect_url)
    return redirect_url


def _read_limited_response_bytes(response: httpx.Response) -> bytes:
    chunks: list[bytes] = []
    total_size = 0
    for chunk in response.iter_bytes():
        total_size += len(chunk)
        if total_size > PROPERTY_IMAGE_MAX_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Downloaded image is too large.",
            )
        chunks.append(chunk)
    return b"".join(chunks)


def _https_url(value: Any) -> str | None:
    text = _clean_text(value)
    if text is None:
        return None
    parsed = urlparse(text)
    return text if parsed.scheme.lower() == "https" and parsed.hostname else None


def _filename_slug(value: str) -> str:
    slug = "".join(
        character.lower() if character.isalnum() else "-"
        for character in value
    ).strip("-")
    return "-".join(part for part in slug.split("-") if part) or "property"


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
