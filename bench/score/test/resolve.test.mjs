// The scorer's resolver must agree with the lane verifiers on every branch of the verifier
// contract. This rebuilds the verifier report for bench/conformance/ around the scorer's own
// resolver and compares it byte for byte with bench/conformance/expected.txt.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isFileNeedle, resolveNeedle } from "../lib/resolve.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CONFORMANCE = join(REPO_ROOT, "bench", "conformance");
const NESTED_KEYS = ["known_sites", "implementations", "known_callers", "outgoing_includes", "incoming_includes"];

function collectPairs(task) {
    const pairs = [];
    if (isFileNeedle(task.from)) {
        pairs.push({ ...task.from, role: "from" });
    }
    const expect = task.expect ?? {};
    if (isFileNeedle(expect)) {
        pairs.push({ file: expect.file, needle: expect.needle, role: "expect" });
    }
    for (const key of NESTED_KEYS) {
        for (const item of Array.isArray(expect[key]) ? expect[key] : []) {
            if (isFileNeedle(item)) {
                pairs.push({ ...item, role: "expect" });
            }
        }
    }
    if (isFileNeedle(expect.candidate)) {
        pairs.push({ ...expect.candidate, role: "expect" });
    }
    return pairs;
}

function summarize(needle) {
    const chars = Array.from(needle);
    return chars.length <= 80 ? needle : `${chars.slice(0, 77).join("")}...`;
}

test("resolver reproduces the verifier report for bench/conformance", () => {
    const manifest = JSON.parse(readFileSync(join(CONFORMANCE, "bench", "tasks.json"), "utf8"));
    const lines = [];

    for (const task of manifest.tasks) {
        let fromLine = null;
        let resolved = 0;
        const failures = [];

        for (const pair of collectPairs(task)) {
            const result = resolveNeedle(CONFORMANCE, pair);
            if (!result.ok) {
                failures.push(`${task.id}: FAIL ${pair.file} needle ${summarize(pair.needle)} (${result.reason})`);
            } else if (pair.role === "from") {
                fromLine = result.line;
            } else {
                resolved += 1;
            }
        }

        if (failures.length > 0) {
            lines.push(...failures);
        } else {
            lines.push(`${task.id}: OK (from ${task.from.file}:${fromLine} -> ${resolved} expect needles resolved)`);
        }
    }

    assert.equal(`${lines.join("\n")}\n`, readFileSync(join(CONFORMANCE, "expected.txt"), "utf8"));
});
