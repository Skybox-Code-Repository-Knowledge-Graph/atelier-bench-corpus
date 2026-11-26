// The rule table: which tasks this version of the scorer can score, and how.
//
// Semantics come from this table, never from the shape of an `expect` block. The same key means
// different things in different tasks (`exact_count` is an overload count in one task, a parameter
// count in another), so a task is scored only when a rule names its surface and its keys. Every
// other task is reported UNSCORABLE with the reason, and every key a rule does not use is listed
// per task as "not scored".

import { isFileNeedle } from "./resolve.mjs";
import { symbolColumns } from "./symbol.mjs";

export const LANES = ["php", "rust", "typescript", "javascript", "python", "go"];

/** Descriptive keys. They label a task; no rule ever scores them and they are not reported. */
export const LABEL_KEYS = new Set(["kind", "resolution"]);

/** Kinds no single-target rule can score, with the reason. A task of such a kind is UNSCORABLE. */
export const KIND_UNSCORABLE = {
    build_generated: "the key names two places, the include! line and the build.rs function",
};

/**
 * Kinds that are UNSCORABLE on one surface only, keyed `surface:kind`. The same kind may be scored
 * (or asked) on another surface, so it is not in KIND_UNSCORABLE.
 */
export const SURFACE_KIND_UNSCORABLE = {
    "direction:mro": "the answer is an order (the method resolution order), which no list rule judges",
    "direction:inherent_impl": "the key requires nothing, it only excludes; a tool that returns nothing would pass",
    "resolution:arity": "exact_count is the signature's parameter count, which no answer field carries; the candidate is the declaration asked from, so a location alone would pass an answer that returns the question",
};

const candidate = (expect) => expect.candidate;
const fileAndNeedle = (expect) => ({ file: expect.file, needle: expect.needle });

/**
 * Kind-less tasks whose `exact_count` beside a target counts the overload signatures the key lists
 * as `known_sites`, keyed `lane:id`. The task's own note says so ("the definition is the
 * implementation, the stubs are known_sites"), and the lane's language server answers the target
 * with the signatures beside it. Other kind-less counts beside a target stay UNSCORABLE.
 */
export const OVERLOAD_COUNT = new Set(["python:def-overload"]);

/**
 * Does a `declaration_merge` task ask about the merged name itself, rather than a member? The lane
 * notes: "the name resolves to both declarations, a member resolves to the half that declares it".
 * The asked symbol is the merged name when it is written on every declaration the key lists.
 */
