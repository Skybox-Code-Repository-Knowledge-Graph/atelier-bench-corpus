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

// The static guards. Each mutation below breaks exactly what one guard protects, on its own temp
// copy, and `--write --matrix-only` (static guards only) must refuse it by name, spawn nothing and
// write nothing; the unchanged copy passing (tests above) is the green half. Targets are picked by
// predicate from the lane files at run time, never by a row or id a lane may legitimately change.
function editJson(root, path, change) {
    const file = join(root, path);
    const value = JSON.parse(readFileSync(file, "utf8"));
    change(value);
    writeFileSync(file, `${JSON.stringify(value, null, 4)}\n`);
}
const readJson = (root, path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const taskIn = (manifest, id) => manifest.tasks.find((task) => task.id === id);
const appendText = (root, path, text) => writeFileSync(join(root, path), readFileSync(join(root, path), "utf8") + text);
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The first task, in lane order, that `predicate` accepts: [lane, task]. */
function findTask(predicate) {
    for (const lane of LANES) {
        const task = readJson(REPO_ROOT, `${lane}/bench/tasks.json`).tasks.find((candidate) => predicate(candidate, lane));
        if (task) {
            return [lane, task];
        }
    }
    assert.fail("no task in any lane fits the mutation");
}

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
            manifest.tasks.push({ ...structuredClone(manifest.tasks[0]), id });
        }), new RegExp(`^matrix: FAIL go/bench/tasks\\.json: task id ${escape(JSON.stringify(id))} is not lower-case kebab-case`));
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
    const lanesOf = new Map(Object.entries(JSON.parse(COMMITTED_MATRIX).canonical).map(([id, entry]) => [id, entry.lanes]));
    for (const shared of [false, true]) {
        const [lane, task] = findTask((candidate) => candidate.surface === "hover" && (lanesOf.get(candidate.id).length > 1) === shared);
        for (const value of [undefined, ""]) {
            assertRefused(t, (root) => editJson(root, `${lane}/bench/tasks.json`, (manifest) => {
                const target = taskIn(manifest, task.id).expect;
                if (value === undefined) {
                    delete target.contains;
                } else {
                    target.contains = value;
                }
            }), new RegExp(`^matrix: FAIL ${lane}:${escape(task.id)}: hover task states no contains string`));
        }
    }
});

test("guard: a list task's count equals its implementations list", (t) => {
    const listed = (surface) => (task) => task.surface === surface && Number.isInteger(task.expect?.exact_count) && Array.isArray(task.expect?.implementations);
    const [cardLane, card] = findTask(listed("cardinality"));
    const size = card.expect.implementations.length;
    assertRefused(t, (root) => editJson(root, `${cardLane}/bench/tasks.json`, (manifest) => {
        taskIn(manifest, card.id).expect.exact_count += 1;
    }), new RegExp(`^matrix: FAIL ${cardLane}:${escape(card.id)}: the key states a count of ${size + 1} but lists ${size} implementations`));

    const [implLane, impl] = findTask(listed("implementation"));
    const implSize = impl.expect.implementations.length;
    assertRefused(t, (root) => editJson(root, `${implLane}/bench/tasks.json`, (manifest) => {
        taskIn(manifest, impl.id).expect.implementations.pop();
    }), new RegExp(`^matrix: FAIL ${implLane}:${escape(impl.id)}: the key states a count of ${implSize} but lists ${implSize - 1} implementations`));

    const [splitLane, split] = findTask((task) => listed("multi-parent")(task) && Number.isInteger(task.expect.extends_count) && Number.isInteger(task.expect.implements_count));
    const { exact_count: exact, extends_count: extendsCount, implements_count: implementsCount } = split.expect;
    assertRefused(t, (root) => editJson(root, `${splitLane}/bench/tasks.json`, (manifest) => {
        taskIn(manifest, split.id).expect.extends_count += 1;
    }), new RegExp(`^matrix: FAIL ${splitLane}:${escape(split.id)}: exact_count ${exact} disagrees with extends_count \\+ implements_count ${extendsCount + implementsCount + 1}`));
});

test("guard: .gitattributes keeps crlf.txt -text, as the last line that sets text for it", (t) => {
    const normalised = /^matrix: FAIL \.gitattributes lets git normalise the line endings of bench\/conformance\/src\/crlf\.txt/;
    assertRefused(t, (root) => {
        const path = join(root, ".gitattributes");
        const text = readFileSync(path, "utf8");
        assert.ok(text.includes("bench/conformance/src/crlf.txt -text\n"));
        writeFileSync(path, text.replace("bench/conformance/src/crlf.txt -text\n", ""));
    }, normalised);
    assertRefused(t, (root) => appendText(root, ".gitattributes", "*.txt text\n"), /\(the last line setting text for it is "\*\.txt text"\)/);
    assertRefused(t, (root) => appendText(root, ".gitattributes", "bench/** text eol=lf\n"), /\(the last line setting text for it is "bench\/\*\* text eol=lf"\)/);
    assertRefused(t, (root) => rmSync(join(root, ".gitattributes")), /^matrix: FAIL \.gitattributes is missing/);

    // Lines that do not match the file, or that do not set text, leave it alone.
    const root = scratch(t);
    appendText(root, ".gitattributes", "*.md text\nbench/conformance/src/*.txt diff=text\n/crlf.txt text\n");
    const result = run(root, "--write", "--matrix-only");
    assert.equal(result.status, 0, result.stderr);
});

