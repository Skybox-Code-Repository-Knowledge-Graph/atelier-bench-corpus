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
    assert.equal(await askSkybox(question({ symbol: "Sum", text: "Sum" }, "rename"), call), undefined);
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

test("anchored: every node that starts at the from line is the subject, in id order, whatever order skybox lists them", async () => {
    const rowsOf = (lines) => TABLE(["c.filePath", "r.callSiteLine", "c.startLine", "c.endLine"], ...lines.map((at) => ["app/page.tsx", String(at), "1", "40"]));
    const subject = TABLE(["n.filePath", "n.startLine", "n.endLine"], ["views/card.tsx", "3", "9"]);
    const cypher = (args) => (args.query.includes("'Component:views/card.tsx:Card'") && args.query.includes("CALLS") ? rowsOf([])
        : args.query.includes("'Function:views/card.tsx:Card:1'") && args.query.includes("CALLS") ? rowsOf([12, 20])
            : subject);
    const question = { id: "t", surface: "references", kind: null, direction: null, from: { file: "views/card.tsx", needle: "x", line: 3, text: "export function Card() {", symbol: "Card" } };
    const listed = (first, second) => `Ambiguous: 2 symbols match. Candidates:\n${first}\n${second}`;
    const component = "Component:views/card.tsx:Card, Card, Component, views/card.tsx, 3, 9";
    const fn = "Function:views/card.tsx:Card:1, Card, Function, views/card.tsx, 3, 9";

    const one = await askSkybox(question, fake({ context: listed(component, fn), cypher }).call);
    const other = await askSkybox(question, fake({ context: listed(fn, component), cypher }).call);
    assert.deepEqual(one, other, "the reply order does not change the answer");
    assert.deepEqual(one.locations, [{ file: "app/page.tsx", line: 12 }, { file: "app/page.tsx", line: 20 }]);
    assert.match(one.note, /Component:views\/card\.tsx:Card \+ Function:views\/card\.tsx:Card:1/);
});

test("anchored references: CALLS and USES edges into the node at the from line, a site at its call-site line", async () => {
    const question = { id: "t", surface: "references", kind: null, direction: null, from: { file: "core/money/money.go", needle: "type Money struct {", line: 10, text: "type Money struct {", symbol: "Money" } };
    const subject = TABLE(["n.filePath", "n.startLine", "n.endLine"], ["core/money/money.go", "10", "14"]);
    const edges = TABLE(["c.filePath", "r.callSiteLine", "c.startLine", "c.endLine"],
        ["core/billing/formatter.go", "", "20", "24"],
        ["app/a.go", "57", "26", "89"],
        ["app/a.go", "57", "26", "89"],
        ["", "", "", ""]);
    const { call, calls } = fake({ context: RESOLVED, cypher: (args) => (args.query.includes("CALLS") ? edges : subject) });
    const answer = await askSkybox(question, call);
    assert.deepEqual(calls[0].args, { name: "Money", file_path: "core/money/money.go" });
    assert.match(calls[2].args.query, /WHERE t\.id = '[^']+' AND \(r\.type = 'CALLS' OR r\.type = 'USES'\) RETURN c\.filePath, r\.callSiteLine, c\.startLine, c\.endLine/);
    assert.deepEqual(answer.locations, [
        { file: "app/a.go", line: 57 },
        { file: "app/a.go", line: 57 },
        { file: "core/billing/formatter.go", line: 20, end_line: 24 },
    ], "a call site at its line; a USES row as the user's range");
    assert.equal(answer.unlocated, 1);

    const elsewhere = TABLE(["n.filePath", "n.startLine", "n.endLine"], ["core/money/money.go", "80", "90"]);
    const moved = await askSkybox(question, fake({ context: RESOLVED, cypher: elsewhere }).call);
    assert.deepEqual(moved.locations, [], "a same-named node elsewhere does not lend its sites");
});

