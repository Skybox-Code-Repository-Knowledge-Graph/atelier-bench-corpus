// Scoring: compare one answer file against one lane's bench/tasks.json.
//
// Knows nothing about any tool. An adapter turns a tool's output into the answer format described
// in bench/score/README.md; this module only compares that file with the answer key.

import { posix } from "node:path";
import { fileLines, linesContaining, resolveNeedle } from "./resolve.mjs";
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

/**
 * The lines of a "sites" plan: `required` (every known site and every line of each repeated group)
 * and `neutral` (optional sites and the line the question is asked from, which a tool may include
 * as the declaration). Returns { required, neutral } or { problem }.
 */
export function resolveSites(root, plan) {
    const known = resolveAll(root, plan.entries);
    if (known.problem) {
        return { problem: known.problem };
    }
    const required = [...known.resolved];
    for (const group of plan.repeated) {
        const lines = linesContaining(root, group.file, group.needle);
        if (lines === null) {
            return { problem: `${group.file}: file missing` };
        }
        if (lines.length !== group.lines) {
            return { problem: `${group.file}: repeated needle ${JSON.stringify(group.needle)} is on ${lines.length} line(s), the key says ${group.lines}` };
        }
        required.push(...lines.map((line) => ({ file: normalizeFile(group.file), line })));
    }
    const optional = resolveAll(root, plan.optional);
    if (optional.problem) {
        return { problem: optional.problem };
    }
    const neutral = [...optional.resolved];
    if (plan.from) {
        const from = resolveNeedle(root, plan.from);
        if (from.ok) {
            neutral.push({ file: normalizeFile(plan.from.file), line: from.line });
        }
    }
    return { required, neutral };
}

