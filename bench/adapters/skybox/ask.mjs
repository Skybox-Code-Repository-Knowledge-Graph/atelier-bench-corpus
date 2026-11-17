// How one corpus question is put to skybox, and how its reply becomes an answer. Pure: the tool
// call is passed in, so tests replay recorded replies without skybox.
//
// Protocol "raw": exactly one `context(name)` call per question, plus one `cypher` lookup by node id
// to read the line of a resolved symbol (the resolved reply carries no line). Nothing else: no file
// hint, no kind filter, no second guess. What skybox returns is what is scored.

/** Surfaces this adapter asks. Every other surface is left unanswered. */
export const ASKED_SURFACES = new Set(["definition", "resolution", "import-precision"]);

const NOT_FOUND = /^Symbol not found in index/m;
const AMBIGUOUS = /^Ambiguous: (\d+) symbols? match\. Candidates:\s*$/m;

/**
 * Is the symbol, at its stated occurrence, inside a quoted string that holds a path? Then it is a
 * path segment of an import (go `"atelier.example/lane/core/models"`), which no name lookup can take.
 */
export function isPathSegment(text, symbol, occurrence = 1) {
    let at = -1;
    for (let seen = 0; seen < occurrence; seen += 1) {
        at = text.indexOf(symbol, at + 1);
        if (at === -1) {
            return false;
        }
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
 * Ask skybox one question. `call(tool, args)` returns the tool's text or throws.
 * Returns an answer in the corpus answer format, or undefined when this adapter does not ask the
 * question (the task is then left unanswered, which is the honest record).
 */
export async function askSkybox(question, call) {
    if (!ASKED_SURFACES.has(question.surface)) {
        return undefined;
    }

    const { symbol, occurrence } = question.from;
    if (symbol === null) {
        return { status: "unsupported", detail: "the question has no single identifier, and skybox is asked by name" };
    }
    if (typeof symbol !== "string") {
        return undefined;
    }
    if (isPathSegment(question.from.text, symbol, occurrence ?? 1)) {
        return { status: "unsupported", detail: "the symbol is a segment of an import path, which a name lookup cannot take" };
    }

    let reply;
    try {
        reply = parseContextReply(await call("context", { name: symbol }));
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
            })),
            unlocated: reply.candidates.length - located.length,
            text: `ambiguous: ${reply.candidates.length} candidates`,
        };
    }

    if (reply.kind === "resolved") {
        let row;
        try {
            row = parseCypherRow(await call("cypher", {
                query: `MATCH (n) WHERE n.id = ${cypherString(reply.id)} RETURN n.filePath, n.startLine, n.endLine`,
            }));
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
