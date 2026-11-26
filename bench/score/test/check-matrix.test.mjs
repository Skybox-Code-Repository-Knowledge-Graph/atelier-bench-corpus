// bench/check-matrix.mjs run on a temporary copy of the repository with ONLY its lane verifier list
// stubbed: each LANE_DEFS `verify` command becomes one node script that prints `<id>: OK` for every
// task of the lane's tasks.json (bench/conformance/expected.txt under --root) and logs the call.
// Everything else is the committed script, so the static guards, buildMatrix() and serialize() under
// test are the real ones, and no cargo, php, python or go runs. The copy sits in the OS temp
// directory, outside any git work tree, as a `git archive` extract would. This file lives under
// bench/score/test/ only so that the suite's one command (`node --test 'bench/score/test/*.test.mjs'
// 'bench/adapters/*/test/*.test.mjs'`) runs it; it tests the corpus check, not the scorer.

import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LANES = ["php", "rust", "typescript", "javascript", "python", "go"];
const SKIP = new Set(["vendor", "node_modules", "target", "__pycache__", ".git", ".venv", ".mypy_cache"]);
const SCRIPT = readFileSync(join(REPO_ROOT, "bench", "check-matrix.mjs"), "utf8");
const COMMITTED_MATRIX = readFileSync(join(REPO_ROOT, "bench", "matrix.json"), "utf8");

const STUB_VERIFIER = `// Stub lane verifier (check-matrix.test.mjs).
import { appendFileSync, readFileSync } from "node:fs";
import process from "node:process";
const here = new URL(".", import.meta.url);
appendFileSync(new URL("verifier-calls.log", here), process.cwd().split(/[\\\\/]/).pop() + " " + process.argv.slice(2).join(" ") + "\\n");
if (process.argv.includes("--root")) {
    process.stdout.write(readFileSync(new URL("bench/conformance/expected.txt", here), "utf8"));
} else {
    const tasks = JSON.parse(readFileSync("bench/tasks.json", "utf8")).tasks;
    process.stdout.write(tasks.map((task) => task.id + ": OK\\n").join(""));
}
`;

/** The committed script with every LANE_DEFS verify command replaced by the stub, and nothing else. */
function stubVerifiers(source) {
    let count = 0;
    const stubbed = source.replace(/\{ name: "([a-z]+)", verify: \[[^\]]*\] \}/g, (_, name) => {
        count += 1;
        return `{ name: "${name}", verify: ["node", "../stub-verify.mjs"] }`;
    });
    // A LANE_DEFS reshaped so that this rewrite misses would run the real verifiers, cargo included.
    assert.equal(count, LANES.length, "LANE_DEFS no longer has the shape this test stubs");
    return stubbed;
}

/** A temp copy of what check-matrix reads, verifiers stubbed. Removed when the test ends. */
function scratch(t) {
    const root = mkdtempSync(join(tmpdir(), "check-matrix-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    for (const path of ["bench", ".gitattributes", ".github", ...LANES]) {
        if (existsSync(join(REPO_ROOT, path))) {
            cpSync(join(REPO_ROOT, path), join(root, path), { recursive: true, filter: (src) => !SKIP.has(basename(src)) });
        }
    }
    writeFileSync(join(root, "bench", "check-matrix.mjs"), stubVerifiers(SCRIPT));
    writeFileSync(join(root, "stub-verify.mjs"), STUB_VERIFIER);
    return root;
}

function run(root, ...args) {
    const result = spawnSync(process.execPath, [join(root, "bench", "check-matrix.mjs"), ...args], { cwd: root, encoding: "utf8" });
    const log = join(root, "verifier-calls.log");
    const calls = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
    rmSync(log, { force: true });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls };
}

const matrixOf = (root) => readFileSync(join(root, "bench", "matrix.json"), "utf8");
const lastLine = (text) => text.trimEnd().split("\n").at(-1);