/** Check the answer's exclusions; locations the key lists are never excluded hits. */
function checkExclusions(plan, answer, locations, context, reasons, notes) {
    const subject = {
        locations,
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
}

/** Score one task. Returns { verdict, detail, rule, class, notScored, notes }. */
export function scoreTask(task, answer, context) {
    const plan = planTask(task, context.lane);
    if (!plan.scorable) {
        return { verdict: "UNSCORABLE", detail: plan.reason };
    }

    const base = { rule: plan.rule, class: plan.class, notScored: plan.notScored };

    // Every needle the rule needs must resolve in this checkout before any answer is judged.
    const needed = resolveAll(context.root, plan.check === "target" ? [plan.target] : plan.entries ?? []);
    if (needed.problem) {
        return { ...base, verdict: "UNRESOLVED", detail: needed.problem };
    }
    const allowed = resolveAll(context.root, plan.allow);
    if (allowed.problem) {
        return { ...base, verdict: "UNRESOLVED", detail: allowed.problem };
    }
    let sites = null;
    if (plan.check === "sites") {
        sites = resolveSites(context.root, plan);
        if (sites.problem) {
            return { ...base, verdict: "UNRESOLVED", detail: sites.problem };
        }
        const distinct = new Set(sites.required.map((site) => `${site.file}:${site.line}`)).size;
        if (distinct !== sites.required.length || distinct !== plan.exactCount) {
            return { ...base, verdict: "UNSCORABLE", detail: `the key lists ${sites.required.length} site line(s), ${distinct} distinct, for exact_count ${plan.exactCount}` };
        }
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
    // Results the tool returned without a file and line. They cannot match the target, but they
    // were returned, so they count like unexpected locations: dropping them must never help.
    const unlocated = answer.unlocated ?? 0;
    if (!Number.isInteger(unlocated) || unlocated < 0) {
        return { ...base, verdict: "ERROR", detail: "invalid answer: unlocated is not a non-negative integer" };
    }
    if (answer.text !== undefined && typeof answer.text !== "string") {
        return { ...base, verdict: "ERROR", detail: "invalid answer: text is not a string" };
    }

    const reasons = [];
    const notes = [];
    const finish = () => (reasons.length === 0
        ? { ...base, verdict: "PASS", notes }
        : { ...base, verdict: "FAIL", detail: reasons.join("; "), notes });

    if (plan.check === "contains") {
        const text = typeof answer.text === "string" ? answer.text : "";
        if (text === "") {
            reasons.push("no text returned");
        } else if (!text.includes(plan.contains)) {
            reasons.push(`text does not contain ${JSON.stringify(plan.contains)}`);
        }
        return finish();
    }

    if (plan.check === "callees" || plan.check === "callers") {
        // Recall: every listed entry must be returned; anything else the tool returns is not judged.
        const matches = plan.check === "callees" ? isDeclaration : coversSite;
        const missing = needed.resolved.filter((entry) => !read.locations.some((location) => matches(location, entry)));
        if (read.locations.length === 0) {
            reasons.push("no location returned");
        } else if (missing.length > 0) {
            const what = plan.check === "callees" ? "callee" : "call site";
            reasons.push(`${missing.length} of ${needed.resolved.length} listed ${what}(s) not returned, first ${missing[0].file}:${missing[0].line}`);
        }
        const unlisted = read.locations.filter((location) => !needed.resolved.some((entry) => matches(location, entry)));
        checkExclusions(plan, answer, unlisted, context, reasons, notes);
        return finish();
    }

    if (plan.check === "sites") {
        // Exact: a reference site is a line, so a location is matched by its `line` alone. A range
        // stands for its first line; one range over a whole file is not an answer of every site.
        const key = (location) => `${location.file}:${location.line}`;
        const required = new Set(sites.required.map(key));
        const neutral = new Set(sites.neutral.map(key));
        const returned = new Set(read.locations.map(key));
        const missing = sites.required.filter((site) => !returned.has(key(site)));
        const extra = [...new Map(read.locations
            .filter((location) => !required.has(key(location)) && !neutral.has(key(location)))
            .map((location) => [key(location), location])).values()];

        if (read.locations.length === 0 && required.size > 0) {
            reasons.push("no location returned");
        } else if (missing.length > 0) {
            const covered = missing.some((site) => read.locations.some((location) => coversSite(location, site)))
                ? "; a returned range covers a missing site, but a site is matched by its line"
                : "";
            reasons.push(`${missing.length} of ${required.size} site(s) not returned, first ${missing[0].file}:${missing[0].line}${covered}`);
        }
        if (extra.length > 0) {
            reasons.push(`${extra.length} location(s) that are not sites, first ${extra[0].file}:${extra[0].line}`);
        }
        if (unlocated > 0) {
            reasons.push(`${unlocated} result(s) without a file and line`);
        }
        checkExclusions(plan, answer, extra, context, reasons, notes);
        return finish();
    }

    const isTarget = plan.targetInsideSymbol ? coversSite : isDeclaration;
    const expected = needed.resolved[0];
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
    } else if (unlocated > 0) {
        reasons.push(`ambiguous: target returned with ${unlocated} result(s) that have no file and line`);
    }

    // A known site is listed by the key itself, so it is never an excluded hit.
    checkExclusions(plan, answer, read.locations.filter((location) => !isKnownSite(location)), context, reasons, notes);
    return finish();
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
    const byClass = { exact: blank(), recall: blank() };

    for (const result of results) {
        const row = (bySurface[result.surface] ??= blank());
        row[result.verdict] += 1;
        row.total += 1;
        total[result.verdict] += 1;
        total.total += 1;
        if (result.class && byClass[result.class]) {
            byClass[result.class][result.verdict] += 1;
            byClass[result.class].total += 1;
        }
    }

    // The two classes are reported side by side and never added together: a recall rule cannot
    // fail a tool that returns everything, so its passes do not mean what an exact pass means.
    const ratios = (counts) => ({
        pass: counts.PASS,
        answered: counts.PASS + counts.FAIL,
        scorable: counts.total - counts.UNRESOLVED,
        asked: counts.PASS + counts.FAIL + counts.UNSUPPORTED + counts.ERROR,
        notAsked: counts.UNANSWERED,
    });
    const classes = { exact: ratios(byClass.exact), recall: ratios(byClass.recall) };

    const answered = total.PASS + total.FAIL;
    const scorable = total.total - total.UNSCORABLE - total.UNRESOLVED;
    return { bySurface, total, answered, scorable, classes };
}
