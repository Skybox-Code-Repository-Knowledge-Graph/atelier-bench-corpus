#!/usr/bin/env node
// Score one tool's answers for one lane against that lane's bench/tasks.json.
//
//   node bench/score/score.mjs --lane go --answers answers.json
//   node bench/score/score.mjs --root <lane-shaped dir> --answers answers.json
//   node bench/score/score.mjs --lane go --answers answers.json --format json
//
// Node built-ins only, run from anywhere. The answer format and the scoring rules are in
// bench/score/README.md. Exit 0 when scoring completed, whatever the tool scored; exit 2 when the
// inputs could not be read. A tool that fails every task is a result, not an error.

import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { LANES } from "./lib/plan.mjs";
import { VERDICTS, scoreLane, validateAnswers } from "./lib/score.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

process.exit(main(process.argv.slice(2)));

function main(args) {
    const options = parseArgs(args);
    if (options.problem) {
        return fail(options.problem);
    }

    const root = options.root ? resolve(options.root) : join(REPO_ROOT, options.lane);
    const lane = options.lane ?? basename(root);

    const manifest = readJson(join(root, "bench", "tasks.json"));
    if (manifest.problem) {
        return fail(manifest.problem);
    }
    if (!manifest.value || !Array.isArray(manifest.value.tasks)) {
        return fail(`${join(root, "bench", "tasks.json")} has no tasks array`);
    }

    const answers = readJson(resolve(options.answers));
    if (answers.problem) {
        return fail(answers.problem);
    }
    const problems = validateAnswers(answers.value);
    if (problems.length > 0) {
        return fail(`${options.answers}: ${problems.join("; ")}`);
    }

    const scored = scoreLane({ root, lane, tasks: manifest.value.tasks, answersDoc: answers.value });

    if (options.format === "json") {
        process.stdout.write(`${JSON.stringify({
            version: 1,
            tool: answers.value.tool,
            lane,
            scope: answers.value.scope ?? "lane",
            ...scored,
        }, null, 2)}\n`);
    } else {
        process.stdout.write(renderText(scored, { lane, tool: answers.value.tool, scope: answers.value.scope ?? "lane" }));
    }

    return 0;
}

function parseArgs(args) {
    const options = { format: "text" };
    for (let index = 0; index < args.length; index += 1) {
        const flag = args[index];
        const value = args[index + 1];
        if (flag === "--lane" || flag === "--root" || flag === "--answers" || flag === "--format") {
            if (value === undefined) {
                return { problem: `${flag} needs a value` };
            }
            options[flag.slice(2)] = value;
            index += 1;
        } else {
            return { problem: `unknown argument ${flag}` };
        }
    }

    if (!options.answers) {
        return { problem: "usage: score.mjs (--lane <name> | --root <dir>) --answers <file> [--format text|json]" };
    }
    if (!options.lane && !options.root) {
        return { problem: "one of --lane or --root is required" };
    }
    if (options.lane && !options.root && !LANES.includes(options.lane)) {
        return { problem: `unknown lane ${options.lane}; lanes are ${LANES.join(", ")}` };
    }
    if (options.format !== "text" && options.format !== "json") {
        return { problem: "--format must be text or json" };
    }
    return options;
}

function readJson(path) {
    let raw;
    try {
        raw = readFileSync(path, "utf8");
    } catch {
        return { problem: `cannot read ${path}` };
    }
    try {
        return { value: JSON.parse(raw) };
    } catch (error) {
        return { problem: `${path} is not valid JSON: ${error.message}` };
    }
}

/** One line per task in manifest order, then the per-surface table, then the two ratios. */
function renderText({ results, summary }, { lane, tool, scope }) {
    const out = [];

    for (const result of results) {
        let line = `${result.id}: ${result.verdict}`;
        if (result.detail) {
            line += ` (${result.detail})`;
        }
        if ((result.verdict === "PASS" || result.verdict === "FAIL") && result.notScored.length > 0) {
            line += ` [not scored: ${result.notScored.join(", ")}]`;
        }
        out.push(line);
    }

    const header = ["surface", ...VERDICTS.map((verdict) => verdict.toLowerCase()), "total"];
    const rows = [
        ...Object.entries(summary.bySurface).map(([surface, counts]) => [surface, ...VERDICTS.map((verdict) => counts[verdict]), counts.total]),
        ["all", ...VERDICTS.map((verdict) => summary.total[verdict]), summary.total.total],
    ];
    const widths = header.map((cell, column) => Math.max(cell.length, ...rows.map((row) => String(row[column]).length)));
    const formatRow = (row) => row.map((cell, column) => (column === 0
        ? String(cell).padEnd(widths[column])
        : String(cell).padStart(widths[column]))).join("  ").trimEnd();

    out.push("");
    out.push(formatRow(header));
    for (const row of rows) {
        out.push(formatRow(row));
    }

    const { total, answered, scorable } = summary;
    const version = typeof tool.version === "string" && tool.version !== "" ? ` ${tool.version}` : "";
    out.push("");
    out.push(`tool: ${tool.name}${version}   lane: ${lane}   scope: ${scope}`);
    out.push(`scorable by this scorer: ${scorable} of ${total.total} tasks`);
    out.push(`passed: ${total.PASS} of ${total.total} tasks (${percent(total.PASS, total.total)}), ${total.PASS} of ${answered} answered (${percent(total.PASS, answered)})`);

    return `${out.join("\n")}\n`;
}

function percent(part, whole) {
    return whole === 0 ? "n/a" : `${((part / whole) * 100).toFixed(1)}%`;
}

function fail(message) {
    process.stderr.write(`score: ${message}\n`);
    return 2;
}
