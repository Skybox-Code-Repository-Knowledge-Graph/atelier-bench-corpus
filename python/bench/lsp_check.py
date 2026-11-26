"""
Run the lane's pinned language server over the hover, document_symbol, call_hierarchy and
implementation keys of bench/tasks.json, and write bench/lsp-check.md: one line per task, agrees /
disagrees / server has no answer, with what the server returned.

The server is pyright 1.1.414, pinned in requirements-dev.txt (the PyPI wheel bundles that pyright
build and runs it on the node found on PATH). It is a reference reading, never a source of keys:
where it and a key disagree, the tree decides, and the disagreement is written down (README, E.5).

Usage, from python/ after `pip install -r requirements-dev.txt`:
    python bench/lsp_check.py            # start the server, rewrite bench/lsp-check.md
    python bench/lsp_check.py --stdout   # print the report instead of writing it

Standard library only. tests/test_lsp_check.py replays recorded replies through the comparison
and report code below, so the suite exercises this file without starting the server.
"""

from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

LANE = Path(__file__).resolve().parent.parent
SURFACES = ("hover", "document_symbol", "call_hierarchy", "implementation")
REPORT = LANE / "bench" / "lsp-check.md"
BIN = Path(sys.executable).parent
SERVER = [str(BIN / "pyright-langserver"), "--stdio"]
VERSION_COMMAND = [str(BIN / "pyright"), "--version"]


def load_tasks() -> list[dict[str, Any]]:
    data = json.loads((LANE / "bench" / "tasks.json").read_text(encoding="utf-8"))
    return [task for task in data["tasks"] if task["surface"] in SURFACES]


def line_of(file: str, needle: str) -> int:
    """0-based line of the one line holding needle (the verifier guarantees there is one)."""
    lines = (LANE / file).read_text(encoding="utf-8").splitlines()
    hits = [number for number, text in enumerate(lines) if needle in text]
    if len(hits) != 1:
        raise ValueError(f"{file}: needle {needle!r} is on {len(hits)} lines")
    return hits[0]


def position(task: dict[str, Any]) -> tuple[str, int, int]:
    """File, 0-based line and 0-based column of the asked symbol (column 0 when there is none)."""
    origin = task["from"]
    line = line_of(origin["file"], origin["needle"])
    symbol = origin.get("symbol")
    if not symbol:
        return origin["file"], line, 0
    text = (LANE / origin["file"]).read_text(encoding="utf-8").splitlines()[line]
    column = -1
    for _ in range(origin.get("occurrence", 1)):
        column = text.index(symbol, column + 1)
    return origin["file"], line, column


def scrub(text: str) -> str:
    """Never let a machine path into the report: the lane root reads `.`, the home directory `~`."""
    return text.replace(str(LANE), ".").replace(str(Path.home()), "~")


def relative(uri: str) -> str:
    path = uri.removeprefix("file://")
    root = str(LANE) + "/"
    return path[len(root):] if path.startswith(root) else f"(outside the lane) {Path(path).name}"


def hover_text(reply: Any) -> str:
    if not reply:
        return ""
    contents = reply.get("contents", "")
    items = contents if isinstance(contents, list) else [contents]
    return "\n".join(item if isinstance(item, str) else str(item.get("value", "")) for item in items)


def symbol_names(reply: Any) -> list[str]:
    names: list[str] = []

    def walk(items: list[dict[str, Any]]) -> None:
        for item in items:
            names.append(item["name"])
            walk(item.get("children", []))

    walk(reply or [])
    return names


def verdict_hover(task: dict[str, Any], reply: Any) -> tuple[str, str]:
    text = hover_text(reply)
    if not text.strip():
        return "server has no answer", "empty hover"
    wanted = task["expect"]["contains"]
    shown = " ".join(text.split())[:160]
    if wanted in text:
        return "agrees", f"hover contains {wanted!r}"
    return "disagrees", f"hover lacks {wanted!r}; returned: {shown!r}"


def verdict_document_symbol(task: dict[str, Any], reply: Any) -> tuple[str, str]:
    names = symbol_names(reply)
    if not names:
        return "server has no answer", "no symbols"
    key = task["expect"]["symbols"]
    missing = sorted(set(key) - set(names))
    extra = sorted(set(names) - set(key))
    if not missing and not extra:
        return "agrees", f"{len(names)} names, the key's {len(key)}"
    return "disagrees", f"server lists {len(names)} names against the key's {len(key)}; key-only: {missing}; server-only: {extra}"


def verdict_call_hierarchy(task: dict[str, Any], calls: Any) -> tuple[str, str]:
    if not calls:
        return "server has no answer", "no calls returned"
    expect = task["expect"]
    if "outgoing_includes" in expect:
        returned = {(relative(call["to"]["uri"]), call["to"]["selectionRange"]["start"]["line"]) for call in calls}
        wanted = [(entry["file"], line_of(entry["file"], entry["needle"])) for entry in expect["outgoing_includes"]]
        missing = [f"{file}:{line + 1}" for file, line in wanted if (file, line) not in returned]
        shown = sorted(f"{file}:{line + 1}" for file, line in returned)
        noun = "callee"
    else:
        # A caller is returned with the ranges of its calls (fromRanges); pyright's caller item
        # range covers only the caller's name, so a call site is matched against fromRanges.
        sites = {(relative(call["from"]["uri"]), span["start"]["line"]) for call in calls for span in call.get("fromRanges", [])}
        wanted = [(entry["file"], line_of(entry["file"], entry["needle"])) for entry in expect["incoming_includes"]]
        missing = [f"{file}:{line + 1}" for file, line in wanted if (file, line) not in sites]
        shown = sorted(f"{file}:{line + 1}" for file, line in sites)
        noun = "call site"
    if missing:
        return "disagrees", f"listed {noun}(s) not returned: {missing}; returned: {shown}"
    return "agrees", f"every listed {noun} returned ({len(wanted)} listed, {len(calls)} returned)"


def verdict_implementation(task: dict[str, Any], reply: Any) -> tuple[str, str]:
    if isinstance(reply, dict) and "error" in reply:
        error = reply["error"]
        return "server has no answer", f"error {error.get('code')}: {error.get('message', '')}"
    if not reply:
        return "server has no answer", "no locations"
    returned = {(relative(item["uri"]), item["range"]["start"]["line"]) for item in reply}
    expect = task["expect"]
    wanted = {(entry["file"], line_of(entry["file"], entry["needle"])) for entry in expect["implementations"]}
    neutral = {(entry["file"], line_of(entry["file"], entry["needle"])) for key in ("optional_sites", "known_sites") for entry in expect.get(key, [])}
    missing = sorted(f"{file}:{line + 1}" for file, line in wanted - returned)
    extra = sorted(f"{file}:{line + 1}" for file, line in returned - wanted - neutral)
    if not missing and not extra:
        return "agrees", f"{len(wanted)} implementations"
    return "disagrees", f"key-only: {missing}; server-only: {extra}"


VERDICTS = {
    "hover": verdict_hover,
    "document_symbol": verdict_document_symbol,
    "call_hierarchy": verdict_call_hierarchy,
    "implementation": verdict_implementation,
}


# The tree's reading wherever the server does not agree with a key, written by hand from the source
# and the notes' counting rules (never from a tool under test). A key changes only when this
# reading finds it wrong; none did at the pinned server version.
READINGS = {
    "docsym-repair-order": "Key right by the notes' document-symbol rule: every one of its 18 names is in the server's list, and the server-only names are parameters, locals and attributes assigned through self, which the rule excludes (the task is UNSCORABLE in bench/score for this reason, issue #208).",
    "docsym-report-registry": "Key right by the same rule: all 8 key names are listed by the server, and its extra names key, name and slug are parameters (of metric, __getattr__, and report / load_report), which the rule excludes.",
    "implementation": "pyright implements no textDocument/implementation, so this surface has no server reading; the key lists the class statements read from the tree (nominal subclasses by their class statements, structural implementors and the virtual subclass by the notes' rules).",
}


def render(results: list[tuple[dict[str, Any], str, str]], version: str) -> str:
    counts = {name: sum(1 for _, verdict, _ in results if verdict == name) for name in ("agrees", "disagrees", "server has no answer")}
    lines = [
        "# Language-server check (python lane)",
        "",
        f"Server: {version} (`pyright==1.1.414` in requirements-dev.txt; the wheel bundles that build and runs it on node).",
        "Command: `python bench/lsp_check.py` from python/ with the lane's venv, which starts the venv's `pyright-langserver --stdio` (rootUri = python/, pythonPath = the venv interpreter).",
        "Keys are never changed to match the server: where the two disagree, the tree decides (README, E.5).",
        "",
        f"{len(results)} tasks: {counts['agrees']} agree, {counts['disagrees']} disagree, {counts['server has no answer']} with no answer from the server.",
        "",
    ]
    for task, verdict, detail in results:
        lines.append(f"- `{task['id']}` ({task['surface']}): {verdict}. {scrub(detail)}")
        reading = READINGS.get(task["id"]) or (READINGS.get(task["surface"]) if verdict != "agrees" else None)
        if verdict != "agrees" and reading:
            lines.append(f"  - Tree: {reading}")
    return "\n".join(lines) + "\n"


