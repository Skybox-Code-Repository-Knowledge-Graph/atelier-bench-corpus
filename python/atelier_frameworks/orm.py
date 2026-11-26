"""
SQLAlchemy 2.x declarative models of the seed's parts and their stock movements. Each column is
declared by a `Mapped[...]` annotation in the class body; `ForeignKey("parts.sku")` names the
column it points at as text, by the target table's __tablename__ and the column's attribute
name, and `relationship(back_populates=...)` names the attribute on the other side as text.
"""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import ForeignKey, Integer, String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship

from atelier_core import Part


class Base(DeclarativeBase):
    pass


class PartRow(Base):
    __tablename__ = "parts"

    sku: Mapped[str] = mapped_column(String(16), primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    unit_price_cents: Mapped[int] = mapped_column(Integer)
    stock: Mapped[int] = mapped_column(Integer)
    reorder_level: Mapped[int] = mapped_column(Integer)
    movements: Mapped[list[StockMovementRow]] = relationship(back_populates="part")


class StockMovementRow(Base):
    __tablename__ = "stock_movements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sku: Mapped[str] = mapped_column(ForeignKey("parts.sku"))
    quantity: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(80))
    part: Mapped[PartRow] = relationship(back_populates="movements")


def seeded_session(parts: Iterable[Part]) -> Session:
    """An in-memory SQLite session holding one row per part."""
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    session = Session(engine)
    session.add_all(
        PartRow(sku=part.sku, name=part.name, unit_price_cents=part.unit_price.cents, stock=part.stock, reorder_level=part.reorder_level)
        for part in parts
    )
    session.commit()
    return session


def low_stock_skus(session: Session) -> list[str]:
    rows = session.scalars(select(PartRow).where(PartRow.stock <= PartRow.reorder_level).order_by(PartRow.sku))
    return [row.sku for row in rows]
