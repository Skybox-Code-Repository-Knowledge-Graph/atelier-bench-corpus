// How one corpus question is put to skybox, and how its reply becomes an answer. Pure: the tool
// call is passed in, so tests replay recorded replies without skybox.
//
// Protocol "raw": exactly one `context(name)` call per question, plus one `cypher` lookup by node id
// to read the line of a resolved symbol (the resolved reply carries no line). Nothing else: no file
// hint, no kind filter, no second guess. What skybox returns is what is scored.
//
// The raw protocol answers a question with the definition skybox resolves for the symbol. A
// question whose answer is a relation instead (which contract a type satisfies by shape, which
// impl block supplies a method) is not asked: the definition of the symbol cannot answer it, and
// claiming skybox cannot be asked would be false. Those tasks stay unanswered.

import { symbolColumns } from "../../score/lib/symbol.mjs";

/** Surfaces this adapter asks. Every other surface is left unanswered. */
export const ASKED_SURFACES = new Set(["definition", "resolution", "import-precision"]);

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
    const rows = text.split("\n").filter((line) => line.startsWith("|") && !line.startsWith("| ---"));
    if (rows.length < 2) {
        return null;
    }
    const cells = rows[1].split("|").slice(1, -1).map((cell) => cell.trim());
    const [file, start, end] = cells;
    const startLine = /^\d+$/.test(start ?? "") ? Number(start) : null;
    const endLine = /^\d+$/.test(end ?? "") ? Number(end) : null;
    return { file: file || null, startLine, endLine };
}

function cypherString(value) {
    return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

/**
 * Ask skybox one question. `call(tool, args)` returns `{ text, isError }` as the server sent it, or
 * throws on a transport failure. skybox flags its negative answers ("not found", "ambiguous") as
 * errors; this function decides what a flagged result means, so the rule is tested here.
 * Returns an answer in the corpus answer format, or undefined when this adapter does not ask the
 * question (the task is then left unanswered, which is the honest record).
 */
export async function askSkybox(question, call) {
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

    let reply;
    try {
        const result = await call("context", { name: symbol });
        if (result.isError && !isNegativeAnswer(result.text)) {
            return { status: "error", detail: `context reported an error: ${result.text.slice(0, 300)}` };
        }
        reply = parseContextReply(result.text);
    } catch (error) {
        return { status: "error", detail: `context: ${error.message}` };
    }

    if (reply.kind === "not-found") {
        return { locations: [], text: "Symbol not found in index" };
    }

    if (reply.kind === "ambiguous") {
        if (reply.candidates.length !== reply.expected) {
            return { status: "error", detail: `ambiguous reply announced ${reply.expected} candidates, ${reply.candidates.length} parsed` };
        }
        const located = reply.candidates.filter((candidate) => candidate.file && candidate.startLine);
        return {
            locations: located.map((candidate) => ({
                file: candidate.file,
                line: candidate.startLine,
                ...(candidate.endLine && candidate.endLine >= candidate.startLine ? { end_line: candidate.endLine } : {}),
            })).sort(byFileAndLine),
            unlocated: reply.candidates.length - located.length,
            text: `ambiguous: ${reply.candidates.length} candidates`,
        };
    }

    if (reply.kind === "resolved") {
        let row;
        try {
            const result = await call("cypher", {
                query: `MATCH (n) WHERE n.id = ${cypherString(reply.id)} RETURN n.filePath, n.startLine, n.endLine`,
            });
            if (result.isError) {
                return { status: "error", detail: `cypher reported an error: ${result.text.slice(0, 300)}` };
            }
            row = parseCypherRow(result.text);
        } catch (error) {
            return { status: "error", detail: `cypher: ${error.message}` };
        }
        if (!row || !row.file || !row.startLine) {
            return { locations: [], unlocated: 1, text: `resolved to ${reply.id}, which has no file and line` };
        }
        return {
            locations: [{ file: row.file, line: row.startLine, ...(row.endLine && row.endLine >= row.startLine ? { end_line: row.endLine } : {}) }],
            text: `resolved to ${reply.id}`,
        };
    }

    return { status: "error", detail: `unrecognised context reply: ${reply.text}` };
}
