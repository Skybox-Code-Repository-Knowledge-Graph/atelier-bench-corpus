// E.5: run the language server this lane's stack starts over its hover, document_symbol,
// call_hierarchy and implementation keys, and write bench/lsp-check.md.
//
//   node bench/lsp-check.mjs            # from javascript/, after npm ci
//
// The server is the exact-pinned typescript-language-server devDependency, driving the
// TypeScript language service of the exact-pinned typescript (its tsserver.js under
// node_modules), over the project jsconfig.json defines. Each task is judged against the key:
// agrees, disagrees (with what the server returned), or server has no answer. The key is never
// changed here: where the two disagree, the tree decides, and the reading is written by hand
// below the HAND_MARKER line of the report, which a rerun keeps.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SURFACES = ["hover", "document_symbol", "call_hierarchy", "implementation"];
export const HAND_MARKER = "<!-- Everything below this line is written by hand and kept by reruns. -->";
const LANE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 0-based { line, character } of a task's from symbol (or the needle start when it names none). */
export function positionOf(source, from) {
    const lines = source.split("\n");
    const line = lines.findIndex((text) => text.includes(from.needle));
    if (line < 0) throw new Error(`needle not found: ${from.needle}`);
    const text = lines[line];
    let character = text.indexOf(from.needle);
    if (typeof from.symbol === "string") {
        const pattern = new RegExp(`(?<![A-Za-z0-9_$])${from.symbol.replace(/[$]/g, "\\$")}(?![A-Za-z0-9_$])`, "g");
        const hits = [...text.matchAll(pattern)].map((match) => match.index);
        character = hits[(from.occurrence ?? 1) - 1] ?? character;
    }
    return { line, character };
}

/** 1-based line of a file+needle entry. */
export function lineOfEntry(root, entry) {
    return readFileSync(join(root, entry.file), "utf8").split("\n").findIndex((text) => text.includes(entry.needle)) + 1;
}

const laneRelative = (root, uri) => relative(root, fileURLToPath(uri)).split(sep).join("/");
const site = (root, uri, range) => `${laneRelative(root, uri)}:${range.start.line + 1}`;

export function hoverText(result) {
    if (!result || !result.contents) return "";
    const parts = Array.isArray(result.contents) ? result.contents : [result.contents];
    return parts.map((part) => (typeof part === "string" ? part : part.value ?? "")).join("\n");
}

export function judgeHover(task, result) {
    const text = hoverText(result);
    if (text === "") return { verdict: "server has no answer", returned: "no hover" };
    const one = text.replace(/\s+/g, " ").trim();
    return text.includes(task.expect.contains)
        ? { verdict: "agrees", returned: `hover holds "${task.expect.contains}"` }
        : { verdict: "disagrees", returned: `hover without the key string: "${one.slice(0, 140)}"` };
}

export function symbolNames(result) {
    const names = [];
    const walk = (symbol) => {
        names.push(symbol.name);
        for (const child of symbol.children ?? []) walk(child);
    };
    for (const symbol of result ?? []) walk(symbol);
    return names;
}

export function judgeSymbols(task, result) {
    const names = symbolNames(result);
    if (names.length === 0) return { verdict: "server has no answer", returned: "no symbols" };
    const key = new Set(task.expect.symbols);
    const got = new Set(names);
    const missing = [...key].filter((name) => !got.has(name));
    const extra = [...got].filter((name) => !key.has(name));
    if (missing.length === 0 && extra.length === 0) return { verdict: "agrees", returned: `${got.size} names, the key's ${key.size}` };
    return {
        verdict: "disagrees",
        returned: `${got.size} distinct names against the key's ${key.size}; missing ${missing.length}${missing.length ? ` (${missing.join(", ")})` : ""}; extra ${extra.length}${extra.length ? ` (${extra.slice(0, 12).join(", ")}${extra.length > 12 ? ", ..." : ""})` : ""}`,
    };
}

