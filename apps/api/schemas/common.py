"""Shared Pydantic helpers."""

from pydantic import BaseModel, ConfigDict


class ApiModel(BaseModel):
    """Common Pydantic model config mixin."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