function addTask(root, lane, task) {
    const path = join(root, lane, "bench", "tasks.json");
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    manifest.tasks.push(task);
    writeFileSync(path, `${JSON.stringify(manifest, null, 4)}\n`);
}

const PROBE_TASK = {
    id: "zz-probe-new-id",
    surface: "definition",
    note: "check-matrix.test.mjs probe",
    from: { file: "app/http/router.go", needle: "\tmux := http.NewServeMux()", symbol: "NewServeMux" },
    expect: { file: "app/http/report.go", needle: "func ShowReport(" },
};

test("the stub replaces the six verify commands and no other line of the script", () => {
    const before = SCRIPT.split("\n");
    const after = stubVerifiers(SCRIPT).split("\n");
    assert.equal(after.length, before.length);
    const changed = before.map((line, index) => [line, after[index]]).filter(([a, b]) => a !== b);
    assert.equal(changed.length, LANES.length);
    for (const [, line] of changed) {
        assert.match(line, /^ {4}\{ name: "[a-z]+", verify: \["node", "\.\.\/stub-verify\.mjs"\] \},$/);
    }
});

test("--matrix-only without --write is an error: exit 1, nothing spawned, nothing written", (t) => {
    const root = scratch(t);
    const result = run(root, "--matrix-only");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^matrix: FAIL --matrix-only needs --write/);
    assert.equal(result.stdout, "");
    assert.deepEqual(result.calls, []);
    assert.equal(matrixOf(root), COMMITTED_MATRIX);
});

test("--write --matrix-only spawns no verifier, and writes what plain --write writes", (t) => {
    const only = scratch(t);
    const plain = scratch(t);

    const matrixOnly = run(only, "--write", "--matrix-only");
    assert.equal(matrixOnly.status, 0, matrixOnly.stderr);
    assert.deepEqual(matrixOnly.calls, [], "no lane verifier and no conformance run");
    assert.match(lastLine(matrixOnly.stdout), /^matrix: OK \(\d+ canonical ids, 6 lanes\)$/);
    assert.match(matrixOnly.stderr, /^matrix: --matrix-only: no lane verifier and no conformance run/);

    const write = run(plain, "--write");
    assert.equal(write.status, 0, write.stderr);
    assert.equal(write.calls.length, 2 * LANES.length, "plain --write still runs every verifier, then every conformance run");
    assert.equal(write.calls.filter((call) => call.endsWith("bench/conformance")).length, LANES.length);
    assert.equal(write.stderr, "");

    assert.equal(matrixOf(only), matrixOf(plain), "the same bytes");
    assert.equal(matrixOnly.stdout, write.stdout, "the same grid and OK line");
    // The tree is unchanged, so the canonical map is the committed one; only `lanes` carries the stub.
    assert.deepEqual(JSON.parse(matrixOf(only)).canonical, JSON.parse(COMMITTED_MATRIX).canonical);
});

test("a new task id fails the default check until a write; both writes then agree byte for byte", (t) => {
    const only = scratch(t);
    const plain = scratch(t);
    for (const root of [only, plain]) {
        assert.equal(run(root).status, 0, "the default check passes on the unchanged copy");
        addTask(root, "go", PROBE_TASK);
    }

    const check = run(plain);
    assert.equal(check.status, 1);
    assert.match(check.stderr, /^matrix: FAIL zz-probe-new-id is present in lane\(s\) go but missing from matrix\.canonical$/m);

    assert.equal(run(only, "--write", "--matrix-only").status, 0);
    assert.equal(run(plain, "--write").status, 0);
    assert.equal(matrixOf(only), matrixOf(plain));
    assert.deepEqual(JSON.parse(matrixOf(only)).canonical["zz-probe-new-id"], { surface: "definition", lanes: ["go"] });

    for (const root of [only, plain]) {
        const after = run(root);
        assert.equal(after.status, 0, after.stderr);
        assert.match(lastLine(after.stdout), /^matrix: OK \(\d+ canonical ids, 6 lanes\)$/);
    }
});
