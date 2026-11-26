// The definition and resolution tasks that issue #135 found UNSCORABLE only because no rule named
// their key shape. Each is either scored by the rule decided for it, or still UNSCORABLE with the
// reason decided for it (README.md, "Counts beside a target" and the sections after it). A change
// to either shows here first: the decisions were taken before any tool under test was measured on
// these tasks, and moving one is a decision too.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { planTask } from "../lib/plan.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** `lane:id` -> the rule that scores it, or a pattern its UNSCORABLE reason must match. */
const DECIDED = {
    // target plus exact_count
    "python:def-overload": { rule: "definition/overloads" },
    "typescript:resolution-class-interface-merge": { rule: "resolution/merged-name" },
    "typescript:resolution-namespace-vs-enum": { rule: "resolution/merged-member" },
    "go:resolution-arity-parameter-groups": { reason: /^kind arity: exact_count is the signature's parameter count/ },
    "typescript:def-method-overload": { reason: /returns only the overload signature the call matches/ },
    "typescript:def-overload": { reason: /parameter line inside the implementation signature/ },
    "javascript:resolution-calculate-through-binding": { reason: /default binding's implementation .* or both implementations/ },
    // contains on resolution, kind lane_local (go)
    ...Object.fromEntries(["calculate", "customer", "dataset", "formatter-billing", "money", "ref-prefix"]
        .map((name) => [`go:lane-local-${name}`, { reason: /^kind lane_local with only `contains`: .* names no declaration and excludes no sibling lane/ }])),
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

test("definition/overloads needs exact_count to count the listed signatures", () => {
    const task = structuredClone(taskOf("python", "def-overload"));
    task.expect.exact_count = 3;
    const plan = planTask(task, "python");
    assert.equal(plan.scorable, false);
    assert.match(plan.reason, /exact_count 3, but the key lists 2 in known_sites/);
    assert.equal(planTask(taskOf("python", "def-overload"), null).scorable, false, "the rule is keyed by lane:id; without the lane it does not apply");
});
