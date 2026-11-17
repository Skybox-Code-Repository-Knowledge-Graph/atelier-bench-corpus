#!/usr/bin/env node
// Score skybox on one lane: index a copy of the lane, ask every question, write an answer file.
//
//   node bench/adapters/skybox/run.mjs --lane go --skybox <path to skybox> --version 0.9.0 --out go.skybox.json
//
// The binary is passed explicitly and must report the pinned version. The lane is copied to a
// temporary directory and indexed there with its own SKYBOX_HOME, so neither the checkout nor the
// caller's skybox registry is touched. Scope is "lane": the tool sees only this lane.
//
// Exit 0 when an answer file was written, whatever skybox answered. Exit 2 when it could not be:
// wrong binary, indexing failed, or the server could not be started.

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { McpStdioClient } from "../lib/mcp.mjs";
import { questionOf } from "../lib/question.mjs";
import { askSkybox } from "./ask.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LANES = ["php", "rust", "typescript", "javascript", "python", "go"];
const SKIP_IN_COPY = new Set([".skybox", "node_modules", "target", "vendor", ".venv"]);

process.exit(await main(process.argv.slice(2)));

async function main(args) {
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
        const flag = args[index];
        if (!["--lane", "--skybox", "--version", "--out", "--keep-work"].includes(flag) || args[index + 1] === undefined) {
            return fail("usage: run.mjs --lane <lane> --skybox <binary> --version <x.y.z> --out <file> [--keep-work <dir>]");
        }
        options[flag.slice(2)] = args[index + 1];
    }
    if (!LANES.includes(options.lane) || !options.skybox || !options.version || !options.out) {
        return fail("usage: run.mjs --lane <lane> --skybox <binary> --version <x.y.z> --out <file> [--keep-work <dir>]");
    }

    const binary = resolve(options.skybox);
    const reported = spawnSync(binary, ["--version"], { encoding: "utf8" });
    const version = (reported.stdout ?? "").match(/^skybox (\S+)/m)?.[1];
    if (version !== options.version) {
        return fail(`${binary} reports version ${version ?? "(none)"}, pinned ${options.version}`);
    }

    const laneRoot = join(REPO_ROOT, options.lane);
    const tasks = JSON.parse(readFileSync(join(laneRoot, "bench", "tasks.json"), "utf8")).tasks;

    const work = options["keep-work"] ? resolve(options["keep-work"]) : mkdtempSync(join(tmpdir(), "atelier-skybox-"));
    const copy = join(work, `lane-${options.lane}`);
    const home = join(work, "home");
    const repoName = `atelier-${options.lane}`;
    const env = { ...process.env, SKYBOX_HOME: home, NO_COLOR: "1" };

    try {
        rmSync(copy, { recursive: true, force: true });
        cpSync(laneRoot, copy, { recursive: true, filter: (source) => !SKIP_IN_COPY.has(source.split(/[\\/]/).pop()) });

        const started = Date.now();
        const indexed = spawnSync(binary, ["index", copy, "--no-embed", "--name", repoName], { env, encoding: "utf8", maxBuffer: 1 << 26 });
        if (indexed.status !== 0) {
            return fail(`skybox index exited ${indexed.status}: ${(indexed.stderr || indexed.stdout || "").slice(-600)}`);
        }
        const indexSeconds = Math.round((Date.now() - started) / 1000);

        let client;
        try {
            client = await McpStdioClient.start(binary, ["mcp", "serve", "--transport", "stdio"], { env });
        } catch (error) {
            return fail(`skybox mcp serve: ${error.message}`);
        }

        const answers = {};
        let calls = 0;
        try {
            const guide = (await client.callTool("skybox_guide", {})).text;
            const guideAck = guide.match(/gack_[0-9a-f]+/)?.[0];
            const call = async (tool, args) => {
                calls += 1;
                return client.callTool(tool, { ...args, repo: repoName, ...(guideAck ? { guide_ack: guideAck } : {}) });
            };

            for (const task of tasks) {
                const question = questionOf(task, laneRoot);
                if (question === null) {
                    continue;
                }
                const answer = await askSkybox(question, call);
                if (answer !== undefined) {
                    answers[task.id] = answer;
                }
            }
        } finally {
            client.close();
        }

        // Nothing time-dependent goes into the answer file: two runs over the same lane and the
        // same skybox must write the same bytes.
        const document = {
            version: 1,
            tool: { name: "skybox", version },
            lane: options.lane,
            scope: "lane",
            protocol: { definition: "raw", resolution: "raw", "import-precision": "raw", hover: "anchored", call_hierarchy: "anchored", references: "anchored", implementation: "anchored", cardinality: "anchored", "multi-parent": "anchored", document_symbol: "file", direction: "anchored", "direction:uses_self": "raw", "direction:declaration_merge": "raw" },
            run: { tool_calls: calls },
            answers,
        };
        writeFileSync(resolve(options.out), `${JSON.stringify(document, null, 2)}\n`);
        process.stderr.write(`skybox ${version}, lane ${options.lane}: ${Object.keys(answers).length} answers, ${calls} tool calls, index ${indexSeconds}s\n`);
        return 0;
    } finally {
        if (!options["keep-work"]) {
            rmSync(work, { recursive: true, force: true });
        }
    }
}

function fail(message) {
    process.stderr.write(`skybox adapter: ${message}\n`);
    return 2;
}
