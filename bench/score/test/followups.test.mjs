// Plans re-read after the go answer-key changes of PR #230 (issue #223, wave 3). No rule is added
// or changed here: each task is pinned to what the existing rule table does with its key as it
// stands, by fixed answers built from the key's own needles and scored with scoreTask, so a change
// to what a rule accepts turns one of these red (a rule-name pin alone would not).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { planTask } from "../lib/plan.mjs";
import { resolveNeedle } from "../lib/resolve.mjs";
import { scoreTask } from "../lib/score.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const GO = join(REPO_ROOT, "go");
const goTasks = JSON.parse(readFileSync(join(GO, "bench", "tasks.json"), "utf8")).tasks;
const taskOf = (id) => {
    const task = goTasks.find((candidate) => candidate.id === id);
    assert.ok(task, `${id} is not in go/bench/tasks.json`);
    return task;
};
const at = (pair) => {
    const resolved = resolveNeedle(GO, pair);
    assert.ok(resolved.ok, `go: ${pair.needle} does not resolve`);
    return { file: pair.file, line: resolved.line };
};
const verdictOf = (task, locations) => scoreTask(task, { locations }, { root: GO, lane: "go", scope: "repo" }).verdict;

test("go impl-structural-no-assertion: implementation/list scores the 25 implementing types", () => {
    // Was refused (LIST_NOT_TYPES: "the list is struct-literal values") while the key listed the 24
    // AdHocRule values; PR #230 re-keyed it to type declarations, the shape the list rule scores.
    const task = taskOf("impl-structural-no-assertion");
    const plan = planTask(task, "go");
    assert.equal(plan.scorable, true, plan.reason);
    assert.equal(plan.rule, "implementation/list");
    assert.equal(plan.class, "exact");
    assert.equal(plan.exactCount, 25);
    assert.equal(plan.entries.length, 25);
    assert.equal(plan.optional.length, 1);
    assert.deepEqual(plan.exclude, ["var _ contracts.RuleLike"]);
    assert.ok(plan.entries.every((entry) => /^type \w+ struct( \{|\{\})$/.test(entry.needle)), "every entry is a type declaration");
});

test("go impl-structural-no-assertion: the types pass; a missing type, a rule value or nothing fails", () => {
    const task = taskOf("impl-structural-no-assertion");
    const types = task.expect.implementations.map(at);
    const ruleContract = at(task.expect.optional_sites[0]);
    const asked = at(task.from);
    // The AdHocRule values the key used to list (card-rule-contract still lists them).
    const values = taskOf("card-rule-contract").expect.implementations
        .filter((entry) => entry.file === "atelier/rules/adhoc/adhoc.go")
        .map(at);
    assert.equal(values.length, 24);

    assert.equal(verdictOf(task, types), "PASS");
    assert.equal(verdictOf(task, [...types, ruleContract]), "PASS", "RuleContract is an optional site");
    assert.equal(verdictOf(task, [...types, asked]), "PASS", "the line asked from is neutral");
    assert.equal(verdictOf(task, types.slice(1)), "FAIL", "AdHocRule missing");
    assert.equal(verdictOf(task, types.slice(0, -1)), "FAIL", "a nominal rule struct missing");
    assert.equal(verdictOf(task, [...types, values[0]]), "FAIL", "a rule value is not an implementing type");
    assert.equal(verdictOf(task, values), "FAIL", "the old key's answer");
    assert.equal(verdictOf(task, []), "FAIL");
});

test("go resolution-shadowed-stdlib-package: still refused, and the namesake its reason names exists", () => {
    const task = taskOf("resolution-shadowed-stdlib-package");
    const plan = planTask(task, "go");
    assert.equal(plan.scorable, false, `scored by ${plan.rule}`);
    assert.match(plan.reason, /the one exclusion, app\/http's own NewServeMux \(router\.go\), only says what the answer is not/);
    assert.ok(!("candidate" in task.expect), "a candidate would need a rule decision, not this refusal");
    assert.deepEqual(task.expect.must_not_include, ["app/http#NewServeMux"]);
    assert.match(readFileSync(join(GO, "app", "http", "router.go"), "utf8"), /^func NewServeMux\(/m, "the reason says app/http declares NewServeMux");
});

test("go def-struct-tag: definition/target on the field whose json tag is the wire name", () => {
    // Nothing in bench/score names this task; PR #230 changed only its note. The plan is the
    // generic target rule over the key's one declaration line.
    const task = taskOf("def-struct-tag");
    const plan = planTask(task, "go");
    assert.equal(plan.scorable, true, plan.reason);
    assert.equal(plan.rule, "definition/target");
    assert.equal(plan.class, "exact");
    assert.deepEqual(plan.target, { file: "app/http/report.go", needle: "\tReference  string `json:\"reference\"`" });

    const field = at(task.expect);
    const asked = at(task.from);
    assert.equal(verdictOf(task, [field]), "PASS");
    assert.equal(verdictOf(task, [asked]), "FAIL", "the string literal asked from is not the answer");
    assert.equal(verdictOf(task, [field, asked]), "FAIL");
    assert.equal(verdictOf(task, []), "FAIL");
});
