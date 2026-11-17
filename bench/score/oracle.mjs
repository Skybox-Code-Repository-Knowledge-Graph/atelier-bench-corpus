#!/usr/bin/env node
// The oracle: an answer file built from the answer key itself.
//
//   node bench/score/oracle.mjs --lane go > go.oracle.json
//   node bench/score/oracle.mjs --root <lane-shaped dir> > oracle.json
//
// Two uses. It is the reference example of the answer format, and it is the scorer's own check:
// every task the scorer claims to score must PASS on the oracle and FAIL on each mutation of it
// (bench/score/test/oracle.test.mjs). A task the oracle cannot answer is left out, so it scores
// UNANSWERED.

import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";

import { LANES, planTask } from "./lib/plan.mjs";
import { resolveNeedle } from "./lib/resolve.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Perfect answers for every task that has a rule and whose target resolves in this checkout. */
export function buildOracle(root, tasks, lane = null) {
    const answers = {};

    for (const task of tasks) {
        const plan = planTask(task, lane);
        if (!plan.scorable) {
            continue;
        }

        if (plan.check === "contains") {
            answers[task.id] = { text: plan.contains };
            continue;
        }

        const wanted = plan.check === "target" ? [plan.target] : plan.entries;
        const resolved = wanted.map((pair) => ({ file: pair.file, result: resolveNeedle(root, pair) }));
        if (resolved.some((entry) => !entry.result.ok)) {
            continue;
        }
        // The key's own lines: a declaration for "target" and "callees", a call site for "callers"
        // (a one-line range covers itself).
        answers[task.id] = { locations: resolved.map((entry) => ({ file: entry.file, line: entry.result.line })) };
    }

    return { version: 1, tool: { name: "oracle", version: "1" }, scope: "repo", answers };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    process.exit(main(process.argv.slice(2)));
}

function main(args) {
    const flag = args[0];
    const value = args[1];
    if ((flag !== "--lane" && flag !== "--root") || value === undefined || args.length !== 2) {
        process.stderr.write("usage: oracle.mjs (--lane <name> | --root <dir>)\n");
        return 2;
    }
    if (flag === "--lane" && !LANES.includes(value)) {
        process.stderr.write(`oracle: unknown lane ${value}; lanes are ${LANES.join(", ")}\n`);
        return 2;
    }

    const root = flag === "--root" ? resolve(value) : join(REPO_ROOT, value);
    let manifest;
    try {
        manifest = JSON.parse(readFileSync(join(root, "bench", "tasks.json"), "utf8"));
    } catch (error) {
        process.stderr.write(`oracle: cannot load ${join(root, "bench", "tasks.json")}: ${error.message}\n`);
        return 2;
    }

    // The lane name is the manifest's own, which is what score.mjs checks an answer file against.
    const oracle = buildOracle(root, manifest.tasks);
    const lane = typeof manifest.lane === "string" ? manifest.lane : flag === "--lane" ? value : basename(root);
    process.stdout.write(`${JSON.stringify({ ...oracle, lane }, null, 2)}\n`);
    return 0;
}
