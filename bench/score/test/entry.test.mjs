// The scorer's entry scripts (issue #221): they run through a symlinked path, and a large stdout
// reaches a pipe in full.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const SCORE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY_SCRIPTS = ["score.mjs", "compare.mjs", "oracle.mjs"];

function tempDir(t, prefix) {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
}

test("oracle.mjs runs through a symlink to the file and through a symlinked directory", (t) => {
    const dir = tempDir(t, "oracle-link-");
    const fileLink = join(dir, "oracle-link.mjs");
    symlinkSync(join(SCORE_DIR, "oracle.mjs"), fileLink);
    const dirLink = join(dir, "score-dir");
    symlinkSync(SCORE_DIR, dirLink, "dir");

    for (const script of [fileLink, join(dirLink, "oracle.mjs")]) {
        const ok = spawnSync(process.execPath, [script, "--lane", "go"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
        assert.equal(ok.status, 0, ok.stderr);
        const oracle = JSON.parse(ok.stdout);
        assert.equal(oracle.lane, "go");
        assert.ok(Object.keys(oracle.answers).length > 0, "the oracle answered nothing: main did not run");

        const bad = spawnSync(process.execPath, [script, "--lane", "nope"], { encoding: "utf8" });
        assert.equal(bad.status, 2);
        assert.match(bad.stderr, /^oracle: unknown lane nope/);
    }
});

test("compare.mjs writes a stdout larger than a pipe buffer in full", (t) => {
    // 20,000 gained tasks print one line each, about 0.6 MB. With process.exit() after the write,
    // a pipe received only the first 64 KB or so on macOS; on Linux CI a ~25 KB piped stdout lost
    // its tail the same way (PR #236, check-matrix.mjs).
    const count = 20000;
    const task = (id, verdict) => ({ id, surface: "definition", protocol: "raw", rule: "definition/target", class: "exact", notScored: [], verdict, notes: [] });
    const ids = Array.from({ length: count }, (_, index) => `t${String(index).padStart(5, "0")}`);
    const report = (verdict) => ({ version: 1, tool: { name: "t", version: "1" }, lane: "go", scope: "lane", results: ids.map((id) => task(id, verdict)), summary: {}, unknownIds: [] });
    const dir = tempDir(t, "compare-big-");
    writeFileSync(join(dir, "before.json"), JSON.stringify(report("FAIL")));
    writeFileSync(join(dir, "after.json"), JSON.stringify(report("PASS")));

    const result = spawnSync(process.execPath, [join(SCORE_DIR, "compare.mjs"), "--before", join(dir, "before.json"), "--after", join(dir, "after.json")], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.length > 256 * 1024, `only ${result.stdout.length} bytes`);
    assert.equal(result.stdout.split("\n").filter((line) => /^ {2}t\d{5}: FAIL -> PASS \[exact, raw\]$/.test(line)).length, count);
    assert.ok(result.stdout.endsWith("\nNOT COMPARED (0)\n"), "the last section arrived");
});

test("no entry script ends the process with process.exit()", () => {
    // How much of a piped stdout process.exit() loses depends on the platform and the reader (both
    // macOS and Linux CI have lost output); this pin does not.
    for (const name of ENTRY_SCRIPTS) {
        const source = readFileSync(join(SCORE_DIR, name), "utf8");
        assert.doesNotMatch(source, /process\.exit\(/, `${name} calls process.exit()`);
        assert.match(source, /process\.exitCode = main\(process\.argv\.slice\(2\)\);/, `${name} sets process.exitCode from main`);
    }
});
