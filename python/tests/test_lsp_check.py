"""
bench/lsp_check.py's comparison and report code, replayed on recorded server replies shaped like
pyright's (no server is started here; the live run writes bench/lsp-check.md and is not part of
the suite, because it needs node).
"""

import importlib.util
import json
import unittest
from pathlib import Path

LANE = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("lsp_check", LANE / "bench/lsp_check.py")
assert SPEC is not None and SPEC.loader is not None
lsp_check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lsp_check)

TASKS = {task["id"]: task for task in json.loads((LANE / "bench" / "tasks.json").read_text(encoding="utf-8"))["tasks"]}


def at(file: str, needle: str) -> dict:
    line = lsp_check.line_of(file, needle)
    return {"start": {"line": line, "character": 0}, "end": {"line": line, "character": 1}}


def uri(file: str) -> str:
    return (LANE / file).as_uri()


VERDICTS = ("agrees", "disagrees", "server has no answer")


def report_is_consistent(report: str) -> bool:
    """The counts line equals the tally of the verdict lines, and every disagreement carries a tree reading."""
    lines = report.splitlines()
    verdicts = [line.split("): ", 1)[1].split(". ", 1)[0] for line in lines if line.startswith("- `")]
    if any(verdict not in VERDICTS for verdict in verdicts):
        return False
    tally = {name: verdicts.count(name) for name in VERDICTS}
    counts = f"{len(verdicts)} tasks: {tally['agrees']} agree, {tally['disagrees']} disagree, {tally['server has no answer']} with no answer from the server."
    readings = all(
        lines[index + 1].startswith("  - Tree: ")
        for index, line in enumerate(lines)
        if line.startswith("- `") and "): agrees." not in line
    )
    return counts in lines and readings


class LspCheckReplayTest(unittest.TestCase):
    def test_the_four_surfaces_are_selected(self) -> None:
        surfaces = {task["surface"] for task in lsp_check.load_tasks()}
        self.assertEqual(surfaces, {"hover", "document_symbol", "call_hierarchy", "implementation"})

    def test_position_finds_the_asked_symbol(self) -> None:
        file, line, column = lsp_check.position(TASKS["hover-free-function"])
        text = (LANE / file).read_text(encoding="utf-8").splitlines()[line]
        self.assertTrue(text[column:].startswith("atelier_format_reference"))
        self.assertEqual(lsp_check.position(TASKS["docsym-repair-order"])[2], 0)

    def test_hover(self) -> None:
        task = TASKS["hover-free-function"]
        self.assertEqual(lsp_check.verdict_hover(task, {"contents": {"kind": "markdown", "value": "pads to the zero-padded width"}})[0], "agrees")
        self.assertEqual(lsp_check.verdict_hover(task, {"contents": ["(function) atelier_format_reference"]})[0], "disagrees")
        self.assertEqual(lsp_check.verdict_hover(task, None)[0], "server has no answer")

    def test_document_symbol(self) -> None:
        task = TASKS["docsym-report-registry"]
        names = task["expect"]["symbols"]
        exact = [{"name": names[0], "children": [{"name": name} for name in names[1:]]}]
        self.assertEqual(lsp_check.verdict_document_symbol(task, exact)[0], "agrees")
        verdict, detail = lsp_check.verdict_document_symbol(task, exact + [{"name": "slug"}])
        self.assertEqual(verdict, "disagrees")
        self.assertIn("server-only: ['slug']", detail)
        self.assertEqual(lsp_check.verdict_document_symbol(task, [])[0], "server has no answer")

    def test_call_hierarchy_both_directions(self) -> None:
        outgoing = TASKS["hierarchy-complete-chain"]
        callee = outgoing["expect"]["outgoing_includes"][0]
        self.assertEqual(lsp_check.verdict_call_hierarchy(outgoing, [{"to": {"uri": uri(callee["file"]), "selectionRange": at(callee["file"], callee["needle"])}}])[0], "agrees")
        incoming = TASKS["hierarchy-incoming-transition"]
        sites = incoming["expect"]["incoming_includes"]
        calls = [{"from": {"uri": uri(site["file"])}, "fromRanges": [at(site["file"], site["needle"])]} for site in sites]
        self.assertEqual(lsp_check.verdict_call_hierarchy(incoming, calls)[0], "agrees")
        self.assertEqual(lsp_check.verdict_call_hierarchy(incoming, calls[1:])[0], "disagrees")
        self.assertEqual(lsp_check.verdict_call_hierarchy(incoming, [])[0], "server has no answer")

    def test_implementation(self) -> None:
        task = TASKS["impl-notifier-contract"]
        unhandled = {"error": {"code": -32601, "message": "Unhandled method textDocument/implementation"}}
        self.assertEqual(lsp_check.verdict_implementation(task, unhandled), ("server has no answer", "error -32601: Unhandled method textDocument/implementation"))
        found = [{"uri": uri(entry["file"]), "range": at(entry["file"], entry["needle"])} for entry in task["expect"]["implementations"] + task["expect"]["optional_sites"]]
        self.assertEqual(lsp_check.verdict_implementation(task, found)[0], "agrees")
        self.assertEqual(lsp_check.verdict_implementation(task, found[1:])[0], "disagrees")

    def test_report_is_lane_relative_and_carries_the_tree_reading(self) -> None:
        self.assertEqual(lsp_check.relative(uri("atelier_core/money.py")), "atelier_core/money.py")
        self.assertEqual(lsp_check.relative("file:///opt/typeshed/builtins.pyi"), "(outside the lane) builtins.pyi")
        task = TASKS["docsym-repair-order"]
        report = lsp_check.render([(task, "disagrees", f"seen under {LANE}"), (TASKS["hover-frozen-seed"], "agrees", "ok")], "pyright 1.1.414")
        self.assertIn("2 tasks: 1 agree, 1 disagree, 0 with no answer from the server.", report)
        self.assertIn("  - Tree: Key right by the notes' document-symbol rule", report)
        self.assertNotIn(str(LANE), report)

    def test_committed_report_matches_the_task_list(self) -> None:
        report = (LANE / "bench" / "lsp-check.md").read_text(encoding="utf-8")
        ids = [task["id"] for task in lsp_check.load_tasks()]
        self.assertEqual([line.split("`")[1] for line in report.splitlines() if line.startswith("- `")], ids)
        self.assertNotIn(str(Path.home()), report)
        self.assertTrue(report_is_consistent(report))
        for line in report.splitlines():
            if line.startswith("- `impl-"):
                self.assertIn("server has no answer. error -32601", line)

    def test_a_flipped_verdict_is_caught(self) -> None:
        report = (LANE / "bench" / "lsp-check.md").read_text(encoding="utf-8")
        flipped = report.replace("(hover): agrees.", "(hover): disagrees.", 1)
        self.assertNotEqual(flipped, report)
        self.assertFalse(report_is_consistent(flipped))
        relabelled = report.replace("(document_symbol): disagrees.", "(document_symbol): agrees.", 1)
        self.assertFalse(report_is_consistent(relabelled))


if __name__ == "__main__":
    unittest.main()
