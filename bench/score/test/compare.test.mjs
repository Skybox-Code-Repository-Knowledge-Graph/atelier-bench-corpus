import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const COMPARE = join(dirname(fileURLToPath(import.meta.url)), "..", "compare.mjs");

function task(id, verdict, extra = {}) {
    return { id, surface: "definition", protocol: "raw", rule: "definition/target", class: "exact", notScored: [], verdict, notes: [], ...extra };
}

function report(results, { tool = { name: "t", version: "1.0.0" }, lane = "go", scope = "lane" } = {}) {
    return { version: 1, tool, lane, scope, results, summary: {}, unknownIds: [] };
}

function run(before, after, ...extra) {
    const dir = mkdtempSync(join(tmpdir(), "compare-test-"));
    const write = (name, value) => {
        const path = join(dir, name);
        writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
        return path;
    };
    const result = spawnSync(process.execPath, [COMPARE, "--before", write("before.json", before), "--after", write("after.json", after), ...extra], { encoding: "utf8" });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("gain, loss, other change, and per-line counts (1, 2)", () => {
    const before = report([task("a", "FAIL"), task("b", "PASS"), task("c", "FAIL"), task("d", "PASS"), task("e", "PASS", { protocol: "anchored" })]);
    const after = report([task("a", "PASS"), task("b", "FAIL"), task("c", "UNSUPPORTED"), task("d", "PASS"), task("e", "PASS", { protocol: "anchored" })], { tool: { name: "t", version: "1.1.0" } });
    const { status, stdout } = run(before, after, "--format", "json");
    assert.equal(status, 0);
    const out = JSON.parse(stdout);
    assert.deepEqual(out.gained.map((entry) => entry.id), ["a"]);
    assert.deepEqual(out.lost.map((entry) => [entry.id, entry.after]), [["b", "FAIL"]]);
    assert.deepEqual(out.changed.map((entry) => [entry.id, entry.before, entry.after]), [["c", "FAIL", "UNSUPPORTED"]]);
    assert.deepEqual(out.notCompared, []);
    assert.deepEqual(out.lines.map((line) => [line.protocol, line.before, line.after]), [
        ["anchored", { pass: 1, scorable: 1 }, { pass: 1, scorable: 1 }],
        ["raw", { pass: 2, scorable: 4 }, { pass: 2, scorable: 4 }],
    ]);
});

test("a loss is shown when the line's total rose (2)", () => {
    const before = report([task("a", "FAIL"), task("b", "FAIL"), task("c", "PASS")]);
    const after = report([task("a", "PASS"), task("b", "PASS"), task("c", "FAIL")]);
    const { status, stdout } = run(before, after);
    assert.equal(status, 0);
    assert.match(stdout, /exact, raw\s+passed 1 of 3 -> 2 of 3\s+\(gained 2, lost 1\)/);
    assert.match(stdout, /LOST \(1\)\n {2}c: PASS -> FAIL/);
    assert.match(stdout, /GAINED \(2\)\n {2}a: FAIL -> PASS/);
});

test("rule, class, protocol changes and one-sided tasks are NOT COMPARED, not gains or losses (3)", () => {
    const before = report([task("rule", "FAIL"), task("cls", "PASS"), task("proto", "PASS"), task("gone", "PASS")]);
    const after = report([
        task("rule", "PASS", { rule: "definition/other" }),
        task("cls", "FAIL", { class: "recall" }),
        task("proto", "FAIL", { protocol: "anchored" }),
        task("new", "PASS"),
    ]);
    const out = JSON.parse(run(before, after, "--format", "json").stdout);
    assert.deepEqual(out.gained, []);
    assert.deepEqual(out.lost, []);
    assert.deepEqual(out.changed, []);
    assert.deepEqual(out.notCompared.map((entry) => entry.id), ["cls", "gone", "new", "proto", "rule"]);
    assert.match(out.notCompared.find((entry) => entry.id === "gone").reason, /only in the before report/);
    assert.match(out.notCompared.find((entry) => entry.id === "new").reason, /only in the after report/);
    assert.match(out.notCompared.find((entry) => entry.id === "rule").reason, /rule definition\/target -> definition\/other/);
});

test("refusals exit 2 with one line (4)", () => {
    const base = report([task("a", "PASS")]);
    const cases = [
        [base, "not json", /is not valid JSON/],
        [base, { version: 1, lane: "go" }, /is not a score report/],
        [base, [1], /is not a score report/],
        [base, report([task("a", "PASS")], { lane: "rust" }), /lanes differ: before is go, after is rust/],
        [base, report([task("a", "PASS")], { tool: { name: "other", version: "1" } }), /tool names differ: before is t, after is other/],
        [base, report([task("a", "PASS")], { scope: "file" }), /scopes differ: before is lane, after is file/],
        [base, report([task("a", "PASS"), task("a", "FAIL")]), /appears twice/],
        [base, report([task("a", "MAYBE")]), /no known verdict/],
    ];
    for (const [before, after, pattern] of cases) {
        const { status, stdout, stderr } = run(before, after);
        assert.equal(status, 2, stderr);
        assert.equal(stdout, "");
        assert.match(stderr, pattern);
        assert.equal(stderr.trimEnd().split("\n").length, 1);
        assert.match(stderr, /^compare: /);
    }
    assert.equal(spawnSync(process.execPath, [COMPARE, "--before", "x"], { encoding: "utf8" }).status, 2);
    assert.equal(spawnSync(process.execPath, [COMPARE, "--before", "/nope/a", "--after", "/nope/b"], { encoding: "utf8" }).status, 2);
});

test("same inputs, same bytes; ids sorted (5)", () => {
    const before = report([task("z", "FAIL"), task("m", "FAIL"), task("a", "FAIL")]);
    const after = report([task("a", "PASS"), task("z", "PASS"), task("m", "PASS")]);
    const first = run(before, after);
    const second = run(before, after);
    assert.equal(first.stdout, second.stdout);
    assert.deepEqual(JSON.parse(run(before, after, "--format", "json").stdout).gained.map((entry) => entry.id), ["a", "m", "z"]);
    assert.equal(run(before, after, "--format", "json").stdout, run(before, after, "--format", "json").stdout);
});

test("a report compared with itself shows no changes (6)", () => {
    const synthetic = report([task("a", "PASS"), task("b", "UNSCORABLE"), task("c", "UNANSWERED"), task("d", "FAIL", { class: "recall", protocol: "anchored" })]);
    const out = JSON.parse(run(synthetic, synthetic, "--format", "json").stdout);
    assert.deepEqual([out.gained, out.lost, out.changed, out.notCompared], [[], [], [], []]);
    for (const line of out.lines) {
        assert.deepEqual(line.before, line.after);
    }
});