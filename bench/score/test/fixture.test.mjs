// The scorer's own conformance fixture: a lane-shaped directory with one task per verdict and per
// must_not_include form, an answer file, and the exact report the CLI must print for it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync } from "node:fs";

import { buildOracle } from "../oracle.mjs";
import { LANES, TARGET_INSIDE_SYMBOL, planTask } from "../lib/plan.mjs";
import { resolveNeedle } from "../lib/resolve.mjs";
import { classifyExclusion, scoreLane, scoreTask, validateAnswers } from "../lib/score.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCORE = resolve(HERE, "..", "score.mjs");
const FIXTURE = join(HERE, "fixture");
const LANE = join(FIXTURE, "lane");

const run = (...args) => spawnSync(process.execPath, [SCORE, ...args], { encoding: "utf8" });
const tasks = () => JSON.parse(readFileSync(join(LANE, "bench", "tasks.json"), "utf8")).tasks;
const task = (id) => tasks().find((candidate) => candidate.id === id);

test("text report for the fixture is byte-identical to expected-mixed.txt", () => {
    const result = run("--root", LANE, "--answers", join(FIXTURE, "answers-mixed.json"));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, readFileSync(join(FIXTURE, "expected-mixed.txt"), "utf8"));
});

test("json report carries the same verdicts as the text report", () => {
    const result = run("--root", LANE, "--answers", join(FIXTURE, "answers-mixed.json"), "--format", "json");
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    const expected = readFileSync(join(FIXTURE, "expected-mixed.txt"), "utf8").split("\n");
    for (const entry of report.results) {
        const line = expected.find((candidate) => candidate.startsWith(`${entry.id}: `));
        assert.ok(line.startsWith(`${entry.id}: ${entry.verdict}`), `${entry.id}: ${entry.verdict} vs ${line}`);
    }
    assert.equal(report.summary.total.total, tasks().length);
});

test("unreadable or malformed inputs exit 2 and score nothing", () => {
    assert.equal(run("--root", LANE, "--answers", join(FIXTURE, "no-such-file.json")).status, 2);
    assert.equal(run("--root", join(FIXTURE, "no-such-lane"), "--answers", join(FIXTURE, "answers-mixed.json")).status, 2);
    assert.equal(run("--lane", "cobol", "--answers", join(FIXTURE, "answers-mixed.json")).status, 2);
    assert.equal(run("--root", LANE).status, 2);

    const wrongLane = run("--root", LANE, "--answers", join(FIXTURE, "answers-wrong-lane.json"));
    assert.equal(wrongLane.status, 2);
    assert.match(wrongLane.stderr, /is for lane go, but the lane being scored is fixture/);
    assert.deepEqual(validateAnswers({ version: 2, tool: {}, scope: "world", answers: [] }).length, 4);
});

test("the oracle passes every scorable fixture task", () => {
    const oracle = buildOracle(LANE, tasks());
    const scored = scoreLane({ root: LANE, lane: "lane", tasks: tasks(), answersDoc: oracle });
    const scorable = tasks().filter((candidate) => planTask(candidate).scorable && candidate.id !== "s-unresolved");
    assert.equal(scored.summary.total.PASS, scorable.length);
    assert.equal(scored.summary.total.FAIL, 0);
});

test("a lane-prefix exclusion needs repo scope to fire", () => {
    const answer = { locations: [{ file: "src/app.txt", line: 1 }, { file: "../php/app/Models/Customer.php", line: 18 }] };
    const repo = scoreTask(task("s-lane-prefix"), answer, { root: LANE, lane: "lane", scope: "repo" });
    assert.equal(repo.verdict, "FAIL");
    assert.match(repo.detail, /excluded "php\/" returned/);

    const laneOnly = scoreTask(task("s-lane-prefix"), { locations: [{ file: "src/app.txt", line: 1 }] }, { root: LANE, lane: "lane", scope: "lane" });
    assert.equal(laneOnly.verdict, "PASS");
    assert.deepEqual(laneOnly.notes, ["1 lane-prefix exclusion(s) not exercised, scope is lane"]);
});

test("a declaration never passes by range, a known site does", () => {
    const context = { root: LANE, lane: "lane", scope: "repo" };
    const enclosing = { locations: [{ file: "src/app.txt", line: 1, end_line: 7 }] };
    assert.equal(scoreTask(task("s-wrong-line"), enclosing, context).verdict, "FAIL");

    const withSite = { locations: [{ file: "src/app.txt", line: 1 }, { file: "src/app.txt", line: 3, end_line: 5 }] };
    assert.equal(scoreTask(task("s-known-site"), withSite, context).verdict, "PASS");
});

