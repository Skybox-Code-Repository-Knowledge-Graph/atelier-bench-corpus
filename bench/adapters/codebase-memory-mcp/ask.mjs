// How one corpus question is put to codebase-memory-mcp (cbm), and how its reply becomes an answer.
// Pure: the tool call is passed in, so tests replay recorded replies without cbm.
//
// Protocols, reported in separate columns:
//
// "raw" (definition, resolution, import-precision): exactly one `search_graph` call per question,
// `name_pattern` = the task's `from.symbol` as an anchored exact-name regex. No file hint, no label
// filter, no second guess. Every node cbm returns for that bare name is an answer location (its
// reply carries the start and end line, so no second call is needed). A name that is not unique in
// the lane is answered with every node of that name: that is what lookup by bare name measures.
//
// "file" (document_symbol): one `get_file_outline` call for the asked file; every row it lists, in
// the order cbm lists them (by start line, then name).
//
// behaviour (parse-negative, diagnostics): no per-question call. cbm reports files it parsed
// partially in the reply of `index_repository` (`parse_partial`); that report is read once by the
// runner and handed in as `parseErrors`. An asked file is answered with the entries for it, which
// is none when cbm did not flag it.
//
// `anchored` surfaces (hover, call_hierarchy, references, implementation, ...) are not asked: that
// protocol is not implemented for this adapter yet, so they are left out and score UNANSWERED.
//
// The adapter's own remarks go in `note`, which the scorer never reads.

import { isPathSegment, RELATION_QUESTIONS, ASKED_SURFACES, FILE_SURFACES, BEHAVIOUR_SURFACES } from "../skybox/ask.mjs";

export { ASKED_SURFACES, FILE_SURFACES, BEHAVIOUR_SURFACES };

/** Largest reply the tool is allowed to send, so its own output budget never truncates an answer. */
const MAX_OUTPUT_TOKENS = 200000;
const ROW_LIMIT = 5000;
/** get_file_outline refuses a page larger than this. */
const OUTLINE_PAGE = 200;

