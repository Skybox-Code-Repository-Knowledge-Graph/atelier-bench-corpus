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
 * The rules.
 *
 *   surface   the task surface the rule serves
 *   requires  expect keys that must be present
 *   forbids   expect keys whose presence makes the target's meaning depend on `kind`
 *   forbids   expect keys whose presence makes the target's meaning depend on `kind`
 *   check     how an answer is compared with the key:
 *               target    one declaration, by exact line (single-target rules)
 *               contains  the key's `contains` string appears in the answer's text
 *               callees   every listed callee declaration is returned, by exact line
 *               callers   every listed call site is covered by a returned caller's range
 *               sites     every reference site is returned and nothing else, each by its line
 *   class     "exact": the key states the whole answer, so extras fail it.
 *             "recall": the key states part of the answer, so extras cannot be judged and do not
 *             fail it. A recall rule cannot catch a tool that returns everything; its results are
 *             reported in their own column and never added to the exact one.
 *   target    for check "target": where the expected declaration is
 *   list      for checks "callees" and "callers": the expect key holding the listed entries
 *   uses      expect keys the rule reads (everything else is "not scored")
 */
export const RULES = [
    {
        name: "definition/target",
        surface: "definition",
        requires: ["file", "needle"],
        forbids: ["exact_count"],
        check: "target",
        class: "exact",
        target: fileAndNeedle,
        uses: ["file", "needle", "known_sites", "must_not_include"],
    },
    {
        name: "definition/candidate",
        surface: "definition",
        requires: ["candidate"],
        forbids: ["exact_count"],
        check: "target",
        class: "exact",
        target: candidate,
        uses: ["candidate", "known_sites", "must_not_include"],
    },
    {
        name: "resolution/candidate",
        surface: "resolution",
        requires: ["candidate"],
        forbids: ["exact_count"],
        check: "target",
        class: "exact",
        target: candidate,
        uses: ["candidate", "known_sites", "must_not_include"],
    },
    {
        name: "import-precision/candidate",
        surface: "import-precision",
        requires: ["candidate"],
        forbids: ["exact_count"],
        check: "target",
        class: "exact",
        target: candidate,
        uses: ["candidate", "known_sites", "must_not_include"],
    },
    {
        name: "hover/contains",
        surface: "hover",
        requires: ["contains"],
        forbids: [],
        check: "contains",
        class: "recall",
        uses: ["contains"],
    },
    {
        name: "call_hierarchy/callees",
        surface: "call_hierarchy",
        requires: ["outgoing_includes"],
        forbids: [],
        check: "callees",
        class: "recall",
        list: "outgoing_includes",
        uses: ["outgoing_includes", "must_not_include"],
    },
    {
        name: "call_hierarchy/callers",
        surface: "call_hierarchy",
        requires: ["incoming_includes"],
        forbids: [],
        check: "callers",
        class: "recall",
        list: "incoming_includes",
        uses: ["incoming_includes", "must_not_include"],
    },
    {
        name: "references/sites",
        surface: "references",
        requires: ["known_sites", "exact_count"],
        forbids: ["min_references"],
        forbidReason: "a floor beside a count, the list is not known to be complete",
        check: "sites",
        class: "exact",
        uses: ["known_sites", "exact_count", "repeated_sites", "optional_sites", "must_not_include"],
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
            const why = rule.forbidReason ?? `target plus ${blocked.join(", ")}: meaning depends on kind`;
            return { scorable: false, reason: rule.forbidReason ? `${blocked.join(", ")}: ${why}` : why };
        }
        if (typeof expect.kind === "string" && Object.hasOwn(KIND_UNSCORABLE, expect.kind)) {
            return { scorable: false, reason: `kind ${expect.kind}: ${KIND_UNSCORABLE[expect.kind]}` };
        }

        const common = {
            scorable: true,
            rule: rule.name,
            check: rule.check,
            class: rule.class,
            exclude: [].concat(expect.must_not_include ?? []).filter((entry) => typeof entry === "string"),
            notScored: keys.filter((key) => !rule.uses.includes(key) && !LABEL_KEYS.has(key)),
        };

        if (rule.check === "contains") {
            if (typeof expect.contains !== "string" || expect.contains === "") {
                return { scorable: false, reason: `${rule.name}: contains is not a non-empty string` };
            }
            return { ...common, contains: expect.contains, allow: [] };
        }

        if (rule.check === "callees" || rule.check === "callers") {
            const entries = Array.isArray(expect[rule.list]) ? expect[rule.list] : [];
            if (entries.length === 0 || !entries.every(isFileNeedle)) {
                return { scorable: false, reason: `${rule.name}: ${rule.list} is not a list of file and needle pairs` };
            }
            return { ...common, entries, allow: [] };
        }

        if (rule.check === "sites") {
            const list = (key) => (Array.isArray(expect[key]) ? expect[key] : []);
            const entries = list("known_sites");
            const repeated = list("repeated_sites");
            const optional = list("optional_sites");
            const wellFormed = entries.every(isFileNeedle)
                && repeated.every((group) => isFileNeedle(group) && Number.isInteger(group.lines))
                && optional.every(isFileNeedle)
                && Number.isInteger(expect.exact_count);
            if (!wellFormed) {
                return { scorable: false, reason: `${rule.name}: the site lists are not file and needle pairs, or exact_count is not an integer` };
            }
            return {
                ...common,
                entries,
                repeated,
                optional,
                from: isFileNeedle(task.from) ? { file: task.from.file, needle: task.from.needle } : null,
                exactCount: expect.exact_count,
                allow: [],
            };
        }

        const target = rule.target(expect);
        if (!isFileNeedle(target)) {
            return { scorable: false, reason: `${rule.name}: target is not a file and needle pair` };
        }

        return {
            ...common,
            target,
            targetInsideSymbol: TARGET_INSIDE_SYMBOL.has(`${lane}:${task.id}`),
            allow: Array.isArray(expect.known_sites) ? expect.known_sites.filter(isFileNeedle) : [],
        };
    }

    return { scorable: false, reason: `no rule for surface ${task.surface} with keys ${keys.sort().join(", ")}` };
}
