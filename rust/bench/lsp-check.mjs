#!/usr/bin/env node
// Run the language server this lane's stack starts (rust-analyzer) over the lane's hover,
// document_symbol, call_hierarchy and implementation keys, and print one report line per task:
// agrees, disagrees, or no answer, with what the server returned.
//
//   node bench/lsp-check.mjs [--root <lane dir>] [--server <command>] [--timeout <seconds>] [-- <server args>]
//
// Run it from the lane root (rust/). CI runs it in the `rust` job of .github/workflows/corpus.yml
// with the rust-analyzer rustup component of the pinned toolchain; bench/lsp-check.md is that
// output. The report never changes a key: where the server and a key disagree, the tree is read
// by hand and the disagreement is written down next to the report.
//
// Zero dependencies. Exit 0 whatever the verdicts are; exit 1 only when the server cannot be
// started, does not initialize, or never reports that it finished loading the workspace.

import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The surfaces a language server answers directly. */
export const SURFACES = ["hover", "document_symbol", "call_hierarchy", "implementation"];

const REQUEST_TIMEOUT_MS = 60_000;
const CONTENT_MODIFIED = -32801;

// ---------------------------------------------------------------------------------------------
// Task geometry: where a task asks from, in LSP coordinates.

/** The 0-based line of `text` that holds `needle`; it must be exactly one line. */
export function lineOf(text, needle) {
    const lines = text.split(/\r?\n/);
    const hits = [];
    lines.forEach((line, index) => {
        if (line.includes(needle)) {
            hits.push(index);
        }
    });
    if (hits.length !== 1) {
        throw new Error(`needle found ${hits.length} times: ${needle}`);
    }

    return { line: hits[0], text: lines[hits[0]] };
}

/**
 * The UTF-16 column of the `occurrence`-th (1-based) whole-word `symbol` on `lineText`, which is
 * the unit LSP positions use by default and the unit JavaScript strings index in.
 */
export function columnOf(lineText, symbol, occurrence = 1) {
    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const word = new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, "g");
    let seen = 0;
    for (const match of lineText.matchAll(word)) {
        seen += 1;
        if (seen === occurrence) {
            return match.index;
        }
    }

    throw new Error(`symbol ${symbol} (occurrence ${occurrence}) not on line: ${lineText.trim()}`);
}

/** A {file, needle} site as a 0-based line in a lane-relative file. */
function siteLine(root, site) {
    return { file: site.file, line: lineOf(readFileSync(resolve(root, site.file), "utf8"), site.needle).line };
}

// ---------------------------------------------------------------------------------------------
// Answer normalisation.

/** A file URI as a lane-relative path, or a marker naming only its last two segments. */
export function laneRelative(root, uri) {
    let path;
    try {
        path = fileURLToPath(uri);
    } catch {
        return `(not a file: ${uri})`;
    }
    const rel = relative(root, path);
    if (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)) {
        return rel.split(sep).join("/");
    }

    return `(outside the lane) .../${path.split(sep).slice(-2).join("/")}`;
}

/** Location | Location[] | LocationLink[] | null as [{uri, start, end}] (0-based lines). */
export function locations(result) {
    if (result === null || result === undefined) {
        return [];
    }

    return (Array.isArray(result) ? result : [result]).map((entry) => {
        const uri = entry.targetUri ?? entry.uri;
        const range = entry.targetRange ?? entry.range;
        const focus = entry.targetSelectionRange ?? entry.range;

        return { uri, start: range.start.line, end: range.end.line, focus: focus.start.line };
    });
}

/** Hover contents (MarkupContent, MarkedString or MarkedString[]) as one string. */
export function hoverText(result) {
    const contents = result?.contents;
    if (contents === undefined || contents === null) {
        return "";
    }
    const parts = Array.isArray(contents) ? contents : [contents];

    return parts.map((part) => (typeof part === "string" ? part : part.value ?? "")).join("\n");
}

/** Every symbol name of a DocumentSymbol tree (or a flat SymbolInformation list), depth first. */
export function symbolNames(result) {
    const names = [];
    const walk = (symbols) => {
        for (const symbol of symbols ?? []) {
            names.push(symbol.name);
            walk(symbol.children);
        }
    };
    walk(result);

    return names;
}

