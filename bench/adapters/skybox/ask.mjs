// How one corpus question is put to skybox, and how its reply becomes an answer. Pure: the tool
// call is passed in, so tests replay recorded replies without skybox.
//
// Two protocols, reported in separate columns:
//
// "raw" (definition, resolution, import-precision): exactly one `context(name)` call per question,
// plus one `cypher` lookup by node id to read the line of a resolved symbol (the resolved reply
// carries no line). No file hint, no kind filter, no second guess. It answers a question with the
// definition skybox resolves for the bare name. A question whose answer is a relation instead (which
// contract a type satisfies by shape, which impl block supplies a method) is not asked: the
// definition of the symbol cannot answer it, and claiming skybox cannot be asked would be false.
//
// "anchored" (hover, call_hierarchy): the `from` line is the declaration the question is about, so
// skybox is asked within that file and the node at that line is taken. See askAnchored.
//
// The adapter's own remarks go in `note`, which the scorer never reads; `text` is only what the
// tool returned as text (hover documentation and signature).

import { symbolColumns } from "../../score/lib/symbol.mjs";

/** Surfaces asked under "raw". */
export const ASKED_SURFACES = new Set(["definition", "resolution", "import-precision"]);

/** Surfaces asked under "anchored". */
export const ANCHORED_SURFACES = new Set(["hover", "call_hierarchy", "references", "implementation", "cardinality", "multi-parent"]);

/** Kinds whose answer is a relation of the symbol, not its definition. Not asked under "raw". */
/**
 * Questions whose answer is a relation of the symbol, not its definition, keyed `surface:kind`. Not
 * asked under "raw". Keyed by surface too: python `def-super-cooperative` is a `definition` task of
 * kind `mro`, and its answer is a definition, so it is asked.
 */
export const RELATION_QUESTIONS = new Set([
    "resolution:structural",
    "resolution:init_order",
    "resolution:mro",
    "resolution:derive_generated",
    "resolution:dyn_upcast",
    "resolution:blanket_impl",
    // An import that binds a namespace or a whole package: the answer is the member read through
    // it (or reached by it), not the definition of the module or namespace the symbol names.
    "import-precision:namespace_import",
    "import-precision:namespace_prefix",
    "import-precision:one_member",
    "import-precision:dot_import",
    "import-precision:side_effect_only",
    "import-precision:no_fanout",
]);

const NOT_FOUND = /^Symbol not found in index/m;
const AMBIGUOUS = /^Ambiguous: (\d+) symbols? match\. Candidates:\s*$/m;

/** Is this tool text one of skybox's negative answers, which it flags as errors? */
export function isNegativeAnswer(text) {
    return NOT_FOUND.test(text) || AMBIGUOUS.test(text);
}

/**
 * Is the symbol, at its stated occurrence, inside a quoted string that holds a path? Then it is a
 * path segment of an import (go `"atelier.example/lane/core/models"`), which no name lookup can take.
 * Occurrences are whole identifiers, as `from.occurrence` counts them.
 */
export function isPathSegment(text, symbol, occurrence = 1) {
    const at = symbolColumns(text, symbol)[occurrence - 1];
    if (at === undefined) {
        return false;
    }
    for (const quote of ['"', "'", "`"]) {
        const open = text.lastIndexOf(quote, at);
        const close = text.indexOf(quote, at + symbol.length);
        if (open !== -1 && close !== -1 && text.slice(open, close).includes("/")) {
            return true;
        }
    }
    return false;
}

/**
 * Locations in a total order, so two runs over the same index write the same answer file: by file,
 * then line, then end line (a location without one sorts first).
 */
function byFileAndLine(left, right) {
    if (left.file !== right.file) {
        return left.file < right.file ? -1 : 1;
    }
    return left.line - right.line || (left.end_line ?? 0) - (right.end_line ?? 0);
}

/**
 * Parse a `context` reply. Returns one of:
 *   { kind: "not-found" }
 *   { kind: "ambiguous", candidates: [{ id, file, startLine, endLine }] }   file or lines may be null
 *   { kind: "resolved", id }
 *   { kind: "unknown", text }
 */
export function parseContextReply(text) {
    if (NOT_FOUND.test(text)) {
        return { kind: "not-found" };
    }

    const ambiguous = text.match(AMBIGUOUS);
    if (ambiguous) {
        const after = text.slice(ambiguous.index + ambiguous[0].length).split("\n");
        const candidates = [];
        for (const row of after) {
            if (row.trim() === "") {
                if (candidates.length > 0) {
                    break;
                }
                continue;
            }
            // id, name, kind, filePath, startLine, endLine  (the id itself never holds ", ")
            const cells = row.split(", ");
            if (cells.length < 6) {
                break;
            }
            const [startLine, endLine] = cells.slice(-2).map((cell) => (/^\d+$/.test(cell.trim()) ? Number(cell.trim()) : null));
            const file = cells[cells.length - 3].trim() || null;
            candidates.push({ id: cells[0].trim(), file, startLine, endLine });
        }
        return { kind: "ambiguous", expected: Number(ambiguous[1]), candidates };
    }

    try {
        const json = JSON.parse(text.split("\n---\n")[0]);
        if (json && typeof json.id === "string") {
            return { kind: "resolved", id: json.id };
        }
    } catch {
        // fall through
    }
    return { kind: "unknown", text: text.slice(0, 300) };
}

