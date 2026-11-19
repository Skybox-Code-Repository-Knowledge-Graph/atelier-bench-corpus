#!/usr/bin/env node
// Score codebase-memory-mcp (cbm) on one lane: index a copy of the lane, ask every question, write
// an answer file.
//
//   node bench/adapters/codebase-memory-mcp/run.mjs --lane go --cbm <path to binary> --version 0.12.1 --out go.cbm.json
//
// The binary is passed explicitly and must report the pinned version. The lane is copied to a
// temporary directory and indexed there with an isolated HOME, so neither the checkout nor the
// caller's cbm index is touched. Scope is "lane": the tool sees only this lane. Each question is one
// `codebase-memory-mcp cli --json <tool>` call with the arguments on stdin.
//
// Exit 0 when an answer file was written, whatever cbm answered. Exit 2 when it could not be: wrong
// binary, or indexing failed.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { questionOf } from "../lib/question.mjs";
import { askCbm, parseEnvelope } from "./ask.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LANES = ["php", "rust", "typescript", "javascript", "python", "go"];
const SKIP_IN_COPY = new Set([".git", "node_modules", "target", "vendor", ".venv", ".codebase-memory"]);
const USAGE = "usage: run.mjs --lane <lane> --cbm <binary> --version <x.y.z> --out <file> [--keep-work <dir>]";

process.exit(await main(process.argv.slice(2)));

/** Run one cbm tool; the envelope's text and error flag, as `{ text, isError }`. */
function callTool(binary, env, tool, args) {
    const result = spawnSync(binary, ["cli", "--json", tool], { env, input: JSON.stringify(args), encoding: "utf8", maxBuffer: 1 << 28, timeout: 120000 });
    if (result.error) {
        throw new Error(`${tool} failed: ${result.error.message}`);
    }
    return parseEnvelope(result.stdout, tool, result.status ?? result.signal, result.stderr);
}

async function main(args) {
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
        const flag = args[index];
        if (!["--lane", "--cbm", "--version", "--out", "--keep-work"].includes(flag) || args[index + 1] === undefined) {
            return fail(USAGE);
        }
        options[flag.slice(2)] = args[index + 1];
    }
    if (!LANES.includes(options.lane) || !options.cbm || !options.version || !options.out) {
        return fail(USAGE);
    }

    const binary = resolve(options.cbm);
    const reported = spawnSync(binary, ["--version"], { encoding: "utf8" });
    const version = (reported.stdout ?? "").match(/^codebase-memory-mcp (\S+)/m)?.[1];
    if (version !== options.version) {
        return fail(`${binary} reports version ${version ?? "(none)"}, pinned ${options.version}`);
    }

    const laneRoot = join(REPO_ROOT, options.lane);
    const tasks = JSON.parse(readFileSync(join(laneRoot, "bench", "tasks.json"), "utf8")).tasks;

    const work = options["keep-work"] ? resolve(options["keep-work"]) : mkdtempSync(join(tmpdir(), "atelier-cbm-"));
    const copy = join(work, `lane-${options.lane}`);
    const home = join(work, "home");
    const project = `atelier-${options.lane}`;
    const env = { ...process.env, HOME: home, XDG_CACHE_HOME: join(home, ".cache"), XDG_CONFIG_HOME: join(home, ".config"), NO_COLOR: "1" };

    try {
        rmSync(copy, { recursive: true, force: true });
        mkdirSync(home, { recursive: true });
        cpSync(laneRoot, copy, { recursive: true, filter: (source) => !SKIP_IN_COPY.has(source.split(/[\\/]/).pop()) });

        const started = Date.now();
        let indexed;
        try {
            indexed = callTool(binary, env, "index_repository", { repo_path: copy, name: project });
        } catch (error) {
            return fail(`index_repository: ${error.message}`);
        }
        let report;
        try {
            report = JSON.parse(indexed.text);
        } catch {
            return fail(`index_repository reply is not JSON: ${indexed.text.slice(0, 300)}`);
        }
        if (indexed.isError || report.status !== "indexed" || report.project !== project) {
            return fail(`index_repository: ${indexed.text.slice(0, 300)}`);
        }
        const indexSeconds = Math.round((Date.now() - started) / 1000);

        const answers = {};
        let calls = 0;
        const call = async (tool, toolArgs) => {
            calls += 1;
            return callTool(binary, env, tool, { ...toolArgs, project });
        };
        for (const task of tasks) {
            const question = questionOf(task, laneRoot);
            if (question === null) {
                continue;
            }
            const answer = await askCbm(question, call, { parseErrors: report.parse_partial });
            if (answer !== undefined) {
                answers[task.id] = answer;
            }
        }

        // Nothing time-dependent goes into the answer file: two runs over the same lane and the
        // same cbm must write the same bytes.
        const document = {
            version: 1,
            tool: { name: "codebase-memory-mcp", version },
            lane: options.lane,
            scope: "lane",
            protocol: { definition: "raw", resolution: "raw", "import-precision": "raw", document_symbol: "file", "parse-negative": "file", diagnostics: "file" },
            run: { tool_calls: calls },
            answers,
        };
        writeFileSync(resolve(options.out), `${JSON.stringify(document, null, 2)}\n`);
        process.stderr.write(`codebase-memory-mcp ${version}, lane ${options.lane}: ${Object.keys(answers).length} answers, ${calls} tool calls, index ${indexSeconds}s\n`);
        return 0;
    } finally {
        if (!options["keep-work"]) {
            rmSync(work, { recursive: true, force: true });
        }
    }
}

function fail(message) {
    process.stderr.write(`codebase-memory-mcp adapter: ${message}\n`);
    return 2;
}
