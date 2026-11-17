// The queried symbol of a task: `from.symbol`, the identifier on the `from` line that the task
// asks about, and `from.occurrence`, which picks one when it appears more than once on that line.
//
// A task's `from` names a line. Tools take a symbol name or a position inside a line, so an
// adapter needs to know which identifier is meant. It reads it here; it never takes the name from
// the answer line, which would leak the answer into the question.

/** Surfaces that ask about a file, not a symbol. Their tasks carry neither key. */
export const FILE_LEVEL_SURFACES = new Set(["document_symbol", "parse-negative", "diagnostics"]);

const WORD = /[A-Za-z0-9_]/;

/**
 * 0-based columns of every whole-identifier occurrence of `symbol` in `line`. An occurrence does
 * not count when it continues a longer identifier: `Sum` is not found in `SumTotal` or `checkSum`.
 * The boundary applies only at an edge of the symbol that is itself a word character, so `$order`
 * and `record.visit` are matched as written.
 */
export function symbolColumns(line, symbol) {
    const columns = [];
    if (typeof symbol !== "string" || symbol === "") {
        return columns;
    }

    const leftEdge = WORD.test(symbol[0]);
    const rightEdge = WORD.test(symbol[symbol.length - 1]);

    for (let at = line.indexOf(symbol); at !== -1; at = line.indexOf(symbol, at + 1)) {
        const before = at === 0 ? "" : line[at - 1];
        const after = line[at + symbol.length] ?? "";
        if ((leftEdge && WORD.test(before)) || (rightEdge && WORD.test(after))) {
            continue;
        }
        columns.push(at);
    }
    return columns;
}

/**
 * Where to point a position-based tool: the 0-based column of the queried symbol on the `from`
 * line, or -1 when the task states no symbol or the symbol is not on the line.
 */
export function symbolColumn(line, from) {
    if (!from || typeof from.symbol !== "string") {
        return -1;
    }
    const columns = symbolColumns(line, from.symbol);
    return columns[(from.occurrence ?? 1) - 1] ?? -1;
}

/**
 * Check one task's `from.symbol` and `from.occurrence` against its resolved `from` line.
 * Returns { state, problems }:
 *
 *   state     "symbol" | "null" | "missing" | "file-level"
 *   problems  what is wrong with what the task does state; empty when it is consistent
 *
 * A missing key is a state, not a problem: whether it fails is the caller's decision.
 */
export function checkSymbol(task, line) {
    const from = task && typeof task.from === "object" && task.from !== null ? task.from : {};
    const problems = [];
    const hasSymbol = Object.hasOwn(from, "symbol");
    const hasOccurrence = Object.hasOwn(from, "occurrence");

    if (FILE_LEVEL_SURFACES.has(task.surface)) {
        if (hasSymbol || hasOccurrence) {
            problems.push(`${task.surface} tasks ask about a file and carry neither from.symbol nor from.occurrence`);
        }
        return { state: "file-level", problems };
    }

    if (!hasSymbol) {
        if (hasOccurrence) {
            problems.push("from.occurrence without from.symbol");
        }
        return { state: "missing", problems };
    }

    if (from.symbol === null) {
        if (hasOccurrence) {
            problems.push("from.occurrence beside a null from.symbol");
        }
        return { state: "null", problems };
    }

    if (typeof from.symbol !== "string" || from.symbol === "" || /\s/.test(from.symbol)) {
        problems.push(`from.symbol must be one identifier or null, got ${JSON.stringify(from.symbol)}`);
        return { state: "symbol", problems };
    }
    // A qualifier is never part of the symbol: Sum, not money::Sum or $money->sum or App\Money.
    // A dot is allowed, because a string key such as record.visit is written with one.
    if (/::|->|\\/.test(from.symbol)) {
        problems.push(`from.symbol must carry no qualifier, got ${JSON.stringify(from.symbol)}`);
        return { state: "symbol", problems };
    }

    if (hasOccurrence && (!Number.isInteger(from.occurrence) || from.occurrence < 1)) {
        problems.push(`from.occurrence must be a positive integer, got ${JSON.stringify(from.occurrence)}`);
        return { state: "symbol", problems };
    }

    const found = symbolColumns(line, from.symbol).length;
    if (found === 0) {
        problems.push(`from.symbol ${JSON.stringify(from.symbol)} does not occur on the from line`);
    } else if (found > 1 && !hasOccurrence) {
        // Never default silently: two occurrences on a line are often two different symbols.
        problems.push(`from.occurrence is required: ${JSON.stringify(from.symbol)} occurs ${found} times on the from line`);
    } else if (hasOccurrence && from.occurrence > found) {
        problems.push(`from.occurrence is ${from.occurrence} but ${JSON.stringify(from.symbol)} occurs ${found} time(s) on the from line`);
    }

    return { state: "symbol", problems };
}