/** Parse the one-row markdown table a `cypher` lookup by id returns into { file, startLine, endLine }. */
export function parseCypherRow(text) {
    const rows = parseCypherRows(text);
    if (rows.length === 0) {
        return null;
    }
    const [file, start, end] = rows[0];
    const startLine = /^\d+$/.test(start ?? "") ? Number(start) : null;
    const endLine = /^\d+$/.test(end ?? "") ? Number(end) : null;
    return { file: file || null, startLine, endLine };
}

/** Every data row of a `cypher` markdown table, as arrays of trimmed cells (header row dropped). */
export function parseCypherRows(text) {
    const rows = text.split("\n").filter((line) => line.startsWith("|") && !line.startsWith("| ---"));
    return rows.slice(1).map((row) => row.split("|").slice(1, -1).map((cell) => cell.trim()));
}

/** The value of a one-column `cypher` result, read whole so a `|` inside it does not split it. */
export function parseCypherValue(text) {
    // A cell can span lines (a doc comment keeps its newlines), so the value runs from the row after
    // the separator to the "*n row(s)*" footer, not to the end of one line.
    const lines = text.split("\n");
    const separator = lines.findIndex((entry) => entry.startsWith("| ---"));
    if (separator < 0) {
        return null;
    }
    const footer = lines.findIndex((entry, index) => index > separator && /^\*\d+ row\(s\)\*$/.test(entry));
    const body = lines.slice(separator + 1, footer < 0 ? lines.length : footer);
    while (body.length > 0 && body[body.length - 1].trim() === "") {
        body.pop();
    }
    if (body.length === 0) {
        return null;
    }
    const value = body.join("\n").replace(/^\|\s?/, "").replace(/\s?\|$/, "").trim();
    return value === "" || value === "null" ? null : value;
}

/**
 * The name skybox indexes a symbol under. A php variable or property is written with its `$` sigil
 * (`from.symbol` is the identifier as written on the line), and skybox names its node without it
 * (`Property:StatusBoard:statusFilter:...`). Dropping the sigil is skybox's own naming, not a hint.
 */
export function nameInIndex(symbol) {
    return symbol.startsWith("$") && symbol.length > 1 ? symbol.slice(1) : symbol;
}

