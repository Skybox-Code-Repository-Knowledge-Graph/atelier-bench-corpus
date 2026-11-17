// The skybox adapter against recorded replies: no skybox, no network. The reply texts below are
// copied from skybox 0.9.0 over MCP, trimmed.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { questionOf } from "../../lib/question.mjs";
import { askSkybox, isPathSegment, nameInIndex, parseContextReply, parseCypherRow, parseCypherValue } from "../ask.mjs";

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

/**
 * A fake tool: replies by tool name as `{ text, isError }`, records every call. A plain string reply
 * is unflagged; `{ text, isError: true }` replays a result the server flagged; an Error is thrown,
 * as a transport failure would be.
 */
function fake(replies) {
    const calls = [];
    const call = async (tool, args) => {
        calls.push({ tool, args });
        const stored = replies[tool];
        const reply = typeof stored === "function" ? stored(args) : stored;
        if (reply instanceof Error) {
            throw reply;
        }
        return typeof reply === "string" ? { text: reply, isError: false } : reply;
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
        assert.equal(asked.direction === null, task.surface !== "call_hierarchy", `${task.id}: direction only on call_hierarchy`);
        if (task.surface === "call_hierarchy") {
            const callers = Array.isArray(task.expect.incoming_includes) || task.expect.min_incoming !== undefined;
            assert.notEqual(callers, Array.isArray(task.expect.outgoing_includes), `${task.id}: a key asks one direction, not both`);
        }
        assert.equal(asked.direction === null, task.surface !== "call_hierarchy", `${task.id}: direction only on call_hierarchy`);
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

    const shuffled = AMBIGUOUS.replace(
        "Function:go/core/money/money.go:Sum:1, Sum, Function, go/core/money/money.go, 56, 62",
        "Function:b.go:Sum:1, Sum, Function, b.go, 9, 9\nFunction:a.go:Sum:1, Sum, Function, a.go, 3, 3",
    ).replace("2 symbols", "3 symbols");
    const ordered = await askSkybox(question({ symbol: "Sum", text: "Sum(xs)" }), fake({ context: shuffled }).call);
    assert.deepEqual(ordered.locations.map((location) => location.file), ["a.go", "b.go"], "candidates are written in a stable order");

    // Two candidates on one line, one with an end line and one without, in either reply order.
    const sameLine = (first, second) => `Ambiguous: 2 symbols match. Candidates:\n${first}\n${second}`;
    const withEnd = "Function:c.tsx:Card:1, Card, Function, c.tsx, 12, 20";
    const withoutEnd = "Class:c.tsx:Card, Card, Class, c.tsx, 12, ";
    const one = await askSkybox(question({ symbol: "Card", text: "<Card />" }), fake({ context: sameLine(withEnd, withoutEnd) }).call);
    const two = await askSkybox(question({ symbol: "Card", text: "<Card />" }), fake({ context: sameLine(withoutEnd, withEnd) }).call);
    assert.deepEqual(one, two, "ties on file and line are broken by end line");
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

test("skybox flags its negative answers as errors: those are answers, anything else flagged is an error", async () => {
    // skybox 0.9.0 sets isError on "Symbol not found in index" and on an ambiguous candidate list.
    const flaggedMissing = await askSkybox(question({ symbol: "ErrNotFound", text: "ErrNotFound" }),
        fake({ context: { text: "Symbol not found in index", isError: true } }).call);
    assert.deepEqual(flaggedMissing, { locations: [], note: "Symbol not found in index" });

    const flaggedAmbiguous = await askSkybox(question({ symbol: "Sum", text: "Sum(xs)" }),
        fake({ context: { text: AMBIGUOUS, isError: true } }).call);
    assert.equal(flaggedAmbiguous.status, undefined);
    assert.equal(flaggedAmbiguous.locations.length, 1);

    const flaggedOther = await askSkybox(question({ symbol: "Sum", text: "Sum(xs)" }),
        fake({ context: { text: "repo not registered", isError: true } }).call);
    assert.equal(flaggedOther.status, "error");
    assert.match(flaggedOther.detail, /repo not registered/);

    const flaggedCypher = await askSkybox(question({ symbol: "Sum", text: "Sum(xs)" }),
        fake({ context: RESOLVED, cypher: { text: "Parser exception", isError: true } }).call);
    assert.equal(flaggedCypher.status, "error");
});

test("null symbols are unsupported; path segments, other surfaces and missing symbols are not asked", async () => {
    const { call, calls } = fake({});
    assert.equal((await askSkybox(question({ symbol: null }), call)).status, "unsupported");
    assert.equal(await askSkybox(question({ symbol: "models", text: '\t"atelier.example/lane/core/models"' }), call), undefined);
    assert.equal(await askSkybox(question({ symbol: "Sum", text: "Sum" }, "references"), call), undefined);
    assert.equal(await askSkybox(question({ text: "Sum" }), call), undefined, "a task with no symbol is not asked");
    assert.equal(calls.length, 0);
});

/** A cypher reply in skybox 0.9.0's shape: header, separator, rows, two blank lines, row count, next-step footer. */
const TABLE = (header, ...rows) => [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.join(" | ")} |`), "", "", `*${rows.length} row(s)*`, "", "---", "**Next:** x"].join("\n");

const anchored = (surface, extra = {}) => ({
    id: "t", surface, kind: null, direction: null,
    from: { file: "core/money/money.go", needle: "func Sum(", line: 56, text: "func Sum(amounts []Money) Money {", symbol: "Sum" },
    ...extra,
});

test("anchored: skybox is asked within the from file, and the node at the from line is taken", async () => {
    const description = TABLE(["n.description"], ["// Sum folds any sequence of amounts into one. | with a bar"]);
    const signature = TABLE(["n.signature"], ["func Sum(amounts []Money) Money"]);
    const located = TABLE(["n.filePath", "n.startLine", "n.endLine"], ["core/money/money.go", "56", "62"]);
    const { call, calls } = fake({
        context: RESOLVED,
        cypher: (args) => (args.query.includes("n.description") ? description : args.query.includes("n.signature") ? signature : located),
    });
    const answer = await askSkybox(anchored("hover"), call);
    assert.deepEqual(calls[0].args, { name: "Sum", file_path: "core/money/money.go" }, "the from file is part of the question here");
    assert.equal(answer.text, "// Sum folds any sequence of amounts into one. | with a bar\nfunc Sum(amounts []Money) Money", "a | inside a value does not split it");
    assert.equal(answer.locations, undefined);

    // A use site: the from file declares no such name, so the name is resolved without the file.
    const { call: useCall, calls: useCalls } = fake({
        context: (args) => (args.file_path ? "Symbol not found in index" : RESOLVED),
        cypher: (args) => (args.query.includes("n.description") ? description : signature),
    });
    const atUse = await askSkybox(anchored("hover", { from: { file: "core/models/order.go", needle: "money.Sum(", line: 12, text: "total := money.Sum(xs)", symbol: "Sum" } }), useCall);
    assert.deepEqual(useCalls.slice(0, 2).map((entry) => entry.args), [{ name: "Sum", file_path: "core/models/order.go" }, { name: "Sum" }]);
    assert.match(atUse.text, /Sum folds/);

    // A use site whose name has several candidates elsewhere: no result, as under raw.
    const twoElsewhere = `Ambiguous: 2 symbols match. Candidates:
Function:a.go:Sum:1, Sum, Function, a.go, 3, 5
Function:b.go:Sum:1, Sum, Function, b.go, 7, 9`;
    const unclear = await askSkybox(anchored("hover"), fake({ context: (args) => (args.file_path ? "Symbol not found in index" : twoElsewhere) }).call);
    assert.deepEqual(unclear, { text: "", note: "ambiguous: 2 candidates, none declared in core/money/money.go" });
});

test("anchored: among several candidates the one starting at the from line wins; none there means no result", async () => {
    const twoInFile = `Ambiguous: 3 symbols match. Candidates:
Method:A:Error:1:core/failure/errors.go, Error, Method, core/failure/errors.go, 24, 27
Method:B:Error:1:core/failure/errors.go, Error, Method, core/failure/errors.go, 40, 43
Method:C:Error:1:other.go, Error, Method, other.go, 40, 43`;
    const question = { ...anchored("call_hierarchy", { direction: "callers" }), from: { file: "core/failure/errors.go", needle: "x", line: 40, text: "func (e *B) Error() string {", symbol: "Error" } };
    const rows = TABLE(["c.filePath", "c.startLine", "c.endLine"], ["app/a.go", "10", "20"], ["app/a.go", "10", "20"], ["app/b.go", "null", "null"]);
    const subject = TABLE(["n.filePath", "n.startLine", "n.endLine"], ["core/failure/errors.go", "40", "43"]);
    const cypher = (args) => (args.query.includes("CALLS") ? rows : subject);
    const { call, calls } = fake({ context: twoInFile, cypher });
    const answer = await askSkybox(question, call);
    assert.match(calls[2].args.query, /WHERE t\.id = 'Method:B:Error:1:core\/failure\/errors\.go' AND r\.type = 'CALLS'/, "callers: edges into the chosen node, CALLS only");
    assert.deepEqual(answer.locations, [{ file: "app/a.go", line: 10, end_line: 20 }, { file: "app/a.go", line: 10, end_line: 20 }]);
    assert.equal(answer.unlocated, 1);
    assert.equal(answer.note, "anchored in core/failure/errors.go to Method:B:Error:1:core/failure/errors.go, callers");

    const nowhere = await askSkybox({ ...question, from: { ...question.from, line: 99 } }, fake({ context: twoInFile }).call);
    assert.deepEqual(nowhere.locations, []);
    assert.match(nowhere.note, /none at core\/failure\/errors\.go:99/);

    const callees = await askSkybox({ ...question, direction: "callees" }, fake({ context: twoInFile, cypher }).call);
    assert.equal(callees.locations.length, 2);
    assert.equal(await askSkybox({ ...question, direction: null }, fake({ context: twoInFile, cypher }).call), undefined, "no direction, not asked");

    // call_hierarchy: a single node that does not cover the from line is another declaration.
    const elsewhere = TABLE(["n.filePath", "n.startLine", "n.endLine"], ["core/failure/errors.go", "80", "90"]);
    const moved = await askSkybox(question, fake({ context: RESOLVED, cypher: elsewhere }).call);
    assert.deepEqual(moved.locations, []);
    assert.match(moved.note, /which is not at core\/failure\/errors\.go:40$/);

    const missing = await askSkybox(anchored("hover"), fake({ context: "Symbol not found in index" }).call);
    assert.deepEqual(missing, { text: "", note: "Symbol not found in index" }, "not found in the file, then not found anywhere");
    assert.equal(parseCypherValue(TABLE(["n.description"], ["null"])), null);
});

test("a php sigil is dropped from the name skybox is asked, and only there", async () => {
    assert.equal(nameInIndex("$statusFilter"), "statusFilter");
    assert.equal(nameInIndex("statusFilter"), "statusFilter");
    assert.equal(nameInIndex("$"), "$");
    const { call, calls } = fake({ context: "Symbol not found in index" });
    await askSkybox({ id: "t", surface: "definition", kind: null, direction: null, from: { file: "a.php", needle: "x", line: 3, text: "echo $repairOrder->reference;", symbol: "$repairOrder" } }, call);
    assert.deepEqual(calls[0].args, { name: "repairOrder" });
    const anchoredCall = fake({ context: "Symbol not found in index" });
    await askSkybox({ id: "t", surface: "hover", kind: null, direction: null, from: { file: "a.php", needle: "x", line: 3, text: "public string $statusFilter = '';", symbol: "$statusFilter" } }, anchoredCall.call);
    assert.deepEqual(anchoredCall.calls.map((entry) => entry.args), [{ name: "statusFilter", file_path: "a.php" }, { name: "statusFilter" }]);
});

test("a cypher value that spans lines is read whole (recorded from skybox 0.9.0, atelier-rust)", () => {
    const recorded = "| n.description |\n| --- |\n| /// Build a technician with an empty [`Schedule`]; slot lookups on the\n/// result forward to its Schedule through `Deref`. |\n\n\n*1 row(s)*\n\n---\n**Next:** To explore a result symbol, use context({name: \"<name>\", repo: \"atelier-rust\"}). For schema reference, READ skybox://repo/atelier-rust/schema.";
    assert.equal(parseCypherValue(recorded), "/// Build a technician with an empty [`Schedule`]; slot lookups on the\n/// result forward to its Schedule through `Deref`.");
    assert.equal(parseCypherValue("*(no rows returned)*\n\n---\n**Next:** x"), null);
});

test("a path segment is told apart from a string key and a plain identifier", () => {
    assert.equal(isPathSegment('\tmoneyfmt "atelier.example/lane/core/billing"', "billing"), true);
    assert.equal(isPathSegment("->middleware('record.visit')", "record.visit"), false);
    assert.equal(isPathSegment("sum := money.Sum(xs)", "Sum"), false);
    assert.equal(isPathSegment('fmt.Println("a/b", support)', "support"), false);
    assert.equal(isPathSegment('\tcoresupport "atelier.example/lane/core/support"', "support"), true, "the whole identifier, not the tail of coresupport");
    assert.equal(isPathSegment("\tcoresupport.Priority", "support"), false);
});

test("a question whose answer is a relation is not asked under the raw protocol", async () => {
    const { call, calls } = fake({});
    const asked = { ...question({ symbol: "AdHocRule", text: "func (r AdHocRule) Evaluate() bool {" }, "resolution"), kind: "structural" };
    assert.equal(await askSkybox(asked, call), undefined);
    assert.equal(calls.length, 0);

    // The same kind on a definition task is a definition question, and is asked.
    const definition = { ...question({ symbol: "label", text: "return f'{super().label()}'" }, "definition"), kind: "mro" };
    const answer = await askSkybox(definition, fake({ context: "Symbol not found in index" }).call);
    assert.deepEqual(answer, { locations: [], note: "Symbol not found in index" });

    // A namespace import is answered by the member read through it, so it is not asked either.
    const namespace = { ...question({ symbol: "rules", text: "use crate::rules;" }, "import-precision"), kind: "namespace_import" };
    assert.equal(await askSkybox(namespace, call), undefined);
    const named = { ...question({ symbol: "Left", text: "use crate::support::pair::Left;" }, "import-precision"), kind: "imports" };
    assert.equal((await askSkybox(named, fake({ context: "Symbol not found in index" }).call)).locations.length, 0, "a named import is a definition question");
});
