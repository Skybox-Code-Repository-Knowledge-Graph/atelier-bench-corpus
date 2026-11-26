#!/usr/bin/env node
// Compare two score reports of the same tool on the same lane: before and after, per line.
//
//   node bench/score/compare.mjs --before before.report.json --after after.report.json
//   node bench/score/compare.mjs --before before.report.json --after after.report.json --format json
//
// Both inputs are `node bench/score/score.mjs --format json` reports. Node built-ins only, run from
// anywhere. The comparison knows nothing about any tool: it reads the reports' own fields. Exit 0
// when the comparison was made, whatever it shows (a loss is a result); exit 2 when the inputs
// cannot be compared (one line on stderr names why). The rules are in bench/score/README.md.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const VERDICTS = ["PASS", "FAIL", "UNSUPPORTED", "UNANSWERED", "ERROR", "UNSCORABLE", "UNRESOLVED"];
const CLASS_ORDER = { exact: 0, recall: 1, behaviour: 2 };
const CLASS_LABEL = { exact: "exact", recall: "recall-only", behaviour: "behaviour" };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exit(main(process.argv.slice(2)));
}

function main(args) {
    const options = parseArgs(args);
    if (options.problem) {
        return fail(options.problem);
    }

    const reports = [];
    for (const path of [options.before, options.after]) {
        const read = readJson(resolve(path));
        if (read.problem) {
            return fail(read.problem);
        }
        const problem = reportProblem(read.value);
        if (problem) {
            return fail(`${path} is not a score report: ${problem}`);
        }
        reports.push(read.value);
    }

    const compared = compareReports(reports[0], reports[1]);
    if (compared.problem) {
        return fail(compared.problem);
    }

    process.stdout.write(options.format === "json" ? `${JSON.stringify(compared, null, 2)}\n` : renderText(compared));
    return 0;
}

