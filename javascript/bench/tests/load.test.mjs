// Every source file the lane ships is loaded by a test, and the CLI entry runs.
//
// The walk covers packages/*/src at run time, so a file added later is loaded
// here without anyone listing it: a module that throws on load, or that imports
// something it cannot reach, fails this test even when no other test touches it.
// packages/app/src/main.js is the CLI entry: importing it would run a command,
// so it is spawned as its own process instead, once per non-blocking command
// (`serve` listens until killed; createApp, which it calls, is covered by
// packages/app/tests/http.test.js). What the modules compute is exercised by
// the package test suites.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import process from "node:process";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const LANE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACKAGES = join(LANE_ROOT, "packages");
const CLI_ENTRY = join(PACKAGES, "app", "src", "main.js");

function sourceFiles() {
    const files = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (/\.(c|m)?js$/.test(entry.name)) files.push(full);
        }
    };
    for (const name of readdirSync(PACKAGES).sort()) {
        walk(join(PACKAGES, name, "src"));
    }
    return files.sort();
}

const laneRelative = (file) => relative(LANE_ROOT, file).split(sep).join("/");

function runCli(...args) {
    const result = spawnSync(process.execPath, [CLI_ENTRY, ...args], { encoding: "utf8", timeout: 30000 });
    assert.equal(result.status, 0, `main.js ${args.join(" ")} exited ${result.status}: ${result.stderr}`);
    return result.stdout.trimEnd().split("\n");
}

describe("every source file", () => {
    it("loads every module under packages/*/src", async (t) => {
        const files = sourceFiles();
        const failures = [];
        let loaded = 0;

        for (const file of files) {
            if (file === CLI_ENTRY) continue;
            try {
                await import(pathToFileURL(file).href);
                loaded += 1;
            } catch (error) {
                failures.push(`${laneRelative(file)}: ${error.message}`);
            }
        }

        t.diagnostic(`${loaded} module(s) loaded, ${files.length} source file(s) walked`);
        assert.deepEqual(failures, []);
        assert.ok(files.includes(CLI_ENTRY), "the walk reaches the CLI entry");
        assert.equal(loaded, files.length - 1);
    });

    it("runs the CLI entry for each command that exits", () => {
        assert.deepEqual(runCli(), ["usage: atelier <serve [port]|seed|report [slug]|recalculate>"]);

        const seed = runCli("seed");
        assert.equal(seed[0], "seeded: 3 customer(s), 4 order(s), 4 part(s), revenue 58325c");
        assert.equal(seed.length, 1 + 16 + 1);
        assert.equal(seed.at(-1), "rules: 48/48 satisfied");

        assert.deepEqual(runCli("report", "gross-profit"), ["revenue,583.25", "part cost,463.00", "gross profit,120.25"]);
        assert.deepEqual(runCli("recalculate"), ["recalculated 1 part(s)"]);
    });
});