// bench/TOOL-SURFACE.md. The committed file passes (the tests above run on it); these tests write
// their own file of the same shape into the copy, built from the copy's lane files, so that the
// lanes filling in their rows never turns them red.
const SURFACE = "bench/TOOL-SURFACE.md";
const LANGUAGE = { php: "PHP", rust: "Rust", typescript: "TypeScript", javascript: "JavaScript", python: "Python", go: "Go" };
const QUOTED = {
    Rust: ["Axum routes", "Reqwest HTTP"],
    PHP: ["Laravel routes", "Eloquent", "Guzzle", "Inertia (PHP side)", "Blade"],
    TypeScript: ["Express", "NestJS"],
    JavaScript: ["Express", "NestJS"],
    Python: ["FastAPI", "Flask", "SQLAlchemy"],
    Go: ["net/http", "chi", "resty"],
};
const installedVersion = (root) => /inputs\.skybox_version \|\| '(\d+\.\d+\.\d+)'/.exec(readFileSync(join(root, ".github", "workflows", "score-tools.yml"), "utf8"))[1];
const readmeTitle = (root, lane) => readFileSync(join(root, lane, "README.md"), "utf8").split("\n").find((line) => line.startsWith("# ")).slice(2);

/**
 * Write a TOOL-SURFACE.md into the copy: each lane's first extractor is a route parser scored by the
 * lane's first task, the others are `other` and not yet, and no server is pinned. `edit` changes
 * the model before it is written.
 */
function writeSurface(root, edit = () => {}) {
    const model = {
        versionLine: `Pinned version: \`${installedVersion(root)}\``,
        quoted: structuredClone(QUOTED),
        lanes: Object.fromEntries(LANES.map((lane) => {
            const first = readJson(root, `${lane}/bench/tasks.json`).tasks[0].id;
            const rows = QUOTED[LANGUAGE[lane]].map((extractor, index) => index === 0
                ? { extractor, klass: "route parser", scoredBy: `\`${first}\``, gap: "", notYet: "" }
                : { extractor, klass: "other", scoredBy: "", gap: "", notYet: "not yet" });
            return [lane, { rows, servers: ["not pinned yet"] }];
        })),
    };
    edit(model);
    const out = ["# Tool surface (test copy)", "", "## Scope (ruling R1)", "", model.versionLine, "", "## Framework extractors (ruling R2)", "",
        "```", "npm view (not run by this test)", "```", "",
        "| Language | Framework extractors |", "| --- | --- |",
        ...Object.entries(model.quoted).map(([language, list]) => `| ${language} | ${list.join(", ")} |`), "", "## Per-lane coverage", ""];
    for (const [lane, { rows, servers }] of Object.entries(model.lanes)) {
        out.push(`### ${lane}`, "", "| Extractor | Class | Scored by (task ids) | Deliberate gap (README line) | Not yet |", "| --- | --- | --- | --- | --- |");
        out.push(...rows.map((row) => `| ${row.extractor} | ${row.klass} | ${row.scoredBy} | ${row.gap} | ${row.notYet} |`), "");
        out.push(...servers.map((server) => `Language server (E.5): ${server}`), "");
    }
    writeFileSync(join(root, SURFACE), `${out.join("\n")}\n`);
}

test("guard: TOOL-SURFACE.md of the checked shape passes, with a quoted gap and a quoted server pin", (t) => {
    const root = scratch(t);
    writeSurface(root, (model) => {
        const python = model.lanes.python.rows.find((row) => row.extractor === "SQLAlchemy");
        Object.assign(python, { gap: `"${readmeTitle(root, "python")}"`, notYet: "" });
        model.lanes.go.servers = [`gopls v0.0.0; source "${readmeTitle(root, "go")}"`];
    });
    const result = run(root, "--write", "--matrix-only");
    assert.equal(result.status, 0, result.stderr);
});

