// The tasks that issue #135 found UNSCORABLE only because no rule named their key shape, on the
// definition, resolution, import-precision, multi-parent and implementation surfaces. Each is either
// scored by the rule decided for it, or still UNSCORABLE with the reason decided for it (README.md,
// "Counts beside a target" and the sections after it). A change to either shows here first: the
// decisions were taken before any tool under test was measured on these tasks, and moving one is a
// decision too.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LANES, UNRULED_SHAPES, asksMergedName, planTask } from "../lib/plan.mjs";
import { resolveNeedle } from "../lib/resolve.mjs";
import { scoreTask } from "../lib/score.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** `lane:id` -> the rule that scores it, or a pattern its UNSCORABLE reason must match. */
const DECIDED = {
    // target plus exact_count
    "python:def-overload": { reason: /^exact_count beside a target: the key's sources disagree on what the answer is/ },
    "typescript:resolution-class-interface-merge": { rule: "resolution/merged-name" },
    "typescript:resolution-namespace-vs-enum": { rule: "resolution/merged-member" },
    "go:resolution-arity-parameter-groups": { reason: /^kind arity: exact_count is the signature's parameter count/ },
    "typescript:def-method-overload": { reason: /returns only the overload signature the call matches/ },
    "typescript:def-overload": { reason: /parameter line inside the implementation signature/ },
    "javascript:resolution-calculate-through-binding": { reason: /default binding's implementation .* or both implementations/ },
    // contains on resolution, kind lane_local (go)
    ...Object.fromEntries(["calculate", "customer", "dataset", "formatter-billing", "money", "ref-prefix"]
        .map((name) => [`go:lane-local-${name}`, { reason: /^kind lane_local with only `contains`: .* names no declaration and excludes no sibling lane/ }])),
    // contains on resolution, kind shadow_alias, target outside the repository (go)
    "go:resolution-shadowed-stdlib-package": { reason: /^kind shadow_alias with `contains` and no candidate: the declaration is in the Go standard library/ },
    // definition with only implementations, asked from Cargo.toml (rust)
    "rust:def-cfg-gated": { reason: /^a definition asked from a Cargo.toml feature line with only `implementations`/ },
    // definition with exact_count, kind and known_sites
    "python:def-string-key-dispatch": { rule: "definition/string-key" },
    "javascript:def-dynamic-require": { reason: /^kind unresolvable_static: .* anchors each module on a line inside it/ },
    "python:def-dynamic-import-module": { reason: /^kind unresolvable_static: .* anchors each module on a line inside it/ },
    // import-precision, kind visibility_boundary, with contains and one known site (go)
    "go:imp-internal-package": { reason: /^kind visibility_boundary with `contains` and one known site and no count: gopls v0\.24\.0 answers .* three importers/ },
    // import-precision, the shared id imp-glob-import: no single reading
    "rust:imp-glob-import": { reason: /^imp-glob-import has no single reading: .* the rust key lists both public items/ },
    "python:imp-glob-import": { reason: /^imp-glob-import has no single reading: .* the python key lists 2 of the 16 names, each on its `from \.x import X` line in metrics\/__init__\.py/ },
    "typescript:imp-glob-import": { reason: /^imp-glob-import has no single reading: .* the typescript key lists 2 of the 4 exported names by line and the other 2 only by name/ },
    "javascript:imp-glob-import": { reason: /^imp-glob-import has no single reading: .* the javascript note says "the answer is the declaring module"/ },
    "php:imp-glob-import": { reason: /^imp-glob-import has no single reading: .* the php statement is a brace group-use that names its eight classes, not a glob/ },
    // multi-parent with only exact_count and must_include, parents outside the repository (rust)
    "rust:parents-supertrait-send-sync": { reason: /^parents with only `exact_count` and `must_include`: the two parents, Send and Sync, are declared in the Rust core library/ },
    // implementation with a single target under vendor/ (php)
    "php:vendor-shouldbroadcast-contract": { reason: /^an implementation question whose key names the contract, not an implementor: phpactor 2026\.11\.22\.0 answers implementation .* six implementors/ },
};

const tasksOf = new Map();
function taskOf(lane, id) {
    if (!tasksOf.has(lane)) {
        tasksOf.set(lane, JSON.parse(readFileSync(join(REPO_ROOT, lane, "bench", "tasks.json"), "utf8")).tasks);
    }
    return tasksOf.get(lane).find((task) => task.id === id);
}

for (const [key, decided] of Object.entries(DECIDED)) {
    test(`decided: ${key}`, () => {
        const [lane, id] = key.split(":");
        const task = taskOf(lane, id);
        assert.ok(task, `${key} is not in ${lane}/bench/tasks.json`);
        const plan = planTask(task, lane);
        if (decided.rule) {
            assert.equal(plan.scorable, true, `${key}: ${plan.reason ?? ""}`);
            assert.equal(plan.rule, decided.rule);
            assert.equal(plan.class, "exact");
        } else {
            assert.equal(plan.scorable, false, `${key} is scored by ${plan.rule}`);
            assert.match(plan.reason, decided.reason);
        }
    });
}

test("a declaration_merge question is the merged name or a member, by the asked symbol", () => {
    const name = planTask(taskOf("typescript", "resolution-class-interface-merge"), "typescript");
    assert.deepEqual(name.notScored, ["candidate"], "the merged name's question does not read the member");
    const member = planTask(taskOf("typescript", "resolution-namespace-vs-enum"), "typescript");
    assert.deepEqual(member.allow, [], "the merged name's declarations are not allowed beside the member");
    assert.deepEqual([...member.notScored].sort(), ["exact_count", "known_sites"]);
});

test("a list rule for a definition or resolution question does not make the asked line neutral", () => {
    // The line asked from is a use (a getattr call), or itself a listed declaration; either way the
    // rule must not accept it as a free extra, as a references question does.
    assert.equal(planTask(taskOf("python", "def-string-key-dispatch"), "python").from, null);
    assert.equal(planTask(taskOf("typescript", "resolution-class-interface-merge"), "typescript").from, null);
});

// What each ruled task's rule DOES, not just its name: a fixed answer built from the key's own
// needles is scored, so a rule that changes what it reads (the wrong half, a candidate it should
// not take, a line it should not make neutral) turns one of these red.
const ROOT_OF = (lane) => join(REPO_ROOT, lane);
const at = (lane, pair) => {
    const resolved = resolveNeedle(ROOT_OF(lane), pair);
    assert.ok(resolved.ok, `${lane}: ${pair.needle} does not resolve`);
    return { file: pair.file, line: resolved.line };
};
const verdictOf = (lane, task, locations) => scoreTask(task, { locations }, { root: ROOT_OF(lane), lane, scope: "repo" }).verdict;

test("resolution/merged-name: both declarations pass; one alone, or with the member, fails", () => {
    const task = taskOf("typescript", "resolution-class-interface-merge");
    const [klass, iface] = task.expect.known_sites.map((site) => at("typescript", site));
    const member = at("typescript", task.expect.candidate);
    assert.equal(verdictOf("typescript", task, [klass, iface]), "PASS");
    assert.equal(verdictOf("typescript", task, [klass]), "FAIL");
    assert.equal(verdictOf("typescript", task, [iface]), "FAIL");
    assert.equal(verdictOf("typescript", task, [klass, iface, member]), "FAIL");
    assert.equal(verdictOf("typescript", task, []), "FAIL");
});

test("resolution/merged-member: the member's own declaration passes; a half of the name beside or instead fails", () => {
    const task = taskOf("typescript", "resolution-namespace-vs-enum");
    const [enumHalf, namespaceHalf] = task.expect.known_sites.map((site) => at("typescript", site));
    const member = at("typescript", task.expect.candidate);
    assert.equal(verdictOf("typescript", task, [member]), "PASS");
    assert.equal(verdictOf("typescript", task, [namespaceHalf]), "FAIL", "the namespace half is not the member");
    assert.equal(verdictOf("typescript", task, [enumHalf]), "FAIL");
    assert.equal(verdictOf("typescript", task, [member, enumHalf]), "FAIL");
    assert.equal(verdictOf("typescript", task, [member, namespaceHalf]), "FAIL");
    assert.equal(verdictOf("typescript", task, []), "FAIL");
});

test("definition/string-key: both selected declarations pass; one, or with the asked line or another declaration, fails", () => {
    const task = taskOf("python", "def-string-key-dispatch");
    const [open, completed] = task.expect.known_sites.map((site) => at("python", site));
    const asked = at("python", task.from);
    const other = at("python", { file: task.from.file, needle: "def total(" });
    assert.equal(verdictOf("python", task, [open, completed]), "PASS");
    assert.equal(verdictOf("python", task, [open]), "FAIL");
    assert.equal(verdictOf("python", task, [completed]), "FAIL");
    assert.equal(verdictOf("python", task, [open, completed, asked]), "FAIL", "the getattr line is not neutral");
    assert.equal(verdictOf("python", task, [open, completed, other]), "FAIL");
    assert.equal(verdictOf("python", task, []), "FAIL");
});

test("definition/string-key passes a task by when it names a target: file, needle or candidate (absent)", () => {
    // README: "A string_key task that names a target (file and needle, or candidate) keeps the
    // target rules." A synthetic task: the real one plus a target taken from its own key.
    const task = taskOf("python", "def-string-key-dispatch");
    assert.equal(planTask(task, "python").rule, "definition/string-key");
    const [site] = task.expect.known_sites;
    for (const extra of [{ file: site.file }, { needle: site.needle }, { file: site.file, needle: site.needle }, { candidate: site }]) {
        const synthetic = structuredClone(task);
        Object.assign(synthetic.expect, extra);
        const plan = planTask(synthetic, "python");
        assert.notEqual(plan.rule, "definition/string-key", `with ${Object.keys(extra).join(" and ")}`);
    }
    const targeted = structuredClone(task);
    Object.assign(targeted.expect, { file: site.file, needle: site.needle });
    delete targeted.expect.exact_count;
    assert.equal(planTask(targeted, "python").rule, "definition/target", "with a target and no count, the target rule takes it");
});

test("resolution/merged-member reads must_not_include: an excluded entry fails the member's own declaration", () => {
    // The real task carries no must_not_include; a synthetic one adds an entry the answer's text can trip.
    const task = structuredClone(taskOf("typescript", "resolution-namespace-vs-enum"));
    task.expect.must_not_include = ["zz excluded by the key"];
    const plan = planTask(task, "typescript");
    assert.equal(plan.rule, "resolution/merged-member");
    assert.ok(!plan.notScored.includes("must_not_include"), "must_not_include is read, not reported as not scored");
    const member = at("typescript", task.expect.candidate);
    const context = { root: ROOT_OF("typescript"), lane: "typescript", scope: "repo" };
    assert.equal(scoreTask(task, { locations: [member] }, context).verdict, "PASS");
    const tripped = scoreTask(task, { locations: [member], text: "zz excluded by the key" }, context);
    assert.equal(tripped.verdict, "FAIL");
    assert.match(tripped.detail, /excluded "zz excluded by the key" returned/);
});

test("a declaration_merge task asks about the member unless the symbol is on every listed declaration", () => {
    // `abstract` is written on 1 of the 2 known sites (the class line), not on both: `every`, not `some`.
    const task = structuredClone(taskOf("typescript", "resolution-class-interface-merge"));
    task.from.symbol = "abstract";
    assert.equal(asksMergedName(task), false);
    assert.equal(planTask(task, "typescript").rule, "resolution/merged-member");
    task.from.symbol = "Worker";
    assert.equal(planTask(task, "typescript").rule, "resolution/merged-name");
});

test("every refused shape lists its tasks as a non-empty set of lane:id, and an entry without one matches nothing", () => {
    const laneId = new RegExp(`^(${LANES.join("|")}):[a-z0-9-]+$`);
    for (const shape of UNRULED_SHAPES) {
        const label = `${shape.surface} ${shape.kind ?? ""} ${shape.keys.join(",")}`;
        assert.ok(shape.tasks instanceof Set && shape.tasks.size > 0, `${label}: tasks is not a non-empty Set`);
        for (const key of shape.tasks) {
            assert.match(key, laneId, label);
        }
        assert.ok(typeof shape.reason === "string" && shape.reason !== "", `${label}: no reason`);
    }
    // An entry written without `tasks` (or with a list in place of a Set) must neither throw for
    // every later task nor take a task of its shape: it matches none.
    const task = taskOf("go", "imp-internal-package");
    for (const tasks of [undefined, ["go:imp-internal-package"]]) {
        UNRULED_SHAPES.unshift({ surface: task.surface, kind: task.expect.kind, keys: Object.keys(task.expect), tasks, reason: "an entry without a Set of tasks" });
        try {
            assert.match(planTask(task, "go").reason, /^kind visibility_boundary with `contains`/);
            assert.match(planTask({ ...structuredClone(task), id: "imp-not-listed" }, "go").reason, /^no rule for surface import-precision with keys contains, kind, known_sites$/);
        } finally {
            UNRULED_SHAPES.shift();
        }
    }
});

test("an unlisted task of a refused shape gets the generic reason, not another lane's", () => {
    const listed = taskOf("go", "lane-local-money");
    assert.match(planTask(listed, "go").reason, /^kind lane_local with only `contains`/);
    const unlisted = { ...structuredClone(listed), id: "lane-local-not-in-the-list" };
    assert.match(planTask(unlisted, "go").reason, /^no rule for surface resolution with keys contains, kind$/);
    assert.match(planTask(listed, "python").reason, /^no rule for surface resolution with keys contains, kind$/, "the same task under another lane is not the listed one");
});

// README "Exact rules" and the plan.mjs header say what `exact_count` beside a target means today:
// the declarations a list names (resolution/merged-name, with merged-member reading the member
// instead), or a parameter count (kind arity, refused). No rule reads it as an overload count.
test("exact_count beside a target is scored only by the declaration_merge rules, and never as an overload count", () => {
    const scoredBy = new Set();
    for (const lane of LANES) {
        for (const task of JSON.parse(readFileSync(join(REPO_ROOT, lane, "bench", "tasks.json"), "utf8")).tasks) {
            const expect = task.expect ?? {};
            if (!("exact_count" in expect) || !("candidate" in expect || ("file" in expect && "needle" in expect))) {
                continue;
            }
            const plan = planTask(task, lane);
            if (plan.scorable) {
                scoredBy.add(plan.rule);
            } else if (/overload/.test(task.id)) {
                assert.match(plan.reason, /^exact_count beside a target: /, `${lane}:${task.id}`);
            }
        }
    }
    assert.deepEqual([...scoredBy].sort(), ["resolution/merged-member", "resolution/merged-name"]);
    for (const file of ["README.md", "lib/plan.mjs"]) {
        const text = readFileSync(join(REPO_ROOT, "bench", "score", file), "utf8");
        assert.doesNotMatch(text, /overload count/, `${file} still gives exact_count an overload meaning`);
    }
});
