// The rule table: which tasks this version of the scorer can score, and how.
//
// Semantics come from this table, never from the shape of an `expect` block. The same key means
// different things in different tasks (`exact_count` counts the declarations a list names in one
// task, a signature's parameters in another), so a task is scored only when a rule names its
// surface and its keys. Every other task is reported UNSCORABLE with the reason, and every key a
// rule does not use is listed per task as "not scored".

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
 *   asks      "name" or "member": a declaration_merge rule serves only that question (asksMergedName)
 *   allowKnownSites  for check "target": false when `known_sites` answer another question and are
 *             therefore not allowed beside the target (default true)
 *   neutralFrom  for check "sites": false when the line asked from is not neutral (default true)
 *   absent    the rule passes a task by when any of these expect keys is present
 */
export const RULES = [
    {
        // A name built from a string at run time: the answer is every declaration the string can
        // select (known_sites, exact_count of them), each by its line, and nothing else. The line
        // asked from (the getattr call) is not one of them.
        name: "definition/string-key",
        surface: "definition",
        kinds: ["string_key"],
        requires: ["known_sites", "exact_count"],
        absent: ["file", "needle", "candidate"],
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
    "python:def-overload": "the key's sources disagree on what the answer is: its note says \"the definition is the implementation, the stubs are known_sites\", the typescript task def-overload, of the same shared id, says \"A tool that lists only one overload, or the implementation only, is incomplete\", and the python lane notes say \"exact_count gives the size of the answer, and known_sites ... list it\"; so an implementation-only answer is correct under one reading and incomplete under the other, and no rule the key states separates them (pyright 1.1.414 answers the implementation and both stubs)",
    "typescript:def-method-overload": "typescript-language-server 6.1.0 (TypeScript 5.9.3) returns only the overload signature the call matches, not the implementation the key names as candidate, while the note asks for both signatures and the implementation",
    "typescript:def-overload": "the candidate is a parameter line inside the implementation signature, not the line that names it, and typescript-language-server 6.1.0 (TypeScript 5.9.3) returns only the overload signature the call matches",
    "javascript:resolution-calculate-through-binding": "no kind says whether the answer is the default binding's implementation (the candidate) or both implementations (exact_count 2), and typescript-language-server 6.1.0 (TypeScript 5.9.3) returns neither, only the @typedef property of the contract",
};

/**
 * Why no rule scores the shared id imp-glob-import (issue #135): the start of each lane's reason.
 * The lanes ask one question, and neither the servers nor the keys settle what its answer is.
 */
const GLOB_NO_READING = "imp-glob-import has no single reading: asked at the import, every lane's own server answers the module or nothing, never the lines the keys list (rust-analyzer 1.96.0 and pyright 1.1.414 the module's first line, typescript-language-server 6.1.0 its first statement, phpactor 2026.11.22.0 no location), asked at a name the import binds the servers answer that name's declaration, and the keys of this shared id disagree on the answer (go's, kind dot_import, names one member the file uses as its candidate, though the file uses more than one)";

/**
 * Key shapes no rule scores, with the reason (issue #135): a surface, an optional kind, the exact
 * set of expect keys, and the tasks (`lane:id`) the reason is true of. Matched only after every rule
 * has passed a task by, so an entry can never take a task a rule scores; a task of the same shape
 * that is not listed falls through to the generic "no rule for surface ..." reason instead of one
 * written for another lane's task. An entry whose `tasks` is not a Set matches no task.
 */
export const UNRULED_SHAPES = [
    {
        surface: "resolution",
        kind: "lane_local",
        keys: ["contains", "kind"],
        tasks: new Set(["go:lane-local-calculate", "go:lane-local-customer", "go:lane-local-dataset", "go:lane-local-formatter-billing", "go:lane-local-money", "go:lane-local-ref-prefix"]),
        reason: "kind lane_local with only `contains`: the lane notes ask that resolution land on this lane's own declaration and never a sibling lane's, but the key names no declaration and excludes no sibling lane; `contains` is defined for hover text only, and gopls v0.24.0's hover holds the string on one of the six go tasks, the one where it is the asked symbol itself",
    },
    {
        surface: "resolution",
        kind: "shadow_alias",
        keys: ["contains", "kind", "must_not_include", "resolution"],
        tasks: new Set(["go:resolution-shadowed-stdlib-package"]),
        reason: "kind shadow_alias with `contains` and no candidate: the declaration is in the Go standard library, outside the repository, so no lane-relative location names it (gopls v0.24.0 answers a GOROOT path); `contains` is defined for hover text only, and the one exclusion, app/http's own NewServeMux (router.go), only says what the answer is not: with nothing required, it alone would pass an empty answer",
    },
    {
        surface: "definition",
        keys: ["implementations"],
        tasks: new Set(["rust:def-cfg-gated"]),
        reason: "a definition asked from a Cargo.toml feature line with only `implementations`: no kind and no count say what the question returns or that the list is complete, the list holds an item the feature does not gate (one behind #[cfg(test)]), and rust-analyzer 1.96.0 answers no definition in Cargo.toml",
    },
    {
        surface: "definition",
        kind: "unresolvable_static",
        keys: ["exact_count", "kind", "known_sites"],
        tasks: new Set(["javascript:def-dynamic-require", "python:def-dynamic-import-module"]),
        reason: "kind unresolvable_static: the answer is each candidate module, and the key anchors each module on a line inside it (its SLUG line), so no line of the key names the module; a module answer lands on the file's first line (typescript-language-server 6.1.0 and pyright 1.1.414 on a static specifier), and matching by file is a mode the key does not state",
    },
    {
        surface: "import-precision",
        kind: "visibility_boundary",
        keys: ["contains", "kind", "known_sites"],
        tasks: new Set(["go:imp-internal-package"]),
        reason: "kind visibility_boundary with `contains` and one known site and no count: no source says what the question returns, known_sites with no target has no stated role (README), and `contains` is defined for hover text only; gopls v0.24.0 answers references at the package clause with three importers (cmd/atelier/main.go, tests/events_test.go, tests/structure_test.go) and the key lists one, so a rule over the list could only be recall",
    },
    {
        surface: "import-precision",
        kind: "glob",
        keys: ["exact_count", "kind", "known_sites"],
        tasks: new Set(["rust:imp-glob-import"]),
        reason: `${GLOB_NO_READING}; the rust key lists both public items of the module, so its list is complete and only the reading is open`,
    },
    {
        surface: "import-precision",
        kind: "glob",
        keys: ["exact_count", "kind", "known_sites", "must_include"],
        tasks: new Set(["python:imp-glob-import"]),
        reason: `${GLOB_NO_READING}; the python key lists 2 of the 16 names, each on its \`from .x import X\` line in metrics/__init__.py, while pyright 1.1.414 resolves a name the star import brings in to its class (metrics/margin.py), and the lane's barrel note says the same of atelier_core: an import through its __init__.py lands on the submodule that defines the name`,
    },
    {
        surface: "import-precision",
        kind: "glob",
        keys: ["exact_count", "kind", "known_sites", "must_include"],
        tasks: new Set(["typescript:imp-glob-import"]),
        reason: `${GLOB_NO_READING}; the typescript key lists 2 of the 4 exported names by line and the other 2 only by name (must_include), so no line of it states the whole answer`,
    },
    {
        surface: "import-precision",
        kind: "glob",
        keys: ["exact_count", "kind", "known_sites", "must_not_include"],
        tasks: new Set(["javascript:imp-glob-import"]),
        reason: `${GLOB_NO_READING}; the javascript key lists the four declarations of helpers.js and counts them (the lane notes: glob is \`export *\`, whose exact_count is the number of names crossing the re-export), and typescript-language-server 6.1.0 asked at from.symbol answers the module (helpers.js:3), which no line of the key names`,
    },
    {
        surface: "import-precision",
        kind: "group_use",
        keys: ["exact_count", "kind", "known_sites", "must_not_include"],
        tasks: new Set(["php:imp-glob-import"]),
        reason: `${GLOB_NO_READING}; the php key has rust's form (the eight declarations the brace group-use binds, exact_count 8; the lane's own note calls the group-use its equivalent of the glob question), and phpactor 2026.11.22.0 answers no location at the namespace asked (Repositories); what splits is the shared id, whose python, typescript and go keys read differently`,
    },
    {
        surface: "multi-parent",
        keys: ["exact_count", "must_include"],
        tasks: new Set(["rust:parents-supertrait-send-sync"]),
        reason: "parents with only `exact_count` and `must_include`: the two parents, Send and Sync, are declared in the Rust core library, outside the repository, so no lane-relative location names them (rust-analyzer 1.96.0 answers core/src/marker.rs in the toolchain, and has no type hierarchy); the key names them only in `must_include`, which no rule scores, and judging a parents answer by name is a mode no source states for this surface",
    },
    {
        surface: "implementation",
        keys: ["file", "needle"],
        tasks: new Set(["php:vendor-shouldbroadcast-contract"]),
        reason: "an implementation question whose key names the contract, not an implementor: phpactor 2026.11.22.0 answers implementation at ShouldBroadcast with six implementors (RepairCompleted and five under vendor/) and definition with the key's interface, so the key holds the definition answer on the implementation surface (the lane's other vendor targets are definition tasks)",
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
        if (rule.asks !== undefined && (rule.asks === "name") !== asksMergedName(task)) {
            continue;
        }
        if (Array.isArray(rule.absent) && rule.absent.some((key) => key in expect)) {
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

        return {
            ...common,
            target,
            allow: rule.allowKnownSites !== false && Array.isArray(expect.known_sites) ? expect.known_sites.filter(isFileNeedle) : [],
        };
    }

    const unruled = UNRULED_SHAPES.find((shape) => shape.tasks instanceof Set && shape.tasks.has(`${lane}:${task.id}`)
        && shape.surface === task.surface
        && (shape.kind === undefined || shape.kind === expect.kind)
        && shape.keys.length === keys.length
        && shape.keys.every((key) => key in expect));
    if (unruled !== undefined) {
        return { scorable: false, reason: unruled.reason };
    }
    return { scorable: false, reason: `no rule for surface ${task.surface} with keys ${keys.sort().join(", ")}` };
}
