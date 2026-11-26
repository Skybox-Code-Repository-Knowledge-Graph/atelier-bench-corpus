/**
 * Exercises the three app files no test reached (issue #223, checklist F.5).
 *
 * - src/main.ts runs its command on import, so each case sets process.argv, captures console.log,
 *   resets the module registry and imports it again. `serve` is never run: it would listen.
 * - src/types/jsx.d.ts and src/types/legacy-formatting.d.ts are ambient declarations with no code,
 *   so nothing of them can load at runtime. The expectTypeOf lines below are their test: tsc
 *   (`npm run typecheck`, which covers every test file) rejects this file when either declaration
 *   stops matching what the views and http/legacy.ts rely on.
 */
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import type { LegacyMoney, legacyFormat } from "atelier-legacy-formatting";

import { toLegacyMoney } from "../src/http/legacy";
import type { Html } from "../src/views/h";

async function runMain(args: string[]): Promise<string[]> {
    const argv = process.argv;
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
        lines.push(String(line));
    });
    process.argv = [argv[0] ?? "node", "main.ts", ...args];
    try {
        vi.resetModules();
        await import("../src/main");
    } finally {
        process.argv = argv;
        log.mockRestore();
    }

    return lines;
}

describe("console entrypoint", { timeout: 30_000 }, () => {
    it("prints usage for help and for an unknown command", async () => {
        const usage = "usage: atelier <serve [port]|seed|report [slug]|recalculate>";

        expect(await runMain(["help"])).toEqual([usage]);
        expect(await runMain(["nonsense"])).toEqual([usage]);
    });

    it("prints the frozen seed summary and one line per metric", async () => {
        const lines = await runMain(["seed"]);

        expect(lines[0]).toBe("seeded: 3 customer(s), 4 order(s), 4 part(s), revenue 58325c");
        expect(lines).toHaveLength(1 + 16);
    });

    it("exports a report as csv", async () => {
        expect((await runMain(["report", "gross-profit"]))[0]).toContain("gross profit,120.25");
    });

    it("recalculates inventory", async () => {
        expect(await runMain(["recalculate"])).toEqual(["recalculated 1 part(s)"]);
    });
});

describe("ambient declarations", () => {
    it("types JSX elements as the h factory's Html", () => {
        expectTypeOf<JSX.Element>().toEqualTypeOf<Html>();
        expectTypeOf<JSX.IntrinsicElements["article"]>().toEqualTypeOf<Record<string, unknown>>();
    });

    it("types the legacy formatting module that ships no code", () => {
        expect(toLegacyMoney(4500)).toEqual({ cents: 4500, currency: "EUR" });
        expectTypeOf(toLegacyMoney(4500)).toEqualTypeOf<LegacyMoney>();
        expectTypeOf<typeof legacyFormat>().toEqualTypeOf<(money: LegacyMoney) => string>();
    });
});
