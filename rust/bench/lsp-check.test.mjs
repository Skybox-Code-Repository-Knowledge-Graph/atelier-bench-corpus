// Tests for bench/lsp-check.mjs, run with `node --test bench/lsp-check.test.mjs` from the lane
// root. The helpers are checked on canned answers; one whole run goes over stdio against a fake
// server, which is this same file started with LSP_CHECK_FAKE_SERVER=1. Neither part starts a
// real language server.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
    columnOf,
    createParser,
    frame,
    hoverText,
    judgeDocumentSymbol,
    judgeHover,
    laneRelative,
    lineOf,
    locations,
    run,
    symbolNames,
} from "./lsp-check.mjs";

// The fixture lane both halves share. Lines are 0-based, as LSP counts them.
const SOURCE = [
    "pub trait Shape {",
    "    fn area(&self) -> u32;",
    "}",
    "pub struct Square;",
    "impl Shape for Square {",
    "    fn area(&self) -> u32 {",
    "        helper()",
    "    }",
    "}",
    "/// Pads to a zero-padded width.",
    "pub fn helper() -> u32 {",
    "    4",
    "}",
    "",
].join("\n");

const site = (needle) => ({ file: "src/lib.rs", needle });

const TASKS = [
    { id: "t-hover", surface: "hover", from: { ...site("        helper()"), symbol: "helper" }, expect: { contains: "zero-padded width" } },
    { id: "t-hover-miss", surface: "hover", from: { ...site("        helper()"), symbol: "helper" }, expect: { contains: "a phrase the doc lacks" } },
    {
        id: "t-docsym",
        surface: "document_symbol",
        from: site("pub trait Shape {"),
        expect: { symbols: ["Shape", "area", "Square", "impl Shape for Square", "area", "helper"], min_symbols: 4 },
    },
    {
        id: "t-impl",
        surface: "implementation",
        from: { ...site("pub trait Shape {"), symbol: "Shape" },
        expect: { exact_count: 1, implementations: [site("impl Shape for Square {")] },
    },
    {
        id: "t-impl-none",
        surface: "implementation",
        from: { ...site("pub struct Square;"), symbol: "Square" },
        expect: { exact_count: 1, implementations: [site("impl Shape for Square {")] },
    },
    {
        id: "t-outgoing",
        surface: "call_hierarchy",
        from: { ...site("    fn area(&self) -> u32 {"), symbol: "area" },
        expect: { outgoing_includes: [site("pub fn helper() -> u32 {")] },
    },
    {
        id: "t-incoming",
        surface: "call_hierarchy",
        from: { ...site("pub fn helper() -> u32 {"), symbol: "helper" },
        expect: { min_incoming: 1, incoming_includes: [site("        helper()")] },
    },
    { id: "t-definition", surface: "definition", from: { ...site("        helper()"), symbol: "helper" }, expect: site("pub fn helper() -> u32 {") },
];

const range = (start, end = start) => ({ start: { line: start, character: 0 }, end: { line: end, character: 1 } });

/** The fake server: just enough LSP to drive one run, answering by the asked line. */
function fakeServer() {
    const root = process.env.LSP_CHECK_FAKE_ROOT;
    const uri = pathToFileURL(join(root, "src", "lib.rs")).href;
    const send = (message) => process.stdout.write(frame({ jsonrpc: "2.0", ...message }));
    let contentModifiedSent = false;
    const answer = (message) => {
        const line = message.params?.position?.line;
        switch (message.method) {
            case "initialize":
                return { capabilities: {}, serverInfo: { name: "fake-lsp", version: "0.0.1" } };
            case "textDocument/hover":
                return { contents: { kind: "markdown", value: "```rust\npub fn helper() -> u32\n```\n\n---\n\nPads to a zero-padded\nwidth." } };
            case "textDocument/documentSymbol":
                return [
                    { name: "Shape", children: [{ name: "area" }] },
                    { name: "Square" },
                    { name: "impl Shape for Square", children: [{ name: "area" }] },
                    { name: "helper" },
                ];
            case "textDocument/implementation":
                return line === 0 ? [{ uri, range: range(4, 8) }] : null;
            case "textDocument/prepareCallHierarchy":
                return [{ name: line === 5 ? "area" : "helper", uri, range: range(line), selectionRange: range(line) }];
            case "callHierarchy/outgoingCalls":
                return [{ to: { name: "helper", uri, range: range(9, 12), selectionRange: range(10) }, fromRanges: [range(6)] }];
            case "callHierarchy/incomingCalls":
                return [{ from: { name: "area", uri, range: range(5, 7), selectionRange: range(5) }, fromRanges: [range(6)] }];
            default:
                return null;
        }
    };
    process.stdin.on("data", createParser((message) => {
        if (message.method === "initialized") {
            // A server-to-client request the client must answer before the workspace is ready.
            send({ id: "fake-1", method: "window/workDoneProgress/create", params: { token: "load" } });

            return;
        }
        if (message.id === "fake-1" && message.method === undefined) {
            send({ method: "experimental/serverStatus", params: { health: "ok", quiescent: false } });
            send({ method: "experimental/serverStatus", params: { health: "ok", quiescent: true } });

            return;
        }
        if (message.method === "exit") {
            process.exit(0);
        }
        if (message.id === undefined) {
            return;
        }
        if (message.method === "textDocument/documentSymbol" && !contentModifiedSent) {
            contentModifiedSent = true;
            send({ id: message.id, error: { code: -32801, message: "content modified" } });

            return;
        }
        send({ id: message.id, result: answer(message) });
    }));
}