test("anchored implementation lists: implementors at any depth into the subject; parents out of it", async () => {
    const from = { file: "contracts/report.go", needle: "type ReportContract interface {", line: 37, text: "type ReportContract interface {", symbol: "ReportContract" };
    const subject = TABLE(["n.filePath", "n.startLine", "n.endLine"], ["contracts/report.go", "37", "45"]);
    const found = TABLE(["c.filePath", "c.startLine", "c.endLine"], ["reports/b.go", "19", "30"], ["reports/a.go", "12", "20"]);
    const header = ["c.id", "c.filePath", "c.startLine", "c.endLine"];
    const walk = (args) => {
        if (!args.query.includes("t.id IN")) {
            return subject;
        }
        if (args.query.includes("'Class:C'")) {
            return TABLE(header);
        }
        if (args.query.includes("'Class:B'")) {
            return TABLE(header, ["Class:C", "reports/c.go", "19", "30"], ["Class:A", "reports/a.go", "12", "20"]);
        }
        return TABLE(header, ["Class:B", "base/b.go", "5", "9"], ["Class:A", "reports/a.go", "12", "20"]);
    };
    for (const surface of ["implementation", "cardinality"]) {
        const { call, calls } = fake({ context: RESOLVED, cypher: walk });
        const answer = await askSkybox({ id: "t", surface, kind: null, direction: null, from }, call);
        assert.match(calls[2].args.query, /MATCH \(c\)-\[r:CodeRelation\]->\(t\) WHERE t\.id IN \['[^']+'\] AND \(r\.type = 'IMPLEMENTS' OR r\.type = 'EXTENDS'\) RETURN DISTINCT c\.id/, `${surface}: one step at a time, IMPLEMENTS and EXTENDS only`);
        assert.equal(calls.length, 5, "context, the subject's range, then steps until one finds nothing new");
        assert.match(calls[3].args.query, /IN \['Class:A', 'Class:B'\]/, "the next step starts from every new node, in id order");
        assert.deepEqual(answer.locations, [
            { file: "base/b.go", line: 5, end_line: 9 },
            { file: "reports/a.go", line: 12, end_line: 20 },
            { file: "reports/c.go", line: 19, end_line: 30 },
        ], "every depth, each node once");
    }
    const { call, calls } = fake({ context: RESOLVED, cypher: (args) => (args.query.includes("(p)") ? found : subject) });
    const parents = await askSkybox({ id: "t", surface: "multi-parent", kind: null, direction: null, from }, call);
    assert.match(calls[2].args.query, /MATCH \(s\)-\[r:CodeRelation\]->\(p\) WHERE s\.id = '[^']+' AND \(r\.type = 'IMPLEMENTS' OR r\.type = 'EXTENDS'\)/, "multi-parent: the direct parents");
    assert.equal(parents.locations.length, 2);
    assert.match(parents.note, /its own IMPLEMENTS and EXTENDS edges$/);
});

test("file protocol (document_symbol): every node with a position in the file, as stored, by line then name", async () => {
    const question = { id: "t", surface: "document_symbol", kind: null, direction: null, from: { file: "core/models/order.go", needle: "package models", line: 1, text: "package models" } };
    const rows = TABLE(["n.name", "n.startLine"], ["Total", "40"], ["Order", "10"], ["ID", "11"], ["Order", "10"], ["null", "12"]);
    const { call, calls } = fake({ cypher: rows });
    const answer = await askSkybox(question, call);
    assert.equal(calls.length, 1, "one cypher call, no symbol lookup");
    assert.match(calls[0].args.query, /MATCH \(n\) WHERE n\.filePath = 'core\/models\/order\.go' AND n\.startLine IS NOT NULL RETURN n\.name, n\.startLine/);
    assert.deepEqual(answer.names, ["Order", "Order", "ID", "Total"], "unedited: a doubled node stays doubled");
    assert.match(answer.note, /1 without a name/);
    const empty = await askSkybox(question, fake({ cypher: "*(no rows returned)*\n\n---\n**Next:** x" }).call);
    assert.deepEqual(empty.names, [], "no node: an empty answer, not unsupported");
});

test("direction: two-sided kinds ask the relation and its opposite; definition kinds are asked by bare name", async () => {
    const from = { file: "contracts/report.go", needle: "type ReportContract interface {", line: 37, text: "type ReportContract interface {", symbol: "ReportContract" };
    const subject = TABLE(["n.filePath", "n.startLine", "n.endLine"], ["contracts/report.go", "37", "45"]);
    const children = TABLE(["c.id", "c.filePath", "c.startLine", "c.endLine"], ["Struct:a", "reports/a.go", "12", "20"]);
    const parents = TABLE(["p.filePath", "p.startLine", "p.endLine"], ["contracts/base.go", "3", "9"]);
    const cypher = (args) => {
        if (args.query.includes("t.id IN [") && args.query.includes("'Struct:a'")) {
            return TABLE(["c.id", "c.filePath", "c.startLine", "c.endLine"]);
        }
        if (args.query.includes("t.id IN [")) {
            return children;
        }
        if (args.query.includes("(p)")) {
            return parents;
        }
        return subject;
    };
    const parentOf = await askSkybox({ id: "t", surface: "direction", kind: "parent_of", direction: null, from }, fake({ context: RESOLVED, cypher }).call);
    assert.deepEqual(parentOf.locations, [{ file: "reports/a.go", line: 12, end_line: 20 }], "parent_of asks the children");
    assert.deepEqual(parentOf.reverse_locations, [{ file: "contracts/base.go", line: 3, end_line: 9 }], "and the parents, the opposite");
    const childOf = await askSkybox({ id: "t", surface: "direction", kind: "child_of", direction: null, from }, fake({ context: RESOLVED, cypher }).call);
    assert.deepEqual(childOf.locations, parentOf.reverse_locations, "child_of asks the parents");
    assert.deepEqual(childOf.reverse_locations, parentOf.locations, "and the children, the opposite");

    const uses = TABLE(["t.filePath", "t.startLine", "t.endLine"], ["contracts/report.go", "37", "45"]);
    const selfCalls = fake({ context: RESOLVED, cypher: (args) => (args.query.includes("r.type = 'USES'") ? uses : cypher(args)) });
    const self = await askSkybox({ id: "t", surface: "direction", kind: "uses_self", direction: null, from }, selfCalls.call);
    assert.ok(selfCalls.calls.some((entry) => /WHERE s\.id = '[^']+' AND r\.type = 'USES'/.test(entry.args.query ?? "")), "uses_self asks the subject's own USES edges");
    assert.deepEqual(self.locations, [{ file: "contracts/report.go", line: 37, end_line: 45 }]);
    assert.deepEqual(self.reverse_locations, parentOf.reverse_locations, "and its parents, the opposite");

    const { call, calls } = fake({ context: "Symbol not found in index" });
    const merged = await askSkybox({ id: "t", surface: "direction", kind: "declaration_merge", direction: null, from: { ...from, text: "export enum RepairStatus {", symbol: "RepairStatus" } }, call);
    assert.deepEqual(calls[0].args, { name: "RepairStatus" }, "declaration_merge is a definition lookup by bare name (raw)");
    assert.deepEqual(merged.locations, []);
    assert.equal(await askSkybox({ id: "t", surface: "direction", kind: "inherent_impl", direction: null, from }, fake({}).call), undefined, "an unscored kind is not asked");
});

test("parse-negative and diagnostics: skybox has no parse-failure report, so it is unsupported, with no call", async () => {
    for (const surface of ["parse-negative", "diagnostics"]) {
        const { call, calls } = fake({});
        const answer = await askSkybox({ id: "t", surface, kind: null, direction: null, from: { file: "fixtures/broken-syntax/bad.go", needle: "x", line: 1, text: "x" } }, call);
        assert.equal(answer.status, "unsupported");
        assert.match(answer.detail, /no per-file parse failure/);
        assert.equal(calls.length, 0);
    }
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
