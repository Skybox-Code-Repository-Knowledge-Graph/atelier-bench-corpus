// Scoring: compare one answer file against one lane's bench/tasks.json.
//
// Knows nothing about any tool. An adapter turns a tool's output into the answer format described
// in bench/score/README.md; this module only compares that file with the answer key.

import { posix } from "node:path";
import { fileLines, resolveNeedle } from "./resolve.mjs";
import { LANES, planTask } from "./plan.mjs";
import { FILE_LEVEL_SURFACES } from "./symbol.mjs";

export const VERDICTS = ["PASS", "FAIL", "UNSUPPORTED", "UNANSWERED", "ERROR", "UNSCORABLE", "UNRESOLVED"];

const STATUSES = new Set(["answered", "unsupported", "error"]);
const SCOPES = new Set(["repo", "lane"]);

function normalizeFile(file) {
    return posix.normalize(String(file).replaceAll("\\", "/"));
}

/** Validate the top level of an answer file. Returns a list of problems, empty when it is usable. */
export function validateAnswers(doc) {
    const problems = [];
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
        return ["answer file is not a JSON object"];
    }
    if (doc.version !== 1) {
        problems.push("version must be 1");
    }
    if (!doc.tool || typeof doc.tool !== "object" || typeof doc.tool.name !== "string" || doc.tool.name === "") {
        problems.push("tool.name must be a non-empty string");
    }
    if (doc.scope !== undefined && !SCOPES.has(doc.scope)) {
        problems.push('scope must be "repo" or "lane"');
    }
    if (!doc.answers || typeof doc.answers !== "object" || Array.isArray(doc.answers)) {
        problems.push("answers must be an object keyed by task id");
    }
    return problems;
}

/** Normalize one answer's locations. Returns { locations } or { problem }. */
function readLocations(answer) {
    const raw = answer.locations ?? [];
    if (!Array.isArray(raw)) {
        return { problem: "locations is not an array" };
    }

    const seen = new Set();
    const locations = [];
    for (const item of raw) {
        if (!item || typeof item !== "object" || typeof item.file !== "string" || item.file === "") {
            return { problem: "a location has no file" };
        }
        if (item.file.startsWith("/") || /^[A-Za-z]:[\\/]/.test(item.file)) {
            return { problem: `location file is absolute: ${item.file}` };
        }
        if (!Number.isInteger(item.line) || item.line < 1) {
            return { problem: `location line is not a positive integer in ${item.file}` };
        }
        const endLine = item.end_line ?? item.line;
        if (!Number.isInteger(endLine) || endLine < item.line) {
            return { problem: `location end_line is before line in ${item.file}` };
        }

        const location = { file: normalizeFile(item.file), line: item.line, endLine };
        const key = `${location.file}:${location.line}:${location.endLine}`;
        if (!seen.has(key)) {
            seen.add(key);
            locations.push(location);
        }
    }
    return { locations };
}

/** A declaration is matched by its exact line: a range never makes an enclosing scope pass. */
function isDeclaration(location, expected) {
    return location.file === expected.file && location.line === expected.line;
}

/** A site is matched by containment: a caller's range covers the call-site line inside it. */
function coversSite(location, expected) {
    return location.file === expected.file && location.line <= expected.line && expected.line <= location.endLine;
}

/** The source text of the line a location reports. Exclusions never search the rest of its range. */
function sourceLine(root, location) {
    const lines = fileLines(root, location.file);
    return lines === null ? "" : lines[location.line - 1] ?? "";
}

function matchesPattern(line, parts) {
    let from = 0;
    for (const part of parts) {
        const at = line.indexOf(part, from);
        if (at === -1) {
            return false;
        }
        from = at + part.length;
    }
    return true;
}

/**
 * How a `must_not_include` entry is matched. The corpus writes these entries in several forms; each
 * form has one rule here, and README.md lists them.
 */
export function classifyExclusion(entry) {
    if (LANES.some((lane) => entry === `${lane}/`)) {
        return "lane-prefix";
    }
    if (entry.includes(".*")) {
        return "pattern";
    }
    if (entry.includes("#") && !/\s/.test(entry)) {
        return "path#symbol";
    }
    return "text";
}

/**
 * Does this answer contain something the task excludes? Returns true, false, or "not-exercised".
 * `locations` are the returned locations the exclusion applies to: known sites are left out by the
 * caller, because the key itself lists them. Text is matched on the reported line only, never on
 * the rest of a range, so a declaration's body cannot trip an exclusion.
 */
export function exclusionHit(entry, { locations, text = "", names = [] }, context) {
    const kind = classifyExclusion(entry);

    if (kind === "lane-prefix") {
        if (context.scope !== "repo") {
            return "not-exercised";
        }
        return locations.some((location) => posix.normalize(`${context.lane}/${location.file}`).startsWith(entry));
    }

    if (kind === "pattern") {
        const parts = entry.split(".*");
        return matchesPattern(text, parts)
            || locations.some((location) => matchesPattern(sourceLine(context.root, location), parts));
    }

    if (kind === "path#symbol") {
        const at = entry.indexOf("#");
        const path = entry.slice(0, at);
        const symbol = entry.slice(at + 1);
        return locations.some((location) => location.file.startsWith(path)
            && sourceLine(context.root, location).includes(symbol));
    }

    return text.includes(entry)
        || names.includes(entry)
        || locations.some((location) => location.file.includes(entry)
            || sourceLine(context.root, location).includes(entry));
}