/** Escape a name for an anchored exact-match regex. */
export function exactNamePattern(symbol) {
    return `^${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
}

/** Locations in a total order: by file, then line, then end line. */
function byFileAndLine(left, right) {
    if (left.file !== right.file) {
        return left.file < right.file ? -1 : 1;
    }
    return left.line - right.line || (left.end_line ?? 0) - (right.end_line ?? 0);
}

/** A "19-21" or "16" range cell as { line, end }, or null. */
export function parseLines(cell) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(String(cell ?? "").trim());
    if (!match) {
        return null;
    }
    const line = Number(match[1]);
    return { line, end: match[2] === undefined ? line : Number(match[2]) };
}

function locationOf(file, range) {
    return { file, line: range.line, ...(range.end > range.line ? { end_line: range.end } : {}) };
}

/**
 * Parse a `search_graph --format json` reply into { rows: [{ name, label, file, lines }], complete }.
 * Throws when the reply is not the documented shape: the caller turns that into a harness error.
 */
export function parseSearchGraph(text) {
    const json = JSON.parse(text);
    if (!Array.isArray(json.groups) || !Array.isArray(json.cols)) {
        throw new Error(`unrecognised search_graph reply: ${text.slice(0, 200)}`);
    }
    const column = (name) => json.cols.indexOf(name);
    const [nameAt, labelAt, linesAt] = [column("name"), column("label"), column("lines")];
    if (nameAt < 0 || linesAt < 0) {
        throw new Error(`search_graph reply lacks name/lines columns: ${json.cols.join(",")}`);
    }
    const rows = [];
    for (const group of json.groups) {
        for (const row of group.rows ?? []) {
            rows.push({ name: row[nameAt], label: labelAt < 0 ? null : row[labelAt], file: group.file ?? null, lines: row[linesAt] });
        }
    }
    return { rows, complete: json.has_more !== true && json.truncated !== true && rows.length === (json.total ?? rows.length) };
}

/** Parse a `get_file_outline --format json` reply into { rows: [{ name, lines }], hasMore }. */
export function parseOutline(text) {
    const json = JSON.parse(text);
    if (!Array.isArray(json.rows) || !Array.isArray(json.cols)) {
        throw new Error(`unrecognised get_file_outline reply: ${text.slice(0, 200)}`);
    }
    const nameAt = json.cols.indexOf("name");
    const linesAt = json.cols.indexOf("lines");
    if (nameAt < 0 || linesAt < 0) {
        throw new Error(`get_file_outline reply lacks name/lines columns: ${json.cols.join(",")}`);
    }
    return {
        rows: json.rows.map((row) => ({ name: row[nameAt], lines: row[linesAt] })),
        hasMore: json.has_more === true,
    };
}

/**
 * The `parse_errors` an `index_repository` reply gives for one file. `partial` is the reply's
 * `parse_partial` object, or undefined when cbm flagged nothing. Throws when the reply's list is
 * incomplete (cbm says it holds examples only), because a missing entry would then look like a
 * miss by the tool.
 */
export function parseErrorsFor(partial, file) {
    if (partial === undefined || partial === null) {
        return [];
    }
    if (partial.truncated === true || (typeof partial.count === "number" && partial.count !== (partial.files ?? []).length)) {
        throw new Error(`index_repository parse_partial list is incomplete (count ${partial.count}, listed ${(partial.files ?? []).length})`);
    }
    return (partial.files ?? [])
        .filter((entry) => entry.path === file)
        .map((entry) => {
            const first = parseLines(entry.error_ranges?.split(",")[0]);
            return { file: entry.path, ...(first ? { line: first.line } : {}), message: `parse_partial: error range ${entry.error_ranges}` };
        });
}

/**
 * Ask cbm one question. `call(tool, args)` returns `{ text, isError }`, or throws on a transport
 * failure. `context.parseErrors` is the `parse_partial` object of the index reply.
 * Returns an answer in the corpus answer format, or undefined when this adapter does not ask the
 * question (the task is then left unanswered, which is the honest record).
 */
export async function askCbm(question, call, context = {}) {
    try {
        if (BEHAVIOUR_SURFACES.has(question.surface)) {
            const errors = parseErrorsFor(context.parseErrors, question.from.file);
            return { parse_errors: errors, note: `index_repository parse_partial: ${errors.length} entr${errors.length === 1 ? "y" : "ies"} for ${question.from.file}` };
        }
        if (FILE_SURFACES.has(question.surface)) {
            return await askFile(question, call);
        }
        return await askRaw(question, call);
    } catch (error) {
        return { status: "error", detail: error.message };
    }
}

async function run(call, tool, args) {
    const result = await call(tool, { ...args, format: "json" });
    if (result.isError) {
        throw new Error(`${tool} reported an error: ${result.text.slice(0, 300)}`);
    }
    return result.text;
}

async function askFile(question, call) {
    const rows = [];
    for (let offset = 0; ; offset += OUTLINE_PAGE) {
        const page = parseOutline(await run(call, "get_file_outline", { file_path: question.from.file, limit: OUTLINE_PAGE, offset }));
        rows.push(...page.rows);
        if (page.rows.length === 0 || !page.hasMore) {
            break;
        }
    }
    const entries = rows
        .map((row) => ({ name: row.name, line: parseLines(row.lines)?.line ?? Number.MAX_SAFE_INTEGER }))
        .sort((left, right) => left.line - right.line || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    return { names: entries.map((entry) => entry.name), note: `${entries.length} row(s) in the outline of ${question.from.file}` };
}

async function askRaw(question, call) {
    if (!ASKED_SURFACES.has(question.surface) || RELATION_QUESTIONS.has(`${question.surface}:${question.kind}`)) {
        return undefined;
    }
    const { symbol, occurrence } = question.from;
    if (symbol === null) {
        return { status: "unsupported", detail: "the question has no single identifier, and cbm is asked by name" };
    }
    if (typeof symbol !== "string") {
        return undefined;
    }
    // A segment of a quoted import path is not a name cbm can be asked for by name; it has import
    // edges, so calling it unsupported would be false. Left unasked.
    if (isPathSegment(question.from.text, symbol, occurrence ?? 1)) {
        return undefined;
    }

    const reply = parseSearchGraph(await run(call, "search_graph", {
        name_pattern: exactNamePattern(symbol),
        limit: ROW_LIMIT,
        max_output_tokens: MAX_OUTPUT_TOKENS,
    }));
    if (!reply.complete) {
        return { status: "error", detail: `search_graph reply for ${symbol} is incomplete (more rows than returned)` };
    }

    const located = [];
    let unlocated = 0;
    for (const row of reply.rows) {
        const range = parseLines(row.lines);
        if (row.file && range) {
            located.push(locationOf(row.file, range));
        } else {
            unlocated += 1;
        }
    }
    located.sort(byFileAndLine);
    return {
        locations: located,
        ...(unlocated > 0 ? { unlocated } : {}),
        note: reply.rows.length === 0 ? "no node of that name" : `${reply.rows.length} node(s) named ${symbol}`,
    };
}
