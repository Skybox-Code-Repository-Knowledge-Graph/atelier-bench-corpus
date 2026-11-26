"""
Stock ledger: a recount of the seed's parts that runs through Python data-model hooks, each one
a protocol the interpreter calls on its own, with no call site that names the method:

- `Sku(raw)` builds the str subclass in `__new__` (str is immutable; there is no `__init__`);
- a with statement over a Ledger runs `Ledger.__enter__` and binds what it returns, a
  LedgerSession, not the Ledger; `async with` runs `__aenter__` the same way;
- `sku in ledger` runs `__contains__`;
- `moved[sku] += n` on a MovementTotals reads a missing key through `__missing__`;
- a StockLevel in an `if` runs `__bool__`, in an f-string with a format spec runs `__format__`,
  and `sum()` over levels starts from 0, so `int + StockLevel` falls back to `__radd__`.
"""

from __future__ import annotations

from collections.abc import Iterable
from types import TracebackType

from ..models.part import Part


class Sku(str):
    """A part number normalised once, on construction."""

    def __new__(cls, raw: str) -> Sku:
        return super().__new__(cls, raw.strip().upper())


class MovementTotals(dict[str, int]):
    """Net movement per SKU; a SKU nothing moved yet reads as 0 and is not stored by the read."""

    def __missing__(self, sku: str) -> int:
        return 0


class StockLevel:
    def __init__(self, sku: str, on_hand: int) -> None:
        self.sku = sku
        self.on_hand = on_hand

    def __bool__(self) -> bool:
        return self.on_hand > 0

    def __format__(self, spec: str) -> str:
        if spec == "units":
            return f"{self.sku} x{self.on_hand}"
        return format(self.sku, spec)

    def __add__(self, other: int) -> int:
        return self.on_hand + other

    def __radd__(self, other: int) -> int:
        return other + self.on_hand


class LedgerSession:
    def __init__(self, levels: dict[str, StockLevel]) -> None:
        self.levels = levels
        self.moved = MovementTotals()

    def record(self, sku: str, quantity: int) -> int:
        self.levels[sku].on_hand += quantity
        self.moved[sku] += quantity
        return self.levels[sku].on_hand


class Ledger:
    def __init__(self, parts: Iterable[Part]) -> None:
        self.levels = {part.sku: StockLevel(part.sku, part.stock) for part in parts}
        self.open_sessions = 0

    def record(self, sku: str, quantity: int = 1) -> int:
        """One movement in a session of its own."""
        with self as session:
            return session.record(Sku(sku), quantity)

    def __contains__(self, sku: object) -> bool:
        return sku in self.levels

    def __enter__(self) -> LedgerSession:
        self.open_sessions += 1
        return LedgerSession(self.levels)

    def __exit__(self, kind: type[BaseException] | None, error: BaseException | None, trace: TracebackType | None) -> None:
        self.open_sessions -= 1

    async def __aenter__(self) -> LedgerSession:
        self.open_sessions += 1
        return LedgerSession(self.levels)

    async def __aexit__(self, kind: type[BaseException] | None, error: BaseException | None, trace: TracebackType | None) -> None:
        self.open_sessions -= 1


def recount(parts: Iterable[Part], movements: Iterable[tuple[str, int]]) -> list[str]:
    """Apply movements of known SKUs in one session; list each SKU left on hand, then the total."""
    ledger = Ledger(parts)
    with ledger as session:
        for raw, quantity in movements:
            sku = Sku(raw)
            if sku in ledger:
                session.record(sku, quantity)
    stocked = [level for level in ledger.levels.values() if level]
    lines = [f"{level:units}" for level in stocked]
    return lines + [f"total {sum(stocked)}"]


async def recount_async(parts: Iterable[Part], movements: Iterable[tuple[str, int]]) -> dict[str, int]:
    """The same recount under `async with`; answers the net movement per SKU."""
    async with Ledger(parts) as session:
        for raw, quantity in movements:
            session.record(Sku(raw), quantity)
        return dict(session.moved)
