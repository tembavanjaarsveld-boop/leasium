"""Schemas for review-first register spreadsheet imports."""

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

ImportSeverity = Literal["info", "warning", "blocker"]
ImportAction = Literal["create", "match", "update", "skip", "review"]


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


class RegisterImportDryRunRead(BaseModel):
    entity_id: UUID
    filename: str
    sheets: list[RegisterImportSheetSummary]
    actions: list[RegisterImportActionSummary]
    findings: list[RegisterImportFinding]
    feature_candidates: list[RegisterImportFeatureCandidate]
    totals: dict[str, int]
    importable: bool
    summary: str
