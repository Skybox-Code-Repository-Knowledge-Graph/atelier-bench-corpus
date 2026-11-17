// Needle resolution, identical to the lane verifiers: a {file, needle} pair resolves when exactly
// one line of the file contains the needle. Lines split on CRLF, LF or CR.

import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const cache = new Map();

/** Lines of a file under root, or null when it is missing or unreadable. Cached per path. */
export function fileLines(root, file) {
    const path = join(root, file);
    if (cache.has(path)) {
        return cache.get(path);
    }

    let lines = null;
    if (existsSync(path) && statSync(path).isFile()) {
        try {
            lines = readFileSync(path, "utf8").split(/\r\n|\n|\r/);
        } catch {
            lines = null;
        }
    }

    cache.set(path, lines);
    return lines;
}

/** Resolve one pair to its unique 1-based line, or say why it did not resolve. */
export function resolveNeedle(root, pair) {
    const lines = fileLines(root, pair.file);
    if (lines === null) {
        return { ok: false, reason: "file missing" };
    }

    const hits = [];
    lines.forEach((line, index) => {
        if (line.includes(pair.needle)) {
            hits.push(index + 1);
        }
    });

    if (hits.length !== 1) {
        return { ok: false, reason: `found ${hits.length} times` };
    }

    return { ok: true, line: hits[0] };
}

/** 1-based line numbers of every line of a file that contains the needle, or null when it is missing. */
export function linesContaining(root, file, needle) {
    const lines = fileLines(root, file);
    if (lines === null) {
        return null;
    }
    const hits = [];
    lines.forEach((line, index) => {
        if (line.includes(needle)) {
            hits.push(index + 1);
        }
    });
    return hits;
}

export function isFileNeedle(value) {
    return Boolean(value)
        && typeof value === "object"
        && typeof value.file === "string"
        && typeof value.needle === "string";
}
