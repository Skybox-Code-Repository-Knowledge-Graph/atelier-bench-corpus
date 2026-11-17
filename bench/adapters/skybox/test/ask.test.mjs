// The skybox adapter against recorded replies: no skybox, no network. The reply texts below are
// copied from skybox 0.9.0 over MCP, trimmed.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { questionOf } from "../../lib/question.mjs";
import { askSkybox, isPathSegment, parseContextReply, parseCypherRow } from "../ask.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const AMBIGUOUS = `Ambiguous: 2 symbols match. Candidates:
Function:go/core/money/money.go:Sum:1, Sum, Function, go/core/money/money.go, 56, 62
Trait:rust/crates/atelier-core/src/money.rs:Sum, Sum, Trait, , , `;

const RESOLVED = `{
  "callees": [],
  "id": "Function:core/money/money.go:Sum:1",
  "name": "Sum"
}

---
**Next:** If planning changes, use impact({target: "Sum"}).`;

const CYPHER = `| n.filePath | n.startLine | n.endLine |
| --- | --- | --- |
| core/money/money.go | 56 | 62 |


*1 row(s)*`;

const question = (from, surface = "definition") => ({ id: "t", surface, from: { file: "f", needle: "n", line: 1, text: from.text ?? "", ...from } });

/** A fake tool: replies by tool name, records every call. */
function fake(replies) {
    const calls = [];
    const call = async (tool, args) => {
        calls.push({ tool, args });
        const reply = replies[tool];
        if (reply instanceof Error) {
            throw reply;
        }
        return reply;
    };
    return { call, calls };
}

test("the question carries no part of the answer key", () => {
    const tasks = JSON.parse(readFileSync(join(REPO_ROOT, "go", "bench", "tasks.json"), "utf8")).tasks;
    for (const task of tasks) {
        const asked = questionOf(task, join(REPO_ROOT, "go"));
        if (asked === null) {
            continue;
        }
        assert.deepEqual(Object.keys(asked).sort(), ["from", "id", "surface"], task.id);
        for (const key of Object.keys(asked.from)) {
            assert.ok(["file", "needle", "symbol", "occurrence", "line", "text"].includes(key), `${task.id}: ${key}`);
        }
        assert.ok(Object.isFrozen(asked) && Object.isFrozen(asked.from));
    }
});

test("context replies are parsed into their three kinds", () => {
    assert.deepEqual(parseContextReply("Symbol not found in index"), { kind: "not-found" });
    assert.deepEqual(parseContextReply(RESOLVED), { kind: "resolved", id: "Function:core/money/money.go:Sum:1" });
    assert.deepEqual(parseContextReply(AMBIGUOUS), {
        kind: "ambiguous",
        expected: 2,
        candidates: [
            { id: "Function:go/core/money/money.go:Sum:1", file: "go/core/money/money.go", startLine: 56, endLine: 62 },
            { id: "Trait:rust/crates/atelier-core/src/money.rs:Sum", file: null, startLine: null, endLine: null },
        ],
    });
    assert.equal(parseContextReply("something else").kind, "unknown");
    assert.deepEqual(parseCypherRow(CYPHER), { file: "core/money/money.go", startLine: 56, endLine: 62 });
    assert.equal(parseCypherRow("*0 row(s)*"), null);
});

test("a resolved symbol is located with one cypher lookup by id", async () => {
    const { call, calls } = fake({ context: RESOLVED, cypher: CYPHER });
    const answer = await askSkybox(question({ symbol: "Sum", text: "sum := money.Sum(xs)" }), call);
    assert.deepEqual(answer.locations, [{ file: "core/money/money.go", line: 56, end_line: 62 }]);
    assert.deepEqual(calls.map((entry) => entry.tool), ["context", "cypher"]);
    assert.deepEqual(calls[0].args, { name: "Sum" }, "context is asked by name only: no file, no kind");
    assert.match(calls[1].args.query, /WHERE n\.id = 'Function:core\/money\/money\.go:Sum:1'/);
});

test("an ambiguous reply returns every candidate, and counts the unlocated ones", async () => {
    const { call } = fake({ context: AMBIGUOUS });
    const answer = await askSkybox(question({ symbol: "Sum", text: "money.Sum(xs)" }), call);
    assert.deepEqual(answer.locations, [{ file: "go/core/money/money.go", line: 56, end_line: 62 }]);
    assert.equal(answer.unlocated, 1);
});

test("not found is an answer with no location; a failed call is an error", async () => {
    const missing = await askSkybox(question({ symbol: "ErrNotFound", text: "failure.ErrNotFound" }), fake({ context: "Symbol not found in index" }).call);
    assert.deepEqual(missing.locations, []);
    assert.equal(missing.status, undefined);

    const broken = await askSkybox(question({ symbol: "Sum", text: "Sum()" }), fake({ context: new Error("timed out after 60000 ms: tools/call") }).call);
    assert.equal(broken.status, "error");

    const garbled = await askSkybox(question({ symbol: "Sum", text: "Sum()" }), fake({ context: "a reply nobody expected" }).call);
    assert.equal(garbled.status, "error");

    const shortList = await askSkybox(question({ symbol: "Sum", text: "Sum()" }), fake({ context: AMBIGUOUS.replace("2 symbols", "3 symbols") }).call);
    assert.equal(shortList.status, "error", "a candidate list that does not parse in full is a harness error, not a skybox miss");
});

test("null symbols and import path segments are unsupported; other surfaces are not asked", async () => {
    const { call, calls } = fake({});
    assert.equal((await askSkybox(question({ symbol: null }), call)).status, "unsupported");
    assert.equal((await askSkybox(question({ symbol: "models", text: '\t"atelier.example/lane/core/models"' }), call)).status, "unsupported");
    assert.equal(await askSkybox(question({ symbol: "Sum", text: "Sum" }, "hover"), call), undefined);
    assert.equal(await askSkybox(question({ text: "Sum" }), call), undefined, "a task with no symbol is not asked");
    assert.equal(calls.length, 0);
});

test("a path segment is told apart from a string key and a plain identifier", () => {
    assert.equal(isPathSegment('\tmoneyfmt "atelier.example/lane/core/billing"', "billing"), true);
    assert.equal(isPathSegment("->middleware('record.visit')", "record.visit"), false);
    assert.equal(isPathSegment("sum := money.Sum(xs)", "Sum"), false);
    assert.equal(isPathSegment('fmt.Println("a/b", support)', "support"), false);
});
