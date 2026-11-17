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

/**
 * The identifier a symbol label declares: the text after the last `.` or `::` (a receiver, class or
 * module qualifier, as in `(*RepairOrder).TransitionTo` or `Foo::bar`), without a leading `$` (a
 * php property). Applied to the key and the answer alike, so label conventions do not decide a
 * verdict; a label with no identifier of its own (`impl RepairOrder`) stays as written.
 */
export function declaredName(label) {
    const trimmed = label.trim();
    const cut = Math.max(trimmed.lastIndexOf("."), trimmed.lastIndexOf("::") + 1);
    const tail = cut > 0 && cut < trimmed.length - 1 ? trimmed.slice(cut + 1) : trimmed;
    return tail.startsWith("$") && tail.length > 1 ? tail.slice(1) : tail;
}

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

    if (plan.check === "names") {
        // Exact: the identifiers the file declares, as a multiset. A name declared twice is returned
        // twice; the order is not judged (tools nest containers and flatten them in different
        // orders). Both sides are compared by the declared identifier (declaredName), so a server's
        // label convention, `(*T).Method`, `Class::method`, `$property`, is not what is measured.
        if (answer.names !== undefined && (!Array.isArray(answer.names) || !answer.names.every((name) => typeof name === "string"))) {
            return { ...base, verdict: "ERROR", detail: "invalid answer: names is not a list of strings" };
        }
        const returned = Array.isArray(answer.names) ? answer.names : [];
        // A label with no identifier of its own (whitespace remains after declaredName, as in a rust
        // `impl Trait for Type` block) names a container, not a symbol: neutral on both sides.
        const named = (list) => list.map(declaredName).filter((name) => !/\s/.test(name));
        const tally = (list) => named(list).reduce((counts, name) => counts.set(name, (counts.get(name) ?? 0) + 1), new Map());
        const wanted = tally(plan.symbols);
        const got = tally(returned);
        const missing = [...wanted].flatMap(([name, count]) => Array(Math.max(0, count - (got.get(name) ?? 0))).fill(name));
        const extra = [...got].flatMap(([name, count]) => Array(Math.max(0, count - (wanted.get(name) ?? 0))).fill(name));
        if (returned.length === 0) {
            reasons.push("no names returned");
        } else {
            if (missing.length > 0) {
                reasons.push(`${missing.length} of ${plan.symbols.length} symbol name(s) not returned, first ${JSON.stringify(missing[0])}`);
            }
            if (extra.length > 0) {
                reasons.push(`${extra.length} name(s) beyond the file's symbols, first ${JSON.stringify(extra[0])}`);
            }
        }
        return finish();
    }

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

    if (plan.check === "twoSided") {
        // The key names one member of a set it does not list. The candidate must be among the
        // locations returned for the asked direction, and absent from those returned when the
        // opposite direction is asked (`reverse_locations`): a tool with the edge backwards, or in
        // both directions, fails. Other locations in the asked direction are not judged (recall).
        const expected = needed.resolved[0];
        if (answer.reverse_locations === undefined) {
            reasons.push("the opposite direction was not asked (no reverse_locations), so the direction is not shown");
        }
        const reverse = readLocations({ locations: answer.reverse_locations ?? [] });
        if (reverse.problem) {
            return { ...base, verdict: "ERROR", detail: `invalid answer: reverse_locations: ${reverse.problem}` };
        }
        if (read.locations.length === 0) {
            reasons.push("no location returned");
        } else if (!read.locations.some((location) => isDeclaration(location, expected))) {
            reasons.push(`candidate not returned: expected ${expected.file}:${expected.line}`);
        }
        if (reverse.locations.some((location) => isDeclaration(location, expected))) {
            reasons.push(`the candidate ${expected.file}:${expected.line} is also returned in the opposite direction`);
        }
        const others = read.locations.filter((location) => !isDeclaration(location, expected));
        checkExclusions(plan, answer, others, context, reasons, notes);
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
                ? `; a returned range covers a missing ${plan.noun}, but a ${plan.noun} is matched by its line`
                : "";
            reasons.push(`${missing.length} of ${required.size} ${plan.noun}(s) not returned, first ${missing[0].file}:${missing[0].line}${covered}`);
        }
        if (extra.length > 0) {
            reasons.push(`${extra.length} location(s) that are not listed ${plan.noun}s, first ${extra[0].file}:${extra[0].line}`);
        }
        if (unlocated > 0) {
            reasons.push(`${unlocated} result(s) without a file and line`);
        }
        checkExclusions(plan, answer, extra, context, reasons, notes);
        return finish();
    }

    // The target and each known site are matched by their line. A range stands for its first line:
    // one that covers a site from above is an enclosing scope, and is an unexpected location.
    const isTarget = isDeclaration;
    const expected = needed.resolved[0];
    const isKnownSite = (location) => allowed.resolved.some((site) => isDeclaration(location, site));
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
        results.push({ id: task.id, surface: task.surface, protocol: protocolOf(answersDoc, task.surface), ...outcome });
    }

    // An answer for an id the lane does not have is reported: a renamed id must not look UNANSWERED.
    const known = new Set(tasks.map((task) => task.id));
    const unknownIds = Object.keys(answersDoc.answers).filter((id) => !known.has(id));

    return { results, summary: summarize(results), unknownIds };
}

