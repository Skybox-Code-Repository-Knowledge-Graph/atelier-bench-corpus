"""
Every module specifier written anywhere in the lane resolves (issue #223, F.1).

py_compile never resolves an import, and mypy.ini sets ignore_missing_imports, so a broken
specifier under `if TYPE_CHECKING:` or in a docstring used to pass every gate. This test reads
each .py file of the three packages, tests/ and bench/ (fixtures/broken-syntax cannot parse, by
design) and resolves:

* every `import` and `from ... import` statement, wherever it sits (module level, inside a
  function, under `if TYPE_CHECKING:`), relative ones against the importing package, and every
  name a from-import binds (an attribute of the module, a submodule, or a name in `__all__`
  for a star import);
* every dotted `atelier_*` path (any top-level name, so a misspelt package is caught) written in
  a string (docstrings, importlib tables, the literal prefix of an f-string) or a comment: the
  longest importable prefix is the module, the rest must be attributes of it;
* the literal prefix (up to its last dot) of the first argument of every `import_module(...)`
  call, and every dotted string held in a module-path table (an assignment to a name containing
  `MODULES`), whatever package it names: it must resolve as a module;
* every `.py` path written in any string constant or comment (atelier_core/support/schedule.py
  names its forwarding mixin by such a path): it must match a file, read from the writing file's
  directory or any directory above it up to the lane root, where `*` is a glob and a brace list
  is expanded, every alternative having to match.
"""

import ast
import importlib
import importlib.util
import io
import re
import tokenize
import unittest
from pathlib import Path

LANE_ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIRS = ("atelier_core", "atelier_bench", "atelier_app", "tests", "bench")
DOTTED = re.compile(r"\batelier_[A-Za-z0-9_]+(?:\.[A-Za-z_][A-Za-z0-9_]*)+")
PY_PATH = re.compile(r"(?:[A-Za-z0-9_*./-]|\{[A-Za-z0-9_*./,-]*\})*[A-Za-z0-9_*}]\.py\b")
MODULE_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+")


def is_import_module(func: ast.expr) -> bool:
    return (isinstance(func, ast.Attribute) and func.attr == "import_module") or (isinstance(func, ast.Name) and func.id == "import_module")


def literal_module(arg: ast.expr) -> str:
    """The module named by a literal first argument, or by an f-string's literal prefix up to its last dot."""
    if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
        return arg.value
    if isinstance(arg, ast.JoinedStr) and arg.values and isinstance(arg.values[0], ast.Constant) and isinstance(arg.values[0].value, str):
        return arg.values[0].value.rpartition(".")[0]
    return ""


def module_table(node: ast.Assign | ast.AnnAssign) -> bool:
    targets = node.targets if isinstance(node, ast.Assign) else [node.target]
    return any(isinstance(t, ast.Name) and "MODULES" in t.id for t in targets)


def lane_sources() -> list[Path]:
    return sorted(p for d in SOURCE_DIRS for p in (LANE_ROOT / d).rglob("*.py") if "__pycache__" not in p.parts)


def package_of(path: Path) -> str:
    parts = path.relative_to(LANE_ROOT).with_suffix("").parts
    return ".".join(parts[:-1])


