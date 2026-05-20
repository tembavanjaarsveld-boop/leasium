"""Schemas for review-first register spreadsheet imports."""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

ImportSeverity = Literal["info", "warning", "blocker"]
ImportAction = Literal["create", "match", "update", "skip", "review"]
ImportDecision = Literal["approve", "ignore", "review"]
ImportApplyStatus = Literal["applied", "skipped", "blocked"]


class RegisterImportSheetSummary(BaseModel):
    name: str
    rows: int
    columns: list[str] = Field(default_factory=list)


class RegisterImportFinding(BaseModel):
    severity: ImportSeverity
    message: str
    sheet: str | None = None
    row: int | None = None
    field: str | None = None
    source_value: Any = None


class RegisterImportActionSummary(BaseModel):
    target: str
    create: int = 0
    match: int = 0
    update: int = 0
    skip: int = 0
    review: int = 0


class RegisterImportFeatureCandidate(BaseModel):
    key: str
    label: str
    reason: str
    source_sheet: str
    source_count: int
    priority: Literal["now", "next", "later"] = "next"


class RegisterImportSourceContext(BaseModel):
    filename: str
    sheet: str
    row: int | None = None
    source_hint: str | None = None
    confidence: float | None = None


class RegisterImportFieldChange(BaseModel):
    field: str
    label: str
    before: Any = None
    after: Any = None
    source: RegisterImportSourceContext | None = None


class RegisterImportActionItem(BaseModel):
    id: str
    target: str
    operation: ImportAction
    label: str
    summary: str
    source: RegisterImportSourceContext
    changes: list[RegisterImportFieldChange] = Field(default_factory=list)
    payload: dict[str, Any] = Field(default_factory=dict)
    blockers: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    default_decision: ImportDecision = "review"


class RegisterImportDryRunRead(BaseModel):
    plan_id: UUID | None = None
    entity_id: UUID
    filename: str
    sheets: list[RegisterImportSheetSummary]
    actions: list[RegisterImportActionSummary]
    action_items: list[RegisterImportActionItem] = Field(default_factory=list)
    findings: list[RegisterImportFinding]
    feature_candidates: list[RegisterImportFeatureCandidate]
    totals: dict[str, int]
    importable: bool
    summary: str


class RegisterImportApplyRequest(BaseModel):
    entity_id: UUID
    filename: str
    plan_id: UUID | None = None
    action_items: list[RegisterImportActionItem] = Field(default_factory=list)
    approved_action_ids: list[str] = Field(default_factory=list)
    ignored_action_ids: list[str] = Field(default_factory=list)
    notes: str | None = None


class RegisterImportApplyItemResult(BaseModel):
    action_id: str
    target: str
    operation: ImportAction
    status: ImportApplyStatus
    message: str
    target_table: str | None = None
    target_id: UUID | None = None
    created: dict[str, int] = Field(default_factory=dict)
    updated: dict[str, int] = Field(default_factory=dict)


class RegisterImportApplyRead(BaseModel):
    entity_id: UUID
    filename: str
    applied_at: datetime
    requested: int
    applied: int
    skipped: int
    blocked: int
    created: dict[str, int] = Field(default_factory=dict)
    updated: dict[str, int] = Field(default_factory=dict)
    ignored_action_ids: list[str] = Field(default_factory=list)
    results: list[RegisterImportApplyItemResult] = Field(default_factory=list)
