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
import { fileLines } from "../lib/resolve.mjs";
import { classifyExclusion, scoreTask } from "../lib/score.mjs";

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
        const oracle = buildOracle(root, tasks);
        const context = { root, lane, scope: "repo" };
        const counts = { scorable: 0, unresolved: 0, unscorable: 0, exclusions: 0, untrippable: [] };

        for (const task of tasks) {
            const plan = planTask(task);
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
            const [target] = answer.locations;
            const label = `${lane}:${task.id}`;

            const perfect = scoreTask(task, answer, context);
            assert.equal(perfect.verdict, "PASS", `${label} oracle: ${perfect.detail ?? ""}`);

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
        t.diagnostic(`${lane}: ${counts.scorable} scorable, ${counts.unresolved} unresolved, ${counts.unscorable} unscorable of ${tasks.length}; ${counts.exclusions} exclusions tripped`);
        if (counts.untrippable.length > 0) {
            t.diagnostic(`${lane}: exclusions no mutation could trip: ${counts.untrippable.join(" | ")}`);
        }
    });
}