function resolveAll(root, pairs) {
    const resolved = [];
    for (const pair of pairs) {
        const result = resolveNeedle(root, pair);
        if (!result.ok) {
            return { problem: `${pair.file}: ${result.reason}` };
        }
        resolved.push({ file: normalizeFile(pair.file), line: result.line });
    }
    return { resolved };
}

/** Score one task. Returns { verdict, detail, rule, notScored, notes }. */
export function scoreTask(task, answer, context) {
    const plan = planTask(task, context.lane);
    if (!plan.scorable) {
        return { verdict: "UNSCORABLE", detail: plan.reason };
    }

    const base = { rule: plan.rule, notScored: plan.notScored };
    const isTarget = plan.targetInsideSymbol ? coversSite : isDeclaration;

    const target = resolveAll(context.root, [plan.target]);
    if (target.problem) {
        return { ...base, verdict: "UNRESOLVED", detail: target.problem };
    }
    const allowed = resolveAll(context.root, plan.allow);
    if (allowed.problem) {
        return { ...base, verdict: "UNRESOLVED", detail: allowed.problem };
    }

    if (answer === undefined) {
        return { ...base, verdict: "UNANSWERED" };
    }
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
        return { ...base, verdict: "ERROR", detail: "invalid answer: not an object" };
    }

    const status = answer.status ?? "answered";
    if (!STATUSES.has(status)) {
        return { ...base, verdict: "ERROR", detail: `invalid answer: unknown status ${JSON.stringify(status)}` };
    }
    if (status === "unsupported") {
        return { ...base, verdict: "UNSUPPORTED" };
    }
    if (status === "error") {
        return { ...base, verdict: "ERROR", detail: typeof answer.detail === "string" ? answer.detail : "" };
    }

    const read = readLocations(answer);
    if (read.problem) {
        return { ...base, verdict: "ERROR", detail: `invalid answer: ${read.problem}` };
    }

    const expected = target.resolved[0];
    const reasons = [];
    const notes = [];

    const isKnownSite = (location) => allowed.resolved.some((site) => coversSite(location, site));
    const unexpected = read.locations.filter((location) => !isTarget(location, expected) && !isKnownSite(location));

    if (read.locations.length === 0) {
        reasons.push("no location returned");
    } else if (!read.locations.some((location) => isTarget(location, expected))) {
        const got = read.locations[0];
        const more = read.locations.length > 1 ? ` and ${read.locations.length - 1} more` : "";
        const covered = read.locations.some((location) => coversSite(location, expected))
            ? "; a returned range covers the target line, but a declaration is matched by its exact line"
            : "";
        reasons.push(`target not returned: expected ${expected.file}:${expected.line}, got ${got.file}:${got.line}${more}${covered}`);
    } else if (unexpected.length > 0) {
        reasons.push(`ambiguous: target returned with ${unexpected.length} unexpected location(s), first ${unexpected[0].file}:${unexpected[0].line}`);
    }

    // A known site is listed by the key itself, so it is never an excluded hit.
    const subject = {
        locations: read.locations.filter((location) => !isKnownSite(location)),
        text: typeof answer.text === "string" ? answer.text : "",
        names: Array.isArray(answer.names) ? answer.names.filter((name) => typeof name === "string") : [],
    };
    let notExercised = 0;
    for (const entry of plan.exclude) {
        const hit = exclusionHit(entry, subject, context);
        if (hit === "not-exercised") {
            notExercised += 1;
        } else if (hit) {
            reasons.push(`excluded ${JSON.stringify(entry)} returned`);
        }
    }
    if (notExercised > 0) {
        notes.push(`${notExercised} lane-prefix exclusion(s) not exercised, scope is lane`);
    }

    return reasons.length === 0
        ? { ...base, verdict: "PASS", notes }
        : { ...base, verdict: "FAIL", detail: reasons.join("; "), notes };
}

/** Score every task of a lane. `root` is the lane directory, `lane` its name in the repository. */
export function scoreLane({ root, lane, tasks, answersDoc }) {
    const context = { root, lane, scope: answersDoc.scope ?? "lane" };
    const results = [];

    for (const task of tasks) {
        const answer = Object.hasOwn(answersDoc.answers, task.id) ? answersDoc.answers[task.id] : undefined;
        // Every adapter asks by `from.symbol`. A task that states none cannot be asked honestly:
        // its lane is not annotated yet, or it is a misfit. A null symbol is a statement, and is scored.
        const asked = FILE_LEVEL_SURFACES.has(task.surface) || (task.from && Object.hasOwn(task.from, "symbol"));
        const outcome = asked
            ? scoreTask(task, answer, context)
            : { verdict: "UNSCORABLE", detail: "task states no from.symbol" };
        results.push({ id: task.id, surface: task.surface, ...outcome });
    }

    // An answer for an id the lane does not have is reported: a renamed id must not look UNANSWERED.
    const known = new Set(tasks.map((task) => task.id));
    const unknownIds = Object.keys(answersDoc.answers).filter((id) => !known.has(id));

    return { results, summary: summarize(results), unknownIds };
}

/** Counts per surface and overall, plus the denominators the report's three ratios use. */
export function summarize(results) {
    const blank = () => Object.fromEntries([...VERDICTS.map((verdict) => [verdict, 0]), ["total", 0]]);
    const bySurface = {};
    const total = blank();

    for (const result of results) {
        const row = (bySurface[result.surface] ??= blank());
        row[result.verdict] += 1;
        row.total += 1;
        total[result.verdict] += 1;
        total.total += 1;
    }

    const answered = total.PASS + total.FAIL;
    const scorable = total.total - total.UNSCORABLE - total.UNRESOLVED;
    return { bySurface, total, answered, scorable };
}
