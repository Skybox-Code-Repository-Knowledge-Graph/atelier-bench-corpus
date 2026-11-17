// `repeated_sites` and `optional_sites` (issue #168), which the lane verifiers ignore, so they are
// checked here.
//
// repeated_sites: reference sites whose text is identical to a sibling line, so no needle keys
// exactly one of them. Each entry says the needle occurs on exactly `lines` lines of the file and
// every one of them is a site:
//   - the needle occurs on exactly `lines` lines of the file;
//   - no repeated line is also listed in known_sites;
//   - a task that carries repeated_sites states exact_count = known_sites + the repeated lines.
//
// optional_sites: lines a tool may or may not report, neither required nor wrong, not counted:
//   - each needle keys exactly one line, listed once;
//   - that line is not the target, a known site or a repeated site.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LANES } from "../lib/plan.mjs";
import { fileLines, isFileNeedle, linesContaining, resolveNeedle } from "../lib/resolve.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * Problems with a references task's count, or an empty list: exact_count must equal its known
 * sites plus every repeated line, and no two entries may name one line. The references rule
 * requires both; checking every task here makes a lane PR that breaks them fail its own CI.
 */
export function checkSiteCount(task, root) {
    const expect = task.expect ?? {};
    if (task.surface !== "references" || !Object.hasOwn(expect, "exact_count")) {
        return [];
    }
    const lines = [];
    for (const site of Array.isArray(expect.known_sites) ? expect.known_sites : []) {
        const resolved = isFileNeedle(site) ? resolveNeedle(root, site) : { ok: false };
        if (resolved.ok) {
            lines.push(`${site.file}:${resolved.line}`);
        }
    }
    for (const entry of Array.isArray(expect.repeated_sites) ? expect.repeated_sites : []) {
        for (const line of (isFileNeedle(entry) ? linesContaining(root, entry.file, entry.needle) : null) ?? []) {
            lines.push(`${entry.file}:${line}`);
        }
    }
    const problems = [];
    const twice = lines.filter((line, index) => lines.indexOf(line) !== index);
    if (twice.length > 0) {
        problems.push(`two entries name ${twice[0]}`);
    }
    if (expect.exact_count !== lines.length) {
        problems.push(`exact_count is ${expect.exact_count}, the key lists ${lines.length} site line(s)`);
    }
    return problems;
}

test("checkSiteCount accepts a consistent count and names each kind of mistake", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "fixture", "lane");
    const task = (expect) => ({ id: "t", surface: "references", expect });
    const gamma = { file: "src/app.txt", needle: "gamma uses alpha" };
    const delta = { file: "src/app.txt", needle: "delta site" };
    const twice = { file: "src/app.txt", needle: "declaration", lines: 2 };

    assert.deepEqual(checkSiteCount(task({ exact_count: 2, known_sites: [gamma, delta] }), root), []);
    assert.deepEqual(checkSiteCount(task({ exact_count: 3, known_sites: [gamma], repeated_sites: [twice] }), root), [], "repeated lines count");
    assert.equal(checkSiteCount(task({ exact_count: 3, known_sites: [gamma, delta] }), root).length, 1, "count above the list");
    assert.equal(checkSiteCount(task({ exact_count: 1, known_sites: [gamma, delta] }), root).length, 1, "count below the list");
    assert.equal(checkSiteCount(task({ exact_count: 3, known_sites: [gamma, { file: "src/app.txt", needle: "alpha declaration" }], repeated_sites: [twice] }), root).length >= 1, true, "a known site that is also a repeated line");
    assert.deepEqual(checkSiteCount({ id: "t", surface: "implementation", expect: { exact_count: 9 } }, root), [], "only references");
    assert.deepEqual(checkSiteCount(task({ min_references: 1, known_sites: [gamma] }), root), [], "no count, nothing to check");
});

for (const lane of LANES) {
    test(`every references count equals its listed site lines: ${lane}`, (t) => {
        const root = join(REPO_ROOT, lane);
        const tasks = JSON.parse(readFileSync(join(root, "bench", "tasks.json"), "utf8")).tasks;
        const problems = tasks.flatMap((task) => checkSiteCount(task, root).map((problem) => `${task.id}: ${problem}`));
        t.diagnostic(`${lane}: ${tasks.filter((task) => task.surface === "references").length} references tasks`);
        assert.deepEqual(problems, []);
    });
}

