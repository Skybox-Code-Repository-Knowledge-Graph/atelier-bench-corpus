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
 *   list      for checks "callees", "callers" and "sites": the expect key holding the listed entries
 *   neutralLists  for check "sites": expect keys whose lines may be returned or not
 *   noun      for check "sites": what one entry is, in reasons ("site", "declaration")
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
        name: "document_symbol/names",
        surface: "document_symbol",
        requires: ["symbols"],
        forbids: [],
        check: "names",
        class: "exact",
        uses: ["symbols"],
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
        list: "known_sites",
        neutralLists: ["optional_sites"],
        noun: "site",
        uses: ["known_sites", "exact_count", "repeated_sites", "optional_sites", "must_not_include"],
    },
    ...["implementation", "cardinality", "multi-parent"].map((surface) => ({
        name: `${surface}/list`,
        surface,
        requires: ["implementations"],
        forbids: ["min_implementations", "min_references"],
        forbidReason: "a floor, the list is not known to be complete",
        check: "sites",
        class: "exact",
        list: "implementations",
        neutralLists: ["optional_sites", "known_sites"],
        noun: "declaration",
        uses: ["implementations", "exact_count", "extends_count", "implements_count", "optional_sites", "known_sites", "must_not_include"],
    })),
];

/**
 * Implementation lists whose entries are not the implementing types an implementation query
 * returns, keyed by id (every lane) or `lane:id`. Such a task is UNSCORABLE under the list rules.
 */
export const LIST_NOT_TYPES = {
    "card-rule-contract": "half the list is rule values (instances, object literals, macro arms), and an implementation query returns types",
    "go:impl-structural-no-assertion": "the list is struct-literal values, and an implementation query returns types",
    "go:card-embedded-promotion": "the list is promoted methods, not implementing types",
    "rust:def-async-trait-method": "the list is methods, not implementing types",
    "php:impl-trait-abstract": "the list is methods, not implementing types",
};

/**
 * document_symbol tasks whose lane's own language server does not pass them, although the key is
 * right by the lane's counting rule (issue #208), keyed `lane:id`. The rule counts declarations; these
 * servers also list what the rule leaves out. The key is not changed to fit the server, and a tool
 * is not scored on a question its reference answers differently, so these tasks are UNSCORABLE.
 * Decided before any tool under test was measured on document_symbol.
 */
export const DOCSYM_REFERENCE_DISAGREES = {
    "typescript:docsym-repair-order": "typescript-language-server 6.1.0 also lists object-literal keys and a local, which the counting rule leaves out (#208)",
    "javascript:docsym-repair-order": "typescript-language-server 6.1.0 also lists JSDoc @typedef properties and a local, which the counting rule leaves out (#208)",
    "javascript:docsym-report-registry": "typescript-language-server 6.1.0 also lists require bindings and module.exports entries, which the counting rule leaves out (#208)",
    "python:docsym-repair-order": "pyright 1.1.414 also lists parameters, instance attributes and locals, which the counting rule leaves out (#208)",
    "python:docsym-report-registry": "pyright 1.1.414 also lists parameters, which the counting rule leaves out (#208)",
};

/**
 * The number of entries a list task states: `exact_count`, or `extends_count` plus
 * `implements_count` where a parents task splits it. null when it states none (the list is not
 * known to be complete); undefined when the two disagree.
 */
export function listCount(expect) {
    const exact = Number.isInteger(expect.exact_count) ? expect.exact_count : null;
    const split = Number.isInteger(expect.extends_count) && Number.isInteger(expect.implements_count)
        ? expect.extends_count + expect.implements_count
        : null;
    if (exact !== null && split !== null && exact !== split) {
        return undefined;
    }
    return exact ?? split;
}

/**
 * Targets anchored on a line INSIDE the declaration they stand for, keyed `lane:id`. The needle sits
 * in the body because the declaration line is not unique in its file, or because the answer is a
 * statement (a blank import's effect is a call inside init). No line of the key names the
 * declaration, and matching by containment would pass any range that covers the anchor, one over
 * the whole file included, so these tasks are UNSCORABLE until their key anchors a line a tool can
 * return. Every other target is matched by its exact line.
 */
export const TARGET_INSIDE_SYMBOL = new Set([
    "python:def-super-cooperative",
    "go:imp-blank-import-side-effect",
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

        if (rule.check === "names") {
            if (!Array.isArray(expect.symbols) || expect.symbols.length === 0 || !expect.symbols.every((name) => typeof name === "string" && name !== "")) {
                return { scorable: false, reason: `${rule.name}: symbols is not a list of names` };
            }
            const disagreement = DOCSYM_REFERENCE_DISAGREES[`${lane}:${task.id}`];
            if (disagreement !== undefined) {
                return { scorable: false, reason: `${rule.name}: ${disagreement}` };
            }
            return { ...common, symbols: expect.symbols, allow: [] };
        }

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
            const exception = LIST_NOT_TYPES[task.id] ?? LIST_NOT_TYPES[`${lane}:${task.id}`];
            if (rule.list === "implementations" && exception !== undefined) {
                return { scorable: false, reason: `${rule.name}: ${exception}` };
            }
            const entries = list(rule.list);
            const repeated = rule.list === "known_sites" ? list("repeated_sites") : [];
            const optional = rule.neutralLists.flatMap(list);
            const wellFormed = entries.every(isFileNeedle)
                && repeated.every((group) => isFileNeedle(group) && Number.isInteger(group.lines))
                && optional.every(isFileNeedle);
            if (!wellFormed) {
                return { scorable: false, reason: `${rule.name}: the lists are not file and needle pairs` };
            }
            const count = listCount(expect);
            if (count === null) {
                return { scorable: false, reason: `${rule.name}: no count states the list is complete` };
            }
            if (count === undefined) {
                return { scorable: false, reason: `${rule.name}: exact_count disagrees with extends_count plus implements_count` };
            }
            return {
                ...common,
                entries,
                repeated,
                optional,
                noun: rule.noun,
                from: isFileNeedle(task.from) ? { file: task.from.file, needle: task.from.needle } : null,
                exactCount: count,
                allow: [],
            };
        }

        const target = rule.target(expect);
        if (!isFileNeedle(target)) {
            return { scorable: false, reason: `${rule.name}: target is not a file and needle pair` };
        }
        if (TARGET_INSIDE_SYMBOL.has(`${lane}:${task.id}`)) {
            return { scorable: false, reason: `${rule.name}: the key anchors the target inside its declaration, so no line names it; matched by containment, one range over the whole file would pass` };
        }

        return {
            ...common,
            target,
            allow: Array.isArray(expect.known_sites) ? expect.known_sites.filter(isFileNeedle) : [],
        };
    }

    return { scorable: false, reason: `no rule for surface ${task.surface} with keys ${keys.sort().join(", ")}` };
}
