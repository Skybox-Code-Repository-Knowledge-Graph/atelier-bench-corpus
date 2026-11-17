// "Scorable" is defined by test, not by claim. For every task a rule covers, in every lane:
//
//   - the oracle answer (built from the answer key) must PASS;
//   - each mutation of it must FAIL: no location, the line shifted by one, an unexpected extra
//     location, and one hit for every must_not_include entry.
//
// A task that a mutation cannot fail would be scored vacuously, so the test fails on it. Counts
// are printed, never asserted: the lanes change, and the numbers are computed at run time.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildOracle } from "../oracle.mjs";
import { LANES, planTask } from "../lib/plan.mjs";
import { fileLines, resolveNeedle } from "../lib/resolve.mjs";
import { classifyExclusion, declaredName, resolveSites, scoreTask } from "../lib/score.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Files under a lane-relative path, which may name a file or a directory. */
function filesUnder(root, path) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) {
        return [];
    }
    if (statSync(absolute).isFile()) {
        return [path];
    }
    return readdirSync(absolute, { recursive: true })
        .map((entry) => join(path, String(entry)).replaceAll("\\", "/"))
        .filter((file) => statSync(join(root, file)).isFile());
}

/** An answer that should trip one exclusion entry, or null when none can be built here. */
function tripExclusion(entry, answer, root, lane) {
    const kind = classifyExclusion(entry);

    if (kind === "lane-prefix") {
        return { ...answer, locations: [...answer.locations, { file: `../${entry}excluded.txt`, line: 1 }] };
    }
    if (kind === "pattern") {
        return { ...answer, text: entry.split(".*").join(" anything ") };
    }
    if (kind === "path#symbol") {
        const at = entry.indexOf("#");
        const symbol = entry.slice(at + 1);
        for (const file of filesUnder(root, entry.slice(0, at))) {
            const index = (fileLines(root, file) ?? []).findIndex((line) => line.includes(symbol));
            if (index !== -1) {
                return { ...answer, locations: [...answer.locations, { file, line: index + 1 }] };
            }
        }
        return null;
    }
    return { ...answer, text: entry };
}

