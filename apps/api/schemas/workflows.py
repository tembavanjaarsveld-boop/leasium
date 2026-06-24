"""Schemas for the review-first workflows builder."""

from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from pydantic import AliasChoices, BaseModel, Field, field_validator, model_validator
from stewart.core.models import (
    WorkflowActionType,
    WorkflowProposalDecisionStatus,
    WorkflowTriggerType,
)

from apps.api.schemas.common import ApiModel


class WorkflowActionConfig(BaseModel):
    type: WorkflowActionType
    config: dict[str, Any] = Field(default_factory=dict)

    @field_validator("config")
    @classmethod
    def _config_must_be_object(cls, value: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise ValueError("Action config must be an object.")
        return value


def _positive_int(value: object, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError(f"{field} must be a positive integer.")
    return value


def validate_workflow_catalog(
    *,
    trigger_type: WorkflowTriggerType,
    trigger_config: dict[str, Any],
    actions: list[WorkflowActionConfig],
) -> None:
    """Validate the fixed v1 workflow catalog.

    v1 deliberately has no free-form provider actions. Anything outside the
    three reviewed action types is rejected by the enum before this helper runs.
    """

    if not isinstance(trigger_config, dict):
        raise ValueError("Trigger config must be an object.")
    if trigger_type in {
        WorkflowTriggerType.lease_expiring,
        WorkflowTriggerType.compliance_due,
    }:
        _positive_int(trigger_config.get("days_before"), "days_before")
    elif trigger_type == WorkflowTriggerType.arrears_threshold:
        min_amount = trigger_config.get("min_amount_cents")
        min_days = trigger_config.get("min_days_overdue")
        if min_amount is None and min_days is None:
            raise ValueError(
                "arrears_threshold requires min_amount_cents or min_days_overdue."
            )
        if min_amount is not None:
            _positive_int(min_amount, "min_amount_cents")
        if min_days is not None:
            _positive_int(min_days, "min_days_overdue")
    if not actions:
        raise ValueError("At least one workflow action is required.")


def workflow_catalog_http_error(exc: ValueError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail=str(exc),
    )


class WorkflowRuleCreate(BaseModel):
    entity_id: UUID
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    trigger_type: WorkflowTriggerType
    trigger_config: dict[str, Any] = Field(default_factory=dict)
    actions: list[WorkflowActionConfig] = Field(default_factory=list)
    enabled: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _validate_catalog(self) -> "WorkflowRuleCreate":
        validate_workflow_catalog(
            trigger_type=self.trigger_type,
            trigger_config=self.trigger_config,
            actions=self.actions,
        )
        return self


class WorkflowRuleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    trigger_type: WorkflowTriggerType | None = None
    trigger_config: dict[str, Any] | None = None
    actions: list[WorkflowActionConfig] | None = None
    enabled: bool | None = None
    metadata: dict[str, Any] | None = None


class WorkflowRuleRead(ApiModel):
    id: UUID
    entity_id: UUID
    name: str
    description: str | None
    trigger_type: WorkflowTriggerType
    trigger_config: dict[str, Any]
    actions: list[dict[str, Any]]
    enabled: bool
    last_evaluated_at: datetime | None
    metadata: dict[str, Any] = Field(
        validation_alias=AliasChoices("workflow_metadata", "metadata"),
        serialization_alias="metadata",
    )
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


class WorkflowProposalSourceRead(BaseModel):
    table: str
    id: UUID
    label: str


class WorkflowProposalEvidenceRead(BaseModel):
    label: str
    value: str


class WorkflowProposalActionRead(BaseModel):
    type: WorkflowActionType
    config: dict[str, Any] = Field(default_factory=dict)


class WorkflowProposalRead(BaseModel):
    id: str
    entity_id: UUID
    rule_id: UUID
    rule_name: str
    trigger_type: WorkflowTriggerType
    action_type: WorkflowActionType
    dedupe_key: str
    target_table: str
    target_id: UUID
    title: str
    summary: str
    source: WorkflowProposalSourceRead
    evidence: list[WorkflowProposalEvidenceRead] = Field(default_factory=list)
    proposed_action: WorkflowProposalActionRead
    generated_at: datetime


class WorkflowQueueRead(BaseModel):
    entity_id: UUID
    proposals: list[WorkflowProposalRead] = Field(default_factory=list)
    guardrail: str
    generated_at: datetime


class WorkflowProposalDecisionCreate(BaseModel):
    rule_id: UUID
    dedupe_key: str = Field(min_length=1)


class WorkflowProposalDecisionRead(ApiModel):
    id: UUID
    entity_id: UUID
    rule_id: UUID
    dedupe_key: str
    target_table: str
    target_id: UUID
    action_type: WorkflowActionType
    decision: WorkflowProposalDecisionStatus
    decided_by_user_id: UUID | None
    decided_at: datetime
    execution_result: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime
