// The queried symbol (`from.symbol`, `from.occurrence`) is checked here, not in the lane verifiers,
// which read `file` and `needle` only.
//
// A symbol that is stated wrongly fails at once: not on the `from` line, a bad occurrence, or stated
// on a task that asks about a file. A symbol that is missing is only counted while the lanes are
// being annotated; set STRICT to true once every lane states it, and a missing one fails as well.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LANES } from "../lib/plan.mjs";
import { fileLines, isFileNeedle, resolveNeedle } from "../lib/resolve.mjs";
import { FILE_LEVEL_SURFACES, checkSymbol, symbolColumn, symbolColumns } from "../lib/symbol.mjs";

const STRICT = false;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("occurrences are whole identifiers", () => {
    assert.deepEqual(symbolColumns("sum := money.Sum(checkSum, SumTotal, Sum)", "Sum"), [13, 37]);
    assert.deepEqual(symbolColumns("$order->customer->display_name", "display_name"), [18]);
    assert.deepEqual(symbolColumns("return $order->total($order);", "$order"), [7, 21]);
    assert.deepEqual(symbolColumns("->middleware('record.visit')", "record.visit"), [14]);
    assert.deepEqual(symbolColumns("use crate::contracts::report_contract::*;", "report_contract"), [22]);
    assert.deepEqual(symbolColumns("anything", ""), []);
});

test("symbolColumn points at the stated occurrence", () => {
    const line = "sum := money.Sum(checkSum, SumTotal, Sum)";
    assert.equal(symbolColumn(line, { symbol: "Sum" }), 13);
    assert.equal(symbolColumn(line, { symbol: "Sum", occurrence: 2 }), 37);
    assert.equal(symbolColumn(line, { symbol: "Sum", occurrence: 3 }), -1);
    assert.equal(symbolColumn(line, { symbol: null }), -1);
    assert.equal(symbolColumn(line, {}), -1);
});

test("checkSymbol accepts what is consistent and names what is not", () => {
    const line = "sum := money.Sum(a, money.FromCents(100), money.FromCents(250))";
    const task = (from, surface = "definition") => ({ id: "t", surface, from: { file: "f", needle: "n", ...from } });

    assert.deepEqual(checkSymbol(task({ symbol: "Sum" }), line), { state: "symbol", problems: [] });
    assert.deepEqual(checkSymbol(task({ symbol: "FromCents", occurrence: 2 }), line), { state: "symbol", problems: [] });
    assert.deepEqual(checkSymbol(task({ symbol: null }), line), { state: "null", problems: [] });
    assert.deepEqual(checkSymbol(task({}), line), { state: "missing", problems: [] });
    assert.deepEqual(checkSymbol(task({}, "hover"), line).state, "missing");
    assert.deepEqual(checkSymbol(task({}, "document_symbol"), line), { state: "file-level", problems: [] });

    const bad = (from, surface) => checkSymbol(task(from, surface), line).problems.length;
    assert.equal(bad({ symbol: "Total" }), 1, "not on the line");
    assert.equal(bad({ symbol: "money.Sum" }), 0, "a dotted key is matched as written");
    assert.equal(bad({ symbol: "two words" }), 1, "not one identifier");
    assert.equal(bad({ symbol: "" }), 1, "empty");
    assert.equal(bad({ symbol: "FromCents", occurrence: 3 }), 1, "occurrence past the last");
    assert.equal(bad({ symbol: "FromCents", occurrence: 0 }), 1, "occurrence below one");
    assert.equal(bad({ symbol: "Sum", occurrence: 1 }), 0, "a redundant occurrence of 1 is allowed");
    assert.equal(bad({ symbol: null, occurrence: 1 }), 1, "occurrence beside null");
    assert.equal(bad({ occurrence: 1 }), 1, "occurrence without a symbol");
    assert.equal(bad({ symbol: "Sum" }, "parse-negative"), 1, "a file-level task states a symbol");
});

for (const lane of LANES) {
    test(`every stated from.symbol is on its from line: ${lane}`, (t) => {
        const root = join(REPO_ROOT, lane);
        const tasks = JSON.parse(readFileSync(join(root, "bench", "tasks.json"), "utf8")).tasks;
        const counts = { symbol: 0, null: 0, missing: 0, "file-level": 0 };
        const problems = [];
        const missing = [];

        for (const task of tasks) {
            let line = "";
            if (isFileNeedle(task.from)) {
                const resolved = resolveNeedle(root, task.from);
                if (resolved.ok) {
                    line = fileLines(root, task.from.file)[resolved.line - 1];
                } else if (!FILE_LEVEL_SURFACES.has(task.surface) && Object.hasOwn(task.from, "symbol")) {
                    problems.push(`${task.id}: from does not resolve (${resolved.reason}), so its symbol cannot be checked`);
                    continue;
                }
            }

            const outcome = checkSymbol(task, line);
            counts[outcome.state] += 1;
            if (outcome.state === "missing") {
                missing.push(task.id);
            }
            for (const problem of outcome.problems) {
                problems.push(`${task.id}: ${problem}`);
            }
        }

        const symbolLevel = tasks.length - counts["file-level"];
        t.diagnostic(`${lane}: ${counts.symbol} with a symbol, ${counts.null} explicit null, ${counts.missing} missing, of ${symbolLevel} symbol-level tasks`);
        assert.deepEqual(problems, [], `${lane}: ${problems.length} wrong from.symbol`);
        if (STRICT) {
            assert.deepEqual(missing, [], `${lane}: ${missing.length} task(s) state no from.symbol`);
        }
    });
}
