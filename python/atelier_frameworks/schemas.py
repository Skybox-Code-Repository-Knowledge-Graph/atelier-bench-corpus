"""
Pydantic models of the parts API. A field is declared by an annotation in the BaseModel class
body: the model class builds __init__ and validation from those annotations, so a read of
`adjustment.quantity` lands on the annotated line, and `@field_validator("reason")` binds a
validator to a field by naming it in a string.
"""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class PartOut(BaseModel):
    sku: str
    name: str
    unit_price_cents: int
    stock: int
    low_stock: bool


class StockAdjustment(BaseModel):
    quantity: int = Field(gt=0, le=100)
    reason: str

    @field_validator("reason")
    @classmethod
    def reason_is_given(cls, value: str) -> str:
        reason = value.strip()
        if not reason:
            raise ValueError("a stock adjustment needs a reason")
        return reason
