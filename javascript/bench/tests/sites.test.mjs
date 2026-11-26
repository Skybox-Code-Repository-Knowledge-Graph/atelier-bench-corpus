// Every {file, needle} pair in bench/tasks.json resolves, whatever key it sits under.
//
// bench/verify-tasks/verify.mjs resolves the needles under from, expect, candidate and
// a fixed list of nested keys, and must stay byte-compatible with the shared
// conformance fixture, so it ignores optional_sites and repeated_sites. This test
// walks the whole manifest instead: a needle under repeated_sites must match exactly
// `lines` lines of its file (at least two, or it belongs under known_sites); every
// other needle must match exactly one line.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const LANE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(join(LANE_ROOT, "bench", "tasks.json"), "utf8"));

/** Every {file, needle} object under `value`, with the key path that reaches it. */
function needlePairs(value, path, out) {
    if (Array.isArray(value)) {
        value.forEach((item, index) => needlePairs(item, `${path}[${index}]`, out));
    } else if (value && typeof value === "object") {
        if (typeof value.file === "string" && typeof value.needle === "string") out.push({ path, pair: value });
        for (const [key, child] of Object.entries(value)) needlePairs(child, `${path}.${key}`, out);
    }
    return out;
}

function linesHolding(file, needle) {
    return readFileSync(join(LANE_ROOT, file), "utf8")
        .split(/\r\n|\n|\r/)
        .flatMap((line, index) => (line.includes(needle) ? [index + 1] : []));
}

describe("answer-key needles", () => {
    it("resolves every needle in the manifest, optional and repeated sites included", (t) => {
        const problems = [];
        const byKey = {};

        for (const task of manifest.tasks) {
            for (const { path, pair } of needlePairs(task, task.id, [])) {
                const key = path.replace(/\[\d+\]/g, "").split(".").slice(1).join(".");
                byKey[key] = (byKey[key] ?? 0) + 1;
                const repeated = /\.repeated_sites\[\d+\]$/.test(path);
                const want = repeated ? pair.lines : 1;
                if (repeated && !(Number.isInteger(pair.lines) && pair.lines >= 2)) {
                    problems.push(`${path}: repeated_sites entry needs an integer lines >= 2, has ${pair.lines}`);
                    continue;
                }
                const hits = linesHolding(pair.file, pair.needle);
                if (hits.length !== want) {
                    problems.push(`${path}: ${pair.file} needle ${JSON.stringify(pair.needle)} matches ${hits.length} line(s) [${hits.join(",")}], expected ${want}`);
                }
            }
        }

        t.diagnostic(Object.entries(byKey).sort().map(([key, count]) => `${key} ${count}`).join(", "));
        assert.deepEqual(problems, []);
        assert.ok((byKey["expect.optional_sites"] ?? 0) > 0 && (byKey["expect.repeated_sites"] ?? 0) > 0, "the walk reaches optional_sites and repeated_sites");
    });
});