function parseArgs(args) {
    const options = { format: "text" };
    for (let index = 0; index < args.length; index += 1) {
        const flag = args[index];
        const value = args[index + 1];
        if (flag === "--before" || flag === "--after" || flag === "--format") {
            if (value === undefined) {
                return { problem: `${flag} needs a value` };
            }
            options[flag.slice(2)] = value;
            index += 1;
        } else {
            return { problem: `unknown argument ${flag}` };
        }
    }

    if (!options.before || !options.after) {
        return { problem: "usage: compare.mjs --before <report.json> --after <report.json> [--format text|json]" };
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

/** The first reason a value is not a `score.mjs --format json` report, or null. */
export function reportProblem(report) {
    if (report === null || typeof report !== "object" || Array.isArray(report)) {
        return "not a JSON object";
    }
    if (report.version !== 1) {
        return "version is not 1";
    }
    if (report.tool === null || typeof report.tool !== "object" || typeof report.tool.name !== "string" || report.tool.name === "") {
        return "no tool name";
    }
    if (typeof report.lane !== "string" || report.lane === "") {
        return "no lane";
    }
    if (typeof report.scope !== "string" || report.scope === "") {
        return "no scope";
    }
    if (!Array.isArray(report.results)) {
        return "no results array";
    }
    const seen = new Set();
    for (const [index, result] of report.results.entries()) {
        if (result === null || typeof result !== "object" || typeof result.id !== "string" || result.id === "") {
            return `results[${index}] has no id`;
        }
        if (!VERDICTS.includes(result.verdict)) {
            return `${result.id} has no known verdict`;
        }
        if (seen.has(result.id)) {
            return `task id ${result.id} appears twice`;
        }
        seen.add(result.id);
    }
    return null;
}

/**
 * Compare two valid reports. Returns { problem } when they must not be compared (lanes, tool names
 * or scopes differ), otherwise the comparison. Deterministic: ids are sorted, nothing reads a clock.
 */
export function compareReports(before, after) {
    if (before.lane !== after.lane) {
        return { problem: `lanes differ: before is ${before.lane}, after is ${after.lane}` };
    }
    if (before.tool.name !== after.tool.name) {
        return { problem: `tool names differ: before is ${before.tool.name}, after is ${after.tool.name}` };
    }
    if (before.scope !== after.scope) {
        return { problem: `scopes differ: before is ${before.scope}, after is ${after.scope}` };
    }

    const beforeById = new Map(before.results.map((result) => [result.id, result]));
    const afterById = new Map(after.results.map((result) => [result.id, result]));
    const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort(byCodeUnit);

    const gained = [];
    const lost = [];
    const changed = [];
    const notCompared = [];

    for (const id of ids) {
        const was = beforeById.get(id);
        const now = afterById.get(id);
        if (!was || !now) {
            notCompared.push({ id, reason: `only in the ${was ? "before" : "after"} report` });
            continue;
        }
        const differs = ["rule", "class", "protocol"].filter((field) => (was[field] ?? null) !== (now[field] ?? null));
        if (differs.length > 0) {
            const parts = differs.map((field) => `${field} ${was[field] ?? "none"} -> ${now[field] ?? "none"}`);
            notCompared.push({ id, reason: parts.join("; ") });
            continue;
        }
        if (was.verdict === now.verdict) {
            continue;
        }
        const entry = { id, class: now.class ?? null, protocol: now.protocol ?? null, before: was.verdict, after: now.verdict };
        if (now.verdict === "PASS") {
            gained.push(entry);
        } else if (was.verdict === "PASS") {
            lost.push(entry);
        } else {
            changed.push(entry);
        }
    }

    return {
        version: 1,
        lane: after.lane,
        scope: after.scope,
        before: { tool: before.tool },
        after: { tool: after.tool },
        lines: lineTable(before.results, after.results, { gained, lost }),
        gained,
        lost,
        changed,
        notCompared,
    };
}

/** One line per rule class and protocol, as score.mjs groups them; never added together. */
function lineTable(beforeResults, afterResults, { gained, lost }) {
    const lines = new Map();
    const line = (result) => {
        if (!(result.class in CLASS_ORDER)) {
            return null;
        }
        const protocol = result.protocol ?? null;
        const key = `${result.class}\u0000${protocol ?? ""}`;
        if (!lines.has(key)) {
            lines.set(key, { class: result.class, protocol, before: { pass: 0, scorable: 0 }, after: { pass: 0, scorable: 0 }, gained: 0, lost: 0 });
        }
        return lines.get(key);
    };
    const count = (results, side) => {
        for (const result of results) {
            const target = line(result)?.[side];
            if (target && result.verdict !== "UNSCORABLE" && result.verdict !== "UNRESOLVED") {
                target.scorable += 1;
                target.pass += result.verdict === "PASS" ? 1 : 0;
            }
        }
    };
    count(beforeResults, "before");
    count(afterResults, "after");
    for (const entry of gained) {
        line(entry).gained += 1;
    }
    for (const entry of lost) {
        line(entry).lost += 1;
    }

    return [...lines.values()]
        .filter((entry) => entry.before.scorable > 0 || entry.after.scorable > 0)
        .sort((left, right) => CLASS_ORDER[left.class] - CLASS_ORDER[right.class] || byCodeUnit(left.protocol ?? "", right.protocol ?? ""));
}

function renderText(compared) {
    const out = [];
    const name = (side) => `${side.tool.name}${typeof side.tool.version === "string" && side.tool.version !== "" ? ` ${side.tool.version}` : ""}`;
    out.push(`compare: ${name(compared.before)} -> ${name(compared.after)}   lane: ${compared.lane}   scope: ${compared.scope}`);
    out.push("");

    for (const entry of compared.lines) {
        const label = `${CLASS_LABEL[entry.class]}${entry.protocol ? `, ${entry.protocol}` : ""}`.padEnd(22);
        out.push(`${label}  passed ${entry.before.pass} of ${entry.before.scorable} -> ${entry.after.pass} of ${entry.after.scorable}   (gained ${entry.gained}, lost ${entry.lost})`);
    }

    const section = (title, entries, describe) => {
        out.push("");
        out.push(`${title} (${entries.length})`);
        for (const entry of entries) {
            out.push(`  ${describe(entry)}`);
        }
    };
    const where = (entry) => `${CLASS_LABEL[entry.class] ?? entry.class}${entry.protocol ? `, ${entry.protocol}` : ""}`;
    section("GAINED", compared.gained, (entry) => `${entry.id}: ${entry.before} -> ${entry.after} [${where(entry)}]`);
    section("LOST", compared.lost, (entry) => `${entry.id}: ${entry.before} -> ${entry.after} [${where(entry)}]`);
    section("CHANGED", compared.changed, (entry) => `${entry.id}: ${entry.before} -> ${entry.after} [${where(entry)}]`);
    section("NOT COMPARED", compared.notCompared, (entry) => `${entry.id}: ${entry.reason}`);

    return `${out.join("\n")}\n`;
}

function byCodeUnit(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}

function fail(message) {
    process.stderr.write(`compare: ${message}\n`);
    return 2;
}