def module_exists(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def binds(module_name: str, name: str) -> bool:
    module = importlib.import_module(module_name)
    return hasattr(module, name) or module_exists(f"{module_name}.{name}")


def resolve_dotted(path: str) -> bool:
    parts = path.split(".")
    for cut in range(len(parts), 0, -1):
        if module_exists(".".join(parts[:cut])):
            target: object = importlib.import_module(".".join(parts[:cut]))
            for attribute in parts[cut:]:
                if not hasattr(target, attribute):
                    return False
                target = getattr(target, attribute)
            return True
    return False


def expand_braces(written: str) -> list[str]:
    match = re.search(r"\{([^{}]*)\}", written)
    if match is None:
        return [written]
    return [
        expanded
        for option in match.group(1).split(",")
        for expanded in expand_braces(written[: match.start()] + option + written[match.end() :])
    ]


def resolve_py_path(source: Path, written: str) -> bool:
    return all(resolve_one_py_path(source, alternative) for alternative in expand_braces(written))


def resolve_one_py_path(source: Path, written: str) -> bool:
    directory = source.parent
    while True:
        if any(directory.glob(written)):
            return True
        if directory == LANE_ROOT:
            return False
        directory = directory.parent


def check_file(path: Path) -> tuple[int, list[str]]:
    """Returns (specifiers checked, problems) for one file."""
    text = path.read_text(encoding="utf-8")
    tree = ast.parse(text)
    where = path.relative_to(LANE_ROOT)
    checked = 0
    problems: list[str] = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                checked += 1
                if not module_exists(alias.name):
                    problems.append(f"{where}:{node.lineno}: import {alias.name} (no such module)")
        elif isinstance(node, ast.ImportFrom):
            module_name = importlib.util.resolve_name("." * node.level + (node.module or ""), package_of(path)) if node.level else node.module or ""
            checked += 1
            if not module_exists(module_name):
                problems.append(f"{where}:{node.lineno}: from {'.' * node.level}{node.module or ''} (no such module {module_name})")
                continue
            for alias in node.names:
                checked += 1
                if alias.name == "*":
                    exported = getattr(importlib.import_module(module_name), "__all__", None)
                    if exported is None or not all(binds(module_name, name) for name in exported):
                        problems.append(f"{where}:{node.lineno}: from {module_name} import * (no __all__, or a name in it is missing)")
                elif not binds(module_name, alias.name):
                    problems.append(f"{where}:{node.lineno}: from {module_name} import {alias.name} (no such name)")

    prose: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            for match in DOTTED.finditer(node.value):
                checked += 1
                if not resolve_dotted(match.group(0)):
                    problems.append(f"{where}:{node.lineno}: string names {match.group(0)} (does not resolve)")
            prose.append((node.lineno, node.value))
        elif isinstance(node, ast.Call) and is_import_module(node.func) and node.args:
            prefix = literal_module(node.args[0])
            if prefix:
                checked += 1
                if not resolve_dotted(prefix):
                    problems.append(f"{where}:{node.lineno}: import_module names {prefix} (does not resolve)")
        elif isinstance(node, (ast.Assign, ast.AnnAssign)) and node.value is not None and module_table(node):
            for item in ast.walk(node.value):
                if isinstance(item, ast.Constant) and isinstance(item.value, str) and MODULE_NAME.fullmatch(item.value):
                    checked += 1
                    if not resolve_dotted(item.value):
                        problems.append(f"{where}:{item.lineno}: module table names {item.value} (does not resolve)")
    for token in tokenize.generate_tokens(io.StringIO(text).readline):
        if token.type == tokenize.COMMENT:
            for match in DOTTED.finditer(token.string):
                checked += 1
                if not resolve_dotted(match.group(0)):
                    problems.append(f"{where}:{token.start[0]}: comment names {match.group(0)} (does not resolve)")
            prose.append((token.start[0], token.string))
    for line, chunk in prose:
        for match in PY_PATH.finditer(chunk):
            checked += 1
            if not resolve_py_path(path, match.group(0)):
                problems.append(f"{where}:{line}: prose names {match.group(0)} (no such file)")
    return checked, problems


class ModuleSpecifierTest(unittest.TestCase):
    def test_every_specifier_in_the_lane_resolves(self) -> None:
        sources = lane_sources()
        total = 0
        problems: list[str] = []
        for path in sources:
            checked, found = check_file(path)
            total += checked
            problems.extend(found)
        self.assertEqual(problems, [])
        self.assertGreater(len(sources), 200)
        self.assertGreater(total, 1000)

    def test_the_checks_bite(self) -> None:
        source = LANE_ROOT / "atelier_core" / ("__init__" + ".py")
        suffix = "." + "py"
        brace = "{" + ",".join(["forwards_to_schedule", "has_reference"]) + "}"
        ghost = "{" + ",".join(["has_reference", "ghost_concern"]) + "}"
        self.assertTrue(resolve_py_path(source, "concerns/" + brace + suffix))
        self.assertFalse(resolve_py_path(source, "concerns/" + ghost + suffix))
        self.assertEqual(len(PY_PATH.findall("see concerns/" + ghost + suffix + " now")), 1)
        self.assertFalse(resolve_py_path(source, "concerns/ghost_module" + suffix))
        misspelt = ast.parse("importlib.import_module(f'atelier_" + "bnech.reports.{slug}')", mode="eval").body
        assert isinstance(misspelt, ast.Call)
        self.assertTrue(is_import_module(misspelt.func))
        self.assertEqual(literal_module(misspelt.args[0]), "atelier_" + "bnech.reports")
        self.assertFalse(resolve_dotted(literal_module(misspelt.args[0])))
        self.assertTrue(resolve_dotted(literal_module(ast.parse("m(f'atelier_bench.reports.{s}')", mode="eval").body.args[0])))  # type: ignore[attr-defined]


if __name__ == "__main__":
    unittest.main()
