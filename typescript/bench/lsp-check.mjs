#!/usr/bin/env node
// One run of the language server this lane's stack starts over the lane's language-server keys
// (issue #223, ruling R5, checklist E.5): typescript-language-server, pinned in package-lock.json,
// over the lane's own TypeScript (node_modules/typescript). It asks every hover, document_symbol,
// call_hierarchy and implementation task of bench/tasks.json and writes bench/lsp-check.md: one line
// per task, agrees / disagrees / server has no answer, with what the server returned.
//
// The server never changes a key. Where it disagrees, the tree decides, and DISPOSITIONS below
// records that reading per task.
//
//   npm ci && node bench/lsp-check.mjs            # writes bench/lsp-check.md
//
// Every packages/*/src and packages/*/tests file is opened before the first question: each
// packages/*/tsconfig.json includes only its own package, and a server that has not opened a
// consuming package's files answers from the declaring package's project alone (lane README).

import { spawn } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const LANE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_PACKAGE = join(LANE, "node_modules", "typescript-language-server");
const SERVER = join(SERVER_PACKAGE, "lib", "cli.mjs");
const TSSERVER = join(LANE, "node_modules", "typescript", "lib", "tsserver.js");
const OUT = join(LANE, "bench", "lsp-check.md");
const SURFACES = ["hover", "document_symbol", "call_hierarchy", "implementation"];

/**
 * The tree's reading of every task the server disagrees with, written after reading the tree.
 * Each reading records the exact answer it was written for: the verdict, the keyed items the
 * server did not return (missing) and what it returned beyond the key (extra), as the report
 * prints them. A run whose answer differs from that prints the line as NOT READ and exits 1, so
 * a reading never stands under an answer nobody read.
 */
const DISPOSITIONS = {
    "impl-invoice-calculator": {
        verdict: "disagrees",
        missing: [],
        extra: ["packages/core/src/support/calculatorRef.ts:7"],
        reading: "key right, unchanged. The extra line is `export type CalculatorRef = import(\"../contracts/invoiceCalculator\").InvoiceCalculator;`, a type alias that names the contract; it declares no type that implements it, and the notes count only implementing types.",
    },
    "impl-report-contract": {
        verdict: "disagrees",
        missing: [],
        extra: ["packages/bench/src/index.ts:69"],
        reading: "key right, unchanged. The extra line is `export const REPORTS: readonly ReportContract[] = [`, the registry array; the notes say a value that only holds implementors is not an implementor.",
    },
    "impl-repository-generic": {
        verdict: "server has no answer",
        missing: [],
        extra: [],
        reading: "key right, unchanged. All 8 files under packages/bench/src/repositories declare `implements Repository<...>` (grep: 8 of 8); the contract lives in packages/core, whose tsconfig.json includes only core, so the server answers from a project that holds none of them.",
    },
    "docsym-repair-order": {
        verdict: "disagrees",
        missing: [],
        extra: [
            "`changedBy` listed 2x (line 23, 48), key 1x",
            "`from` listed 2x (line 21, 48), key 1x",
            "`order` listed 1x (line 81), key 0x",
            "`partId` listed 2x (line 13, 73), key 1x",
            "`parts.map() callback` listed 1x (line 63), key 0x",
            "`quantity` listed 2x (line 15, 73), key 1x",
            "`sku` listed 2x (line 14, 73), key 1x",
            "`to` listed 2x (line 22, 48), key 1x",
            "`unitPrice` listed 2x (line 16, 73), key 1x",
        ],
        reading: "key right, unchanged. 9 extras: the keyed `partId`, `sku`, `quantity`, `unitPrice` (lines 13-16, interface OrderPart) and `from`, `to`, `changedBy` (lines 21-23, interface StatusChange) are listed again from the object literals `{ partId: part.id, sku: part.sku, quantity, unitPrice: part.unitPrice }` (line 73, in addPart) and `{ from: this.status, to: next, changedBy }` (line 48, in transitionTo); line 63 is the anonymous `this.parts.map((line) => ...)` callback and line 81 the function-local `const order` in `seed`. The counting rule in the notes leaves object-literal keys, anonymous callbacks and function-local variables out (the callback and the local are also recorded in bench/score as DOCSYM_REFERENCE_DISAGREES, issue #208).",
    },
    "docsym-report-registry": {
        verdict: "disagrees",
        missing: [],
        extra: ["`METRICS.find() callback` listed 1x (line 123), key 0x", "`REPORTS.find() callback` listed 1x (line 118), key 0x"],
        reading: "key right, unchanged. The extras are the anonymous arrow callbacks of `REPORTS.find((candidate) => ...)` (line 118, in `report`) and `METRICS.find((candidate) => ...)` (line 123, in `metric`); the counting rule in the notes leaves anonymous callbacks out.",
    },
    "hierarchy-incoming-transition": {
        verdict: "disagrees",
        missing: ["packages/bench/src/dataset.ts:72"],
        extra: [],
        reading: "key right, unchanged. packages/bench/src/dataset.ts:72 is `orders[1]!.transitionTo(RepairStatus.AwaitingParts, \"seeder\");` inside Dataset.seeded, a caller in packages/bench; the declaration is in packages/core, whose project does not include bench, so the server misses that caller.",
    },
    "impl-type-alias-contract": {
        verdict: "disagrees",
        missing: [],
        extra: ["packages/bench/tests/typescriptOnly.test.ts:33"],
        reading: "key right, unchanged. The extra line is `const rules: PriceRule[] = [...]` in the test, an array value typed with the alias; it holds implementors and is not one.",
    },
};

