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

// The static guards: each mutation below breaks exactly what one guard protects, on its own temp
// copy, and `--write --matrix-only` (static guards only) must refuse it by name, spawn nothing and
// write nothing. The unchanged copy passing (tests above) is the green half.
function editJson(root, path, change) {
    const file = join(root, path);
    const value = JSON.parse(readFileSync(file, "utf8"));
    change(value);
    writeFileSync(file, `${JSON.stringify(value, null, 4)}\n`);
}
const taskIn = (manifest, id) => manifest.tasks.find((task) => task.id === id);
const appendText = (root, path, text) => writeFileSync(join(root, path), readFileSync(join(root, path), "utf8") + text);

function assertRefused(t, mutate, pattern) {
    const root = scratch(t);
    mutate(root);
    const result = run(root, "--write", "--matrix-only");
    assert.equal(result.status, 1, `not refused: ${lastLine(result.stdout)}`);
    assert.match(result.stderr, pattern);
    assert.deepEqual(result.calls, []);
    assert.equal(matrixOf(root), COMMITTED_MATRIX, "nothing written");
}

test("guard: task ids are lower-case kebab-case, so a case or whitespace variant is refused", (t) => {
    for (const id of ["Def-Free-Function", "def-free-function ", "def_free_function", "def--free-function"]) {
        assertRefused(t, (root) => editJson(root, "go/bench/tasks.json", (manifest) => {
            manifest.tasks.push({ ...structuredClone(taskIn(manifest, "def-free-function")), id });
        }), new RegExp(`^matrix: FAIL go/bench/tasks\\.json: task id ${JSON.stringify(JSON.stringify(id)).slice(1, -1)} is not lower-case kebab-case`));
    }
});

test("guard: bench/conformance/bench/tasks.json is checked for repeated and malformed ids too", (t) => {
    assertRefused(t, (root) => editJson(root, "bench/conformance/bench/tasks.json", (manifest) => {
        manifest.tasks.push(structuredClone(taskIn(manifest, "c-unique")));
    }), /^matrix: FAIL bench\/conformance\/bench\/tasks\.json repeats task id c-unique$/m);
    assertRefused(t, (root) => editJson(root, "bench/conformance/bench/tasks.json", (manifest) => {
        taskIn(manifest, "c-unique").id = "C-Unique";
    }), /^matrix: FAIL bench\/conformance\/bench\/tasks\.json: task id "C-Unique" is not lower-case kebab-case/);
});

test("guard: every hover task states a contains string, a lane-local one included", (t) => {
    assertRefused(t, (root) => editJson(root, "go/bench/tasks.json", (manifest) => {
        delete taskIn(manifest, "hover-generated-marker").expect.contains;
    }), /^matrix: FAIL go:hover-generated-marker: hover task states no contains string/);
    assertRefused(t, (root) => editJson(root, "php/bench/tasks.json", (manifest) => {
        taskIn(manifest, "hover-global-function").expect.contains = "";
    }), /^matrix: FAIL php:hover-global-function: hover task states no contains string/);
});

test("guard: a list task's count equals its implementations list", (t) => {
    assertRefused(t, (root) => editJson(root, "javascript/bench/tasks.json", (manifest) => {
        taskIn(manifest, "card-report-contract").expect.exact_count += 1;
    }), /^matrix: FAIL javascript:card-report-contract: the key states a count of 25 but lists 24 implementations/);
    assertRefused(t, (root) => editJson(root, "go/bench/tasks.json", (manifest) => {
        taskIn(manifest, "impl-structural-no-assertion").expect.implementations.pop();
    }), /^matrix: FAIL go:impl-structural-no-assertion: the key states a count of 25 but lists 24 implementations/);
    assertRefused(t, (root) => editJson(root, "python/bench/tasks.json", (manifest) => {
        taskIn(manifest, "parents-class-one-plus-two").expect.extends_count = 2;
    }), /^matrix: FAIL python:parents-class-one-plus-two: exact_count 3 disagrees with extends_count \+ implements_count 4/);
});

test("guard: .gitattributes keeps crlf.txt -text, as the last line that sets text for it", (t) => {
    assertRefused(t, (root) => {
        const path = join(root, ".gitattributes");
        writeFileSync(path, readFileSync(path, "utf8").replace("bench/conformance/src/crlf.txt -text\n", ""));
    }, /^matrix: FAIL \.gitattributes lets git normalise the line endings of bench\/conformance\/src\/crlf\.txt \(the last line setting text for it is "\* text=auto eol=lf"\)/);
    assertRefused(t, (root) => appendText(root, ".gitattributes", "*.txt text\n"), /\(the last line setting text for it is "\*\.txt text"\)/);
    assertRefused(t, (root) => appendText(root, ".gitattributes", "bench/** text eol=lf\n"), /\(the last line setting text for it is "bench\/\*\* text eol=lf"\)/);
    assertRefused(t, (root) => rmSync(join(root, ".gitattributes")), /^matrix: FAIL \.gitattributes is missing/);

    // Lines that do not match the file, or that do not set text, leave it alone.
    const root = scratch(t);
    appendText(root, ".gitattributes", "*.md text\nbench/conformance/src/*.txt diff=text\n/crlf.txt text\n");
    const result = run(root, "--write", "--matrix-only");
    assert.equal(result.status, 0, result.stderr);
});
