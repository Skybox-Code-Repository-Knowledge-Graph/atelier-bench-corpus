"""
Python data-model hooks the lane-only tasks ask about, run against the frozen seed: the stock
ledger (atelier_core/support/stock_ledger.py), the comparisons @total_ordering fills in on Money,
and the __set_name__ hook of the notifiers' endpoint descriptor.
"""

import ast
import asyncio
import inspect
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
    Aisle,
    Batteries,
    CountSheet,
    MovementKind,
    Screens,
    family_of,
    first_short,
    walk,
)

COMPREHENSIONS = (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)
NESTED_SCOPES = (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)


def function_scope_stores(function: ast.FunctionDef, name: str) -> list[str]:
    """How the function's own scope binds name: "parameter", "walrus" per :=, "store" per other binding.

    A comprehension's loop targets belong to the comprehension; a := inside one binds in the function.
    """
    found = ["parameter" for arg in function.args.args if arg.arg == name]

    def visit(node: ast.AST, in_comprehension: bool) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, NESTED_SCOPES):
                continue
            if isinstance(child, ast.NamedExpr) and child.target.id == name:
                found.append("walrus")
                visit(child.value, in_comprehension)
                continue
            if isinstance(child, ast.Name) and child.id == name and isinstance(child.ctx, ast.Store) and not in_comprehension:
                found.append("store")
            visit(child, in_comprehension or isinstance(child, COMPREHENSIONS))

    visit(function, False)
    return found


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


class ProtocolFallbackTest(unittest.TestCase):
    def test_truth_test_falls_back_to_len(self) -> None:
        # The key holds only while Ledger declares no __bool__ of its own.
        self.assertNotIn("__bool__", vars(Ledger))
        self.assertEqual(Ledger(seeded_state().data.parts).summary(), "4 SKU(s) on hand")
        self.assertEqual(Ledger([]).summary(), "nothing on hand")

    def test_for_loop_indexes_a_getitem_only_class(self) -> None:
        # The key holds only while Aisle declares no __iter__ of its own.
        self.assertNotIn("__iter__", vars(Aisle))
        self.assertEqual(walk(Aisle(["SCR-13", "KBD-EU"])), ["SCR-13", "KBD-EU"])

    def test_walrus_target_outlives_the_generator(self) -> None:
        # BAT-55 is the first level below 3 and FAN-A1 the other one. Were the list
        # comprehension's own `short` to leak, the result would name FAN-A1.
        levels = [StockLevel("SCR-13", 4), StockLevel("BAT-55", 1), StockLevel("FAN-A1", 2)]
        self.assertEqual(first_short(levels, 3), "BAT-55 (+1)")
        self.assertEqual(first_short(levels, 2), "BAT-55 (+0)")
        self.assertIsNone(first_short(levels, 1))

    def test_walrus_is_the_only_function_scope_binding(self) -> None:
        # The key's premise: inside first_short, `short` is bound in the function's scope by the
        # walrus alone; the list comprehension's `short` lives in the comprehension's own scope.
        tree = ast.parse(inspect.getsource(first_short))
        function = tree.body[0]
        assert isinstance(function, ast.FunctionDef)
        self.assertEqual(function_scope_stores(function, "short"), ["walrus"])

    def test_class_keyword_reaches_init_subclass(self) -> None:
        self.assertIs(family_of("scr-13"), Screens)
        self.assertEqual(Batteries.prefix, "BAT")
        self.assertIsNone(family_of("kbd-eu"))

    def test_auto_asks_generate_next_value(self) -> None:
        self.assertEqual([kind.value for kind in MovementKind], ["restock", "stock-take"])

    def test_prepare_binds_column_for_the_class_body(self) -> None:
        self.assertEqual((CountSheet.sku, CountSheet.counted), ("SKU", "COUNTED"))

    def test_del_runs_the_descriptor_delete(self) -> None:
        level = StockLevel("BAT-55", 1)
        level.reserved = 3
        self.assertEqual((level.reserved, level.release(), level.reserved), (3, 3, 0))
        level.reserved = -2
        self.assertEqual(level.reserved, 0)


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