/** Each key entry is a 1-based "file:line"; returned are "file:line" strings or {file, start, end} spans. */
export function judgeListed(keyed, returnedSpans, noun) {
    if (returnedSpans.length === 0) return { verdict: "server has no answer", returned: `no ${noun}` };
    const covered = (entry) => returnedSpans.some((span) => span.file === entry.file && span.start <= entry.line && entry.line <= span.end);
    const missing = keyed.filter((entry) => !covered(entry));
    const shown = returnedSpans.map((span) => `${span.file}:${span.start}`);
    return missing.length === 0
        ? { verdict: "agrees", returned: `${returnedSpans.length} ${noun}, every keyed one among them` }
        : { verdict: "disagrees", returned: `${returnedSpans.length} ${noun} (${shown.slice(0, 6).join(", ")}${shown.length > 6 ? ", ..." : ""}); missing ${missing.map((entry) => `${entry.file}:${entry.line}`).join(", ")}` };
}

export function judgeImplementation(keyed, optional, returnedSites) {
    if (returnedSites.length === 0) return { verdict: "server has no answer", returned: "no locations" };
    const want = new Set(keyed);
    const neutral = new Set(optional);
    const got = new Set(returnedSites);
    const missing = [...want].filter((entry) => !got.has(entry));
    const extra = [...got].filter((entry) => !want.has(entry) && !neutral.has(entry));
    if (missing.length === 0 && extra.length === 0) return { verdict: "agrees", returned: `${got.size} locations, the key's ${want.size} (+ optional sites)` };
    return { verdict: "disagrees", returned: `${got.size} locations against the key's ${want.size}; missing ${missing.length}; extra ${extra.length}${extra.length ? ` (${extra.slice(0, 6).join(", ")}${extra.length > 6 ? ", ..." : ""})` : ""}` };
}

class Client {
    constructor(child) {
        this.child = child;
        this.next = 1;
        this.pending = new Map();
        this.buffer = Buffer.alloc(0);
        this.log = [];
        child.stdout.on("data", (chunk) => this.read(chunk));
    }

    read(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        for (;;) {
            const head = this.buffer.indexOf("\r\n\r\n");
            if (head < 0) return;
            const length = Number(/Content-Length: (\d+)/i.exec(this.buffer.subarray(0, head).toString())?.[1]);
            if (this.buffer.length < head + 4 + length) return;
            const message = JSON.parse(this.buffer.subarray(head + 4, head + 4 + length).toString());
            this.buffer = this.buffer.subarray(head + 4 + length);
            if (message.id !== undefined && this.pending.has(message.id)) {
                this.pending.get(message.id)(message);
                this.pending.delete(message.id);
            } else if (message.method === "window/logMessage") {
                this.log.push(message.params.message);
            } else if (message.id !== undefined && message.method) {
                this.send({ jsonrpc: "2.0", id: message.id, result: null });
            }
        }
    }

    send(message) {
        const body = JSON.stringify(message);
        this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    }

    request(method, params) {
        const id = this.next++;
        return new Promise((resolve) => {
            this.pending.set(id, (message) => resolve(message.result ?? null));
            this.send({ jsonrpc: "2.0", id, method, params });
        });
    }

    notify(method, params) {
        this.send({ jsonrpc: "2.0", method, params });
    }
}

const pinned = (root, name) => JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8")).version;