/** The protocol an answer file states for a surface: one name, a map by surface, or none. */
export function protocolOf(answersDoc, surface) {
    const protocol = answersDoc?.protocol;
    if (typeof protocol === "string" && protocol !== "") {
        return protocol;
    }
    if (protocol && typeof protocol === "object") {
        // A map that leaves a surface out: the adapter states no protocol for it, so its tasks are
        // reported apart from every stated protocol, never folded into one.
        return typeof protocol[surface] === "string" ? protocol[surface] : "unstated";
    }
    return null;
}

/** Counts per surface and overall, plus one column per rule class and protocol. */
export function summarize(results) {
    const blank = () => Object.fromEntries([...VERDICTS.map((verdict) => [verdict, 0]), ["total", 0]]);
    const bySurface = {};
    const total = blank();
    const byColumn = new Map();

    for (const result of results) {
        const row = (bySurface[result.surface] ??= blank());
        row[result.verdict] += 1;
        row.total += 1;
        total[result.verdict] += 1;
        total.total += 1;
        if (result.class === "exact" || result.class === "recall") {
            const key = `${result.class}\u0000${result.protocol ?? ""}`;
            if (!byColumn.has(key)) {
                byColumn.set(key, { class: result.class, protocol: result.protocol ?? null, counts: blank() });
            }
            const column = byColumn.get(key);
            column.counts[result.verdict] += 1;
            column.counts.total += 1;
        }
    }

    // One column per rule class and adapter protocol, never added together. A recall rule cannot
    // fail a tool that returns everything, so its passes do not mean what an exact pass means; and
    // answers asked under different protocols measure different things (adapters README).
    // "asked" counts every question the tool was put, its errors and "unsupported" replies included:
    // a tool that times out or cannot be asked has not answered, and must not look better for it.
    // "notAsked" is what the adapter chose not to ask; it counts against "scorable", never for it.
    const ratios = (counts) => ({
        pass: counts.PASS,
        scorable: counts.total - counts.UNRESOLVED - counts.UNSCORABLE,
        asked: counts.PASS + counts.FAIL + counts.UNSUPPORTED + counts.ERROR,
        notAsked: counts.UNANSWERED,
        errors: counts.ERROR,
        unsupported: counts.UNSUPPORTED,
    });
    const order = { exact: 0, recall: 1 };
    const columns = [...byColumn.values()]
        .sort((left, right) => order[left.class] - order[right.class] || String(left.protocol ?? "").localeCompare(String(right.protocol ?? "")))
        .map((column) => ({ class: column.class, protocol: column.protocol, ...ratios(column.counts) }));

    const scorable = total.total - total.UNSCORABLE - total.UNRESOLVED;
    return { bySurface, total, scorable, columns };
}
