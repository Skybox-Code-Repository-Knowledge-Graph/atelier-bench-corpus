"""
SQLAlchemy 2.x declarative model of the seed's parts. `PartRow.stock`, read on the class inside a
select(), is an instrumented column attribute: the `Mapped[int]` annotation in the class body
declares it, and no __init__ or assignment statement names it.
"""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import Integer, String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

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