function cypherString(value) {
    return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function locationOf(file, startLine, endLine) {
    return { file, line: startLine, ...(endLine && endLine >= startLine ? { end_line: endLine } : {}) };
}

/** Locations from `cypher` rows of [file, startLine, endLine]; rows without a line are counted. */
function locationsOfRows(rows) {
    const located = [];
    let unlocated = 0;
    for (const [file, start, end] of rows) {
        const startLine = /^\d+$/.test(start ?? "") ? Number(start) : null;
        const endLine = /^\d+$/.test(end ?? "") ? Number(end) : null;
        if (file && file !== "null" && startLine) {
            located.push(locationOf(file, startLine, endLine));
        } else {
            unlocated += 1;
        }
    }
    return { locations: located.sort(byFileAndLine), unlocated };
}

/** Run one tool call; a flagged result that is not one of skybox's negative answers becomes an error. */
async function ask(call, tool, args) {
    const result = await call(tool, args);
    if (result.isError && !(tool === "context" && isNegativeAnswer(result.text))) {
        throw new Error(`${tool} reported an error: ${result.text.slice(0, 300)}`);
    }
    return result.text;
}

/**
 * Ask skybox one question. `call(tool, args)` returns `{ text, isError }` as the server sent it, or
 * throws on a transport failure. skybox flags its negative answers ("not found", "ambiguous") as
 * errors; this module decides what a flagged result means, so the rule is tested here.
 * Returns an answer in the corpus answer format, or undefined when this adapter does not ask the
 * question (the task is then left unanswered, which is the honest record).
 */
export async function askSkybox(question, call) {
    try {
        if (ANCHORED_SURFACES.has(question.surface)) {
            return await askAnchored(question, call);
        }
        return await askRaw(question, call);
    } catch (error) {
        return { status: "error", detail: error.message };
    }
}

/**
 * Protocol "raw" (definition, resolution, import-precision): one `context(name)` by bare name, plus one
 * `cypher` lookup by node id for the line of a resolved symbol.
 */
async function askRaw(question, call) {
    if (!ASKED_SURFACES.has(question.surface) || RELATION_QUESTIONS.has(`${question.surface}:${question.kind}`)) {
        return undefined;
    }

    const { symbol, occurrence } = question.from;
    if (symbol === null) {
        return { status: "unsupported", detail: "the question has no single identifier, and skybox is asked by name" };
    }
    if (typeof symbol !== "string") {
        return undefined;
    }
    // An import path segment is not asked under "raw": a name lookup cannot take a path, but skybox
    // has import edges, so calling it unsupported would be false.
    if (isPathSegment(question.from.text, symbol, occurrence ?? 1)) {
        return undefined;
    }

    const reply = parseContextReply(await ask(call, "context", { name: nameInIndex(symbol) }));

    if (reply.kind === "not-found") {
        return { locations: [], note: "Symbol not found in index" };
    }

    if (reply.kind === "ambiguous") {
        if (reply.candidates.length !== reply.expected) {
            return { status: "error", detail: `ambiguous reply announced ${reply.expected} candidates, ${reply.candidates.length} parsed` };
        }
        const located = reply.candidates.filter((candidate) => candidate.file && candidate.startLine);
        return {
            locations: located.map((candidate) => locationOf(candidate.file, candidate.startLine, candidate.endLine)).sort(byFileAndLine),
            unlocated: reply.candidates.length - located.length,
            note: `ambiguous: ${reply.candidates.length} candidates`,
        };
    }

    if (reply.kind === "resolved") {
        const row = parseCypherRow(await ask(call, "cypher", {
            query: `MATCH (n) WHERE n.id = ${cypherString(reply.id)} RETURN n.filePath, n.startLine, n.endLine`,
        }));
        if (!row || !row.file || !row.startLine) {
            return { locations: [], unlocated: 1, note: `resolved to ${reply.id}, which has no file and line` };
        }
        return { locations: [locationOf(row.file, row.startLine, row.endLine)], note: `resolved to ${reply.id}` };
    }

    return { status: "error", detail: `unrecognised context reply: ${reply.text}` };
}

/**
 * Protocol "anchored" (hover, call_hierarchy). The question is asked from a line in a file, and both
 * are part of the question, not the answer:
 *
 *   1. `context(name, file_path: from.file)`. If one node comes back, it is the subject. If several
 *      come back, the one that starts at the `from` line (or, failing that, the smallest whose range
 *      covers it) is the subject; none there means no result.
 *   2. If the file declares no such name, the `from` line is a use site of something declared
 *      elsewhere: `context(name)` without the file. One node is the subject; several mean no
 *      result, as under "raw".
 *
 * Then one `cypher` call per needed fact, by node id: the documentation and the signature for hover;
 * for the other surfaces the subject's own range (it must cover the `from` line, which those keys
 * put on the subject's declaration), then its edges: CALLS in the asked direction for
 * call_hierarchy, each with its node's range; CALLS and USES into it for references, each at its
 * call-site line when the edge has one; IMPLEMENTS and EXTENDS into it at any depth for
 * implementation and cardinality, and out of it for multi-parent, each at its node's declaration.
 * The note says which step found the subject.
 */
async function askAnchored(question, call) {
    const { symbol, file, line } = question.from;
    if (symbol === null) {
        return { status: "unsupported", detail: "the question has no single identifier, and skybox is asked by name" };
    }
    if (typeof symbol !== "string") {
        return undefined;
    }
    if (question.surface === "call_hierarchy" && question.direction !== "callers" && question.direction !== "callees") {
        return undefined;
    }
    const empty = question.surface === "hover" ? { text: "" } : { locations: [] };

    let reply = parseContextReply(await ask(call, "context", { name: nameInIndex(symbol), file_path: file }));
    let usedFile = true;
    if (reply.kind === "not-found") {
        reply = parseContextReply(await ask(call, "context", { name: nameInIndex(symbol) }));
        usedFile = false;
        if (reply.kind === "not-found") {
            return { ...empty, note: "Symbol not found in index" };
        }
    }

    const how = usedFile ? `anchored in ${file} to` : `${file} declares no ${symbol}; resolved by name to`;
    let ids;
    if (reply.kind === "ambiguous") {
        if (!usedFile) {
            return { ...empty, note: `ambiguous: ${reply.candidates.length} candidates, none declared in ${file}` };
        }
        const inFile = reply.candidates.filter((candidate) => candidate.file === file && candidate.startLine);
        // skybox can model one declaration as several nodes (a JSX component and its function):
        // every node that starts at the from line is the subject, taken in id order so runs agree.
        const starting = inFile.filter((candidate) => candidate.startLine === line).map((candidate) => candidate.id).sort();
        const covering = inFile
            .filter((candidate) => candidate.startLine <= line && line <= (candidate.endLine ?? candidate.startLine))
            .sort((left, right) => ((left.endLine ?? left.startLine) - left.startLine) - ((right.endLine ?? right.startLine) - right.startLine))[0];
        ids = starting.length > 0 ? starting : covering ? [covering.id] : [];
        if (ids.length === 0) {
            return { ...empty, note: `ambiguous: ${reply.candidates.length} candidates, none at ${file}:${line}` };
        }
    } else if (reply.kind === "resolved") {
        ids = [reply.id];
    } else {
        return { status: "error", detail: `unrecognised context reply: ${reply.text}` };
    }
    const named = ids.join(" + ");

    if (question.surface === "hover") {
        const parts = [];
        for (const id of ids) {
            parts.push(parseCypherValue(await ask(call, "cypher", { query: `MATCH (n) WHERE n.id = ${cypherString(id)} RETURN n.description` })));
            parts.push(parseCypherValue(await ask(call, "cypher", { query: `MATCH (n) WHERE n.id = ${cypherString(id)} RETURN n.signature` })));
        }
        return { text: parts.filter(Boolean).join("\n"), note: `${how} ${named}` };
    }

    // Every call_hierarchy, references and implementation-family key is asked from its subject's
    // declaration line, so a node that does not cover that line is another declaration of that name.
    const rows = [];
    for (const id of ids) {
        const row = parseCypherRow(await ask(call, "cypher", {
            query: `MATCH (n) WHERE n.id = ${cypherString(id)} RETURN n.filePath, n.startLine, n.endLine`,
        }));
        if (!row || row.file !== file || !row.startLine || line < row.startLine || line > (row.endLine ?? row.startLine)) {
            return { ...empty, note: `${how} ${id}, which is not at ${file}:${line}` };
        }
        rows.push(...await edgeRows(question, id, call));
    }
    const { locations, unlocated } = locationsOfRows(rows);
    return { locations, ...(unlocated > 0 ? { unlocated } : {}), note: `${how} ${named}, ${ASKED_EDGES[question.surface] ?? question.direction}` };
}

/** What each anchored list surface asks of the subject's edges, for the note. */
const ASKED_EDGES = {
    references: "CALLS and USES edges",
    implementation: "IMPLEMENTS and EXTENDS edges into it at any depth",
    cardinality: "IMPLEMENTS and EXTENDS edges into it at any depth",
    "multi-parent": "its own IMPLEMENTS and EXTENDS edges",
};

/** The [file, line, endLine] rows one subject node answers with, by surface. */
async function edgeRows(question, id, call) {
    const subject = cypherString(id);
    switch (question.surface) {
        case "references": {
            // skybox 0.9.0 records a use of a symbol as an edge into its node: CALLS (one per call
            // site, always with the site's line) and USES (php and go without a line, rust with one
            // on about half). An edge with a line is answered at that line; one without, with the
            // using declaration's range, which is what the tool returned.
            const edges = parseCypherRows(await ask(call, "cypher", {
                query: `MATCH (c)-[r:CodeRelation]->(t) WHERE t.id = ${subject} AND (r.type = 'CALLS' OR r.type = 'USES') RETURN c.filePath, r.callSiteLine, c.startLine, c.endLine`,
            }));
            return edges.map(([path, site, start, end]) => (/^\d+$/.test(site ?? "") ? [path, site, ""] : [path, start, end]));
        }
        case "implementation":
        case "cardinality":
            // Every implementor at any depth (the lane READMEs count concrete implementors through
            // abstract bases): nodes that reach the subject by IMPLEMENTS or EXTENDS edges only, up
            // to 10 steps, each at its own declaration.
            return parseCypherRows(await ask(call, "cypher", {
                query: `MATCH (c)-[r:CodeRelation*1..10 (e, n | WHERE e.type = 'IMPLEMENTS' OR e.type = 'EXTENDS')]->(t) WHERE t.id = ${subject} RETURN DISTINCT c.filePath, c.startLine, c.endLine`,
            }));
        case "multi-parent":
            // The direct parents: the subject's own IMPLEMENTS and EXTENDS edges.
            return parseCypherRows(await ask(call, "cypher", {
                query: `MATCH (s)-[r:CodeRelation]->(p) WHERE s.id = ${subject} AND (r.type = 'IMPLEMENTS' OR r.type = 'EXTENDS') RETURN p.filePath, p.startLine, p.endLine`,
            }));
        default: {
            const query = question.direction === "callers"
                ? `MATCH (c)-[r:CodeRelation]->(t) WHERE t.id = ${subject} AND r.type = 'CALLS' RETURN c.filePath, c.startLine, c.endLine`
                : `MATCH (s)-[r:CodeRelation]->(c) WHERE s.id = ${subject} AND r.type = 'CALLS' RETURN c.filePath, c.startLine, c.endLine`;
            return parseCypherRows(await ask(call, "cypher", { query }));
        }
    }
}
