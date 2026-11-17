// The rule table: which tasks this version of the scorer can score, and how.
//
// Semantics come from this table, never from the shape of an `expect` block. The same key means
// different things in different tasks (`exact_count` is an overload count in one task, a parameter
// count in another), so a task is scored only when a rule names its surface and its keys. Every
// other task is reported UNSCORABLE with the reason, and every key a rule does not use is listed
// per task as "not scored".

import { isFileNeedle } from "./resolve.mjs";

export const LANES = ["php", "rust", "typescript", "javascript", "python", "go"];

/** Descriptive keys. They label a task; no rule ever scores them and they are not reported. */
export const LABEL_KEYS = new Set(["kind", "resolution"]);

/** Kinds no single-target rule can score, with the reason. A task of such a kind is UNSCORABLE. */
export const KIND_UNSCORABLE = {
    build_generated: "the key names two places, the include! line and the build.rs function",
};

const candidate = (expect) => expect.candidate;
const fileAndNeedle = (expect) => ({ file: expect.file, needle: expect.needle });

/**
 * Single-target rules: the answer is one declaration.
 *
 *   surface   the task surface the rule serves
 *   requires  expect keys that must be present
 *   forbids   expect keys whose presence makes the target's meaning depend on `kind`
 *   target    where the expected declaration is
 *   uses      expect keys the rule reads (everything else is "not scored")
 */
export const RULES = [
    {
        name: "definition/target",
        surface: "definition",
        requires: ["file", "needle"],
        forbids: ["exact_count"],
        target: fileAndNeedle,
        uses: ["file", "needle", "known_sites", "must_not_include"],
    },
    {
        name: "definition/candidate",
        surface: "definition",
        requires: ["candidate"],
        forbids: ["exact_count"],
        target: candidate,
        uses: ["candidate", "known_sites", "must_not_include"],
    },
    {
        name: "resolution/candidate",
        surface: "resolution",
        requires: ["candidate"],
        forbids: ["exact_count"],
        target: candidate,
        uses: ["candidate", "known_sites", "must_not_include"],
    },
    {
        name: "import-precision/candidate",
        surface: "import-precision",
        requires: ["candidate"],
        forbids: ["exact_count"],
        target: candidate,
        uses: ["candidate", "known_sites", "must_not_include"],
    },
];

/**
 * Targets anchored on a line INSIDE the declaration they stand for, keyed `lane:id`. The needle sits
 * in the body because the declaration line is not unique in its file, or because the answer is a
 * statement (a blank import's effect is a call inside init). A tool returns the declaration, so
 * these targets are matched by containment: the returned range must cover the anchored line.
 * Every other target is matched by its exact line.
 */
export const TARGET_INSIDE_SYMBOL = new Set([
    "python:def-super-cooperative",
    "go:imp-blank-import-side-effect",
    "go:def-type-switch",
    "php:def-static-closure",
    "typescript:resolution-satisfies",
]);

/** Decide how one task is scored, or why it is not. `lane` selects the per-lane exceptions above. */
export function planTask(task, lane = null) {
    const expect = task && typeof task.expect === "object" && task.expect !== null ? task.expect : {};
    const keys = Object.keys(expect);
    const candidates = RULES.filter((rule) => rule.surface === task.surface);

    if (candidates.length === 0) {
        return { scorable: false, reason: `no rule for surface ${task.surface}` };
    }

    for (const rule of candidates) {
        if (!rule.requires.every((key) => key in expect)) {
            continue;
        }

        const blocked = rule.forbids.filter((key) => key in expect);
        if (blocked.length > 0) {
            return { scorable: false, reason: `target plus ${blocked.join(", ")}: meaning depends on kind` };
        }
        if (typeof expect.kind === "string" && Object.hasOwn(KIND_UNSCORABLE, expect.kind)) {
            return { scorable: false, reason: `kind ${expect.kind}: ${KIND_UNSCORABLE[expect.kind]}` };
        }

        const target = rule.target(expect);
        if (!isFileNeedle(target)) {
            return { scorable: false, reason: `${rule.name}: target is not a file and needle pair` };
        }

        return {
            scorable: true,
            rule: rule.name,
            target,
            targetInsideSymbol: TARGET_INSIDE_SYMBOL.has(`${lane}:${task.id}`),
            allow: Array.isArray(expect.known_sites) ? expect.known_sites.filter(isFileNeedle) : [],
            exclude: [].concat(expect.must_not_include ?? []).filter((entry) => typeof entry === "string"),
            notScored: keys.filter((key) => !rule.uses.includes(key) && !LABEL_KEYS.has(key)),
        };
    }

    return { scorable: false, reason: `no rule for surface ${task.surface} with keys ${keys.sort().join(", ")}` };
}
