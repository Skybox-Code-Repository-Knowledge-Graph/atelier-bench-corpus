// The codebase-memory-mcp adapter against recorded replies: no cbm, no network. The reply texts
// below are copied from codebase-memory-mcp 0.12.1 (`cli --json <tool>`, `format: json`), trimmed.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { questionOf } from "../../lib/question.mjs";
import { askCbm, exactNamePattern, isPathSegment, parseEnvelope, parseErrorsFor, parseLines, parseOutline, parseSearchGraph } from "../ask.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const search = (groups, extra = {}) => JSON.stringify({
    qn_rule: "qn = qn_prefix == \"\" ? name : qn_prefix + \".\" + name",
    cols: ["name", "label", "lines", "in", "out"],
    groups,
    total: groups.reduce((sum, group) => sum + group.rows.length, 0),
    has_more: false,
    truncated: false,
    ...extra,
});

const SUM = search([{ qn_prefix: "p.core.money", file: "core/money/money.go", rows: [["Sum", "Function", "56-62", 2, 3]] }]);
const TOTAL = search([
    { qn_prefix: "p.atelier.services", file: "atelier/services/order_volume_service.go", rows: [["Total", "Method", "25-27", 4, 3]] },
    { qn_prefix: "p.app.http.ReportView", file: "app/http/report.go", rows: [["Total", "Field", "16-16", 1, 0]] },
    { qn_prefix: "p.core.models", file: "core/models/repairorder.go", rows: [["Total", "Method", "90-92", 1, 4]] },
]);
const NONE = search([], { hint: "No results match the current filters; broaden or remove filters and retry." });

const OUTLINE = JSON.stringify({
    file_path: "atelier/reports/registry.go",
    cols: ["name", "label", "lines", "qn"],
    rows: [["Count", "Function", "34-36", "q.Count"], ["registry", "Variable", "11-11", "q.registry"], ["Register", "Function", "14-16", "q.Register"]],
    total: 3, offset: 0, limit: 200, returned: 3, has_more: false,
});

const PARTIAL = {
    files: [{ path: "fixtures/broken-syntax/bad_receiver.go", error_ranges: "10-10" }, { path: "fixtures/broken-syntax/unclosed_struct.go", error_ranges: "11-14" }],
    count: 2,
    truncated: false,
};

const question = (from, surface = "definition", kind = null) => ({ id: "t", surface, kind, from: { file: "f", needle: "n", line: 1, text: from.text ?? "", ...from } });

/** A fake tool: replies by tool name as `{ text, isError }`, records every call. */
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
    let asked = 0;
    for (const task of tasks) {
        const built = questionOf(task, join(REPO_ROOT, "go"));
        if (built === null) {
            continue;
        }
        asked += 1;
        for (const key of Object.keys(built.from)) {
            assert.ok(["file", "needle", "symbol", "occurrence", "line", "text"].includes(key), `${task.id}: ${key}`);
        }
        assert.ok(Object.isFrozen(built) && Object.isFrozen(built.from));
    }
    assert.ok(asked > 100);
});

test("the adapter source never reads the answer key", () => {
    for (const file of ["ask.mjs", "run.mjs"]) {
        const source = readFileSync(join(REPO_ROOT, "bench", "adapters", "codebase-memory-mcp", file), "utf8");
        assert.doesNotMatch(source, /\.expect\b|\.note\b|must_include|must_not_include|known_sites/, file);
    }
});

test("a symbol is asked as an anchored exact-name regex", () => {
    assert.equal(exactNamePattern("Sum"), "^Sum$");
    assert.equal(exactNamePattern("a.b"), "^a\\.b$");
    assert.equal(exactNamePattern("T[K]"), "^T\\[K\\]$");
});

test("range cells parse to line and end", () => {
    assert.deepEqual(parseLines("56-62"), { line: 56, end: 62 });
    assert.deepEqual(parseLines("16"), { line: 16, end: 16 });
    assert.equal(parseLines(null), null);
    assert.equal(parseLines("x-y"), null);
});