function oneLine(text, limit = 160) {
    const flat = text.replace(/\s+/g, " ").trim();

    return flat.length > limit ? `${flat.slice(0, limit - 3)}...` : flat;
}

function place(root, loc) {
    return `${laneRelative(root, loc.uri)}:${loc.focus + 1}`;
}

// ---------------------------------------------------------------------------------------------
// Verdicts: compare one answer with one key. The key is never changed here.

export function judgeHover(task, result) {
    const text = hoverText(result);
    const wanted = task.expect.contains;
    if (text.trim() === "") {
        return { verdict: "no answer", detail: "empty hover" };
    }
    if (text.includes(wanted)) {
        return { verdict: "agrees", detail: `contains "${wanted}"` };
    }
    if (oneLine(text, Infinity).includes(wanted)) {
        return { verdict: "agrees", detail: `contains "${wanted}" once line breaks are folded` };
    }

    return { verdict: "disagrees", detail: `"${wanted}" absent; hover: ${oneLine(text)}` };
}

export function judgeDocumentSymbol(task, result) {
    const returned = symbolNames(result);
    if (returned.length === 0) {
        return { verdict: "no answer", detail: "no symbols" };
    }
    const remaining = [...returned];
    const missing = [];
    for (const name of task.expect.symbols ?? []) {
        const index = remaining.indexOf(name);
        if (index === -1) {
            missing.push(name);
        } else {
            remaining.splice(index, 1);
        }
    }
    const counts = `${returned.length} returned, key N = ${(task.expect.symbols ?? []).length}, min_symbols ${task.expect.min_symbols}`;
    if (missing.length === 0 && remaining.length === 0) {
        return { verdict: "agrees", detail: `${counts}; same names` };
    }

    return {
        verdict: "disagrees",
        detail: `${counts}; key names not returned: [${missing.join(", ")}]; returned names not in the key: [${remaining.join(", ")}]`,
    };
}

export function judgeImplementation(root, task, result) {
    const found = locations(result);
    if (found.length === 0) {
        return { verdict: "no answer", detail: "no locations" };
    }
    const keyed = (task.expect.implementations ?? []).map((site) => siteLine(root, site));
    const optional = (task.expect.optional_sites ?? []).map((site) => siteLine(root, site));
    const covers = (site, loc) => laneRelative(root, loc.uri) === site.file && loc.start <= site.line && site.line <= loc.end;
    const missing = keyed.filter((site) => !found.some((loc) => covers(site, loc)));
    const extra = found.filter((loc) => ![...keyed, ...optional].some((site) => covers(site, loc)));
    const counts = `${found.length} returned, key exact_count ${task.expect.exact_count}`;
    if (missing.length === 0 && extra.length === 0) {
        return { verdict: "agrees", detail: `${counts}; every keyed implementation returned, nothing else` };
    }

    return {
        verdict: "disagrees",
        detail: `${counts}; keyed but not returned: [${missing.map((site) => `${site.file}:${site.line + 1}`).join(", ")}]; returned but not keyed: [${extra.map((loc) => place(root, loc)).join(", ")}]`,
    };
}

export function judgeCallHierarchy(root, task, prepared, outgoing, incoming) {
    if (!Array.isArray(prepared) || prepared.length === 0) {
        return { verdict: "no answer", detail: "prepareCallHierarchy returned nothing" };
    }
    const notes = [];
    let agrees = true;

    const wantOut = (task.expect.outgoing_includes ?? []).map((site) => siteLine(root, site));
    if (wantOut.length > 0) {
        const callees = (outgoing ?? []).map((call) => call.to);
        for (const site of wantOut) {
            const hit = callees.some((item) => laneRelative(root, item.uri) === site.file
                && (item.selectionRange.start.line === site.line || (item.range.start.line <= site.line && site.line <= item.range.end.line)));
            if (!hit) {
                agrees = false;
            }
            notes.push(`callee ${site.file}:${site.line + 1} ${hit ? "returned" : "NOT returned"}`);
        }
        notes.push(`outgoing: [${callees.map((item) => `${item.name} ${laneRelative(root, item.uri)}:${item.selectionRange.start.line + 1}`).join(", ")}]`);
    }

    const wantIn = (task.expect.incoming_includes ?? []).map((site) => siteLine(root, site));
    if (wantIn.length > 0) {
        const calls = incoming ?? [];
        for (const site of wantIn) {
            const hit = calls.some((call) => laneRelative(root, call.from.uri) === site.file
                && call.fromRanges.some((range) => range.start.line <= site.line && site.line <= range.end.line));
            if (!hit) {
                agrees = false;
            }
            notes.push(`call ${site.file}:${site.line + 1} ${hit ? "returned" : "NOT returned"}`);
        }
        const floor = task.expect.min_incoming;
        if (floor !== undefined && calls.length < floor) {
            agrees = false;
        }
        notes.push(`${calls.length} callers (min_incoming ${floor ?? "none"}): [${calls.map((call) => `${call.from.name} ${laneRelative(root, call.from.uri)}`).join(", ")}]`);
    }

    const emptyOut = wantOut.length === 0 || (outgoing ?? []).length === 0;
    const emptyIn = wantIn.length === 0 || (incoming ?? []).length === 0;
    const nothing = emptyOut && emptyIn;
    if (nothing) {
        return { verdict: "no answer", detail: notes.join("; ") };
    }

    return { verdict: agrees ? "agrees" : "disagrees", detail: notes.join("; ") };
}

