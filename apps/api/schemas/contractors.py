"""Schemas for the contractor directory."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ContractorBase(BaseModel):
    """Shared fields between create + update + read."""

    name: str
    company_name: str | None = None
    categories: list[str] = Field(default_factory=list)
    email: str | None = None
    phone: str | None = None
    service_radius_km: int | None = None
    priority: int = 2  # 1 = preferred, 2 = normal, 3 = backup
    notes: str | None = None


class ContractorCreate(ContractorBase):
    entity_id: UUID


class ContractorUpdate(BaseModel):
    """Partial update — every field optional so a PATCH only touches the
    keys the client supplies."""

    name: str | None = None
    company_name: str | None = None
    categories: list[str] | None = None
    email: str | None = None
    phone: str | None = None
    service_radius_km: int | None = None
    priority: int | None = None
    notes: str | None = None


class ContractorRead(ContractorBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    entity_id: UUID
    created_at: datetime
    updated_at: datetime
