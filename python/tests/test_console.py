import io
import unittest
from contextlib import redirect_stdout

from atelier_app.__main__ import main

from atelier_app.commands import parse_command, usage
from atelier_app.commands.export_report import export_report
from atelier_app.commands.recalculate_inventory import recalculate_inventory
from atelier_app.seed import metric_lines, rule_line, summarize
from atelier_app.state import seeded_state


class ConsoleTest(unittest.TestCase):
    def test_parse_command(self) -> None:
        self.assertEqual(parse_command(["serve", "9090"]).port, 9090)
        self.assertEqual(parse_command(["serve"]).port, 8080)
        self.assertEqual(parse_command(["report"]).slug, "gross-profit")
        self.assertEqual(parse_command(["report", "cash-flow"]).slug, "cash-flow")
        self.assertEqual(parse_command([]).kind, "help")
        self.assertTrue(usage().startswith("usage:"))

    def test_seed_and_export_and_recalculate(self) -> None:
        state = seeded_state()
        self.assertEqual(summarize(state), "seeded: 3 customer(s), 4 order(s), 4 part(s), revenue 58325c")
        self.assertEqual(len(metric_lines(state)), 16)
        self.assertEqual(rule_line(state), "rules: 48/48 satisfied")
        self.assertEqual(export_report(state, "gross-profit").splitlines()[2], "gross profit,120.25")
        self.assertTrue(export_report(state, "cash-flow", "md").startswith("| label |"))
        with self.assertRaises(ValueError):
            export_report(state, "gross-profit", "xlsx")
        self.assertEqual(recalculate_inventory(state), "recalculated 1 part(s)")

    def test_shared_command_names_run_the_commands(self) -> None:
        # export-report and recalculate-inventory are the shared set's command names; report and
        # recalculate are this lane's own spellings, kept as aliases that parse to the same command.
        self.assertEqual(parse_command(["export-report", "cash-flow"]).slug, "cash-flow")
        self.assertEqual(parse_command(["export-report"]).slug, "gross-profit")
        self.assertEqual(parse_command(["recalculate-inventory"]).kind, "recalculate")
        for spelling in ("export-report", "report"):
            out = io.StringIO()
            with redirect_stdout(out):
                self.assertEqual(main([spelling, "gross-profit"]), 0)
            self.assertEqual(out.getvalue().splitlines()[2], "gross profit,120.25", spelling)
        for spelling in ("recalculate-inventory", "recalculate"):
            out = io.StringIO()
            with redirect_stdout(out):
                self.assertEqual(main([spelling]), 0)
            self.assertEqual(out.getvalue(), "recalculated 1 part(s)\n", spelling)


if __name__ == "__main__":
    unittest.main()