const version = (path) => JSON.parse(readFileSync(join(path, "package.json"), "utf8")).version;
const tasks = JSON.parse(readFileSync(join(LANE, "bench", "tasks.json"), "utf8")).tasks.filter((task) => SURFACES.includes(task.surface));
const laneRelative = (path) => relative(LANE, path).split("\\").join("/");
const uriOf = (file) => pathToFileURL(join(LANE, file)).href;
const fileOfUri = (uri) => laneRelative(fileURLToPath(uri));

function lineOf(file, needle) {
    const lines = readFileSync(join(LANE, file), "utf8").split(/\r?\n/);
    const hits = lines.flatMap((line, index) => (line.includes(needle) ? [index] : []));
    if (hits.length !== 1) {
        throw new Error(`${file}: needle ${JSON.stringify(needle)} matches ${hits.length} lines`);
    }

    return hits[0];
}

/** 0-based column of from.symbol on the from line, honouring from.occurrence. */
function columnOf(from) {
    const text = readFileSync(join(LANE, from.file), "utf8").split(/\r?\n/)[lineOf(from.file, from.needle)];
    const word = /[A-Za-z0-9_$]/;
    const columns = [];
    for (let at = text.indexOf(from.symbol); at !== -1; at = text.indexOf(from.symbol, at + 1)) {
        const before = text[at - 1] ?? "";
        const after = text[at + from.symbol.length] ?? "";
        if (!(word.test(from.symbol[0]) && word.test(before)) && !(word.test(from.symbol.at(-1)) && word.test(after))) {
            columns.push(at);
        }
    }

    return columns[(from.occurrence ?? 1) - 1] ?? 0;
}

const site = (entry) => `${entry.file}:${lineOf(entry.file, entry.needle) + 1}`;

// --- a minimal LSP client over stdio ---------------------------------------------------------
const child = spawn(process.execPath, [SERVER, "--stdio"], { cwd: LANE, stdio: ["pipe", "pipe", "ignore"] });
let buffer = Buffer.alloc(0);
let nextId = 1;
const pending = new Map();

function send(message) {
    const text = JSON.stringify(message);
    child.stdin.write(`Content-Length: ${Buffer.byteLength(text, "utf8")}\r\n\r\n${text}`);
}

child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) {
            return;
        }
        const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, headerEnd).toString("ascii"))?.[1]);
        if (buffer.length < headerEnd + 4 + length) {
            return;
        }
        const message = JSON.parse(buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString("utf8"));
        buffer = buffer.subarray(headerEnd + 4 + length);
        if (message.method !== undefined && message.id !== undefined) {
            // A request from the server (configuration, progress): answer it so it never blocks.
            send({ jsonrpc: "2.0", id: message.id, result: message.method === "workspace/configuration" ? (message.params?.items ?? []).map(() => null) : null });
        } else if (message.id !== undefined && pending.has(message.id)) {
            pending.get(message.id)(message);
            pending.delete(message.id);
        }
    }
});

function request(method, params) {
    const id = nextId++;

    return new Promise((resolve) => {
        pending.set(id, resolve);
        send({ jsonrpc: "2.0", id, method, params });
    });
}

const notify = (method, params) => send({ jsonrpc: "2.0", method, params });

function laneSources(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (entry === "node_modules") {
            continue;
        }
        if (statSync(path).isDirectory()) {
            laneSources(path, out);
        } else if (/\.tsx?$/.test(entry)) {
            out.push(path);
        }
    }

    return out;
}

// --- the questions -----------------------------------------------------------------------------
const position = (task) => ({ textDocument: { uri: uriOf(task.from.file) }, position: { line: lineOf(task.from.file, task.from.needle), character: columnOf(task.from) } });