for (const lane of LANES) {
    test(`oracle passes and every mutation fails: ${lane}`, (t) => {
        const root = join(REPO_ROOT, lane);
        const tasks = JSON.parse(readFileSync(join(root, "bench", "tasks.json"), "utf8")).tasks;
        const oracle = buildOracle(root, tasks, lane);
        const context = { root, lane, scope: "repo" };
        const counts = { scorable: 0, unresolved: 0, unscorable: 0, exclusions: 0, untrippable: [], byCheck: {} };

        for (const task of tasks) {
            const plan = planTask(task, lane);
            if (!plan.scorable) {
                counts.unscorable += 1;
                assert.equal(scoreTask(task, undefined, context).verdict, "UNSCORABLE", `${lane}:${task.id}`);
                continue;
            }

            const answer = oracle.answers[task.id];
            if (answer === undefined) {
                counts.unresolved += 1;
                assert.equal(scoreTask(task, undefined, context).verdict, "UNRESOLVED", `${lane}:${task.id}`);
                continue;
            }

            counts.scorable += 1;
            counts.byCheck[plan.check] = (counts.byCheck[plan.check] ?? 0) + 1;
            const label = `${lane}:${task.id}`;

            if (plan.check === "names") {
                checkNamesRule(task, plan, answer, context, label);
                continue;
            }
            if (plan.check === "sites") {
                checkSitesRule(task, plan, answer, context, label, counts);
                continue;
            }
            if (plan.check !== "target") {
                checkRecallRule(task, plan, answer, context, label, counts);
                continue;
            }
            const [target] = answer.locations;

            const perfect = scoreTask(task, answer, context);
            assert.equal(perfect.verdict, "PASS", `${label} oracle: ${perfect.detail ?? ""}`);

            // Two richer answers a real tool gives must pass as well: the target with its full
            // range, and the target together with every site the key lists.
            const ranged = scoreTask(task, { locations: [{ ...target, end_line: target.line + 40 }] }, context);
            assert.equal(ranged.verdict, "PASS", `${label} target with a range: ${ranged.detail ?? ""}`);

            const sites = plan.allow.map((site) => ({ file: site.file, line: resolveNeedle(root, site).line }));
            const withSites = scoreTask(task, { locations: [target, ...sites] }, context);
            assert.equal(withSites.verdict, "PASS", `${label} target with known sites: ${withSites.detail ?? ""}`);

            // A range that starts above the target and covers it is an enclosing scope, and fails.
            if (target.line > 1) {
                const enclosing = scoreTask(task, { locations: [{ file: target.file, line: target.line - 1, end_line: target.line + 40 }] }, context);
                assert.equal(enclosing.verdict, "FAIL", `${label} enclosing range`);
            }

            // A known site is matched by its line: a range that starts above it does not name it.
            if (sites.length > 0 && sites[0].line > 1) {
                const aboveSite = { file: sites[0].file, line: sites[0].line - 1, end_line: sites[0].line + 1 };
                if (!sites.some((site) => site.file === aboveSite.file && site.line === aboveSite.line) && !(aboveSite.file === target.file && aboveSite.line === target.line)) {
                    const ranged = scoreTask(task, { locations: [target, aboveSite] }, context);
                    assert.equal(ranged.verdict, "FAIL", `${label} a range over a known site`);
                }
            }

            assert.equal(scoreTask(task, { locations: [] }, context).verdict, "FAIL", `${label} no location`);

            const shifted = { file: target.file, line: target.line > 1 ? target.line - 1 : target.line + 1 };
            assert.equal(scoreTask(task, { locations: [shifted] }, context).verdict, "FAIL", `${label} shifted line`);

            const extra = { locations: [target, { file: "no/such/file.txt", line: 1 }] };
            assert.equal(scoreTask(task, extra, context).verdict, "FAIL", `${label} unexpected extra`);

            for (const entry of plan.exclude) {
                const tripped = tripExclusion(entry, answer, root, lane);
                if (tripped === null) {
                    counts.untrippable.push(`${task.id}: ${entry}`);
                    continue;
                }
                counts.exclusions += 1;
                const outcome = scoreTask(task, tripped, context);
                assert.equal(outcome.verdict, "FAIL", `${label} exclusion ${JSON.stringify(entry)}`);
                assert.match(outcome.detail, /excluded/, `${label} exclusion ${JSON.stringify(entry)} named in the reason`);
            }
        }

        assert.ok(counts.scorable > 0, `${lane}: no task is scorable`);
        t.diagnostic(`${lane}: ${counts.scorable} scorable (${Object.entries(counts.byCheck).map(([check, n]) => `${check} ${n}`).join(", ")}), ${counts.unresolved} unresolved, ${counts.unscorable} unscorable of ${tasks.length}; ${counts.exclusions} exclusions tripped`);
        if (counts.untrippable.length > 0) {
            t.diagnostic(`${lane}: exclusions no mutation could trip: ${counts.untrippable.join(" | ")}`);
        }
    });
}

/**
 * The exact rule "names" (document_symbol): the oracle passes, and so does it in reverse order (order
 * is not judged), with every label qualified the way a server may print it (`Owner.name`, `$name`),
 * and with an unnamed container added (`impl X for Y`). One name missing, one extra name, one name
 * returned twice, no names, and a location list without names each fail.
 */