/** Problems with one task's repeated_sites, or an empty list. */
export function checkRepeatedSites(task, root) {
    const expect = task.expect ?? {};
    if (!Object.hasOwn(expect, "repeated_sites")) {
        return [];
    }
    const problems = [];
    if (!Array.isArray(expect.repeated_sites) || expect.repeated_sites.length === 0) {
        return ["repeated_sites must be a non-empty array"];
    }

    const listed = new Set();
    for (const site of Array.isArray(expect.known_sites) ? expect.known_sites : []) {
        if (isFileNeedle(site)) {
            const resolved = resolveNeedle(root, site);
            if (resolved.ok) {
                listed.add(`${site.file}:${resolved.line}`);
            }
        }
    }

    let repeated = 0;
    for (const entry of expect.repeated_sites) {
        if (!isFileNeedle(entry) || !Number.isInteger(entry.lines) || entry.lines < 2) {
            problems.push(`repeated_sites entry needs file, needle and lines >= 2: ${JSON.stringify(entry)}`);
            continue;
        }
        const hits = linesContaining(root, entry.file, entry.needle);
        if (hits === null) {
            problems.push(`${entry.file}: file missing`);
            continue;
        }
        if (hits.length !== entry.lines) {
            problems.push(`${entry.file}: needle ${JSON.stringify(entry.needle)} is on ${hits.length} line(s), lines says ${entry.lines}`);
        }
        for (const line of hits) {
            if (listed.has(`${entry.file}:${line}`)) {
                problems.push(`${entry.file}:${line} is both a known site and a repeated site`);
            }
        }
        repeated += entry.lines;
    }

    const known = Array.isArray(expect.known_sites) ? expect.known_sites.length : 0;
    if (expect.exact_count !== known + repeated) {
        problems.push(`exact_count is ${expect.exact_count}, known_sites (${known}) + repeated lines (${repeated}) = ${known + repeated}`);
    }
    return problems;
}

test("checkRepeatedSites accepts a consistent entry and names each kind of mistake", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "fixture", "lane");
    // src/app.txt holds "alpha declaration" once and "declaration" twice.
    const task = (expect) => ({ id: "t", surface: "references", expect });
    const twice = { file: "src/app.txt", needle: "declaration", lines: 2 };

    assert.deepEqual(checkRepeatedSites(task({ known_sites: [], repeated_sites: [twice], exact_count: 2 }), root), []);
    assert.equal(checkRepeatedSites(task({ known_sites: [], repeated_sites: [{ ...twice, lines: 3 }], exact_count: 3 }), root).length, 1, "wrong line count");
    assert.equal(checkRepeatedSites(task({ known_sites: [], repeated_sites: [twice], exact_count: 3 }), root).length, 1, "wrong exact_count");
    assert.equal(checkRepeatedSites(task({ known_sites: [{ file: "src/app.txt", needle: "alpha declaration" }], repeated_sites: [twice], exact_count: 3 }), root).length, 1, "a line listed twice");
    assert.equal(checkRepeatedSites(task({ repeated_sites: [{ file: "src/app.txt", needle: "declaration", lines: 1 }], exact_count: 1 }), root).length >= 1, true, "lines below 2");
    assert.deepEqual(checkRepeatedSites(task({ known_sites: [] }), root), [], "no repeated_sites, nothing to check");
});

for (const lane of LANES) {
    test(`every repeated_sites entry matches its file: ${lane}`, (t) => {
        const root = join(REPO_ROOT, lane);
        const tasks = JSON.parse(readFileSync(join(root, "bench", "tasks.json"), "utf8")).tasks;
        const problems = [];
        let entries = 0;
        for (const task of tasks) {
            entries += Array.isArray(task.expect?.repeated_sites) ? task.expect.repeated_sites.length : 0;
            for (const problem of checkRepeatedSites(task, root)) {
                problems.push(`${task.id}: ${problem}`);
            }
        }
        t.diagnostic(`${lane}: ${entries} repeated_sites entries`);
        assert.deepEqual(problems, []);
    });
}

/**
 * Problems with one task's optional_sites, or an empty list. An optional site is a line a tool may
 * or may not report (a string-level or structural link with no `kind` naming it the link): neither
 * required nor wrong, and not counted. So each needle keys exactly one line, and that line is not
 * also the target, a known site or a repeated site.
 */