function hoverText(contents) {
    if (contents === undefined || contents === null) {
        return "";
    }
    if (typeof contents === "string") {
        return contents;
    }
    if (Array.isArray(contents)) {
        return contents.map(hoverText).join("\n");
    }

    return contents.value ?? "";
}

/** Every symbol the server lists, nested ones included, with the 1-based line of its name. */
function symbolEntries(symbols) {
    return (symbols ?? []).flatMap((symbol) => [
        { name: symbol.name, line: (symbol.selectionRange ?? symbol.range ?? symbol.location.range).start.line + 1 },
        ...symbolEntries(symbol.children),
    ]);
}

function locations(result) {
    return (Array.isArray(result) ? result : result ? [result] : []).map((location) => {
        const uri = location.targetUri ?? location.uri;
        const range = location.targetSelectionRange ?? location.range;

        return `${fileOfUri(uri)}:${range.start.line + 1}`;
    });
}

const brief = (items, limit = 6) => (items.length <= limit ? items.join(", ") : `${items.slice(0, limit).join(", ")}, ... (${items.length})`);

/** One answer: the verdict, what the server said, and the exact difference from the key. */
const answer = (verdict, detail, missing = [], extra = []) => ({ verdict, detail, missing, extra });
const sameItems = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
const all = (items) => items.join(", ") || "none";

async function ask(task) {
    const expect = task.expect;
    if (task.surface === "hover") {
        const text = hoverText((await request("textDocument/hover", position(task))).result?.contents);
        if (text === "") {
            return answer("server has no answer", "empty hover");
        }

        return text.includes(expect.contains)
            ? answer("agrees", `hover holds ${JSON.stringify(expect.contains)}`)
            : answer("disagrees", `hover is ${JSON.stringify(text.replace(/\s+/g, " ").slice(0, 160))}`, [JSON.stringify(expect.contains)]);
    }
    if (task.surface === "document_symbol") {
        const listed = symbolEntries((await request("textDocument/documentSymbol", { textDocument: { uri: uriOf(task.from.file) } })).result);
        if (listed.length === 0) {
            return answer("server has no answer", "no symbols");
        }
        // A multiset compare by name, with every line the server gives for that name: a name the
        // server lists more often than the key is an extra even when the key holds it once (an
        // object-literal key spelled like a property), so a name set would hide it.
        const missing = [];
        const extra = [];
        for (const name of [...new Set([...expect.symbols, ...listed.map((entry) => entry.name)])].sort()) {
            const keyed = expect.symbols.filter((symbol) => symbol === name).length;
            const lines = listed.filter((entry) => entry.name === name).map((entry) => entry.line).sort((left, right) => left - right);
            const shown = `\`${name}\` listed ${lines.length}x${lines.length > 0 ? ` (line ${lines.join(", ")})` : ""}, key ${keyed}x`;
            if (lines.length < keyed) {
                missing.push(shown);
            }
            if (lines.length > keyed) {
                extra.push(shown);
            }
        }

        return missing.length === 0 && extra.length === 0
            ? answer("agrees", `${listed.length} symbols listed, the key's ${expect.symbols.length} names with the same multiplicity`)
            : answer("disagrees", `${listed.length} symbols listed, the key holds ${expect.symbols.length}; listed fewer times than the key: ${all(missing)}; listed more times than the key: ${all(extra)}`, missing, extra);
    }
    if (task.surface === "call_hierarchy") {
        const item = (await request("textDocument/prepareCallHierarchy", position(task))).result?.[0];
        if (item === undefined) {
            return answer("server has no answer", "prepareCallHierarchy returned nothing");
        }
        if (Array.isArray(expect.incoming_includes)) {
            const calls = (await request("callHierarchy/incomingCalls", { item })).result ?? [];
            const sites = new Set(calls.flatMap((call) => call.fromRanges.map((range) => `${fileOfUri(call.from.uri)}:${range.start.line + 1}`)));
            const missing = expect.incoming_includes.map(site).filter((line) => !sites.has(line));

            return missing.length === 0
                ? answer("agrees", `${calls.length} caller(s); every keyed call site covered`)
                : answer("disagrees", `${calls.length} caller(s) (${brief(calls.map((call) => call.from.name))}); keyed call sites not returned: ${all(missing)}`, missing);
        }
        const calls = (await request("callHierarchy/outgoingCalls", { item })).result ?? [];
        const callees = new Set(calls.map((call) => `${fileOfUri(call.to.uri)}:${call.to.selectionRange.start.line + 1}`));
        const missing = expect.outgoing_includes.map(site).filter((line) => !callees.has(line));

        return missing.length === 0
            ? answer("agrees", `${calls.length} callee(s); every keyed callee returned`)
            : answer("disagrees", `${calls.length} callee(s) (${brief(calls.map((call) => call.to.name))}); keyed callees not returned: ${all(missing)}`, missing);
    }
    const returned = locations((await request("textDocument/implementation", position(task))).result);
    if (returned.length === 0) {
        return answer("server has no answer", "no locations");
    }
    const keyed = new Set(expect.implementations.map(site));
    const allowed = new Set([...keyed, ...(expect.optional_sites ?? []).map(site), site(task.from)]);
    const missing = [...keyed].filter((line) => !returned.includes(line));
    const extra = [...new Set(returned)].filter((line) => !allowed.has(line));

    return missing.length === 0 && extra.length === 0
        ? answer("agrees", `${returned.length} location(s): the key's ${keyed.size} plus only optional or asked-from lines`)
        : answer("disagrees", `${returned.length} location(s); keyed not returned: ${all(missing)}; returned beyond the key: ${all(extra)}`, missing, extra);
}

