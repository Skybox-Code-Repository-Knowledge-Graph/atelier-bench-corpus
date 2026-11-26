"""
Stock ledger: a recount of the seed's parts that runs through Python data-model hooks, each one
a protocol the interpreter calls on its own, with no call site that names the method:

- `Sku(raw)` builds the str subclass in `__new__` (str is immutable; there is no `__init__`);
- a with statement over a Ledger runs `Ledger.__enter__` and binds what it returns, a
  LedgerSession, not the Ledger; `async with` runs `__aenter__` the same way;
- `sku in ledger` runs `__contains__`;
- `moved[sku] += n` on a MovementTotals reads a missing key through `__missing__`;
- a StockLevel in an `if` runs `__bool__`, in an f-string with a format spec runs `__format__`,
  and `sum()` over levels starts from 0, so `int + StockLevel` falls back to `__radd__`;
- calling Bin runs its metaclass's `__call__`, subscripting the Shelf class runs
  `__class_getitem__`, an isinstance test against Countable asks its `__subclasshook__`, and the
  reversed() builtin over a Ledger runs `__reversed__`.
"""

from __future__ import annotations

from abc import ABC
from collections.abc import Iterable, Iterator
from types import TracebackType
from typing import Any

from ..models.part import Part


class Sku(str):
    """A part number normalised once, on construction."""

    def __new__(cls, raw: str) -> Sku:
        return super().__new__(cls, raw.strip().upper())


class MovementTotals(dict[str, int]):
    """Net movement per SKU; a SKU nothing moved yet reads as 0 and is not stored by the read."""

    def __missing__(self, sku: str) -> int:
        return 0


class Interned(type):
    """Calling a class built by this metaclass runs this __call__ first: one instance per label."""

    def __call__(cls, *args: Any, **kwargs: Any) -> Any:
        key = (cls, args, tuple(sorted(kwargs.items())))
        if key not in _INTERNED:
            _INTERNED[key] = super().__call__(*args, **kwargs)
        return _INTERNED[key]


_INTERNED: dict[tuple[Any, ...], Any] = {}


class Bin(metaclass=Interned):
    """A storage bin, named by the first three letters of the SKUs it holds."""

    def __init__(self, label: str) -> None:
        self.label = label


class Shelf:
    """`Shelf["scr"]` names the shelf of one part family: subscripting the class runs __class_getitem__."""

    def __init__(self, family: str) -> None:
        self.family = family

    def __class_getitem__(cls, family: str) -> Shelf:
        return cls(family.strip().upper())


class Countable(ABC):
    """Anything that annotates an on_hand count is Countable: no base class or registration needed."""

    on_hand: int

    @classmethod
    def __subclasshook__(cls, candidate: type) -> bool:
        return "on_hand" in getattr(candidate, "__annotations__", {})


def units_on_hand(items: Iterable[object]) -> int:
    return sum(item.on_hand for item in items if isinstance(item, Countable))


class StockLevel:
    sku: str
    on_hand: int

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

    def bin_of(self, sku: str) -> Bin:
        return Bin(Sku(sku)[:3])

    def newest_first(self) -> list[str]:
        return [level.sku for level in reversed(self)]

    def units(self) -> int:
        return units_on_hand(self.levels.values())

    def __iter__(self) -> Iterator[StockLevel]:
        return iter(self.levels.values())

    def __reversed__(self) -> Iterator[StockLevel]:
        return reversed(list(self.levels.values()))

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