// ---------------------------------------------------------------------------------------------
// A minimal LSP client over stdio (JSON-RPC 2.0 with Content-Length framing).

/** Frame one JSON-RPC message. */
export function frame(message) {
    const body = Buffer.from(JSON.stringify(message), "utf8");

    return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

/** Incremental parser: feed it chunks, it calls `onMessage` with each complete message. */
export function createParser(onMessage) {
    let buffer = Buffer.alloc(0);

    return (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        for (;;) {
            const headerEnd = buffer.indexOf("\r\n\r\n");
            if (headerEnd === -1) {
                return;
            }
            const header = buffer.subarray(0, headerEnd).toString("ascii");
            const length = Number(/Content-Length:\s*(\d+)/i.exec(header)?.[1]);
            if (!Number.isInteger(length)) {
                throw new Error(`bad LSP header: ${header}`);
            }
            const start = headerEnd + 4;
            if (buffer.length < start + length) {
                return;
            }
            const body = buffer.subarray(start, start + length).toString("utf8");
            buffer = buffer.subarray(start + length);
            onMessage(JSON.parse(body));
        }
    };
}

class Client {
    constructor(command, args, cwd) {
        this.next = 1;
        this.pending = new Map();
        this.stderr = "";
        this.quiescent = false;
        this.readyWaiters = [];
        this.exited = null;
        this.child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
        this.child.stderr.on("data", (chunk) => {
            this.stderr = (this.stderr + chunk.toString("utf8")).slice(-20_000);
        });
        this.child.on("error", (error) => this.fail(error));
        this.child.on("exit", (code, signal) => {
            this.exited = { code, signal };
            this.fail(new Error(`server exited (code ${code}, signal ${signal})`));
        });
        this.child.stdout.on("data", createParser((message) => this.receive(message)));
    }

    fail(error) {
        for (const { reject } of this.pending.values()) {
            reject(error);
        }
        this.pending.clear();
        for (const waiter of this.readyWaiters) {
            waiter.reject(error);
        }
        this.readyWaiters = [];
    }

    write(message) {
        if (this.exited === null) {
            this.child.stdin.write(frame(message));
        }
    }

    receive(message) {
        if (message.id !== undefined && message.method === undefined) {
            const waiter = this.pending.get(message.id);
            if (waiter !== undefined) {
                this.pending.delete(message.id);
                clearTimeout(waiter.timer);
                if (message.error) {
                    const error = new Error(message.error.message);
                    error.code = message.error.code;
                    waiter.reject(error);
                } else {
                    waiter.resolve(message.result ?? null);
                }
            }

            return;
        }
        if (message.id !== undefined) {
            // A request from the server: answer it, or the server waits on us.
            const result = message.method === "workspace/configuration"
                ? (message.params?.items ?? []).map(() => null)
                : null;
            this.write({ jsonrpc: "2.0", id: message.id, result });

            return;
        }
        if (message.method === "experimental/serverStatus" && message.params?.quiescent === true) {
            this.quiescent = true;
            for (const waiter of this.readyWaiters) {
                waiter.resolve();
            }
            this.readyWaiters = [];
        }
    }

    request(method, params, timeoutMs = REQUEST_TIMEOUT_MS) {
        const id = this.next++;

        return new Promise((resolvePromise, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`${method} timed out after ${timeoutMs} ms`));
            }, timeoutMs);
            this.pending.set(id, { resolve: resolvePromise, reject, timer });
            this.write({ jsonrpc: "2.0", id, method, params });
        });
    }

    notify(method, params) {
        this.write({ jsonrpc: "2.0", method, params });
    }

    ready(timeoutMs) {
        if (this.quiescent) {
            return Promise.resolve();
        }

        return new Promise((resolvePromise, reject) => {
            const timer = setTimeout(() => reject(new Error(`no quiescent serverStatus within ${timeoutMs} ms`)), timeoutMs);
            this.readyWaiters.push({
                resolve: () => {
                    clearTimeout(timer);
                    resolvePromise();
                },
                reject: (error) => {
                    clearTimeout(timer);
                    reject(error);
                },
            });
        });
    }

    async close() {
        try {
            await this.request("shutdown", null, 10_000);
            this.notify("exit", null);
        } catch {
            // The report is already complete; a server that will not shut down is killed.
        }
        await new Promise((done) => {
            if (this.exited !== null) {
                done();

                return;
            }
            const timer = setTimeout(() => {
                this.child.kill("SIGKILL");
                done();
            }, 5_000);
            this.child.on("exit", () => {
                clearTimeout(timer);
                done();
            });
        });
    }
}