// --- run ---------------------------------------------------------------------------------------
const init = await request("initialize", {
    processId: process.pid,
    rootUri: pathToFileURL(LANE).href,
    capabilities: { textDocument: { hover: { contentFormat: ["plaintext"] }, documentSymbol: { hierarchicalDocumentSymbolSupport: true }, callHierarchy: {}, implementation: { linkSupport: false } } },
    initializationOptions: { tsserver: { path: TSSERVER } },
});
if (init.error !== undefined) {
    throw new Error(`initialize failed: ${JSON.stringify(init.error)}`);
}
notify("initialized", {});
const opened = laneSources(join(LANE, "packages")).filter((path) => /\/packages\/[^/]+\/(src|tests)\//.test(path));
for (const path of opened) {
    notify("textDocument/didOpen", { textDocument: { uri: pathToFileURL(path).href, languageId: path.endsWith(".tsx") ? "typescriptreact" : "typescript", version: 1, text: readFileSync(path, "utf8") } });
}

const rows = [];
const unread = [];
for (const task of tasks) {
    const result = await ask(task);
    const reading = DISPOSITIONS[task.id];
    let tree = "";
    if (result.verdict !== "agrees") {
        const covers = reading !== undefined
            && reading.verdict === result.verdict
            && sameItems(reading.missing, result.missing)
            && sameItems(reading.extra, result.extra);
        tree = covers ? ` Tree: ${reading.reading}` : " Tree: NOT READ (no DISPOSITIONS entry was written for exactly this answer).";
        if (!covers) {
            unread.push(task.id);
        }
    } else if (reading !== undefined) {
        unread.push(`${task.id} (agrees now, so its DISPOSITIONS entry is stale)`);
    }
    rows.push(`- \`${task.id}\` (${task.surface}): **${result.verdict}**. ${result.detail}.${tree}`);
}
for (const id of Object.keys(DISPOSITIONS).filter((id) => !tasks.some((task) => task.id === id))) {
    unread.push(`${id} (no such task)`);
}
await request("shutdown", null);
notify("exit", null);

const counts = ["agrees", "disagrees", "server has no answer"].map((verdict) => `${rows.filter((row) => row.includes(`**${verdict}**`)).length} ${verdict}`).join(", ");
writeFileSync(OUT, [
    "# Language-server check (issue #223, E.5)",
    "",
    "Generated by `node bench/lsp-check.mjs` (run from the lane root after `npm ci`); do not edit by hand.",
    "",
    `- Server: typescript-language-server ${version(SERVER_PACKAGE)} (devDependency, pinned in package-lock.json), started as \`node node_modules/typescript-language-server/lib/cli.mjs --stdio\`.`,
    `- TypeScript: ${version(join(LANE, "node_modules", "typescript"))}, the lane's own, passed as initializationOptions.tsserver.path = node_modules/typescript/lib/tsserver.js.`,
    `- Root: the lane directory; all ${opened.length} files under packages/*/src and packages/*/tests opened before the first question.`,
    `- Tasks: every hover, document_symbol, call_hierarchy and implementation task of bench/tasks.json (${tasks.length}): ${counts}.`,
    "- A key is never changed because the server disagrees; where it does, the line says what the tree shows. Each reading records the exact difference it was written for, and the script fails when the server's difference is not exactly that one.",
    "",
    ...rows,
    "",
].join("\n"));
console.log(`lsp-check: ${counts}; wrote ${laneRelative(OUT)}`);
if (unread.length > 0) {
    console.error(`lsp-check: FAIL, answers with no matching tree reading: ${unread.join("; ")}`);
    process.exitCode = 1;
}