function checkNamesRule(task, plan, answer, context, label) {
    const verdict = (candidate) => scoreTask(task, candidate, context).verdict;
    const names = answer.names;
    const first = names.findIndex((name) => !/\s/.test(declaredName(name)));
    assert.ok(first >= 0, `${label}: the key names no identifier`);
    assert.equal(verdict(answer), "PASS", `${label} oracle`);
    assert.equal(verdict({ names: [...names].reverse() }), "PASS", `${label} order is not judged`);
    assert.equal(verdict({ names: names.map((name) => (/\s/.test(name) ? name : `Owner.${declaredName(name)}`)) }), "PASS", `${label} qualified labels`);
    assert.equal(verdict({ names: [...names, "impl Something for Other"] }), "PASS", `${label} an unnamed container is neutral`);
    assert.equal(verdict({ names: names.filter((_, index) => index !== first) }), "FAIL", `${label} one name missing`);
    assert.equal(verdict({ names: [...names, "zz_not_a_symbol_of_this_file"] }), "FAIL", `${label} one extra name`);
    assert.equal(verdict({ names: [...names, names[first]] }), "FAIL", `${label} one name twice`);
    assert.equal(verdict({ names: [] }), "FAIL", `${label} no names`);
    assert.equal(verdict({ locations: [{ file: task.from.file, line: 1 }] }), "FAIL", `${label} locations without names`);
    assert.equal(verdict({ names: [1, 2] }), "ERROR", `${label} names that are not strings`);
}

/**
 * The exact rule "sites" (references): the oracle passes, and so do the oracle plus the declaration
 * the question is asked from or any optional site. One site dropped, one moved by a line, a line
 * that is not a site, a result without a line, and one range per file in place of its sites each
 * fail, and so does one hit for every `must_not_include` entry.
 */
function checkSitesRule(task, plan, answer, context, label, counts) {
    const verdict = (candidate) => scoreTask(task, candidate, context);
    const outcome = verdict(answer);
    assert.equal(outcome.verdict, "PASS", `${label} oracle: ${outcome.detail ?? ""}`);

    const sites = resolveSites(context.root, plan);
    const key = (location) => `${location.file}:${location.line}`;
    const taken = new Set([...sites.required, ...sites.neutral].map(key));
    const listed = answer.locations;
    const freeLine = (file, near) => {
        const total = (fileLines(context.root, file) ?? []).length;
        for (let step = 1; step <= total; step += 1) {
            for (const line of [near - step, near + step]) {
                if (line >= 1 && line <= total && !taken.has(`${file}:${line}`)) {
                    return line;
                }
            }
        }
        return null;
    };

    for (const neutral of sites.neutral) {
        assert.equal(verdict({ locations: [...listed, neutral] }).verdict, "PASS", `${label} with neutral ${key(neutral)}`);
    }
    assert.equal(verdict({ locations: [...listed], unlocated: 1 }).verdict, "FAIL", `${label} a result without a line`);

    if (listed.length > 0) {
        assert.equal(verdict({ locations: listed.slice(1) }).verdict, "FAIL", `${label} one site missing`);
        const moved = freeLine(listed[0].file, listed[0].line);
        if (moved !== null) {
            assert.equal(verdict({ locations: [{ ...listed[0], line: moved }, ...listed.slice(1)] }).verdict, "FAIL", `${label} one site moved`);
        }
        const files = [...new Set(listed.map((location) => location.file))];
        if (files.length < listed.length) {
            const wide = files.map((file) => {
                const lines = listed.filter((location) => location.file === file).map((location) => location.line);
                return { file, line: Math.min(...lines), end_line: Math.max(...lines) + 10 };
            });
            assert.equal(verdict({ locations: wide }).verdict, "FAIL", `${label} one range per file`);
        }
        if (plan.repeated.length > 0) {
            const group = plan.repeated[0];
            const lines = new Set((fileLines(context.root, group.file) ?? []).flatMap((text, index) => (text.includes(group.needle) ? [index + 1] : [])));
            const lastOfGroup = listed.findLastIndex((location) => location.file === group.file && lines.has(location.line));
            const withoutOne = listed.filter((_, index) => index !== lastOfGroup);
            assert.equal(verdict({ locations: withoutOne }).verdict, "FAIL", `${label} one line of a repeated group missing`);
        }
    }
    const anchorFile = plan.from?.file ?? listed[0]?.file;
    if (anchorFile !== undefined) {
        const line = freeLine(anchorFile, 1);
        if (line !== null) {
            assert.equal(verdict({ locations: [...listed, { file: anchorFile, line }] }).verdict, "FAIL", `${label} a line that is not a site`);
        }
    }

    for (const entry of plan.exclude) {
        const tripped = tripExclusion(entry, answer, context.root, context.lane);
        if (tripped === null) {
            counts.untrippable.push(`${task.id}: ${entry}`);
            continue;
        }
        counts.exclusions += 1;
        const result = verdict(tripped);
        assert.equal(result.verdict, "FAIL", `${label} exclusion ${JSON.stringify(entry)}`);
    }
}

