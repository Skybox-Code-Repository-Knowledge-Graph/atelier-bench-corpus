// The question side of a task: everything an adapter may know before it asks a tool.
//
// An adapter gets the task id (to file the answer under), the surface and the kind (what sort of
// question it is, to pick which tool call to make), and the `from` block with the resolved text of
// the `from` line. It never sees `expect`, `note` or any other part of the answer key, and it must
// not pass `kind` on to the tool.
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
        kind: typeof task.expect?.kind === "string" ? task.expect.kind : null,
        // For call_hierarchy only: which way the question asks. It is read from the key's shape, but
        // it is part of the question ("who calls this?" or "what does this call?"), not the answer.
        direction: task.surface !== "call_hierarchy" ? null
            : (Array.isArray(task.expect?.incoming_includes) || task.expect?.min_incoming !== undefined) ? "callers"
                : Array.isArray(task.expect?.outgoing_includes) ? "callees" : null,
        from: Object.freeze({ ...from, line: resolved.line, text: fileLines(laneRoot, from.file)[resolved.line - 1] }),
    });
}