export function asksMergedName(task) {
    const symbol = task?.from?.symbol;
    const sites = Array.isArray(task?.expect?.known_sites) ? task.expect.known_sites : [];
    return typeof symbol === "string"
        && sites.length > 0
        && sites.every((site) => isFileNeedle(site) && symbolColumns(site.needle, symbol).length > 0);
}

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
 *
 * Optional selectors and switches, for rules that serve one meaning of a shared key shape:
 *
 *   kinds     the rule serves only tasks of these `kind`s
 *   tasks     the rule serves only these tasks, keyed `lane:id` (a kind-less key whose meaning a
 *             task's own note settles)
 *   asks      "name" or "member": a declaration_merge rule serves only that question (asksMergedName)
 *   countOf   for check "target": `exact_count` must equal the length of this list, or UNSCORABLE
 *   allowKnownSites  for check "target": false when `known_sites` answer another question and are
 *             therefore not allowed beside the target (default true)
 *   neutralFrom  for check "sites": false when the line asked from is not neutral (default true)
 */
export const RULES = [
    {
        // Overload signatures beside the implementation: the implementation is the target, each
        // signature may be returned beside it, and exact_count counts the signatures.
        name: "definition/overloads",
        surface: "definition",
        tasks: OVERLOAD_COUNT,
        requires: ["file", "needle", "known_sites", "exact_count"],
        forbids: [],
        check: "target",
        class: "exact",
        target: fileAndNeedle,
        countOf: "known_sites",
        uses: ["file", "needle", "known_sites", "exact_count", "must_not_include"],
    },
    {
        // Asked about a merged name: the answer is every declaration of it (known_sites, exact_count).
        // The candidate is a member of one half, which this question does not ask about.
        name: "resolution/merged-name",
        surface: "resolution",
        kinds: ["declaration_merge"],
        asks: "name",
        requires: ["known_sites", "exact_count"],
        forbids: [],
        check: "sites",
        class: "exact",
        list: "known_sites",
        neutralLists: ["optional_sites"],
        neutralFrom: false,
        noun: "declaration",
        uses: ["known_sites", "exact_count", "optional_sites", "must_not_include"],
    },
    {
        // Asked about a member of a merged name: the answer is the half that declares it (the
        // candidate). known_sites and exact_count are the merged name's declarations, another question.
        name: "resolution/merged-member",
        surface: "resolution",
        kinds: ["declaration_merge"],
        asks: "member",
        requires: ["candidate"],
        forbids: [],
        check: "target",
        class: "exact",
        target: candidate,
        allowKnownSites: false,
        uses: ["candidate", "must_not_include"],
    },
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
    {
        // A fixture broken on purpose: asked about it, the tool must report that parsing it failed.
        name: "parse-negative/reported",
        surface: "parse-negative",
        kinds: ["syntax_error"],
        requires: [],
        forbids: [],
        check: "parse",
        class: "behaviour",
        uses: [],
    },
    {
        // Asked about a broken file, the tool must degrade loudly: report the parse failure, never
        // crash (a harness ERROR) and never answer silently empty.
        name: "diagnostics/loud",
        surface: "diagnostics",
        requires: ["behavior"],
        forbids: [],
        check: "parse",
        class: "behaviour",
        uses: ["behavior"],
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
    {
        // The key names one member of a set it does not list: the candidate must be returned when
        // the asked direction is asked, and must not be when the opposite direction is asked.
        name: "direction/two-sided",
        surface: "direction",
        kinds: ["parent_of", "child_of", "used_by", "uses_self"],
        requires: [],
        forbids: [],
        check: "twoSided",
        class: "recall",
        target: (expect) => expect.candidate ?? (expect.file !== undefined ? fileAndNeedle(expect) : undefined),
        uses: ["candidate", "file", "needle", "must_not_include"],
    },
    {
        name: "direction/list",
        surface: "direction",
        kinds: ["declaration_merge"],
        requires: ["known_sites", "exact_count"],
        forbids: [],
        check: "sites",
        class: "exact",
        list: "known_sites",
        neutralLists: ["optional_sites"],
        noun: "declaration",
        uses: ["known_sites", "exact_count", "optional_sites", "must_not_include"],
    },
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
    "javascript:docsym-repair-order": "typescript-language-server 6.1.0 also lists object-literal keys and a local, which the counting rule leaves out (#208)",
    "javascript:docsym-report-registry": "typescript-language-server 6.1.0 also lists require bindings and module.exports entries, which the counting rule leaves out (#208)",
    "python:docsym-repair-order": "pyright 1.1.414 also lists parameters, instance attributes and locals, which the counting rule leaves out (#208)",
    "python:docsym-report-registry": "pyright 1.1.414 also lists parameters, which the counting rule leaves out (#208)",
};

/**
 * Kind-less tasks with `exact_count` beside a target that no rule scores, keyed `lane:id`, with the
 * reason (issue #135). Their notes or their lane's own language server leave the answer unsettled,
 * and the key is not changed to fit a rule. Decided before any tool under test was measured on them.
 */
export const TARGET_COUNT_UNSCORABLE = {
    "typescript:def-method-overload": "typescript-language-server 6.1.0 (TypeScript 5.9.3) returns only the overload signature the call matches, not the implementation the key names as candidate, while the note asks for both signatures and the implementation",
    "typescript:def-overload": "the candidate is a parameter line inside the implementation signature, not the line that names it, and typescript-language-server 6.1.0 (TypeScript 5.9.3) returns only the overload signature the call matches",
    "javascript:resolution-calculate-through-binding": "no kind says whether the answer is the default binding's implementation (the candidate) or both implementations (exact_count 2), and typescript-language-server 6.1.0 (TypeScript 5.9.3) returns neither, only the @typedef property of the contract",
};

/**
 * Key shapes no rule scores, with the reason (issue #135): a surface, an optional kind, and the exact
 * set of expect keys. Matched only after every rule has passed a task by, so an entry can never take
 * a task a rule scores; it replaces "no rule for surface ..." with why there is none.
 */
export const UNRULED_SHAPES = [
    {
        surface: "resolution",
        kind: "lane_local",
        keys: ["contains", "kind"],
        reason: "kind lane_local with only `contains`: the lane notes ask that resolution land on this lane's own declaration and never a sibling lane's, but the key names no declaration and excludes no sibling lane; `contains` is defined for hover text only, and gopls v0.24.0's hover holds the string on one of the six go tasks, the one where it is the asked symbol itself",
    },
    {
        surface: "resolution",
        kind: "shadow_alias",
        keys: ["contains", "kind", "must_not_include", "resolution"],
        reason: "kind shadow_alias with `contains` and no candidate: the declaration is in the Go standard library, outside the repository, so no lane-relative location names it (gopls v0.24.0 answers a GOROOT path); `contains` is defined for hover text only, and the one exclusion can trip only on the line asked from, so it alone would pass an empty answer",
    },
];

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

    if (typeof expect.kind === "string" && Object.hasOwn(KIND_UNSCORABLE, expect.kind)) {
        return { scorable: false, reason: `kind ${expect.kind}: ${KIND_UNSCORABLE[expect.kind]}` };
    }
    const surfaceKind = `${task.surface}:${expect.kind}`;
    if (Object.hasOwn(SURFACE_KIND_UNSCORABLE, surfaceKind)) {
        return { scorable: false, reason: `kind ${expect.kind}: ${SURFACE_KIND_UNSCORABLE[surfaceKind]}` };
    }
    const unsettled = TARGET_COUNT_UNSCORABLE[`${lane}:${task.id}`];
    if (unsettled !== undefined) {
        return { scorable: false, reason: `exact_count beside a target: ${unsettled}` };
    }

    for (const rule of candidates) {
        if (Array.isArray(rule.kinds) && !rule.kinds.includes(expect.kind)) {
            continue;
        }
        if (rule.tasks instanceof Set && !rule.tasks.has(`${lane}:${task.id}`)) {
            continue;
        }
        if (rule.asks !== undefined && (rule.asks === "name") !== asksMergedName(task)) {
            continue;
        }
        if (!rule.requires.every((key) => key in expect)) {
            continue;
        }

        const blocked = rule.forbids.filter((key) => key in expect);
        if (blocked.length > 0) {
            const why = rule.forbidReason ?? `target plus ${blocked.join(", ")}: meaning depends on kind`;
            return { scorable: false, reason: rule.forbidReason ? `${blocked.join(", ")}: ${why}` : why };
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

        if (rule.check === "parse") {
            if (!isFileNeedle(task.from)) {
                return { scorable: false, reason: `${rule.name}: the task names no file` };
            }
            return { ...common, file: task.from.file, allow: [] };
        }

        if (rule.check === "twoSided") {
            const target = rule.target(expect);
            if (!isFileNeedle(target)) {
                return { scorable: false, reason: `${rule.name}: no candidate file and needle pair` };
            }
            return { ...common, target, entries: [target], allow: [] };
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
                from: rule.neutralFrom !== false && isFileNeedle(task.from) ? { file: task.from.file, needle: task.from.needle } : null,
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

        if (rule.countOf !== undefined) {
            const listed = Array.isArray(expect[rule.countOf]) ? expect[rule.countOf].length : 0;
            if (expect.exact_count !== listed) {
                return { scorable: false, reason: `${rule.name}: exact_count ${expect.exact_count}, but the key lists ${listed} in ${rule.countOf}` };
            }
        }

        return {
            ...common,
            target,
            allow: rule.allowKnownSites !== false && Array.isArray(expect.known_sites) ? expect.known_sites.filter(isFileNeedle) : [],
        };
    }

    const unruled = UNRULED_SHAPES.find((shape) => shape.surface === task.surface
        && (shape.kind === undefined || shape.kind === expect.kind)
        && shape.keys.length === keys.length
        && shape.keys.every((key) => key in expect));
    if (unruled !== undefined) {
        return { scorable: false, reason: unruled.reason };
    }
    return { scorable: false, reason: `no rule for surface ${task.surface} with keys ${keys.sort().join(", ")}` };
}
