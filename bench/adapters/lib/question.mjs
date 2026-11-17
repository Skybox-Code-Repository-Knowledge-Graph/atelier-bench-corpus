// The question side of a task: everything an adapter may know before it asks a tool.
//
// An adapter never sees `expect`, `kind`, `note` or any other part of the answer key. It gets the
// task id (to file the answer under), the surface (to pick which tool call to make), and the
// `from` block with the resolved text of the `from` line. That is all.

import { fileLines, resolveNeedle } from "../../score/lib/resolve.mjs";

const FROM_KEYS = ["file", "needle", "symbol", "occurrence"];

/** Build the question for one task, or null when its `from` does not resolve in this checkout. */
export function questionOf(task, laneRoot) {
    if (!task || typeof task.from !== "object" || task.from === null) {
        return null;
    }

    const from = {};
    for (const key of FROM_KEYS) {
        if (Object.hasOwn(task.from, key)) {
            from[key] = task.from[key];
        }
    }

    const resolved = resolveNeedle(laneRoot, from);
    if (!resolved.ok) {
        return null;
    }

    return Object.freeze({
        id: task.id,
        surface: task.surface,
        from: Object.freeze({ ...from, line: resolved.line, text: fileLines(laneRoot, from.file)[resolved.line - 1] }),
    });
}