test("an answer for an id the lane does not have is reported, not dropped", () => {
    const result = run("--root", LANE, "--answers", join(FIXTURE, "answers-mixed.json"), "--format", "json");
    assert.deepEqual(JSON.parse(result.stdout).unknownIds, ["s-renamed-id"]);
});

test("an exclusion is matched on the reported line, and a known site is never an excluded hit", () => {
    const context = { root: LANE, lane: "lane", scope: "repo" };

    const ranged = { locations: [{ file: "src/app.txt", line: 4, end_line: 7 }] };
    assert.equal(scoreTask(task("s-range-over-excluded-text"), ranged, context).verdict, "PASS");
    const onTheLine = { locations: [{ file: "src/app.txt", line: 4 }, { file: "src/app.txt", line: 5 }] };
    assert.match(scoreTask(task("s-range-over-excluded-text"), onTheLine, context).detail, /excluded "Right" returned/);

    const knownSite = { locations: [{ file: "src/app.txt", line: 1 }, { file: "src/other.txt", line: 1 }] };
    assert.equal(scoreTask(task("s-known-site-excluded-path"), knownSite, context).verdict, "PASS");
});

test("a target anchored inside its declaration matches by containment, in that lane only", () => {
    const repo = resolve(HERE, "..", "..", "..");
    const python = JSON.parse(readFileSync(join(repo, "python", "bench", "tasks.json"), "utf8")).tasks;
    const anchored = python.find((candidate) => candidate.id === "def-super-cooperative");
    assert.equal(planTask(anchored, "python").targetInsideSymbol, true);
    assert.equal(planTask(anchored, "go").targetInsideSymbol, false);

    const root = join(repo, "python");
    const { line } = buildOracle(root, [anchored]).answers[anchored.id].locations[0];
    const method = { locations: [{ file: anchored.expect.file, line: line - 1, end_line: line }] };
    assert.equal(scoreTask(anchored, method, { root, lane: "python", scope: "repo" }).verdict, "PASS");
    assert.equal(scoreTask(anchored, method, { root, lane: "go", scope: "repo" }).verdict, "FAIL");
});

test("oracle.mjs output is accepted by score.mjs and passes every scorable task", () => {
    const oracle = spawnSync(process.execPath, [resolve(HERE, "..", "oracle.mjs"), "--root", LANE], { encoding: "utf8" });
    assert.equal(oracle.status, 0, oracle.stderr);

    const file = join(mkdtempSync(join(tmpdir(), "score-oracle-")), "oracle.json");
    writeFileSync(file, oracle.stdout);
    const scored = run("--root", LANE, "--answers", file);
    assert.equal(scored.status, 0, scored.stderr);
    assert.match(scored.stdout, /passed: (\d+) of \1 scorable \(100\.0%\)/);
});

test("every target matched by containment names a task that exists and is scorable", () => {
    const repo = resolve(HERE, "..", "..", "..");
    for (const key of TARGET_INSIDE_SYMBOL) {
        const [lane, id] = key.split(":");
        assert.ok(LANES.includes(lane), `${key}: unknown lane`);
        const root = join(repo, lane);
        const found = JSON.parse(readFileSync(join(root, "bench", "tasks.json"), "utf8")).tasks.find((candidate) => candidate.id === id);
        assert.ok(found, `${key}: no such task; the id was renamed or removed`);
        const plan = planTask(found, lane);
        assert.equal(plan.scorable, true, `${key}: ${plan.reason}`);
        assert.equal(resolveNeedle(root, plan.target).ok, true, `${key}: target does not resolve`);
    }
});

test("a kind whose key names two places is unscorable, and a near miss says why it failed", () => {
    const repo = resolve(HERE, "..", "..", "..");
    const rust = JSON.parse(readFileSync(join(repo, "rust", "bench", "tasks.json"), "utf8")).tasks;
    const generated = rust.find((candidate) => candidate.expect.kind === "build_generated");
    assert.equal(planTask(generated, "rust").scorable, false);
    assert.match(planTask(generated, "rust").reason, /kind build_generated/);

    const enclosing = { locations: [{ file: "src/app.txt", line: 1, end_line: 7 }] };
    const outcome = scoreTask(task("s-wrong-line"), enclosing, { root: LANE, lane: "lane", scope: "repo" });
    assert.match(outcome.detail, /a returned range covers the target line/);
});

test("must_not_include entries are classified by form", () => {
    assert.equal(classifyExclusion("php/"), "lane-prefix");
    assert.equal(classifyExclusion("packages/core/"), "text");
    assert.equal(classifyExclusion("impl .* for Money"), "pattern");
    assert.equal(classifyExclusion("app/http#NewServeMux"), "path#symbol");
    assert.equal(classifyExclusion("models/device.ts"), "text");
    assert.equal(classifyExclusion("ATELIER_UNIT_SUFFIX = 'u'"), "text");
});