class Server:
    """A minimal JSON-RPC client over the server's stdio (Content-Length framing)."""

    def __init__(self, command: list[str]) -> None:
        env = dict(os.environ, PYRIGHT_PYTHON_IGNORE_WARNINGS="1")
        self.process = subprocess.Popen(command, cwd=LANE, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        self.replies: queue.Queue[dict[str, Any]] = queue.Queue()
        self.next_id = 0
        threading.Thread(target=self._read, daemon=True).start()

    def _send(self, message: dict[str, Any]) -> None:
        body = json.dumps(message).encode("utf-8")
        assert self.process.stdin is not None
        self.process.stdin.write(b"Content-Length: %d\r\n\r\n" % len(body) + body)
        self.process.stdin.flush()

    def _read(self) -> None:
        stream = self.process.stdout
        assert stream is not None
        while True:
            length = 0
            while (header := stream.readline()) not in (b"\r\n", b""):
                if header.lower().startswith(b"content-length:"):
                    length = int(header.split(b":")[1])
            if not header:
                return
            message = json.loads(stream.read(length))
            if "method" in message and "id" in message:
                self._answer(message)
            elif "id" in message:
                self.replies.put(message)

    def _answer(self, request: dict[str, Any]) -> None:
        result: Any = None
        if request["method"] == "workspace/configuration":
            result = [{"pythonPath": sys.executable} if item.get("section") == "python" else {} for item in request["params"]["items"]]
        self._send({"jsonrpc": "2.0", "id": request["id"], "result": result})

    def notify(self, method: str, params: dict[str, Any]) -> None:
        self._send({"jsonrpc": "2.0", "method": method, "params": params})

    def request(self, method: str, params: dict[str, Any]) -> Any:
        self.next_id += 1
        self._send({"jsonrpc": "2.0", "id": self.next_id, "method": method, "params": params})
        while True:
            reply = self.replies.get(timeout=180)
            if reply.get("id") == self.next_id:
                return {"error": reply["error"]} if "error" in reply else reply.get("result")

    def close(self) -> None:
        self.request("shutdown", {})
        self.notify("exit", {})
        self.process.wait(timeout=30)


def ask(server: Server, task: dict[str, Any]) -> Any:
    file, line, column = position(task)
    document = {"uri": (LANE / file).as_uri()}
    at = {"textDocument": document, "position": {"line": line, "character": column}}
    if task["surface"] == "hover":
        return server.request("textDocument/hover", at)
    if task["surface"] == "document_symbol":
        return server.request("textDocument/documentSymbol", {"textDocument": document})
    if task["surface"] == "implementation":
        return server.request("textDocument/implementation", at)
    items = server.request("textDocument/prepareCallHierarchy", at) or []
    direction = "callHierarchy/outgoingCalls" if "outgoing_includes" in task["expect"] else "callHierarchy/incomingCalls"
    calls: list[Any] = []
    for item in items if isinstance(items, list) else []:
        calls.extend(server.request(direction, {"item": item}) or [])
    return calls


def main(argv: list[str]) -> int:
    version = subprocess.run(VERSION_COMMAND, cwd=LANE, capture_output=True, text=True, env=dict(os.environ, PYRIGHT_PYTHON_IGNORE_WARNINGS="1")).stdout.strip()
    tasks = load_tasks()
    server = Server(SERVER)
    server.request("initialize", {
        "processId": os.getpid(),
        "rootUri": LANE.as_uri(),
        "workspaceFolders": [{"uri": LANE.as_uri(), "name": "python"}],
        "capabilities": {"textDocument": {
            "hover": {"contentFormat": ["plaintext", "markdown"]},
            "documentSymbol": {"hierarchicalDocumentSymbolSupport": True},
            "callHierarchy": {}, "implementation": {},
        }, "workspace": {"configuration": True}},
    })
    server.notify("initialized", {})
    opened: set[str] = set()
    results = []
    for task in tasks:
        file = task["from"]["file"]
        if file not in opened:
            text = (LANE / file).read_text(encoding="utf-8")
            server.notify("textDocument/didOpen", {"textDocument": {"uri": (LANE / file).as_uri(), "languageId": "python", "version": 1, "text": text}})
            opened.add(file)
        verdict, detail = VERDICTS[task["surface"]](task, ask(server, task))
        results.append((task, verdict, detail))
    server.close()
    report = render(results, version)
    if "--stdout" in argv:
        print(report, end="")
    else:
        REPORT.write_text(report, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
