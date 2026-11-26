"""
FastAPI routes over the seed's parts, in FastAPI's own convention: path operations are registered
by `@router.get(...)` / `@router.post(...)` decorators on an APIRouter (the route string sits on
the decorator, the handler is the def under it), the request body is a Pydantic model, and the
SQLAlchemy session is injected with Depends.

No `from __future__ import annotations` here: FastAPI reads the handlers' annotations at runtime.
"""

from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, HTTPException
from sqlalchemy.orm import Session

from atelier_app.state import seeded_state

from .orm import PartRow, low_stock_skus, seeded_session
from .schemas import PartOut, StockAdjustment

router = APIRouter(prefix="/api/parts")


def parts_session() -> Iterator[Session]:
    session = seeded_session(seeded_state().data.parts)
    try:
        yield session
    finally:
        session.close()


SessionDep = Annotated[Session, Depends(parts_session)]


def part_out(row: PartRow) -> PartOut:
    return PartOut(sku=row.sku, name=row.name, unit_price_cents=row.unit_price_cents, stock=row.stock, low_stock=row.stock <= row.reorder_level)


@router.get("/low-stock")
def list_low_stock(session: SessionDep) -> list[str]:
    return low_stock_skus(session)


@router.get("/{sku}")
def show_part(sku: str, session: SessionDep) -> PartOut:
    row = session.get(PartRow, sku)
    if row is None:
        raise HTTPException(status_code=404, detail=f"unknown part {sku}")
    return part_out(row)


@router.post("/{sku}/adjustments")
def adjust_stock(sku: str, adjustment: StockAdjustment, session: SessionDep) -> PartOut:
    row = session.get(PartRow, sku)
    if row is None:
        raise HTTPException(status_code=404, detail=f"unknown part {sku}")
    row.stock += adjustment.quantity
    session.commit()
    return part_out(row)


def create_api() -> FastAPI:
    api = FastAPI(title="atelier parts")
    api.include_router(router)
    return api