/**
 * The recall rules ("contains", "callees", "callers"): the oracle passes, a missing or moved entry
 * fails, and each excluded entry fails. Their known limit is pinned too: an answer that returns more
 * than the key lists (extra text, extra locations, one range over a whole file) passes, which is why
 * these rules are reported in their own column.
 */
function checkRecallRule(task, plan, answer, context, label, counts) {
    const verdict = (candidate) => scoreTask(task, candidate, context);
    assert.equal(verdict(answer).verdict, "PASS", `${label} oracle: ${verdict(answer).detail ?? ""}`);

    if (plan.check === "contains") {
        assert.equal(verdict({ text: "" }).verdict, "FAIL", `${label} no text`);
        assert.equal(verdict({ text: plan.contains.slice(0, -1) }).verdict, "FAIL", `${label} truncated text`);
        assert.equal(verdict({ locations: [] }).verdict, "FAIL", `${label} locations only`);
        assert.equal(verdict({ text: `before ${plan.contains} after` }).verdict, "PASS", `${label} recall limit: surrounding text is not judged`);
        return;
    }

    const listed = answer.locations;
    assert.equal(verdict({ locations: [] }).verdict, "FAIL", `${label} no location`);
    assert.equal(verdict({ locations: listed.slice(1) }).verdict, "FAIL", `${label} one listed entry missing`);
    const moved = [{ ...listed[0], line: listed[0].line > 1 ? listed[0].line - 1 : listed[0].line + 1 }, ...listed.slice(1)];
    assert.equal(verdict({ locations: moved }).verdict, "FAIL", `${label} one listed entry moved by a line`);
    assert.equal(verdict({ locations: [...listed, { file: "no/such/file.txt", line: 1 }] }).verdict, "PASS", `${label} recall limit: an extra location is not judged`);

    if (plan.check === "callees") {
        // A callee is a declaration: a range that starts above it does not stand for it.
        const enclosing = [{ file: listed[0].file, line: listed[0].line > 1 ? listed[0].line - 1 : listed[0].line, end_line: listed[0].line + 40 }, ...listed.slice(1)];
        if (listed[0].line > 1) {
            assert.equal(verdict({ locations: enclosing }).verdict, "FAIL", `${label} callee by an enclosing range`);
        }
    } else {
        // A caller is the range of the calling declaration: one range over each file covers every site.
        const files = [...new Set(listed.map((location) => location.file))];
        const wide = files.map((file) => ({ file, line: 1, end_line: Math.max(...listed.filter((l) => l.file === file).map((l) => l.line)) + 10 }));
        assert.equal(verdict({ locations: wide }).verdict, "PASS", `${label} recall limit: one range per file covers every call site`);
    }

    for (const entry of plan.exclude) {
        const tripped = tripExclusion(entry, answer, context.root, context.lane);
        if (tripped === null) {
            counts.untrippable.push(`${task.id}: ${entry}`);
            continue;
        }
        counts.exclusions += 1;
        const outcome = verdict(tripped);
        assert.equal(outcome.verdict, "FAIL", `${label} exclusion ${JSON.stringify(entry)}`);
        assert.match(outcome.detail, /excluded/, `${label} exclusion ${JSON.stringify(entry)} named in the reason`);
    }
}
