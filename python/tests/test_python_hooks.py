"""
Python data-model hooks the lane-only tasks ask about, run against the frozen seed: the stock
ledger (atelier_core/support/stock_ledger.py), the comparisons @total_ordering fills in on Money,
and the __set_name__ hook of the notifiers' endpoint descriptor.
"""

import asyncio
import unittest

from atelier_app.state import seeded_state
from atelier_bench.support.abstract_notifier import AbstractNotifier
from atelier_core.support.stock_ledger import (
    Bin,
    Countable,
    Ledger,
    MovementTotals,
    Shelf,
    Sku,
    StockLevel,
    recount,
    recount_async,
    units_on_hand,
)


class StockLedgerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.parts = seeded_state().data.parts

    def test_recount_runs_every_hook(self) -> None:
        # Seed stock: SCR-13 4, BAT-55 1, KBD-EU 7, FAN-A1 2. BAT-55 drops to 0 (falsy), FAN-A1
        # rises to 5, and an unknown SKU is skipped by the `in` test.
        lines = recount(self.parts, [(" bat-55 ", -1), ("fan-a1", 3), ("nope-00", 9)])
        self.assertEqual(lines, ["SCR-13 x4", "KBD-EU x7", "FAN-A1 x5", "total 16"])

    def test_each_hook_on_its_own(self) -> None:
        self.assertEqual(Sku("  kbd-eu "), "KBD-EU")
        totals = MovementTotals()
        self.assertEqual(totals["SCR-13"], 0)
        self.assertNotIn("SCR-13", totals)
        ledger = Ledger(self.parts)
        self.assertIn("BAT-55", ledger)
        self.assertEqual(ledger.record("bat-55", 2), 3)
        self.assertEqual(ledger.open_sessions, 0)
        self.assertFalse(StockLevel("FAN-A1", 0))
        self.assertEqual(f"{StockLevel('FAN-A1', 2):>8}", "  FAN-A1")
        self.assertEqual(sum([StockLevel("SCR-13", 4), StockLevel("KBD-EU", 7)]), 11)
        self.assertEqual(StockLevel("SCR-13", 4) + 1, 5)

    def test_async_recount_enters_through_aenter(self) -> None:
        moved = asyncio.run(recount_async(self.parts, [("scr-13", -2), ("scr-13", 1), ("kbd-eu", 4)]))
        self.assertEqual(moved, {"SCR-13": -1, "KBD-EU": 4})


class ClassLevelHookTest(unittest.TestCase):
    def setUp(self) -> None:
        self.ledger = Ledger(seeded_state().data.parts)

    def test_metaclass_call_interns_bins(self) -> None:
        self.assertIs(self.ledger.bin_of("scr-13"), self.ledger.bin_of("SCR-99"))
        self.assertEqual(self.ledger.bin_of("kbd-eu").label, "KBD")
        self.assertIs(Bin("FAN"), Bin("FAN"))

    def test_class_getitem_names_a_shelf(self) -> None:
        shelf = Shelf["scr"]
        self.assertEqual(shelf.family, "SCR")

    def test_subclasshook_decides_isinstance(self) -> None:
        self.assertTrue(isinstance(StockLevel("SCR-13", 4), Countable))
        self.assertFalse(isinstance(Sku("SCR-13"), Countable))
        self.assertEqual(self.ledger.units(), 14)
        self.assertEqual(units_on_hand([StockLevel("FAN-A1", 2), "not countable"]), 2)

    def test_reversed_runs_the_ledger_hook(self) -> None:
        self.assertEqual(self.ledger.newest_first(), ["FAN-A1", "KBD-EU", "BAT-55", "SCR-13"])
        self.assertEqual([level.sku for level in self.ledger][0], "SCR-13")


class GeneratedComparisonTest(unittest.TestCase):
    def test_total_ordering_fills_in_ge_from_lt(self) -> None:
        screen, battery = seeded_state().data.parts[:2]
        self.assertTrue(screen.unit_price >= battery.unit_price)
        self.assertFalse(battery.unit_price >= screen.unit_price)


class SetNameHookTest(unittest.TestCase):
    def test_descriptor_learned_its_attribute_name(self) -> None:
        self.assertEqual(vars(AbstractNotifier)["endpoint"].private_name, "_endpoint_endpoint")


if __name__ == "__main__":
    unittest.main()
