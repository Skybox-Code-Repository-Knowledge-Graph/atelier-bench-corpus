// bench/lsp-check.mjs and its committed report, bench/lsp-check.md (box E.5).
//
// The server run itself is not repeated here (it needs the language server and takes seconds);
// this test pins what the run rests on: the judging rules, one report row per keyed task of the
// four language-server surfaces, and the server and TypeScript versions the lockfile pins.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { HAND_MARKER, SURFACES, judgeHover, judgeImplementation, judgeListed, judgeSymbols, positionOf } from "../lsp-check.mjs";

const LANE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const report = readFileSync(join(LANE_ROOT, "bench", "lsp-check.md"), "utf8");
const tasks = JSON.parse(readFileSync(join(LANE_ROOT, "bench", "tasks.json"), "utf8")).tasks;
const lock = JSON.parse(readFileSync(join(LANE_ROOT, "package-lock.json"), "utf8"));

describe("lsp-check", () => {
    it("judges each surface by the key, never the other way round", () => {
        const hover = { expect: { contains: "zero-padded width" } };
        assert.equal(judgeHover(hover, { contents: { kind: "markdown", value: "a zero-padded width" } }).verdict, "agrees");
        assert.equal(judgeHover(hover, { contents: "other text" }).verdict, "disagrees");
        assert.equal(judgeHover(hover, null).verdict, "server has no answer");
        const docsym = { expect: { symbols: ["A", "b"] } };
        assert.equal(judgeSymbols(docsym, [{ name: "A", children: [{ name: "b" }] }]).verdict, "agrees");
        assert.match(judgeSymbols(docsym, [{ name: "A", children: [{ name: "b" }, { name: "c" }] }]).returned, /extra 1 \(c\)/);
        assert.equal(judgeListed([{ file: "x.js", line: 4 }], [{ file: "x.js", start: 3, end: 5 }], "callees").verdict, "agrees");
        assert.equal(judgeListed([{ file: "x.js", line: 9 }], [{ file: "x.js", start: 3, end: 5 }], "callees").verdict, "disagrees");
        assert.equal(judgeImplementation(["a.cjs:6"], ["base.cjs:3"], ["a.cjs:6", "base.cjs:3"]).verdict, "agrees");
        assert.equal(judgeImplementation(["a.cjs:6"], [], ["b.cjs:6"]).verdict, "disagrees");
        assert.deepEqual(positionOf("x\nfoo(bar, bar)\n", { needle: "foo(bar, bar)", symbol: "bar", occurrence: 2 }), { line: 1, character: 9 });
    });

    it("reports one row per keyed task of the four surfaces", () => {
        const keyed = tasks.filter((task) => SURFACES.includes(task.surface)).map((task) => task.id).sort();
        const rows = [...report.split(HAND_MARKER)[0].matchAll(/^\| `([a-z0-9-]+)` \| ([a-z_]+) \| (agrees|disagrees|server has no answer) \|/gm)];
        assert.deepEqual(rows.map((row) => row[1]).sort(), keyed);
        for (const row of rows) assert.equal(row[2], tasks.find((task) => task.id === row[1]).surface);
        assert.ok(report.includes(HAND_MARKER));
    });

    it("names the server and TypeScript versions the lockfile pins, and no local path", () => {
        const server = lock.packages["node_modules/typescript-language-server"].version;
        const typescript = lock.packages["node_modules/typescript"].version;
        assert.ok(report.includes(`\`typescript-language-server\` ${server}`));
        assert.ok(report.includes(`\`typescript\` ${typescript}`));
        assert.doesNotMatch(report, /file:\/\/|\/Users\/|\/home\//);
    });
});