/** A request that rust-analyzer may cancel with ContentModified while it settles: retry it. */
async function ask(client, method, params) {
    for (let attempt = 1; ; attempt += 1) {
        try {
            return await client.request(method, params);
        } catch (error) {
            if (error.code !== CONTENT_MODIFIED || attempt === 5) {
                throw error;
            }
            await new Promise((done) => setTimeout(done, 2_000));
        }
    }
}

const CAPABILITIES = {
    general: { positionEncodings: ["utf-16"] },
    window: { workDoneProgress: true },
    experimental: { serverStatusNotification: true },
    textDocument: {
        hover: { contentFormat: ["markdown", "plaintext"] },
        documentSymbol: { hierarchicalDocumentSymbolSupport: true },
        implementation: { linkSupport: false },
        callHierarchy: {},
        synchronization: {},
    },
};

const INITIALIZATION_OPTIONS = {
    cargo: { buildScripts: { enable: true } },
    procMacro: { enable: true },
    checkOnSave: false,
    cachePriming: { enable: true },
};

// ---------------------------------------------------------------------------------------------
// The run.

/** The lane's tasks on the four language-server surfaces, in file order. */
export function lspTasks(root) {
    const manifest = JSON.parse(readFileSync(resolve(root, "bench/tasks.json"), "utf8"));

    return manifest.tasks.filter((task) => SURFACES.includes(task.surface));
}

async function checkTask(client, root, task) {
    const fromPath = resolve(root, task.from.file);
    const textDocument = { uri: pathToFileURL(fromPath).href };
    if (task.surface === "document_symbol") {
        return judgeDocumentSymbol(task, await ask(client, "textDocument/documentSymbol", { textDocument }));
    }
    const at = lineOf(readFileSync(fromPath, "utf8"), task.from.needle);
    const position = { line: at.line, character: columnOf(at.text, task.from.symbol, task.from.occurrence ?? 1) };
    if (task.surface === "hover") {
        return judgeHover(task, await ask(client, "textDocument/hover", { textDocument, position }));
    }
    if (task.surface === "implementation") {
        return judgeImplementation(root, task, await ask(client, "textDocument/implementation", { textDocument, position }));
    }
    const prepared = await ask(client, "textDocument/prepareCallHierarchy", { textDocument, position });
    if (!Array.isArray(prepared) || prepared.length === 0) {
        return judgeCallHierarchy(root, task, prepared, null, null);
    }
    const item = prepared[0];
    const outgoing = task.expect.outgoing_includes ? await ask(client, "callHierarchy/outgoingCalls", { item }) : null;
    const incoming = task.expect.incoming_includes ? await ask(client, "callHierarchy/incomingCalls", { item }) : null;

    return judgeCallHierarchy(root, task, prepared, outgoing, incoming);
}

function escapeCell(text) {
    return String(text).replace(/\|/g, "\\|");
}

/**
 * Start the server, wait until it reports a quiescent workspace, check every task, and return
 * the report as lines. Throws only when the server cannot be used at all.
 */