test("guard: TOOL-SURFACE.md names only task ids its lanes have", (t) => {
    assertRefused(t, (root) => writeSurface(root, (model) => {
        model.lanes.rust.rows[0].scoredBy += ", `no-such-task-id`";
    }), /^matrix: FAIL bench\/TOOL-SURFACE\.md: rust Axum routes: task no-such-task-id is not in rust\/bench\/tasks\.json/);
    // The lane renames an id the table names: the rot this guard exists for.
    const goFirst = readJson(REPO_ROOT, "go/bench/tasks.json").tasks[0].id;
    assertRefused(t, (root) => {
        writeSurface(root);
        editJson(root, "go/bench/tasks.json", (manifest) => {
            manifest.tasks[0].id = `${goFirst}-renamed`;
        });
    }, new RegExp(`^matrix: FAIL bench/TOOL-SURFACE\\.md: go net/http: task ${escape(goFirst)} is not in go/bench/tasks\\.json`));
    assertRefused(t, (root) => writeSurface(root, (model) => {
        model.lanes.python.rows[0].scoredBy = model.lanes.python.rows[0].scoredBy.replaceAll("`", "");
    }), /python FastAPI: Scored by must be backticked task ids/);
});

test("guard: TOOL-SURFACE.md rows follow the quoted list, one state each", (t) => {
    assertRefused(t, (root) => writeSurface(root, (model) => model.lanes.rust.rows.pop()),
        /^matrix: FAIL bench\/TOOL-SURFACE\.md: rust rows are \[Axum routes\], but the quoted Rust list is \[Axum routes, Reqwest HTTP\]/);
    assertRefused(t, (root) => writeSurface(root, (model) => model.quoted.Go.push("fiber")),
        /go rows are \[net\/http, chi, resty\], but the quoted Go list is \[net\/http, chi, resty, fiber\]/);
    assertRefused(t, (root) => writeSurface(root, (model) => {
        model.lanes.rust.rows[0].notYet = "not yet";
    }), /rust Axum routes: fill exactly one of Scored by, Deliberate gap and Not yet \(2 filled\)/);
    assertRefused(t, (root) => writeSurface(root, (model) => {
        model.lanes.go.rows[1].notYet = "";
    }), /go chi: fill exactly one of Scored by, Deliberate gap and Not yet \(0 filled\)/);
    assertRefused(t, (root) => writeSurface(root, (model) => {
        model.lanes.go.rows[2].notYet = "later";
    }), /go resty: the Not yet cell reads "later"/);
    assertRefused(t, (root) => writeSurface(root, (model) => {
        model.lanes.rust.rows[1].klass = "client";
    }), /rust Reqwest HTTP: class "client" is not one of/);
    assertRefused(t, (root) => writeSurface(root, (model) => {
        delete model.lanes.typescript;
    }), /no coverage table for lane typescript/);
});

test("guard: a deliberate gap quotes the lane README, and a route parser cannot be one", (t) => {
    const gapOn = (index, cell) => (root) => writeSurface(root, (model) => {
        Object.assign(model.lanes.python.rows[index], { scoredBy: "", gap: typeof cell === "function" ? cell(root) : cell, notYet: "" });
    });
    assertRefused(t, gapOn(2, '"no SQLAlchemy here, on purpose"'), /python SQLAlchemy: Deliberate gap must quote, in double quotes, a line of python\/README\.md/);
    assertRefused(t, gapOn(2, (root) => readmeTitle(root, "python")), /python SQLAlchemy: Deliberate gap must quote/);
    assertRefused(t, gapOn(0, (root) => `"${readmeTitle(root, "python")}"`), /python FastAPI: a route parser cannot be a deliberate gap/);
});

test("guard: TOOL-SURFACE.md pins the version score-tools.yml installs, and quotes each pinned server", (t) => {
    assertRefused(t, (root) => writeSurface(root, (model) => {
        model.versionLine = "Pinned version: `999.0.0`";
    }), /^matrix: FAIL bench\/TOOL-SURFACE\.md: pinned version 999\.0\.0 is not the one \.github\/workflows\/score-tools\.yml installs \(\d+\.\d+\.\d+\)/);
    assertRefused(t, (root) => writeSurface(root, (model) => {
        model.versionLine = model.versionLine.replaceAll("`", "");
    }), /pinned version \(no "Pinned version:" line\)/);
    assertRefused(t, (root) => writeSurface(root, (model) => {
        model.lanes.go.servers = ["gopls v0.0.0"];
    }), /go language server: end the line with ; source "<the go\/README\.md text that pins it>"/);
    assertRefused(t, (root) => writeSurface(root, (model) => {
        model.lanes.go.servers = ['gopls v0.0.0; source "a pin no go README line holds"'];
    }), /go language server: end the line with ; source/);
    assertRefused(t, (root) => writeSurface(root, (model) => {
        model.lanes.php.servers = ["not pinned yet", "not pinned yet"];
    }), /the php section needs exactly one "Language server \(E\.5\): \.\.\." line \(2 found\)/);
    assertRefused(t, (root) => rmSync(join(root, SURFACE)), /^matrix: FAIL bench\/TOOL-SURFACE\.md is missing/);
});