test("search_graph replies are parsed to rows with their file", () => {
    assert.deepEqual(parseSearchGraph(SUM), { rows: [{ name: "Sum", label: "Function", file: "core/money/money.go", lines: "56-62" }], complete: true });
    assert.equal(parseSearchGraph(search([{ file: "a.go", rows: [["X", "Function", "1-2", 0, 0]] }], { has_more: true })).complete, false);
    assert.equal(parseSearchGraph(search([{ file: "a.go", rows: [["X", "Function", "1-2", 0, 0]] }], { truncated: true })).complete, false);
    assert.throws(() => parseSearchGraph("{}"), /unrecognised/);
    assert.throws(() => parseSearchGraph("not json"));
});

test("a definition question is one search_graph call by bare name, whatever the file or kind", async () => {
    const tool = fake({ search_graph: SUM });
    const answer = await askCbm(question({ symbol: "Sum", file: "tests/structure_test.go" }, "definition", "free_function"), tool.call);
    assert.equal(tool.calls.length, 1);
    assert.equal(tool.calls[0].tool, "search_graph");
    assert.equal(tool.calls[0].args.name_pattern, "^Sum$");
    assert.deepEqual(Object.keys(tool.calls[0].args).sort(), ["format", "limit", "max_output_tokens", "name_pattern"]);
    assert.deepEqual(answer.locations, [{ file: "core/money/money.go", line: 56, end_line: 62 }]);
});

test("every node of the name is an answer, sorted by file then line, nothing dropped", async () => {
    const answer = await askCbm(question({ symbol: "Total" }), fake({ search_graph: TOTAL }).call);
    assert.deepEqual(answer.locations.map((location) => `${location.file}:${location.line}`), [
        "app/http/report.go:16",
        "atelier/services/order_volume_service.go:25",
        "core/models/repairorder.go:90",
    ]);
    assert.equal(answer.locations[0].end_line, undefined, "a one-line range has no end_line");
});

test("a row without a range is counted, not dropped", async () => {
    const reply = search([{ file: "a.go", rows: [["X", "Module", "", 0, 0]] }]);
    const answer = await askCbm(question({ symbol: "X" }), fake({ search_graph: reply }).call);
    assert.deepEqual(answer.locations, []);
    assert.equal(answer.unlocated, 1);
});

test("a negative answer is an answer: no locations, not an error", async () => {
    const answer = await askCbm(question({ symbol: "Nope" }), fake({ search_graph: NONE }).call);
    assert.deepEqual(answer.locations, []);
    assert.equal(answer.status, undefined);
});

test("harness failures are errors, never misses", async () => {
    assert.equal((await askCbm(question({ symbol: "Sum" }), fake({ search_graph: new Error("timed out") }).call)).status, "error");
    assert.equal((await askCbm(question({ symbol: "Sum" }), fake({ search_graph: { text: "limit must be between 1 and 200", isError: true } }).call)).status, "error");
    assert.equal((await askCbm(question({ symbol: "Sum" }), fake({ search_graph: "garbage" }).call)).status, "error");
    const partial = search([{ file: "a.go", rows: [["Sum", "Function", "1-2", 0, 0]] }], { has_more: true });
    assert.equal((await askCbm(question({ symbol: "Sum" }), fake({ search_graph: partial }).call)).status, "error");
});

test("what is not asked is left out; a null symbol is unsupported", async () => {
    const tool = fake({ search_graph: SUM });
    assert.equal(await askCbm(question({ symbol: "Sum" }, "references"), tool.call), undefined);
    assert.equal(await askCbm(question({ symbol: "Sum" }, "hover"), tool.call), undefined);
    assert.equal(await askCbm(question({ symbol: "Sum" }, "resolution", "mro"), tool.call), undefined);
    assert.equal(await askCbm(question({ symbol: "models", text: `import "atelier.example/lane/core/models"`, occurrence: 1 }, "import-precision", "type_only"), tool.call), undefined);
    assert.equal(tool.calls.length, 0);
    assert.equal((await askCbm(question({ symbol: null }), tool.call)).status, "unsupported");
});