export function checkOptionalSites(task, root) {
    const expect = task.expect ?? {};
    if (!Object.hasOwn(expect, "optional_sites")) {
        return [];
    }
    if (!Array.isArray(expect.optional_sites) || expect.optional_sites.length === 0) {
        return ["optional_sites must be a non-empty array"];
    }
    const taken = new Map();
    const take = (entry, what) => {
        if (isFileNeedle(entry)) {
            const resolved = resolveNeedle(root, entry);
            if (resolved.ok) {
                taken.set(`${entry.file}:${resolved.line}`, what);
            }
        }
    };
    take(expect, "the target");
    for (const site of Array.isArray(expect.known_sites) ? expect.known_sites : []) {
        take(site, "a known site");
    }
    for (const entry of Array.isArray(expect.repeated_sites) ? expect.repeated_sites : []) {
        for (const line of (isFileNeedle(entry) ? linesContaining(root, entry.file, entry.needle) : null) ?? []) {
            taken.set(`${entry.file}:${line}`, "a repeated site");
        }
    }

    const problems = [];
    const seen = new Set();
    for (const entry of expect.optional_sites) {
        if (!isFileNeedle(entry) || Object.keys(entry).some((key) => key !== "file" && key !== "needle")) {
            problems.push(`optional_sites entry needs exactly file and needle: ${JSON.stringify(entry)}`);
            continue;
        }
        const resolved = resolveNeedle(root, entry);
        if (!resolved.ok) {
            problems.push(`${entry.file}: needle ${JSON.stringify(entry.needle)} does not key one line (${resolved.reason ?? "unresolved"})`);
            continue;
        }
        const key = `${entry.file}:${resolved.line}`;
        if (taken.has(key)) {
            problems.push(`${key} is both an optional site and ${taken.get(key)}`);
        }
        if (seen.has(key)) {
            problems.push(`${key} is listed twice in optional_sites`);
        }
        seen.add(key);
    }
    return problems;
}

test("checkOptionalSites accepts a consistent entry and names each kind of mistake", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "fixture", "lane");
    // src/app.txt holds "alpha declaration" and "gamma uses alpha" once each, and "declaration" twice.
    const task = (expect) => ({ id: "t", surface: "references", expect });
    const gamma = { file: "src/app.txt", needle: "gamma uses alpha" };

    assert.deepEqual(checkOptionalSites(task({ known_sites: [], optional_sites: [gamma] }), root), []);
    assert.equal(checkOptionalSites(task({ known_sites: [gamma], optional_sites: [gamma] }), root).length, 1, "also a known site");
    assert.equal(checkOptionalSites(task({ file: "src/app.txt", needle: "gamma uses alpha", optional_sites: [gamma] }), root).length, 1, "also the target");
    assert.equal(checkOptionalSites(task({ repeated_sites: [{ file: "src/app.txt", needle: "declaration", lines: 2 }], optional_sites: [{ file: "src/app.txt", needle: "alpha declaration" }] }), root).length, 1, "also a repeated site");
    assert.equal(checkOptionalSites(task({ optional_sites: [{ file: "src/app.txt", needle: "declaration" }] }), root).length, 1, "needle on two lines");
    assert.equal(checkOptionalSites(task({ optional_sites: [gamma, gamma] }), root).length, 1, "listed twice");
    assert.equal(checkOptionalSites(task({ optional_sites: [{ ...gamma, lines: 1 }] }), root).length, 1, "an extra key");
    assert.equal(checkOptionalSites(task({ optional_sites: [] }), root).length, 1, "empty");
    assert.deepEqual(checkOptionalSites(task({ known_sites: [] }), root), [], "no optional_sites, nothing to check");
});

for (const lane of LANES) {
    test(`every optional_sites entry keys one line that is not otherwise listed: ${lane}`, (t) => {
        const root = join(REPO_ROOT, lane);
        const tasks = JSON.parse(readFileSync(join(root, "bench", "tasks.json"), "utf8")).tasks;
        const problems = [];
        let entries = 0;
        for (const task of tasks) {
            entries += Array.isArray(task.expect?.optional_sites) ? task.expect.optional_sites.length : 0;
            for (const problem of checkOptionalSites(task, root)) {
                problems.push(`${task.id}: ${problem}`);
            }
        }
        t.diagnostic(`${lane}: ${entries} optional_sites entries`);
        assert.deepEqual(problems, []);
    });
}
