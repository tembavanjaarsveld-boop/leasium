"""Lease agreement question and signing state for tenant onboarding."""

from uuid import UUID, uuid4

from stewart.core.db import utcnow
from stewart.core.models import TenantOnboarding, TenantOnboardingStatus

LEASE_AGREEMENT_KEY = "lease_agreement"
BLOCKING_QUESTION_STATUSES = {"open", "needs_revision", "legal_review"}
ACTIVE_SIGNING_STATUSES = {"queued", "sent", "delivered"}
SIGNING_LOCKED_REASON = (
    "An e-signature request is waiting for completion. Complete the signing "
    "request instead of signing inside Relby."
)


def _delivery_data(onboarding: TenantOnboarding) -> dict[str, object]:
    return dict(onboarding.delivery_data or {})


def lease_agreement_section(onboarding: TenantOnboarding) -> dict[str, object]:
    section = _delivery_data(onboarding).get(LEASE_AGREEMENT_KEY)
    return dict(section) if isinstance(section, dict) else {}


def lease_agreement_exists(onboarding: TenantOnboarding) -> bool:
    return isinstance(_delivery_data(onboarding).get(LEASE_AGREEMENT_KEY), dict)


def set_lease_agreement_section(
    onboarding: TenantOnboarding,
    section: dict[str, object],
) -> None:
    data = _delivery_data(onboarding)
    data[LEASE_AGREEMENT_KEY] = section
    onboarding.delivery_data = data


def _question_records(section: dict[str, object]) -> list[dict[str, object]]:
    questions = section.get("questions")
    if not isinstance(questions, list):
        return []
    normalised: list[dict[str, object]] = []
    for item in questions:
        if not isinstance(item, dict):
            continue
        question_id = item.get("id")
        question_text = item.get("question")
        if not isinstance(question_id, str) or not isinstance(question_text, str):
            continue
        status = item.get("status")
        if status not in {
            "open",
            "answered",
            "resolved",
            "needs_revision",
            "legal_review",
        }:
            status = "open"
        record = dict(item)
        record["id"] = question_id
        record["question"] = question_text
        record["status"] = status
        normalised.append(record)
    return normalised


def blocking_lease_question_count(onboarding: TenantOnboarding) -> int:
    return sum(
        1
        for question in _question_records(lease_agreement_section(onboarding))
        if question.get("status") in BLOCKING_QUESTION_STATUSES
    )


def lease_agreement_signed(onboarding: TenantOnboarding) -> bool:
    signing = lease_agreement_section(onboarding).get("signing")
    return isinstance(signing, dict) and isinstance(signing.get("signed_at"), str)


def lease_agreement_read(onboarding: TenantOnboarding) -> dict[str, object]:
    section = lease_agreement_section(onboarding)
    questions = _question_records(section)
    signing = section.get("signing")
    signing_data = dict(signing) if isinstance(signing, dict) else {}
    signed_at = signing_data.get("signed_at")
    open_question_count = sum(
        1 for question in questions if question.get("status") in BLOCKING_QUESTION_STATUSES
    )

    if isinstance(signed_at, str) and signed_at:
        status = "signed"
        locked_reason = None
    elif (
        signing_data.get("provider")
        and signing_data.get("status") in ACTIVE_SIGNING_STATUSES
    ):
        status = "not_ready"
        locked_reason = SIGNING_LOCKED_REASON
    elif open_question_count:
        status = "questions_open"
        locked_reason = "Resolve lease agreement questions before signing."
    elif onboarding.status in {
        TenantOnboardingStatus.reviewed,
        TenantOnboardingStatus.applied,
    }:
        status = "ready_to_sign"
        locked_reason = None
    else:
        status = "not_ready"
        locked_reason = "Property team review must be completed before signing."

    return {
        "status": status,
        "open_question_count": open_question_count,
        "questions": questions,
        "signed_at": signed_at if isinstance(signed_at, str) else None,
        "signed_by_actor": signing_data.get("signed_by_actor")
        if isinstance(signing_data.get("signed_by_actor"), str)
        else None,
        "signing": signing_data,
        "signing_provider": signing_data.get("provider")
        if isinstance(signing_data.get("provider"), str)
        else None,
        "signing_status": signing_data.get("status")
        if isinstance(signing_data.get("status"), str)
        else None,
        "signing_envelope_id": signing_data.get("envelope_id")
        if isinstance(signing_data.get("envelope_id"), str)
        else None,
        "signing_document_id": signing_data.get("document_id")
        if isinstance(signing_data.get("document_id"), str)
        else None,
        "signing_sent_at": signing_data.get("sent_at")
        if isinstance(signing_data.get("sent_at"), str)
        else None,
        "signing_locked_reason": locked_reason,
    }


def append_lease_question(
    onboarding: TenantOnboarding,
    *,
    question: str,
    clause_reference: str | None,
    actor: str,
) -> dict[str, object]:
    section = lease_agreement_section(onboarding)
    questions = _question_records(section)
    now = utcnow().isoformat()
    record: dict[str, object] = {
        "id": str(uuid4()),
        "question": question,
        "clause_reference": clause_reference,
        "status": "open",
        "asked_at": now,
        "asked_by_actor": actor,
    }
    questions.append(record)
    section["questions"] = questions
    section["last_activity_at"] = now
    set_lease_agreement_section(onboarding, section)
    return record


def respond_to_lease_question(
    onboarding: TenantOnboarding,
    *,
    question_id: str,
    answer: str | None,
    response_status: str,
    actor: str,
    user_id: UUID,
) -> dict[str, object] | None:
    section = lease_agreement_section(onboarding)
    questions = _question_records(section)
    now = utcnow().isoformat()
    updated: dict[str, object] | None = None
    for question in questions:
        if question.get("id") != question_id:
            continue
        question["status"] = response_status
        if answer:
            question["answer"] = answer
        question["answered_at"] = now
        question["answered_by_actor"] = actor
        question["answered_by_user_id"] = str(user_id)
        if response_status == "resolved":
            question["resolved_at"] = now
        updated = question
        break
    if updated is None:
        return None
    section["questions"] = questions
    section["last_activity_at"] = now
    set_lease_agreement_section(onboarding, section)
    return updated


def mark_lease_agreement_signed(
    onboarding: TenantOnboarding,
    *,
    actor: str,
    source: str = "tenant_portal",
    signing_updates: dict[str, object] | None = None,
) -> dict[str, object]:
    section = lease_agreement_section(onboarding)
    signing = section.get("signing")
    signing_data = dict(signing) if isinstance(signing, dict) else {}
    if signing_updates:
        signing_data.update(signing_updates)
    signing_data["signed_at"] = signing_data.get("signed_at") or utcnow().isoformat()
    signing_data["signed_by_actor"] = signing_data.get("signed_by_actor") or actor
    signing_data["source"] = signing_data.get("source") or source
    section["signing"] = signing_data
    section["last_activity_at"] = signing_data["signed_at"]
    set_lease_agreement_section(onboarding, section)
    return signing_data