if (process.env.LSP_CHECK_FAKE_SERVER === "1") {
    fakeServer();
} else {
    const { test } = await import("node:test");
    const assert = (await import("node:assert/strict")).default;

    test("a needle names one line and a symbol its UTF-16 column, by occurrence", () => {
        assert.deepEqual(lineOf(SOURCE, "impl Shape for Square {"), { line: 4, text: "impl Shape for Square {" });
        assert.throws(() => lineOf(SOURCE, "fn area(&self) -> u32"), /found 2 times/);
        assert.equal(columnOf("let shape: Shape = Shape::new();", "Shape", 2), 19);
        assert.equal(columnOf("é helper()", "helper"), 2);
        assert.throws(() => columnOf("helpers()", "helper"), /not on line/);
    });

    test("frames survive being split across chunks", () => {
        const seen = [];
        const feed = createParser((message) => seen.push(message));
        const bytes = Buffer.concat([frame({ id: 1, result: "ü" }), frame({ method: "m" })]);
        feed(bytes.subarray(0, 7));
        feed(bytes.subarray(7, 30));
        feed(bytes.subarray(30));
        assert.deepEqual(seen, [{ id: 1, result: "ü" }, { method: "m" }]);
    });

    test("answers are normalised before they are judged", () => {
        const root = join(tmpdir(), "lane");
        assert.equal(laneRelative(root, pathToFileURL(join(root, "src", "a.rs")).href), "src/a.rs");
        assert.match(laneRelative(root, pathToFileURL(join(tmpdir(), "other", "core", "lib.rs")).href), /^\(outside the lane\) \.\.\.\/core\/lib\.rs$/);
        assert.deepEqual(locations([{ targetUri: "file:///x", targetRange: range(3, 9), targetSelectionRange: range(4) }]), [{ uri: "file:///x", start: 3, end: 9, focus: 4 }]);
        assert.deepEqual(locations(null), []);
        assert.equal(hoverText({ contents: ["a", { language: "rust", value: "b" }] }), "a\nb");
        assert.deepEqual(symbolNames([{ name: "A", children: [{ name: "b" }] }, { name: "C" }]), ["A", "b", "C"]);
    });

    test("verdicts compare an answer with the key and never the other way round", () => {
        const hover = { expect: { contains: "zero-padded width" } };
        assert.equal(judgeHover(hover, { contents: { value: "a zero-padded width" } }).verdict, "agrees");
        assert.match(judgeHover(hover, { contents: { value: "a zero-padded\nwidth" } }).detail, /line breaks are folded/);
        assert.equal(judgeHover(hover, { contents: { value: "other" } }).verdict, "disagrees");
        assert.equal(judgeHover(hover, null).verdict, "no answer");
        const docsym = { expect: { symbols: ["A", "impl A"], min_symbols: 1 } };
        assert.equal(judgeDocumentSymbol(docsym, [{ name: "A" }, { name: "impl A" }]).verdict, "agrees");
        assert.match(judgeDocumentSymbol(docsym, [{ name: "A" }, { name: "B" }]).detail, /not returned: \[impl A\]; returned names not in the key: \[B\]/);
    });

    test("a whole run against a fake server reports one verdict per task on the four surfaces", async () => {
        const root = mkdtempSync(join(tmpdir(), "lsp-check-"));
        try {
            mkdirSync(join(root, "src"));
            mkdirSync(join(root, "bench"));
            writeFileSync(join(root, "src", "lib.rs"), SOURCE);
            writeFileSync(join(root, "bench", "tasks.json"), JSON.stringify({ version: 1, tasks: TASKS }));
            process.env.LSP_CHECK_FAKE_SERVER = "1";
            process.env.LSP_CHECK_FAKE_ROOT = root;
            const lines = await run({
                root,
                command: process.execPath,
                args: [fileURLToPath(import.meta.url)],
                readyTimeoutMs: 20_000,
                version: "fake-lsp 0.0.1 (test)",
                env: {},
            });
            delete process.env.LSP_CHECK_FAKE_SERVER;
            const report = lines.join("\n");

            assert.equal(lines[0], "<!-- lsp-check begin -->");
            assert.equal(lines.at(-1), "<!-- lsp-check end -->");
            assert.match(report, /- server: `fake-lsp 0\.0\.1 \(test\)`; initialize serverInfo: `fake-lsp 0\.0\.1`/);
            assert.match(report, /- run: local/);
            assert.match(report, /- tasks: 7 \(hover 2, document_symbol 1, call_hierarchy 2, implementation 2\); agrees 5, disagrees 1, no answer 1/);
            assert.match(report, /^\| t-hover \| hover \| agrees \| contains "zero-padded width" once line breaks are folded \|$/m);
            assert.match(report, /^\| t-hover-miss \| hover \| disagrees \| "a phrase the doc lacks" absent; hover: /m);
            assert.match(report, /^\| t-docsym \| document_symbol \| agrees \| 6 returned, key N = 6, min_symbols 4; same names \|$/m);
            assert.match(report, /^\| t-impl \| implementation \| agrees \| 1 returned, key exact_count 1; every keyed implementation returned, nothing else \|$/m);
            assert.match(report, /^\| t-impl-none \| implementation \| no answer \| no locations \|$/m);
            assert.match(report, /^\| t-outgoing \| call_hierarchy \| agrees \| callee src\/lib\.rs:11 returned; outgoing: \[helper src\/lib\.rs:11\] \|$/m);
            assert.match(report, /^\| t-incoming \| call_hierarchy \| agrees \| call src\/lib\.rs:7 returned; 1 callers \(min_incoming 1\): \[area src\/lib\.rs\] \|$/m);
            assert.doesNotMatch(report, /t-definition/);
            assert.doesNotMatch(report, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        } finally {
            delete process.env.LSP_CHECK_FAKE_SERVER;
            rmSync(root, { recursive: true, force: true });
        }
    });
}