export async function run({ root, command, args = [], readyTimeoutMs = 900_000, version = null, env = process.env }) {
    const tasks = lspTasks(root);
    const started = Date.now();
    const client = new Client(command, args, root);
    const lines = [];
    try {
        const init = await client.request("initialize", {
            processId: process.pid,
            clientInfo: { name: "lane-lsp-check" },
            rootUri: pathToFileURL(root).href,
            workspaceFolders: [{ uri: pathToFileURL(root).href, name: "lane" }],
            capabilities: CAPABILITIES,
            initializationOptions: INITIALIZATION_OPTIONS,
        }, readyTimeoutMs);
        client.notify("initialized", {});
        await client.ready(readyTimeoutMs);
        const readySeconds = Math.round((Date.now() - started) / 1000);

        const opened = new Set();
        for (const task of tasks) {
            if (!opened.has(task.from.file)) {
                opened.add(task.from.file);
                const path = resolve(root, task.from.file);
                client.notify("textDocument/didOpen", {
                    textDocument: { uri: pathToFileURL(path).href, languageId: "rust", version: 1, text: readFileSync(path, "utf8") },
                });
            }
        }

        const rows = [];
        const tally = { agrees: 0, disagrees: 0, "no answer": 0 };
        for (const task of tasks) {
            let outcome;
            try {
                outcome = await checkTask(client, root, task);
            } catch (error) {
                outcome = { verdict: "no answer", detail: `request failed: ${error.message}` };
            }
            tally[outcome.verdict] += 1;
            rows.push(`| ${task.id} | ${task.surface} | ${outcome.verdict} | ${escapeCell(outcome.detail)} |`);
        }

        const bySurface = SURFACES.map((surface) => `${surface} ${tasks.filter((task) => task.surface === surface).length}`).join(", ");
        const info = init?.serverInfo ? `${init.serverInfo.name} ${init.serverInfo.version ?? ""}`.trim() : "not sent";
        lines.push("<!-- lsp-check begin -->");
        lines.push(`- server: \`${version ?? "version not probed"}\`; initialize serverInfo: \`${info}\``);
        lines.push(`- command: \`node bench/lsp-check.mjs --server ${command}${args.length > 0 ? ` -- ${args.join(" ")}` : ""}\`, run from the lane root`);
        lines.push(`- run: ${env.GITHUB_RUN_ID ? `GitHub Actions run ${env.GITHUB_RUN_ID}, commit ${env.GITHUB_SHA ?? "?"}` : "local"}`);
        lines.push(`- workspace quiescent after ${readySeconds} s (experimental/serverStatus)`);
        lines.push(`- tasks: ${tasks.length} (${bySurface}); agrees ${tally.agrees}, disagrees ${tally.disagrees}, no answer ${tally["no answer"]}`);
        lines.push("");
        lines.push("| task | surface | verdict | what the server returned |");
        lines.push("| --- | --- | --- | --- |");
        lines.push(...rows);
        lines.push("<!-- lsp-check end -->");
    } catch (error) {
        error.message = `${error.message}\nserver stderr (tail):\n${client.stderr.slice(-4_000)}`;
        throw error;
    } finally {
        await client.close();
    }

    return lines;
}

function parseArgs(argv) {
    const options = { root: process.cwd(), command: "rust-analyzer", args: [], timeout: 900 };
    for (let index = 0; index < argv.length; index += 1) {
        const flag = argv[index];
        if (flag === "--") {
            options.args = argv.slice(index + 1);
            break;
        }
        const value = argv[index + 1];
        if (flag === "--root") {
            options.root = resolve(value);
        } else if (flag === "--server") {
            options.command = value;
        } else if (flag === "--timeout") {
            options.timeout = Number(value);
        } else {
            throw new Error(`unknown flag ${flag}`);
        }
        index += 1;
    }

    return options;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const probe = spawnSync(options.command, ["--version"], { encoding: "utf8" });
    const version = probe.status === 0 ? probe.stdout.trim() : null;
    try {
        const lines = await run({
            root: options.root,
            command: options.command,
            args: options.args,
            readyTimeoutMs: options.timeout * 1000,
            version,
        });
        process.stdout.write(`${lines.join("\n")}\n`);
    } catch (error) {
        process.stderr.write(`lsp-check: FAIL ${error.message}\n`);
        process.exitCode = 1;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    await main();
}