async function main(root = LANE_ROOT) {
    const tasks = JSON.parse(readFileSync(join(root, "bench", "tasks.json"), "utf8")).tasks.filter((task) => SURFACES.includes(task.surface));
    const tsserver = join(root, "node_modules", "typescript", "lib", "tsserver.js");
    const child = spawn(process.execPath, [join(root, "node_modules", "typescript-language-server", "lib", "cli.mjs"), "--stdio"], { cwd: root, stdio: ["pipe", "pipe", "ignore"] });
    const client = new Client(child);
    await client.request("initialize", {
        processId: process.pid,
        rootUri: pathToFileURL(root).href,
        capabilities: { textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true }, hover: { contentFormat: ["markdown", "plaintext"] } } },
        initializationOptions: { tsserver: { path: tsserver } },
    });
    client.notify("initialized", {});
    const opened = new Set();
    const open = (file) => {
        const uri = pathToFileURL(join(root, file)).href;
        if (!opened.has(uri)) {
            opened.add(uri);
            client.notify("textDocument/didOpen", { textDocument: { uri, languageId: "javascript", version: 1, text: readFileSync(join(root, file), "utf8") } });
        }
        return uri;
    };
    const span = (uri, range) => ({ file: laneRelative(root, uri), start: range.start.line + 1, end: range.end.line + 1 });
    const rows = [];
    for (const task of tasks) {
        const uri = open(task.from.file);
        const position = positionOf(readFileSync(join(root, task.from.file), "utf8"), task.from);
        const at = { textDocument: { uri }, position };
        let judged;
        if (task.surface === "hover") {
            judged = judgeHover(task, await client.request("textDocument/hover", at));
        } else if (task.surface === "document_symbol") {
            judged = judgeSymbols(task, await client.request("textDocument/documentSymbol", { textDocument: { uri } }));
        } else if (task.surface === "implementation") {
            const result = (await client.request("textDocument/implementation", at)) ?? [];
            const sites = result.map((location) => site(root, location.uri ?? location.targetUri, location.range ?? location.targetSelectionRange));
            const entry = (item) => `${item.file}:${lineOfEntry(root, item)}`;
            judged = judgeImplementation(task.expect.implementations.map(entry), (task.expect.optional_sites ?? []).map(entry), sites);
        } else {
            const items = (await client.request("textDocument/prepareCallHierarchy", at)) ?? [];
            const outgoing = Array.isArray(task.expect.outgoing_includes);
            const list = outgoing ? task.expect.outgoing_includes : task.expect.incoming_includes;
            const keyed = list.map((item) => ({ file: item.file, line: lineOfEntry(root, item) }));
            const spans = [];
            for (const item of items) {
                if (outgoing) {
                    for (const call of (await client.request("callHierarchy/outgoingCalls", { item })) ?? []) spans.push(span(call.to.uri, call.to.selectionRange));
                } else {
                    for (const call of (await client.request("callHierarchy/incomingCalls", { item })) ?? []) {
                        for (const range of call.fromRanges ?? []) spans.push(span(call.from.uri, range));
                    }
                }
            }
            judged = judgeListed(keyed, spans, outgoing ? "callees" : "call lines");
        }
        rows.push(`| \`${task.id}\` | ${task.surface} | ${judged.verdict} | ${judged.returned.replace(/\|/g, "\\|")} |`);
    }
    await client.request("shutdown", null);
    client.notify("exit", null);
    child.kill();
    const path = join(root, "bench", "lsp-check.md");
    const kept = existsSync(path) && readFileSync(path, "utf8").includes(HAND_MARKER) ? readFileSync(path, "utf8").split(HAND_MARKER)[1] : "\n";
    const report = [
        "# Language-server check (E.5)",
        "",
        `Server: \`typescript-language-server\` ${pinned(root, "typescript-language-server")} (exact-pinned devDependency) driving the TypeScript language service of \`typescript\` ${pinned(root, "typescript")} (\`node_modules/typescript/lib/tsserver.js\`, exact-pinned); project \`jsconfig.json\` (\`packages/*/src\` only, so test files are outside it).`,
        "",
        "Command: `node bench/lsp-check.mjs`, run from `javascript/` after `npm ci`; it rewrites the table below and keeps the hand-written part. Each task is asked at its `from` position (hover, prepareCallHierarchy + outgoing/incoming calls, implementation) or on its file (documentSymbol).",
        "",
        `${tasks.length} tasks: ${["agrees", "disagrees", "server has no answer"].map((verdict) => `${rows.filter((row) => row.includes(`| ${verdict} |`)).length} ${verdict}`).join(", ")}.`,
        "",
        "| task | surface | verdict | what the server returned |",
        "| --- | --- | --- | --- |",
        ...rows,
        "",
        HAND_MARKER,
    ].join("\n");
    writeFileSync(path, `${report}${kept}`);
    process.stdout.write(`${report.split("\n").slice(6, 7).join("")}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
