// `repeated_sites` (issue #168): reference sites whose text is identical to a sibling line, so no
// needle keys exactly one of them. Each entry says the needle occurs on exactly `lines` lines of the
// file and every one of them is a site. The lane verifiers ignore this key, so it is checked here:
//
//   - the needle occurs on exactly `lines` lines of the file;
//   - no repeated line is also listed in known_sites;
//   - a task that carries repeated_sites states exact_count = known_sites + the repeated lines.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LANES } from "../lib/plan.mjs";
import { fileLines, isFileNeedle, resolveNeedle } from "../lib/resolve.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** 1-based line numbers of every line of a lane file that contains the needle. */
export function linesContaining(root, file, needle) {
    const lines = fileLines(root, file);
    if (lines === null) {
        return null;
    }
    const hits = [];
    lines.forEach((line, index) => {
        if (line.includes(needle)) {
            hits.push(index + 1);
        }
    });
    return hits;
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
