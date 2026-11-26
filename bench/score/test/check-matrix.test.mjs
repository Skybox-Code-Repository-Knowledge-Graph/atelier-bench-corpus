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
import { closeSync, cpSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    // stdout goes to a file, not a pipe: check-matrix.mjs used to end in process.exit() right after
    // printing its grid (~25 KB), and through a pipe on Linux CI the tail of it was lost (the #221
    // pattern, seen on PR #236's first run). A file is written synchronously, whatever the script does.
    const outPath = join(root, "check-matrix.stdout");
    const out = openSync(outPath, "w");
    let result;
    try {
        result = spawnSync(process.execPath, [join(root, "bench", "check-matrix.mjs"), ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", out, "pipe"] });
    } finally {
        closeSync(out);
    }
    const stdout = readFileSync(outPath, "utf8");
    rmSync(outPath, { force: true });
    const log = join(root, "verifier-calls.log");
    const calls = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
    rmSync(log, { force: true });
    return { status: result.status, stdout, stderr: result.stderr, calls };
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

test("an argument check-matrix does not know is refused before anything runs (a typo never runs the full pass)", (t) => {
    for (const argv of [["--write", "--matrix-onyl"], ["--bogus"], ["--write", "--write=1"], ["--matrix-only", "--WRITE"]]) {
        const root = scratch(t);
        const result = run(root, ...argv);
        assert.equal(result.status, 1, argv.join(" "));
        assert.match(result.stderr, /^matrix: FAIL unknown argument \S+ \(known: --write, --matrix-only\)\n$/);
        assert.equal(result.stdout, "");
        assert.deepEqual(result.calls, [], "no verifier spawned");
        assert.equal(matrixOf(root), COMMITTED_MATRIX, "nothing written");
    }
});

test("check-matrix.mjs sets process.exitCode and never calls process.exit() (piped output stays whole)", () => {
    const code = SCRIPT.split("\n").filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line)).join("\n");
    assert.doesNotMatch(code, /process\.exit\(/);
    assert.match(SCRIPT, /^process\.exitCode = /m);
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
        for (const value of [undefined, "", " \t "]) {
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

test("guard: .gitattributes as git reads it: a double star matching no directory, and a nested .gitattributes", (t) => {
    const cases = [
        ["a /**/ pattern", (root) => appendText(root, ".gitattributes", "bench/conformance/src/**/crlf.txt text\n")],
        ["a nested file", (root) => writeFileSync(join(root, "bench", "conformance", "src", ".gitattributes"), "crlf.txt text\n")],
    ];
    // Outside a work tree (the copy is no git repository): the parser reads every .gitattributes on the path.
    for (const [label, mutate] of cases) {
        assertRefused(t, mutate, /^matrix: FAIL \.gitattributes lets git normalise the line endings of bench\/conformance\/src\/crlf\.txt \(the last line setting text for it is /, label);
    }
    // In a work tree git itself is asked.
    const gitInit = (root) => {
        for (const argv of [["init", "-q"], ["add", "-A"]]) {
            assert.equal(spawnSync("git", argv, { cwd: root }).status, 0, `git ${argv.join(" ")}`);
        }
    };
    for (const [label, mutate] of cases) {
        assertRefused(t, (root) => {
            gitInit(root);
            mutate(root);
        }, /^matrix: FAIL \.gitattributes lets git normalise the line endings of bench\/conformance\/src\/crlf\.txt \(git check-attr says text: set\)/, label);
    }
    const root = scratch(t);
    gitInit(root);
    const result = run(root, "--write", "--matrix-only");
    assert.equal(result.status, 0, result.stderr);
});

// bench/TOOL-SURFACE.md. The committed file passes (the tests above run on it); these tests write
// their own file of the same shape into the copy, built from the copy's lane files, so that the
// lanes filling in their rows never turns them red.
const SURFACE = "bench/TOOL-SURFACE.md";
const LANGUAGE = { php: "PHP", rust: "Rust", typescript: "TypeScript", javascript: "JavaScript", python: "Python", go: "Go" };
// SKYBOX_EXTRACTORS in bench/check-matrix.mjs, the R2 list of the pinned version.
const QUOTED = {
    Rust: ["Axum routes", "Reqwest HTTP"],
    PHP: ["Laravel routes", "Eloquent", "Guzzle", "Inertia (PHP side)", "Blade"],
    TypeScript: ["Express", "NestJS", "Hono", "Fastify", "Remix", "SvelteKit", "Nuxt", "Expo"],
    JavaScript: ["Express", "NestJS", "Hono", "Fastify", "Remix", "SvelteKit", "Nuxt", "Expo"],
    Python: ["FastAPI", "Flask", "Django", "SQLAlchemy", "Pydantic"],
    Go: ["net/http", "gorilla/mux", "chi", "gin", "echo", "fiber", "resty"],
};
// README text a lane could write for a deliberate gap and for a server pin; appended to the copy's
// README by the tests that quote it.
const PYTHON_GAP = "SQLAlchemy is a deliberate gap: the lane has no database layer, only Flask.";
const GO_PIN = "The language server this lane's stack starts is gopls v0.24.0.";
const installedVersion = (root) => /inputs\.skybox_version \|\| '(\d+\.\d+\.\d+)'/.exec(readFileSync(join(root, ".github", "workflows", "score-tools.yml"), "utf8"))[1];

/**
 * Write a TOOL-SURFACE.md into the copy: each lane's first extractor is a route parser scored by the
 * lane's first task, the others are `other` and not yet, and no server is pinned. `edit` changes
 * the model before it is written.
 */
function writeSurface(root, edit = () => {}) {
    const model = {
        versionLines: [`Pinned version: \`${installedVersion(root)}\``],
        quoted: structuredClone(QUOTED),
        lanes: Object.fromEntries(LANES.map((lane) => {
            const first = readJson(root, `${lane}/bench/tasks.json`).tasks[0].id;
            const rows = QUOTED[LANGUAGE[lane]].map((extractor, index) => index === 0
                ? { extractor, klass: "route parser", scoredBy: `\`${first}\``, gap: "", notYet: "" }
                : { extractor, klass: "other", scoredBy: "", gap: "", notYet: "not yet" });
            return [lane, { rows, servers: ["not pinned yet"], extra: [] }];
        })),
        separator: "| --- | --- | --- | --- | --- |",
    };
    edit(model);
    const out = ["# Tool surface (test copy)", "", "## Scope (ruling R1)", "", ...model.versionLines, "", "## Framework extractors (ruling R2)", "",
        "```", "npm view (not run by this test)", "Pinned version: `0.0.1`", "```", "",
        "| Language | Framework extractors |", "| --- | --- |",
        ...Object.entries(model.quoted).map(([language, list]) => `| ${language} | ${list.join(", ")} |`), "", "## Per-lane coverage", ""];
    for (const [lane, { rows, servers, extra }] of Object.entries(model.lanes)) {
        out.push(`### ${lane}`, "", "| Extractor | Class | Scored by (task ids) | Deliberate gap (README line) | Not yet |", model.separator);
        out.push(...rows.map((row) => `| ${row.extractor} | ${row.klass} | ${row.scoredBy} | ${row.gap} | ${row.notYet} |`), "");
        out.push(...extra, ...servers.map((server) => `Language server (E.5): ${server}`), "");
    }
    writeFileSync(join(root, SURFACE), `${out.join("\n")}\n`);
}
const row = (model, lane, extractor) => model.lanes[lane].rows.find((candidate) => candidate.extractor === extractor);
const setGap = (model, lane, extractor, gap) => Object.assign(row(model, lane, extractor), { scoredBy: "", gap, notYet: "" });

test("guard: TOOL-SURFACE.md of the checked shape passes, with a quoted gap and a quoted server pin", (t) => {
    const root = scratch(t);
    appendText(root, "python/README.md", `\n${PYTHON_GAP}\n`);
    appendText(root, "go/README.md", `\n${GO_PIN}\n`);
    writeSurface(root, (model) => {
        setGap(model, "python", "SQLAlchemy", `"${PYTHON_GAP}"`);
        model.lanes.go.servers = [`gopls v0.24.0; source "${GO_PIN}"`];
        // A second table in a section is not read, and aligned separators are separators.
        model.lanes.rust.extra = ["| Note | Text |", "| :--- | ---: |", "| a | b |", ""];
        model.separator = "| :--- | :---: | --- | --- | ---: |";
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

test("guard: TOOL-SURFACE.md rows and quoted list follow the pinned R2 list, one state each", (t) => {
    assertRefused(t, (root) => writeSurface(root, (model) => model.lanes.rust.rows.pop()),
        /^matrix: FAIL bench\/TOOL-SURFACE\.md: rust rows are \[Axum routes\], but the Rust list is \[Axum routes, Reqwest HTTP\]/);
    assertRefused(t, (root) => writeSurface(root, (model) => model.quoted.Go.push("httprouter")),
        /the quoted Go list is \[net\/http, .*, resty, httprouter\], but skybox 0\.9\.0 ships \[net\/http, .*, resty\]/);
    // Dropping an extractor from the quoted row and from the lane's rows together is still refused.
    assertRefused(t, (root) => writeSurface(root, (model) => {
        model.quoted.PHP = model.quoted.PHP.filter((extractor) => extractor !== "Guzzle");
        model.lanes.php.rows = model.lanes.php.rows.filter((candidate) => candidate.extractor !== "Guzzle");
    }), /the quoted PHP list is \[Laravel routes, Eloquent, Inertia \(PHP side\), Blade\], but skybox 0\.9\.0 ships/);
    assertRefused(t, (root) => writeSurface(root, (model) => {
        model.lanes.rust.rows[0].notYet = "not yet";
    }), /rust Axum routes: fill exactly one of Scored by, Deliberate gap and Not yet \(2 filled\)/);
    assertRefused(t, (root) => writeSurface(root, (model) => {
        row(model, "go", "chi").notYet = "";
    }), /go chi: fill exactly one of Scored by, Deliberate gap and Not yet \(0 filled\)/);
    assertRefused(t, (root) => writeSurface(root, (model) => {
        row(model, "go", "resty").notYet = "later";
    }), /go resty: the Not yet cell reads "later"/);
    assertRefused(t, (root) => writeSurface(root, (model) => {
        row(model, "rust", "Reqwest HTTP").klass = "client";
    }), /rust Reqwest HTTP: class "client" is not one of/);
    assertRefused(t, (root) => writeSurface(root, (model) => {
        delete model.lanes.typescript;
    }), /no coverage table for lane typescript/);
});

test("guard: a deliberate gap quotes README text that names the extractor, and a route parser cannot be one", (t) => {
    const gapRefused = /python SQLAlchemy: Deliberate gap must quote, in double quotes, python\/README\.md text of 5 or more words that names SQLAlchemy/;
    const withGapText = (cell) => (root) => {
        appendText(root, "python/README.md", `\n${PYTHON_GAP}\n`);
        writeSurface(root, (model) => setGap(model, "python", "SQLAlchemy", cell));
    };
    assertRefused(t, withGapText('"a"'), gapRefused); // byte-present in any README
    assertRefused(t, withGapText('"the lane has no database layer, only Flask."'), gapRefused); // README text, no name
    assertRefused(t, withGapText('"SQLAlchemy is a deliberate"'), gapRefused); // names it, four words
    assertRefused(t, withGapText('"SQLAlchemy is not used by this lane"'), gapRefused); // not README text
    assertRefused(t, withGapText(PYTHON_GAP), gapRefused); // not double-quoted
    assertRefused(t, (root) => {
        appendText(root, "python/README.md", `\n${PYTHON_GAP}\n`);
        writeSurface(root, (model) => setGap(model, "python", "FastAPI", `"${PYTHON_GAP}"`));
    }, /python FastAPI: a route parser cannot be a deliberate gap/);
});

test("guard: TOOL-SURFACE.md pins the version score-tools.yml installs, once, and quotes each pinned server", (t) => {
    assertRefused(t, (root) => writeSurface(root, (model) => {
        model.versionLines = ["Pinned version: `999.0.0`"];
    }), /^matrix: FAIL bench\/TOOL-SURFACE\.md: pinned version 999\.0\.0 is not the one \.github\/workflows\/score-tools\.yml installs \(\d+\.\d+\.\d+\)/);
    assertRefused(t, (root) => writeSurface(root, (model) => {
        model.versionLines = [model.versionLines[0].replaceAll("`", "")];
    }), /pinned version \(no "Pinned version: `x\.y\.z`" line\)/);
    assertRefused(t, (root) => writeSurface(root, (model) => {
        model.versionLines = [model.versionLines[0], "Pinned version: `0.8.0`"];
    }), /needs exactly one "Pinned version:" line outside a code block \(2 found\)/);
    // Only the copy inside the code block is left: that one does not count.
    assertRefused(t, (root) => writeSurface(root, (model) => {
        model.versionLines = [];
    }), /needs exactly one "Pinned version:" line outside a code block \(0 found\)/);

    const pinRefused = /go language server: name the server with its version, then end the line with ; source "<go\/README\.md text of 5 or more words that pins that version>"/;
    const withPinText = (server) => (root) => {
        appendText(root, "go/README.md", `\n${GO_PIN}\n`);
        writeSurface(root, (model) => {
            model.lanes.go.servers = [server];
        });
    };
    assertRefused(t, withPinText("gopls v0.24.0"), pinRefused); // no source
    assertRefused(t, withPinText('gopls v0.24.0; source "a"'), pinRefused); // byte-present in any README
    assertRefused(t, withPinText('gopls v0.25.0; source "The language server this lane\'s stack starts is gopls"'), pinRefused); // source without the version
    assertRefused(t, withPinText(`gopls; source "${GO_PIN}"`), pinRefused); // the line names no version
    assertRefused(t, withPinText('gopls v0.24.0; source "a pin no go README line holds, 0.24.0"'), pinRefused); // not README text
    assertRefused(t, (root) => writeSurface(root, (model) => {
        model.lanes.php.servers = ["not pinned yet", "not pinned yet"];
    }), /the php section needs exactly one "Language server \(E\.5\): \.\.\." line \(2 found\)/);
    assertRefused(t, (root) => rmSync(join(root, SURFACE)), /^matrix: FAIL bench\/TOOL-SURFACE\.md is missing/);
});