test("document_symbol lists the outline by start line, then name, paging until done", async () => {
    const pages = [];
    const tool = fake({ get_file_outline: (args) => { pages.push(args); return OUTLINE; } });
    const answer = await askCbm(question({ file: "atelier/reports/registry.go" }, "document_symbol"), tool.call);
    assert.deepEqual(answer.names, ["registry", "Register", "Count"]);
    assert.deepEqual(pages, [{ file_path: "atelier/reports/registry.go", limit: 200, offset: 0, format: "json" }]);

    const first = JSON.stringify({ cols: ["name", "label", "lines", "qn"], rows: [["A", "Function", "1-1", "q"]], total: 2, has_more: true });
    const second = JSON.stringify({ cols: ["name", "label", "lines", "qn"], rows: [["B", "Function", "2-2", "q"]], total: 2, has_more: false });
    const offsets = [];
    const paged = fake({ get_file_outline: (args) => { offsets.push(args.offset); return args.offset === 0 ? first : second; } });
    assert.deepEqual((await askCbm(question({ file: "f.go" }, "document_symbol"), paged.call)).names, ["A", "B"]);
    assert.deepEqual(offsets, [0, 200]);
});

test("outline replies are parsed", () => {
    assert.deepEqual(parseOutline(OUTLINE).rows[0], { name: "Count", lines: "34-36" });
    assert.throws(() => parseOutline("{}"), /unrecognised/);
});

test("parse-negative and diagnostics read cbm's parse_partial report for the asked file", async () => {
    const tool = fake({});
    const hit = await askCbm(question({ file: "fixtures/broken-syntax/unclosed_struct.go" }, "parse-negative", "syntax_error"), tool.call, { parseErrors: PARTIAL });
    assert.deepEqual(hit.parse_errors, [{ file: "fixtures/broken-syntax/unclosed_struct.go", line: 11, message: JSON.stringify(PARTIAL.files.find((entry) => entry.path === "fixtures/broken-syntax/unclosed_struct.go")) }]);
    assert.doesNotMatch(hit.parse_errors[0].message, /^parse_partial:/, "no adapter-composed prose");
    const clean = await askCbm(question({ file: "fixtures/broken-syntax/doc.go" }, "diagnostics"), tool.call, { parseErrors: PARTIAL });
    assert.deepEqual(clean.parse_errors, [], "a file cbm did not flag is an empty answer, not unsupported");
    const none = await askCbm(question({ file: "x.go" }, "diagnostics"), tool.call, {});
    assert.deepEqual(none.parse_errors, []);
    assert.equal(tool.calls.length, 0);
});

test("an incomplete parse_partial list is a harness error, never a miss", () => {
    assert.throws(() => parseErrorsFor({ ...PARTIAL, truncated: true }, "x.go"), /incomplete/);
    assert.throws(() => parseErrorsFor({ ...PARTIAL, count: 5 }, "x.go"), /incomplete/);
});

test("the envelope is read whatever the exit code; no envelope is a harness failure", () => {
    const flagged = JSON.stringify({ content: [{ type: "text", text: "limit must be between 1 and 200" }], isError: true });
    assert.deepEqual(parseEnvelope(flagged, "get_file_outline", 1), { text: "limit must be between 1 and 200", isError: true });
    const fine = JSON.stringify({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }], isError: false });
    assert.deepEqual(parseEnvelope(fine, "search_graph", 0), { text: "a\nb", isError: false });
    assert.throws(() => parseEnvelope("", "search_graph", null, "killed"), /without a JSON envelope: killed/);
});

test("a segment of a quoted import path is recognised", () => {
    assert.equal(isPathSegment('import "atelier.example/lane/core/models"', "models", 1), true);
    assert.equal(isPathSegment("sum := money.Sum(x)", "Sum", 1), false);
});
